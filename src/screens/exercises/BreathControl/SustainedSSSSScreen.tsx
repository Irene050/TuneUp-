
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
} from '@/constants/appConstants';
import type {
  SustainedExhaleParams,
  Tier,
} from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseNoAudioModal,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseQuitModal,
  ExerciseResultsScreen,
  MetricCard,
} from '@/screens/exercises/ExerciseScreen';

import {
  generateSustainedSSSSParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';

import {
  measureSustainedSSSS,
  type SustainedSSSSMeasurement,
} from '@/services/measurement/breathControl/sustainedSSSS';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  scoreSustainedSSSS,
  type SustainedSSSSScoreResult,
} from '@/services/scoring/breathControl/sustainedSSSS';

import {
  hasSufficientRecordedSignal,
} from '@/utils/audioSignal';

const PROCESSING_DELAY_MS = 1200;

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

interface RepResult {
  rep: number;
  measurement: SustainedSSSSMeasurement;
  score: SustainedSSSSScoreResult;
}

interface Props {
  tier?: Tier;
}

export default function SustainedSSSSScreen({
  tier: initialTier,
}: Props) {

  const [tier, setTier] = useState<Tier | null>(
    initialTier ?? null,
  );

  const [params, setParams] =
    useState<SustainedExhaleParams | null>(null);

  const [loadingParams, setLoadingParams] = useState(true);
  const [phase, setPhase] = useState<Phase>('instructions');
  const [currentRep, setCurrentRep] = useState(1);

  const [countdown, setCountdown] = useState(
    EXERCISE_COUNTDOWN_SECONDS,
  );

  const [elapsed, setElapsed] = useState(0);
  const [volume, setVolume] = useState<number | null>(null);
  const [repResults, setRepResults] = useState<RepResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

  const paramsRef = useRef<SustainedExhaleParams | null>(null);

  const tierRef = useRef<Tier | null>(
    initialTier ?? null,
  );

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const processingTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const repResultsRef = useRef<RepResult[]>([]);
  const currentRepRef = useRef(1);
  const phaseRef = useRef<Phase>('instructions');
  const pausedPhaseRef = useRef<Phase>('instructions');
  const pendingProcessingRef = useRef(false);
  const pendingFinalRepRef = useRef(false);
  const saveInProgressRef = useRef(false);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const stopRecordingRef =
    useRef<(() => void) | null>(null);

  const beginCountdownRef =
    useRef<(() => void) | null>(null);

  const finishProcessingRef =
    useRef<(() => void) | null>(null);

  const updatePhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const setQuitModalVisible = useCallback(
    (visible: boolean) => {
      showQuitModalRef.current = visible;
      setShowQuitModal(visible);
    },
    [],
  );

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (processingTimerRef.current) {
      clearTimeout(processingTimerRef.current);
      processingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initializeAdaptiveExercise() {
      try {
        setLoadingParams(true);

        let currentTier: Tier = initialTier ?? 'beginner';

        const user = auth.currentUser;

        if (!initialTier && user) {
          const progress = await fetchComponentProgress(
            user.uid,
            'breathControl',
          );

          currentTier = progress?.currentTier ?? 'beginner';
        }

        if (cancelled) return;

        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'breathControl',
          );

          if (cancelled) return;

          const matchingRecords = records.filter(
            record =>
              record.templateId === 'sustainedSSSS' &&
              record.tier === currentTier,
          );

          recentScores = matchingRecords
            .slice(-5)
            .map(record => record.scorePct);

          if (recentScores.length === 0) {
            const assessment = await getLatestAssessment();

            if (cancelled) return;

            const assessmentScore = assessment?.scores.find(
              score => score.componentId === 'breathControl',
            )?.scorePct;

            if (typeof assessmentScore === 'number') {
              recentScores = [assessmentScore];
            }
          }
        }

        if (cancelled) return;

        const generatedParams = generateSustainedSSSSParams({
          tier: currentTier,
          recentScores,
        });

        if (cancelled) return;

        paramsRef.current = generatedParams;
        tierRef.current = currentTier;

        setParams(generatedParams);
        setTier(currentTier);
      } catch (initializationError) {
        console.error(
          'Failed to initialize Sustained SSSS exercise:',
          initializationError,
        );

        if (cancelled) return;

        const fallbackTier: Tier = initialTier ?? 'beginner';

        const fallbackParams = generateSustainedSSSSParams({
          tier: fallbackTier,
          recentScores: [],
        });

        paramsRef.current = fallbackParams;
        tierRef.current = fallbackTier;

        setParams(fallbackParams);
        setTier(fallbackTier);
      } finally {
        if (!cancelled) {
          setLoadingParams(false);
        }
      }
    }

    void initializeAdaptiveExercise();

    return () => {
      cancelled = true;
    };
  }, [initialTier]);

  const handleLiveFrame = useCallback(
    (frame: { volume: number }) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      setVolume(frame.volume);
    },
    [],
  );

  const finishProcessing = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      quitInProgressRef.current ||
      !pendingProcessingRef.current
    ) {
      return;
    }

    if (pendingFinalRepRef.current) {
      if (saveInProgressRef.current) return;

      saveInProgressRef.current = true;

      const finalResults = [...repResultsRef.current];

      const currentTier = tierRef.current;

      const finalScore =
        finalResults.length > 0
          ? Math.round(
              finalResults.reduce(
                (sum, item) => sum + item.score.score,
                0,
              ) / finalResults.length,
            )
          : 0;

      const saveResults = async () => {
        try {
          if (currentTier) {
            await saveCompletedExercise(
              'breathControl',
              'sustainedSSSS',
              currentTier,
              finalScore,
            );
          }
        } catch (saveError) {
          console.error(
            'Failed to save Sustained SSSS progress:',
            saveError,
          );
        } finally {
          saveInProgressRef.current = false;
        }

        if (
          !mountedRef.current ||
          pausedRef.current ||
          quitInProgressRef.current
        ) {
          return;
        }

        pendingProcessingRef.current = false;
        pendingFinalRepRef.current = false;

        setRepResults(finalResults);

        updatePhase('results');

        startingRef.current = false;
        finishingRef.current = false;
      };

      void saveResults();

      return;
    }

    pendingProcessingRef.current = false;
    pendingFinalRepRef.current = false;

    const nextRep = currentRepRef.current + 1;

    currentRepRef.current = nextRep;

    setCurrentRep(nextRep);
    setElapsed(0);
    setVolume(null);

    startingRef.current = false;
    finishingRef.current = false;

    beginCountdownRef.current?.();
  }, [updatePhase]);

  useEffect(() => {
    finishProcessingRef.current = finishProcessing;
  }, [finishProcessing]);

  const scheduleProcessingCompletion = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      quitInProgressRef.current ||
      !pendingProcessingRef.current
    ) {
      return;
    }

    if (processingTimerRef.current) {
      clearTimeout(processingTimerRef.current);
    }

    processingTimerRef.current = setTimeout(() => {
      processingTimerRef.current = null;
      finishProcessingRef.current?.();
    }, PROCESSING_DELAY_MS);
  }, []);

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (!mountedRef.current) return;

      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;

        startingRef.current = false;
        finishingRef.current = false;

        return;
      }

      if (
        pausedRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      clearTimers();

      updatePhase('processing');

      setVolume(null);

      startingRef.current = false;
      finishingRef.current = false;

      const adaptiveParams = paramsRef.current;
      const currentTier = tierRef.current;

      if (!adaptiveParams || !currentTier) {
        setError(
          'Exercise parameters are unavailable. Please try again.',
        );

        updatePhase('instructions');
        return;
      }

      if (!hasSufficientRecordedSignal(samples)) {
        updatePhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      try {
        const measurement = measureSustainedSSSS(
          samples,
          adaptiveParams.detectionThreshold,
          sampleRate,
        );

        const score = scoreSustainedSSSS(
          measurement,
          adaptiveParams,
        );

        const result: RepResult = {
          rep: currentRepRef.current,
          measurement,
          score,
        };

        const updatedResults = [
          ...repResultsRef.current,
          result,
        ];

        repResultsRef.current = updatedResults;

        setRepResults(updatedResults);

        pendingProcessingRef.current = true;

        pendingFinalRepRef.current =
          currentRepRef.current >= adaptiveParams.repetitions;

        scheduleProcessingCompletion();
      } catch (analysisError) {
        console.error(
          'Sustained SSSS analysis failed:',
          analysisError,
        );

        if (!mountedRef.current) return;

        clearTimers();

        setError(
          'We could not analyze your recording. Please try again.',
        );

        updatePhase('instructions');

        startingRef.current = false;
        finishingRef.current = false;
      }
    },
    [
      clearTimers,
      scheduleProcessingCompletion,
      updatePhase,
    ],
  );

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    analyzePitch: false,
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const startRecordingPhase = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      quitInProgressRef.current ||
      startingRef.current
    ) {
      return;
    }

    const adaptiveParams = paramsRef.current;

    if (!adaptiveParams) {
      setError(
        'Exercise parameters are not ready. Please try again.',
      );

      updatePhase('instructions');
      return;
    }

    const start = startRecordingRef.current;
    const stop = stopRecordingRef.current;

    if (!start || !stop) {
      setError(
        'Audio recorder is not ready. Please try again.',
      );

      updatePhase('instructions');
      return;
    }

    startingRef.current = true;
    finishingRef.current = false;

    clearTimers();

    setElapsed(0);
    setVolume(null);
    setError(null);

    updatePhase('recording');

    try {
      discardNextStopRef.current = false;

      await start();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitInProgressRef.current
      ) {
        stop();
        return;
      }

      const startTime = Date.now();

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          quitInProgressRef.current ||
          finishingRef.current ||
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        const seconds = (Date.now() - startTime) / 1000;

        setElapsed(seconds);

        if (
          seconds >= adaptiveParams.durationRangeSec[1]
        ) {
          clearTimers();

          if (!finishingRef.current) {
            finishingRef.current = true;
            stop();
          }
        }
      }, 100);
    } catch (recordingError) {
      console.error(
        'Failed to start Sustained SSSS recording:',
        recordingError,
      );

      if (
        !mountedRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      clearTimers();

      setError(
        'Microphone access or recording failed. Please try again.',
      );

      updatePhase('instructions');

      startingRef.current = false;
      finishingRef.current = false;
    }
  }, [clearTimers, updatePhase]);

  const beginCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      quitInProgressRef.current ||
      startingRef.current
    ) {
      return;
    }

    clearTimers();

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);

    setElapsed(0);
    setVolume(null);

    updatePhase('countdown');

    let value = EXERCISE_COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
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

        void startRecordingPhase();

        return;
      }

      setCountdown(value);
    }, 1000);
  }, [clearTimers, startRecordingPhase, updatePhase]);

  useEffect(() => {
    beginCountdownRef.current = beginCountdown;
  }, [beginCountdown]);

  const startExercise = useCallback(() => {
    if (
      startingRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    if (!paramsRef.current || !tierRef.current) {
      setError(
        'Exercise parameters are still loading. Please try again.',
      );

      return;
    }

    pausedRef.current = false;
    quitInProgressRef.current = false;

    setIsQuitting(false);
    setQuitModalVisible(false);

    discardNextStopRef.current = false;

    pendingProcessingRef.current = false;
    pendingFinalRepRef.current = false;
    saveInProgressRef.current = false;

    clearTimers();

    startingRef.current = false;
    finishingRef.current = false;

    repResultsRef.current = [];
    currentRepRef.current = 1;

    setRepResults([]);
    setCurrentRep(1);

    setElapsed(0);
    setVolume(null);
    setError(null);

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);

    beginCountdown();
  }, [
    beginCountdown,
    clearTimers,
    setQuitModalVisible,
  ]);

  const openQuitModal = useCallback(() => {
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

    clearTimers();

    if (
      currentPhase === 'instructions' ||
      currentPhase === 'results'
    ) {
      setQuitModalVisible(true);
      return;
    }

    setVolume(null);

    if (currentPhase === 'recording') {
      discardNextStopRef.current = true;

      startingRef.current = false;
      finishingRef.current = true;

      stopRecordingRef.current?.();

      setElapsed(0);
    } else if (currentPhase === 'countdown') {
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    }

    setQuitModalVisible(true);
  }, [clearTimers, setQuitModalVisible]);

  const continueExercise = useCallback(() => {
    if (
      !mountedRef.current ||
      quitInProgressRef.current ||
      !showQuitModalRef.current
    ) {
      return;
    }

    setQuitModalVisible(false);

    pausedRef.current = false;

    const previousPhase = pausedPhaseRef.current;

    if (previousPhase === 'recording') {
      startingRef.current = false;
      finishingRef.current = false;

      setElapsed(0);
      setVolume(null);

      setCountdown(EXERCISE_COUNTDOWN_SECONDS);

      beginCountdownRef.current?.();

      return;
    }

    if (previousPhase === 'countdown') {
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);

      beginCountdownRef.current?.();

      return;
    }

    if (previousPhase === 'processing') {
      if (pendingProcessingRef.current) {
        scheduleProcessingCompletion();
      } else {
        startingRef.current = false;
        finishingRef.current = false;

        setElapsed(0);
        setCountdown(EXERCISE_COUNTDOWN_SECONDS);

        beginCountdownRef.current?.();
      }
    }
  }, [
    scheduleProcessingCompletion,
    setQuitModalVisible,
  ]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;

    pausedRef.current = true;

    setIsQuitting(true);

    setQuitModalVisible(false);

    clearTimers();

    startingRef.current = false;
    finishingRef.current = true;

    discardNextStopRef.current = true;

    try {
      await Promise.resolve(
        stopRecordingRef.current?.(),
      );
    } catch (recordingError) {
      console.error(
        'Failed to stop Sustained SSSS before leaving:',
        recordingError,
      );
    } finally {
      if (mountedRef.current) {
        router.replace('/exercises/breath-control');
      }
    }
  }, [clearTimers, setQuitModalVisible]);

  const goBack = useCallback(() => {
    openQuitModal();
  }, [openQuitModal]);

  const retryExercise = useCallback(() => {
    pausedRef.current = false;
    quitInProgressRef.current = false;

    setIsQuitting(false);
    setQuitModalVisible(false);

    clearTimers();

    discardNextStopRef.current = true;

    stopRecordingRef.current?.();

    startingRef.current = false;
    finishingRef.current = false;

    pendingProcessingRef.current = false;
    pendingFinalRepRef.current = false;
    saveInProgressRef.current = false;

    repResultsRef.current = [];
    currentRepRef.current = 1;

    setRepResults([]);
    setCurrentRep(1);

    setElapsed(0);
    setVolume(null);
    setError(null);

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);

    updatePhase('instructions');
  }, [
    clearTimers,
    setQuitModalVisible,
    updatePhase,
  ]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (
          showQuitModalRef.current ||
          showNoAudioModal
        ) {
          return true;
        }

        openQuitModal();

        return true;
      },
    );

    return () => subscription.remove();
  }, [openQuitModal, showNoAudioModal]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      pausedRef.current = true;

      clearTimers();

      stopRecordingRef.current?.();
    };
  }, [clearTimers]);

  const quitMessage =
    pausedPhaseRef.current === 'instructions' ||
    pausedPhaseRef.current === 'results'
      ? 'Are you sure you want to leave Sustained "SSSS"?'
      : pausedPhaseRef.current === 'recording'
        ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
        : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.';

  const quitModal = (
    <ExerciseQuitModal
      visible={showQuitModal}
      title="Quit exercise?"
      message={quitMessage}
      isQuitting={isQuitting}
      onContinue={continueExercise}
      onQuit={() => {
        void quitExercise();
      }}
      continueLabel="Continue Exercise"
      quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
    />
  );

  const noAudioModal = (
    <ExerciseNoAudioModal
      visible={showNoAudioModal}
      onRedo={() => {
        setShowNoAudioModal(false);

        startingRef.current = false;
        finishingRef.current = false;

        pausedRef.current = false;
        quitInProgressRef.current = false;

        beginCountdownRef.current?.();
      }}
      onQuit={() => {
        setShowNoAudioModal(false);

        void quitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  if (loadingParams || !params || !tier) {
    return (
      <>
        {quitModal}
        {noAudioModal}

        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level."
          icon="options-outline"
          iconSize={44}
          containerStyle={styles.centerScreen}
        />
      </>
    );
  }

  const averageDuration =
    repResults.length > 0
      ? repResults.reduce(
          (sum, item) =>
            sum + item.measurement.actualDurationSec,
          0,
        ) / repResults.length
      : 0;

  const averageConsistency =
    repResults.length > 0
      ? repResults.reduce(
          (sum, item) =>
            sum + item.measurement.consistencyPct,
          0,
        ) / repResults.length
      : 0;

  const averageScore =
    repResults.length > 0
      ? Math.round(
          repResults.reduce(
            (sum, item) => sum + item.score.score,
            0,
          ) / repResults.length,
        )
      : 0;

  const passedReps = repResults.filter(
    item => item.score.passed,
  ).length;

  const maxDuration = params.durationRangeSec[1];

  const durationProgress = Math.min(
    elapsed / maxDuration,
    1,
  );

  const targetDuration =
    (params.durationRangeSec[0] +
      params.durationRangeSec[1]) / 2;

  if (phase === 'instructions') {
    return (
      <>
        {quitModal}
        {noAudioModal}

        <ExerciseScreen
          category="Breath Control"
          title={'Sustained "SSSS"'}
          icon="cloud-outline"
          instructions={'Take a comfortable breath, then release the air through your teeth using a steady "ssss" hissing sound.'}
          preparationSteps={[
            {
              icon: 'leaf-outline',
              text: 'Sit or stand with a relaxed posture.',
            },
            {
              icon: 'body-outline',
              text: 'Take a comfortable breath without overfilling your lungs.',
            },
            {
              icon: 'volume-low-outline',
              text: 'Release the air using a continuous "ssss" sound.',
            },
            {
              icon: 'mic-outline',
              text: 'Keep the sound steady and stay close to the microphone.',
            },
          ]}
          targetValue={`${params.durationRangeSec[0]} → ${params.durationRangeSec[1]} sec`}
          targetHint={'sustained "ssss"'}
          repetitions={params.repetitions}
          tip={'Focus on keeping the "ssss" sound smooth and consistent instead of forcing a burst of air.'}
          tier={tier}
          error={error}
          onBack={goBack}
          onStart={startExercise}
        />
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        {quitModal}
        {noAudioModal}

        <ExerciseCountdownScreen
          icon="cloud-outline"
          title="Get Ready"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Prepare to make a steady SSSS sound"
          prompt="Keep the hiss smooth and continuous."
          onBack={goBack}
        />
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <View style={styles.container}>
        {quitModal}
        {noAudioModal}

        <ScrollView
          contentContainerStyle={styles.recordingContent}
          showsVerticalScrollIndicator={false}
        >

          <View style={styles.recordingHeader}>
            <Text style={styles.recordingTitle}>
              Sustain "SSSS"
            </Text>

            <Text style={styles.repLabel}>
              Repetition {currentRep} of {params.repetitions}
            </Text>
          </View>

          <View style={styles.recordingVisual}>
            <View
              style={[
                styles.recordingOuterCircle,
                {
                  transform: [
                    {
                      scale: 1 + durationProgress * 0.08,
                    },
                  ],
                },
              ]}
            >
              <View style={styles.recordingInnerCircle}>
                <Ionicons
                  name="mic"
                  size={52}
                  color={COLORS.brown}
                />
              </View>
            </View>
          </View>

          <View style={styles.recordingBadge}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingBadgeText}>
              RECORDING
            </Text>
          </View>

          <Text style={styles.timerText}>
            {elapsed.toFixed(1)}s
          </Text>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${durationProgress * 100}%` },
              ]}
            />
          </View>

          <View style={styles.rangeRow}>
            <Text style={styles.rangeText}>
              {params.durationRangeSec[0]}s
            </Text>

            <Text style={styles.rangeTarget}>
              Target: {targetDuration.toFixed(1)}s
            </Text>

            <Text style={styles.rangeText}>
              {params.durationRangeSec[1]}s
            </Text>
          </View>

          <View style={styles.liveCard}>
            <View style={styles.liveIconCircle}>
              <Ionicons
                name="water-outline"
                size={24}
                color={COLORS.brown}
              />
            </View>

            <View style={styles.liveTextContainer}>
              <Text style={styles.liveLabel}>
                RELATIVE MIC LEVEL
              </Text>

              <Text style={styles.liveValue}>
                {volume !== null
                  ? volume.toFixed(2)
                  : 'Listening...'}
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'processing') {
    const isFinalRep = currentRep >= params.repetitions;

    return (
      <>
        {quitModal}
        {noAudioModal}

        <ExerciseProcessingScreen
          icon="analytics-outline"
          title={
            isFinalRep
              ? 'Analyzing Your Results'
              : 'Analyzing Your Hissing Sound'
          }
          message={
            isFinalRep
              ? 'Calculating your overall breath control score'
              : `Processing repetition ${currentRep}`
          }
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pause exercise"
          style={styles.processingPauseButton}
          onPress={openQuitModal}
        >
          <Ionicons
            name="pause-circle-outline"
            size={25}
            color={COLORS.brown}
          />

          <Text style={styles.processingPauseText}>
            Pause
          </Text>
        </Pressable>
      </>
    );
  }

  return (
    <>
      {quitModal}
      {noAudioModal}

      <ExerciseResultsScreen
        title="Exercise Complete"
        subtitle={'Sustained "SSSS"'}
        score={averageScore}
        resultIcon="checkmark"
        scoreDetails={
          <View style={styles.scoreBar}>
            <View
              style={[
                styles.scoreBarFill,
                {
                  width: `${averageScore}%`,
                },
              ]}
            />
          </View>
        }
        onRetry={retryExercise}
        onExit={goBack}
      >
        <View style={styles.resultsContent}>
          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>
              Your Performance
            </Text>

            <View style={styles.metricsGrid}>
              <MetricCard
                variant="breathControl"
                icon="time-outline"
                label="Avg. Duration"
                value={`${averageDuration.toFixed(1)}s`}
              />

              <MetricCard
                variant="breathControl"
                icon="pulse-outline"
                label="Consistency"
                value={`${Math.round(averageConsistency)}%`}
              />

              <MetricCard
                variant="breathControl"
                icon="repeat-outline"
                label="Repetitions"
                value={`${repResults.length}/${params.repetitions}`}
              />

              <MetricCard
                variant="breathControl"
                icon="checkmark-circle-outline"
                label="Passed"
                value={`${passedReps}/${repResults.length}`}
              />
            </View>
          </View>

          <View style={styles.repResultsCard}>
            <Text style={styles.sectionTitle}>
              Repetition Results
            </Text>

            {repResults.map(result => (
              <View
                key={`rep-${result.rep}`}
                style={styles.repResultRow}
              >
                <View
                  style={[
                    styles.repNumber,
                    result.score.passed &&
                      styles.repNumberPassed,
                  ]}
                >
                  <Text style={styles.repNumberText}>
                    {result.rep}
                  </Text>
                </View>

                <View style={styles.repResultInfo}>
                  <Text style={styles.repResultTitle}>
                    Repetition {result.rep}
                  </Text>

                  <Text style={styles.repResultDetails}>
                    {result.measurement.actualDurationSec.toFixed(1)}
                    s
                    {' • '}
                    {Math.round(
                      result.measurement.consistencyPct,
                    )}
                    % consistency
                  </Text>
                </View>

                <View style={styles.repScoreContainer}>
                  <Text style={styles.repResultScore}>
                    {result.score.score}
                  </Text>

                  <Text style={styles.repScorePercent}>
                    %
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.feedbackCard}>
            <Ionicons
              name="bulb-outline"
              size={23}
              color={COLORS.brown}
            />

            <View style={styles.feedbackContent}>
              <Text style={styles.feedbackTitle}>
                Feedback
              </Text>

              <Text style={styles.feedbackText}>
                {averageScore >= 85
                  ? 'Excellent control! Your SSSS sound was sustained with strong consistency.'
                  : averageScore >= 70
                    ? 'Good work! Focus on keeping your airflow even throughout the entire sound.'
                    : averageScore >= 50
                      ? 'Keep practicing. Try to maintain a smoother and more consistent SSSS sound.'
                      : 'Keep practicing your breath control. Focus on a steady stream of air and a continuous SSSS sound.'}
              </Text>
            </View>
          </View>
        </View>
      </ExerciseResultsScreen>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  centerScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  recordingContent: {
    paddingHorizontal: 24,
    paddingTop: 76,
    paddingBottom: 40,
  },
  recordingHeader: {
    alignItems: 'center',
  },
  repLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: COLORS.muted,
    letterSpacing: 0.7,
  },
  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 29,
    color: COLORS.brown,
    marginTop: 7,
  },
  recordingVisual: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 48,
  },
  recordingOuterCircle: {
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingInnerCircle: {
    width: 135,
    height: 135,
    borderRadius: 68,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBadge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 15,
    marginTop: 24,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.brown,
    marginRight: 7,
  },
  recordingBadgeText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: COLORS.brown,
    letterSpacing: 0.5,
  },
  timerText: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: COLORS.brown,
    textAlign: 'center',
    marginTop: 14,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.lightGray,
    overflow: 'hidden',
    marginTop: 18,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.pink,
    borderRadius: 5,
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  rangeText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
  },
  rangeTarget: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: COLORS.brown,
  },
  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 18,
    padding: 16,
    marginTop: 28,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  liveIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveTextContainer: {
    marginLeft: 13,
  },
  liveLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 0.5,
  },
  liveValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: COLORS.brown,
    marginTop: 2,
  },
  processingPauseButton: {
    position: 'absolute',
    right: 22,
    top: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  processingPauseText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: COLORS.brown,
    marginLeft: 5,
  },
  resultsContent: {
    flex: 1,
  },
  sectionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: COLORS.brown,
    marginBottom: 12,
  },
  summaryCard: {
    backgroundColor: COLORS.white,
    marginTop: 22,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  scoreBar: {
    width: '100%',
    height: 10,
    backgroundColor: COLORS.white,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 17,
  },
  scoreBarFill: {
    height: '100%',
    backgroundColor: COLORS.pink,
    borderRadius: 5,
  },
  repResultsCard: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 18,
    marginTop: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  repResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  repNumber: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repNumberPassed: {
    backgroundColor: COLORS.pink,
  },
  repNumberText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  repResultInfo: {
    flex: 1,
    marginLeft: 11,
  },
  repResultTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  repResultDetails: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 2,
  },
  repScoreContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  repResultScore: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: COLORS.brown,
  },
  repScorePercent: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    marginLeft: 1,
  },
  feedbackCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.pink,
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
  },
  feedbackContent: {
    flex: 1,
    marginLeft: 11,
  },
  feedbackTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  feedbackText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.brown,
    marginTop: 4,
  },
});