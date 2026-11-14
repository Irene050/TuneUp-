import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, Text, View } from 'react-native';

import { ExerciseNoAudioModal, ExerciseQuitModal } from '@/components/ExerciseModals';
import { COLORS, EXERCISE_COUNTDOWN_SECONDS, EXERCISE_FINAL_RESULT_DELAY_MS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { CONTROLLED_BREATH_RELEASE_PARAMS, type ControlledBreathReleaseParams, type Tier } from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { useMountedRefLifecycle } from '@/hooks/useMountedRefLifecycle';
import type { ExerciseTierProps } from '@/types/exercises';
import ExerciseScreen, { ExerciseCountdownScreen, ExercisePreparingScreen, ExerciseProcessingScreen, ExerciseResultsScreen, ResultStat } from '@/screens/exercises/ExerciseScreen';
import { generateControlledBreathReleaseParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureControlledBreathRelease, type ControlledBreathReleaseMeasurement } from '@/services/measurement/breathControl/controlledBreathRelease';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreControlledBreathRelease, type ControlledBreathReleaseScoreResult } from '@/services/scoring/breathControl/controlledBreathRelease';
import {
    getLiveVoiceDetection,
    hasSufficientRecordedSignal,
} from '@/utils/audioSignal';

import LiveVoiceDetectionVisualizer from '../../../components/SharedBreathControlComponent';

const EXTRA_RECORDING_TIME_SECONDS = 1;
const GUIDE_TOLERANCE_SECONDS = 0.35;
const PROCESSING_DELAY_MS = 700;

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'finishing'
  | 'processing'
  | 'results';

type Props = ExerciseTierProps;

interface RepetitionResult {
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

  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [targetRecordingDuration, setTargetRecordingDuration] =
    useState(0);
  const [volume, setVolume] = useState<number | null>(null);
  const [isVoiceDetected, setIsVoiceDetected] = useState(false);
  const [guidedPulse, setGuidedPulse] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [repetitionResults, setRepetitionResults] = useState<RepetitionResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const tierRef = useRef<Tier>(defaultTier);
  const paramsRef = useRef<ControlledBreathReleaseParams>(
    CONTROLLED_BREATH_RELEASE_PARAMS[defaultTier],
  );

  const mountedRef = useRef(false);
  useMountedRefLifecycle(mountedRef);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const cancellingRef = useRef(false);
  const processingRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const leavingRef = useRef(false);
  const pausedRef = useRef(false);
  const restartCurrentRepRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');
  const discardNextStopRef = useRef(false);

  const currentRepRef = useRef(1);
  const repetitionResultsRef = useRef<RepetitionResult[]>([]);
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
    setElapsedSeconds(0);
    setTargetRecordingDuration(0);
    setVolume(null);
    setIsVoiceDetected(false);
    setGuidedPulse(0);
    guidedPulseRef.current = 0;
  }, []);

  const resetRepetitionResults = useCallback(() => {
    repetitionResultsRef.current = [];
    currentRepRef.current = 1;
    guidedPulseRef.current = 0;

    setRepetitionResults([]);
    setCurrentRep(1);
    resetLiveRecordingState();
  }, [resetLiveRecordingState]);

  const openQuitModal = useCallback(() => {
    if (
      !mountedRef.current ||
      showQuitModalRef.current ||
      leavingRef.current
    ) {
      return;
    }

    const currentPhase = phaseRef.current;

    showQuitModalRef.current = true;
    pausedRef.current = true;
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

  const continueExercise = useCallback(() => {
    if (leavingRef.current || !showQuitModalRef.current) {
      return;
    }

    const previousPhase = pausedPhaseRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    pausedRef.current = false;

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
          showQuitModalRef.current ||
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
      }, currentRepRef.current >= paramsRef.current.repetitions
        ? EXERCISE_FINAL_RESULT_DELAY_MS
        : PROCESSING_DELAY_MS);

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
    showQuitModalRef.current = false;
    pausedRef.current = false;
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
          if (showQuitModalRef.current) {
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
      showQuitModalRef.current ||
      processingRef.current
    ) {
      return;
    }

    clearTimers();
    processingRef.current = true;

    const finalResults = repetitionResultsRef.current;
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
      showQuitModalRef.current
    ) {
      processingRef.current = false;
      return;
    }

    processingRef.current = false;
    startingRef.current = false;
    finishingRef.current = false;

    resetLiveRecordingState();
    setPhase('results');
  }, [clearTimers, resetLiveRecordingState, setPhase]);

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
          !pausedRef.current &&
          !leavingRef.current
        ) {
          cancellingRef.current = false;
        }

        return;
      }

      if (
        cancellingRef.current ||
        leavingRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
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

      if (!hasSufficientRecordedSignal(samples)) {
        startingRef.current = false;
        finishingRef.current = false;
        processingRef.current = false;
        setPhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      processingRef.current = true;

      setPhase('processing');
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

        transitionTimerRef.current = setTimeout(() => {
          transitionTimerRef.current = null;

          if (
            !mountedRef.current ||
            cancellingRef.current ||
            leavingRef.current ||
            showQuitModalRef.current ||
            pausedRef.current ||
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
        }, currentRepRef.current >= adaptiveParams.repetitions
          ? EXERCISE_FINAL_RESULT_DELAY_MS
          : PROCESSING_DELAY_MS);
      } catch (analysisError) {
        console.error(
          'Failed to analyze Controlled Breath Release:',
          analysisError,
        );

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          leavingRef.current ||
          showQuitModalRef.current
        ) {
          processingRef.current = false;
          return;
        }

        processingRef.current = false;
        startingRef.current = false;
        finishingRef.current = false;

        clearTimers();

        setErrorMessage(
          'We could not analyze this recording. Please try again.',
        );
        setPhase('instructions');
      }
    },
    [
      clearTimers,
      resetLiveRecordingState,
      setPhase,
    ],
  );

  const { startRecording, stopRecording } = useAudioRecorder({
    analyzePitch: false,
    onFrame: frame => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        leavingRef.current ||
        showQuitModalRef.current ||
        pausedRef.current ||
        phaseRef.current !== 'recording'
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
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const startRecordingPhase = useCallback(() => {
    if (
      !mountedRef.current ||
      startingRef.current ||
      cancellingRef.current ||
      leavingRef.current ||
      showQuitModalRef.current ||
      pausedRef.current
    ) {
      return;
    }

    const adaptiveParams = paramsRef.current;
    const start = startRecordingRef.current;
    const stop = stopRecordingRef.current;

    if (!start || !stop) {
      setErrorMessage('Audio recorder is not ready. Please try again.');
      setPhase('instructions');
      return;
    }

    const guideDuration =
      adaptiveParams.pulseCount * adaptiveParams.intervalSec;
    const recordingDuration =
      guideDuration + EXTRA_RECORDING_TIME_SECONDS;

    startingRef.current = true;
    finishingRef.current = false;
    processingRef.current = false;

    clearTimers();
    setErrorMessage(null);
    setElapsedSeconds(0);
    setTargetRecordingDuration(guideDuration);
    setVolume(null);
    setIsVoiceDetected(false);

    discardNextStopRef.current = false;
    restartCurrentRepRef.current = false;

    const firstPulse =
      adaptiveParams.pulseCount > 0 ? 1 : 0;

    guidedPulseRef.current = firstPulse;
    setGuidedPulse(firstPulse);
    setPhase('recording');

    void (async () => {
      try {
        await start();

        if (
          !mountedRef.current ||
          cancellingRef.current ||
          leavingRef.current ||
          showQuitModalRef.current ||
          pausedRef.current ||
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
            showQuitModalRef.current ||
            pausedRef.current ||
            (phaseRef.current !== 'recording' &&
              phaseRef.current !== 'finishing')
          ) {
            return;
          }

          const seconds = (Date.now() - startedAt) / 1000;

          setElapsedSeconds(Math.min(seconds, guideDuration));

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
            setElapsedSeconds(guideDuration);
            finishingRef.current = true;
            setPhase('finishing');
          }

          if (seconds >= recordingDuration) {
            clearTimers();
            setElapsedSeconds(guideDuration);
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
              setErrorMessage(
                'Recording could not be stopped. Please try again.',
              );
              setPhase('instructions');
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
          showQuitModalRef.current
        ) {
          startingRef.current = false;
          return;
        }

        clearTimers();
        startingRef.current = false;
        finishingRef.current = false;
        resetLiveRecordingState();

        setErrorMessage(
          'Microphone access or recording failed. Please try again.',
        );
        setPhase('instructions');
      }
    })();
  }, [clearTimers, resetLiveRecordingState, setPhase]);

  useEffect(() => {
    startRecordingPhaseRef.current = startRecordingPhase;
  }, [startRecordingPhase]);

  const startCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      cancellingRef.current ||
      leavingRef.current ||
      showQuitModalRef.current ||
      pausedRef.current
    ) {
      return;
    }

    clearTimers();
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setErrorMessage(null);
    resetLiveRecordingState();
    setPhase('countdown');

    let value = EXERCISE_COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        cancellingRef.current ||
        leavingRef.current ||
        showQuitModalRef.current ||
        pausedRef.current
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
  }, [clearTimers, resetLiveRecordingState, setPhase]);

  useEffect(() => {
    startCountdownRef.current = startCountdown;
  }, [startCountdown]);

  useEffect(() => {
    return () => {
      cancellingRef.current = true;
      pausedRef.current = false;
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
      showQuitModalRef.current
    ) {
      return;
    }

    cancellingRef.current = false;
    pausedRef.current = false;
    restartCurrentRepRef.current = false;
    discardNextStopRef.current = false;
    processingRef.current = false;
    finishingRef.current = false;

    clearTimers();
    resetRepetitionResults();
    setErrorMessage(null);

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
    pausedRef.current = false;
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
    setErrorMessage(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setPhase('instructions');

    cancellingRef.current = false;
  }, [clearTimers, resetRepetitionResults, setPhase]);

  const averageScore =
    repetitionResults.length > 0
      ? Math.round(
          repetitionResults.reduce(
            (sum, item) => sum + item.score.score,
            0,
          ) / repetitionResults.length,
        )
      : 0;

  const averagePulseConsistency =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, item) =>
            sum + item.measurement.pulseConsistencyPct,
          0,
        ) / repetitionResults.length
      : 0;

  const averageIntervalAccuracy =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, item) =>
            sum + item.measurement.intervalAccuracyPct,
          0,
        ) / repetitionResults.length
      : 0;

  const averageDetectedPulses =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, item) => sum + item.measurement.peaks.length,
          0,
        ) / repetitionResults.length
      : 0;

  const passedReps = repetitionResults.filter(
    item => item.score.passed,
  ).length;

  const durationProgress =
    targetRecordingDuration > 0
      ? Math.min(elapsedSeconds / targetRecordingDuration, 1)
      : 0;

  const pulseGuideProgress =
    params.pulseCount > 0
      ? Math.min(guidedPulse / params.pulseCount, 1)
      : 0;

  const isFinalPulse =
    guidedPulse > 0 && guidedPulse === params.pulseCount;

  const currentPulseElapsed =
    guidedPulse > 0
      ? elapsedSeconds - (guidedPulse - 1) * params.intervalSec
      : 0;

  const currentPulseIsDue =
    phase === 'recording' &&
    guidedPulse > 0 &&
    currentPulseElapsed >= 0 &&
    currentPulseElapsed <= GUIDE_TOLERANCE_SECONDS;

  const quitConfirmationModal = (
    <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit exercise?"}
        message={pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Controlled Breath Release?'
              : pausedPhaseRef.current === 'recording' ||
                  pausedPhaseRef.current === 'finishing'
                ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={confirmQuitExercise}
        continueLabel={"Continue Exercise"}
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />
  );

  const noAudioModal = (
    <ExerciseNoAudioModal
      visible={showNoAudioModal}
      onRedo={function redoExerciseRepetition() {
        setShowNoAudioModal(false);
        startingRef.current = false;
        finishingRef.current = false;
        processingRef.current = false;
        restartCurrentRepRef.current = false;
        setErrorMessage(null);
        resetLiveRecordingState();
        startCountdownRef.current?.();
      }}
      onQuit={() => {
        setShowNoAudioModal(false);
        void confirmQuitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  if (!paramsReady || !tier) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level"
          icon="options-outline"
          iconSize={44}
        />

        {quitConfirmationModal}
        {noAudioModal}
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
          errorMessage={errorMessage}
          onBack={openQuitModal}
          onStart={startExercise}
          startDisabled={!paramsReady}
          startLabel="Start Exercise"
        />

        {quitConfirmationModal}
        {noAudioModal}
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

        />

        {quitConfirmationModal}
        {noAudioModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        <View style={exerciseStyles.container}>
          <ScrollView
            contentContainerStyle={exerciseStyles.instructionsContent}
            showsVerticalScrollIndicator={false}
          >

            <View style={exerciseStyles.recordingHeader}>
              <Text style={exerciseStyles.recordingTitleVariant1}>
                Release Gently
              </Text>

              <Text style={exerciseStyles.repLabel}>
                Repetition {currentRep} of {params.repetitions}
              </Text>
            </View>

            <View style={exerciseStyles.recordingVisualVariant1}>
              <View
                style={[
                  exerciseStyles.recordingOuterCircleVariant1,
                  {
                    transform: [
                      { scale: 1 + durationProgress * 0.08 },
                    ],
                  },
                ]}
              >
                <View style={exerciseStyles.recordingInnerCircleVariant1}>
                  <Ionicons
                    name="pulse-outline"
                    size={52}
                    color={COLORS.brown}
                  />
                </View>
              </View>
            </View>

            <View style={[exerciseStyles.recordingBadge, { marginTop: 20 }]}>
              <View style={exerciseStyles.recordingDot} />
              <Text style={exerciseStyles.recordingBadgeText}>
                RECORDING
              </Text>
            </View>

            <View style={exerciseStyles.pulseGuideCard}>
              <Text style={exerciseStyles.volumeLabel}>
                PULSE GUIDE
              </Text>

              <Text style={exerciseStyles.pulseGuideValue}>
                {guidedPulse}
                <Text style={exerciseStyles.pulseGuideTotal}>
                  {' '}/ {params.pulseCount}
                </Text>
              </Text>

              <Text style={exerciseStyles.pulseGuideInstruction}>
                {currentPulseIsDue
                  ? 'Release one short, gentle breath pulse now.'
                  : isFinalPulse
                    ? 'This is your final pulse.'
                    : guidedPulse === 0
                      ? 'Get ready for the first pulse.'
                      : 'Get ready for the next pulse.'}
              </Text>

              <View style={[exerciseStyles.progressTrack, { marginTop: 13 }]}>
                <View
                  style={[
                    exerciseStyles.progressFill,
                    { width: `${pulseGuideProgress * 100}%` },
                  ]}
                />
              </View>

              <View style={exerciseStyles.pulseDots}>
                {Array.from({ length: params.pulseCount }).map(
                  (_, index) => {
                    const pulseNumber = index + 1;
                    const completed = pulseNumber < guidedPulse;
                    const active = pulseNumber === guidedPulse;

                    return (
                      <View
                        key={pulseNumber}
                        style={[
                          exerciseStyles.pulseDot,
                          completed && exerciseStyles.pulseDotCompleted,
                          active && exerciseStyles.pulseDotActive,
                        ]}
                      />
                    );
                  },
                )}
              </View>
            </View>

             <View style={[exerciseStyles.progressTrack, { marginTop: 14 }]}>
              <View
                style={[
                  exerciseStyles.progressFill,
                  { width: `${durationProgress * 100}%` },
                ]}
              />
            </View>

            <LiveVoiceDetectionVisualizer
              detected={isVoiceDetected}
              level={volume ?? 0}
            />
          </ScrollView>
        </View>
        {quitConfirmationModal}
        {noAudioModal}
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
        />

        {quitConfirmationModal}
        {noAudioModal}
      </>
    );
  }

  return (
    <>
      <ExerciseResultsScreen
        title="Exercise Complete"
        subtitle="Your controlled breath release results"
        score={averageScore}
        repetitionScores={repetitionResults.map(item => ({
          repetition: item.rep,
          score: item.score.score,
          passed: item.score.passed,
          components: [
            {
              label: 'Pulse consistency',
              value: `${Math.round(item.measurement.pulseConsistencyPct)}%`,
            },
            {
              label: 'Interval accuracy',
              value: `${Math.round(item.measurement.intervalAccuracyPct)}%`,
            },
            {
              label: 'Detected pulses',
              value: `${item.measurement.peaks.length}/${params.pulseCount}`,
            },
            {
              label: 'Pulse intervals',
              value:
                item.measurement.peaks.length >= 2
                  ? item.measurement.peaks
                      .slice(1)
                      .map((peak, index) =>
                        `${(
                          peak.timestamp -
                          item.measurement.peaks[index].timestamp
                        ).toFixed(2)}s`,
                      )
                      .join(', ')
                  : 'Not enough detected pulses',
            },
            {
              label: 'Target interval',
              value: `${params.intervalSec.toFixed(2)}s`,
            },
          ],
        }))}
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

        onRetry={retryExercise}
        onExit={exitExercise}
      >
        <View>
          <View style={exerciseStyles.statsGrid}>
            <ResultStat
              label="Pulse Consistency"
              value={`${Math.round(averagePulseConsistency)}%`}
              labelFontSize={11}
            />

            <ResultStat
              label="Interval Accuracy"
              value={`${Math.round(averageIntervalAccuracy)}%`}
              labelFontSize={11}
            />

            <ResultStat
              label="Avg. Pulses"
              value={averageDetectedPulses.toFixed(1)}
              labelFontSize={11}
            />

            <ResultStat
              label="Passed"
              value={`${passedReps}/${repetitionResults.length}`}
              labelFontSize={11}
            />
          </View>

        </View>
      </ExerciseResultsScreen>

      {quitConfirmationModal}
      {noAudioModal}
    </>
  );
}
