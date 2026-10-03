import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  type DiaphragmaticBreathingParams,
  type Tier,
} from '@/constants/exercises/breathControl';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import {
  measureDiaphragmaticBreathing,
  type DiaphragmaticBreathingMeasurement,
} from '@/services/measurement/breathControl/diaphragmaticBreathing';

import {
  scoreDiaphragmaticBreathing,
  type DiaphragmaticBreathingScoreResult,
} from '@/services/scoring/breathControl/diaphragmaticBreathing';

import { generateDiaphragmaticBreathingParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { getLatestAssessment } from '@/services/assessment/assessmentRepository';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

import { auth } from '@/services/firebase/config';

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

export default function DiaphragmaticBreathingScreen({
  tier: initialTier,
}: Props) {
  /*
   * =====================================================
   * ADAPTIVE PARAMETERS
   * =====================================================
   */

  const [params, setParams] =
    useState<DiaphragmaticBreathingParams | null>(null);

  const paramsRef =
    useRef<DiaphragmaticBreathingParams | null>(null);

  const [tier, setTier] =
    useState<Tier | null>(initialTier ?? null);

  const tierRef =
    useRef<Tier>(initialTier ?? 'beginner');

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

  const inhaleSamplesRef =
    useRef<Float32Array | null>(null);

  /*
   * =====================================================
   * LIFECYCLE / RECORDER REFS
   * =====================================================
   */

  const mountedRef =
    useRef(true);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const stopRecordingRef =
    useRef<(() => void) | null>(null);

  /*
   * =====================================================
   * TIMERS
   * =====================================================
   */

  const phaseTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPhaseTimerRef =
    useRef<((durationSec: number) => void) | null>(null);

  const startInhalePhaseRef =
    useRef<(() => void) | null>(null);

  const startCountdownRef =
    useRef<(() => void) | null>(null);

  /*
   * =====================================================
   * INITIALIZE ADAPTIVE PARAMETERS
   * =====================================================
   */

  useEffect(() => {
    let cancelled = false;

    const initializeParams = async () => {
      setParamsReady(false);

      let currentTier: Tier =
        initialTier ?? 'beginner';

      let recentScores: number[] = [];

      /*
       * -----------------------------------------------
       * STEP 1: DETERMINE CURRENT TIER
       * -----------------------------------------------
       */

      try {
        const user = auth.currentUser;

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

      setTier(currentTier);

      /*
       * -----------------------------------------------
       * STEP 2: LOAD EXERCISE HISTORY
       * -----------------------------------------------
       *
       * Continuous ADS uses only the latest five
       * completed exercises for this specific
       * exercise and current tier.
       *
       * Other Breath Control exercises and other
       * tiers are excluded.
       */

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
                  'diaphragmaticBreathing' &&
                record.tier === currentTier,
            );

          recentScores =
            currentExerciseRecords
              .slice(-5)
              .map(
                record =>
                  record.scorePct,
              );

          if (recentScores.length > 0) {
            console.log(
              '📊 Diaphragmatic Breathing ADS reference from exercise history:',
              recentScores,
            );
          }
        }

        /*
         * ---------------------------------------------
         * STEP 3: ASSESSMENT COLD-START FALLBACK
         * ---------------------------------------------
         *
         * If this exercise has never been completed
         * at the current tier, use the latest
         * Breath Control assessment score.
         */

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

      if (cancelled) {
        return;
      }

      /*
       * -----------------------------------------------
       * STEP 4: GENERATE ADAPTIVE PARAMETERS
       * -----------------------------------------------
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
      if (phaseTimerRef.current) {
        clearInterval(
          phaseTimerRef.current,
        );

        phaseTimerRef.current =
          null;
      }

      if (countdownTimerRef.current) {
        clearInterval(
          countdownTimerRef.current,
        );

        countdownTimerRef.current =
          null;
      }

      if (stopTimerRef.current) {
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

        phaseRef.current =
          'results';

        setPhase('results');
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

          phaseRef.current =
            'instructions';

          setPhase('instructions');

          return;
        }

        const measurement =
          measureDiaphragmaticBreathing(
            inhaleSamples,
            exhaleSamples,
            adaptiveParams.detectionThreshold,
            sampleRate,
          );

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

        stopTimerRef.current =
          setTimeout(() => {
            if (!mountedRef.current) {
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

          phaseRef.current =
            'instructions';

          setPhase('instructions');

          return;
        }

        const stoppedPhase =
          phaseRef.current;

        /*
         * -----------------------------------------------
         * INHALE FINISHED
         * -----------------------------------------------
         */

        if (stoppedPhase === 'inhale') {
          inhaleSamplesRef.current =
            samples;

          setElapsed(0);
          setVolume(0);

          phaseRef.current =
            'exhale';

          setPhase('exhale');

          stopTimerRef.current =
            setTimeout(() => {
              if (!mountedRef.current) {
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
         * -----------------------------------------------
         * EXHALE FINISHED
         * -----------------------------------------------
         */

        if (stoppedPhase === 'exhale') {
          const inhaleSamples =
            inhaleSamplesRef.current;

          if (!inhaleSamples) {
            phaseRef.current =
              'processing';

            setPhase('processing');

            stopTimerRef.current =
              setTimeout(() => {
                if (mountedRef.current) {
                  finishExercise();
                }
              }, 500);

            return;
          }

          phaseRef.current =
            'processing';

          setPhase('processing');

          setElapsed(0);
          setVolume(0);

          stopTimerRef.current =
            setTimeout(() => {
              if (!mountedRef.current) {
                return;
              }

              processRep(
                inhaleSamples,
                samples,
                sampleRate,
              );

              inhaleSamplesRef.current =
                null;
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

  /*
   * =====================================================
   * SYNCHRONIZE RECORDER REFS
   * =====================================================
   */

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
   * RETURN TO INSTRUCTIONS
   * =====================================================
   */

  const returnToInstructions =
    useCallback(() => {
      /*
       * Set the phase ref first so an asynchronous
       * recorder callback does not treat the stop
       * as an inhale/exhale completion.
       */

      phaseRef.current =
        'instructions';

      clearTimers();

      inhaleSamplesRef.current =
        null;

      stopRecordingRef.current?.();

      setElapsed(0);
      setVolume(0);
      setPhase('instructions');
    }, [clearTimers]);

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
            if (!mountedRef.current) {
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
              if (phaseTimerRef.current) {
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
          if (!mountedRef.current) {
            return;
          }

          value -= 1;

          if (value <= 0) {
            if (countdownTimerRef.current) {
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
   * START EXERCISE
   * =====================================================
   */

  const startExercise =
    useCallback(() => {
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

      currentRepRef.current =
        1;

      repResultsRef.current =
        [];

      inhaleSamplesRef.current =
        null;

      setCurrentRep(1);
      setRepResults([]);
      setElapsed(0);
      setVolume(0);
      setCountdown(
        PREPARATION_COUNTDOWN,
      );

      startCountdownRef.current?.();
    }, [paramsReady]);

  /*
   * =====================================================
   * RETRY
   * =====================================================
   */

  const retryExercise =
    useCallback(() => {
      if (!paramsReady) {
        return;
      }

      clearTimers();

      stopRecordingRef.current?.();

      currentRepRef.current =
        1;

      repResultsRef.current =
        [];

      inhaleSamplesRef.current =
        null;

      setCurrentRep(1);
      setRepResults([]);
      setElapsed(0);
      setVolume(0);
      setCountdown(
        PREPARATION_COUNTDOWN,
      );

      startCountdownRef.current?.();
    }, [
      clearTimers,
      paramsReady,
    ]);

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
      <View style={styles.loadingScreen}>
        <View
          style={styles.loadingIconCircle}
        >
          <Ionicons
            name="options-outline"
            size={44}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.loadingTitle}
        >
          Preparing Your Exercise
        </Text>

        <Text
          style={styles.loadingText}
        >
          Adjusting the exercise to your
          current difficulty level
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.loadingSpinner}
        />
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

  /*
   * =====================================================
   * INSTRUCTIONS
   * =====================================================
   */

  if (phase === 'instructions') {
    return (
      <ExerciseScreen
        category="Breath Control"
        title="Diaphragmatic Breathing"
        icon="body-outline"
        instructions="Breathe slowly and deeply using your diaphragm. Inhale comfortably, then exhale gently and smoothly while keeping your airflow controlled."
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
            text: 'Inhale with ease and exhale gently and steadily.',
          },
          {
            icon: 'mic-outline',
            text: 'Stay close enough to the microphone for consistent audio.',
          },
        ]}
        targetValue={`${params.inhaleSec}s inhale / ${params.exhaleSec}s exhale`}
        targetHint="breathing pattern"
        repetitions={params.repetitions}
        tip="Focus on maintaining a relaxed, controlled airflow instead of forcing each breath."
        tier={tier}
        onBack={() =>
          router.back()
        }
        onStart={startExercise}
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
        icon="body-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={params.repetitions}
        countdown={countdown}
        promptTitle="Prepare to breathe"
        prompt="Relax your shoulders and get ready to inhale slowly."
        onBack={
          returnToInstructions
        }
      />
    );
  }

  /*
   * =====================================================
   * INHALE
   * =====================================================
   */

  if (phase === 'inhale') {
    return (
      <View
        style={styles.exerciseContainer}
      >
        <View
          style={styles.exerciseContent}
        >
          <Text
            style={styles.phaseLabel}
          >
            INHALE
          </Text>

          <Text
            style={styles.repText}
          >
            Repetition {currentRep} of{' '}
            {params.repetitions}
          </Text>

          <View
            style={styles.breathCircle}
          >
            <Ionicons
              name="arrow-down-outline"
              size={42}
              color={BROWN}
            />

            <Text
              style={styles.phaseTime}
            >
              {elapsed.toFixed(1)}
            </Text>

            <Text
              style={styles.phaseTarget}
            >
              / {params.inhaleSec.toFixed(1)}s
            </Text>
          </View>

          <Text
            style={styles.instructionTitle}
          >
            Breathe in slowly
          </Text>

          <Text
            style={styles.instructionText}
          >
            Take a comfortable, deep
            breath using your diaphragm.
          </Text>

          <ProgressBar
            progress={progress}
          />

          <Text
            style={styles.smallHint}
          >
            Keep your shoulders relaxed.
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

  if (phase === 'exhale') {
    const [
      dbMin,
      dbMax,
    ] =
      params.targetDbRange;

    return (
      <View
        style={styles.exerciseContainer}
      >
        <View
          style={styles.exerciseContent}
        >
          <Text
            style={styles.phaseLabel}
          >
            EXHALE
          </Text>

          <Text
            style={styles.repText}
          >
            Repetition {currentRep} of{' '}
            {params.repetitions}
          </Text>

          <View
            style={styles.breathCircle}
          >
            <Ionicons
              name="arrow-up-outline"
              size={42}
              color={BROWN}
            />

            <Text
              style={styles.phaseTime}
            >
              {elapsed.toFixed(1)}
            </Text>

            <Text
              style={styles.phaseTarget}
            >
              / {params.exhaleSec.toFixed(1)}s
            </Text>
          </View>

          <Text
            style={styles.instructionTitle}
          >
            Exhale gently
          </Text>

          <Text
            style={styles.instructionText}
          >
            Slowly release your breath
            toward the microphone.
          </Text>

          <View
            style={styles.volumeCard}
          >
            <Text
              style={styles.volumeLabel}
            >
              AIRFLOW LEVEL
            </Text>

            <Text
              style={styles.volumeValue}
            >
              {volume.toFixed(2)}
            </Text>

            <Text
              style={styles.volumeTarget}
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
            Keep your airflow smooth and
            consistent.
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

  if (phase === 'processing') {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your Breathing"
        message="Measuring duration, consistency, and volume..."
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
      subtitle="Your diaphragmatic breathing results"
      score={averageScore}
      resultIcon={
        averageScore >= 70
          ? 'checkmark'
          : 'analytics-outline'
      }
      scoreMessage={
        averageScore >= 90
          ? 'Excellent control!'
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
          style={styles.sectionTitle}
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
                    {result.score.passed
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
      </View>
    </ExerciseResultsScreen>
  );
}

/*
 * =====================================================
 * UI COMPONENTS
 * =====================================================
 */

function ProgressBar({
  progress,
}: {
  progress: number;
}) {
  return (
    <View
      style={styles.progressTrack}
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
   * ADS LOADING
   * -----------------------------------------------------
   */

  loadingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },

  loadingIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },

  loadingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },

  loadingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },

  loadingSpinner: {
    marginTop: 28,
  },

  /*
   * -----------------------------------------------------
   * BREATHING PHASES
   * -----------------------------------------------------
   */

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

  /*
   * -----------------------------------------------------
   * LIVE AIRFLOW
   * -----------------------------------------------------
   */

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
});