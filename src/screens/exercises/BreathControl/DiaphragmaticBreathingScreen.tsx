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
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  type DiaphragmaticBreathingParams,
  type Tier,
} from '@/constants/breathControl';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
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
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '../ExerciseScreen';

import { COLORS } from '@/constants/appConstants';

const PREPARATION_COUNTDOWN = 3;

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

interface RepResult {
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

  const [phase, setPhase] = useState<Phase>('instructions');
  const phaseRef = useRef<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(PREPARATION_COUNTDOWN);
  const [elapsed, setElapsed] = useState(0);
  const [volume, setVolume] = useState(0);
  const [showExitPrompt, setShowExitPrompt] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const showExitPromptRef = useRef(false);
  const pausedForExitRef = useRef(false);
  const restartCurrentRepRef = useRef(false);
  const leavingRef = useRef(false);

  const [currentRep, setCurrentRep] = useState(1);
  const currentRepRef = useRef(1);

  const [repResults, setRepResults] = useState<RepResult[]>([]);
  const repResultsRef = useRef<RepResult[]>([]);

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

  const setCurrentPhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const setExitPromptVisible = useCallback((visible: boolean) => {
    showExitPromptRef.current = visible;
    setShowExitPrompt(visible);
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
      } catch (error) {
        console.error(
          'Failed to load Diaphragmatic Breathing current tier:',
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
      } catch (error) {
        console.error(
          'Failed to load Diaphragmatic Breathing ADS reference:',
          error,
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
    setElapsed(0);
    setVolume(0);
  }, []);

  const resetRepetitionResults = useCallback(() => {
    currentRepRef.current = 1;
    repResultsRef.current = [];

    setCurrentRep(1);
    setRepResults([]);
    resetLiveState();
  }, [resetLiveState]);

  const finishExercise = useCallback(async () => {
    if (
      !mountedRef.current ||
      cancellingRef.current ||
      pausedForExitRef.current ||
      leavingRef.current ||
      processingRef.current
    ) {
      return;
    }

    clearTimers();
    processingRef.current = true;

    const finalResults = [...repResultsRef.current];

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
    } catch (error) {
      console.error(
        'Failed to save Diaphragmatic Breathing progress:',
        error,
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

    setCurrentPhase('results');
  }, [clearTimers, setCurrentPhase]);

  const processRep = useCallback(
    (exhaleSamples: Float32Array, sampleRate: number) => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        pausedForExitRef.current ||
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

        setCurrentPhase('instructions');
        return;
      }

      processingRef.current = true;

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
            pausedForExitRef.current ||
            leavingRef.current
          ) {
            processingRef.current = false;
            return;
          }

          processingRef.current = false;
          startCountdownRef.current?.();
        }, 700);
      } catch (error) {
        console.error(
          'Failed to analyze Diaphragmatic Breathing:',
          error,
        );

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          pausedForExitRef.current
        ) {
          processingRef.current = false;
          return;
        }

        processingRef.current = false;
        setCurrentPhase('instructions');
      }
    },
    [finishExercise, setCurrentPhase],
  );

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        pausedForExitRef.current ||
        restartCurrentRepRef.current ||
        leavingRef.current ||
        phaseRef.current !== 'exhale'
      ) {
        return;
      }

      clearTimers();
      processingRef.current = true;

      setCurrentPhase('processing');
      setElapsed(0);
      setVolume(0);

      stopTimerRef.current = setTimeout(() => {
        stopTimerRef.current = null;

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          pausedForExitRef.current ||
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
    [clearTimers, processRep, setCurrentPhase],
  );

  const { startRecording, stopRecording } = useAudioRecorder({
    onFrame: frame => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        pausedForExitRef.current ||
        restartCurrentRepRef.current ||
        leavingRef.current ||
        phaseRef.current !== 'exhale'
      ) {
        return;
      }

      setVolume(frame.volume ?? 0);
    },
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const startPhaseTimer = useCallback(
    (durationSec: number, stopRecorder = true) => {
      if (
        cancellingRef.current ||
        pausedForExitRef.current ||
        leavingRef.current
      ) {
        return;
      }

      clearTimers();

      const startedAt = Date.now();
      setElapsed(0);

      phaseTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          cancellingRef.current ||
          pausedForExitRef.current ||
          leavingRef.current
        ) {
          return;
        }

        const elapsedSec = (Date.now() - startedAt) / 1000;

        setElapsed(Math.min(elapsedSec, durationSec));

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
      pausedForExitRef.current ||
      leavingRef.current
    ) {
      return;
    }

    const adaptiveParams = paramsRef.current;
    if (!adaptiveParams) return;

    clearTimers();

    setCurrentPhase('exhale');
    setElapsed(0);
    setVolume(0);

    const start = startRecordingRef.current;

    if (!start) {
      setCurrentPhase('instructions');
      return;
    }

    startingRef.current = true;

    void (async () => {
      try {
        await start();

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          pausedForExitRef.current ||
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
      } catch (error) {
        console.error(
          'Failed to start Diaphragmatic Breathing recording:',
          error,
        );

        startingRef.current = false;

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          pausedForExitRef.current
        ) {
          return;
        }

        clearTimers();
        resetLiveState();
        setCurrentPhase('instructions');
      }
    })();
  }, [clearTimers, resetLiveState, setCurrentPhase]);

  useEffect(() => {
    startExhalePhaseRef.current = startExhalePhase;
  }, [startExhalePhase]);

  const startInhalePhase = useCallback(() => {
    if (
      !mountedRef.current ||
      cancellingRef.current ||
      pausedForExitRef.current ||
      leavingRef.current
    ) {
      return;
    }

    const adaptiveParams = paramsRef.current;
    if (!adaptiveParams) return;

    clearTimers();

    setCurrentPhase('inhale');
    setElapsed(0);
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
        pausedForExitRef.current ||
        leavingRef.current
      ) {
        return;
      }

      startExhalePhaseRef.current?.();
    }, adaptiveParams.inhaleSec * 1000);
  }, [clearTimers, setCurrentPhase]);

  useEffect(() => {
    startInhalePhaseRef.current = startInhalePhase;
  }, [startInhalePhase]);

  const startCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      cancellingRef.current ||
      pausedForExitRef.current ||
      leavingRef.current
    ) {
      return;
    }

    clearTimers();

    setCurrentPhase('countdown');
    setCountdown(PREPARATION_COUNTDOWN);
    setElapsed(0);
    setVolume(0);

    let value = PREPARATION_COUNTDOWN;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        pausedForExitRef.current ||
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
  }, [clearTimers, setCurrentPhase]);

  useEffect(() => {
    startCountdownRef.current = startCountdown;
  }, [startCountdown]);

  const startExercise = useCallback(() => {
    if (!paramsReady || !paramsRef.current) return;

    cancellingRef.current = false;
    processingRef.current = false;
    startingRef.current = false;
    pausedForExitRef.current = false;
    restartCurrentRepRef.current = false;
    leavingRef.current = false;

    setIsQuitting(false);
    clearTimers();
    resetRepetitionResults();
    setCountdown(PREPARATION_COUNTDOWN);
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
    pausedForExitRef.current = false;
    restartCurrentRepRef.current = false;

    setIsQuitting(false);
    clearTimers();
    stopRecordingRef.current?.();

    resetRepetitionResults();
    setCountdown(PREPARATION_COUNTDOWN);
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
      showExitPromptRef.current
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
      pausedForExitRef.current = true;

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
        } catch (error) {
          console.error(
            'Failed to stop interrupted Diaphragmatic Breathing recording:',
            error,
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
    if (leavingRef.current || !showExitPromptRef.current) {
      return;
    }

    setExitPromptVisible(false);

    if (!pausedForExitRef.current) {
      return;
    }

    pausedForExitRef.current = false;
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
    pausedForExitRef.current = false;
    restartCurrentRepRef.current = false;
    processingRef.current = false;
    startingRef.current = false;

    setIsQuitting(true);
    clearTimers();

    try {
      stopRecordingRef.current?.();
    } catch (error) {
      console.error(
        'Failed to stop Diaphragmatic Breathing recording:',
        error,
      );
    }

    setExitPromptVisible(false);
    router.replace('/exercises/breath-control');
  }, [clearTimers, setExitPromptVisible]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showExitPromptRef.current) {
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
      pausedForExitRef.current = false;
      restartCurrentRepRef.current = false;
      processingRef.current = false;
      startingRef.current = false;

      clearTimers();

      try {
        stopRecordingRef.current?.();
      } catch (error) {
        console.error(
          'Failed to stop Diaphragmatic Breathing during cleanup:',
          error,
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
    <Modal
      visible={showExitPrompt}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={continueExercise}
    >
      <View style={styles.modalOverlay}>
        <View
          accessibilityRole="alert"
          accessibilityLabel="Exercise exit confirmation"
          style={styles.confirmationCard}
        >
          <View style={styles.confirmationIcon}>
            <Ionicons
              name="exit-outline"
              size={32}
              color={COLORS.brown}
            />
          </View>

          <Text style={styles.confirmationTitle}>
            Quit exercise?
          </Text>

          <Text style={styles.confirmationMessage}>
            {quitMessage}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            onPress={continueExercise}
            disabled={isQuitting}
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
            onPress={quitExercise}
            disabled={isQuitting}
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

  if (!params || !tier || !paramsReady) {
    return (
      <>
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
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
      {quitModal}
      </>
    );
  }

  const averageScore =
    repResults.length > 0
      ? Math.round(
          repResults.reduce(
            (sum, result) => sum + result.score.score,
            0,
          ) / repResults.length,
        )
      : 0;

  const averageExhale =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum + result.measurement.exhaleDurationSec,
          0,
        ) / repResults.length
      : 0;

  const averageConsistency =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum + result.measurement.consistencyPct,
          0,
        ) / repResults.length
      : 0;

  const averageVolume =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) => sum + result.measurement.volumeDb,
          0,
        ) / repResults.length
      : 0;

  const progress =
    phase === 'inhale'
      ? Math.min(elapsed / params.inhaleSec, 1)
      : phase === 'exhale'
        ? Math.min(elapsed / params.exhaleSec, 1)
        : 0;

  return (
    <View style={styles.screen}>
      {quitModal}

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
        <View style={styles.exerciseContainer}>

          <View style={styles.exerciseContent}>
            <Text style={styles.phaseLabel}>
              {phase === 'inhale' ? 'INHALE' : 'EXHALE'}
            </Text>

            <Text style={styles.repText}>
              Repetition {currentRep} of {params.repetitions}
            </Text>

            <View style={styles.breathCircle}>
              <Ionicons
                name={
                  phase === 'inhale'
                    ? 'arrow-down-outline'
                    : 'arrow-up-outline'
                }
                size={42}
                color={COLORS.brown}
              />

              <Text style={styles.phaseTime}>
                {elapsed.toFixed(1)}
              </Text>

              <Text style={styles.phaseTarget}>
                / {(phase === 'inhale'
                  ? params.inhaleSec
                  : params.exhaleSec
                ).toFixed(1)}s
              </Text>
            </View>

            <Text style={styles.instructionTitle}>
              {phase === 'inhale'
                ? 'Breathe in slowly'
                : 'Exhale gently'}
            </Text>

            <Text style={styles.instructionText}>
              {phase === 'inhale'
                ? 'Take a comfortable, deep breath using your diaphragm.'
                : 'Slowly release your breath toward the microphone.'}
            </Text>

            {phase === 'exhale' && (
              <View style={styles.volumeCard}>
                <Text style={styles.volumeLabel}>
                  RELATIVE MIC LEVEL
                </Text>

                <Text style={styles.volumeValue}>
                  {Number.isFinite(volume)
                    ? volume.toFixed(2)
                    : '--'}
                </Text>
              </View>
            )}

            <ProgressBar progress={progress} />

            <Text style={styles.smallHint}>
              {phase === 'inhale'
                ? 'Keep your shoulders relaxed.'
                : 'Keep your airflow smooth and consistent.'}
            </Text>
          </View>
        </View>
      )}

      {phase === 'processing' && (
        <>
          <ExerciseProcessingScreen
            icon="analytics-outline"
            title="Analyzing Your Breathing"
            message="Measuring duration, consistency, and relative microphone level..."
            onBack={handleBack}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pause exercise"
            style={styles.processingPauseButton}
            onPress={handleBack}
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
            <View style={styles.statsGrid}>
              <ResultStat
                label="Avg. Exhale"
                value={`${averageExhale.toFixed(1)}s`}
              />

              <ResultStat
                label="Consistency"
                value={`${Math.round(averageConsistency)}%`}
              />

              <ResultStat
                label="Avg. Relative Level"
                value={
                  Number.isFinite(averageVolume)
                    ? `${averageVolume.toFixed(1)} dB`
                    : '--'
                }
              />
            </View>

            <Text style={styles.sectionTitle}>
              Repetition Results
            </Text>

            {repResults.map(result => (
              <View
                key={`rep-${result.rep}`}
                style={styles.repResultCard}
              >
                <View style={styles.repResultHeader}>
                  <Text style={styles.repResultTitle}>
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
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          {
            width: `${Math.max(0, Math.min(progress, 1) * 100)}%`,
          },
        ]}
      />
    </View>
  );
}

function ResultStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.resultStat}>
      <Text style={styles.resultStatValue}>{value}</Text>
      <Text style={styles.resultStatLabel}>{label}</Text>
    </View>
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
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  preparingScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  preparingIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
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
  exerciseContainer: {
    flex: 1,
    backgroundColor: COLORS.white,
    paddingHorizontal: 25,
    paddingTop: 180,
  },
  exerciseContent: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 5,
  },
  phaseLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    letterSpacing: 1.5,
    color: COLORS.brown,
  },
  repText: {
    marginTop: 5,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
  },
  breathCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 35,
  },
  phaseTime: {
    marginTop: 8,
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: COLORS.brown,
  },
  phaseTarget: {
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
  },
  instructionTitle: {
    marginTop: 25,
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: COLORS.brown,
    textAlign: 'center',
  },
  instructionText: {
    marginTop: 7,
    maxWidth: 320,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 21,
    color: COLORS.muted,
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.lightGray,
    overflow: 'hidden',
    marginTop: 30,
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: COLORS.brown,
  },
  smallHint: {
    marginTop: 18,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: COLORS.muted,
    textAlign: 'center',
  },
  volumeCard: {
    width: '100%',
    marginTop: 22,
    padding: 16,
    borderRadius: 18,
    backgroundColor: COLORS.background,
    alignItems: 'center',
  },
  volumeLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    letterSpacing: 1,
    color: COLORS.muted,
  },
  volumeValue: {
    marginTop: 3,
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: COLORS.brown,
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  resultStat: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: COLORS.lightGray,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  resultStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: COLORS.brown,
  },
  resultStatLabel: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
  },
  sectionTitle: {
    marginTop: 24,
    marginBottom: 10,
    fontFamily: 'FredokaSemiBold',
    fontSize: 17,
    color: COLORS.brown,
  },
  repResultCard: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    padding: 15,
    marginBottom: 10,
  },
  repResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  repResultTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  passBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: COLORS.pink,
  },
  failBadge: {
    backgroundColor: COLORS.lightGray,
  },
  passBadgeText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    color: COLORS.brown,
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
    color: COLORS.muted,
  },
  metricValue: {
    marginTop: 2,
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.transparentbrown,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 26,
  },
  confirmationCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: COLORS.white,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  confirmationIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  confirmationTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: COLORS.brown,
    textAlign: 'center',
  },
  confirmationMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 9,
    marginBottom: 22,
  },
  continueButton: {
    width: '100%',
    minHeight: 49,
    backgroundColor: COLORS.pink,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  continueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  quitButton: {
    width: '100%',
    minHeight: 47,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginTop: 10,
  },
  quitButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
