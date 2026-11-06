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
  BackHandler,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
} from 'react-native';

import { COLORS, EXERCISE_COUNTDOWN_SECONDS, EXERCISE_REFERENCE_NOTE_DURATION_SECONDS } from '@/constants/appConstants';
import {
  NOTE_MATCHING_PARAMS,
  type Tier,
} from '@/constants/params';
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
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import {
  calcLiveStability,
  calcPitchAccuracy,
} from '@/utils/dsp/pitch';
import { clamp } from '@/utils/math';
import {
  disposeNotePlayer,
  playSingleNote,
} from '@/utils/music/notePlayer';
import {
  frequencyToNoteName,
  getRandomPitchNote,
  type VocalRange,
} from '@/utils/music/notes';
import { formatFrequency } from '@/utils/numberFormatting';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseNoAudioModal,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseQuitModal,
  ExerciseResultsScreen,
  MetricCard,
} from '../ExerciseScreen';

const RECORDING_DURATION_SECONDS = 4;
const PITCH_HISTORY_LIMIT = 20;
const GUIDE_MAX_CENTS = 100;
const GUIDE_TRACE_LIMIT = 18;

type Phase =
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
  detectedFrequency: number;
  averageClarity: number;
  voicedFrames: number;
};

type PitchGuideStatus = {
  label: string;
  color: string;
  cents: number | null;
  position: number;
  hint: string;
};

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
      label: 'LISTENING',
      color: COLORS.muted,
      cents: null,
      position: 50,
      hint: 'Sing the target note to see your live pitch.',
    };
  }

  const cents = calculateCentsDifference(pitch, targetFrequency);
  const absoluteCents = Math.abs(cents);

  let label: string;
  let color: string;
  let hint: string;

  if (absoluteCents <= 25) {
    label = 'IN TUNE';
    color = COLORS.guideGreen;
    hint = 'Great! Keep holding the target pitch steadily.';
  } else if (absoluteCents <= 60) {
    label = cents > 0 ? 'A LITTLE HIGH' : 'A LITTLE LOW';
    color = COLORS.guideYellow;
    hint = cents > 0
      ? 'Relax your voice slightly and bring your pitch down.'
      : 'Gently raise your pitch toward the target note.';
  } else {
    label = cents > 0 ? 'TOO HIGH' : 'TOO LOW';
    color = COLORS.guideRed;
    hint = cents > 0
      ? 'Your pitch is too high. Try aiming lower.'
      : 'Your pitch is too low. Try aiming higher.';
  }

  const position = clamp(
    50 + (cents / GUIDE_MAX_CENTS) * 43,
    7,
    93,
  );

  return {
    label,
    color,
    cents,
    position,
    hint,
  };
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
  const [phase, setPhase] = useState<Phase>('instructions');
  const [currentTier, setCurrentTier] = useState<Tier>(
    tier ?? 'beginner',
  );
  const [adaptiveParams, setAdaptiveParams] = useState(
    NOTE_MATCHING_PARAMS[tier ?? 'beginner'],
  );
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
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
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [pitchTrace, setPitchTrace] = useState<number[]>([]);

  const mountedRef = useRef(true);
  const screenRef = useRef<Phase>('instructions');
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const pausedRepetitionRef = useRef(1);
  const pausedScreenRef = useRef<Phase>('instructions');
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

  const changePhase = useCallback((nextPhase: Phase) => {
    screenRef.current = nextPhase;
    setPhase(nextPhase);
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
        quitInProgressRef.current ||
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
      quitInProgressRef.current
    ) {
      return;
    }

    const results = repResultsRef.current;

    if (results.length === 0) {
      finishingRef.current = false;
      startingRef.current = false;
      changePhase('instructions');
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
      changePhase('listening');

      try {
        await playSingleNote(
          targetFrequency,
          EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
        );

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current
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
          changePhase('instructions');
        }
      }

      return;
    }

    const finalScore = Math.round(
      results.reduce((sum, item) => sum + item.score, 0) /
        results.length,
    );

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
      quitInProgressRef.current
    ) {
      return;
    }

    setResult({
      score: finalScore,
      passed,
      detectedFrequency: averageDetectedFrequency,
      averageClarity,
      voicedFrames: totalVoicedFrames,
    });

    finishingRef.current = false;
    startingRef.current = false;
    changePhase('results');
  }, [
    adaptiveParams.repetitions,
    changePhase,
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
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: (samples: Float32Array, sampleRate: number) => {
      clearTimers();

      if (
        !mountedRef.current ||
        quitInProgressRef.current ||
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

      if (!hasSufficientRecordedSignal(samples)) {
        finishingRef.current = false;
        startingRef.current = false;
        resetLivePitch();
        changePhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      changePhase('processing');

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
          quitInProgressRef.current
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
          changePhase('instructions');
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
      quitInProgressRef.current ||
      startingRef.current
    ) {
      return;
    }

    const start = startRecordingRef.current;

    if (!start) {
      setErrorMessage(
        'The audio recorder is not ready. Please try again.',
      );
      changePhase('instructions');
      return;
    }

    clearTimers();
    resetLivePitch();
    setElapsedSeconds(0);

    startingRef.current = true;
    finishingRef.current = false;
    changePhase('recording');

    try {
      await start();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
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
          quitInProgressRef.current ||
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
        changePhase('instructions');
      }
    }
  }, [changePhase, clearTimers, resetLivePitch]);

  useEffect(() => {
    startRecordingAttemptRef.current = startRecordingAttempt;
  }, [startRecordingAttempt]);

  const beginCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    clearTimers();
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    changePhase('countdown');

    let remaining = EXERCISE_COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
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
      changePhase('listening');

      void playSingleNote(
        targetFrequency,
        EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
      )
        .then(async () => {
          if (
            !mountedRef.current ||
            pausedRef.current ||
            showQuitModalRef.current ||
            quitInProgressRef.current
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
            changePhase('instructions');
          }
        });
    }, 1000);
  }, [changePhase, clearTimers, targetFrequency]);

  useEffect(() => {
    beginCountdownRef.current = beginCountdown;
  }, [beginCountdown]);

  const openQuitModal = useCallback(() => {
    if (quitInProgressRef.current || showQuitModalRef.current) {
      return;
    }

    const activeScreen = screenRef.current;

    pausedScreenRef.current = activeScreen;
    pausedRepetitionRef.current = currentRepRef.current;

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
    if (quitInProgressRef.current) return;

    const interruptedScreen = pausedScreenRef.current;

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

    currentRepRef.current = pausedRepetitionRef.current;
    setCurrentRep(pausedRepetitionRef.current);
    setElapsedSeconds(0);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    resetLivePitch();

    startingRef.current = false;
    finishingRef.current = false;
    discardNextStopRef.current = false;

    beginCountdownRef.current?.();
  }, [resetLivePitch]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
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
      quitInProgressRef.current
    ) {
      return;
    }

    clearTimers();

    startingRef.current = false;
    finishingRef.current = false;
    pausedRef.current = false;
    quitInProgressRef.current = false;
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
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
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
    quitInProgressRef.current = false;
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
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    resetLivePitch();

    finishingRef.current = false;
    changePhase('instructions');
  }, [changePhase, clearTimers, resetLivePitch]);

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
    <>
      <ExerciseQuitModal
        visible={showQuitModal}
        title="Quit exercise?"
        message={
          pausedScreenRef.current === 'instructions' ||
          pausedScreenRef.current === 'results'
            ? 'Are you sure you want to leave Note Matching?'
            : pausedScreenRef.current === 'recording'
              ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
              : pausedScreenRef.current === 'processing'
                ? 'Your exercise is paused. Continue to resume processing your current results.'
                : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'
        }
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => {
          void quitExercise();
        }}
        continueLabel="Continue Exercise"
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />

      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={() => {
          setShowNoAudioModal(false);
          currentRepRef.current = repResultsRef.current.length + 1;
          setCurrentRep(currentRepRef.current);
          setElapsedSeconds(0);
          setErrorMessage('');
          finishingRef.current = false;
          startingRef.current = false;
          resetLivePitch();
          beginCountdownRef.current?.();
        }}
        onQuit={() => {
          void quitExercise();
        }}
        isQuitting={isQuitting}
      />
    </>
  );

  if (phase === 'instructions' && isLoadingAdaptiveParams) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level"
          icon="options-outline"
          iconSize={44}
          containerStyle={styles.centerScreen}
        />
        {quitModal}
      </>
    );
  }

  return (
    <>
      {phase === 'instructions' && (
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

      {phase === 'countdown' && (
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

      {phase === 'listening' && (
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

      {phase === 'recording' && (
        <View style={styles.phase}>
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
                          ? COLORS.lightGray
                          : `${pitchGuide.color}18`,
                      borderColor:
                        pitchGuide.cents === null
                          ? COLORS.border
                          : `${pitchGuide.color}70`,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.guideStatusText,
                      { color: pitchGuide.color },
                    ]}
                  >
                    {pitchGuide.label}
                  </Text>
                </View>
              </View>

              <View style={styles.pitchGuideInner}>
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

                  <View style={styles.pitchComparisonArrow}>
                    <Ionicons
                      name="mic-outline"
                      size={22}
                      color={COLORS.muted}
                    />
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
                      ← LOW
                    </Text>
                    <Text style={styles.pitchMeterCenterLabel}>
                      TARGET
                    </Text>
                    <Text style={styles.pitchMeterEdgeLabel}>
                      HIGH →
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
                          borderTopLeftRadius: 8,
                          borderBottomLeftRadius: 8,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.pitchMeterZone,
                        {
                          left: '20%',
                          width: '15%',
                          backgroundColor: COLORS.guideYellow,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.pitchMeterZone,
                        {
                          left: '35%',
                          width: '30%',
                          backgroundColor: COLORS.guideGreen,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.pitchMeterZone,
                        {
                          left: '65%',
                          width: '15%',
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
                          borderTopRightRadius: 8,
                          borderBottomRightRadius: 8,
                        },
                      ]}
                    />

                    <View style={styles.pitchMeterTargetLine} />

                    {pitchTrace.map((sample, index) => {
                      const traceLeft: DimensionValue =
                        `${clamp(50 + sample * 43, 7, 93)}%`;

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
                          borderColor:
                            pitchGuide.cents === null
                              ? COLORS.muted
                              : pitchGuide.color,
                          opacity:
                            pitchGuide.cents === null ? 0.55 : 1,
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
                    <Text style={styles.pitchMeterScaleText}>
                      0
                    </Text>
                    <Text style={styles.pitchMeterScaleText}>
                      +100 cents
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.metricsGrid}>
                <MetricCard
                  label="ACCURACY"
                  variant="noteMatching"
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
                  variant="noteMatching"
                  value={
                    livePitch.pitch > 0
                      ? `${Math.round(livePitch.stability)}%`
                      : '--'
                  }
                />

                <MetricCard
                  label="FREQUENCY"
                  variant="noteMatching"
                  value={
                    livePitch.pitch > 0
                      ? `${livePitch.pitch.toFixed(0)} Hz`
                      : '-- Hz'
                  }
                />
              </View>
            </View>

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
            <Text style={styles.timerText}>
              {elapsedSeconds.toFixed(1)} /{' '}
              {RECORDING_DURATION_SECONDS.toFixed(1)}s
            </Text>
          </ScrollView>
        </View>
      )}

      {phase === 'processing' && (
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing Your Singing"
          message={
            currentRep < adaptiveParams.repetitions
              ? `Checking repetition ${currentRep} of ${adaptiveParams.repetitions}.`
              : 'Calculating your final Note Matching result.'
          }
        />
      )}

      {phase === 'results' && result && (
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
              variant="noteMatching"
              value={`${result.score}%`}
            />

            <MetricCard
              label="DEVIATION"
              variant="noteMatching"
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
              variant="noteMatching"
              value={`${Math.round(result.averageClarity * 100)}%`}
            />

            <MetricCard
              label="VOICED FRAMES"
              variant="noteMatching"
              value={String(result.voicedFrames)}
            />
          </View>

          <View style={styles.feedbackCard}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={COLORS.brown}
            />

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

const styles = StyleSheet.create({
  phase: {
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
    borderRadius: 99,
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
    marginTop: 8,
  },
  timerTrack: {
    marginTop: 12,
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
    padding: 12,
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
    marginBottom: 10,
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
    backgroundColor: COLORS.brown,
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
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '53%',
  },
  guideStatusText: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    letterSpacing: 0.2,
    flexShrink: 1,
    textAlign: 'center',
  },
  pitchGuideInner: {
    width: '100%',
    backgroundColor: COLORS.white,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 13,
  },
  pitchTargetSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 5,
    paddingVertical: 5,
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
    fontSize: 29,
    lineHeight: 35,
    color: COLORS.brown,
    marginTop: 2,
  },
  pitchTargetFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 1,
  },
  pitchComparisonArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.lightGray,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  pitchDetectedSummary: {
    flex: 1,
    alignItems: 'flex-end',
  },
  pitchDetectedValue: {
    fontFamily: 'FredokaBold',
    fontSize: 29,
    lineHeight: 35,
    marginTop: 2,
  },
  horizontalPitchMeter: {
    width: '100%',
    marginTop: 19,
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
    width: 25,
    height: 25,
    marginLeft: -12.5,
    marginTop: -12.5,
    borderRadius: 13,
    borderWidth: 3,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    elevation: 4,
    shadowColor: COLORS.gray,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
  },
  pitchMeterMarkerInner: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  pitchMeterScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 7,
  },
  pitchMeterScaleText: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: COLORS.muted,
  },
  pitchGuideFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 14,
    paddingTop: 11,
    gap: 10,
  },
  pitchGuideHintRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  pitchGuideHint: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 14,
    color: COLORS.brown,
  },
  pitchGuideCents: {
    alignItems: 'flex-end',
    minWidth: 65,
  },
  pitchGuideCentsLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    letterSpacing: 0.45,
    color: COLORS.muted,
  },
  pitchGuideCentsValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    marginTop: 2,
  },
  metricsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    marginTop: 10,
  },
});