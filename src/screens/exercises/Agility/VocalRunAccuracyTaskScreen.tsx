import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AudioContext } from 'react-native-audio-api';

import {
  AUDIO_SAMPLE_RATE,
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
} from '@/constants/appConstants';
import type { Tier } from '@/constants/params';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import { AgilitySequenceGuide } from '@/screens/exercises/Agility/AgilitySequenceGuide';
import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseNoAudioModal,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseQuitModal,
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
import { frequencyToNoteName } from '@/utils/music/notes';

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
  if (
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds < 0 ||
    targetNoteCount <= 0 ||
    !Number.isFinite(noteDurationSec) ||
    noteDurationSec <= 0
  ) {
    return null;
  }

  const gap = Math.max(
    0,
    Number.isFinite(gapSec) ? gapSec : 0,
  );

  const cycle = noteDurationSec + gap;
  const index = Math.floor(elapsedSeconds / cycle);

  if (index >= targetNoteCount) {
    return null;
  }

  return elapsedSeconds - index * cycle < noteDurationSec
    ? index
    : null;
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
  const [tierLoading, setTierLoading] = useState(true);

  const [config, setConfig] = useState<Config | null>(null);
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(
    EXERCISE_COUNTDOWN_SECONDS,
  );
  const [recordingTime, setRecordingTime] = useState(0);
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
  const phaseRef = useRef<Phase>('instructions');

  const audioContextRef = useRef<AudioContext | null>(null);

  const measurementsRef = useRef<
    ReturnType<typeof measureVocalRunAccuracy>[]
  >([]);

  const recordingStartRef = useRef<number | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const exerciseRunIdRef = useRef(0);
  const countdownRunIdRef = useRef(0);
  const referencePlaybackIdRef = useRef(0);

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
    recordingStartRef.current = null;

    try {
      await cancelAudioRecording();
    } catch (error) {
      console.warn('[VocalRun] Could not cancel recording:', error);
    }
  }, [cancelAudioRecording, clearRecordingTimer]);

  const stopActiveRecording = useCallback(async () => {
    clearRecordingTimer();
    recordingStartRef.current = null;

    try {
      await stopAudioRecording();
    } catch (error) {
      console.warn('[VocalRun] Could not stop recording:', error);

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
        void context.suspend().catch(error => {
          console.warn(
            '[VocalRun] Could not suspend reference audio:',
            error,
          );
        });
      } catch (error) {
        console.warn(
          '[VocalRun] Could not suspend reference audio:',
          error,
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
        } catch (error) {
          console.warn(
            '[VocalRun] Could not close audio context:',
            error,
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
          setTierLoading(false);
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
      } catch (error) {
        console.warn('[VocalRun] Could not load tier:', error);

        if (!cancelled) {
          setTier('beginner');
        }
      } finally {
        if (!cancelled) {
          setTierLoading(false);
        }
      }
    }

    void loadTier();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tierLoading) {
      return;
    }

    let cancelled = false;

    async function loadParameters() {
      setIsLoadingAdaptiveParams(true);

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
        } catch (error) {
          console.warn(
            '[VocalRun] Could not load score history:',
            error,
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
        } catch (error) {
          console.warn(
            '[VocalRun] Could not load vocal range:',
            error,
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
        setIsLoadingAdaptiveParams(false);
      }
    }

    void loadParameters().catch(error => {
      console.warn(
        '[VocalRun] Parameter loading failed:',
        error,
      );

      if (!cancelled) {
        const fallback = generateVocalRunAccuracyParams({
          tier,
          recentScores: recentScoresRef.current,
          vocalRange: vocalRangeRef.current,
        });

        setConfig(fallback);
        setIsLoadingAdaptiveParams(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [tier, tierLoading]);

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
          recordingTime,
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
    } catch (error) {
      console.warn(
        '[VocalRun] Reference playback failed:',
        error,
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
  }, [config, hasValidGeneratedSequence]);

  const beginExercise = useCallback(async () => {
    if (
      tierLoading ||
      isLoadingAdaptiveParams ||
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
    setRecordingTime(0);
    setLivePitch(null);
    setResult(null);
    setShowNoAudioModal(false);
    setExercisePhase('listening');
  }, [
    cancelReferencePlayback,
    hasValidGeneratedSequence,
    isLoadingAdaptiveParams,
    setExercisePhase,
    tierLoading,
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
            setRecordingTime(0);
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
          setRecordingTime(0);
          setLivePitch(null);

          processingRef.current = false;
          setExercisePhase('listening');

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
      } catch (error) {
        console.warn(
          '[VocalRun] Recording processing failed:',
          error,
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
      phaseRef.current !== 'countdown' ||
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
      setRecordingTime(0);
      setLivePitch(null);

      recordingStartRef.current = Date.now();

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

      recordingStartRef.current = Date.now();

      console.log('[VocalRun] Recording started successfully.');

      recordingTimerRef.current = setInterval(() => {
        const started = recordingStartRef.current;

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

        const elapsed = (Date.now() - started) / 1000;

        const boundedElapsed = Math.min(
          elapsed,
          recordingDurationSec,
        );

        setRecordingTime(boundedElapsed);

        if (elapsed >= recordingDurationSec) {
          setRecordingTime(recordingDurationSec);

          clearRecordingTimer();
          recordingStartRef.current = null;

          setExercisePhase('processing');

          console.log(
            '[VocalRun] Recording duration reached. Stopping recorder.',
          );

          void stopActiveRecording();
        }
      }, 100);
    } catch (error) {
      console.warn(
        '[VocalRun] Could not start recording:',
        error,
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

  const startCountdown = useCallback(async () => {
    if (
      phaseRef.current !== 'listening' ||
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
    await sleep(500);

    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      countdownRunIdRef.current !== runId
    ) {
      return;
    }

    await startRecording();
  }, [setExercisePhase, startRecording]);

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
    setRecordingTime(0);
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
      setRecordingTime(0);
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

      setRecordingTime(0);
      setLivePitch(null);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);

      setExercisePhase('listening');
      return;
    }

    pausedRef.current = false;
    showQuitModalRef.current = false;

    if (previousPhase === 'listening') {
      setExercisePhase('listening');
      return;
    }

    if (previousPhase === 'processing') {
      setExercisePhase('listening');
      return;
    }

    setExercisePhase(previousPhase);
  }, [
    cancelActiveRecording,
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
    setRecordingTime(0);

    cancelReferencePlayback();

    await cancelActiveRecording();

    const context = audioContextRef.current;
    audioContextRef.current = null;

    if (context) {
      try {
        await context.close();
      } catch (error) {
        console.warn(
          '[VocalRun] Could not close audio context:',
          error,
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
      error={errorMessage || null}
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
          caption="The pink highlight follows the note being played."
        />
      }
      error={errorMessage || null}
      isPlayingReference={isPlayingReference}
      onPlayReference={() => void playReference()}
      onContinue={() => void startCountdown()}
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
        liveNote={livePitch?.note}
        showFeedback
        caption="Follow the highlighted note. Green is in tune, yellow is close, and red is off pitch."
      />

      <View style={styles.recordingCard}>
        <Text style={styles.cardTitle}>CURRENT NOTE</Text>

        <Text
          style={[
            styles.livePitch,
            { color: pitchStatusColor },
          ]}
        >
          {livePitch?.note ?? '--'}
        </Text>

        <Text style={styles.hint}>
          {livePitch
            ? `${livePitch.frequency.toFixed(1)} Hz`
            : '--'}
        </Text>

        {pitchAccuracy ? (
          <Text style={styles.pitchDeviation}>
            {Math.abs(pitchAccuracy.cents).toFixed(0)} cents{' '}
            {pitchAccuracy.cents > 0
              ? 'sharp'
              : pitchAccuracy.cents < 0
                ? 'flat'
                : 'on pitch'}
          </Text>
        ) : null}
      </View>

      <View style={styles.timerContainer}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${
                  recordingDurationSec > 0
                    ? Math.min(
                        100,
                        (recordingTime / recordingDurationSec) * 100,
                      )
                    : 0
                }%`,
              },
            ]}
          />
        </View>
        <Text style={styles.timerText}>
          Recording Time: {' '}
          {recordingTime.toFixed(1)}
        </Text>
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
          <Text style={styles.hint}>
            {result.repetitionsCompleted} of {config!.repetitions}{' '}
            repetitions completed
          </Text>
        }
        onBack={handleBack}
        onRetry={resetExercise}
        onExit={handleBack}
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Accuracy Breakdown</Text>

          {accuracyItems.map(([label, value]) => (
            <View key={label} style={styles.metricBlock}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{label}</Text>

                <Text style={styles.detailValue}>
                  {Math.round(value)}%
                </Text>
              </View>

              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
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

          <Text style={styles.hint}>
            Sequence target: {config!.accuracyThreshold}%
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Performance Metrics</Text>

          {metrics.map(([label, value]) => (
            <View key={label} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{label}</Text>
              <Text style={styles.detailValue}>{value}</Text>
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
        setRecordingTime(0);
        setExercisePhase('listening');
      }}
      onQuit={() => {
        setShowNoAudioModal(false);
        void quitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  if (tierLoading || isLoadingAdaptiveParams || !config) {
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
    <View style={styles.root}>
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
          style={styles.screen}
          contentContainerStyle={styles.scrollContent}
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  scrollContent: {
    flexGrow: 1,
  },
  card: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  recordingCard: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
    marginTop: 8,
  },
  cardTitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 6,
    textAlign: 'center',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  detailLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    flex: 1,
  },
  detailValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: COLORS.brown,
    textAlign: 'right',
    marginLeft: 12,
  },
  hint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  pitchStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
  pitchStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  pitchStatusText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  livePitch: {
    fontFamily: 'FredokaBold',
    fontSize: 38,
    textAlign: 'center',
    marginTop: 6,
  },
  pitchDeviation: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: COLORS.brown,
    textAlign: 'center',
    marginTop: 5,
  },
  pitchLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
  },
  timerContainer: {
    width: '100%',
    paddingHorizontal: 4,
  },
  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.background,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.pink,
    borderRadius: 4,
  },
  metricBlock: {
    marginBottom: 12,
  },
});