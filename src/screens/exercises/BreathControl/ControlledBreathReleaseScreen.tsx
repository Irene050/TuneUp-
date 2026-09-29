// src/screens/exercises/BreathControl/ControlledBreathReleaseScreen.tsx

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
  CONTROLLED_BREATH_RELEASE_PARAMS,
  type ControlledBreathReleaseParams,
  type Tier,
} from '@/constants/exercises/breathControl';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import { auth } from '@/services/firebase/config';

import {
  ControlledBreathReleaseMeasurement,
  measureControlledBreathRelease,
} from '@/services/measurement/breathControl/controlledBreathRelease';

import {
  ControlledBreathReleaseScoreResult,
  scoreControlledBreathRelease,
} from '@/services/scoring/breathControl/controlledBreathRelease';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { getLatestAssessment } from '@/services/assessment/assessmentRepository';

import { generateControlledBreathReleaseParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const PREPARATION_COUNTDOWN = 3;

/*
 * Extra time gives the user enough room to complete
 * the final pulse and allows the pulse detector to
 * capture the complete sequence.
 */
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
   * ----------------------------------------------------
   * CURRENT TIER
   * ----------------------------------------------------
   *
   * If a tier is explicitly supplied, use it.
   *
   * Otherwise, load the user's saved current tier
   * for Breath Control.
   *
   * If no progress exists, default to Beginner.
   */
  const [tier, setTier] = useState<Tier | null>(
    initialTier ?? null,
  );

  const tierRef = useRef<Tier>(
    initialTier ?? 'beginner',
  );

  /*
   * ----------------------------------------------------
   * ADAPTIVE PARAMETERS
   * ----------------------------------------------------
   *
   * Initial state uses Beginner/current-tier defaults
   * so the screen always has valid parameters while
   * the user's adaptive data is being loaded.
   */
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
   * The target sequence is based on:
   *
   * pulseCount × interval
   *
   * We add a small amount of extra time so the
   * final pulse is not cut off.
   */
  const recordingDuration =
    params.pulseCount *
      params.intervalSec +
    EXTRA_RECORDING_TIME_SEC;

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(PREPARATION_COUNTDOWN);

  const [elapsed, setElapsed] =
    useState(0);

  const [volume, setVolume] =
    useState(0);

  const [currentRep, setCurrentRep] =
    useState(1);

  const [repResults, setRepResults] =
    useState<RepResult[]>([]);

  const mountedRef = useRef(true);

  const phaseRef = useRef<Phase>(
    'instructions',
  );

  const currentRepRef = useRef(1);

  const repResultsRef =
    useRef<RepResult[]>([]);

  /*
   * Refs prevent callbacks from using stale
   * recorder functions or stale countdown functions.
   */
  const startRecordingRef = useRef<
    (() => Promise<void>) | null
  >(null);

  const stopRecordingRef = useRef<
    (() => void) | null
  >(null);

  const startRecordingPhaseRef =
    useRef<(() => void) | null>(null);

  const startCountdownRef =
    useRef<(() => void) | null>(null);

  const countdownTimerRef = useRef<
    ReturnType<typeof setInterval> | null
  >(null);

  const recordingTimerRef = useRef<
    ReturnType<typeof setInterval> | null
  >(null);

  /*
   * ----------------------------------------------------
   * LOAD ADAPTIVE PARAMETERS
   * ----------------------------------------------------
   *
   * Priority:
   *
   * 1. Resolve the user's current tier from saved
   *    component progress when no tier prop is supplied.
   *
   * 2. Latest five completed exercises for Breath
   *    Control in the current tier.
   *
   * 3. If no exercise history exists, use the latest
   *    Initial Assessment Breath Control score.
   *
   * 4. If neither exists, use default tier parameters.
   *
   * Assessment records remain separate from exercise
   * history. The assessment score is only used as the
   * initial ADS reference.
   */
  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParams = async () => {
      let currentTier: Tier =
        initialTier ?? 'beginner';

      let referenceScores: number[] = [];

      /*
       * Reset to a valid default while loading.
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
       * ------------------------------------------------
       * STEP 1: RESOLVE CURRENT TIER
       * ------------------------------------------------
       *
       * An explicitly supplied tier takes priority.
       *
       * Otherwise, use the saved component progress.
       *
       * If no saved progress exists, remain at Beginner.
       */
      try {
        const user = auth.currentUser;

        if (
          !initialTier &&
          user
        ) {
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
       * Make sure the initial params match the
       * resolved tier before loading ADS data.
       */
      const defaultParams =
        CONTROLLED_BREATH_RELEASE_PARAMS[
          currentTier
        ];

      paramsRef.current =
        defaultParams;

      setParams(defaultParams);

      /*
       * ------------------------------------------------
       * STEP 2: LOAD ADS REFERENCE
       * ------------------------------------------------
       */
      try {
        const user = auth.currentUser;

        /*
         * No authenticated user:
         * use default current-tier parameters.
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
/*
 * ------------------------------------------------
 * EXERCISE HISTORY
 * ------------------------------------------------
 *
 * Use the latest five completed exercises for
 * this specific exercise and current tier.
 *
 * History from other exercises and other tiers
 * is excluded because each exercise/tier has
 * its own adaptive parameter history.
 */
const exerciseRecords =
  await fetchExerciseRecords(
    user.uid,
    'breathControl',
  );

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
         * ------------------------------------------------
         * INITIAL ASSESSMENT FALLBACK
         * ------------------------------------------------
         *
         * Only use the assessment when no completed
         * exercise history exists for the component
         * and current tier.
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
              'ℹ️ No Controlled Breath Release exercise history or Breath Control assessment score. Using default parameters.',
            );
          }
        }

        /*
         * ------------------------------------------------
         * STEP 3: GENERATE ADAPTIVE PARAMETERS
         * ------------------------------------------------
         */
        const generatedParams =
          generateControlledBreathReleaseParams({
            tier: currentTier,
            recentScores:
              referenceScores,
          });

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
         * If adaptive data cannot be loaded,
         * safely fall back to the resolved tier defaults.
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
   * ----------------------------------------------------
   * TIMER MANAGEMENT
   * ----------------------------------------------------
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
   * ----------------------------------------------------
   * FINISH EXERCISE
   * ----------------------------------------------------
   */

  const finishExercise =
    useCallback(async () => {
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

      /*
       * ------------------------------------------
       * SAVE PROGRESS
       * ------------------------------------------
       */

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
    }, [clearTimers]);

  /*
   * ----------------------------------------------------
   * RECORDING STOP
   * ----------------------------------------------------
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

        clearTimers();

        phaseRef.current =
          'processing';

        setPhase('processing');

        setElapsed(0);
        setVolume(0);

        /*
         * Always read the current adaptive
         * parameters through the ref.
         */
        const adaptiveParams =
          paramsRef.current;

        /*
         * Analyze the entire pulse sequence
         * using the adaptive interval.
         */
        const measurement =
          measureControlledBreathRelease(
            samples,
            adaptiveParams.intervalSec,
            sampleRate,
          );

        /*
         * Score against the actual adaptive
         * parameters rather than the static tier.
         *
         * This is important because ADS can change
         * pulseCount and other exercise parameters.
         */
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
           * Use the same adaptive parameters
           * that were active for this exercise.
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
   * ----------------------------------------------------
   * AUDIO RECORDER
   * ----------------------------------------------------
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
   * ----------------------------------------------------
   * START RECORDING PHASE
   * ----------------------------------------------------
   */

  const startRecordingPhase =
    useCallback(() => {
      if (!mountedRef.current) {
        return;
      }

      clearTimers();

      /*
       * Use the current adaptive parameters.
       */
      const adaptiveParams =
        paramsRef.current;

      const adaptiveRecordingDuration =
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
              adaptiveRecordingDuration,
            ),
          );

          if (
            elapsedSeconds >=
            adaptiveRecordingDuration
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
   * ----------------------------------------------------
   * THREE-SECOND PREPARATION COUNTDOWN
   * ----------------------------------------------------
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
   * ----------------------------------------------------
   * START / RETRY
   * ----------------------------------------------------
   */

  const startExercise =
    useCallback(() => {
      /*
       * Do not start until the adaptive
       * parameter lookup has completed.
       */
      if (!paramsReady) {
        console.log(
          '⏳ Controlled Breath Release parameters are still loading.',
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
    }, [
      paramsReady,
      startCountdown,
    ]);

  const retryExercise =
    useCallback(() => {
      repResultsRef.current = [];

      currentRepRef.current = 1;

      setRepResults([]);

      setCurrentRep(1);

      setElapsed(0);

      setVolume(0);

      startCountdown();
    }, [startCountdown]);

  /*
   * ----------------------------------------------------
   * CLEANUP
   * ----------------------------------------------------
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
   * ----------------------------------------------------
   * RESULTS CALCULATIONS
   * ----------------------------------------------------
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
            result.measurement.peaks
              .length,
          0,
        ) /
        repResults.length
      : 0;

  const passedReps =
    repResults.filter(
      result =>
        result.score.passed,
    ).length;

  const progress =
    recordingDuration > 0
      ? Math.min(
          elapsed /
            recordingDuration,
          1,
        )
      : 0;

  const formatTime = (
    seconds: number,
  ) => seconds.toFixed(1);

  /*
   * ----------------------------------------------------
   * BACK BUTTON
   * ----------------------------------------------------
   */

  const handleBack = () => {
    if (
      phase === 'instructions'
    ) {
      router.replace(
        '/dashboard/exercises',
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

  /*
   * ----------------------------------------------------
   * INSTRUCTIONS
   * ----------------------------------------------------
   */

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
          <View
            style={styles.iconCircle}
          >
            <Ionicons
              name="pulse-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.title}>
            Controlled Breath Release
          </Text>

          <Text style={styles.subtitle}>
            Breath Control
          </Text>

          <View
            style={
              styles.instructionCard
            }
          >
            <Text
              style={
                styles.sectionTitle
              }
            >
              Exercise Instructions
            </Text>

            <Text
              style={
                styles.instructionText
              }
            >
              Take a comfortable breath,
              then release it in short,
              controlled pulses toward the
              microphone.
            </Text>

            <View
              style={styles.beforeCard}
            >
              <Text
                style={styles.beforeTitle}
              >
                Before You Begin
              </Text>

              <PrepareItem
                icon="leaf-outline"
                text="Sit or stand with a relaxed posture."
              />

              <PrepareItem
                icon="body-outline"
                text="Take a comfortable breath without forcing it."
              />

              <PrepareItem
                icon="volume-low-outline"
                text="Exhale gently and steadily in controlled pulses."
              />

              <PrepareItem
                icon="mic-outline"
                text="Stay close enough to the microphone for consistent audio."
              />
            </View>

            <View
              style={styles.targetBox}
            >
              <View
                style={styles.targetItem}
              >
                <Text
                  style={
                    styles.targetLabel
                  }
                >
                  TARGET
                </Text>

                <Text
                  style={
                    styles.targetValue
                  }
                >
                  {params.pulseCount}{' '}
                  pulses
                </Text>

                <Text
                  style={
                    styles.targetHint
                  }
                >
                  {params.intervalSec}s
                  apart
                </Text>
              </View>

              <View
                style={
                  styles.targetDivider
                }
              />

              <View
                style={styles.targetItem}
              >
                <Text
                  style={
                    styles.targetLabel
                  }
                >
                  REPETITIONS
                </Text>

                <Text
                  style={
                    styles.targetValue
                  }
                >
                  {params.repetitions}
                </Text>

                <Text
                  style={
                    styles.targetHint
                  }
                >
                  attempts
                </Text>
              </View>
            </View>

            <View
              style={styles.tipCard}
            >
              <Ionicons
                name="bulb-outline"
                size={21}
                color={BROWN}
              />

              <Text
                style={styles.tipText}
              >
                Focus on control rather
                than releasing your breath
                too quickly. Use comfortable,
                gentle breath pulses.
              </Text>
            </View>
          </View>

          <View
            style={styles.difficultyRow}
          >
            <View>
              <Text
                style={
                  styles.difficultyLabel
                }
              >
                DIFFICULTY
              </Text>

              <Text
                style={
                  styles.difficultyValue
                }
              >
                {tier
                  ? tier.charAt(0).toUpperCase() +
                    tier.slice(1)
                  : 'Beginner'}
              </Text>
            </View>

            <View
              style={
                styles.difficultyDots
              }
            >
              {[
                'beginner',
                'intermediate',
                'advanced',
              ].map(level => (
                <View
                  key={level}
                  style={[
                    styles.difficultyDot,
                    level === tier &&
                      styles.difficultyDotActive,
                  ]}
                />
              ))}
            </View>
          </View>

          <Pressable
            style={[
              styles.startButton,
              !paramsReady &&
                styles.startButtonDisabled,
            ]}
            onPress={startExercise}
            disabled={!paramsReady}
          >
            <Ionicons
              name="play"
              size={20}
              color={WHITE}
            />

            <Text
              style={
                styles.startButtonText
              }
            >
              {paramsReady
                ? 'Start Exercise'
                : 'Loading...'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  /*
   * ----------------------------------------------------
   * COUNTDOWN
   * ----------------------------------------------------
   */

  if (phase === 'countdown') {
    return (
      <View
        style={
          styles.exerciseScreen
        }
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
            GET READY
          </Text>

          <Text style={styles.repText}>
            Repetition {currentRep} of{' '}
            {params.repetitions}
          </Text>

          <View
            style={
              styles.countdownCircle
            }
          >
            <Text
              style={
                styles.countdownText
              }
            >
              {countdown}
            </Text>
          </View>

          <Text
            style={
              styles.exerciseTitle
            }
          >
            Prepare your breath
          </Text>

          <Text
            style={
              styles.exerciseDescription
            }
          >
            Take a comfortable breath and
            get ready to release short,
            controlled pulses.
          </Text>
        </View>
      </View>
    );
  }

  /*
   * ----------------------------------------------------
   * RECORDING
   * ----------------------------------------------------
   */

  if (phase === 'recording') {
    return (
      <View
        style={
          styles.exerciseScreen
        }
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
              name="pulse-outline"
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
   * ----------------------------------------------------
   * PROCESSING
   * ----------------------------------------------------
   */

  if (phase === 'processing') {
    return (
      <View
        style={
          styles.exerciseScreen
        }
      >
        {renderBackButton()}

        <View
          style={
            styles.processingContent
          }
        >
          <View
            style={
              styles.processingCircle
            }
          >
            <Ionicons
              name="analytics-outline"
              size={48}
              color={BROWN}
            />
          </View>

          <Text
            style={
              styles.processingTitle
            }
          >
            Analyzing your breath pulses
          </Text>

          <Text
            style={
              styles.processingText
            }
          >
            Checking pulse consistency and
            timing...
          </Text>
        </View>
      </View>
    );
  }

  /*
   * ----------------------------------------------------
   * RESULTS
   * ----------------------------------------------------
   */

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
        <View
          style={styles.resultsIcon}
        >
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
          style={
            styles.resultsSubtitle
          }
        >
          Your controlled breath release
          results
        </Text>

        {/* OVERALL SCORE */}

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
              ? 'Excellent breath control!'
              : averageScore >= 75
                ? 'Great work!'
                : averageScore >= 60
                  ? 'Good effort!'
                  : 'Keep practicing!'}
          </Text>
        </View>

        {/* SUMMARY */}

        <View style={styles.statsGrid}>
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

        {/* RETRY */}

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
            style={
              styles.retryButtonText
            }
          >
            Try Again
          </Text>
        </Pressable>

        {/* DONE */}

        <Pressable
          style={styles.doneButton}
          onPress={() =>
            router.replace(
              '/dashboard/exercises',
            )
          }
        >
          <Text
            style={
              styles.doneButtonText
            }
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

      <Text
        style={styles.prepareText}
      >
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
        style={
          styles.parameterValue
        }
      >
        {value}
      </Text>

      <Text
        style={
          styles.parameterLabel
        }
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
    paddingTop: 78,
    paddingBottom: 60,
    alignItems: 'center',
  },

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
    fontSize: 16,
    color: MUTED,

    marginTop: 3,
    marginBottom: 24,
  },

  instructionCard: {
    width: '100%',

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
    fontSize: 14,
    lineHeight: 17,
    color: BROWN,

    marginLeft: 10,
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

  targetText: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
  },

  intervalText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,

    marginTop: 3,
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

  startButtonDisabled: {
    opacity: 0.55,
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