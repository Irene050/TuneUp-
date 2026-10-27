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
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  SUSTAINED_NOTE_STABILITY_PARAMS,
  type SustainedNoteStabilityParams,
  type Tier,
} from '@/constants/pitch';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateSustainedNoteStabilityParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import {
  measureSustainedNoteStability,
  type SustainedNoteStabilityMeasurement,
} from '@/services/measurement/pitch/sustainedNoteStability';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
  scoreSustainedNoteStabilityRepetitions,
  type SustainedNoteStabilityScoreResult,
} from '@/services/scoring/pitch/sustainedNoteStability';
import {
  calcLiveStability,
  calcPitchAccuracy,
} from '@/utils/dsp/pitch';
import {
  disposeNotePlayer,
  playSingleNote,
} from '@/utils/music/notePlayer';
import {
  createMusicalNote,
  getRandomPitchNote,
} from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const GREEN = '#54A879';
const LIGHT_GREEN = '#DFF2E6';
const YELLOW = '#E5B84B';
const RED = '#D96A6A';
const METER_GRAY = '#EAE3E5';

const EXERCISE_ID = 'sustainedNoteStability' as const;
const COMPONENT_ID = 'pitch' as const;
const RECORDING_INTERVAL_MS = 100;
const COUNTDOWN_SECONDS = 3;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'preparing'
  | 'countdown'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'results';

type MusicalNote = ReturnType<typeof createMusicalNote>;

export default function SustainedNoteStabilityScreen({
  tier,
}: Props) {
  const [currentTier, setCurrentTier] = useState<Tier>(
    tier ?? 'beginner',
  );
  const [params, setParams] =
    useState<SustainedNoteStabilityParams>(
      SUSTAINED_NOTE_STABILITY_PARAMS[tier ?? 'beginner'],
    );
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);
  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [currentRep, setCurrentRep] = useState(1);
  const [isQuitModalVisible, setIsQuitModalVisible] = useState(false);
  const [isStoppingForModal, setIsStoppingForModal] = useState(false);
  const [targetNote, setTargetNote] = useState<MusicalNote>(
    () => createMusicalNote(60),
  );
  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);
  const [liveFrequencies, setLiveFrequencies] = useState<number[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] =
    useState<SustainedNoteStabilityScoreResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const phaseRef = useRef<Phase>('instructions');

  const recordingRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const processingRef = useRef(false);
  const discardRecordingRef = useRef(false);

  const pausedRef = useRef(false);
  const modalVisibleRef = useRef(false);
  const navigatingAwayRef = useRef(false);
  const stopPendingForModalRef = useRef(false);

  const interruptedPhaseRef = useRef<Phase>('instructions');

  const elapsedRef = useRef(0);
  const currentRepRef = useRef(1);
  const targetNoteRef = useRef<MusicalNote>(createMusicalNote(60));

  const measurementsRef =
    useRef<SustainedNoteStabilityMeasurement[]>([]);
  const pitchHistoryRef = useRef<number[]>([]);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const recorderStartPromiseRef = useRef<Promise<void> | null>(null);

  const playTargetAndRecordRef =
    useRef<((note: MusicalNote) => Promise<void>) | null>(null);
  const resumeCurrentRepRef = useRef<(() => void) | null>(null);

  const changePhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    clearCountdownTimer();
    clearRecordingTimer();
  }, [clearCountdownTimer, clearRecordingTimer]);

  const resetLiveMeasurements = useCallback(() => {
    pitchHistoryRef.current = [];
    setLiveFrequencies([]);
    setLiveFrame(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParams() {
      setIsLoadingAdaptiveParams(true);

      let resolvedTier: Tier = tier ?? 'beginner';

      try {
        const { auth } = await import('@/services/firebase/config');
        const user = auth.currentUser;

        if (!tier && user) {
          const progress = await fetchComponentProgress(
            user.uid,
            COMPONENT_ID,
          );

          resolvedTier = progress?.currentTier ?? 'beginner';
        }

        if (cancelled) return;

        setCurrentTier(resolvedTier);

        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            COMPONENT_ID,
          );

          if (cancelled) return;

          recentScores = records
            .filter(
              record =>
                record.tier === resolvedTier &&
                record.templateId === EXERCISE_ID,
            )
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-5)
            .map(record => record.scorePct);
        }

        if (recentScores.length === 0) {
          const assessment = await getLatestAssessment();

          if (cancelled) return;

          const pitchScore = assessment?.scores.find(
            score => score.componentId === COMPONENT_ID,
          );

          if (typeof pitchScore?.scorePct === 'number') {
            recentScores = [pitchScore.scorePct];
          }
        }

        const generatedParams = generateSustainedNoteStabilityParams({
          tier: resolvedTier,
          recentScores,
        });

        if (cancelled) return;

        setParams(generatedParams);
      } catch (error) {
        console.error(
          'Failed to load sustained note adaptive parameters:',
          error,
        );

        if (!cancelled) {
          setCurrentTier(resolvedTier);
          setParams(SUSTAINED_NOTE_STABILITY_PARAMS[resolvedTier]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
        }
      }
    }

    void loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  const stopAndDiscardRecording = useCallback(async () => {
    discardRecordingRef.current = true;
    stopRequestedRef.current = true;
    stopPendingForModalRef.current = true;

    clearRecordingTimer();

    if (startingRecordingRef.current && !recordingRef.current) {
      if (mountedRef.current) {
        setIsStoppingForModal(true);
      }
      return;
    }

    if (!recordingRef.current && !stopInFlightRef.current) {
      discardRecordingRef.current = false;
      stopRequestedRef.current = false;
      stopPendingForModalRef.current = false;

      if (mountedRef.current) {
        setIsStoppingForModal(false);
      }
      return;
    }

    const stop = stopRecordingRef.current;

    if (!stop || stopInFlightRef.current) {
      if (mountedRef.current) {
        setIsStoppingForModal(stopInFlightRef.current);
      }
      return;
    }

    stopInFlightRef.current = true;

    if (mountedRef.current) {
      setIsStoppingForModal(true);
    }

    try {
      await stop();
    } catch (error) {
      console.error(
        'Failed to stop interrupted sustained note recording:',
        error,
      );

      stopInFlightRef.current = false;
      recordingRef.current = false;
      startingRecordingRef.current = false;
      stopRequestedRef.current = false;
      discardRecordingRef.current = false;
      stopPendingForModalRef.current = false;

      if (mountedRef.current) {
        setIsStoppingForModal(false);
      }
    }
  }, [clearRecordingTimer]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      modalVisibleRef.current = false;
      navigatingAwayRef.current = true;
      discardRecordingRef.current = true;

      clearTimers();

      const stop = stopRecordingRef.current;

      if (
        stop &&
        !stopInFlightRef.current &&
        (recordingRef.current || startingRecordingRef.current)
      ) {
        stopInFlightRef.current = true;

        void (async () => {
          try {
            await recorderStartPromiseRef.current?.catch(() => undefined);
            await stop();
          } catch (error) {
            console.warn(
              'Failed to stop recording during cleanup:',
              error,
            );
          }
        })();
      }

      void disposeNotePlayer().catch(error => {
        console.warn('Failed to dispose note player:', error);
      });
    };
  }, [clearTimers]);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      modalVisibleRef.current ||
      navigatingAwayRef.current ||
      discardRecordingRef.current ||
      phaseRef.current !== 'recording'
    ) {
      return;
    }

    setLiveFrame(frame);

    if (Number.isFinite(frame.pitch) && frame.pitch > 0) {
      const nextHistory = [
        ...pitchHistoryRef.current,
        frame.pitch,
      ].slice(-30);

      pitchHistoryRef.current = nextHistory;
      setLiveFrequencies(nextHistory);
    }
  }, []);

  const beginRecording = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      modalVisibleRef.current ||
      navigatingAwayRef.current ||
      recordingRef.current ||
      startingRecordingRef.current ||
      processingRef.current ||
      discardRecordingRef.current
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

    startingRecordingRef.current = true;
    stopRequestedRef.current = false;

    try {
      resetLiveMeasurements();
      changePhase('recording');

      const startPromise = start();
      recorderStartPromiseRef.current = startPromise;

      try {
        await startPromise;
      } finally {
        if (recorderStartPromiseRef.current === startPromise) {
          recorderStartPromiseRef.current = null;
        }
      }

      recordingRef.current = true;
      startingRecordingRef.current = false;

      if (
        !mountedRef.current ||
        pausedRef.current ||
        modalVisibleRef.current ||
        navigatingAwayRef.current ||
        discardRecordingRef.current ||
        stopRequestedRef.current
      ) {
        if (navigatingAwayRef.current) return;

        await stopAndDiscardRecording();
        return;
      }

      const durationMs = params.durationSec * 1000;
      const startTime = Date.now();

      clearRecordingTimer();

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          modalVisibleRef.current ||
          navigatingAwayRef.current ||
          !recordingRef.current ||
          stopRequestedRef.current
        ) {
          return;
        }

        const elapsed = Date.now() - startTime;
        elapsedRef.current = Math.min(elapsed, durationMs);
        setElapsedMs(elapsedRef.current);

        if (elapsed < durationMs) return;

        clearRecordingTimer();

        if (stopRequestedRef.current) return;

        stopRequestedRef.current = true;
        stopInFlightRef.current = true;

        const stop = stopRecordingRef.current;

        if (!stop) {
          stopInFlightRef.current = false;
          recordingRef.current = false;
          stopRequestedRef.current = false;

          setErrorMessage(
            'The microphone could not be stopped. Please try again.',
          );
          changePhase('instructions');
          return;
        }

        void stop().catch(error => {
          console.error(
            'Failed to stop sustained note recording:',
            error,
          );

          stopInFlightRef.current = false;
          recordingRef.current = false;
          stopRequestedRef.current = false;
          processingRef.current = false;

          if (
            mountedRef.current &&
            !pausedRef.current &&
            !navigatingAwayRef.current
          ) {
            setErrorMessage(
              'We could not finish the recording. Please try again.',
            );
            changePhase('instructions');
          }
        });
      }, RECORDING_INTERVAL_MS);
    } catch (error) {
      startingRecordingRef.current = false;
      recordingRef.current = false;
      stopInFlightRef.current = false;
      stopRequestedRef.current = false;

      console.error('Failed to start sustained note recording:', error);

      if (
        mountedRef.current &&
        !pausedRef.current &&
        !navigatingAwayRef.current
      ) {
        changePhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }

      if (mountedRef.current) {
        setIsStoppingForModal(false);
      }

      stopPendingForModalRef.current = false;
      discardRecordingRef.current = false;
    }
  }, [
    changePhase,
    clearRecordingTimer,
    params.durationSec,
    resetLiveMeasurements,
    stopAndDiscardRecording,
  ]);

  const playTargetAndRecord = useCallback(
    async (note: MusicalNote) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        modalVisibleRef.current ||
        navigatingAwayRef.current
      ) {
        return;
      }

      try {
        changePhase('listening');

        await playSingleNote(note.frequency, 1.5);

        if (
          !mountedRef.current ||
          pausedRef.current ||
          modalVisibleRef.current ||
          navigatingAwayRef.current
        ) {
          return;
        }

        await beginRecording();
      } catch (error) {
        console.error('Failed to play target note:', error);

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !navigatingAwayRef.current
        ) {
          setErrorMessage(
            'Unable to play the target note. Please try again.',
          );
          changePhase('instructions');
        }
      }
    },
    [beginRecording, changePhase],
  );

  useEffect(() => {
    playTargetAndRecordRef.current = playTargetAndRecord;
  }, [playTargetAndRecord]);

  const handleRecordingStop = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      recordingRef.current = false;
      startingRecordingRef.current = false;
      stopInFlightRef.current = false;
      clearRecordingTimer();

      if (discardRecordingRef.current) {
        discardRecordingRef.current = false;
        stopRequestedRef.current = false;
        processingRef.current = false;
        stopPendingForModalRef.current = false;

        if (mountedRef.current) {
          setIsStoppingForModal(false);
        }

        if (
          mountedRef.current &&
          !modalVisibleRef.current &&
          !pausedRef.current &&
          !navigatingAwayRef.current
        ) {
          resumeCurrentRepRef.current?.();
        }

        return;
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        modalVisibleRef.current ||
        navigatingAwayRef.current ||
        processingRef.current
      ) {
        stopRequestedRef.current = false;
        return;
      }

      processingRef.current = true;

      try {
        const measurement = measureSustainedNoteStability(
          samples,
          sampleRate,
          params.minClarity,
        );

        measurementsRef.current = [
          ...measurementsRef.current,
          measurement,
        ];

        const completedReps = measurementsRef.current.length;

        if (completedReps < params.repetitions) {
          const nextRep = completedReps + 1;

          currentRepRef.current = nextRep;
          setCurrentRep(nextRep);
          resetLiveMeasurements();

          stopRequestedRef.current = false;
          processingRef.current = false;

          await playTargetAndRecordRef.current?.(
            targetNoteRef.current,
          );

          return;
        }

        changePhase('processing');

        const score = scoreSustainedNoteStabilityRepetitions(
          measurementsRef.current,
          params,
          targetNoteRef.current.frequency,
        );

        await saveCompletedExercise(
          COMPONENT_ID,
          EXERCISE_ID,
          currentTier,
          score.score,
        );

        if (
          !mountedRef.current ||
          pausedRef.current ||
          navigatingAwayRef.current
        ) {
          return;
        }

        setResult(score);
        changePhase('results');
      } catch (error) {
        console.error('Sustained note processing error:', error);

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !navigatingAwayRef.current
        ) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          changePhase('instructions');
        }
      } finally {
        processingRef.current = false;
        stopRequestedRef.current = false;
      }
    },
    [
      changePhase,
      clearRecordingTimer,
      currentTier,
      params,
      resetLiveMeasurements,
    ],
  );

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;

    return () => {
      startRecordingRef.current = null;
      stopRecordingRef.current = null;
    };
  }, [startRecording, stopRecording]);

  const startCountdown = useCallback(() => {
    if (
      isLoadingAdaptiveParams ||
      pausedRef.current ||
      modalVisibleRef.current ||
      navigatingAwayRef.current ||
      startingRecordingRef.current ||
      recordingRef.current ||
      stopInFlightRef.current ||
      processingRef.current
    ) {
      return;
    }

    clearTimers();

    const generatedNote = getRandomPitchNote(currentTier);

    targetNoteRef.current = generatedNote;
    setTargetNote(generatedNote);
    setResult(null);
    setErrorMessage(null);

    currentRepRef.current = 1;
    setCurrentRep(1);

    measurementsRef.current = [];
    resetLiveMeasurements();

    processingRef.current = false;
    stopRequestedRef.current = false;
    discardRecordingRef.current = false;
    stopPendingForModalRef.current = false;

    let remaining = COUNTDOWN_SECONDS;

    setCountdown(remaining);
    changePhase('countdown');

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        modalVisibleRef.current ||
        navigatingAwayRef.current
      ) {
        return;
      }

      remaining -= 1;

      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }

      clearCountdownTimer();
      setCountdown(0);

      void playTargetAndRecordRef.current?.(generatedNote);
    }, 1000);
  }, [
    changePhase,
    clearTimers,
    currentTier,
    isLoadingAdaptiveParams,
    resetLiveMeasurements,
  ]);

  const requestPause = useCallback(() => {
    if (
      pausedRef.current ||
      modalVisibleRef.current ||
      navigatingAwayRef.current ||
      phaseRef.current === 'processing' ||
      phaseRef.current === 'results'
    ) {
      return;
    }

    interruptedPhaseRef.current = phaseRef.current;

    pausedRef.current = true;
    modalVisibleRef.current = true;

    clearTimers();
    setIsQuitModalVisible(true);

    if (
      recordingRef.current ||
      startingRecordingRef.current ||
      isRecording
    ) {
      if (isRecording) recordingRef.current = true;

      void stopAndDiscardRecording();
    } else {
      setIsStoppingForModal(false);
    }
  }, [clearTimers, isRecording, stopAndDiscardRecording]);

  const resumeCurrentRep = useCallback(() => {
    if (
      navigatingAwayRef.current ||
      stopPendingForModalRef.current ||
      stopInFlightRef.current ||
      startingRecordingRef.current ||
      recordingRef.current
    ) {
      return;
    }

    setIsQuitModalVisible(false);
    modalVisibleRef.current = false;
    pausedRef.current = false;
    setIsStoppingForModal(false);
    setErrorMessage(null);

    const interruptedPhase = interruptedPhaseRef.current;

    if (interruptedPhase === 'instructions') {
      changePhase('instructions');
      return;
    }

    if (interruptedPhase === 'processing') {
      changePhase('processing');
      return;
    }

    if (interruptedPhase === 'results') {
      changePhase('results');
      return;
    }

    resetLiveMeasurements();

    let remaining = COUNTDOWN_SECONDS;

    setCountdown(remaining);
    changePhase('countdown');
    clearCountdownTimer();

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        modalVisibleRef.current ||
        navigatingAwayRef.current
      ) {
        return;
      }

      remaining -= 1;

      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }

      clearCountdownTimer();
      setCountdown(0);

      void playTargetAndRecordRef.current?.(targetNoteRef.current);
    }, 1000);
  }, [
    changePhase,
    clearCountdownTimer,
    resetLiveMeasurements,
  ]);

  useEffect(() => {
    resumeCurrentRepRef.current = resumeCurrentRep;
  }, [resumeCurrentRep]);

  const quitExercise = useCallback(async () => {
    if (navigatingAwayRef.current) return;

    navigatingAwayRef.current = true;
    pausedRef.current = true;
    modalVisibleRef.current = false;
    discardRecordingRef.current = true;
    stopRequestedRef.current = true;
    stopPendingForModalRef.current = false;

    clearTimers();
    setIsQuitModalVisible(false);

    try {
      await recorderStartPromiseRef.current?.catch(error => {
        console.warn('Recorder startup ended with an error:', error);
      });

      if (
        recordingRef.current ||
        startingRecordingRef.current ||
        isRecording
      ) {
        const stop = stopRecordingRef.current;

        if (stop && !stopInFlightRef.current) {
          stopInFlightRef.current = true;
          await stop();
        }
      }
    } catch (error) {
      console.error(
        'Failed to stop recording when quitting:',
        error,
      );
    } finally {
      recordingRef.current = false;
      startingRecordingRef.current = false;
      stopInFlightRef.current = false;
    }

    try {
      await disposeNotePlayer();
    } catch (error) {
      console.warn('Failed to dispose note player:', error);
    }

    if (mountedRef.current) {
      router.replace('/exercises/pitch');
    }
  }, [clearTimers, isRecording]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (modalVisibleRef.current) return true;

        if (
          phaseRef.current === 'processing' ||
          phaseRef.current === 'results'
        ) {
          return false;
        }

        requestPause();
        return true;
      },
    );

    return () => subscription.remove();
  }, [requestPause]);

  const retry = useCallback(() => {
    clearTimers();

    if (
      recordingRef.current ||
      startingRecordingRef.current ||
      isRecording
    ) {
      discardRecordingRef.current = true;
      stopRequestedRef.current = true;

      const stop = stopRecordingRef.current;

      if (
        stop &&
        !stopInFlightRef.current &&
        !startingRecordingRef.current
      ) {
        stopInFlightRef.current = true;

        void stop().catch(error => {
          console.error(
            'Failed to stop recorder before retry:',
            error,
          );

          stopInFlightRef.current = false;
          recordingRef.current = false;
        });
      }
    }

    setResult(null);
    setErrorMessage(null);
    setCurrentRep(1);
    currentRepRef.current = 1;

    measurementsRef.current = [];
    resetLiveMeasurements();

    processingRef.current = false;
    pausedRef.current = false;
    modalVisibleRef.current = false;
    navigatingAwayRef.current = false;
    stopPendingForModalRef.current = false;

    setIsQuitModalVisible(false);
    setIsStoppingForModal(false);
    setCountdown(COUNTDOWN_SECONDS);
    changePhase('instructions');
  }, [
    changePhase,
    clearTimers,
    isRecording,
    resetLiveMeasurements,
  ]);

  const durationMs = params.durationSec * 1000;
  const progress =
    durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 0;

  const liveAccuracy =
    liveFrame && liveFrame.pitch > 0
      ? Math.max(
          0,
          calcPitchAccuracy(
            liveFrame.pitch,
            targetNote.frequency,
          ),
        )
      : 0;

  const liveStability = calcLiveStability(liveFrequencies);

  const quitMessage = isStoppingForModal
    ? 'Your exercise is paused while the microphone stops safely. The interrupted recording will not be scored, and your completed repetitions will be kept.'
    : interruptedPhaseRef.current === 'instructions'
      ? 'Are you sure you want to leave Sustained Note Stability?'
      : interruptedPhaseRef.current === 'recording'
        ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
        : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.';

  const quitModal = (
    <QuitExerciseModal
      visible={isQuitModalVisible}
      isStopping={isStoppingForModal}
      message={quitMessage}
      onContinue={resumeCurrentRep}
      onQuit={() => {
        void quitExercise();
      }}
    />
  );

  if (
    phase === 'preparing' ||
    (phase === 'instructions' && isLoadingAdaptiveParams)
  ) {
    return (
      <>
        <View style={styles.centerScreen}>
          <View style={styles.iconCircle}>
            <Ionicons
              name="musical-notes-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.title}>Preparing Your Exercise</Text>

          <Text style={styles.phaseSubtitle}>
            Setting up your personalized exercise...
          </Text>

          <ActivityIndicator
            size="large"
            color={BROWN}
            style={styles.loadingIndicator}
          />
        </View>
        {quitModal}
      </>
    );
  }

  if (phase === 'instructions') {
    return (
      <>
        <View style={styles.screen}>
          <Pressable
            style={styles.backButton}
            onPress={requestPause}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={22} color={BROWN} />
          </Pressable>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <View style={styles.iconCircle}>
              <Ionicons
                name="radio-outline"
                size={34}
                color={BROWN}
              />
            </View>

            <Text style={styles.title}>
              Sustained Note Stability
            </Text>

            <Text style={styles.subtitle}>Pitch</Text>

            <View style={styles.instructionCard}>
              <Text style={styles.cardTitle}>
                Exercise Instructions
              </Text>

              <Text style={styles.instruction}>
                Listen to the reference note before each recording.
              </Text>

              <Text style={styles.instruction}>
                Sing the same comfortable note and hold it steadily
                for {params.durationSec} seconds.
              </Text>

              <Text style={styles.instruction}>
                Complete {params.repetitions} repetitions while
                keeping your pitch steady without drifting sharp
                or flat.
              </Text>

              <View style={styles.prepareCard}>
                <View style={styles.prepareHeader}>
                  <Ionicons
                    name="mic-outline"
                    size={21}
                    color={BROWN}
                  />
                  <Text style={styles.prepareTitle}>
                    Before You Begin
                  </Text>
                </View>

                <View style={styles.prepareItem}>
                  <Ionicons
                    name="volume-mute-outline"
                    size={17}
                    color={BROWN}
                  />
                  <Text style={styles.prepareText}>
                    Find a quiet room or area with minimal
                    background noise.
                  </Text>
                </View>

                <View style={styles.prepareItem}>
                  <Ionicons
                    name="body-outline"
                    size={17}
                    color={BROWN}
                  />
                  <Text style={styles.prepareText}>
                    Sit upright or stand with your back straight
                    and your shoulders relaxed.
                  </Text>
                </View>

                <View style={styles.prepareItem}>
                  <Ionicons
                    name="mic-outline"
                    size={17}
                    color={BROWN}
                  />
                  <Text style={styles.prepareText}>
                    Sing toward the microphone for clearer
                    audio capture.
                  </Text>
                </View>
              </View>

              <View style={styles.targetBox}>
                <Ionicons name="remove" size={25} color={BROWN} />
                <Text style={styles.targetText}>
                  Keep the note steady
                </Text>
              </View>

              <Text style={styles.helperText}>
                TuneUp! measures pitch stability across all
                repetitions.
              </Text>
            </View>

            <View style={styles.tipCard}>
              <Ionicons name="bulb-outline" size={21} color={BROWN} />
              <Text style={styles.tipText}>
                Avoid intentionally changing pitch. Focus on
                maintaining one relaxed, consistent note.
              </Text>
            </View>

            <View style={styles.difficultyRow}>
              <Text style={styles.difficultyLabel}>Difficulty</Text>
              <Text style={styles.difficultyValue}>
                {currentTier}
              </Text>
            </View>

            <Pressable
              style={[
                styles.startButton,
                isLoadingAdaptiveParams && styles.disabledButton,
              ]}
              onPress={startCountdown}
              disabled={isLoadingAdaptiveParams}
              accessibilityRole="button"
            >
              {isLoadingAdaptiveParams ? (
                <ActivityIndicator size="small" color={WHITE} />
              ) : (
                <>
                  <Text style={styles.startButtonText}>
                    Start Exercise
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={18}
                    color={WHITE}
                  />
                </>
              )}
            </Pressable>

            {errorMessage && (
              <Text style={styles.errorText}>{errorMessage}</Text>
            )}
          </ScrollView>
        </View>
        {quitModal}
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="musical-notes-outline"
          title="Get Ready"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Get ready"
          prompt="A reference note will play next."
          onBack={requestPause}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'listening') {
    return (
      <>
        <ExerciseListeningScreen
          icon="volume-high-outline"
          title="Listen Carefully"
          currentRep={currentRep}
          repetitions={params.repetitions}
          promptTitle="Listen to the reference note"
          prompt="Listen to the reference note, then sing it steadily."
          liveContent={
            <View style={styles.targetCard}>
              <Text style={styles.targetLabel}>TARGET NOTE</Text>
              <Text style={styles.targetNote}>{targetNote.name}</Text>
              <Text style={styles.targetFrequency}>
                {Math.round(targetNote.frequency)} Hz
              </Text>
            </View>
          }
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.recordingContent}
          showsVerticalScrollIndicator={false}
        >

          <View style={styles.recordingIcon}>
            <Ionicons name="mic" size={34} color={BROWN} />
          </View>

          <Text style={styles.phaseTitle}>
            Hold {targetNote.name}
          </Text>

          <Text style={styles.phaseSubtitle}>
            Repetition {currentRep} of {params.repetitions}
          </Text>

          <Text style={styles.phaseSubtitle}>
            Keep your pitch as steady as possible.
          </Text>

          <View style={styles.liveCard}>
            <View style={styles.liveCardHeader}>
              <View style={styles.liveHeaderText}>
                <Text style={styles.liveCardTitle}>Live Pitch Monitor</Text>
              </View>
            </View>

            <View style={styles.pitchComparison}>
              <View style={styles.pitchColumn}>
                <Text style={styles.liveLabel}>TARGET NOTE</Text>
                <Text style={styles.liveTarget}>{targetNote.name}</Text>
                <Text style={styles.liveFrequency}>
                  {Math.round(targetNote.frequency)} Hz
                </Text>
              </View>

              <View style={styles.pitchComparisonDivider}>
                <Ionicons
                  name="arrow-forward"
                  size={20}
                  color={MUTED}
                />
              </View>

              <View style={styles.pitchColumn}>
                <Text style={styles.liveLabel}>YOUR NOTE</Text>
                <Text
                  style={[
                    styles.liveNote,
                    liveFrame?.pitch && liveFrame.pitch > 0
                      ? styles.liveNoteDetected
                      : styles.liveNoteWaiting,
                  ]}
                >
                  {liveFrame?.note ?? '--'}
                </Text>
                <Text style={styles.liveFrequency}>
                  {liveFrame && liveFrame.pitch > 0
                    ? `${Math.round(liveFrame.pitch)} Hz`
                    : 'Waiting for voice'}
                </Text>
              </View>
            </View>

            <LivePitchIndicator
              targetFrequency={targetNote.frequency}
              detectedFrequency={
                liveFrame && Number.isFinite(liveFrame.pitch) &&
                liveFrame.pitch > 0
                  ? liveFrame.pitch
                  : null
              }
            />

            <View style={styles.liveSectionDivider} />

            <LiveStabilityIndicator
              stability={liveStability}
              hasPitch={liveFrequencies.length >= 2}
            />

            <View style={styles.liveStats}>
              <View style={styles.liveStat}>
                <View style={styles.liveStatHeading}>
                  <Ionicons
                    name="locate-outline"
                    size={15}
                    color={BROWN}
                  />
                  <Text style={styles.liveStatLabel}>Accuracy</Text>
                </View>
                <Text style={styles.liveStatValue}>
                  {Math.round(liveAccuracy)}%
                </Text>
              </View>

              <View style={styles.liveStatsDivider} />

              <View style={styles.liveStat}>
                <View style={styles.liveStatHeading}>
                  <Ionicons
                    name="pulse-outline"
                    size={15}
                    color={BROWN}
                  />
                  <Text style={styles.liveStatLabel}>Stability</Text>
                </View>
                <Text style={styles.liveStatValue}>
                  {Math.round(liveStability)}%
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progress * 100}%` },
                ]}
              />
            </View>

            <Text style={styles.progressText}>
              {(elapsedMs / 1000).toFixed(1)}s / {params.durationSec}s
            </Text>
          </View>

          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>
              {isRecording ? 'Recording...' : 'Preparing microphone...'}
            </Text>
          </View>
        </ScrollView>
        {quitModal}
      </>
    );
  }

  if (phase === 'processing') {
    return (
      <>
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing Your Singing"
          message="Measuring your pitch stability across all repetitions."
          onBack={requestPause}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'results' && result) {
    return (
      <View style={styles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.resultsContent}
        >
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
            Sustained Note Stability Result
          </Text>

          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>Overall Score</Text>
            <Text style={styles.scoreValue}>{result.score}%</Text>
            <Text style={styles.scoreDescription}>
              {result.passed
                ? 'Your pitch stability reached the target level across all repetitions.'
                : 'Focus on keeping your pitch steadier and maintaining the required duration across repetitions.'}
            </Text>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>Target Note</Text>
            <View style={styles.noteDisplay}>
              <Text style={styles.resultNote}>{targetNote.name}</Text>
              <Text style={styles.resultFrequency}>
                {Math.round(targetNote.frequency)} Hz
              </Text>
            </View>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>
              Repetition Results
            </Text>

            <ResultRow
              label="Repetitions completed"
              value={`${result.repetitionsCompleted} / ${params.repetitions}`}
            />
            <ResultRow
              label="Average score"
              value={`${result.score}%`}
            />
            <ResultRow
              label="Average pitch variation"
              value={`${result.stabilityCents.toFixed(1)} cents`}
            />
            <ResultRow
              label="Required stability"
              value={`≤ ${params.stabilityThresholdCents} cents`}
            />
            <ResultRow
              label="Average duration"
              value={`${result.durationSec.toFixed(1)} s`}
            />
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>
              Scores by Repetition
            </Text>

            {result.repetitionScores.map((repetitionScore, index) => (
              <ResultRow
                key={`repetition-${index}`}
                label={`Repetition ${index + 1}`}
                value={`${repetitionScore}%`}
              />
            ))}
          </View>

          <View style={styles.tipCard}>
            <Ionicons name="bulb-outline" size={21} color={BROWN} />
            <Text style={styles.tipText}>
              {result.passed
                ? 'Nice work! Continue practicing sustained notes to build consistent pitch control across repetitions.'
                : 'Try relaxing your throat and supporting the note with steady breath while avoiding unnecessary pitch movement.'}
            </Text>
          </View>

          <Pressable style={styles.startButton} onPress={retry}>
            <Text style={styles.startButtonText}>Try Again</Text>
            <Ionicons name="refresh" size={18} color={WHITE} />
          </Pressable>

          <Pressable
            style={styles.doneButton}
            onPress={() => {
              void quitExercise();
            }}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return null;
}


function LivePitchIndicator({
  targetFrequency,
  detectedFrequency,
}: {
  targetFrequency: number;
  detectedFrequency: number | null;
}) {
  const hasPitch =
    detectedFrequency !== null &&
    Number.isFinite(detectedFrequency) &&
    detectedFrequency > 0 &&
    Number.isFinite(targetFrequency) &&
    targetFrequency > 0;

  const cents = hasPitch
    ? 1200 * Math.log2(detectedFrequency / targetFrequency)
    : null;

  const absoluteCents = cents === null ? null : Math.abs(cents);

  const status =
    cents === null
      ? 'LISTENING'
      : absoluteCents! <= 25
        ? 'IN TUNE'
        : cents < 0
          ? 'TOO LOW'
          : 'TOO HIGH';

  const statusColor =
    cents === null
      ? MUTED
      : absoluteCents! <= 25
        ? GREEN
        : absoluteCents! <= 60
          ? YELLOW
          : RED;

  const markerPosition =
    cents === null
      ? 50
      : Math.max(3, Math.min(97, 50 + (cents / 100) * 47));

  return (
    <View style={styles.pitchIndicator}>
      <View style={styles.pitchIndicatorHeader}>
        <View>
          <Text style={styles.indicatorTitle}>Pitch Accuracy</Text>
          <Text style={styles.indicatorSubtitle}>
            Distance from target
          </Text>
        </View>

        <View
          style={[
            styles.pitchStatusBadge,
            { backgroundColor: `${statusColor}20` },
          ]}
        >
          <View
            style={[
              styles.pitchStatusDot,
              { backgroundColor: statusColor },
            ]}
          />
          <Text
            style={[
              styles.pitchStatusText,
              { color: statusColor },
            ]}
          >
            {status}
          </Text>
        </View>
      </View>

      <View style={styles.pitchMeterLabels}>
        <Text style={styles.pitchMeterEndLabel}>FLAT</Text>
        <Text style={styles.pitchMeterCenterLabel}>IN TUNE</Text>
        <Text style={styles.pitchMeterEndLabel}>SHARP</Text>
      </View>

      <View style={styles.pitchMeter}>
        <View
          style={[styles.pitchMeterZone, styles.pitchMeterRed]}
        />
        <View
          style={[styles.pitchMeterZone, styles.pitchMeterYellow]}
        />
        <View
          style={[styles.pitchMeterZone, styles.pitchMeterGreen]}
        />
        <View
          style={[styles.pitchMeterZone, styles.pitchMeterYellow]}
        />
        <View
          style={[styles.pitchMeterZone, styles.pitchMeterRed]}
        />

        <View
          style={[
            styles.pitchMeterMarker,
            { left: `${markerPosition}%` },
            !hasPitch && styles.pitchMeterMarkerInactive,
          ]}
        />
      </View>

      <View style={styles.centsRow}>
        <Text style={styles.centsLabel}>Pitch deviation</Text>
        <Text
          style={[
            styles.centsValue,
            { color: hasPitch ? statusColor : MUTED },
          ]}
        >
          {cents === null
            ? '-- cents'
            : cents === 0
              ? '0 cents'
              : `${cents > 0 ? '+' : ''}${cents.toFixed(1)} cents`}
        </Text>
      </View>
    </View>
  );
}

function LiveStabilityIndicator({
  stability,
  hasPitch,
}: {
  stability: number;
  hasPitch: boolean;
}) {
  const safeStability = Number.isFinite(stability)
    ? Math.max(0, Math.min(100, stability))
    : 0;

  const status = !hasPitch
    ? 'WAITING'
    : safeStability >= 80
      ? 'STEADY'
      : safeStability >= 60
        ? 'MODERATE'
        : 'UNSTEADY';

  const statusColor = !hasPitch
    ? MUTED
    : safeStability >= 80
      ? GREEN
      : safeStability >= 60
        ? YELLOW
        : RED;

  return (
    <View style={styles.stabilityIndicator}>
      <View style={styles.stabilityHeader}>
        <View style={styles.stabilityHeadingText}>
          <Text style={styles.indicatorTitle}>
            Pitch Stability
          </Text>
        </View>
      </View>

      <View style={styles.stabilityTrack}>
        <View
          style={[
            styles.stabilityFill,
            {
              width: hasPitch ? `${safeStability}%` : '0%',
              backgroundColor: statusColor,
            },
          ]}
        />
      </View>

      <View style={styles.stabilityFooter}>
        <Text style={styles.stabilityScaleLabel}>
          Less steady
        </Text>
        <Text
          style={[
            styles.stabilityStatus,
            { color: statusColor },
          ]}
        >
          {status}
        </Text>
        <Text style={styles.stabilityScaleLabel}>
          More steady
        </Text>
      </View>
    </View>
  );
}

function QuitExerciseModal({
  visible,
  isStopping,
  message,
  onContinue,
  onQuit,
}: {
  visible: boolean;
  isStopping: boolean;
  message: string;
  onContinue: () => void;
  onQuit: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onContinue}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}>
            <Ionicons
              name="exit-outline"
              size={30}
              color={BROWN}
            />
          </View>

          <Text style={styles.modalTitle}>Quit exercise?</Text>

          <Text style={styles.modalMessage}>{message}</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            disabled={isStopping}
            onPress={onContinue}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.buttonPressed,
              isStopping && styles.buttonDisabled,
            ]}
          >
            {isStopping ? (
              <ActivityIndicator size="small" color={BROWN} />
            ) : (
              <Text style={styles.continueButtonText}>
                Continue Exercise
              </Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
            onPress={onQuit}
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.quitButtonText}>
              Quit Exercise
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ResultRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultRowLabel}>{label}</Text>
      <Text style={styles.resultRowValue}>{value}</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 70,
    paddingBottom: 40,
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
  activeBackButton: {
    position: 'absolute',
    top: 12,
    left: 4,
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
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },
  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  prepareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  prepareTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
    marginLeft: 9,
  },
  prepareItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  prepareText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },
  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 14,
  },
  instruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: BROWN,
    marginBottom: 10,
  },
  targetBox: {
    backgroundColor: PINK,
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 8,
  },
  targetText: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
  },
  helperText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },
  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },
  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 10,
  },
  difficultyRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 20,
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
  startButton: {
    width: '100%',
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  disabledButton: {
    opacity: 0.7,
  },
  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },
  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 12,
  },
  loadingIndicator: {
    marginTop: 20,
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
    marginTop: 8,
  },
  targetCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    padding: 24,
    marginTop: 28,
  },
  targetLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.5,
  },
  targetNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    marginTop: 4,
  },
  targetFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },
  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    marginTop: 12,
    alignItems: 'center',
  },
  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  liveTarget: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    marginTop: 3,
  },
  liveDivider: {
    width: '70%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },
  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 3,
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
  progressContainer: {
    width: '100%',
    marginTop: 22,
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 5,
  },
  progressText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 7,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: BROWN,
    marginRight: 7,
  },
  recordingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
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
    marginBottom: 10,
  },
  noteDisplay: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  resultNote: {
    fontFamily: 'FredokaBold',
    fontSize: 31,
    color: BROWN,
  },
  resultFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
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
    flexShrink: 0,
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
  
  liveCardHeader: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  liveHeaderText: {
    flex: 1,
    paddingRight: 8,
  },
  liveCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
  },
  liveCardSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
    marginTop: 3,
  },
  liveRecordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  liveRecordingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: RED,
    marginRight: 5,
  },
  liveRecordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
  },
  pitchComparison: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: WHITE,
    borderRadius: 17,
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  pitchColumn: {
    flex: 1,
    alignItems: 'center',
  },
  pitchComparisonDivider: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  liveNoteDetected: {
    color: BROWN,
  },
  liveNoteWaiting: {
    color: MUTED,
  },
  pitchIndicator: {
    width: '100%',
    marginTop: 22,
  },
  pitchIndicatorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  indicatorTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
  indicatorSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 2,
  },
  pitchStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  pitchStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 5,
  },
  pitchStatusText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
  },
  pitchMeterLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 7,
  },
  pitchMeterEndLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  pitchMeterCenterLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: GREEN,
  },
  pitchMeter: {
    width: '100%',
    height: 14,
    flexDirection: 'row',
    borderRadius: 7,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: METER_GRAY,
  },
  pitchMeterZone: {
    flex: 1,
    height: '100%',
  },
  pitchMeterRed: {
    backgroundColor: '#E8A1A1',
  },
  pitchMeterYellow: {
    backgroundColor: '#F0D58B',
  },
  pitchMeterGreen: {
    backgroundColor: '#86CBA2',
  },
  pitchMeterMarker: {
    position: 'absolute',
    top: -3,
    width: 5,
    height: 20,
    marginLeft: -2.5,
    borderRadius: 3,
    backgroundColor: BROWN,
    borderWidth: 1,
    borderColor: WHITE,
  },
  pitchMeterMarkerInactive: {
    opacity: 0.45,
  },
  centsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  centsLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  centsValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
  },
  liveSectionDivider: {
    width: '100%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 20,
  },
  stabilityIndicator: {
    width: '100%',
  },
  stabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stabilityIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  stabilityHeadingText: {
    flex: 1,
  },
  stabilityPercentage: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    marginLeft: 8,
  },
  stabilityTrack: {
    height: 10,
    width: '100%',
    backgroundColor: METER_GRAY,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 15,
  },
  stabilityFill: {
    height: '100%',
    borderRadius: 5,
  },
  stabilityFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 7,
  },
  stabilityScaleLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  stabilityStatus: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
  },
  liveStatHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveStatsDivider: {
    width: 1,
    backgroundColor: BORDER,
    alignSelf: 'stretch',
  },
});