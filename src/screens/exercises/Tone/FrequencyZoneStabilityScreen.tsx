// src/screens/exercises/Tone/FrequencyZoneStabilityScreen.tsx

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
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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
  computeFFTMagnitudes,
} from '@/utils/dsp/fft';

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
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
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
  const [currentTier, setCurrentTier] =
    useState<Tier>(
      tier ?? 'beginner',
    );

  const [params, setParams] =
    useState<FrequencyZoneStabilityParams>(
      FREQUENCY_ZONE_STABILITY_PARAMS[
        tier ?? 'beginner'
      ],
    );

  const [loadingParams, setLoadingParams] =
    useState(true);

  const [phase, setPhase] =
    useState<Phase>(
      'instructions',
    );

  const [countdown, setCountdown] =
    useState(
      COUNTDOWN_SECONDS,
    );

  const [restCountdown, setRestCountdown] =
    useState(
      REST_SECONDS,
    );

  const [repetition, setRepetition] =
    useState(0);

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(
      null,
    );

  const [liveZone, setLiveZone] =
    useState<FrequencyZone | null>(
      null,
    );

  const [repetitionResults, setRepetitionResults] =
    useState<RepetitionResult[]>(
      [],
    );

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
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const restTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const recordingRef =
    useRef(false);

  const processingRef =
    useRef(false);

  const stopRequestedRef =
    useRef(false);

  const elapsedRef =
    useRef(0);

  const repetitionRef =
    useRef(0);

  const resultsRef =
    useRef<RepetitionResult[]>(
      [],
    );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (countdownTimerRef.current) {
        clearInterval(
          countdownTimerRef.current,
        );

        countdownTimerRef.current =
          null;
      }

      if (restTimerRef.current) {
        clearInterval(
          restTimerRef.current,
        );

        restTimerRef.current =
          null;
      }

      if (recordingTimerRef.current) {
        clearInterval(
          recordingTimerRef.current,
        );

        recordingTimerRef.current =
          null;
      }

      recordingRef.current = false;
      processingRef.current = false;
      stopRequestedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParams() {
      const user = auth.currentUser;

      if (!user) {
        if (!cancelled) {
          const fallbackTier =
            tier ?? 'beginner';

          setCurrentTier(
            fallbackTier,
          );

          setParams(
            FREQUENCY_ZONE_STABILITY_PARAMS[
              fallbackTier
            ],
          );

          setLoadingParams(false);
        }

        return;
      }

      try {
        setLoadingParams(true);

        const componentProgress =
          await fetchComponentProgress(
            user.uid,
            'tone',
          );

        const resolvedTier =
          tier ??
          componentProgress?.currentTier ??
          'beginner';

        const records =
          await fetchExerciseRecords(
            user.uid,
            'tone',
          );

        const currentTierRecords =
          records
            .filter(
              (record) =>
                record.tier ===
                  resolvedTier &&
                record.templateId ===
                  'frequencyZoneStability',
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

          const toneAssessment =
            assessment?.scores.find(
              (score) =>
                score.componentId ===
                'tone',
            );

          if (toneAssessment) {
            recentScores = [
              toneAssessment.scorePct,
            ];
          }
        }

        const generatedParams =
          generateFrequencyZoneStabilityParams({
            tier: resolvedTier,
            recentScores,
          });

        if (!cancelled) {
          setCurrentTier(
            resolvedTier,
          );

          setParams(
            generatedParams,
          );
        }
      } catch (error) {
        console.error(
          '❌ FAILED TO LOAD FREQUENCY ZONE STABILITY ADS PARAMS:',
          error,
        );

        if (!cancelled) {
          const fallbackTier =
            tier ?? 'beginner';

          setCurrentTier(
            fallbackTier,
          );

          setParams(
            FREQUENCY_ZONE_STABILITY_PARAMS[
              fallbackTier
            ],
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingParams(false);
        }
      }
    }

    void loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  const clearTimers =
    useCallback(() => {
      if (countdownTimerRef.current) {
        clearInterval(
          countdownTimerRef.current,
        );

        countdownTimerRef.current =
          null;
      }

      if (restTimerRef.current) {
        clearInterval(
          restTimerRef.current,
        );

        restTimerRef.current =
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

  const handleLiveFrame =
    useCallback(
      (frame: LiveAudioFrame) => {
        if (!mountedRef.current) {
          return;
        }

        setLiveFrame(frame);

        const pitch =
          Number.isFinite(frame.pitch) &&
          frame.pitch > 0
            ? frame.pitch
            : 0;

        setLiveZone(
          pitch > 0
            ? classifyFrequencyZone(pitch)
            : null,
        );
      },
      [],
    );

  const finishExercise =
    useCallback(
      async (
        completedResults: RepetitionResult[],
      ) => {
        if (
          completedResults.length === 0 ||
          !mountedRef.current
        ) {
          return;
        }

        const totalScore =
          completedResults.reduce(
            (
              sum,
              item,
            ) =>
              sum +
              item.score.score,
            0,
          ) /
          completedResults.length;

        const allPassed =
          completedResults.every(
            (item) =>
              item.score.passed,
          );

        const roundedScore =
          Math.round(
            clamp(
              totalScore,
              0,
              100,
            ),
          );

        setResult({
          score: roundedScore,
          passed: allPassed,
        });

        await saveCompletedExercise(
          'tone',
          'frequencyZoneStability',
          currentTier,
          roundedScore,
        );

        if (!mountedRef.current) {
          return;
        }

        setPhase('results');
      },
      [currentTier],
    );

  const handleRecordingStop =
    useCallback(
      async (
        samples: Float32Array,
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

          recordingTimerRef.current =
            null;
        }

        setPhase('processing');

        try {
          if (samples.length === 0) {
            throw new Error(
              'No audio samples were recorded.',
            );
          }

          const measurement =
            measureFrequencyZoneStability(
              samples,
              sampleRate,
              computeFFTMagnitudes,
            );

          if (
            measurement.zoneSequence.length ===
            0
          ) {
            throw new Error(
              'No usable frequency-zone frames were detected.',
            );
          }

          const scored =
            scoreFrequencyZoneStability(
              measurement,
              params,
            );

          const detectedZones =
            measurement.zoneSequence;

          const detectedZone =
            detectedZones.length > 0
              ? detectedZones[
                  Math.floor(
                    detectedZones.length / 2,
                  )
                ]
              : null;

          const nextResults = [
            ...resultsRef.current,
            {
              measurement,
              score: scored,
              detectedZone,
            },
          ];

          resultsRef.current =
            nextResults;

          setRepetitionResults(
            nextResults,
          );

          processingRef.current = false;

          if (!mountedRef.current) {
            return;
          }

          const isLast =
            repetitionRef.current >=
            params.repetitions;

          if (isLast) {
            await finishExercise(
              nextResults,
            );

            return;
          }

          setPhase('rest');

          let restValue =
            REST_SECONDS;

          setRestCountdown(
            restValue,
          );

          restTimerRef.current =
            setInterval(
              () => {
                restValue -= 1;

                if (restValue <= 0) {
                  if (restTimerRef.current) {
                    clearInterval(
                      restTimerRef.current,
                    );

                    restTimerRef.current =
                      null;
                  }

                  const nextIndex =
                    repetitionRef.current +
                    1;

                  setRepetition(
                    nextIndex,
                  );

                  repetitionRef.current =
                    nextIndex;

                  setCountdown(
                    COUNTDOWN_SECONDS,
                  );

                  setPhase('countdown');

                  return;
                }

                if (mountedRef.current) {
                  setRestCountdown(
                    restValue,
                  );
                }
              },
              1000,
            );
        } catch (error) {
          console.error(
            '❌ FREQUENCY ZONE STABILITY PROCESSING ERROR:',
            error,
          );

          processingRef.current = false;

          if (mountedRef.current) {
            setErrorMessage(
              'We could not analyze your frequency-zone recording. Please try again.',
            );

            setPhase(
              'instructions',
            );
          }
        }
      },
      [
        finishExercise,
        params,
      ],
    );

  const {
    startRecording,
    stopRecording,
  } =
    useAudioRecorder({
      onFrame:
        handleLiveFrame,
      onStop:
        handleRecordingStop,
    });

  const beginRecording =
    useCallback(
      async () => {
        if (
          !mountedRef.current ||
          recordingRef.current ||
          processingRef.current
        ) {
          return;
        }

        try {
          setLiveFrame(null);
          setLiveZone(null);

          elapsedRef.current = 0;

          setElapsedMs(0);

          stopRequestedRef.current =
            false;

          processingRef.current =
            false;

          setPhase('recording');

          await startRecording();

          if (!mountedRef.current) {
            return;
          }

          recordingRef.current =
            true;

          const durationMs =
            params.durationSec * 1000;

          recordingTimerRef.current =
            setInterval(
              () => {
                if (
                  !mountedRef.current ||
                  !recordingRef.current ||
                  stopRequestedRef.current
                ) {
                  return;
                }

                elapsedRef.current +=
                  100;

                setElapsedMs(
                  elapsedRef.current,
                );

                if (
                  elapsedRef.current >=
                  durationMs
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
                    stopRequestedRef.current
                  ) {
                    return;
                  }

                  stopRequestedRef.current =
                    true;

                  stopRecording().catch(
                    (error) => {
                      console.error(
                        '❌ FAILED TO STOP FREQUENCY ZONE STABILITY RECORDING:',
                        error,
                      );

                      recordingRef.current =
                        false;

                      stopRequestedRef.current =
                        false;

                      processingRef.current =
                        false;

                      if (
                        mountedRef.current
                      ) {
                        setErrorMessage(
                          'We could not finish the recording. Please try again.',
                        );

                        setPhase(
                          'instructions',
                        );
                      }
                    },
                  );
                }
              },
              100,
            );
        } catch (error) {
          console.error(
            '❌ FAILED TO START FREQUENCY ZONE STABILITY RECORDING:',
            error,
          );

          recordingRef.current =
            false;

          processingRef.current =
            false;

          stopRequestedRef.current =
            false;

          if (mountedRef.current) {
            setPhase(
              'instructions',
            );

            Alert.alert(
              'Microphone Error',
              'Unable to start the microphone. Please check your microphone permission and try again.',
            );
          }
        }
      },
      [
        params.durationSec,
        startRecording,
        stopRecording,
      ],
    );

  const startCountdown =
    useCallback(
      () => {
        if (
          !mountedRef.current ||
          recordingRef.current ||
          processingRef.current ||
          loadingParams
        ) {
          return;
        }

        clearTimers();

        resultsRef.current = [];

        setRepetitionResults([]);

        setResult(null);

        setErrorMessage(null);

        setLiveFrame(null);

        setLiveZone(null);

        elapsedRef.current = 0;

        setElapsedMs(0);

        recordingRef.current =
          false;

        processingRef.current =
          false;

        stopRequestedRef.current =
          false;

        repetitionRef.current = 1;

        setRepetition(1);

        let value =
          COUNTDOWN_SECONDS;

        setCountdown(value);

        setPhase('countdown');

        countdownTimerRef.current =
          setInterval(
            () => {
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

                void beginRecording();

                return;
              }

              if (mountedRef.current) {
                setCountdown(value);
              }
            },
            1000,
          );
      },
      [
        beginRecording,
        clearTimers,
        loadingParams,
      ],
    );

  const retry =
    useCallback(
      () => {
        clearTimers();

        resultsRef.current = [];

        setRepetitionResults([]);

        setResult(null);

        setLiveFrame(null);

        setLiveZone(null);

        setElapsedMs(0);

        setRepetition(0);

        repetitionRef.current = 0;

        recordingRef.current =
          false;

        processingRef.current =
          false;

        stopRequestedRef.current =
          false;

        setErrorMessage(null);

        setPhase('instructions');
      },
      [clearTimers],
    );

  const goBack =
    useCallback(
      () => {
        clearTimers();

        recordingRef.current =
          false;

        processingRef.current =
          false;

        stopRequestedRef.current =
          true;

        router.replace(
          '/dashboard?tab=exercises',
        );
      },
      [clearTimers],
    );

  const recordingProgress =
    params.durationSec > 0
      ? clamp(
          elapsedMs /
            1000 /
            params.durationSec,
          0,
          1,
        )
      : 0;

  const livePitch =
    liveFrame &&
    liveFrame.pitch > 0
      ? formatNumber(
          liveFrame.pitch,
          0,
        )
      : '--';

  const averageScore =
    repetitionResults.length > 0
      ? Math.round(
          repetitionResults.reduce(
            (
              sum,
              item,
            ) =>
              sum +
              item.score.score,
            0,
          ) /
            repetitionResults.length,
        )
      : 0;

  if (loadingParams) {
    return (
      <View
        style={
          styles.centerScreen
        }
      >
        <View
          style={
            styles.iconCircle
          }
        >
          <Ionicons
            name="options-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={
            styles.phaseTitle
          }
        >
          Preparing Your Exercise
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Adjusting the exercise based on
          your recent performance.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={
            styles.processingIndicator
          }
        />
      </View>
    );
  }

  if (phase === 'instructions') {
    return (
      <View
        style={styles.screen}
      >
        <Pressable
          style={styles.backButton}
          onPress={goBack}
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={BROWN}
          />
        </Pressable>

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
              name="swap-horizontal-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.title}
          >
            Frequency Zone Stability
          </Text>

          <Text
            style={styles.subtitle}
          >
            Tone
          </Text>

          <View
            style={
              styles.instructionCard
            }
          >
            <View
              style={
                styles.prepareCard
              }
            >
              <View
                style={
                  styles.prepareHeader
                }
              >
                <Ionicons
                  name="mic-outline"
                  size={21}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareTitle
                  }
                >
                  Before You Begin
                </Text>
              </View>

              <View
                style={
                  styles.prepareItem
                }
              >
                <Ionicons
                  name="volume-mute-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareText
                  }
                >
                  Find a quiet room or area
                  with minimal background
                  noise.
                </Text>
              </View>

              <View
                style={
                  styles.prepareItem
                }
              >
                <Ionicons
                  name="body-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareText
                  }
                >
                  Stand or sit upright with
                  your shoulders and neck
                  relaxed.
                </Text>
              </View>

              <View
                style={
                  styles.prepareItem
                }
              >
                <Ionicons
                  name="mic-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareText
                  }
                >
                  Keep a consistent distance
                  from the microphone.
                </Text>
              </View>
            </View>

            <Text
              style={styles.cardTitle}
            >
              What You Are Practicing
            </Text>

            <Text
              style={
                styles.instruction
              }
            >
              Frequency-zone stability measures
              how consistently the detected
              dominant frequency remains within
              the classified frequency zone while
              you sustain your voice.
            </Text>

            <Text
              style={
                styles.instruction
              }
            >
              Sustain a comfortable note and keep
              your vocal setup steady. Avoid
              intentionally shifting between
              frequency zones during the hold.
            </Text>

            <Text
              style={
                styles.instruction
              }
            >
              TuneUp! cannot directly sense the
              physical location of your vocal
              resonance. It uses dominant-frequency
              analysis as a microphone-based
              frequency-zone indicator.
            </Text>

            <View
              style={styles.targetBox}
            >
              <Ionicons
                name="analytics-outline"
                size={28}
                color={BROWN}
              />

              <View
                style={
                  styles.targetInfo
                }
              >
                <Text
                  style={
                    styles.targetLabel
                  }
                >
                  Exercise Focus
                </Text>

                <Text
                  style={
                    styles.targetValue
                  }
                >
                  Frequency Stability
                </Text>

                <Text
                  style={
                    styles.targetHint
                  }
                >
                  Maintain a stable classified
                  frequency zone throughout the
                  required hold.
                </Text>
              </View>
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
              Keep your jaw, tongue, and neck
              relaxed. The goal is a controlled,
              repeatable vocal sound rather than
              forcing a specific frequency zone.
            </Text>
          </View>

          <View
            style={
              styles.difficultyRow
            }
          >
            <Text
              style={
                styles.difficultyLabel
              }
            >
              Difficulty
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {currentTier}
            </Text>
          </View>

          <View
            style={
              styles.difficultyRow
            }
          >
            <Text
              style={
                styles.difficultyLabel
              }
            >
              Hold Duration
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {params.durationSec}s
            </Text>
          </View>

          <View
            style={
              styles.difficultyRow
            }
          >
            <Text
              style={
                styles.difficultyLabel
              }
            >
              Repetitions
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {params.repetitions}
            </Text>
          </View>

          <View
            style={
              styles.difficultyRow
            }
          >
            <Text
              style={
                styles.difficultyLabel
              }
            >
              Required Stability
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {params.stabilityThreshold}%
            </Text>
          </View>

          {errorMessage && (
            <View
              style={
                styles.errorCard
              }
            >
              <Ionicons
                name="alert-circle-outline"
                size={21}
                color={BROWN}
              />

              <Text
                style={
                  styles.errorText
                }
              >
                {errorMessage}
              </Text>
            </View>
          )}

          <Pressable
            style={
              styles.startButton
            }
            onPress={
              startCountdown
            }
          >
            <Text
              style={
                styles.startButtonText
              }
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

  if (phase === 'countdown') {
    return (
      <View
        style={
          styles.centerScreen
        }
      >
        <View
          style={
            styles.iconCircle
          }
        >
          <Ionicons
            name="swap-horizontal-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={
            styles.phaseTitle
          }
        >
          Get Ready
        </Text>

        <Text
          style={
            styles.countdownText
          }
        >
          {countdown}
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Prepare a comfortable,
          steady vocal sound.
        </Text>

        <Text
          style={
            styles.largeBand
          }
        >
          Stay Stable
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Repetition{' '}
          {repetition} /{' '}
          {params.repetitions}
        </Text>
      </View>
    );
  }

  if (phase === 'rest') {
    return (
      <View
        style={
          styles.centerScreen
        }
      >
        <View
          style={
            styles.iconCircle
          }
        >
          <Ionicons
            name="pause-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={
            styles.phaseTitle
          }
        >
          Relax
        </Text>

        <Text
          style={
            styles.countdownText
          }
        >
          {restCountdown}
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Prepare for the next repetition
        </Text>

        <Text
          style={
            styles.largeBand
          }
        >
          Stay Consistent
        </Text>
      </View>
    );
  }

  if (phase === 'recording') {
    return (
      <View
        style={styles.screen}
      >
        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.recordingContent
          }
        >
          <View
            style={
              styles.recordingIcon
            }
          >
            <Ionicons
              name="mic"
              size={34}
              color={BROWN}
            />
          </View>

          <Text
            style={
              styles.recordingTitle
            }
          >
            Stabilize Your Resonance
          </Text>

          <Text
            style={
              styles.recordingSubtitle
            }
          >
            Keep your vocal sound steady
            throughout the hold.
          </Text>

          <View
            style={styles.targetBandCard}
          >
            <Text
              style={
                styles.targetBandLabel
              }
            >
              EXERCISE FOCUS
            </Text>

            <View
              style={
                styles.targetBandRow
              }
            >
              <View
                style={
                  styles.targetBandIconCircle
                }
              >
                <Ionicons
                  name="analytics-outline"
                  size={27}
                  color={BROWN}
                />
              </View>

              <View>
                <Text
                  style={
                    styles.targetBandValue
                  }
                >
                  Frequency Stability
                </Text>

                <Text
                  style={
                    styles.targetBandHint
                  }
                >
                  Maintain a consistent
                  dominant-frequency zone.
                </Text>
              </View>
            </View>
          </View>

          <View
            style={
              styles.microphoneArea
            }
          >
            <View
              style={
                styles.outerMicCircle
              }
            >
              <View
                style={
                  styles.innerMicCircle
                }
              >
                <Ionicons
                  name="mic"
                  size={52}
                  color={BROWN}
                />
              </View>
            </View>

            <View
              style={
                styles.recordingBadge
              }
            >
              <View
                style={
                  styles.recordingDot
                }
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

          <View
            style={
              styles.liveResonanceCard
            }
          >
            <Text
              style={
                styles.liveLabel
              }
            >
              LIVE FREQUENCY INDICATOR
            </Text>

            <Text
              style={
                styles.liveBandValue
              }
            >
              {liveZone
                ? zoneLabel(liveZone)
                : '--'}
            </Text>

            <View
              style={
                styles.liveMatchPill
              }
            >
              <Ionicons
                name={
                  liveZone
                    ? 'analytics-outline'
                    : 'information-circle-outline'
                }
                size={17}
                color={BROWN}
              />

              <Text
                style={
                  styles.liveMatchText
                }
              >
                {liveZone
                  ? `Current frequency indicator: ${zoneLabel(
                      liveZone,
                    )}`
                  : 'Waiting for a clear vocal signal'}
              </Text>
            </View>

            <Text
              style={
                styles.liveDisclaimer
              }
            >
              This is a frequency-based training
              indicator, not a direct measurement
              of physical resonance placement.
            </Text>

            <View
              style={
                styles.livePitchRow
              }
            >
              <Text
                style={
                  styles.livePitchLabel
                }
              >
                Detected pitch
              </Text>

              <Text
                style={
                  styles.livePitchValue
                }
              >
                {livePitch} Hz
              </Text>
            </View>
          </View>

          <View
            style={
              styles.timerCard
            }
          >
            <Text
              style={
                styles.timerText
              }
            >
              {(elapsedMs / 1000).toFixed(1)}
              {' / '}
              {params.durationSec}s
            </Text>

            <View
              style={
                styles.timerTrack
              }
            >
              <View
                style={[
                  styles.timerFill,
                  {
                    width: `${recordingProgress * 100}%`,
                  },
                ]}
              />
            </View>

            <Text
              style={
                styles.repetitionText
              }
            >
              Repetition{' '}
              {repetition} /{' '}
              {params.repetitions}
            </Text>
          </View>

          <View
            style={
              styles.reminderCard
            }
          >
            <Ionicons
              name="body-outline"
              size={20}
              color={BROWN}
            />

            <Text
              style={
                styles.reminderText
              }
            >
              Keep the jaw, tongue, and neck
              relaxed. Do not push or deliberately
              shift the voice during the hold.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'processing') {
    return (
      <View
        style={
          styles.centerScreen
        }
      >
        <View
          style={
            styles.iconCircle
          }
        >
          <Ionicons
            name="analytics-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={
            styles.phaseTitle
          }
        >
          Analyzing Your Frequency
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Tracking dominant frequency changes
          and frequency-zone stability.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={
            styles.processingIndicator
          }
        />
      </View>
    );
  }

  if (
    phase === 'results' &&
    result
  ) {
    return (
      <View
        style={
          styles.screen
        }
      >
        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.resultsContent
          }
        >
          <View
            style={[
              styles.resultIcon,
              result.passed
                ? styles.resultIconPassed
                : styles.resultIconFailed,
            ]}
          >
            <Ionicons
              name={
                result.passed
                  ? 'checkmark'
                  : 'refresh'
              }
              size={40}
              color={BROWN}
            />
          </View>

          <Text
            style={
              styles.resultTitle
            }
          >
            {result.passed
              ? 'Great Job!'
              : 'Keep Practicing!'}
          </Text>

          <Text
            style={
              styles.resultSubtitle
            }
          >
            Frequency Zone Stability Result
          </Text>

          <View
            style={
              styles.scoreCard
            }
          >
            <Text
              style={
                styles.scoreLabel
              }
            >
              Overall Score
            </Text>

            <Text
              style={
                styles.scoreValue
              }
            >
              {result.score}%
            </Text>

            <Text
              style={
                styles.scoreDescription
              }
            >
              {result.passed
                ? 'Your frequency-zone stability met the required threshold and the hold duration met the target.'
                : 'Focus on maintaining a stable frequency zone for the full required hold.'}
            </Text>
          </View>

          <View
            style={
              styles.resultCard
            }
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Repetition Results
            </Text>

            {repetitionResults.map(
              (
                item,
                index,
              ) => (
                <View
                  key={`${index}-${item.detectedZone ?? 'none'}`}
                  style={
                    styles.repResultRow
                  }
                >
                  <View
                    style={
                      styles.repResultNumber
                    }
                  >
                    <Text
                      style={
                        styles.repResultNumberText
                      }
                    >
                      {index + 1}
                    </Text>
                  </View>

                  <View
                    style={
                      styles.repResultMain
                    }
                  >
                    <Text
                      style={
                        styles.repResultTarget
                      }
                    >
                      Detected:{' '}
                      {item.detectedZone
                        ? zoneLabel(
                            item.detectedZone,
                          )
                        : '--'}
                    </Text>

                    <Text
                      style={
                        styles.repResultDetected
                      }
                    >
                      Stability:{' '}
                      {formatNumber(
                        item.measurement
                          .stabilityPct,
                        0,
                      )}
                      %
                    </Text>
                  </View>

                  <Text
                    style={
                      styles.repResultScore
                    }
                  >
                    {item.score.score}%
                  </Text>
                </View>
              ),
            )}
          </View>

          <View
            style={
              styles.resultCard
            }
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Performance Summary
            </Text>

            <View
              style={
                styles.resultRow
              }
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Frequency-zone stability
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {repetitionResults.length
                  ? `${Math.round(
                      repetitionResults.reduce(
                        (
                          sum,
                          item,
                        ) =>
                          sum +
                          item.measurement
                            .stabilityPct,
                        0,
                      ) /
                        repetitionResults.length,
                    )}%`
                  : '--'}
              </Text>
            </View>

            <View
              style={
                styles.resultRow
              }
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Average hold duration
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {repetitionResults.length
                  ? `${formatNumber(
                      repetitionResults.reduce(
                        (
                          sum,
                          item,
                        ) =>
                          sum +
                          item.measurement
                            .durationSec,
                        0,
                      ) /
                        repetitionResults.length,
                    )}s`
                  : '--'}
              </Text>
            </View>

            <View
              style={
                styles.resultRow
              }
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Required stability
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {params.stabilityThreshold}%
              </Text>
            </View>

            <View
              style={
                styles.resultRow
              }
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Average score
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {averageScore}%
              </Text>
            </View>
          </View>

          <View
            style={
              styles.explanationCard
            }
          >
            <Ionicons
              name="information-circle-outline"
              size={21}
              color={BROWN}
            />

            <Text
              style={
                styles.explanationText
              }
            >
              The frequency-zone indicator is based
              on dominant-frequency classification.
              The current scoring function evaluates
              frequency-zone stability and hold
              duration using a 60% stability and
              40% duration weighting. Target-zone
              agreement is not a separate scoring
              term.
            </Text>
          </View>

          <Pressable
            style={
              styles.primaryButton
            }
            onPress={
              retry
            }
          >
            <Text
              style={
                styles.primaryButtonText
              }
            >
              Try Again
            </Text>

            <Ionicons
              name="refresh"
              size={18}
              color={WHITE}
            />
          </Pressable>

          <Pressable
            style={
              styles.secondaryButton
            }
            onPress={
              goBack
            }
          >
            <Text
              style={
                styles.secondaryButtonText
              }
            >
              Back to Exercises
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 100,
    paddingBottom: 60,
    alignItems: 'center',
  },

  recordingContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 50,
    alignItems: 'center',
  },

  resultsContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 50,
    alignItems: 'center',
  },

  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
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
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },

  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
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
    paddingVertical: 15,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },

  targetInfo: {
    flex: 1,
    marginLeft: 12,
  },

  targetLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  targetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    marginTop: 2,
  },

  targetHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: MUTED,
    marginTop: 2,
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
    marginBottom: 20,
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

  errorCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  errorText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 10,
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

  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },

  phaseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
  },

  largeBand: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 12,
  },

  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
  },

  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 18,
  },

  targetBandCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    marginTop: 25,
  },

  targetBandLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  targetBandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },

  targetBandIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  targetBandValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
  },

  targetBandHint: {
    maxWidth: 240,
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 14,
    color: MUTED,
  },

  microphoneArea: {
    alignItems: 'center',
    marginVertical: 20,
  },

  outerMicCircle: {
    width: 146,
    height: 146,
    borderRadius: 73,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  innerMicCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recordingBadge: {
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: BROWN,
  },

  recordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
    letterSpacing: 0.8,
  },

  liveResonanceCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    marginTop: 14,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  liveBandValue: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 4,
  },

  liveMatchPill: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WHITE,
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 9,
  },

  liveMatchText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 14,
    color: BROWN,
    marginLeft: 7,
  },

  liveDisclaimer: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    lineHeight: 13,
    color: MUTED,
    textAlign: 'center',
    marginTop: 9,
  },

  livePitchRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  livePitchLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  livePitchValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  timerCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    marginTop: 14,
  },

  timerText: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    textAlign: 'center',
  },

  timerTrack: {
    width: '100%',
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 10,
  },

  timerFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 5,
  },

  repetitionText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 9,
  },

  reminderCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  reminderText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 10,
  },

  processingIndicator: {
    marginTop: 28,
  },

  resultIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  resultIconPassed: {
    backgroundColor: PINK,
  },

  resultIconFailed: {
    backgroundColor: LIGHT_GRAY,
  },

  resultTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
  },

  resultSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
    marginBottom: 22,
  },

  scoreCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
  },

  scoreLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
  },

  scoreValue: {
    fontFamily: 'FredokaBold',
    fontSize: 52,
    color: BROWN,
    marginVertical: 3,
  },

  scoreDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
  },

  resultCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginBottom: 10,
  },

  repResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  repResultNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  repResultNumberText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },

  repResultMain: {
    flex: 1,
    marginLeft: 9,
  },

  repResultTarget: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },

  repResultDetected: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    lineHeight: 13,
    color: MUTED,
    marginTop: 2,
  },

  repResultScore: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginLeft: 10,
  },

  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  resultRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    flex: 1,
  },

  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    marginLeft: 12,
  },

  explanationCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  explanationText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: BROWN,
    marginLeft: 9,
  },

  primaryButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },

  primaryButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  secondaryButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },

  secondaryButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
  },
});