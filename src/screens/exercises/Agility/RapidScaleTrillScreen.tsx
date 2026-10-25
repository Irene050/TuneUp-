import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
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

import {
  RAPID_SCALE_TRILL_PARAMS,
  type Tier,
} from '@/constants/agility';
import ExerciseScreen from '@/screens/exercises/ExerciseScreen';
import { generateRapidScaleTrillParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureRapidScaleTrill } from '@/services/measurement/agility/rapidScaleTrill';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreRapidScaleTrill } from '@/services/scoring/agility/rapidScaleTrill';
import { frequencyToNoteName } from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';
const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const MAX_RECORDING_BUFFER_SECONDS = 20;
const COUNTDOWN_SECONDS = 3;
const MIN_RECORDING_SECONDS = 0.25;
const MIN_RECORDING_RMS = 0.001;

type VocalRange = { lowHz: number; highHz: number };
type Phase =
  | 'instructions'
  | 'reference'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';
type Confirmation = 'tryAgain' | 'quit' | null;
type AdaptiveConfig = ReturnType<typeof generateRapidScaleTrillParams>;
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

function isTier(value: unknown): value is Tier {
  return value === 'beginner' || value === 'intermediate' || value === 'advanced';
}

function getAssessmentVocalRange(assessment: any): VocalRange | null {
  const lowHz =
    assessment?.vocalRange?.lowHz ?? assessment?.vocalRangeLowHz;
  const highHz =
    assessment?.vocalRange?.highHz ?? assessment?.vocalRangeHighHz;

  if (
    typeof lowHz !== 'number' ||
    typeof highHz !== 'number' ||
    !Number.isFinite(lowHz) ||
    !Number.isFinite(highHz) ||
    lowHz <= 0 ||
    highHz <= lowHz
  ) {
    return null;
  }

  return { lowHz, highHz };
}

export default function RapidScaleTrillScreen() {
  const currentUserId = auth.currentUser?.uid ?? null;
  const [tier, setTier] = useState<Tier | null>(null);
  const [tierLoading, setTierLoading] = useState(true);
  const [config, setConfig] = useState<AdaptiveConfig | null>(null);
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] = useState(true);
  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);
  const [vocalRangeError, setVocalRangeError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [currentRepetition, setCurrentRepetition] = useState(1);
  const [recordingTime, setRecordingTime] = useState(0);
  const [result, setResult] = useState<RapidScaleTrillResult | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [activeReferenceNoteIndex, setActiveReferenceNoteIndex] = useState<number | null>(null);
  const [activeExerciseNoteIndex, setActiveExerciseNoteIndex] = useState<number | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const samplesRef = useRef<Float32Array>(
    new Float32Array(SAMPLE_RATE * MAX_RECORDING_BUFFER_SECONDS),
  );
  const sampleCountRef = useRef(0);
  const recordingStartRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingRef = useRef(false);
  const countdownRunRef = useRef(0);
  const referenceRunRef = useRef(0);
  const referencePlayingRef = useRef(false);
  const savedAttemptRef = useRef(false);
  const repetitionStartSampleCountRef = useRef(0);
  const mountedRef = useRef(true);

  const frequencies = config?.frequencies ?? [];
  const noteDurationSec = config?.noteDurationSec ?? 0;
  const repetitions = config?.repetitions ?? RAPID_SCALE_TRILL_PARAMS.beginner.repetitions;
  const accuracyThreshold =
    config?.accuracyThreshold ?? RAPID_SCALE_TRILL_PARAMS.beginner.accuracyThreshold;
  const targetSequenceDurationSeconds = frequencies.length * noteDurationSec;
  const expectedTargetNoteCount = frequencies.length * repetitions;
  const hasUsableSequence = frequencies.length > 0 && noteDurationSec > 0;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTier() {
      setTierLoading(true);
      try {
        if (!currentUserId) {
          if (!cancelled) setTier('beginner');
          return;
        }

        const progress = await fetchComponentProgress(currentUserId, 'agility');
        const candidate = progress?.currentTier;
        if (!cancelled) setTier(isTier(candidate) ? candidate : 'beginner');
      } catch (error) {
        console.error('Failed to load Agility tier:', error);
        if (!cancelled) setTier('beginner');
      } finally {
        if (!cancelled) setTierLoading(false);
      }
    }

    void loadTier();
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParameters() {
      if (tierLoading || !tier) return;

      setIsLoadingAdaptiveParams(true);
      setConfig(null);
      setVocalRange(null);
      setVocalRangeError(null);

      try {
        if (!currentUserId) {
          setVocalRangeError(
            'Sign in and complete a vocal assessment before starting this exercise.',
          );
          return;
        }

        const [records, assessment] = await Promise.all([
          fetchExerciseRecords(currentUserId, 'agility'),
          getLatestAssessment(),
        ]);

        if (cancelled) return;

        const recentScores = records
          .filter(
            (record) =>
              record.templateId === 'rapidScaleTrill' &&
              record.tier === tier &&
              Number.isFinite(record.scorePct),
          )
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-5)
          .map((record) => record.scorePct);

        const assessedRange = getAssessmentVocalRange(assessment);
        if (!assessedRange) {
          setVocalRangeError(
            'A valid vocal range was not found in your latest assessment. Complete or update your vocal assessment, then try again.',
          );
          return;
        }

        setVocalRange(assessedRange);

        const generated = generateRapidScaleTrillParams({
          tier,
          recentScores,
          vocalRange: assessedRange,
        });

        if (!generated.frequencies.length) {
          setVocalRangeError(
            'Your assessed vocal range could not produce a suitable note sequence. Please update your vocal assessment and try again.',
          );
          return;
        }

        if (!cancelled) setConfig(generated);
      } catch (error) {
        console.error('Failed to load Rapid Scale Trill parameters:', error);
        if (!cancelled) {
          setVocalRangeError(
            'Your exercise could not be prepared. Check your assessment and connection, then try again.',
          );
        }
      } finally {
        if (!cancelled) setIsLoadingAdaptiveParams(false);
      }
    }

    void loadAdaptiveParameters();
    return () => {
      cancelled = true;
    };
  }, [currentUserId, tier, tierLoading]);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    recordingStartRef.current = null;

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      try {
        recorder.clearOnAudioReady();
      } catch {}
      try {
        void recorder.stop();
      } catch {}
    }
  }, []);

  const cancelReferencePlayback = useCallback(() => {
    referenceRunRef.current += 1;
    referencePlayingRef.current = false;
    setReferencePlaying(false);
    setActiveReferenceNoteIndex(null);
  }, []);

  const requestQuitConfirmation = useCallback(() => {
    if (confirmation !== null) return;

    if (phase === 'countdown') {
      countdownRunRef.current += 1;
      setCountdown(COUNTDOWN_SECONDS);
      setPhase('reference');
    } else if (phase === 'recording') {
      stopRecording();
      sampleCountRef.current = repetitionStartSampleCountRef.current;
      setRecordingTime(0);
      setActiveExerciseNoteIndex(null);
      setPhase('reference');
    }

    cancelReferencePlayback();
    setConfirmation('quit');
  }, [confirmation, phase, stopRecording, cancelReferencePlayback]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (confirmation !== null) {
        setConfirmation(null);
        return true;
      }
      requestQuitConfirmation();
      return true;
    });
    return () => subscription.remove();
  }, [confirmation, requestQuitConfirmation]);

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
        } catch {}
      }
    };
  }, [stopRecording]);

  const requestMicrophonePermission = async (): Promise<boolean> => {
    try {
      return (await AudioManager.requestRecordingPermissions()) === 'Granted';
    } catch (error) {
      console.warn('Microphone permission request failed:', error);
      return false;
    }
  };

  const playReference = async () => {
    if (
      referencePlayingRef.current ||
      phase !== 'reference' ||
      !hasUsableSequence ||
      isLoadingAdaptiveParams
    ) return;

    const runId = ++referenceRunRef.current;
    referencePlayingRef.current = true;
    setReferencePlaying(true);

    try {
      let context = audioContextRef.current;
      if (!context) {
        context = new AudioContext({ sampleRate: SAMPLE_RATE });
        audioContextRef.current = context;
      }
      await context.resume();

      for (const [index, frequency] of frequencies.entries()) {
        if (referenceRunRef.current !== runId) return;

        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.12;
        oscillator.connect(gain);
        gain.connect(context.destination);

        const startTime = context.currentTime;
        setActiveReferenceNoteIndex(index);
        oscillator.start(startTime);
        oscillator.stop(startTime + noteDurationSec);

        await new Promise<void>((resolve) =>
          setTimeout(resolve, noteDurationSec * 1000),
        );
        if (referenceRunRef.current === runId) setActiveReferenceNoteIndex(null);
      }
    } catch (error) {
      if (referenceRunRef.current === runId) {
        console.warn('Reference playback failed:', error);
        Alert.alert('Playback Error', 'The reference sequence could not be played. Please try again.');
      }
    } finally {
      if (referenceRunRef.current === runId) {
        referencePlayingRef.current = false;
        setReferencePlaying(false);
        setActiveReferenceNoteIndex(null);
      }
    }
  };

  const beginExercise = async () => {
    if (!hasUsableSequence || !vocalRange) {
      Alert.alert(
        'Vocal Assessment Required',
        vocalRangeError ?? 'Complete a valid vocal assessment before starting this exercise.',
      );
      return;
    }

    const permission = await requestMicrophonePermission();
    if (!permission) {
      Alert.alert(
        'Microphone Permission Required',
        'Allow microphone access to record your singing.',
      );
      return;
    }

    savedAttemptRef.current = false;
    sampleCountRef.current = 0;
    samplesRef.current = new Float32Array(SAMPLE_RATE * MAX_RECORDING_BUFFER_SECONDS);
    setCurrentRepetition(1);
    setRecordingTime(0);
    setResult(null);
    setActiveExerciseNoteIndex(null);
    setActiveReferenceNoteIndex(null);
    setPhase('reference');
  };

  const showZeroScoreResult = (feedback: string, durationMs: number) => {
    const targetNoteCount = expectedTargetNoteCount;
    const zeroResult: RapidScaleTrillResult = {
      overall: 0,
      pitchScore: 0,
      sequenceScore: 0,
      transitionScore: 0,
      speedScore: 0,
      passed: false,
      feedback,
      noteCount: targetNoteCount,
      correctNoteCount: 0,
      transitionCount: Math.max(0, targetNoteCount - 1),
      correctTransitionCount: 0,
      averageTransitionTimeMs: 0,
      notesPerSecond: 0,
      durationMs: Math.max(0, durationMs),
    };
    setResult(zeroResult);
    setPhase('results');

    if (tier && !savedAttemptRef.current) {
      savedAttemptRef.current = true;
      void saveCompletedExercise('agility', 'rapidScaleTrill', tier, 0).catch((error) =>
        console.error('Failed to save Rapid Scale Trill zero score:', error),
      );
    }
  };

  const processRecording = async () => {
    if (processingRef.current || !config) return;

    processingRef.current = true;
    stopRecording();
    setActiveExerciseNoteIndex(null);
    setPhase('processing');

    try {
      const sampleCount = sampleCountRef.current;
      if (sampleCount < SAMPLE_RATE * MIN_RECORDING_SECONDS) {
        showZeroScoreResult(
          'Your recording was too short to detect singing. Your score is 0%. Please sing the full pattern and try again.',
          (sampleCount / SAMPLE_RATE) * 1000,
        );
        return;
      }

      const samples = samplesRef.current.subarray(0, sampleCount);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
      const rms = Math.sqrt(sumSquares / samples.length);

      if (rms < MIN_RECORDING_RMS) {
        showZeroScoreResult(
          'No clear singing was detected. Move closer to the microphone and sing in a quiet area.',
          (sampleCount / SAMPLE_RATE) * 1000,
        );
        return;
      }

      const measurement = measureRapidScaleTrill(
        samples,
        SAMPLE_RATE,
        config.frequencies,
        config.repetitions,
      );
      const scored = scoreRapidScaleTrill(measurement, config.accuracyThreshold);

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
        correctTransitionCount: measurement.correctTransitionCount,
        averageTransitionTimeMs: measurement.averageTransitionTimeMs,
        notesPerSecond: measurement.notesPerSecond,
        durationMs: measurement.durationMs,
      };

      setResult(finalResult);
      setPhase('results');

      if (tier && !savedAttemptRef.current) {
        savedAttemptRef.current = true;
        void saveCompletedExercise('agility', 'rapidScaleTrill', tier, scored.overall)
          .then(() => console.log('Rapid Scale Trill progress saved:', scored.overall))
          .catch((error) => console.error('Failed to save Rapid Scale Trill progress:', error));
      }
    } catch (error) {
      console.error('Rapid Scale Trill processing failed:', error);
      setPhase('instructions');
      Alert.alert(
        'Recording Not Processed',
        error instanceof Error ? error.message : 'Unable to process the recording. Please try again.',
        [{ text: 'Try Again', onPress: resetExercise }],
      );
    } finally {
      processingRef.current = false;
    }
  };

  const startRecording = async () => {
    if (!config) return;

    try {
      processingRef.current = false;
      repetitionStartSampleCountRef.current = sampleCountRef.current;
      const recorder = new AudioRecorder();
      recorderRef.current = recorder;

      const callbackResult = recorder.onAudioReady(
        { sampleRate: SAMPLE_RATE, bufferLength: BUFFER_SIZE, channelCount: 1 },
        ({ buffer, numFrames }) => {
          if (recorderRef.current !== recorder) return;
          try {
            const channelData = buffer.getChannelData(0);
            const frameCount = Math.min(numFrames, channelData.length);
            const remaining = samplesRef.current.length - sampleCountRef.current;
            const count = Math.min(frameCount, remaining);
            for (let i = 0; i < count; i++) {
              samplesRef.current[sampleCountRef.current + i] = channelData[i];
            }
            sampleCountRef.current += count;
          } catch (error) {
            console.warn('Failed to capture audio frame:', error);
          }
        },
      );

      if (callbackResult.status === 'error') throw new Error(callbackResult.message);
      const startResult = await recorder.start();
      if (startResult.status === 'error') throw new Error(startResult.message);

      recordingStartRef.current = Date.now();
      setRecordingTime(0);
      setPhase('recording');

      recordingTimerRef.current = setInterval(() => {
        const startedAt = recordingStartRef.current;
        if (startedAt === null || processingRef.current) return;

        const elapsed = (Date.now() - startedAt) / 1000;
        setRecordingTime(Math.min(elapsed, targetSequenceDurationSeconds));

        const noteDurationMs = Math.max(1, noteDurationSec * 1000);
        const sequenceDurationMs = noteDurationMs * frequencies.length;
        const elapsedMs = elapsed * 1000;

        if (frequencies.length > 0 && elapsedMs < sequenceDurationMs) {
          const positionInSequence = elapsedMs % sequenceDurationMs;
          setActiveExerciseNoteIndex(
            Math.min(frequencies.length - 1, Math.floor(positionInSequence / noteDurationMs)),
          );
        } else {
          setActiveExerciseNoteIndex(null);
        }

        if (elapsed >= targetSequenceDurationSeconds) {
          setActiveExerciseNoteIndex(null);
          stopRecording();

          if (currentRepetition < repetitions) {
            setCurrentRepetition((previous) => previous + 1);
            setPhase('reference');
          } else {
            void processRecording();
          }
        }
      }, 30);
    } catch (error) {
      console.error('Failed to start recording:', error);
      stopRecording();
      Alert.alert(
        'Recording Error',
        error instanceof Error ? error.message : 'The recording could not be started. Please try again.',
      );
      setPhase('reference');
    }
  };

  const startCountdown = async () => {
    if (referencePlayingRef.current || phase !== 'reference' || !hasUsableSequence) return;

    const runId = ++countdownRunRef.current;
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');

    for (let value = COUNTDOWN_SECONDS; value >= 1; value--) {
      if (countdownRunRef.current !== runId) return;
      setCountdown(value);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }

    if (countdownRunRef.current !== runId) return;
    await startRecording();
  };

  const resetExercise = () => {
    countdownRunRef.current += 1;
    cancelReferencePlayback();
    stopRecording();
    processingRef.current = false;
    savedAttemptRef.current = false;
    sampleCountRef.current = 0;
    samplesRef.current = new Float32Array(SAMPLE_RATE * MAX_RECORDING_BUFFER_SECONDS);
    setResult(null);
    setRecordingTime(0);
    setCountdown(COUNTDOWN_SECONDS);
    setCurrentRepetition(1);
    setActiveReferenceNoteIndex(null);
    setActiveExerciseNoteIndex(null);
    setPhase('instructions');
  };

  const renderInstructions = () => (
    <ExerciseScreen
      title="Rapid Scale Trill"
      category="Vocal Agility"
      icon="flash-outline"
      instructions="Listen to the reference scale pattern, then sing the notes in order while keeping each pitch clear and controlled."
      preparationSteps={[
        { icon: 'volume-mute-outline', text: 'Find a quiet area with minimal background noise.' },
        { icon: 'body-outline', text: 'Sit or stand upright with relaxed shoulders.' },
        { icon: 'mic-outline', text: 'Keep a comfortable distance from the microphone.' },
      ]}
      summary={[
        { label: 'DIFFICULTY', value: config?.label ?? (tier ?? 'beginner') },
        { label: 'SPEED', value: config?.speedLabel ?? '—' },
        { label: 'NOTES', value: String(frequencies.length) },
        { label: 'REPETITIONS', value: String(repetitions) },
        { label: 'NOTE DURATION', value: config ? `${config.noteDurationSec.toFixed(2)}s` : '—' },
        { label: 'SEQUENCE', value: frequencies.map(frequencyToNoteName).join(' • ') || 'Unavailable' },
      ]}
      tip={
        vocalRangeError ??
        'Focus on clean pitch changes first. Build speed naturally while maintaining accuracy.'
      }
      tier={tier ?? 'beginner'}
      startDisabled={tierLoading || isLoadingAdaptiveParams || !hasUsableSequence || !vocalRange}
      startLabel={
        tierLoading || isLoadingAdaptiveParams
          ? 'Preparing Exercise...'
          : !vocalRange || !hasUsableSequence
            ? 'Vocal Assessment Required'
            : 'Start Exercise'
      }
      onBack={requestQuitConfirmation}
      onStart={beginExercise}
    />
  );

  const renderReference = () => (
    <View style={styles.content}>
      <Pressable style={styles.backButton} onPress={requestQuitConfirmation}>
        <Ionicons name="chevron-back" size={25} color={BROWN} />
      </Pressable>
      <View style={styles.iconCircle}>
        <Ionicons name="musical-notes-outline" size={34} color={BROWN} />
      </View>
      <Text style={styles.phaseTitle}>Listen to the Reference</Text>
      <Text style={styles.phaseSubtitle}>
        Repetition {currentRepetition} of {repetitions}. Listen to the sequence generated from your assessed vocal range.
      </Text>

      <View style={styles.referenceCard}>
        <Text style={styles.cardTitle}>Reference Sequence</Text>
        <View style={styles.noteSequence}>
          {frequencies.map((frequency, index) => {
            const active = activeReferenceNoteIndex === index;
            return (
              <View key={`${frequency}-${index}`} style={[styles.notePill, active && styles.notePillActive]}>
                <Text style={[styles.noteNumber, active && styles.activeText]}>{index + 1}</Text>
                <Text style={[styles.noteText, active && styles.activeText]}>{frequencyToNoteName(frequency)}</Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.referenceHint}>
          Range: {vocalRange?.lowHz.toFixed(0)}–{vocalRange?.highHz.toFixed(0)} Hz
        </Text>
      </View>

      <Pressable
        style={[styles.startButton, referencePlaying && styles.disabledButton]}
        disabled={referencePlaying}
        onPress={() => void playReference()}
      >
        {referencePlaying ? <ActivityIndicator color={WHITE} /> : <Ionicons name="play" size={20} color={WHITE} />}
        <Text style={styles.startButtonText}>{referencePlaying ? 'Playing Reference...' : 'Play Reference'}</Text>
      </Pressable>
      <Pressable
        style={[styles.doneButton, referencePlaying && styles.disabledButton]}
        disabled={referencePlaying}
        onPress={() => void startCountdown()}
      >
        <Text style={styles.doneButtonText}>Start Repetition {currentRepetition}</Text>
      </Pressable>
    </View>
  );

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}><Ionicons name="flash-outline" size={34} color={BROWN} /></View>
      <Text style={styles.phaseTitle}>Get Ready</Text>
      <Text style={styles.countdownText}>{countdown}</Text>
      <Text style={styles.phaseSubtitle}>Prepare for repetition {currentRepetition} of {repetitions}.</Text>
    </View>
  );

  const renderRecording = () => {
    const progress = targetSequenceDurationSeconds > 0
      ? Math.min(recordingTime / targetSequenceDurationSeconds, 1)
      : 0;

    return (
      <View style={styles.content}>
        <View style={styles.iconCircle}><Ionicons name="mic" size={34} color={BROWN} /></View>
        <Text style={styles.phaseTitle}>Sing the Scale</Text>
        <Text style={styles.phaseSubtitle}>
          Repetition {currentRepetition} of {repetitions}. Follow the note sequence and sing each pitch clearly.
        </Text>
        <View style={styles.recordingBadge}><View style={styles.recordingDot} /><Text style={styles.recordingBadgeText}>RECORDING</Text></View>

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>REPETITION {currentRepetition} OF {repetitions}</Text>
          <Text style={styles.liveCurrentNote}>{recordingTime.toFixed(1)}s</Text>
          <View style={styles.liveDivider} />
          <Text style={styles.cardTitle}>Sing This Sequence</Text>
          <View style={styles.noteSequence}>
            {frequencies.map((frequency, index) => {
              const active = activeExerciseNoteIndex === index;
              return (
                <View key={`${frequency}-${index}`} style={[styles.notePill, active && styles.notePillActive]}>
                  <Text style={[styles.noteNumber, active && styles.activeText]}>{index + 1}</Text>
                  <Text style={[styles.noteText, active && styles.activeText]}>{frequencyToNoteName(frequency)}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <Text style={styles.timerText}>Recording Time: {recordingTime.toFixed(1)}s / {targetSequenceDurationSeconds.toFixed(1)}s</Text>
        <View style={styles.timerTrack}><View style={[styles.timerFill, { width: `${progress * 100}%` }]} /></View>
        <Pressable style={styles.finishButton} onPress={() => void processRecording()}>
          <Ionicons name="stop" size={18} color={BROWN} />
          <Text style={styles.finishButtonText}>Finish Recording</Text>
        </Pressable>
      </View>
    );
  };

  const renderProcessing = () => (
    <View style={styles.centerScreen}>
      <ActivityIndicator size="large" color={BROWN} />
      <Text style={styles.phaseTitle}>Analyzing Your Singing</Text>
      <Text style={styles.phaseSubtitle}>Measuring pitch accuracy, sequence accuracy, transitions, and speed.</Text>
    </View>
  );

  const renderResults = () => {
    if (!result) return null;
    const rows = [
      { label: 'Pitch Accuracy', score: result.pitchScore },
      { label: 'Sequence Accuracy', score: result.sequenceScore },
      { label: 'Transition Accuracy', score: result.transitionScore },
      { label: 'Speed Score', score: result.speedScore },
    ];

    return (
      <View style={styles.resultsContent}>
        <View style={styles.iconCircle}>
          <Ionicons name={result.passed ? 'checkmark' : 'refresh'} size={40} color={BROWN} />
        </View>
        <Text style={styles.resultTitle}>{result.passed ? 'Great Job!' : 'Keep Practicing!'}</Text>
        <Text style={styles.phaseSubtitle}>Rapid Scale Trill Result</Text>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>OVERALL SCORE</Text>
          <Text style={styles.scoreValue}>{Math.round(result.overall)}</Text>
          <Text style={styles.scoreDescription}>out of 100</Text>
        </View>
        <View style={styles.referenceCard}>
          <Text style={styles.cardTitle}>Performance Breakdown</Text>
          {rows.map((row) => (
            <View key={row.label} style={styles.scoreRow}>
              <View style={styles.scoreRowHeader}>
                <Text style={styles.metricLabel}>{row.label}</Text>
                <Text style={styles.metricValue}>{Math.round(row.score)}%</Text>
              </View>
              <View style={styles.timerTrack}>
                <View style={[styles.timerFill, { width: `${Math.min(100, Math.max(0, row.score))}%` }]} />
              </View>
            </View>
          ))}
        </View>
        <View style={styles.referenceCard}>
          <Text style={styles.cardTitle}>Performance Metrics</Text>
          <MetricRow label="Correct Notes" value={`${result.correctNoteCount}/${result.noteCount}`} />
          <MetricRow label="Correct Transitions" value={`${result.correctTransitionCount}/${result.transitionCount}`} />
          <MetricRow label="Average Transition" value={`${Math.round(result.averageTransitionTimeMs)} ms`} />
          <MetricRow label="Notes per Second" value={result.notesPerSecond.toFixed(2)} />
          <MetricRow label="Duration" value={`${(result.durationMs / 1000).toFixed(1)}s`} />
        </View>
        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={20} color={BROWN} />
          <Text style={styles.tipText}>{result.feedback}</Text>
        </View>
        <Pressable style={styles.startButton} onPress={() => setConfirmation('tryAgain')}>
          <Ionicons name="refresh" size={18} color={WHITE} />
          <Text style={styles.startButtonText}>Try Again</Text>
        </Pressable>
        <Pressable style={styles.doneButton} onPress={() => setConfirmation('quit')}>
          <Text style={styles.doneButtonText}>Back to Exercises</Text>
        </Pressable>
      </View>
    );
  };

  if (tierLoading || isLoadingAdaptiveParams) {
    return (
      <View style={styles.preparingScreen}>
        <View style={styles.iconCircle}><Ionicons name="options-outline" size={40} color={BROWN} /></View>
        <Text style={styles.phaseTitle}>Preparing Your Exercise</Text>
        <Text style={styles.phaseSubtitle}>Loading your difficulty level and vocal range from your assessment.</Text>
        <ActivityIndicator size="large" color={BROWN} style={{ marginTop: 24 }} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={phase === 'results' ? styles.resultsWrapper : undefined}
      showsVerticalScrollIndicator={false}
    >
      {phase === 'instructions' && renderInstructions()}
      {phase === 'reference' && renderReference()}
      {phase === 'countdown' && renderCountdown()}
      {phase === 'recording' && renderRecording()}
      {phase === 'processing' && renderProcessing()}
      {phase === 'results' && renderResults()}

      <Modal
        transparent
        visible={confirmation !== null}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setConfirmation(null)}
      >
        <View style={styles.confirmationOverlay}>
          <View style={styles.confirmationCard}>
            <View style={styles.iconCircle}>
              <Ionicons name={confirmation === 'tryAgain' ? 'refresh' : 'log-out-outline'} size={25} color={BROWN} />
            </View>
            <Text style={styles.confirmationTitle}>{confirmation === 'tryAgain' ? 'Try again?' : 'Quit exercise?'}</Text>
            <Text style={styles.confirmationMessage}>
              {confirmation === 'tryAgain'
                ? 'Are you sure you want to restart this exercise?'
                : 'Are you sure you want to leave this exercise?'}
            </Text>
            <Pressable
              style={styles.startButton}
              onPress={() => {
                const action = confirmation;
                setConfirmation(null);
                if (action === 'tryAgain') resetExercise();
                else if (action === 'quit') {
                  cancelReferencePlayback();
                  stopRecording();
                  router.replace('/exercises/breath-control');
                }
              }}
            >
              <Text style={styles.startButtonText}>{confirmation === 'tryAgain' ? 'Restart Exercise' : 'Quit Exercise'}</Text>
            </Pressable>
            <Pressable style={styles.doneButton} onPress={() => setConfirmation(null)}>
              <Text style={styles.doneButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: WHITE },
  preparingScreen: { flex: 1, minHeight: 600, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: WHITE },
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 88, paddingBottom: 48, backgroundColor: WHITE },
  resultsContent: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 72, paddingBottom: 48, backgroundColor: WHITE },
  resultsWrapper: { flexGrow: 1, width: '100%' },
  centerScreen: { flexGrow: 1, minHeight: 620, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: WHITE },
  backButton: { position: 'absolute', top: 48, left: 24, zIndex: 2, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: LIGHT_PINK },
  iconCircle: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: PINK, marginBottom: 18 },
  phaseTitle: { fontFamily: 'FredokaBold', fontSize: 25, color: BROWN, textAlign: 'center', marginTop: 10 },
  phaseSubtitle: { fontFamily: 'FredokaRegular', fontSize: 13, lineHeight: 20, color: MUTED, textAlign: 'center', marginTop: 8, maxWidth: 330 },
  referenceCard: { width: '100%', padding: 18, borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: LIGHT_PINK, marginTop: 20 },
  cardTitle: { fontFamily: 'FredokaBold', fontSize: 18, color: BROWN, marginBottom: 12 },
  noteSequence: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  notePill: { minWidth: 54, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: PINK },
  notePillActive: { backgroundColor: '#E85D83', borderWidth: 1, borderColor: '#C93E68' },
  activeText: { color: WHITE },
  noteNumber: { fontFamily: 'FredokaBold', fontSize: 12, color: MUTED, marginBottom: 2 },
  noteText: { fontFamily: 'FredokaBold', fontSize: 13, color: BROWN },
  referenceHint: { fontFamily: 'FredokaRegular', fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 14 },
  startButton: { width: '100%', minHeight: 52, borderRadius: 26, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: BROWN, marginTop: 14 },
  startButtonText: { fontFamily: 'FredokaBold', fontSize: 15, color: WHITE },
  doneButton: { width: '100%', minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: LIGHT_GRAY, marginTop: 10 },
  doneButtonText: { fontFamily: 'FredokaBold', fontSize: 15, color: BROWN },
  disabledButton: { opacity: 0.5 },
  countdownText: { fontFamily: 'FredokaBold', fontSize: 76, color: BROWN, marginTop: 20 },
  recordingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: LIGHT_PINK, borderWidth: 1, borderColor: BORDER, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 13, marginTop: 18 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C93E68', marginRight: 7 },
  recordingBadgeText: { fontFamily: 'FredokaBold', fontSize: 10, color: BROWN, letterSpacing: 0.7 },
  liveCard: { width: '100%', alignItems: 'center', backgroundColor: LIGHT_PINK, borderRadius: 20, padding: 18, marginTop: 20, borderWidth: 1, borderColor: BORDER },
  liveLabel: { fontFamily: 'FredokaRegular', fontSize: 10, color: MUTED, letterSpacing: 0.7 },
  liveCurrentNote: { fontFamily: 'FredokaBold', fontSize: 38, color: BROWN, marginTop: 4 },
  liveDivider: { height: 1, alignSelf: 'stretch', backgroundColor: BORDER, marginVertical: 14 },
  timerText: { fontFamily: 'FredokaRegular', fontSize: 11, color: MUTED, marginTop: 18, marginBottom: 7, textAlign: 'center' },
  timerTrack: { width: '100%', height: 8, backgroundColor: LIGHT_GRAY, borderRadius: 4, overflow: 'hidden', marginTop: 5 },
  timerFill: { height: '100%', backgroundColor: '#E85D83', borderRadius: 4 },
  finishButton: { width: '100%', minHeight: 52, borderRadius: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: LIGHT_GRAY, marginTop: 18 },
  finishButtonText: { fontFamily: 'FredokaBold', fontSize: 15, color: BROWN },
  preparingTitle: { fontFamily: 'FredokaBold', fontSize: 25, color: BROWN, textAlign: 'center' },
  preparingSubtitle: { fontFamily: 'FredokaRegular', fontSize: 14, lineHeight: 21, color: MUTED, textAlign: 'center', marginTop: 8 },
  resultTitle: { fontFamily: 'FredokaBold', fontSize: 27, color: BROWN, textAlign: 'center' },
  scoreCard: { width: '100%', alignItems: 'center', backgroundColor: PINK, borderRadius: 22, padding: 22, marginTop: 20 },
  scoreLabel: { fontFamily: 'FredokaRegular', fontSize: 12, color: BROWN },
  scoreValue: { fontFamily: 'FredokaBold', fontSize: 52, color: BROWN, marginVertical: 3 },
  scoreDescription: { fontFamily: 'FredokaRegular', fontSize: 11, color: MUTED },
  scoreRow: { marginBottom: 14 },
  scoreRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  metricRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  metricLabel: { flex: 1, fontFamily: 'FredokaRegular', fontSize: 12, color: MUTED },
  metricValue: { fontFamily: 'FredokaBold', fontSize: 12, color: BROWN, marginLeft: 12, textAlign: 'right' },
  tipCard: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 15, borderRadius: 18, backgroundColor: PINK, marginTop: 14 },
  tipText: { flex: 1, fontFamily: 'FredokaRegular', fontSize: 12, lineHeight: 18, color: BROWN },
  confirmationOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, backgroundColor: 'rgba(0,0,0,0.45)' },
  confirmationCard: { width: '100%', maxWidth: 380, alignItems: 'center', padding: 24, borderRadius: 24, backgroundColor: WHITE },
  confirmationTitle: { fontFamily: 'FredokaBold', fontSize: 23, color: BROWN, textAlign: 'center' },
  confirmationMessage: { fontFamily: 'FredokaRegular', fontSize: 14, lineHeight: 21, color: MUTED, textAlign: 'center', marginTop: 9, marginBottom: 12 },
});
