// src/screens/exercises/BreathControl/SustainedExhaleScreen.tsx

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  SUSTAINED_EXHALE_PARAMS,
  Tier,
} from '@/constants/exercises/breathControl';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import {
  measureSustainedExhale,
  SustainedExhaleMeasurement,
} from '@/services/measurement/breathControl/sustainedExhale';

import {
  scoreSustainedExhale,
  SustainedExhaleScoreResult,
} from '@/services/scoring/breathControl/sustainedExhale';

// import { saveCompletedExercise } from '@/services/progress/exerciseRepository';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

type Screen =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

interface RepResult {
  measurement: SustainedExhaleMeasurement;
  score: SustainedExhaleScoreResult;
}

interface SustainedExhaleScreenProps {
  tier?: Tier;
}

export default function SustainedExhaleScreen({
  tier = 'beginner',
}: SustainedExhaleScreenProps) {
  const params = useMemo(
    () => SUSTAINED_EXHALE_PARAMS[tier],
    [tier]
  );

  const [screen, setScreen] =
    useState<Screen>('instructions');

  const [currentRep, setCurrentRep] =
    useState(1);

  const [countdown, setCountdown] =
    useState(3);

  const [recordingSeconds, setRecordingSeconds] =
    useState(0);

  const [liveVolume, setLiveVolume] =
    useState<number | null>(null);

  const [repResults, setRepResults] =
    useState<RepResult[]>([]);

  const [overallScore, setOverallScore] =
    useState(0);

  const [error, setError] =
    useState<string | null>(null);

  const mountedRef = useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const startingRef =
    useRef(false);

  const finishingRef =
    useRef(false);

  const currentRepRef =
    useRef(1);

  const screenRef =
    useRef<Screen>('instructions');

  const repResultsRef =
    useRef<RepResult[]>([]);

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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  const changeScreen = useCallback(
    (nextScreen: Screen) => {
      screenRef.current = nextScreen;

      if (mountedRef.current) {
        setScreen(nextScreen);
      }
    },
    []
  );

  // ----------------------------------------------------------
  // LIVE AUDIO
  // ----------------------------------------------------------

  const handleLiveFrame = useCallback(
    (frame: {
      pitch: number | null;
      note: string | null;
      clarity: number;
      volume: number;
      stability: number;
    }) => {
      if (!mountedRef.current) return;

      setLiveVolume(frame.volume);
    },
    []
  );

  // ----------------------------------------------------------
  // RECORDING STOP / ANALYSIS
  // ----------------------------------------------------------

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (!mountedRef.current) return;

      clearTimers();

      if (finishingRef.current) {
        return;
      }

      finishingRef.current = true;

      changeScreen('processing');

      try {
        const measurement =
          measureSustainedExhale(
            samples,
            params.detectionThreshold,
            sampleRate
          );

        const score =
          scoreSustainedExhale(
            measurement,
            tier
          );

        const result: RepResult = {
          measurement,
          score,
        };

        const updatedResults = [
          ...repResultsRef.current,
          result,
        ];

        repResultsRef.current =
          updatedResults;

        if (!mountedRef.current) {
          return;
        }

        setRepResults(updatedResults);

        const isFinalRep =
          currentRepRef.current >=
          params.repetitions;

        if (isFinalRep) {
          const totalScore =
            updatedResults.length > 0
              ? Math.round(
                  updatedResults.reduce(
                    (sum, item) =>
                      sum + item.score.score,
                    0
                  ) / updatedResults.length
                )
              : 0;

          setOverallScore(totalScore);

          // saveCompletedExercise(
          //   'breathControl',
          //   'sustainedExhale',
          //   tier,
          //   totalScore
          // ).catch(saveError => {
          //   console.warn(
          //     'Failed to save Sustained Exhale:',
          //     saveError
          //   );
          // });

          setTimeout(() => {
            if (!mountedRef.current) return;

            finishingRef.current = false;
            changeScreen('results');
          }, 500);

          return;
        }

        const nextRep =
          currentRepRef.current + 1;

        currentRepRef.current =
          nextRep;

        setCurrentRep(nextRep);

        setTimeout(() => {
          if (!mountedRef.current) return;

          finishingRef.current = false;
          beginCountdown();
        }, 800);
      } catch (analysisError) {
        console.error(
          'Sustained Exhale analysis failed:',
          analysisError
        );

        if (!mountedRef.current) return;

        finishingRef.current = false;
        setError(
          'We could not analyze this recording. Please try again.'
        );
        changeScreen('instructions');
      }
    },
    [
      changeScreen,
      clearTimers,
      params,
      tier,
    ]
  );

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  // ----------------------------------------------------------
  // COUNTDOWN
  // ----------------------------------------------------------

  const beginCountdown = useCallback(() => {
    clearTimers();

    if (!mountedRef.current) return;

    setCountdown(3);
    changeScreen('countdown');

    let value = 3;

    countdownTimerRef.current =
      setInterval(() => {
        value -= 1;

        if (!mountedRef.current) {
          clearTimers();
          return;
        }

        if (value <= 0) {
          clearTimers();

          startRecordingPhase();
          return;
        }

        setCountdown(value);
      }, 1000);
  }, [changeScreen, clearTimers]);

  // ----------------------------------------------------------
  // RECORDING
  // ----------------------------------------------------------

  const startRecordingPhase = useCallback(async () => {
    if (!mountedRef.current) return;
    if (startingRef.current) return;

    startingRef.current = true;
    finishingRef.current = false;

    setRecordingSeconds(0);
    setLiveVolume(null);
    setError(null);

    try {
      await startRecording();

      if (!mountedRef.current) return;

      changeScreen('recording');

      let elapsedMs = 0;

      recordingTimerRef.current =
        setInterval(() => {
          elapsedMs += 100;

          if (!mountedRef.current) {
            clearTimers();
            return;
          }

          const seconds =
            elapsedMs / 1000;

          setRecordingSeconds(seconds);

          /*
           * Automatically stop at the maximum
           * duration configured for this tier.
           *
           * The user can also finish earlier.
           */
          if (
  seconds >=
  params.durationRangeSec[1]
) {
  clearTimers();

  if (isRecording) {
    finishingRef.current = false;
    stopRecording();
  }
}
        }, 100);
    } catch (recordingError) {
      console.error(
        'Failed to start Sustained Exhale recording:',
        recordingError
      );

      if (!mountedRef.current) return;

      setError(
        'Microphone access could not be started. Please check your microphone permission.'
      );

      changeScreen('instructions');
    } finally {
      startingRef.current = false;
    }
  }, [
    changeScreen,
    clearTimers,
    isRecording,
    params.durationRangeSec,
    startRecording,
    stopRecording,
  ]);

  const finishRecording = useCallback(() => {
  if (!mountedRef.current) return;
  if (!isRecording) return;
  if (finishingRef.current) return;

  clearTimers();

  finishingRef.current = false;

  stopRecording();
}, [
  clearTimers,
  isRecording,
  stopRecording,
]);

  // ----------------------------------------------------------
  // START EXERCISE
  // ----------------------------------------------------------

  const startExercise = useCallback(() => {
    if (startingRef.current) return;
    if (screenRef.current !== 'instructions') {
      return;
    }

    setError(null);

    repResultsRef.current = [];

    setRepResults([]);

    currentRepRef.current = 1;
    setCurrentRep(1);

    setOverallScore(0);

    beginCountdown();
  }, [beginCountdown]);

  // ----------------------------------------------------------
  // RETRY
  // ----------------------------------------------------------

  const retryExercise = useCallback(() => {
    clearTimers();

    repResultsRef.current = [];

    currentRepRef.current = 1;

    finishingRef.current = false;
    startingRef.current = false;

    setRepResults([]);
    setCurrentRep(1);
    setCountdown(3);
    setRecordingSeconds(0);
    setLiveVolume(null);
    setOverallScore(0);
    setError(null);

    changeScreen('instructions');
  }, [changeScreen, clearTimers]);

  const goBack = useCallback(() => {
    clearTimers();

    if (isRecording) {
      stopRecording();
    }

    router.replace('/dashboard/exercises');
  }, [
    clearTimers,
    isRecording,
    stopRecording,
  ]);

  // ----------------------------------------------------------
  // DERIVED VALUES
  // ----------------------------------------------------------

  const averageDuration =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement.actualDurationSec,
          0
        ) / repResults.length
      : 0;

  const averageConsistency =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement.consistencyPct,
          0
        ) / repResults.length
      : 0;

  const passedReps =
    repResults.filter(
      result => result.score.passed
    ).length;

  const durationProgress =
    Math.min(
      recordingSeconds /
        params.durationRangeSec[1],
      1
    );

  const targetDuration =
    (
      params.durationRangeSec[0] +
      params.durationRangeSec[1]
    ) / 2;

  // ----------------------------------------------------------
  // INSTRUCTIONS
  // ----------------------------------------------------------

  if (screen === 'instructions') {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={
            styles.scrollContent
          }
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            style={styles.backButton}
            onPress={goBack}
          >
            <Ionicons
              name="arrow-back"
              size={24}
              color={BROWN}
            />
          </Pressable>

          <View style={styles.hero}>
            <View style={styles.iconCircle}>
              <Ionicons
                name="cloud-outline"
                size={38}
                color={BROWN}
              />
            </View>

            <Text style={styles.title}>
              Sustained Exhale
            </Text>

            <Text style={styles.subtitle}>
              Breath Control
            </Text>
          </View>

          <View style={styles.instructionCard}>
            <Text style={styles.sectionTitle}>
              Exercise Instructions
            </Text>

            <Text style={styles.instructionText}>
              Take a comfortable breath in,
              then slowly exhale through your
              mouth. Keep the airflow steady
              and controlled for as long as you
              comfortably can.
            </Text>

            <View style={styles.beforeCard}>
              <Text style={styles.beforeTitle}>
                Before You Begin
              </Text>

              <InstructionRow
                icon="leaf-outline"
                text="Sit or stand with a relaxed posture."
              />

              <InstructionRow
                icon="body-outline"
                text="Take a comfortable breath without forcing it."
              />

              <InstructionRow
                icon="volume-low-outline"
                text="Exhale gently and steadily."
              />

              <InstructionRow
                icon="mic-outline"
                text="Stay close enough to the microphone for consistent audio."
              />
            </View>

            <View style={styles.targetBox}>
              <View style={styles.targetItem}>
                <Text style={styles.targetLabel}>
                  TARGET
                </Text>

                <Text style={styles.targetValue}>
                  {params.durationRangeSec[0]}–
                  {params.durationRangeSec[1]} sec
                </Text>

                <Text style={styles.targetHint}>
                  sustained exhale
                </Text>
              </View>

              <View style={styles.targetDivider} />

              <View style={styles.targetItem}>
                <Text style={styles.targetLabel}>
                  REPETITIONS
                </Text>

                <Text style={styles.targetValue}>
                  {params.repetitions}
                </Text>

                <Text style={styles.targetHint}>
                  attempts
                </Text>
              </View>
            </View>

            <View style={styles.tipCard}>
              <Ionicons
                name="bulb-outline"
                size={21}
                color={BROWN}
              />

              <Text style={styles.tipText}>
                Focus on keeping your airflow
                steady rather than trying to
                force a longer exhale.
              </Text>
            </View>
          </View>

          <View style={styles.difficultyRow}>
            <View>
              <Text style={styles.difficultyLabel}>
                DIFFICULTY
              </Text>

              <Text style={styles.difficultyValue}>
                {capitalize(tier)}
              </Text>
            </View>

            <View style={styles.difficultyDots}>
              {['beginner', 'intermediate', 'advanced'].map(
                level => (
                  <View
                    key={level}
                    style={[
                      styles.difficultyDot,
                      level === tier &&
                        styles.difficultyDotActive,
                    ]}
                  />
                )
              )}
            </View>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Ionicons
                name="alert-circle-outline"
                size={21}
                color="#A33A3A"
              />

              <Text style={styles.errorText}>
                {error}
              </Text>
            </View>
          )}

          <Pressable
            style={styles.primaryButton}
            onPress={startExercise}
          >
            <Ionicons
              name="play"
              size={20}
              color={WHITE}
            />

            <Text style={styles.primaryButtonText}>
              Start Exercise
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ----------------------------------------------------------
  // COUNTDOWN
  // ----------------------------------------------------------

  if (screen === 'countdown') {
    return (
      <View style={styles.centeredScreen}>
        <View style={styles.largeIconCircle}>
          <Ionicons
            name="cloud-outline"
            size={46}
            color={BROWN}
          />
        </View>

        <Text style={styles.countdownTitle}>
          Get Ready
        </Text>

        <Text style={styles.countdownSubtitle}>
          Prepare for repetition {currentRep}
        </Text>

        <Text style={styles.countdownNumber}>
          {countdown}
        </Text>

        <Text style={styles.countdownHint}>
          Take a comfortable breath in
        </Text>
      </View>
    );
  }

  // ----------------------------------------------------------
  // RECORDING
  // ----------------------------------------------------------

  if (screen === 'recording') {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={
            styles.recordingContent
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.recordingHeader}>
            <Text style={styles.repLabel}>
              REPETITION {currentRep} OF{' '}
              {params.repetitions}
            </Text>

            <Text style={styles.recordingTitle}>
              Exhale Slowly
            </Text>

            <Text style={styles.recordingSubtitle}>
              Keep your airflow steady
            </Text>
          </View>

          <View style={styles.recordingVisual}>
            <View
              style={[
                styles.recordingOuterCircle,
                {
                  transform: [
                    {
                      scale:
                        1 +
                        durationProgress *
                          0.08,
                    },
                  ],
                },
              ]}
            >
              <View style={styles.recordingInnerCircle}>
                <Ionicons
                  name="mic"
                  size={52}
                  color={BROWN}
                />
              </View>
            </View>
          </View>

          <View style={styles.recordingBadge}>
            <View
              style={styles.recordingDot}
            />

            <Text style={styles.recordingBadgeText}>
              RECORDING
            </Text>
          </View>

          <Text style={styles.timerText}>
            {recordingSeconds.toFixed(1)}s
          </Text>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${durationProgress * 100}%`,
                },
              ]}
            />
          </View>

          <View style={styles.rangeRow}>
            <Text style={styles.rangeText}>
              {params.durationRangeSec[0]}s
            </Text>

            <Text style={styles.rangeTarget}>
              Target: {targetDuration.toFixed(1)}s
            </Text>

            <Text style={styles.rangeText}>
              {params.durationRangeSec[1]}s
            </Text>
          </View>

          <View style={styles.liveCard}>
            <View style={styles.liveIconCircle}>
              <Ionicons
                name="water-outline"
                size={24}
                color={BROWN}
              />
            </View>

            <View style={styles.liveTextContainer}>
              <Text style={styles.liveLabel}>
                AIRFLOW
              </Text>

              <Text style={styles.liveValue}>
                {liveVolume !== null
                  ? liveVolume.toFixed(2)
                  : 'Listening...'}
              </Text>
            </View>
          </View>

          <View style={styles.pacingCard}>
            <Ionicons
              name="speedometer-outline"
              size={22}
              color={BROWN}
            />

            <View style={styles.pacingTextContainer}>
              <Text style={styles.pacingTitle}>
                Keep it steady
              </Text>

              <Text style={styles.pacingText}>
                Maintain a controlled airflow
                throughout your exhale.
              </Text>
            </View>
          </View>

          <Pressable
            style={styles.finishButton}
            onPress={finishRecording}
          >
            <Text style={styles.finishButtonText}>
              Finish Exhale
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ----------------------------------------------------------
  // PROCESSING
  // ----------------------------------------------------------

  if (screen === 'processing') {
    const isFinalRep =
      currentRep >= params.repetitions;

    return (
      <View style={styles.centeredScreen}>
        <View style={styles.largeIconCircle}>
          <Ionicons
            name="analytics-outline"
            size={46}
            color={BROWN}
          />
        </View>

        <Text style={styles.processingTitle}>
          {isFinalRep
            ? 'Analyzing Your Results'
            : 'Analyzing Your Exhale'}
        </Text>

        <Text style={styles.processingSubtitle}>
          {isFinalRep
            ? 'Calculating your overall breath control score'
            : `Processing repetition ${currentRep}`}
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  }

  // ----------------------------------------------------------
  // RESULTS
  // ----------------------------------------------------------

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={
          styles.scrollContent
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.resultHero}>
          <View style={styles.resultIconCircle}>
            <Ionicons
              name={
                overallScore >= 60
                  ? 'checkmark'
                  : 'refresh-outline'
              }
              size={42}
              color={BROWN}
            />
          </View>

          <Text style={styles.resultTitle}>
            Exercise Complete
          </Text>

          <Text style={styles.resultSubtitle}>
            Sustained Exhale
          </Text>
        </View>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>
            OVERALL SCORE
          </Text>

          <Text style={styles.scoreValue}>
            {overallScore}
          </Text>

          <Text style={styles.scoreOutOf}>
            out of 100
          </Text>

          <View style={styles.scoreBar}>
            <View
              style={[
                styles.scoreBarFill,
                {
                  width: `${overallScore}%`,
                },
              ]}
            />
          </View>

          <Text style={styles.scoreMessage}>
            {getScoreMessage(overallScore)}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>
            Your Performance
          </Text>

          <View style={styles.metricsGrid}>
            <MetricCard
              icon="time-outline"
              label="Avg. Duration"
              value={`${averageDuration.toFixed(1)}s`}
            />

            <MetricCard
              icon="pulse-outline"
              label="Consistency"
              value={`${Math.round(
                averageConsistency
              )}%`}
            />

            <MetricCard
              icon="repeat-outline"
              label="Repetitions"
              value={`${repResults.length}/${params.repetitions}`}
            />

            <MetricCard
              icon="checkmark-circle-outline"
              label="Passed"
              value={`${passedReps}/${repResults.length}`}
            />
          </View>
        </View>

        <View style={styles.repResultsCard}>
          <Text style={styles.sectionTitle}>
            Repetition Results
          </Text>

          {repResults.map(
            (result, index) => (
              <View
                key={`rep-${index}`}
                style={styles.repResultRow}
              >
                <View
                  style={[
                    styles.repNumber,
                    result.score.passed &&
                      styles.repNumberPassed,
                  ]}
                >
                  <Text
                    style={
                      styles.repNumberText
                    }
                  >
                    {index + 1}
                  </Text>
                </View>

                <View
                  style={
                    styles.repResultInfo
                  }
                >
                  <Text
                    style={
                      styles.repResultTitle
                    }
                  >
                    Repetition {index + 1}
                  </Text>

                  <Text
                    style={
                      styles.repResultDetails
                    }
                  >
                    {result.measurement.actualDurationSec.toFixed(
                      1
                    )}
                    s •{' '}
                    {Math.round(
                      result.measurement.consistencyPct
                    )}
                    % consistency
                  </Text>
                </View>

                <Text
                  style={
                    styles.repResultScore
                  }
                >
                  {result.score.score}
                </Text>
              </View>
            )
          )}
        </View>

        <View style={styles.feedbackCard}>
          <Ionicons
            name="bulb-outline"
            size={23}
            color={BROWN}
          />

          <View
            style={styles.feedbackContent}
          >
            <Text style={styles.feedbackTitle}>
              Feedback
            </Text>

            <Text style={styles.feedbackText}>
              {getFeedback(
                overallScore,
                averageConsistency,
                averageDuration,
                params.durationRangeSec
              )}
            </Text>
          </View>
        </View>

        <Pressable
          style={styles.primaryButton}
          onPress={retryExercise}
        >
          <Ionicons
            name="refresh"
            size={20}
            color={WHITE}
          />

          <Text style={styles.primaryButtonText}>
            Try Again
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={goBack}
        >
          <Text style={styles.secondaryButtonText}>
            Back to Exercises
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ----------------------------------------------------------
// SMALL COMPONENTS
// ----------------------------------------------------------

function InstructionRow({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.instructionRow}>
      <Ionicons
        name={icon}
        size={20}
        color={BROWN}
      />

      <Text style={styles.instructionRowText}>
        {text}
      </Text>
    </View>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Ionicons
        name={icon}
        size={21}
        color={BROWN}
      />

      <Text style={styles.metricLabel}>
        {label}
      </Text>

      <Text style={styles.metricValue}>
        {value}
      </Text>
    </View>
  );
}

// ----------------------------------------------------------
// HELPERS
// ----------------------------------------------------------

function capitalize(value: string) {
  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

function getScoreMessage(score: number) {
  if (score >= 90) {
    return 'Excellent breath control!';
  }

  if (score >= 75) {
    return 'Great control and consistency!';
  }

  if (score >= 60) {
    return 'Good work! Keep building consistency.';
  }

  if (score >= 40) {
    return 'Keep practicing your airflow control.';
  }

  return 'Focus on maintaining a steady exhale.';
}

function getFeedback(
  score: number,
  consistency: number,
  averageDuration: number,
  range: [number, number]
) {
  if (score >= 90) {
    return 'Your exhale was strong and consistent. Continue practicing controlled airflow to maintain this level of breath stability.';
  }

  if (consistency < 60) {
    return 'Your airflow varied during the exercise. Try using a gentler, more even stream of air instead of pushing the breath out quickly.';
  }

  if (averageDuration < range[0]) {
    return 'Your exhale duration was below the target range. Focus on taking a comfortable breath and releasing the air more gradually.';
  }

  return 'Good effort. Continue practicing steady airflow and gradually work toward longer, more consistent exhales.';
}

// ----------------------------------------------------------
// STYLES
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WHITE,
  },

  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 78,
    paddingBottom: 40,
  },

  recordingContent: {
    paddingHorizontal: 24,
    paddingTop: 76,
    paddingBottom: 40,
  },

  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  hero: {
    alignItems: 'center',
    marginBottom: 28,
  },

  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 29,
    color: BROWN,
    textAlign: 'center',
  },

  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 16,
    color: MUTED,
    marginTop: 4,
  },

  instructionCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },

  sectionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 12,
  },

  instructionText: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 23,
    color: MUTED,
  },

  beforeCard: {
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
  },

  beforeTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: BROWN,
    marginBottom: 12,
  },

  instructionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 11,
  },

  instructionRowText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 20,
    color: BROWN,
    marginLeft: 10,
  },

  targetBox: {
    flexDirection: 'row',
    backgroundColor: WHITE,
    borderRadius: 18,
    paddingVertical: 17,
    marginTop: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  targetItem: {
    flex: 1,
    alignItems: 'center',
  },

  targetDivider: {
    width: 1,
    backgroundColor: BORDER,
  },

  targetLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: MUTED,
    letterSpacing: 0.5,
  },

  targetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
    marginTop: 3,
  },

  targetHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 1,
  },

  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
    marginLeft: 10,
  },

  difficultyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    paddingHorizontal: 4,
  },

  difficultyLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: MUTED,
    letterSpacing: 0.5,
  },

  difficultyValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
    marginTop: 2,
  },

  difficultyDots: {
    flexDirection: 'row',
    gap: 7,
  },

  difficultyDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
  },

  difficultyDotActive: {
    backgroundColor: PINK,
    borderWidth: 2,
    borderColor: BROWN,
  },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF1F1',
    borderRadius: 14,
    padding: 13,
    marginTop: 18,
  },

  errorText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: '#A33A3A',
    marginLeft: 9,
  },

  primaryButton: {
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    gap: 9,
  },

  primaryButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: WHITE,
  },

  secondaryButton: {
    height: 54,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },

  secondaryButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: BROWN,
  },

  centeredScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },

  largeIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 25,
  },

  countdownTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
  },

  countdownSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    marginTop: 5,
  },

  countdownNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 88,
    color: BROWN,
    lineHeight: 105,
    marginTop: 25,
  },

  countdownHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    marginTop: 5,
  },

  recordingHeader: {
    alignItems: 'center',
  },

  repLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: MUTED,
    letterSpacing: 0.7,
  },

  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 29,
    color: BROWN,
    marginTop: 7,
  },

  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    marginTop: 3,
  },

  recordingVisual: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 48,
  },

  recordingOuterCircle: {
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recordingInnerCircle: {
    width: 135,
    height: 135,
    borderRadius: 68,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recordingBadge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 15,
    marginTop: 24,
  },

  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BROWN,
    marginRight: 7,
  },

  recordingBadgeText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: BROWN,
    letterSpacing: 0.5,
  },

  timerText: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    textAlign: 'center',
    marginTop: 14,
  },

  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 18,
  },

  progressFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 5,
  },

  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },

  rangeText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  rangeTarget: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },

  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    padding: 16,
    marginTop: 28,
    borderWidth: 1,
    borderColor: BORDER,
  },

  liveIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  liveTextContainer: {
    marginLeft: 13,
  },

  liveLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.5,
  },

  liveValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginTop: 2,
  },

  pacingCard: {
    flexDirection: 'row',
    backgroundColor: WHITE,
    borderRadius: 17,
    padding: 15,
    marginTop: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },

  pacingTextContainer: {
    flex: 1,
    marginLeft: 11,
  },

  pacingTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
  },

  pacingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    marginTop: 2,
  },

  finishButton: {
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 26,
  },

  finishButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: WHITE,
  },

  processingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
  },

  processingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 21,
    color: MUTED,
    textAlign: 'center',
    marginTop: 7,
    maxWidth: 280,
  },

  spinner: {
    marginTop: 28,
  },

  resultHero: {
    alignItems: 'center',
    marginBottom: 24,
  },

  resultIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },

  resultTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
  },

  resultSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    marginTop: 3,
  },

  scoreCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 24,
    padding: 23,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },

  scoreLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: MUTED,
    letterSpacing: 0.8,
  },

  scoreValue: {
    fontFamily: 'FredokaBold',
    fontSize: 62,
    lineHeight: 70,
    color: BROWN,
    marginTop: 3,
  },

  scoreOutOf: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
  },

  scoreBar: {
    width: '100%',
    height: 10,
    backgroundColor: WHITE,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 17,
  },

  scoreBarFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 5,
  },

  scoreMessage: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
    textAlign: 'center',
    marginTop: 15,
  },

  summaryCard: {
    backgroundColor: WHITE,
    marginTop: 22,
  },

  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  metricCard: {
    width: '48%',
    minHeight: 100,
    backgroundColor: LIGHT_PINK,
    borderRadius: 17,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 8,
  },

  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginTop: 2,
  },

  repResultsCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 22,
    borderWidth: 1,
    borderColor: BORDER,
  },

  repResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  repNumber: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  repNumberPassed: {
    backgroundColor: PINK,
  },

  repNumberText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
  },

  repResultInfo: {
    flex: 1,
    marginLeft: 11,
  },

  repResultTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
  },

  repResultDetails: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },

  repResultScore: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
  },

  feedbackCard: {
    flexDirection: 'row',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
  },

  feedbackContent: {
    flex: 1,
    marginLeft: 11,
  },

  feedbackTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },

  feedbackText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: BROWN,
    marginTop: 4,
  },
});