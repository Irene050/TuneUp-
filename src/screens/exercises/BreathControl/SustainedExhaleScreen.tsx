import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, Text, View } from 'react-native';

import { ExerciseNoAudioModal, ExerciseQuitModal } from '@/components/ExerciseModals';
import { COLORS, EXERCISE_COUNTDOWN_SECONDS, EXERCISE_FINAL_RESULT_DELAY_MS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import type { SustainedExhaleParams, Tier } from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { useMountedRefLifecycle } from '@/hooks/useMountedRefLifecycle';
import type {
  ExerciseTierProps,
  RecordingExercisePhase,
} from '@/types/exercises';
import ExerciseScreen, { ExerciseCountdownScreen, ExercisePreparingScreen, ExerciseProcessingScreen, ExerciseResultsScreen, MetricCard } from '@/screens/exercises/ExerciseScreen';
import { generateSustainedExhaleParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureSustainedBreath, type SustainedBreathMeasurement } from '@/services/measurement/breathControl/sustainedBreath';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreSustainedBreath, type SustainedBreathScoreResult } from '@/services/scoring/breathControl/sustainedBreath';
import {
    getLiveVoiceDetection,
    hasSufficientRecordedSignal,
} from '@/utils/audioSignal';

import LiveVoiceDetectionVisualizer from '../../../components/SharedBreathControlComponent';

const PROCESSING_DELAY_MS = 1200;

type Phase = RecordingExercisePhase;

interface RepetitionResult {
  rep: number;
  measurement: SustainedBreathMeasurement;
  score: SustainedBreathScoreResult;
}

type Props = ExerciseTierProps;

export default function SustainedExhaleScreen({
  tier: initialTier,
}: Props) {
  const [tier, setTier] = useState<Tier | null>(
    initialTier ?? null,
  );
  const [params, setParams] =
    useState<SustainedExhaleParams | null>(null);
  const [isLoadingParams, setIsLoadingParams] = useState(true);
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [currentRep, setCurrentRep] = useState(1);
  const [countdown, setCountdown] = useState(
    EXERCISE_COUNTDOWN_SECONDS,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [volume, setVolume] = useState<number | null>(null);
  const [isVoiceDetected, setIsVoiceDetected] = useState(false);
  const [repetitionResults, setRepetitionResults] = useState<RepetitionResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

  const paramsRef = useRef<SustainedExhaleParams | null>(null);
  const tierRef = useRef<Tier | null>(initialTier ?? null);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const processingTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const mountedRef = useRef(true);
  useMountedRefLifecycle(mountedRef);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const repetitionResultsRef = useRef<RepetitionResult[]>([]);
  const currentRepRef = useRef(1);

  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef =
    useRef<(() => void | Promise<void>) | null>(null);
  const beginCountdownRef = useRef<(() => void) | null>(null);
  const resumeProcessingRef = useRef<(() => void) | null>(null);

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
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      const detection = getLiveVoiceDetection(frame.volume);
      setVolume(detection.level);
      setIsVoiceDetected(detection.detected);
    },
    [],
  );

  useEffect(() => {
    if (phase !== 'recording') {
      setVolume(null);
      setIsVoiceDetected(false);
    }
  }, [phase]);

  useEffect(() => {
    let cancelled = false;

    async function initializeAdaptiveExercise() {
      setIsLoadingParams(true);

      try {
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
              record.templateId === 'sustainedExhale' &&
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

        const generatedParams = generateSustainedExhaleParams({
          tier: currentTier,
          recentScores,
        });

        paramsRef.current = generatedParams;
        tierRef.current = currentTier;

        setParams(generatedParams);
        setTier(currentTier);
      } catch (initializationError) {
        console.error(
          'Failed to initialize Sustained Exhale:',
          initializationError,
        );

        if (cancelled) return;

        const fallbackTier: Tier = initialTier ?? 'beginner';
        const fallbackParams = generateSustainedExhaleParams({
          tier: fallbackTier,
          recentScores: [],
        });

        paramsRef.current = fallbackParams;
        tierRef.current = fallbackTier;

        setParams(fallbackParams);
        setTier(fallbackTier);
      } finally {
        if (!cancelled) {
          setIsLoadingParams(false);
        }
      }
    }

    void initializeAdaptiveExercise();

    return () => {
      cancelled = true;
    };
  }, [initialTier]);

  const scheduleAfterProcessing = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const adaptiveParams = paramsRef.current;
    const currentTier = tierRef.current;

    if (!adaptiveParams || !currentTier) {
      setErrorMessage(
        'Exercise parameters are unavailable. Please try again.',
      );
      setPhase('instructions');
      return;
    }

    clearTimers();

    processingTimerRef.current = setTimeout(() => {
      processingTimerRef.current = null;

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      if (currentRepRef.current < adaptiveParams.repetitions) {
        const nextRep = currentRepRef.current + 1;

        currentRepRef.current = nextRep;
        setCurrentRep(nextRep);
        setElapsedSeconds(0);
        setVolume(null);

        startingRef.current = false;
        finishingRef.current = false;

        beginCountdownRef.current?.();
        return;
      }

      if (finishingRef.current) return;

      finishingRef.current = true;

      void (async () => {
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
            'sustainedExhale',
            currentTier,
            finalScore,
          );
        } catch (saveError) {
          console.error(
            'Failed to save Sustained Exhale progress:',
            saveError,
          );
        }

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current
        ) {
          finishingRef.current = false;
          return;
        }

        setRepetitionResults(finalResults);
        setPhase('results');
        startingRef.current = false;
        finishingRef.current = false;
      })();
    }, currentRepRef.current >= adaptiveParams.repetitions
      ? EXERCISE_FINAL_RESULT_DELAY_MS
      : PROCESSING_DELAY_MS);
  }, [clearTimers, setPhase]);

  useEffect(() => {
    resumeProcessingRef.current = scheduleAfterProcessing;
  }, [scheduleAfterProcessing]);

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        return;
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      clearTimers();

      const adaptiveParams = paramsRef.current;
      const currentTier = tierRef.current;

      if (!adaptiveParams || !currentTier) {
        setErrorMessage(
          'Exercise parameters are unavailable. Please try again.',
        );
        setPhase('instructions');
        startingRef.current = false;
        finishingRef.current = false;
        return;
      }

      if (!hasSufficientRecordedSignal(samples)) {
        startingRef.current = false;
        finishingRef.current = false;
        setPhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      setPhase('processing');
      setElapsedSeconds(0);
      setVolume(null);

      startingRef.current = false;
      finishingRef.current = false;

      try {
        const measurement = measureSustainedBreath(
          samples,
          adaptiveParams.detectionThreshold,
          sampleRate,
        );

        const score = scoreSustainedBreath(
          measurement,
          adaptiveParams,
          'minimumAndMaximum',
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

        scheduleAfterProcessing();
      } catch (analysisError) {
        console.error(
          'Failed to analyze Sustained Exhale:',
          analysisError,
        );

        if (!mountedRef.current) return;

        clearTimers();
        setErrorMessage(
          'We could not analyze your recording. Please try again.',
        );
        setPhase('instructions');
        startingRef.current = false;
        finishingRef.current = false;
      }
    },
    [clearTimers, scheduleAfterProcessing, setPhase],
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
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      startingRef.current
    ) {
      return;
    }

    const adaptiveParams = paramsRef.current;

    if (!adaptiveParams) {
      setErrorMessage(
        'Exercise parameters are not ready. Please try again.',
      );
      setPhase('instructions');
      return;
    }

    const start = startRecordingRef.current;
    const stop = stopRecordingRef.current;

    if (!start || !stop) {
      setErrorMessage(
        'Audio recorder is not ready. Please try again.',
      );
      setPhase('instructions');
      return;
    }

    startingRef.current = true;
    finishingRef.current = false;

    clearTimers();
    setElapsedSeconds(0);
    setVolume(null);
    setErrorMessage(null);
    setPhase('recording');

    discardNextStopRef.current = false;

    try {
      await start();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      const startTime = Date.now();

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          finishingRef.current ||
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        const seconds = (Date.now() - startTime) / 1000;
        setElapsedSeconds(seconds);

        if (seconds >= adaptiveParams.durationRangeSec[1]) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }

          if (!finishingRef.current) {
            finishingRef.current = true;
            void Promise.resolve(stop()).catch(recordingError => {
              console.error(
                'Failed to stop Sustained Exhale recording:',
                recordingError,
              );
            });
          }
        }
      }, 100);
    } catch (recordingError) {
      console.error(
        'Failed to start Sustained Exhale recording:',
        recordingError,
      );

      if (!mountedRef.current) return;

      clearTimers();
      setErrorMessage(
        'Microphone access or recording failed. Please try again.',
      );
      setPhase('instructions');
      startingRef.current = false;
      finishingRef.current = false;
    }
  }, [clearTimers, setPhase]);

  const beginCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      startingRef.current
    ) {
      return;
    }

    clearTimers();
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setElapsedSeconds(0);
    setVolume(null);
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
        clearTimers();
        void startRecordingPhase();
        return;
      }

      setCountdown(value);
    }, 1000);
  }, [clearTimers, setPhase, startRecordingPhase]);

  useEffect(() => {
    beginCountdownRef.current = beginCountdown;
  }, [beginCountdown]);

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
      startingRef.current = false;
      finishingRef.current = true;
      setElapsedSeconds(0);
      setVolume(null);

      try {
        void Promise.resolve(
          stopRecordingRef.current?.(),
        ).catch(recordingError => {
          console.error(
            'Failed to stop Sustained Exhale while paused:',
            recordingError,
          );
        });
      } catch (recordingError) {
        console.error(
          'Failed to stop Sustained Exhale while paused:',
          recordingError,
        );
      }
    } else if (currentPhase === 'countdown') {
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    }

    setShowQuitModal(true);
  }, [clearTimers]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    showQuitModalRef.current = false;
    setShowQuitModal(false);

    const pausedPhase = pausedPhaseRef.current;

    pausedRef.current = false;

    if (
      pausedPhase === 'countdown' ||
      pausedPhase === 'recording'
    ) {
      startingRef.current = false;
      finishingRef.current = false;
      discardNextStopRef.current = false;
      setElapsedSeconds(0);
      setVolume(null);
      beginCountdownRef.current?.();
      return;
    }

    if (pausedPhase === 'processing') {
      finishingRef.current = false;
      resumeProcessingRef.current?.();
    }
  }, []);

  const startExercise = useCallback(() => {
    if (startingRef.current) return;

    if (!paramsRef.current || !tierRef.current) {
      setErrorMessage(
        'Exercise parameters are still loading. Please try again.',
      );
      return;
    }

    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    quitInProgressRef.current = false;
    discardNextStopRef.current = false;

    startingRef.current = false;
    finishingRef.current = false;

    repetitionResultsRef.current = [];
    currentRepRef.current = 1;

    setRepetitionResults([]);
    setCurrentRep(1);
    setElapsedSeconds(0);
    setVolume(null);
    setErrorMessage(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setShowQuitModal(false);

    beginCountdown();
  }, [beginCountdown, clearTimers]);

  const retryExercise = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    try {
      void Promise.resolve(
        stopRecordingRef.current?.(),
      ).catch(recordingError => {
        console.error(
          'Failed to stop Sustained Exhale before retry:',
          recordingError,
        );
      });
    } catch (recordingError) {
      console.error(
        'Failed to stop Sustained Exhale before retry:',
        recordingError,
      );
    }

    startingRef.current = false;
    finishingRef.current = false;

    repetitionResultsRef.current = [];
    currentRepRef.current = 1;

    setRepetitionResults([]);
    setCurrentRep(1);
    setElapsedSeconds(0);
    setVolume(null);
    setErrorMessage(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setShowQuitModal(false);
    setPhase('instructions');
  }, [clearTimers, setPhase]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();
    startingRef.current = false;
    finishingRef.current = true;

    try {
      await Promise.resolve(stopRecordingRef.current?.());
    } catch (recordingError) {
      console.error(
        'Failed to stop Sustained Exhale before leaving:',
        recordingError,
      );
    } finally {
      if (mountedRef.current) {
        router.replace('/exercises/breath-control');
      }
    }
  }, [clearTimers]);

  const handleBack = useCallback(() => {
    pauseForExitPrompt();
  }, [pauseForExitPrompt]);

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
    return () => {
      pausedRef.current = true;
      showQuitModalRef.current = false;
      discardNextStopRef.current = true;

      clearTimers();

      try {
        void Promise.resolve(
          stopRecordingRef.current?.(),
        ).catch(recordingError => {
          console.error(
            'Failed to stop Sustained Exhale during cleanup:',
            recordingError,
          );
        });
      } catch (recordingError) {
        console.error(
          'Failed to stop Sustained Exhale during cleanup:',
          recordingError,
        );
      }
    };
  }, [clearTimers]);

  const quitModal = (
    <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit exercise?"}
        message={pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Sustained Exhale?'
              : pausedPhaseRef.current === 'recording'
                ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
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

  if (isLoadingParams || !params || !tier) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level."
          icon="options-outline"
          iconSize={44}
          containerStyle={exerciseStyles.centerScreen}
        />
        {quitModal}
        {noAudioModal}
      </>
    );
  }

  const averageDuration =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, result) =>
            sum + result.measurement.actualDurationSec,
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

  const averageScore =
    repetitionResults.length > 0
      ? Math.round(
          repetitionResults.reduce(
            (sum, result) => sum + result.score.score,
            0,
          ) / repetitionResults.length,
        )
      : 0;

  const passedReps = repetitionResults.filter(
    result => result.score.passed,
  ).length;

  const durationProgress = Math.min(
    elapsedSeconds / params.durationRangeSec[1],
    1,
  );

  if (phase === 'instructions') {
    return (
      <>
        <ExerciseScreen
          category="Breath Control"
          title="Sustained Exhale"
          icon="cloud-outline"
          instructions="Take a comfortable breath in, then slowly exhale through your mouth. Keep the airflow steady and controlled for as long as you comfortably can."
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
              text: 'Exhale gently and steadily.',
            },
            {
              icon: 'mic-outline',
              text: 'Stay close enough to the microphone for consistent audio.',
            },
          ]}
          targetValue={`${params.durationRangeSec[0]} → ${params.durationRangeSec[1]} sec`}
          targetHint="sustained exhale"
          repetitions={params.repetitions}
          tip="Focus on keeping your airflow steady rather than trying to force a longer exhale."
          tier={tier}
          errorMessage={errorMessage}
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
          icon="cloud-outline"
          title="Get Ready"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Take a comfortable breath in"
          prompt="Prepare for a slow, steady exhale."

        />
        {quitModal}
        {noAudioModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <View style={exerciseStyles.screen}>
        <ScrollView
          contentContainerStyle={exerciseStyles.recordingContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={exerciseStyles.recordingHeader}>
            <Text style={exerciseStyles.recordingTitle}>
              Exhale Slowly
            </Text>

            <Text style={exerciseStyles.repLabel}>
              Repetition {currentRep} of {params.repetitions}
            </Text>
          </View>

          <View style={exerciseStyles.recordingVisual}>
            <View
              style={[
                exerciseStyles.recordingOuterCircle,
                {
                  transform: [
                    { scale: 1 + durationProgress * 0.08 },
                  ],
                },
              ]}
            >
              <View style={exerciseStyles.recordingInnerCircle}>
                <Ionicons
                  name="mic"
                  size={52}
                  color={COLORS.brown}
                />
              </View>
            </View>
          </View>

          <View style={exerciseStyles.recordingBadge}>
            <View style={exerciseStyles.recordingDot} />
            <Text style={exerciseStyles.recordingBadgeText}>
              RECORDING
            </Text>
          </View>

          <Text style={exerciseStyles.timerTextVariant1}>
            {elapsedSeconds.toFixed(1)}s
          </Text>

          <View style={[exerciseStyles.progressTrack, { marginTop: 18 }]}>
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
        {quitModal}
        {noAudioModal}
      </View>
    );
  }

  if (phase === 'processing') {
    const isFinalRep = currentRep >= params.repetitions;

    return (
      <>
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title={
            isFinalRep
              ? 'Analyzing Your Results'
              : 'Analyzing Your Exhale'
          }
          message={
            isFinalRep
              ? 'Calculating your overall breath control score'
              : `Processing repetition ${currentRep}`
          }
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
        subtitle="Sustained Exhale"
        score={averageScore}
        repetitionScores={repetitionResults.map(result => ({
          repetition: result.rep,
          score: result.score.score,
          passed: result.score.passed,
          components: [
            {
              label: 'Duration',
              value: `${result.measurement.actualDurationSec.toFixed(1)}s`,
            },
            {
              label: 'Consistency',
              value: `${Math.round(result.measurement.consistencyPct)}%`,
            },
          ],
        }))}
        resultIcon="checkmark"
        scoreDetails={
          <View style={[exerciseStyles.progressTrack, { marginTop: 17 }]}>
            <View
              style={[
                exerciseStyles.progressFill,
                { width: `${averageScore}%` },
              ]}
            />
          </View>
        }
        onRetry={retryExercise}
        onExit={handleBack}
      >
        <View style={exerciseStyles.infoText}>
          <View style={exerciseStyles.summaryCard}>
            <Text style={exerciseStyles.sectionTitle}>
              Your Performance
            </Text>

            <View style={exerciseStyles.metricsGrid}>
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
                value={`${repetitionResults.length}/${params.repetitions}`}
              />

              <MetricCard
                variant="breathControl"
                icon="checkmark-circle-outline"
                label="Passed"
                value={`${passedReps}/${repetitionResults.length}`}
              />
            </View>
          </View>

          <View style={exerciseStyles.feedbackCardVariant1}>
            <Ionicons
              name="bulb-outline"
              size={23}
              color={COLORS.brown}
            />

            <View style={exerciseStyles.repResultInfo}>
              <Text style={exerciseStyles.cardTitle}>
                Feedback
              </Text>

              <Text style={exerciseStyles.feedbackBodyText}>
                {averageScore >= 85
                  ? 'Excellent control! Your exhale was sustained with strong consistency.'
                  : averageScore >= 70
                    ? 'Good work! Focus on keeping your airflow even throughout the entire sound.'
                    : averageScore >= 50
                      ? 'Keep practicing. Try to maintain a smoother and more consistent exhalation.'
                      : 'Keep practicing your breath control. Focus on a steady stream of air and a continuous exhale.'}
              </Text>
            </View>
          </View>
        </View>
      </ExerciseResultsScreen>
      {quitModal}
      {noAudioModal}
    </>
  );
}
