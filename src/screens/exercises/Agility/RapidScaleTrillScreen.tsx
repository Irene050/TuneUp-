
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  AudioContext,
  AudioManager,
  AudioRecorder,
} from 'react-native-audio-api';

import ExerciseScreen from '@/screens/exercises/ExerciseScreen';

import {
  RAPID_SCALE_TRILL_PARAMS,
  type Tier,
} from '@/constants/exercises/agility';

import { auth } from '@/services/firebase/config';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  generateRapidScaleTrillParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  measureRapidScaleTrill,
} from '@/services/measurement/agility/rapidScaleTrill';

import {
  scoreRapidScaleTrill,
} from '@/services/scoring/agility/rapidScaleTrill';

import { frequencyToNoteName } from '@/utils/music/notes';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

// ============================================================
// COLORS AND CONFIGURATION
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const MAX_RECORDING_SECONDS = 10;
const COUNTDOWN_SECONDS = 3;
const MIN_RECORDING_SECONDS = 0.25;
const MIN_RECORDING_RMS = 0.001;

type Phase =
  | 'instructions'
  | 'reference'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

type RapidScaleTrillResult = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  transitionScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
  noteCount: number;
  correctNoteCount: number;
  transitionCount: number;
  correctTransitionCount: number;
  averageTransitionTimeMs: number;
  notesPerSecond: number;
  durationMs: number;
};

// ============================================================
// COMPONENT
// ============================================================

export default function RapidScaleTrillScreen() {
  // ----------------------------------------------------------
  // USER AND TIER
  // ----------------------------------------------------------

  const currentUserId = auth.currentUser?.uid ?? null;

  const [tier, setTier] = useState<Tier | null>(null);
  const [tierLoading, setTierLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadTier = async () => {
      setTierLoading(true);

      if (!currentUserId) {
        if (!cancelled) {
          setTier('beginner');
          setTierLoading(false);
        }
        return;
      }

      try {
        const progress = await fetchComponentProgress(
          currentUserId,
          'agility',
        );

        if (!cancelled) {
          setTier(progress?.currentTier ?? 'beginner');
        }
      } catch (error) {
        console.error('Failed to load Agility tier:', error);

        if (!cancelled) {
          setTier('beginner');
        }
      } finally {
        if (!cancelled) {
          setTierLoading(false);
        }
      }
    };

    void loadTier();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const activeTier: Tier = tier ?? 'beginner';

  const baseConfig = useMemo(
    () => RAPID_SCALE_TRILL_PARAMS[activeTier],
    [activeTier],
  );

  const [config, setConfig] = useState(baseConfig);

  // ----------------------------------------------------------
  // SCREEN STATE
  // ----------------------------------------------------------

  const [phase, setPhase] = useState<Phase>('instructions');

  const [countdown, setCountdown] = useState(
    COUNTDOWN_SECONDS,
  );

  const [recordingTime, setRecordingTime] = useState(0);

  const [result, setResult] =
    useState<RapidScaleTrillResult | null>(null);

  const [referencePlaying, setReferencePlaying] =
    useState(false);

  // ----------------------------------------------------------
  // AUDIO AND RECORDING REFS
  // ----------------------------------------------------------

  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);

  const samplesRef = useRef<Float32Array>(
    new Float32Array(
      SAMPLE_RATE * MAX_RECORDING_SECONDS,
    ),
  );

  const sampleCountRef = useRef(0);
  const recordingStartRef = useRef<number | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const processingRef = useRef(false);
  const countdownRunRef = useRef(0);

  const referencePlayingRef = useRef(false);
  const referenceRunRef = useRef(0);

  // Prevents saving the same attempt more than once.
  const savedAttemptRef = useRef(false);

  // ----------------------------------------------------------
  // ADAPTIVE DIFFICULTY SCALING
  //
  // Only completed exercises from the same template and tier
  // influence continuous ADS.
  //
  // The generator uses the most recent five scores and returns
  // the tier defaults unchanged when history is empty.
  // ----------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParameters = async () => {
      if (tierLoading || !tier) {
        return;
      }

      if (!currentUserId) {
        setConfig(baseConfig);
        return;
      }

      try {
        const records = await fetchExerciseRecords(
          currentUserId,
          'agility',
        );

        if (cancelled) {
          return;
        }

        const matchingRecords = records
          .filter(
            (record) =>
              record.templateId === 'rapidScaleTrill' &&
              record.tier === tier &&
              Number.isFinite(record.scorePct),
          )
          .sort((a, b) => a.timestamp - b.timestamp);

        const recentScores = matchingRecords
          .slice(-5)
          .map((record) => record.scorePct);

        const generated = generateRapidScaleTrillParams({
          tier,
          recentScores,
        });

        if (!cancelled) {
          setConfig(generated);
        }
      } catch (error) {
        console.error(
          'Failed to load Rapid Scale Trill adaptive parameters:',
          error,
        );

        if (!cancelled) {
          setConfig(baseConfig);
        }
      }
    };

    void loadAdaptiveParameters();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, tier, tierLoading, baseConfig]);

  // ----------------------------------------------------------
  // STOP RECORDING
  // ----------------------------------------------------------

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const recorder = recorderRef.current;
    recorderRef.current = null;

    if (recorder) {
      try {
        recorder.clearOnAudioReady();
      } catch {
        // The recorder may already have stopped.
      }

      try {
        recorder.stop();
      } catch {
        // The recorder may already have stopped.
      }
    }
  }, []);

  // ----------------------------------------------------------
  // CANCEL REFERENCE PLAYBACK
  // ----------------------------------------------------------

  const cancelReferencePlayback = useCallback(() => {
    referenceRunRef.current += 1;
    referencePlayingRef.current = false;
    setReferencePlaying(false);
  }, []);

  // ----------------------------------------------------------
  // CLEANUP
  // ----------------------------------------------------------

  useEffect(() => {
    return () => {
      countdownRunRef.current += 1;
      referenceRunRef.current += 1;

      stopRecording();

      referencePlayingRef.current = false;

      const context = audioContextRef.current;
      audioContextRef.current = null;

      if (context) {
        try {
          void context.close();
        } catch {
          // The audio context may already be closed.
        }
      }
    };
  }, [stopRecording]);

  // ----------------------------------------------------------
  // MICROPHONE PERMISSION
  // ----------------------------------------------------------

  const requestMicrophonePermission =
    async (): Promise<boolean> => {
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
    };

  // ----------------------------------------------------------
  // PLAY REFERENCE SEQUENCE
  // ----------------------------------------------------------

  const playReference = async () => {
    if (referencePlayingRef.current) {
      return;
    }

    const runId = ++referenceRunRef.current;

    referencePlayingRef.current = true;
    setReferencePlaying(true);

    try {
      let context = audioContextRef.current;

      if (!context) {
        context = new AudioContext({
          sampleRate: SAMPLE_RATE,
        });

        audioContextRef.current = context;
      }

      await context.resume();

      for (const frequency of config.frequencies) {
        if (referenceRunRef.current !== runId) {
          return;
        }

        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.frequency.value = frequency;
        gain.gain.value = 0.12;

        oscillator.connect(gain);
        gain.connect(context.destination);

        const startTime = context.currentTime;

        oscillator.start(startTime);
        oscillator.stop(
          startTime + config.noteDurationSec,
        );

        await new Promise<void>((resolve) => {
          setTimeout(
            resolve,
            config.noteDurationSec * 1000,
          );
        });
      }
    } catch (error) {
      if (referenceRunRef.current === runId) {
        console.warn('Reference playback failed:', error);

        Alert.alert(
          'Playback Error',
          'The reference sequence could not be played. Please try again.',
        );
      }
    } finally {
      if (referenceRunRef.current === runId) {
        referencePlayingRef.current = false;
        setReferencePlaying(false);
      }
    }
  };

  // ----------------------------------------------------------
  // BEGIN EXERCISE
  // ----------------------------------------------------------

  const beginExercise = async () => {
    const permission = await requestMicrophonePermission();

    if (!permission) {
      Alert.alert(
        'Microphone Permission Required',
        'Allow microphone access to record your singing.',
      );

      return;
    }

    savedAttemptRef.current = false;
    setResult(null);
    setPhase('reference');
  };

  // ----------------------------------------------------------
  // COUNTDOWN
  // ----------------------------------------------------------

  const startCountdown = async () => {
    if (referencePlayingRef.current) {
      return;
    }

    const runId = ++countdownRunRef.current;

    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');

    for (
      let value = COUNTDOWN_SECONDS;
      value >= 1;
      value--
    ) {
      if (countdownRunRef.current !== runId) {
        return;
      }

      setCountdown(value);

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000);
      });
    }

    if (countdownRunRef.current !== runId) {
      return;
    }

    await startRecording();
  };

  // ----------------------------------------------------------
  // PROCESS RECORDING
  // Declared before startRecording so both timer and button
  // can invoke the same guarded processing operation.
  // ----------------------------------------------------------

  const processRecording = async () => {
    if (processingRef.current) {
      return;
    }

    processingRef.current = true;

    stopRecording();
    recordingStartRef.current = null;
    setPhase('processing');

    try {
      const sampleCount = sampleCountRef.current;

      if (
        sampleCount <
        SAMPLE_RATE * MIN_RECORDING_SECONDS
      ) {
        throw new Error(
          'The recording is too short. Please sing the pattern and try again.',
        );
      }

      const samples = samplesRef.current.subarray(
        0,
        sampleCount,
      );

      let sumSquares = 0;

      for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
      }

      const rms = Math.sqrt(
        sumSquares / samples.length,
      );

      if (rms < MIN_RECORDING_RMS) {
        throw new Error(
          'No clear singing was detected. Please try again with your microphone closer to your voice.',
        );
      }

      const measurement = measureRapidScaleTrill(
        samples,
        SAMPLE_RATE,
        config.frequencies,
      );

      const scored = scoreRapidScaleTrill(
        measurement,
        config.accuracyThreshold,
      );

      const finalResult: RapidScaleTrillResult = {
        overall: scored.overall,
        pitchScore: scored.pitchScore,
        sequenceScore: scored.sequenceScore,
        transitionScore: scored.transitionScore,
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
        notesPerSecond: measurement.notesPerSecond,
        durationMs: measurement.durationMs,
      };

      setResult(finalResult);
      setPhase('results');

      if (tier && !savedAttemptRef.current) {
        savedAttemptRef.current = true;

        void saveCompletedExercise(
          'agility',
          'rapidScaleTrill',
          tier,
          scored.overall,
        )
          .then(() => {
            console.log(
              'Rapid Scale Trill progress saved:',
              scored.overall,
            );
          })
          .catch((saveError) => {
            // Do not automatically retry here: an uncertain
            // network result could otherwise create duplicates.
            console.error(
              'Failed to save Rapid Scale Trill progress:',
              saveError,
            );
          });
      }
    } catch (error) {
      console.error(
        'Rapid Scale Trill processing failed:',
        error,
      );

      setPhase('instructions');

      Alert.alert(
        'Recording Not Processed',
        error instanceof Error
          ? error.message
          : 'Unable to process the recording. Please try again.',
        [
          {
            text: 'Try Again',
            onPress: resetExercise,
          },
        ],
      );
    } finally {
      processingRef.current = false;
    }
  };

  // ----------------------------------------------------------
  // START RECORDING
  // ----------------------------------------------------------

  const startRecording = async () => {
    try {
      processingRef.current = false;
      savedAttemptRef.current = false;

      sampleCountRef.current = 0;
      samplesRef.current = new Float32Array(
        SAMPLE_RATE * MAX_RECORDING_SECONDS,
      );

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
            if (recorderRef.current !== recorder) {
              return;
            }

            const channelData = buffer.getChannelData(0);

            const frameCount = Math.min(
              numFrames,
              channelData.length,
            );

            const remaining =
              samplesRef.current.length -
              sampleCountRef.current;

            const count = Math.min(
              frameCount,
              remaining,
            );

            for (let i = 0; i < count; i++) {
              samplesRef.current[
                sampleCountRef.current + i
              ] = channelData[i];
            }

            sampleCountRef.current += count;
          } catch (error) {
            console.warn(
              'Failed to capture audio frame:',
              error,
            );
          }
        },
      );

      if (callbackResult.status === 'error') {
        throw new Error(callbackResult.message);
      }

      const startResult = await recorder.start();

      if (startResult.status === 'error') {
        throw new Error(startResult.message);
      }

      recordingStartRef.current = Date.now();
      setRecordingTime(0);
      setPhase('recording');

      recordingTimerRef.current = setInterval(() => {
        const start = recordingStartRef.current;

        if (start === null) {
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
      console.error('Failed to start recording:', error);

      stopRecording();
      recordingStartRef.current = null;

      Alert.alert(
        'Recording Error',
        error instanceof Error
          ? error.message
          : 'The recording could not be started. Please try again.',
      );

      setPhase('instructions');
    }
  };

  // ----------------------------------------------------------
  // RESET
  // ----------------------------------------------------------

  const resetExercise = () => {
    countdownRunRef.current += 1;
    cancelReferencePlayback();
    stopRecording();

    processingRef.current = false;
    recordingStartRef.current = null;
    sampleCountRef.current = 0;
    savedAttemptRef.current = false;

    samplesRef.current = new Float32Array(
      SAMPLE_RATE * MAX_RECORDING_SECONDS,
    );

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
      title="Rapid Scale Trill"
      category="Vocal Agility"
      icon="flash-outline"
      instructions="Listen carefully to the reference scale pattern, follow the notes in order, and sing rapidly while keeping each note clear."
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
        { label: 'DIFFICULTY', value: config.label },
        { label: 'SPEED', value: config.speedLabel },
        {
          label: 'NOTES',
          value: String(config.frequencies.length),
        },
        {
          label: 'NOTE DURATION',
          value: `${config.noteDurationSec.toFixed(2)}s`,
        },
        {
          label: 'SCALE',
          value: config.frequencies
            .map(frequencyToNoteName)
            .join(' • '),
        },
      ]}
      tip="Focus on clean pitch changes first. Build speed naturally while maintaining accuracy."
      tier={tier}
      startDisabled={tierLoading}
      startLabel={
        tierLoading ? 'Preparing Exercise...' : 'Start Exercise'
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.backButton}
        onPress={() => {
          countdownRunRef.current += 1;
          cancelReferencePlayback();
          setPhase('instructions');
        }}
      >
        <Ionicons
          name="chevron-back"
          size={25}
          color={BROWN}
        />
      </Pressable>

      <View style={styles.iconCircle}>
        <Ionicons
          name="musical-notes-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>
        Listen to the Reference
      </Text>

      <Text style={styles.phaseSubtitle}>
        Listen carefully to the sequence before singing it.
      </Text>

      <View style={styles.referenceCard}>
        <Text style={styles.cardTitle}>
          Reference Sequence
        </Text>

        <View style={styles.noteSequence}>
          {config.frequencies.map((frequency, index) => (
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
          ))}
        </View>

        <Text style={styles.referenceHint}>
          Listen to the complete sequence before starting.
        </Text>
      </View>

      <Pressable
        style={[
          styles.startButton,
          referencePlaying && styles.disabledButton,
        ]}
        disabled={referencePlaying}
        onPress={() => void playReference()}
      >
        <Ionicons
          name="play"
          size={20}
          color={WHITE}
        />
        <Text style={styles.startButtonText}>
          {referencePlaying
            ? 'Playing Reference...'
            : 'Play Reference'}
        </Text>
      </Pressable>

      <Pressable
        style={[
          styles.doneButton,
          referencePlaying && styles.disabledButton,
        ]}
        disabled={referencePlaying}
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
        Prepare for the rapid scale pattern.
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
          Sing the Scale
        </Text>

        <Text style={styles.recordingSubtitle}>
          Follow the pattern quickly while keeping every note
          accurate and controlled.
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
                {config.frequencies.length}
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
            {config.frequencies.map((frequency, index) => (
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
            ))}
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
        Measuring pitch accuracy, sequence accuracy,
        transitions, and speed.
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

    const scoreRows = [
      {
        label: 'Pitch Accuracy',
        score: result.pitchScore,
      },
      {
        label: 'Sequence Accuracy',
        score: result.sequenceScore,
      },
      {
        label: 'Transition Accuracy',
        score: result.transitionScore,
      },
      {
        label: 'Speed Score',
        score: result.speedScore,
      },
    ];

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
          Rapid Scale Trill Result
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

          {scoreRows.map((item, index) => (
            <View
              key={item.label}
              style={
                index === scoreRows.length - 1
                  ? styles.scoreRowLast
                  : styles.scoreRow
              }
            >
              <View style={styles.scoreRowHeader}>
                <Text style={styles.scoreRowLabel}>
                  {item.label}
                </Text>
                <Text style={styles.scoreRowValue}>
                  {Math.round(item.score)}%
                </Text>
              </View>

              <View style={styles.progressBackground}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(
                        Math.max(item.score, 0),
                        100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Performance Metrics
          </Text>

          <MetricRow
            label="Correct Notes"
            value={`${result.correctNoteCount}/${result.noteCount}`}
          />

          <MetricRow
            label="Correct Transitions"
            value={`${result.correctTransitionCount}/${result.transitionCount}`}
          />

          <MetricRow
            label="Average Transition"
            value={`${Math.round(result.averageTransitionTimeMs)} ms`}
          />

          <MetricRow
            label="Notes per Second"
            value={result.notesPerSecond.toFixed(2)}
          />

          <MetricRow
            label="Duration"
            value={`${(result.durationMs / 1000).toFixed(1)}s`}
            last
          />
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
// SMALL RESULT METRIC ROW
// ============================================================

function MetricRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.metricRow,
        last && styles.metricRowLast,
      ]}
    >
      <Text style={styles.metricLabel}>
        {label}
      </Text>
      <Text style={styles.metricValue}>
        {value}
      </Text>
    </View>
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
    minHeight: 650,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHITE,
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
  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },
  disabledButton: {
    opacity: 0.5,
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
    minHeight: 54,
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
