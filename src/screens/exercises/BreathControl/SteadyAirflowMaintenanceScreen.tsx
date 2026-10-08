import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  SteadyAirflowParams,
  Tier,
} from '@/constants/exercises/breathControl';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import {
  measureSteadyAirflow,
  SteadyAirflowMeasurement,
} from '@/services/measurement/breathControl/steadyAirflowMaintenance';

import {
  scoreSteadyAirflow,
  SteadyAirflowScoreResult,
} from '@/services/scoring/breathControl/steadyAirflowMaintenance';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { auth } from '@/services/firebase/config';

import { getLatestAssessment } from '@/services/assessment/assessmentRepository';

import {
  generateSteadyAirflowParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';

const PREPARATION_COUNTDOWN = 3;

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

  const paramsRef =
    useRef<SteadyAirflowParams | null>(null);

  const tierRef = useRef<Tier>(
    initialTier ?? 'beginner',
  );

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] = useState(
    PREPARATION_COUNTDOWN,
  );

  const [elapsed, setElapsed] = useState(0);

  const [currentRep, setCurrentRep] = useState(1);

  const [volume, setVolume] = useState(0);

  const [repResults, setRepResults] = useState<
    RepResult[]
  >([]);

  const mountedRef = useRef(true);

  const phaseRef = useRef<Phase>('instructions');

  const currentRepRef = useRef(1);

  const repResultsRef = useRef<RepResult[]>([]);

  const startRecordingRef = useRef<
    (() => Promise<void>) | null
  >(null);

  const stopRecordingRef = useRef<
    (() => void) | null
  >(null);

  const countdownTimerRef = useRef<
    ReturnType<typeof setInterval> | null
  >(null);

  const recordingTimerRef = useRef<
    ReturnType<typeof setInterval> | null
  >(null);

  const startRecordingPhaseRef = useRef<
    (() => void) | null
  >(null);

  /*
   * ------------------------------------------
   * ADS PARAMETER INITIALIZATION
   * ------------------------------------------
   */

  useEffect(() => {
    let cancelled = false;

    const initializeParams = async () => {
      let currentTier: Tier =
        initialTier ?? 'beginner';

      let recentScores: number[] = [];

      try {
        const user = auth.currentUser;

        if (!initialTier && user) {
          const progress =
            await fetchComponentProgress(
              user.uid,
              'breathControl',
            );

          currentTier =
            progress?.currentTier ?? 'beginner';
        }
      } catch (error) {
        console.error(
          '❌ Failed to load Steady Airflow current tier:',
          error,
        );

        currentTier =
          initialTier ?? 'beginner';
      }

      if (cancelled) {
        return;
      }

      tierRef.current = currentTier;
      setTier(currentTier);

      try {
        const user = auth.currentUser;

        if (user) {
          const records =
            await fetchExerciseRecords(
              user.uid,
              'breathControl',
            );

          const currentExerciseRecords =
            records.filter(
              record =>
                record.templateId ===
                  'steadyAirflow' &&
                record.tier === currentTier,
            );

          recentScores =
            currentExerciseRecords
              .slice(-5)
              .map(
                record =>
                  record.scorePct,
              );

          if (recentScores.length === 0) {
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
              recentScores = [
                assessmentScore,
              ];

              console.log(
                '📋 Steady Airflow ADS reference from assessment:',
                assessmentScore,
              );
            } else {
              console.log(
                'ℹ️ No Steady Airflow exercise history or Breath Control assessment score. Using default parameters.',
              );
            }
          }
        } else {
          console.log(
            'ℹ️ No authenticated user. Using default Steady Airflow parameters.',
          );
        }
      } catch (error) {
        console.error(
          '❌ Failed to load Steady Airflow history/assessment:',
          error,
        );

        recentScores = [];
      }

      if (cancelled) {
        return;
      }

      const generatedParams =
        generateSteadyAirflowParams({
          tier: currentTier,
          recentScores,
        });

      if (cancelled) {
        return;
      }

      paramsRef.current = generatedParams;

      setParams(generatedParams);

      console.log(
        '🎯 Steady Airflow adaptive parameters:',
        {
          tier: currentTier,
          recentScores,
          generatedParams,
        },
      );
    };

    initializeParams();

    return () => {
      cancelled = true;
    };
  }, [initialTier]);

  /*
   * ------------------------------------------
   * TIMER CLEANUP
   * ------------------------------------------
   */

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(
        countdownTimerRef.current,
      );

      countdownTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(
        recordingTimerRef.current,
      );

      recordingTimerRef.current = null;
    }
  }, []);

  /*
   * ------------------------------------------
   * COUNTDOWN
   * ------------------------------------------
   */

  const startCountdown = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    clearTimers();

    phaseRef.current = 'countdown';

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
          if (countdownTimerRef.current) {
            clearInterval(
              countdownTimerRef.current,
            );

            countdownTimerRef.current = null;
          }

          startRecordingPhaseRef.current?.();

          return;
        }

        setCountdown(value);
      }, 1000);
  }, [clearTimers]);

  /*
   * ------------------------------------------
   * FINISH EXERCISE
   * ------------------------------------------
   */

  const finishExercise = useCallback(async () => {
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
                sum + result.score.score,
              0,
            ) /
              finalResults.length,
          )
        : 0;

    console.log(
      '🏆 Final Steady Airflow results:',
      finalResults,
    );

    console.log(
      '🏆 Final Steady Airflow score:',
      finalScore,
    );

    /*
     * ------------------------------------------
     * SAVE PROGRESS
     * ------------------------------------------
     */

    const activeTier =
      tierRef.current;

    if (!activeTier) {
      console.error(
        '❌ Current exercise tier is not available.',
      );

      return;
    }

    try {
      await saveCompletedExercise(
        'breathControl',
        'steadyAirflow',
        activeTier,
        finalScore,
      );

      console.log(
        '💾 Steady Airflow progress saved',
      );
    } catch (saveError) {
      console.error(
        '❌ Failed to save Steady Airflow progress:',
        saveError,
      );
    }

    if (!mountedRef.current) {
      return;
    }

    phaseRef.current = 'results';

    setPhase('results');
    setElapsed(0);
    setVolume(0);
  }, [clearTimers]);

  /*
   * ------------------------------------------
   * RECORDING PHASE
   * ------------------------------------------
   */

  const startRecordingPhase =
    useCallback(() => {
      if (!mountedRef.current) {
        return;
      }

      const adaptiveParams =
        paramsRef.current;

      if (!adaptiveParams) {
        console.error(
          '❌ Steady Airflow parameters are not ready.',
        );

        return;
      }

      clearTimers();

      phaseRef.current = 'recording';

      setPhase('recording');

      setElapsed(0);
      setVolume(0);

      startRecordingRef.current?.();

      const startedAt = Date.now();

      recordingTimerRef.current =
        setInterval(() => {
          if (!mountedRef.current) {
            return;
          }

          const elapsedSeconds =
            (Date.now() - startedAt) /
            1000;

          setElapsed(
            Math.min(
              elapsedSeconds,
              adaptiveParams.durationSec,
            ),
          );

          if (
            elapsedSeconds >=
            adaptiveParams.durationSec
          ) {
            if (
              recordingTimerRef.current
            ) {
              clearInterval(
                recordingTimerRef.current,
              );

              recordingTimerRef.current = null;
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
   * ------------------------------------------
   * RECORDING STOP / MEASUREMENT / SCORING
   * ------------------------------------------
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

        if (
          phaseRef.current !==
          'recording'
        ) {
          return;
        }

        const adaptiveParams =
          paramsRef.current;

        if (!adaptiveParams) {
          console.error(
            '❌ Steady Airflow parameters are not ready.',
          );

          phaseRef.current =
            'instructions';

          setPhase('instructions');

          return;
        }

        clearTimers();

        phaseRef.current =
          'processing';

        setPhase('processing');

        setElapsed(0);
        setVolume(0);

        const measurement =
          measureSteadyAirflow(
            samples,
            adaptiveParams.detectionThreshold,
            sampleRate,
          );

        const score =
          scoreSteadyAirflow(
            measurement,
            adaptiveParams,
          );

        const result: RepResult = {
          rep:
            currentRepRef.current,
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

          startCountdown();
        }, 700);
      },
      [
        clearTimers,
        finishExercise,
        startCountdown,
      ],
    );

  /*
   * ------------------------------------------
   * AUDIO RECORDER
   * ------------------------------------------
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
   * ------------------------------------------
   * START / RETRY
   * ------------------------------------------
   */

  const startExercise =
    useCallback(() => {
      if (!paramsRef.current) {
        console.warn(
          '⚠️ Steady Airflow parameters are not ready.',
        );

        return;
      }

      repResultsRef.current = [];

      currentRepRef.current = 1;

      setRepResults([]);
      setCurrentRep(1);
      setElapsed(0);
      setVolume(0);

      startCountdown();
    }, [startCountdown]);

  const retryExercise =
    useCallback(() => {
      if (!paramsRef.current) {
        return;
      }

      repResultsRef.current = [];

      currentRepRef.current = 1;

      setRepResults([]);
      setCurrentRep(1);
      setElapsed(0);
      setVolume(0);

      startCountdown();
    }, [startCountdown]);

  /*
   * ------------------------------------------
   * MOUNT / UNMOUNT CLEANUP
   * ------------------------------------------
   */

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      clearTimers();

      stopRecordingRef.current?.();
    };
  }, [clearTimers]);

  /*
   * ------------------------------------------
   * CALCULATED RESULTS
   * ------------------------------------------
   */

  const averageScore =
    repResults.length > 0
      ? Math.round(
          repResults.reduce(
            (sum, result) =>
              sum + result.score.score,
            0,
          ) /
            repResults.length,
        )
      : 0;

  const averageStability =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .stabilityPct,
          0,
        ) /
        repResults.length
      : 0;

  const averageDuration =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .durationSec,
          0,
        ) /
        repResults.length
      : 0;

  const passedReps =
    repResults.filter(
      result =>
        result.score.passed,
    ).length;

  /*
   * ------------------------------------------
   * BACK BUTTON
   * ------------------------------------------
   */

  const handleBack = () => {
    if (phase === 'instructions') {
      router.replace(
        '/dashboard?tab=exercises',
      );

      return;
    }

    stopRecordingRef.current?.();

    clearTimers();

    phaseRef.current =
      'instructions';

    setPhase('instructions');
  };

  /*
   * ------------------------------------------
   * PARAMETERS LOADING
   * ------------------------------------------
   */

  if (!params || !tier) {
    return (
      <ExerciseProcessingScreen
        icon="options-outline"
        title="Preparing your exercise"
        message="Setting your airflow parameters..."
        onBack={handleBack}
      />
    );
  }

  /*
   * ------------------------------------------
   * RECORDING CALCULATIONS
   * ------------------------------------------
   */

  const progress =
    params.durationSec > 0
      ? Math.min(
          elapsed /
            params.durationSec,
          1,
        )
      : 0;

  /*
   * ------------------------------------------
   * INSTRUCTIONS
   * ------------------------------------------
   */

  if (phase === 'instructions') {
    return (
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
    );
  }

  /*
   * ------------------------------------------
   * COUNTDOWN
   * ------------------------------------------
   */

  if (phase === 'countdown') {
    return (
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
    );
  }

  /*
   * ------------------------------------------
   * RECORDING
   * ------------------------------------------
   */

  if (phase === 'recording') {
    return (
      <View style={styles.exerciseScreen}>
        <View style={styles.exerciseContent}>
          <Text style={styles.phaseLabel}>
            STEADY AIRFLOW
          </Text>

          <Text style={styles.repText}>
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

          <Text
            style={styles.exerciseDescription}
          >
            Gently blow toward the
            microphone. Keep your
            airflow as even as possible.
          </Text>

          <View style={styles.airflowCard}>
            <Text style={styles.airflowLabel}>
              AIRFLOW
            </Text>

            <View
              style={styles.airflowIndicator}
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

            <Text style={styles.airflowHint}>
              Maintain a consistent level
            </Text>
          </View>

          <View
            style={styles.progressTrack}
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

          <Text style={styles.smallHint}>
            Keep going until the timer
            reaches{' '}
            {`${params.durationSec} seconds.`}
          </Text>
        </View>
      </View>
    );
  }

  /*
   * ------------------------------------------
   * PROCESSING
   * ------------------------------------------
   */

  if (phase === 'processing') {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing your airflow"
        message="Measuring airflow stability and duration..."
        onBack={handleBack}
      />
    );
  }

  /*
   * ------------------------------------------
   * RESULTS
   * ------------------------------------------
   */

  return (
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
      onExit={() =>
        router.replace(
          '/dashboard?tab=exercises',
        )
      }
    >
      <View style={styles.statsGrid}>
        <View style={styles.resultStat}>
          <Text
            style={styles.resultStatValue}
          >
            {Math.round(
              averageStability,
            )}%
          </Text>

          <Text
            style={styles.resultStatLabel}
          >
            Avg. Stability
          </Text>
        </View>

        <View style={styles.resultStat}>
          <Text
            style={styles.resultStatValue}
          >
            {averageDuration.toFixed(1)}s
          </Text>

          <Text
            style={styles.resultStatLabel}
          >
            Avg. Duration
          </Text>
        </View>

        <View style={styles.resultStat}>
          <Text
            style={styles.resultStatValue}
          >
            {passedReps}/{repResults.length}
          </Text>

          <Text
            style={styles.resultStatLabel}
          >
            Passed
          </Text>
        </View>

        <View style={styles.resultStat}>
          <Text
            style={styles.resultStatValue}
          >
            {params.stabilityThreshold}%
          </Text>

          <Text
            style={styles.resultStatLabel}
          >
            Target
          </Text>
        </View>
      </View>

      <Text
        style={styles.resultsSectionTitle}
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
                style={styles.passBadgeText}
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
              label="Stability"
              value={`${Math.round(
                result.measurement
                  .stabilityPct,
              )}%`}
            />

            <Metric
              label="Duration"
              value={`${result.measurement.durationSec.toFixed(
                1,
              )}s`}
            />

            <Metric
              label="Score"
              value={`${result.score.score}%`}
            />

            <Metric
              label="Detected"
              value={
                result.measurement
                  .detected
                  ? 'Yes'
                  : 'No'
              }
            />
          </View>
        </View>
      ))}
    </ExerciseResultsScreen>
  );
}

/*
 * --------------------------------
 * SMALL COMPONENTS
 * --------------------------------
 */

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metric}>
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
 * --------------------------------
 * STYLES
 * --------------------------------
 */

const styles = StyleSheet.create({
  /*
   * RECORDING
   */

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

  airflowLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    letterSpacing: 1,
    color: MUTED,
    textAlign: 'center',
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

  /*
   * RESULTS
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
    borderColor: '#F2DDE5',
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