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
} from '@/constants/tone';
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

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const GUIDE_GREEN = '#4F9B67';
const GUIDE_YELLOW = '#D9A72E';
const GUIDE_RED = '#D64F5A';

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

interface ToneFeedback {
  title: string;
  message: string;
  icon: keyof typeof Ionicons.glyphMap;
  backgroundColor: string;
  iconColor: string;
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

function getToneFeedback(
  frame: LiveAudioFrame | null,
): ToneFeedback {
  if (
    !frame ||
    !Number.isFinite(frame.pitch) ||
    frame.pitch <= 0
  ) {
    return {
      title: 'I’m listening…',
      message: 'Start making your vowel sound when you’re ready.',
      icon: 'ear-outline',
      backgroundColor: LIGHT_PINK,
      iconColor: GUIDE_RED,
    };
  }

  if (!Number.isFinite(frame.clarity) || frame.clarity < 0.45) {
    return {
      title: 'Let’s hear that again',
      message: 'Try making a clear, gentle vowel sound. No need to shout.',
      icon: 'volume-medium-outline',
      backgroundColor: `${GUIDE_YELLOW}20`,
      iconColor: GUIDE_YELLOW,
    };
  }

  if (frame.clarity >= 0.75) {
    return {
      title: 'Nice and clear!',
      message: 'Your voice is coming through clearly. Keep going!',
      icon: 'checkmark-circle-outline',
      backgroundColor: `${GUIDE_GREEN}20`,
      iconColor: GUIDE_GREEN,
    };
  }

  return {
    title: 'Good start!',
    message: 'Keep your voice relaxed and continue holding the vowel.',
    icon: 'heart-outline',
    backgroundColor: `${GUIDE_YELLOW}20`,
    iconColor: GUIDE_YELLOW,
  };
}

function VowelLiveWaveform({
  frame,
}: {
  frame: LiveAudioFrame | null;
}) {
  const pitch = frame?.pitch ?? 0;
  const hasPitch = Number.isFinite(pitch) && pitch > 0;
  const clarity =
    frame && Number.isFinite(frame.clarity) ? frame.clarity : 0;

  const waveformColor = !hasPitch
    ? GUIDE_RED
    : clarity >= 0.75
      ? GUIDE_GREEN
      : clarity >= 0.45
        ? GUIDE_YELLOW
        : GUIDE_RED;

  const statusText = !hasPitch
    ? 'Listening for your voice...'
    : clarity >= 0.75
      ? 'Your voice is coming through clearly'
      : clarity >= 0.45
        ? 'Keep your voice relaxed and steady'
        : 'Try making a clearer vowel sound';

  const bars = Array.from({ length: 30 }, (_, index) => {
    const center = 14.5;
    const distance = Math.abs(index - center) / center;
    const envelope = 1 - distance * 0.65;
    const variation = hasPitch
      ? 0.35 +
        Math.abs(Math.sin(index * 0.72 + pitch * 0.001)) * 0.65
      : 0.12 + Math.abs(Math.sin(index * 0.72)) * 0.12;

    return Math.max(5, Math.round(38 * envelope * variation));
  });

  return (
    <View style={styles.waveformContainer}>
      <View
        style={styles.waveformBars}
        accessibilityLabel={
          !hasPitch
            ? 'No pitch detected'
            : clarity >= 0.75
              ? 'Clear voice detected'
              : 'Voice detected'
        }
      >
        {bars.map((height, index) => (
          <View
            key={`vowel-wave-${index}`}
            style={[
              styles.waveformBar,
              {
                height,
                backgroundColor: waveformColor,
                opacity: hasPitch ? 0.9 : 0.45,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.waveformStatusRow}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: waveformColor },
          ]}
        />
        <Text
          style={[
            styles.waveformStatus,
            { color: waveformColor },
          ]}
        >
          {statusText}
        </Text>
      </View>
    </View>
  );
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

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

        console.log('📊 VOWEL REPETITION SCORES:', {
  repetitionScores: nextResults.map(item => item.score),
  repetitionCount: nextResults.length,
  expectedRepetitions: repetitions,
});

        const overallScore = Math.round(
          nextResults.reduce((sum, item) => sum + item.score, 0) /
            nextResults.length,
        );

        console.log('📊 VOWEL FINAL SCORE:', {
  overallScore,
  savedTier: currentTier,
  repetitionScores: nextResults.map(item => item.score),
});

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

    if (
      previousPhase === 'countdown' ||
      previousPhase === 'recording'
    ) {
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
    }
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
        router.replace('/exercises/tone');
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

  const toneFeedback = getToneFeedback(liveFrame);

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
              size={44}
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
            style={styles.spinner}
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
        value: `${formatNumber(params.durationRangeSec[0])} → ${formatNumber(params.durationRangeSec[1])}s`,
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

          <Text style={styles.phaseTitle}>Take a Little Rest</Text>

          <Text style={styles.phaseSubtitle}>
            Repetition {currentRepetition - 1} complete. Relax your
            voice before the next one.
          </Text>

          <Text style={styles.largeVowel}>
            {vowelDisplay(params.vowel)}
          </Text>

          <Text style={styles.restHint}>
            Get ready for repetition {currentRepetition}
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
  const elapsedSeconds = elapsedMs / 1000;

  const recordingProgress = targetDuration > 0
    ? clamp(elapsedSeconds / targetDuration, 0, 1)
    : 0;

  const remainingSeconds = Math.max(
    0,
    targetDuration - elapsedSeconds,
  );

  const detectedPitch =
    liveFrame &&
    Number.isFinite(liveFrame.pitch) &&
    liveFrame.pitch > 0
      ? `${formatNumber(liveFrame.pitch, 1)} Hz`
      : '--';

  const voiceClarity =
    liveFrame && Number.isFinite(liveFrame.clarity)
      ? `${formatNumber(
          clamp(liveFrame.clarity * 100, 0, 100),
          0,
        )}%`
      : '--';

  return (
    <>
      <View style={styles.recordingScreen}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.recordingBody}
        >

          <Text style={styles.recordingTitle}>
            Keep the Vowel Consistent
          </Text>

          <Text style={styles.recordingSubtitle}>
            Hold the same vowel sound. Stay relaxed and let your
            voice flow naturally.
          </Text>

          <View style={styles.repPill}>
            <Ionicons
              name="repeat-outline"
              size={16}
              color={BROWN}
            />
            <Text style={styles.repPillText}>
              REPETITION {currentRepetition} OF {repetitions}
            </Text>
          </View>

          <View style={styles.liveCard}>
            <View style={styles.liveCardHeader}>
              <View style={styles.liveMicCircle}>
                <Ionicons
                  name="mic"
                  size={21}
                  color={GUIDE_GREEN}
                />
              </View>

              <View style={styles.liveCardHeading}>
                <Text style={styles.liveCardTitle}>
                  Live Voice Monitor
                </Text>
                <Text style={styles.liveCardSubtitle}>
                  Your microphone feedback
                </Text>
              </View>

              <View style={styles.liveIndicatorPill}>
                <View style={styles.recordingDot} />
                <Text style={styles.liveIndicatorText}>LIVE</Text>
              </View>
            </View>

            <VowelLiveWaveform frame={liveFrame} />

            <View style={styles.liveMetricsRow}>
              <View style={styles.liveMetric}>
                <Text style={styles.liveLabel}>TARGET VOWEL</Text>
                <Text style={styles.liveValue}>
                  {vowelDisplay(params.vowel)}
                </Text>
                <Text style={styles.metricHint}>
                  Keep the sound consistent
                </Text>
              </View>

              <View style={styles.liveDivider} />

              <View style={styles.liveMetric}>
                <Text style={styles.liveLabel}>VOICE CLARITY</Text>
                <Text style={styles.liveValue}>
                  {voiceClarity}
                </Text>
                <Text style={styles.metricHint}>
                  {detectedPitch}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.recordingProgressSection}>
            <View style={styles.recordingProgressLabels}>
              <Text style={styles.progressLabel}>RECORDING</Text>
              <Text style={styles.progressTime}>
                {formatNumber(elapsedSeconds)}s /{' '}
                {formatNumber(targetDuration)}s
              </Text>
            </View>

            <View
              style={styles.progressTrack}
              accessibilityRole="progressbar"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round(recordingProgress * 100),
              }}
            >
              <View
                style={[
                  styles.progressFill,
                  { width: `${recordingProgress * 100}%` },
                ]}
              />
            </View>

            <Text style={styles.remainingText}>
              {formatNumber(remainingSeconds)} seconds remaining
            </Text>
          </View>
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
              ? 'Preparing Your Results'
              : 'Checking Your Vowel'
          }
          message={
            isFinalRep
              ? 'Looking at all your repetitions to calculate your overall score.'
              : `Checking repetition ${currentRepetition}. Just a moment!`
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
                name={
                  finalResult.passed
                    ? 'checkmark-circle-outline'
                    : 'refresh-outline'
                }
                size={42}
                color={BROWN}
              />
            </View>

            <Text style={styles.resultTitle}>
              {finalResult.passed
                ? 'Great Job!'
                : 'Keep Practicing!'}
            </Text>

            <Text style={styles.resultSubtitle}>
              You finished your Vowel Consistency exercise
            </Text>

            <View style={styles.scoreCard}>
              <Text style={styles.scoreLabel}>
                YOUR OVERALL SCORE
              </Text>

              <Text style={styles.scoreValue}>
                {finalResult.score}%
              </Text>

              <Text style={styles.scoreDescription}>
                {finalResult.passed
                  ? 'Well done! Your results met the exercise target. Keep practicing to build an even steadier sound.'
                  : 'You’re making progress. Try holding the same vowel shape and sound from beginning to end.'}
              </Text>
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>
                Your Practice
              </Text>

              <View style={styles.targetResultRow}>
                <View>
                  <Text style={styles.resultTargetSmall}>
                    TARGET VOWEL
                  </Text>

                  <Text style={styles.resultTargetLarge}>
                    {vowelDisplay(params.vowel)}
                  </Text>
                </View>

                <View style={styles.targetBadge}>
                  <Text style={styles.targetBadgeText}>
                    {results.length} of {repetitions} reps
                  </Text>
                </View>
              </View>

              <View style={styles.practiceTip}>
                <Ionicons
                  name="bulb-outline"
                  size={22}
                  color={BROWN}
                />

                <View style={styles.practiceTipText}>
                  <Text style={styles.practiceTipTitle}>
                    What to focus on next
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>
                How You Did Each Time
              </Text>

              {results.map((item, index) => (
                <View
                  style={styles.resultRow}
                  key={`rep-${index}`}
                >
                  <View
                    style={[
                      styles.repStatusIcon,
                      item.passed
                        ? styles.repStatusPassed
                        : styles.repStatusNeedsPractice,
                    ]}
                  >
                    <Ionicons
                      name={
                        item.passed
                          ? 'checkmark'
                          : 'refresh-outline'
                      }
                      size={17}
                      color={BROWN}
                    />
                  </View>

                  <View style={styles.resultRowContent}>
                    <Text style={styles.resultRowLabel}>
                      Repetition {index + 1}
                    </Text>

                    <Text style={styles.resultRowHint}>
                      {item.passed
                        ? 'Exercise target reached'
                        : 'Keep practicing this vowel'}
                    </Text>
                  </View>

                  <Text style={styles.resultRowValue}>
                    {item.score}%
                  </Text>
                </View>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.startButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={retry}
              accessibilityRole="button"
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
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={goBack}
              accessibilityRole="button"
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
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
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
    paddingTop: 70,
    paddingBottom: 40,
    alignItems: 'center',
  },
  resultsContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 50,
    paddingBottom: 45,
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
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
  },
  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },
  secondaryButton: {
    width: '100%',
    minHeight: 50,
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
  restHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 5,
    textAlign: 'center',
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
    marginTop: 12,
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
    marginVertical: 18,
  },
  outerMicCircle: {
    width: 126,
    height: 126,
    borderRadius: 63,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerMicCircle: {
    width: 94,
    height: 94,
    borderRadius: 47,
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
  recordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
    letterSpacing: 0.8,
  },
  feedbackPanel: {
    width: '100%',
    borderRadius: 17,
    paddingHorizontal: 13,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  feedbackTextContainer: {
    flex: 1,
  },
  feedbackIcon: {
  marginRight: 12,
},
  feedbackTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },
  feedbackMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginTop: 3,
  },
  soundWaveArea: {
    width: '100%',
    height: 45,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginTop: 17,
    paddingHorizontal: 3,
  },
  soundWaveBar: {
    width: 4,
    borderRadius: 4,
    backgroundColor: '#EBC4CE',
  },
  waveCaption: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
  },
  timerText: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    textAlign: 'center',
    marginTop: 20,
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
    lineHeight: 18,
    color: MUTED,
    textAlign: 'center',
    marginTop: 4,
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
    marginBottom: 12,
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
  practiceTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: WHITE,
    borderRadius: 14,
    padding: 13,
    marginTop: 16,
    gap: 10,
  },
  practiceTipText: {
    flex: 1,
  },
  practiceTipTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },
  practiceTipMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
    marginTop: 4,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  repStatusIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  repStatusPassed: {
    backgroundColor: GUIDE_GREEN,
  },
  repStatusNeedsPractice: {
    backgroundColor: GUIDE_YELLOW,
  },
  resultRowContent: {
    flex: 1,
  },
  resultRowLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },
  resultRowHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 14,
    color: MUTED,
    marginTop: 2,
    maxWidth: 220,
  },
  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginLeft: 10,
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
  recordingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    paddingHorizontal: 22,
    paddingTop: 120,
    paddingBottom: 20,
  },
  recordingBody: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 36,
  },
  repPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: PINK,
  },
  repPillText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.6,
    color: BROWN,
  },
  recordingProgressSection: {
    width: '100%',
    marginTop: 26,
    marginBottom: 20,
  },
  recordingProgressLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  progressLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: MUTED,
  },
  progressTime: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: LIGHT_PINK,
  },
  progressFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: PINK,
  },
  remainingText: {
    marginTop: 7,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'right',
  },
  liveCard: {
    marginTop: 30,
    width: '110%',
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 22,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
  },
  liveCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  liveMicCircle: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#E5F2E8',
  },
  liveCardHeading: {
    flex: 1,
    marginLeft: 10,
  },
  liveCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
  liveCardSubtitle: {
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  liveIndicatorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#FCE9EC',
  },
  recordingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: GUIDE_RED,
  },
  liveIndicatorText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.7,
    color: GUIDE_RED,
  },
  waveformContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 5,
    paddingBottom: 15,
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  waveformBars: {
    width: '100%',
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  waveformBar: {
    flex: 1,
    maxWidth: 6,
    minWidth: 2,
    borderRadius: 4,
  },
  waveformStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  waveformStatus: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    textAlign: 'center',
  },
  liveMetricsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveMetric: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  liveDivider: {
    width: 1,
    height: 52,
    backgroundColor: BORDER,
  },
  liveLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: MUTED,
    marginBottom: 5,
    textAlign: 'center',
  },
  liveValue: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
  },
  metricHint: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    textAlign: 'center',
  },
  recordingTip: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 5,
  },
  recordingTipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
  },
});