// src/screens/exercises/Tone/SteadyToneHoldingScreen.tsx

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
  STEADY_TONE_HOLDING_PARAMS,
  Tier,
} from '@/constants/exercises/tone';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  measureSteadyToneHolding,
  SteadyToneHoldingMeasurement,
} from '@/services/measurement/tone/steadyToneHolding';

import {
  scoreSteadyToneHolding,
  SteadyToneHoldingScoreResult,
} from '@/services/scoring/tone/steadyToneHolding';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

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
  tier = 'beginner',
}: Props) {
  const params =
    STEADY_TONE_HOLDING_PARAMS[tier];

  // ==========================================================
  // STATE
  // ==========================================================

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

    // Only stop the recorder if this screen
    // actually started a recording.
    if (wasRecording) {
      void stopRecordingRef.current?.();
    }

    recordingRef.current = false;
    stopRequestedRef.current = false;
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

        if (recordingTimerRef.current) {
          clearInterval(
            recordingTimerRef.current,
          );
          recordingTimerRef.current = null;
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
              tier,
            );

          if (
            !Number.isFinite(scored.score)
          ) {
            throw new Error(
              'The tone score could not be calculated.',
            );
          }

          if (!mountedRef.current) {
            return;
          }

          setMeasurement(measured);
          setResult(scored);

          await saveCompletedExercise(
            'tone',
            'steadyToneHolding',
            tier,
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
            setPhase('instructions');
          }
        } finally {
          processingRef.current = false;
          stopRequestedRef.current = false;
        }
      },
      [tier],
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

  // Keep the latest stop function available
  // to cleanup without creating dependency loops.
  useEffect(() => {
    stopRecordingRef.current =
      stopRecording;

    return () => {
      stopRecordingRef.current = null;
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
        processingRef.current
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

        stopRequestedRef.current = false;
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

              stopRecording().catch(
                (error) => {
                  console.error(
                    '❌ FAILED TO STOP STEADY TONE RECORDING:',
                    error,
                  );

                  recordingRef.current = false;
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
        stopRequestedRef.current = false;

        if (mountedRef.current) {
          setPhase('instructions');

          Alert.alert(
            'Microphone Error',
            'Unable to start the microphone. Please check your microphone permission and try again.',
          );
        }
      }
    }, [
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
        processingRef.current
      ) {
        return;
      }

      if (countdownTimerRef.current) {
        clearInterval(
          countdownTimerRef.current,
        );
        countdownTimerRef.current = null;
      }

      setErrorMessage(null);
      setLiveFrame(null);
      setMeasurement(null);
      setResult(null);

      elapsedRef.current = 0;
      setElapsedMs(0);

      recordingRef.current = false;
      stopRequestedRef.current = false;
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
    }, [beginRecording]);

  // ==========================================================
  // RETRY
  // ==========================================================

  const retry =
    useCallback(() => {
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

      recordingRef.current = false;
      stopRequestedRef.current = false;
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

      recordingRef.current = false;
      stopRequestedRef.current = true;

      stopRecordingRef.current?.();

      router.replace(
        '/dashboard/exercises',
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
    Number.isFinite(liveFrame.pitch) &&
    liveFrame.pitch > 0
      ? frequencyToNote(
          liveFrame.pitch,
        )
      : '--';

  const livePitchHz =
    liveFrame &&
    Number.isFinite(liveFrame.pitch) &&
    liveFrame.pitch > 0
      ? `${Math.round(
          liveFrame.pitch,
        )} Hz`
      : '--';

  const liveClarity =
    liveFrame &&
    Number.isFinite(liveFrame.clarity)
      ? `${Math.round(
          liveFrame.clarity * 100,
        )}%`
      : '--';

  const liveVolume =
    liveFrame &&
    Number.isFinite(liveFrame.volume)
      ? `${Math.round(
          liveFrame.volume,
        )} dB`
      : '--';

  // ==========================================================
  // INSTRUCTIONS
  // ==========================================================

  if (phase === 'instructions') {
    return (
      <View style={styles.screen}>
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
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            styles.content
          }
        >
          <View style={styles.iconCircle}>
            <Ionicons
              name="pulse-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.title}>
            Steady Tone Holding
          </Text>

          <Text style={styles.subtitle}>
            Tone
          </Text>

          <View
            style={styles.instructionCard}
          >
            <View
              style={styles.prepareCard}
            >
              <View
                style={styles.prepareHeader}
              >
                <Ionicons
                  name="mic-outline"
                  size={21}
                  color={BROWN}
                />

                <Text
                  style={styles.prepareTitle}
                >
                  Before You Begin
                </Text>
              </View>

              <View
                style={styles.prepareItem}
              >
                <Ionicons
                  name="volume-mute-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={styles.prepareText}
                >
                  Find a quiet area with
                  minimal background noise.
                </Text>
              </View>

              <View
                style={styles.prepareItem}
              >
                <Ionicons
                  name="body-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={styles.prepareText}
                >
                  Sit upright or stand with
                  relaxed shoulders and
                  comfortable posture.
                </Text>
              </View>

              <View
                style={styles.prepareItem}
              >
                <Ionicons
                  name="mic-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={styles.prepareText}
                >
                  Keep your voice directed
                  toward the microphone.
                </Text>
              </View>
            </View>

            <Text
              style={styles.cardTitle}
            >
              Instructions
            </Text>

            <Text
              style={styles.instruction}
            >
              Sustain one comfortable note
              for the full exercise duration.
            </Text>

            <Text
              style={styles.instruction}
            >
              Keep your tone quality smooth,
              your loudness steady, and your
              pitch as stable as possible.
            </Text>

            <Text
              style={styles.instruction}
            >
              Avoid intentionally changing
              the pitch, tone, or loudness
              while you hold the note.
            </Text>

            <View
              style={styles.targetBox}
            >
              <Ionicons
                name="pulse-outline"
                size={27}
                color={BROWN}
              />

              <View
                style={styles.targetInfo}
              >
                <Text
                  style={styles.targetLabel}
                >
                  GOAL
                </Text>

                <Text
                  style={styles.targetValue}
                >
                  Smooth + Steady
                </Text>

                <Text
                  style={styles.targetHelper}
                >
                  Hold the note for{' '}
                  {params.durationSec}
                  {' '}seconds.
                </Text>
              </View>
            </View>

            <Text
              style={styles.helperText}
            >
              TuneUp! combines tone
              smoothness, loudness stability,
              and pitch stability into one
              overall tone-quality score.
            </Text>
          </View>

          <View style={styles.tipCard}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text style={styles.tipText}>
              Think of keeping the voice
              balanced and relaxed rather than
              trying to make it artificially
              still.
            </Text>
          </View>

          <View style={styles.difficultyRow}>
            <Text
              style={styles.difficultyLabel}
            >
              Difficulty
            </Text>

            <Text
              style={styles.difficultyValue}
            >
              {tier}
            </Text>
          </View>

          <View style={styles.difficultyRow}>
            <Text
              style={styles.difficultyLabel}
            >
              Duration
            </Text>

            <Text
              style={styles.difficultyValue}
            >
              {params.durationSec}s
            </Text>
          </View>

          <View style={styles.difficultyRow}>
            <Text
              style={styles.difficultyLabel}
            >
              Required Tone Quality
            </Text>

            <Text
              style={styles.difficultyValue}
            >
              {params.qualityThreshold}%
            </Text>
          </View>

          <Pressable
            style={styles.startButton}
            onPress={startCountdown}
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

          {errorMessage && (
            <View style={styles.errorCard}>
              <Ionicons
                name="alert-circle-outline"
                size={21}
                color={BROWN}
              />

              <Text
                style={styles.errorText}
              >
                {errorMessage}
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  if (phase === 'countdown') {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.iconCircle}>
          <Ionicons
            name="pulse-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Get Ready
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Prepare to hold a smooth,
          steady tone.
        </Text>

        <Text
          style={styles.countdownText}
        >
          {countdown}
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          {params.durationSec} seconds
        </Text>
      </View>
    );
  }

  // ==========================================================
  // RECORDING
  // ==========================================================

  if (phase === 'recording') {
    return (
      <View style={styles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            styles.recordingContent
          }
        >
          <View
            style={styles.recordingIcon}
          >
            <Ionicons
              name="mic"
              size={34}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.recordingTitle}
          >
            Hold Your Tone
          </Text>

          <Text
            style={styles.recordingSubtitle}
          >
            Keep tone, loudness, and pitch
            steady.
          </Text>

          <View style={styles.targetCard}>
            <Text
              style={styles.targetLabel}
            >
              GOAL
            </Text>

            <Text
              style={styles.targetValueLarge}
            >
              SMOOTH + STEADY
            </Text>

            <Text
              style={styles.targetHelper}
            >
              One comfortable note for the
              entire recording.
            </Text>
          </View>

          <View
            style={styles.microphoneArea}
          >
            <View
              style={styles.outerMicCircle}
            >
              <View
                style={styles.innerMicCircle}
              >
                <Ionicons
                  name="mic"
                  size={52}
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

          <View style={styles.liveCard}>
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
              <View style={styles.liveStat}>
                <Text
                  style={styles.liveStatLabel}
                >
                  Clarity
                </Text>

                <Text
                  style={styles.liveStatValue}
                >
                  {liveClarity}
                </Text>
              </View>

              <View style={styles.liveStat}>
                <Text
                  style={styles.liveStatLabel}
                >
                  Volume
                </Text>

                <Text
                  style={styles.liveStatValue}
                >
                  {liveVolume}
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.timerText}>
            {(elapsedMs / 1000).toFixed(1)}
            {' / '}
            {formatNumber(
              params.durationSec,
            )}
            s
          </Text>

          <View style={styles.timerTrack}>
            <View
              style={[
                styles.timerFill,
                {
                  width: `${Math.round(
                    recordingProgress * 100,
                  )}%`,
                },
              ]}
            />
          </View>

          <View
            style={styles.recordingIndicator}
          >
            <Ionicons
              name={
                isRecording
                  ? 'radio'
                  : 'radio-outline'
              }
              size={15}
              color={BROWN}
            />

            <Text
              style={
                styles.recordingText
              }
            >
              {isRecording
                ? 'Listening to your voice...'
                : 'Starting microphone...'}
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ==========================================================
  // PROCESSING
  // ==========================================================

  if (phase === 'processing') {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.iconCircle}>
          <Ionicons
            name="pulse-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Analyzing Your Tone
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Measuring smoothness, loudness,
          pitch stability, and duration.
        </Text>

        <ActivityIndicator
          size="small"
          color={BROWN}
          style={
            styles.processingIndicator
          }
        />
      </View>
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
      <View style={styles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            styles.resultsContent
          }
        >
          <View
            style={styles.resultIcon}
          >
            <Ionicons
              name={
                result.passed
                  ? 'checkmark-circle-outline'
                  : 'refresh-outline'
              }
              size={40}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.resultTitle}
          >
            {result.passed
              ? 'Great Tone Control!'
              : 'Keep Practicing'}
          </Text>

          <Text
            style={styles.resultSubtitle}
          >
            Your steady-tone performance
          </Text>

          <View style={styles.scoreCard}>
            <Text
              style={styles.scoreLabel}
            >
              OVERALL TONE QUALITY
            </Text>

            <Text
              style={styles.scoreValue}
            >
              {result.score}%
            </Text>

            <Text
              style={styles.scoreHelper}
            >
              {result.passed
                ? 'You kept the tone stable across the exercise.'
                : 'Work on keeping your tone, loudness, and pitch more consistent.'}
            </Text>
          </View>

          <View style={styles.resultCard}>
            <Text
              style={styles.resultCardTitle}
            >
              Your Performance
            </Text>

            <View style={styles.resultRow}>
              <Text
                style={styles.resultRowLabel}
              >
                Tone smoothness
              </Text>

              <Text
                style={styles.resultRowValue}
              >
                {formatNumber(
                  measurement.smoothnessPct,
                  0,
                )}
                %
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text
                style={styles.resultRowLabel}
              >
                Loudness stability
              </Text>

              <Text
                style={styles.resultRowValue}
              >
                {formatNumber(
                  measurement.amplitudeStabilityPct,
                  0,
                )}
                %
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text
                style={styles.resultRowLabel}
              >
                Pitch stability
              </Text>

              <Text
                style={styles.resultRowValue}
              >
                {formatNumber(
                  measurement.pitchStabilityPct,
                  0,
                )}
                %
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text
                style={styles.resultRowLabel}
              >
                Duration
              </Text>

              <Text
                style={styles.resultRowValue}
              >
                {formatNumber(
                  measurement.durationSec,
                )}
                s
              </Text>
            </View>
          </View>

          <View style={styles.tipCard}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text style={styles.tipText}>
              {result.passed
                ? 'Nice work! Keep practicing relaxed, balanced sustained notes to maintain consistent tone quality.'
                : 'Try using steady breath support and a relaxed throat. Focus on keeping the same vocal quality, loudness, and pitch.'}
            </Text>
          </View>

          <Pressable
            style={styles.startButton}
            onPress={retry}
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
            style={styles.doneButton}
            onPress={goBack}
          >
            <Text
              style={styles.doneButtonText}
            >
              Done
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return null;
}

// ============================================================
// STYLES
// ============================================================

const styles =
  StyleSheet.create({
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
      paddingTop: 82,
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
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: '#F2DDE5',
    },

    prepareCard: {
      width: '100%',
      backgroundColor: PINK,
      borderRadius: 18,
      padding: 16,
      marginBottom: 18,
      borderWidth: 1,
      borderColor: '#EFC8D3',
    },

    prepareHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
    },

    prepareTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 17,
      color: BROWN,
      marginLeft: 9,
    },

    prepareItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 10,
    },

    prepareText: {
      flex: 1,
      fontFamily: 'FredokaRegular',
      fontSize: 12,
      lineHeight: 18,
      color: BROWN,
      marginLeft: 9,
    },

    cardTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 19,
      color: BROWN,
      marginBottom: 11,
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
      alignItems: 'center',
      width: '100%',
      backgroundColor: PINK,
      borderRadius: 16,
      padding: 14,
      marginTop: 7,
      marginBottom: 12,
    },

    targetInfo: {
      flex: 1,
      marginLeft: 11,
    },

    targetLabel: {
      fontFamily: 'FredokaRegular',
      fontSize: 9,
      letterSpacing: 0.8,
      color: MUTED,
    },

    targetValue: {
      fontFamily: 'FredokaBold',
      fontSize: 18,
      color: BROWN,
      marginTop: 1,
    },

    targetHelper: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,
      color: MUTED,
      marginTop: 2,
    },

    helperText: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,
      lineHeight: 17,
      color: MUTED,
      textAlign: 'center',
    },

    tipCard: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: PINK,
      borderRadius: 15,
      padding: 14,
      marginTop: 18,
    },

    tipText: {
      flex: 1,
      fontFamily: 'FredokaRegular',
      fontSize: 11,
      lineHeight: 17,
      color: BROWN,
      marginLeft: 9,
    },

    difficultyRow: {
      width: '100%',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 18,
      marginBottom: -9,
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
    },

    startButton: {
      width: '100%',
      height: 54,
      borderRadius: 27,
      backgroundColor: BROWN,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 27,
    },

    startButtonText: {
      fontFamily: 'FredokaBold',
      fontSize: 14,
      color: WHITE,
      marginRight: 9,
    },

    doneButton: {
      width: '100%',
      height: 50,
      borderRadius: 25,
      backgroundColor: LIGHT_GRAY,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 10,
    },

    doneButtonText: {
      fontFamily: 'FredokaBold',
      fontSize: 14,
      color: BROWN,
    },

    errorCard: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: LIGHT_PINK,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: '#F2DDE5',
      padding: 13,
      marginTop: 14,
    },

    errorText: {
      flex: 1,
      fontFamily: 'FredokaRegular',
      fontSize: 11,
      lineHeight: 17,
      color: BROWN,
      marginLeft: 9,
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
      marginTop: 7,
      maxWidth: 280,
    },

    countdownText: {
      fontFamily: 'FredokaBold',
      fontSize: 72,
      color: BROWN,
      marginTop: 18,
      marginBottom: 3,
    },

    recordingIcon: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: PINK,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 18,
    },

    recordingTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 25,
      color: BROWN,
      textAlign: 'center',
    },

    recordingSubtitle: {
      fontFamily: 'FredokaRegular',
      fontSize: 13,
      lineHeight: 20,
      color: MUTED,
      textAlign: 'center',
      marginTop: 5,
      marginBottom: 20,
    },

    targetCard: {
      width: '100%',
      backgroundColor: LIGHT_PINK,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: '#F2DDE5',
      padding: 18,
      alignItems: 'center',
    },

    targetValueLarge: {
      fontFamily: 'FredokaBold',
      fontSize: 23,
      color: BROWN,
      marginTop: 4,
    },

    microphoneArea: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 24,
    },

    outerMicCircle: {
      width: 150,
      height: 150,
      borderRadius: 75,
      borderWidth: 8,
      borderColor: PINK,
      alignItems: 'center',
      justifyContent: 'center',
    },

    innerMicCircle: {
      width: 118,
      height: 118,
      borderRadius: 59,
      backgroundColor: PINK,
      alignItems: 'center',
      justifyContent: 'center',
    },

    recordingBadge: {
      marginTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: LIGHT_PINK,
      borderRadius: 20,
      paddingHorizontal: 13,
      paddingVertical: 7,
    },

    recordingDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: BROWN,
      marginRight: 7,
    },

    recordingBadgeText: {
      fontFamily: 'FredokaBold',
      fontSize: 10,
      letterSpacing: 0.6,
      color: BROWN,
    },

    liveCard: {
      width: '100%',
      backgroundColor: LIGHT_PINK,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: '#F2DDE5',
      padding: 20,
      marginTop: 18,
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
      fontFamily: 'FredokaRegular',
      fontSize: 11,
      color: MUTED,
      textAlign: 'center',
      marginTop: 18,
      marginBottom: 7,
    },

    timerTrack: {
      width: '100%',
      height: 7,
      backgroundColor: LIGHT_GRAY,
      borderRadius: 4,
      overflow: 'hidden',
    },

    timerFill: {
      height: '100%',
      backgroundColor: PINK,
      borderRadius: 4,
    },

    recordingIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 16,
    },

    recordingText: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,
      color: MUTED,
      marginLeft: 7,
    },

    processingIndicator: {
      marginTop: 28,
    },

    resultIcon: {
      width: 82,
      height: 82,
      borderRadius: 41,
      backgroundColor: PINK,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 17,
    },

    resultTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 28,
      color: BROWN,
      textAlign: 'center',
    },

    resultSubtitle: {
      fontFamily: 'FredokaRegular',
      fontSize: 12,
      color: MUTED,
      marginTop: 4,
      marginBottom: 24,
      textAlign: 'center',
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
      fontSize: 10,
      color: MUTED,
      letterSpacing: 0.7,
    },

    scoreValue: {
      fontFamily: 'FredokaBold',
      fontSize: 50,
      color: BROWN,
      marginTop: 3,
    },

    scoreHelper: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,
      lineHeight: 17,
      color: BROWN,
      textAlign: 'center',
      marginTop: 5,
    },

    resultCard: {
      width: '100%',
      backgroundColor: LIGHT_PINK,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: '#F2DDE5',
      padding: 20,
      marginTop: 14,
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
  });
