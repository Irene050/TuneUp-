// src/screens/exercises/BreathControl/ControlledBreathReleaseScreen.tsx

import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

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
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

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

  /*
   * Current guided pulse.
   *
   * This is the pulse the user should currently
   * be releasing. Actual detected pulses are still
   * determined later from the recorded audio.
   */

  const [guidedPulse, setGuidedPulse] =
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
   *
   * Keep these refs exactly so callbacks can be
   * declared before the recorder hook without
   * triggering:
   *
   * "used before being assigned"
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
   */

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParams =
      async () => {
        let currentTier: Tier =
          initialTier ?? 'beginner';

        let referenceScores: number[] =
          [];

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
         * STEP 1:
         * Resolve current tier.
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
         * STEP 2:
         * Load exercise history.
         */

        try {
          const user =
            auth.currentUser;

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
           * STEP 3:
           * Assessment cold start.
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
           * STEP 4:
           * Generate adaptive parameters.
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
        setGuidedPulse(0);
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
        setGuidedPulse(0);

        const adaptiveParams =
          paramsRef.current;

        /*
         * Continuous recording is analyzed as one
         * complete audio stream for this repetition.
         *
         * Pulse timestamps are produced by the DSP
         * detector and are therefore used for the
         * actual interval calculations.
         */

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
   *
   * IMPORTANT:
   *
   * The recorder is intentionally declared here,
   * while start/stop are exposed through refs.
   *
   * This preserves the working architecture of the
   * original file and avoids block-scoped declaration
   * errors.
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

      /*
       * The first pulse is guided immediately.
       *
       * Additional pulses occur at the configured
       * interval. Recording continues continuously
       * throughout the entire repetition.
       */

      const recordingDuration =
        Math.max(
          0,
          (adaptiveParams.pulseCount - 1) *
            adaptiveParams.intervalSec,
        ) +
        EXTRA_RECORDING_TIME_SEC;

      phaseRef.current =
        'recording';

      setPhase('recording');

      setElapsed(0);
      setVolume(0);

      /*
       * Pulse 1 is the first guided pulse.
       */

      setGuidedPulse(
        adaptiveParams.pulseCount > 0
          ? 1
          : 0,
      );

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

          /*
           * Determine which pulse should currently
           * be guided based on the configured interval.
           *
           * This is only the USER GUIDE.
           * Actual pulse detection still comes from
           * the recorded audio and DSP detector.
           */

          const nextGuidedPulse =
            Math.min(
              adaptiveParams.pulseCount,
              Math.floor(
                elapsedSeconds /
                  adaptiveParams.intervalSec,
              ) + 1,
            );

          if (
            nextGuidedPulse !==
            guidedPulseRef.current
          ) {
            guidedPulseRef.current =
              nextGuidedPulse;

            setGuidedPulse(
              nextGuidedPulse,
            );
          }

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

  /*
   * Ref used by the recording timer so the
   * interval callback does not depend on stale
   * React state.
   */

  const guidedPulseRef =
    useRef(0);

  useEffect(() => {
    guidedPulseRef.current =
      guidedPulse;
  }, [guidedPulse]);

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
      setGuidedPulse(0);

      guidedPulseRef.current = 0;

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

      guidedPulseRef.current = 0;

      setRepResults([]);
      setCurrentRep(1);
      setElapsed(0);
      setVolume(0);
      setGuidedPulse(0);

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

      guidedPulseRef.current = 0;

      setRepResults([]);
      setCurrentRep(1);
      setElapsed(0);
      setVolume(0);
      setGuidedPulse(0);

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
    Math.max(
      0,
      (params.pulseCount - 1) *
        params.intervalSec,
    ) +
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
   * PULSE GUIDE
   * =====================================================
   */

  const pulseGuideProgress =
    params.pulseCount > 0
      ? Math.min(
          guidedPulse /
            params.pulseCount,
          1,
        )
      : 0;

  const nextPulseIn =
    guidedPulse >= params.pulseCount
      ? 0
      : Math.max(
          0,
          params.intervalSec -
            (elapsed %
              params.intervalSec),
        );

  const currentPulseIsDue =
    guidedPulse > 0 &&
    guidedPulse <=
      params.pulseCount &&
    Math.abs(
      elapsed -
        (guidedPulse - 1) *
          params.intervalSec,
    ) <= GUIDE_TOLERANCE_SEC;

  /*
   * =====================================================
   * BACK TO INSTRUCTIONS
   * =====================================================
   */

  const returnToInstructions =
    useCallback(() => {
      phaseRef.current =
        'instructions';

      clearTimers();

      stopRecordingRef.current?.();

      guidedPulseRef.current = 0;

      setElapsed(0);
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
        prompt="Take a comfortable breath. The app will guide each controlled release pulse while continuously recording."
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
      <ExerciseListeningScreen
        icon="pulse-outline"
        title="Controlled Breath Release"
        currentRep={currentRep}
        repetitions={
          params.repetitions
        }
        elapsed={elapsed}
        targetDuration={
          recordingDuration
        }
        promptTitle={
          currentPulseIsDue
            ? `PULSE ${guidedPulse}`
            : guidedPulse >=
                params.pulseCount
              ? 'Finish Release'
              : `Pulse ${guidedPulse} of ${params.pulseCount}`
        }
        prompt={
          currentPulseIsDue
            ? 'RELEASE NOW'
            : guidedPulse >=
                params.pulseCount
              ? 'Continue recording until the exercise ends.'
              : `Next pulse in ${nextPulseIn.toFixed(1)}s`
        }
        progress={
          pulseGuideProgress * 100
        }
        liveContent={
          <View>
            {/* PULSE GUIDE */}

            <View
              style={
                styles.pulseGuideCard
              }
            >
              <Text
                style={
                  styles.pulseGuideLabel
                }
              >
                PULSE GUIDE
              </Text>

              <Text
                style={
                  styles.pulseGuideValue
                }
              >
                {guidedPulse}
                <Text
                  style={
                    styles.pulseGuideTotal
                  }
                >
                  {' '}
                  / {params.pulseCount}
                </Text>
              </Text>

              <Text
                style={
                  styles.pulseGuideInstruction
                }
              >
                {currentPulseIsDue
                  ? 'Release a short, gentle breath pulse now.'
                  : guidedPulse >=
                      params.pulseCount
                    ? 'All guided pulses completed.'
                    : `Prepare for the next pulse in ${nextPulseIn.toFixed(1)} seconds.`}
              </Text>

              {/* PULSE DOTS */}

              <View
                style={
                  styles.pulseDots
                }
              >
                {Array.from({
                  length:
                    params.pulseCount,
                }).map(
                  (_, index) => {
                    const pulseNumber =
                      index + 1;

                    const completed =
                      pulseNumber <
                      guidedPulse;

                    const active =
                      pulseNumber ===
                      guidedPulse;

                    return (
                      <View
                        key={
                          `pulse-${pulseNumber}`
                        }
                        style={[
                          styles.pulseDot,
                          completed &&
                            styles.pulseDotCompleted,
                          active &&
                            styles.pulseDotActive,
                        ]}
                      />
                    );
                  },
                )}
              </View>
            </View>

            {/* LIVE AIRFLOW */}

            <View
              style={
                styles.airflowCard
              }
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
                style={
                  styles.airflowHint
                }
              >
                Keep each pulse gentle and controlled
              </Text>
            </View>
          </View>
        }
        onBack={handleBack}
      />
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
        message="Checking pulse consistency and measuring the actual time between detected pulses..."
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

            {/* ACTUAL DETECTED INTERVALS */}

            <View
              style={
                styles.intervalsCard
              }
            >
              <Text
                style={
                  styles.intervalsTitle
                }
              >
                Detected Pulse Intervals
              </Text>

              {result.measurement.peaks
                .length >= 2 ? (
                result.measurement.peaks
                  .slice(1)
                  .map(
                    (peak, index) => {
                      const previousPeak =
                        result
                          .measurement
                          .peaks[index];

                      const interval =
                        peak.timestamp -
                        previousPeak.timestamp;

                      return (
                        <View
                          key={`interval-${result.rep}-${index}`}
                          style={
                            styles.intervalRow
                          }
                        >
                          <Text
                            style={
                              styles.intervalLabel
                            }
                          >
                            Pulse {index + 1} →{' '}
                            {index + 2}
                          </Text>

                          <Text
                            style={
                              styles.intervalValue
                            }
                          >
                            {interval.toFixed(
                              2,
                            )}{' '}
                            s
                          </Text>
                        </View>
                      );
                    },
                  )
              ) : (
                <Text
                  style={
                    styles.noIntervalsText
                  }
                >
                  Not enough detected pulses to calculate intervals.
                </Text>
              )}

              {result.measurement.peaks
                .length >= 2 ? (
                <Text
                  style={
                    styles.targetIntervalText
                  }
                >
                  Target interval:{' '}
                  {params.intervalSec.toFixed(
                    2,
                  )}{' '}
                  s
                </Text>
              ) : null}
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

const styles = {
  pulseGuideCard: {
    backgroundColor: WHITE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    alignItems: 'center',
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
    textAlign: 'center',
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