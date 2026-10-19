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
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  SteadyAirflowParams,
  Tier,
} from '@/constants/exercises/breathControl';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateSteadyAirflowParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import type { SteadyAirflowMeasurement } from '@/services/measurement/breathControl/steadyAirflowMaintenance';
import { measureSteadyAirflow } from '@/services/measurement/breathControl/steadyAirflowMaintenance';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import type { SteadyAirflowScoreResult } from '@/services/scoring/breathControl/steadyAirflowMaintenance';
import { scoreSteadyAirflow } from '@/services/scoring/breathControl/steadyAirflowMaintenance';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const ACCENT = '#D86C89';
const BORDER = '#F2DDE5';

const PREPARATION_COUNTDOWN = 3;
const AIRFLOW_DETECTION_THRESHOLD = 0.002;
const STABILITY_WINDOW_SIZE = 20;
const MIN_STABILITY_READINGS = 5;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

interface RepResult {
  rep: number;
  measurement: SteadyAirflowMeasurement;
  score: SteadyAirflowScoreResult;
}

export default function SteadyAirflowMaintenanceScreen({
  tier: initialTier,
}: Props) {
  const [tier, setTier] = useState<Tier | null>(
    initialTier ?? null,
  );
  const [params, setParams] =
    useState<SteadyAirflowParams | null>(null);
  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(
    PREPARATION_COUNTDOWN,
  );
  const [elapsed, setElapsed] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [volume, setVolume] = useState(0);
  const [airflowDetected, setAirflowDetected] = useState(false);
  const [airflowStability, setAirflowStability] = useState(0);
  const [repResults, setRepResults] = useState<RepResult[]>([]);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const paramsRef = useRef<SteadyAirflowParams | null>(null);
  const tierRef = useRef<Tier>(initialTier ?? 'beginner');
  const mountedRef = useRef(true);
  const phaseRef = useRef<Phase>('instructions');
  const currentRepRef = useRef(1);
  const repResultsRef = useRef<RepResult[]>([]);
  const recentVolumeRef = useRef<number[]>([]);

  // Keep modal visibility in a ref so audio callbacks can block
  // processing immediately, without waiting for a React render.
  const showQuitModalRef = useRef(false);
  const exitRequestedRef = useRef(false);
  const quitInProgressRef = useRef(false);

  // If recording was interrupted, the current repetition must be
  // repeated from the beginning. Never score its partial audio.
  const restartCurrentRepRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');

  const startRecordingRef = useRef<
    (() => Promise<void>) | null
  >(null);
  const stopRecordingRef = useRef<
    (() => void | Promise<void>) | null
  >(null);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const processingTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const startRecordingPhaseRef = useRef<(() => void) | null>(
    null,
  );

  const setCurrentPhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const setQuitModalVisible = useCallback((visible: boolean) => {
    showQuitModalRef.current = visible;
    setShowQuitModal(visible);
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

    if (processingTimerRef.current) {
      clearTimeout(processingTimerRef.current);
      processingTimerRef.current = null;
    }
  }, []);

  const resetAirflowIndicator = useCallback(() => {
    recentVolumeRef.current = [];
    setVolume(0);
    setAirflowDetected(false);
    setAirflowStability(0);
  }, []);

  const stopRecorderSafely = useCallback(() => {
    try {
      void Promise.resolve(
        stopRecordingRef.current?.(),
      ).catch(error => {
        console.error(
          'Failed to stop Steady Airflow recording:',
          error,
        );
      });
    } catch (error) {
      console.error(
        'Failed to stop Steady Airflow recording:',
        error,
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initializeParams = async () => {
      let currentTier: Tier = initialTier ?? 'beginner';
      let recentScores: number[] = [];

      try {
        const user = auth.currentUser;

        if (!initialTier && user) {
          const progress = await fetchComponentProgress(
            user.uid,
            'breathControl',
          );

          currentTier = progress?.currentTier ?? 'beginner';
        }
      } catch (error) {
        console.error(
          'Failed to load Steady Airflow current tier:',
          error,
        );

        currentTier = initialTier ?? 'beginner';
      }

      if (cancelled) return;

      tierRef.current = currentTier;
      setTier(currentTier);

      try {
        const user = auth.currentUser;

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'breathControl',
          );

          const currentExerciseRecords = records.filter(
            record =>
              record.templateId === 'steadyAirflow' &&
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
      } catch (error) {
        console.error(
          'Failed to load Steady Airflow history or assessment:',
          error,
        );

        recentScores = [];
      }

      if (cancelled) return;

      const generatedParams = generateSteadyAirflowParams({
        tier: currentTier,
        recentScores,
      });

      if (cancelled) return;

      paramsRef.current = generatedParams;
      setParams(generatedParams);
    };

    void initializeParams();

    return () => {
      cancelled = true;
    };
  }, [initialTier]);

  const startCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      exitRequestedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    clearTimers();

    setCurrentPhase('countdown');
    setCountdown(PREPARATION_COUNTDOWN);
    setElapsed(0);
    resetAirflowIndicator();

    let value = PREPARATION_COUNTDOWN;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        exitRequestedRef.current ||
        quitInProgressRef.current ||
        showQuitModalRef.current
      ) {
        clearTimers();
        return;
      }

      value -= 1;

      if (value <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }

        startRecordingPhaseRef.current?.();
        return;
      }

      setCountdown(value);
    }, 1000);
  }, [
    clearTimers,
    resetAirflowIndicator,
    setCurrentPhase,
  ]);

  const finishExercise = useCallback(async () => {
    clearTimers();

    if (
      !mountedRef.current ||
      exitRequestedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    const finalResults = repResultsRef.current;
    const finalScore =
      finalResults.length > 0
        ? Math.round(
            finalResults.reduce(
              (sum, result) => sum + result.score.score,
              0,
            ) / finalResults.length,
          )
        : 0;

    const activeTier = tierRef.current;

    try {
      await saveCompletedExercise(
        'breathControl',
        'steadyAirflow',
        activeTier,
        finalScore,
      );
    } catch (error) {
      console.error(
        'Failed to save Steady Airflow progress:',
        error,
      );
    }

    if (
      !mountedRef.current ||
      exitRequestedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    setCurrentPhase('results');
    setElapsed(0);
    resetAirflowIndicator();
  }, [
    clearTimers,
    resetAirflowIndicator,
    setCurrentPhase,
  ]);

  const startRecordingPhase = useCallback(() => {
    if (
      !mountedRef.current ||
      exitRequestedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    const adaptiveParams = paramsRef.current;

    if (!adaptiveParams) {
      console.error(
        'Steady Airflow parameters are not ready.',
      );
      setCurrentPhase('instructions');
      return;
    }

    clearTimers();
    resetAirflowIndicator();

    setCurrentPhase('recording');
    setElapsed(0);

    const startedAt = Date.now();

    // Clear the interrupted-attempt marker only when beginning
    // the new recording for this repetition.
    restartCurrentRepRef.current = false;

    void startRecordingRef.current?.();

    recordingTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        exitRequestedRef.current ||
        quitInProgressRef.current ||
        showQuitModalRef.current ||
        phaseRef.current !== 'recording'
      ) {
        clearTimers();
        return;
      }

      const elapsedSeconds = (Date.now() - startedAt) / 1000;

      setElapsed(
        Math.min(elapsedSeconds, adaptiveParams.durationSec),
      );

      if (elapsedSeconds >= adaptiveParams.durationSec) {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        void Promise.resolve(
          stopRecordingRef.current?.(),
        ).catch(error => {
          console.error(
            'Failed to stop Steady Airflow recording:',
            error,
          );
        });
      }
    }, 50);
  }, [
    clearTimers,
    resetAirflowIndicator,
    setCurrentPhase,
  ]);

  useEffect(() => {
    startRecordingPhaseRef.current = startRecordingPhase;
  }, [startRecordingPhase]);

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (
        !mountedRef.current ||
        exitRequestedRef.current ||
        quitInProgressRef.current ||
        showQuitModalRef.current ||
        restartCurrentRepRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      const adaptiveParams = paramsRef.current;

      if (!adaptiveParams) {
        console.error(
          'Steady Airflow parameters are not ready.',
        );
        setCurrentPhase('instructions');
        return;
      }

      clearTimers();

      setCurrentPhase('processing');
      setElapsed(0);
      resetAirflowIndicator();

      // This callback only runs for a completed recording. If the
      // modal interrupted the repetition, its callback is discarded.
      const measurement = measureSteadyAirflow(
        samples,
        adaptiveParams.detectionThreshold,
        sampleRate,
      );

      const score = scoreSteadyAirflow(
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

      processingTimerRef.current = setTimeout(() => {
        processingTimerRef.current = null;

        if (
          !mountedRef.current ||
          exitRequestedRef.current ||
          quitInProgressRef.current ||
          showQuitModalRef.current
        ) {
          return;
        }

        if (
          currentRepRef.current >=
          adaptiveParams.repetitions
        ) {
          void finishExercise();
          return;
        }

        currentRepRef.current += 1;
        setCurrentRep(currentRepRef.current);
        startCountdown();
      }, 700);
    },
    [
      clearTimers,
      finishExercise,
      resetAirflowIndicator,
      setCurrentPhase,
      startCountdown,
    ],
  );

  const {
    isRecording,
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: frame => {
      if (
        !mountedRef.current ||
        exitRequestedRef.current ||
        quitInProgressRef.current ||
        showQuitModalRef.current ||
        restartCurrentRepRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      const currentVolume = frame.volume ?? 0;
      setVolume(currentVolume);

      // The live indicator assumes frame.volume is a linear RMS-like value.
      const readings = recentVolumeRef.current;
      readings.push(currentVolume);

      if (readings.length > STABILITY_WINDOW_SIZE) {
        readings.shift();
      }

      if (readings.length < MIN_STABILITY_READINGS) {
        setAirflowDetected(false);
        setAirflowStability(0);
        return;
      }

      const average =
        readings.reduce((sum, value) => sum + value, 0) /
        readings.length;

      const detected =
        average > AIRFLOW_DETECTION_THRESHOLD;

      setAirflowDetected(detected);

      if (!detected || average <= 0) {
        setAirflowStability(0);
        return;
      }

      const variance =
        readings.reduce(
          (sum, value) => sum + (value - average) ** 2,
          0,
        ) / readings.length;

      const coefficientOfVariation =
        Math.sqrt(variance) / average;

      const stability = Math.max(
        0,
        Math.min(
          100,
          100 - coefficientOfVariation * 100,
        ),
      );

      setAirflowStability(Math.round(stability));
    },
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const startExercise = useCallback(() => {
    if (!paramsRef.current) {
      console.warn(
        'Steady Airflow parameters are not ready.',
      );
      return;
    }

    exitRequestedRef.current = false;
    quitInProgressRef.current = false;
    restartCurrentRepRef.current = false;
    pausedPhaseRef.current = 'instructions';

    repResultsRef.current = [];
    currentRepRef.current = 1;

    setRepResults([]);
    setCurrentRep(1);
    setElapsed(0);
    resetAirflowIndicator();

    startCountdown();
  }, [resetAirflowIndicator, startCountdown]);

  const retryExercise = useCallback(() => {
    if (!paramsRef.current) return;

    exitRequestedRef.current = false;
    quitInProgressRef.current = false;
    restartCurrentRepRef.current = false;
    pausedPhaseRef.current = 'instructions';

    repResultsRef.current = [];
    currentRepRef.current = 1;

    setRepResults([]);
    setCurrentRep(1);
    setElapsed(0);
    resetAirflowIndicator();

    startCountdown();
  }, [resetAirflowIndicator, startCountdown]);

  const handleBack = useCallback(() => {
    if (
      !mountedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    const currentPhase = phaseRef.current;
    pausedPhaseRef.current = currentPhase;

    const hasActiveAttempt =
      currentPhase === 'countdown' ||
      currentPhase === 'recording' ||
      currentPhase === 'processing';

    if (hasActiveAttempt) {
      // Block all timers, frames, and stop callbacks before stopping
      // the recorder. Do not reset the repetition or completed results.
      showQuitModalRef.current = true;
      restartCurrentRepRef.current =
        currentPhase === 'recording' ||
        currentPhase === 'processing';

      clearTimers();
      recentVolumeRef.current = [];
      setElapsed(0);
      resetAirflowIndicator();

      if (currentPhase === 'recording') {
        setCurrentPhase('countdown');
        stopRecorderSafely();
      }
    }

    setQuitModalVisible(true);
  }, [
    clearTimers,
    resetAirflowIndicator,
    setCurrentPhase,
    setQuitModalVisible,
    stopRecorderSafely,
  ]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) {
          return true;
        }

        handleBack();
        return true;
      },
    );

    return () => subscription.remove();
  }, [handleBack]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    const pausedPhase = pausedPhaseRef.current;

    setQuitModalVisible(false);

    const wasActive =
      pausedPhase === 'countdown' ||
      pausedPhase === 'recording' ||
      pausedPhase === 'processing';

    if (!wasActive) return;

    // The recorder has no safe pause/resume interface, so continue
    // from a fresh countdown for the same repetition. Previously
    // completed repetitions remain untouched.
    restartCurrentRepRef.current = false;
    exitRequestedRef.current = false;
    setElapsed(0);
    resetAirflowIndicator();
    startCountdown();
  }, [
    resetAirflowIndicator,
    setQuitModalVisible,
    startCountdown,
  ]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    exitRequestedRef.current = true;
    restartCurrentRepRef.current = true;

    setIsQuitting(true);
    setQuitModalVisible(false);

    clearTimers();
    recentVolumeRef.current = [];

    setCurrentPhase('instructions');

    try {
      await Promise.resolve(
        stopRecordingRef.current?.(),
      );
    } catch (error) {
      console.error(
        'Failed to stop Steady Airflow recording:',
        error,
      );
    } finally {
      if (mountedRef.current) {
        router.replace('/dashboard?tab=exercises');
      }
    }
  }, [
    clearTimers,
    setCurrentPhase,
    setQuitModalVisible,
  ]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      exitRequestedRef.current = true;
      restartCurrentRepRef.current = true;
      showQuitModalRef.current = false;

      clearTimers();

      void Promise.resolve(
        stopRecordingRef.current?.(),
      ).catch(error => {
        console.error(
          'Failed to stop Steady Airflow recording during cleanup:',
          error,
        );
      });
    };
  }, [clearTimers]);

  const averageScore =
    repResults.length > 0
      ? Math.round(
          repResults.reduce(
            (sum, result) => sum + result.score.score,
            0,
          ) / repResults.length,
        )
      : 0;

  const averageStability =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum + result.measurement.stabilityPct,
          0,
        ) / repResults.length
      : 0;

  const averageDuration =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum + result.measurement.durationSec,
          0,
        ) / repResults.length
      : 0;

  const passedReps = repResults.filter(
    result => result.score.passed,
  ).length;

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
            {pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Steady Airflow Maintenance?'
              : 'Your exercise is paused. Continue to resume with your current repetition. If it was interrupted, that repetition will restart. Your completed repetitions will be kept.'}
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

  if (!params || !tier) {
    return (
      <>
        <ExerciseProcessingScreen
          icon="options-outline"
          title="Preparing your exercise"
          message="Setting your airflow parameters..."
          onBack={handleBack}
        />
        {quitModal}
      </>
    );
  }

  const progress =
    params.durationSec > 0
      ? Math.min(elapsed / params.durationSec, 1)
      : 0;

  if (phase === 'instructions') {
    return (
      <>
        <ExerciseScreen
          title="Steady Airflow Maintenance"
          category="Breath Control"
          icon="water-outline"
          instructions="Take a comfortable breath, then gently exhale toward the microphone. Maintain a smooth and steady airflow throughout the entire exercise."
          preparationSteps={[
            {
              icon: 'leaf-outline',
              text: 'Sit or stand with a relaxed posture.',
            },
            {
              icon: 'body-outline',
              text: 'Take a comfortable breath without forcing it.',
            },
            {
              icon: 'volume-low-outline',
              text: 'Exhale gently and steadily for the full duration.',
            },
            {
              icon: 'mic-outline',
              text: 'Stay close enough to the microphone for consistent audio.',
            },
          ]}
          summary={[
            {
              label: 'TARGET',
              value: `${params.durationSec}s`,
              hint: 'steady airflow',
            },
            {
              label: 'REPETITIONS',
              value: String(params.repetitions),
              hint: 'attempts',
            },
          ]}
          tip="Focus on keeping your airflow even from the beginning to the end. Avoid sudden changes in breath strength."
          tier={tier}
          onBack={handleBack}
          onStart={startExercise}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="water-outline"
          title="Prepare your breath"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Get Ready"
          prompt="Take a comfortable breath and get ready to exhale steadily."
          onBack={handleBack}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <View style={styles.exerciseScreen}>
        <View style={styles.exerciseContent}>
          <Text style={styles.phaseLabel}>
            STEADY AIRFLOW
          </Text>

          <Text style={styles.repText}>
            Repetition {currentRep} of {params.repetitions}
          </Text>

          <View
            style={[
              styles.recordingCircle,
              isRecording && styles.recordingCircleActive,
            ]}
          >
            <Ionicons
              name="water-outline"
              size={42}
              color={BROWN}
            />

            <Text style={styles.timerText}>
              {elapsed.toFixed(1)}
            </Text>

            <Text style={styles.timerTarget}>
              / {params.durationSec.toFixed(1)}s
            </Text>
          </View>

          <Text style={styles.exerciseTitle}>
            Exhale steadily
          </Text>

          <Text style={styles.exerciseDescription}>
            Gently blow toward the microphone. Keep your airflow
            as even as possible.
          </Text>

          <View style={styles.airflowCard}>
            <View style={styles.airflowHeader}>
              <Text style={styles.airflowLabel}>
                AIRFLOW DETECTION
              </Text>

              <View style={styles.airflowStatus}>
                <View
                  style={[
                    styles.statusDot,
                    airflowDetected && styles.statusDotActive,
                  ]}
                />

                <Text style={styles.airflowStatusText}>
                  {airflowDetected ? 'Detected' : 'Listening'}
                </Text>
              </View>
            </View>

            <View style={styles.airflowIndicator}>
              <View
                style={[
                  styles.airflowFill,
                  {
                    width: `${Math.min(
                      Math.max(volume * 100, 0),
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>

            <View style={styles.stabilityHeader}>
              <Text style={styles.stabilityLabel}>
                LIVE STABILITY
              </Text>

              <Text style={styles.stabilityValue}>
                {airflowDetected
                  ? `${airflowStability}%`
                  : '--'}
              </Text>
            </View>

            <View style={styles.stabilityTrack}>
              <View
                style={[
                  styles.stabilityFill,
                  {
                    width: `${
                      airflowDetected ? airflowStability : 0
                    }%`,
                  },
                ]}
              />
            </View>

            <Text style={styles.airflowHint}>
              {!airflowDetected
                ? 'Exhale gently toward the microphone.'
                : airflowStability >= 80
                  ? 'Your airflow is looking consistent.'
                  : 'Try to maintain a more even airflow.'}
            </Text>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>

          <Text style={styles.smallHint}>
            Keep going until the timer reaches{' '}
            {`${params.durationSec} seconds.`}
          </Text>
        </View>

        {quitModal}
      </View>
    );
  }

  if (phase === 'processing') {
    return (
      <>
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing your airflow"
          message="Measuring airflow stability and duration..."
          onBack={handleBack}
        />
        {quitModal}
      </>
    );
  }

  return (
    <>
      <ExerciseResultsScreen
        title="Exercise Complete"
        subtitle="Your steady airflow results"
        score={averageScore}
        resultIcon={
          averageScore >= 70
            ? 'checkmark'
            : 'analytics-outline'
        }
        scoreMessage={
          averageScore >= 90
            ? 'Excellent airflow control!'
            : averageScore >= 75
              ? 'Great work!'
              : averageScore >= 60
                ? 'Good effort!'
                : 'Keep practicing!'
        }
        onBack={handleBack}
        onRetry={retryExercise}
        onExit={() => {
          void quitExercise();
        }}
      >
        <View style={styles.statsGrid}>
          <View style={styles.resultStat}>
            <Text style={styles.resultStatValue}>
              {Math.round(averageStability)}%
            </Text>
            <Text style={styles.resultStatLabel}>
              Avg. Stability
            </Text>
          </View>

          <View style={styles.resultStat}>
            <Text style={styles.resultStatValue}>
              {averageDuration.toFixed(1)}s
            </Text>
            <Text style={styles.resultStatLabel}>
              Avg. Duration
            </Text>
          </View>

          <View style={styles.resultStat}>
            <Text style={styles.resultStatValue}>
              {passedReps}/{repResults.length}
            </Text>
            <Text style={styles.resultStatLabel}>
              Passed
            </Text>
          </View>

          <View style={styles.resultStat}>
            <Text style={styles.resultStatValue}>
              {params.stabilityThreshold}%
            </Text>
            <Text style={styles.resultStatLabel}>
              Target
            </Text>
          </View>
        </View>

        <Text style={styles.resultsSectionTitle}>
          Repetition Results
        </Text>

        {repResults.map(result => (
          <View
            key={`rep-${result.rep}`}
            style={styles.repCard}
          >
            <View style={styles.repHeader}>
              <Text style={styles.repTitle}>
                Repetition {result.rep}
              </Text>

              <View
                style={[
                  styles.passBadge,
                  !result.score.passed && styles.failBadge,
                ]}
              >
                <Text style={styles.passBadgeText}>
                  {result.score.passed
                    ? 'PASS'
                    : 'KEEP PRACTICING'}
                </Text>
              </View>
            </View>

            <View style={styles.repMetrics}>
              <Metric
                label="Stability"
                value={`${Math.round(
                  result.measurement.stabilityPct,
                )}%`}
              />

              <Metric
                label="Duration"
                value={`${result.measurement.durationSec.toFixed(1)}s`}
              />

              <Metric
                label="Score"
                value={`${result.score.score}%`}
              />

              <Metric
                label="Detected"
                value={
                  result.measurement.detected ? 'Yes' : 'No'
                }
              />
            </View>
          </View>
        ))}
      </ExerciseResultsScreen>

      {quitModal}
    </>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  exerciseScreen: {
    flex: 1,
    backgroundColor: WHITE,
  },
  exerciseContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 25,
    paddingTop: 100,
  },
  phaseLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    letterSpacing: 1.5,
    color: BROWN,
  },
  repText: {
    marginTop: 5,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
  },
  recordingCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 42,
  },
  recordingCircleActive: {
    borderWidth: 5,
    borderColor: LIGHT_PINK,
  },
  timerText: {
    marginTop: 7,
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
  },
  timerTarget: {
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
  },
  exerciseTitle: {
    marginTop: 30,
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    textAlign: 'center',
  },
  exerciseDescription: {
    marginTop: 7,
    maxWidth: 320,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 21,
    color: MUTED,
    textAlign: 'center',
  },
  airflowCard: {
    width: '100%',
    marginTop: 22,
    padding: 16,
    borderRadius: 18,
    backgroundColor: LIGHT_PINK,
  },
  airflowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  airflowLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    letterSpacing: 1,
    color: MUTED,
  },
  airflowStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: MUTED,
  },
  statusDotActive: {
    backgroundColor: ACCENT,
  },
  airflowStatusText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
  },
  airflowIndicator: {
    width: '100%',
    height: 12,
    borderRadius: 6,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 12,
  },
  airflowFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: BROWN,
  },
  stabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  stabilityLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    letterSpacing: 1,
    color: MUTED,
  },
  stabilityValue: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
  },
  stabilityTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 8,
  },
  stabilityFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  airflowHint: {
    marginTop: 8,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 25,
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: BROWN,
  },
  smallHint: {
    marginTop: 16,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  resultStat: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  resultStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
  },
  resultStatLabel: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },
  resultsSectionTitle: {
    marginTop: 24,
    marginBottom: 10,
    fontFamily: 'FredokaSemiBold',
    fontSize: 17,
    color: BROWN,
  },
  repCard: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 15,
    marginBottom: 10,
  },
  repHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  repTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
  passBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: PINK,
  },
  failBadge: {
    backgroundColor: LIGHT_GRAY,
  },
  passBadgeText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    color: BROWN,
  },
  repMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 13,
    gap: 8,
  },
  metric: {
    width: '47%',
  },
  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  metricValue: {
    marginTop: 2,
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
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