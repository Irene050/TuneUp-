
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
  Alert,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  type Tier,
  VOWEL_CONSISTENCY_PARAMS,
  type VowelConsistencyParams,
} from '@/constants/exercises/tone';
import {
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
  ExerciseCountdownScreen,
  type ExercisePreparationStep,
  ExerciseProcessingScreen,
  type ExerciseSummaryItem,
} from '@/screens/exercises/ExerciseScreen';
import {
  generateVowelConsistencyParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import {
  measureVowelConsistency,
} from '@/services/measurement/tone/vowelConsistencyExercise';
import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
  scoreVowelConsistencyExercise,
  type VowelConsistencyScoreResult,
} from '@/services/scoring/tone/vowelConsistencyExercise';
import { samplesToFFTFrames } from '@/utils/dsp/fft';
import { frequencyToNote } from '@/utils/dsp/pitch';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;
const COUNTDOWN_SECONDS = 3;
const REST_MS = 1200;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'rest'
  | 'processing'
  | 'results';

interface RepetitionResult {
  score: number;
  passed: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function randomInRange([min, max]: [number, number]) {
  return min + Math.random() * (max - min);
}

function formatNumber(value: number, decimals = 1) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

function vowelDisplay(vowel: string) {
  return vowel.toUpperCase();
}

export default function VowelConsistencyExerciseScreen({
  tier,
}: Props) {
  const initialTier = tier ?? 'beginner';

  const [currentTier, setCurrentTier] = useState<Tier>(initialTier);
  const [params, setParams] = useState<VowelConsistencyParams>(
    VOWEL_CONSISTENCY_PARAMS[initialTier],
  );
  const [loadingParams, setLoadingParams] = useState(true);
  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [targetDuration, setTargetDuration] = useState(() =>
    randomInRange(params.durationRangeSec),
  );
  const [currentRepetition, setCurrentRepetition] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveFrame, setLiveFrame] = useState<LiveAudioFrame | null>(null);
  const [results, setResults] = useState<RepetitionResult[]>([]);
  const [finalResult, setFinalResult] =
    useState<VowelConsistencyScoreResult | null>(null);
  const [finalAverageCentroid, setFinalAverageCentroid] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const repetitions = Math.max(1, params.repetitions);

  const mountedRef = useRef(true);
  const phaseRef = useRef<Phase>('instructions');
  const pausedPhaseRef = useRef<Phase>('instructions');

  const pausedRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const discardNextStopRef = useRef(false);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const restTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const recordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const processingRef = useRef(false);
  const elapsedRef = useRef(0);
  const repetitionRef = useRef(1);
  const targetDurationRef = useRef(targetDuration);

  const repetitionMeasurementsRef = useRef<
    Array<ReturnType<typeof measureVowelConsistency>>
  >([]);
  const resultsRef = useRef<RepetitionResult[]>([]);

  const stopRecordingRef = useRef<
    (() => Promise<void>) | null
  >(null);

  const startRepCountdownRef = useRef<(() => void) | null>(null);
  const beginRecordingRef = useRef<(() => Promise<void>) | null>(null);

  const setCurrentPhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (restTimerRef.current) {
      clearTimeout(restTimerRef.current);
      restTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParams() {
      setLoadingParams(true);

      try {
        const user = auth.currentUser;
        let resolvedTier: Tier = initialTier;
        let recentScores: number[] = [];

        if (!tier && user) {
          try {
            const progress = await fetchComponentProgress(
              user.uid,
              'tone',
            );

            if (cancelled) return;

            resolvedTier = progress?.currentTier ?? 'beginner';
          } catch (error) {
            console.error('Failed to load tone progress:', error);
          }
        }

        if (cancelled) return;

        setCurrentTier(resolvedTier);

        if (user) {
          try {
            const records = await fetchExerciseRecords(
              user.uid,
              'tone',
            );

            if (cancelled) return;

            recentScores = records
              .filter(
                record =>
                  record.tier === resolvedTier &&
                  record.templateId === 'vowelConsistency',
              )
              .sort((a, b) => a.timestamp - b.timestamp)
              .slice(-5)
              .map(record => record.scorePct);
          } catch (error) {
            console.error(
              'Failed to load vowel consistency history:',
              error,
            );
          }

          if (cancelled) return;

          if (recentScores.length === 0) {
            try {
              const assessment = await getLatestAssessment();

              if (cancelled) return;

              const toneScore = assessment?.scores.find(
                score => score.componentId === 'tone',
              );

              if (
                toneScore &&
                Number.isFinite(toneScore.scorePct)
              ) {
                recentScores = [toneScore.scorePct];
              }
            } catch (error) {
              console.error(
                'Failed to load latest assessment:',
                error,
              );
            }
          }
        }

        if (cancelled) return;

        const generatedParams = generateVowelConsistencyParams({
          tier: resolvedTier,
          recentScores,
        });

        const nextDuration = randomInRange(
          generatedParams.durationRangeSec,
        );

        targetDurationRef.current = nextDuration;

        setParams(generatedParams);
        setTargetDuration(nextDuration);
      } catch (error) {
        console.error(
          'Failed to load adaptive vowel consistency parameters:',
          error,
        );

        if (!cancelled) {
          setCurrentTier(initialTier);
          setParams(VOWEL_CONSISTENCY_PARAMS[initialTier]);
        }
      } finally {
        if (!cancelled) setLoadingParams(false);
      }
    }

    void loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [initialTier, tier]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      showQuitModalRef.current = false;
      discardNextStopRef.current = true;

      clearTimers();

      recordingRef.current = false;
      stopRequestedRef.current = true;

      try {
        void stopRecordingRef.current?.().catch(error => {
          console.error(
            'Failed to stop vowel recording during cleanup:',
            error,
          );
        });
      } catch (error) {
        console.error(
          'Failed to stop vowel recording during cleanup:',
          error,
        );
      }
    };
  }, [clearTimers]);

  useEffect(() => {
    targetDurationRef.current = targetDuration;
  }, [targetDuration]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phaseRef.current !== 'recording'
    ) {
      return;
    }

    setLiveFrame(frame);
  }, []);

  const resetExercise = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    quitInProgressRef.current = false;
    discardNextStopRef.current = false;

    repetitionRef.current = 1;
    recordingRef.current = false;
    stopRequestedRef.current = false;
    processingRef.current = false;
    elapsedRef.current = 0;
    repetitionMeasurementsRef.current = [];
    resultsRef.current = [];

    setCurrentRepetition(1);
    setElapsedMs(0);
    setLiveFrame(null);
    setResults([]);
    setFinalResult(null);
    setFinalAverageCentroid(0);
    setFrameCount(0);
    setErrorMessage(null);
    setShowQuitModal(false);
    setIsQuitting(false);

    const nextDuration = randomInRange(params.durationRangeSec);

    targetDurationRef.current = nextDuration;
    setTargetDuration(nextDuration);
  }, [clearTimers, params.durationRangeSec]);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,

    onStop: async (samples, sampleRate) => {
      // Discard audio from a repetition interrupted by the quit modal.
      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        recordingRef.current = false;
        stopRequestedRef.current = false;
        return;
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        processingRef.current
      ) {
        return;
      }

      recordingRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      setCurrentPhase('processing');

      try {
        if (!samples.length || sampleRate <= 0) {
          throw new Error('No usable audio was recorded.');
        }

        const fftFrames = samplesToFFTFrames(
          samples,
          FFT_SIZE,
          FFT_HOP_SIZE,
        );

        if (!fftFrames.length) {
          throw new Error('No FFT frames could be generated.');
        }

        const measurement = measureVowelConsistency(
          fftFrames,
          sampleRate,
          FFT_SIZE,
        );

        const scored = scoreVowelConsistencyExercise(
          measurement,
          params,
        );

        repetitionMeasurementsRef.current.push(measurement);

        const nextResults = [
          ...resultsRef.current,
          {
            score: scored.score,
            passed: scored.passed,
          },
        ];

        resultsRef.current = nextResults;

        if (!mountedRef.current || quitInProgressRef.current) {
          return;
        }

        setResults(nextResults);
        setFrameCount(previous => previous + fftFrames.length);

        const measurements = repetitionMeasurementsRef.current;

        const centroidAverages = measurements.map(item => {
          const valid = item.centroidOverTime.filter(
            value => Number.isFinite(value) && value > 0,
          );

          return valid.length
            ? valid.reduce((sum, value) => sum + value, 0) /
                valid.length
            : 0;
        });

        setFinalAverageCentroid(
          centroidAverages.reduce((sum, value) => sum + value, 0) /
            measurements.length,
        );

        if (nextResults.length < repetitions) {
          const nextRep = nextResults.length + 1;

          repetitionRef.current = nextRep;
          setCurrentRepetition(nextRep);
          setLiveFrame(null);
          setElapsedMs(0);
          elapsedRef.current = 0;
          setCurrentPhase('rest');

          restTimerRef.current = setTimeout(() => {
            restTimerRef.current = null;

            if (
              mountedRef.current &&
              !pausedRef.current &&
              !quitInProgressRef.current
            ) {
              startRepCountdownRef.current?.();
            }
          }, REST_MS);

          return;
        }

        processingRef.current = true;

        const overallScore = Math.round(
          nextResults.reduce((sum, item) => sum + item.score, 0) /
            nextResults.length,
        );

        const finalScored: VowelConsistencyScoreResult = {
          score: clamp(overallScore, 0, 100),
          passed: nextResults.every(item => item.passed),
        };

        setFinalResult(finalScored);

        if (quitInProgressRef.current) return;

        await saveCompletedExercise(
          'tone',
          'vowelConsistency',
          currentTier,
          finalScored.score,
        );

        if (
          mountedRef.current &&
          !quitInProgressRef.current
        ) {
          setCurrentPhase('results');
        }
      } catch (error) {
        console.error(
          'Vowel consistency processing error:',
          error,
        );

        if (
          mountedRef.current &&
          !quitInProgressRef.current
        ) {
          setErrorMessage(
            'We could not analyze this repetition. Please try again.',
          );
          setCurrentPhase('instructions');
        }
      } finally {
        processingRef.current = false;
        stopRequestedRef.current = false;
      }
    },
  });

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  const beginRecording = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      recordingRef.current ||
      processingRef.current
    ) {
      return;
    }

    try {
      setErrorMessage(null);
      setLiveFrame(null);
      elapsedRef.current = 0;
      setElapsedMs(0);
      stopRequestedRef.current = false;
      discardNextStopRef.current = false;
      setCurrentPhase('recording');

      await startRecording();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      recordingRef.current = true;

      const durationMs = targetDurationRef.current * 1000;

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          !recordingRef.current ||
          stopRequestedRef.current
        ) {
          return;
        }

        elapsedRef.current += 100;
        setElapsedMs(elapsedRef.current);

        if (elapsedRef.current >= durationMs) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }

          stopRequestedRef.current = true;

          stopRecording().catch(error => {
            console.error(
              'Failed to stop vowel recording:',
              error,
            );

            recordingRef.current = false;
            stopRequestedRef.current = false;

            if (mountedRef.current && !quitInProgressRef.current) {
              setErrorMessage(
                'We could not finish the recording. Please try again.',
              );
              setCurrentPhase('instructions');
            }
          });
        }
      }, 100);
    } catch (error) {
      console.error('Failed to start vowel recording:', error);

      recordingRef.current = false;
      stopRequestedRef.current = false;

      if (
        mountedRef.current &&
        !quitInProgressRef.current &&
        !pausedRef.current
      ) {
        setCurrentPhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    }
  }, [setCurrentPhase, startRecording, stopRecording]);

  useEffect(() => {
    beginRecordingRef.current = beginRecording;
  }, [beginRecording]);

  const startRepCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      processingRef.current ||
      recordingRef.current
    ) {
      return;
    }

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    setCountdown(COUNTDOWN_SECONDS);
    setCurrentPhase('countdown');

    let value = COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      value -= 1;

      if (value <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }

        void beginRecordingRef.current?.();
        return;
      }

      setCountdown(value);
    }, 1000);
  }, [setCurrentPhase]);

  useEffect(() => {
    startRepCountdownRef.current = startRepCountdown;
  }, [startRepCountdown]);

  const startExercise = useCallback(() => {
    if (loadingParams || quitInProgressRef.current) return;

    resetExercise();
    startRepCountdownRef.current?.();
  }, [loadingParams, resetExercise]);

  const stopEarly = useCallback(() => {
    if (
      !recordingRef.current ||
      stopRequestedRef.current ||
      pausedRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    stopRequestedRef.current = true;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    void stopRecording().catch(error => {
      console.error(
        'Failed to stop vowel recording early:',
        error,
      );

      stopRequestedRef.current = false;
    });
  }, [stopRecording]);

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

    clearTimers();

    if (currentPhase === 'recording') {
      // An interrupted recording is discarded, not scored.
      discardNextStopRef.current = true;
      stopRequestedRef.current = true;
      recordingRef.current = false;
      elapsedRef.current = 0;

      setElapsedMs(0);
      setLiveFrame(null);

      try {
        void stopRecordingRef.current?.().catch(error => {
          console.error(
            'Failed to stop vowel recording while paused:',
            error,
          );
        });
      } catch (error) {
        console.error(
          'Failed to stop vowel recording while paused:',
          error,
        );
      }
    }

    setShowQuitModal(true);
  }, [clearTimers]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    const previousPhase = pausedPhaseRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    pausedRef.current = false;

    if (previousPhase === 'countdown' ||
        previousPhase === 'recording') {
      // Start a fresh countdown for the interrupted repetition.
      recordingRef.current = false;
      stopRequestedRef.current = false;
      discardNextStopRef.current = false;
      elapsedRef.current = 0;

      setElapsedMs(0);
      setLiveFrame(null);

      startRepCountdownRef.current?.();
      return;
    }

    if (previousPhase === 'rest') {
      // Continue the existing rest period without skipping a rep.
      restTimerRef.current = setTimeout(() => {
        restTimerRef.current = null;

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !quitInProgressRef.current
        ) {
          startRepCountdownRef.current?.();
        }
      }, REST_MS);

      return;
    }

    // Processing may finish while the modal is visible.
    // Do not run scoring or saving a second time.
  }, []);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();

    recordingRef.current = false;
    stopRequestedRef.current = true;
    elapsedRef.current = 0;

    try {
      await Promise.resolve(stopRecordingRef.current?.());
    } catch (error) {
      console.error(
        'Failed to stop vowel recording before leaving:',
        error,
      );
    } finally {
      if (mountedRef.current) {
        router.replace('/dashboard?tab=exercises');
      }
    }
  }, [clearTimers]);

  const goBack = useCallback(() => {
    pauseForExitPrompt();
  }, [pauseForExitPrompt]);

  const retry = useCallback(() => {
    if (quitInProgressRef.current) return;

    resetExercise();
    setCurrentPhase('instructions');
  }, [resetExercise, setCurrentPhase]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) return true;

        pauseForExitPrompt();
        return true;
      },
    );

    return () => subscription.remove();
  }, [pauseForExitPrompt]);

  const recordingProgress = targetDuration
    ? clamp(elapsedMs / 1000 / targetDuration, 0, 1)
    : 0;

  const livePitchNote =
    liveFrame && liveFrame.pitch > 0
      ? frequencyToNote(liveFrame.pitch)
      : '--';

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

          <Text style={styles.modalTitle}>Quit exercise?</Text>

          <Text style={styles.modalMessage}>
            {pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Vowel Consistency?'
              : pausedPhaseRef.current === 'recording'
                ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                : pausedPhaseRef.current === 'processing'
                  ? 'Your current repetition is being analyzed. You can continue to let the exercise finish or quit and return to exercises.'
                  : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'}
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

  if (loadingParams || !params) {
    return (
      <>
        <View style={styles.preparingScreen}>
          <View style={styles.preparingIconCircle}>
            <Ionicons
              name="options-outline"
              size={32}
              color={BROWN}
            />
          </View>

          <Text style={styles.preparingTitle}>
            Preparing Your Exercise
          </Text>

          <Text style={styles.preparingSubtitle}>
            Adjusting the exercise to your current difficulty level
            and preparing your vocal range.
          </Text>

          <ActivityIndicator
            size="large"
            color={BROWN}
            style={styles.preparingSpinner}
          />
        </View>
        {quitModal}
      </>
    );
  }

  if (phase === 'instructions') {
    const preparationSteps: ExercisePreparationStep[] = [
      {
        icon: 'volume-mute-outline',
        text: 'Find a quiet place with minimal background noise.',
      },
      {
        icon: 'body-outline',
        text: 'Keep your posture relaxed and keep the microphone a comfortable distance away.',
      },
      {
        icon: 'repeat-outline',
        text: 'You will repeat the same vowel several times so TuneUp! can compare your consistency.',
      },
    ];

    const summary: ExerciseSummaryItem[] = [
      {
        label: 'TARGET',
        value: vowelDisplay(params.vowel),
        hint: 'vowel',
      },
      {
        label: 'REPETITIONS',
        value: String(repetitions),
        hint: 'attempts',
      },
      {
        label: 'HOLD',
        value: `${formatNumber(params.durationRangeSec[0])}–${formatNumber(params.durationRangeSec[1])}s`,
        hint: 'per repetition',
      },
      {
        label: 'CONSISTENCY',
        value: `${params.smoothnessThreshold}%`,
        hint: 'minimum',
      },
    ];

    return (
      <>
        <ExerciseScreen
          title="Vowel Consistency"
          category="Tone"
          icon="text-outline"
          instructions="Sing the target vowel clearly at a comfortable pitch. Hold the vowel without changing its mouth shape or sound quality. Rest briefly, then repeat the same vowel for every repetition."
          preparationSteps={preparationSteps}
          summary={summary}
          targetValue={vowelDisplay(params.vowel)}
          targetHint="target vowel"
          repetitions={repetitions}
          tip="Keep the vowel sounding the same from start to finish."
          tier={currentTier}
          onBack={goBack}
          onStart={startExercise}
          error={errorMessage ?? undefined}
          startDisabled={loadingParams}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          title="Vowel Consistency"
          icon="text-outline"
          currentRep={currentRepetition}
          repetitions={repetitions}
          countdown={countdown}
          promptTitle="Target Vowel"
          prompt={vowelDisplay(params.vowel)}
          onBack={goBack}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'rest') {
    return (
      <>
        <View style={styles.centerScreen}>
          <View style={styles.iconCircle}>
            <Ionicons
              name="pause-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.phaseTitle}>Relax</Text>

          <Text style={styles.phaseSubtitle}>
            Repetition {currentRepetition - 1} complete.
          </Text>

          <Text style={styles.largeVowel}>
            Next {currentRepetition}
          </Text>

          <ActivityIndicator
            size="small"
            color={BROWN}
            style={styles.restIndicator}
          />
        </View>
        {quitModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        <View style={styles.screen}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.recordingContent}
          >
            <Text style={styles.recordingEyebrow}>
              REPETITION {currentRepetition} / {repetitions}
            </Text>

            <Text style={styles.recordingTitle}>
              Keep the Vowel Consistent
            </Text>

            <Text style={styles.recordingSubtitle}>
              Do not change the vowel shape while you sustain it.
            </Text>

            <View style={styles.vowelCard}>
              <Text style={styles.vowelLabel}>TARGET VOWEL</Text>

              <Text style={styles.vowelValue}>
                {vowelDisplay(params.vowel)}
              </Text>

              <Text style={styles.vowelInstruction}>
                Same vowel • same sound
              </Text>
            </View>

            <View style={styles.microphoneArea}>
              <View style={styles.outerMicCircle}>
                <View style={styles.innerMicCircle}>
                  <Ionicons
                    name="mic"
                    size={52}
                    color={BROWN}
                  />
                </View>
              </View>

              <View style={styles.recordingBadge}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingBadgeText}>
                  RECORDING
                </Text>
              </View>
            </View>

            <View style={styles.liveCard}>
              <Text style={styles.liveLabel}>LIVE SIGNAL</Text>

              <Text style={styles.liveNote}>
                {livePitchNote}
              </Text>

              <Text style={styles.liveFrequency}>
                {liveFrame && liveFrame.pitch > 0
                  ? `${Math.round(liveFrame.pitch)} Hz`
                  : '--'}
              </Text>

              <View style={styles.liveStats}>
                <View style={styles.liveStat}>
                  <Text style={styles.liveStatLabel}>
                    Clarity
                  </Text>

                  <Text style={styles.liveStatValue}>
                    {liveFrame && liveFrame.clarity > 0
                      ? `${Math.round(liveFrame.clarity * 100)}%`
                      : '--'}
                  </Text>
                </View>

                <View style={styles.liveStat}>
                  <Text style={styles.liveStatLabel}>
                    Volume
                  </Text>

                  <Text style={styles.liveStatValue}>
                    {liveFrame &&
                    Number.isFinite(liveFrame.volume)
                      ? `${Math.round(liveFrame.volume)} dB`
                      : '--'}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={styles.timerText}>
              {(elapsedMs / 1000).toFixed(1)} /{' '}
              {formatNumber(targetDuration)}s
            </Text>

            <View style={styles.timerTrack}>
              <View
                style={[
                  styles.timerFill,
                  {
                    width: `${recordingProgress * 100}%`,
                  },
                ]}
              />
            </View>

            <Text style={styles.helperText}>
              The important part is keeping the vowel sounding the
              same from start to finish.
            </Text>

            <Pressable
              style={styles.stopButton}
              onPress={stopEarly}
              disabled={!isRecording || isQuitting}
              accessibilityRole="button"
            >
              <Ionicons
                name="stop-circle-outline"
                size={20}
                color={BROWN}
              />

              <Text style={styles.stopButtonText}>
                Finish This Repetition
              </Text>
            </Pressable>
          </ScrollView>
        </View>
        {quitModal}
      </>
    );
  }

  if (phase === 'processing') {
    const isFinalRep = currentRepetition >= repetitions;

    return (
      <>
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title={
            isFinalRep
              ? 'Analyzing Your Results'
              : 'Analyzing Your Vowel'
          }
          message={
            isFinalRep
              ? 'Calculating your overall tone consistency score'
              : `Processing repetition ${currentRepetition}`
          }
          onBack={goBack}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'results' && finalResult) {
    return (
      <>
        <View style={styles.screen}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.resultsContent}
          >
            <View
              style={[
                styles.resultIcon,
                finalResult.passed
                  ? styles.resultIconPassed
                  : styles.resultIconFailed,
              ]}
            >
              <Ionicons
                name={finalResult.passed ? 'checkmark' : 'refresh'}
                size={40}
                color={BROWN}
              />
            </View>

            <Text style={styles.resultTitle}>
              {finalResult.passed
                ? 'Great Job!'
                : 'Keep Practicing!'}
            </Text>

            <Text style={styles.resultSubtitle}>
              Vowel Consistency Result
            </Text>

            <View style={styles.scoreCard}>
              <Text style={styles.scoreLabel}>Overall Score</Text>

              <Text style={styles.scoreValue}>
                {finalResult.score}%
              </Text>

              <Text style={styles.scoreDescription}>
                {finalResult.passed
                  ? 'Your vowel stayed consistent across the exercise.'
                  : 'Try to keep the vowel shape and tone more consistent in every repetition.'}
              </Text>
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>Target</Text>

              <View style={styles.targetResultRow}>
                <View>
                  <Text style={styles.resultTargetSmall}>
                    VOWEL
                  </Text>

                  <Text style={styles.resultTargetLarge}>
                    {vowelDisplay(params.vowel)}
                  </Text>
                </View>

                <View style={styles.targetBadge}>
                  <Text style={styles.targetBadgeText}>
                    {repetitions} reps
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>
                Repetition Scores
              </Text>

              {results.map((item, index) => (
                <View
                  style={styles.resultRow}
                  key={`rep-${index}`}
                >
                  <View style={styles.resultRowContent}>
                    <Text style={styles.resultRowLabel}>
                      Repetition {index + 1}
                    </Text>

                    <Text style={styles.resultRowHint}>
                      {item.passed
                        ? 'Vowel target and smoothness met'
                        : 'Needs more consistent vowel quality'}
                    </Text>
                  </View>

                  <Text style={styles.resultRowValue}>
                    {item.score}%
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>Analysis</Text>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  Average spectral centroid
                </Text>

                <Text style={styles.resultRowValue}>
                  {finalAverageCentroid > 0
                    ? `${Math.round(finalAverageCentroid)} Hz`
                    : '--'}
                </Text>
              </View>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  Frames analyzed
                </Text>

                <Text style={styles.resultRowValue}>
                  {frameCount}
                </Text>
              </View>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  Required smoothness
                </Text>

                <Text style={styles.resultRowValue}>
                  {params.smoothnessThreshold}%
                </Text>
              </View>
            </View>

            <Pressable
              style={styles.startButton}
              onPress={retry}
            >
              <Text style={styles.startButtonText}>
                Try Again
              </Text>

              <Ionicons
                name="refresh"
                size={18}
                color={WHITE}
              />
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={goBack}
            >
              <Text style={styles.secondaryButtonText}>
                Back to Exercises
              </Text>
            </Pressable>
          </ScrollView>
        </View>
        {quitModal}
      </>
    );
  }

  return quitModal;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },
  preparingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  preparingIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  preparingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
    color: '#9A817D',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 285,
  },
  preparingSpinner: {
    marginTop: 24,
  },
  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  recordingContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 50,
    alignItems: 'center',
  },
  resultsContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 50,
    alignItems: 'center',
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
  startButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },
  secondaryButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  secondaryButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
  },
  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
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
  largeVowel: {
    fontFamily: 'FredokaBold',
    fontSize: 58,
    color: BROWN,
    marginTop: 14,
  },
  restIndicator: {
    marginTop: 18,
  },
  recordingEyebrow: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 1,
    color: MUTED,
    textAlign: 'center',
  },
  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
    marginTop: 8,
  },
  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 18,
  },
  vowelCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    marginTop: 24,
  },
  vowelLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  vowelValue: {
    fontFamily: 'FredokaBold',
    fontSize: 54,
    color: BROWN,
    marginTop: 2,
  },
  vowelInstruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
    marginTop: 2,
  },
  microphoneArea: {
    alignItems: 'center',
    marginVertical: 20,
  },
  outerMicCircle: {
    width: 146,
    height: 146,
    borderRadius: 73,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerMicCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBadge: {
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: BROWN,
  },
  recordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
    letterSpacing: 0.8,
  },
  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    marginTop: 25,
    alignItems: 'center',
  },
  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 3,
  },
  liveFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },
  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 18,
  },
  liveStat: {
    alignItems: 'center',
  },
  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginTop: 2,
  },
  timerText: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    textAlign: 'center',
    marginTop: 18,
  },
  timerTrack: {
    width: '100%',
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 9,
  },
  timerFill: {
    height: '100%',
    backgroundColor: PINK,
  },
  helperText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 12,
  },
  stopButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  stopButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
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
    textAlign: 'center',
    marginTop: 3,
    marginBottom: 22,
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
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
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
    marginBottom: 10,
  },
  targetResultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultTargetSmall: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  resultTargetLarge: {
    fontFamily: 'FredokaBold',
    fontSize: 38,
    color: BROWN,
  },
  targetBadge: {
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  targetBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  resultRowContent: {
    flex: 1,
  },
  resultRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  resultRowHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
    marginTop: 2,
    maxWidth: 220,
  },
  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    marginLeft: 12,
  },
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