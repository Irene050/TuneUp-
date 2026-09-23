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
  DIAPHRAGMATIC_BREATHING_PARAMS,
  Tier,
} from '@/constants/exercises/breathControl';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import {
  DiaphragmaticBreathingMeasurement,
  measureDiaphragmaticBreathing,
} from '@/services/measurement/breathControl/diaphragmaticBreathing';

import {
  DiaphragmaticBreathingScoreResult,
  scoreDiaphragmaticBreathing,
} from '@/services/scoring/breathControl/diaphragmaticBreathing';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

interface Props {
  tier: Tier;
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

const PREPARATION_COUNTDOWN = 3;

export default function DiaphragmaticBreathingScreen({
  tier,
}: Props) {
  const params = DIAPHRAGMATIC_BREATHING_PARAMS[tier];

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(PREPARATION_COUNTDOWN);
  const [elapsed, setElapsed] = useState(0);
  const [volume, setVolume] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [repResults, setRepResults] = useState<RepResult[]>([]);

  const [currentInhaleSamples, setCurrentInhaleSamples] =
    useState<Float32Array | null>(null);

  const mountedRef = useRef(true);

  const phaseRef = useRef<Phase>('instructions');
  const currentRepRef = useRef(1);

  const inhaleSamplesRef = useRef<Float32Array | null>(null);

  const startRecordingRef = useRef<
    (() => Promise<void>) | null
  >(null);

  const stopRecordingRef = useRef<
    (() => void) | null
  >(null);

  const repResultsRef = useRef<RepResult[]>([]);

  const phaseTimerRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);

  const countdownTimerRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);

  const stopTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

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
    '🏆 Final Diaphragmatic Breathing results:',
    finalResults
  );

  console.log(
    '🏆 Final Diaphragmatic Breathing score:',
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
      'diaphragmaticBreathing',
      tier,
      finalScore,
    );

    console.log(
      '💾 Diaphragmatic Breathing progress saved'
    );
  } catch (saveError) {
    console.error(
      '❌ Failed to save Diaphragmatic Breathing progress:',
      saveError
    );
  }

  if (!mountedRef.current) {
    return;
  }

  setPhase('results');
  phaseRef.current = 'results';
}, [
  clearTimers,
  tier,
]);

  const processRep = useCallback(
    (
      inhaleSamples: Float32Array,
      exhaleSamples: Float32Array,
      sampleRate: number
    ) => {
      if (!mountedRef.current) {
        return;
      }

      const measurement =
        measureDiaphragmaticBreathing(
          inhaleSamples,
          exhaleSamples,
          params.detectionThreshold,
          sampleRate
        );

      const score = scoreDiaphragmaticBreathing(
        measurement,
        tier
      );

      const result: RepResult = {
        rep: currentRepRef.current,
        measurement,
        score,
      };

      repResultsRef.current = [
        ...repResultsRef.current,
        result,
      ];

      setRepResults([...repResultsRef.current]);

      if (
        currentRepRef.current >=
        params.repetitions
      ) {
        finishExercise();
        return;
      }

      currentRepRef.current += 1;
      setCurrentRep(currentRepRef.current);

      setTimeout(() => {
        if (!mountedRef.current) {
          return;
        }

        startCountdown();
      }, 700);
    },
    [finishExercise, params, tier]
  );

  const handleRecordingStop = useCallback(
    (
      samples: Float32Array,
      sampleRate: number
    ) => {
      if (!mountedRef.current) {
        return;
      }

      const stoppedPhase = phaseRef.current;

      if (stoppedPhase === 'inhale') {
        inhaleSamplesRef.current = samples;
        setCurrentInhaleSamples(samples);

        setElapsed(0);
        setVolume(0);

        phaseRef.current = 'exhale';
        setPhase('exhale');

        setTimeout(() => {
          if (!mountedRef.current) {
            return;
          }

          startRecordingRef.current?.();

          startPhaseTimer(
            params.exhaleSec
          );
        }, 250);

        return;
      }

      if (stoppedPhase === 'exhale') {
        const inhaleSamples =
          inhaleSamplesRef.current;

        if (!inhaleSamples) {
          phaseRef.current = 'processing';
          setPhase('processing');

          setTimeout(() => {
            if (mountedRef.current) {
              finishExercise();
            }
          }, 500);

          return;
        }

        phaseRef.current = 'processing';
        setPhase('processing');

        setElapsed(0);
        setVolume(0);

        setTimeout(() => {
          if (!mountedRef.current) {
            return;
          }

          processRep(
            inhaleSamples,
            samples,
            sampleRate
          );

          inhaleSamplesRef.current = null;
          setCurrentInhaleSamples(null);
        }, 300);
      }
    },
    [finishExercise, params.exhaleSec, processRep]
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
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const startPhaseTimer = useCallback(
    (durationSec: number) => {
      clearTimers();

      const startedAt = Date.now();

      setElapsed(0);

      phaseTimerRef.current = setInterval(() => {
        if (!mountedRef.current) {
          return;
        }

        const elapsedSec =
          (Date.now() - startedAt) / 1000;

        setElapsed(
          Math.min(elapsedSec, durationSec)
        );

        if (elapsedSec >= durationSec) {
          if (phaseTimerRef.current) {
            clearInterval(
              phaseTimerRef.current
            );

            phaseTimerRef.current = null;
          }

          stopRecordingRef.current?.();
        }
      }, 50);
    },
    [clearTimers]
  );

  const startInhalePhase = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    clearTimers();

    phaseRef.current = 'inhale';
    setPhase('inhale');
    setElapsed(0);
    setVolume(0);

    inhaleSamplesRef.current = null;
    setCurrentInhaleSamples(null);

    startRecordingRef.current?.();

    startPhaseTimer(params.inhaleSec);
  }, [clearTimers, params.inhaleSec, startPhaseTimer]);

  const startCountdown = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    clearTimers();

    phaseRef.current = 'countdown';
    setPhase('countdown');
    setCountdown(PREPARATION_COUNTDOWN);
    setElapsed(0);
    setVolume(0);

    let value = PREPARATION_COUNTDOWN;

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

            countdownTimerRef.current = null;
          }

          startInhalePhase();
          return;
        }

        setCountdown(value);
      }, 1000);
  }, [clearTimers, startInhalePhase]);

  const startExercise = useCallback(() => {
    currentRepRef.current = 1;
    repResultsRef.current = [];

    setCurrentRep(1);
    setRepResults([]);
    setElapsed(0);
    setVolume(0);

    startCountdown();
  }, [startCountdown]);

  const retryExercise = useCallback(() => {
    currentRepRef.current = 1;
    repResultsRef.current = [];

    setCurrentRep(1);
    setRepResults([]);
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

  const averageInhale =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .inhaleDurationSec,
          0
        ) / repResults.length
      : 0;

  const averageExhale =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .exhaleDurationSec,
          0
        ) / repResults.length
      : 0;

  const averageConsistency =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .consistencyPct,
          0
        ) / repResults.length
      : 0;

  const averageVolume =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement.volumeDb,
          0
        ) / repResults.length
      : 0;

  const progress =
    phase === 'inhale'
      ? Math.min(
          elapsed / params.inhaleSec,
          1
        )
      : phase === 'exhale'
        ? Math.min(
            elapsed / params.exhaleSec,
            1
          )
        : 0;

  const formatTime = (seconds: number) =>
    seconds.toFixed(1);

  const renderHeader = () => (
    <View style={styles.header}>
      <Pressable
        style={styles.backButton}
        onPress={() => {
          if (phase === 'instructions') {
            router.back();
          } else {
            stopRecordingRef.current?.();
            clearTimers();
            phaseRef.current =
              'instructions';
            setPhase('instructions');
          }
        }}
      >
        <Ionicons
          name="arrow-back"
          size={24}
          color={BROWN}
        />
      </Pressable>

      <Text style={styles.headerTitle}>
        Diaphragmatic Breathing
      </Text>

      <View style={styles.headerSpacer} />
    </View>
  );

  if (phase === 'instructions') {
    return (
      <View style={styles.container}>
        {renderHeader()}

        <ScrollView
          contentContainerStyle={
            styles.instructionsContent
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconCircle}>
            <Ionicons
              name="body-outline"
              size={46}
              color={BROWN}
            />
          </View>

          <Text style={styles.title}>
            Diaphragmatic Breathing
          </Text>

          <Text style={styles.subtitle}>
            Breath Control
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Before You Begin
            </Text>

            <InstructionRow text="Find a quiet room with minimal background noise." />

            <InstructionRow text="Sit upright or stand comfortably with your back straight and shoulders relaxed." />

            <InstructionRow text="Keep the phone microphone about 10–15 cm from your mouth." />

            <InstructionRow text="During the exhale, gently direct your breath toward the microphone." />

            <InstructionRow text="Keep the microphone at a consistent distance throughout the exercise." />

            <View style={styles.divider} />

            <Text style={styles.cardTitle}>
              Instructions
            </Text>

            <InstructionRow text="Breathe slowly and deeply using your diaphragm." />

            <InstructionRow
              text={`Inhale comfortably for ${params.inhaleSec} seconds.`}
            />

            <InstructionRow
              text={`Gently exhale for ${params.exhaleSec} seconds.`}
            />

            <InstructionRow text="Keep the exhale smooth and controlled." />

            <Text style={styles.helperText}>
              The exercise measures your breathing
              duration, exhale consistency, and
              volume stability.
            </Text>
          </View>

          <View style={styles.tipCard}>
            <View style={styles.tipIcon}>
              <Ionicons
                name="bulb-outline"
                size={20}
                color={BROWN}
              />
            </View>

            <View style={styles.tipContent}>
              <Text style={styles.tipTitle}>
                Tip
              </Text>

              <Text style={styles.tipText}>
                Avoid forcing your breath. Focus
                on maintaining a relaxed,
                controlled airflow.
              </Text>
            </View>
          </View>

          <View style={styles.difficultyRow}>
            <Text style={styles.difficultyLabel}>
              Difficulty
            </Text>

            <View style={styles.tierBadge}>
              <Text style={styles.tierText}>
                {tier.charAt(0).toUpperCase() +
                  tier.slice(1)}
              </Text>
            </View>
          </View>

          <View style={styles.parameterRow}>
            <Parameter
              value={`${params.inhaleSec}s`}
              label="Inhale"
            />

            <Parameter
              value={`${params.exhaleSec}s`}
              label="Exhale"
            />

            <Parameter
              value={`${params.repetitions}`}
              label="Reps"
            />
          </View>

          <Pressable
            style={styles.startButton}
            onPress={startExercise}
          >
            <Text style={styles.startButtonText}>
              Start Exercise
            </Text>

            <Ionicons
              name="arrow-forward"
              size={21}
              color={WHITE}
            />
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'countdown') {
    return (
      <View style={styles.exerciseContainer}>
        {renderHeader()}

        <View style={styles.exerciseContent}>
          <Text style={styles.phaseLabel}>
            GET READY
          </Text>

          <Text style={styles.repText}>
            Repetition {currentRep} of{' '}
            {params.repetitions}
          </Text>

          <View style={styles.largeCircle}>
            <Text style={styles.countdownText}>
              {countdown}
            </Text>
          </View>

          <Text style={styles.instructionTitle}>
            Prepare to breathe
          </Text>

          <Text style={styles.instructionText}>
            Relax your shoulders and get ready
            to inhale slowly.
          </Text>
        </View>
      </View>
    );
  }

  if (phase === 'inhale') {
    return (
      <View style={styles.exerciseContainer}>
        {renderHeader()}

        <View style={styles.exerciseContent}>
          <Text style={styles.phaseLabel}>
            INHALE
          </Text>

          <Text style={styles.repText}>
            Repetition {currentRep} of{' '}
            {params.repetitions}
          </Text>

          <View style={styles.breathCircle}>
            <Ionicons
              name="arrow-down-outline"
              size={42}
              color={BROWN}
            />

            <Text style={styles.phaseTime}>
              {formatTime(elapsed)}
            </Text>

            <Text style={styles.phaseTarget}>
              / {params.inhaleSec.toFixed(1)}s
            </Text>
          </View>

          <Text style={styles.instructionTitle}>
            Breathe in slowly
          </Text>

          <Text style={styles.instructionText}>
            Take a comfortable, deep breath
            using your diaphragm.
          </Text>

          <ProgressBar progress={progress} />

          <Text style={styles.smallHint}>
            Keep your shoulders relaxed.
          </Text>
        </View>
      </View>
    );
  }

  if (phase === 'exhale') {
    const [dbMin, dbMax] =
      params.targetDbRange;

    return (
      <View style={styles.exerciseContainer}>
        {renderHeader()}

        <View style={styles.exerciseContent}>
          <Text style={styles.phaseLabel}>
            EXHALE
          </Text>

          <Text style={styles.repText}>
            Repetition {currentRep} of{' '}
            {params.repetitions}
          </Text>

          <View style={styles.breathCircle}>
            <Ionicons
              name="arrow-up-outline"
              size={42}
              color={BROWN}
            />

            <Text style={styles.phaseTime}>
              {formatTime(elapsed)}
            </Text>

            <Text style={styles.phaseTarget}>
              / {params.exhaleSec.toFixed(1)}s
            </Text>
          </View>

          <Text style={styles.instructionTitle}>
            Exhale gently
          </Text>

          <Text style={styles.instructionText}>
            Slowly release your breath toward
            the microphone.
          </Text>

          <View style={styles.volumeCard}>
            <Text style={styles.volumeLabel}>
              AIRFLOW LEVEL
            </Text>

            <Text style={styles.volumeValue}>
              {volume.toFixed(2)}
            </Text>

            <Text style={styles.volumeTarget}>
              Target: {dbMin}–{dbMax} dB
            </Text>
          </View>

          <ProgressBar progress={progress} />

          <Text style={styles.smallHint}>
            Keep your airflow smooth and
            consistent.
          </Text>
        </View>
      </View>
    );
  }

  if (phase === 'processing') {
    return (
      <View style={styles.exerciseContainer}>
        {renderHeader()}

        <View style={styles.processingContent}>
          <View style={styles.processingCircle}>
            <Ionicons
              name="analytics-outline"
              size={48}
              color={BROWN}
            />
          </View>

          <Text style={styles.processingTitle}>
            Analyzing your breathing
          </Text>

          <Text style={styles.processingText}>
            Measuring duration, consistency,
            and volume...
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader()}

      <ScrollView
        contentContainerStyle={styles.resultsContent}
        showsVerticalScrollIndicator={false}
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

        <Text style={styles.resultsTitle}>
          Exercise Complete
        </Text>

        <Text style={styles.resultsSubtitle}>
          Your diaphragmatic breathing results
        </Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>
            OVERALL SCORE
          </Text>

          <Text style={styles.scoreValue}>
            {averageScore}%
          </Text>

          <Text style={styles.scoreMessage}>
            {averageScore >= 90
              ? 'Excellent control!'
              : averageScore >= 75
                ? 'Great work!'
                : averageScore >= 60
                  ? 'Good effort!'
                  : 'Keep practicing!'}
          </Text>
        </View>

        <View style={styles.statsGrid}>
          <ResultStat
            label="Avg. Inhale"
            value={`${averageInhale.toFixed(1)}s`}
          />

          <ResultStat
            label="Avg. Exhale"
            value={`${averageExhale.toFixed(1)}s`}
          />

          <ResultStat
            label="Consistency"
            value={`${Math.round(
              averageConsistency
            )}%`}
          />

          <ResultStat
            label="Avg. Volume"
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

        {repResults.map((result) => (
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
                  !result.score.passed &&
                    styles.failBadge,
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
                label="Inhale"
                value={`${result.measurement.inhaleDurationSec.toFixed(
                  1
                )}s`}
              />

              <Metric
                label="Exhale"
                value={`${result.measurement.exhaleDurationSec.toFixed(
                  1
                )}s`}
              />

              <Metric
                label="Consistency"
                value={`${Math.round(
                  result.measurement
                    .consistencyPct
                )}%`}
              />

              <Metric
                label="Score"
                value={`${result.score.score}%`}
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

          <Text style={styles.retryButtonText}>
            Try Again
          </Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={() =>
            router.replace('/dashboard/exercises')
          }
        >
          <Text style={styles.doneButtonText}>
            Back to Exercises
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function InstructionRow({
  text,
}: {
  text: string;
}) {
  return (
    <View style={styles.instructionRow}>
      <View style={styles.bullet}>
        <Ionicons
          name="checkmark"
          size={13}
          color={BROWN}
        />
      </View>

      <Text style={styles.instructionRowText}>
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
      <Text style={styles.parameterValue}>
        {value}
      </Text>

      <Text style={styles.parameterLabel}>
        {label}
      </Text>
    </View>
  );
}

function ProgressBar({
  progress,
}: {
  progress: number;
}) {
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          {
            width: `${Math.max(
              0,
              Math.min(progress, 1) * 100
            )}%`,
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
      <Text style={styles.resultStatValue}>
        {value}
      </Text>

      <Text style={styles.resultStatLabel}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WHITE,
  },

  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
  },

  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'FredokaSemiBold',
    fontSize: 17,
    color: BROWN,
  },

  headerSpacer: {
    width: 42,
  },

  instructionsContent: {
    paddingHorizontal: 20,
    paddingBottom: 35,
  },

  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 10,
  },

  title: {
    marginTop: 18,
    textAlign: 'center',
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
  },

  subtitle: {
    marginTop: 4,
    textAlign: 'center',
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
  },

  card: {
    marginTop: 24,
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
  },

  cardTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 17,
    color: BROWN,
    marginBottom: 12,
  },

  instructionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },

  bullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },

  instructionRowText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 20,
    color: BROWN,
  },

  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 15,
  },

  helperText: {
    marginTop: 4,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
  },

  tipCard: {
    marginTop: 15,
    padding: 15,
    borderRadius: 18,
    backgroundColor: PINK,
    flexDirection: 'row',
  },

  tipIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },

  tipContent: {
    flex: 1,
  },

  tipTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
    marginBottom: 3,
  },

  tipText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 18,
    color: BROWN,
  },

  difficultyRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  difficultyLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },

  tierBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: LIGHT_PINK,
  },

  tierText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
  },

  parameterRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 10,
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
    fontSize: 17,
    color: BROWN,
  },

  parameterLabel: {
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  startButton: {
    marginTop: 22,
    height: 56,
    borderRadius: 28,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  startButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: WHITE,
  },

  exerciseContainer: {
    flex: 1,
    backgroundColor: WHITE,
  },

  exerciseContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 25,
    paddingTop: 45,
  },

  phaseLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    letterSpacing: 1.5,
    color: BROWN,
  },

  repText: {
    marginTop: 5,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
  },

  largeCircle: {
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

  breathCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 42,
  },

  phaseTime: {
    marginTop: 8,
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
  },

  phaseTarget: {
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
  },

  instructionTitle: {
    marginTop: 30,
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    textAlign: 'center',
  },

  instructionText: {
    marginTop: 7,
    maxWidth: 320,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 21,
    color: MUTED,
    textAlign: 'center',
  },

  progressTrack: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 30,
  },

  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: BROWN,
  },

  smallHint: {
    marginTop: 18,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
  },

  volumeCard: {
    width: '100%',
    marginTop: 22,
    padding: 16,
    borderRadius: 18,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
  },

  volumeLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    letterSpacing: 1,
    color: MUTED,
  },

  volumeValue: {
    marginTop: 3,
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
  },

  volumeTarget: {
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
  },

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

  resultsContent: {
    paddingHorizontal: 20,
    paddingBottom: 35,
  },

  resultsIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: PINK,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15,
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

  repResultCard: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
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