
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  NOTE_MATCHING_PARAMS,
  type Tier,
} from '@/constants/exercises/pitch';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { generateNoteMatchingParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureNoteMatching } from '@/services/measurement/pitch/noteMatching';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreNoteMatching } from '@/services/scoring/pitch/noteMatching';
import {
  calcLiveStability,
  calcPitchAccuracy,
  frequencyToNote,
} from '@/utils/dsp/pitch';
import {
  disposeNotePlayer,
  playSingleNote,
} from '@/utils/music/notePlayer';
import {
  getRandomPitchNote,
  type VocalRange,
} from '@/utils/music/notes';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '../ExerciseScreen';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const COUNTDOWN_SECONDS = 3;
const TARGET_NOTE_DURATION_SECONDS = 1.5;
const RECORDING_DURATION_SECONDS = 4;
const PITCH_HISTORY_LIMIT = 20;

type Screen =
  | 'instructions'
  | 'countdown'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'results';

type Props = {
  tier?: Tier;
};

type LivePitchState = {
  pitch: number;
  note: string;
  clarity: number;
  stability: number;
};

type ResultState = {
  score: number;
  passed: boolean;
  deviationPct: number;
  detectedFrequency: number;
  averageClarity: number;
  voicedFrames: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function calculateCentsDifference(
  detectedFrequency: number,
  targetFrequency: number,
): number {
  if (
    !Number.isFinite(detectedFrequency) ||
    !Number.isFinite(targetFrequency) ||
    detectedFrequency <= 0 ||
    targetFrequency <= 0
  ) {
    return 0;
  }

  return 1200 * Math.log2(detectedFrequency / targetFrequency);
}

function getPitchMessage(cents: number): string {
  const absoluteCents = Math.abs(cents);

  if (absoluteCents <= 25) return 'Great!';
  if (absoluteCents <= 50) return 'Close';

  return cents > 0 ? 'Too High' : 'Too Low';
}

function formatFrequency(frequency: number): string {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return '--';
  }

  return `${frequency.toFixed(1)} Hz`;
}

function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return '--';
  if (Math.abs(cents) < 0.5) return '0 cents';

  return `${cents > 0 ? '+' : ''}${Math.round(cents)} cents`;
}

function getFeedback(
  result: ResultState,
  cents: number,
  targetNote: string,
): string {
  if (result.detectedFrequency <= 0) {
    return `We couldn't detect enough reliable pitch information. Try singing closer to the microphone and hold ${targetNote} steadily.`;
  }

  if (result.passed) {
    return `Excellent pitch matching! Your voice stayed close to ${targetNote} across the repetitions. Keep practicing controlled and steady pitch placement.`;
  }

  if (Math.abs(cents) <= 50) {
    return `You were very close to ${targetNote}. Listen carefully to the reference note and make small adjustments while sustaining it.`;
  }

  if (cents > 0) {
    return `Your detected pitch was higher than ${targetNote}. Try relaxing your voice slightly and aim a little lower.`;
  }

  return `Your detected pitch was lower than ${targetNote}. Try supporting the note steadily and aim slightly higher.`;
}

export default function NoteMatchingScreen({ tier }: Props) {
  const [screen, setScreen] = useState<Screen>('instructions');
  const [currentTier, setCurrentTier] = useState<Tier>(
    tier ?? 'beginner',
  );
  const [adaptiveParams, setAdaptiveParams] = useState(
    NOTE_MATCHING_PARAMS[tier ?? 'beginner'],
  );
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [livePitch, setLivePitch] = useState<LivePitchState>({
    pitch: 0,
    note: '--',
    clarity: 0,
    stability: 0,
  });
  const [result, setResult] = useState<ResultState | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const mountedRef = useRef(true);
  const screenRef = useRef<Screen>('instructions');
  const pausedRef = useRef(false);
  const quittingRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const interruptedRecordingRef = useRef(false);
  const interruptedRepRef = useRef(1);
  const interruptedScreenRef = useRef<Screen>('instructions');
  const processingResultRef = useRef<ResultState | null>(null);
  const pitchHistoryRef = useRef<number[]>([]);
  const repResultsRef = useRef<ResultState[]>([]);
  const currentRepRef = useRef(1);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);

  const startRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const startRecordingAttemptRef =
    useRef<(() => Promise<void>) | null>(null);
  const beginCountdownRef = useRef<(() => void) | null>(null);
  const continueAfterProcessingRef = useRef<(() => void) | null>(null);

  const changeScreen = useCallback((nextScreen: Screen) => {
    screenRef.current = nextScreen;
    setScreen(nextScreen);
  }, []);

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const resetLivePitch = useCallback(() => {
    pitchHistoryRef.current = [];
    setLivePitch({
      pitch: 0,
      note: '--',
      clarity: 0,
      stability: 0,
    });
  }, []);

  const target = useMemo(
    () => getRandomPitchNote(currentTier, vocalRange),
    [currentTier, vocalRange],
  );

  const targetFrequency = target.frequency;
  const targetNote = target.name;

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParameters() {
      setIsLoadingAdaptiveParams(true);

      try {
        const user = auth.currentUser;
        let resolvedTier: Tier = tier ?? 'beginner';

        if (!tier && user) {
          const progress = await fetchComponentProgress(
            user.uid,
            'pitch',
          );

          resolvedTier = progress?.currentTier ?? 'beginner';
        }

        if (cancelled) return;

        setCurrentTier(resolvedTier);

        let recentScores: number[] = [];
        const assessment = await getLatestAssessment();

        if (cancelled) return;

        setVocalRange(assessment?.vocalRange ?? null);

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'pitch',
          );

          if (cancelled) return;

          const matchingRecords = records
            .filter(
              record =>
                record.tier === resolvedTier &&
                record.templateId === 'noteMatchingExercise',
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          recentScores = matchingRecords
            .slice(-5)
            .map(record => record.scorePct);
        }

        if (recentScores.length === 0) {
          const assessmentScore = assessment?.scores.find(
            score => score.componentId === 'pitch',
          );

          if (typeof assessmentScore?.scorePct === 'number') {
            recentScores = [assessmentScore.scorePct];
          }
        }

        if (cancelled) return;

        setAdaptiveParams(
          generateNoteMatchingParams({
            tier: resolvedTier,
            recentScores,
          }),
        );
      } catch (error) {
        console.error('Note Matching ADS error:', error);

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';
          setCurrentTier(fallbackTier);
          setAdaptiveParams(NOTE_MATCHING_PARAMS[fallbackTier]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
        }
      }
    }

    void loadAdaptiveParameters();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  const handleLiveFrame = useCallback(
    (frame: { pitch: number; note: string; clarity: number }) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quittingRef.current ||
        screenRef.current !== 'recording'
      ) {
        return;
      }

      if (Number.isFinite(frame.pitch) && frame.pitch > 0) {
        const history = [
          ...pitchHistoryRef.current,
          frame.pitch,
        ].slice(-PITCH_HISTORY_LIMIT);

        pitchHistoryRef.current = history;

        setLivePitch({
          pitch: frame.pitch,
          note: frame.note || '--',
          clarity: frame.clarity,
          stability: calcLiveStability(history),
        });

        return;
      }

      setLivePitch(previous => ({
        ...previous,
        pitch: 0,
        note: '--',
        clarity: frame.clarity,
      }));
    },
    [],
  );

  const processCompletedResults = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quittingRef.current
    ) {
      return;
    }

    const results = repResultsRef.current;

    if (results.length === 0) {
      finishingRef.current = false;
      startingRef.current = false;
      changeScreen('instructions');
      setErrorMessage('No repetition results were available. Please try again.');
      return;
    }

    if (results.length < adaptiveParams.repetitions) {
      const nextRep = results.length + 1;

      currentRepRef.current = nextRep;
      setCurrentRep(nextRep);
      setElapsedSeconds(0);
      resetLivePitch();

      processingResultRef.current = null;
      finishingRef.current = false;
      startingRef.current = false;

      // The previous repetition is already scored. Play the next target
      // note only after the user resumes the exercise.
      changeScreen('listening');

      try {
        await playSingleNote(
          targetFrequency,
          TARGET_NOTE_DURATION_SECONDS,
        );

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quittingRef.current
        ) {
          return;
        }

        await startRecordingAttemptRef.current?.();
      } catch (error) {
        console.error('Failed to play the next target note:', error);

        if (mountedRef.current && !pausedRef.current) {
          setErrorMessage(
            'We could not play the target note. Please try again.',
          );
          changeScreen('instructions');
        }
      }

      return;
    }

    const finalScore = Math.round(
      results.reduce((sum, item) => sum + item.score, 0) /
        results.length,
    );

    const averageDeviation =
      results.reduce((sum, item) => sum + item.deviationPct, 0) /
      results.length;

    const detectedResults = results.filter(
      item => item.detectedFrequency > 0,
    );

    const averageDetectedFrequency =
      detectedResults.length > 0
        ? detectedResults.reduce(
            (sum, item) => sum + item.detectedFrequency,
            0,
          ) / detectedResults.length
        : 0;

    const averageClarity =
      results.reduce((sum, item) => sum + item.averageClarity, 0) /
      results.length;

    const totalVoicedFrames = results.reduce(
      (sum, item) => sum + item.voicedFrames,
      0,
    );

    const passed = results.every(item => item.passed);

    try {
      await saveCompletedExercise(
        'pitch',
        'noteMatchingExercise',
        currentTier,
        finalScore,
      );
    } catch (error) {
      console.error('Failed to save Note Matching progress:', error);
    }

    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quittingRef.current
    ) {
      return;
    }

    setResult({
      score: finalScore,
      passed,
      deviationPct: averageDeviation,
      detectedFrequency: averageDetectedFrequency,
      averageClarity,
      voicedFrames: totalVoicedFrames,
    });

    processingResultRef.current = null;
    finishingRef.current = false;
    startingRef.current = false;
    changeScreen('results');
  }, [
    adaptiveParams.repetitions,
    changeScreen,
    currentTier,
    resetLivePitch,
    targetFrequency,
  ]);

  useEffect(() => {
    continueAfterProcessingRef.current = () => {
      void processCompletedResults();
    };
  }, [processCompletedResults]);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: (samples: Float32Array, sampleRate: number) => {
      clearTimers();

      if (
        !mountedRef.current ||
        quittingRef.current ||
        discardNextStopRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        screenRef.current !== 'recording'
      ) {
        discardNextStopRef.current = false;
        startingRef.current = false;
        finishingRef.current = false;
        return;
      }

      finishingRef.current = true;
      changeScreen('processing');

      try {
        const measurement = measureNoteMatching(
          samples,
          sampleRate,
          adaptiveParams.minClarity,
        );

        const scored = scoreNoteMatching(
          measurement,
          targetFrequency,
          adaptiveParams,
        );

        const repetitionResult: ResultState = {
          score: scored.score,
          passed: scored.passed,
          deviationPct: scored.deviationPct,
          detectedFrequency: scored.detectedFrequency,
          averageClarity: scored.averageClarity,
          voicedFrames: measurement.voicedFrames,
        };

        processingResultRef.current = repetitionResult;
        repResultsRef.current = [
          ...repResultsRef.current,
          repetitionResult,
        ];

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quittingRef.current
        ) {
          return;
        }

        void processCompletedResults();
      } catch (error) {
        console.error('Note Matching analysis error:', error);

        if (mountedRef.current && !pausedRef.current) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          changeScreen('instructions');
        }

        finishingRef.current = false;
        startingRef.current = false;
      }
    },
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const startRecordingAttempt = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quittingRef.current ||
      startingRef.current
    ) {
      return;
    }

    const start = startRecordingRef.current;

    if (!start) {
      setErrorMessage('The audio recorder is not ready. Please try again.');
      changeScreen('instructions');
      return;
    }

    clearTimers();
    resetLivePitch();
    setElapsedSeconds(0);

    startingRef.current = true;
    finishingRef.current = false;
    changeScreen('recording');

    try {
      await start();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quittingRef.current ||
        screenRef.current !== 'recording'
      ) {
        return;
      }

      const startTime = Date.now();

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quittingRef.current ||
          finishingRef.current ||
          screenRef.current !== 'recording'
        ) {
          return;
        }

        const elapsed = (Date.now() - startTime) / 1000;

        setElapsedSeconds(
          Math.min(elapsed, RECORDING_DURATION_SECONDS),
        );

        if (elapsed >= RECORDING_DURATION_SECONDS) {
          clearTimers();

          if (!finishingRef.current) {
            finishingRef.current = true;

            try {
              stopRecordingRef.current?.();
            } catch (error) {
              console.error('Failed to stop recording:', error);
              finishingRef.current = false;
            }
          }
        }
      }, 100);
    } catch (error) {
      console.error('Failed to start Note Matching recording:', error);

      clearTimers();
      startingRef.current = false;
      finishingRef.current = false;

      if (mountedRef.current && !pausedRef.current) {
        setErrorMessage(
          'We could not start recording. Please check your microphone permission and try again.',
        );
        changeScreen('instructions');
      }
    }
  }, [changeScreen, clearTimers, resetLivePitch]);

  useEffect(() => {
    startRecordingAttemptRef.current = startRecordingAttempt;
  }, [startRecordingAttempt]);

  const beginCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quittingRef.current
    ) {
      return;
    }

    clearTimers();
    setCountdown(COUNTDOWN_SECONDS);
    changeScreen('countdown');

    let remaining = COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quittingRef.current
      ) {
        return;
      }

      remaining -= 1;

      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }

      clearTimers();
      setCountdown(0);
      changeScreen('listening');

      void playSingleNote(
        targetFrequency,
        TARGET_NOTE_DURATION_SECONDS,
      )
        .then(async () => {
          if (
            !mountedRef.current ||
            pausedRef.current ||
            showQuitModalRef.current ||
            quittingRef.current
          ) {
            return;
          }

          await startRecordingAttemptRef.current?.();
        })
        .catch(error => {
          console.error('Failed to start Note Matching:', error);

          startingRef.current = false;

          if (mountedRef.current && !pausedRef.current) {
            setErrorMessage(
              'We could not start the exercise. Please check your microphone permission and try again.',
            );
            changeScreen('instructions');
          }
        });
    }, 1000);
  }, [changeScreen, clearTimers, targetFrequency]);

  useEffect(() => {
    beginCountdownRef.current = beginCountdown;
  }, [beginCountdown]);

  const openQuitModal = useCallback(() => {
    if (
      quittingRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    const activeScreen = screenRef.current;

    interruptedScreenRef.current = activeScreen;
    interruptedRepRef.current = currentRepRef.current;
    interruptedRecordingRef.current = activeScreen === 'recording';

    pausedRef.current = true;
    showQuitModalRef.current = true;
    clearTimers();

    if (activeScreen === 'recording') {
      // AudioRecorder does not provide a safe pause/resume operation.
      // Discard this recording and restart the current rep on Continue.
      discardNextStopRef.current = true;
      startingRef.current = false;
      finishingRef.current = true;
      setElapsedSeconds(0);
      resetLivePitch();

      try {
        void Promise.resolve(stopRecordingRef.current?.()).catch(error => {
          console.error('Failed to stop interrupted recording:', error);
        });
      } catch (error) {
        console.error('Failed to stop interrupted recording:', error);
      }
    }

    setShowQuitModal(true);
  }, [clearTimers, resetLivePitch]);

  const continueExercise = useCallback(() => {
    if (quittingRef.current) return;

    const interruptedScreen = interruptedScreenRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    pausedRef.current = false;

    if (
      interruptedScreen === 'instructions' ||
      interruptedScreen === 'results'
    ) {
      return;
    }

    if (interruptedScreen === 'processing') {
      // A result that was already analyzed remains in repResultsRef.
      // Continue processing it; do not analyze or append it again.
      startingRef.current = false;
      finishingRef.current = true;
      continueAfterProcessingRef.current?.();
      return;
    }

    currentRepRef.current = interruptedRepRef.current;
    setCurrentRep(interruptedRepRef.current);
    setElapsedSeconds(0);
    setCountdown(COUNTDOWN_SECONDS);
    resetLivePitch();

    startingRef.current = false;
    finishingRef.current = false;
    discardNextStopRef.current = false;

    // Countdown, listening, and recording resume from a clean repetition.
    // This replays the target note and avoids scoring audio from the modal.
    beginCountdownRef.current?.();
  }, [resetLivePitch]);

  const quitExercise = useCallback(async () => {
    if (quittingRef.current) return;

    quittingRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();
    startingRef.current = false;
    finishingRef.current = true;

    try {
      await Promise.resolve(stopRecordingRef.current?.());
    } catch (error) {
      console.error('Failed to stop recording before leaving:', error);
    }

    try {
      await disposeNotePlayer();
    } catch (error) {
      console.warn('Failed to dispose note player:', error);
    }

    if (mountedRef.current) {
      router.replace('/dashboard?tab=exercises');
    }
  }, [clearTimers]);

  const goBack = useCallback(() => {
    openQuitModal();
  }, [openQuitModal]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) return true;

        openQuitModal();
        return true;
      },
    );

    return () => subscription.remove();
  }, [openQuitModal]);

  const startExercise = useCallback(() => {
    if (
      startingRef.current ||
      isLoadingAdaptiveParams ||
      pausedRef.current ||
      quittingRef.current
    ) {
      return;
    }

    clearTimers();

    startingRef.current = false;
    finishingRef.current = false;
    pausedRef.current = false;
    quittingRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = false;
    interruptedRecordingRef.current = false;
    processingResultRef.current = null;

    pitchHistoryRef.current = [];
    repResultsRef.current = [];
    currentRepRef.current = 1;

    setCurrentRep(1);
    setErrorMessage('');
    setResult(null);
    setShowQuitModal(false);
    setIsQuitting(false);
    setElapsedSeconds(0);
    setCountdown(COUNTDOWN_SECONDS);
    resetLivePitch();

    beginCountdown();
  }, [
    beginCountdown,
    clearTimers,
    isLoadingAdaptiveParams,
    resetLivePitch,
  ]);

  const finishRecording = useCallback(() => {
    if (
      !isRecording ||
      finishingRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quittingRef.current
    ) {
      return;
    }

    finishingRef.current = true;
    clearTimers();

    try {
      stopRecording();
    } catch (error) {
      console.error('Failed to finish Note Matching recording:', error);
      finishingRef.current = false;
    }
  }, [clearTimers, isRecording, stopRecording]);

  const retryExercise = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    quittingRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;
    interruptedRecordingRef.current = false;
    processingResultRef.current = null;

    startingRef.current = false;
    finishingRef.current = true;

    try {
      void Promise.resolve(stopRecordingRef.current?.()).catch(error => {
        console.error('Failed to stop recorder before retry:', error);
      });
    } catch (error) {
      console.error('Failed to stop recorder before retry:', error);
    }

    pitchHistoryRef.current = [];
    repResultsRef.current = [];
    currentRepRef.current = 1;

    setShowQuitModal(false);
    setIsQuitting(false);
    setCurrentRep(1);
    setResult(null);
    setErrorMessage('');
    setElapsedSeconds(0);
    setCountdown(COUNTDOWN_SECONDS);
    resetLivePitch();

    finishingRef.current = false;
    changeScreen('instructions');
  }, [changeScreen, clearTimers, resetLivePitch]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      showQuitModalRef.current = false;
      discardNextStopRef.current = true;

      clearTimers();

      try {
        void Promise.resolve(stopRecordingRef.current?.()).catch(error => {
          console.warn('Failed to stop recorder during cleanup:', error);
        });
      } catch (error) {
        console.warn('Failed to stop recorder during cleanup:', error);
      }

      void disposeNotePlayer().catch(error => {
        console.warn('Failed to dispose note player:', error);
      });
    };
  }, [clearTimers]);

  const quitModal = (
    <Modal
      visible={showQuitModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={continueExercise}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}>
            <Ionicons name="exit-outline" size={30} color={BROWN} />
          </View>

          <Text style={styles.modalTitle}>Quit exercise?</Text>

          <Text style={styles.modalMessage}>
            {interruptedScreenRef.current === 'instructions' ||
            interruptedScreenRef.current === 'results'
              ? 'Are you sure you want to leave Note Matching?'
              : interruptedScreenRef.current === 'recording'
                ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                : interruptedScreenRef.current === 'processing'
                  ? 'Your exercise is paused. Continue to resume processing your current results.'
                  : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            disabled={isQuitting}
            onPress={continueExercise}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.continueButtonText}>
              Continue Exercise
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
            disabled={isQuitting}
            onPress={() => {
              void quitExercise();
            }}
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.quitButtonText}>
              {isQuitting ? 'Stopping...' : 'Quit Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  if (screen === 'instructions' && isLoadingAdaptiveParams) {
    return (
      <>
        <View style={styles.centerScreen}>
          <View style={styles.largeIconCircle}>
            <Ionicons
              name="options-outline"
              size={44}
              color={BROWN}
            />
          </View>

          <Text style={styles.processingTitle}>
            Preparing Your Exercise
          </Text>

          <Text style={styles.processingSubtitle}>
            Adjusting the exercise to your current difficulty level
          </Text>

          <ActivityIndicator
            size="large"
            color={BROWN}
            style={styles.spinner}
          />
        </View>
        {quitModal}
      </>
    );
  }

  return (
    <>
      {screen === 'instructions' && (
        <ExerciseScreen
          title="Note Matching Exercise"
          category="Pitch"
          icon="musical-note-outline"
          instructions={
            'Listen carefully to the target note first.\n\n' +
            'After the target note finishes, sing the same note back.\n\n' +
            'Hold the note steadily and try to match the pitch as closely as possible.'
          }
          preparationSteps={[
            {
              icon: 'volume-mute-outline',
              text: 'Find a quiet room or area with minimal background noise.',
            },
            {
              icon: 'body-outline',
              text: 'Sit upright or stand with your back straight and your shoulders relaxed.',
            },
            {
              icon: 'mic-outline',
              text: 'If available, an external microphone or audio recording equipment is recommended.',
            },
          ]}
          summary={[
            { label: 'Target Note', value: targetNote },
            { label: 'Frequency', value: formatFrequency(targetFrequency) },
            {
              label: 'Repetitions',
              value: String(adaptiveParams.repetitions),
            },
          ]}
          tip="Sing comfortably and make small adjustments until your pitch matches the target."
          tier={currentTier}
          onBack={goBack}
          onStart={startExercise}
          error={errorMessage}
          startDisabled={isLoadingAdaptiveParams}
        />
      )}

      {screen === 'countdown' && (
        <ExerciseCountdownScreen
          icon="musical-notes-outline"
          title="Get Ready"
          currentRep={currentRep}
          repetitions={adaptiveParams.repetitions}
          countdown={countdown}
          promptTitle="Your target note is"
          prompt={`${targetNote} • ${formatFrequency(targetFrequency)}`}
          onBack={goBack}
        />
      )}

      {screen === 'listening' && (
        <ExerciseListeningScreen
          icon="volume-high-outline"
          title="Listen to the Note"
          currentRep={currentRep}
          repetitions={adaptiveParams.repetitions}
          promptTitle="Listen to the reference note"
          prompt="Listen to the reference note, then sing the same note."
          liveContent={
            <View style={styles.sharedListenNoteBox}>
              <Text style={styles.listenLabel}>TARGET NOTE</Text>
              <Text style={styles.largeNote}>{targetNote}</Text>
              <Text style={styles.stateFrequency}>
                {formatFrequency(targetFrequency)}
              </Text>
            </View>
          }
          progress={100}
        />
      )}

      {screen === 'recording' && (
        <View style={styles.screen}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.recordingContent}
          >
            <View style={styles.recordingIcon}>
              <Ionicons name="mic" size={34} color={BROWN} />
            </View>

            <Text style={styles.recordingTitle}>Sing the Note</Text>

            <Text style={styles.recordingSubtitle}>
              Repetition {currentRep} of {adaptiveParams.repetitions}
            </Text>

            <View style={styles.smallTargetCard}>
              <View>
                <Text style={styles.smallLabel}>TARGET</Text>
                <Text style={styles.smallNote}>{targetNote}</Text>
              </View>

              <Text style={styles.smallHz}>
                {formatFrequency(targetFrequency)}
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

            <View style={styles.detectedArea}>
              <Text style={styles.detectedLabel}>DETECTED NOTE</Text>
              <Text style={styles.detectedNote}>{livePitch.note}</Text>
              <Text style={styles.detectedFrequency}>
                {formatFrequency(livePitch.pitch)}
              </Text>
              <Text style={styles.pitchMessage}>
                {livePitch.pitch > 0
                  ? getPitchMessage(
                      calculateCentsDifference(
                        livePitch.pitch,
                        targetFrequency,
                      ),
                    )
                  : 'Listening...'}
              </Text>
            </View>

            <View style={styles.accuracyTrack}>
              <View
                style={[
                  styles.accuracyFill,
                  {
                    width: `${
                      livePitch.pitch > 0
                        ? clamp(
                            calcPitchAccuracy(
                              livePitch.pitch,
                              targetFrequency,
                            ),
                            0,
                            100,
                          )
                        : 0
                    }%`,
                  },
                ]}
              />
            </View>

            <Text style={styles.centsText}>
              {livePitch.pitch > 0
                ? formatCents(
                    calculateCentsDifference(
                      livePitch.pitch,
                      targetFrequency,
                    ),
                  )
                : 'Waiting for pitch...'}
            </Text>

            <View style={styles.metricsGrid}>
              <MetricCard
                label="ACCURACY"
                value={
                  livePitch.pitch > 0
                    ? `${Math.round(
                        calcPitchAccuracy(
                          livePitch.pitch,
                          targetFrequency,
                        ),
                      )}%`
                    : '--'
                }
              />
              <MetricCard
                label="CLARITY"
                value={
                  livePitch.clarity > 0
                    ? `${Math.round(livePitch.clarity * 100)}%`
                    : '--'
                }
              />
              <MetricCard
                label="STABILITY"
                value={
                  livePitch.stability > 0
                    ? `${Math.round(livePitch.stability)}%`
                    : '--'
                }
              />
            </View>

            <Text style={styles.timerText}>
              {elapsedSeconds.toFixed(1)} /{' '}
              {RECORDING_DURATION_SECONDS.toFixed(1)}s
            </Text>

            <View style={styles.timerTrack}>
              <View
                style={[
                  styles.timerFill,
                  {
                    width: `${
                      clamp(
                        elapsedSeconds / RECORDING_DURATION_SECONDS,
                        0,
                        1,
                      ) * 100
                    }%`,
                  },
                ]}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={finishRecording}
              disabled={!isRecording || finishingRef.current}
              style={({ pressed }) => [
                styles.finishButton,
                pressed && styles.buttonPressed,
                (!isRecording || finishingRef.current) &&
                  styles.buttonDisabled,
              ]}
            >
              <Ionicons name="stop" size={20} color={BROWN} />
              <Text style={styles.finishButtonText}>Finish</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      {screen === 'processing' && (
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing Your Singing"
          message={
            currentRep < adaptiveParams.repetitions
              ? `Checking repetition ${currentRep} of ${adaptiveParams.repetitions}.`
              : 'Calculating your final Note Matching result.'
          }
          onBack={goBack}
        />
      )}

      {screen === 'results' && result && (
        <ExerciseResultsScreen
          title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
          subtitle={`Note Matching Result • ${adaptiveParams.repetitions} repetitions`}
          score={result.score}
          resultIcon={result.passed ? 'checkmark' : 'refresh'}
          scoreMessage={
            result.passed
              ? 'You matched the target note accurately across all repetitions.'
              : 'Keep practicing your pitch placement across each repetition.'
          }
          onRetry={retryExercise}
          onExit={goBack}
        >
          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>Pitch Comparison</Text>

            <View style={styles.comparisonRow}>
              <View style={styles.comparisonSide}>
                <Text style={styles.comparisonLabel}>TARGET</Text>
                <Text style={styles.comparisonNote}>{targetNote}</Text>
                <Text style={styles.comparisonFrequency}>
                  {formatFrequency(targetFrequency)}
                </Text>
              </View>

              <Ionicons
                name="arrow-forward"
                size={23}
                color={MUTED}
              />

              <View
                style={[
                  styles.comparisonSide,
                  styles.detectedComparison,
                ]}
              >
                <Text style={styles.comparisonLabel}>
                  AVERAGE DETECTED
                </Text>
                <Text style={styles.comparisonNote}>
                  {result.detectedFrequency > 0
                    ? frequencyToNote(result.detectedFrequency)
                    : '--'}
                </Text>
                <Text style={styles.comparisonFrequency}>
                  {formatFrequency(result.detectedFrequency)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.resultsGrid}>
            <MetricCard
              label="PITCH ACCURACY"
              value={`${result.score}%`}
            />
            <MetricCard
              label="DEVIATION"
              value={formatCents(
                calculateCentsDifference(
                  result.detectedFrequency,
                  targetFrequency,
                ),
              )}
            />
            <MetricCard
              label="AVG. CLARITY"
              value={`${Math.round(result.averageClarity * 100)}%`}
            />
            <MetricCard
              label="VOICED FRAMES"
              value={String(result.voicedFrames)}
            />
          </View>

          <View style={styles.feedbackCard}>
            <Ionicons name="bulb-outline" size={21} color={BROWN} />

            <View style={styles.feedbackContent}>
              <Text style={styles.feedbackTitle}>Feedback</Text>
              <Text style={styles.feedbackText}>
                {getFeedback(
                  result,
                  calculateCentsDifference(
                    result.detectedFrequency,
                    targetFrequency,
                  ),
                  targetNote,
                )}
              </Text>
            </View>
          </View>
        </ExerciseResultsScreen>
      )}

      {quitModal}
    </>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
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
    paddingHorizontal: 30,
  },
  largeIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  processingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  processingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },
  sharedListenNoteBox: {
    minWidth: 180,
    backgroundColor: PINK,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 30,
    alignItems: 'center',
    marginTop: 22,
  },
  listenLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.8,
  },
  largeNote: {
    fontFamily: 'FredokaBold',
    fontSize: 55,
    color: BROWN,
    marginTop: 10,
  },
  stateFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 1,
  },
  recordingContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 82,
    paddingBottom: 50,
    alignItems: 'center',
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
  },
  smallTargetCard: {
    width: '100%',
    marginTop: 20,
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 18,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  smallLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.7,
  },
  smallNote: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    marginTop: 1,
  },
  smallHz: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  microphoneArea: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 18,
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
  detectedArea: {
    alignItems: 'center',
  },
  detectedLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.7,
    color: MUTED,
  },
  detectedNote: {
    fontFamily: 'FredokaBold',
    fontSize: 48,
    color: BROWN,
    marginTop: 2,
  },
  detectedFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },
  pitchMessage: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginTop: 5,
  },
  accuracyTrack: {
    width: '100%',
    height: 9,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 17,
  },
  accuracyFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 5,
  },
  centsText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 7,
  },
  metricsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18,
  },
  metricCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.6,
    color: MUTED,
  },
  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginTop: 3,
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
    marginBottom: 12,
  },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  comparisonSide: {
    flex: 1,
  },
  detectedComparison: {
    alignItems: 'flex-end',
  },
  comparisonLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.7,
    color: MUTED,
  },
  comparisonNote: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    color: BROWN,
    marginTop: 2,
  },
  comparisonFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 1,
  },
  resultsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  feedbackCard: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
    marginBottom: 18,
  },
  feedbackContent: {
    flex: 1,
    marginLeft: 10,
  },
  feedbackTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },
  feedbackText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: WHITE,
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
    marginBottom: 15,
  },
  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
    textAlign: 'center',
  },
  modalMessage: {
    marginTop: 10,
    marginBottom: 23,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: MUTED,
    textAlign: 'center',
  },
  continueButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: PINK,
  },
  continueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
  quitButton: {
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
  quitButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: MUTED,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});