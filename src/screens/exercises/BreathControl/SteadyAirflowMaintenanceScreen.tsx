import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Text, View } from 'react-native';

import { ExerciseNoAudioModal, ExerciseQuitModal } from '@/components/ExerciseModals';
import { COLORS, EXERCISE_COUNTDOWN_SECONDS, EXERCISE_FINAL_RESULT_DELAY_MS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import type { SteadyAirflowParams, Tier } from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { useMountedRefLifecycle } from '@/hooks/useMountedRefLifecycle';
import type {
  ExerciseTierProps,
  RecordingExercisePhase,
} from '@/types/exercises';
import ExerciseScreen, { ExerciseCountdownScreen, ExercisePreparingScreen, ExerciseProcessingScreen, ExerciseResultsScreen } from '@/screens/exercises/ExerciseScreen';
import { generateSteadyAirflowParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureSteadyAirflow, type SteadyAirflowMeasurement } from '@/services/measurement/breathControl/steadyAirflowMaintenance';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreSteadyAirflow, type SteadyAirflowScoreResult } from '@/services/scoring/breathControl/steadyAirflowMaintenance';
import { getLiveVoiceDetection, hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { average } from '@/utils/math';

import LiveVoiceDetectionVisualizer from '../../../components/SharedBreathControlComponent';

const STABILITY_WINDOW_SIZE = 20;
const MIN_STABILITY_READINGS = 5;
const PROCESSING_DELAY_MS = 700;

type Props = ExerciseTierProps;

type Phase = RecordingExercisePhase;

interface RepetitionResult {
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
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [countdown, setCountdown] = useState(
    EXERCISE_COUNTDOWN_SECONDS,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [volume, setVolume] = useState(0);
  const [airflowDetected, setAirflowDetected] = useState(false);
  const [airflowStability, setAirflowStability] = useState(0);
  const [repetitionResults, setRepetitionResults] = useState<RepetitionResult[]>([]);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

  const paramsRef = useRef<SteadyAirflowParams | null>(null);
  const tierRef = useRef<Tier>(initialTier ?? 'beginner');
  const mountedRef = useRef(true);
  useMountedRefLifecycle(mountedRef);
  const currentRepRef = useRef(1);
  const repetitionResultsRef = useRef<RepetitionResult[]>([]);
  const recentVolumeRef = useRef<number[]>([]);
  const showQuitModalRef = useRef(false);
  const exitRequestedRef = useRef(false);
  const quitInProgressRef = useRef(false);
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
      ).catch(errorMessage => {
        console.error(
          'Failed to stop Steady Airflow recording:',
          errorMessage,
        );
      });
    } catch (errorMessage) {
      console.error(
        'Failed to stop Steady Airflow recording:',
        errorMessage,
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
      } catch (errorMessage) {
        console.error(
          'Failed to load Steady Airflow current tier:',
          errorMessage,
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
      } catch (errorMessage) {
        console.error(
          'Failed to load Steady Airflow history or assessment:',
          errorMessage,
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

    setPhase('countdown');
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setElapsedSeconds(0);
    resetAirflowIndicator();

    let value = EXERCISE_COUNTDOWN_SECONDS;

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
    setPhase,
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

    const finalResults = repetitionResultsRef.current;
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
    } catch (errorMessage) {
      console.error(
        'Failed to save Steady Airflow progress:',
        errorMessage,
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

    setPhase('results');
    setElapsedSeconds(0);
    resetAirflowIndicator();
  }, [
    clearTimers,
    resetAirflowIndicator,
    setPhase,
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
      setPhase('instructions');
      return;
    }

    clearTimers();
    resetAirflowIndicator();

    setPhase('recording');
    setElapsedSeconds(0);

    const startedAt = Date.now();
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

      setElapsedSeconds(
        Math.min(elapsedSeconds, adaptiveParams.durationSec),
      );

      if (elapsedSeconds >= adaptiveParams.durationSec) {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        void Promise.resolve(
          stopRecordingRef.current?.(),
        ).catch(errorMessage => {
          console.error(
            'Failed to stop Steady Airflow recording:',
            errorMessage,
          );
        });
      }
    }, 50);
  }, [
    clearTimers,
    resetAirflowIndicator,
    setPhase,
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
        setPhase('instructions');
        return;
      }

      if (!hasSufficientRecordedSignal(samples)) {
        clearTimers();
        setPhase('instructions');
        setElapsedSeconds(0);
        resetAirflowIndicator();
        setShowNoAudioModal(true);
        return;
      }

      clearTimers();

      setPhase('processing');
      setElapsedSeconds(0);
      resetAirflowIndicator();

      const measurement = measureSteadyAirflow(
        samples,
        adaptiveParams.detectionThreshold,
        sampleRate,
      );

      const score = scoreSteadyAirflow(
        measurement,
        adaptiveParams,
      );

      const result: RepetitionResult = {
        rep: currentRepRef.current,
        measurement,
        score,
      };

      const updatedResults = [
        ...repetitionResultsRef.current,
        result,
      ];

      repetitionResultsRef.current = updatedResults;
      setRepetitionResults(updatedResults);

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
      }, currentRepRef.current >= adaptiveParams.repetitions
        ? EXERCISE_FINAL_RESULT_DELAY_MS
        : PROCESSING_DELAY_MS);
    },
    [
      clearTimers,
      finishExercise,
      resetAirflowIndicator,
      setPhase,
      startCountdown,
    ],
  );

  const {
    isRecording,
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    analyzePitch: false,
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

  const volumeDb = frame.volume;

  if (!Number.isFinite(volumeDb)) {
    setVolume(0);
    setAirflowDetected(false);
    setAirflowStability(0);
    recentVolumeRef.current = [];
    return;
  }

  const { detected, level } = getLiveVoiceDetection(volumeDb);

  setVolume(level);
  setAirflowDetected(detected);

  if (!detected) {
    recentVolumeRef.current = [];
    setAirflowStability(0);
    return;
  }

  const linearAmplitude = Math.pow(10, volumeDb / 20);

  const readings = recentVolumeRef.current;
  readings.push(linearAmplitude);

  if (readings.length > STABILITY_WINDOW_SIZE) {
    readings.shift();
  }

  if (readings.length < MIN_STABILITY_READINGS) {
    setAirflowStability(0);
    return;
  }

  const meanAmplitude = average(readings);

  if (meanAmplitude <= 0) {
    setAirflowStability(0);
    return;
  }

  const variance =
    readings.reduce(
      (sum, value) => sum + (value - meanAmplitude) ** 2,
      0,
    ) / readings.length;

  const coefficientOfVariation =
    Math.sqrt(variance) / meanAmplitude;

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

    repetitionResultsRef.current = [];
    currentRepRef.current = 1;

    setRepetitionResults([]);
    setCurrentRep(1);
    setElapsedSeconds(0);
    resetAirflowIndicator();

    startCountdown();
  }, [resetAirflowIndicator, startCountdown]);

  const retryExercise = useCallback(() => {
    if (!paramsRef.current) return;

    exitRequestedRef.current = false;
    quitInProgressRef.current = false;
    restartCurrentRepRef.current = false;
    pausedPhaseRef.current = 'instructions';

    repetitionResultsRef.current = [];
    currentRepRef.current = 1;

    setRepetitionResults([]);
    setCurrentRep(1);
    setElapsedSeconds(0);
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
      showQuitModalRef.current = true;
      restartCurrentRepRef.current =
        currentPhase === 'recording' ||
        currentPhase === 'processing';

      clearTimers();
      recentVolumeRef.current = [];
      setElapsedSeconds(0);
      resetAirflowIndicator();

      if (currentPhase === 'recording') {
        setPhase('countdown');
        stopRecorderSafely();
      }
    }

    setQuitModalVisible(true);
  }, [
    clearTimers,
    resetAirflowIndicator,
    setPhase,
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

    restartCurrentRepRef.current = false;
    exitRequestedRef.current = false;
    setElapsedSeconds(0);
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

    setPhase('instructions');

    try {
      await Promise.resolve(
        stopRecordingRef.current?.(),
      );
    } catch (errorMessage) {
      console.error(
        'Failed to stop Steady Airflow recording:',
        errorMessage,
      );
    } finally {
      if (mountedRef.current) {
        router.replace('/exercises/breath-control');
      }
    }
  }, [
    clearTimers,
    setPhase,
    setQuitModalVisible,
  ]);

  useEffect(() => {
    return () => {
      exitRequestedRef.current = true;
      restartCurrentRepRef.current = true;
      showQuitModalRef.current = false;

      clearTimers();

      void Promise.resolve(
        stopRecordingRef.current?.(),
      ).catch(errorMessage => {
        console.error(
          'Failed to stop Steady Airflow recording during cleanup:',
          errorMessage,
        );
      });
    };
  }, [clearTimers]);

  const averageScore =
    repetitionResults.length > 0
      ? Math.round(
          repetitionResults.reduce(
            (sum, result) => sum + result.score.score,
            0,
          ) / repetitionResults.length,
        )
      : 0;

  const averageStability =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, result) =>
            sum + result.measurement.stabilityPct,
          0,
        ) / repetitionResults.length
      : 0;

  const averageDuration =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, result) =>
            sum + result.measurement.durationSec,
          0,
        ) / repetitionResults.length
      : 0;

  const passedReps = repetitionResults.filter(
    result => result.score.passed,
  ).length;

  const quitModal = (
    <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit exercise?"}
        message={pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Steady Airflow Maintenance?'
              : 'Your exercise is paused. Continue to resume with your current repetition. If it was interrupted, that repetition will restart. Your completed repetitions will be kept.'}
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
        exitRequestedRef.current = false;
        quitInProgressRef.current = false;
        restartCurrentRepRef.current = false;
        startCountdown();
      }}
      onQuit={() => {
        setShowNoAudioModal(false);
        void quitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  if (!params || !tier) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level and preparing your vocal range."
          icon="options-outline"
          iconSize={44}
        />

        {quitModal}
        {noAudioModal}
      </>
    );
  }

  const progress =
    params.durationSec > 0
      ? Math.min(elapsedSeconds / params.durationSec, 1)
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
        {noAudioModal}
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

        />
        {quitModal}
        {noAudioModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <View style={exerciseStyles.screen}>
        <View style={exerciseStyles.exerciseContentVariant2}>
          <Text style={exerciseStyles.phaseLabelVariant1}>
            Maintain a Steady Airflow
          </Text>

          <Text style={exerciseStyles.exerciseSubtitle}>
            Repetition {currentRep} of {params.repetitions}
          </Text>

          <View
            style={[
              exerciseStyles.recordingCircle,
              isRecording && exerciseStyles.recordingCircleActive,
            ]}
          >
            <Ionicons
              name="water-outline"
              size={42}
              color={COLORS.brown}
            />

            <Text style={exerciseStyles.timerTextVariant6}>
              {elapsedSeconds.toFixed(1)}
            </Text>

            <Text style={exerciseStyles.frequencyText}>
              / {params.durationSec.toFixed(1)}s
            </Text>
          </View>

          <View style={exerciseStyles.airflowCard}>
            <View style={exerciseStyles.stabilityHeader}>
              <Text style={exerciseStyles.airflowLabel}>
                LIVE STABILITY
              </Text>

              <Text style={exerciseStyles.repResultTitle}>
                {airflowDetected
                  ? `${airflowStability}%`
                  : '--'}
              </Text>
            </View>

            <View style={[exerciseStyles.progressTrack, { marginTop: 8 }]}>
              <View
                style={[
                  exerciseStyles.progressFill,
                  {
                    width: `${
                      airflowDetected ? airflowStability : 0
                    }%`,
                  },
                ]}
              />
            </View>

            <Text style={exerciseStyles.airflowHint}>
              {!airflowDetected
                ? 'Exhale gently toward the microphone.'
                : airflowStability >= 80
                  ? 'Your airflow is looking consistent.'
                  : 'Try to maintain a more even airflow.'}
            </Text>
          </View>

          <View style={[exerciseStyles.progressTrack, { marginTop: 25 }]}>
            <View
              style={[
                exerciseStyles.progressFill,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>

          <LiveVoiceDetectionVisualizer
            detected={airflowDetected}
            level={volume}
          />
        </View>

        {quitModal}
        {noAudioModal}
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
        />
        {quitModal}
        {noAudioModal}
      </>
    );
  }

  return (
    <>
      <ExerciseResultsScreen
        title="Exercise Complete"
        subtitle="Your steady airflow results"
        score={averageScore}
        repetitionScores={repetitionResults.map(result => ({
          repetition: result.rep,
          score: result.score.score,
          passed: result.score.passed,
          components: [
            {
              label: 'Airflow stability',
              value: `${Math.round(result.measurement.stabilityPct)}%`,
            },
            {
              label: 'Duration',
              value: `${result.measurement.durationSec.toFixed(1)}s`,
            },
            {
              label: 'Airflow detected',
              value: result.measurement.detected ? 'Yes' : 'No',
            },
          ],
        }))}
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

        onRetry={retryExercise}
        onExit={() => {
          void quitExercise();
        }}
      >
        <View style={exerciseStyles.statsGrid}>
          <View style={exerciseStyles.resultStat}>
            <Text style={exerciseStyles.resultStatValue}>
              {Math.round(averageStability)}%
            </Text>
            <Text style={exerciseStyles.resultStatLabel}>
              Avg. Stability
            </Text>
          </View>

          <View style={exerciseStyles.resultStat}>
            <Text style={exerciseStyles.resultStatValue}>
              {averageDuration.toFixed(1)}s
            </Text>
            <Text style={exerciseStyles.resultStatLabel}>
              Avg. Duration
            </Text>
          </View>

          <View style={exerciseStyles.resultStat}>
            <Text style={exerciseStyles.resultStatValue}>
              {passedReps}/{repetitionResults.length}
            </Text>
            <Text style={exerciseStyles.resultStatLabel}>
              Passed
            </Text>
          </View>

          <View style={exerciseStyles.resultStat}>
            <Text style={exerciseStyles.resultStatValue}>
              {params.stabilityThreshold}%
            </Text>
            <Text style={exerciseStyles.resultStatLabel}>
              Target
            </Text>
          </View>
        </View>

      </ExerciseResultsScreen>

      {quitModal}
      {noAudioModal}
    </>
  );
}
