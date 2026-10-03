import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  SustainedExhaleParams,
  Tier,
} from '@/constants/exercises/breathControl';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import {
  measureSustainedSSSS,
  type SustainedSSSSMeasurement,
} from '@/services/measurement/breathControl/sustainedSSSS';

import {
  scoreSustainedSSSS,
  type SustainedSSSSScoreResult,
} from '@/services/scoring/breathControl/sustainedSSSS';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

import { auth } from '@/services/firebase/config';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { getLatestAssessment } from '@/services/assessment/assessmentRepository';

import { generateSustainedSSSSParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';

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
const BORDER = '#F2DDE5';
const PREPARATION_COUNTDOWN = 3;

type Phases =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

interface RepResult {
  rep: number;
  measurement: SustainedSSSSMeasurement;
  score: SustainedSSSSScoreResult;
}

interface Props {
  tier?: Tier;
}

export default function SustainedSSSSScreen({
  tier: initialTier,
}: Props) {

  const [tier, setTier] = useState<Tier | null>(
    initialTier ?? null
  );

  const [params, setParams] =
    useState<SustainedExhaleParams | null>(null);

  const [loadingParams, setLoadingParams] =
    useState(true);

  const [phase, setPhase] =
    useState<Phases>('instructions');

  const [currentRep, setCurrentRep] =
    useState(1);

  const [countdown, setCountdown] =
    useState(PREPARATION_COUNTDOWN);

  const [volume, setVolume] =
    useState<number | null>(null);

  const [repResults, setRepResults] =
    useState<RepResult[]>([]);

  const [error, setError] =
    useState<string | null>(null);

  const paramsRef =
    useRef<SustainedExhaleParams | null>(null);

  const tierRef =
    useRef<Tier | null>(initialTier ?? null);

  const countdownTimerRef = useRef<
    ReturnType<typeof setInterval> | null
  >(null);

  const recordingTimerRef = useRef<
    ReturnType<typeof setInterval> | null
  >(null);

  const processingTimerRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);

  const [elapsed, setElapsed] =
    useState(0);

  const mountedRef = useRef(true);

  const startingRef = useRef(false);
  const finishingRef = useRef(false);

  const repResultsRef =
    useRef<RepResult[]>([]);

  const currentRepRef =
    useRef(1);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const stopRecordingRef =
    useRef<(() => void) | null>(null);



  useEffect(() => {
    let cancelled = false;

    async function initializeAdaptiveExercise() {
      try {
        setLoadingParams(true);

        let currentTier: Tier =
          initialTier ?? 'beginner';

        const user = auth.currentUser;

        if (!initialTier && user) {
          const progress =
            await fetchComponentProgress(
              user.uid,
              'breathControl'
            );

          currentTier =
            progress?.currentTier ?? 'beginner';
        }

        if (cancelled) {
          return;
        }

        let recentScores: number[] = [];

        if (user) {
          const records =
            await fetchExerciseRecords(
              user.uid,
              'breathControl'
            );

          const currentExerciseRecords =
            records.filter(
              record =>
                record.templateId ===
                  'sustainedSSSS' &&
                record.tier === currentTier
            );

          recentScores =
            currentExerciseRecords
              .slice(-5)
              .map(
                record =>
                  record.scorePct
              );

          if (recentScores.length === 0) {
            const assessment =
              await getLatestAssessment();

            const assessmentScore =
              assessment?.scores.find(
                score =>
                  score.componentId ===
                  'breathControl'
              )?.scorePct;

            if (
              typeof assessmentScore ===
              'number'
            ) {
              recentScores = [
                assessmentScore,
              ];
            }
          }
        }

        if (cancelled) {
          return;
        }

        const generatedParams =
          generateSustainedSSSSParams({
            tier: currentTier,
            recentScores,
          });

        if (cancelled) {
          return;
        }

        setTier(currentTier);
        setParams(generatedParams);

        tierRef.current = currentTier;
        paramsRef.current = generatedParams;

        console.log(
          '🎯 Sustained SSSS adaptive parameters:',
          {
            tier: currentTier,
            recentScores,
            generatedParams,
          }
        );
      } catch (initializationError) {
        console.error(
          '❌ Failed to initialize Sustained SSSS ADS:',
          initializationError
        );

        if (!cancelled) {
          const fallbackTier: Tier =
            initialTier ?? 'beginner';

          const fallbackParams =
            generateSustainedSSSSParams({
              tier: fallbackTier,
              recentScores: [],
            });

          setTier(fallbackTier);
          setParams(fallbackParams);

          tierRef.current = fallbackTier;
          paramsRef.current = fallbackParams;
        }
      } finally {
        if (!cancelled) {
          setLoadingParams(false);
        }
      }
    }

    initializeAdaptiveExercise();

    return () => {
      cancelled = true;
    };
  }, [initialTier]);

  /*
   * =================================================
   * TIMER CLEANUP
   * =================================================
   */

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(
        countdownTimerRef.current
      );

      countdownTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(
        recordingTimerRef.current
      );

      recordingTimerRef.current = null;
    }

    if (processingTimerRef.current) {
      clearTimeout(
        processingTimerRef.current
      );

      processingTimerRef.current = null;
    }
  }, []);

  /*
   * =================================================
   * LIVE AUDIO
   * =================================================
   */

  const handleLiveFrame = useCallback(
    (frame: { volume: number }) => {
      if (!mountedRef.current) {
        return;
      }

      setVolume(frame.volume);
    },
    []
  );

  const handleRecordingStop =
    useCallback(
      (
        samples: Float32Array,
        sampleRate: number
      ) => {
        if (!mountedRef.current) {
          return;
        }

        console.log(
          '🛑 Sustained SSSS recording stopped'
        );

        clearTimers();

        setPhase('processing');
        setVolume(null);

        startingRef.current = false;
        finishingRef.current = false;

        const adaptiveParams =
          paramsRef.current;

        const currentTier =
          tierRef.current;

        if (!adaptiveParams || !currentTier) {
          console.error(
            '❌ Sustained SSSS adaptive parameters are unavailable.'
          );

          setError(
            'Exercise parameters are unavailable. Please try again.'
          );

          setPhase('instructions');

          return;
        }

        try {

          const measurement =
            measureSustainedSSSS(
              samples,
              adaptiveParams.detectionThreshold,
              sampleRate
            );

          console.log(
            '📊 SSSS measurement:',
            measurement
          );

          const score =
            scoreSustainedSSSS(
              measurement,
              adaptiveParams
            );

          console.log(
            '📊 SSSS score:',
            score
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
            updatedResults
          );

          console.log(
            `📊 Completed rep ${currentRepRef.current}/${adaptiveParams.repetitions}`
          );

          if (
            currentRepRef.current <
            adaptiveParams.repetitions
          ) {
            processingTimerRef.current =
              setTimeout(() => {
                if (
                  !mountedRef.current
                ) {
                  return;
                }

                const nextRep =
                  currentRepRef.current +
                  1;

                currentRepRef.current =
                  nextRep;

                setCurrentRep(
                  nextRep
                );

                setElapsed(0);
                setVolume(null);

                startingRef.current =
                  false;

                finishingRef.current =
                  false;

                beginCountdown();
              }, 1200);

            return;
          }

          /*
           * ----------------------------------------
           * ALL REPS COMPLETE
           * ----------------------------------------
           */

          processingTimerRef.current =
            setTimeout(async () => {
              if (
                !mountedRef.current
              ) {
                return;
              }

              const finalResults =
                repResultsRef.current;

              const finalScore =
                finalResults.length > 0
                  ? Math.round(
                      finalResults.reduce(
                        (sum, item) =>
                          sum +
                          item.score.score,
                        0
                      ) /
                        finalResults.length
                    )
                  : 0;

              console.log(
                '🏆 Final SSSS results:',
                finalResults
              );

              console.log(
                '🏆 Final SSSS score:',
                finalScore
              );

              /*
               * ------------------------------------
               * SAVE PROGRESS
               * ------------------------------------
               */

              try {
                await saveCompletedExercise(
                  'breathControl',
                  'sustainedSSSS',
                  currentTier,
                  finalScore
                );

                console.log(
                  '💾 Sustained SSSS progress saved'
                );
              } catch (saveError) {
                console.error(
                  '❌ Failed to save Sustained SSSS progress:',
                  saveError
                );
              }

              if (
                !mountedRef.current
              ) {
                return;
              }

              setRepResults(
                finalResults
              );

              setPhase('results');

              startingRef.current =
                false;

              finishingRef.current =
                false;
            }, 1200);
        } catch (analysisError) {
          console.error(
            '❌ Sustained SSSS analysis failed:',
            analysisError
          );

          if (!mountedRef.current) {
            return;
          }

          clearTimers();

          setError(
            'We could not analyze your recording. Please try again.'
          );

          setPhase('instructions');

          startingRef.current = false;
          finishingRef.current = false;
        }
      },
      [clearTimers]
    );

  /*
   * =================================================
   * AUDIO RECORDER
   * =================================================
   */

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  /*
   * =================================================
   * SYNCHRONIZE RECORDER REFS
   * =================================================
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
   * =================================================
   * START RECORDING PHASE
   * =================================================
   */

  const startRecordingPhase =
    useCallback(async () => {
      if (!mountedRef.current) {
        return;
      }

      if (startingRef.current) {
        return;
      }

      const adaptiveParams =
        paramsRef.current;

      if (!adaptiveParams) {
        console.error(
          '❌ Adaptive SSSS parameters are not ready.'
        );

        setError(
          'Exercise parameters are not ready. Please try again.'
        );

        setPhase('instructions');

        return;
      }

      const start =
        startRecordingRef.current;

      const stop =
        stopRecordingRef.current;

      if (!start || !stop) {
        console.error(
          '❌ Audio recorder is not ready.'
        );

        setError(
          'Audio recorder is not ready. Please try again.'
        );

        setPhase('instructions');

        return;
      }

      startingRef.current = true;
      finishingRef.current = false;

      clearTimers();

      setElapsed(0);
      setVolume(null);
      setError(null);
      setPhase('recording');

      console.log(
        '🎤 Starting Sustained SSSS recording...'
      );

      try {
        await start();

        if (!mountedRef.current) {
          return;
        }

        console.log(
          '🎤 Sustained SSSS recording started'
        );

        const startTime =
          Date.now();

        recordingTimerRef.current =
          setInterval(() => {
            if (!mountedRef.current) {
              return;
            }

            if (finishingRef.current) {
              return;
            }

            const seconds =
              (Date.now() - startTime) /
              1000;

            setElapsed(seconds);

            if (
              seconds >=
              adaptiveParams.durationRangeSec[1]
            ) {
              console.log(
                '⏱️ Maximum SSSS duration reached'
              );

              clearTimers();

              if (!finishingRef.current) {
                finishingRef.current = true;

                stop();
              }
            }
          }, 100);
      } catch (recordingError) {
        console.error(
          '❌ Failed to start Sustained SSSS recording:',
          recordingError
        );

        if (!mountedRef.current) {
          return;
        }

        clearTimers();

        setError(
          'Microphone access or recording failed. Please try again.'
        );

        setPhase('instructions');

        startingRef.current = false;
        finishingRef.current = false;
      }
    }, [clearTimers]);

  /*
   * =================================================
   * COUNTDOWN
   * =================================================
   */

  const beginCountdown =
    useCallback(() => {
      if (!mountedRef.current) {
        return;
      }

      if (startingRef.current) {
        return;
      }

      clearTimers();

      setCountdown(PREPARATION_COUNTDOWN);
      setPhase('countdown');

      let value = 3;

      console.log(
        `⏳ Countdown started for rep ${currentRepRef.current}`
      );

      countdownTimerRef.current =
        setInterval(() => {
          if (!mountedRef.current) {
            return;
          }

          value -= 1;

          if (value <= 0) {
            clearTimers();

            console.log(
              '⏳ Countdown finished'
            );

            startRecordingPhase();

            return;
          }

          setCountdown(value);
        }, 1000);
    }, [
      clearTimers,
      startRecordingPhase,
    ]);

  /*
   * =================================================
   * COMPONENT CLEANUP
   * =================================================
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
   * =================================================
   * START EXERCISE
   * =================================================
   */

  const startExercise =
    useCallback(() => {
      console.log(
        '🟢 SSSS START EXERCISE PRESSED'
      );

      if (startingRef.current) {
        console.log(
          '⚠️ SSSS already starting'
        );

        return;
      }

      /*
       * Do not start until adaptive parameters
       * have been initialized.
       */

      if (!paramsRef.current || !tierRef.current) {
        console.log(
          '⚠️ SSSS parameters are not ready'
        );

        setError(
          'Exercise parameters are still loading. Please try again.'
        );

        return;
      }

      clearTimers();

      startingRef.current = false;
      finishingRef.current = false;

      repResultsRef.current = [];

      currentRepRef.current = 1;

      setRepResults([]);
      setCurrentRep(1);
      setElapsed(0);
      setVolume(null);
      setError(null);
      setCountdown(PREPARATION_COUNTDOWN);

      console.log(
        '🟢 Starting SSSS countdown'
      );

      beginCountdown();
    }, [
      beginCountdown,
      clearTimers,
    ]);

  /*
   * =================================================
   * FINISH CURRENT REP
   * =================================================
   */

  const finishRecording =
    useCallback(() => {
      if (!mountedRef.current) {
        return;
      }

      if (finishingRef.current) {
        return;
      }

      const stop =
        stopRecordingRef.current;

      if (!stop) {
        console.error(
          '❌ Audio recorder is not ready.'
        );

        return;
      }

      console.log(
        '🛑 Finish Rep pressed'
      );

      clearTimers();

      finishingRef.current = true;

      stop();
    }, [clearTimers]);

  /*
   * =================================================
   * RETRY
   * =================================================
   */

  const retryExercise =
    useCallback(() => {
      console.log(
        '🔄 Retrying Sustained SSSS'
      );

      clearTimers();

      const stop =
        stopRecordingRef.current;

      if (stop) {
        stop();
      }

      startingRef.current = false;
      finishingRef.current = false;

      repResultsRef.current = [];

      currentRepRef.current = 1;

      setRepResults([]);
      setCurrentRep(1);
      setElapsed(0);
      setVolume(null);
      setError(null);
      setCountdown(PREPARATION_COUNTDOWN);
      setPhase('instructions');
    }, [clearTimers]);

  /*
   * =================================================
   * GO BACK
   * =================================================
   */

  const goBack =
    useCallback(() => {
      clearTimers();

      startingRef.current = false;
      finishingRef.current = true;

      const stop =
        stopRecordingRef.current;

      if (stop) {
        stop();
      }

      router.replace(
        '/dashboard?tab=exercises'
      );
    }, [clearTimers]);

  /*
   * =================================================
   * RESULT CALCULATIONS
   * =================================================
   */

  const averageDuration =
    repResults.length > 0
      ? repResults.reduce(
          (sum, item) =>
            sum +
            item.measurement
              .actualDurationSec,
          0
        ) / repResults.length
      : 0;

  const averageConsistency =
    repResults.length > 0
      ? repResults.reduce(
          (sum, item) =>
            sum +
            item.measurement
              .consistencyPct,
          0
        ) / repResults.length
      : 0;

  const averageScore =
    repResults.length > 0
      ? Math.round(
          repResults.reduce(
            (sum, item) =>
              sum +
              item.score.score,
            0
          ) / repResults.length
        )
      : 0;

  const passedReps =
    repResults.filter(
      item => item.score.passed
    ).length;

  /*
   * =================================================
   * ADS LOADING
   * =================================================
   */

  if (
    loadingParams ||
    !params ||
    !tier
  ) {
    return (
      <View style={styles.centerScreen}>
        <View
          style={styles.largeIconCircle}
        >
          <Ionicons
            name="options-outline"
            size={44}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.processingTitle}
        >
          Preparing Your Exercise
        </Text>

        <Text
          style={styles.processingSubtitle}
        >
          Adjusting the exercise to your
          current difficulty level
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  }

  /*
   * =================================================
   * INSTRUCTIONS
   * =================================================
   */

    if (phase === 'instructions') {
    return (
      <ExerciseScreen
      category="Breath Control"
      title={'Sustained "SSSS"'} 
      icon="cloud-outline"
        instructions={'Take a comfortable breath, then release the air through your teeth using a steady "ssss" hissing sound.'}
        preparationSteps={[
          { icon: 'leaf-outline', text: 'Sit or stand with a relaxed posture.' },
          { icon: 'body-outline', text: 'Take a comfortable breath without overfilling your lungs.' },
          { icon: 'volume-low-outline', text: 'Release the air using a continuous "ssss" sound.' },
          { icon: 'mic-outline', text: 'Keep the sound steady and stay close to the microphone.' },
        ]}
        targetValue={`${params.durationRangeSec[0]}–${params.durationRangeSec[1]} sec`}
        targetHint={'sustained "ssss"'}
        repetitions={params.repetitions}
        tip={'Focus on keeping the "ssss" sound smooth and consistent instead of forcing a burst of air.'}
        tier={tier}
        error={error}
        onBack={goBack}
        onStart={startExercise}
      />
    );
  }

  /*
   * =================================================
   * COUNTDOWN
   * =================================================
   */

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="cloud-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={params.repetitions}
        countdown={countdown}
        promptTitle="Prepare to make a steady SSSS sound"
        prompt="Keep the hiss smooth and continuous."
      />
    );
  }

  /*
   * =================================================
   * RECORDING
   * =================================================
   */

  if (phase === 'recording') {
    const maxDuration =
      params.durationRangeSec[1];

    const progress =
      Math.min(
        elapsed / maxDuration,
        1
      );

    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={
            styles.recordingContent
          }
          showsVerticalScrollIndicator={
            false
          }
        >
          <View
            style={styles.recordingHeader}
          >
            <View
              style={styles.smallIconCircle}
            >
              <Ionicons
                name="cloud-outline"
                size={27}
                color={BROWN}
              />
            </View>

            <View
              style={styles.recordingHeaderText}
            >
              <Text
                style={styles.recordingTitle}
              >
                Sustain "SSSS"
              </Text>

              <Text
                style={
                  styles.recordingSubtitle
                }
              >
                Repetition {currentRep} of{' '}
                {params.repetitions}
              </Text>
            </View>
          </View>

          <View
            style={styles.sssssCard}
          >
            <Text
              style={styles.sssssText}
            >
              SSSSSSSSSS
            </Text>

            <Text
              style={styles.sssssHint}
            >
              Keep the sound steady
            </Text>
          </View>

          <View style={styles.micArea}>
            <View
              style={styles.outerMicCircle}
            >
              <View
                style={styles.innerMicCircle}
              >
                <Ionicons
                  name="mic"
                  size={48}
                  color={BROWN}
                />
              </View>
            </View>

            <View
              style={styles.recordingBadge}
            >
              <View
                style={styles.recordingDot}
              />

              <Text
                style={
                  styles.recordingBadgeText
                }
              >
                RECORDING
              </Text>
            </View>
          </View>

          <Text
            style={styles.timerText}
          >
            {elapsed.toFixed(1)}s
          </Text>

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

          <View
            style={styles.liveMetrics}
          >
            <View
              style={styles.liveMetricCard}
            >
              <Text
                style={
                  styles.liveMetricLabel
                }
              >
                AUDIO LEVEL
              </Text>

              <Text
                style={
                  styles.liveMetricValue
                }
              >
                {volume !== null
                  ? volume.toFixed(1)
                  : '--'}
              </Text>
            </View>

            <View
              style={styles.liveMetricCard}
            >
              <Text
                style={
                  styles.liveMetricLabel
                }
              >
                TARGET
              </Text>

              <Text
                style={
                  styles.liveMetricValue
                }
              >
                {params.durationRangeSec[0]}–
                {params.durationRangeSec[1]}s
              </Text>
            </View>
          </View>

          <Pressable
            style={styles.primaryButton}
            onPress={finishRecording}
          >
            <Ionicons
              name="stop"
              size={20}
              color={WHITE}
            />

            <Text
              style={
                styles.primaryButtonText
              }
            >
              Finish Rep
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  /*
   * =================================================
   * PROCESSING
   * =================================================
   */

  if (phase === 'processing') {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your SSSS"
        message={
          currentRep < params.repetitions
            ? `Checking duration and consistency. Preparing repetition ${currentRep + 1} of ${params.repetitions}.`
            : 'Checking duration and consistency...'
        }
      />
    );
  }

  /*
   * =================================================
   * RESULTS
   * =================================================
   */

  return (
    <ExerciseResultsScreen
      title="Exercise Complete!"
      subtitle="Here's how you performed"
      score={averageScore}
      resultIcon="checkmark"
      onRetry={retryExercise}
      onExit={goBack}
    >
      <View
        style={styles.metricsGrid}
      >
        <View
          style={styles.resultMetricCard}
        >
          <Ionicons
            name="timer-outline"
            size={24}
            color={BROWN}
          />

          <Text
            style={
              styles.resultMetricValue
            }
          >
            {averageDuration.toFixed(1)}s
          </Text>

          <Text
            style={
              styles.resultMetricLabel
            }
          >
            Avg. Duration
          </Text>
        </View>

        <View
          style={styles.resultMetricCard}
        >
          <Ionicons
            name="pulse-outline"
            size={24}
            color={BROWN}
          />

          <Text
            style={
              styles.resultMetricValue
            }
          >
            {Math.round(
              averageConsistency
            )}
            %
          </Text>

          <Text
            style={
              styles.resultMetricLabel
            }
          >
            Consistency
          </Text>
        </View>

        <View
          style={styles.resultMetricCard}
        >
          <Ionicons
            name="repeat-outline"
            size={24}
            color={BROWN}
          />

          <Text
            style={
              styles.resultMetricValue
            }
          >
            {repResults.length}/
            {params.repetitions}
          </Text>

          <Text
            style={
              styles.resultMetricLabel
            }
          >
            Repetitions
          </Text>
        </View>

        <View
          style={styles.resultMetricCard}
        >
          <Ionicons
            name="checkmark-circle-outline"
            size={24}
            color={BROWN}
          />

          <Text
            style={
              styles.resultMetricValue
            }
          >
            {passedReps}
          </Text>

          <Text
            style={
              styles.resultMetricLabel
            }
          >
            Passed
          </Text>
        </View>
      </View>

      <View
        style={styles.feedbackCard}
      >
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={24}
          color={BROWN}
        />

        <View
          style={styles.feedbackContent}
        >
          <Text
            style={styles.feedbackTitle}
          >
            Feedback
          </Text>

          <Text
            style={styles.feedbackText}
          >
            {averageScore >= 85
              ? 'Excellent control! Your SSSS sound was sustained with strong consistency.'
              : averageScore >= 70
                ? 'Good work! Focus on keeping your airflow even throughout the entire sound.'
                : averageScore >= 50
                  ? 'Keep practicing. Try to maintain a smoother and more consistent SSSS sound.'
                  : 'Keep practicing your breath control. Focus on a steady stream of air and a continuous SSSS sound.'}
          </Text>
        </View>
      </View>

      <Text
        style={styles.repResultsTitle}
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
                styles.repResultLeft
              }
            >
              <View
                style={styles.repNumber}
              >
                <Text
                  style={
                    styles.repNumberText
                  }
                >
                  {result.rep}
                </Text>
              </View>

              <View>
                <Text
                  style={
                    styles.repResultTitle
                  }
                >
                  Repetition {result.rep}
                </Text>

                <Text
                  style={
                    styles.repResultSubtitle
                  }
                >
                  {result.measurement.actualDurationSec.toFixed(
                    1
                  )}
                  s •{' '}
                  {Math.round(
                    result.measurement
                      .consistencyPct
                  )}
                  % consistency
                </Text>
              </View>
            </View>

            <View
              style={styles.repScore}
            >
              <Text
                style={styles.repScoreText}
              >
                {result.score.score}
              </Text>

              <Text
                style={
                  styles.repScorePercent
                }
              >
                %
              </Text>
            </View>
          </View>
        )
      )}

    </ExerciseResultsScreen>
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
  primaryButton: {
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 24,
  },
  primaryButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: WHITE,
    marginLeft: 8,
  },
  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  largeIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  recordingContent: {
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 40,
  },
  recordingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  smallIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  recordingHeaderText: {
    flex: 1,
  },
  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
  },
  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    marginTop: 2,
  },
  sssssCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  sssssText: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    letterSpacing: 3,
    color: BROWN,
  },
  sssssHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    marginTop: 5,
  },
  micArea: {
    alignItems: 'center',
    marginTop: 28,
  },
  outerMicCircle: {
    width: 164,
    height: 164,
    borderRadius: 82,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerMicCircle: {
    width: 116,
    height: 116,
    borderRadius: 58,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBadge: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_GRAY,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C94D5B',
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
    fontSize: 34,
    color: BROWN,
    textAlign: 'center',
    marginTop: 18,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 5,
  },
  liveMetrics: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  liveMetricCard: {
    flex: 1,
    backgroundColor: LIGHT_PINK,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  liveMetricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.4,
  },
  liveMetricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginTop: 4,
  },
  processingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  processingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
  },
  resultMetricCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
  },
  resultMetricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 21,
    color: BROWN,
    marginTop: 5,
  },
  resultMetricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 2,
  },
  feedbackCard: {
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 16,
  },
  feedbackContent: {
    flex: 1,
    marginLeft: 10,
  },
  feedbackTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },
  feedbackText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: BROWN,
    marginTop: 4,
  },
  repResultsTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginTop: 22,
    marginBottom: 10,
  },
  repResultCard: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 17,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  repResultLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  repNumber: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  repNumberText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
  repResultTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
  },
  repResultSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },
  repScore: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  repScoreText: {
    fontFamily: 'FredokaBold',
    fontSize: 21,
    color: BROWN,
  },
  repScorePercent: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginLeft: 1,
  },
});