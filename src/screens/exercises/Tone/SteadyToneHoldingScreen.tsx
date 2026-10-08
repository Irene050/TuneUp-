// src/screens/exercises/Tone/SteadyToneHoldingScreen.tsx

import type { LiveAudioFrame } from '@/hooks/useAudioRecorder';

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
  View
} from 'react-native';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';

import {
  STEADY_TONE_HOLDING_PARAMS,
  type SteadyToneHoldingParams,
  type Tier,
} from '@/constants/exercises/tone';

import {
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  measureSteadyToneHolding,
  type SteadyToneHoldingMeasurement,
} from '@/services/measurement/tone/steadyToneHolding';

import {
  scoreSteadyToneHolding,
  type SteadyToneHoldingScoreResult,
} from '@/services/scoring/tone/steadyToneHolding';

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
  generateSteadyToneHoldingParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import { auth } from '@/services/firebase/config';

import {
  samplesToFFTFrames,
} from '@/utils/dsp/fft';

import {
  frequencyToNote,
} from '@/utils/dsp/pitch';

// ============================================================
// COLORS
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

// ============================================================
// CONFIGURATION
// ============================================================

const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;
const COUNTDOWN_SECONDS = 3;

// ============================================================
// TYPES
// ============================================================

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

// ============================================================
// HELPERS
// ============================================================

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

// ============================================================
// SCREEN
// ============================================================

export default function SteadyToneHoldingScreen({
  tier,
}: Props) {
  const fallbackTier: Tier =
    tier ?? 'beginner';

  // ==========================================================
  // STATE
  // ==========================================================

  const [currentTier, setCurrentTier] =
    useState<Tier>(fallbackTier);

  const [params, setParams] =
    useState<SteadyToneHoldingParams>(
      STEADY_TONE_HOLDING_PARAMS[
        fallbackTier
      ],
    );

  const [loadingParams, setLoadingParams] =
    useState(true);

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [result, setResult] =
    useState<SteadyToneHoldingScoreResult | null>(
      null,
    );

  const [measurement, setMeasurement] =
    useState<SteadyToneHoldingMeasurement | null>(
      null,
    );

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  // ==========================================================
  // ADS PARAMETER LOADING
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    const loadParams = async () => {
      try {
        setLoadingParams(true);

        const user = auth.currentUser;

        if (!user) {
          if (!cancelled) {
            setCurrentTier(
              fallbackTier,
            );

            setParams(
              STEADY_TONE_HOLDING_PARAMS[
                fallbackTier
              ],
            );
          }

          return;
        }

        const componentProgress =
          await fetchComponentProgress(
            user.uid,
            'tone',
          );

        const resolvedTier: Tier =
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
              record =>
                record.tier ===
                  resolvedTier &&
                record.templateId ===
                  'steadyToneHolding',
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
              record =>
                record.scorePct,
            );

        /*
         * Assessment is only used as the initial
         * reference when current-tier exercise
         * history does not exist.
         */
        if (
          recentScores.length === 0
        ) {
          const latestAssessment =
            await getLatestAssessment();

          const assessmentToneScore =
            latestAssessment?.scores.find(
              score =>
                score.componentId ===
                'tone',
            )?.scorePct;

          if (
            assessmentToneScore !==
              undefined &&
            Number.isFinite(
              assessmentToneScore,
            )
          ) {
            recentScores = [
              assessmentToneScore,
            ];
          }
        }

        const generatedParams =
          generateSteadyToneHoldingParams({
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
          '❌ FAILED TO LOAD STEADY TONE HOLDING PARAMETERS:',
          error,
        );

        if (!cancelled) {
          setCurrentTier(
            fallbackTier,
          );

          setParams(
            STEADY_TONE_HOLDING_PARAMS[
              fallbackTier
            ],
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingParams(false);
        }
      }
    };

    void loadParams();

    return () => {
      cancelled = true;
    };
  }, [
    tier,
    fallbackTier,
  ]);

  // ==========================================================
  // REFS
  // ==========================================================

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
    useRef<
      (() => Promise<void>) | null
    >(null);

  // ==========================================================
  // CLEANUP
  // ==========================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      const wasRecording =
        recordingRef.current;

      mountedRef.current = false;

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

      if (wasRecording) {
        void stopRecordingRef.current?.();
      }

      recordingRef.current = false;
      stopRequestedRef.current =
        false;
    };
  }, []);

  // ==========================================================
  // LIVE AUDIO
  // ==========================================================

  const handleLiveFrame =
    useCallback(
      (frame: LiveAudioFrame) => {
        if (!mountedRef.current) {
          return;
        }

        setLiveFrame(frame);
      },
      [],
    );

  // ==========================================================
  // RECORDING STOP / ANALYSIS
  // ==========================================================

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

        if (
          recordingTimerRef.current
        ) {
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

          if (
            !Number.isFinite(sampleRate) ||
            sampleRate <= 0
          ) {
            throw new Error(
              'Invalid audio sample rate.',
            );
          }

          const fftFrames =
            samplesToFFTFrames(
              samples,
              FFT_SIZE,
              FFT_HOP_SIZE,
            );

          if (fftFrames.length === 0) {
            throw new Error(
              'No FFT frames could be generated.',
            );
          }

          const measured =
            measureSteadyToneHolding(
              samples,
              fftFrames,
              sampleRate,
              FFT_SIZE,
            );

          const scored =
            scoreSteadyToneHolding(
              measured,
              params,
            );

          if (
            !Number.isFinite(
              scored.score,
            )
          ) {
            throw new Error(
              'The tone score could not be calculated.',
            );
          }

          if (!mountedRef.current) {
            return;
          }

          setMeasurement(
            measured,
          );

          setResult(
            scored,
          );

          await saveCompletedExercise(
            'tone',
            'steadyToneHolding',
            currentTier,
            scored.score,
          );

          if (!mountedRef.current) {
            return;
          }

          setPhase('results');
        } catch (error) {
          console.error(
            '❌ STEADY TONE HOLDING PROCESSING ERROR:',
            error,
          );

          if (mountedRef.current) {
            setErrorMessage(
              'We could not analyze your recording. Please try again.',
            );

            setPhase(
              'instructions',
            );
          }
        } finally {
          processingRef.current = false;
          stopRequestedRef.current =
            false;
        }
      },
      [
        currentTier,
        params,
      ],
    );

  // ==========================================================
  // AUDIO RECORDER
  // ==========================================================

  const {
    startRecording,
    stopRecording,
    isRecording,
  } =
    useAudioRecorder({
      onFrame: handleLiveFrame,
      onStop: handleRecordingStop,
    });

  useEffect(() => {
    stopRecordingRef.current =
      stopRecording;

    return () => {
      stopRecordingRef.current =
        null;
    };
  }, [stopRecording]);

  // ==========================================================
  // BEGIN RECORDING
  // ==========================================================

  const beginRecording =
    useCallback(async () => {
      if (
        !mountedRef.current ||
        recordingRef.current ||
        processingRef.current ||
        loadingParams
      ) {
        return;
      }

      try {
        setErrorMessage(null);
        setLiveFrame(null);
        setMeasurement(null);
        setResult(null);

        elapsedRef.current = 0;
        setElapsedMs(0);

        stopRequestedRef.current =
          false;

        processingRef.current = false;

        setPhase('recording');

        await startRecording();

        if (!mountedRef.current) {
          return;
        }

        recordingRef.current = true;

        const durationMs =
          params.durationSec * 1000;

        recordingTimerRef.current =
          setInterval(() => {
            if (
              !mountedRef.current ||
              !recordingRef.current ||
              stopRequestedRef.current
            ) {
              return;
            }

            elapsedRef.current += 100;

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

              void stopRecording().catch(
                error => {
                  console.error(
                    '❌ FAILED TO STOP STEADY TONE RECORDING:',
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
          }, 100);
      } catch (error) {
        console.error(
          '❌ FAILED TO START STEADY TONE RECORDING:',
          error,
        );

        recordingRef.current = false;
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
    }, [
      loadingParams,
      params.durationSec,
      startRecording,
      stopRecording,
    ]);

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  const startCountdown =
    useCallback(() => {
      if (
        recordingRef.current ||
        processingRef.current ||
        loadingParams
      ) {
        return;
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

      setErrorMessage(null);
      setLiveFrame(null);
      setMeasurement(null);
      setResult(null);

      elapsedRef.current = 0;
      setElapsedMs(0);

      recordingRef.current = false;
      stopRequestedRef.current =
        false;
      processingRef.current = false;

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setPhase('countdown');

      let value =
        COUNTDOWN_SECONDS;

      countdownTimerRef.current =
        setInterval(() => {
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
        }, 1000);
    }, [
      beginRecording,
      loadingParams,
    ]);

  // ==========================================================
  // RETRY
  // ==========================================================

  const retry =
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

      recordingRef.current = false;
      stopRequestedRef.current =
        false;
      processingRef.current = false;

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setElapsedMs(0);
      elapsedRef.current = 0;

      setLiveFrame(null);
      setMeasurement(null);
      setResult(null);
      setErrorMessage(null);

      setPhase('instructions');
    }, []);

  // ==========================================================
  // GO BACK
  // ==========================================================

  const goBack =
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

      recordingRef.current = false;
      stopRequestedRef.current = true;

      void stopRecordingRef.current?.();

      router.replace(
        '/dashboard?tab=exercises',
      );
    }, []);

  // ==========================================================
  // LIVE VALUES
  // ==========================================================

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

  const livePitchNote =
    liveFrame &&
    Number.isFinite(
      liveFrame.pitch,
    ) &&
    liveFrame.pitch > 0
      ? frequencyToNote(
          liveFrame.pitch,
        )
      : '--';

  const livePitchHz =
    liveFrame &&
    Number.isFinite(
      liveFrame.pitch,
    ) &&
    liveFrame.pitch > 0
      ? `${Math.round(
          liveFrame.pitch,
        )} Hz`
      : '--';

  const liveClarity =
    liveFrame &&
    Number.isFinite(
      liveFrame.clarity,
    )
      ? `${Math.round(
          liveFrame.clarity * 100,
        )}%`
      : '--';

  const liveVolume =
    liveFrame &&
    Number.isFinite(
      liveFrame.volume,
    )
      ? `${Math.round(
          liveFrame.volume,
        )} dB`
      : '--';

  // ==========================================================
  // INSTRUCTIONS
  // ==========================================================

  if (phase === 'instructions') {
    return (
      <ExerciseScreen
        title="Steady Tone Holding"
        category="Tone"
        icon="pulse-outline"
        instructions="Sustain one comfortable note for the full exercise duration. Keep your tone quality smooth, your loudness steady, and your pitch as stable as possible."
        preparationSteps={[
          {
            icon: 'volume-mute-outline',
            text: 'Find a quiet area with minimal background noise.',
          },
          {
            icon: 'body-outline',
            text: 'Sit upright or stand with relaxed shoulders and comfortable posture.',
          },
          {
            icon: 'mic-outline',
            text: 'Keep your voice directed toward the microphone.',
          },
        ]}
        summary={[
          {
            label: 'DURATION',
            value: `${params.durationSec}s`,
            hint: 'sustained tone',
          },
          {
            label: 'REPETITIONS',
            value: '1',
            hint: 'attempt',
          },
          {
            label: 'QUALITY',
            value: `${params.qualityThreshold}%`,
            hint: 'required',
          },
        ]}
        tip="Think of keeping the voice balanced and relaxed rather than trying to make it artificially still."
        tier={currentTier}
        onBack={goBack}
        onStart={startCountdown}
        error={errorMessage}
        startDisabled={
          loadingParams
        }
      />
    );
  }

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="pulse-outline"
        title="Steady Tone Holding"
        countdown={countdown}
        promptTitle="Get Ready"
        prompt="Prepare to sustain one comfortable note."
        onBack={goBack}
      />
    );
  }

  // ==========================================================
  // RECORDING
  // ==========================================================

  if (phase === 'recording') {
    return (
      <ExerciseListeningScreen
        icon="mic"
        title="Steady Tone Holding"
        elapsed={
          elapsedMs / 1000
        }
        targetDuration={
          params.durationSec
        }
        promptTitle="Hold Your Tone"
        prompt="Keep your tone, loudness, and pitch steady for the full duration."
        progress={
          recordingProgress * 100
        }
        liveContent={
          <View
            style={styles.liveContent}
          >
            <Text
              style={styles.liveLabel}
            >
              LIVE AUDIO
            </Text>

            <Text
              style={styles.liveNote}
            >
              {livePitchNote}
            </Text>

            <Text
              style={styles.liveFrequency}
            >
              {livePitchHz}
            </Text>

            <View
              style={styles.liveStats}
            >
              <View
                style={styles.liveStat}
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
                  {liveClarity}
                </Text>
              </View>

              <View
                style={styles.liveStat}
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
                  {liveVolume}
                </Text>
              </View>
            </View>

            <View
              style={
                styles.recordingStatus
              }
            >
              <View
                style={
                  styles.recordingDot
                }
              />

              <Text
                style={
                  styles.recordingStatusText
                }
              >
                {isRecording
                  ? 'Listening to your voice...'
                  : 'Starting microphone...'}
              </Text>
            </View>
          </View>
        }
        onBack={goBack}
      />
    );
  }

  // ==========================================================
  // PROCESSING
  // ==========================================================

  if (phase === 'processing') {
    return (
      <ExerciseProcessingScreen
        icon="pulse-outline"
        title="Analyzing Your Tone"
        message="Measuring tone smoothness, loudness stability, pitch stability, and duration."
        onBack={goBack}
      />
    );
  }

  // ==========================================================
  // RESULTS
  // ==========================================================

  if (
    phase === 'results' &&
    result &&
    measurement
  ) {
    return (
      <ExerciseResultsScreen
        title={
          result.passed
            ? 'Great Tone Control!'
            : 'Keep Practicing'
        }
        subtitle="Your steady-tone performance"
        score={result.score}
        resultIcon={
          result.passed
            ? 'checkmark-circle-outline'
            : 'refresh-outline'
        }
        scoreMessage={
          result.passed
            ? 'You kept the tone stable throughout the exercise.'
            : 'Work on keeping your tone, loudness, and pitch more consistent.'
        }
        onRetry={retry}
        onExit={goBack}
        onBack={goBack}
      >
        <View
          style={styles.resultCard}
        >
          <Text
            style={
              styles.resultCardTitle
            }
          >
            Your Performance
          </Text>

          <View
            style={styles.resultRow}
          >
            <Text
              style={
                styles.resultRowLabel
              }
            >
              Tone smoothness
            </Text>

            <Text
              style={
                styles.resultRowValue
              }
            >
              {formatNumber(
                measurement.smoothnessPct,
                0,
              )}
              %
            </Text>
          </View>

          <View
            style={styles.resultRow}
          >
            <Text
              style={
                styles.resultRowLabel
              }
            >
              Loudness stability
            </Text>

            <Text
              style={
                styles.resultRowValue
              }
            >
              {formatNumber(
                measurement.amplitudeStabilityPct,
                0,
              )}
              %
            </Text>
          </View>

          <View
            style={styles.resultRow}
          >
            <Text
              style={
                styles.resultRowLabel
              }
            >
              Pitch stability
            </Text>

            <Text
              style={
                styles.resultRowValue
              }
            >
              {formatNumber(
                measurement.pitchStabilityPct,
                0,
              )}
              %
            </Text>
          </View>

          <View
            style={styles.resultRow}
          >
            <Text
              style={
                styles.resultRowLabel
              }
            >
              Duration
            </Text>

            <Text
              style={
                styles.resultRowValue
              }
            >
              {formatNumber(
                measurement.durationSec,
              )}
              s
            </Text>
          </View>
        </View>

        <View
          style={styles.resultTip}
        >
          <Text
            style={styles.resultTipText}
          >
            {result.passed
              ? 'Nice work! Keep practicing relaxed, balanced sustained notes to maintain consistent tone quality.'
              : 'Try using steady breath support and a relaxed throat. Focus on keeping the same vocal quality, loudness, and pitch.'}
          </Text>
        </View>
      </ExerciseResultsScreen>
    );
  }

  return null;
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  liveContent: {
    width: '100%',
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.7,
  },

  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 40,
    color: BROWN,
    marginTop: 4,
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
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
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

  recordingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
  },

  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BROWN,
    marginRight: 7,
  },

  recordingStatusText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  resultCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
  },

  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 10,
  },

  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },

  resultRowLabel: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    marginLeft: 12,
  },

  resultTip: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  resultTipText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
  },
});