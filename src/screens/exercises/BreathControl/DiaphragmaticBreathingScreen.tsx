import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';

import {
    type DiaphragmaticBreathingParams,
    type Tier,
} from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { generateDiaphragmaticBreathingParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import {
    measureDiaphragmaticBreathing,
    type DiaphragmaticBreathingMeasurement,
} from '@/services/measurement/breathControl/diaphragmaticBreathing';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
    fetchComponentProgress,
    fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
    scoreDiaphragmaticBreathing,
    type DiaphragmaticBreathingScoreResult,
} from '@/services/scoring/breathControl/diaphragmaticBreathing';

import ExerciseScreen, {
    ExerciseCountdownScreen,
    ExercisePreparingScreen,
    ExerciseProcessingScreen,
    ExerciseResultsScreen,
    Metric,
    ResultStat,
} from '../ExerciseScreen';

import {
    COLORS,
    EXERCISE_COUNTDOWN_SECONDS,
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import {
    getLiveVoiceDetection,
    hasSufficientRecordedSignal,
} from '@/utils/audioSignal';

import {
    ExerciseNoAudioModal,
    ExerciseQuitModal,
} from '@/components/ExerciseModals';
import LiveVoiceDetectionVisualizer from './LiveVoiceDetectionVisualizer';


interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'inhale'
  | 'exhale'
  | 'processing'
  | 'results';

interface RepetitionResult {
  rep: number;
  measurement: DiaphragmaticBreathingMeasurement;
  score: DiaphragmaticBreathingScoreResult;
}

export default function DiaphragmaticBreathingScreen({
  tier: initialTier,
}: Props) {
  const [params, setParams] =
    useState<DiaphragmaticBreathingParams | null>(null);
  const paramsRef =
    useRef<DiaphragmaticBreathingParams | null>(null);

  const [tier, setTier] =
    useState<Tier | null>(initialTier ?? null);
  const tierRef = useRef<Tier>(initialTier ?? 'beginner');
  const [paramsReady, setParamsReady] = useState(false);

  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(EXERCISE_COUNTDOWN_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [volume, setVolume] = useState(0);
  const [isVoiceDetected, setIsVoiceDetected] = useState(false);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const restartCurrentRepRef = useRef(false);
  const leavingRef = useRef(false);

  const [currentRep, setCurrentRep] = useState(1);
  const currentRepRef = useRef(1);

  const [repetitionResults, setRepetitionResults] = useState<RepetitionResult[]>([]);
  const repetitionResultsRef = useRef<RepetitionResult[]>([]);

  const mountedRef = useRef(true);
  const cancellingRef = useRef(false);
  const processingRef = useRef(false);
  const startingRef = useRef(false);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef =
    useRef<(() => void) | null>(null);

  const phaseTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPhaseTimerRef = useRef<
    ((durationSec: number, stopRecorder?: boolean) => void) | null
  >(null);
  const startInhalePhaseRef =
    useRef<(() => void) | null>(null);
  const startExhalePhaseRef =
    useRef<(() => void) | null>(null);
  const startCountdownRef =
    useRef<(() => void) | null>(null);

  const setExitPromptVisible = useCallback((visible: boolean) => {
    showQuitModalRef.current = visible;
    setShowQuitModal(visible);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initializeParams = async () => {
      setParamsReady(false);

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
          'Failed to load Diaphragmatic Breathing current tier:',
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

          if (cancelled) return;

          recentScores = records
            .filter(
              record =>
                record.templateId === 'diaphragmaticBreathing' &&
                record.tier === currentTier,
            )
            .slice(-5)
            .map(record => record.scorePct);
        }

        if (cancelled) return;

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
      } catch (errorMessage) {
        console.error(
          'Failed to load Diaphragmatic Breathing ADS reference:',
          errorMessage,
        );

        recentScores = [];
      }

      if (cancelled) return;

      const generatedParams = generateDiaphragmaticBreathingParams({
        tier: currentTier,
        recentScores,
      });

      if (cancelled) return;

      paramsRef.current = generatedParams;
      setParams(generatedParams);
      setParamsReady(true);
    };

    void initializeParams();

    return () => {
      cancelled = true;
    };
  }, [initialTier]);

  const clearTimers = useCallback(() => {
    if (phaseTimerRef.current) {
      clearInterval(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  const resetLiveState = useCallback(() => {
    setElapsedSeconds(0);
    setVolume(0);
  }, []);

  const resetRepetitionResults = useCallback(() => {
    currentRepRef.current = 1;
    repetitionResultsRef.current = [];

    setCurrentRep(1);
    setRepetitionResults([]);
    resetLiveState();
  }, [resetLiveState]);

  const finishExercise = useCallback(async () => {
    if (
      !mountedRef.current ||
      cancellingRef.current ||
      pausedRef.current ||
      leavingRef.current ||
      processingRef.current
    ) {
      return;
    }

    clearTimers();
    processingRef.current = true;

    const finalResults = [...repetitionResultsRef.current];

    const finalScore =
      finalResults.length > 0
        ? Math.round(
            finalResults.reduce(
              (sum, result) => sum + result.score.score,
              0,
            ) / finalResults.length,
          )
        : 0;

    try {
      await saveCompletedExercise(
        'breathControl',
        'diaphragmaticBreathing',
        tierRef.current,
        finalScore,
      );
    } catch (errorMessage) {
      console.error(
        'Failed to save Diaphragmatic Breathing progress:',
        errorMessage,
      );
    }

    if (
      !mountedRef.current ||
      cancellingRef.current ||
      leavingRef.current
    ) {
      processingRef.current = false;
      return;
    }

    processingRef.current = false;
    startingRef.current = false;

    setPhase('results');
  }, [clearTimers, setPhase]);

  const processRep = useCallback(
    (exhaleSamples: Float32Array, sampleRate: number) => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        pausedRef.current ||
        restartCurrentRepRef.current ||
        leavingRef.current ||
        processingRef.current
      ) {
        return;
      }

      const adaptiveParams = paramsRef.current;

      if (!adaptiveParams) {
        console.error(
          'Diaphragmatic Breathing parameters are not ready.',
        );

        setPhase('instructions');
        return;
      }

      processingRef.current = true;

      if (!hasSufficientRecordedSignal(exhaleSamples)) {
        processingRef.current = false;
        setPhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      try {
        const measurement = measureDiaphragmaticBreathing(
          exhaleSamples,
          adaptiveParams.detectionThreshold,
          sampleRate,
        );

        const score = scoreDiaphragmaticBreathing(
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

        if (
          currentRepRef.current >= adaptiveParams.repetitions
        ) {
          processingRef.current = false;
          void finishExercise();
          return;
        }

        currentRepRef.current += 1;
        setCurrentRep(currentRepRef.current);

        stopTimerRef.current = setTimeout(() => {
          stopTimerRef.current = null;

          if (
            !mountedRef.current ||
            cancellingRef.current ||
            pausedRef.current ||
            leavingRef.current
          ) {
            processingRef.current = false;
            return;
          }

          processingRef.current = false;
          startCountdownRef.current?.();
        }, 700);
      } catch (errorMessage) {
        console.error(
          'Failed to analyze Diaphragmatic Breathing:',
          errorMessage,
        );

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          pausedRef.current
        ) {
          processingRef.current = false;
          return;
        }

        processingRef.current = false;
        setPhase('instructions');
      }
    },
    [finishExercise, setPhase],
  );

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        pausedRef.current ||
        restartCurrentRepRef.current ||
        leavingRef.current ||
        phaseRef.current !== 'exhale'
      ) {
        return;
      }

      clearTimers();
      processingRef.current = true;

      setPhase('processing');
      setElapsedSeconds(0);
      setVolume(0);

      stopTimerRef.current = setTimeout(() => {
        stopTimerRef.current = null;

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          pausedRef.current ||
          restartCurrentRepRef.current ||
          leavingRef.current
        ) {
          processingRef.current = false;
          return;
        }

        processingRef.current = false;
        processRep(samples, sampleRate);
      }, 300);
    },
    [clearTimers, processRep, setPhase],
  );

  const { startRecording, stopRecording } = useAudioRecorder({
    analyzePitch: false,
    onFrame: frame => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        pausedRef.current ||
        restartCurrentRepRef.current ||
        leavingRef.current ||
        phaseRef.current !== 'exhale'
      ) {
        return;
      }

      const detection = getLiveVoiceDetection(frame.volume);
      setVolume(detection.level);
      setIsVoiceDetected(detection.detected);
    },
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    if (phase !== 'exhale') {
      setVolume(0);
      setIsVoiceDetected(false);
    }
  }, [phase]);

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const startPhaseTimer = useCallback(
    (durationSec: number, stopRecorder = true) => {
      if (
        cancellingRef.current ||
        pausedRef.current ||
        leavingRef.current
      ) {
        return;
      }

      clearTimers();

      const startedAt = Date.now();
      setElapsedSeconds(0);

      phaseTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          cancellingRef.current ||
          pausedRef.current ||
          leavingRef.current
        ) {
          return;
        }

        const elapsedSec = (Date.now() - startedAt) / 1000;

        setElapsedSeconds(Math.min(elapsedSec, durationSec));

        if (elapsedSec >= durationSec) {
          if (phaseTimerRef.current) {
            clearInterval(phaseTimerRef.current);
            phaseTimerRef.current = null;
          }

          if (stopRecorder) {
            stopRecordingRef.current?.();
          }
        }
      }, 50);
    },
    [clearTimers],
  );

  useEffect(() => {
    startPhaseTimerRef.current = startPhaseTimer;
  }, [startPhaseTimer]);

  const startExhalePhase = useCallback(() => {
    if (
      !mountedRef.current ||
      cancellingRef.current ||
      pausedRef.current ||
      leavingRef.current
    ) {
      return;
    }

    const adaptiveParams = paramsRef.current;
    if (!adaptiveParams) return;

    clearTimers();

    setPhase('exhale');
    setElapsedSeconds(0);
    setVolume(0);

    const start = startRecordingRef.current;

    if (!start) {
      setPhase('instructions');
      return;
    }

    startingRef.current = true;

    void (async () => {
      try {
        await start();

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          pausedRef.current ||
          restartCurrentRepRef.current ||
          leavingRef.current ||
          phaseRef.current !== 'exhale'
        ) {
          stopRecordingRef.current?.();
          startingRef.current = false;
          return;
        }

        startingRef.current = false;

        startPhaseTimerRef.current?.(
          adaptiveParams.exhaleSec,
          true,
        );
      } catch (errorMessage) {
        console.error(
          'Failed to start Diaphragmatic Breathing recording:',
          errorMessage,
        );

        startingRef.current = false;

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          pausedRef.current
        ) {
          return;
        }

        clearTimers();
        resetLiveState();
        setPhase('instructions');
      }
    })();
  }, [clearTimers, resetLiveState, setPhase]);

  useEffect(() => {
    startExhalePhaseRef.current = startExhalePhase;
  }, [startExhalePhase]);

  const startInhalePhase = useCallback(() => {
    if (
      !mountedRef.current ||
      cancellingRef.current ||
      pausedRef.current ||
      leavingRef.current
    ) {
      return;
    }

    const adaptiveParams = paramsRef.current;
    if (!adaptiveParams) return;

    clearTimers();

    setPhase('inhale');
    setElapsedSeconds(0);
    setVolume(0);

    startPhaseTimerRef.current?.(
      adaptiveParams.inhaleSec,
      false,
    );

    stopTimerRef.current = setTimeout(() => {
      stopTimerRef.current = null;

      if (
        !mountedRef.current ||
        cancellingRef.current ||
        pausedRef.current ||
        leavingRef.current
      ) {
        return;
      }

      startExhalePhaseRef.current?.();
    }, adaptiveParams.inhaleSec * 1000);
  }, [clearTimers, setPhase]);

  useEffect(() => {
    startInhalePhaseRef.current = startInhalePhase;
  }, [startInhalePhase]);

  const startCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      cancellingRef.current ||
      pausedRef.current ||
      leavingRef.current
    ) {
      return;
    }

    clearTimers();

    setPhase('countdown');
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setElapsedSeconds(0);
    setVolume(0);

    let value = EXERCISE_COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        pausedRef.current ||
        leavingRef.current
      ) {
        return;
      }

      value -= 1;

      if (value <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }

        startInhalePhaseRef.current?.();
        return;
      }

      setCountdown(value);
    }, 1000);
  }, [clearTimers, setPhase]);

  useEffect(() => {
    startCountdownRef.current = startCountdown;
  }, [startCountdown]);

  const startExercise = useCallback(() => {
    if (!paramsReady || !paramsRef.current) return;

    cancellingRef.current = false;
    processingRef.current = false;
    startingRef.current = false;
    pausedRef.current = false;
    restartCurrentRepRef.current = false;
    leavingRef.current = false;

    setIsQuitting(false);
    clearTimers();
    resetRepetitionResults();
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setExitPromptVisible(false);

    startCountdownRef.current?.();
  }, [
    clearTimers,
    paramsReady,
    resetRepetitionResults,
    setExitPromptVisible,
  ]);

  const retryExercise = useCallback(() => {
    if (!paramsReady || leavingRef.current) return;

    cancellingRef.current = true;
    processingRef.current = false;
    startingRef.current = false;
    pausedRef.current = false;
    restartCurrentRepRef.current = false;

    setIsQuitting(false);
    clearTimers();
    stopRecordingRef.current?.();

    resetRepetitionResults();
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setExitPromptVisible(false);

    cancellingRef.current = false;
    startCountdownRef.current?.();
  }, [
    clearTimers,
    paramsReady,
    resetRepetitionResults,
    setExitPromptVisible,
  ]);

  const handleBack = useCallback(() => {
    if (
      !mountedRef.current ||
      leavingRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    const currentPhase = phaseRef.current;

    const attemptIsActive =
      currentPhase === 'countdown' ||
      currentPhase === 'inhale' ||
      currentPhase === 'exhale' ||
      currentPhase === 'processing';

    if (attemptIsActive) {
      pausedRef.current = true;

      const recordingWasActive = currentPhase === 'exhale';
      const analysisWasPending = currentPhase === 'processing';

      if (recordingWasActive || analysisWasPending) {
        restartCurrentRepRef.current = true;
      }

      clearTimers();

      if (recordingWasActive) {
        cancellingRef.current = true;

        try {
          stopRecordingRef.current?.();
        } catch (errorMessage) {
          console.error(
            'Failed to stop interrupted Diaphragmatic Breathing recording:',
            errorMessage,
          );
        }

        cancellingRef.current = false;
      }

      startingRef.current = false;
      processingRef.current = false;

      resetLiveState();
    }

    setIsQuitting(false);
    setExitPromptVisible(true);
  }, [
    clearTimers,
    resetLiveState,
    setExitPromptVisible,
  ]);

  const continueExercise = useCallback(() => {
    if (leavingRef.current || !showQuitModalRef.current) {
      return;
    }

    setExitPromptVisible(false);

    if (!pausedRef.current) {
      return;
    }

    pausedRef.current = false;
    cancellingRef.current = false;
    startingRef.current = false;
    processingRef.current = false;

    if (restartCurrentRepRef.current) {
      restartCurrentRepRef.current = false;
      resetLiveState();
      startCountdownRef.current?.();
      return;
    }

    startCountdownRef.current?.();
  }, [resetLiveState, setExitPromptVisible]);

  const quitExercise = useCallback(() => {
    if (leavingRef.current) return;

    leavingRef.current = true;
    cancellingRef.current = true;
    pausedRef.current = false;
    restartCurrentRepRef.current = false;
    processingRef.current = false;
    startingRef.current = false;

    setIsQuitting(true);
    clearTimers();

    try {
      stopRecordingRef.current?.();
    } catch (errorMessage) {
      console.error(
        'Failed to stop Diaphragmatic Breathing recording:',
        errorMessage,
      );
    }

    setExitPromptVisible(false);
    router.replace('/exercises/breath-control');
  }, [clearTimers, setExitPromptVisible]);

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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      cancellingRef.current = true;
      pausedRef.current = false;
      restartCurrentRepRef.current = false;
      processingRef.current = false;
      startingRef.current = false;

      clearTimers();

      try {
        stopRecordingRef.current?.();
      } catch (errorMessage) {
        console.error(
          'Failed to stop Diaphragmatic Breathing during cleanup:',
          errorMessage,
        );
      }
    };
  }, [clearTimers]);

  const quitMessage =
    phaseRef.current === 'instructions' ||
    phaseRef.current === 'results'
      ? 'Are you sure you want to leave Diaphragmatic Breathing?'
      : phaseRef.current === 'exhale' ||
          restartCurrentRepRef.current
        ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
        : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.';

  const quitModal = (
    <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit exercise?"}
        message={quitMessage}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={quitExercise}
        continueLabel={"Continue Exercise"}
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />
  );

  const noAudioModal = (
    <ExerciseNoAudioModal
      visible={showNoAudioModal}
      onRedo={function redoExerciseRepetition() {
        setShowNoAudioModal(false);
        processingRef.current = false;
        startCountdownRef.current?.();
      }}
      onQuit={() => {
        setShowNoAudioModal(false);
        quitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  if (!params || !tier || !paramsReady) {
    return (
      <>
      <ExercisePreparingScreen
        title="Preparing Your Exercise"
        message="Adjusting the exercise to your current difficulty level"
        icon="options-outline"
        iconSize={44}
      />
      {quitModal}
      {noAudioModal}
      </>
    );
  }

  const averageScore =
    repetitionResults.length > 0
      ? Math.round(
          repetitionResults.reduce(
            (sum, result) => sum + result.score.score,
            0,
          ) / repetitionResults.length,
        )
      : 0;

  const averageExhale =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, result) =>
            sum + result.measurement.exhaleDurationSec,
          0,
        ) / repetitionResults.length
      : 0;

  const averageConsistency =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, result) =>
            sum + result.measurement.consistencyPct,
          0,
        ) / repetitionResults.length
      : 0;

  const progress =
    phase === 'inhale'
      ? Math.min(elapsedSeconds / params.inhaleSec, 1)
      : phase === 'exhale'
        ? Math.min(elapsedSeconds / params.exhaleSec, 1)
        : 0;

  return (
    <View style={exerciseStyles.screen}>
      {quitModal}
      {noAudioModal}

      {phase === 'instructions' && (
        <ExerciseScreen
          category="Breath Control"
          title="Diaphragmatic Breathing"
          icon="body-outline"
          instructions="Breathe slowly and deeply using your diaphragm. Inhale comfortably, then exhale gently and smoothly while keeping your airflow controlled."
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
              text: 'Inhale with ease and exhale gently and steadily.',
            },
            {
              icon: 'mic-outline',
              text: 'Stay close enough to the microphone for consistent audio.',
            },
          ]}
          targetValue={`${params.inhaleSec}s inhale / ${params.exhaleSec}s exhale`}
          targetHint="breathing pattern"
          repetitions={params.repetitions}
          tip="Focus on maintaining a relaxed, controlled airflow instead of forcing each breath."
          tier={tier}
          onBack={handleBack}
          onStart={startExercise}
          startDisabled={!paramsReady}
        />
      )}

      {phase === 'countdown' && (
        <ExerciseCountdownScreen
          icon="body-outline"
          title="Get Ready"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Prepare to breathe"
          prompt="Relax your shoulders and get ready to inhale slowly."
          onBack={handleBack}
        />
      )}

      {(phase === 'inhale' || phase === 'exhale') && (
        <View style={exerciseStyles.exerciseContainer}>

          <View style={exerciseStyles.exerciseContentVariant1}>
            <Text style={exerciseStyles.phaseLabel}>
              {phase === 'inhale' ? 'INHALE' : 'EXHALE'}
            </Text>

            <Text style={exerciseStyles.exerciseSubtitle}>
              Repetition {currentRep} of {params.repetitions}
            </Text>

            <View style={exerciseStyles.breathCircle}>
              <Ionicons
                name={
                  phase === 'inhale'
                    ? 'arrow-down-outline'
                    : 'arrow-up-outline'
                }
                size={42}
                color={COLORS.brown}
              />

              <Text style={exerciseStyles.phaseTime}>
                {elapsedSeconds.toFixed(1)}
              </Text>

              <Text style={exerciseStyles.frequencyText}>
                / {(phase === 'inhale'
                  ? params.inhaleSec
                  : params.exhaleSec
                ).toFixed(1)}s
              </Text>
            </View>

            <Text style={exerciseStyles.instructionTitle}>
              {phase === 'inhale'
                ? 'Breathe in slowly'
                : 'Exhale slowly'}
            </Text>

            <Text style={exerciseStyles.instructionText}>
              {phase === 'inhale'
                ? 'Take a comfortable, deep breath using your diaphragm.'
                : 'Slowly release your breath toward the microphone.'}
            </Text>

            <ProgressBar progress={progress} />

            {phase === 'exhale' && (
              <LiveVoiceDetectionVisualizer
                detected={isVoiceDetected}
                level={volume}
              />
            )}
          </View>
        </View>
      )}

      {phase === 'processing' && (
        <>
          <ExerciseProcessingScreen
            icon="analytics-outline"
            title="Analyzing Your Breathing"
            message="Measuring breath duration and consistency..."
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pause exercise"
            style={exerciseStyles.processingPauseButton}
            onPress={handleBack}
          >
            <Ionicons
              name="pause-circle-outline"
              size={25}
              color={COLORS.brown}
            />

            <Text style={exerciseStyles.processingPauseText}>
              Pause
            </Text>
          </Pressable>
        </>
      )}

      {phase === 'results' && (
        <ExerciseResultsScreen
          title="Exercise Complete"
          subtitle="Your diaphragmatic breathing results"
          score={averageScore}
          resultIcon={
            averageScore >= 70
              ? 'checkmark'
              : 'analytics-outline'
          }
          scoreMessage={
            averageScore >= 90
              ? 'Excellent control!'
              : averageScore >= 75
                ? 'Great work!'
                : averageScore >= 60
                  ? 'Good effort!'
                  : 'Keep practicing!'
          }
          onBack={handleBack}
          onRetry={retryExercise}
          onExit={quitExercise}
        >
          <View>
            <View style={exerciseStyles.statsGrid}>
              <ResultStat
                label="Avg. Exhale"
                value={`${averageExhale.toFixed(1)}s`}
              />

              <ResultStat
                label="Consistency"
                value={`${Math.round(averageConsistency)}%`}
              />

            </View>

            <Text style={exerciseStyles.resultsSectionTitle}>
              Repetition Results
            </Text>

            {repetitionResults.map(result => (
              <View
                key={`rep-${result.rep}`}
                style={exerciseStyles.repCard}
              >
                <View style={exerciseStyles.resultDetailRow}>
                  <Text style={exerciseStyles.cardTitle}>
                    Repetition {result.rep}
                  </Text>

                  <View
                    style={[
                      exerciseStyles.passBadge,
                      !result.score.passed && exerciseStyles.resultIconFailed,
                    ]}
                  >
                    <Text style={exerciseStyles.passBadgeText}>
                      {result.score.passed
                        ? 'PASS'
                        : 'KEEP PRACTICING'}
                    </Text>
                  </View>
                </View>

                <View style={exerciseStyles.repMetrics}>
                  <Metric
                    label="Exhale"
                    value={`${result.measurement.exhaleDurationSec.toFixed(1)}s`}
                  />

                  <Metric
                    label="Consistency"
                    value={`${Math.round(result.measurement.consistencyPct)}%`}
                  />

                  <Metric
                    label="Score"
                    value={`${result.score.score}%`}
                  />
                </View>
              </View>
            ))}
          </View>
        </ExerciseResultsScreen>
      )}
    </View>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <View style={exerciseStyles.progressTrackVariant4}>
      <View
        style={[
          exerciseStyles.progressFill,
          {
            width: `${Math.max(0, Math.min(progress, 1) * 100)}%`,
          },
        ]}
      />
    </View>
  );
}
