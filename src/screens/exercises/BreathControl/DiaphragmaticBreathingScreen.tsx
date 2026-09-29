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
  type DiaphragmaticBreathingParams,
  type Tier,
} from '@/constants/exercises/breathControl';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import type { DiaphragmaticBreathingMeasurement } from '@/services/measurement/breathControl/diaphragmaticBreathing';

import {
  measureDiaphragmaticBreathing,
} from '@/services/measurement/breathControl/diaphragmaticBreathing';

import type { DiaphragmaticBreathingScoreResult } from '@/services/scoring/breathControl/diaphragmaticBreathing';

import {
  scoreDiaphragmaticBreathing,
} from '@/services/scoring/breathControl/diaphragmaticBreathing';

import {
  generateDiaphragmaticBreathingParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { getLatestAssessment } from '@/services/assessment/assessmentRepository';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import { auth } from '@/services/firebase/config';


const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

interface Props {
  tier?: Tier;
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
  tier: initialTier,
}: Props) {
  /*
   * =====================================================
   * ADAPTIVE PARAMETERS
   * =====================================================
   */

  const [params, setParams] =
    useState<DiaphragmaticBreathingParams | null>(
      null,
    );

  const paramsRef =
    useRef<DiaphragmaticBreathingParams | null>(
      null,
    );

  const [tier, setTier] =
    useState<Tier | null>(
      initialTier ?? null,
    );

  const tierRef =
    useRef<Tier>(
      initialTier ?? 'beginner',
    );

  const [paramsReady, setParamsReady] =
    useState(false);

  /*
   * =====================================================
   * SCREEN STATE
   * =====================================================
   */

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

  const [currentInhaleSamples, setCurrentInhaleSamples] =
    useState<Float32Array | null>(null);

  /*
   * =====================================================
   * REFS
   * =====================================================
   */

  const mountedRef =
    useRef(true);

  const phaseRef =
    useRef<Phase>('instructions');

  const currentRepRef =
    useRef(1);

  const inhaleSamplesRef =
    useRef<Float32Array | null>(null);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const stopRecordingRef =
    useRef<(() => void) | null>(null);

  const repResultsRef =
    useRef<RepResult[]>([]);

  const phaseTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const stopTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  /*
   * These refs prevent asynchronous callbacks
   * from depending on declaration order.
   */

  const startPhaseTimerRef =
    useRef<((durationSec: number) => void) | null>(
      null,
    );

  const startInhalePhaseRef =
    useRef<(() => void) | null>(
      null,
    );

  const startCountdownRef =
    useRef<(() => void) | null>(
      null,
    );

  /*
   * =====================================================
   * LOAD ADAPTIVE PARAMETERS
   * =====================================================
   *
   * Tier selection and continuous ADS adjustment are
   * handled separately.
   *
   * 1. Use an explicitly supplied tier when available.
   * 2. Otherwise load the saved component tier.
   * 3. If no progress exists, use Beginner.
   * 4. Use the latest five current-tier exercise scores.
   * 5. If no current-tier history exists, use the latest
   *    assessment Breath Control score.
   * 6. If neither exists, use the default tier parameters.
   */

  useEffect(() => {
    let cancelled = false;

    const initializeParams = async () => {
      let currentTier: Tier =
        initialTier ?? 'beginner';

      let recentScores: number[] = [];

      /*
       * ===================================================
       * STEP 1: DETERMINE CURRENT TIER
       * ===================================================
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
          '❌ Failed to load Diaphragmatic Breathing current tier:',
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

      setTier(
        currentTier,
      );
/*
 * ===================================================
 * STEP 2: LOAD EXERCISE HISTORY
 * ===================================================
 *
 * Continuous ADS uses only the latest five
 * completed exercises for this specific
 * exercise and current tier.
 *
 * Other Breath Control exercises and other
 * tiers are excluded.
 */

try {
  const user =
    auth.currentUser;

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
            'diaphragmaticBreathing' &&
          record.tier ===
            currentTier,
      );

    recentScores =
      currentExerciseRecords
        .slice(-5)
        .map(
          record =>
            record.scorePct,
        );

    if (
      recentScores.length > 0
    ) {
      console.log(
        '📊 Diaphragmatic Breathing ADS reference from exercise history:',
        recentScores,
      );
    }
  }

  /*
   * =================================================
   * STEP 3: ASSESSMENT COLD-START FALLBACK
   * =================================================
   *
   * If this exercise has never been completed
   * at the current tier, use the latest
   * Breath Control assessment score as the
   * initial ADS reference.
   *
   * Once exercise history exists, the assessment
   * is no longer used for continuous ADS.
   */

  if (
    recentScores.length === 0
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
      recentScores = [
        assessmentScore,
      ];

      console.log(
        '📋 Diaphragmatic Breathing ADS cold-start reference from assessment:',
        assessmentScore,
      );
    } else {
      console.log(
        'ℹ️ No exercise history or assessment score. Using default parameters.',
      );
    }
  }
} catch (error) {
  console.error(
    '❌ Failed to load Diaphragmatic Breathing ADS reference:',
    error,
  );

  recentScores = [];
}
      /*
       * ===================================================
       * STEP 4: GENERATE ADAPTIVE PARAMETERS
       * ===================================================
       */

      const generatedParams =
        generateDiaphragmaticBreathingParams({
          tier: currentTier,
          recentScores,
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
        '🎯 Diaphragmatic Breathing adaptive parameters:',
        {
          tier: currentTier,
          recentScores,
          generatedParams,
        },
      );
    };

    setParamsReady(false);

    initializeParams();

    return () => {
      cancelled = true;
    };
  }, [initialTier]);

  /*
   * =====================================================
   * TIMER CLEANUP
   * =====================================================
   */

  const clearTimers =
    useCallback(() => {
      if (
        phaseTimerRef.current
      ) {
        clearInterval(
          phaseTimerRef.current,
        );

        phaseTimerRef.current =
          null;
      }

      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current,
        );

        countdownTimerRef.current =
          null;
      }

      if (
        stopTimerRef.current
      ) {
        clearTimeout(
          stopTimerRef.current,
        );

        stopTimerRef.current =
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
          '🏆 Final Diaphragmatic Breathing results:',
          finalResults,
        );

        console.log(
          '🏆 Final Diaphragmatic Breathing score:',
          finalScore,
        );

        /*
         * ------------------------------------------
         * SAVE PROGRESS
         * ------------------------------------------
         */

        const activeTier =
          tierRef.current;

        try {
          await saveCompletedExercise(
            'breathControl',
            'diaphragmaticBreathing',
            activeTier,
            finalScore,
          );

          console.log(
            '💾 Diaphragmatic Breathing progress saved',
          );
        } catch (saveError) {
          console.error(
            '❌ Failed to save Diaphragmatic Breathing progress:',
            saveError,
          );
        }

        if (!mountedRef.current) {
          return;
        }

        setPhase('results');

        phaseRef.current =
          'results';
      },
      [clearTimers],
    );

  /*
   * =====================================================
   * PROCESS REPETITION
   * =====================================================
   */

  const processRep =
    useCallback(
      (
        inhaleSamples: Float32Array,
        exhaleSamples: Float32Array,
        sampleRate: number,
      ) => {
        if (!mountedRef.current) {
          return;
        }

        const adaptiveParams =
          paramsRef.current;

        if (!adaptiveParams) {
          console.error(
            '❌ Diaphragmatic Breathing parameters are not ready.',
          );

          setPhase(
            'instructions',
          );

          phaseRef.current =
            'instructions';

          return;
        }

        /*
         * Measure using the adaptive
         * detection threshold.
         */

        const measurement =
          measureDiaphragmaticBreathing(
            inhaleSamples,
            exhaleSamples,
            adaptiveParams.detectionThreshold,
            sampleRate,
          );

        /*
         * Score against the adaptive
         * parameters.
         */

        const score =
          scoreDiaphragmaticBreathing(
            measurement,
            adaptiveParams,
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

        setRepResults([
          ...repResultsRef.current,
        ]);

        /*
         * Finish once the adaptive number
         * of repetitions has been completed.
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

        /*
         * Give the user a short pause
         * before the next repetition.
         */

        stopTimerRef.current =
          setTimeout(() => {
            if (
              !mountedRef.current
            ) {
              return;
            }

            startCountdownRef.current?.();
          }, 700);
      },
      [finishExercise],
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

        const adaptiveParams =
          paramsRef.current;

        if (!adaptiveParams) {
          console.error(
            '❌ Diaphragmatic Breathing parameters are not ready.',
          );

          setPhase(
            'instructions',
          );

          phaseRef.current =
            'instructions';

          return;
        }

        const stoppedPhase =
          phaseRef.current;

        /*
         * ------------------------------------------
         * INHALE FINISHED
         * ------------------------------------------
         */

        if (
          stoppedPhase ===
          'inhale'
        ) {
          inhaleSamplesRef.current =
            samples;

          setCurrentInhaleSamples(
            samples,
          );

          setElapsed(0);
          setVolume(0);

          phaseRef.current =
            'exhale';

          setPhase('exhale');

          /*
           * Small delay before starting
           * the exhale recording.
           */

          stopTimerRef.current =
            setTimeout(() => {
              if (
                !mountedRef.current
              ) {
                return;
              }

              startRecordingRef.current?.();

              startPhaseTimerRef.current?.(
                adaptiveParams.exhaleSec,
              );
            }, 250);

          return;
        }

        /*
         * ------------------------------------------
         * EXHALE FINISHED
         * ------------------------------------------
         */

        if (
          stoppedPhase ===
          'exhale'
        ) {
          const inhaleSamples =
            inhaleSamplesRef.current;

          if (!inhaleSamples) {
            phaseRef.current =
              'processing';

            setPhase(
              'processing',
            );

            stopTimerRef.current =
              setTimeout(() => {
                if (
                  mountedRef.current
                ) {
                  finishExercise();
                }
              }, 500);

            return;
          }

          phaseRef.current =
            'processing';

          setPhase(
            'processing',
          );

          setElapsed(0);
          setVolume(0);

          stopTimerRef.current =
            setTimeout(() => {
              if (
                !mountedRef.current
              ) {
                return;
              }

              processRep(
                inhaleSamples,
                samples,
                sampleRate,
              );

              inhaleSamplesRef.current =
                null;

              setCurrentInhaleSamples(
                null,
              );
            }, 300);
        }
      },
      [
        finishExercise,
        processRep,
      ],
    );

  /*
   * =====================================================
   * AUDIO RECORDER
   * =====================================================
   */

  const {
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
   * PHASE TIMER
   * =====================================================
   */

  const startPhaseTimer =
    useCallback(
      (durationSec: number) => {
        clearTimers();

        const startedAt =
          Date.now();

        setElapsed(0);

        phaseTimerRef.current =
          setInterval(() => {
            if (
              !mountedRef.current
            ) {
              return;
            }

            const elapsedSec =
              (Date.now() -
                startedAt) /
              1000;

            setElapsed(
              Math.min(
                elapsedSec,
                durationSec,
              ),
            );

            if (
              elapsedSec >=
              durationSec
            ) {
              if (
                phaseTimerRef.current
              ) {
                clearInterval(
                  phaseTimerRef.current,
                );

                phaseTimerRef.current =
                  null;
              }

              stopRecordingRef.current?.();
            }
          }, 50);
      },
      [clearTimers],
    );

  useEffect(() => {
    startPhaseTimerRef.current =
      startPhaseTimer;
  }, [startPhaseTimer]);

  /*
   * =====================================================
   * INHALE PHASE
   * =====================================================
   */

  const startInhalePhase =
    useCallback(() => {
      if (!mountedRef.current) {
        return;
      }

      const adaptiveParams =
        paramsRef.current;

      if (!adaptiveParams) {
        return;
      }

      clearTimers();

      phaseRef.current =
        'inhale';

      setPhase('inhale');

      setElapsed(0);
      setVolume(0);

      inhaleSamplesRef.current =
        null;

      setCurrentInhaleSamples(
        null,
      );

      startRecordingRef.current?.();

      startPhaseTimerRef.current?.(
        adaptiveParams.inhaleSec,
      );
    }, [clearTimers]);

  useEffect(() => {
    startInhalePhaseRef.current =
      startInhalePhase;
  }, [startInhalePhase]);

  /*
   * =====================================================
   * COUNTDOWN
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
          if (
            !mountedRef.current
          ) {
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

            startInhalePhaseRef.current?.();

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
      /*
       * Do not start while ADS parameters
       * are still being prepared.
       */

      if (!paramsReady) {
        console.log(
          '⏳ Diaphragmatic Breathing parameters are still loading.',
        );

        return;
      }

      if (!paramsRef.current) {
        console.error(
          '❌ Cannot start exercise without adaptive parameters.',
        );

        return;
      }

      currentRepRef.current = 1;

      repResultsRef.current =
        [];

      setCurrentRep(1);
      setRepResults([]);
      setElapsed(0);
      setVolume(0);

      startCountdownRef.current?.();
    }, [paramsReady]);

  const retryExercise =
    useCallback(() => {
      if (!paramsReady) {
        return;
      }

      currentRepRef.current = 1;

      repResultsRef.current =
        [];

      setCurrentRep(1);
      setRepResults([]);
      setElapsed(0);
      setVolume(0);

      startCountdownRef.current?.();
    }, [paramsReady]);

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
   * WAIT FOR ADAPTIVE PARAMETERS
   * =====================================================
   */

  if (!params || !tier) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable
            style={styles.backButton}
            onPress={() =>
              router.back()
            }
          >
            <Ionicons
              name="arrow-back"
              size={24}
              color={BROWN}
            />
          </Pressable>

          <Text
            style={
              styles.headerTitle
            }
          >
            Diaphragmatic Breathing
          </Text>

          <View
            style={
              styles.headerSpacer
            }
          />
        </View>

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
              name="options-outline"
              size={48}
              color={BROWN}
            />
          </View>

          <Text
            style={
              styles.processingTitle
            }
          >
            Preparing your exercise
          </Text>

          <Text
            style={
              styles.processingText
            }
          >
            Setting your breathing
            parameters...
          </Text>
        </View>
      </View>
    );
  }

  /*
   * =====================================================
   * CALCULATED RESULTS
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

  const averageInhale =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .inhaleDurationSec,
          0,
        ) /
        repResults.length
      : 0;

  const averageExhale =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .exhaleDurationSec,
          0,
        ) /
        repResults.length
      : 0;

  const averageConsistency =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .consistencyPct,
          0,
        ) /
        repResults.length
      : 0;

  const averageVolume =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .volumeDb,
          0,
        ) /
        repResults.length
      : 0;

  const progress =
    phase === 'inhale'
      ? Math.min(
          elapsed /
            params.inhaleSec,
          1,
        )
      : phase === 'exhale'
        ? Math.min(
            elapsed /
              params.exhaleSec,
            1,
          )
        : 0;

  const formatTime = (
    seconds: number,
  ) =>
    seconds.toFixed(1);

  /*
   * =====================================================
   * HEADER
   * =====================================================
   */

  const renderHeader = () => (
    <View style={styles.header}>
      <Pressable
        style={styles.backButton}
        onPress={() => {
          if (
            phase ===
            'instructions'
          ) {
            router.back();
          } else {
            stopRecordingRef.current?.();

            clearTimers();

            phaseRef.current =
              'instructions';

            setPhase(
              'instructions',
            );
          }
        }}
      >
        <Ionicons
          name="arrow-back"
          size={24}
          color={BROWN}
        />
      </Pressable>

      <Text
        style={styles.headerTitle}
      >
        Diaphragmatic Breathing
      </Text>

      <View
        style={styles.headerSpacer}
      />
    </View>
  );

  /*
   * =====================================================
   * INSTRUCTIONS
   * =====================================================
   */

  if (
    phase === 'instructions'
  ) {
    return (
      <View
        style={styles.container}
      >
        {renderHeader()}

        <ScrollView
          contentContainerStyle={
            styles.instructionsContent
          }
          showsVerticalScrollIndicator={
            false
          }
        >
          <View
            style={styles.iconCircle}
          >
            <Ionicons
              name="body-outline"
              size={46}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.title}
          >
            Diaphragmatic Breathing
          </Text>

          <Text
            style={styles.subtitle}
          >
            Breath Control
          </Text>

          <View
            style={styles.card}
          >
            <Text
              style={
                styles.cardTitle
              }
            >
              Exercise Instructions
            </Text>

            <Text
              style={
                styles.helperText
              }
            >
              Breathe slowly and deeply
              using your diaphragm.
              Inhale comfortably, then
              exhale gently and smoothly
              while keeping your airflow
              controlled.
            </Text>

            <View
              style={
                styles.beforeCard
              }
            >
              <Text
                style={
                  styles.beforeTitle
                }
              >
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
                text="Inhale with ease and exhale gently and steadily."
              />

              <InstructionRow
                icon="mic-outline"
                text="Stay close enough to the microphone for consistent audio."
              />
            </View>

            <View
              style={
                styles.targetBox
              }
            >
              <View
                style={
                  styles.targetItem
                }
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
                  {params.inhaleSec}s{' '}
                  inhale /{' '}
                  {params.exhaleSec}s{' '}
                  exhale
                </Text>

                <Text
                  style={
                    styles.targetHint
                  }
                >
                  breathing pattern
                </Text>
              </View>

              <View
                style={
                  styles.targetDivider
                }
              />

              <View
                style={
                  styles.targetItem
                }
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
              style={
                styles.tipCard
              }
            >
              <View
                style={
                  styles.tipIcon
                }
              >
                <Ionicons
                  name="bulb-outline"
                  size={20}
                  color={BROWN}
                />
              </View>

              <View
                style={
                  styles.tipContent
                }
              >
                <Text
                  style={
                    styles.tipText
                  }
                >
                  Focus on maintaining a
                  relaxed, controlled
                  airflow instead of
                  forcing each breath.
                </Text>
              </View>
            </View>
          </View>

          <View
            style={
              styles.difficultyRow
            }
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
                  .charAt(0)
                  .toUpperCase() +
                  tier.slice(1)}
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
            style={
              styles.startButton
            }
            onPress={
              startExercise
            }
          >
            <Ionicons
              name="play"
              size={21}
              color={WHITE}
            />

            <Text
              style={
                styles.startButtonText
              }
            >
              Start Exercise
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  /*
   * =====================================================
   * COUNTDOWN
   * =====================================================
   */

  if (
    phase === 'countdown'
  ) {
    return (
      <View
        style={
          styles.exerciseContainer
        }
      >
        {renderHeader()}

        <View
          style={
            styles.exerciseContent
          }
        >
          <Text
            style={
              styles.phaseLabel
            }
          >
            GET READY
          </Text>

          <Text
            style={styles.repText}
          >
            Repetition {currentRep}{' '}
            of {params.repetitions}
          </Text>

          <View
            style={
              styles.largeCircle
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
              styles.instructionTitle
            }
          >
            Prepare to breathe
          </Text>

          <Text
            style={
              styles.instructionText
            }
          >
            Relax your shoulders and
            get ready to inhale slowly.
          </Text>
        </View>
      </View>
    );
  }

  /*
   * =====================================================
   * INHALE
   * =====================================================
   */

  if (
    phase === 'inhale'
  ) {
    return (
      <View
        style={
          styles.exerciseContainer
        }
      >
        {renderHeader()}

        <View
          style={
            styles.exerciseContent
          }
        >
          <Text
            style={
              styles.phaseLabel
            }
          >
            INHALE
          </Text>

          <Text
            style={styles.repText}
          >
            Repetition {currentRep}{' '}
            of {params.repetitions}
          </Text>

          <View
            style={
              styles.breathCircle
            }
          >
            <Ionicons
              name="arrow-down-outline"
              size={42}
              color={BROWN}
            />

            <Text
              style={
                styles.phaseTime
              }
            >
              {formatTime(elapsed)}
            </Text>

            <Text
              style={
                styles.phaseTarget
              }
            >
              / {params.inhaleSec.toFixed(1)}s
            </Text>
          </View>

          <Text
            style={
              styles.instructionTitle
            }
          >
            Breathe in slowly
          </Text>

          <Text
            style={
              styles.instructionText
            }
          >
            Take a comfortable, deep
            breath using your
            diaphragm.
          </Text>

          <ProgressBar
            progress={progress}
          />

          <Text
            style={styles.smallHint}
          >
            Keep your shoulders
            relaxed.
          </Text>
        </View>
      </View>
    );
  }

  /*
   * =====================================================
   * EXHALE
   * =====================================================
   */

  if (
    phase === 'exhale'
  ) {
    const [
      dbMin,
      dbMax,
    ] =
      params.targetDbRange;

    return (
      <View
        style={
          styles.exerciseContainer
        }
      >
        {renderHeader()}

        <View
          style={
            styles.exerciseContent
          }
        >
          <Text
            style={
              styles.phaseLabel
            }
          >
            EXHALE
          </Text>

          <Text
            style={styles.repText}
          >
            Repetition {currentRep}{' '}
            of {params.repetitions}
          </Text>

          <View
            style={
              styles.breathCircle
            }
          >
            <Ionicons
              name="arrow-up-outline"
              size={42}
              color={BROWN}
            />

            <Text
              style={
                styles.phaseTime
              }
            >
              {formatTime(elapsed)}
            </Text>

            <Text
              style={
                styles.phaseTarget
              }
            >
              / {params.exhaleSec.toFixed(1)}s
            </Text>
          </View>

          <Text
            style={
              styles.instructionTitle
            }
          >
            Exhale gently
          </Text>

          <Text
            style={
              styles.instructionText
            }
          >
            Slowly release your breath
            toward the microphone.
          </Text>

          <View
            style={
              styles.volumeCard
            }
          >
            <Text
              style={
                styles.volumeLabel
              }
            >
              AIRFLOW LEVEL
            </Text>

            <Text
              style={
                styles.volumeValue
              }
            >
              {volume.toFixed(2)}
            </Text>

            <Text
              style={
                styles.volumeTarget
              }
            >
              Target: {dbMin}–{dbMax} dB
            </Text>
          </View>

          <ProgressBar
            progress={progress}
          />

          <Text
            style={styles.smallHint}
          >
            Keep your airflow smooth
            and consistent.
          </Text>
        </View>
      </View>
    );
  }

  /*
   * =====================================================
   * PROCESSING
   * =====================================================
   */

  if (
    phase === 'processing'
  ) {
    return (
      <View
        style={
          styles.exerciseContainer
        }
      >
        {renderHeader()}

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
            Analyzing your breathing
          </Text>

          <Text
            style={
              styles.processingText
            }
          >
            Measuring duration,
            consistency, and volume...
          </Text>
        </View>
      </View>
    );
  }

  /*
   * =====================================================
   * RESULTS
   * =====================================================
   */

  return (
    <View
      style={styles.container}
    >
      {renderHeader()}

      <ScrollView
        contentContainerStyle={
          styles.resultsContent
        }
        showsVerticalScrollIndicator={
          false
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
          Your diaphragmatic
          breathing results
        </Text>

        <View
          style={styles.scoreCard}
        >
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
            style={
              styles.scoreMessage
            }
          >
            {averageScore >= 90
              ? 'Excellent control!'
              : averageScore >= 75
                ? 'Great work!'
                : averageScore >= 60
                  ? 'Good effort!'
                  : 'Keep practicing!'}
          </Text>
        </View>

        <View
          style={styles.statsGrid}
        >
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
              averageConsistency,
            )}%`}
          />

          <ResultStat
            label="Avg. Volume"
            value={
              Number.isFinite(
                averageVolume,
              )
                ? `${averageVolume.toFixed(1)} dB`
                : '--'
            }
          />
        </View>

        <Text
          style={
            styles.sectionTitle
          }
        >
          Repetition Results
        </Text>

        {repResults.map(
          result => (
            <View
              key={`rep-${result.rep}`}
              style={
                styles.repResultCard
              }
            >
              <View
                style={
                  styles.repResultHeader
                }
              >
                <Text
                  style={
                    styles.repResultTitle
                  }
                >
                  Repetition {result.rep}
                </Text>

                <View
                  style={[
                    styles.passBadge,
                    !result.score
                      .passed &&
                      styles.failBadge,
                  ]}
                >
                  <Text
                    style={
                      styles.passBadgeText
                    }
                  >
                    {result.score
                      .passed
                      ? 'PASS'
                      : 'KEEP PRACTICING'}
                  </Text>
                </View>
              </View>

              <View
                style={
                  styles.repMetrics
                }
              >
                <Metric
                  label="Inhale"
                  value={`${result.measurement.inhaleDurationSec.toFixed(
                    1,
                  )}s`}
                />

                <Metric
                  label="Exhale"
                  value={`${result.measurement.exhaleDurationSec.toFixed(
                    1,
                  )}s`}
                />

                <Metric
                  label="Consistency"
                  value={`${Math.round(
                    result.measurement
                      .consistencyPct,
                  )}%`}
                />

                <Metric
                  label="Score"
                  value={`${result.score.score}%`}
                />
              </View>
            </View>
          ),
        )}

        <Pressable
          style={
            styles.retryButton
          }
          onPress={
            retryExercise
          }
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

/*
 * =====================================================
 * UI COMPONENTS
 * =====================================================
 */

function InstructionRow({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View
      style={styles.instructionRow}
    >
      <Ionicons
        name={icon}
        size={15}
        color={BROWN}
      />

      <Text
        style={
          styles.instructionRowText
        }
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
    <View
      style={styles.parameter}
    >
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

function ProgressBar({
  progress,
}: {
  progress: number;
}) {
  return (
    <View
      style={
        styles.progressTrack
      }
    >
      <View
        style={[
          styles.progressFill,
          {
            width: `${Math.max(
              0,
              Math.min(
                progress,
                1,
              ) * 100,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 29,
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
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
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

  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 15,
  },

  helperText: {
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

  tipIcon: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
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

  tierBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: LIGHT_PINK,
  },

  tierText: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
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