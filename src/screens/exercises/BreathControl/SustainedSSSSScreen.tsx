import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS, EXERCISE_COUNTDOWN_SECONDS, EXERCISE_FINAL_RESULT_DELAY_MS } from '@/constants/appConstants';
import type { SustainedExhaleParams, Tier } from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import ExerciseScreen, { ExerciseCountdownScreen, ExercisePreparingScreen, ExerciseProcessingScreen, ExerciseResultsScreen, MetricCard } from '@/screens/exercises/ExerciseScreen';
import { generateSustainedSSSSParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureSustainedSSSS, type SustainedSSSSMeasurement } from '@/services/measurement/breathControl/sustainedSSSS';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreSustainedSSSS, type SustainedSSSSScoreResult } from '@/services/scoring/breathControl/sustainedSSSS';
import {
  getLiveVoiceDetection,
  hasSufficientRecordedSignal,
} from '@/utils/audioSignal';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { ExerciseNoAudioModal, ExerciseQuitModal } from '@/components/exercises/ExerciseModals';
import LiveVoiceDetectionVisualizer from './LiveVoiceDetectionVisualizer';
import { usePhaseState } from '@/hooks/usePhaseState';

const PROCESSING_DELAY_MS = 1200;

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

interface RepetitionResult {
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
  const repetitionResultsRef = useRef<RepetitionResult[]>([]);
  const currentRepRef = useRef(1);
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
        setIsLoadingParams(true);

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
          setIsLoadingParams(false);
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

      const finalResults = [...repetitionResultsRef.current];

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

        setRepetitionResults(finalResults);

        setPhase('results');

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
    setElapsedSeconds(0);
    setVolume(null);

    startingRef.current = false;
    finishingRef.current = false;

    beginCountdownRef.current?.();
  }, [setPhase]);

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
    }, pendingFinalRepRef.current
      ? EXERCISE_FINAL_RESULT_DELAY_MS
      : PROCESSING_DELAY_MS);
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

      setPhase('processing');

      setVolume(null);

      startingRef.current = false;
      finishingRef.current = false;

      const adaptiveParams = paramsRef.current;
      const currentTier = tierRef.current;

      if (!adaptiveParams || !currentTier) {
        setErrorMessage(
          'Exercise parameters are unavailable. Please try again.',
        );

        setPhase('instructions');
        return;
      }

      if (!hasSufficientRecordedSignal(samples)) {
        setPhase('instructions');
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

        setErrorMessage(
          'We could not analyze your recording. Please try again.',
        );

        setPhase('instructions');

        startingRef.current = false;
        finishingRef.current = false;
      }
    },
    [
      clearTimers,
      scheduleProcessingCompletion,
      setPhase,
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

        setElapsedSeconds(seconds);

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
  }, [clearTimers, startRecordingPhase, setPhase]);

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
      setErrorMessage(
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

    repetitionResultsRef.current = [];
    currentRepRef.current = 1;

    setRepetitionResults([]);
    setCurrentRep(1);

    setElapsedSeconds(0);
    setVolume(null);
    setErrorMessage(null);

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

      setElapsedSeconds(0);
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

      setElapsedSeconds(0);
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

        setElapsedSeconds(0);
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

    repetitionResultsRef.current = [];
    currentRepRef.current = 1;

    setRepetitionResults([]);
    setCurrentRep(1);

    setElapsedSeconds(0);
    setVolume(null);
    setErrorMessage(null);

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);

    setPhase('instructions');
  }, [
    clearTimers,
    setQuitModalVisible,
    setPhase,
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

  if (isLoadingParams || !params || !tier) {
    return (
      <>
        {quitModal}
        {noAudioModal}

        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level."
          icon="options-outline"
          iconSize={44}
          containerStyle={exerciseStyles.centerScreen}
        />
      </>
    );
  }

  const averageDuration =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, item) =>
            sum + item.measurement.actualDurationSec,
          0,
        ) / repetitionResults.length
      : 0;

  const averageConsistency =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, item) =>
            sum + item.measurement.consistencyPct,
          0,
        ) / repetitionResults.length
      : 0;

  const averageScore =
    repetitionResults.length > 0
      ? Math.round(
          repetitionResults.reduce(
            (sum, item) => sum + item.score.score,
            0,
          ) / repetitionResults.length,
        )
      : 0;

  const passedReps = repetitionResults.filter(
    item => item.score.passed,
  ).length;

  const maxDuration = params.durationRangeSec[1];

  const durationProgress = Math.min(
    elapsedSeconds / maxDuration,
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
          errorMessage={errorMessage}
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
      <View style={exerciseStyles.screen}>
        {quitModal}
        {noAudioModal}

        <ScrollView
          contentContainerStyle={exerciseStyles.recordingContent}
          showsVerticalScrollIndicator={false}
        >

          <View style={exerciseStyles.recordingHeader}>
            <Text style={exerciseStyles.recordingTitle}>
              Sustain "SSSS"
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
                    {
                      scale: 1 + durationProgress * 0.08,
                    },
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

          <View style={exerciseStyles.progressTrack}>
            <View
              style={[
                exerciseStyles.progressFill,
                { width: `${durationProgress * 100}%` },
              ]}
            />
          </View>

          <View style={exerciseStyles.rangeRow}>
            <Text style={exerciseStyles.sessionLabel}>
              {params.durationRangeSec[0]}s
            </Text>

            <Text style={exerciseStyles.progressTime}>
              Target: {targetDuration.toFixed(1)}s
            </Text>

            <Text style={exerciseStyles.sessionLabel}>
              {params.durationRangeSec[1]}s
            </Text>
          </View>

          <LiveVoiceDetectionVisualizer
            detected={isVoiceDetected}
            level={volume ?? 0}
          />
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
          style={exerciseStyles.processingPauseButton}
          onPress={openQuitModal}
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
          <View style={exerciseStyles.scoreBar}>
            <View
              style={[
                exerciseStyles.progressFill,
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

          <View style={exerciseStyles.repResultsCard}>
            <Text style={exerciseStyles.sectionTitle}>
              Repetition Results
            </Text>

            {repetitionResults.map(result => (
              <View
                key={`rep-${result.rep}`}
                style={exerciseStyles.repResultRow}
              >
                <View
                  style={[
                    exerciseStyles.repNumber,
                    result.score.passed &&
                      exerciseStyles.resultIconPassed,
                  ]}
                >
                  <Text style={exerciseStyles.componentScore}>
                    {result.rep}
                  </Text>
                </View>

                <View style={exerciseStyles.repResultInfo}>
                  <Text style={exerciseStyles.repResultTitle}>
                    Repetition {result.rep}
                  </Text>

                  <Text style={exerciseStyles.repResultDetails}>
                    {result.measurement.actualDurationSec.toFixed(1)}
                    s
                    {' • '}
                    {Math.round(
                      result.measurement.consistencyPct,
                    )}
                    % consistency
                  </Text>
                </View>

                <View style={exerciseStyles.repScoreContainer}>
                  <Text style={exerciseStyles.resultStatValue}>
                    {result.score.score}
                  </Text>

                  <Text style={exerciseStyles.repScorePercent}>
                    %
                  </Text>
                </View>
              </View>
            ))}
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

              <Text style={exerciseStyles.feedbackText}>
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
