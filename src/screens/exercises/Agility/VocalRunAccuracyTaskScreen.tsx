
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  RAPID_VOCAL_RUN_PARAMS,
  type Tier,
} from '@/constants/exercises/agility';

import {
  AudioContext,
  AudioManager,
  AudioRecorder,
} from 'react-native-audio-api';

import { auth } from '@/services/firebase/config';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  generateVocalRunAccuracyParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  measureVocalRunAccuracy,
} from '@/services/measurement/agility/vocalRunAccuracyTask';

import {
  scoreVocalRunAccuracy,
} from '@/services/scoring/agility/vocalRunAccuracyTask';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  detectPitchAutocorrelation,
} from '@/utils/dsp/agility';

import {
  frequencyToNoteName,
} from '@/utils/music/notes';

// ============================================================
// COLORS
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const GREEN = '#39734A';
const RED = '#A04444';

// ============================================================
// CONFIG
// ============================================================

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const COUNTDOWN_SECONDS = 3;
const MAX_RECORDING_SECONDS = 10;
const MAX_RECORDING_SAMPLES =
  SAMPLE_RATE * MAX_RECORDING_SECONDS;

// ============================================================
// TYPES
// ============================================================

type Phase =
  | 'instructions'
  | 'reference'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

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

// ============================================================
// HELPERS
// ============================================================

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function isValidTier(value: unknown): value is Tier {
  return (
    value === 'beginner' ||
    value === 'intermediate' ||
    value === 'advanced'
  );
}

function getRecentVocalRunScores(
  records: Awaited<
    ReturnType<typeof fetchExerciseRecords>
  >,
  tier: Tier,
): number[] {
  return records
    .filter(
      (exercise) =>
        exercise.templateId === 'vocalRunAccuracy' &&
        exercise.tier === tier,
    )
    .slice(-5)
    .map((exercise) => exercise.scorePct)
    .filter(
      (score) =>
        Number.isFinite(score) &&
        score >= 0 &&
        score <= 100,
    );
}

// ============================================================
// COMPONENT
// ============================================================

export default function VocalRunAccuracyTaskScreen() {
  // ==========================================================
  // TIER
  // ==========================================================

  const [tier, setTier] = useState<Tier>('beginner');

  const [tierLoading, setTierLoading] = useState(true);

  // ==========================================================
  // ADAPTIVE CONFIGURATION
  // ==========================================================

  const [adaptiveConfig, setAdaptiveConfig] = useState(
    () => RAPID_VOCAL_RUN_PARAMS.beginner,
  );

  const [
    isLoadingAdaptiveParams,
    setIsLoadingAdaptiveParams,
  ] = useState(true);

  // ==========================================================
  // PHASE AND RESULTS
  // ==========================================================

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);

  const [recordingTime, setRecordingTime] =
    useState(0);

  const [currentRepetition, setCurrentRepetition] =
    useState(1);

  const [result, setResult] =
    useState<ExerciseResult | null>(null);

  const [errorMessage, setErrorMessage] =
    useState('');

  const [livePitch, setLivePitch] =
    useState<LivePitch | null>(null);

  const [isPlayingReference, setIsPlayingReference] =
    useState(false);

  // ==========================================================
  // REFS
  // ==========================================================

  const mountedRef = useRef(true);

  const phaseRef = useRef<Phase>('instructions');

  const audioContextRef =
    useRef<AudioContext | null>(null);

  const recorderRef =
    useRef<AudioRecorder | null>(null);

  const samplesRef = useRef<number[]>([]);

  const measurementsRef = useRef<
    ReturnType<typeof measureVocalRunAccuracy>[]
  >([]);

  const recordingStartRef =
    useRef<number | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const processingRef = useRef(false);

  // Invalidate delayed work when leaving or resetting the exercise.
  const exerciseRunIdRef = useRef(0);
  const countdownRunIdRef = useRef(0);
  const referencePlaybackIdRef = useRef(0);
  const referencePlayingRef = useRef(false);

  // ==========================================================
  // SET PHASE
  // ==========================================================

  const setExercisePhase = useCallback(
    (next: Phase) => {
      phaseRef.current = next;
      setPhase(next);
    },
    [],
  );

  // ==========================================================
  // TIMER CLEANUP
  // ==========================================================

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  // ==========================================================
  // STOP RECORDING
  // ==========================================================

  const stopRecording = useCallback(() => {
    clearRecordingTimer();

    const recorder = recorderRef.current;

    recorderRef.current = null;

    if (recorder) {
      try {
        recorder.clearOnAudioReady();
      } catch {
        // Recorder may already be stopped.
      }

      try {
        void recorder.stop();
      } catch {
        // Recorder may already be stopped.
      }
    }

    recordingStartRef.current = null;

    try {
      void AudioManager.setAudioSessionActivity(false);
    } catch {
      // Audio session may already be inactive.
    }
  }, [clearRecordingTimer]);

  // ==========================================================
  // CANCEL REFERENCE PLAYBACK
  // ==========================================================

  const cancelReferencePlayback = useCallback(() => {
    referencePlaybackIdRef.current += 1;
    referencePlayingRef.current = false;

    if (mountedRef.current) {
      setIsPlayingReference(false);
    }
  }, []);

  // ==========================================================
  // UNMOUNT CLEANUP
  // ==========================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      exerciseRunIdRef.current += 1;
      countdownRunIdRef.current += 1;
      referencePlaybackIdRef.current += 1;

      referencePlayingRef.current = false;

      stopRecording();

      const context = audioContextRef.current;
      audioContextRef.current = null;

      if (context) {
        try {
          void context.close();
        } catch {
          // Context may already be closed.
        }
      }
    };
  }, [stopRecording]);

  // ==========================================================
  // LOAD COMPONENT TIER
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    const loadComponentTier = async () => {
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
          const savedTier = progress?.currentTier;

          setTier(
            isValidTier(savedTier)
              ? savedTier
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

    void loadComponentTier();

    return () => {
      cancelled = true;
    };
  }, []);

  // ==========================================================
  // LOAD ADAPTIVE PARAMETERS
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParameters = async () => {
      setIsLoadingAdaptiveParams(true);

      const currentBaseParams =
        RAPID_VOCAL_RUN_PARAMS[tier];

      setAdaptiveConfig(currentBaseParams);

      const user = auth.currentUser;

      if (!user) {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
        }

        return;
      }

      try {
        const records = await fetchExerciseRecords(
          user.uid,
          'agility',
        );

        if (cancelled) {
          return;
        }

        const recentScores = getRecentVocalRunScores(
          records,
          tier,
        );

        const generatedParams =
          generateVocalRunAccuracyParams({
            tier,
            recentScores,
          });

        if (!cancelled) {
          setAdaptiveConfig(generatedParams);
        }
      } catch (error) {
        console.warn(
          'Failed to load Vocal Run Accuracy adaptive parameters:',
          error,
        );

        if (!cancelled) {
          setAdaptiveConfig(currentBaseParams);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
        }
      }
    };

    if (!tierLoading) {
      void loadAdaptiveParameters();
    }

    return () => {
      cancelled = true;
    };
  }, [tier, tierLoading]);

  // ==========================================================
  // ACTIVE CONFIG
  // ==========================================================

  const config = adaptiveConfig;

  // ==========================================================
  // MICROPHONE PERMISSION
  // ==========================================================

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

  // ==========================================================
  // REFERENCE PLAYBACK
  // ==========================================================

  const playReference = useCallback(async () => {
    if (
      !mountedRef.current ||
      phaseRef.current !== 'reference' ||
      referencePlayingRef.current
    ) {
      return;
    }

    const playbackId =
      ++referencePlaybackIdRef.current;

    referencePlayingRef.current = true;
    setIsPlayingReference(true);
    setErrorMessage('');

    try {
      const context =
        audioContextRef.current ??
        new AudioContext({
          sampleRate: SAMPLE_RATE,
        });

      audioContextRef.current = context;

      await context.resume();

      for (const frequency of config.frequencies) {
        if (
          !mountedRef.current ||
          playbackId !== referencePlaybackIdRef.current ||
          phaseRef.current !== 'reference'
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
        oscillator.stop(
          startTime + config.noteDurationSec,
        );

        await sleep(config.noteDurationSec * 1000);
      }
    } catch (error) {
      console.warn(
        'Reference playback failed:',
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
      if (
        playbackId === referencePlaybackIdRef.current
      ) {
        referencePlayingRef.current = false;

        if (mountedRef.current) {
          setIsPlayingReference(false);
        }
      }
    }
  }, [config]);

  const handlePlayReference = useCallback(async () => {
    await playReference();
  }, [playReference]);

  // ==========================================================
  // BEGIN EXERCISE
  // ==========================================================

  const beginExercise = useCallback(async () => {
    if (
      tierLoading ||
      isLoadingAdaptiveParams ||
      phaseRef.current !== 'instructions'
    ) {
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

    const permission =
      await requestMicrophonePermission();

    if (
      !permission ||
      !mountedRef.current ||
      runId !== exerciseRunIdRef.current
    ) {
      return;
    }

    setExercisePhase('reference');
  }, [
    cancelReferencePlayback,
    isLoadingAdaptiveParams,
    requestMicrophonePermission,
    setExercisePhase,
    tierLoading,
  ]);

  // ==========================================================
  // PROCESS RECORDING
  // ==========================================================

  const processRecording = useCallback(async () => {
    if (
      processingRef.current ||
      phaseRef.current !== 'recording'
    ) {
      return;
    }

    processingRef.current = true;

    const runId = exerciseRunIdRef.current;

    stopRecording();
    setExercisePhase('processing');

    try {
      await sleep(200);

      if (
        !mountedRef.current ||
        runId !== exerciseRunIdRef.current
      ) {
        return;
      }

      const samples = new Float32Array(
        samplesRef.current,
      );

      if (samples.length === 0) {
        throw new Error(
          'No audio samples were captured.',
        );
      }

      const measurement = measureVocalRunAccuracy(
        samples,
        SAMPLE_RATE,
        config.frequencies,
      );

      console.log(
        'Vocal Run Accuracy measurement:',
        {
          targetNotes: measurement.targetNotes,
          detectedNotes: measurement.detectedNotes,
          pitchAccuracy: measurement.pitchAccuracy,
          sequenceAccuracy: measurement.sequenceAccuracy,
          noteCount: measurement.noteCount,
          correctNoteCount: measurement.correctNoteCount,
          transitionCount: measurement.transitionCount,
          correctTransitionCount:
            measurement.correctTransitionCount,
        },
      );

      measurementsRef.current.push(measurement);

      const completedRepetitions =
        measurementsRef.current.length;

      // ----------------------------------------------
      // MORE REPETITIONS REMAIN
      // ----------------------------------------------

      if (completedRepetitions < config.repetitions) {
        if (
          !mountedRef.current ||
          runId !== exerciseRunIdRef.current
        ) {
          return;
        }

        samplesRef.current = [];

        setCurrentRepetition(
          completedRepetitions + 1,
        );

        setCountdown(COUNTDOWN_SECONDS);
        setRecordingTime(0);
        setLivePitch(null);

        setExercisePhase('reference');
        return;
      }

      // ----------------------------------------------
      // AGGREGATE MEASUREMENTS
      // ----------------------------------------------

      const measurements = measurementsRef.current;

      const average = (values: number[]) =>
        values.length > 0
          ? values.reduce(
              (sum, value) => sum + value,
              0,
            ) / values.length
          : 0;

      const totalNoteCount = measurements.reduce(
        (sum, item) => sum + item.noteCount,
        0,
      );

      const totalCorrectNoteCount =
        measurements.reduce(
          (sum, item) => sum + item.correctNoteCount,
          0,
        );

      const totalTransitionCount =
        measurements.reduce(
          (sum, item) => sum + item.transitionCount,
          0,
        );

      const totalCorrectTransitionCount =
        measurements.reduce(
          (sum, item) =>
            sum + item.correctTransitionCount,
          0,
        );

      const totalDurationMs = measurements.reduce(
        (sum, item) => sum + item.durationMs,
        0,
      );

      // Keep the existing mean-per-repetition behavior
      // for pitch and sequence accuracy.
      const pitchScore = average(
        measurements.map(
          (item) => item.pitchAccuracy,
        ),
      );

      const sequenceScore = average(
        measurements.map(
          (item) => item.sequenceAccuracy,
        ),
      );

      // Use pooled transition counts rather than averaging
      // per-repetition percentages.
      const transitionScore =
        totalTransitionCount > 0
          ? (totalCorrectTransitionCount /
              totalTransitionCount) *
            100
          : sequenceScore;

      const notesPerSecond =
        totalDurationMs > 0
          ? totalNoteCount / (totalDurationMs / 1000)
          : 0;

      const aggregatedMeasurement = {
        detectedPitches: measurements.flatMap(
          (item) => item.detectedPitches,
        ),

        detectedNotes: measurements.flatMap(
          (item) => item.detectedNotes,
        ),

        targetNotes: measurements.flatMap(
          (item) => item.targetNotes,
        ),

        pitchAccuracy: pitchScore,
        sequenceAccuracy: sequenceScore,
        noteCount: totalNoteCount,
        correctNoteCount: totalCorrectNoteCount,
        transitionCount: totalTransitionCount,
        correctTransitionCount:
          totalCorrectTransitionCount,
        durationMs: totalDurationMs,
        notesPerSecond,
      };

      // ----------------------------------------------
      // SCORE ONCE
      // ----------------------------------------------

      const score = scoreVocalRunAccuracy(
        aggregatedMeasurement,
        config.accuracyThreshold,
      );

      if (
        !mountedRef.current ||
        runId !== exerciseRunIdRef.current
      ) {
        return;
      }

      const feedback =
        score.passed
          ? score.feedback
          : sequenceScore < config.accuracyThreshold
            ? `Sequence accuracy must reach at least ${config.accuracyThreshold}% for the ${config.label.toLowerCase()} level.`
            : score.feedback;

      // ----------------------------------------------
      // SAVE PROGRESS
      // ----------------------------------------------

      // saveCompletedExercise handles its own errors.
      // This screen cannot assume that a resolved call
      // means the backend write definitely succeeded.
      await saveCompletedExercise(
        'agility',
        'vocalRunAccuracy',
        tier,
        score.overall,
      );

      if (
        !mountedRef.current ||
        runId !== exerciseRunIdRef.current
      ) {
        return;
      }

      console.log(
        'Vocal Run Accuracy progress save attempted:',
        score.overall,
      );

      // ----------------------------------------------
      // DISPLAY RESULTS
      // ----------------------------------------------

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
        correctTransitionCount:
          totalCorrectTransitionCount,
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
        runId === exerciseRunIdRef.current
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
  }, [
    config,
    setExercisePhase,
    stopRecording,
    tier,
  ]);

  // ==========================================================
  // START RECORDING
  // ==========================================================

  const startRecording = useCallback(async () => {
    if (
      recorderRef.current ||
      phaseRef.current !== 'countdown'
    ) {
      return;
    }

    const runId = exerciseRunIdRef.current;

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

            // Preserve raw PCM for final measurement.
            // Never exceed the configured recording limit.
            const remainingSamples =
              MAX_RECORDING_SAMPLES -
              samplesRef.current.length;

            const samplesToCopy = Math.min(
              frameCount,
              Math.max(remainingSamples, 0),
            );

            for (
              let index = 0;
              index < samplesToCopy;
              index++
            ) {
              const sample = channelData[index];

              if (Number.isFinite(sample)) {
                samplesRef.current.push(sample);
              }
            }

            // Live detection is separate from saved raw samples.
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
        runId !== exerciseRunIdRef.current
      ) {
        stopRecording();
        return;
      }

      recordingStartRef.current = Date.now();

      setRecordingTime(0);
      setExercisePhase('recording');

      recordingTimerRef.current = setInterval(() => {
        const start = recordingStartRef.current;

        if (
          start === null ||
          !mountedRef.current ||
          runId !== exerciseRunIdRef.current
        ) {
          return;
        }

        const elapsed = (Date.now() - start) / 1000;

        setRecordingTime(
          Math.min(elapsed, MAX_RECORDING_SECONDS),
        );

        if (elapsed >= MAX_RECORDING_SECONDS) {
          void processRecording();
        }
      }, 100);
    } catch (error) {
      console.warn('Recording failed:', error);

      stopRecording();

      if (
        mountedRef.current &&
        runId === exerciseRunIdRef.current
      ) {
        setLivePitch(null);

        setErrorMessage(
          'We could not start the recording. Please try again.',
        );

        setExercisePhase('instructions');
      }
    }
  }, [
    processRecording,
    setExercisePhase,
    stopRecording,
  ]);

  // ==========================================================
  // START COUNTDOWN
  // ==========================================================

const startCountdown = useCallback(async () => {
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
      countdownRunIdRef.current !== runId
    ) {
      return;
    }

    setCountdown(value);
    await sleep(1000);
  }

  if (
    !mountedRef.current ||
    countdownRunIdRef.current !== runId
  ) {
    return;
  }

  await startRecording();
}, [setExercisePhase, startRecording]);

  // ==========================================================
  // FINISH RECORDING
  // ==========================================================

  const finishRecording = useCallback(() => {
    if (
      phaseRef.current !== 'recording' ||
      !recorderRef.current ||
      processingRef.current
    ) {
      return;
    }

    void processRecording();
  }, [processRecording]);

  // ==========================================================
  // CANCEL / BACK TO INSTRUCTIONS
  // ==========================================================

  const returnToInstructions = useCallback(() => {
    exerciseRunIdRef.current += 1;
    countdownRunIdRef.current += 1;

    cancelReferencePlayback();
    stopRecording();

    processingRef.current = false;

    samplesRef.current = [];
    measurementsRef.current = [];

    setResult(null);
    setCurrentRepetition(1);
    setRecordingTime(0);
    setCountdown(COUNTDOWN_SECONDS);
    setLivePitch(null);
    setErrorMessage('');

    setExercisePhase('instructions');
  }, [
    cancelReferencePlayback,
    setExercisePhase,
    stopRecording,
  ]);

  // ==========================================================
  // RESET
  // ==========================================================

  const resetExercise = useCallback(() => {
  countdownRunIdRef.current += 1;

  stopRecording();

  processingRef.current = false;

  samplesRef.current = [];
  measurementsRef.current = [];

  setResult(null);
  setCurrentRepetition(1);
  setRecordingTime(0);
  setCountdown(COUNTDOWN_SECONDS);
  setLivePitch(null);
  setErrorMessage('');

  setExercisePhase('instructions');
}, [setExercisePhase, stopRecording]);

  // ==========================================================
  // INSTRUCTIONS
  // ==========================================================

  const renderInstructions = () => (
    <View style={styles.content}>
      <Pressable
        style={styles.backButton}
        onPress={() => router.back()}
        hitSlop={10}
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

      <View style={styles.instructionCard}>
        <View style={styles.prepareCard}>
          <View style={styles.prepareHeader}>
            <Ionicons
              name="information-circle-outline"
              size={21}
              color={BROWN}
            />

            <Text style={styles.prepareTitle}>
              Before You Begin
            </Text>
          </View>

          <View style={styles.prepareItem}>
            <Ionicons
              name="volume-mute-outline"
              size={17}
              color={BROWN}
            />

            <Text style={styles.prepareText}>
              Find a quiet area with minimal background noise.
            </Text>
          </View>

          <View style={styles.prepareItem}>
            <Ionicons
              name="body-outline"
              size={17}
              color={BROWN}
            />

            <Text style={styles.prepareText}>
              Stand or sit upright with your shoulders relaxed.
            </Text>
          </View>

          <View style={styles.prepareItem}>
            <Ionicons
              name="mic-outline"
              size={17}
              color={BROWN}
            />

            <Text style={styles.prepareText}>
              Keep a comfortable distance from the microphone while singing.
            </Text>
          </View>
        </View>

        <Text style={styles.cardTitle}>
          Exercise Details
        </Text>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Difficulty
          </Text>
          <Text style={styles.detailValue}>
            {config.label}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Speed
          </Text>
          <Text style={styles.detailValue}>
            {config.speedLabel}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Notes
          </Text>
          <Text style={styles.detailValue}>
            {config.frequencies.length}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Repetitions
          </Text>
          <Text style={styles.detailValue}>
            {config.repetitions}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Sequence Target
          </Text>
          <Text style={styles.detailValue}>
            {config.accuracyThreshold}%
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Note Duration
          </Text>
          <Text style={styles.detailValue}>
            {config.noteDurationSec.toFixed(2)} sec
          </Text>
        </View>

        <Text style={[styles.cardTitle, { marginTop: 14 }]}>
          Exercise Instructions
        </Text>

        {[
          'Listen carefully to the reference vocal run.',
          'Sing every note in the same order.',
          'Keep your pitch accurate throughout the run.',
          'Move smoothly between each note.',
          `Complete all ${config.repetitions} repetitions of the vocal run.`,
        ].map((instruction, index) => (
          <View
            key={instruction}
            style={styles.prepareItem}
          >
            <Ionicons
              name={
                index === 4
                  ? 'repeat-outline'
                  : 'checkmark-circle-outline'
              }
              size={17}
              color={BROWN}
            />

            <Text style={styles.prepareText}>
              {instruction}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.referenceCard}>
        <Text style={styles.cardTitle}>
          Reference Sequence
        </Text>

        <Text style={styles.referenceLabel}>
          LISTEN AND FOLLOW THE NOTE ORDER
        </Text>

        <View style={styles.noteSequence}>
          {config.frequencies.map((frequency, index) => (
            <View
              key={`${frequency}-${index}`}
              style={styles.notePill}
            >
              <Text style={styles.noteNumber}>
                {index + 1}
              </Text>

              <Text style={styles.noteText}>
                {frequencyToNoteName(frequency)}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.referenceHint}>
          The reference run will play before each repetition.
        </Text>
      </View>

      {errorMessage ? (
        <View style={styles.errorCard}>
          <Ionicons
            name="alert-circle-outline"
            size={18}
            color={BROWN}
          />

          <Text style={styles.errorText}>
            {errorMessage}
          </Text>
        </View>
      ) : null}

      <View style={styles.tipCard}>
        <Ionicons
          name="bulb-outline"
          size={19}
          color={BROWN}
        />

        <Text style={styles.tipText}>
          Focus on accurate notes and smooth transitions. Speed should come naturally with practice.
        </Text>
      </View>

      <View style={styles.difficultyRow}>
        <Text style={styles.difficultyLabel}>
          Difficulty
        </Text>

        <Text style={styles.difficultyValue}>
          {config.label}
        </Text>
      </View>

      <Pressable
        style={styles.startButton}
        onPress={beginExercise}
      >
        <Ionicons
          name="play"
          size={18}
          color={WHITE}
        />

        <Text style={styles.startButtonText}>
          Start Exercise
        </Text>
      </Pressable>
    </View>
  );

  // ==========================================================
  // REFERENCE
  // ==========================================================

  const renderReference = () => (
    <View style={styles.content}>
      <Pressable
        style={styles.backButton}
        onPress={returnToInstructions}
        hitSlop={10}
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

      <View style={styles.referenceProgressCard}>
        <Text style={styles.referenceProgressLabel}>
          EXERCISE PROGRESS
        </Text>

        <View style={styles.repetitionDots}>
          {Array.from({
            length: config.repetitions,
          }).map((_, index) => (
            <View
              key={index}
              style={[
                styles.repetitionDot,
                index < currentRepetition
                  ? styles.repetitionDotCompleted
                  : styles.repetitionDotPending,
              ]}
            />
          ))}
        </View>

        <Text style={styles.referenceProgressText}>
          Repetition {currentRepetition} of {config.repetitions}
        </Text>
      </View>

      <View style={styles.referenceCard}>
        <Text style={styles.cardTitle}>
          Note Sequence
        </Text>

        <Text style={styles.referenceLabel}>
          FOLLOW THE NOTES IN ORDER
        </Text>

        <View style={styles.noteSequence}>
          {config.frequencies.map((frequency, index) => (
            <View
              key={`${frequency}-${index}`}
              style={styles.notePill}
            >
              <Text style={styles.noteNumber}>
                {index + 1}
              </Text>

              <Text style={styles.noteText}>
                {frequencyToNoteName(frequency)}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.referenceHint}>
          Listen to the complete run before you begin singing.
        </Text>
      </View>

      <Pressable
        style={[
          styles.startButton,
          isPlayingReference && styles.disabledButton,
        ]}
        disabled={isPlayingReference}
        onPress={handlePlayReference}
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

        <Text style={styles.startButtonText}>
          {isPlayingReference
            ? 'Playing Reference...'
            : 'Play Reference'}
        </Text>
      </Pressable>

      <Pressable
        style={[
          styles.finishButton,
          isPlayingReference && styles.disabledButton,
        ]}
        disabled={isPlayingReference}
        onPress={startCountdown}
      >
        <Ionicons
          name="arrow-forward"
          size={18}
          color={BROWN}
        />

        <Text style={styles.finishButtonText}>
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

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="flash-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>
        Get Ready
      </Text>

      <Text style={styles.repetitionLabel}>
        REPETITION {currentRepetition} OF {config.repetitions}
      </Text>

      <Text style={styles.countdownText}>
        {countdown}
      </Text>

      <Text style={styles.phaseSubtitle}>
        Prepare to sing the vocal run.
      </Text>

      <Pressable
        style={styles.finishButton}
        onPress={returnToInstructions}
      >
        <Text style={styles.finishButtonText}>
          Cancel
        </Text>
      </Pressable>
    </View>
  );

  // ==========================================================
  // RECORDING
  // ==========================================================

  const renderRecording = () => {
    const progress = Math.min(
      recordingTime / MAX_RECORDING_SECONDS,
      1,
    );

    return (
      <View style={styles.content}>
        <View style={styles.recordingIcon}>
          <Ionicons
            name="mic"
            size={34}
            color={BROWN}
          />
        </View>

        <Text style={styles.recordingTitle}>
          Sing the Vocal Run
        </Text>

        <Text style={styles.repetitionLabel}>
          REPETITION {currentRepetition} OF {config.repetitions}
        </Text>

        <Text style={styles.recordingSubtitle}>
          Follow the sequence as accurately and smoothly as possible.
        </Text>

        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />

          <Text style={styles.recordingBadgeText}>
            RECORDING
          </Text>
        </View>

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>
            TARGET SEQUENCE
          </Text>

          <View style={styles.liveSequence}>
            {config.frequencies.map((frequency, index) => (
              <View
                key={`${frequency}-${index}`}
                style={styles.liveNote}
              >
                <Text style={styles.liveNoteNumber}>
                  {index + 1}
                </Text>

                <Text style={styles.liveNoteText}>
                  {frequencyToNoteName(frequency)}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.liveDivider} />

          <View style={styles.liveStats}>
            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>
                Notes
              </Text>

              <Text style={styles.liveStatValue}>
                {config.frequencies.length}
              </Text>
            </View>

            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>
                Target Speed
              </Text>

              <Text style={styles.liveStatValue}>
                {config.speedLabel}
              </Text>
            </View>

            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>
                Progress
              </Text>

              <Text style={styles.liveStatValue}>
                {currentRepetition}/{config.repetitions}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.detectedPitchCard}>
          <Text style={styles.liveLabel}>
            LIVE DETECTED PITCH
          </Text>

          <Text style={styles.detectedPitchNote}>
            {livePitch?.note ?? '--'}
          </Text>

          <Text style={styles.detectedPitchFrequency}>
            {livePitch
              ? `${livePitch.frequency.toFixed(1)} Hz`
              : 'Sing a note to begin detection'}
          </Text>

          <Text style={styles.detectedPitchHint}>
            {livePitch
              ? 'Pitch detected from your microphone'
              : 'Listening for a clear vocal pitch'}
          </Text>
        </View>

        <Text style={styles.timerText}>
          Recording Time: {recordingTime.toFixed(1)}s
        </Text>

        <View style={styles.timerTrack}>
          <View
            style={[
              styles.timerFill,
              { width: `${progress * 100}%` },
            ]}
          />
        </View>

        <Pressable
          style={styles.finishButton}
          onPress={finishRecording}
        >
          <Ionicons
            name="stop"
            size={18}
            color={BROWN}
          />

          <Text style={styles.finishButtonText}>
            Finish Recording
          </Text>
        </Pressable>

        <Pressable
          style={styles.cancelButton}
          onPress={returnToInstructions}
        >
          <Text style={styles.cancelButtonText}>
            Cancel Exercise
          </Text>
        </Pressable>
      </View>
    );
  };

  // ==========================================================
  // PROCESSING
  // ==========================================================

  const renderProcessing = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <ActivityIndicator
          size="large"
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>
        Analyzing Your Singing
      </Text>

      <Text style={styles.repetitionLabel}>
        REPETITION{' '}
        {Math.min(
          currentRepetition,
          config.repetitions,
        )}{' '}
        OF {config.repetitions}
      </Text>

      <Text style={styles.phaseSubtitle}>
        Measuring pitch accuracy, sequence accuracy, transitions, and performance speed.
      </Text>
    </View>
  );

  // ==========================================================
  // RESULTS
  // ==========================================================

  const renderResults = () => {
    if (!result) {
      return null;
    }

    return (
      <View style={styles.resultsContent}>
        <View
          style={[
            styles.resultIcon,
            result.passed
              ? styles.resultIconPassed
              : styles.resultIconFailed,
          ]}
        >
          <Ionicons
            name={result.passed ? 'checkmark' : 'refresh'}
            size={40}
            color={BROWN}
          />
        </View>

        <Text style={styles.resultTitle}>
          {result.passed
            ? 'Great Job!'
            : 'Keep Practicing!'}
        </Text>

        <Text style={styles.resultSubtitle}>
          Vocal Run Accuracy Result
        </Text>

        <View style={styles.repetitionResultCard}>
          <Ionicons
            name="repeat-outline"
            size={20}
            color={BROWN}
          />

          <View style={styles.repetitionResultTextContainer}>
            <Text style={styles.repetitionResultTitle}>
              Repetitions Completed
            </Text>

            <Text style={styles.repetitionResultValue}>
              {result.repetitionsCompleted} of {config.repetitions}
            </Text>
          </View>
        </View>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>
            OVERALL SCORE
          </Text>

          <Text style={styles.scoreValue}>
            {Math.round(result.overall)}
          </Text>

          <Text style={styles.scoreDescription}>
            out of 100
          </Text>
        </View>

        <View style={styles.statusBadge}>
          <Text
            style={[
              styles.statusText,
              result.passed
                ? styles.statusPassedText
                : styles.statusNeedsWorkText,
            ]}
          >
            {result.passed ? 'PASSED' : 'KEEP PRACTICING'}
          </Text>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Accuracy Breakdown
          </Text>

          {[
            {
              label: 'Pitch Accuracy',
              value: result.pitchScore,
            },
            {
              label: 'Sequence Accuracy',
              value: result.sequenceScore,
            },
            {
              label: 'Transition Accuracy',
              value: result.transitionScore,
            },
          ].map((item, index) => (
            <View
              key={item.label}
              style={
                index === 2
                  ? styles.scoreRowLast
                  : styles.scoreRow
              }
            >
              <View style={styles.scoreRowHeader}>
                <Text style={styles.scoreRowLabel}>
                  {item.label}
                </Text>

                <Text style={styles.scoreRowValue}>
                  {Math.round(item.value)}%
                </Text>
              </View>

              <View style={styles.progressBackground}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(
                        Math.max(item.value, 0),
                        100,
                      )}%`,
                    },
                  ]}
                />
              </View>

              {index === 1 ? (
                <Text style={styles.thresholdText}>
                  Required: {config.accuracyThreshold}%
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Performance Metrics
          </Text>

          {[
            {
              label: 'Correct Notes',
              value: `${result.correctNoteCount}/${result.noteCount}`,
            },
            {
              label: 'Correct Transitions',
              value: `${result.correctTransitionCount}/${result.transitionCount}`,
            },
            {
              label: 'Notes/sec',
              value: result.notesPerSecond.toFixed(2),
            },
            {
              label: 'Total Duration',
              value: `${(result.durationMs / 1000).toFixed(1)}s`,
            },
          ].map((item, index) => (
            <View
              key={item.label}
              style={[
                styles.metricRow,
                index === 3 && styles.metricRowLast,
              ]}
            >
              <Text style={styles.metricLabel}>
                {item.label}
              </Text>

              <Text style={styles.metricValue}>
                {item.value}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.tipCard}>
          <Ionicons
            name="bulb-outline"
            size={20}
            color={BROWN}
          />

          <Text style={styles.tipText}>
            {result.feedback}
          </Text>
        </View>

        <Pressable
          style={styles.startButton}
          onPress={resetExercise}
        >
          <Ionicons
            name="refresh"
            size={18}
            color={WHITE}
          />

          <Text style={styles.startButtonText}>
            Try Again
          </Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={() =>
            router.replace('/dashboard?tab=exercises')
          }
        >
          <Text style={styles.doneButtonText}>
            Done
          </Text>
        </Pressable>
      </View>
    );
  };

  // ==========================================================
  // MAIN RENDER
  // ==========================================================

  if (tierLoading || isLoadingAdaptiveParams) {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.iconCircle}>
          <ActivityIndicator
            size="large"
            color={BROWN}
          />
        </View>

        <Text style={styles.phaseTitle}>
          Preparing Exercise
        </Text>

        <Text style={styles.phaseSubtitle}>
          Loading your current difficulty and exercise settings.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={
        phase === 'results'
          ? styles.resultsWrapper
          : undefined
      }
      showsVerticalScrollIndicator={false}
    >
      {phase === 'instructions' && renderInstructions()}
      {phase === 'reference' && renderReference()}
      {phase === 'countdown' && renderCountdown()}
      {phase === 'recording' && renderRecording()}
      {phase === 'processing' && renderProcessing()}
      {phase === 'results' && renderResults()}
    </ScrollView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 92,
    paddingBottom: 60,
    alignItems: 'center',
  },

  resultsContent: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 92,
    paddingBottom: 50,
    alignItems: 'center',
  },

  resultsWrapper: {
    flexGrow: 1,
    width: '100%',
  },

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHITE,
  },

  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
  },

  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 3,
    marginBottom: 24,
  },

  instructionCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },

  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  prepareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  prepareTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
    marginLeft: 9,
  },

  prepareItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },

  prepareText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginTop: 10,
    marginBottom: 14,
  },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },

  detailLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  detailValue: {
    flex: 1,
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'right',
    marginLeft: 16,
  },

  errorCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  errorText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 9,
  },

  startButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },

  disabledButton: {
    opacity: 0.55,
  },

  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  finishButton: {
    width: '100%',
    height: 53,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },

  finishButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 4,
  },

  cancelButtonText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  referenceCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 22,
  },

  referenceProgressCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 20,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },

  referenceProgressLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
  },

  repetitionDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 13,
  },

  repetitionDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
  },

  repetitionDotCompleted: {
    backgroundColor: BROWN,
  },

  repetitionDotPending: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  referenceProgressText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
    marginTop: 10,
  },

  repetitionLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: MUTED,
    textAlign: 'center',
    marginTop: 7,
  },

  referenceLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
    textAlign: 'center',
  },

  referenceHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 16,
  },

  noteSequence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
    marginTop: 16,
  },

  notePill: {
    minWidth: 60,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
  },

  noteNumber: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
    marginBottom: 2,
  },

  noteText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  centerScreen: {
    flexGrow: 1,
    minHeight: 700,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
    marginTop: 20,
  },

  phaseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
  },

  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 26,
    color: BROWN,
    textAlign: 'center',
  },

  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
    maxWidth: 310,
  },

  recordingBadge: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: BORDER,
  },

  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BROWN,
    marginRight: 7,
  },

  recordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: BROWN,
  },

  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    marginTop: 22,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
  },

  liveSequence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },

  liveNote: {
    minWidth: 52,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 13,
    backgroundColor: PINK,
    alignItems: 'center',
  },

  liveNoteNumber: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
    marginBottom: 1,
  },

  liveNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  liveDivider: {
    width: '100%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 15,
  },

  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 6,
  },

  liveStat: {
    flex: 1,
    alignItems: 'center',
  },

  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginTop: 3,
  },

  detectedPitchCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 20,
    padding: 20,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },

  detectedPitchNote: {
    fontFamily: 'FredokaBold',
    fontSize: 38,
    color: BROWN,
    marginTop: 12,
  },

  detectedPitchFrequency: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginTop: 4,
  },

  detectedPitchHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
  },

  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 7,
  },

  timerTrack: {
    width: '100%',
    height: 7,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 4,
    overflow: 'hidden',
  },

  timerFill: {
    height: '100%',
    backgroundColor: PINK,
  },

  resultIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  resultIconPassed: {
    backgroundColor: PINK,
  },

  resultIconFailed: {
    backgroundColor: LIGHT_GRAY,
  },

  resultTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
  },

  resultSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 3,
    marginBottom: 22,
  },

  repetitionResultCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    padding: 15,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 14,
  },

  repetitionResultTextContainer: {
    flex: 1,
    marginLeft: 10,
  },

  repetitionResultTitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  repetitionResultValue: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginTop: 2,
  },

  scoreCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
  },

  scoreLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
  },

  scoreValue: {
    fontFamily: 'FredokaBold',
    fontSize: 52,
    color: BROWN,
    marginVertical: 3,
  },

  scoreDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
    textAlign: 'center',
  },

  statusBadge: {
    marginTop: 14,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: LIGHT_PINK,
  },

  statusText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
  },

  statusPassedText: {
    color: GREEN,
  },

  statusNeedsWorkText: {
    color: RED,
  },

  resultCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginBottom: 14,
  },

  scoreRow: {
    marginBottom: 14,
  },

  scoreRowLast: {
    marginBottom: 0,
  },

  scoreRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 7,
  },

  scoreRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  scoreRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  thresholdText: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
    marginTop: 5,
  },

  progressBackground: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: PINK,
  },

  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  metricRowLast: {
    borderBottomWidth: 0,
  },

  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    flex: 1,
  },

  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'right',
    marginLeft: 12,
  },

  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 15,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },

  difficultyRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 4,
  },

  difficultyLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  difficultyValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  doneButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },

  doneButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
});
