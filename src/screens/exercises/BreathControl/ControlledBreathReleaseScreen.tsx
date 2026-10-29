import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
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

import {
    CONTROLLED_BREATH_RELEASE_PARAMS,
    type ControlledBreathReleaseParams,
    type Tier,
} from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { generateControlledBreathReleaseParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import {
    measureControlledBreathRelease,
    type ControlledBreathReleaseMeasurement,
} from '@/services/measurement/breathControl/controlledBreathRelease';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
    fetchComponentProgress,
    fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
    scoreControlledBreathRelease,
    type ControlledBreathReleaseScoreResult,
} from '@/services/scoring/breathControl/controlledBreathRelease';

import ExerciseScreen, {
    ExerciseCountdownScreen,
    ExerciseProcessingScreen,
    ExerciseResultsScreen,
} from '../ExerciseScreen';

import { COLORS } from '@/constants/appConstants';

const PREPARATION_COUNTDOWN = 3;
const EXTRA_RECORDING_TIME_SEC = 1;
const GUIDE_TOLERANCE_SEC = 0.35;
const PROCESSING_DELAY_MS = 700;

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'finishing'
  | 'processing'
  | 'results';

interface Props {
  tier?: Tier;
}

interface RepResult {
  rep: number;
  measurement: ControlledBreathReleaseMeasurement;
  score: ControlledBreathReleaseScoreResult;
}

export default function ControlledBreathReleaseScreen({
  tier: initialTier,
}: Props) {
  const defaultTier = initialTier ?? 'beginner';

  const [tier, setTier] = useState<Tier | null>(defaultTier);
  const [params, setParams] = useState<ControlledBreathReleaseParams>(
    CONTROLLED_BREATH_RELEASE_PARAMS[defaultTier],
  );
  const [paramsReady, setParamsReady] = useState(false);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [countdown, setCountdown] = useState(PREPARATION_COUNTDOWN);
  const [elapsed, setElapsed] = useState(0);
  const [targetRecordingDuration, setTargetRecordingDuration] =
    useState(0);
  const [volume, setVolume] = useState<number | null>(null);
  const [guidedPulse, setGuidedPulse] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [repResults, setRepResults] = useState<RepResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const phaseRef = useRef<Phase>('instructions');
  const tierRef = useRef<Tier>(defaultTier);
  const paramsRef = useRef<ControlledBreathReleaseParams>(
    CONTROLLED_BREATH_RELEASE_PARAMS[defaultTier],
  );

  const mountedRef = useRef(false);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const cancellingRef = useRef(false);
  const processingRef = useRef(false);
  const quitModalOpenRef = useRef(false);
  const leavingRef = useRef(false);
  const pausedForQuitRef = useRef(false);
  const restartCurrentRepRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');
  const discardNextStopRef = useRef(false);

  const currentRepRef = useRef(1);
  const repResultsRef = useRef<RepResult[]>([]);
  const guidedPulseRef = useRef(0);

  const startRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const startRecordingPhaseRef = useRef<(() => void) | null>(null);
  const startCountdownRef = useRef<(() => void) | null>(null);
  const finishExerciseRef = useRef<(() => Promise<void>) | null>(null);

  const transitionTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

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

    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }, []);

  const resetLiveRecordingState = useCallback(() => {
    setElapsed(0);
    setTargetRecordingDuration(0);
    setVolume(null);
    setGuidedPulse(0);
    guidedPulseRef.current = 0;
  }, []);

  const resetRepetitionResults = useCallback(() => {
    repResultsRef.current = [];
    currentRepRef.current = 1;
    guidedPulseRef.current = 0;

    setRepResults([]);
    setCurrentRep(1);
    resetLiveRecordingState();
  }, [resetLiveRecordingState]);

  const openQuitModal = useCallback(() => {
    if (
      !mountedRef.current ||
      quitModalOpenRef.current ||
      leavingRef.current
    ) {
      return;
    }

    const currentPhase = phaseRef.current;

    quitModalOpenRef.current = true;
    pausedForQuitRef.current = true;
    pausedPhaseRef.current = currentPhase;

    clearTimers();

    if (
      currentPhase === 'recording' ||
      currentPhase === 'finishing'
    ) {
      restartCurrentRepRef.current = true;
      cancellingRef.current = true;
      discardNextStopRef.current = true;
      startingRef.current = false;
      finishingRef.current = false;
      processingRef.current = false;

      resetLiveRecordingState();

      try {
        stopRecordingRef.current?.();
      } catch (stopError) {
        console.error(
          'Failed to stop Controlled Breath Release recording:',
          stopError,
        );
      }
    }

    setShowQuitModal(true);
  }, [clearTimers, resetLiveRecordingState]);

  const dismissQuitModal = useCallback(() => {
    if (leavingRef.current || !quitModalOpenRef.current) {
      return;
    }

    const previousPhase = pausedPhaseRef.current;

    quitModalOpenRef.current = false;
    setShowQuitModal(false);
    pausedForQuitRef.current = false;

    if (restartCurrentRepRef.current) {
      startingRef.current = false;
      finishingRef.current = false;
      processingRef.current = false;
      cancellingRef.current = false;

      resetLiveRecordingState();
      startCountdownRef.current?.();
      return;
    }

    if (previousPhase === 'countdown') {
      startCountdownRef.current?.();
      return;
    }

    if (previousPhase === 'processing') {
      transitionTimerRef.current = setTimeout(() => {
        transitionTimerRef.current = null;

        if (
          !mountedRef.current ||
          quitModalOpenRef.current ||
          leavingRef.current ||
          cancellingRef.current ||
          phaseRef.current !== 'processing'
        ) {
          return;
        }

        if (processingRef.current) {
          return;
        }

        if (
          currentRepRef.current >= paramsRef.current.repetitions
        ) {
          void finishExerciseRef.current?.();
          return;
        }

        currentRepRef.current += 1;
        setCurrentRep(currentRepRef.current);
        startCountdownRef.current?.();
      }, PROCESSING_DELAY_MS);

      return;
    }
    cancellingRef.current = false;
  }, [resetLiveRecordingState]);

  const exitExercise = useCallback(() => {
    if (leavingRef.current) {
      return;
    }

    leavingRef.current = true;
    cancellingRef.current = true;
    quitModalOpenRef.current = false;
    pausedForQuitRef.current = false;
    restartCurrentRepRef.current = false;
    discardNextStopRef.current = true;

    clearTimers();

    startingRef.current = false;
    finishingRef.current = false;
    processingRef.current = false;

    try {
      stopRecordingRef.current?.();
    } catch (stopError) {
      console.error(
        'Failed to stop Controlled Breath Release recording:',
        stopError,
      );
    }

    setShowQuitModal(false);
    router.replace('/exercises/breath-control');
  }, [clearTimers]);

  const confirmQuitExercise = useCallback(() => {
    if (leavingRef.current) return;

    setIsQuitting(true);
    exitExercise();
  }, [exitExercise]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          if (quitModalOpenRef.current) {
            return true;
          }

          openQuitModal();
          return true;
        },
      );

      return () => subscription.remove();
    }, [openQuitModal]),
  );

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParams() {
      const startingTier = initialTier ?? 'beginner';

      setParamsReady(false);
      setTier(startingTier);
      tierRef.current = startingTier;

      const defaultParams =
        CONTROLLED_BREATH_RELEASE_PARAMS[startingTier];

      paramsRef.current = defaultParams;
      setParams(defaultParams);

      let currentTier = startingTier;
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

        if (cancelled) return;

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'breathControl',
          );

          if (cancelled) return;

          recentScores = records
            .filter(
              record =>
                record.templateId === 'controlledBreathRelease' &&
                record.tier === currentTier,
            )
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

        const generatedParams = generateControlledBreathReleaseParams({
          tier: currentTier,
          recentScores,
        });

        tierRef.current = currentTier;
        paramsRef.current = generatedParams;

        setTier(currentTier);
        setParams(generatedParams);
        setParamsReady(true);
      } catch (loadError) {
        console.error(
          'Failed to load Controlled Breath Release parameters:',
          loadError,
        );

        if (cancelled) return;

        const fallbackParams =
          CONTROLLED_BREATH_RELEASE_PARAMS[currentTier];

        tierRef.current = currentTier;
        paramsRef.current = fallbackParams;

        setTier(currentTier);
        setParams(fallbackParams);
        setParamsReady(true);
      }
    }

    void loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [initialTier]);

  const finishExercise = useCallback(async () => {
    if (
      !mountedRef.current ||
      cancellingRef.current ||
      leavingRef.current ||
      quitModalOpenRef.current ||
      processingRef.current
    ) {
      return;
    }

    clearTimers();
    processingRef.current = true;

    const finalResults = repResultsRef.current;
    const finalScore =
      finalResults.length > 0
        ? Math.round(
            finalResults.reduce(
              (sum, item) => sum + item.score.score,
              0,
            ) / finalResults.length,
          )
        : 0;

    try {
      await saveCompletedExercise(
        'breathControl',
        'controlledBreathRelease',
        tierRef.current,
        finalScore,
      );
    } catch (saveError) {
      console.error(
        'Failed to save Controlled Breath Release progress:',
        saveError,
      );
    }

    if (
      !mountedRef.current ||
      cancellingRef.current ||
      leavingRef.current ||
      quitModalOpenRef.current
    ) {
      processingRef.current = false;
      return;
    }

    processingRef.current = false;
    startingRef.current = false;
    finishingRef.current = false;

    resetLiveRecordingState();
    setCurrentPhase('results');
  }, [clearTimers, resetLiveRecordingState, setCurrentPhase]);

  useEffect(() => {
    finishExerciseRef.current = finishExercise;
  }, [finishExercise]);

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (!mountedRef.current) return;

      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;

        startingRef.current = false;
        finishingRef.current = false;

        if (
          !pausedForQuitRef.current &&
          !leavingRef.current
        ) {
          cancellingRef.current = false;
        }

        return;
      }

      if (
        cancellingRef.current ||
        leavingRef.current ||
        pausedForQuitRef.current ||
        quitModalOpenRef.current ||
        restartCurrentRepRef.current
      ) {
        startingRef.current = false;
        finishingRef.current = false;
        return;
      }

      if (
        phaseRef.current !== 'recording' &&
        phaseRef.current !== 'finishing'
      ) {
        return;
      }

      if (processingRef.current) return;

      clearTimers();
      processingRef.current = true;

      setCurrentPhase('processing');
      resetLiveRecordingState();

      const adaptiveParams = paramsRef.current;

      try {
        const measurement = measureControlledBreathRelease(
          samples,
          adaptiveParams.intervalSec,
          sampleRate,
          adaptiveParams.pulseCount,
        );

        const score = scoreControlledBreathRelease(
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

        transitionTimerRef.current = setTimeout(() => {
          transitionTimerRef.current = null;

          if (
            !mountedRef.current ||
            cancellingRef.current ||
            leavingRef.current ||
            quitModalOpenRef.current ||
            pausedForQuitRef.current ||
            phaseRef.current !== 'processing'
          ) {
            return;
          }

          processingRef.current = false;

          if (
            currentRepRef.current >= adaptiveParams.repetitions
          ) {
            void finishExerciseRef.current?.();
            return;
          }

          currentRepRef.current += 1;
          setCurrentRep(currentRepRef.current);
          startCountdownRef.current?.();
        }, PROCESSING_DELAY_MS);
      } catch (analysisError) {
        console.error(
          'Failed to analyze Controlled Breath Release:',
          analysisError,
        );

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          leavingRef.current ||
          quitModalOpenRef.current
        ) {
          processingRef.current = false;
          return;
        }

        processingRef.current = false;
        startingRef.current = false;
        finishingRef.current = false;

        clearTimers();

        setError(
          'We could not analyze this recording. Please try again.',
        );
        setCurrentPhase('instructions');
      }
    },
    [
      clearTimers,
      resetLiveRecordingState,
      setCurrentPhase,
    ],
  );

  const { startRecording, stopRecording } = useAudioRecorder({
    onFrame: frame => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        leavingRef.current ||
        quitModalOpenRef.current ||
        pausedForQuitRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      const volumeDb = frame.volume;

      setVolume(
        Number.isFinite(volumeDb)
          ? Math.max(0, Math.min(1, (volumeDb + 45) / 45))
          : 0,
      );
    },
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const startRecordingPhase = useCallback(() => {
    if (
      !mountedRef.current ||
      startingRef.current ||
      cancellingRef.current ||
      leavingRef.current ||
      quitModalOpenRef.current ||
      pausedForQuitRef.current
    ) {
      return;
    }

    const adaptiveParams = paramsRef.current;
    const start = startRecordingRef.current;
    const stop = stopRecordingRef.current;

    if (!start || !stop) {
      setError('Audio recorder is not ready. Please try again.');
      setCurrentPhase('instructions');
      return;
    }

    const guideDuration =
      adaptiveParams.pulseCount * adaptiveParams.intervalSec;
    const recordingDuration =
      guideDuration + EXTRA_RECORDING_TIME_SEC;

    startingRef.current = true;
    finishingRef.current = false;
    processingRef.current = false;

    clearTimers();
    setError(null);
    setElapsed(0);
    setTargetRecordingDuration(guideDuration);
    setVolume(null);

    discardNextStopRef.current = false;
    restartCurrentRepRef.current = false;

    const firstPulse =
      adaptiveParams.pulseCount > 0 ? 1 : 0;

    guidedPulseRef.current = firstPulse;
    setGuidedPulse(firstPulse);
    setCurrentPhase('recording');

    void (async () => {
      try {
        await start();

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          leavingRef.current ||
          quitModalOpenRef.current ||
          pausedForQuitRef.current ||
          phaseRef.current !== 'recording'
        ) {
          stopRecordingRef.current?.();
          startingRef.current = false;
          return;
        }

        startingRef.current = false;
        const startedAt = Date.now();

        recordingTimerRef.current = setInterval(() => {
          if (
            !mountedRef.current ||
            cancellingRef.current ||
            leavingRef.current ||
            quitModalOpenRef.current ||
            pausedForQuitRef.current ||
            (phaseRef.current !== 'recording' &&
              phaseRef.current !== 'finishing')
          ) {
            return;
          }

          const seconds = (Date.now() - startedAt) / 1000;

          setElapsed(Math.min(seconds, guideDuration));

          const nextPulse =
            adaptiveParams.pulseCount > 0
              ? Math.min(
                  adaptiveParams.pulseCount,
                  Math.floor(
                    seconds / adaptiveParams.intervalSec,
                  ) + 1,
                )
              : 0;

          if (
            phaseRef.current === 'recording' &&
            nextPulse !== guidedPulseRef.current
          ) {
            guidedPulseRef.current = nextPulse;
            setGuidedPulse(nextPulse);
          }

          if (
            seconds >= guideDuration &&
            phaseRef.current === 'recording'
          ) {
            setElapsed(guideDuration);
            finishingRef.current = true;
            setCurrentPhase('finishing');
          }

          if (seconds >= recordingDuration) {
            clearTimers();
            setElapsed(guideDuration);
            finishingRef.current = true;

            try {
              stopRecordingRef.current?.();
            } catch (stopError) {
              console.error(
                'Failed to stop Controlled Breath Release recording:',
                stopError,
              );

              finishingRef.current = false;
              processingRef.current = false;
              setError(
                'Recording could not be stopped. Please try again.',
              );
              setCurrentPhase('instructions');
            }
          }
        }, 50);
      } catch (recordingError) {
        console.error(
          'Failed to start Controlled Breath Release recording:',
          recordingError,
        );

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          leavingRef.current ||
          quitModalOpenRef.current
        ) {
          startingRef.current = false;
          return;
        }

        clearTimers();
        startingRef.current = false;
        finishingRef.current = false;
        resetLiveRecordingState();

        setError(
          'Microphone access or recording failed. Please try again.',
        );
        setCurrentPhase('instructions');
      }
    })();
  }, [clearTimers, resetLiveRecordingState, setCurrentPhase]);

  useEffect(() => {
    startRecordingPhaseRef.current = startRecordingPhase;
  }, [startRecordingPhase]);

  const startCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      cancellingRef.current ||
      leavingRef.current ||
      quitModalOpenRef.current ||
      pausedForQuitRef.current
    ) {
      return;
    }

    clearTimers();
    setCountdown(PREPARATION_COUNTDOWN);
    setError(null);
    resetLiveRecordingState();
    setCurrentPhase('countdown');

    let value = PREPARATION_COUNTDOWN;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        leavingRef.current ||
        quitModalOpenRef.current ||
        pausedForQuitRef.current
      ) {
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
  }, [clearTimers, resetLiveRecordingState, setCurrentPhase]);

  useEffect(() => {
    startCountdownRef.current = startCountdown;
  }, [startCountdown]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      cancellingRef.current = true;
      pausedForQuitRef.current = false;
      restartCurrentRepRef.current = false;
      discardNextStopRef.current = true;

      clearTimers();

      try {
        stopRecordingRef.current?.();
      } catch (stopError) {
        console.error(
          'Failed to stop recording during cleanup:',
          stopError,
        );
      }
    };
  }, [clearTimers]);

  const startExercise = useCallback(() => {
    if (
      !paramsReady ||
      startingRef.current ||
      leavingRef.current ||
      quitModalOpenRef.current
    ) {
      return;
    }

    cancellingRef.current = false;
    pausedForQuitRef.current = false;
    restartCurrentRepRef.current = false;
    discardNextStopRef.current = false;
    processingRef.current = false;
    finishingRef.current = false;

    clearTimers();
    resetRepetitionResults();
    setError(null);

    startCountdown();
  }, [
    clearTimers,
    paramsReady,
    resetRepetitionResults,
    startCountdown,
  ]);

  const retryExercise = useCallback(() => {
    clearTimers();

    cancellingRef.current = true;
    pausedForQuitRef.current = false;
    restartCurrentRepRef.current = false;
    discardNextStopRef.current = true;

    try {
      stopRecordingRef.current?.();
    } catch (stopError) {
      console.error(
        'Failed to stop recording before retry:',
        stopError,
      );
    }

    startingRef.current = false;
    finishingRef.current = false;
    processingRef.current = false;

    resetRepetitionResults();
    setError(null);
    setCountdown(PREPARATION_COUNTDOWN);
    setCurrentPhase('instructions');

    cancellingRef.current = false;
  }, [clearTimers, resetRepetitionResults, setCurrentPhase]);

  const averageScore =
    repResults.length > 0
      ? Math.round(
          repResults.reduce(
            (sum, item) => sum + item.score.score,
            0,
          ) / repResults.length,
        )
      : 0;

  const averagePulseConsistency =
    repResults.length > 0
      ? repResults.reduce(
          (sum, item) =>
            sum + item.measurement.pulseConsistencyPct,
          0,
        ) / repResults.length
      : 0;

  const averageIntervalAccuracy =
    repResults.length > 0
      ? repResults.reduce(
          (sum, item) =>
            sum + item.measurement.intervalAccuracyPct,
          0,
        ) / repResults.length
      : 0;

  const averageDetectedPulses =
    repResults.length > 0
      ? repResults.reduce(
          (sum, item) => sum + item.measurement.peaks.length,
          0,
        ) / repResults.length
      : 0;

  const passedReps = repResults.filter(
    item => item.score.passed,
  ).length;

  const durationProgress =
    targetRecordingDuration > 0
      ? Math.min(elapsed / targetRecordingDuration, 1)
      : 0;

  const pulseGuideProgress =
    params.pulseCount > 0
      ? Math.min(guidedPulse / params.pulseCount, 1)
      : 0;

  const isFinalPulse =
    guidedPulse > 0 && guidedPulse === params.pulseCount;

  const currentPulseElapsed =
    guidedPulse > 0
      ? elapsed - (guidedPulse - 1) * params.intervalSec
      : 0;

  const currentPulseIsDue =
    phase === 'recording' &&
    guidedPulse > 0 &&
    currentPulseElapsed >= 0 &&
    currentPulseElapsed <= GUIDE_TOLERANCE_SEC;

  const nextPulseIn =
    guidedPulse > 0 && !isFinalPulse
      ? Math.max(0, guidedPulse * params.intervalSec - elapsed)
      : 0;

  const secondsRemaining = Math.max(
    0,
    targetRecordingDuration - elapsed,
  );

  const quitConfirmationModal = (
    <Modal
      visible={showQuitModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissQuitModal}
    >
      <View style={styles.modalOverlay}>
        <View
          accessibilityRole="alert"
          accessibilityLabel="Quit exercise confirmation"
          style={styles.modalCard}
        >
          <View style={styles.modalIcon}>
            <Ionicons
              name="exit-outline"
              size={30}
              color={COLORS.brown}
            />
          </View>

          <Text style={styles.modalTitle}>Quit exercise?</Text>

          <Text style={styles.modalMessage}>
            {pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Controlled Breath Release?'
              : pausedPhaseRef.current === 'recording' ||
                  pausedPhaseRef.current === 'finishing'
                ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            disabled={isQuitting}
            onPress={dismissQuitModal}
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
            onPress={confirmQuitExercise}
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

  if (!paramsReady || !tier) {
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

        {quitConfirmationModal}
      </>
    );
  }

  if (phase === 'instructions') {
    return (
      <>
        <ExerciseScreen
          category="Breath Control"
          title="Controlled Breath Release"
          icon="pulse-outline"
          instructions="Take a comfortable breath, then release it in short, controlled pulses toward the microphone. The exercise will guide you through each pulse while continuously recording your breathing."
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
              text: 'Follow each pulse cue and release your breath gently.',
            },
            {
              icon: 'mic-outline',
              text: 'Stay close enough to the microphone for consistent audio.',
            },
          ]}
          targetValue={`${params.pulseCount} pulses`}
          targetHint={`${params.intervalSec}s apart`}
          repetitions={params.repetitions}
          tip="Focus on control rather than releasing your breath too quickly. The microphone measures acoustic changes associated with your breath; it does not directly measure airflow."
          tier={tier}
          error={error}
          onBack={openQuitModal}
          onStart={startExercise}
          startDisabled={!paramsReady}
          startLabel="Start Exercise"
        />

        {quitConfirmationModal}
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="pulse-outline"
          title="Get Ready"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Prepare your breath"
          prompt="Take a comfortable breath. Release a short, gentle pulse whenever the guide cues you."
          onBack={openQuitModal}
        />

        {quitConfirmationModal}
      </>
    );
  }

  if (phase === 'finishing' || phase === 'processing') {
    return (
      <>
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title={
            phase === 'finishing'
              ? 'Finishing Audio Capture'
              : 'Analyzing Your Breath Pulses'
          }
          message={
            phase === 'finishing'
              ? 'The pulse sequence is complete. Please relax while the recording finishes.'
              : 'Checking pulse consistency and measuring the time between detected pulses...'
          }
          onBack={openQuitModal}
        />

        {quitConfirmationModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        <View style={styles.container}>
          <ScrollView
            contentContainerStyle={styles.recordingContent}
            showsVerticalScrollIndicator={false}
          >

            <View style={styles.recordingHeader}>
              <Text style={styles.recordingTitle}>
                Release Gently
              </Text>

              <Text style={styles.repLabel}>
                Repetition {currentRep} of {params.repetitions}
              </Text>

              <Text style={styles.recordingSubtitle}>
                Follow the pulse guide and keep each breath controlled
              </Text>
            </View>

            <View style={styles.recordingVisual}>
              <View
                style={[
                  styles.recordingOuterCircle,
                  {
                    transform: [
                      { scale: 1 + durationProgress * 0.08 },
                    ],
                  },
                ]}
              >
                <View style={styles.recordingInnerCircle}>
                  <Ionicons
                    name="pulse-outline"
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

            <View style={styles.pulseGuideCard}>
              <Text style={styles.pulseGuideLabel}>
                PULSE GUIDE
              </Text>

              <Text style={styles.pulseGuideValue}>
                {guidedPulse}
                <Text style={styles.pulseGuideTotal}>
                  {' '}/ {params.pulseCount}
                </Text>
              </Text>

              <Text style={styles.pulseGuideInstruction}>
                {currentPulseIsDue
                  ? 'Release one short, gentle breath pulse now.'
                  : isFinalPulse
                    ? `Final pulse — ${secondsRemaining.toFixed(1)}s remaining`
                    : guidedPulse === 0
                      ? 'Get ready for the first pulse.'
                      : `Next pulse in ${nextPulseIn.toFixed(1)} seconds.`}
              </Text>

              <View style={styles.pulseProgressTrack}>
                <View
                  style={[
                    styles.pulseProgressFill,
                    { width: `${pulseGuideProgress * 100}%` },
                  ]}
                />
              </View>

              <View style={styles.pulseDots}>
                {Array.from({ length: params.pulseCount }).map(
                  (_, index) => {
                    const pulseNumber = index + 1;
                    const completed = pulseNumber < guidedPulse;
                    const active = pulseNumber === guidedPulse;

                    return (
                      <View
                        key={pulseNumber}
                        style={[
                          styles.pulseDot,
                          completed && styles.pulseDotCompleted,
                          active && styles.pulseDotActive,
                        ]}
                      />
                    );
                  },
                )}
              </View>
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
                    ? `${Math.round(volume * 100)}%`
                    : 'Listening...'}
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
                  { width: `${durationProgress * 100}%` },
                ]}
              />
            </View>

            <View style={styles.rangeRow}>
              <Text style={styles.rangeText}>0s</Text>
              <Text style={styles.rangeTarget}>
                Guide: {targetRecordingDuration.toFixed(1)}s
              </Text>
              <Text style={styles.rangeText}>
                {targetRecordingDuration.toFixed(1)}s
              </Text>
            </View>
          </ScrollView>
        </View>
        {quitConfirmationModal}
      </>
    );
  }

  return (
    <>
      <ExerciseResultsScreen
        title="Exercise Complete"
        subtitle="Your controlled breath release results"
        score={averageScore}
        resultIcon={
          averageScore >= 70 ? 'checkmark' : 'analytics-outline'
        }
        scoreMessage={
          averageScore >= 90
            ? 'Excellent breath control!'
            : averageScore >= 75
              ? 'Great work!'
              : averageScore >= 60
                ? 'Good effort!'
                : 'Keep practicing!'
        }
        onBack={openQuitModal}
        onRetry={retryExercise}
        onExit={exitExercise}
      >
        <View>
          <View style={styles.statsGrid}>
            <ResultStat
              label="Pulse Consistency"
              value={`${Math.round(averagePulseConsistency)}%`}
            />

            <ResultStat
              label="Interval Accuracy"
              value={`${Math.round(averageIntervalAccuracy)}%`}
            />

            <ResultStat
              label="Avg. Pulses"
              value={averageDetectedPulses.toFixed(1)}
            />

            <ResultStat
              label="Passed"
              value={`${passedReps}/${repResults.length}`}
            />
          </View>

          <Text style={styles.resultsSectionTitle}>
            Repetition Results
          </Text>

          {repResults.map(item => (
            <View key={item.rep} style={styles.repCard}>
              <View style={styles.repHeader}>
                <Text style={styles.repTitle}>
                  Repetition {item.rep}
                </Text>

                <View
                  style={[
                    styles.passBadge,
                    !item.score.passed && styles.failBadge,
                  ]}
                >
                  <Text style={styles.passBadgeText}>
                    {item.score.passed
                      ? 'PASS'
                      : 'KEEP PRACTICING'}
                  </Text>
                </View>
              </View>

              <View style={styles.repMetrics}>
                <Metric
                  label="Pulses"
                  value={`${item.measurement.peaks.length}/${params.pulseCount}`}
                />

                <Metric
                  label="Consistency"
                  value={`${Math.round(item.measurement.pulseConsistencyPct)}%`}
                />

                <Metric
                  label="Interval Accuracy"
                  value={`${Math.round(item.measurement.intervalAccuracyPct)}%`}
                />

                <Metric
                  label="Score"
                  value={`${item.score.score}%`}
                />
              </View>

              <View style={styles.intervalsCard}>
                <Text style={styles.intervalsTitle}>
                  Detected Pulse Intervals
                </Text>

                {item.measurement.peaks.length >= 2 ? (
                  item.measurement.peaks.slice(1).map(
                    (peak, index) => {
                      const previousPeak =
                        item.measurement.peaks[index];

                      return (
                        <View
                          key={`${item.rep}-${index}`}
                          style={styles.intervalRow}
                        >
                          <Text style={styles.intervalLabel}>
                            Pulse {index + 1} → {index + 2}
                          </Text>

                          <Text style={styles.intervalValue}>
                            {(
                              peak.timestamp - previousPeak.timestamp
                            ).toFixed(2)}{' '}
                            s
                          </Text>
                        </View>
                      );
                    },
                  )
                ) : (
                  <Text style={styles.noIntervalsText}>
                    Not enough detected pulses to calculate intervals.
                  </Text>
                )}

                {item.measurement.peaks.length >= 2 && (
                  <Text style={styles.targetIntervalText}>
                    Target interval: {params.intervalSec.toFixed(2)}s
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      </ExerciseResultsScreen>

      {quitConfirmationModal}
    </>
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
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
    paddingTop: 20,
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
  recordingContent: {
    paddingHorizontal: 24,
    paddingTop: 58,
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
    textAlign: 'center',
  },
  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 4,
  },
  recordingVisual: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  recordingOuterCircle: {
    width: 164,
    height: 164,
    borderRadius: 82,
    backgroundColor:COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingInnerCircle: {
    width: 118,
    height: 118,
    borderRadius: 59,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBadge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor:COLORS.background,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 15,
    marginTop: 20,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.accent,
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
    fontSize: 38,
    color: COLORS.brown,
    textAlign: 'center',
    marginTop: 12,
  },
  progressTrack: {
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.lightGray,
    overflow: 'hidden',
    marginTop: 14,
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
    fontSize: 11,
    color: COLORS.muted,
  },
  rangeTarget: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: COLORS.brown,
  },
  pulseGuideCard: {
    backgroundColor:COLORS.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 17,
    alignItems: 'center',
    marginTop: 23,
  },
  pulseGuideLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 1,
    color: COLORS.muted,
  },
  pulseGuideValue: {
    fontFamily: 'FredokaBold',
    fontSize: 32,
    color: COLORS.brown,
    marginTop: 2,
  },
  pulseGuideTotal: {
    fontFamily: 'FredokaRegular',
    fontSize: 18,
    color: COLORS.muted,
  },
  pulseGuideInstruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 3,
  },
  pulseProgressTrack: {
    height: 6,
    width: '100%',
    backgroundColor: COLORS.white,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 13,
  },
  pulseProgressFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: 3,
  },
  pulseDots: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
    marginTop: 13,
  },
  pulseDot: {
    width: 25,
    height: 25,
    borderRadius: 100,
    backgroundColor: COLORS.lightGray,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pulseDotCompleted: {
    backgroundColor: COLORS.pink,
    borderColor: COLORS.brown,
  },
  pulseDotActive: {
    width: 29,
    height: 29,
    borderRadius: 100,
    backgroundColor: COLORS.brown,
    borderColor: COLORS.brown,
    marginTop: -2,
  },
  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor:COLORS.background,
    borderRadius: 18,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  liveIconCircle: {
    width: 45,
    height: 45,
    borderRadius: 23,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveTextContainer: {
    flex: 1,
    marginLeft: 12,
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
  airflowIndicator: {
    width: 64,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.white,
    overflow: 'hidden',
    marginLeft: 8,
  },
  airflowFill: {
    height: '100%',
    backgroundColor: COLORS.brown,
    borderRadius: 5,
  },
  pacingCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 17,
    padding: 15,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pacingTextContainer: {
    flex: 1,
    marginLeft: 11,
  },
  pacingTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  pacingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.muted,
    marginTop: 2,
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
    fontSize: 11,
    color: COLORS.muted,
    textAlign: 'center',
  },
  resultsSectionTitle: {
    marginTop: 24,
    marginBottom: 10,
    fontFamily: 'FredokaSemiBold',
    fontSize: 17,
    color: COLORS.brown,
  },
  repCard: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    padding: 15,
    marginBottom: 10,
  },
  repHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  repTitle: {
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
  intervalsCard: {
    marginTop: 14,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  intervalsTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: COLORS.brown,
    marginBottom: 7,
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  intervalLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
  },
  intervalValue: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: COLORS.brown,
  },
  targetIntervalText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 7,
  },
  noIntervalsText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.muted,
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
    backgroundColor:COLORS.background,
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
});