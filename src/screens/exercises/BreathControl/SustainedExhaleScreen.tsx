import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  type SustainedExhaleParams,
  type Tier,
} from '@/constants/exercises/breathControl';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import {
  measureSustainedExhale,
  type SustainedExhaleMeasurement,
} from '@/services/measurement/breathControl/sustainedExhale';

import {
  scoreSustainedExhale,
  type SustainedExhaleScoreResult,
} from '@/services/scoring/breathControl/sustainedExhale';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

import { auth } from '@/services/firebase/config';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { getLatestAssessment } from '@/services/assessment/assessmentRepository';

import { generateSustainedExhaleParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';

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

type Phases =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

interface RepResult {
  rep: number;
  measurement: SustainedExhaleMeasurement;
  score: SustainedExhaleScoreResult;
}

interface Props {
  tier?: Tier;
}

export default function SustainedExhaleScreen({
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

  const [elapsed, setElapsed] =
    useState(0);

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

        if (!initialTier) {
          const user = auth.currentUser;

          if (user) {
            const progress =
              await fetchComponentProgress(
                user.uid, 'breathControl'
              );

            currentTier =
              progress?.currentTier ?? 'beginner';
          }
        }

        if (cancelled) {
          return;
        }

        let recentScores: number[] = [];

        const user = auth.currentUser;

        if (user) {
          const records =
            await fetchExerciseRecords(
              user.uid,
              'breathControl'
            );

          const currentExerciseRecords =
            records.filter(
              (record) =>
                record.templateId ===
                  'sustainedExhale' &&
                record.tier === currentTier
            );

          recentScores =
            currentExerciseRecords
              .slice(-5)
              .map(
                (record) =>
                  record.scorePct
              );

          if (recentScores.length === 0) {
            const assessment =
              await getLatestAssessment();

            const assessmentScore =
              assessment?.scores.find(
                (score) =>
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
          generateSustainedExhaleParams({
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
          '🎯 Sustained Exhale adaptive parameters:',
          {
            tier: currentTier,
            recentScores,
            generatedParams,
          }
        );
      } catch (initializationError) {
        console.error(
          'Failed to initialize Sustained Exhale ADS:',
          initializationError
        );

        if (!cancelled) {
          const fallbackTier: Tier =
            initialTier ?? 'beginner';

          const fallbackParams =
            generateSustainedExhaleParams({
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

  // ----------------------------------------------------------
  // TIMER CLEANUP
  // ----------------------------------------------------------

  const clearTimers =
    useCallback(() => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      if (processingTimerRef.current) {
        clearTimeout(processingTimerRef.current);
        processingTimerRef.current = null;
      }
    }, []);

  // ----------------------------------------------------------
  // LIVE AUDIO
  // ----------------------------------------------------------

  const handleLiveFrame =
  useCallback(
    (frame: {
      volume: number;
    }) => {
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
          '🛑 Sustained Exhale recording stopped'
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

        if (
          !adaptiveParams ||
          !currentTier
        ) {
          console.error(
            '❌ Sustained Exhale adaptive parameters are unavailable.'
          );

          setError(
            'Exercise parameters are unavailable. Please try again.'
          );

          setPhase('instructions');
          return;
        }

        try {
          const measurement =
            measureSustainedExhale(
              samples,
              adaptiveParams.detectionThreshold,
              sampleRate
            );

          console.log(
            '📊 Sustained Exhale measurement:',
            measurement
          );

          const score =
            scoreSustainedExhale(
              measurement,
              adaptiveParams
            );

          console.log(
            '📊 Sustained Exhale score:',
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

          setRepResults(updatedResults);

          console.log(
            `📊 Completed rep ${currentRepRef.current}/${adaptiveParams.repetitions}`
          );

          if (
            currentRepRef.current <
            adaptiveParams.repetitions
          ) {
            processingTimerRef.current =
              setTimeout(() => {
                if (!mountedRef.current) {
                  return;
                }

                const nextRep =
                  currentRepRef.current + 1;

                currentRepRef.current =
                  nextRep;

                setCurrentRep(nextRep);
                setElapsed(0);
                setVolume(null);

                startingRef.current = false;
                finishingRef.current = false;

                beginCountdown();
              }, 1200);

            return;
          }

          processingTimerRef.current =
            setTimeout(async () => {
              if (!mountedRef.current) {
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
                '🏆 Final Sustained Exhale results:',
                finalResults
              );

              console.log(
                '🏆 Final Sustained Exhale score:',
                finalScore
              );

              try {
                await saveCompletedExercise(
                  'breathControl',
                  'sustainedExhale',
                  currentTier,
                  finalScore
                );

                console.log(
                  '💾 Sustained Exhale progress saved'
                );
              } catch (saveError) {
                console.error(
                  '❌ Failed to save Sustained Exhale progress:',
                  saveError
                );
              }

              if (!mountedRef.current) {
                return;
              }

              setRepResults(finalResults);
              setPhase('results');

              startingRef.current = false;
              finishingRef.current = false;
            }, 1200);
        } catch (analysisError) {
          console.error(
            '❌ Sustained Exhale analysis failed:',
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

  // ----------------------------------------------------------
  // AUDIO RECORDER
  // ----------------------------------------------------------

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  // ----------------------------------------------------------
  // SYNCHRONIZE RECORDER REFS
  // ----------------------------------------------------------

  useEffect(() => {
    startRecordingRef.current =
      startRecording;

    stopRecordingRef.current =
      stopRecording;
  }, [
    startRecording,
    stopRecording,
  ]);

  // ----------------------------------------------------------
  // START RECORDING PHASE
  // ----------------------------------------------------------

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
          '❌ Adaptive Sustained Exhale parameters are not ready.'
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
        '🎤 Starting Sustained Exhale recording...'
      );

      try {
        await start();

        if (!mountedRef.current) {
          return;
        }

        console.log(
          '🎤 Sustained Exhale recording started'
        );

        const startTime = Date.now();

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
              adaptiveParams
                .durationRangeSec[1]
            ) {
              console.log(
                '⏱️ Maximum Sustained Exhale duration reached'
              );

              clearTimers();

              if (
                !finishingRef.current
              ) {
                finishingRef.current =
                  true;

                stop();
              }
            }
          }, 100);
      } catch (recordingError) {
        console.error(
          '❌ Failed to start Sustained Exhale recording:',
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

  // ----------------------------------------------------------
  // COUNTDOWN
  // ----------------------------------------------------------

  const beginCountdown =
    useCallback(() => {
      if (!mountedRef.current) {
        return;
      }

      if (startingRef.current) {
        return;
      }

      clearTimers();

      setCountdown(
        PREPARATION_COUNTDOWN
      );
      setPhase('countdown');

      let value =
        PREPARATION_COUNTDOWN;

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

  // ----------------------------------------------------------
  // COMPONENT CLEANUP
  // ----------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearTimers();
      stopRecordingRef.current?.();
    };
  }, [clearTimers]);

  // ----------------------------------------------------------
  // START EXERCISE
  // ----------------------------------------------------------

  const startExercise =
    useCallback(() => {
      console.log(
        '🟢 Sustained Exhale START EXERCISE PRESSED'
      );

      if (startingRef.current) {
        console.log(
          '⚠️ Sustained Exhale already starting'
        );
        return;
      }

      if (
        !paramsRef.current ||
        !tierRef.current
      ) {
        console.log(
          '⚠️ Sustained Exhale parameters are not ready'
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
      setCountdown(
        PREPARATION_COUNTDOWN
      );

      console.log(
        '🟢 Starting Sustained Exhale countdown'
      );

      beginCountdown();
    }, [
      beginCountdown,
      clearTimers,
    ]);

  // ----------------------------------------------------------
  // FINISH CURRENT REP
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // RETRY
  // ----------------------------------------------------------

  const retryExercise =
    useCallback(() => {
      console.log(
        '🔄 Retrying Sustained Exhale'
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
      setCountdown(
        PREPARATION_COUNTDOWN
      );
      setPhase('instructions');
    }, [clearTimers]);

  // ----------------------------------------------------------
  // GO BACK
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // ADS PARAMETER LOADING
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // DERIVED VALUES
  // ----------------------------------------------------------

  const averageDuration =
    repResults.length > 0
      ? repResults.reduce(
          (sum, result) =>
            sum +
            result.measurement
              .actualDurationSec,
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

  const averageScore =
    repResults.length > 0
      ? Math.round(
          repResults.reduce(
            (sum, result) =>
              sum +
              result.score.score,
            0
          ) / repResults.length
        )
      : 0;

  const passedReps =
    repResults.filter(
      (result) =>
        result.score.passed
    ).length;

  const durationProgress =
    Math.min(
      elapsed /
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

  if (phase === 'instructions') {
    return (
      <ExerciseScreen
        category="Breath Control"
        title="Sustained Exhale"
        icon="cloud-outline"
        instructions="Take a comfortable breath in, then slowly exhale through your mouth. Keep the airflow steady and controlled for as long as you comfortably can."
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
            text: 'Exhale gently and steadily.',
          },
          {
            icon: 'mic-outline',
            text: 'Stay close enough to the microphone for consistent audio.',
          },
        ]}
        targetValue={`${params.durationRangeSec[0]}–${params.durationRangeSec[1]} sec`}
        targetHint="sustained exhale"
        repetitions={params.repetitions}
        tip="Focus on keeping your airflow steady rather than trying to force a longer exhale."
        tier={tier}
        error={error}
        onBack={goBack}
        onStart={startExercise}
      />
    );
  }

  // ----------------------------------------------------------
  // COUNTDOWN
  // ----------------------------------------------------------

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="cloud-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={params.repetitions}
        countdown={countdown}
        promptTitle="Take a comfortable breath in"
        prompt="Prepare for a slow, steady exhale."
        onBack={goBack}
      />
    );
  }

  // ----------------------------------------------------------
  // RECORDING
  // ----------------------------------------------------------

  if (phase === 'recording') {
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
              Repetition {currentRep} of{' '}
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
              <View
                style={
                  styles.recordingInnerCircle
                }
              >
                <Ionicons
                  name="mic"
                  size={52}
                  color={BROWN}
                />
              </View>
            </View>
          </View>

          <View style={styles.recordingBadge}>
            <View style={styles.recordingDot} />

            <Text
              style={
                styles.recordingBadgeText
              }
            >
              RECORDING
            </Text>
          </View>

          <Text style={styles.timerText}>
            {elapsed.toFixed(1)}s
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
              Target:{' '}
              {targetDuration.toFixed(1)}s
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
                {volume !== null
                  ? volume.toFixed(2)
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
                Maintain a controlled
                airflow throughout your
                exhale.
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

  if (phase === 'processing') {
    const isFinalRep =
      currentRep >= params.repetitions;

    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title={
          isFinalRep
            ? 'Analyzing Your Results'
            : 'Analyzing Your Exhale'
        }
        message={
          isFinalRep
            ? 'Calculating your overall breath control score'
            : `Processing repetition ${currentRep}`
        }
      />
    );
  }

  // ----------------------------------------------------------
  // RESULTS
  // ----------------------------------------------------------

  return (
    <ExerciseResultsScreen
      title="Exercise Complete"
      subtitle="Sustained Exhale"
      score={averageScore}
      resultIcon="checkmark"
      scoreDetails={
        <View style={styles.scoreBar}>
          <View
            style={[
              styles.scoreBarFill,
              {
                width: `${averageScore}%`,
              },
            ]}
          />
        </View>
      }
      onRetry={retryExercise}
      onExit={goBack}
    >
      <View style={styles.resultsContent}>
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

          {repResults.map((result) => (
            <View
              key={`rep-${result.rep}`}
              style={styles.repResultRow}
            >
              <View
                style={[
                  styles.repNumber,
                  result.score.passed &&
                    styles.repNumberPassed,
                ]}
              >
                <Text style={styles.repNumberText}>
                  {result.rep}
                </Text>
              </View>

              <View style={styles.repResultInfo}>
                <Text
                  style={
                    styles.repResultTitle
                  }
                >
                  Repetition {result.rep}
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
                    result.measurement
                      .consistencyPct
                  )}
                  % consistency
                </Text>
              </View>

              <Text style={styles.repResultScore}>
                {result.score.score}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.feedbackCard}>
          <Ionicons
            name="bulb-outline"
            size={23}
            color={BROWN}
          />

          <View style={styles.feedbackContent}>
            <Text style={styles.feedbackTitle}>
              Feedback
            </Text>

            <Text
                        style={styles.feedbackText}
                      >
                        {averageScore >= 85
                          ? 'Excellent control! Your exhale was sustained with strong consistency.'
                          : averageScore >= 70
                            ? 'Good work! Focus on keeping your airflow even throughout the entire sound.'
                            : averageScore >= 50
                              ? 'Keep practicing. Try to maintain a smoother and more consistent exhalation.'
                              : 'Keep practicing your breath control. Focus on a steady stream of air and a continuous exhale.'}
                      
                      </Text>
          </View>
        </View>
      </View>
    </ExerciseResultsScreen>
  );
}

// ----------------------------------------------------------
// SMALL COMPONENTS
// ----------------------------------------------------------

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
// STYLES
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WHITE,
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
    paddingTop: 76,
    paddingBottom: 40,
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

  resultsContent: {
    flex: 1,
  },

  sectionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 12,
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