// src/screens/exercises/Tone/ToneConsistencyExerciseScreen.tsx

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
  Tier,
  TONE_CONSISTENCY_PARAMS,
} from '@/constants/exercises/tone';
import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import {
  measureToneConsistency,
} from '@/services/measurement/tone/toneConsistencyExercise';
import {
  ToneConsistencyScoreResult,
  scoreToneConsistencyExercise,
} from '@/services/scoring/tone/toneConsistencyExercise';
import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';
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
const REST_MS = 1200;

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

interface RepPreview {
  durationSec: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number, decimals = 1) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

export default function ToneConsistencyExerciseScreen({
  tier = 'beginner',
}: Props) {
  const params = TONE_CONSISTENCY_PARAMS[tier];
  const repetitions = Math.max(1, params.repetitions);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [currentRepetition, setCurrentRepetition] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveFrame, setLiveFrame] = useState<LiveAudioFrame | null>(null);
  const [repPreviews, setRepPreviews] = useState<RepPreview[]>([]);
  const [finalResult, setFinalResult] =
    useState<ToneConsistencyScoreResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const processingRef = useRef(false);
  const elapsedRef = useRef(0);
  const repetitionRef = useRef(1);
  const repetitionSamplesRef = useRef<Float32Array[]>([]);
  const repetitionFFTFramesRef = useRef<Float32Array[][]>([]);
  const repPreviewsRef = useRef<RepPreview[]>([]);
  const startRepCountdownRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (restTimerRef.current) {
        clearTimeout(restTimerRef.current);
      }

      recordingRef.current = false;
      stopRequestedRef.current = false;
    };
  }, []);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (mountedRef.current) {
      setLiveFrame(frame);
    }
  }, []);

  const resetExercise = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (restTimerRef.current) {
      clearTimeout(restTimerRef.current);
      restTimerRef.current = null;
    }

    repetitionRef.current = 1;
    recordingRef.current = false;
    stopRequestedRef.current = false;
    processingRef.current = false;
    elapsedRef.current = 0;
    repetitionSamplesRef.current = [];
    repetitionFFTFramesRef.current = [];
    repPreviewsRef.current = [];

    setCurrentRepetition(1);
    setElapsedMs(0);
    setLiveFrame(null);
    setRepPreviews([]);
    setFinalResult(null);
    setErrorMessage(null);
  }, []);

  const { startRecording, stopRecording, isRecording } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: async (samples, sampleRate) => {
      if (!mountedRef.current || processingRef.current) {
        return;
      }

      recordingRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      try {
        if (!samples.length || sampleRate <= 0) {
          throw new Error('No usable audio was recorded.');
        }

        const fftFrames = samplesToFFTFrames(
          samples,
          FFT_SIZE,
          FFT_HOP_SIZE,
        );

        if (!fftFrames.length) {
          throw new Error('No FFT frames could be generated.');
        }

        repetitionSamplesRef.current.push(samples);
        repetitionFFTFramesRef.current.push(fftFrames);

        const preview: RepPreview = {
          durationSec: samples.length / sampleRate,
        };
        const nextPreviews = [...repPreviewsRef.current, preview];
        repPreviewsRef.current = nextPreviews;

        if (mountedRef.current) {
          setRepPreviews(nextPreviews);
          setLiveFrame(null);
        }

        if (nextPreviews.length < repetitions) {
          const nextRep = nextPreviews.length + 1;
          repetitionRef.current = nextRep;
          elapsedRef.current = 0;

          if (mountedRef.current) {
            setCurrentRepetition(nextRep);
            setElapsedMs(0);
            setPhase('rest');
          }

          restTimerRef.current = setTimeout(() => {
            if (!mountedRef.current) {
              return;
            }

            startRepCountdownRef.current?.();
          }, REST_MS);

          return;
        }

        processingRef.current = true;

        if (mountedRef.current) {
          setPhase('processing');
        }

        const measurement = measureToneConsistency(
          repetitionSamplesRef.current,
          repetitionFFTFramesRef.current,
          sampleRate,
          FFT_SIZE,
        );

        const scored = scoreToneConsistencyExercise(measurement, tier);
        const finalScored: ToneConsistencyScoreResult = {
          score: clamp(scored.score, 0, 100),
          passed: scored.passed,
        };

        setFinalResult(finalScored);

        await saveCompletedExercise(
          'tone',
          'toneConsistencyExercise',
          tier,
          finalScored.score,
        );

        if (mountedRef.current) {
          setPhase('results');
        }
      } catch (error) {
        console.error('❌ TONE CONSISTENCY PROCESSING ERROR:', error);

        if (mountedRef.current) {
          setErrorMessage(
            'We could not analyze the recordings. Please try again.',
          );
          setPhase('instructions');
        }
      } finally {
        stopRequestedRef.current = false;

        if (repPreviewsRef.current.length >= repetitions) {
          processingRef.current = false;
        }
      }
    },
  });

  const beginRecording = useCallback(async () => {
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
      elapsedRef.current = 0;
      setElapsedMs(0);
      stopRequestedRef.current = false;
      setPhase('recording');

      await startRecording();

      if (!mountedRef.current) {
        return;
      }

      recordingRef.current = true;

      const durationMs = params.intervalSec * 1000;

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          !recordingRef.current ||
          stopRequestedRef.current
        ) {
          return;
        }

        elapsedRef.current += 100;
        setElapsedMs(elapsedRef.current);

        if (elapsedRef.current >= durationMs) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }

          stopRequestedRef.current = true;

          stopRecording().catch((error) => {
            console.error(
              '❌ FAILED TO STOP TONE CONSISTENCY RECORDING:',
              error,
            );
            recordingRef.current = false;
            stopRequestedRef.current = false;

            if (mountedRef.current) {
              setErrorMessage(
                'We could not finish the recording. Please try again.',
              );
              setPhase('instructions');
            }
          });
        }
      }, 100);
    } catch (error) {
      console.error('❌ FAILED TO START TONE CONSISTENCY RECORDING:', error);
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
  }, [params.intervalSec, startRecording, stopRecording]);

  const startRepCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      processingRef.current ||
      recordingRef.current
    ) {
      return;
    }

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }

    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');

    let value = COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      value -= 1;

      if (value <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }

        void beginRecording();
        return;
      }

      if (mountedRef.current) {
        setCountdown(value);
      }
    }, 1000);
  }, [beginRecording]);

  startRepCountdownRef.current = startRepCountdown;

  const startExercise = useCallback(() => {
    resetExercise();
    setPhase('countdown');
    startRepCountdown();
  }, [resetExercise, startRepCountdown]);

  const stopEarly = useCallback(() => {
    if (!recordingRef.current || stopRequestedRef.current) {
      return;
    }

    stopRequestedRef.current = true;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    stopRecording().catch((error) => {
      console.error(
        '❌ FAILED TO STOP TONE CONSISTENCY RECORDING EARLY:',
        error,
      );
      stopRequestedRef.current = false;
    });
  }, [stopRecording]);

  const goBack = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    if (restTimerRef.current) {
      clearTimeout(restTimerRef.current);
    }

    router.replace('/dashboard/exercises');
  }, []);

  const retry = useCallback(() => {
    resetExercise();
    setPhase('instructions');
  }, [resetExercise]);

  const recordingProgress = clamp(
    elapsedMs / 1000 / Math.max(params.intervalSec, 0.1),
    0,
    1,
  );

  const livePitchNote =
    liveFrame && liveFrame.pitch > 0
      ? frequencyToNote(liveFrame.pitch)
      : '--';

  if (phase === 'instructions') {
    return (
      <View style={styles.screen}>
        <Pressable style={styles.backButton} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={BROWN} />
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.iconCircle}>
            <Ionicons name="repeat-outline" size={34} color={BROWN} />
          </View>

          <Text style={styles.title}>Tone Consistency</Text>
          <Text style={styles.subtitle}>Tone</Text>

          <View style={styles.instructionCard}>
            <View style={styles.prepareCard}>
              <View style={styles.prepareHeader}>
                <Ionicons name="mic-outline" size={21} color={BROWN} />
                <Text style={styles.prepareTitle}>Before You Begin</Text>
              </View>

              <View style={styles.prepareItem}>
                <Ionicons
                  name="volume-mute-outline"
                  size={17}
                  color={BROWN}
                />
                <Text style={styles.prepareText}>
                  Find a quiet place with minimal background noise.
                </Text>
              </View>

              <View style={styles.prepareItem}>
                <Ionicons name="body-outline" size={17} color={BROWN} />
                <Text style={styles.prepareText}>
                  Keep your posture relaxed and keep the microphone a comfortable distance away.
                </Text>
              </View>

              <View style={styles.prepareItem}>
                <Ionicons name="repeat-outline" size={17} color={BROWN} />
                <Text style={styles.prepareText}>
                  You will repeat the same note and tone several times so TuneUp! can compare them.
                </Text>
              </View>
            </View>

            <Text style={styles.cardTitle}>How It Works</Text>
            <Text style={styles.instruction}>
              Sing one comfortable note using the same vowel for every repetition.
            </Text>
            <Text style={styles.instruction}>
              Keep the tone quality and loudness as similar as you can from one repetition to the next.
            </Text>
            <Text style={styles.instruction}>
              Rest briefly between repetitions and repeat the same sound each time.
            </Text>

            <View style={styles.targetBox}>
              <Ionicons name="musical-note-outline" size={28} color={BROWN} />
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>TARGET</Text>
                <Text style={styles.targetValue}>Same note &amp; same tone</Text>
              </View>
            </View>
          </View>

          <View style={styles.keyMetricCard}>
            <Text style={styles.keyMetricTitle}>What TuneUp! checks</Text>

            <View style={styles.metricRow}>
              <Ionicons name="radio-outline" size={19} color={BROWN} />
              <Text style={styles.metricText}>
                Average spectral brightness of each repetition
              </Text>
            </View>

            <View style={styles.metricRow}>
              <Ionicons name="volume-medium-outline" size={19} color={BROWN} />
              <Text style={styles.metricText}>
                Average loudness of each repetition
              </Text>
            </View>

            <View style={styles.metricRow}>
              <Ionicons name="repeat-outline" size={19} color={BROWN} />
              <Text style={styles.metricText}>
                Similarity across all repetitions
              </Text>
            </View>
          </View>

          <View style={styles.difficultyRow}>
            <Text style={styles.difficultyLabel}>Difficulty</Text>
            <Text style={styles.difficultyValue}>{tier}</Text>
          </View>

          <View style={styles.difficultyRow}>
            <Text style={styles.difficultyLabel}>Repetitions</Text>
            <Text style={styles.difficultyValue}>{repetitions}</Text>
          </View>

          <View style={styles.difficultyRow}>
            <Text style={styles.difficultyLabel}>Hold interval</Text>
            <Text style={styles.difficultyValue}>{params.intervalSec}s</Text>
          </View>

          <View style={styles.difficultyRow}>
            <Text style={styles.difficultyLabel}>Required consistency</Text>
            <Text style={styles.difficultyValue}>
              {params.consistencyThreshold}%
            </Text>
          </View>

          {errorMessage && (
            <View style={styles.errorCard}>
              <Ionicons
                name="alert-circle-outline"
                size={21}
                color={BROWN}
              />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <Pressable style={styles.startButton} onPress={startExercise}>
            <Text style={styles.startButtonText}>Start Exercise</Text>
            <Ionicons name="arrow-forward" size={18} color={WHITE} />
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'countdown') {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.iconCircle}>
          <Ionicons name="repeat-outline" size={34} color={BROWN} />
        </View>
        <Text style={styles.phaseTitle}>Get Ready</Text>
        <Text style={styles.countdownText}>{countdown}</Text>
        <Text style={styles.phaseSubtitle}>
          Repetition {currentRepetition} of {repetitions}
        </Text>
        <Text style={styles.largeTarget}>Same tone</Text>
        <Text style={styles.phaseSubtitle}>
          Hold for {params.intervalSec} seconds
        </Text>
      </View>
    );
  }

  if (phase === 'rest') {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.iconCircle}>
          <Ionicons name="pause-outline" size={34} color={BROWN} />
        </View>
        <Text style={styles.phaseTitle}>Relax</Text>
        <Text style={styles.phaseSubtitle}>
          Repetition {currentRepetition - 1} complete.
        </Text>
        <Text style={styles.largeTarget}>Keep the same sound</Text>
        <Text style={styles.phaseSubtitle}>
          Next: repetition {currentRepetition} of {repetitions}
        </Text>
        <ActivityIndicator
          size="small"
          color={BROWN}
          style={{ marginTop: 18 }}
        />
      </View>
    );
  }

  if (phase === 'recording') {
    return (
      <View style={styles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.recordingContent}
        >
          <Text style={styles.recordingEyebrow}>
            REPETITION {currentRepetition} / {repetitions}
          </Text>
          <Text style={styles.recordingTitle}>Keep the Tone the Same</Text>
          <Text style={styles.recordingSubtitle}>
            Repeat the same note with the same tone quality and loudness.
          </Text>

          <View style={styles.targetCard}>
            <Text style={styles.targetCardLabel}>TARGET</Text>
            <Text style={styles.targetCardValue}>Same note &amp; same tone</Text>
            <Text style={styles.targetCardHint}>
              Consistency matters more than volume.
            </Text>
          </View>

          <View style={styles.microphoneArea}>
            <View style={styles.outerMicCircle}>
              <View style={styles.innerMicCircle}>
                <Ionicons name="mic" size={52} color={BROWN} />
              </View>
            </View>
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingBadgeText}>RECORDING</Text>
            </View>
          </View>

          <View style={styles.liveCard}>
            <Text style={styles.liveLabel}>LIVE SIGNAL</Text>
            <Text style={styles.liveNote}>{livePitchNote}</Text>
            <Text style={styles.liveFrequency}>
              {liveFrame && liveFrame.pitch > 0
                ? `${Math.round(liveFrame.pitch)} Hz`
                : '--'}
            </Text>

            <View style={styles.liveStats}>
              <View style={styles.liveStat}>
                <Text style={styles.liveStatLabel}>Clarity</Text>
                <Text style={styles.liveStatValue}>
                  {liveFrame && liveFrame.clarity > 0
                    ? `${Math.round(liveFrame.clarity * 100)}%`
                    : '--'}
                </Text>
              </View>

              <View style={styles.liveStat}>
                <Text style={styles.liveStatLabel}>Volume</Text>
                <Text style={styles.liveStatValue}>
                  {liveFrame && Number.isFinite(liveFrame.volume)
                    ? `${Math.round(liveFrame.volume)} dB`
                    : '--'}
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.timerText}>
            {(elapsedMs / 1000).toFixed(1)} / {formatNumber(params.intervalSec)}s
          </Text>

          <View style={styles.timerTrack}>
            <View
              style={[
                styles.timerFill,
                { width: `${recordingProgress * 100}%` },
              ]}
            />
          </View>

          <Text style={styles.helperText}>
            Try to reproduce the same sound you made in the previous repetition.
          </Text>

          <Pressable
            style={styles.stopButton}
            onPress={stopEarly}
            disabled={!isRecording}
          >
            <Ionicons
              name="stop-circle-outline"
              size={20}
              color={BROWN}
            />
            <Text style={styles.stopButtonText}>Finish This Repetition</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'processing') {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.iconCircle}>
          <Ionicons name="analytics-outline" size={34} color={BROWN} />
        </View>
        <Text style={styles.phaseTitle}>Analyzing Your Tone</Text>
        <Text style={styles.phaseSubtitle}>
          Comparing brightness and loudness across {repetitions} repetitions.
        </Text>
        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.processingIndicator}
        />
      </View>
    );
  }

  const score = finalResult?.score ?? 0;
  const passed = finalResult?.passed ?? false;

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.resultsContent}
      >
        <View
          style={[
            styles.resultIcon,
            passed ? styles.resultIconPassed : styles.resultIconFailed,
          ]}
        >
          <Ionicons
            name={passed ? 'checkmark' : 'analytics-outline'}
            size={40}
            color={BROWN}
          />
        </View>

        <Text style={styles.resultTitle}>
          {passed ? 'Tone Kept Consistent!' : 'Keep Practicing'}
        </Text>
        <Text style={styles.resultSubtitle}>
          Your tone consistency was measured across all repetitions.
        </Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>YOUR SCORE</Text>
          <Text style={styles.scoreValue}>{score}%</Text>
          <Text style={styles.scoreDescription}>
            Higher scores mean the tone brightness and loudness changed less between repetitions.
          </Text>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>Session Summary</Text>

          <View style={styles.resultRow}>
            <View style={styles.resultRowTextBlock}>
              <Text style={styles.resultRowLabel}>Repetitions recorded</Text>
              <Text style={styles.resultRowHint}>
                All completed repetitions used for the final comparison.
              </Text>
            </View>
            <Text style={styles.resultRowValue}>
              {repPreviews.length}/{repetitions}
            </Text>
          </View>

          <View style={styles.resultRow}>
            <View style={styles.resultRowTextBlock}>
              <Text style={styles.resultRowLabel}>Hold interval</Text>
              <Text style={styles.resultRowHint}>
                Target duration for each repetition.
              </Text>
            </View>
            <Text style={styles.resultRowValue}>
              {params.intervalSec}s
            </Text>
          </View>

          <View style={styles.resultRow}>
            <View style={styles.resultRowTextBlock}>
              <Text style={styles.resultRowLabel}>Consistency target</Text>
              <Text style={styles.resultRowHint}>
                Minimum score for this difficulty tier.
              </Text>
            </View>
            <Text style={styles.resultRowValue}>
              {params.consistencyThreshold}%
            </Text>
          </View>

          <View style={[styles.statusBadge, passed ? styles.statusPassed : styles.statusFailed]}>
            <Ionicons
              name={passed ? 'checkmark-circle-outline' : 'refresh-outline'}
              size={18}
              color={BROWN}
            />
            <Text style={styles.statusBadgeText}>
              {passed ? 'Target reached' : 'Needs more consistency'}
            </Text>
          </View>
        </View>

        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={20} color={BROWN} />
          <Text style={styles.tipText}>
            Keep your mouth shape, pitch, and airflow setup as similar as possible each time. Small differences in loudness and tone color can change the final consistency score.
          </Text>
        </View>

        <Pressable style={styles.doneButton} onPress={goBack}>
          <Text style={styles.doneButtonText}>Back to Exercises</Text>
        </Pressable>

        <Pressable style={styles.retryButton} onPress={retry}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
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
    padding: 4,
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
    textAlign: 'center',
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
    borderColor: '#F0D2DC',
  },

  prepareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },

  prepareTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
  },

  prepareItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 10,
    gap: 9,
  },

  prepareText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: BROWN,
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 8,
  },

  instruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    marginTop: 6,
  },

  targetBox: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 16,
    padding: 14,
    marginTop: 18,
  },

  targetInfo: {
    marginLeft: 12,
    flex: 1,
  },

  targetLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.7,
    color: MUTED,
  },

  targetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginTop: 2,
  },

  keyMetricCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    padding: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  keyMetricTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
    marginBottom: 7,
  },

  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },

  metricText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
  },

  difficultyRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: -8,
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
    backgroundColor: LIGHT_GRAY,
    borderRadius: 15,
    padding: 14,
    marginTop: 20,
    gap: 8,
  },

  errorText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
  },

  startButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 28,
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
    marginTop: 3,
  },

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 12,
  },

  largeTarget: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 4,
  },

  recordingEyebrow: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 1.1,
    color: MUTED,
    textAlign: 'center',
  },

  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
    marginTop: 8,
  },

  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
    marginBottom: 18,
  },

  targetCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F0D2DC',
  },

  targetCardLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.8,
    color: MUTED,
  },

  targetCardValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
    marginTop: 3,
    textAlign: 'center',
  },

  targetCardHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 4,
    textAlign: 'center',
  },

  microphoneArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    marginBottom: 18,
  },

  outerMicCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  innerMicCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recordingBadge: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  recordingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: BROWN,
  },

  recordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: BROWN,
  },

  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 1,
    color: MUTED,
  },

  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 38,
    color: BROWN,
    marginTop: 5,
  },

  liveFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 1,
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

  helperText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 12,
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

  resultRowTextBlock: {
    flex: 1,
    paddingRight: 12,
  },

  resultRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  resultRowHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
    marginTop: 2,
    maxWidth: 220,
  },

  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    marginLeft: 12,
  },

  statusBadge: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 14,
    paddingVertical: 11,
    marginTop: 12,
  },

  statusPassed: {
    backgroundColor: PINK,
  },

  statusFailed: {
    backgroundColor: LIGHT_GRAY,
  },

  statusBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },

  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
    gap: 8,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
  },

  doneButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },

  doneButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  retryButton: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: '#E8DCD7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },

  retryButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },
});
