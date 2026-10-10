
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  AudioContext,
  AudioManager,
  AudioRecorder,
} from 'react-native-audio-api';

import ExerciseScreen from '@/screens/exercises/ExerciseScreen';

import {
  QUICK_INTERVAL_JUMP_PARAMS,
  type Tier,
} from '@/constants/exercises/agility';

import { auth } from '@/services/firebase/config';

import { measureQuickIntervalJump } from '@/services/measurement/agility/quickIntervalJump';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { scoreQuickIntervalJump } from '@/services/scoring/agility/quickIntervalJump';

import { generateQuickIntervalJumpParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import { frequencyToNoteName } from '@/utils/music/notes';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

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
// CONFIG
// ============================================================

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const MAX_RECORDING_SECONDS = 10;
const MAX_SAMPLE_COUNT = SAMPLE_RATE * MAX_RECORDING_SECONDS;
const COUNTDOWN_SECONDS = 3;

// ============================================================
// TYPES
// ============================================================

type Phase =
  | 'instructions'
  | 'reference'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

type ExerciseResult = {
  overall: number;
  pitchScore: number;
  intervalScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
  noteCount: number;
  correctNoteCount: number;
  transitionCount: number;
  correctTransitionCount: number;
  averageTransitionTimeMs: number;
  durationMs: number;
};

// ============================================================
// HELPERS
// ============================================================

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ============================================================
// COMPONENT
// ============================================================

export default function QuickIntervalJumpScreen() {
  const [tier, setTier] = useState<Tier>('beginner');
  const [tierLoading, setTierLoading] = useState(true);

  const [adaptiveConfig, setAdaptiveConfig] = useState(
    QUICK_INTERVAL_JUMP_PARAMS.beginner,
  );

  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPlayingReference, setIsPlayingReference] = useState(false);
  const [result, setResult] = useState<ExerciseResult | null>(null);

  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------

  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);

  const samplesRef = useRef<number[]>([]);
  const recordingStartRef = useRef<number | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const processingRef = useRef(false);
  const mountedRef = useRef(true);

  // Incrementing these tokens invalidates pending asynchronous work.
  const countdownTokenRef = useRef(0);
  const playbackTokenRef = useRef(0);

  const referencePlayingRef = useRef(false);

  // ----------------------------------------------------------
  // CURRENT TIER CONFIGURATION
  // ----------------------------------------------------------

  const baseConfig = QUICK_INTERVAL_JUMP_PARAMS[tier];

  // ==========================================================
  // LOAD COMPONENT TIER
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    const loadComponentTier = async () => {
      const user = auth.currentUser;

      if (!user) {
        if (!cancelled) {
          setTier('beginner');
          setTierLoading(false);
        }
        return;
      }

      try {
        const progress = await fetchComponentProgress(
          user.uid,
          'agility',
        );

        if (cancelled) {
          return;
        }

        const savedTier = progress?.currentTier;

        const validTier: Tier =
          savedTier === 'beginner' ||
          savedTier === 'intermediate' ||
          savedTier === 'advanced'
            ? savedTier
            : 'beginner';

        setTier(validTier);
      } catch (error) {
        console.warn(
          'Failed to load agility component tier:',
          error,
        );

        if (!cancelled) {
          setTier('beginner');
        }
      } finally {
        if (!cancelled) {
          setTierLoading(false);
        }
      }
    };

    void loadComponentTier();

    return () => {
      cancelled = true;
    };
  }, []);

  // ==========================================================
  // LOAD ADAPTIVE PARAMETERS
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParameters = async () => {
      if (tierLoading) {
        return;
      }

      setIsLoadingAdaptiveParams(true);

      const currentBaseParams = QUICK_INTERVAL_JUMP_PARAMS[tier];

      setAdaptiveConfig(currentBaseParams);

      const user = auth.currentUser;

      if (!user) {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
        }
        return;
      }

      try {
        const records = await fetchExerciseRecords(
          user.uid,
          'agility',
        );

        if (cancelled) {
          return;
        }

        // ADS uses only the latest five scores for this exercise
        // at the current tier. Assessment scores are not included.
        const recentScores = records
          .filter(
            (exercise) =>
              exercise.templateId === 'quickIntervalJump' &&
              exercise.tier === tier,
          )
          .slice(-5)
          .map((exercise) => exercise.scorePct);

        const generatedParams = generateQuickIntervalJumpParams({
          tier,
          recentScores,
        });

        if (!cancelled) {
          setAdaptiveConfig(generatedParams);
        }
      } catch (error) {
        console.warn(
          'Failed to load Quick Interval Jump adaptive parameters:',
          error,
        );

        if (!cancelled) {
          setAdaptiveConfig(currentBaseParams);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
        }
      }
    };

    void loadAdaptiveParameters();

    return () => {
      cancelled = true;
    };
  }, [tier, tierLoading]);

  // ==========================================================
  // MICROPHONE PERMISSION
  // ==========================================================

  const requestMicrophonePermission =
    useCallback(async (): Promise<boolean> => {
      try {
        const permission =
          await AudioManager.requestRecordingPermissions();

        return permission === 'Granted';
      } catch (error) {
        console.warn(
          'Microphone permission request failed:',
          error,
        );
        return false;
      }
    }, []);

  // ==========================================================
  // STOP RECORDING
  // ==========================================================

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingStartRef.current = null;

    const recorder = recorderRef.current;

    if (recorder) {
      try {
        recorder.clearOnAudioReady();
      } catch {}

      try {
        void recorder.stop();
      } catch {}

      recorderRef.current = null;
    }
  }, []);

  // ==========================================================
  // CLEANUP
  // ==========================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      // Invalidate asynchronous countdowns and reference playback.
      countdownTokenRef.current += 1;
      playbackTokenRef.current += 1;
      referencePlayingRef.current = false;

      stopRecording();

      const context = audioContextRef.current;
      audioContextRef.current = null;

      if (context) {
        try {
          void context.close();
        } catch {}
      }
    };
  }, [stopRecording]);

  // ==========================================================
  // REFERENCE PLAYBACK
  // ==========================================================

  const playReference = async () => {
    if (
      referencePlayingRef.current ||
      phase !== 'reference' ||
      isLoadingAdaptiveParams
    ) {
      return;
    }

    referencePlayingRef.current = true;
    setIsPlayingReference(true);

    const playbackToken = ++playbackTokenRef.current;

    try {
      const context =
        audioContextRef.current ??
        new AudioContext({ sampleRate: SAMPLE_RATE });

      audioContextRef.current = context;

      await context.resume();

      if (
        !mountedRef.current ||
        playbackToken !== playbackTokenRef.current
      ) {
        return;
      }

      // These timings are intentionally derived from the tier.
      // QUICK_INTERVAL_JUMP_PARAMS does not define timing fields.
      const noteDurationSec =
        tier === 'beginner'
          ? 0.5
          : tier === 'intermediate'
            ? 0.4
            : 0.3;

      const gapSec = 0.1;

      for (const frequency of adaptiveConfig.frequencies) {
        if (
          !mountedRef.current ||
          playbackToken !== playbackTokenRef.current
        ) {
          break;
        }

        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.frequency.value = frequency;
        gain.gain.value = 0.12;

        oscillator.connect(gain);
        gain.connect(context.destination);

        const startTime = context.currentTime;

        oscillator.start(startTime);
        oscillator.stop(startTime + noteDurationSec);

        await sleep((noteDurationSec + gapSec) * 1000);
      }
    } catch (error) {
      console.warn('Reference playback failed:', error);
    } finally {
      if (playbackToken === playbackTokenRef.current) {
        referencePlayingRef.current = false;

        if (mountedRef.current) {
          setIsPlayingReference(false);
        }
      }
    }
  };

  // ==========================================================
  // BEGIN EXERCISE
  // ==========================================================

  const beginExercise = async () => {
    if (tierLoading || isLoadingAdaptiveParams) {
      return;
    }

    const permission = await requestMicrophonePermission();

    if (!mountedRef.current) {
      return;
    }

    if (!permission) {
      console.warn(
        'Microphone permission was not granted.',
      );
      return;
    }

    setResult(null);
    setPhase('reference');
  };

  // ==========================================================
  // START COUNTDOWN
  // ==========================================================

  const startCountdown = async () => {
    if (
      phase !== 'reference' ||
      referencePlayingRef.current ||
      isPlayingReference ||
      isLoadingAdaptiveParams
    ) {
      return;
    }

    const countdownToken = ++countdownTokenRef.current;

    // Invalidate any previous reference playback operation.
    playbackTokenRef.current += 1;

    setCountdown(COUNTDOWN_SECONDS);
    setRecordingTime(0);
    setResult(null);
    samplesRef.current = [];
    processingRef.current = false;
    setPhase('countdown');

    for (
      let value = COUNTDOWN_SECONDS;
      value >= 1;
      value--
    ) {
      if (
        !mountedRef.current ||
        countdownToken !== countdownTokenRef.current
      ) {
        return;
      }

      setCountdown(value);
      await sleep(1000);
    }

    if (
      !mountedRef.current ||
      countdownToken !== countdownTokenRef.current
    ) {
      return;
    }

    await startRecording(countdownToken);
  };

  // ==========================================================
  // START RECORDING
  // ==========================================================

  const startRecording = async (countdownToken: number) => {
    if (
      !mountedRef.current ||
      countdownToken !== countdownTokenRef.current
    ) {
      return;
    }

    try {
      processingRef.current = false;
      samplesRef.current = [];

      const recorder = new AudioRecorder();
      recorderRef.current = recorder;

      const callbackResult = recorder.onAudioReady(
        {
          sampleRate: SAMPLE_RATE,
          bufferLength: BUFFER_SIZE,
          channelCount: 1,
        },
        ({ buffer, numFrames }) => {
          try {
            // Ignore frames after cancellation or recorder shutdown.
            if (
              recorderRef.current !== recorder ||
              processingRef.current
            ) {
              return;
            }

            const channelData = buffer.getChannelData(0);
            const frameCount = Math.min(
              numFrames,
              channelData.length,
            );

            // Never retain more than ten seconds of PCM samples.
            const remaining =
              MAX_SAMPLE_COUNT - samplesRef.current.length;

            const samplesToCopy = Math.min(
              frameCount,
              Math.max(0, remaining),
            );

            for (let i = 0; i < samplesToCopy; i++) {
              samplesRef.current.push(channelData[i]);
            }
          } catch (error) {
            console.warn(
              'Could not read microphone audio buffer:',
              error,
            );
          }
        },
      );

      if (callbackResult.status === 'error') {
        console.warn(
          'Could not initialize microphone recording:',
          callbackResult.message,
        );

        try {
          recorder.clearOnAudioReady();
        } catch {}

        if (recorderRef.current === recorder) {
          recorderRef.current = null;
        }

        if (mountedRef.current) {
          setPhase('instructions');
        }

        return;
      }

      if (
        !mountedRef.current ||
        countdownToken !== countdownTokenRef.current
      ) {
        try {
          recorder.clearOnAudioReady();
          void recorder.stop();
        } catch {}

        if (recorderRef.current === recorder) {
          recorderRef.current = null;
        }

        return;
      }

      const startResult = await recorder.start();

      if (startResult.status === 'error') {
        console.warn(
          'Could not start recorder:',
          startResult.message,
        );

        try {
          recorder.clearOnAudioReady();
          void recorder.stop();
        } catch {}

        if (recorderRef.current === recorder) {
          recorderRef.current = null;
        }

        if (mountedRef.current) {
          setPhase('instructions');
        }

        return;
      }

      if (
        !mountedRef.current ||
        countdownToken !== countdownTokenRef.current
      ) {
        try {
          recorder.clearOnAudioReady();
          void recorder.stop();
        } catch {}

        if (recorderRef.current === recorder) {
          recorderRef.current = null;
        }

        return;
      }

      recordingStartRef.current = Date.now();

      setRecordingTime(0);
      setPhase('recording');

      recordingTimerRef.current = setInterval(() => {
        const start = recordingStartRef.current;

        if (start === null || !mountedRef.current) {
          return;
        }

        const elapsed = (Date.now() - start) / 1000;

        setRecordingTime(
          Math.min(elapsed, MAX_RECORDING_SECONDS),
        );

        if (elapsed >= MAX_RECORDING_SECONDS) {
          void processRecording();
        }
      }, 100);
    } catch (error) {
      console.warn('Recording failed:', error);

      stopRecording();

      if (mountedRef.current) {
        setPhase('instructions');
      }
    }
  };

  // ==========================================================
  // PROCESS RECORDING
  // ==========================================================

  const processRecording = async () => {
    if (
      processingRef.current ||
      !mountedRef.current
    ) {
      return;
    }

    processingRef.current = true;

    // Prevent a delayed countdown from starting another recording.
    countdownTokenRef.current += 1;

    stopRecording();
    setPhase('processing');

    await sleep(250);

    if (!mountedRef.current) {
      return;
    }

    try {
      const samples = new Float32Array(samplesRef.current);

      const measurement = measureQuickIntervalJump(
        samples,
        SAMPLE_RATE,
        adaptiveConfig.frequencies,
      );

      const scored = scoreQuickIntervalJump(measurement);
      const finalScore = Math.round(scored.overall);

      // --------------------------------------------------------
      // SAVE EXERCISE PROGRESS
      // --------------------------------------------------------

      try {
        await saveCompletedExercise(
          'agility',
          'quickIntervalJump',
          tier,
          finalScore,
        );

        // The save service may handle errors internally, so this
        // message confirms only that the save call returned.
        console.log(
          'Quick Interval Jump save call completed:',
          {
            componentId: 'agility',
            templateId: 'quickIntervalJump',
            tier,
            scorePct: finalScore,
          },
        );
      } catch (saveError) {
        console.error(
          'Failed to save Quick Interval Jump progress:',
          saveError,
        );
      }

      if (!mountedRef.current) {
        return;
      }

      setResult({
        overall: scored.overall,
        pitchScore: scored.pitchScore,
        intervalScore: scored.intervalScore,
        speedScore: scored.speedScore,
        passed: scored.passed,
        feedback: scored.feedback,
        noteCount: measurement.noteCount,
        correctNoteCount: measurement.correctNoteCount,
        transitionCount: measurement.transitionCount,
        correctTransitionCount:
          measurement.correctTransitionCount,
        averageTransitionTimeMs:
          measurement.averageTransitionTimeMs,
        durationMs: measurement.durationMs,
      });

      setPhase('results');
    } catch (error) {
      console.warn(
        'Quick Interval Jump processing failed:',
        error,
      );

      if (mountedRef.current) {
        setPhase('instructions');
      }
    } finally {
      processingRef.current = false;
    }
  };

  // ==========================================================
  // RESET
  // ==========================================================

  const resetExercise = () => {
    // Cancel any pending countdown or reference playback.
    countdownTokenRef.current += 1;
    playbackTokenRef.current += 1;
    referencePlayingRef.current = false;
    setIsPlayingReference(false);

    processingRef.current = false;
    stopRecording();

    samplesRef.current = [];

    setResult(null);
    setRecordingTime(0);
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('instructions');
  };

  // ==========================================================
  // INSTRUCTIONS
  // ==========================================================

  const renderInstructions = () => (
    <ExerciseScreen
      title="Quick Interval Jump"
      category="Vocal Agility"
      icon="swap-horizontal-outline"
      instructions="Listen carefully to the reference note pattern, identify each target pitch, then sing each interval accurately and smoothly."
      preparationSteps={[
        {
          icon: 'volume-mute-outline',
          text: 'Find a quiet area with minimal background noise.',
        },
        {
          icon: 'body-outline',
          text: 'Sit or stand upright with relaxed shoulders.',
        },
        {
          icon: 'mic-outline',
          text: 'Keep a comfortable distance from the microphone.',
        },
      ]}
      summary={[
        { label: 'DIFFICULTY', value: adaptiveConfig.label },
        { label: 'SPEED', value: adaptiveConfig.speedLabel },
        {
          label: 'NOTES',
          value: String(adaptiveConfig.frequencies.length),
        },
      ]}
      tip="Focus on accurate interval jumps first. Smoothness and speed should develop naturally."
      tier={tier}
      startDisabled={
        tierLoading || isLoadingAdaptiveParams
      }
      startLabel={
        tierLoading || isLoadingAdaptiveParams
          ? 'Preparing Exercise...'
          : 'Start Exercise'
      }
      onBack={() => router.back()}
      onStart={beginExercise}
    />
  );

  // ==========================================================
  // REFERENCE
  // ==========================================================

  const renderReference = () => (
    <View style={styles.content}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="swap-horizontal-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>
        Listen to the Reference
      </Text>

      <Text style={styles.phaseSubtitle}>
        Listen carefully to the note sequence, then sing the
        same interval jumps.
      </Text>

      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>
          REFERENCE SEQUENCE
        </Text>

        <View style={styles.noteSequence}>
          {adaptiveConfig.frequencies.map(
            (frequency, index) => (
              <View
                key={`${frequency}-${index}`}
                style={styles.notePill}
              >
                <Text style={styles.noteNumber}>
                  {index + 1}
                </Text>

                <Text style={styles.noteText}>
                  {frequencyToNoteName(frequency)}
                </Text>
              </View>
            ),
          )}
        </View>

        <Text style={styles.referenceHint}>
          Listen to the complete pattern before starting.
        </Text>
      </View>

      <Pressable
        style={[
          styles.startButton,
          isPlayingReference && styles.disabledButton,
        ]}
        disabled={isPlayingReference}
        onPress={() => void playReference()}
      >
        {isPlayingReference ? (
          <ActivityIndicator
            size="small"
            color={WHITE}
          />
        ) : (
          <Ionicons
            name="play"
            size={18}
            color={WHITE}
          />
        )}

        <Text style={styles.startButtonText}>
          {isPlayingReference
            ? 'Playing Reference...'
            : 'Play Reference'}
        </Text>
      </Pressable>

      <Pressable
        style={[
          styles.doneButton,
          isPlayingReference && styles.disabledButton,
        ]}
        disabled={isPlayingReference}
        onPress={() => void startCountdown()}
      >
        <Text style={styles.doneButtonText}>
          I'm Ready
        </Text>
      </Pressable>
    </View>
  );

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="flash-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>
        Get Ready
      </Text>

      <Text style={styles.countdownText}>
        {countdown}
      </Text>

      <Text style={styles.phaseSubtitle}>
        Prepare for the interval jumps.
      </Text>
    </View>
  );

  // ==========================================================
  // RECORDING
  // ==========================================================

  const renderRecording = () => {
    const progress = Math.min(
      recordingTime / MAX_RECORDING_SECONDS,
      1,
    );

    return (
      <View style={styles.content}>
        <View style={styles.recordingIcon}>
          <Ionicons
            name="mic"
            size={34}
            color={BROWN}
          />
        </View>

        <Text style={styles.recordingTitle}>
          Jump Between Notes
        </Text>

        <Text style={styles.recordingSubtitle}>
          Sing each target note clearly and make each interval
          change precise.
        </Text>

        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />

          <Text style={styles.recordingBadgeText}>
            RECORDING
          </Text>
        </View>

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>
            RECORDING TIME
          </Text>

          <Text style={styles.liveCurrentNote}>
            {recordingTime.toFixed(1)}s
          </Text>

          <View style={styles.liveDivider} />

          <View style={styles.liveStats}>
            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>
                Target Notes
              </Text>

              <Text style={styles.liveStatValue}>
                {adaptiveConfig.frequencies.length}
              </Text>
            </View>

            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>
                Max Time
              </Text>

              <Text style={styles.liveStatValue}>
                {MAX_RECORDING_SECONDS}s
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.timerText}>
          Recording Time: {recordingTime.toFixed(1)}s
        </Text>

        <View style={styles.timerTrack}>
          <View
            style={[
              styles.timerFill,
              { width: `${progress * 100}%` },
            ]}
          />
        </View>

        <View style={styles.referenceCard}>
          <Text style={styles.cardTitle}>
            Sing This Sequence
          </Text>

          <View style={styles.noteSequence}>
            {adaptiveConfig.frequencies.map(
              (frequency, index) => (
                <View
                  key={`${frequency}-${index}`}
                  style={styles.notePill}
                >
                  <Text style={styles.noteNumber}>
                    {index + 1}
                  </Text>

                  <Text style={styles.noteText}>
                    {frequencyToNoteName(frequency)}
                  </Text>
                </View>
              ),
            )}
          </View>
        </View>

        <Pressable
          style={styles.finishButton}
          onPress={() => void processRecording()}
        >
          <Ionicons
            name="stop"
            size={18}
            color={BROWN}
          />

          <Text style={styles.finishButtonText}>
            Finish Recording
          </Text>
        </Pressable>
      </View>
    );
  };

  // ==========================================================
  // PROCESSING
  // ==========================================================

  const renderProcessing = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <ActivityIndicator
          size="large"
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>
        Analyzing Your Singing
      </Text>

      <Text style={styles.phaseSubtitle}>
        Measuring pitch accuracy, interval accuracy, and
        transition speed.
      </Text>
    </View>
  );

  // ==========================================================
  // RESULTS
  // ==========================================================

  const renderResults = () => {
    if (!result) {
      return null;
    }

    return (
      <View style={styles.resultsContent}>
        <View
          style={[
            styles.resultIcon,
            result.passed
              ? styles.resultIconPassed
              : styles.resultIconFailed,
          ]}
        >
          <Ionicons
            name={result.passed ? 'checkmark' : 'refresh'}
            size={40}
            color={BROWN}
          />
        </View>

        <Text style={styles.resultTitle}>
          {result.passed ? 'Great Job!' : 'Keep Practicing!'}
        </Text>

        <Text style={styles.resultSubtitle}>
          Quick Interval Jump Result
        </Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>
            OVERALL SCORE
          </Text>

          <Text style={styles.scoreValue}>
            {Math.round(result.overall)}
          </Text>

          <Text style={styles.scoreDescription}>
            out of 100
          </Text>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Performance Breakdown
          </Text>

          <View style={styles.scoreRow}>
            <View style={styles.scoreRowHeader}>
              <Text style={styles.scoreRowLabel}>
                Pitch Accuracy
              </Text>

              <Text style={styles.scoreRowValue}>
                {Math.round(result.pitchScore)}%
              </Text>
            </View>

            <View style={styles.progressBackground}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(
                      100,
                      Math.max(0, result.pitchScore),
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>

          <View style={styles.scoreRow}>
            <View style={styles.scoreRowHeader}>
              <Text style={styles.scoreRowLabel}>
                Interval Accuracy
              </Text>

              <Text style={styles.scoreRowValue}>
                {Math.round(result.intervalScore)}%
              </Text>
            </View>

            <View style={styles.progressBackground}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(
                      100,
                      Math.max(0, result.intervalScore),
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>

          <View style={styles.scoreRowLast}>
            <View style={styles.scoreRowHeader}>
              <Text style={styles.scoreRowLabel}>
                Transition Speed
              </Text>

              <Text style={styles.scoreRowValue}>
                {Math.round(result.speedScore)}%
              </Text>
            </View>

            <View style={styles.progressBackground}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(
                      100,
                      Math.max(0, result.speedScore),
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Performance Metrics
          </Text>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>
              Correct Notes
            </Text>

            <Text style={styles.metricValue}>
              {result.correctNoteCount}/{result.noteCount}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>
              Correct Jumps
            </Text>

            <Text style={styles.metricValue}>
              {result.correctTransitionCount}/
              {result.transitionCount}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>
              Average Transition
            </Text>

            <Text style={styles.metricValue}>
              {result.averageTransitionTimeMs > 0
                ? result.averageTransitionTimeMs.toFixed(0)
                : '0'}{' '}
              ms
            </Text>
          </View>

          <View style={[styles.metricRow, styles.metricRowLast]}>
            <Text style={styles.metricLabel}>
              Duration
            </Text>

            <Text style={styles.metricValue}>
              {(result.durationMs / 1000).toFixed(1)}s
            </Text>
          </View>
        </View>

        <View style={styles.tipCard}>
          <Ionicons
            name="bulb-outline"
            size={20}
            color={BROWN}
          />

          <Text style={styles.tipText}>
            {result.feedback}
          </Text>
        </View>

        <Pressable
          style={styles.startButton}
          onPress={resetExercise}
        >
          <Ionicons
            name="refresh"
            size={18}
            color={WHITE}
          />

          <Text style={styles.startButtonText}>
            Try Again
          </Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={() =>
            router.replace('/dashboard?tab=exercises')
          }
        >
          <Text style={styles.doneButtonText}>
            Done
          </Text>
        </Pressable>
      </View>
    );
  };

  // ==========================================================
  // MAIN RENDER
  // ==========================================================

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={
        phase === 'results'
          ? styles.resultsWrapper
          : undefined
      }
      showsVerticalScrollIndicator={false}
    >
      {phase === 'instructions' && renderInstructions()}
      {phase === 'reference' && renderReference()}
      {phase === 'countdown' && renderCountdown()}
      {phase === 'recording' && renderRecording()}
      {phase === 'processing' && renderProcessing()}
      {phase === 'results' && renderResults()}
    </ScrollView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 92,
    paddingBottom: 60,
    alignItems: 'center',
  },

  resultsContent: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 92,
    paddingBottom: 50,
    alignItems: 'center',
  },

  resultsWrapper: {
    flexGrow: 1,
    width: '100%',
  },

  centerScreen: {
    flexGrow: 1,
    minHeight: 700,
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

  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
    marginTop: 20,
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

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginTop: 10,
    marginBottom: 14,
  },

  referenceCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 22,
  },

  referenceLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
    textAlign: 'center',
  },

  referenceHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 16,
  },

  noteSequence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
    marginTop: 16,
  },

  notePill: {
    minWidth: 60,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
  },

  noteNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: MUTED,
    marginBottom: 2,
  },

  noteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 15,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },

  startButton: {
    width: '100%',
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },

  disabledButton: {
    opacity: 0.55,
  },

  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  finishButton: {
    width: '100%',
    height: 53,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },

  finishButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  doneButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },

  doneButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
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
    fontSize: 26,
    color: BROWN,
    textAlign: 'center',
  },

  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
    maxWidth: 310,
  },

  recordingBadge: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: BORDER,
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
    borderRadius: 20,
    padding: 20,
    marginTop: 22,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
  },

  liveCurrentNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    marginTop: 4,
  },

  liveDivider: {
    width: '100%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 15,
  },

  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 6,
  },

  liveStat: {
    flex: 1,
    alignItems: 'center',
  },

  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginTop: 3,
  },

  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 20,
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
    lineHeight: 16,
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
    marginBottom: 14,
  },

  scoreRow: {
    marginBottom: 14,
  },

  scoreRowLast: {
    marginBottom: 0,
  },

  scoreRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 7,
  },

  scoreRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  scoreRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  progressBackground: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: PINK,
  },

  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  metricRowLast: {
    borderBottomWidth: 0,
  },

  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    flex: 1,
  },

  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'right',
    marginLeft: 12,
  },
});