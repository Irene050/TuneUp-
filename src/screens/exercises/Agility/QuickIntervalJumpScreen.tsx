import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  QUICK_INTERVAL_JUMP_PARAMS,
  type Tier,
} from '@/constants/agility';
import ExerciseScreen from '@/screens/exercises/ExerciseScreen';
import { generateQuickIntervalJumpParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureQuickIntervalJump } from '@/services/measurement/agility/quickIntervalJump';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreQuickIntervalJump } from '@/services/scoring/agility/quickIntervalJump';
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
const MAX_RECORDING_SECONDS = 15;
const MAX_SAMPLE_COUNT = SAMPLE_RATE * MAX_RECORDING_SECONDS;
const COUNTDOWN_SECONDS = 3;

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

type QuickIntervalJumpSettings = {
  noteDurationSec: number;
  gapSec: number;
  repetitions: number;
  accuracyTarget: number;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const getQuickIntervalJumpSettings = (
  tier: Tier,
): QuickIntervalJumpSettings => {
  switch (tier) {
    case 'beginner':
      return {
        noteDurationSec: 0.5,
        gapSec: 0.1,
        repetitions: 3,
        accuracyTarget: 60,
      };
    case 'intermediate':
      return {
        noteDurationSec: 0.4,
        gapSec: 0.1,
        repetitions: 4,
        accuracyTarget: 70,
      };
    case 'advanced':
      return {
        noteDurationSec: 0.3,
        gapSec: 0.1,
        repetitions: 5,
        accuracyTarget: 80,
      };
  }
};

export default function QuickIntervalJumpScreen() {
  const [tier, setTier] = useState<Tier>('beginner');
  const [tierLoading, setTierLoading] = useState(true);
  const [adaptiveConfig, setAdaptiveConfig] = useState(
    QUICK_INTERVAL_JUMP_PARAMS.beginner,
  );
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);
  const [isPreparingResume, setIsPreparingResume] = useState(false);
  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [recordingTime, setRecordingTime] = useState(0);
  const [currentRepetition, setCurrentRepetition] = useState(1);
  const [isPlayingReference, setIsPlayingReference] = useState(false);
  const [activeReferenceNoteIndex, setActiveReferenceNoteIndex] =
    useState<number | null>(null);
  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [confirmation, setConfirmation] = useState<'tryAgain' | 'backToExercises' | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const samplesRef = useRef<number[]>([]);
  const recordingStartRef = useRef<number | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const countdownTokenRef = useRef(0);
  const playbackTokenRef = useRef(0);
  const referencePlayingRef = useRef(false);
  const repetitionSampleStartRef = useRef(0);
  const pausedRepetitionRef = useRef(1);

  const { noteDurationSec, gapSec, repetitions, accuracyTarget } =
    getQuickIntervalJumpSettings(tier);

  const notesPerRepetition = adaptiveConfig.frequencies.length;
  const totalTargetNoteCount = notesPerRepetition * repetitions;

  const repetitionDurationSec =
    notesPerRepetition * noteDurationSec +
    Math.max(0, notesPerRepetition - 1) * gapSec;

  useEffect(() => {
    let cancelled = false;

    const loadComponentTier = async () => {
      const user = auth.currentUser;

      if (!user) {
        setTier('beginner');
        setTierLoading(false);
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
        console.warn('Failed to load agility component tier:', error);

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

  useEffect(() => {
    if (tierLoading) {
      return;
    }

    let cancelled = false;

    const loadAdaptiveParameters = async () => {
      setIsLoadingAdaptiveParams(true);

      const baseParams = {
        ...QUICK_INTERVAL_JUMP_PARAMS[tier],
        accuracyThreshold: accuracyTarget,
      };

      setAdaptiveConfig(baseParams);

      const user = auth.currentUser;

      if (!user) {
        setIsLoadingAdaptiveParams(false);
        return;
      }

      let recentScores: number[] = [];
      let vocalRange: { lowHz: number; highHz: number } | null = null;

      try {
        const records = await fetchExerciseRecords(user.uid, 'agility');

        if (cancelled) {
          return;
        }

        recentScores = records
          .filter(
            (record) =>
              record.templateId === 'quickIntervalJump' &&
              record.tier === tier,
          )
          .slice(-5)
          .map((record) => record.scorePct);
      } catch (error) {
        console.warn(
          'Could not load Quick Interval Jump score history:',
          error,
        );
      }

      try {
        const assessment = await getLatestAssessment();

        if (cancelled) {
          return;
        }

        const lowHz =
          assessment?.vocalRange?.lowHz ??
          assessment?.vocalRangeLowHz;

        const highHz =
          assessment?.vocalRange?.highHz ??
          assessment?.vocalRangeHighHz;

        if (
          typeof lowHz === 'number' &&
          Number.isFinite(lowHz) &&
          lowHz > 0 &&
          typeof highHz === 'number' &&
          Number.isFinite(highHz) &&
          highHz > lowHz
        ) {
          vocalRange = { lowHz, highHz };
        }
      } catch (error) {
        console.warn(
          'Could not load the latest assessment vocal range:',
          error,
        );
      }

      if (cancelled) {
        return;
      }

      try {
        const generatedParams = generateQuickIntervalJumpParams({
          tier,
          recentScores,
          vocalRange,
        });

        setAdaptiveConfig({
          ...generatedParams,
          accuracyThreshold: accuracyTarget,
        });
      } catch (error) {
        console.warn(
          'Failed to generate Quick Interval Jump adaptive parameters:',
          error,
        );
        setAdaptiveConfig(baseParams);
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
  }, [tier, tierLoading, accuracyTarget]);

  const requestMicrophonePermission =
    useCallback(async (): Promise<boolean> => {
      try {
        const permission =
          await AudioManager.requestRecordingPermissions();

        return permission === 'Granted';
      } catch (error) {
        console.warn('Microphone permission request failed:', error);
        return false;
      }
    }, []);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingStartRef.current = null;

    const recorder = recorderRef.current;

    if (!recorder) {
      return;
    }

    try {
      recorder.clearOnAudioReady();
    } catch {}

    try {
      void recorder.stop();
    } catch {}

    recorderRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
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

      for (const [index, frequency] of adaptiveConfig.frequencies.entries()) {
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

        setActiveReferenceNoteIndex(index);

        await sleep(noteDurationSec * 1000);

        if (
          mountedRef.current &&
          playbackToken === playbackTokenRef.current
        ) {
          setActiveReferenceNoteIndex(null);
        }

        await sleep(gapSec * 1000);
      }
    } catch (error) {
      console.warn('Reference playback failed:', error);
    } finally {
      if (playbackToken === playbackTokenRef.current) {
        referencePlayingRef.current = false;

        if (mountedRef.current) {
          setIsPlayingReference(false);
          setActiveReferenceNoteIndex(null);
        }
      }
    }
  };

  const beginExercise = async () => {
    if (tierLoading || isLoadingAdaptiveParams) {
      return;
    }

    const permission = await requestMicrophonePermission();

    if (!mountedRef.current) {
      return;
    }

    if (!permission) {
      console.warn('Microphone permission was not granted.');
      return;
    }

    setResult(null);
    setPhase('reference');
  };

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

    playbackTokenRef.current += 1;

    setCountdown(COUNTDOWN_SECONDS);
    setRecordingTime(0);
    setResult(null);
    if (currentRepetition === 1) {
      samplesRef.current = [];
    }
    repetitionSampleStartRef.current = samplesRef.current.length;
    processingRef.current = false;
    setPhase('countdown');

    for (let value = COUNTDOWN_SECONDS; value >= 1; value--) {
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

  const processRecording = async () => {
    if (processingRef.current || !mountedRef.current) {
      return;
    }

    processingRef.current = true;
    countdownTokenRef.current += 1;

    stopRecording();
    setPhase('processing');

    await sleep(250);

    if (!mountedRef.current) {
      processingRef.current = false;
      return;
    }

    try {
      const samples = new Float32Array(samplesRef.current);
      const targetFrequencies = Array.from(
        { length: repetitions },
        () => adaptiveConfig.frequencies,
      ).flat();

      const measurement = measureQuickIntervalJump(
        samples,
        SAMPLE_RATE,
        targetFrequencies,
      );

      const scored = scoreQuickIntervalJump(measurement);
      const finalScore = Math.round(scored.overall);
      const accuracyScore =
        (scored.pitchScore + scored.intervalScore) / 2;
      const passed = accuracyScore >= accuracyTarget;

      const feedback =
        passed === scored.passed
          ? scored.feedback
          : passed
            ? `You met the ${accuracyTarget}% accuracy target for the ${tier} level. Keep practicing smooth, precise interval jumps.`
            : `Aim for at least ${accuracyTarget}% accuracy for the ${tier} level. Sing each repeated sequence in order and focus on precise interval jumps.`;

      try {
        await saveCompletedExercise(
          'agility',
          'quickIntervalJump',
          tier,
          finalScore,
        );

        console.log('Quick Interval Jump progress save call completed:', {
          componentId: 'agility',
          templateId: 'quickIntervalJump',
          tier,
          scorePct: finalScore,
        });
      } catch (error) {
        console.error(
          'Failed to save Quick Interval Jump progress:',
          error,
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
        passed,
        feedback,
        noteCount: measurement.noteCount,
        correctNoteCount: measurement.correctNoteCount,
        transitionCount: measurement.transitionCount,
        correctTransitionCount: measurement.correctTransitionCount,
        averageTransitionTimeMs: measurement.averageTransitionTimeMs,
        durationMs: measurement.durationMs,
      });

      setPhase('results');
    } catch (error) {
      console.warn('Quick Interval Jump processing failed:', error);

      if (mountedRef.current) {
        setPhase('instructions');
      }
    } finally {
      processingRef.current = false;
    }
  };

  const startRecording = async (countdownToken: number) => {
    if (
      !mountedRef.current ||
      countdownToken !== countdownTokenRef.current
    ) {
      return;
    }

    try {
      processingRef.current = false;
      repetitionSampleStartRef.current = samplesRef.current.length;

      const recorder = new AudioRecorder();
      recorderRef.current = recorder;

      const callbackResult = recorder.onAudioReady(
        {
          sampleRate: SAMPLE_RATE,
          bufferLength: BUFFER_SIZE,
          channelCount: 1,
        },
        ({ buffer, numFrames }) => {
          if (
            recorderRef.current !== recorder ||
            processingRef.current
          ) {
            return;
          }

          try {
            const channelData = buffer.getChannelData(0);
            const frameCount = Math.min(
              numFrames,
              channelData.length,
            );
            const remaining =
              MAX_SAMPLE_COUNT - samplesRef.current.length;
            const samplesToCopy = Math.min(
              frameCount,
              Math.max(0, remaining),
            );

            for (let index = 0; index < samplesToCopy; index++) {
              samplesRef.current.push(channelData[index]);
            }
          } catch (error) {
            console.warn('Could not read microphone audio buffer:', error);
          }
        },
      );

      if (callbackResult.status === 'error') {
        console.warn(
          'Could not initialize microphone recording:',
          callbackResult.message,
        );

        stopRecording();

        if (mountedRef.current) {
          setPhase('instructions');
        }

        return;
      }

      if (
        !mountedRef.current ||
        countdownToken !== countdownTokenRef.current
      ) {
        stopRecording();
        return;
      }

      const startResult = await recorder.start();

      if (startResult.status === 'error') {
        console.warn('Could not start recorder:', startResult.message);

        stopRecording();

        if (mountedRef.current) {
          setPhase('instructions');
        }

        return;
      }

      if (
        !mountedRef.current ||
        countdownToken !== countdownTokenRef.current ||
        recorderRef.current !== recorder
      ) {
        stopRecording();
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

        setRecordingTime(Math.min(elapsed, repetitionDurationSec));

        if (elapsed >= repetitionDurationSec) {
          stopRecording();

          if (currentRepetition < repetitions) {
            setCurrentRepetition(previous => previous + 1);
            setRecordingTime(0);
            setPhase('reference');
          } else {
            void processRecording();
          }
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

  const resetExercise = () => {
    countdownTokenRef.current += 1;
    playbackTokenRef.current += 1;
    referencePlayingRef.current = false;

    setIsPlayingReference(false);
    setActiveReferenceNoteIndex(null);

    processingRef.current = false;
    stopRecording();

    samplesRef.current = [];
    setResult(null);
    setRecordingTime(0);
    setCurrentRepetition(1);
    repetitionSampleStartRef.current = 0;
    pausedRepetitionRef.current = 1;
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('instructions');
  };

  const confirmTryAgain = () => {
    setConfirmation('tryAgain');
  };

  const confirmBackToExercises = () => {
    if (confirmation !== null || phase === 'processing') {
      return;
    }

    pausedRepetitionRef.current = currentRepetition;
    countdownTokenRef.current += 1;
    playbackTokenRef.current += 1;
    referencePlayingRef.current = false;
    setIsPlayingReference(false);
    setActiveReferenceNoteIndex(null);

    if (phase === 'recording') {
      samplesRef.current = samplesRef.current.slice(
        0,
        repetitionSampleStartRef.current,
      );
      stopRecording();
      setRecordingTime(0);
      setPhase('reference');
    } else if (phase === 'countdown') {
      setRecordingTime(0);
      setPhase('reference');
    }

    setConfirmation('backToExercises');
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (confirmation !== null || phase === 'processing') {
          return true;
        }

        confirmBackToExercises();
        return true;
      },
    );

    return () => subscription.remove();
  }, [confirmation, phase, currentRepetition]);

  const closeConfirmation = () => {
    const action = confirmation;
    setConfirmation(null);

    if (action === 'backToExercises' && phase !== 'results') {
      setCurrentRepetition(pausedRepetitionRef.current);
      setRecordingTime(0);
      setCountdown(COUNTDOWN_SECONDS);
      processingRef.current = false;
      setPhase('reference');
      setIsPreparingResume(true);
      setTimeout(() => setIsPreparingResume(false), 900);
    }
  };

  const handleConfirmation = () => {
    const action = confirmation;
    setConfirmation(null);

    if (action === 'tryAgain') {
      resetExercise();
    } else if (action === 'backToExercises') {
      router.replace('/exercises/agility' as any);
    }
  };

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
        { label: 'NOTES', value: String(notesPerRepetition) },
        { label: 'REPETITIONS', value: String(repetitions) },
        { label: 'ACCURACY TARGET', value: `${accuracyTarget}%` },
      ]}
      tip="Focus on accurate interval jumps first. Smoothness and speed should develop naturally."
      tier={tier}
      startDisabled={tierLoading || isLoadingAdaptiveParams}
      startLabel={
        tierLoading || isLoadingAdaptiveParams
          ? 'Preparing Exercise...'
          : 'Start Exercise'
      }
      onBack={() => router.back()}
      onStart={beginExercise}
    />
  );

  const renderReference = () => (
    <View style={styles.content}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="swap-horizontal-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>Listen to the Reference</Text>
      <Text style={styles.phaseSubtitle}>Repetition {currentRepetition} of {repetitions}</Text>
      <Text style={styles.phaseSubtitle}>
        Listen carefully to the note sequence, then sing the same interval
        jumps.
      </Text>

      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>REFERENCE SEQUENCE</Text>

        <View style={styles.noteSequence}>
          {adaptiveConfig.frequencies.map((frequency, index) => {
            const isActive = activeReferenceNoteIndex === index;

            return (
              <View
                key={`${frequency}-${index}`}
                style={[
                  styles.notePill,
                  isActive && styles.referenceNotePlaying,
                ]}
              >
                <Text
                  style={[
                    styles.noteNumber,
                    isActive && styles.referenceNotePlayingText,
                  ]}
                >
                  {index + 1}
                </Text>
                <Text
                  style={[
                    styles.noteText,
                    isActive && styles.referenceNotePlayingText,
                  ]}
                >
                  {frequencyToNoteName(frequency)}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.referenceHint}>
          Listen to the complete pattern before starting repetition {currentRepetition}.
        </Text>
      </View>

      <Pressable
        style={[
          styles.referenceButton,
          isPlayingReference && styles.disabledButton,
        ]}
        disabled={isPlayingReference}
        onPress={() => void playReference()}
      >
        {isPlayingReference ? (
          <ActivityIndicator size="small" color={BROWN} />
        ) : (
          <Ionicons name="play" size={18} color={BROWN} />
        )}
        <Text style={styles.referenceButtonText}>
          {isPlayingReference ? 'Playing Reference...' : 'Play Reference'}
        </Text>
      </Pressable>

      <Pressable
        style={[
          styles.startButton,
          isPlayingReference && styles.disabledButton,
        ]}
        disabled={isPlayingReference}
        onPress={() => void startCountdown()}
      >
        <Text style={styles.startButtonText}>I'm Ready</Text>
      </Pressable>
    </View>
  );

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons name="flash-outline" size={34} color={BROWN} />
      </View>
      <Text style={styles.phaseTitle}>Get Ready</Text>
      <Text style={styles.countdownText}>{countdown}</Text>
      <Text style={styles.phaseSubtitle}>
        Prepare for repetition {currentRepetition} of {repetitions}.
      </Text>
    </View>
  );

  const renderRecording = () => {
    const progress = Math.min(recordingTime / repetitionDurationSec, 1);
    const noteSlotDurationSec = noteDurationSec + gapSec;
    const noteIndexByTime = Math.floor(
      recordingTime / noteSlotDurationSec,
    );
    const timeWithinNoteSlot =
      recordingTime - noteIndexByTime * noteSlotDurationSec;

    const activeRecordingNoteIndex =
      noteIndexByTime < totalTargetNoteCount &&
      timeWithinNoteSlot < noteDurationSec
        ? noteIndexByTime % notesPerRepetition
        : null;


    return (
      <View style={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open quit exercise confirmation"
          hitSlop={10}
          style={styles.quitButtonTop}
          onPress={confirmBackToExercises}
        >
          <Ionicons name="close" size={22} color={BROWN} />
        </Pressable>

        <View style={styles.recordingIcon}>
          <Ionicons name="mic" size={34} color={BROWN} />
        </View>

        <Text style={styles.recordingTitle}>Jump Between Notes</Text>
        <Text style={styles.recordingSubtitle}>Repetition {currentRepetition} of {repetitions}</Text>
        <Text style={styles.recordingSubtitle}>
          Sing each target note clearly and make each interval change
          precise.
        </Text>

        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingBadgeText}>RECORDING</Text>
        </View>

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>RECORDING TIME</Text>
          <Text style={styles.liveCurrentNote}>
            {recordingTime.toFixed(1)}s
          </Text>

          <View style={styles.liveDivider} />

          <View style={styles.liveStats}>
            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>Target Notes</Text>
              <Text style={styles.liveStatValue}>{notesPerRepetition}</Text>
            </View>
            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>Repetition</Text>
              <Text style={styles.liveStatValue}>
                {currentRepetition}/{repetitions}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.timerText}>
          Recording Time: {recordingTime.toFixed(1)}s /{' '}
          {repetitionDurationSec.toFixed(1)}s
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
          <Text style={styles.cardTitle}>Sing This Sequence</Text>
          <Text style={styles.referenceLabel}>
            SING THE PINK NOTE WHEN IT LIGHTS UP
          </Text>

          <View style={styles.noteSequence}>
            {adaptiveConfig.frequencies.map((frequency, index) => {
              const isActive = activeRecordingNoteIndex === index;

              return (
                <View
                  key={`${frequency}-${index}`}
                  style={[
                    styles.notePill,
                    isActive && styles.referenceNotePlaying,
                  ]}
                >
                  <Text
                    style={[
                      styles.noteNumber,
                      isActive && styles.referenceNotePlayingText,
                    ]}
                  >
                    {index + 1}
                  </Text>
                  <Text
                    style={[
                      styles.noteText,
                      isActive && styles.referenceNotePlayingText,
                    ]}
                  >
                    {frequencyToNoteName(frequency)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <Pressable
          style={styles.finishButton}
          onPress={() => void processRecording()}
        >
          <Ionicons name="stop" size={18} color={BROWN} />
          <Text style={styles.finishButtonText}>Finish Recording</Text>
        </Pressable>
      </View>
    );
  };

  const renderProcessing = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <ActivityIndicator size="large" color={BROWN} />
      </View>
      <Text style={styles.phaseTitle}>Analyzing Your Singing</Text>
      <Text style={styles.phaseSubtitle}>
        Measuring pitch accuracy, interval accuracy, and transition speed.
      </Text>
    </View>
  );

  const renderScoreRow = (
    label: string,
    score: number,
    isLast = false,
  ) => (
    <View style={isLast ? styles.scoreRowLast : styles.scoreRow}>
      <View style={styles.scoreRowHeader}>
        <Text style={styles.scoreRowLabel}>{label}</Text>
        <Text style={styles.scoreRowValue}>{Math.round(score)}%</Text>
      </View>
      <View style={styles.progressBackground}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.min(100, Math.max(0, score))}%`,
            },
          ]}
        />
      </View>
    </View>
  );

  const renderMetricRow = (
    label: string,
    value: string,
    isLast = false,
  ) => (
    <View
      style={[
        styles.metricRow,
        isLast && styles.metricRowLast,
      ]}
    >
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );

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
          <Text style={styles.scoreLabel}>OVERALL SCORE</Text>
          <Text style={styles.scoreValue}>
            {Math.round(result.overall)}
          </Text>
          <Text style={styles.scoreDescription}>out of 100</Text>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Performance Breakdown
          </Text>
          {renderScoreRow('Pitch Accuracy', result.pitchScore)}
          {renderScoreRow('Interval Accuracy', result.intervalScore)}
          {renderScoreRow('Transition Speed', result.speedScore, true)}
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>Performance Metrics</Text>
          {renderMetricRow(
            'Correct Notes',
            `${result.correctNoteCount}/${result.noteCount}`,
          )}
          {renderMetricRow(
            'Correct Jumps',
            `${result.correctTransitionCount}/${result.transitionCount}`,
          )}
          {renderMetricRow(
            'Average Transition',
            `${result.averageTransitionTimeMs > 0 ? result.averageTransitionTimeMs.toFixed(0) : '0'} ms`,
          )}
          {renderMetricRow(
            'Duration',
            `${(result.durationMs / 1000).toFixed(1)}s`,
            true,
          )}
        </View>

        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={20} color={BROWN} />
          <Text style={styles.tipText}>{result.feedback}</Text>
        </View>

        <Pressable
          style={styles.startButton}
          onPress={confirmTryAgain}
          accessibilityRole="button"
          accessibilityLabel="Try the exercise again"
        >
          <Ionicons name="refresh" size={18} color={WHITE} />
          <Text style={styles.startButtonText}>Try Again</Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={confirmBackToExercises}
          accessibilityRole="button"
          accessibilityLabel="Back to exercises"
        >
          <Ionicons name="arrow-back" size={15} color={BROWN} />
          <Text style={styles.doneButtonText}>Back to Exercises</Text>
        </Pressable>
      </View>
    );
  };

  if (tierLoading || isLoadingAdaptiveParams) {
    return (
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons name="options-outline" size={44} color={BROWN} />
        </View>
        <Text style={styles.preparingTitle}>
          Preparing Your Exercise
        </Text>
        <Text style={styles.preparingSubtitle}>
          Adjusting the exercise to your current difficulty level and
          preparing your vocal range.
        </Text>
        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  }

  if (isPreparingResume) {
    return (
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons name="musical-notes-outline" size={44} color={BROWN} />
        </View>
        <Text style={styles.preparingTitle}>Preparing Your Repetition</Text>
        <Text style={styles.preparingSubtitle}>
          Getting your reference notes ready. Your completed repetitions are preserved.
        </Text>
        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  }

  return (
    <>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={
        phase === 'results' ? styles.resultsWrapper : undefined
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

    <Modal
      visible={confirmation !== null}
      transparent
      animationType="fade"
      onRequestClose={closeConfirmation}
      statusBarTranslucent
    >
      <View style={styles.confirmationOverlay}>
        <View style={styles.confirmationCard}>
          <View style={styles.confirmationIconCircle}>
            <Ionicons
              name={confirmation === 'tryAgain' ? 'refresh' : 'log-out-outline'}
              size={30}
              color={BROWN}
            />
          </View>
          <Text style={styles.confirmationTitle}>
            {confirmation === 'tryAgain' ? 'Try again?' : 'Quit exercise?'}
          </Text>
          <Text style={styles.confirmationMessage}>
            {confirmation === 'tryAgain'
              ? 'Are you sure you want to repeat this exercise? Your current result will be cleared.'
              : 'Are you sure you want to leave this exercise?'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            onPress={closeConfirmation}
            style={({ pressed }) => [
              styles.confirmationContinueButton,
              pressed && styles.confirmationButtonPressed,
            ]}
          >
            <Text style={styles.confirmationContinueButtonText}>
              Continue Exercise
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={confirmation === 'tryAgain' ? 'Try again' : 'Quit exercise'}
            onPress={handleConfirmation}
            style={({ pressed }) => [
              styles.confirmationQuitButton,
              pressed && styles.confirmationButtonPressed,
            ]}
          >
            <Text style={styles.confirmationQuitButtonText}>
              {confirmation === 'tryAgain' ? 'Try Again' : 'Quit Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  preparingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  preparingIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  preparingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },
  quitButtonTop: {
    alignSelf: 'flex-end',
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
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
  referenceNotePlaying: {
    backgroundColor: '#E85D83',
    borderWidth: 1,
    borderColor: '#C93E68',
  },
  referenceNotePlayingText: {
    color: WHITE,
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
  referenceButton: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 22,
  },
  referenceButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
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
  confirmationOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  confirmationCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: WHITE,
  },
  confirmationIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
    marginBottom: 15,
  },
  confirmationTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
    textAlign: 'center',
  },
  confirmationMessage: {
    marginTop: 10,
    marginBottom: 23,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: MUTED,
    textAlign: 'center',
  },
  confirmationContinueButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: PINK,
  },
  confirmationContinueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
  confirmationQuitButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
  },
  confirmationQuitButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
  confirmationButtonPressed: {
    opacity: 0.8,
  },
});