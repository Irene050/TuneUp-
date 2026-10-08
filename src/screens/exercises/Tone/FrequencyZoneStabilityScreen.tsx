import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
  type ExercisePreparationStep,
  type ExerciseSummaryItem,
} from '@/screens/exercises/ExerciseScreen';

import {
  FREQUENCY_ZONE_STABILITY_PARAMS,
  type FrequencyZoneStabilityParams,
  type Tier,
} from '@/constants/exercises/tone';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  generateFrequencyZoneStabilityParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  classifyFrequencyZone,
  type FrequencyZone,
} from '@/utils/dsp/spectral';

import {
  measureFrequencyZoneStability,
  type FrequencyZoneStabilityMeasurement,
} from '@/services/measurement/tone/frequencyZoneStability';

import {
  scoreFrequencyZoneStability,
  type FrequencyZoneStabilityScoreResult,
} from '@/services/scoring/tone/frequencyZoneStability';

import { auth } from '@/services/firebase/config';

const BROWN = '#4E2F1F';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const BORDER = '#F2DDE5';

const COUNTDOWN_SECONDS = 3;
const REST_SECONDS = 2;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'rest'
  | 'processing'
  | 'results';

interface RepetitionResult {
  measurement: FrequencyZoneStabilityMeasurement;
  score: FrequencyZoneStabilityScoreResult;
  detectedZone: FrequencyZone | null;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

function formatNumber(
  value: number,
  decimals = 1,
): string {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return value.toFixed(decimals);
}

function zoneLabel(
  zone: FrequencyZone,
): string {
  return String(zone)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

export default function FrequencyZoneStabilityScreen({
  tier,
}: Props) {
  const user = auth.currentUser;

  const [currentTier, setCurrentTier] =
    useState<Tier>('beginner');

  const [params, setParams] =
    useState<FrequencyZoneStabilityParams>(
      FREQUENCY_ZONE_STABILITY_PARAMS.beginner,
    );

  const [loadingParams, setLoadingParams] =
    useState(true);

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);

  const [restCountdown, setRestCountdown] =
    useState(REST_SECONDS);

  const [repetition, setRepetition] =
    useState(1);

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [liveZone, setLiveZone] =
    useState<FrequencyZone | null>(null);

  const [repetitionResults, setRepetitionResults] =
    useState<RepetitionResult[]>([]);

  const [result, setResult] =
    useState<{
      score: number;
      passed: boolean;
    } | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const mountedRef =
    useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const restTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const recordingRef =
    useRef(false);

  const processingRef =
    useRef(false);

  const stopRequestedRef =
    useRef(false);

  const elapsedRef =
    useRef(0);

  const repetitionRef =
    useRef(1);

  const resultsRef =
    useRef<RepetitionResult[]>([]);

  const pitchHistoryRef =
    useRef<number[]>([]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;

      if (countdownTimerRef.current) {
        clearInterval(
          countdownTimerRef.current,
        );
      }

      if (restTimerRef.current) {
        clearInterval(
          restTimerRef.current,
        );
      }

      if (recordingTimerRef.current) {
        clearInterval(
          recordingTimerRef.current,
        );
      }
    };
  }, []);

  const loadParams = useCallback(
    async () => {
      if (!user) {
        setLoadingParams(false);
        return;
      }

      try {
        setLoadingParams(true);

        const progress =
          await fetchComponentProgress(
            user.uid,
            'tone',
          );

        const resolvedTier =
          tier ??
          progress?.currentTier ??
          'beginner';

        if (!mountedRef.current) {
          return;
        }

        setCurrentTier(resolvedTier);

        const records =
          await fetchExerciseRecords(
            user.uid,
            'tone',
          );

        const currentTierRecords =
          records
            .filter(
              (record) =>
                record.templateId ===
                  'frequencyZoneStability' &&
                record.tier ===
                  resolvedTier,
            )
            .sort(
              (a, b) =>
                a.timestamp -
                b.timestamp,
            );

        let recentScores =
          currentTierRecords
            .slice(-5)
            .map(
              (record) =>
                record.scorePct,
            );

        if (recentScores.length === 0) {
          const assessment =
            await getLatestAssessment();

          const assessmentScore =
            assessment?.scores.find(
              (score) =>
                score.componentId === 'tone',
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

        const generatedParams =
          generateFrequencyZoneStabilityParams({
            tier: resolvedTier,
            recentScores,
          });

        if (!mountedRef.current) {
          return;
        }

        setParams(generatedParams);
      } catch (error) {
        console.error(
          'Failed to load Frequency Zone Stability parameters:',
          error,
        );

        if (!mountedRef.current) {
          return;
        }

        const fallbackTier =
          tier ?? 'beginner';

        setCurrentTier(fallbackTier);

        setParams(
          FREQUENCY_ZONE_STABILITY_PARAMS[
            fallbackTier
          ],
        );
      } finally {
        if (mountedRef.current) {
          setLoadingParams(false);
        }
      }
    },
    [tier, user],
  );

  useEffect(() => {
    loadParams();
  }, [loadParams]);

  const handleLiveFrame =
    useCallback(
      (frame: LiveAudioFrame) => {
        if (!mountedRef.current) {
          return;
        }

        setLiveFrame(frame);

        if (
          Number.isFinite(frame.pitch) &&
          frame.pitch > 0
        ) {
          pitchHistoryRef.current.push(
            frame.pitch,
          );

          setLiveZone(
            classifyFrequencyZone(
              frame.pitch,
            ),
          );
        } else {
          setLiveZone(null);
        }
      },
      [],
    );

  const finishExercise =
    useCallback(
      async (
        results: RepetitionResult[],
      ) => {
        if (results.length === 0) {
          setErrorMessage(
            'No recording results were detected.',
          );
          setPhase('instructions');
          return;
        }

        const averageScore =
          results.reduce(
            (sum, item) =>
              sum + item.score.score,
            0,
          ) / results.length;

        const allPassed =
          results.every(
            (item) =>
              item.score.passed,
          );

        const finalScore = Math.round(
          clamp(
            averageScore,
            0,
            100,
          ),
        );

        if (user) {
          try {
            await saveCompletedExercise(
              'tone',
              'frequencyZoneStability',
              currentTier,
              finalScore,
            );
          } catch (error) {
            console.error(
              'Failed to save Frequency Zone Stability result:',
              error,
            );

            if (mountedRef.current) {
              Alert.alert(
                'Progress Save Error',
                'Your score was calculated, but the progress could not be saved.',
              );
            }
          }
        }

        if (!mountedRef.current) {
          return;
        }

        setResult({
          score: finalScore,
          passed: allPassed,
        });

        setPhase('results');
      },
      [currentTier, user],
    );

  const handleRecordingStop =
    useCallback(
      (
        _samples: Float32Array,
        sampleRate: number,
      ) => {
        if (
          !mountedRef.current ||
          processingRef.current
        ) {
          return;
        }

        processingRef.current = true;
        recordingRef.current = false;

        if (recordingTimerRef.current) {
          clearInterval(
            recordingTimerRef.current,
          );

          recordingTimerRef.current = null;
        }

        const measurement =
          measureFrequencyZoneStability(
            pitchHistoryRef.current,
            elapsedRef.current / 1000,
          );

        const score =
          scoreFrequencyZoneStability(
            measurement,
            params,
          );

        const detectedZones =
          measurement.zoneSequence;

        const zoneCounts: Record<
          FrequencyZone,
          number
        > = {
          low: 0,
          mid: 0,
          high: 0,
        };

        for (const zone of detectedZones) {
          zoneCounts[zone] += 1;
        }

        let detectedZone:
          | FrequencyZone
          | null = null;

        if (detectedZones.length > 0) {
          detectedZone = 'low';

          for (const zone of [
            'mid',
            'high',
          ] as FrequencyZone[]) {
            if (
              zoneCounts[zone] >
              zoneCounts[detectedZone]
            ) {
              detectedZone = zone;
            }
          }
        }

        const repetitionResult: RepetitionResult =
          {
            measurement,
            score,
            detectedZone,
          };

        const updatedResults = [
          ...resultsRef.current,
          repetitionResult,
        ];

        resultsRef.current =
          updatedResults;

        if (!mountedRef.current) {
          return;
        }

        setRepetitionResults(
          updatedResults,
        );
        setLiveFrame(null);
        setLiveZone(null);

        pitchHistoryRef.current = [];

        processingRef.current = false;

        if (
          repetitionRef.current <
          params.repetitions
        ) {
          setPhase('rest');
          setRestCountdown(
            REST_SECONDS,
          );
        } else {
          setPhase('processing');

          void finishExercise(
            updatedResults,
          );
        }
      },
      [finishExercise, params],
    );

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  const startRecordingPhase =
    useCallback(
      async () => {
        if (
          recordingRef.current ||
          !mountedRef.current
        ) {
          return;
        }

        try {
          setErrorMessage(null);
          setElapsedMs(0);
          elapsedRef.current = 0;
          pitchHistoryRef.current = [];

          recordingRef.current = true;
          stopRequestedRef.current = false;

          setLiveFrame(null);
          setLiveZone(null);

          await startRecording();

          if (!mountedRef.current) {
            return;
          }

          recordingTimerRef.current =
            setInterval(() => {
              elapsedRef.current += 100;

              if (
                mountedRef.current
              ) {
                setElapsedMs(
                  elapsedRef.current,
                );
              }

              if (
                elapsedRef.current >=
                params.durationSec *
                  1000
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

                if (
                  !stopRequestedRef.current
                ) {
                  stopRequestedRef.current =
                    true;

                  stopRecording();
                }
              }
            }, 100);

          setPhase('recording');
        } catch (error) {
          console.error(
            'Failed to start recording:',
            error,
          );

          recordingRef.current =
            false;

          pitchHistoryRef.current = [];

          if (
            recordingTimerRef.current
          ) {
            clearInterval(
              recordingTimerRef.current,
            );

            recordingTimerRef.current =
              null;
          }

          if (mountedRef.current) {
            setErrorMessage(
              'Unable to start recording. Please check microphone permission and try again.',
            );

            setPhase('instructions');
          }
        }
      },
      [
        params.durationSec,
        startRecording,
        stopRecording,
      ],
    );

  const beginCountdown =
    useCallback(() => {
      setErrorMessage(null);
      setCountdown(
        COUNTDOWN_SECONDS,
      );
      setPhase('countdown');

      let value =
        COUNTDOWN_SECONDS;

      countdownTimerRef.current =
        setInterval(() => {
          value -= 1;

          if (
            !mountedRef.current
          ) {
            return;
          }

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

            void startRecordingPhase();
            return;
          }

          setCountdown(value);
        }, 1000);
    }, [startRecordingPhase]);

  const startExercise =
    useCallback(() => {
      resultsRef.current = [];
      repetitionRef.current = 1;
      pitchHistoryRef.current = [];

      setRepetitionResults([]);
      setResult(null);
      setRepetition(1);
      setErrorMessage(null);

      beginCountdown();
    }, [beginCountdown]);

  const handleRest =
    useCallback(() => {
      let value = REST_SECONDS;

      setRestCountdown(value);

      if (restTimerRef.current) {
        clearInterval(
          restTimerRef.current,
        );
      }

      restTimerRef.current =
        setInterval(() => {
          value -= 1;

          if (
            !mountedRef.current
          ) {
            return;
          }

          if (value <= 0) {
            if (
              restTimerRef.current
            ) {
              clearInterval(
                restTimerRef.current,
              );

              restTimerRef.current =
                null;
            }

            repetitionRef.current += 1;

            setRepetition(
              repetitionRef.current,
            );

            setElapsedMs(0);
            elapsedRef.current = 0;
            pitchHistoryRef.current = [];

            beginCountdown();
            return;
          }

          setRestCountdown(value);
        }, 1000);
    }, [beginCountdown]);

  useEffect(() => {
    if (phase === 'rest') {
      handleRest();
    }
  }, [phase, handleRest]);

  const handleRetry =
    useCallback(() => {
      resultsRef.current = [];
      repetitionRef.current = 1;
      pitchHistoryRef.current = [];

      setRepetitionResults([]);
      setResult(null);
      setRepetition(1);
      setElapsedMs(0);
      elapsedRef.current = 0;
      setLiveFrame(null);
      setLiveZone(null);
      setErrorMessage(null);

      setPhase('instructions');
    }, []);

  const handleExit =
    useCallback(() => {
      router.back();
    }, []);

  const recordingProgress =
    params.durationSec > 0
      ? clamp(
          (elapsedMs / 1000) /
            params.durationSec,
          0,
          1,
        ) * 100
      : 0;

  const livePitch =
    liveFrame &&
    Number.isFinite(liveFrame.pitch) &&
    liveFrame.pitch > 0
      ? liveFrame.pitch
      : null;

  const averageScore =
    repetitionResults.length > 0
      ? Math.round(
          repetitionResults.reduce(
            (sum, item) =>
              sum + item.score.score,
            0,
          ) /
            repetitionResults.length,
        )
      : 0;

  const preparationSteps: ExercisePreparationStep[] =
    [
      {
        icon: 'body-outline',
        text: 'Stand or sit comfortably with relaxed shoulders.',
      },
      {
        icon: 'mic-outline',
        text: 'Sing at a comfortable pitch without forcing your voice.',
      },
      {
        icon: 'musical-note-outline',
        text: 'Maintain a steady vocal frequency throughout the recording.',
      },
    ];

  const summary: ExerciseSummaryItem[] =
    [
      {
        label: 'DURATION',
        value: `${params.durationSec}s`,
        hint: 'per repetition',
      },
      {
        label: 'STABILITY',
        value: `${params.stabilityThreshold}%`,
        hint: 'minimum',
      },
      {
        label: 'REPETITIONS',
        value: String(
          params.repetitions,
        ),
        hint: 'attempts',
      },
    ];

  if (loadingParams) {
    return (
      <View style={styles.loadingScreen}>
        <Text style={styles.loadingText}>
          Preparing exercise...
        </Text>
      </View>
    );
  }

  if (phase === 'instructions') {
    return (
      <ExerciseScreen
        title="Frequency Zone Stability"
        category="Tone"
        icon="pulse"
        instructions="Sing steadily while maintaining a consistent frequency zone throughout each repetition."
        preparationSteps={
          preparationSteps
        }
        summary={summary}
        tip="Focus on keeping your voice steady rather than changing pitch during the repetition."
        tier={currentTier}
        onBack={() => router.back()}
        onStart={startExercise}
        error={errorMessage}
      >
        <View
          style={styles.disclaimerCard}
        >
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={BROWN}
          />

          <Text
            style={styles.disclaimerText}
          >
            This is a frequency-based
            training indicator, not a
            direct measurement of
            physical resonance placement.
          </Text>
        </View>
      </ExerciseScreen>
    );
  }

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="pulse"
        title="Frequency Zone Stability"
        currentRep={repetition}
        repetitions={params.repetitions}
        countdown={countdown}
        promptTitle="Get Ready"
        prompt="Prepare to sing steadily and maintain a consistent frequency zone."
        onBack={() => router.back()}
      />
    );
  }

  if (phase === 'recording') {
    return (
      <ExerciseListeningScreen
        icon="pulse"
        title="Frequency Zone Stability"
        currentRep={repetition}
        repetitions={params.repetitions}
        elapsed={elapsedMs / 1000}
        targetDuration={
          params.durationSec
        }
        promptTitle="Stabilize Your Frequency"
        prompt="Sing steadily and maintain a consistent frequency zone."
        progress={recordingProgress}
        liveContent={
          <View
            style={styles.liveFrequencyCard}
          >
            <Text
              style={styles.liveLabel}
            >
              LIVE FREQUENCY
            </Text>

            <Text
              style={styles.liveValue}
            >
              {livePitch !== null
                ? `${formatNumber(
                    livePitch,
                    0,
                  )} Hz`
                : '--'}
            </Text>

            <View
              style={styles.liveZoneRow}
            >
              <Text
                style={styles.liveZoneLabel}
              >
                Zone
              </Text>

              <Text
                style={styles.liveZoneValue}
              >
                {liveZone
                  ? zoneLabel(
                      liveZone,
                    )
                  : '--'}
              </Text>
            </View>

            <Text
              style={styles.liveDisclaimer}
            >
              Live frequency is a
              training indicator.
            </Text>
          </View>
        }
        onBack={() => {
          if (
            recordingRef.current
          ) {
            stopRequestedRef.current =
              true;

            stopRecording();
          }

          router.back();
        }}
      />
    );
  }

  if (phase === 'rest') {
    return (
      <ExerciseCountdownScreen
        icon="pulse"
        title="Frequency Zone Stability"
        currentRep={repetition}
        repetitions={params.repetitions}
        countdown={restCountdown}
        promptTitle="Rest"
        prompt="Relax your voice and prepare for the next repetition."
        onBack={() => router.back()}
      />
    );
  }

  if (phase === 'processing') {
    return (
      <ExerciseProcessingScreen
        icon="pulse"
        title="Analyzing Your Performance"
        message="Analyzing your frequency stability..."
      />
    );
  }

  if (phase === 'results' && result) {
    return (
      <ExerciseResultsScreen
        title={
          result.passed
            ? 'Great Job!'
            : 'Keep Practicing!'
        }
        subtitle="Frequency Zone Stability"
        score={result.score}
        resultIcon={
          result.passed
            ? 'checkmark-circle'
            : 'refresh-circle'
        }
        scoreMessage={
          result.passed
            ? 'You maintained good frequency stability.'
            : 'Try to keep your vocal frequency more consistent.'
        }
        onRetry={handleRetry}
        onExit={handleExit}
      >
        <View
          style={styles.resultDetailsCard}
        >
          <View
            style={styles.resultDetailRow}
          >
            <Text
              style={styles.resultDetailLabel}
            >
              Stability
            </Text>

            <Text
              style={styles.resultDetailValue}
            >
              {formatNumber(
                repetitionResults.reduce(
                  (sum, item) =>
                    sum +
                    item.measurement
                      .stabilityPct,
                  0,
                ) /
                  Math.max(
                    repetitionResults.length,
                    1,
                  ),
                1,
              )}
              %
            </Text>
          </View>

          <View
            style={styles.resultDivider}
          />

          <View
            style={styles.resultDetailRow}
          >
            <Text
              style={styles.resultDetailLabel}
            >
              Repetitions
            </Text>

            <Text
              style={styles.resultDetailValue}
            >
              {
                repetitionResults.filter(
                  (item) =>
                    item.score.passed,
                ).length
              }
              /{repetitionResults.length}
            </Text>
          </View>

          <View
            style={styles.resultDivider}
          />

          <View
            style={styles.resultDetailRow}
          >
            <Text
              style={styles.resultDetailLabel}
            >
              Average Score
            </Text>

            <Text
              style={styles.resultDetailValue}
            >
              {averageScore}%
            </Text>
          </View>
        </View>
      </ExerciseResultsScreen>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  loadingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
  },

  disclaimerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  disclaimerText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    marginLeft: 9,
  },

  liveFrequencyCard: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: MUTED,
    letterSpacing: 0.7,
  },

  liveValue: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    color: BROWN,
    marginTop: 4,
  },

  liveZoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },

  liveZoneLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
  },

  liveZoneValue: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
    marginLeft: 5,
  },

  liveDisclaimer: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
  },

  resultDetailsCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    marginBottom: 2,
  },

  resultDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  resultDetailLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
  },

  resultDetailValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },

  resultDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },
});