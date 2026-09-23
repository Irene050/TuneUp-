// src/screens/exercises/BreathControl/SteadyAirflowMaintenanceScreen.tsx

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  STEADY_AIRFLOW_PARAMS,
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

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const PREPARATION_COUNTDOWN = 3;

interface Props {
  tier: Tier;
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
  tier,
}: Props) {
  const params = STEADY_AIRFLOW_PARAMS[tier];

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] = useState(
    PREPARATION_COUNTDOWN
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

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const finishExercise = useCallback(async () => {
  clearTimers();

  if (!mountedRef.current) {
    return;
  }

  const finalResults = repResultsRef.current;

  const finalScore =
    finalResults.length > 0
      ? Math.round(
          finalResults.reduce(
            (sum, result) =>
              sum + result.score.score,
            0
          ) / finalResults.length
        )
      : 0;

  console.log(
    '🏆 Final Steady Airflow results:',
    finalResults
  );

  console.log(
    '🏆 Final Steady Airflow score:',
    finalScore
  );

  /*
   * ------------------------------------------
   * SAVE PROGRESS
   * ------------------------------------------
   */

  try {
    await saveCompletedExercise(
      'breathControl',
      'steadyAirflow',
      tier,
      finalScore,
    );

    console.log(
      '💾 Steady Airflow progress saved'
    );
  } catch (saveError) {
    console.error(
      '❌ Failed to save Steady Airflow progress:',
      saveError
    );
  }

  if (!mountedRef.current) {
    return;
  }

  phaseRef.current = 'results';
  setPhase('results');
  setElapsed(0);
  setVolume(0);
}, [
  clearTimers,
  tier,
]);

  const handleRecordingStop = useCallback(
    (
      samples: Float32Array,
      sampleRate: number
    ) => {
      if (!mountedRef.current) {
        return;
      }

      if (phaseRef.current !== 'recording') {
        return;
      }

      clearTimers();

      phaseRef.current = 'processing';
      setPhase('processing');

      setElapsed(0);
      setVolume(0);

      const measurement =
        measureSteadyAirflow(
          samples,
          params.detectionThreshold,
          sampleRate
        );

      const score = scoreSteadyAirflow(
        measurement,
        tier
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

      setRepResults(updatedResults);

      setTimeout(() => {
        if (!mountedRef.current) {
          return;
        }

        if (
          currentRepRef.current >=
          params.repetitions
        ) {
          finishExercise();
          return;
        }

        currentRepRef.current += 1;

        setCurrentRep(
          currentRepRef.current
        );

        startCountdown();
      }, 700);
    },
    [
      clearTimers,
      finishExercise,
      params,
      tier,
    ]
  );

  const {
    isRecording,
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (!mountedRef.current) {
        return;
      }

      setVolume(frame.volume ?? 0);
    },

    onStop: handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current =
      startRecording;

    stopRecordingRef.current =
      stopRecording;
  }, [startRecording, stopRecording]);

  const startRecordingPhase =
    useCallback(() => {
      if (!mountedRef.current) {
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
              params.durationSec
            )
          );

          if (
            elapsedSeconds >=
            params.durationSec
          ) {
            if (recordingTimerRef.current) {
              clearInterval(
                recordingTimerRef.current
              );

              recordingTimerRef.current =
                null;
            }

            stopRecordingRef.current?.();
          }
        }, 50);
    }, [
      clearTimers,
      params.durationSec,
    ]);

  useEffect(() => {
    startRecordingPhaseRef.current =
      startRecordingPhase;
  }, [startRecordingPhase]);

  const startCountdown =
    useCallback(() => {
      if (!mountedRef.current) {
        return;
      }

      clearTimers();

      phaseRef.current = 'countdown';
      setPhase('countdown');

      setCountdown(
        PREPARATION_COUNTDOWN
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
                countdownTimerRef.current
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

  const startExercise = useCallback(() => {
    repResultsRef.current = [];

    currentRepRef.current = 1;

    setRepResults([]);
    setCurrentRep(1);
    setElapsed(0);
    setVolume(0);

    startCountdown();
  }, [startCountdown]);

  const retryExercise = useCallback(() => {
    repResultsRef.current = [];

    currentRepRef.current = 1;

    setRepResults([]);
    setCurrentRep(1);
    setElapsed(0);
    setVolume(0);

    startCountdown();
  }, [startCountdown]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      clearTimers();

      stopRecordingRef.current?.();
    };
  }, [clearTimers]);

  const averageScore =
    repResults.length > 0
      ? Math.round(
          repResults.reduce(
            (sum, result) =>
              sum + result.score.score,
            0
          ) / repResults.length
        )
      : 0;

  const averageStability =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .stabilityPct,
          0
        ) / repResults.length
      : 0;

  const averageDuration =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement.durationSec,
          0
        ) / repResults.length
      : 0;

  const passedReps =
    repResults.filter(
      (result) => result.score.passed
    ).length;

  const progress =
    params.durationSec > 0
      ? Math.min(
          elapsed / params.durationSec,
          1
        )
      : 0;

  const formatTime = (
    seconds: number
  ) => seconds.toFixed(1);

  const handleBack = () => {
    if (phase === 'instructions') {
      router.replace(
        '/dashboard/exercises'
      );
      return;
    }

    stopRecordingRef.current?.();
    clearTimers();

    phaseRef.current =
      'instructions';

    setPhase('instructions');
  };

  const renderBackButton = () => (
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

  /* --------------------------------
     INSTRUCTIONS
  -------------------------------- */

  if (phase === 'instructions') {
    return (
      <View style={styles.screen}>
        {renderBackButton()}

        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.content
          }
        >
          <View style={styles.iconCircle}>
            <Ionicons
              name="water-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.title}>
            Steady Airflow Maintenance
          </Text>

          <Text style={styles.subtitle}>
            Breath Control
          </Text>

          <View
            style={styles.instructionCard}
          >
            <View
              style={styles.prepareCard}
            >
              <View
                style={styles.prepareHeader}
              >
                <Ionicons
                  name="mic-outline"
                  size={21}
                  color={BROWN}
                />

                <Text
                  style={styles.prepareTitle}
                >
                  Before You Begin
                </Text>
              </View>

              <PrepareItem
                icon="volume-mute-outline"
                text="Find a quiet room or area with minimal background noise."
              />

              <PrepareItem
                icon="body-outline"
                text="Sit upright or stand with your back straight and your shoulders relaxed."
              />

              <PrepareItem
                icon="mic-outline"
                text="Hold your phone's microphone about 10–15 cm from your mouth. Direct your exhale toward the microphone so the app can detect the strength and consistency of your airflow."
              />

              <PrepareItem
                icon="resize-outline"
                text="Keep the microphone at a consistent distance from your mouth throughout the exercise."
              />
            </View>

            <Text
              style={styles.cardTitle}
            >
              Instructions
            </Text>

            <Text
              style={styles.instruction}
            >
              Take a comfortable breath, then
              gently exhale toward the
              microphone. Maintain a smooth and
              steady airflow throughout the
              entire exercise.
            </Text>

            <Text
              style={styles.instruction}
            >
              Continue for:
            </Text>

            <View
              style={styles.targetBox}
            >
              <Text
                style={styles.targetText}
              >
                {params.durationSec} seconds
              </Text>
            </View>

            <Text
              style={styles.helperText}
            >
              Imagine gently blowing on hot soup.
              Try not to increase or decrease the
              strength of your airflow.
            </Text>
          </View>

          <View style={styles.tipCard}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text style={styles.tipText}>
              Aim for an even airflow from the
              beginning to the end. Avoid sudden
              changes in breath strength.
            </Text>
          </View>

          <View
            style={styles.difficultyRow}
          >
            <Text
              style={styles.difficultyLabel}
            >
              Difficulty
            </Text>

            <Text
              style={styles.difficultyValue}
            >
              {tier}
            </Text>
          </View>

          <View style={styles.parameterRow}>
            <Parameter
              value={`${params.durationSec}s`}
              label="Duration"
            />

            <Parameter
              value={`${params.repetitions}`}
              label="Repetitions"
            />

            <Parameter
              value={`${params.stabilityThreshold}%`}
              label="Target"
            />
          </View>

          <Pressable
            style={styles.startButton}
            onPress={startExercise}
          >
            <Text
              style={styles.startButtonText}
            >
              Start Exercise
            </Text>

            <Ionicons
              name="arrow-forward"
              size={18}
              color={WHITE}
            />
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  /* --------------------------------
     COUNTDOWN
  -------------------------------- */

  if (phase === 'countdown') {
    return (
      <View style={styles.exerciseScreen}>
        {renderBackButton()}

        <View
          style={styles.exerciseContent}
        >
          <Text
            style={styles.phaseLabel}
          >
            GET READY
          </Text>

          <Text style={styles.repText}>
            Repetition {currentRep} of{' '}
            {params.repetitions}
          </Text>

          <View
            style={styles.countdownCircle}
          >
            <Text
              style={styles.countdownText}
            >
              {countdown}
            </Text>
          </View>

          <Text
            style={styles.exerciseTitle}
          >
            Prepare your breath
          </Text>

          <Text
            style={styles.exerciseDescription}
          >
            Take a comfortable breath and get
            ready to exhale steadily.
          </Text>
        </View>
      </View>
    );
  }

  /* --------------------------------
     RECORDING
  -------------------------------- */

  if (phase === 'recording') {
    return (
      <View style={styles.exerciseScreen}>
        {renderBackButton()}

        <View
          style={styles.exerciseContent}
        >
          <Text
            style={styles.phaseLabel}
          >
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

            <Text
              style={styles.timerText}
            >
              {formatTime(elapsed)}
            </Text>

            <Text
              style={styles.timerTarget}
            >
              / {params.durationSec.toFixed(1)}s
            </Text>
          </View>

          <Text
            style={styles.exerciseTitle}
          >
            Exhale steadily
          </Text>

          <Text
            style={styles.exerciseDescription}
          >
            Gently blow toward the microphone.
            Keep your airflow as even as
            possible.
          </Text>

          <View
            style={styles.airflowCard}
          >
            <Text
              style={styles.airflowLabel}
            >
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
                        0
                      ),
                      100
                    )}%`,
                  },
                ]}
              />
            </View>

            <Text
              style={styles.airflowHint}
            >
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

          <Text
            style={styles.smallHint}
          >
            Keep going until the timer reaches
            {` ${params.durationSec} seconds.`}
          </Text>
        </View>
      </View>
    );
  }

  /* --------------------------------
     PROCESSING
  -------------------------------- */

  if (phase === 'processing') {
    return (
      <View style={styles.exerciseScreen}>
        {renderBackButton()}

        <View
          style={styles.processingContent}
        >
          <View
            style={styles.processingCircle}
          >
            <Ionicons
              name="analytics-outline"
              size={48}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.processingTitle}
          >
            Analyzing your airflow
          </Text>

          <Text
            style={styles.processingText}
          >
            Measuring airflow stability and
            duration...
          </Text>
        </View>
      </View>
    );
  }

  /* --------------------------------
     RESULTS
  -------------------------------- */

  return (
    <View style={styles.screen}>
      {renderBackButton()}

      <ScrollView
        showsVerticalScrollIndicator={
          false
        }
        contentContainerStyle={
          styles.resultsContent
        }
      >
        <View style={styles.resultsIcon}>
          <Ionicons
            name={
              averageScore >= 70
                ? 'checkmark'
                : 'analytics-outline'
            }
            size={42}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.resultsTitle}
        >
          Exercise Complete
        </Text>

        <Text
          style={styles.resultsSubtitle}
        >
          Your steady airflow results
        </Text>

        <View style={styles.scoreCard}>
          <Text
            style={styles.scoreLabel}
          >
            OVERALL SCORE
          </Text>

          <Text
            style={styles.scoreValue}
          >
            {averageScore}%
          </Text>

          <Text
            style={styles.scoreMessage}
          >
            {averageScore >= 90
              ? 'Excellent airflow control!'
              : averageScore >= 75
                ? 'Great work!'
                : averageScore >= 60
                  ? 'Good effort!'
                  : 'Keep practicing!'}
          </Text>
        </View>

        <View style={styles.statsGrid}>
          <ResultStat
            label="Avg. Stability"
            value={`${Math.round(
              averageStability
            )}%`}
          />

          <ResultStat
            label="Avg. Duration"
            value={`${averageDuration.toFixed(
              1
            )}s`}
          />

          <ResultStat
            label="Passed"
            value={`${passedReps}/${repResults.length}`}
          />

          <ResultStat
            label="Target"
            value={`${params.stabilityThreshold}%`}
          />
        </View>

        <Text
          style={styles.sectionTitle}
        >
          Repetition Results
        </Text>

        {repResults.map((result) => (
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
                label="Stability"
                value={`${Math.round(
                  result.measurement
                    .stabilityPct
                )}%`}
              />

              <Metric
                label="Duration"
                value={`${result.measurement.durationSec.toFixed(
                  1
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

        <Pressable
          style={styles.retryButton}
          onPress={retryExercise}
        >
          <Ionicons
            name="refresh"
            size={20}
            color={BROWN}
          />

          <Text
            style={styles.retryButtonText}
          >
            Try Again
          </Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={() =>
            router.replace(
              '/dashboard/exercises'
            )
          }
        >
          <Text
            style={styles.doneButtonText}
          >
            Back to Exercises
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/* --------------------------------
   SMALL COMPONENTS
-------------------------------- */

function PrepareItem({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.prepareItem}>
      <Ionicons
        name={icon}
        size={17}
        color={BROWN}
      />

      <Text style={styles.prepareText}>
        {text}
      </Text>
    </View>
  );
}

function Parameter({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <View style={styles.parameter}>
      <Text
        style={styles.parameterValue}
      >
        {value}
      </Text>

      <Text
        style={styles.parameterLabel}
      >
        {label}
      </Text>
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
      <Text
        style={styles.resultStatValue}
      >
        {value}
      </Text>

      <Text
        style={styles.resultStatLabel}
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
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>
        {label}
      </Text>

      <Text style={styles.metricValue}>
        {value}
      </Text>
    </View>
  );
}

/* --------------------------------
   STYLES
-------------------------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 100,
    paddingBottom: 60,
    alignItems: 'center',
  },

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
  },

  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 3,
    marginBottom: 24,
  },

  instructionCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },

  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },

  prepareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  prepareTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
    marginLeft: 9,
  },

  prepareItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },

  prepareText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 14,
  },

  instruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: BROWN,
    marginBottom: 10,
  },

  targetBox: {
    backgroundColor: PINK,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginVertical: 8,
  },

  targetText: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
  },

  helperText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },

  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 10,
  },

  difficultyRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 10,
  },

  difficultyLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  difficultyValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    textTransform: 'capitalize',
  },

  parameterRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },

  parameter: {
    flex: 1,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 15,
    paddingVertical: 12,
    alignItems: 'center',
  },

  parameterValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },

  parameterLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 2,
  },

  startButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  /* EXERCISE */

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

  countdownCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 45,
  },

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
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

  /* PROCESSING */

  processingContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },

  processingCircle: {
    width: 105,
    height: 105,
    borderRadius: 53,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  processingTitle: {
    marginTop: 25,
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    textAlign: 'center',
  },

  processingText: {
    marginTop: 8,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
  },

  /* RESULTS */

  resultsContent: {
    paddingHorizontal: 20,
    paddingTop: 100,
    paddingBottom: 40,
  },

  resultsIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: PINK,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },

  resultsTitle: {
    marginTop: 17,
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },

  resultsSubtitle: {
    marginTop: 4,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
  },

  scoreCard: {
    marginTop: 22,
    paddingVertical: 24,
    borderRadius: 22,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
  },

  scoreLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    letterSpacing: 1,
    color: MUTED,
  },

  scoreValue: {
    marginTop: 3,
    fontFamily: 'FredokaBold',
    fontSize: 52,
    color: BROWN,
  },

  scoreMessage: {
    marginTop: 2,
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
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

  sectionTitle: {
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

  retryButton: {
    marginTop: 15,
    height: 53,
    borderRadius: 27,
    borderWidth: 1.5,
    borderColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  retryButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },

  doneButton: {
    marginTop: 10,
    height: 53,
    borderRadius: 27,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
  },

  doneButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: WHITE,
  },
});