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

import type { Tier } from '@/constants/pitch';
import {
  TONE_CONSISTENCY_PARAMS,
  type ToneConsistencyParams,
} from '@/constants/tone';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { generateToneConsistencyParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureToneConsistency } from '@/services/measurement/tone/toneConsistencyExercise';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreToneConsistencyExercise } from '@/services/scoring/tone/toneConsistencyExercise';
import { samplesToFFTFrames } from '@/utils/dsp/fft';
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

import { COLORS } from '@/constants/appConstants';

const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;
const COUNTDOWN_SECONDS = 3;
const TARGET_NOTE_DURATION_SECONDS = 1.5;
const WAVEFORM_BAR_COUNT = 30;

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatFrequency(frequency: number): string {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return '--';
  }

  return `${frequency.toFixed(1)} Hz`;
}

function formatVolume(volume: number): string {
  if (!Number.isFinite(volume) || volume <= -100) {
    return '--';
  }

  return `${Math.round(volume)} dB`;
}

function LiveToneWaveform({
  pitch,
  volume,
  elapsedSeconds,
}: {
  pitch: number;
  volume: number;
  elapsedSeconds: number;
}) {
  const hasPitch = Number.isFinite(pitch) && pitch > 0;

  const volumeLevel =
    Number.isFinite(volume) && volume > -100
      ? clamp((volume + 60) / 60, 0, 1)
      : 0;

  const bars = useMemo(
    () =>
      Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
        const center = (WAVEFORM_BAR_COUNT - 1) / 2;
        const distance = Math.abs(index - center) / center;
        const envelope = 1 - distance * 0.58;

        const movement = hasPitch
          ? 0.35 +
            Math.abs(
              Math.sin(
                index * 0.72 +
                  elapsedSeconds * 3.4 +
                  pitch * 0.001,
              ),
            ) *
              0.65
          : 0.12 +
            Math.abs(
              Math.sin(index * 0.72 + elapsedSeconds * 1.8),
            ) *
              0.12;

        const volumeScale = hasPitch ? 0.55 + volumeLevel * 0.45 : 1;

        return Math.max(
          5,
          Math.round(42 * envelope * movement * volumeScale),
        );
      }),
    [elapsedSeconds, hasPitch, pitch, volumeLevel],
  );

  return (
    <View style={styles.waveformContainer}>
      <View
        style={styles.waveformBars}
        accessibilityLabel={
          hasPitch
            ? 'Live vocal activity detected'
            : 'Waiting for vocal activity'
        }
      >
        {bars.map((height, index) => (
          <View
            key={index}
            style={[
              styles.waveformBar,
              {
                height,
                opacity: hasPitch ? 0.95 : 0.3,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.waveformStatusRow}>
        <View
          style={[
            styles.waveformStatusDot,
            {
              backgroundColor: hasPitch ? COLORS.guideGreen : COLORS.guideRed,
            },
          ]}
        />

        <Text style={styles.waveformStatus}>
          {hasPitch
            ? 'Voice detected — keep your tone steady.'
            : 'Listening for your voice...'}
        </Text>
      </View>
    </View>
  );
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
        clarity: Number.isFinite(frame.clarity)
          ? frame.clarity
          : 0,
        volume: Number.isFinite(frame.volume)
          ? frame.volume
          : -100,
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
    [clearTimers, currentTier, params, setCurrentScreen],
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

    void disposeNotePlayer().catch(error => {
      console.warn('Failed to pause reference note:', error);
    });

    if (
      screenRef.current === 'recording' ||
      isRecordingRef.current ||
      isRecording
    ) {
      discardNextStopRef.current = true;
      finishingRef.current = true;

      if (isRecordingRef.current || isRecording) {
        void Promise.resolve(stopRecordingRef.current?.()).catch(
          error => {
            console.warn(
              'Failed to stop interrupted tone-consistency recording:',
              error,
            );
          },
        );
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

      void Promise.resolve(stopRecordingRef.current?.()).catch(
        error => {
          console.warn(
            'Failed to stop recording while quitting:',
            error,
          );
        },
      );
    }

    isRecordingRef.current = false;

    router.replace('/exercises/tone');
  }, [clearTimers, isRecording]);

  const goBack = useCallback(() => {
    openQuitModal();
  }, [openQuitModal]);

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

  const recordingProgress =
    params.intervalSec > 0
      ? clamp(elapsedSeconds / params.intervalSec, 0, 1)
      : 0;

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
              color={COLORS.brown}
            />
          </View>

          <Text style={styles.modalTitle}>Quit Exercise?</Text>

          <Text style={styles.modalMessage}>{quitMessage}</Text>

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
              <ActivityIndicator color={COLORS.brown} />
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
              size={44}
              color={COLORS.brown}
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
            color={COLORS.brown}
            style={styles.spinner}
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
        />

        {quitModal}
      </>
    );
  }

  if (screen === 'recording') {
    const hasPitch =
      Number.isFinite(liveTone.pitch) && liveTone.pitch > 0;

    const hasClarity =
      Number.isFinite(liveTone.clarity) && liveTone.clarity > 0;

    const elapsed = Math.min(elapsedSeconds, params.intervalSec);
    const remaining = Math.max(0, params.intervalSec - elapsed);

    return (
      <>
        <View style={styles.recordingScreen}>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.recordingContent}
          >
            <Text style={styles.recordingTitle}>
              Sing the Note
            </Text>

            <Text style={styles.recordingSubtitle}>
              Match the reference note and keep your voice consistent
              throughout each repetition.
            </Text>

            <View style={styles.repPill}>
              <Ionicons
                name="repeat-outline"
                size={15}
                color={COLORS.brown}
              />

              <Text style={styles.repPillText}>
                REPETITION {currentRep} OF {params.repetitions}
              </Text>
            </View>

            <View style={styles.targetNoteCard}>
              <View style={styles.targetNoteHeading}>
                <View style={styles.targetNoteIcon}>
                  <Ionicons
                    name="musical-note"
                    size={19}
                    color={COLORS.brown}
                  />
                </View>

                <View style={styles.targetNoteText}>
                  <Text style={styles.targetNoteLabel}>
                    YOUR TARGET NOTE
                  </Text>
                </View>
              </View>

              <View style={styles.targetNoteValueContainer}>
                <Text style={styles.targetNoteValue}>
                  {targetNote}
                </Text>

                <Text style={styles.targetNoteFrequency}>
                  {formatFrequency(targetFrequency)}
                </Text>
              </View>
            </View>

            <View style={styles.liveCard}>
              <View style={styles.liveCardHeader}>
                <View style={styles.liveMicCircle}>
                  <Ionicons
                    name="mic"
                    size={21}
                    color={COLORS.guideGreen}
                  />
                </View>

                <View style={styles.liveCardHeading}>
                  <Text style={styles.liveCardTitle}>
                    Live Tone Monitor
                  </Text>

                  <Text style={styles.liveCardSubtitle}>
                    Real-time microphone feedback
                  </Text>
                </View>

                <View style={styles.liveIndicatorPill}>
                  <View
                    style={[
                      styles.recordingDot,
                      {
                        backgroundColor: isRecording
                          ? COLORS.guideRed
                          : COLORS.muted,
                      },
                    ]}
                  />

                  <Text style={styles.liveIndicatorText}>
                    {isRecording ? 'LIVE' : 'STARTING'}
                  </Text>
                </View>
              </View>

              <LiveToneWaveform
                pitch={liveTone.pitch}
                volume={liveTone.volume}
                elapsedSeconds={elapsedSeconds}
              />

              <View style={styles.liveMetricsRow}>
                <View style={styles.liveMetric}>
                  <Text style={styles.liveLabel}>DETECTED NOTE</Text>

                  <Text style={styles.liveValue}>
                    {hasPitch ? liveTone.note : '--'}
                  </Text>

                  <Text style={styles.metricHint}>
                    {hasPitch
                      ? formatFrequency(liveTone.pitch)
                      : 'Waiting for pitch'}
                  </Text>
                </View>

                <View style={styles.liveDivider} />

                <View style={styles.liveMetric}>
                  <Text style={styles.liveLabel}>CLARITY</Text>

                  <Text style={styles.liveValue}>
                    {hasClarity
                      ? `${Math.round(
                          clamp(liveTone.clarity, 0, 1) * 100,
                        )}%`
                      : '--'}
                  </Text>

                  <Text style={styles.metricHint}>
                    {hasClarity
                      ? 'Vocal signal'
                      : 'Listening for tone'}
                  </Text>
                </View>

                <View style={styles.liveDivider} />

                <View style={styles.liveMetric}>
                  <Text style={styles.liveLabel}>VOLUME</Text>

                  <Text style={styles.liveValueSmall}>
                    {formatVolume(liveTone.volume)}
                  </Text>

                  <Text style={styles.metricHint}>
                    Live level
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.recordingProgressSection}>
              <View style={styles.recordingProgressLabels}>
                <Text style={styles.progressLabel}>
                  RECORDING PROGRESS
                </Text>

                <Text style={styles.progressTime}>
                  {elapsed.toFixed(1)}s / {params.intervalSec.toFixed(1)}s
                </Text>
              </View>

              <View
                style={styles.progressTrack}
                accessibilityRole="progressbar"
                accessibilityLabel="Repetition recording progress"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round(recordingProgress * 100),
                }}
              >
                <View
                  style={[
                    styles.progressFill,
                    { width: `${recordingProgress * 100}%` },
                  ]}
                />
              </View>

              <Text style={styles.remainingText}>
                {remaining.toFixed(1)} seconds remaining
              </Text>
            </View>

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
              color={COLORS.brown}
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
  preparingScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  preparingIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  preparingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: COLORS.brown,
    textAlign: 'center',
  },
  preparingSubtitle: {
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
  recordingScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    paddingHorizontal: 22,
    paddingTop: 80,
    paddingBottom: 20,
  },
  recordingContent: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 64,
    paddingBottom: 28,
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
    lineHeight: 18,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 330,
  },
  repPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: COLORS.pink,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 8,
    marginTop: 17,
  },
  repPillText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color: COLORS.brown,
  },
  targetNoteCard: {
    width: '110%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.background,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 15,
    paddingVertical: 13,
    marginTop: 17,
  },
  targetNoteHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  targetNoteIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetNoteText: {
    flex: 1,
    marginLeft: 10,
  },
  targetNoteLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    letterSpacing: 0.5,
    color: COLORS.muted,
  },
  targetNoteHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 3,
  },
  targetNoteValueContainer: {
    alignItems: 'flex-end',
    marginLeft: 10,
  },
  targetNoteValue: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: COLORS.brown,
  },
  targetNoteFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 1,
  },
  recordingProgressSection: {
    width: '110%',
    marginTop: 19,
  },
  recordingProgressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: COLORS.muted,
  },
  progressTime: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: COLORS.brown,
  },
  progressTrack: {
    height: 7,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: COLORS.background,
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: COLORS.waveform,
  },
  remainingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    textAlign: 'right',
    marginTop: 7,
  },
  liveCard: {
    width: '110%',
    backgroundColor: COLORS.background,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 15,
    marginTop: 16,
  },
  liveCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveMicCircle: {
    width: 41,
    height: 41,
    borderRadius: 21,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveCardHeading: {
    flex: 1,
    marginLeft: 10,
  },
  liveCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  liveCardSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 3,
  },
  liveIndicatorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 15,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  recordingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  liveIndicatorText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    letterSpacing: 0.5,
    color: COLORS.brown,
  },
  waveformContainer: {
    marginTop: 15,
    backgroundColor: COLORS.white,
    borderRadius: 17,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  waveformBars: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  waveformBar: {
    flex: 1,
    maxWidth: 6,
    minHeight: 5,
    borderRadius: 5,
    backgroundColor: COLORS.waveform,
  },
  waveformStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
  },
  waveformStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 7,
  },
  waveformStatus: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    textAlign: 'center',
  },

  liveMetricsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 14,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  liveMetric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  liveDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: 6,
  },
  liveLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    letterSpacing: 0.3,
    color: COLORS.muted,
    textAlign: 'center',
  },
  liveValue: {
    fontFamily: 'FredokaBold',
    fontSize: 21,
    color: COLORS.brown,
    marginTop: 5,
    textAlign: 'center',
  },
  liveValueSmall: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
    marginTop: 8,
    textAlign: 'center',
  },
  metricHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: COLORS.muted,
    marginTop: 3,
    textAlign: 'center',
  },
  recordingTip: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: COLORS.background,
    borderRadius: 15,
    padding: 13,
    marginTop: 13,
  },
  recordingTipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: COLORS.muted,
  },
  metricCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.6,
    color: COLORS.muted,
  },
  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: COLORS.brown,
    marginTop: 3,
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
  resultTarget: {
    alignItems: 'center',
    backgroundColor: COLORS.pink,
    borderRadius: 18,
    paddingVertical: 18,
  },
  resultTargetLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 0.7,
  },
  resultTargetNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: COLORS.brown,
    marginTop: 4,
  },
  resultTargetFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
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
});