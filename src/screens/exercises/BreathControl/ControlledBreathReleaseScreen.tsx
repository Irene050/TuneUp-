
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  View,
} from 'react-native';

import {
  CONTROLLED_BREATH_RELEASE_PARAMS,
  type ControlledBreathReleaseParams,
  type Tier,
} from '@/constants/exercises/breathControl';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { auth } from '@/services/firebase/config';

import {
  measureControlledBreathRelease,
  type ControlledBreathReleaseMeasurement,
} from '@/services/measurement/breathControl/controlledBreathRelease';

import {
  scoreControlledBreathRelease,
  type ControlledBreathReleaseScoreResult,
} from '@/services/scoring/breathControl/controlledBreathRelease';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { getLatestAssessment } from '@/services/assessment/assessmentRepository';

import { generateControlledBreathReleaseParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '../ExerciseScreen';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';
const LIGHT_PINK = '#FFF8FA';

const PREPARATION_COUNTDOWN = 3;
const EXTRA_RECORDING_TIME_SEC = 1;
const GUIDE_TOLERANCE_SEC = 0.35;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'finishing'
  | 'processing'
  | 'results';

interface RepResult {
  rep: number;
  measurement: ControlledBreathReleaseMeasurement;
  score: ControlledBreathReleaseScoreResult;
}

export default function ControlledBreathReleaseScreen({
  tier: initialTier,
}: Props) {
  // ADAPTIVE PARAMETERS

  const [tier, setTier] = useState<Tier | null>(
    initialTier ?? null,
  );

  const tierRef = useRef<Tier>(initialTier ?? 'beginner');

  const [params, setParams] =
    useState<ControlledBreathReleaseParams>(
      CONTROLLED_BREATH_RELEASE_PARAMS[
        initialTier ?? 'beginner'
      ],
    );

  const paramsRef = useRef<ControlledBreathReleaseParams>(
    CONTROLLED_BREATH_RELEASE_PARAMS[
      initialTier ?? 'beginner'
    ],
  );

  const [paramsReady, setParamsReady] = useState(false);

  // EXERCISE STATE

  const [phase, setPhase] = useState<Phase>('instructions');
  const phaseRef = useRef<Phase>('instructions');

  const [countdown, setCountdown] = useState(
    PREPARATION_COUNTDOWN,
  );

  const [elapsed, setElapsed] = useState(0);
  const [targetRecordingDuration, setTargetRecordingDuration] =
    useState(0);
  const [volume, setVolume] = useState(0);
  const [guidedPulse, setGuidedPulse] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [repResults, setRepResults] = useState<RepResult[]>([]);

  const currentRepRef = useRef(1);
  const repResultsRef = useRef<RepResult[]>([]);
  const guidedPulseRef = useRef(0);
  const mountedRef = useRef(true);

  const startRecordingRef = useRef<
    (() => Promise<void>) | null
  >(null);

  const stopRecordingRef = useRef<(() => void) | null>(null);
  const startRecordingPhaseRef = useRef<(() => void) | null>(null);
  const startCountdownRef = useRef<(() => void) | null>(null);

  const transitionTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  // ADAPTIVE PARAMETER INITIALIZATION

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParams = async () => {
      let currentTier: Tier = initialTier ?? 'beginner';
      let referenceScores: number[] = [];

      const initialDefaultParams =
        CONTROLLED_BREATH_RELEASE_PARAMS[currentTier];

      paramsRef.current = initialDefaultParams;
      setParams(initialDefaultParams);
      setParamsReady(false);

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
          'Failed to load Controlled Breath Release tier:',
          error,
        );

        currentTier = initialTier ?? 'beginner';
      }

      if (cancelled) return;

      tierRef.current = currentTier;
      setTier(currentTier);

      const defaultParams =
        CONTROLLED_BREATH_RELEASE_PARAMS[currentTier];

      paramsRef.current = defaultParams;
      setParams(defaultParams);

      try {
        const user = auth.currentUser;

        if (!user) {
          paramsRef.current = defaultParams;
          setParams(defaultParams);
          setParamsReady(true);
          return;
        }

        const exerciseRecords = await fetchExerciseRecords(
          user.uid,
          'breathControl',
        );

        const currentExerciseRecords = exerciseRecords.filter(
          record =>
            record.templateId === 'controlledBreathRelease' &&
            record.tier === currentTier,
        );

        referenceScores = currentExerciseRecords
          .slice(-5)
          .map(record => record.scorePct);

        if (referenceScores.length > 0) {
          console.log(
            'Controlled Breath Release ADS history:',
            referenceScores,
          );
        }

        // Use assessment only for cold start.
        if (referenceScores.length === 0) {
          const assessment = await getLatestAssessment();

          const assessmentScore = assessment?.scores.find(
            score => score.componentId === 'breathControl',
          )?.scorePct;

          if (typeof assessmentScore === 'number') {
            referenceScores = [assessmentScore];

            console.log(
              'Controlled Breath Release ADS assessment reference:',
              assessmentScore,
            );
          }
        }

        const generatedParams =
          generateControlledBreathReleaseParams({
            tier: currentTier,
            recentScores: referenceScores,
          });

        if (cancelled) return;

        paramsRef.current = generatedParams;
        setParams(generatedParams);
        setParamsReady(true);

        console.log('Controlled Breath Release parameters:', {
          tier: currentTier,
          referenceScores,
          generatedParams,
        });
      } catch (error) {
        console.error(
          'Failed to load Controlled Breath Release ADS parameters:',
          error,
        );

        if (!cancelled) {
          paramsRef.current = defaultParams;
          setParams(defaultParams);
          setParamsReady(true);
        }
      }
    };

    void loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [initialTier]);

  // TIMER MANAGEMENT

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

  const secondsRemaining = Math.max(
    0,
    targetRecordingDuration - elapsed,
  );

  // FINISH EXERCISE

  const finishExercise = useCallback(async () => {
    clearTimers();

    if (!mountedRef.current) return;

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

    console.log(
      'Final Controlled Breath Release score:',
      finalScore,
    );

    try {
      await saveCompletedExercise(
        'breathControl',
        'controlledBreathRelease',
        tierRef.current,
        finalScore,
      );

      console.log('Controlled Breath Release progress saved');
    } catch (saveError) {
      console.error(
        'Failed to save Controlled Breath Release progress:',
        saveError,
      );
    }

    if (!mountedRef.current) return;

    phaseRef.current = 'results';
    setPhase('results');

    setElapsed(0);
    setTargetRecordingDuration(0);
    setVolume(0);
    setGuidedPulse(0);
    guidedPulseRef.current = 0;
  }, [clearTimers]);

  // HANDLE RECORDING STOP

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (!mountedRef.current) return;

      if (
        phaseRef.current !== 'recording' &&
        phaseRef.current !== 'finishing'
      ) {
        return;
      }

      clearTimers();

      phaseRef.current = 'processing';
      setPhase('processing');

      setElapsed(0);
      setTargetRecordingDuration(0);
      setVolume(0);
      setGuidedPulse(0);
      guidedPulseRef.current = 0;

      const adaptiveParams = paramsRef.current;

      const measurement = measureControlledBreathRelease(
        samples,
        adaptiveParams.intervalSec,
        sampleRate,
      );

      const score = scoreControlledBreathRelease(
        measurement,
        adaptiveParams,
      );

      console.log('Controlled Breath Release rep result:', {
        repetition: currentRepRef.current,
        sampleCount: samples.length,
        sampleRate,
        durationSec: samples.length / sampleRate,
        detectedPulses: measurement.peaks.length,
        pulseConsistencyPct: measurement.pulseConsistencyPct,
        intervalAccuracyPct: measurement.intervalAccuracyPct,
        consistencyContribution: Math.round(
          Math.max(
            0,
            Math.min(100, measurement.pulseConsistencyPct),
          ) * 0.6,
        ),
        intervalContribution: Math.round(
          Math.max(
            0,
            Math.min(100, measurement.intervalAccuracyPct),
          ) * 0.4,
        ),
        score: score.score,
        passed: score.passed,
      });

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

        if (!mountedRef.current) return;
        if (phaseRef.current !== 'processing') return;

        if (
          currentRepRef.current >=
          adaptiveParams.repetitions
        ) {
          void finishExercise();
          return;
        }

        currentRepRef.current += 1;
        setCurrentRep(currentRepRef.current);

        startCountdownRef.current?.();
      }, 700);
    },
    [clearTimers, finishExercise],
  );

  // AUDIO RECORDER

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: frame => {
      if (!mountedRef.current) return;

      const volumeDb = frame.volume;

      const normalizedVolume = Number.isFinite(volumeDb)
        ? Math.max(0, Math.min(1, (volumeDb + 45) / 45))
        : 0;

      setVolume(normalizedVolume);
    },
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  // RECORDING PHASE

  const startRecordingPhase = useCallback(() => {
    if (!mountedRef.current) return;

    clearTimers();

    const adaptiveParams = paramsRef.current;

    const guideDuration =
      adaptiveParams.pulseCount *
      adaptiveParams.intervalSec;

    const recordingDuration =
      guideDuration + EXTRA_RECORDING_TIME_SEC;

    setTargetRecordingDuration(guideDuration);

    phaseRef.current = 'recording';
    setPhase('recording');

    setElapsed(0);
    setVolume(0);

    const firstPulse =
      adaptiveParams.pulseCount > 0 ? 1 : 0;

    guidedPulseRef.current = firstPulse;
    setGuidedPulse(firstPulse);

    void (async () => {
      try {
        const startRecorder = startRecordingRef.current;

        if (!startRecorder) {
          throw new Error('Audio recorder is not ready.');
        }

        await startRecorder();

        if (
          !mountedRef.current ||
          phaseRef.current !== 'recording'
        ) {
          stopRecordingRef.current?.();
          return;
        }

        const startedAt = Date.now();

        recordingTimerRef.current = setInterval(() => {
          if (!mountedRef.current) return;

          const currentPhase = phaseRef.current;

          if (
            currentPhase !== 'recording' &&
            currentPhase !== 'finishing'
          ) {
            return;
          }

          const elapsedSeconds =
            (Date.now() - startedAt) / 1000;

          setElapsed(
            Math.min(elapsedSeconds, guideDuration),
          );

          const nextGuidedPulse =
            adaptiveParams.pulseCount > 0
              ? Math.min(
                  adaptiveParams.pulseCount,
                  Math.floor(
                    elapsedSeconds /
                      adaptiveParams.intervalSec,
                  ) + 1,
                )
              : 0;

          if (
            currentPhase === 'recording' &&
            nextGuidedPulse !== guidedPulseRef.current
          ) {
            guidedPulseRef.current = nextGuidedPulse;
            setGuidedPulse(nextGuidedPulse);
          }

          if (
            elapsedSeconds >= guideDuration &&
            phaseRef.current === 'recording'
          ) {
            setElapsed(guideDuration);

            phaseRef.current = 'finishing';
            setPhase('finishing');
          }

          if (elapsedSeconds >= recordingDuration) {
            if (recordingTimerRef.current) {
              clearInterval(recordingTimerRef.current);
              recordingTimerRef.current = null;
            }

            setElapsed(guideDuration);
            stopRecordingRef.current?.();
          }
        }, 50);
      } catch (error) {
        console.error(
          'Failed to start Controlled Breath Release recording:',
          error,
        );

        if (
          mountedRef.current &&
          phaseRef.current === 'recording'
        ) {
          clearTimers();

          phaseRef.current = 'instructions';
          setPhase('instructions');

          setElapsed(0);
          setTargetRecordingDuration(0);
          setGuidedPulse(0);
          guidedPulseRef.current = 0;
        }
      }
    })();
  }, [clearTimers]);

  useEffect(() => {
    startRecordingPhaseRef.current = startRecordingPhase;
  }, [startRecordingPhase]);

  // PREPARATION COUNTDOWN

  const startCountdown = useCallback(() => {
    if (!mountedRef.current) return;

    clearTimers();

    phaseRef.current = 'countdown';
    setPhase('countdown');

    setCountdown(PREPARATION_COUNTDOWN);
    setElapsed(0);
    setTargetRecordingDuration(0);
    setVolume(0);
    setGuidedPulse(0);
    guidedPulseRef.current = 0;

    let value = PREPARATION_COUNTDOWN;

    countdownTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;

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
  }, [clearTimers]);

  useEffect(() => {
    startCountdownRef.current = startCountdown;
  }, [startCountdown]);

  // START / RETRY

  const startExercise = useCallback(() => {
    if (!paramsReady) {
      console.log(
        'Controlled Breath Release parameters are still loading.',
      );
      return;
    }

    repResultsRef.current = [];
    currentRepRef.current = 1;
    guidedPulseRef.current = 0;

    setRepResults([]);
    setCurrentRep(1);
    setElapsed(0);
    setTargetRecordingDuration(0);
    setVolume(0);
    setGuidedPulse(0);

    startCountdown();
  }, [paramsReady, startCountdown]);

  const retryExercise = useCallback(() => {
    repResultsRef.current = [];
    currentRepRef.current = 1;
    guidedPulseRef.current = 0;

    setRepResults([]);
    setCurrentRep(1);
    setElapsed(0);
    setTargetRecordingDuration(0);
    setVolume(0);
    setGuidedPulse(0);

    startCountdown();
  }, [startCountdown]);

  // CLEANUP

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearTimers();
      stopRecordingRef.current?.();
    };
  }, [clearTimers]);

  // RESULT CALCULATIONS

  const averageScore =
    repResults.length > 0
      ? Math.round(
          repResults.reduce(
            (sum, result) => sum + result.score.score,
            0,
          ) / repResults.length,
        )
      : 0;

  const averagePulseConsistency =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum + result.measurement.pulseConsistencyPct,
          0,
        ) / repResults.length
      : 0;

  const averageIntervalAccuracy =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum + result.measurement.intervalAccuracyPct,
          0,
        ) / repResults.length
      : 0;

  const averageDetectedPulses =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum + result.measurement.peaks.length,
          0,
        ) / repResults.length
      : 0;

  const passedReps = repResults.filter(
    result => result.score.passed,
  ).length;

  // PULSE GUIDE

  const pulseGuideProgress =
    params.pulseCount > 0
      ? Math.min(guidedPulse / params.pulseCount, 1)
      : 0;

  const isFinalPulse =
    guidedPulse > 0 &&
    guidedPulse === params.pulseCount;

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
      ? Math.max(
          0,
          guidedPulse * params.intervalSec - elapsed,
        )
      : 0;

  // BACK TO INSTRUCTIONS

  const returnToInstructions = useCallback(() => {
    phaseRef.current = 'instructions';

    clearTimers();
    stopRecordingRef.current?.();

    guidedPulseRef.current = 0;

    setElapsed(0);
    setTargetRecordingDuration(0);
    setVolume(0);
    setGuidedPulse(0);
    setPhase('instructions');
  }, [clearTimers]);

  const handleBack = () => {
    if (phase === 'instructions') {
      router.back();
      return;
    }

    returnToInstructions();
  };

  // ADAPTIVE PARAMETER LOADING SCREEN

  if (!paramsReady || !tier) {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.largeIconCircle}>
          <Ionicons
            name="options-outline"
            size={44}
            color={BROWN}
          />
        </View>

        <Text style={styles.processingTitle}>
          Preparing Your Exercise
        </Text>

        <Text style={styles.processingSubtitle}>
          Adjusting the exercise to your current difficulty level
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  }

  // INSTRUCTIONS

  if (phase === 'instructions') {
    return (
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
        tip="Focus on control rather than releasing your breath too quickly. The app will continuously record your breath and analyze the actual timing between detected pulses."
        tier={tier}
        onBack={() => router.back()}
        onStart={startExercise}
        startDisabled={!paramsReady}
        startLabel={paramsReady ? 'Start Exercise' : 'Loading...'}
      />
    );
  }

  // COUNTDOWN

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="pulse-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={params.repetitions}
        countdown={countdown}
        promptTitle="Prepare your breath"
        prompt="Take a comfortable breath. The app will guide each controlled release pulse while continuously recording."
        onBack={handleBack}
      />
    );
  }

  // FINISHING / PROCESSING

  if (phase === 'finishing' || phase === 'processing') {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title={
          phase === 'finishing'
            ? 'Finishing Audio Capture'
            : 'Analyzing Your Breath Pulses'
        }
        message={
          phase === 'finishing'
            ? 'Pulse sequence complete. Please relax while the recording finishes.'
            : 'Checking pulse consistency and measuring the actual time between detected pulses...'
        }
        onBack={returnToInstructions}
      />
    );
  }

  // RECORDING

  if (phase === 'recording') {
    return (
      <ExerciseListeningScreen
        icon="pulse-outline"
        title="Controlled Breath Release"
        currentRep={currentRep}
        repetitions={params.repetitions}
        elapsed={elapsed}
        targetDuration={targetRecordingDuration}
        promptTitle={
          isFinalPulse
            ? `FINAL PULSE ${guidedPulse} OF ${params.pulseCount}`
            : `PULSE ${guidedPulse} OF ${params.pulseCount}`
        }
        prompt={
          currentPulseIsDue
            ? 'RELEASE A SHORT, GENTLE PULSE NOW'
            : isFinalPulse
              ? `Final Pulse — ${secondsRemaining.toFixed(1)}s remaining`
              : `Next pulse in ${nextPulseIn.toFixed(1)}s`
        }
        progress={pulseGuideProgress * 100}
        liveContent={
          <View>
            <View style={styles.pulseGuideCard}>
              <Text style={styles.pulseGuideLabel}>
                PULSE GUIDE
              </Text>

              <Text style={styles.pulseGuideValue}>
                {guidedPulse}
                <Text style={styles.pulseGuideTotal}>
                  {' '}
                  / {params.pulseCount}
                </Text>
              </Text>

              <Text style={styles.pulseGuideInstruction}>
                {currentPulseIsDue
                  ? 'Release one short, gentle breath pulse now.'
                  : isFinalPulse
                    ? `Release Final Pulse for ${secondsRemaining.toFixed(1)}s`
                    : `Prepare for the next pulse in ${nextPulseIn.toFixed(1)} seconds.`}
              </Text>

              <View style={styles.pulseDots}>
                {Array.from({
                  length: params.pulseCount,
                }).map((_, index) => {
                  const pulseNumber = index + 1;
                  const completed = pulseNumber < guidedPulse;
                  const active = pulseNumber === guidedPulse;

                  return (
                    <View
                      key={`pulse-${pulseNumber}`}
                      style={[
                        styles.pulseDot,
                        completed && styles.pulseDotCompleted,
                        active && styles.pulseDotActive,
                      ]}
                    />
                  );
                })}
              </View>
            </View>

            <View style={styles.airflowCard}>
              <Text style={styles.airflowLabel}>
                AIRFLOW
              </Text>

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

              <Text style={styles.airflowHint}>
                Keep each pulse gentle and controlled
              </Text>
            </View>
          </View>
        }
        onBack={handleBack}
      />
    );
  }

  // RESULTS

  return (
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
      onBack={returnToInstructions}
      onRetry={retryExercise}
      onExit={() =>
        router.replace('/dashboard?tab=exercises')
      }
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

        {repResults.map(result => {
          // Match the scoring function's clamping and weights.
          const consistencyScore = Math.max(
            0,
            Math.min(
              100,
              result.measurement.pulseConsistencyPct,
            ),
          );

          const intervalScore = Math.max(
            0,
            Math.min(
              100,
              result.measurement.intervalAccuracyPct,
            ),
          );

          const consistencyContribution =
            consistencyScore * 0.6;

          const intervalContribution =
            intervalScore * 0.4;

          return (
            <View key={`rep-${result.rep}`} style={styles.repCard}>
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
                  label="Pulses Detected"
                  value={`${result.measurement.peaks.length}/${params.pulseCount}`}
                />

                <Metric
                  label="Pulse Consistency"
                  value={`${Math.round(consistencyScore)}%`}
                />

                <Metric
                  label="Interval Accuracy"
                  value={`${Math.round(intervalScore)}%`}
                />

                <Metric
                  label="Final Score"
                  value={`${result.score.score}%`}
                />
              </View>

              {/* SCORING BREAKDOWN */}
              <View style={styles.scoreBreakdown}>
                <Text style={styles.breakdownTitle}>
                  Score Breakdown
                </Text>

                <View style={styles.breakdownRow}>
                  <View style={styles.breakdownTextGroup}>
                    <Text style={styles.breakdownLabel}>
                      Pulse Consistency
                    </Text>
                    <Text style={styles.breakdownHint}>
                      {consistencyScore.toFixed(1)}% × 60%
                    </Text>
                  </View>

                  <Text style={styles.breakdownValue}>
                    {consistencyContribution.toFixed(1)} pts
                  </Text>
                </View>

                <View style={styles.breakdownRow}>
                  <View style={styles.breakdownTextGroup}>
                    <Text style={styles.breakdownLabel}>
                      Interval Accuracy
                    </Text>
                    <Text style={styles.breakdownHint}>
                      {intervalScore.toFixed(1)}% × 40%
                    </Text>
                  </View>

                  <Text style={styles.breakdownValue}>
                    {intervalContribution.toFixed(1)} pts
                  </Text>
                </View>

                <View style={styles.breakdownDivider} />

                <View style={styles.breakdownTotal}>
                  <Text style={styles.breakdownTotalLabel}>
                    Final Repetition Score
                  </Text>

                  <Text style={styles.breakdownTotalValue}>
                    {result.score.score}%
                  </Text>
                </View>

                <Text style={styles.breakdownNote}>
                  Passing also requires enough detected pulses
                  and the required pulse consistency.
                </Text>
              </View>

              {/* DETECTED PULSE INTERVALS */}
              <View style={styles.intervalsCard}>
                <Text style={styles.intervalsTitle}>
                  Detected Pulse Intervals
                </Text>

                {result.measurement.peaks.length >= 2 ? (
                  result.measurement.peaks
                    .slice(1)
                    .map((peak, index) => {
                      const previousPeak =
                        result.measurement.peaks[index];

                      const interval =
                        peak.timestamp - previousPeak.timestamp;

                      return (
                        <View
                          key={`interval-${result.rep}-${index}`}
                          style={styles.intervalRow}
                        >
                          <Text style={styles.intervalLabel}>
                            Pulse {index + 1} → {index + 2}
                          </Text>

                          <Text style={styles.intervalValue}>
                            {interval.toFixed(2)} s
                          </Text>
                        </View>
                      );
                    })
                ) : (
                  <Text style={styles.noIntervalsText}>
                    Not enough detected pulses to calculate intervals.
                  </Text>
                )}

                {result.measurement.peaks.length >= 2 && (
                  <Text style={styles.targetIntervalText}>
                    Target interval: {params.intervalSec.toFixed(2)} s
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </ExerciseResultsScreen>
  );
}

// RESULT COMPONENTS

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

// STYLES

const styles = {
  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 30,
  },

  largeIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PINK,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 22,
  },

  processingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center' as const,
  },

  processingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center' as const,
    marginTop: 6,
  },

  spinner: {
    marginTop: 28,
  },

  pulseGuideCard: {
    backgroundColor: WHITE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    alignItems: 'center' as const,
  },

  pulseGuideLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 1,
    color: MUTED,
  },

  pulseGuideValue: {
    fontFamily: 'FredokaBold',
    fontSize: 32,
    color: BROWN,
    marginTop: 2,
  },

  pulseGuideTotal: {
    fontFamily: 'FredokaRegular',
    fontSize: 18,
    color: MUTED,
  },

  pulseGuideInstruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    textAlign: 'center' as const,
    marginTop: 3,
  },

  pulseDots: {
    width: '100%',
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    justifyContent: 'center' as const,
    gap: 7,
    marginTop: 13,
  },

  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    borderWidth: 1,
    borderColor: BORDER,
  },

  pulseDotCompleted: {
    backgroundColor: PINK,
    borderColor: BROWN,
  },

  pulseDotActive: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: BROWN,
    borderColor: BROWN,
    marginTop: -2,
  },

  airflowCard: {
    width: '100%',
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  airflowLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 1,
    color: MUTED,
    textAlign: 'center' as const,
  },

  airflowIndicator: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden' as const,
    marginTop: 9,
  },

  airflowFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: BROWN,
  },

  airflowHint: {
    marginTop: 6,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center' as const,
  },

  statsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginTop: 12,
  },

  resultStat: {
    width: '48%' as const,
    flexGrow: 1,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center' as const,
  },

  resultStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
  },

  resultStatLabel: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center' as const,
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
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
  },

  repTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
    flexShrink: 1,
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
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    marginTop: 13,
    gap: 8,
  },

  metric: {
    width: '47%' as const,
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

  scoreBreakdown: {
    marginTop: 14,
    padding: 12,
    backgroundColor: LIGHT_PINK,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },

  breakdownTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
    marginBottom: 12,
  },

  breakdownRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
    marginBottom: 12,
  },

  breakdownTextGroup: {
    flex: 1,
  },

  breakdownLabel: {
    fontFamily: 'FredokaMedium',
    fontSize: 12,
    color: BROWN,
  },

  breakdownHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 3,
  },

  breakdownValue: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
  },

  breakdownDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 2,
  },

  breakdownTotal: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingTop: 9,
  },

  breakdownTotalLabel: {
    flex: 1,
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },

  breakdownTotalValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
  },

  breakdownNote: {
    marginTop: 9,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
  },

  intervalsCard: {
    marginTop: 14,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  intervalsTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
    marginBottom: 7,
  },

  intervalRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 4,
  },

  intervalLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  intervalValue: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
  },

  targetIntervalText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 7,
  },

  noIntervalsText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
  },
} as const;
