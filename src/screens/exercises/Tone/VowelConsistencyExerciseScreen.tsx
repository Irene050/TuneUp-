import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, ScrollView, Text, View } from 'react-native';

import {
    type Tier,
    VOWEL_CONSISTENCY_PARAMS,
    type VowelConsistencyParams,
} from '@/constants/params';
import {
    type LiveAudioFrame,
    useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';

import ExerciseScreen, {
    ExerciseCountdownScreen,
    type ExercisePreparationStep,
    ExercisePreparingScreen,
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

import {
    COLORS,
    EXERCISE_COUNTDOWN_SECONDS,
    EXERCISE_FFT_HOP_SIZE,
    EXERCISE_FFT_SIZE,
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { LiveToneMonitorCard } from '@/screens/exercises/Tone/LiveToneMonitorCard';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { clamp } from '@/utils/math';
import { formatNumber } from '@/utils/numberFormatting';

import {
    ExerciseNoAudioModal,
    ExerciseQuitModal,
} from '@/components/ExerciseModals';

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

function randomInRange([min, max]: [number, number]) {
  return min + Math.random() * (max - min);
}

function vowelDisplay(vowel: string) {
  return vowel.toUpperCase();
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
    ? COLORS.guideRed
    : clarity >= 0.75
      ? COLORS.guideGreen
      : clarity >= 0.45
        ? COLORS.guideYellow
        : COLORS.guideRed;

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
    <View style={exerciseStyles.waveformContainer}>
      <View
        style={exerciseStyles.waveformBars}
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
              exerciseStyles.waveformBar,
              {
                height,
                backgroundColor: waveformColor,
                opacity: hasPitch ? 0.9 : 0.45,
              },
            ]}
          />
        ))}
      </View>

      <View style={exerciseStyles.waveformStatusRow}>
        <View
          style={[
            exerciseStyles.statusDot,
            { backgroundColor: waveformColor },
          ]}
        />
        <Text
          style={[
            exerciseStyles.waveformStatus,
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
  const [isLoadingParams, setIsLoadingParams] = useState(true);
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [targetDuration, setTargetDuration] = useState(() =>
    randomInRange(params.durationRangeSec),
  );
  const [currentRep, setCurrentRep] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveAudioFrame, setLiveAudioFrame] = useState<LiveAudioFrame | null>(null);
  const [repetitionResults, setRepetitionResults] = useState<RepetitionResult[]>([]);
  const [result, setResult] =
    useState<VowelConsistencyScoreResult | null>(null);

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const repetitions = Math.max(1, params.repetitions);

  const mountedRef = useRef(true);
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

  const isRecordingRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);
  const processingRef = useRef(false);
  const elapsedRef = useRef(0);
  const currentRepRef = useRef(1);
  const targetDurationRef = useRef(targetDuration);

  const repetitionMeasurementsRef = useRef<
    Array<ReturnType<typeof measureVowelConsistency>>
  >([]);
  const repetitionResultsRef = useRef<RepetitionResult[]>([]);

  const stopRecordingRef = useRef<
    (() => Promise<void>) | null
  >(null);

  const startRepCountdownRef = useRef<(() => void) | null>(null);
  const beginRecordingRef = useRef<(() => Promise<void>) | null>(null);

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
      setIsLoadingParams(true);

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
          } catch (errorMessage) {
            console.error('Failed to load tone progress:', errorMessage);
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
          } catch (errorMessage) {
            console.error(
              'Failed to load vowel consistency history:',
              errorMessage,
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
            } catch (errorMessage) {
              console.error(
                'Failed to load latest assessment:',
                errorMessage,
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
      } catch (errorMessage) {
        console.error(
          'Failed to load adaptive vowel consistency parameters:',
          errorMessage,
        );

        if (!cancelled) {
          setCurrentTier(initialTier);
          setParams(VOWEL_CONSISTENCY_PARAMS[initialTier]);
        }
      } finally {
        if (!cancelled) setIsLoadingParams(false);
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

      isRecordingRef.current = false;
      recordingStopRequestedRef.current = true;

      try {
        void stopRecordingRef.current?.().catch(errorMessage => {
          console.error(
            'Failed to stop vowel recording during cleanup:',
            errorMessage,
          );
        });
      } catch (errorMessage) {
        console.error(
          'Failed to stop vowel recording during cleanup:',
          errorMessage,
        );
      }
    };
  }, [clearTimers]);

  useEffect(() => {
    targetDurationRef.current = targetDuration;
  }, [targetDuration]);

  useEffect(() => {
    repetitionResultsRef.current = repetitionResults;
  }, [repetitionResults]);

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

    setLiveAudioFrame(frame);
  }, []);

  const resetExercise = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    quitInProgressRef.current = false;
    discardNextStopRef.current = false;

    currentRepRef.current = 1;
    isRecordingRef.current = false;
    recordingStopRequestedRef.current = false;
    processingRef.current = false;
    elapsedRef.current = 0;
    repetitionMeasurementsRef.current = [];
    repetitionResultsRef.current = [];

    setCurrentRep(1);
    setElapsedMs(0);
    setLiveAudioFrame(null);
    setRepetitionResults([]);
    setResult(null);
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
  } = useAudioRecorder({
    onFrame: handleLiveFrame,

    onStop: async (samples, sampleRate) => {
      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        isRecordingRef.current = false;
        recordingStopRequestedRef.current = false;
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

      isRecordingRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      setPhase('processing');

      try {
        if (!hasSufficientRecordedSignal(samples)) {
          setPhase('instructions');
          setShowNoAudioModal(true);
          return;
        }

        if (sampleRate <= 0) {
          throw new Error('No usable audio was recorded.');
        }

        const fftFrames = samplesToFFTFrames(
          samples,
          EXERCISE_FFT_SIZE,
          EXERCISE_FFT_HOP_SIZE,
        );

        if (!fftFrames.length) {
          throw new Error('No FFT frames could be generated.');
        }

        const measurement = measureVowelConsistency(
          fftFrames,
          sampleRate,
          EXERCISE_FFT_SIZE,
        );



        const scored = scoreVowelConsistencyExercise(
          measurement,
          params,
        );

        repetitionMeasurementsRef.current.push(measurement);

        const nextResults = [
          ...repetitionResultsRef.current,
          {
            score: scored.score,
            passed: scored.passed,
          },
        ];

        repetitionResultsRef.current = nextResults;

        if (!mountedRef.current || quitInProgressRef.current) {
          return;
        }

        setRepetitionResults(nextResults);

        if (nextResults.length < repetitions) {
          const nextRep = nextResults.length + 1;

          currentRepRef.current = nextRep;
          setCurrentRep(nextRep);
          setLiveAudioFrame(null);
          setElapsedMs(0);
          elapsedRef.current = 0;
          setPhase('rest');

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

        setResult(finalScored);

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
          setPhase('results');
        }
      } catch (errorMessage) {
        console.error(
          'Vowel consistency processing error:',
          errorMessage,
        );

        if (
          mountedRef.current &&
          !quitInProgressRef.current
        ) {
          setErrorMessage(
            'We could not analyze this repetition. Please try again.',
          );
          setPhase('instructions');
        }
      } finally {
        processingRef.current = false;
        recordingStopRequestedRef.current = false;
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
      isRecordingRef.current ||
      processingRef.current
    ) {
      return;
    }

    try {
      setErrorMessage(null);
      setLiveAudioFrame(null);
      elapsedRef.current = 0;
      setElapsedMs(0);
      recordingStopRequestedRef.current = false;
      discardNextStopRef.current = false;
      setPhase('recording');

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

      isRecordingRef.current = true;

      const durationMs = targetDurationRef.current * 1000;
      let lastTickAt = Date.now();

      recordingTimerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsedDelta = now - lastTickAt;
        lastTickAt = now;

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          !isRecordingRef.current ||
          recordingStopRequestedRef.current
        ) {
          return;
        }

        elapsedRef.current += elapsedDelta;
        setElapsedMs(elapsedRef.current);

        if (elapsedRef.current >= durationMs) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }

          recordingStopRequestedRef.current = true;

          stopRecording().catch(errorMessage => {
            console.error(
              'Failed to stop vowel recording:',
              errorMessage,
            );

            isRecordingRef.current = false;
            recordingStopRequestedRef.current = false;

            if (mountedRef.current && !quitInProgressRef.current) {
              setErrorMessage(
                'We could not finish the recording. Please try again.',
              );
              setPhase('instructions');
            }
          });
        }
      }, 100);
    } catch (errorMessage) {
      console.error('Failed to start vowel recording:', errorMessage);

      isRecordingRef.current = false;
      recordingStopRequestedRef.current = false;

      if (
        mountedRef.current &&
        !quitInProgressRef.current &&
        !pausedRef.current
      ) {
        setPhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    }
  }, [setPhase, startRecording, stopRecording]);

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
      isRecordingRef.current
    ) {
      return;
    }

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setPhase('countdown');

    let value = EXERCISE_COUNTDOWN_SECONDS;

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
  }, [setPhase]);

  useEffect(() => {
    startRepCountdownRef.current = startRepCountdown;
  }, [startRepCountdown]);

  const startExercise = useCallback(() => {
    if (isLoadingParams || quitInProgressRef.current) return;

    resetExercise();
    startRepCountdownRef.current?.();
  }, [isLoadingParams, resetExercise]);

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
      recordingStopRequestedRef.current = true;
      isRecordingRef.current = false;
      elapsedRef.current = 0;

      setElapsedMs(0);
      setLiveAudioFrame(null);

      try {
        void stopRecordingRef.current?.().catch(errorMessage => {
          console.error(
            'Failed to stop vowel recording while paused:',
            errorMessage,
          );
        });
      } catch (errorMessage) {
        console.error(
          'Failed to stop vowel recording while paused:',
          errorMessage,
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
      isRecordingRef.current = false;
      recordingStopRequestedRef.current = false;
      discardNextStopRef.current = false;
      elapsedRef.current = 0;

      setElapsedMs(0);
      setLiveAudioFrame(null);

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

    isRecordingRef.current = false;
    recordingStopRequestedRef.current = true;
    elapsedRef.current = 0;

    try {
      await Promise.resolve(stopRecordingRef.current?.());
    } catch (errorMessage) {
      console.error(
        'Failed to stop vowel recording before leaving:',
        errorMessage,
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
    setPhase('instructions');
  }, [resetExercise, setPhase]);

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

  const quitModal = (
    <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit exercise?"}
        message={pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Vowel Consistency?'
              : pausedPhaseRef.current === 'recording'
                ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                : pausedPhaseRef.current === 'processing'
                  ? 'Your current repetition is being analyzed. You can continue to let the exercise finish or quit and return to exercises.'
                  : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => {
              void quitExercise();
            }}
        continueLabel={"Continue Exercise"}
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />
  );

  const noAudioModal = (
    <ExerciseNoAudioModal
      visible={showNoAudioModal}
      onRedo={function redoExerciseRepetition() {
        setShowNoAudioModal(false);
        setErrorMessage(null);
        startRepCountdownRef.current?.();
      }}
      onQuit={() => {
        setShowNoAudioModal(false);
        void quitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  if (isLoadingParams || !params) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level and preparing your vocal range."
          icon="options-outline"
          iconSize={44}
        />
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
          errorMessage={errorMessage ?? undefined}
          startDisabled={isLoadingParams}
        />

        {quitModal}
        {noAudioModal}
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          title="Vowel Consistency"
          icon="text-outline"
          currentRep={currentRep}
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
        <View style={exerciseStyles.centerScreenVariant1}>
          <View style={exerciseStyles.iconCircle}>
            <Ionicons
              name="pause-outline"
              size={34}
              color={COLORS.brown}
            />
          </View>

          <Text style={exerciseStyles.phaseTitleVariant1}>Take a Little Rest</Text>

          <Text style={exerciseStyles.phaseSubtitle}>
            Repetition {currentRep - 1} complete. Relax your
            voice before the next one.
          </Text>

          <Text style={exerciseStyles.largeVowel}>
            {vowelDisplay(params.vowel)}
          </Text>

          <Text style={exerciseStyles.restHint}>
            Get ready for repetition {currentRep}
          </Text>

          <ActivityIndicator
            size="small"
            color={COLORS.brown}
            style={exerciseStyles.restIndicator}
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

  const detectedPitch =
    liveAudioFrame &&
    Number.isFinite(liveAudioFrame.pitch) &&
    liveAudioFrame.pitch > 0
      ? `${formatNumber(liveAudioFrame.pitch, 1)} Hz`
      : '--';

  const voiceClarity =
    liveAudioFrame && Number.isFinite(liveAudioFrame.clarity)
      ? `${formatNumber(
          clamp(liveAudioFrame.clarity * 100, 0, 100),
          0,
        )}%`
      : '--';

  return (
    <>
      <View style={exerciseStyles.recordingScreenVariant5}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={exerciseStyles.recordingBody}
        >

          <Text style={exerciseStyles.recordingTitleVariant5}>
            Keep the Vowel Consistent
          </Text>

          <Text style={exerciseStyles.repText}>
              Repetition {currentRep} of {repetitions}
            </Text>

          <LiveToneMonitorCard>


            <VowelLiveWaveform frame={liveAudioFrame} />

            <View style={exerciseStyles.liveMetricsRow}>
              <View style={exerciseStyles.liveMetric}>
                <Text style={exerciseStyles.liveLabelVariant2}>TARGET VOWEL</Text>
                <Text style={exerciseStyles.liveValueVariant1}>
                  {vowelDisplay(params.vowel)}
                </Text>
                <Text style={exerciseStyles.metricHint}>
                  Keep the sound consistent
                </Text>
              </View>

              <View style={exerciseStyles.liveDivider} />

              <View style={exerciseStyles.liveMetric}>
                <Text style={exerciseStyles.liveLabelVariant2}>VOICE CLARITY</Text>
                <Text style={exerciseStyles.liveValueVariant1}>
                  {voiceClarity}
                </Text>
                <Text style={exerciseStyles.metricHint}>
                  {detectedPitch}
                </Text>
              </View>
            </View>
          </LiveToneMonitorCard>

          <View style={exerciseStyles.recordingProgressSection}>
            <View style={exerciseStyles.recordingProgressLabels}>
              <Text style={exerciseStyles.progressLabel}>RECORDING</Text>
            </View>

            <View
              style={exerciseStyles.progressTrackVariant1}
              accessibilityRole="progressbar"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round(recordingProgress * 100),
              }}
            >
              <View
                style={[
                  exerciseStyles.progressFill,
                  { width: `${recordingProgress * 100}%` },
                ]}
              />
            </View>

          </View>
        </ScrollView>
      </View>

      {quitModal}
    </>
  );
}

  if (phase === 'processing') {
    const isFinalRep = currentRep >= repetitions;

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
              : `Checking repetition ${currentRep}. Just a moment!`
          }
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'results' && result) {
    return (
      <>
        <View style={exerciseStyles.screen}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={exerciseStyles.resultsContentVariant3}
          >
            <View
              style={[
                exerciseStyles.resultIcon,
                result.passed
                  ? exerciseStyles.resultIconPassed
                  : exerciseStyles.resultIconFailed,
              ]}
            >
              <Ionicons
                name={
                  result.passed
                    ? 'checkmark-circle-outline'
                    : 'refresh-outline'
                }
                size={42}
                color={COLORS.brown}
              />
            </View>

            <Text style={exerciseStyles.resultTitle}>
              {result.passed
                ? 'Great Job!'
                : 'Keep Practicing!'}
            </Text>

            <Text style={exerciseStyles.resultSubtitleVariant2}>
              You finished your Vowel Consistency exercise
            </Text>

            <View style={exerciseStyles.scoreCard}>
              <Text style={exerciseStyles.scoreLabel}>
                YOUR OVERALL SCORE
              </Text>

              <Text style={exerciseStyles.scoreValue}>
                {result.score}%
              </Text>

              <Text style={exerciseStyles.scoreDescription}>
                {result.passed
                  ? 'Well done! Your results met the exercise target. Keep practicing to build an even steadier sound.'
                  : 'You’re making progress. Try holding the same vowel shape and sound from beginning to end.'}
              </Text>
            </View>

            <View style={exerciseStyles.resultCard}>
              <Text style={exerciseStyles.resultCardTitle}>
                Your Practice
              </Text>

              <View style={exerciseStyles.resultDetailRow}>
                <View>
                  <Text style={exerciseStyles.scaleText}>
                    TARGET VOWEL
                  </Text>

                  <Text style={exerciseStyles.resultTargetLarge}>
                    {vowelDisplay(params.vowel)}
                  </Text>
                </View>

                <View style={exerciseStyles.targetBadge}>
                  <Text style={exerciseStyles.volumeGuideText}>
                    {repetitionResults.length} of {repetitions} reps
                  </Text>
                </View>
              </View>

              <View style={exerciseStyles.practiceTip}>
                <Ionicons
                  name="bulb-outline"
                  size={22}
                  color={COLORS.brown}
                />

                <View style={exerciseStyles.infoText}>
                  <Text style={exerciseStyles.scoreRowValue}>
                    What to focus on next
                  </Text>
                </View>
              </View>
            </View>

            <View style={exerciseStyles.resultCard}>
              <Text style={exerciseStyles.resultCardTitle}>
                How You Did Each Time
              </Text>

              {repetitionResults.map((item, index) => (
                <View
                  style={exerciseStyles.resultRowVariant2}
                  key={`rep-${index}`}
                >
                  <View
                    style={[
                      exerciseStyles.repStatusIcon,
                      item.passed
                        ? exerciseStyles.repStatusPassed
                        : exerciseStyles.repStatusNeedsPractice,
                    ]}
                  >
                    <Ionicons
                      name={
                        item.passed
                          ? 'checkmark'
                          : 'refresh-outline'
                      }
                      size={17}
                      color={COLORS.brown}
                    />
                  </View>

                  <View style={exerciseStyles.infoText}>
                    <Text style={exerciseStyles.scoreRowValue}>
                      Repetition {index + 1}
                    </Text>

                    <Text style={exerciseStyles.resultRowHint}>
                      {item.passed
                        ? 'Exercise target reached'
                        : 'Keep practicing this vowel'}
                    </Text>
                  </View>

                  <Text style={exerciseStyles.resultRowValueVariant2}>
                    {item.score}%
                  </Text>
                </View>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [
                exerciseStyles.startButtonVariant6,
                pressed && exerciseStyles.buttonPressed,
              ]}
              onPress={retry}
              accessibilityRole="button"
            >
              <Text style={exerciseStyles.startButtonText}>
                Try Again
              </Text>

              <Ionicons
                name="refresh"
                size={18}
                color={COLORS.white}
              />
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                exerciseStyles.secondaryButton,
                pressed && exerciseStyles.buttonPressed,
              ]}
              onPress={goBack}
              accessibilityRole="button"
            >
              <Text style={exerciseStyles.componentScore}>
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
