import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, Text, View } from 'react-native';
import { AudioContext } from 'react-native-audio-api';

import {
    AUDIO_SAMPLE_RATE,
    COLORS,
    EXERCISE_COUNTDOWN_SECONDS,
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import type { Tier } from '@/constants/params';
import {
    useAudioRecorder,
    type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { AgilitySequenceGuide } from '@/screens/exercises/Agility/AgilitySequenceGuide';

import ExerciseScreen, {
    ExerciseCountdownScreen,
    ExerciseListeningScreen,
    ExercisePreparingScreen,
    ExerciseProcessingScreen,
    ExerciseRecordingScreen,
    ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateVocalRunAccuracyParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureVocalRunAccuracy } from '@/services/measurement/agility/vocalRunAccuracyTask';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
    fetchComponentProgress,
    fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreVocalRunAccuracy } from '@/services/scoring/agility/vocalRunAccuracyTask';
import { sleep } from '@/utils/async';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { average } from '@/utils/math';
import {
    AGILITY_NOTE_START_DELAY_MS,
    getActiveSequenceNoteIndex,
} from '@/utils/music/notePlayer';
import { frequencyToNoteName } from '@/utils/music/notes';

import {
    ExerciseNoAudioModal,
    ExerciseQuitModal,
} from '@/components/ExerciseModals';

type Phase =
  | 'instructions'
  | 'listening'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

type VocalRange = {
  lowHz: number;
  highHz: number;
};

type Config = ReturnType<typeof generateVocalRunAccuracyParams>;

type LivePitch = {
  note: string;
  frequency: number;
};

type ExerciseResult = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  transitionScore: number;
  passed: boolean;
  feedback: string;
  noteCount: number;
  correctNoteCount: number;
  transitionCount: number;
  correctTransitionCount: number;
  notesPerSecond: number;
  durationMs: number;
  repetitionsCompleted: number;
};

type PitchStatus =
  | 'inTune'
  | 'close'
  | 'notInTune'
  | 'listening';

function isValidVocalRange(
  range: VocalRange | null | undefined,
): range is VocalRange {
  return (
    !!range &&
    Number.isFinite(range.lowHz) &&
    Number.isFinite(range.highHz) &&
    range.lowHz > 0 &&
    range.highHz > range.lowHz
  );
}

function getRecentVocalRunScores(
  records: Awaited<ReturnType<typeof fetchExerciseRecords>>,
  tier: Tier,
): number[] {
  return records
    .filter(
      exercise =>
        exercise.templateId === 'vocalRunAccuracy' &&
        exercise.tier === tier,
    )
    .slice(-5)
    .map(exercise => exercise.scorePct)
    .filter(
      score =>
        Number.isFinite(score) && score >= 0 && score <= 100,
    );
}

function getTimedTargetNoteIndex(
  elapsedSeconds: number,
  targetNoteCount: number,
  noteDurationSec: number,
  gapSec: number,
): number | null {
  return getActiveSequenceNoteIndex(
    elapsedSeconds,
    targetNoteCount,
    noteDurationSec,
    gapSec,
  );
}

function getSequenceDurationSeconds(
  noteCount: number,
  noteDurationSec: number,
  gapSec: number,
): number {
  if (
    noteCount <= 0 ||
    !Number.isFinite(noteDurationSec) ||
    noteDurationSec <= 0
  ) {
    return 0.1;
  }

  return (
    noteCount * noteDurationSec +
    Math.max(0, noteCount - 1) *
      Math.max(0, Number.isFinite(gapSec) ? gapSec : 0)
  );
}

function getPitchAccuracy(
  detectedFrequency: number,
  targetFrequency: number,
): {
  cents: number;
  status: Exclude<PitchStatus, 'listening'>;
} | null {
  if (
    !Number.isFinite(detectedFrequency) ||
    !Number.isFinite(targetFrequency) ||
    detectedFrequency <= 0 ||
    targetFrequency <= 0
  ) {
    return null;
  }

  const cents =
    1200 * Math.log2(detectedFrequency / targetFrequency);

  const absoluteCents = Math.abs(cents);

  if (absoluteCents <= 25) {
    return { cents, status: 'inTune' };
  }

  if (absoluteCents <= 50) {
    return { cents, status: 'close' };
  }

  return { cents, status: 'notInTune' };
}

export default function VocalRunAccuracyTaskScreen() {
  const [tier, setTier] = useState<Tier>('beginner');
  const [isLoadingTier, setIsLoadingTier] = useState(true);

  const [config, setConfig] = useState<Config | null>(null);
  const [isLoadingParams, setIsLoadingParams] =
    useState(true);

  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [countdown, setCountdown] = useState(
    EXERCISE_COUNTDOWN_SECONDS,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);

  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [livePitch, setLivePitch] = useState<LivePitch | null>(null);

  const [isPlayingReference, setIsPlayingReference] = useState(false);
  const [activeReferenceNoteIndex, setActiveReferenceNoteIndex] =
    useState<number | null>(null);

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const mountedRef = useRef(true);

  const audioContextRef = useRef<AudioContext | null>(null);

  const measurementsRef = useRef<
    ReturnType<typeof measureVocalRunAccuracy>[]
  >([]);

  const recordingStartedAtRef = useRef<number | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const exerciseRunIdRef = useRef(0);
  const countdownRunIdRef = useRef(0);
  const referencePlaybackIdRef = useRef(0);
  const startCountdownRef =
    useRef<(() => Promise<void>) | null>(null);
  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const referencePlayingRef = useRef(false);
  const processingRef = useRef(false);
  const recordingStartInProgressRef = useRef(false);

  const pausedRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');

  const recentScoresRef = useRef<number[]>([]);
  const vocalRangeRef = useRef<VocalRange | null>(null);
  const processRecordingRef = useRef<
    ((samples: Float32Array, sampleRate: number) => Promise<void>) | null
  >(null);

  const setExercisePhase = useCallback((next: Phase) => {
    console.log(`[VocalRun] Phase: ${phaseRef.current} -> ${next}`);

    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const handleLiveAudioFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      const frequency = frame.pitch;
      const clarity = frame.clarity;

      if (
        !Number.isFinite(frequency) ||
        frequency < 70 ||
        frequency > 1000 ||
        !Number.isFinite(clarity) ||
        clarity < 0.45
      ) {
        setLivePitch(null);
        return;
      }

      setLivePitch({
        note: frame.note || frequencyToNoteName(frequency),
        frequency,
      });
    },
    [],
  );

  const handleAudioRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      console.log('[VocalRun] Shared recorder stopped:', {
        sampleCount: samples.length,
        sampleRate,
        durationSeconds:
          sampleRate > 0 ? samples.length / sampleRate : 0,
      });

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        console.log(
          '[VocalRun] Ignoring stopped recording because exercise is paused or exiting.',
        );
        return;
      }

      const processor = processRecordingRef.current;

      if (!processor) {
        console.warn('[VocalRun] Recording processor is not ready.');
        return;
      }

      void processor(samples, sampleRate);
    },
    [],
  );

  const {
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording,
    cancelRecording: cancelAudioRecording,
  } = useAudioRecorder({
    onFrame: handleLiveAudioFrame,
    onStop: handleAudioRecordingStop,
  });

  const cancelActiveRecording = useCallback(async () => {
    clearRecordingTimer();
    recordingStartedAtRef.current = null;

    try {
      await cancelAudioRecording();
    } catch (errorMessage) {
      console.warn('[VocalRun] Could not cancel recording:', errorMessage);
    }
  }, [cancelAudioRecording, clearRecordingTimer]);

  const stopActiveRecording = useCallback(async () => {
    clearRecordingTimer();
    recordingStartedAtRef.current = null;

    try {
      await stopAudioRecording();
    } catch (errorMessage) {
      console.warn('[VocalRun] Could not stop recording:', errorMessage);

      if (
        mountedRef.current &&
        !quitInProgressRef.current &&
        !pausedRef.current
      ) {
        setErrorMessage(
          'The recording could not be stopped. Please try again.',
        );
        setExercisePhase('instructions');
      }
    }
  }, [
    clearRecordingTimer,
    setExercisePhase,
    stopAudioRecording,
  ]);

  const cancelReferencePlayback = useCallback(() => {
    referencePlaybackIdRef.current += 1;
    referencePlayingRef.current = false;

    const context = audioContextRef.current;

    if (context) {
      try {
        void context.suspend().catch(errorMessage => {
          console.warn(
            '[VocalRun] Could not suspend reference audio:',
            errorMessage,
          );
        });
      } catch (errorMessage) {
        console.warn(
          '[VocalRun] Could not suspend reference audio:',
          errorMessage,
        );
      }
    }

    if (mountedRef.current) {
      setIsPlayingReference(false);
      setActiveReferenceNoteIndex(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      exerciseRunIdRef.current += 1;
      countdownRunIdRef.current += 1;
      referencePlaybackIdRef.current += 1;

      pausedRef.current = true;
      referencePlayingRef.current = false;

      clearRecordingTimer();

      void cancelAudioRecording();

      const context = audioContextRef.current;
      audioContextRef.current = null;

      if (context) {
        try {
          void context.close();
        } catch (errorMessage) {
          console.warn(
            '[VocalRun] Could not close audio context:',
            errorMessage,
          );
        }
      }
    };
  }, [cancelAudioRecording, clearRecordingTimer]);

  useEffect(() => {
    let cancelled = false;

    async function loadTier() {
      const user = auth.currentUser;

      if (!user) {
        if (!cancelled) {
          setTier('beginner');
          setIsLoadingTier(false);
        }
        return;
      }

      try {
        const progress = await fetchComponentProgress(
          user.uid,
          'agility',
        );

        if (!cancelled) {
          setTier(progress?.currentTier ?? 'beginner');
        }
      } catch (errorMessage) {
        console.warn('[VocalRun] Could not load tier:', errorMessage);

        if (!cancelled) {
          setTier('beginner');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTier(false);
        }
      }
    }

    void loadTier();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isLoadingTier) {
      return;
    }

    let cancelled = false;

    async function loadParameters() {
      setIsLoadingParams(true);

      let recentScores: number[] = [];
      let vocalRange: VocalRange | null = null;

      const user = auth.currentUser;

      if (user) {
        try {
          const records = await fetchExerciseRecords(
            user.uid,
            'agility',
          );

          if (cancelled) {
            return;
          }

          recentScores = getRecentVocalRunScores(records, tier);
        } catch (errorMessage) {
          console.warn(
            '[VocalRun] Could not load score history:',
            errorMessage,
          );
        }

        if (cancelled) {
          return;
        }

        try {
          const assessment = await getLatestAssessment();

          if (cancelled) {
            return;
          }

          const lowHz =
            assessment?.vocalRange?.lowHz ??
            assessment?.vocalRangeLowHz;

          const highHz =
            assessment?.vocalRange?.highHz ??
            assessment?.vocalRangeHighHz;

          if (
            typeof lowHz === 'number' &&
            typeof highHz === 'number' &&
            isValidVocalRange({ lowHz, highHz })
          ) {
            vocalRange = { lowHz, highHz };
          }
        } catch (errorMessage) {
          console.warn(
            '[VocalRun] Could not load vocal range:',
            errorMessage,
          );
        }
      }

      if (cancelled) {
        return;
      }

      recentScoresRef.current = recentScores;
      vocalRangeRef.current = vocalRange;

      const generated = generateVocalRunAccuracyParams({
        tier,
        recentScores,
        vocalRange,
      });

      if (!cancelled) {
        console.log('[VocalRun] Adaptive parameters loaded:', {
          tier,
          hasVocalRange: isValidVocalRange(vocalRange),
          noteCount: generated.frequencies.length,
          repetitions: generated.repetitions,
          noteDurationSec: generated.noteDurationSec,
          gapSec: generated.gapSec,
        });

        setConfig(generated);
        setIsLoadingParams(false);
      }
    }

    void loadParameters().catch(errorMessage => {
      console.warn(
        '[VocalRun] Parameter loading failed:',
        errorMessage,
      );

      if (!cancelled) {
        const fallback = generateVocalRunAccuracyParams({
          tier,
          recentScores: recentScoresRef.current,
          vocalRange: vocalRangeRef.current,
        });

        setConfig(fallback);
        setIsLoadingParams(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [tier, isLoadingTier]);

  const hasValidGeneratedSequence =
    !!config &&
    isValidVocalRange(vocalRangeRef.current) &&
    config.frequencies.length >= 3 &&
    config.frequencies.every(
      frequency =>
        Number.isFinite(frequency) &&
        frequency > 0 &&
        frequency >= vocalRangeRef.current!.lowHz &&
        frequency <= vocalRangeRef.current!.highHz,
    );

  const recordingDurationSec = config
    ? getSequenceDurationSeconds(
        config.frequencies.length,
        config.noteDurationSec,
        config.gapSec,
      )
    : 0.1;

  const activeTargetNoteIndex =
    phase === 'recording' && config
      ? getTimedTargetNoteIndex(
          elapsedSeconds,
          config.frequencies.length,
          config.noteDurationSec,
          config.gapSec,
        )
      : null;

  const targetFrequency =
    activeTargetNoteIndex !== null && config
      ? config.frequencies[activeTargetNoteIndex]
      : null;

  const pitchAccuracy =
    livePitch && targetFrequency !== null
      ? getPitchAccuracy(livePitch.frequency, targetFrequency)
      : null;

  const pitchStatus: PitchStatus =
    pitchAccuracy?.status ?? 'listening';

  const pitchStatusColor =
    pitchStatus === 'inTune'
      ? COLORS.guideGreen
      : pitchStatus === 'close'
        ? COLORS.guideYellow
        : pitchStatus === 'notInTune'
          ? COLORS.guideRed
          : COLORS.brown;

  const playReference = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phaseRef.current !== 'listening' ||
      referencePlayingRef.current ||
      !config ||
      !hasValidGeneratedSequence
    ) {
      return;
    }

    const playbackId = ++referencePlaybackIdRef.current;

    referencePlayingRef.current = true;
    setIsPlayingReference(true);
    setErrorMessage('');

    let completed = false;

    try {
      const context =
        audioContextRef.current ??
        new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });

      audioContextRef.current = context;

      await context.resume();

      for (const [index, frequency] of config.frequencies.entries()) {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          playbackId !== referencePlaybackIdRef.current ||
          phaseRef.current !== 'listening'
        ) {
          return;
        }

        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.frequency.value = frequency;
        gain.gain.value = 0.12;

        oscillator.connect(gain);
        gain.connect(context.destination);

        const startTime = context.currentTime;

        oscillator.start(startTime);
        oscillator.stop(startTime + config.noteDurationSec);

        setActiveReferenceNoteIndex(index);

        await sleep(config.noteDurationSec * 1000);

        if (
          mountedRef.current &&
          playbackId === referencePlaybackIdRef.current
        ) {
          setActiveReferenceNoteIndex(null);
        }

        if (
          index < config.frequencies.length - 1 &&
          config.gapSec > 0
        ) {
          await sleep(config.gapSec * 1000);
        }
      }
      completed =
        mountedRef.current &&
        playbackId === referencePlaybackIdRef.current &&
        phaseRef.current === 'listening' &&
        !pausedRef.current &&
        !showQuitModalRef.current &&
        !quitInProgressRef.current;
    } catch (errorMessage) {
      console.warn(
        '[VocalRun] Reference playback failed:',
        errorMessage,
      );

      if (
        mountedRef.current &&
        playbackId === referencePlaybackIdRef.current
      ) {
        setErrorMessage(
          'The reference sequence could not be played. Please try again.',
        );
      }
    } finally {
      if (playbackId === referencePlaybackIdRef.current) {
        referencePlayingRef.current = false;

        if (mountedRef.current) {
          setIsPlayingReference(false);
          setActiveReferenceNoteIndex(null);
        }
      }
    }
    if (completed) {
      void startCountdownRef.current?.();
    }
  }, [config, hasValidGeneratedSequence]);

  const beginExercise = useCallback(async () => {
    if (
      isLoadingTier ||
      isLoadingParams ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phaseRef.current !== 'instructions'
    ) {
      return;
    }

    if (!hasValidGeneratedSequence) {
      setErrorMessage(
        'A valid vocal range could not be found. Please complete your vocal range assessment before starting this exercise.',
      );
      return;
    }

    setErrorMessage('');

    exerciseRunIdRef.current += 1;
    countdownRunIdRef.current += 1;

    cancelReferencePlayback();

    measurementsRef.current = [];
    processingRef.current = false;
    recordingStartInProgressRef.current = false;

    setCurrentRep(1);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setElapsedSeconds(0);
    setLivePitch(null);
    setResult(null);
    setShowNoAudioModal(false);
    setExercisePhase('listening');
    void playReference();
  }, [
    cancelReferencePlayback,
    hasValidGeneratedSequence,
    isLoadingParams,
    isLoadingTier,
    playReference,
    setExercisePhase,
  ]);

  const processRecording = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      if (
        processingRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        !config ||
        phaseRef.current !== 'processing'
      ) {
        return;
      }

      processingRef.current = true;

      const runId = exerciseRunIdRef.current;

      try {
        setLivePitch(null);

        if (
          !Number.isFinite(sampleRate) ||
          sampleRate <= 0 ||
          samples.length === 0 ||
          !hasSufficientRecordedSignal(samples)
        ) {
          console.warn('[VocalRun] No sufficient audio signal:', {
            sampleCount: samples.length,
            sampleRate,
          });

          if (
            mountedRef.current &&
            runId === exerciseRunIdRef.current &&
            !quitInProgressRef.current
          ) {
            setElapsedSeconds(0);
            setExercisePhase('listening');
            setShowNoAudioModal(true);
          }

          return;
        }

        const measurement = measureVocalRunAccuracy(
          samples,
          sampleRate,
          config.frequencies,
        );

        console.log('[VocalRun] Measurement:', {
          sampleCount: samples.length,
          sampleRate,
          durationSeconds: samples.length / sampleRate,
          targetNotes: measurement.targetNotes,
          detectedNotes: measurement.detectedNotes,
          pitchAccuracy: measurement.pitchAccuracy,
          sequenceAccuracy: measurement.sequenceAccuracy,
          noteCount: measurement.noteCount,
          correctNoteCount: measurement.correctNoteCount,
          transitionCount: measurement.transitionCount,
          correctTransitionCount:
            measurement.correctTransitionCount,
        });

        if (
          !mountedRef.current ||
          runId !== exerciseRunIdRef.current ||
          quitInProgressRef.current
        ) {
          return;
        }

        measurementsRef.current.push(measurement);

        const completedRepetitions = measurementsRef.current.length;

        if (completedRepetitions < config.repetitions) {
          setCurrentRep(completedRepetitions + 1);
          setCountdown(EXERCISE_COUNTDOWN_SECONDS);
          setElapsedSeconds(0);
          setLivePitch(null);

          processingRef.current = false;
          setExercisePhase('listening');
          void playReference();

          return;
        }

        const measurements = measurementsRef.current;

        const totalNoteCount = measurements.reduce(
          (sum, item) => sum + item.noteCount,
          0,
        );

        const totalCorrectNoteCount = measurements.reduce(
          (sum, item) => sum + item.correctNoteCount,
          0,
        );

        const totalTransitionCount = measurements.reduce(
          (sum, item) => sum + item.transitionCount,
          0,
        );

        const totalCorrectTransitionCount = measurements.reduce(
          (sum, item) => sum + item.correctTransitionCount,
          0,
        );

        const totalDurationMs = measurements.reduce(
          (sum, item) => sum + item.durationMs,
          0,
        );

        const pitchScore = average(
          measurements.map(item => item.pitchAccuracy),
        );

        const sequenceScore = average(
          measurements.map(item => item.sequenceAccuracy),
        );

        const notesPerSecond =
          totalDurationMs > 0
            ? totalNoteCount / (totalDurationMs / 1000)
            : 0;

        const aggregatedMeasurement = {
          detectedPitches: measurements.flatMap(
            item => item.detectedPitches,
          ),
          detectedNotes: measurements.flatMap(
            item => item.detectedNotes,
          ),
          targetNotes: measurements.flatMap(
            item => item.targetNotes,
          ),
          pitchAccuracy: pitchScore,
          sequenceAccuracy: sequenceScore,
          noteCount: totalNoteCount,
          correctNoteCount: totalCorrectNoteCount,
          transitionCount: totalTransitionCount,
          correctTransitionCount: totalCorrectTransitionCount,
          durationMs: totalDurationMs,
          notesPerSecond,
        };

        const score = scoreVocalRunAccuracy(
          aggregatedMeasurement,
          config.accuracyThreshold,
        );

        if (
          !mountedRef.current ||
          runId !== exerciseRunIdRef.current ||
          quitInProgressRef.current
        ) {
          return;
        }

        const feedback = score.passed
          ? score.feedback
          : sequenceScore < config.accuracyThreshold
            ? `Sequence accuracy must reach at least ${config.accuracyThreshold}% for the ${config.label.toLowerCase()} level.`
            : score.feedback;

        await saveCompletedExercise(
          'agility',
          'vocalRunAccuracy',
          tier,
          score.overall,
        );

        if (
          !mountedRef.current ||
          runId !== exerciseRunIdRef.current ||
          quitInProgressRef.current
        ) {
          return;
        }

        setResult({
          overall: score.overall,
          pitchScore: score.pitchScore,
          sequenceScore: score.sequenceScore,
          transitionScore: score.transitionScore,
          passed: score.passed,
          feedback,
          noteCount: totalNoteCount,
          correctNoteCount: totalCorrectNoteCount,
          transitionCount: totalTransitionCount,
          correctTransitionCount: totalCorrectTransitionCount,
          notesPerSecond,
          durationMs: totalDurationMs,
          repetitionsCompleted: measurements.length,
        });

        setExercisePhase('results');
      } catch (errorMessage) {
        console.warn(
          '[VocalRun] Recording processing failed:',
          errorMessage,
        );

        if (
          mountedRef.current &&
          runId === exerciseRunIdRef.current &&
          !quitInProgressRef.current
        ) {
          setErrorMessage(
            'We could not analyze this recording. Please try again.',
          );
          setExercisePhase('instructions');
        }
      } finally {
        if (runId === exerciseRunIdRef.current) {
          processingRef.current = false;
        }
      }
    },
    [config, setExercisePhase, tier],
  );

  processRecordingRef.current = processRecording;

  const startRecording = useCallback(async () => {
    if (
      recordingStartInProgressRef.current ||
      phaseRef.current !== 'listening' ||
      referencePlayingRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      !config
    ) {
      return;
    }

    recordingStartInProgressRef.current = true;

    const runId = exerciseRunIdRef.current;

    try {
      setElapsedSeconds(0);
      setLivePitch(null);

      recordingStartedAtRef.current = Date.now();

      setExercisePhase('recording');

      console.log('[VocalRun] Starting shared audio recorder.');

      await startAudioRecording();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        runId !== exerciseRunIdRef.current
      ) {
        console.log(
          '[VocalRun] Recording start completed after cancellation. Discarding it.',
        );

        await cancelActiveRecording();
        return;
      }

      recordingStartedAtRef.current = Date.now();

      console.log('[VocalRun] Recording started successfully.');

      recordingTimerRef.current = setInterval(() => {
        const started = recordingStartedAtRef.current;

        if (
          started === null ||
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          runId !== exerciseRunIdRef.current ||
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        const elapsedSeconds = (Date.now() - started) / 1000;

        const boundedElapsed = Math.min(
          elapsedSeconds,
          recordingDurationSec,
        );

        setElapsedSeconds(boundedElapsed);

        if (elapsedSeconds >= recordingDurationSec) {
          setElapsedSeconds(recordingDurationSec);

          clearRecordingTimer();
          recordingStartedAtRef.current = null;

          setExercisePhase('processing');

          console.log(
            '[VocalRun] Recording duration reached. Stopping recorder.',
          );

          void stopActiveRecording();
        }
      }, 20);
    } catch (errorMessage) {
      console.warn(
        '[VocalRun] Could not start recording:',
        errorMessage,
      );

      await cancelActiveRecording();

      if (
        mountedRef.current &&
        runId === exerciseRunIdRef.current &&
        !quitInProgressRef.current &&
        !pausedRef.current
      ) {
        setLivePitch(null);
        setErrorMessage(
          'We could not start the recording. Please check microphone access and try again.',
        );
        setExercisePhase('instructions');
      }
    } finally {
      recordingStartInProgressRef.current = false;
    }
  }, [
    cancelActiveRecording,
    clearRecordingTimer,
    config,
    recordingDurationSec,
    setExercisePhase,
    startAudioRecording,
    stopActiveRecording,
  ]);
  startRecordingRef.current = startRecording;

  const startCountdown = useCallback(async () => {
    if (
      (phaseRef.current !== 'instructions' &&
        phaseRef.current !== 'listening') ||
      referencePlayingRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const runId = ++countdownRunIdRef.current;

    setErrorMessage('');
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setExercisePhase('countdown');

    for (
      let value = EXERCISE_COUNTDOWN_SECONDS;
      value >= 1;
      value--
    ) {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        countdownRunIdRef.current !== runId
      ) {
        return;
      }

      setCountdown(value);
      await sleep(1000);
    }

    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      countdownRunIdRef.current !== runId
    ) {
      return;
    }

    setCountdown(0);
    await sleep(AGILITY_NOTE_START_DELAY_MS);

    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      countdownRunIdRef.current !== runId
    ) {
      return;
    }

    setExercisePhase('listening');
    void startRecordingRef.current?.();
  }, [setExercisePhase]);
  startCountdownRef.current = startCountdown;

  const resetExercise = useCallback(() => {
    if (quitInProgressRef.current) {
      return;
    }

    exerciseRunIdRef.current += 1;
    countdownRunIdRef.current += 1;

    cancelReferencePlayback();

    void cancelActiveRecording();

    processingRef.current = false;
    recordingStartInProgressRef.current = false;

    measurementsRef.current = [];

    let nextScores = recentScoresRef.current;

    if (
      result &&
      Number.isFinite(result.overall) &&
      result.overall >= 0 &&
      result.overall <= 100
    ) {
      nextScores = [...nextScores, result.overall].slice(-5);
      recentScoresRef.current = nextScores;
    }

    const nextConfig = generateVocalRunAccuracyParams({
      tier,
      recentScores: nextScores,
      vocalRange: vocalRangeRef.current,
      previousFrequencies: config?.frequencies,
    });

    pausedRef.current = false;
    showQuitModalRef.current = false;

    setShowQuitModal(false);
    setShowNoAudioModal(false);
    setIsQuitting(false);

    setConfig(nextConfig);
    setResult(null);
    setCurrentRep(1);
    setElapsedSeconds(0);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setLivePitch(null);
    setErrorMessage('');

    setExercisePhase('instructions');
  }, [
    cancelActiveRecording,
    cancelReferencePlayback,
    config,
    result,
    setExercisePhase,
    tier,
  ]);

  const pauseForExitPrompt = useCallback(() => {
    if (
      !mountedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    pausedPhaseRef.current = phaseRef.current;

    pausedRef.current = true;
    showQuitModalRef.current = true;

    countdownRunIdRef.current += 1;

    cancelReferencePlayback();

    if (pausedPhaseRef.current === 'recording') {
      setElapsedSeconds(0);
      setLivePitch(null);

      void cancelActiveRecording();
    } else if (pausedPhaseRef.current === 'countdown') {
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    }

    setShowQuitModal(true);
  }, [cancelActiveRecording, cancelReferencePlayback]);

  const continueExercise = useCallback(async () => {
    if (quitInProgressRef.current) {
      return;
    }

    const previousPhase = pausedPhaseRef.current;

    setShowQuitModal(false);
    setErrorMessage('');

    if (
      previousPhase === 'countdown' ||
      previousPhase === 'recording'
    ) {
      while (
        recordingStartInProgressRef.current &&
        mountedRef.current &&
        !quitInProgressRef.current
      ) {
        await sleep(50);
      }

      if (!mountedRef.current || quitInProgressRef.current) {
        return;
      }

      await cancelActiveRecording();

      if (!mountedRef.current || quitInProgressRef.current) {
        return;
      }

      pausedRef.current = false;
      showQuitModalRef.current = false;

      setElapsedSeconds(0);
      setLivePitch(null);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);

      setExercisePhase('listening');
      void playReference();
      return;
    }

    pausedRef.current = false;
    showQuitModalRef.current = false;

    if (previousPhase === 'listening') {
      setExercisePhase('listening');
      void playReference();
      return;
    }

    if (previousPhase === 'processing') {
      setExercisePhase('listening');
      return;
    }

    setExercisePhase(previousPhase);
  }, [
    cancelActiveRecording,
    playReference,
    setExercisePhase,
  ]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) {
      return;
    }

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;

    exerciseRunIdRef.current += 1;
    countdownRunIdRef.current += 1;
    referencePlaybackIdRef.current += 1;

    referencePlayingRef.current = false;
    processingRef.current = false;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearRecordingTimer();

    setLivePitch(null);
    setElapsedSeconds(0);

    cancelReferencePlayback();

    await cancelActiveRecording();

    const context = audioContextRef.current;
    audioContextRef.current = null;

    if (context) {
      try {
        await context.close();
      } catch (errorMessage) {
        console.warn(
          '[VocalRun] Could not close audio context:',
          errorMessage,
        );
      }
    }

    router.replace('/exercises/agility');
  }, [
    cancelActiveRecording,
    cancelReferencePlayback,
    clearRecordingTimer,
  ]);

  const handleBack = useCallback(() => {
    pauseForExitPrompt();
  }, [pauseForExitPrompt]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (
          showQuitModalRef.current ||
          quitInProgressRef.current
        ) {
          return true;
        }

        handleBack();
        return true;
      },
    );

    return () => subscription.remove();
  }, [handleBack]);

  const quitModalMessage =
    pausedPhaseRef.current === 'instructions' ||
    pausedPhaseRef.current === 'results'
      ? 'Are you sure you want to leave Vocal Run Accuracy?'
      : pausedPhaseRef.current === 'recording'
        ? 'Your completed repetitions will be kept. The current repetition will restart when you continue.'
        : pausedPhaseRef.current === 'countdown'
          ? 'Your completed repetitions will be kept. The current repetition will restart when you continue.'
          : pausedPhaseRef.current === 'listening'
            ? 'Your completed repetitions will be kept. Continue to return to the listening sequence.'
            : 'Your completed repetitions will be kept. Continue to resume your exercise.';

  const renderInstructions = () => (
    <ExerciseScreen
      title="Vocal Run Accuracy"
      category="VOCAL AGILITY"
      icon="flash-outline"
      tier={tier}
      instructions="Listen carefully to the reference vocal run, then sing every note in the same order. Keep your pitch accurate and move smoothly between notes."
      preparationSteps={[
        {
          icon: 'ear-outline',
          text: 'Listen carefully to the reference vocal run.',
        },
        {
          icon: 'musical-notes-outline',
          text: 'Sing every note in the same order.',
        },
        {
          icon: 'trending-up-outline',
          text: 'Maintain accurate pitch and smooth transitions.',
        },
        {
          icon: 'repeat-outline',
          text: `Complete all ${config!.repetitions} repetitions.`,
        },
      ]}
      summary={[
        {
          label: 'DIFFICULTY',
          value: config!.label,
        },
        {
          label: 'SPEED',
          value: config!.speedLabel,
        },
        {
          label: 'NOTES',
          value: String(config!.frequencies.length),
        },
        {
          label: 'REPETITIONS',
          value: String(config!.repetitions),
        },
        {
          label: 'ACCURACY TARGET',
          value: `${config!.accuracyThreshold}%`,
        },
        {
          label: 'NOTE DURATION',
          value: `${config!.noteDurationSec.toFixed(2)} sec`,
        },
      ]}
      errorMessage={errorMessage || null}
      startDisabled={!hasValidGeneratedSequence}
      startLabel="Start Exercise"
      onBack={handleBack}
      onStart={() => void beginExercise()}
    />
  );

  const renderReference = () => (
    <ExerciseListeningScreen
      icon="musical-notes-outline"
      title="Vocal Run Accuracy"
      currentRep={currentRep}
      repetitions={config!.repetitions}
      promptTitle="Listen to the Sequence"
      prompt="Listen to the full reference run, then sing the notes in the same order."
      liveContent={
        <AgilitySequenceGuide
          names={config!.frequencies.map(frequencyToNoteName)}
          activeIndex={activeReferenceNoteIndex}
          noteDurationSec={config!.noteDurationSec}
          gapSec={config!.gapSec}
          caption="The highlight follows each note while it plays."
        />
      }
      errorMessage={errorMessage || null}
      isPlayingReference={isPlayingReference}
      onPlayReference={() => void playReference()}
      onBack={handleBack}
    />
  );

  const renderCountdown = () => (
    <ExerciseCountdownScreen
      icon="flash-outline"
      title="Get Ready"
      currentRep={currentRep}
      repetitions={config!.repetitions}
      countdown={countdown}
      promptTitle="Prepare to sing"
      prompt="Get ready to sing each note in the displayed order."
    />
  );

  const renderRecording = () => (
    <ExerciseRecordingScreen
      title="Sing the Vocal Run"
      currentRep={currentRep}
      repetitions={config!.repetitions}
      onBack={handleBack}
    >
      <AgilitySequenceGuide
        names={config!.frequencies.map(frequencyToNoteName)}
        activeIndex={activeTargetNoteIndex}
        noteDurationSec={config!.noteDurationSec}
        gapSec={config!.gapSec}
        liveNote={livePitch?.note}
        showFeedback
        caption="Follow the highlighted note. Green is in tune, yellow is close, and red is off pitch."
      />

      <View style={exerciseStyles.recordingCard}>
        <Text style={exerciseStyles.cardTitleVariant2}>CURRENT NOTE</Text>

        <Text
          style={[
            exerciseStyles.livePitch,
            { color: pitchStatusColor },
          ]}
        >
          {livePitch?.note ?? '--'}
        </Text>

        <Text style={exerciseStyles.hint}>
          {livePitch
            ? `${livePitch.frequency.toFixed(1)} Hz`
            : '--'}
        </Text>

        {pitchAccuracy ? (
          <Text style={exerciseStyles.pitchDeviation}>
            {Math.abs(pitchAccuracy.cents).toFixed(0)} cents{' '}
            {pitchAccuracy.cents > 0
              ? 'sharp'
              : pitchAccuracy.cents < 0
                ? 'flat'
                : 'on pitch'}
          </Text>
        ) : null}
      </View>

      <View style={exerciseStyles.timerContainer}>
        <View style={exerciseStyles.progressTrackVariant2}>
          <View
            style={[
              exerciseStyles.progressFill,
              {
                width: `${
                  recordingDurationSec > 0
                    ? Math.min(
                        100,
                        (elapsedSeconds / recordingDurationSec) * 100,
                      )
                    : 0
                }%`,
              },
            ]}
          />
        </View>
      </View>
    </ExerciseRecordingScreen>
  );

  const renderProcessing = () => (
    <ExerciseProcessingScreen
      icon="analytics-outline"
      title="Analyzing Your Singing"
      message="Measuring pitch, sequence, and transition accuracy."
    />
  );

  const renderResults = () => {
    if (!result) {
      return (
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Preparing Your Results"
          message="Please wait while your results are prepared."
        />
      );
    }

    const accuracyItems: [string, number][] = [
      ['Pitch Accuracy', result.pitchScore],
      ['Sequence Accuracy', result.sequenceScore],
      ['Transition Accuracy', result.transitionScore],
    ];

    const metrics: [string, string][] = [
      [
        'Correct Notes',
        `${result.correctNoteCount}/${result.noteCount}`,
      ],
      [
        'Correct Transitions',
        `${result.correctTransitionCount}/${result.transitionCount}`,
      ],
      ['Notes/sec', result.notesPerSecond.toFixed(2)],
      [
        'Total Duration',
        `${(result.durationMs / 1000).toFixed(1)}s`,
      ],
    ];

    return (
      <ExerciseResultsScreen
        title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
        subtitle="VOCAL RUN ACCURACY RESULT"
        score={Math.round(result.overall)}
        scoreSuffix=" / 100"
        resultIcon={
          result.passed
            ? 'checkmark-circle-outline'
            : 'refresh-outline'
        }
        scoreMessage={result.feedback}
        scoreDetails={
          <Text style={exerciseStyles.hint}>
            {result.repetitionsCompleted} of {config!.repetitions}{' '}
            repetitions completed
          </Text>
        }
        onBack={handleBack}
        onRetry={resetExercise}
        onExit={handleBack}
      >
        <View style={exerciseStyles.cardVariant1}>
          <Text style={exerciseStyles.cardTitleVariant2}>Accuracy Breakdown</Text>

          {accuracyItems.map(([label, value]) => (
            <View key={label} style={exerciseStyles.metricBlock}>
              <View style={exerciseStyles.detailRow}>
                <Text style={exerciseStyles.detailLabel}>{label}</Text>

                <Text style={exerciseStyles.metricValue}>
                  {Math.round(value)}%
                </Text>
              </View>

              <View style={exerciseStyles.progressTrackVariant2}>
                <View
                  style={[
                    exerciseStyles.progressFill,
                    {
                      width: `${Math.max(
                        0,
                        Math.min(100, value),
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))}

          <Text style={exerciseStyles.hint}>
            Sequence target: {config!.accuracyThreshold}%
          </Text>
        </View>

        <View style={exerciseStyles.cardVariant1}>
          <Text style={exerciseStyles.cardTitleVariant2}>Performance Metrics</Text>

          {metrics.map(([label, value]) => (
            <View key={label} style={exerciseStyles.detailRow}>
              <Text style={exerciseStyles.detailLabel}>{label}</Text>
              <Text style={exerciseStyles.metricValue}>{value}</Text>
            </View>
          ))}
        </View>
      </ExerciseResultsScreen>
    );
  };

  const quitModal = (
    <ExerciseQuitModal
      visible={showQuitModal}
      title="Quit exercise?"
      message={quitModalMessage}
      isQuitting={isQuitting}
      onContinue={() => void continueExercise()}
      onQuit={() => void quitExercise()}
      continueLabel="Continue Exercise"
      quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
    />
  );

  const noAudioModal = (
    <ExerciseNoAudioModal
      visible={showNoAudioModal}
      onRedo={() => {
        setShowNoAudioModal(false);
        setLivePitch(null);
        setElapsedSeconds(0);
        setExercisePhase('listening');
        void playReference();
      }}
      onQuit={() => {
        setShowNoAudioModal(false);
        void quitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  if (isLoadingTier || isLoadingParams || !config) {
    return (
      <ExercisePreparingScreen
        title="Preparing Your Exercise"
        message="Loading your difficulty level and assessed vocal range."
        icon="options-outline"
        iconSize={38}
      />
    );
  }

  return (
    <View style={exerciseStyles.screen}>
      {phase === 'instructions' ? (
        renderInstructions()
      ) : phase === 'countdown' ? (
        renderCountdown()
      ) : phase === 'processing' ? (
        renderProcessing()
      ) : phase === 'results' ? (
        renderResults()
      ) : (
        <ScrollView
          key={phase}
          style={exerciseStyles.screen}
          contentContainerStyle={exerciseStyles.scrollContent_Register}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {phase === 'listening' && renderReference()}
          {phase === 'recording' && renderRecording()}
        </ScrollView>
      )}

      {quitModal}
      {noAudioModal}
    </View>
  );
}
