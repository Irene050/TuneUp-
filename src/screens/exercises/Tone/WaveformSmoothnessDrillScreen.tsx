// src/screens/exercises/Tone/WaveformSmoothnessDrillScreen.tsx

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  type Tier,
  WAVEFORM_SMOOTHNESS_PARAMS,
  type WaveformSmoothnessParams,
} from '@/constants/exercises/tone';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  generateWaveformSmoothnessParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  measureWaveformSmoothness,
} from '@/services/measurement/tone/waveformSmoothnessDrill';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  WaveformSmoothnessScoreResult,
  scoreWaveformSmoothnessDrill,
} from '@/services/scoring/tone/waveformSmoothnessDrill';

import { auth } from '@/services/firebase/config';

import { samplesToFFTFrames } from '@/utils/dsp/fft';
import { frequencyToNote } from '@/utils/dsp/pitch';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';

const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;
const COUNTDOWN_SECONDS = 3;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

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
  return Number.isFinite(value)
    ? value.toFixed(decimals)
    : '--';
}

export default function WaveformSmoothnessDrillScreen({
  tier,
}: Props) {
  /*
   * ----------------------------------------------------------
   * INITIAL STATE
   * ----------------------------------------------------------
   *
   * If a route explicitly supplies a tier, use it.
   * Otherwise, begin with Beginner while the user's
   * saved Tone tier is being loaded.
   */
  const initialTier =
    tier ?? 'beginner';

  const [currentTier, setCurrentTier] =
    useState<Tier>(
      initialTier,
    );

  const [params, setParams] =
    useState<WaveformSmoothnessParams>(
      WAVEFORM_SMOOTHNESS_PARAMS[
        initialTier
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

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(
      null,
    );

  const [result, setResult] =
    useState<WaveformSmoothnessScoreResult | null>(
      null,
    );

  const [centroidSmoothness, setCentroidSmoothness] =
    useState(0);

  const [amplitudeStability, setAmplitudeStability] =
    useState(0);

  const [averageCentroid, setAverageCentroid] =
    useState(0);

  const [frameCount, setFrameCount] =
    useState(0);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(
      null,
    );

  const mountedRef =
    useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const recordingRef =
    useRef(false);

  const stopRequestedRef =
    useRef(false);

  const processingRef =
    useRef(false);

  const elapsedRef =
    useRef(0);

  const stopRecordingRef =
    useRef<(() => Promise<void>) | null>(
      null,
    );

  /*
   * ----------------------------------------------------------
   * LOAD ADAPTIVE PARAMETERS
   * ----------------------------------------------------------
   *
   * Adaptive parameters used by this exercise:
   *
   * - durationSec
   * - smoothnessThreshold
   *
   * The exercise is one continuous hold, so repetitions
   * are not used here.
   *
   * Amplitude stability is measured from the recording,
   * but amplitudeVariancePct is not currently used as a
   * scoring threshold, so it is not treated as an
   * adaptive parameter for this screen.
   *
   * Recent history is limited to the current tier and
   * this exercise template.
   *
   * If there is no exercise history yet, the latest
   * Tone Assessment score is used as the cold-start
   * reference.
   */
  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParameters =
      async () => {
        const user =
          auth.currentUser;

        if (!user) {
          if (!cancelled) {
            const fallbackTier =
              tier ?? 'beginner';

            setCurrentTier(
              fallbackTier,
            );

            setParams(
              WAVEFORM_SMOOTHNESS_PARAMS[
                fallbackTier
              ],
            );

            setLoadingParams(
              false,
            );
          }

          return;
        }

        try {
          setLoadingParams(
            true,
          );

          /*
           * Get the user's stored Tone component progress.
           */
          const componentProgress =
            await fetchComponentProgress(
              user.uid,
              'tone',
            );

          /*
           * Explicit route tier takes priority.
           * Otherwise use the saved component tier.
           * If neither exists, use Beginner.
           */
          const resolvedTier =
            tier ??
            componentProgress?.currentTier ??
            'beginner';

          /*
           * Get completed Tone exercise records.
           */
          const records =
            await fetchExerciseRecords(
              user.uid,
              'tone',
            );

          /*
           * Use only Waveform Smoothness records
           * from the currently resolved tier.
           */
          const currentTierRecords =
            records
              .filter(
                record =>
                  record.tier ===
                    resolvedTier &&
                  record.templateId ===
                    'waveformSmoothnessDrill',
              )
              .sort(
                (a, b) =>
                  a.timestamp -
                  b.timestamp,
              );

          /*
           * Rolling window = latest five completed
           * Waveform Smoothness scores.
           */
          const recentScores =
            currentTierRecords
              .slice(-5)
              .map(record =>
                Number(
                  record.scorePct,
                ),
              )
              .filter(score =>
                Number.isFinite(
                  score,
                ),
              );

          /*
           * Cold start:
           * if there is no completed exercise history
           * for this tier/template, use the latest
           * Tone Assessment result.
           */
          let referenceScores =
            recentScores;

          if (
            referenceScores.length ===
            0
          ) {
            const assessment =
              await getLatestAssessment();

            const toneAssessmentScore =
              assessment?.scores.find(
                score =>
                  score.componentId ===
                  'tone',
              )?.scorePct;

            if (
              Number.isFinite(
                toneAssessmentScore,
              )
            ) {
              referenceScores = [
                Number(
                  toneAssessmentScore,
                ),
              ];
            }
          }

          /*
           * Generate adaptive parameters.
           */
          const generatedParams =
            generateWaveformSmoothnessParams(
              {
                tier:
                  resolvedTier,

                recentScores:
                  referenceScores,
              },
            );

          if (cancelled) {
            return;
          }

          setCurrentTier(
            resolvedTier,
          );

          setParams(
            generatedParams,
          );
        } catch (error) {
          console.error(
            '❌ FAILED TO LOAD WAVEFORM SMOOTHNESS ADS:',
            error,
          );

          /*
           * Fall back to the explicitly supplied tier,
           * or Beginner if no tier was supplied.
           */
          if (!cancelled) {
            const fallbackTier =
              tier ?? 'beginner';

            setCurrentTier(
              fallbackTier,
            );

            setParams(
              WAVEFORM_SMOOTHNESS_PARAMS[
                fallbackTier
              ],
            );
          }
        } finally {
          if (!cancelled) {
            setLoadingParams(
              false,
            );
          }
        }
      };

    void loadAdaptiveParameters();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  /*
   * ----------------------------------------------------------
   * CLEANUP
   * ----------------------------------------------------------
   */
  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;

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
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current,
        );

        recordingTimerRef.current =
          null;
      }

      recordingRef.current =
        false;

      stopRequestedRef.current =
        false;
    };
  }, []);

  /*
   * ----------------------------------------------------------
   * LIVE AUDIO
   * ----------------------------------------------------------
   */
  const handleLiveFrame =
    useCallback(
      (
        frame: LiveAudioFrame,
      ) => {
        if (
          mountedRef.current
        ) {
          setLiveFrame(
            frame,
          );
        }
      },
      [],
    );

  /*
   * ----------------------------------------------------------
   * RESET
   * ----------------------------------------------------------
   */
  const resetExercise =
    useCallback(() => {
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
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current,
        );

        recordingTimerRef.current =
          null;
      }

      recordingRef.current =
        false;

      stopRequestedRef.current =
        false;

      processingRef.current =
        false;

      elapsedRef.current =
        0;

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setElapsedMs(
        0,
      );

      setLiveFrame(
        null,
      );

      setResult(
        null,
      );

      setCentroidSmoothness(
        0,
      );

      setAmplitudeStability(
        0,
      );

      setAverageCentroid(
        0,
      );

      setFrameCount(
        0,
      );

      setErrorMessage(
        null,
      );
    }, []);

  /*
   * ----------------------------------------------------------
   * RECORDING STOP / PROCESSING
   * ----------------------------------------------------------
   */
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

        recordingRef.current =
          false;

        if (
          recordingTimerRef.current
        ) {
          clearInterval(
            recordingTimerRef.current,
          );

          recordingTimerRef.current =
            null;
        }

        processingRef.current =
          true;

        setPhase(
          'processing',
        );

        try {
          if (
            !samples.length ||
            sampleRate <= 0
          ) {
            throw new Error(
              'No usable audio was recorded.',
            );
          }

          const fftFrames =
            samplesToFFTFrames(
              samples,
              FFT_SIZE,
              FFT_HOP_SIZE,
            );

          if (
            !fftFrames.length
          ) {
            throw new Error(
              'No FFT frames could be generated.',
            );
          }

          const measurement =
            measureWaveformSmoothness(
              samples,
              fftFrames,
              sampleRate,
              FFT_SIZE,
            );

          /*
           * Score using the adaptive parameter set.
           *
           * The scorer calculates:
           *
           * spectral smoothness × 0.7
           * + amplitude stability × 0.3
           *
           * The adaptive smoothness threshold is used
           * for the pass/fail decision.
           */
          const scored =
            scoreWaveformSmoothnessDrill(
              measurement,
              params,
            );

          /*
           * Calculate average spectral centroid for
           * the result display.
           */
          const centroidArray =
            fftFrames
              .map(
                frame => {
                  let weightedSum =
                    0;

                  let magnitudeSum =
                    0;

                  for (
                    let bin = 0;
                    bin <
                    frame.length;
                    bin += 1
                  ) {
                    const frequency =
                      (bin *
                        sampleRate) /
                      FFT_SIZE;

                    const magnitude =
                      frame[bin];

                    weightedSum +=
                      frequency *
                      magnitude;

                    magnitudeSum +=
                      magnitude;
                  }

                  return magnitudeSum >
                    0
                    ? weightedSum /
                        magnitudeSum
                    : 0;
                },
              )
              .filter(
                value =>
                  Number.isFinite(
                    value,
                  ) &&
                  value > 0,
              );

          const avgCentroid =
            centroidArray.length >
            0
              ? centroidArray.reduce(
                  (
                    sum,
                    value,
                  ) =>
                    sum + value,
                  0,
                ) /
                centroidArray.length
              : 0;

          if (
            !mountedRef.current
          ) {
            return;
          }

          setCentroidSmoothness(
            measurement.centroidSmoothnessPct,
          );

          setAmplitudeStability(
            measurement.amplitudeStabilityPct,
          );

          setAverageCentroid(
            avgCentroid,
          );

          setFrameCount(
            fftFrames.length,
          );

          setResult(
            scored,
          );

          /*
           * Save using the resolved current tier.
           */
          await saveCompletedExercise(
            'tone',
            'waveformSmoothnessDrill',
            currentTier,
            scored.score,
          );

          if (
            mountedRef.current
          ) {
            setPhase(
              'results',
            );
          }
        } catch (error) {
          console.error(
            '❌ WAVEFORM SMOOTHNESS PROCESSING ERROR:',
            error,
          );

          if (
            mountedRef.current
          ) {
            setErrorMessage(
              'We could not analyze your recording. Please try again.',
            );

            setPhase(
              'instructions',
            );
          }
        } finally {
          processingRef.current =
            false;

          stopRequestedRef.current =
            false;
        }
      },
      [
        currentTier,
        params,
      ],
    );

  const {
    startRecording,
    stopRecording,
    isRecording,
  } =
    useAudioRecorder({
      onFrame:
        handleLiveFrame,

      onStop:
        handleRecordingStop,
    });

  useEffect(() => {
    stopRecordingRef.current =
      stopRecording;
  }, [stopRecording]);

  /*
   * ----------------------------------------------------------
   * BEGIN RECORDING
   * ----------------------------------------------------------
   */
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
          setLiveFrame(
            null,
          );

          elapsedRef.current =
            0;

          setElapsedMs(
            0,
          );

          stopRequestedRef.current =
            false;

          setPhase(
            'recording',
          );

          await startRecording();

          if (
            !mountedRef.current
          ) {
            return;
          }

          recordingRef.current =
            true;

          const durationMs =
            params.durationSec *
            1000;

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

                  stopRequestedRef.current =
                    true;

                  stopRecording().catch(
                    error => {
                      console.error(
                        '❌ FAILED TO STOP WAVEFORM RECORDING:',
                        error,
                      );

                      recordingRef.current =
                        false;

                      stopRequestedRef.current =
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
            '❌ FAILED TO START WAVEFORM RECORDING:',
            error,
          );

          recordingRef.current =
            false;

          stopRequestedRef.current =
            false;

          if (
            mountedRef.current
          ) {
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

  /*
   * ----------------------------------------------------------
   * COUNTDOWN
   * ----------------------------------------------------------
   */
  const startCountdown =
    useCallback(() => {
      resetExercise();

      setPhase(
        'countdown',
      );

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      let value =
        COUNTDOWN_SECONDS;

      countdownTimerRef.current =
        setInterval(
          () => {
            value -= 1;

            if (
              value <= 0
            ) {
              if (
                countdownTimerRef.current
              ) {
                clearInterval(
                  countdownTimerRef.current,
                );
              }

              countdownTimerRef.current =
                null;

              void beginRecording();

              return;
            }

            if (
              mountedRef.current
            ) {
              setCountdown(
                value,
              );
            }
          },
          1000,
        );
    }, [
      beginRecording,
      resetExercise,
    ]);

  /*
   * ----------------------------------------------------------
   * STOP EARLY
   * ----------------------------------------------------------
   */
  const stopEarly =
    useCallback(() => {
      if (
        !recordingRef.current ||
        stopRequestedRef.current
      ) {
        return;
      }

      stopRequestedRef.current =
        true;

      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current,
        );
      }

      recordingTimerRef.current =
        null;

      const stop =
        stopRecordingRef.current;

      if (!stop) {
        return;
      }

      stop().catch(
        error => {
          console.error(
            '❌ FAILED TO STOP WAVEFORM RECORDING EARLY:',
            error,
          );

          stopRequestedRef.current =
            false;
        },
      );
    }, []);

  /*
   * ----------------------------------------------------------
   * NAVIGATION
   * ----------------------------------------------------------
   */
  const goBack =
    useCallback(() => {
      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current,
        );
      }

      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current,
        );
      }

      router.replace(
        '/dashboard?tab=exercises',
      );
    }, []);

  const retry =
    useCallback(() => {
      resetExercise();

      setPhase(
        'instructions',
      );
    }, [
      resetExercise,
    ]);

  const recordingProgress =
    params.durationSec
      ? clamp(
          elapsedMs /
            1000 /
            params.durationSec,
          0,
          1,
        )
      : 0;

  const livePitchNote =
    liveFrame &&
    liveFrame.pitch > 0
      ? frequencyToNote(
          liveFrame.pitch,
        )
      : '--';

  /*
   * ----------------------------------------------------------
   * LOADING
   * ----------------------------------------------------------
   */
  if (
    loadingParams
  ) {
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
            name="pulse-outline"
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
          Adjusting the exercise to your current Tone progress.
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

  /*
   * ----------------------------------------------------------
   * INSTRUCTIONS
   * ----------------------------------------------------------
   */
  if (
    phase ===
    'instructions'
  ) {
    return (
      <View
        style={styles.screen}
      >
        <Pressable
          style={
            styles.backButton
          }
          onPress={
            goBack
          }
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
            style={
              styles.iconCircle
            }
          >
            <Ionicons
              name="pulse-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.title}
          >
            Waveform Smoothness
          </Text>

          <Text
            style={
              styles.subtitle
            }
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
                  Find a quiet place with minimal background noise.
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
                  Choose one comfortable note and stay on it for the entire drill.
                </Text>
              </View>

              <View
                style={
                  styles.prepareItem
                }
              >
                <Ionicons
                  name="pulse-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareText
                  }
                >
                  This is one continuous hold. There are no vowel repetitions or changing targets.
                </Text>
              </View>
            </View>

            <Text
              style={
                styles.cardTitle
              }
            >
              How It Works
            </Text>

            <Text
              style={
                styles.instruction
              }
            >
              Sustain one comfortable vocal sound for the full duration.
            </Text>

            <Text
              style={
                styles.instruction
              }
            >
              Keep the tone steady. Avoid deliberate changes in pitch, loudness, or vocal quality.
            </Text>

            <Text
              style={
                styles.instruction
              }
            >
              The drill looks at how stable your tone and amplitude remain across the whole recording.
            </Text>

            <View
              style={
                styles.targetBox
              }
            >
              <Ionicons
                name="pulse-outline"
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
                  GOAL
                </Text>

                <Text
                  style={
                    styles.targetValue
                  }
                >
                  Smooth &amp; Steady Tone
                </Text>
              </View>
            </View>
          </View>

          <View
            style={
              styles.keyMetricCard
            }
          >
            <Text
              style={
                styles.keyMetricTitle
              }
            >
              What makes this different?
            </Text>

            <View
              style={
                styles.metricRow
              }
            >
              <Ionicons
                name="pulse-outline"
                size={19}
                color={BROWN}
              />

              <Text
                style={
                  styles.metricText
                }
              >
                One continuous recording instead of repeated vowel attempts
              </Text>
            </View>

            <View
              style={
                styles.metricRow
              }
            >
              <Ionicons
                name="volume-medium-outline"
                size={19}
                color={BROWN}
              />

              <Text
                style={
                  styles.metricText
                }
              >
                Tone brightness smoothness + amplitude stability
              </Text>
            </View>
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
              Continuous hold
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {formatNumber(
                params.durationSec,
              )}
              s
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
              Required smoothness
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {formatNumber(
                params.smoothnessThreshold,
              )}
              %
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

  /*
   * ----------------------------------------------------------
   * COUNTDOWN
   * ----------------------------------------------------------
   */
  if (
    phase ===
    'countdown'
  ) {
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
            name="pulse-outline"
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
          Choose one comfortable note
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Then keep the tone steady for{' '}
          {formatNumber(
            params.durationSec,
          )}{' '}
          seconds.
        </Text>
      </View>
    );
  }

  /*
   * ----------------------------------------------------------
   * RECORDING
   * ----------------------------------------------------------
   */
  if (
    phase ===
    'recording'
  ) {
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
          <Text
            style={
              styles.recordingEyebrow
            }
          >
            ONE CONTINUOUS HOLD
          </Text>

          <Text
            style={
              styles.recordingTitle
            }
          >
            Keep Your Tone Steady
          </Text>

          <Text
            style={
              styles.recordingSubtitle
            }
          >
            Do not intentionally change the sound while you hold it.
          </Text>

          <View
            style={
              styles.goalCard
            }
          >
            <Ionicons
              name="pulse-outline"
              size={29}
              color={BROWN}
            />

            <View
              style={{
                flex: 1,
              }}
            >
              <Text
                style={
                  styles.goalTitle
                }
              >
                Steady Tone
              </Text>

              <Text
                style={
                  styles.goalText
                }
              >
                No target vowel • no repetitions • one continuous take
              </Text>
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
              styles.liveCard
            }
          >
            <Text
              style={
                styles.liveLabel
              }
            >
              LIVE SIGNAL
            </Text>

            <Text
              style={
                styles.liveNote
              }
            >
              {livePitchNote}
            </Text>

            <Text
              style={
                styles.liveFrequency
              }
            >
              {liveFrame &&
              liveFrame.pitch > 0
                ? `${Math.round(
                    liveFrame.pitch,
                  )} Hz`
                : '--'}
            </Text>

            <View
              style={
                styles.liveStats
              }
            >
              <View
                style={
                  styles.liveStat
                }
              >
                <Text
                  style={
                    styles.liveStatLabel
                  }
                >
                  Clarity
                </Text>

                <Text
                  style={
                    styles.liveStatValue
                  }
                >
                  {liveFrame &&
                  liveFrame.clarity >
                    0
                    ? `${Math.round(
                        liveFrame.clarity *
                          100,
                      )}%`
                    : '--'}
                </Text>
              </View>

              <View
                style={
                  styles.liveStat
                }
              >
                <Text
                  style={
                    styles.liveStatLabel
                  }
                >
                  Volume
                </Text>

                <Text
                  style={
                    styles.liveStatValue
                  }
                >
                  {liveFrame &&
                  Number.isFinite(
                    liveFrame.volume,
                  )
                    ? `${Math.round(
                        liveFrame.volume,
                      )} dB`
                    : '--'}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={
              styles.liveReminder
            }
          >
            <Ionicons
              name="lock-closed-outline"
              size={18}
              color={BROWN}
            />

            <Text
              style={
                styles.liveReminderText
              }
            >
              Keep the same vocal quality until the timer reaches the end.
            </Text>
          </View>

          <Text
            style={
              styles.timerText
            }
          >
            {(elapsedMs / 1000).toFixed(
              1,
            )}{' '}
            /{' '}
            {params.durationSec.toFixed(
              1,
            )}
            s
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

          <Pressable
            style={
              styles.stopButton
            }
            onPress={
              stopEarly
            }
            disabled={
              !isRecording
            }
          >
            <Ionicons
              name="stop-circle-outline"
              size={20}
              color={BROWN}
            />

            <Text
              style={
                styles.stopButtonText
              }
            >
              Finish Early
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  /*
   * ----------------------------------------------------------
   * PROCESSING
   * ----------------------------------------------------------
   */
  if (
    phase ===
    'processing'
  ) {
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
          Analyzing Your Tone
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Measuring spectral smoothness and amplitude stability across the whole take.
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

  /*
   * ----------------------------------------------------------
   * RESULTS
   * ----------------------------------------------------------
   */
  if (
    phase ===
      'results' &&
    result
  ) {
    return (
      <View
        style={styles.screen}
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
            Waveform Smoothness Result
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
                ? 'Your tone stayed sufficiently smooth through the continuous hold.'
                : 'Focus on holding one steady tone with less wavering and loudness variation.'}
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
              Tone Stability
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
                Spectral smoothness
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {Math.round(
                  centroidSmoothness,
                )}
                %
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
                Amplitude stability
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {Math.round(
                  amplitudeStability,
                )}
                %
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
                Required smoothness
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {formatNumber(
                  params.smoothnessThreshold,
                )}
                %
              </Text>
            </View>
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
              Recording
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
                Difficulty
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {currentTier}
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
                Continuous hold
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {formatNumber(
                  params.durationSec,
                )}
                s
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
                FFT frames analyzed
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {frameCount}
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
                Average spectral centroid
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {averageCentroid >
                0
                  ? `${formatNumber(
                      averageCentroid,
                      0,
                    )} Hz`
                  : '--'}
              </Text>
            </View>
          </View>

          <View
            style={
              styles.differenceCard
            }
          >
            <Ionicons
              name="pulse-outline"
              size={22}
              color={BROWN}
            />

            <View
              style={{
                flex: 1,
              }}
            >
              <Text
                style={
                  styles.differenceTitle
                }
              >
                What you just practiced
              </Text>

              <Text
                style={
                  styles.differenceText
                }
              >
                This drill evaluates continuous tone stability. It does not ask you to match or repeat a specific vowel.
              </Text>
            </View>
          </View>

          <Pressable
            style={
              styles.startButton
            }
            onPress={
              retry
            }
          >
            <Text
              style={
                styles.startButtonText
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

  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
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

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
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
    borderColor: '#F2DDE5',
  },

  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
    borderWidth: 1,
    borderColor: '#F2DDE5',
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
    fontSize: 21,
    color: BROWN,
    marginTop: 2,
  },

  keyMetricCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  keyMetricTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginBottom: 10,
  },

  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },

  metricText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginLeft: 8,
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

  recordingEyebrow: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 1,
    color: MUTED,
    textAlign: 'center',
  },

  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
    marginTop: 8,
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

  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    padding: 20,
    marginTop: 25,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 3,
  },

  liveFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },

  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 18,
  },

  liveStat: {
    alignItems: 'center',
  },

  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginTop: 2,
  },

  timerText: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    textAlign: 'center',
    marginTop: 18,
  },

  timerTrack: {
    width: '100%',
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 9,
  },

  timerFill: {
    height: '100%',
    backgroundColor: PINK,
  },

  stopButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },

  stopButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
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
    borderColor: '#F2DDE5',
  },

  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginBottom: 10,
  },

  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2DDE5',
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

  goalCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 18,
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },

  goalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
    textAlign: 'center',
  },

  goalText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    textAlign: 'center',
    marginTop: 5,
  },

  liveReminder: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
  },

  liveReminderText: {
    flex: 1,
    marginLeft: 8,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: BROWN,
  },

  differenceCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  differenceTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginBottom: 8,
  },

  differenceText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: MUTED,
  },
});