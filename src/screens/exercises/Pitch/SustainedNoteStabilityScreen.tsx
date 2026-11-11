import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Alert, BackHandler, Pressable, ScrollView, Text, View } from 'react-native';

import { usePhaseState } from '@/hooks/usePhaseState';
import {
  SUSTAINED_NOTE_STABILITY_PARAMS,
  type SustainedNoteStabilityParams,
  type Tier,
} from '@/constants/params';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';

import {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  default as ExerciseScreen,
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

import {
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
  EXERCISE_RECORDING_INTERVAL_MS,
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { LivePitchIndicator as ExerciseLivePitchIndicator } from '@/screens/exercises/Pitch/LivePitchIndicator';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';

import {
  ExerciseNoAudioModal,
  ExerciseQuitModal,
} from '@/components/exercises/ExerciseModals';

const EXERCISE_ID = 'sustainedNoteStability' as const;
const COMPONENT_ID = 'pitch' as const;

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
  const [isLoadingParams, setIsLoadingParams] =
    useState(true);
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [isInitialListening, setIsInitialListening] = useState(false);
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [currentRep, setCurrentRep] = useState(1);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const [isStoppingForModal, setIsStoppingForModal] = useState(false);
  const [targetNote, setTargetNote] = useState<MusicalNote>(
    () => createMusicalNote(60),
  );
  const [liveAudioFrame, setLiveAudioFrame] =
    useState<LiveAudioFrame | null>(null);
  const [liveFrequencies, setLiveFrequencies] = useState<number[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] =
    useState<SustainedNoteStabilityScoreResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const isRecordingRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const processingRef = useRef(false);
  const discardRecordingRef = useRef(false);

  const pausedRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const navigatingAwayRef = useRef(false);
  const stopPendingForModalRef = useRef(false);

  const pausedPhaseRef = useRef<Phase>('instructions');

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
  const continueExerciseRef = useRef<(() => void) | null>(null);

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
    setLiveAudioFrame(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParams() {
      setIsLoadingParams(true);

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
      } catch (errorMessage) {
        console.error(
          'Failed to load sustained note adaptive parameters:',
          errorMessage,
        );

        if (!cancelled) {
          setCurrentTier(resolvedTier);
          setParams(SUSTAINED_NOTE_STABILITY_PARAMS[resolvedTier]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingParams(false);
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
    recordingStopRequestedRef.current = true;
    stopPendingForModalRef.current = true;

    clearRecordingTimer();

    if (startingRecordingRef.current && !isRecordingRef.current) {
      if (mountedRef.current) {
        setIsStoppingForModal(true);
      }
      return;
    }

    if (!isRecordingRef.current && !stopInFlightRef.current) {
      discardRecordingRef.current = false;
      recordingStopRequestedRef.current = false;
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
    } catch (errorMessage) {
      console.error(
        'Failed to stop interrupted sustained note recording:',
        errorMessage,
      );

      stopInFlightRef.current = false;
      isRecordingRef.current = false;
      startingRecordingRef.current = false;
      recordingStopRequestedRef.current = false;
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
      showQuitModalRef.current = false;
      navigatingAwayRef.current = true;
      discardRecordingRef.current = true;

      clearTimers();

      const stop = stopRecordingRef.current;

      if (
        stop &&
        !stopInFlightRef.current &&
        (isRecordingRef.current || startingRecordingRef.current)
      ) {
        stopInFlightRef.current = true;

        void (async () => {
          try {
            await recorderStartPromiseRef.current?.catch(() => undefined);
            await stop();
          } catch (errorMessage) {
            console.warn(
              'Failed to stop recording during cleanup:',
              errorMessage,
            );
          }
        })();
      }

      void disposeNotePlayer().catch(errorMessage => {
        console.warn('Failed to dispose note player:', errorMessage);
      });
    };
  }, [clearTimers]);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      navigatingAwayRef.current ||
      discardRecordingRef.current ||
      phaseRef.current !== 'recording'
    ) {
      return;
    }

    setLiveAudioFrame(frame);

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
      showQuitModalRef.current ||
      navigatingAwayRef.current ||
      isRecordingRef.current ||
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
      setPhase('instructions');
      return;
    }

    startingRecordingRef.current = true;
    recordingStopRequestedRef.current = false;

    try {
      resetLiveMeasurements();
      setPhase('recording');

      const startPromise = start();
      recorderStartPromiseRef.current = startPromise;

      try {
        await startPromise;
      } finally {
        if (recorderStartPromiseRef.current === startPromise) {
          recorderStartPromiseRef.current = null;
        }
      }

      isRecordingRef.current = true;
      startingRecordingRef.current = false;

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        navigatingAwayRef.current ||
        discardRecordingRef.current ||
        recordingStopRequestedRef.current
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
          showQuitModalRef.current ||
          navigatingAwayRef.current ||
          !isRecordingRef.current ||
          recordingStopRequestedRef.current
        ) {
          return;
        }

        const elapsedSeconds = Date.now() - startTime;
        elapsedRef.current = Math.min(elapsedSeconds, durationMs);
        setElapsedMs(elapsedRef.current);

        if (elapsedSeconds < durationMs) return;

        clearRecordingTimer();

        if (recordingStopRequestedRef.current) return;

        recordingStopRequestedRef.current = true;
        stopInFlightRef.current = true;

        const stop = stopRecordingRef.current;

        if (!stop) {
          stopInFlightRef.current = false;
          isRecordingRef.current = false;
          recordingStopRequestedRef.current = false;

          setErrorMessage(
            'The microphone could not be stopped. Please try again.',
          );
          setPhase('instructions');
          return;
        }

        void stop().catch(errorMessage => {
          console.error(
            'Failed to stop sustained note recording:',
            errorMessage,
          );

          stopInFlightRef.current = false;
          isRecordingRef.current = false;
          recordingStopRequestedRef.current = false;
          processingRef.current = false;

          if (
            mountedRef.current &&
            !pausedRef.current &&
            !navigatingAwayRef.current
          ) {
            setErrorMessage(
              'We could not finish the recording. Please try again.',
            );
            setPhase('instructions');
          }
        });
      }, EXERCISE_RECORDING_INTERVAL_MS);
    } catch (errorMessage) {
      startingRecordingRef.current = false;
      isRecordingRef.current = false;
      stopInFlightRef.current = false;
      recordingStopRequestedRef.current = false;

      console.error('Failed to start sustained note recording:', errorMessage);

      if (
        mountedRef.current &&
        !pausedRef.current &&
        !navigatingAwayRef.current
      ) {
        setPhase('instructions');

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
    setPhase,
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
        showQuitModalRef.current ||
        navigatingAwayRef.current
      ) {
        return;
      }

      try {
        setPhase('listening');

        await playSingleNote(note.frequency, 1.5);

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          navigatingAwayRef.current
        ) {
          return;
        }

        await beginRecording();
      } catch (errorMessage) {
        console.error('Failed to play target note:', errorMessage);

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !navigatingAwayRef.current
        ) {
          setErrorMessage(
            'Unable to play the target note. Please try again.',
          );
          setPhase('instructions');
        }
      }
    },
    [beginRecording, setPhase],
  );

  useEffect(() => {
    playTargetAndRecordRef.current = playTargetAndRecord;
  }, [playTargetAndRecord]);

  const handleRecordingStop = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      isRecordingRef.current = false;
      startingRecordingRef.current = false;
      stopInFlightRef.current = false;
      clearRecordingTimer();

      if (discardRecordingRef.current) {
        discardRecordingRef.current = false;
        recordingStopRequestedRef.current = false;
        processingRef.current = false;
        stopPendingForModalRef.current = false;

        if (mountedRef.current) {
          setIsStoppingForModal(false);
        }

        if (
          mountedRef.current &&
          !showQuitModalRef.current &&
          !pausedRef.current &&
          !navigatingAwayRef.current
        ) {
          continueExerciseRef.current?.();
        }

        return;
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        navigatingAwayRef.current ||
        processingRef.current
      ) {
        recordingStopRequestedRef.current = false;
        return;
      }

      if (!hasSufficientRecordedSignal(samples)) {
        recordingStopRequestedRef.current = false;
        processingRef.current = false;
        setErrorMessage(null);
        pausedPhaseRef.current = 'recording';
        setPhase('instructions');
        setShowNoAudioModal(true);
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

          recordingStopRequestedRef.current = false;
          processingRef.current = false;

          await playTargetAndRecordRef.current?.(
            targetNoteRef.current,
          );

          return;
        }

        setPhase('processing');

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
        setPhase('results');
      } catch (errorMessage) {
        console.error('Sustained note processing error:', errorMessage);

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !navigatingAwayRef.current
        ) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          setPhase('instructions');
        }
      } finally {
        processingRef.current = false;
        recordingStopRequestedRef.current = false;
      }
    },
    [
      setPhase,
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
      isLoadingParams ||
      pausedRef.current ||
      showQuitModalRef.current ||
      navigatingAwayRef.current ||
      startingRecordingRef.current ||
      isRecordingRef.current ||
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
    recordingStopRequestedRef.current = false;
    discardRecordingRef.current = false;
    stopPendingForModalRef.current = false;

    let remaining = EXERCISE_COUNTDOWN_SECONDS;

    setCountdown(remaining);
    setIsInitialListening(false);
    setPhase('countdown');

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
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
    setPhase,
    clearTimers,
    currentTier,
    isLoadingParams,
    resetLiveMeasurements,
  ]);

  const requestPause = useCallback(() => {
    if (
      pausedRef.current ||
      showQuitModalRef.current ||
      navigatingAwayRef.current ||
      phaseRef.current === 'processing' ||
      phaseRef.current === 'results'
    ) {
      return;
    }

    pausedPhaseRef.current = phaseRef.current;

    pausedRef.current = true;
    showQuitModalRef.current = true;

    clearTimers();
    setShowQuitModal(true);

    if (
      isRecordingRef.current ||
      startingRecordingRef.current ||
      isRecording
    ) {
      if (isRecording) isRecordingRef.current = true;

      void stopAndDiscardRecording();
    } else {
      setIsStoppingForModal(false);
    }
  }, [clearTimers, isRecording, stopAndDiscardRecording]);

  const continueExercise = useCallback(() => {
    if (
      navigatingAwayRef.current ||
      stopPendingForModalRef.current ||
      stopInFlightRef.current ||
      startingRecordingRef.current ||
      isRecordingRef.current
    ) {
      return;
    }

    setShowQuitModal(false);
    showQuitModalRef.current = false;
    pausedRef.current = false;
    setIsStoppingForModal(false);
    setErrorMessage(null);

    const interruptedPhase = pausedPhaseRef.current;

    if (interruptedPhase === 'instructions') {
      setPhase('instructions');
      return;
    }

    if (interruptedPhase === 'processing') {
      setPhase('processing');
      return;
    }

    if (interruptedPhase === 'results') {
      setPhase('results');
      return;
    }

    resetLiveMeasurements();

    let remaining = EXERCISE_COUNTDOWN_SECONDS;

    setCountdown(remaining);
    setPhase('countdown');
    clearCountdownTimer();

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
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
    setPhase,
    clearCountdownTimer,
    resetLiveMeasurements,
  ]);

  useEffect(() => {
    continueExerciseRef.current = continueExercise;
  }, [continueExercise]);

  const quitExercise = useCallback(async () => {
    if (navigatingAwayRef.current) return;

    navigatingAwayRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    discardRecordingRef.current = true;
    recordingStopRequestedRef.current = true;
    stopPendingForModalRef.current = false;

    clearTimers();
    setShowQuitModal(false);

    try {
      await recorderStartPromiseRef.current?.catch(errorMessage => {
        console.warn('Recorder startup ended with an error:', errorMessage);
      });

      if (
        isRecordingRef.current ||
        startingRecordingRef.current ||
        isRecording
      ) {
        const stop = stopRecordingRef.current;

        if (stop && !stopInFlightRef.current) {
          stopInFlightRef.current = true;
          await stop();
        }
      }
    } catch (errorMessage) {
      console.error(
        'Failed to stop recording when quitting:',
        errorMessage,
      );
    } finally {
      isRecordingRef.current = false;
      startingRecordingRef.current = false;
      stopInFlightRef.current = false;
    }

    try {
      await disposeNotePlayer();
    } catch (errorMessage) {
      console.warn('Failed to dispose note player:', errorMessage);
    }

    if (mountedRef.current) {
      router.replace('/exercises/pitch');
    }
  }, [clearTimers, isRecording]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) return true;

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
      isRecordingRef.current ||
      startingRecordingRef.current ||
      isRecording
    ) {
      discardRecordingRef.current = true;
      recordingStopRequestedRef.current = true;

      const stop = stopRecordingRef.current;

      if (
        stop &&
        !stopInFlightRef.current &&
        !startingRecordingRef.current
      ) {
        stopInFlightRef.current = true;

        void stop().catch(errorMessage => {
          console.error(
            'Failed to stop recorder before retry:',
            errorMessage,
          );

          stopInFlightRef.current = false;
          isRecordingRef.current = false;
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
    showQuitModalRef.current = false;
    navigatingAwayRef.current = false;
    stopPendingForModalRef.current = false;

    setShowQuitModal(false);
    setIsStoppingForModal(false);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setPhase('instructions');
  }, [
    setPhase,
    clearTimers,
    isRecording,
    resetLiveMeasurements,
  ]);

  const durationMs = params.durationSec * 1000;
  const progress =
    durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 0;

  const liveAccuracy =
    liveAudioFrame && liveAudioFrame.pitch > 0
      ? Math.max(
          0,
          calcPitchAccuracy(
            liveAudioFrame.pitch,
            targetNote.frequency,
          ),
        )
      : 0;

  const liveStability = calcLiveStability(liveFrequencies);

  const quitMessage = isStoppingForModal
    ? 'Your exercise is paused while the microphone stops safely. The interrupted recording will not be scored, and your completed repetitions will be kept.'
    : pausedPhaseRef.current === 'instructions'
      ? 'Are you sure you want to leave Sustained Note Stability?'
      : pausedPhaseRef.current === 'recording'
        ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
        : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.';

  const quitModal = (
    <>
      <QuitExerciseModal
        visible={showQuitModal}
        message={quitMessage}
        onContinue={continueExercise}
        onQuit={() => {
          void quitExercise();
        }}
      />
      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={function redoExerciseRepetition() {
          setShowNoAudioModal(false);
          setErrorMessage(null);
          continueExerciseRef.current?.();
        }}
        onQuit={() => {
          void quitExercise();
        }}
        isQuitting={isStoppingForModal}
      />
    </>
  );

  if (
    phase === 'preparing' ||
    (phase === 'instructions' && isLoadingParams)
  ) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Setting up your personalized exercise..."
          icon="musical-notes-outline"
          iconSize={34}
          containerStyle={exerciseStyles.centerScreenVariant1}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'instructions') {
    return (
      <>
        <ExerciseScreen
          title="Sustained Note Stability"
          category="Pitch"
          icon="radio-outline"
          instructions={`Listen to the reference note before each recording. Sing the same comfortable note and hold it steadily for ${params.durationSec} seconds. Complete ${params.repetitions} repetitions while keeping your pitch steady without drifting sharp or flat.`}
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
              text: 'Sing toward the microphone for clearer audio capture.',
            },
          ]}
          summary={[
            {
              label: 'DURATION',
              value: `${params.durationSec} seconds`,
              hint: 'per repetition',
            },
            {
              label: 'REPETITIONS',
              value: String(params.repetitions),
            },
            {
              label: 'TARGET',
              value: 'Keep the note steady',
            },
          ]}
          tip="Avoid intentionally changing pitch. Focus on maintaining one relaxed, consistent note."
          tier={currentTier}
          onBack={requestPause}
          onStart={() => {
            setIsInitialListening(true);
            setPhase('listening');
          }}
          errorMessage={errorMessage}
          startDisabled={isLoadingParams}
          startLabel={
            isLoadingParams ? 'Preparing...' : 'Start Exercise'
          }
        />
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
            <View style={exerciseStyles.targetCard}>
              <Text style={exerciseStyles.targetLabel}>TARGET NOTE</Text>
              <Text style={exerciseStyles.targetNote}>{targetNote.name}</Text>
              <Text style={exerciseStyles.repResultDetails}>
                {Math.round(targetNote.frequency)} Hz
              </Text>
            </View>
          }
          onContinue={
            isInitialListening
              ? startCountdown
              : undefined
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
          style={exerciseStyles.screen}
          contentContainerStyle={exerciseStyles.recordingContentVariant3}
          showsVerticalScrollIndicator={false}
        >

          <View style={exerciseStyles.iconCircle}>
            <Ionicons name="mic" size={34} color={COLORS.brown} />
          </View>

          <Text style={exerciseStyles.phaseTitleVariant1}>
            Sustain {targetNote.name}
          </Text>

          <Text style={exerciseStyles.phaseSubtitleVariant1}>
            Repetition {currentRep} of {params.repetitions}
          </Text>

          <View style={exerciseStyles.liveCardVariant9}>
            <View style={exerciseStyles.liveCardHeaderVariant2}>
              <Text style={exerciseStyles.scoreRowValue}>LIVE PITCH GUIDE</Text>
            </View>

            <View style={exerciseStyles.pitchComparison}>
              <View style={exerciseStyles.sessionPart}>
                <Text style={exerciseStyles.scoreRowLabel}>TARGET NOTE</Text>
                <Text style={exerciseStyles.liveTarget}>{targetNote.name}</Text>
                <Text style={exerciseStyles.repResultDetails}>
                  {Math.round(targetNote.frequency)} Hz
                </Text>
              </View>

              <View style={exerciseStyles.pitchComparisonDividerVariant1}>
                <Ionicons
                  name="mic-outline"
                  size={20}
                  color={COLORS.muted}
                />
              </View>

              <View style={exerciseStyles.sessionPart}>
                <Text style={exerciseStyles.scoreRowLabel}>YOUR NOTE</Text>
                <Text
                  style={[
                    exerciseStyles.liveNoteVariant1,
                    liveAudioFrame?.pitch && liveAudioFrame.pitch > 0
                      ? exerciseStyles.liveNoteDetected
                      : exerciseStyles.liveNoteWaiting,
                  ]}
                >
                  {liveAudioFrame?.note ?? '--'}
                </Text>
                <Text style={exerciseStyles.repResultDetails}>
                  {liveAudioFrame && liveAudioFrame.pitch > 0
                    ? `${Math.round(liveAudioFrame.pitch)} Hz`
                    : 'Waiting for voice'}
                </Text>
              </View>
            </View>

            <ExerciseLivePitchIndicator
              targetNote={targetNote.name}
              targetFrequency={targetNote.frequency}
              detectedNote={liveAudioFrame && liveAudioFrame.pitch > 0 ? liveAudioFrame.note : null}
              detectedFrequency={liveAudioFrame && Number.isFinite(liveAudioFrame.pitch) && liveAudioFrame.pitch > 0 ? liveAudioFrame.pitch : null}
            />

            <View style={exerciseStyles.liveSectionDivider} />

            <LiveStabilityIndicator
              stability={liveStability}
              hasPitch={liveFrequencies.length >= 2}
            />

            <View style={exerciseStyles.liveStatsVariant2}>
              <View style={exerciseStyles.recordingHeader}>
                <View style={exerciseStyles.liveStatHeading}>
                  <Text style={exerciseStyles.guideText}>ACCURACY</Text>
                </View>
                <Text style={exerciseStyles.liveStatValueVariant3}>
                  {Math.round(liveAccuracy)}%
                </Text>
              </View>

              <View style={exerciseStyles.liveStatsDivider} />

              <View style={exerciseStyles.recordingHeader}>
                <View style={exerciseStyles.liveStatHeading}>
                  <Text style={exerciseStyles.guideText}>STABILITY</Text>
                </View>
                <Text style={exerciseStyles.liveStatValueVariant3}>
                  {Math.round(liveStability)}%
                </Text>
              </View>
            </View>
          </View>

          <View style={exerciseStyles.progressContainer}>
            <View style={exerciseStyles.progressTrackVariant6}>
              <View
                style={[
                  exerciseStyles.progressFill,
                  { width: `${progress * 100}%` },
                ]}
              />
            </View>

            <Text style={exerciseStyles.targetIntervalText}>
              {(elapsedMs / 1000).toFixed(1)}s / {params.durationSec}s
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
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'results' && result) {
    return (
      <View style={exerciseStyles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={exerciseStyles.resultsContent}
        >
          <View
            style={[
              exerciseStyles.resultIcon,
              result.passed
                ? exerciseStyles.resultIconPassed
                : exerciseStyles.resultIconFailed,
            ]}
          >
            <Ionicons
              name={result.passed ? 'checkmark' : 'refresh'}
              size={40}
              color={COLORS.brown}
            />
          </View>

          <Text style={exerciseStyles.resultTitle}>
            {result.passed ? 'Great Job!' : 'Keep Practicing!'}
          </Text>

          <Text style={exerciseStyles.resultSubtitleVariant1}>
            Sustained Note Stability Result
          </Text>

          <View style={exerciseStyles.scoreCard}>
            <Text style={exerciseStyles.scoreLabel}>Overall Score</Text>
            <Text style={exerciseStyles.scoreValue}>{result.score}%</Text>
            <Text style={exerciseStyles.scoreDescriptionVariant2}>
              {result.passed
                ? 'Your pitch stability reached the target level across all repetitions.'
                : 'Focus on keeping your pitch steadier and maintaining the required duration across repetitions.'}
            </Text>
          </View>

          <View style={exerciseStyles.resultCard}>
            <Text style={exerciseStyles.resultCardTitle}>Target Note</Text>
            <View style={exerciseStyles.noteDisplay}>
              <Text style={exerciseStyles.resultNote}>{targetNote.name}</Text>
              <Text style={exerciseStyles.repResultDetails}>
                {Math.round(targetNote.frequency)} Hz
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.resultCard}>
            <Text style={exerciseStyles.resultCardTitle}>
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

          <View style={exerciseStyles.resultCard}>
            <Text style={exerciseStyles.resultCardTitle}>
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

          <View style={exerciseStyles.tipCard}>
            <Ionicons name="bulb-outline" size={21} color={COLORS.brown} />
            <Text style={exerciseStyles.tipText}>
              {result.passed
                ? 'Nice work! Continue practicing sustained notes to build consistent pitch control across repetitions.'
                : 'Try relaxing your throat and supporting the note with steady breath while avoiding unnecessary pitch movement.'}
            </Text>
          </View>

          <Pressable style={exerciseStyles.startButtonVariant5} onPress={retry}>
            <Text style={exerciseStyles.startButtonText}>Try Again</Text>
            <Ionicons name="refresh" size={18} color={COLORS.white} />
          </Pressable>

          <Pressable
            style={exerciseStyles.doneButton}
            onPress={() => {
              void quitExercise();
            }}
          >
            <Text style={exerciseStyles.componentScore}>Done</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return null;
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
    ? COLORS.pink
    : safeStability >= 80
      ? COLORS.guideGreen
      : safeStability >= 60
        ? COLORS.guideYellow
        : COLORS.guideRed;

  return (
    <View style={exerciseStyles.form_Login_login}>
          <Text style={exerciseStyles.infoName}>
            Pitch Stability
          </Text>

      <View style={exerciseStyles.stabilityTrackVariant1}>
        <View
          style={[
            exerciseStyles.stabilityFillVariant1,
            {
              width: hasPitch ? `${safeStability}%` : '0%',
              backgroundColor: statusColor,
            },
          ]}
        />
      </View>

      <View style={exerciseStyles.stabilityFooter}>
        <Text style={exerciseStyles.scaleText}>
          Less steady
        </Text>
        <Text
          style={[
            exerciseStyles.stabilityStatus,
            { color: statusColor },
          ]}
        >
          {status}
        </Text>
        <Text style={exerciseStyles.scaleText}>
          More steady
        </Text>
      </View>
    </View>
  );
}

function QuitExerciseModal({
  visible,
  message,
  onContinue,
  onQuit,
}: {
  visible: boolean;
  message: string;
  onContinue: () => void;
  onQuit: () => void;
}) {
  return (
    <ExerciseQuitModal
        visible={visible}
        title={"Quit exercise?"}
        message={message}
        isQuitting={false}
        onContinue={onContinue}
        onQuit={onQuit}
        continueLabel={"Continue Exercise"}
        quitLabel={"Quit Exercise"}
      />
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
    <View style={exerciseStyles.resultRow}>
      <Text style={exerciseStyles.resultRowLabel}>{label}</Text>
      <Text style={exerciseStyles.resultRowValueVariant1}>{value}</Text>
    </View>
  );
}
