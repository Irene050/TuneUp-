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
    BackHandler,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import type {
    SustainedExhaleParams,
    Tier,
} from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
    ExerciseCountdownScreen,
    ExerciseProcessingScreen,
    ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateSustainedSSSSParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import {
    measureSustainedSSSS,
    type SustainedSSSSMeasurement,
} from '@/services/measurement/breathControl/sustainedSSSS';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
    fetchComponentProgress,
    fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
    scoreSustainedSSSS,
    type SustainedSSSSScoreResult,
} from '@/services/scoring/breathControl/sustainedSSSS';

import { COLORS } from '@/constants/appConstants';

const PREPARATION_COUNTDOWN = 3;
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
    PREPARATION_COUNTDOWN,
  );
  const [volume, setVolume] = useState<number | null>(null);
  const [repResults, setRepResults] = useState<RepResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const paramsRef = useRef<SustainedExhaleParams | null>(null);
  const tierRef = useRef<Tier | null>(initialTier ?? null);

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
  const quittingRef = useRef(false);
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
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const beginCountdownRef = useRef<(() => void) | null>(null);
  const finishProcessingRef = useRef<(() => void) | null>(null);

  const updatePhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const setQuitModalVisible = useCallback((visible: boolean) => {
    showQuitModalRef.current = visible;
    setShowQuitModal(visible);
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

        if (cancelled) {
          return;
        }

        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'breathControl',
          );

          const currentExerciseRecords = records.filter(
            record =>
              record.templateId === 'sustainedSSSS' &&
              record.tier === currentTier,
          );

          recentScores = currentExerciseRecords
            .slice(-5)
            .map(record => record.scorePct);

          if (recentScores.length === 0) {
            const assessment = await getLatestAssessment();

            const assessmentScore = assessment?.scores.find(
              score => score.componentId === 'breathControl',
            )?.scorePct;

            if (typeof assessmentScore === 'number') {
              recentScores = [assessmentScore];
            }
          }
        }

        if (cancelled) {
          return;
        }

        const generatedParams = generateSustainedSSSSParams({
          tier: currentTier,
          recentScores,
        });

        if (cancelled) {
          return;
        }

        setTier(currentTier);
        setParams(generatedParams);

        tierRef.current = currentTier;
        paramsRef.current = generatedParams;
      } catch (initializationError) {
        console.error(
          'Failed to initialize Sustained SSSS exercise:',
          initializationError,
        );

        if (!cancelled) {
          const fallbackTier: Tier = initialTier ?? 'beginner';
          const fallbackParams = generateSustainedSSSSParams({
            tier: fallbackTier,
            recentScores: [],
          });

          setTier(fallbackTier);
          setParams(fallbackParams);

          tierRef.current = fallbackTier;
          paramsRef.current = fallbackParams;
        }
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

  const handleLiveFrame = useCallback(
    (frame: { volume: number }) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        quittingRef.current ||
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
      quittingRef.current ||
      !pendingProcessingRef.current
    ) {
      return;
    }

    if (pendingFinalRepRef.current) {
      if (saveInProgressRef.current) {
        return;
      }

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
          quittingRef.current
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
      quittingRef.current ||
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
      if (!mountedRef.current) {
        return;
      }

      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        startingRef.current = false;
        finishingRef.current = false;
        return;
      }

      if (pausedRef.current || quittingRef.current) {
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

        if (!mountedRef.current) {
          return;
        }

        clearTimers();

        setError(
          'We could not analyze your recording. Please try again.',
        );
        updatePhase('instructions');

        startingRef.current = false;
        finishingRef.current = false;
      }
    },
    [clearTimers, scheduleProcessingCompletion, updatePhase],
  );

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
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
      quittingRef.current ||
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
        quittingRef.current
      ) {
        stop();
        return;
      }

      const startTime = Date.now();

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          quittingRef.current ||
          finishingRef.current
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

      if (!mountedRef.current || quittingRef.current) {
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
      quittingRef.current ||
      startingRef.current
    ) {
      return;
    }

    clearTimers();

    setCountdown(PREPARATION_COUNTDOWN);
    updatePhase('countdown');

    let value = PREPARATION_COUNTDOWN;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        quittingRef.current
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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      clearTimers();
      stopRecordingRef.current?.();
    };
  }, [clearTimers]);

  const startExercise = useCallback(() => {
    if (startingRef.current || quittingRef.current) {
      return;
    }

    if (!paramsRef.current || !tierRef.current) {
      setError(
        'Exercise parameters are still loading. Please try again.',
      );
      return;
    }

    pausedRef.current = false;
    quittingRef.current = false;
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
    setCountdown(PREPARATION_COUNTDOWN);

    beginCountdown();
  }, [beginCountdown, clearTimers, setQuitModalVisible]);

  const finishRecording = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      quittingRef.current ||
      finishingRef.current
    ) {
      return;
    }

    const stop = stopRecordingRef.current;

    if (!stop) {
      console.error('Audio recorder is not ready.');
      return;
    }

    clearTimers();
    finishingRef.current = true;
    stop();
  }, [clearTimers]);

  const openQuitModal = useCallback(() => {
    if (
      !mountedRef.current ||
      quittingRef.current ||
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
      setCountdown(PREPARATION_COUNTDOWN);
    }
    setQuitModalVisible(true);
  }, [clearTimers, setQuitModalVisible]);

  const continueExercise = useCallback(() => {
    if (
      !mountedRef.current ||
      quittingRef.current ||
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
      setCountdown(PREPARATION_COUNTDOWN);
      beginCountdownRef.current?.();
      return;
    }

    if (previousPhase === 'countdown') {
      setCountdown(PREPARATION_COUNTDOWN);
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
        setCountdown(PREPARATION_COUNTDOWN);
        beginCountdownRef.current?.();
      }
    }
  }, [scheduleProcessingCompletion, setQuitModalVisible]);

  const quitExercise = useCallback(async () => {
    if (quittingRef.current) {
      return;
    }

    quittingRef.current = true;
    pausedRef.current = true;
    setIsQuitting(true);
    setQuitModalVisible(false);
    clearTimers();

    startingRef.current = false;
    finishingRef.current = true;
    discardNextStopRef.current = true;

    try {
      stopRecordingRef.current?.();
    } finally {
      router.replace('/exercises/breath-control');
    }
  }, [clearTimers, setQuitModalVisible]);

  const goBack = useCallback(() => {
    openQuitModal();
  }, [openQuitModal]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) {
          return true;
        }

        openQuitModal();
        return true;
      },
    );

    return () => subscription.remove();
  }, [openQuitModal]);

  const retryExercise = useCallback(() => {
    pausedRef.current = false;
    quittingRef.current = false;
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
    setCountdown(PREPARATION_COUNTDOWN);
    updatePhase('instructions');
  }, [clearTimers, setQuitModalVisible, updatePhase]);

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

  const quitMessage =
    pausedPhaseRef.current === 'instructions' ||
    pausedPhaseRef.current === 'results'
      ? 'Are you sure you want to leave Sustained "SSSS"?'
      : pausedPhaseRef.current === 'recording'
        ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
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
              color={COLORS.brown}
            />
          </View>

          <Text style={styles.modalTitle}>
            Quit exercise?
          </Text>

          <Text style={styles.modalMessage}>
            {quitMessage}
          </Text>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
            onPress={continueExercise}
            disabled={isQuitting}
          >
            <Text style={styles.continueButtonText}>
              Continue Exercise
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
            onPress={() => {
              void quitExercise();
            }}
            disabled={isQuitting}
          >
            <Text style={styles.quitButtonText}>
              {isQuitting ? 'Stopping...' : 'Quit Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  if (loadingParams || !params || !tier) {
    return (
      <>
        {quitModal}

        <View style={styles.centerScreen}>
          <View style={styles.largeIconCircle}>
            <Ionicons
              name="options-outline"
              size={44}
              color={COLORS.brown}
            />
          </View>

          <Text style={styles.preparingTitle}>
            Preparing Your Exercise
          </Text>

          <Text style={styles.preparingSubtitle}>
            Adjusting the exercise to your current difficulty level
          </Text>

          <ActivityIndicator
            size="large"
            color={COLORS.brown}
            style={styles.spinner}
          />
        </View>
      </>
    );
  }

  if (phase === 'instructions') {
    return (
      <>
        {quitModal}

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
    const maxDuration = params.durationRangeSec[1];
    const progress = Math.min(elapsed / maxDuration, 1);

    return (
      <View style={styles.container}>
        {quitModal}

        <ScrollView
          contentContainerStyle={styles.recordingContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.recordingHeader}>
            <View style={styles.smallIconCircle}>
              <Ionicons
                name="cloud-outline"
                size={27}
                color={COLORS.brown}
              />
            </View>

            <View style={styles.recordingHeaderText}>
              <Text style={styles.recordingTitle}>
                Sustain "SSSS"
              </Text>

              <Text style={styles.recordingSubtitle}>
                Repetition {currentRep} of {params.repetitions}
              </Text>
            </View>
          </View>

          <View style={styles.sssssCard}>
            <Text style={styles.sssssText}>
              SSSSSSS
            </Text>

            <Text style={styles.sssssHint}>
              Keep the sound steady
            </Text>
          </View>

          <View style={styles.micArea}>
            <View style={styles.outerMicCircle}>
              <View style={styles.innerMicCircle}>
                <Ionicons
                  name="mic"
                  size={48}
                  color={COLORS.brown}
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

          <Text style={styles.timerText}>
            {elapsed.toFixed(1)}s
          </Text>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>

          <View style={styles.liveMetrics}>
            <View style={styles.liveMetricCard}>
              <Text style={styles.liveMetricLabel}>
                AUDIO LEVEL
              </Text>

              <Text style={styles.liveMetricValue}>
                {volume !== null ? volume.toFixed(1) : '--'}
              </Text>
            </View>

            <View style={styles.liveMetricCard}>
              <Text style={styles.liveMetricLabel}>
                TARGET
              </Text>

              <Text style={styles.liveMetricValue}>
                {params.durationRangeSec[0]}–
                {params.durationRangeSec[1]}s
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

      <ExerciseResultsScreen
        title="Exercise Complete!"
        subtitle="Here's how you performed"
        score={averageScore}
        resultIcon="checkmark"
        onRetry={retryExercise}
        onExit={goBack}
      >
        <View style={styles.metricsGrid}>
          <View style={styles.resultMetricCard}>
            <Ionicons
              name="timer-outline"
              size={24}
              color={COLORS.brown}
            />

            <Text style={styles.resultMetricValue}>
              {averageDuration.toFixed(1)}s
            </Text>

            <Text style={styles.resultMetricLabel}>
              Avg. Duration
            </Text>
          </View>

          <View style={styles.resultMetricCard}>
            <Ionicons
              name="pulse-outline"
              size={24}
              color={COLORS.brown}
            />

            <Text style={styles.resultMetricValue}>
              {Math.round(averageConsistency)}%
            </Text>

            <Text style={styles.resultMetricLabel}>
              Consistency
            </Text>
          </View>

          <View style={styles.resultMetricCard}>
            <Ionicons
              name="repeat-outline"
              size={24}
              color={COLORS.brown}
            />

            <Text style={styles.resultMetricValue}>
              {repResults.length}/{params.repetitions}
            </Text>

            <Text style={styles.resultMetricLabel}>
              Repetitions
            </Text>
          </View>

          <View style={styles.resultMetricCard}>
            <Ionicons
              name="checkmark-circle-outline"
              size={24}
              color={COLORS.brown}
            />

            <Text style={styles.resultMetricValue}>
              {passedReps}
            </Text>

            <Text style={styles.resultMetricLabel}>
              Passed
            </Text>
          </View>
        </View>

        <View style={styles.feedbackCard}>
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={24}
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

        <Text style={styles.repResultsTitle}>
          Repetition Results
        </Text>

        {repResults.map(result => (
          <View
            key={`rep-${result.rep}`}
            style={styles.repResultCard}
          >
            <View style={styles.repResultLeft}>
              <View style={styles.repNumber}>
                <Text style={styles.repNumberText}>
                  {result.rep}
                </Text>
              </View>

              <View>
                <Text style={styles.repResultTitle}>
                  Repetition {result.rep}
                </Text>

                <Text style={styles.repResultSubtitle}>
                  {result.measurement.actualDurationSec.toFixed(1)}
                  s • {Math.round(result.measurement.consistencyPct)}
                  % consistency
                </Text>
              </View>
            </View>

            <View style={styles.repScore}>
              <Text style={styles.repScoreText}>
                {result.score.score}
              </Text>

              <Text style={styles.repScorePercent}>
                %
              </Text>
            </View>
          </View>
        ))}
      </ExerciseResultsScreen>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
    paddingTop: 60,
  },
  primaryButton: {
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.brown,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 24,
  },
  primaryButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: COLORS.white,
    marginLeft: 8,
  },
  centerScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  largeIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  recordingContent: {
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 40,
  },
  recordingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  smallIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  recordingHeaderText: {
    flex: 1,
  },
  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: COLORS.brown,
  },
  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 2,
  },
  pauseButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sssssCard: {
    backgroundColor: COLORS.background,
    borderRadius: 22,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sssssText: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    letterSpacing: 3,
    color: COLORS.brown,
  },
  sssssHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 5,
  },
  micArea: {
    alignItems: 'center',
    marginTop: 28,
  },
  outerMicCircle: {
    width: 164,
    height: 164,
    borderRadius: 82,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerMicCircle: {
    width: 116,
    height: 116,
    borderRadius: 58,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBadge: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.lightGray,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.guideRed,
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
    fontSize: 34,
    color: COLORS.brown,
    textAlign: 'center',
    marginTop: 18,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.lightGray,
    overflow: 'hidden',
    marginTop: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.pink,
    borderRadius: 5,
  },
  liveMetrics: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  liveMetricCard: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  liveMetricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 0.4,
  },
  liveMetricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: COLORS.brown,
    marginTop: 4,
  },
  preparingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: COLORS.brown,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
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
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: COLORS.transparentbrown,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: COLORS.white,
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    marginBottom: 15,
  },
  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: COLORS.brown,
    textAlign: 'center',
  },
  modalMessage: {
    marginTop: 10,
    marginBottom: 23,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.muted,
    textAlign: 'center',
  },
  continueButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: COLORS.pink,
  },
  continueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
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
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  quitButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.muted,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
  },
  resultMetricCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: COLORS.background,
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
  },
  resultMetricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 21,
    color: COLORS.brown,
    marginTop: 5,
  },
  resultMetricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 2,
  },
  feedbackCard: {
    backgroundColor: COLORS.pink,
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 16,
  },
  feedbackContent: {
    flex: 1,
    marginLeft: 10,
  },
  feedbackTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: COLORS.brown,
  },
  feedbackText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.brown,
    marginTop: 4,
  },
  repResultsTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: COLORS.brown,
    marginTop: 22,
    marginBottom: 10,
  },
  repResultCard: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 17,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  repResultLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  repNumber: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  repNumberText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  repResultTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  repResultSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 2,
  },
  repScore: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  repScoreText: {
    fontFamily: 'FredokaBold',
    fontSize: 21,
    color: COLORS.brown,
  },
  repScorePercent: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    marginLeft: 1,
  },
});