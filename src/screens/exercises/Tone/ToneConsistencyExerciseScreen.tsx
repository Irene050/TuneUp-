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

import type { Tier } from '@/constants/exercises/pitch';
import {
  TONE_CONSISTENCY_PARAMS,
  type ToneConsistencyParams,
} from '@/constants/exercises/tone';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import {
  generateToneConsistencyParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import {
  measureToneConsistency,
} from '@/services/measurement/tone/toneConsistencyExercise';
import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
  scoreToneConsistencyExercise,
} from '@/services/scoring/tone/toneConsistencyExercise';
import {
  samplesToFFTFrames,
} from '@/utils/dsp/fft';
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

const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;
const COUNTDOWN_SECONDS = 3;
const TARGET_NOTE_DURATION_SECONDS = 1.5;

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

type LiveToneState = {
  pitch: number;
  note: string;
  clarity: number;
  volume: number;
};

type ResultState = {
  score: number;
  passed: boolean;
  averageCentroidHz: number;
  averageAmplitude: number;
};

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function formatFrequency(frequency: number): string {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return '--';
  }

  return `${frequency.toFixed(1)} Hz`;
}

function formatVolume(volume: number): string {
  if (!Number.isFinite(volume)) {
    return '--';
  }

  return `${Math.round(volume)} dB`;
}

export default function ToneConsistencyExerciseScreen({
  tier,
}: Props) {
  const [screen, setScreen] = useState<Screen>('instructions');
  const [currentTier, setCurrentTier] = useState<Tier>(
    tier ?? 'beginner',
  );
  const [params, setParams] = useState<ToneConsistencyParams>(
    TONE_CONSISTENCY_PARAMS[tier ?? 'beginner'],
  );
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);
  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [listenElapsedSeconds, setListenElapsedSeconds] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [liveTone, setLiveTone] = useState<LiveToneState>({
    pitch: 0,
    note: '--',
    clarity: 0,
    volume: -100,
  });
  const [result, setResult] = useState<ResultState | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const generatedTarget = useMemo(
    () => getRandomPitchNote(currentTier, vocalRange),
    [currentTier, vocalRange],
  );

  const lockedTargetRef = useRef<typeof generatedTarget | null>(null);
  const activeTarget = lockedTargetRef.current ?? generatedTarget;
  const targetFrequency = activeTarget.frequency;
  const targetNote = activeTarget.name;

  const mountedRef = useRef(true);
  const exitingRef = useRef(false);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const currentRepRef = useRef(1);
  const screenRef = useRef<Screen>('instructions');

  const pausedRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const discardNextStopRef = useRef(false);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const listeningTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const repetitionSamplesRef = useRef<Float32Array[]>([]);
  const repetitionFFTFramesRef = useRef<Float32Array[][]>([]);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef =
    useRef<(() => void | Promise<void>) | null>(null);
  const isRecordingRef = useRef(false);

  const startExerciseRef = useRef<(() => void) | null>(null);
  const listenToTargetNoteRef =
    useRef<(() => Promise<boolean>) | null>(null);
  const startRecordingAttemptRef =
    useRef<(() => Promise<void>) | null>(null);

  const setCurrentScreen = useCallback((nextScreen: Screen) => {
    screenRef.current = nextScreen;

    if (mountedRef.current) {
      setScreen(nextScreen);
    }
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

    if (listeningTimerRef.current) {
      clearInterval(listeningTimerRef.current);
      listeningTimerRef.current = null;
    }
  }, []);

  // Load adaptive difficulty and the user's assessed vocal range.
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
            'tone',
          );

          resolvedTier = progress?.currentTier ?? 'beginner';
        }

        if (cancelled) {
          return;
        }

        setCurrentTier(resolvedTier);

        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'tone',
          );

          if (cancelled) {
            return;
          }

          const matchingRecords = records
            .filter(
              record =>
                record.tier === resolvedTier &&
                record.templateId === 'toneConsistencyExercise',
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          recentScores = matchingRecords
            .slice(-5)
            .map(record => record.scorePct);

          const assessment = await getLatestAssessment();

          if (cancelled) {
            return;
          }

          if (assessment) {
            setVocalRange(assessment.vocalRange ?? null);
          }

          // Use assessment as the initial reference only when
          // this template has no records at the resolved tier.
          if (recentScores.length === 0) {
            const assessmentScore = assessment?.scores.find(
              score => score.componentId === 'tone',
            );

            if (assessmentScore) {
              recentScores = [assessmentScore.scorePct];
            }
          }
        }

        const generatedParams = generateToneConsistencyParams({
          tier: resolvedTier,
          recentScores,
        });

        if (cancelled) {
          return;
        }

        setParams(generatedParams);
      } catch (error) {
        console.error('Tone consistency ADS error:', error);

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';

          setCurrentTier(fallbackTier);
          setParams(TONE_CONSISTENCY_PARAMS[fallbackTier]);
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
    (frame: {
      pitch: number;
      note: string;
      clarity: number;
      volume: number;
    }) => {
      if (
        !mountedRef.current ||
        exitingRef.current ||
        pausedRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      setLiveTone({
        pitch:
          Number.isFinite(frame.pitch) && frame.pitch > 0
            ? frame.pitch
            : 0,
        note: frame.note || '--',
        clarity: frame.clarity,
        volume: frame.volume,
      });
    },
    [],
  );

  const listenToTargetNote = useCallback(async () => {
    if (
      !mountedRef.current ||
      exitingRef.current ||
      pausedRef.current ||
      quitInProgressRef.current
    ) {
      return false;
    }

    clearTimers();
    setListenElapsedSeconds(0);
    setCurrentScreen('listening');

    const startTime = Date.now();

    listeningTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        exitingRef.current ||
        pausedRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      const elapsed = (Date.now() - startTime) / 1000;

      setListenElapsedSeconds(
        Math.min(elapsed, TARGET_NOTE_DURATION_SECONDS),
      );
    }, 50);

    try {
      const targetToPlay =
        lockedTargetRef.current ?? generatedTarget;

      await playSingleNote(
        targetToPlay.frequency,
        TARGET_NOTE_DURATION_SECONDS,
      );
    } catch (error) {
      console.error('Failed to play target note:', error);
      clearTimers();

      if (
        mountedRef.current &&
        !exitingRef.current &&
        !pausedRef.current &&
        !quitInProgressRef.current
      ) {
        setErrorMessage(
          'We could not play the reference note. Please try again.',
        );
        setCurrentScreen('instructions');
        startingRef.current = false;
      }

      return false;
    }

    clearTimers();

    if (
      !mountedRef.current ||
      exitingRef.current ||
      pausedRef.current ||
      quitInProgressRef.current
    ) {
      return false;
    }

    setListenElapsedSeconds(TARGET_NOTE_DURATION_SECONDS);

    return true;
  }, [clearTimers, generatedTarget, setCurrentScreen]);

  useEffect(() => {
    listenToTargetNoteRef.current = listenToTargetNote;

    return () => {
      listenToTargetNoteRef.current = null;
    };
  }, [listenToTargetNote]);

  const startRecordingAttempt = useCallback(async () => {
    if (
      !mountedRef.current ||
      exitingRef.current ||
      pausedRef.current ||
      quitInProgressRef.current ||
      !startRecordingRef.current ||
      isRecordingRef.current
    ) {
      return;
    }

    clearTimers();

    setLiveTone({
      pitch: 0,
      note: '--',
      clarity: 0,
      volume: -100,
    });
    setElapsedSeconds(0);
    setCurrentScreen('recording');

    try {
      // A new attempt must not inherit a stale stop callback.
      discardNextStopRef.current = false;

      await startRecordingRef.current();

      if (
        !mountedRef.current ||
        exitingRef.current ||
        pausedRef.current ||
        quitInProgressRef.current ||
        screenRef.current !== 'recording'
      ) {
        discardNextStopRef.current = true;
        isRecordingRef.current = false;

        void stopRecordingRef.current?.();
        return;
      }

      isRecordingRef.current = true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      isRecordingRef.current = false;

      if (
        mountedRef.current &&
        !exitingRef.current &&
        !pausedRef.current &&
        !quitInProgressRef.current
      ) {
        setErrorMessage(
          'We could not start the exercise. Please check your microphone permission and try again.',
        );
        setCurrentScreen('instructions');
      }

      startingRef.current = false;
      return;
    }

    const startTime = Date.now();

    recordingTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        exitingRef.current ||
        pausedRef.current ||
        quitInProgressRef.current ||
        !isRecordingRef.current
      ) {
        return;
      }

      const elapsed = (Date.now() - startTime) / 1000;

      setElapsedSeconds(
        Math.min(elapsed, params.intervalSec),
      );

      if (elapsed >= params.intervalSec) {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        if (!finishingRef.current) {
          finishingRef.current = true;
          void stopRecordingRef.current?.();
        }
      }
    }, 50);
  }, [clearTimers, params.intervalSec, setCurrentScreen]);

  useEffect(() => {
    startRecordingAttemptRef.current = startRecordingAttempt;

    return () => {
      startRecordingAttemptRef.current = null;
    };
  }, [startRecordingAttempt]);

  const handleRecordingStop = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      clearTimers();
      isRecordingRef.current = false;

      // An interrupted recording must never be counted as a rep.
      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        finishingRef.current = false;
        return;
      }

      if (
        !mountedRef.current ||
        exitingRef.current ||
        pausedRef.current ||
        quitInProgressRef.current
      ) {
        finishingRef.current = false;
        return;
      }

      try {
        if (
          samples.length === 0 ||
          !Number.isFinite(sampleRate) ||
          sampleRate <= 0
        ) {
          throw new Error('No usable recording data was captured.');
        }

        const fftFrames = samplesToFFTFrames(
          samples,
          FFT_SIZE,
          FFT_HOP_SIZE,
        );

        if (fftFrames.length === 0) {
          throw new Error('No FFT frames could be generated.');
        }

        repetitionSamplesRef.current.push(samples);
        repetitionFFTFramesRef.current.push(fftFrames);

        const isLastRepetition =
          currentRepRef.current >= params.repetitions;

        if (!isLastRepetition) {
          const nextRep = currentRepRef.current + 1;

          currentRepRef.current = nextRep;
          setCurrentRep(nextRep);
          finishingRef.current = false;
          setElapsedSeconds(0);
          setListenElapsedSeconds(0);
          setLiveTone({
            pitch: 0,
            note: '--',
            clarity: 0,
            volume: -100,
          });

          const played = await listenToTargetNoteRef.current?.();

          if (
            !played ||
            !mountedRef.current ||
            exitingRef.current ||
            pausedRef.current ||
            quitInProgressRef.current
          ) {
            return;
          }

          await startRecordingAttemptRef.current?.();
          return;
        }

        setCurrentScreen('processing');

        const measurement = measureToneConsistency(
          repetitionSamplesRef.current,
          repetitionFFTFramesRef.current,
          sampleRate,
          FFT_SIZE,
        );

        const scored = scoreToneConsistencyExercise(
          measurement,
          params,
        );

        const validCentroids = measurement.centroids.filter(
          centroid =>
            Number.isFinite(centroid) && centroid > 0,
        );

        const averageCentroid =
          validCentroids.length > 0
            ? validCentroids.reduce(
                (sum, centroid) => sum + centroid,
                0,
              ) / validCentroids.length
            : 0;

        const validAmplitudes = measurement.amplitudes.filter(
          amplitude => Number.isFinite(amplitude),
        );

        const averageAmplitudeValue =
          validAmplitudes.length > 0
            ? validAmplitudes.reduce(
                (sum, amplitude) => sum + amplitude,
                0,
              ) / validAmplitudes.length
            : 0;

        await saveCompletedExercise(
          'tone',
          'toneConsistencyExercise',
          currentTier,
          scored.score,
        );

        if (
          !mountedRef.current ||
          exitingRef.current ||
          pausedRef.current ||
          quitInProgressRef.current
        ) {
          return;
        }

        setResult({
          score: scored.score,
          passed: scored.passed,
          averageCentroidHz: averageCentroid,
          averageAmplitude: averageAmplitudeValue,
        });

        setCurrentScreen('results');
      } catch (error) {
        console.error('Tone consistency analysis error:', error);

        if (
          mountedRef.current &&
          !exitingRef.current &&
          !pausedRef.current &&
          !quitInProgressRef.current
        ) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          setCurrentScreen('instructions');
        }
      } finally {
        finishingRef.current = false;
        startingRef.current = false;
      }
    },
    [
      clearTimers,
      currentTier,
      params,
      setCurrentScreen,
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

  const startExercise = useCallback(() => {
    if (
      startingRef.current ||
      isLoadingAdaptiveParams ||
      !mountedRef.current ||
      pausedRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    startingRef.current = true;
    exitingRef.current = false;
    finishingRef.current = false;
    discardNextStopRef.current = false;

    lockedTargetRef.current = generatedTarget;

    clearTimers();

    repetitionSamplesRef.current = [];
    repetitionFFTFramesRef.current = [];
    currentRepRef.current = 1;

    setCurrentRep(1);
    setErrorMessage('');
    setResult(null);
    setLiveTone({
      pitch: 0,
      note: '--',
      clarity: 0,
      volume: -100,
    });
    setElapsedSeconds(0);
    setListenElapsedSeconds(0);
    setCountdown(COUNTDOWN_SECONDS);
    setCurrentScreen('countdown');

    let remaining = COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        exitingRef.current ||
        pausedRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      remaining -= 1;

      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }

      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }

      setCountdown(0);

      void (async () => {
        try {
          const played =
            await listenToTargetNoteRef.current?.();

          if (
            !played ||
            !mountedRef.current ||
            exitingRef.current ||
            pausedRef.current ||
            quitInProgressRef.current
          ) {
            startingRef.current = false;
            return;
          }

          await startRecordingAttemptRef.current?.();
        } catch (error) {
          console.error(
            'Failed to start tone consistency exercise:',
            error,
          );

          startingRef.current = false;

          if (
            mountedRef.current &&
            !exitingRef.current &&
            !pausedRef.current &&
            !quitInProgressRef.current
          ) {
            setErrorMessage(
              'We could not start the exercise. Please check your microphone permission and try again.',
            );
            setCurrentScreen('instructions');
          }
        }
      })();
    }, 1000);
  }, [
    clearTimers,
    generatedTarget,
    isLoadingAdaptiveParams,
    setCurrentScreen,
  ]);

  useEffect(() => {
    startExerciseRef.current = startExercise;

    return () => {
      startExerciseRef.current = null;
    };
  }, [startExercise]);

  const finishRecording = useCallback(() => {
    if (
      !isRecordingRef.current ||
      finishingRef.current ||
      pausedRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    finishingRef.current = true;
    clearTimers();
    void stopRecordingRef.current?.();
  }, [clearTimers]);

  const retryExercise = useCallback(() => {
    clearTimers();

    void disposeNotePlayer().catch(error => {
      console.warn('Failed to stop note player:', error);
    });

    if (isRecordingRef.current || isRecording) {
      discardNextStopRef.current = true;
      void stopRecordingRef.current?.();
    }

    pausedRef.current = false;
    showQuitModalRef.current = false;
    quitInProgressRef.current = false;
    exitingRef.current = false;
    startingRef.current = false;
    finishingRef.current = false;
    isRecordingRef.current = false;
    discardNextStopRef.current = false;
    lockedTargetRef.current = null;

    repetitionSamplesRef.current = [];
    repetitionFFTFramesRef.current = [];
    currentRepRef.current = 1;

    setShowQuitModal(false);
    setIsQuitting(false);
    setCurrentRep(1);
    setResult(null);
    setErrorMessage('');
    setElapsedSeconds(0);
    setListenElapsedSeconds(0);
    setCountdown(COUNTDOWN_SECONDS);
    setLiveTone({
      pitch: 0,
      note: '--',
      clarity: 0,
      volume: -100,
    });

    setCurrentScreen('instructions');
  }, [clearTimers, isRecording, setCurrentScreen]);

  const openQuitModal = useCallback(() => {
    if (
      !mountedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    pausedRef.current = true;
    showQuitModalRef.current = true;

    clearTimers();

    // Stop note playback if the exercise was in its listening phase.
    void disposeNotePlayer().catch(error => {
      console.warn('Failed to pause reference note:', error);
    });

    if (
      screenRef.current === 'recording' ||
      isRecordingRef.current ||
      isRecording
    ) {
      // Discard the partial repetition instead of scoring it.
      discardNextStopRef.current = true;
      finishingRef.current = true;

      if (isRecordingRef.current || isRecording) {
        void Promise.resolve(stopRecordingRef.current?.()).catch(error => {
          console.warn(
            'Failed to stop interrupted tone-consistency recording:',
            error,
          );
        });
      }

      isRecordingRef.current = false;
      finishingRef.current = false;
    }

    setShowQuitModal(true);
  }, [clearTimers, isRecording]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) {
      return;
    }

    const previousScreen = screenRef.current;

    showQuitModalRef.current = false;
    pausedRef.current = false;
    setShowQuitModal(false);

    if (
      previousScreen === 'recording' ||
      previousScreen === 'listening' ||
      previousScreen === 'countdown'
    ) {
      // Restart the exercise as a fresh attempt so interrupted audio
      // is never included in the score.
      startingRef.current = false;
      finishingRef.current = false;
      isRecordingRef.current = false;
      discardNextStopRef.current = false;
      lockedTargetRef.current = null;

      repetitionSamplesRef.current = [];
      repetitionFFTFramesRef.current = [];
      currentRepRef.current = 1;

      setCurrentRep(1);
      setResult(null);
      setErrorMessage('');
      setElapsedSeconds(0);
      setListenElapsedSeconds(0);
      setCountdown(COUNTDOWN_SECONDS);
      setLiveTone({
        pitch: 0,
        note: '--',
        clarity: 0,
        volume: -100,
      });

      startExerciseRef.current?.();
      return;
    }

    if (previousScreen === 'processing') {
      // Processing continues while the modal is displayed. Do not
      // trigger a second analysis or duplicate progress save.
      return;
    }

    if (previousScreen === 'instructions') {
      setCurrentScreen('instructions');
      return;
    }

    setCurrentScreen(previousScreen);
  }, [setCurrentScreen]);

  const quitExercise = useCallback(() => {
    if (quitInProgressRef.current) {
      return;
    }

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    exitingRef.current = true;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();

    void disposeNotePlayer().catch(error => {
      console.warn('Failed to stop reference note:', error);
    });

    if (isRecordingRef.current || isRecording) {
      discardNextStopRef.current = true;

      void Promise.resolve(stopRecordingRef.current?.()).catch(error => {
        console.warn(
          'Failed to stop recording while quitting:',
          error,
        );
      });
    }

    isRecordingRef.current = false;

    router.replace('/dashboard?tab=exercises');
  }, [clearTimers, isRecording]);

  const goBack = useCallback(() => {
    openQuitModal();
  }, [openQuitModal]);

  // Android hardware back should open the same quit modal.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (quitInProgressRef.current) {
          return true;
        }

        if (showQuitModalRef.current) {
          return true;
        }

        openQuitModal();
        return true;
      },
    );

    return () => subscription.remove();
  }, [openQuitModal]);

  // Cleanup when this screen unmounts.
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      showQuitModalRef.current = false;
      exitingRef.current = true;
      discardNextStopRef.current = true;

      clearTimers();

      if (isRecordingRef.current) {
        void Promise.resolve(stopRecordingRef.current?.()).catch(
          () => undefined,
        );
      }

      isRecordingRef.current = false;

      void disposeNotePlayer().catch(error => {
        console.warn('Failed to dispose note player:', error);
      });
    };
  }, [clearTimers]);

  const listenProgress =
    clamp(
      listenElapsedSeconds / TARGET_NOTE_DURATION_SECONDS,
      0,
      1,
    ) * 100;

  const recordingProgress = clamp(
    elapsedSeconds / params.intervalSec,
    0,
    1,
  );

  const quitMessage =
    screen === 'recording'
      ? 'Your current repetition will be discarded. If you continue, the exercise will restart from the countdown.'
      : screen === 'listening'
        ? 'Reference-note playback will stop. If you continue, the exercise will restart from the countdown.'
        : screen === 'countdown'
          ? 'Your countdown will restart if you continue the exercise.'
          : screen === 'processing'
            ? 'Your completed repetitions are being analyzed. You can return to the exercise while analysis continues.'
            : screen === 'results'
              ? 'Are you sure you want to leave Tone Consistency? Your completed result has already been saved.'
              : 'Are you sure you want to leave Tone Consistency?';

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
            <Ionicons
              name="exit-outline"
              size={30}
              color={BROWN}
            />
          </View>

          <Text style={styles.modalTitle}>
            Quit Exercise?
          </Text>

          <Text style={styles.modalMessage}>
            {quitMessage}
          </Text>

          <Pressable
            accessibilityRole="button"
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
            disabled={isQuitting}
            onPress={quitExercise}
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
          >
            {isQuitting ? (
              <ActivityIndicator color={BROWN} />
            ) : (
              <Text style={styles.quitButtonText}>
                Quit Exercise
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  if (screen === 'instructions' && isLoadingAdaptiveParams) {
    return (
      <>
        <View style={styles.preparingScreen}>
          <View style={styles.preparingIconCircle}>
            <Ionicons
              name="options-outline"
              size={32}
              color={BROWN}
            />
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
            style={styles.preparingSpinner}
          />
        </View>
        {quitModal}
      </>
    );
  }

  if (screen === 'instructions') {
    return (
      <>
        <ExerciseScreen
          title="Tone Consistency Exercise"
          category="Tone"
          icon="musical-note-outline"
          instructions={
            'Listen carefully to the target note first.\n\n' +
            'After the reference note finishes, sing the same note back.\n\n' +
            'Repeat the exercise while keeping your tone and vocal output as consistent as possible.'
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
              value: String(params.repetitions),
            },
            {
              label: 'Sing Duration',
              value: `${params.intervalSec}s`,
            },
          ]}
          tip="Listen to the reference note before every repetition and use the same target note each time."
          tier={currentTier}
          onBack={goBack}
          onStart={startExercise}
          error={errorMessage}
          startDisabled={isLoadingAdaptiveParams}
        />
        {quitModal}
      </>
    );
  }

  if (screen === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="musical-notes-outline"
          title="Get Ready"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Your target note is"
          prompt={`${targetNote} • ${formatFrequency(targetFrequency)}`}
          onBack={goBack}
        />
        {quitModal}
      </>
    );
  }

  if (screen === 'listening') {
    return (
      <>
        <ExerciseListeningScreen
          icon="volume-high-outline"
          title="Listen to the Note"
          currentRep={currentRep}
          repetitions={params.repetitions}
          elapsed={listenElapsedSeconds}
          targetDuration={TARGET_NOTE_DURATION_SECONDS}
          promptTitle="Listen to the reference note"
          prompt="Listen carefully. After the note finishes, sing the same note."
          liveContent={
            <View style={styles.sharedListenNoteBox}>
              <Text style={styles.listenLabel}>TARGET NOTE</Text>
              <Text style={styles.largeNote}>{targetNote}</Text>
              <Text style={styles.stateFrequency}>
                {formatFrequency(targetFrequency)}
              </Text>
            </View>
          }
          progress={listenProgress}
          onBack={goBack}
        />
        {quitModal}
      </>
    );
  }

  if (screen === 'recording') {
    return (
      <>
        <View style={styles.screen}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.recordingContent}
          >
            <View style={styles.recordingIcon}>
              <Ionicons name="mic" size={34} color={BROWN} />
            </View>

            <Text style={styles.recordingTitle}>
              Sing the Note
            </Text>

            <Text style={styles.recordingSubtitle}>
              Repetition {currentRep} of {params.repetitions}
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
                <Text style={styles.recordingBadgeText}>
                  RECORDING
                </Text>
              </View>
            </View>

            <View style={styles.detectedArea}>
              <Text style={styles.detectedLabel}>
                CURRENT NOTE
              </Text>
              <Text style={styles.detectedNote}>
                {liveTone.note}
              </Text>
              <Text style={styles.detectedFrequency}>
                {formatFrequency(liveTone.pitch)}
              </Text>
              <Text style={styles.pitchMessage}>
                {liveTone.pitch > 0
                  ? 'Keep the tone steady'
                  : 'Listening...'}
              </Text>
            </View>

            <View style={styles.metricsGrid}>
              <MetricCard
                label="PITCH"
                value={
                  liveTone.pitch > 0
                    ? formatFrequency(liveTone.pitch)
                    : '--'
                }
              />
              <MetricCard
                label="CLARITY"
                value={
                  liveTone.clarity > 0
                    ? `${Math.round(liveTone.clarity * 100)}%`
                    : '--'
                }
              />
              <MetricCard
                label="VOLUME"
                value={formatVolume(liveTone.volume)}
              />
              <MetricCard
                label="REP"
                value={`${currentRep}/${params.repetitions}`}
              />
            </View>

            <Text style={styles.timerText}>
              {elapsedSeconds.toFixed(1)} /{' '}
              {params.intervalSec.toFixed(1)}s
            </Text>

            <View style={styles.timerTrack}>
              <View
                style={[
                  styles.timerFill,
                  { width: `${recordingProgress * 100}%` },
                ]}
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.finishButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={finishRecording}
            >
              <Ionicons name="stop" size={20} color={BROWN} />
              <Text style={styles.finishButtonText}>
                Finish
              </Text>
            </Pressable>
          </ScrollView>
        </View>
        {quitModal}
      </>
    );
  }

  if (screen === 'processing') {
    return (
      <>
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing Your Singing"
          message="Comparing your repetitions for tone and vocal consistency."
          onBack={goBack}
        />
        {quitModal}
      </>
    );
  }

  if (screen === 'results' && result) {
    return (
      <>
        <ExerciseResultsScreen
          title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
          subtitle={`Tone Consistency Result • ${params.repetitions} repetitions`}
          score={result.score}
          resultIcon={result.passed ? 'checkmark' : 'refresh'}
          scoreMessage={
            result.passed
              ? 'Your tone and vocal output stayed consistent across the repetitions.'
              : 'Keep practicing the same target note with a steady and consistent tone.'
          }
          onRetry={retryExercise}
          onExit={goBack}
          onBack={goBack}
        >
          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>
              Tone Consistency
            </Text>

            <View style={styles.resultTarget}>
              <Text style={styles.resultTargetLabel}>
                TARGET NOTE
              </Text>
              <Text style={styles.resultTargetNote}>
                {targetNote}
              </Text>
              <Text style={styles.resultTargetFrequency}>
                {formatFrequency(targetFrequency)}
              </Text>
            </View>
          </View>

          <View style={styles.resultsGrid}>
            <MetricCard
              label="OVERALL SCORE"
              value={`${result.score}%`}
            />
            <MetricCard
              label="AVG. CENTROID"
              value={
                result.averageCentroidHz > 0
                  ? `${Math.round(result.averageCentroidHz)} Hz`
                  : '--'
              }
            />
            <MetricCard
              label="AVG. AMPLITUDE"
              value={
                result.averageAmplitude > 0
                  ? result.averageAmplitude.toFixed(3)
                  : '--'
              }
            />
            <MetricCard
              label="REPETITIONS"
              value={String(params.repetitions)}
            />
          </View>

          <View style={styles.feedbackCard}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <View style={styles.feedbackContent}>
              <Text style={styles.feedbackTitle}>Feedback</Text>
              <Text style={styles.feedbackText}>
                {result.passed
                  ? `Excellent consistency! Your voice maintained a stable tone while repeating ${targetNote}. Keep practicing with the same controlled vocal output.`
                  : `Your tone varied between repetitions. Listen carefully to the reference note before each attempt and focus on maintaining the same vocal quality throughout ${targetNote}.`}
              </Text>
            </View>
          </View>
        </ExerciseResultsScreen>
        {quitModal}
      </>
    );
  }

  return quitModal;
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
    fontSize: 20,
    color: BROWN,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
    color: '#9A817D',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 285,
  },
  preparingSpinner: {
    marginTop: 24,
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
  resultTarget: {
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 18,
    paddingVertical: 18,
  },
  resultTargetLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.7,
  },
  resultTargetNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    marginTop: 4,
  },
  resultTargetFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
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