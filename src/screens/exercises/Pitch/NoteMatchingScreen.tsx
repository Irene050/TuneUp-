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
  type DimensionValue,
} from 'react-native';

import {
  NOTE_MATCHING_PARAMS,
  type Tier,
} from '@/constants/pitch';
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
} from '@/utils/dsp/pitch';
import {
  disposeNotePlayer,
  playSingleNote,
} from '@/utils/music/notePlayer';
import {
  frequencyToNoteName,
  getRandomPitchNote,
  type VocalRange
} from '@/utils/music/notes';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '../ExerciseScreen';

import { COLORS } from '@/constants/appConstants';

const COUNTDOWN_SECONDS = 3;
const TARGET_NOTE_DURATION_SECONDS = 1.5;
const RECORDING_DURATION_SECONDS = 4;
const PITCH_HISTORY_LIMIT = 20;
const GUIDE_MAX_CENTS = 100;
const GUIDE_TRACE_LIMIT = 18;

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

type PitchGuideStatus = {
  label: string;
  color: string;
  cents: number | null;
  position: number;
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

function getPitchGuideStatus(
  pitch: number,
  targetFrequency: number,
): PitchGuideStatus {
  if (
    !Number.isFinite(pitch) ||
    pitch <= 0 ||
    !Number.isFinite(targetFrequency) ||
    targetFrequency <= 0
  ) {
    return {
      label: 'LISTENING FOR PITCH',
      color: COLORS.muted,
      cents: null,
      position: 50,
    };
  }

  const cents = calculateCentsDifference(pitch, targetFrequency);
  const absoluteCents = Math.abs(cents);

  let label: string;
  let color: string;

  if (absoluteCents <= 25) {
    label = 'IN TUNE';
    color = COLORS.guideGreen;
  } else if (absoluteCents <= 60) {
    label = cents > 0 ? 'A LITTLE HIGH' : 'A LITTLE LOW';
    color = COLORS.guideYellow;
  } else {
    label = cents > 0 ? 'TOO HIGH' : 'TOO LOW';
    color = COLORS.guideRed;
  }

  const position = clamp(
    50 + cents * 0.5,
    4.2,
    95.8,
  );

  return {
    label,
    color,
    cents,
    position,
  };
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
    stability: 0,
  });
  const [result, setResult] = useState<ResultState | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [pitchTrace, setPitchTrace] = useState<number[]>([]);

  const mountedRef = useRef(true);
  const screenRef = useRef<Screen>('instructions');
  const pausedRef = useRef(false);
  const quittingRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const interruptedRepRef = useRef(1);
  const interruptedScreenRef = useRef<Screen>('instructions');
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
    setPitchTrace([]);
    setLivePitch({
      pitch: 0,
      note: '--',
      stability: 0,
    });
  }, []);

  const target = useMemo(
    () => getRandomPitchNote(currentTier, vocalRange),
    [currentTier, vocalRange],
  );

  const targetFrequency = target.frequency;
  const targetNote = target.name;

  const pitchGuide = useMemo(
    () => getPitchGuideStatus(livePitch.pitch, targetFrequency),
    [livePitch.pitch, targetFrequency],
  );

  const pitchIndicatorLeft: DimensionValue =
    `${pitchGuide.position}%`;

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
          stability: calcLiveStability(history),
        });

        const cents = calculateCentsDifference(
          frame.pitch,
          targetFrequency,
        );

        const normalized = clamp(
          cents / GUIDE_MAX_CENTS,
          -1,
          1,
        );

        setPitchTrace(previous =>
          [...previous, normalized].slice(-GUIDE_TRACE_LIMIT),
        );

        return;
      }

      setLivePitch(previous => ({
        ...previous,
        pitch: 0,
        note: '--',
      }));
    },
    [targetFrequency],
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
      setErrorMessage(
        'No repetition results were available. Please try again.',
      );
      return;
    }

    if (results.length < adaptiveParams.repetitions) {
      const nextRep = results.length + 1;

      currentRepRef.current = nextRep;
      setCurrentRep(nextRep);
      setElapsedSeconds(0);
      resetLivePitch();

      finishingRef.current = false;
      startingRef.current = false;
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
      setErrorMessage(
        'The audio recorder is not ready. Please try again.',
      );
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
    if (quittingRef.current || showQuitModalRef.current) {
      return;
    }

    const activeScreen = screenRef.current;

    interruptedScreenRef.current = activeScreen;
    interruptedRepRef.current = currentRepRef.current;

    pausedRef.current = true;
    showQuitModalRef.current = true;
    clearTimers();

    if (activeScreen === 'recording') {
      discardNextStopRef.current = true;
      startingRef.current = false;
      finishingRef.current = true;
      setElapsedSeconds(0);
      resetLivePitch();

      try {
        void Promise.resolve(
          stopRecordingRef.current?.(),
        ).catch(error => {
          console.error(
            'Failed to stop interrupted recording:',
            error,
          );
        });
      } catch (error) {
        console.error(
          'Failed to stop interrupted recording:',
          error,
        );
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
      console.error(
        'Failed to stop recording before leaving:',
        error,
      );
    }

    try {
      await disposeNotePlayer();
    } catch (error) {
      console.warn('Failed to dispose note player:', error);
    }

    if (mountedRef.current) {
      router.replace('/exercises/pitch');
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

  const retryExercise = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    quittingRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    startingRef.current = false;
    finishingRef.current = true;

    try {
      void Promise.resolve(
        stopRecordingRef.current?.(),
      ).catch(error => {
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
        void Promise.resolve(
          stopRecordingRef.current?.(),
        ).catch(error => {
          console.warn(
            'Failed to stop recorder during cleanup:',
            error,
          );
        });
      } catch (error) {
        console.warn(
          'Failed to stop recorder during cleanup:',
          error,
        );
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
            <Ionicons name="exit-outline" size={30} color={COLORS.brown} />
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
              color={COLORS.brown}
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
            color={COLORS.brown}
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
            {
              label: 'Frequency',
              value: formatFrequency(targetFrequency),
            },
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
              <Ionicons name="mic" size={30} color={COLORS.brown} />
            </View>

            
            <Text style={styles.recordingTitle}>Sing the Note</Text>
            <Text style={styles.recordingSubtitle}>
              Repetition {currentRep} of {adaptiveParams.repetitions}
            </Text>

            <View style={styles.pitchGuideCard}>
              <View style={styles.pitchGuideHeader}>
                <View style={styles.pitchGuideTitleRow}>
                  <View style={styles.liveStatusDot} />
                  <Text style={styles.pitchGuideTitle}>
                    LIVE PITCH GUIDE
                  </Text>
                </View>

                <View
                  style={[
                    styles.guideStatusPill,
                    {
                      backgroundColor:
                        pitchGuide.cents === null
                          ? COLORS.white
                          : `${pitchGuide.color}15`,
                      borderColor:
                        pitchGuide.cents === null
                          ? COLORS.border
                          : `${pitchGuide.color}55`,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.guideStatusText,
                      { color: pitchGuide.color },
                    ]}
                  >
                    {pitchGuide.cents === null
                      ? 'LISTENING'
                      : pitchGuide.label}
                  </Text>
                </View>
              </View>

              <View style={styles.pitchTargetSummary}>
                <View style={styles.pitchTargetSide}>
                  <Text style={styles.pitchTargetCaption}>
                    TARGET NOTE
                  </Text>
                  <Text style={styles.pitchTargetValue}>
                    {targetNote}
                  </Text>
                  <Text style={styles.pitchTargetFrequency}>
                    {formatFrequency(targetFrequency)}
                  </Text>
                </View>

                <View style={styles.pitchDetectedSummary}>
                  <Text style={styles.pitchTargetCaption}>
                    YOUR PITCH
                  </Text>
                  <Text
                    style={[
                      styles.pitchDetectedValue,
                      {
                        color:
                          pitchGuide.cents === null
                            ? COLORS.brown
                            : pitchGuide.color,
                      },
                    ]}
                  >
                    {livePitch.pitch > 0 ? livePitch.note : '--'}
                  </Text>
                  <Text style={styles.pitchTargetFrequency}>
                    {formatFrequency(livePitch.pitch)}
                  </Text>
                </View>
              </View>

              <View style={styles.horizontalPitchMeter}>
                <View style={styles.pitchMeterLabels}>
                  <Text style={styles.pitchMeterEdgeLabel}>
                    {'← LOW'}
                  </Text>
                  <Text style={styles.pitchMeterCenterLabel}>
                    TARGET
                  </Text>
                  <Text style={styles.pitchMeterEdgeLabel}>
                    {'HIGH →'}
                  </Text>
                </View>

                <View style={styles.pitchMeterTrack}>
                  <View
                    style={[
                      styles.pitchMeterZone,
                      {
                        left: '0%',
                        width: '20%',
                        backgroundColor: COLORS.guideRed,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.pitchMeterZone,
                      {
                        left: '20%',
                        width: '17.5%',
                        backgroundColor: COLORS.guideYellow,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.pitchMeterZone,
                      {
                        left: '37.5%',
                        width: '25%',
                        backgroundColor: COLORS.guideGreen,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.pitchMeterZone,
                      {
                        left: '62.5%',
                        width: '17.5%',
                        backgroundColor: COLORS.guideYellow,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.pitchMeterZone,
                      {
                        left: '80%',
                        width: '20%',
                        backgroundColor: COLORS.guideRed,
                      },
                    ]}
                  />

                  <View style={styles.pitchMeterTargetLine} />

                  {pitchTrace.map((sample, index) => {
                    const traceLeft: DimensionValue =
                      `${clamp(50 + sample * 50, 4.2, 95.8)}%`;

                    const absoluteCents = Math.abs(
                      sample * GUIDE_MAX_CENTS,
                    );

                    const traceColor =
                      absoluteCents <= 25
                        ? COLORS.guideGreen
                        : absoluteCents <= 60
                          ? COLORS.guideYellow
                          : COLORS.guideRed;

                    return (
                      <View
                        key={`pitch-trace-${index}`}
                        style={[
                          styles.pitchMeterTrace,
                          {
                            left: traceLeft,
                            opacity:
                              0.2 +
                              (index /
                                Math.max(pitchTrace.length, 1)) *
                                0.65,
                            backgroundColor: traceColor,
                          },
                        ]}
                      />
                    );
                  })}

                  <View
                    style={[
                      styles.pitchMeterMarker,
                      {
                        left: pitchIndicatorLeft,
                        borderColor: pitchGuide.color,
                        backgroundColor: COLORS.gray,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.pitchMeterMarkerInner,
                        {
                          backgroundColor:
                            pitchGuide.cents === null
                              ? COLORS.muted
                              : pitchGuide.color,
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.pitchMeterScale}>
                  <Text style={styles.pitchMeterScaleText}>
                    -100 cents
                  </Text>
                  <Text style={styles.pitchMeterScaleText}>0</Text>
                  <Text style={styles.pitchMeterScaleText}>
                    +100 cents
                  </Text>
                </View>
              </View>

              <View style={styles.pitchGuideFooter}>
                <Ionicons
                  name="ear-outline"
                  size={15}
                  color={COLORS.muted}
                />
                <Text style={styles.pitchGuideHint}>
                  {pitchGuide.cents === null
                    ? 'Sing the target note to activate the guide.'
                    : pitchGuide.cents > 25
                      ? 'Lower your pitch toward the center.'
                      : pitchGuide.cents < -25
                        ? 'Raise your pitch toward the center.'
                        : 'Great! Keep your pitch steady.'}
                </Text>
              </View>
            </View>

            <View style={styles.metricsGrid}>
              <MetricCard
                label="ACCURACY"
                value={
                  livePitch.pitch > 0
                    ? `${Math.round(
                        clamp(
                          calcPitchAccuracy(
                            livePitch.pitch,
                            targetFrequency,
                          ),
                          0,
                          100,
                        ),
                      )}%`
                    : '--'
                }
              />

              <MetricCard
                label="STABILITY"
                value={
                  livePitch.pitch > 0
                    ? `${Math.round(livePitch.stability)}%`
                    : '--'
                }
              />

              <MetricCard
                label="FREQUENCY"
                value={
                  livePitch.pitch > 0
                    ? `${livePitch.pitch.toFixed(0)} Hz`
                    : '-- Hz'
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
            <Text style={styles.resultCardTitle}>
              Pitch Comparison
            </Text>

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
                color={COLORS.muted}
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
                    ? frequencyToNoteName(result.detectedFrequency)
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
              value={
                result.detectedFrequency > 0
                  ? formatCents(
                      calculateCentsDifference(
                        result.detectedFrequency,
                        targetFrequency,
                      ),
                    )
                  : '--'
              }
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
            <Ionicons name="bulb-outline" size={21} color={COLORS.brown} />

            <View style={styles.feedbackContent}>
              <Text style={styles.feedbackTitle}>Feedback</Text>
              <Text style={styles.feedbackText}>
                {getFeedback(
                  result,
                  result.detectedFrequency > 0
                    ? calculateCentsDifference(
                        result.detectedFrequency,
                        targetFrequency,
                      )
                    : 0,
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
    backgroundColor: COLORS.white,
  },
  centerScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  largeIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  processingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: COLORS.brown,
    textAlign: 'center',
  },
  processingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },
  sharedListenNoteBox: {
    minWidth: 180,
    backgroundColor: COLORS.pink,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 30,
    alignItems: 'center',
    marginTop: 22,
  },
  listenLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 0.8,
  },
  largeNote: {
    fontFamily: 'FredokaBold',
    fontSize: 55,
    color: COLORS.brown,
    marginTop: 10,
  },
  stateFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 1,
  },
  recordingIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 7,
  },
  timerTrack: {
    width: '100%',
    height: 7,
    backgroundColor: COLORS.lightGray,
    borderRadius: 4,
    overflow: 'hidden',
  },
  timerFill: {
    height: '100%',
    backgroundColor: COLORS.pink,
  },
  resultCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: COLORS.brown,
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
    color: COLORS.muted,
  },
  comparisonNote: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    color: COLORS.brown,
    marginTop: 2,
  },
  comparisonFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
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
    backgroundColor: COLORS.pink,
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
    color: COLORS.brown,
  },
  feedbackText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.brown,
    marginTop: 4,
  },

  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: COLORS.transparentbrown,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: COLORS.white,
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    marginBottom: 15,
  },
  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: COLORS.brown,
    textAlign: 'center',
  },
  modalMessage: {
    marginTop: 10,
    marginBottom: 23,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.muted,
    textAlign: 'center',
  },
  continueButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: COLORS.pink,
  },
  continueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
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
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  quitButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.muted,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  recordingContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 150,
    paddingBottom: 25,
    alignItems: 'center',
  },
  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 26,
    color: COLORS.brown,
    textAlign: 'center',
  },
  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 3,
    marginBottom: 20,
  },
  pitchGuideCard: {
    width: '100%',
    padding: 14,
    borderRadius: 22,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pitchGuideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pitchGuideTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  liveStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.gray,
  },
  pitchGuideTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.35,
    color: COLORS.brown,
  },
  guideStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
    maxWidth: '53%',
  },
  guideStatusText: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    letterSpacing: 0.15,
    flexShrink: 1,
    textAlign: 'center',
  },
  pitchTargetSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pitchTargetSide: {
    flex: 1,
  },
  pitchTargetCaption: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.55,
    color: COLORS.muted,
  },
  pitchTargetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    lineHeight: 33,
    color: COLORS.brown,
    marginTop: 1,
  },
  pitchDetectedSummary: {
    flex: 1,
    alignItems: 'flex-end',
  },
  pitchDetectedValue: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    lineHeight: 33,
    marginTop: 1,
  },
  pitchTargetFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 1,
  },
  horizontalPitchMeter: {
    width: '100%',
    marginTop: 18,
  },
  pitchMeterLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 9,
  },
  pitchMeterEdgeLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    letterSpacing: 0.35,
    color: COLORS.guideRed,
  },
  pitchMeterCenterLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    letterSpacing: 0.4,
    color: COLORS.guideGreen,
  },
  pitchMeterTrack: {
    width: '100%',
    height: 15,
    borderRadius: 8,
    overflow: 'visible',
    backgroundColor: COLORS.white,
    position: 'relative',
  },
  pitchMeterZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  pitchMeterTargetLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 2,
    marginLeft: -1,
    backgroundColor: COLORS.gray,
    zIndex: 2,
  },
  pitchMeterTrace: {
    position: 'absolute',
    top: '50%',
    width: 4,
    height: 4,
    borderRadius: 2,
    marginLeft: -2,
    marginTop: -2,
    zIndex: 3,
  },
  pitchMeterMarker: {
    position: 'absolute',
    top: '50%',
    width: 23,
    height: 23,
    borderRadius: 12,
    borderWidth: 2,
    marginLeft: -11.5,
    marginTop: -11.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    elevation: 3,
  },
  pitchMeterMarkerInner: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.white,
  },
  pitchMeterScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  pitchMeterScaleText: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: COLORS.muted,
  },
  pitchGuideFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  pitchGuideHint: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: COLORS.muted,
  },
  metricsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    marginTop: 14,
  },
  metricCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: COLORS.background,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    letterSpacing: 0.3,
    color: COLORS.muted,
    textAlign: 'center',
  },
  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
    marginTop: 4,
    textAlign: 'center',
  },
});