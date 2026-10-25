import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AudioContext,
  AudioManager,
  AudioRecorder,
} from 'react-native-audio-api';

import { type Tier } from '@/constants/agility';
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
import { detectPitchAutocorrelation } from '@/utils/dsp/agility';
import { frequencyToNoteName } from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';
const GREEN = '#39734A';
const RED = '#A04444';
const YELLOW = '#F9A825';
const GRAY = '#9E9E9E';

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const COUNTDOWN_SECONDS = 3;

type Phase =
  | 'instructions'
  | 'reference'
  | 'loading'
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

type PitchStatus = 'inTune' | 'close' | 'notInTune' | 'listening';

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

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

function isValidTier(value: unknown): value is Tier {
  return (
    value === 'beginner' ||
    value === 'intermediate' ||
    value === 'advanced'
  );
}

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

  const cycle =
    noteDurationSec +
    Math.max(0, Number.isFinite(gapSec) ? gapSec : 0);

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
    return {
      cents,
      status: 'inTune',
    };
  }

  if (absoluteCents <= 50) {
    return {
      cents,
      status: 'close',
    };
  }

  return {
    cents,
    status: 'notInTune',
  };
}

export default function VocalRunAccuracyTaskScreen() {
  const [tier, setTier] = useState<Tier>('beginner');
  const [tierLoading, setTierLoading] = useState(true);
  const [adaptiveConfig, setAdaptiveConfig] =
    useState<Config | null>(null);
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [recordingTime, setRecordingTime] = useState(0);
  const [currentRepetition, setCurrentRepetition] = useState(1);
  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [livePitch, setLivePitch] = useState<LivePitch | null>(null);
  const [isPlayingReference, setIsPlayingReference] = useState(false);
  const [activeReferenceNoteIndex, setActiveReferenceNoteIndex] =
    useState<number | null>(null);

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const mountedRef = useRef(true);
  const recentScoresRef = useRef<number[]>([]);
  const vocalRangeRef = useRef<VocalRange | null>(null);

  const phaseRef = useRef<Phase>('instructions');

  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);

  const samplesRef = useRef<number[]>([]);
  const measurementsRef = useRef<
    ReturnType<typeof measureVocalRunAccuracy>[]
  >([]);

  const recordingStartRef = useRef<number | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const processingRef = useRef(false);

  const exerciseRunIdRef = useRef(0);
  const countdownRunIdRef = useRef(0);
  const referencePlaybackIdRef = useRef(0);
  const referencePlayingRef = useRef(false);

  // Quit-modal coordination refs.
  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');

  const setExercisePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    clearRecordingTimer();

    const recorder = recorderRef.current;
    recorderRef.current = null;

    if (recorder) {
      try {
        recorder.clearOnAudioReady();
      } catch {
        // The recorder may already have stopped.
      }

      try {
        void Promise.resolve(recorder.stop()).catch(error => {
          console.warn('Failed to stop audio recorder:', error);
        });
      } catch (error) {
        console.warn('Failed to stop audio recorder:', error);
      }
    }

    recordingStartRef.current = null;

    try {
      void AudioManager.setAudioSessionActivity(false);
    } catch (error) {
      console.warn('Failed to deactivate audio session:', error);
    }
  }, [clearRecordingTimer]);

  const cancelReferencePlayback = useCallback(() => {
    referencePlaybackIdRef.current += 1;
    referencePlayingRef.current = false;

    const context = audioContextRef.current;

    if (context) {
      try {
        void context.suspend().catch(error => {
          console.warn(
            'Failed to suspend reference audio:',
            error,
          );
        });
      } catch (error) {
        console.warn('Failed to suspend reference audio:', error);
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

      referencePlayingRef.current = false;
      pausedRef.current = true;
      showQuitModalRef.current = false;

      stopRecording();

      const context = audioContextRef.current;
      audioContextRef.current = null;

      if (context) {
        try {
          void context.close();
        } catch {
          // The context may already be closed.
        }
      }
    };
  }, [stopRecording]);

  // Load the user's current agility tier.
  useEffect(() => {
    let cancelled = false;

    const loadTier = async () => {
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
          setTier(
            isValidTier(progress?.currentTier)
              ? progress.currentTier
              : 'beginner',
          );
        }
      } catch (error) {
        console.warn(
          'Failed to load agility component tier:',
          error,
        );

        if (!cancelled) {
          setTier('beginner');
        }
      } finally {
        if (!cancelled) {
          setTierLoading(false);
        }
      }
    };

    void loadTier();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load adaptive exercise parameters and the assessed vocal range.
  useEffect(() => {
    if (tierLoading) {
      return;
    }

    let cancelled = false;

    const loadAdaptiveParameters = async () => {
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
            'Failed to load Vocal Run Accuracy score history:',
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
            vocalRange = {
              lowHz,
              highHz,
            };
          }
        } catch (error) {
          console.warn(
            'Failed to load assessment vocal range:',
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
        setAdaptiveConfig(generated);
        setIsLoadingAdaptiveParams(false);
      }
    };

    void loadAdaptiveParameters().catch(error => {
      console.warn(
        'Failed to generate Vocal Run Accuracy parameters:',
        error,
      );

      if (!cancelled) {
        const fallback = generateVocalRunAccuracyParams({
          tier,
          recentScores: recentScoresRef.current,
          vocalRange: vocalRangeRef.current,
        });

        setAdaptiveConfig(fallback);
        setIsLoadingAdaptiveParams(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [tier, tierLoading]);

  const config = adaptiveConfig;

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
    livePitch !== null && targetFrequency !== null
      ? getPitchAccuracy(livePitch.frequency, targetFrequency)
      : null;

  const pitchStatus: PitchStatus =
    pitchAccuracy?.status ?? 'listening';

  const pitchStatusColor =
    pitchStatus === 'inTune'
      ? GREEN
      : pitchStatus === 'close'
        ? YELLOW
        : pitchStatus === 'notInTune'
          ? RED
          : GRAY;

  const pitchStatusLabel =
    pitchStatus === 'inTune'
      ? 'IN TUNE'
      : pitchStatus === 'close'
        ? 'CLOSE'
        : pitchStatus === 'notInTune'
          ? 'NOT IN TUNE'
          : 'LISTENING...';

  const requestMicrophonePermission = useCallback(
    async (): Promise<boolean> => {
      try {
        const permission =
          await AudioManager.requestRecordingPermissions();

        if (permission !== 'Granted') {
          if (mountedRef.current) {
            setErrorMessage(
              'Microphone permission is required to perform this exercise.',
            );
          }

          return false;
        }

        return true;
      } catch (error) {
        console.warn(
          'Microphone permission request failed:',
          error,
        );

        if (mountedRef.current) {
          setErrorMessage(
            'We could not access the microphone. Please check your microphone permissions.',
          );
        }

        return false;
      }
    },
    [],
  );

  const playReference = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phaseRef.current !== 'reference' ||
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
        new AudioContext({ sampleRate: SAMPLE_RATE });

      audioContextRef.current = context;

      await context.resume();

      for (const [index, frequency] of config.frequencies.entries()) {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          playbackId !== referencePlaybackIdRef.current ||
          phaseRef.current !== 'reference'
        ) {
          return;
        }

        setActiveReferenceNoteIndex(index);

        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.frequency.value = frequency;
        gain.gain.value = 0.12;

        oscillator.connect(gain);
        gain.connect(context.destination);

        const startTime = context.currentTime;

        oscillator.start(startTime);
        oscillator.stop(startTime + config.noteDurationSec);

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
      console.warn('Reference playback failed:', error);

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

    const runId = ++exerciseRunIdRef.current;

    countdownRunIdRef.current += 1;
    cancelReferencePlayback();

    measurementsRef.current = [];
    samplesRef.current = [];
    processingRef.current = false;

    setCurrentRepetition(1);
    setCountdown(COUNTDOWN_SECONDS);
    setRecordingTime(0);
    setLivePitch(null);
    setResult(null);

    const permission = await requestMicrophonePermission();

    if (
      !permission ||
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      runId !== exerciseRunIdRef.current
    ) {
      return;
    }

    setExercisePhase('reference');
  }, [
    cancelReferencePlayback,
    hasValidGeneratedSequence,
    isLoadingAdaptiveParams,
    requestMicrophonePermission,
    setExercisePhase,
    tierLoading,
  ]);

  const processRecording = useCallback(async () => {
    if (
      processingRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      !config ||
      (phaseRef.current !== 'recording' &&
        phaseRef.current !== 'processing')
    ) {
      return;
    }

    processingRef.current = true;

    const runId = exerciseRunIdRef.current;

    try {
      stopRecording();

      setLivePitch(null);
      setExercisePhase('processing');

      await sleep(200);

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        runId !== exerciseRunIdRef.current
      ) {
        return;
      }

      const samples = new Float32Array(samplesRef.current);

      if (!samples.length) {
        throw new Error('No audio samples were captured.');
      }

      const measurement = measureVocalRunAccuracy(
        samples,
        SAMPLE_RATE,
        config.frequencies,
      );

      console.log('Vocal Run Accuracy measurement:', {
        targetNotes: measurement.targetNotes,
        detectedNotes: measurement.detectedNotes,
        pitchAccuracy: measurement.pitchAccuracy,
        sequenceAccuracy: measurement.sequenceAccuracy,
        noteCount: measurement.noteCount,
        correctNoteCount: measurement.correctNoteCount,
        transitionCount: measurement.transitionCount,
        correctTransitionCount: measurement.correctTransitionCount,
      });

      measurementsRef.current.push(measurement);

      const completedRepetitions = measurementsRef.current.length;

      if (completedRepetitions < config.repetitions) {
        if (
          !mountedRef.current ||
          runId !== exerciseRunIdRef.current
        ) {
          return;
        }

        samplesRef.current = [];

        setCurrentRepetition(completedRepetitions + 1);
        setCountdown(COUNTDOWN_SECONDS);
        setRecordingTime(0);
        setLivePitch(null);
        setExercisePhase('reference');

        return;
      }

      const measurements = measurementsRef.current;

      const average = (values: number[]) =>
        values.length
          ? values.reduce((sum, value) => sum + value, 0) /
            values.length
          : 0;

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

      const transitionScore =
        totalTransitionCount > 0
          ? (totalCorrectTransitionCount / totalTransitionCount) * 100
          : sequenceScore;

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

      setLivePitch(null);
      setExercisePhase('results');
    } catch (error) {
      console.warn(
        'Vocal Run Accuracy processing failed:',
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
  }, [config, setExercisePhase, stopRecording, tier]);

  const startRecording = useCallback(async () => {
    if (
      recorderRef.current ||
      phaseRef.current !== 'countdown' ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      !config
    ) {
      return;
    }

    const runId = exerciseRunIdRef.current;
    const maxSamples = Math.ceil(
      recordingDurationSec * SAMPLE_RATE,
    );

    try {
      samplesRef.current = [];
      setRecordingTime(0);
      setLivePitch(null);

      const recorder = new AudioRecorder();
      recorderRef.current = recorder;

      const callbackResult = recorder.onAudioReady(
        {
          sampleRate: SAMPLE_RATE,
          bufferLength: BUFFER_SIZE,
          channelCount: 1,
        },
        ({ buffer, numFrames }) => {
          if (
            !mountedRef.current ||
            pausedRef.current ||
            showQuitModalRef.current ||
            quitInProgressRef.current ||
            runId !== exerciseRunIdRef.current ||
            phaseRef.current !== 'recording'
          ) {
            return;
          }

          try {
            const channelData = buffer.getChannelData(0);

            const frameCount = Math.min(
              numFrames,
              channelData.length,
            );

            const remaining =
              maxSamples - samplesRef.current.length;

            const copyCount = Math.min(
              frameCount,
              Math.max(remaining, 0),
            );

            for (let i = 0; i < copyCount; i++) {
              if (Number.isFinite(channelData[i])) {
                samplesRef.current.push(channelData[i]);
              }
            }

            const liveFrame = new Float32Array(
              channelData.slice(0, frameCount),
            );

            const detected = detectPitchAutocorrelation(
              liveFrame,
              SAMPLE_RATE,
              {
                minFrequency: 70,
                maxFrequency: 1000,
                minRms: 0.008,
                minCorrelation: 0.70,
              },
            );

            if (
              mountedRef.current &&
              !pausedRef.current &&
              typeof detected === 'number' &&
              Number.isFinite(detected) &&
              detected >= 70 &&
              detected <= 1000
            ) {
              setLivePitch({
                note: frequencyToNoteName(detected),
                frequency: detected,
              });
            } else if (mountedRef.current) {
              setLivePitch(null);
            }
          } catch (error) {
            console.warn(
              'Could not process live audio frame:',
              error,
            );
          }
        },
      );

      if (callbackResult.status === 'error') {
        throw new Error(callbackResult.message);
      }

      await AudioManager.setAudioSessionActivity(true);

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        runId !== exerciseRunIdRef.current
      ) {
        stopRecording();
        return;
      }

      const startResult = await recorder.start();

      if (startResult.status === 'error') {
        throw new Error(startResult.message);
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        runId !== exerciseRunIdRef.current
      ) {
        stopRecording();
        return;
      }

      recordingStartRef.current = Date.now();

      setRecordingTime(0);
      setExercisePhase('recording');

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

        setRecordingTime(
          Math.min(elapsed, recordingDurationSec),
        );

        if (elapsed >= recordingDurationSec) {
          setRecordingTime(recordingDurationSec);
          void processRecording();
        }
      }, 100);
    } catch (error) {
      console.warn('Recording failed:', error);

      stopRecording();

      if (
        mountedRef.current &&
        runId === exerciseRunIdRef.current &&
        !quitInProgressRef.current
      ) {
        setLivePitch(null);
        setErrorMessage(
          'We could not start the recording. Please try again.',
        );
        setExercisePhase('instructions');
      }
    }
  }, [
    config,
    processRecording,
    recordingDurationSec,
    setExercisePhase,
    stopRecording,
  ]);

  const startCountdown = useCallback(async () => {
    if (
      phaseRef.current !== 'reference' ||
      referencePlayingRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const runId = ++countdownRunIdRef.current;

    setErrorMessage('');
    setExercisePhase('countdown');

    for (
      let value = COUNTDOWN_SECONDS;
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
    await sleep(1000);

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
    stopRecording();

    processingRef.current = false;
    samplesRef.current = [];
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
    setIsQuitting(false);

    setAdaptiveConfig(nextConfig);
    setResult(null);
    setCurrentRepetition(1);
    setRecordingTime(0);
    setCountdown(COUNTDOWN_SECONDS);
    setLivePitch(null);
    setErrorMessage('');

    setExercisePhase('instructions');
  }, [
    cancelReferencePlayback,
    config,
    result,
    setExercisePhase,
    stopRecording,
    tier,
  ]);

  // Pause the current exercise and display the exit modal.
  const pauseForExitPrompt = useCallback(() => {
    if (
      !mountedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    const currentPhase = phaseRef.current;

    pausedPhaseRef.current = currentPhase;
    pausedRef.current = true;
    showQuitModalRef.current = true;

    // Invalidate any countdown currently in progress.
    countdownRunIdRef.current += 1;

    // Stop the reference sequence if it is playing.
    cancelReferencePlayback();

    if (currentPhase === 'recording') {
      // The current repetition is incomplete, so discard its audio.
      samplesRef.current = [];

      setRecordingTime(0);
      setLivePitch(null);

      stopRecording();
    } else if (currentPhase === 'countdown') {
      setCountdown(COUNTDOWN_SECONDS);
    }

    setShowQuitModal(true);
  }, [cancelReferencePlayback, stopRecording]);

  // Close the modal and resume the exercise appropriately.
  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) {
      return;
    }

    const pausedPhase = pausedPhaseRef.current;

    pausedRef.current = false;
    showQuitModalRef.current = false;

    setShowQuitModal(false);
    setErrorMessage('');

    if (
      pausedPhase === 'countdown' ||
      pausedPhase === 'recording'
    ) {
      // Replay the reference sequence before restarting this repetition.
      samplesRef.current = [];

      setRecordingTime(0);
      setLivePitch(null);
      setCountdown(COUNTDOWN_SECONDS);

      setExercisePhase('reference');
      return;
    }

    if (pausedPhase === 'reference') {
      // Return to the reference screen; the user can replay the sequence.
      setExercisePhase('reference');
      return;
    }

    if (pausedPhase === 'processing') {
      // Processing may have completed while the modal was open.
      if (phaseRef.current === 'results') {
        return;
      }

      // If processing was interrupted before analysis completed,
      // resume it using the captured samples.
      if (
        phaseRef.current === 'processing' &&
        !processingRef.current
      ) {
        void processRecording();
      }

      return;
    }

    // Instructions and results need no additional phase changes.
  }, [processRecording, setExercisePhase]);

  // Stop the exercise and leave the screen.
  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) {
      return;
    }

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;

    // Invalidate any asynchronous recording/countdown work.
    exerciseRunIdRef.current += 1;
    countdownRunIdRef.current += 1;
    referencePlaybackIdRef.current += 1;

    referencePlayingRef.current = false;
    processingRef.current = false;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearRecordingTimer();

    samplesRef.current = [];

    cancelReferencePlayback();
    stopRecording();

    const context = audioContextRef.current;
    audioContextRef.current = null;

    if (context) {
      try {
        await context.close();
      } catch (error) {
        console.warn(
          'Failed to close reference audio context:',
          error,
        );
      }
    }

    try {
      router.replace('/exercises/agility');
    } catch (error) {
      console.error(
        'Failed to navigate away from Vocal Run Accuracy:',
        error,
      );

      if (mountedRef.current) {
        setIsQuitting(false);
        quitInProgressRef.current = false;
      }
    }
  }, [
    cancelReferencePlayback,
    clearRecordingTimer,
    stopRecording,
  ]);

  const handleBack = useCallback(() => {
    pauseForExitPrompt();
  }, [pauseForExitPrompt]);

  // Android hardware back button.
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

  // The modal message depends on the phase where the user requested exit.
  const quitModalMessage =
    pausedPhaseRef.current === 'instructions' ||
    pausedPhaseRef.current === 'results'
      ? 'Are you sure you want to leave Vocal Run Accuracy?'
      : pausedPhaseRef.current === 'recording'
        ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
        : pausedPhaseRef.current === 'countdown'
          ? 'Your exercise is paused. Your completed repetitions will be kept. The current repetition will restart when you continue.'
          : pausedPhaseRef.current === 'reference'
            ? 'Your exercise is paused. Your completed repetitions will be kept. Continue to return to the reference sequence.'
            : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.';

  const quitModal = (
    <Modal
      visible={showQuitModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={continueExercise}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}>
            <Ionicons
              name="exit-outline"
              size={30}
              color={BROWN}
            />
          </View>

          <Text style={styles.modalTitle}>
            Quit exercise?
          </Text>

          <Text style={styles.modalMessage}>
            {quitModalMessage}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            disabled={isQuitting}
            onPress={continueExercise}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.continueButtonText}>
              Continue Exercise
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
            disabled={isQuitting}
            onPress={() => {
              void quitExercise();
            }}
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.quitButtonText}>
              {isQuitting ? 'Stopping...' : 'Quit Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  if (tierLoading || isLoadingAdaptiveParams || !config) {
    return (
      <>
        <View style={styles.preparingScreen}>
          <View style={styles.iconCircle}>
            <Ionicons
              name="options-outline"
              size={38}
              color={BROWN}
            />
          </View>

          <Text style={styles.title}>
            Preparing Your Exercise
          </Text>

          <Text style={styles.subtitle}>
            Loading your difficulty level and assessed vocal range.
          </Text>

          <ActivityIndicator
            size="large"
            color={BROWN}
            style={styles.spinner}
          />
        </View>

        {quitModal}
      </>
    );
  }

  const renderSequence = (
    activeIndex: number | null,
    live = false,
  ) => (
    <View style={styles.sequence}>
      {config.frequencies.map((frequency, index) => {
        const active = activeIndex === index;

        return (
          <View
            key={`${frequency}-${index}`}
            style={[
              styles.notePill,
              active && styles.activeNote,
              live && styles.liveNote,
            ]}
          >
            <Text
              style={[
                styles.noteNumber,
                active && styles.activeText,
              ]}
            >
              {index + 1}
            </Text>

            <Text
              style={[
                styles.noteText,
                active && styles.activeText,
              ]}
            >
              {frequencyToNoteName(frequency)}
            </Text>
          </View>
        );
      })}
    </View>
  );

  const renderInstructions = () => (
    <View style={styles.content}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.backButton}
        onPress={handleBack}
      >
        <Ionicons
          name="arrow-back"
          size={24}
          color={BROWN}
        />
      </Pressable>

      <View style={styles.iconCircle}>
        <Ionicons
          name="flash-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.title}>
        Vocal Run Accuracy
      </Text>

      <Text style={styles.subtitle}>
        VOCAL AGILITY
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Exercise Instructions
        </Text>

        {[
          'Listen carefully to the reference vocal run.',
          'Sing every note in the same order.',
          'Keep your pitch accurate and move smoothly between notes.',
          `Complete all ${config.repetitions} repetitions.`,
        ].map(line => (
          <Text key={line} style={styles.bodyText}>
           {line}
          </Text>
        ))}

        <Text style={styles.cardTitle}>
          Exercise Details
        </Text>

        {[
          ['Difficulty', config.label],
          ['Speed', config.speedLabel],
          ['Notes', String(config.frequencies.length)],
          ['Repetitions', String(config.repetitions)],
          ['Accuracy Target', `${config.accuracyThreshold}%`],
          [
            'Note Duration',
            `${config.noteDurationSec.toFixed(2)} sec`,
          ],
        ].map(([label, value]) => (
          <View key={label} style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue}>{value}</Text>
          </View>
        ))}
      </View>

      {errorMessage ? (
        <Text style={styles.errorText}>{errorMessage}</Text>
      ) : null}

      <Pressable
        style={[
          styles.button,
          !hasValidGeneratedSequence && styles.disabled,
        ]}
        disabled={!hasValidGeneratedSequence}
        onPress={() => {
          void beginExercise();
        }}
      >
        <Ionicons
          name="play"
          size={18}
          color={WHITE}
        />

        <Text style={styles.buttonText}>
          Start Exercise
        </Text>
      </Pressable>
    </View>
  );

  const renderReference = () => (
    <View style={styles.content}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.backButton}
        onPress={handleBack}
      >
        <Ionicons
          name="arrow-back"
          size={24}
          color={BROWN}
        />
      </Pressable>

      <View style={styles.iconCircle}>
        <Ionicons
          name="musical-notes-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.title}>
        Repetition {currentRepetition}
      </Text>

      <Text style={styles.subtitle}>
        OF {config.repetitions} REPETITIONS
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Listen to the Sequence
        </Text>

        {renderSequence(activeReferenceNoteIndex)}

        <Text style={styles.hint}>
          Listen to the full sequence before singing.
        </Text>
      </View>

      <Pressable
        style={[
          styles.button,
          isPlayingReference && styles.disabled,
        ]}
        disabled={isPlayingReference}
        onPress={() => {
          void playReference();
        }}
      >
        {isPlayingReference ? (
          <ActivityIndicator color={WHITE} />
        ) : (
          <Ionicons
            name="play"
            size={18}
            color={WHITE}
          />
        )}

        <Text style={styles.buttonText}>
          {isPlayingReference
            ? 'Playing Reference...'
            : 'Play Reference'}
        </Text>
      </Pressable>

      <Pressable
        style={[
          styles.secondaryButton,
          isPlayingReference && styles.disabled,
        ]}
        disabled={isPlayingReference}
        onPress={() => {
          void startCountdown();
        }}
      >
        <Text style={styles.secondaryButtonText}>
          Continue
        </Text>
      </Pressable>

      {errorMessage ? (
        <Text style={styles.errorText}>
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.backButton}
        onPress={handleBack}
      >
        <Ionicons
          name="arrow-back"
          size={24}
          color={BROWN}
        />
      </Pressable>

      <View style={styles.iconCircle}>
        <Ionicons
          name="flash-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.title}>
        Get Ready
      </Text>

      <Text style={styles.subtitle}>
        REPETITION {currentRepetition} OF {config.repetitions}
      </Text>

      <Text style={styles.countdown}>
        {countdown === 0 ? 'READY' : countdown}
      </Text>

      <Text style={styles.hint}>
        Prepare to sing the vocal run.
      </Text>
    </View>
  );

  const renderRecording = () => (
    <View style={styles.content}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.backButton}
        onPress={handleBack}
      >
        <Ionicons
          name="arrow-back"
          size={24}
          color={BROWN}
        />
      </Pressable>

      <View style={styles.iconCircle}>
        <Ionicons
          name="mic"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.title}>
        Sing the Vocal Run
      </Text>

      <Text style={styles.subtitle}>
        REPETITION {currentRepetition} OF {config.repetitions}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Target Sequence
        </Text>

        {renderSequence(activeTargetNoteIndex, true)}

        <View style={styles.divider} />

        <Text style={styles.cardTitle}>
          Live Pitch Accuracy
        </Text>

        <View
          style={[
            styles.pitchStatusBadge,
            {
              backgroundColor: `${pitchStatusColor}18`,
              borderColor: pitchStatusColor,
            },
          ]}
        >
          <View
            style={[
              styles.pitchStatusDot,
              { backgroundColor: pitchStatusColor },
            ]}
          />

          <Text
            style={[
              styles.pitchStatusText,
              { color: pitchStatusColor },
            ]}
          >
            {pitchStatusLabel}
          </Text>
        </View>

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
            : 'Listening for a clear vocal pitch'}
        </Text>

        {pitchAccuracy && targetFrequency !== null ? (
          <Text style={styles.pitchDeviation}>
            {Math.abs(pitchAccuracy.cents).toFixed(0)} cents{' '}
            {pitchAccuracy.cents > 0
              ? 'sharp'
              : pitchAccuracy.cents < 0
                ? 'flat'
                : 'on pitch'}
          </Text>
        ) : null}

        <View style={styles.pitchLegend}>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: GREEN },
              ]}
            />
            <Text style={styles.legendText}>
              In tune
            </Text>
          </View>

          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: YELLOW },
              ]}
            />
            <Text style={styles.legendText}>
              Close
            </Text>
          </View>

          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: RED },
              ]}
            />
            <Text style={styles.legendText}>
              Not in tune
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.hint}>
        Recording: {Math.min(recordingTime, recordingDurationSec).toFixed(1)}{' '}
        / {recordingDurationSec.toFixed(1)} sec
      </Text>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.min(
                100,
                (recordingTime / recordingDurationSec) * 100,
              )}%`,
            },
          ]}
        />
      </View>
    </View>
  );

  const renderProcessing = () => (
    <View style={styles.centerScreen}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.backButton}
        onPress={handleBack}
      >
        <Ionicons
          name="arrow-back"
          size={24}
          color={BROWN}
        />
      </Pressable>

      <ActivityIndicator
        size="large"
        color={BROWN}
      />

      <Text style={styles.title}>
        Analyzing Your Singing
      </Text>

      <Text style={styles.hint}>
        Measuring pitch, sequence, and transition accuracy.
      </Text>
    </View>
  );

  const renderResults = () => {
    if (!result) {
      return null;
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
      <View style={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to exercises"
          style={styles.backButton}
          onPress={handleBack}
        >
          <Ionicons
            name="arrow-back"
            size={24}
            color={BROWN}
          />
        </Pressable>

        <View style={styles.iconCircle}>
          <Ionicons
            name={
              result.passed
                ? 'checkmark-circle-outline'
                : 'refresh-outline'
            }
            size={38}
            color={BROWN}
          />
        </View>

        <Text style={styles.title}>
          {result.passed ? 'Great Job!' : 'Keep Practicing!'}
        </Text>

        <Text style={styles.subtitle}>
          VOCAL RUN ACCURACY RESULT
        </Text>

        <View style={styles.scoreCard}>
          <Text style={styles.cardTitle}>
            OVERALL SCORE
          </Text>

          <Text style={styles.score}>
            {Math.round(result.overall)}
            <Text style={styles.scoreOutOf}> / 100</Text>
          </Text>

          <Text
            style={[
              styles.status,
              { color: result.passed ? GREEN : RED },
            ]}
          >
            {result.passed ? 'PASSED' : 'KEEP PRACTICING'}
          </Text>

          <Text style={styles.hint}>
            {result.repetitionsCompleted} of {config.repetitions}{' '}
            repetitions completed
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Accuracy Breakdown
          </Text>

          {accuracyItems.map(([label, value]) => (
            <View key={label} style={styles.metricBlock}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>
                  {label}
                </Text>

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
            Sequence target: {config.accuracyThreshold}%
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Performance Metrics
          </Text>

          {metrics.map(([label, value]) => (
            <View key={label} style={styles.detailRow}>
              <Text style={styles.detailLabel}>
                {label}
              </Text>

              <Text style={styles.detailValue}>
                {value}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.bodyText}>
            {result.feedback}
          </Text>
        </View>

        <Pressable
          style={styles.button}
          onPress={resetExercise}
        >
          <Ionicons
            name="refresh"
            size={18}
            color={WHITE}
          />

          <Text style={styles.buttonText}>
            Try Again
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={handleBack}
        >
          <Text style={styles.secondaryButtonText}>
            Back to Exercises
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {phase === 'instructions' && renderInstructions()}

        {phase === 'loading' && (
          <View style={styles.centerScreen}>
            <ActivityIndicator color={BROWN} />
            <Text style={styles.title}>
              Getting You Ready
            </Text>
          </View>
        )}

        {phase === 'reference' && renderReference()}
        {phase === 'countdown' && renderCountdown()}
        {phase === 'recording' && renderRecording()}
        {phase === 'processing' && renderProcessing()}
        {phase === 'results' && renderResults()}
      </ScrollView>

      {quitModal}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WHITE,
  },
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },
  scrollContent: {
    flexGrow: 1,
  },
  preparingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  spinner: {
    marginTop: 24,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 120,
    paddingBottom: 48,
  },
  centerScreen: {
    flexGrow: 1,
    minHeight: 520,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  backButton: {
    position: 'absolute',
    top: 44,
    left: 24,
    zIndex: 1,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: LIGHT_PINK,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PINK,
    marginBottom: 16,
  },
  title: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 5,
    marginBottom: 20,
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  card: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: LIGHT_PINK,
    borderColor: BORDER,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    marginBottom: 12,
    marginTop: 10,
  },
  bodyText: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 19,
    color: BROWN,
    marginBottom: 6,
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
    color: MUTED,
    flex: 1,
  },
  detailValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'right',
    marginLeft: 12,
  },
  sequence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 10,
  },
  notePill: {
    minWidth: 52,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: PINK,
    alignItems: 'center',
  },
  noteNumber: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  noteText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginTop: 2,
  },
  activeNote: {
    backgroundColor: '#E85D83',
    borderWidth: 1,
    borderColor: '#C93E68',
  },
  activeText: {
    color: WHITE,
  },
  liveNote: {
    minWidth: 48,
  },
  hint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 10,
  },
  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: RED,
    textAlign: 'center',
    marginVertical: 10,
  },
  button: {
    width: '100%',
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  buttonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: WHITE,
  },
  secondaryButton: {
    width: '100%',
    minHeight: 50,
    borderRadius: 25,
    backgroundColor: LIGHT_GRAY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  secondaryButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
  },
  disabled: {
    opacity: 0.5,
  },
  countdown: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginVertical: 16,
  },
  livePitch: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    textAlign: 'center',
    marginTop: 8,
  },
  pitchStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    fontSize: 12,
    letterSpacing: 0.5,
  },
  pitchDeviation: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'center',
    marginTop: 6,
  },
  pitchLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 16,
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
    color: MUTED,
  },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 14,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#E85D83',
    borderRadius: 4,
  },
  scoreCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: PINK,
    padding: 22,
    borderRadius: 22,
    marginBottom: 14,
  },
  score: {
    fontFamily: 'FredokaBold',
    fontSize: 54,
    color: BROWN,
  },
  scoreOutOf: {
    fontSize: 18,
  },
  status: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    marginTop: 4,
  },
  metricBlock: {
    marginBottom: 12,
  },

  // Quit modal styles matching Sustained Exhale.
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: WHITE,
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
    marginBottom: 15,
  },
  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
    textAlign: 'center',
  },
  modalMessage: {
    marginTop: 10,
    marginBottom: 23,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: MUTED,
    textAlign: 'center',
  },
  continueButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: PINK,
  },
  continueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
  quitButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
  },
  quitButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: MUTED,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});