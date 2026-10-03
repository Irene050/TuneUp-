// src/screens/exercises/BreathControl/ControlledBreathReleaseScreen.tsx

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
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
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '../ExerciseScreen';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const PREPARATION_COUNTDOWN = 3;
const EXTRA_RECORDING_TIME_SEC = 1;

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
  measurement: ControlledBreathReleaseMeasurement;
  score: ControlledBreathReleaseScoreResult;
}

export default function ControlledBreathReleaseScreen({
  tier: initialTier,
}: Props) {
  /*
   * =====================================================
   * ADAPTIVE PARAMETERS
   * =====================================================
   */

  const [tier, setTier] = useState<Tier | null>(
    initialTier ?? null,
  );

  const tierRef = useRef<Tier>(
    initialTier ?? 'beginner',
  );

  const [params, setParams] =
    useState<ControlledBreathReleaseParams>(
      CONTROLLED_BREATH_RELEASE_PARAMS[
        initialTier ?? 'beginner'
      ],
    );

  const paramsRef =
    useRef<ControlledBreathReleaseParams>(
      CONTROLLED_BREATH_RELEASE_PARAMS[
        initialTier ?? 'beginner'
      ],
    );

  const [paramsReady, setParamsReady] =
    useState(false);

  /*
   * =====================================================
   * EXERCISE STATE
   * =====================================================
   */

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const phaseRef =
    useRef<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(PREPARATION_COUNTDOWN);

  const [elapsed, setElapsed] =
    useState(0);

  const [volume, setVolume] =
    useState(0);

  const [currentRep, setCurrentRep] =
    useState(1);

  const currentRepRef =
    useRef(1);

  const [repResults, setRepResults] =
    useState<RepResult[]>([]);

  const repResultsRef =
    useRef<RepResult[]>([]);

  const mountedRef =
    useRef(true);

  /*
   * =====================================================
   * RECORDER REFS
   * =====================================================
   */

  const startRecordingRef = useRef<
    (() => Promise<void>) | null
  >(null);

  const stopRecordingRef =
    useRef<(() => void) | null>(null);

  const startRecordingPhaseRef =
    useRef<(() => void) | null>(null);

  const startCountdownRef =
    useRef<(() => void) | null>(null);

  /*
   * =====================================================
   * TIMERS
   * =====================================================
   */

  const countdownTimerRef = useRef<
    ReturnType<typeof setInterval> | null
  >(null);

  const recordingTimerRef = useRef<
    ReturnType<typeof setInterval> | null
  >(null);

  /*
   * =====================================================
   * ADAPTIVE PARAMETER INITIALIZATION
   * =====================================================
   *
   * Priority:
   *
   * 1. Explicit tier prop
   * 2. Saved component progress tier
   * 3. Latest five completed exercises for this
   *    exercise and current tier
   * 4. Latest Breath Control assessment score
   * 5. Default current-tier parameters
   */

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParams =
      async () => {
        let currentTier: Tier =
          initialTier ?? 'beginner';

        let referenceScores: number[] =
          [];

        /*
         * Reset to the default parameters
         * while adaptive data is loading.
         */

        const initialDefaultParams =
          CONTROLLED_BREATH_RELEASE_PARAMS[
            currentTier
          ];

        paramsRef.current =
          initialDefaultParams;

        setParams(
          initialDefaultParams,
        );

        setParamsReady(false);

        /*
         * ---------------------------------------------
         * STEP 1: RESOLVE CURRENT TIER
         * ---------------------------------------------
         */

        try {
          const user =
            auth.currentUser;

          if (!initialTier && user) {
            const progress =
              await fetchComponentProgress(
                user.uid,
                'breathControl',
              );

            currentTier =
              progress?.currentTier ??
              'beginner';
          }
        } catch (error) {
          console.error(
            '❌ Failed to load Controlled Breath Release current tier:',
            error,
          );

          currentTier =
            initialTier ?? 'beginner';
        }

        if (cancelled) {
          return;
        }

        tierRef.current =
          currentTier;

        setTier(currentTier);

        /*
         * Make sure the fallback parameters
         * match the resolved tier.
         */

        const defaultParams =
          CONTROLLED_BREATH_RELEASE_PARAMS[
            currentTier
          ];

        paramsRef.current =
          defaultParams;

        setParams(
          defaultParams,
        );

        /*
         * ---------------------------------------------
         * STEP 2: LOAD EXERCISE HISTORY
         * ---------------------------------------------
         */

        try {
          const user =
            auth.currentUser;

          /*
           * No authenticated user:
           * use current-tier defaults.
           */

          if (!user) {
            console.log(
              'ℹ️ No authenticated user. Using default Controlled Breath Release parameters.',
            );

            if (!cancelled) {
              paramsRef.current =
                defaultParams;

              setParams(
                defaultParams,
              );

              setParamsReady(true);
            }

            return;
          }

          const exerciseRecords =
            await fetchExerciseRecords(
              user.uid,
              'breathControl',
            );

          /*
           * Only use history from:
           *
           * - Breath Control
           * - Controlled Breath Release
           * - current tier
           */

          const currentExerciseRecords =
            exerciseRecords.filter(
              record =>
                record.templateId ===
                  'controlledBreathRelease' &&
                record.tier ===
                  currentTier,
            );

          referenceScores =
            currentExerciseRecords
              .slice(-5)
              .map(
                record =>
                  record.scorePct,
              );

          if (
            referenceScores.length > 0
          ) {
            console.log(
              '📊 Controlled Breath Release ADS reference from exercise history:',
              referenceScores,
            );
          }

          /*
           * -------------------------------------------
           * STEP 3: ASSESSMENT COLD START
           * -------------------------------------------
           *
           * Assessment is only used when there
           * is no exercise history for this
           * exercise/current tier.
           */

          if (
            referenceScores.length === 0
          ) {
            const assessment =
              await getLatestAssessment();

            const assessmentScore =
              assessment?.scores.find(
                score =>
                  score.componentId ===
                  'breathControl',
              )?.scorePct;

            if (
              typeof assessmentScore ===
              'number'
            ) {
              referenceScores = [
                assessmentScore,
              ];

              console.log(
                '📋 Controlled Breath Release ADS reference from assessment:',
                assessmentScore,
              );
            } else {
              console.log(
                'ℹ️ No Controlled Breath Release history or Breath Control assessment score. Using default parameters.',
              );
            }
          }

          /*
           * -------------------------------------------
           * STEP 4: GENERATE ADAPTIVE PARAMETERS
           * -------------------------------------------
           */

          const generatedParams =
            generateControlledBreathReleaseParams(
              {
                tier: currentTier,
                recentScores:
                  referenceScores,
              },
            );

          if (cancelled) {
            return;
          }

          paramsRef.current =
            generatedParams;

          setParams(
            generatedParams,
          );

          setParamsReady(true);

          console.log(
            '🎯 Controlled Breath Release adaptive parameters:',
            {
              tier: currentTier,
              referenceScores,
              generatedParams,
            },
          );
        } catch (error) {
          console.error(
            '❌ Failed to load Controlled Breath Release ADS parameters:',
            error,
          );

          /*
           * Safely fall back to the resolved
           * current-tier defaults.
           */

          if (!cancelled) {
            paramsRef.current =
              defaultParams;

            setParams(
              defaultParams,
            );

            setParamsReady(true);
          }
        }
      };

    loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [initialTier]);

  /*
   * =====================================================
   * TIMER MANAGEMENT
   * =====================================================
   */

  const clearTimers =
    useCallback(() => {
      if (countdownTimerRef.current) {
        clearInterval(
          countdownTimerRef.current,
        );

        countdownTimerRef.current =
          null;
      }

      if (recordingTimerRef.current) {
        clearInterval(
          recordingTimerRef.current,
        );

        recordingTimerRef.current =
          null;
      }
    }, []);

  /*
   * =====================================================
   * FINISH EXERCISE
   * =====================================================
   */

  const finishExercise =
    useCallback(
      async () => {
        clearTimers();

        if (!mountedRef.current) {
          return;
        }

        const finalResults =
          repResultsRef.current;

        const finalScore =
          finalResults.length > 0
            ? Math.round(
                finalResults.reduce(
                  (sum, result) =>
                    sum +
                    result.score.score,
                  0,
                ) /
                  finalResults.length,
              )
            : 0;

        console.log(
          '🏆 Final Controlled Breath Release score:',
          finalScore,
        );

        try {
          const activeTier =
            tierRef.current;

          await saveCompletedExercise(
            'breathControl',
            'controlledBreathRelease',
            activeTier,
            finalScore,
          );

          console.log(
            '💾 Controlled Breath Release progress saved',
          );
        } catch (saveError) {
          console.error(
            '❌ Failed to save Controlled Breath Release progress:',
            saveError,
          );
        }

        if (!mountedRef.current) {
          return;
        }

        phaseRef.current =
          'results';

        setPhase('results');

        setElapsed(0);
        setVolume(0);
      },
      [clearTimers],
    );

  /*
   * =====================================================
   * HANDLE RECORDING STOP
   * =====================================================
   */

  const handleRecordingStop =
    useCallback(
      (
        samples: Float32Array,
        sampleRate: number,
      ) => {
        if (!mountedRef.current) {
          return;
        }

        /*
         * Ignore recorder callbacks that happen
         * after leaving the recording phase.
         */

        if (
          phaseRef.current !==
          'recording'
        ) {
          return;
        }

        clearTimers();

        phaseRef.current =
          'processing';

        setPhase('processing');

        setElapsed(0);
        setVolume(0);

        /*
         * Always use the current adaptive
         * parameters through the ref.
         */

        const adaptiveParams =
          paramsRef.current;

        const measurement =
          measureControlledBreathRelease(
            samples,
            adaptiveParams.intervalSec,
            sampleRate,
          );

        const score =
          scoreControlledBreathRelease(
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

        repResultsRef.current =
          updatedResults;

        setRepResults(
          updatedResults,
        );

        setTimeout(() => {
          if (!mountedRef.current) {
            return;
          }

          /*
           * Complete the exercise when all
           * adaptive repetitions are finished.
           */

          if (
            currentRepRef.current >=
            adaptiveParams.repetitions
          ) {
            finishExercise();

            return;
          }

          currentRepRef.current += 1;

          setCurrentRep(
            currentRepRef.current,
          );

          startCountdownRef.current?.();
        }, 700);
      },
      [
        clearTimers,
        finishExercise,
      ],
    );

  /*
   * =====================================================
   * AUDIO RECORDER
   * =====================================================
   */

  const {
    isRecording,
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: frame => {
      if (!mountedRef.current) {
        return;
      }

      setVolume(
        frame.volume ?? 0,
      );
    },

    onStop:
      handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current =
      startRecording;

    stopRecordingRef.current =
      stopRecording;
  }, [
    startRecording,
    stopRecording,
  ]);

  /*
   * =====================================================
   * RECORDING PHASE
   * =====================================================
   */

  const startRecordingPhase =
    useCallback(() => {
      if (!mountedRef.current) {
        return;
      }

      clearTimers();

      const adaptiveParams =
        paramsRef.current;

      const recordingDuration =
        adaptiveParams.pulseCount *
          adaptiveParams.intervalSec +
        EXTRA_RECORDING_TIME_SEC;

      phaseRef.current =
        'recording';

      setPhase('recording');

      setElapsed(0);
      setVolume(0);

      startRecordingRef.current?.();

      const startedAt =
        Date.now();

      recordingTimerRef.current =
        setInterval(() => {
          if (!mountedRef.current) {
            return;
          }

          const elapsedSeconds =
            (Date.now() -
              startedAt) /
            1000;

          setElapsed(
            Math.min(
              elapsedSeconds,
              recordingDuration,
            ),
          );

          if (
            elapsedSeconds >=
            recordingDuration
          ) {
            if (
              recordingTimerRef.current
            ) {
              clearInterval(
                recordingTimerRef.current,
              );

              recordingTimerRef.current =
                null;
            }

            stopRecordingRef.current?.();
          }
        }, 50);
    }, [clearTimers]);

  useEffect(() => {
    startRecordingPhaseRef.current =
      startRecordingPhase;
  }, [startRecordingPhase]);

  /*
   * =====================================================
   * PREPARATION COUNTDOWN
   * =====================================================
   */

  const startCountdown =
    useCallback(() => {
      if (!mountedRef.current) {
        return;
      }

      clearTimers();

      phaseRef.current =
        'countdown';

      setPhase('countdown');

      setCountdown(
        PREPARATION_COUNTDOWN,
      );

      setElapsed(0);
      setVolume(0);

      let value =
        PREPARATION_COUNTDOWN;

      countdownTimerRef.current =
        setInterval(() => {
          if (!mountedRef.current) {
            return;
          }

          value -= 1;

          if (value <= 0) {
            if (
              countdownTimerRef.current
            ) {
              clearInterval(
                countdownTimerRef.current,
              );

              countdownTimerRef.current =
                null;
            }

            startRecordingPhaseRef.current?.();

            return;
          }

          setCountdown(value);
        }, 1000);
    }, [clearTimers]);

  useEffect(() => {
    startCountdownRef.current =
      startCountdown;
  }, [startCountdown]);

  /*
   * =====================================================
   * START / RETRY
   * =====================================================
   */

  const startExercise =
    useCallback(() => {
      if (!paramsReady) {
        console.log(
          '⏳ Controlled Breath Release parameters are still loading.',
        );

        return;
      }

      repResultsRef.current =
        [];

      currentRepRef.current =
        1;

      setRepResults([]);

      setCurrentRep(1);

      setElapsed(0);

      setVolume(0);

      startCountdown();
    }, [
      paramsReady,
      startCountdown,
    ]);

  const retryExercise =
    useCallback(() => {
      repResultsRef.current =
        [];

      currentRepRef.current =
        1;

      setRepResults([]);

      setCurrentRep(1);

      setElapsed(0);

      setVolume(0);

      startCountdown();
    }, [startCountdown]);

  /*
   * =====================================================
   * CLEANUP
   * =====================================================
   */

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current =
        false;

      clearTimers();

      stopRecordingRef.current?.();
    };
  }, [clearTimers]);

  /*
   * =====================================================
   * RESULT CALCULATIONS
   * =====================================================
   */

  const averageScore =
    repResults.length > 0
      ? Math.round(
          repResults.reduce(
            (sum, result) =>
              sum +
              result.score.score,
            0,
          ) /
            repResults.length,
        )
      : 0;

  const averagePulseConsistency =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .pulseConsistencyPct,
          0,
        ) /
        repResults.length
      : 0;

  const averageIntervalAccuracy =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .intervalAccuracyPct,
          0,
        ) /
        repResults.length
      : 0;

  const averageDetectedPulses =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .peaks.length,
          0,
        ) /
        repResults.length
      : 0;

  const passedReps =
    repResults.filter(
      result =>
        result.score.passed,
    ).length;

  const recordingDuration =
    params.pulseCount *
      params.intervalSec +
    EXTRA_RECORDING_TIME_SEC;

  const progress =
    recordingDuration > 0
      ? Math.min(
          elapsed /
            recordingDuration,
          1,
        )
      : 0;

  /*
   * =====================================================
   * BACK TO INSTRUCTIONS
   * =====================================================
   */

  const returnToInstructions =
    useCallback(() => {
      /*
       * Set the phase ref first so any
       * asynchronous recorder callback does
       * not process the stopped recording.
       */

      phaseRef.current =
        'instructions';

      clearTimers();

      stopRecordingRef.current?.();

      setElapsed(0);
      setVolume(0);
      setPhase('instructions');
    }, [clearTimers]);

  const handleBack = () => {
    if (phase === 'instructions') {
      router.back();
      return;
    }

    returnToInstructions();
  };

  /*
   * =====================================================
   * ACTIVE RECORDING BACK BUTTON
   * =====================================================
   */

  const renderBackButton =
    () => (
      <Pressable
        style={styles.backButton}
        onPress={handleBack}
      >
        <Ionicons
          name="arrow-back"
          size={22}
          color={BROWN}
        />
      </Pressable>
    );

  /*
   * =====================================================
   * INSTRUCTIONS
   * =====================================================
   */

  if (phase === 'instructions') {
    return (
      <ExerciseScreen
        category="Breath Control"
        title="Controlled Breath Release"
        icon="pulse-outline"
        instructions="Take a comfortable breath, then release it in short, controlled pulses toward the microphone."
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
            text: 'Exhale gently and steadily in controlled pulses.',
          },
          {
            icon: 'mic-outline',
            text: 'Stay close enough to the microphone for consistent audio.',
          },
        ]}
        targetValue={`${params.pulseCount} pulses`}
        targetHint={`${params.intervalSec}s apart`}
        repetitions={params.repetitions}
        tip="Focus on control rather than releasing your breath too quickly. Use comfortable, gentle breath pulses."
        tier={tier}
        onBack={() =>
          router.back()
        }
        onStart={startExercise}
        startDisabled={!paramsReady}
        startLabel={
          paramsReady
            ? 'Start Exercise'
            : 'Loading...'
        }
      />
    );
  }

  /*
   * =====================================================
   * COUNTDOWN
   * =====================================================
   */

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="pulse-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={
          params.repetitions
        }
        countdown={countdown}
        promptTitle="Prepare your breath"
        prompt="Take a comfortable breath and get ready to release short, controlled pulses."
        onBack={handleBack}
      />
    );
  }

  /*
   * =====================================================
   * RECORDING
   * =====================================================
   */

  if (phase === 'recording') {
    return (
      <View
        style={styles.exerciseScreen}
      >
        {renderBackButton()}

        <View
          style={
            styles.exerciseContent
          }
        >
          <Text
            style={styles.phaseLabel}
          >
            CONTROLLED RELEASE
          </Text>

          <Text
            style={styles.repText}
          >
            Repetition {currentRep} of{' '}
            {params.repetitions}
          </Text>

          <View
            style={[
              styles.recordingCircle,
              isRecording &&
                styles.recordingCircleActive,
            ]}
          >
            <Ionicons
              name="pulse-outline"
              size={42}
              color={BROWN}
            />

            <Text
              style={styles.timerText}
            >
              {elapsed.toFixed(1)}
            </Text>

            <Text
              style={styles.timerTarget}
            >
              / {recordingDuration.toFixed(1)}
              s
            </Text>
          </View>

          <Text
            style={
              styles.exerciseTitle
            }
          >
            Release controlled pulses
          </Text>

          <Text
            style={
              styles.exerciseDescription
            }
          >
            Release each pulse gently and
            try to keep the strength and
            spacing consistent.
          </Text>

          {/* TARGET PULSE CARD */}

          <View
            style={
              styles.pulseTargetCard
            }
          >
            <View
              style={
                styles.pulseTargetItem
              }
            >
              <Text
                style={
                  styles.pulseTargetValue
                }
              >
                {params.pulseCount}
              </Text>

              <Text
                style={
                  styles.pulseTargetLabel
                }
              >
                Target Pulses
              </Text>
            </View>

            <View
              style={
                styles.verticalDivider
              }
            />

            <View
              style={
                styles.pulseTargetItem
              }
            >
              <Text
                style={
                  styles.pulseTargetValue
                }
              >
                {params.intervalSec}s
              </Text>

              <Text
                style={
                  styles.pulseTargetLabel
                }
              >
                Pulse Interval
              </Text>
            </View>
          </View>

          {/* LIVE AIRFLOW */}

          <View
            style={styles.airflowCard}
          >
            <Text
              style={
                styles.airflowLabel
              }
            >
              AIRFLOW
            </Text>

            <View
              style={
                styles.airflowIndicator
              }
            >
              <View
                style={[
                  styles.airflowFill,
                  {
                    width: `${Math.min(
                      Math.max(
                        volume * 100,
                        0,
                      ),
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>

            <Text
              style={styles.airflowHint}
            >
              Pulse gently and consistently
            </Text>
          </View>

          <View
            style={
              styles.progressTrack
            }
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progress * 100}%`,
                },
              ]}
            />
          </View>
        </View>
      </View>
    );
  }

  /*
   * =====================================================
   * PROCESSING
   * =====================================================
   */

  if (phase === 'processing') {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your Breath Pulses"
        message="Checking pulse consistency and timing..."
        onBack={
          returnToInstructions
        }
      />
    );
  }

  /*
   * =====================================================
   * RESULTS
   * =====================================================
   */

  return (
    <ExerciseResultsScreen
      title="Exercise Complete"
      subtitle="Your controlled breath release results"
      score={averageScore}
      resultIcon={
        averageScore >= 70
          ? 'checkmark'
          : 'analytics-outline'
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
      onBack={
        returnToInstructions
      }
      onRetry={retryExercise}
      onExit={() =>
        router.replace(
          '/dashboard?tab=exercises',
        )
      }
    >
      <View>
        {/* SUMMARY */}

        <View
          style={styles.statsGrid}
        >
          <ResultStat
            label="Pulse Consistency"
            value={`${Math.round(
              averagePulseConsistency,
            )}%`}
          />

          <ResultStat
            label="Interval Accuracy"
            value={`${Math.round(
              averageIntervalAccuracy,
            )}%`}
          />

          <ResultStat
            label="Avg. Pulses"
            value={averageDetectedPulses.toFixed(
              1,
            )}
          />

          <ResultStat
            label="Passed"
            value={`${passedReps}/${repResults.length}`}
          />
        </View>

        {/* REP RESULTS */}

        <Text
          style={
            styles.resultsSectionTitle
          }
        >
          Repetition Results
        </Text>

        {repResults.map(result => (
          <View
            key={`rep-${result.rep}`}
            style={styles.repCard}
          >
            <View
              style={styles.repHeader}
            >
              <Text
                style={styles.repTitle}
              >
                Repetition {result.rep}
              </Text>

              <View
                style={[
                  styles.passBadge,
                  !result.score.passed &&
                    styles.failBadge,
                ]}
              >
                <Text
                  style={
                    styles.passBadgeText
                  }
                >
                  {result.score.passed
                    ? 'PASS'
                    : 'KEEP PRACTICING'}
                </Text>
              </View>
            </View>

            <View
              style={styles.repMetrics}
            >
              <Metric
                label="Pulses"
                value={`${result.measurement.peaks.length}/${params.pulseCount}`}
              />

              <Metric
                label="Consistency"
                value={`${Math.round(
                  result.measurement
                    .pulseConsistencyPct,
                )}%`}
              />

              <Metric
                label="Interval Accuracy"
                value={`${Math.round(
                  result.measurement
                    .intervalAccuracyPct,
                )}%`}
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
  );
}

/*
 * =====================================================
 * RESULT COMPONENTS
 * =====================================================
 */

function ResultStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View
      style={styles.resultStat}
    >
      <Text
        style={
          styles.resultStatValue
        }
      >
        {value}
      </Text>

      <Text
        style={
          styles.resultStatLabel
        }
      >
        {label}
      </Text>
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
    <View
      style={styles.metric}
    >
      <Text
        style={styles.metricLabel}
      >
        {label}
      </Text>

      <Text
        style={styles.metricValue}
      >
        {value}
      </Text>
    </View>
  );
}

/*
 * =====================================================
 * STYLES
 * =====================================================
 */

const styles = StyleSheet.create({
  /*
   * -----------------------------------------------------
   * ACTIVE RECORDING
   * -----------------------------------------------------
   */

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,

    width: 44,
    height: 44,
    borderRadius: 22,

    alignItems: 'center',
    justifyContent: 'center',
  },

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
    marginTop: 27,

    fontFamily: 'FredokaBold',
    fontSize: 21,

    color: BROWN,

    textAlign: 'center',
  },

  exerciseDescription: {
    marginTop: 7,

    maxWidth: 320,

    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 20,

    color: MUTED,

    textAlign: 'center',
  },

  /*
   * -----------------------------------------------------
   * TARGET PULSE CARD
   * -----------------------------------------------------
   */

  pulseTargetCard: {
    width: '100%',

    flexDirection: 'row',

    alignItems: 'center',
    justifyContent: 'center',

    backgroundColor: LIGHT_PINK,

    borderRadius: 18,

    paddingVertical: 15,

    marginTop: 18,
  },

  pulseTargetItem: {
    flex: 1,
    alignItems: 'center',
  },

  pulseTargetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,

    color: BROWN,
  },

  pulseTargetLabel: {
    marginTop: 2,

    fontFamily: 'FredokaRegular',
    fontSize: 11,

    color: MUTED,
  },

  verticalDivider: {
    width: 1,
    height: 35,

    backgroundColor: BORDER,
  },

  /*
   * -----------------------------------------------------
   * LIVE AIRFLOW
   * -----------------------------------------------------
   */

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

    textAlign: 'center',
  },

  airflowIndicator: {
    width: '100%',

    height: 10,

    borderRadius: 5,

    backgroundColor: LIGHT_GRAY,

    overflow: 'hidden',

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

    textAlign: 'center',
  },

  /*
   * -----------------------------------------------------
   * RECORDING PROGRESS
   * -----------------------------------------------------
   */

  progressTrack: {
    width: '100%',

    height: 8,

    borderRadius: 5,

    backgroundColor: LIGHT_GRAY,

    overflow: 'hidden',

    marginTop: 18,
  },

  progressFill: {
    height: '100%',

    borderRadius: 5,

    backgroundColor: BROWN,
  },

  /*
   * -----------------------------------------------------
   * RESULTS
   * -----------------------------------------------------
   */

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
    fontSize: 11,

    color: MUTED,

    textAlign: 'center',
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
});