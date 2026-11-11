import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { BackHandler, ScrollView, Text, View } from 'react-native';

import type { Tier } from '@/constants/params';
import {
    TONE_CONSISTENCY_PARAMS,
    type ToneConsistencyParams,
} from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
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
    ExercisePreparingScreen,
    ExerciseProcessingScreen,
    ExerciseResultsScreen,
    MetricCard,
} from '../ExerciseScreen';

import {
    COLORS,
    EXERCISE_COUNTDOWN_SECONDS,
    EXERCISE_FFT_HOP_SIZE,
    EXERCISE_FFT_SIZE,
    EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
    TONE_WAVEFORM_BAR_COUNT,
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { LiveToneMonitorCard } from '@/screens/exercises/Tone/LiveToneMonitorCard';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { clamp } from '@/utils/math';
import { formatFrequency } from '@/utils/numberFormatting';

import {
    ExerciseNoAudioModal,
    ExerciseQuitModal,
} from '@/components/ExerciseModals';


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

type LiveToneState = {
  pitch: number;
  note: string;
  clarity: number;
  volume: number;
};

type ExerciseResult = {
  score: number;
  passed: boolean;
  averageCentroidHz: number;
  averageAmplitude: number;
};

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
      Array.from({ length: TONE_WAVEFORM_BAR_COUNT }, (_, index) => {
        const center = (TONE_WAVEFORM_BAR_COUNT - 1) / 2;
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
    <View style={exerciseStyles.waveformContainerVariant1}>
      <View
        style={exerciseStyles.waveformBarsVariant1}
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
              exerciseStyles.waveformBarVariant1,
              {
                height,
                opacity: hasPitch ? 0.95 : 0.3,
              },
            ]}
          />
        ))}
      </View>

      <View style={exerciseStyles.waveformStatusRowVariant1}>
        <View
          style={[
            exerciseStyles.waveformStatusDot,
            {
              backgroundColor: hasPitch ? COLORS.guideGreen : COLORS.guideRed,
            },
          ]}
        />

        <Text style={exerciseStyles.waveformStatusVariant2}>
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
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');

  const [currentTier, setCurrentTier] = useState<Tier>(
    tier ?? 'beginner',
  );

  const [params, setParams] = useState<ToneConsistencyParams>(
    TONE_CONSISTENCY_PARAMS[tier ?? 'beginner'],
  );

  const [isLoadingParams, setIsLoadingParams] =
    useState(true);

  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [listenElapsedSeconds, setListenElapsedSeconds] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);

  const [liveTone, setLiveTone] = useState<LiveToneState>({
    pitch: 0,
    note: '--',
    clarity: 0,
    volume: -100,
  });

  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

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

  const setExercisePhase = useCallback((nextScreen: Phase) => {
    phaseRef.current = nextScreen;

    if (mountedRef.current) {
      setPhase(nextScreen);
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
      setIsLoadingParams(true);

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
      } catch (errorMessage) {
        console.error('Tone consistency ADS error:', errorMessage);

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';

          setCurrentTier(fallbackTier);
          setParams(TONE_CONSISTENCY_PARAMS[fallbackTier]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingParams(false);
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
    setExercisePhase('listening');

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

      const elapsedSeconds = (Date.now() - startTime) / 1000;

      setListenElapsedSeconds(
        Math.min(elapsedSeconds, EXERCISE_REFERENCE_NOTE_DURATION_SECONDS),
      );
    }, 50);

    try {
      const targetToPlay =
        lockedTargetRef.current ?? generatedTarget;

      await playSingleNote(
        targetToPlay.frequency,
        EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
      );
    } catch (errorMessage) {
      console.error('Failed to play target note:', errorMessage);
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
        setExercisePhase('instructions');
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

    setListenElapsedSeconds(EXERCISE_REFERENCE_NOTE_DURATION_SECONDS);

    return true;
  }, [clearTimers, generatedTarget, setExercisePhase]);

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
    setExercisePhase('recording');

    try {
      discardNextStopRef.current = false;

      await startRecordingRef.current();

      if (
        !mountedRef.current ||
        exitingRef.current ||
        pausedRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        discardNextStopRef.current = true;
        isRecordingRef.current = false;

        void stopRecordingRef.current?.();
        return;
      }

      isRecordingRef.current = true;
    } catch (errorMessage) {
      console.error('Failed to start recording:', errorMessage);
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
        setExercisePhase('instructions');
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

      const elapsedSeconds = (Date.now() - startTime) / 1000;

      setElapsedSeconds(
        Math.min(elapsedSeconds, params.intervalSec),
      );

      if (elapsedSeconds >= params.intervalSec) {
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
  }, [clearTimers, params.intervalSec, setExercisePhase]);

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
        if (!hasSufficientRecordedSignal(samples)) {
          setExercisePhase('instructions');
          setShowNoAudioModal(true);
          return;
        }

        if (
          !Number.isFinite(sampleRate) ||
          sampleRate <= 0
        ) {
          throw new Error('The recording has an invalid sample rate.');
        }

        const fftFrames = samplesToFFTFrames(
          samples,
          EXERCISE_FFT_SIZE,
          EXERCISE_FFT_HOP_SIZE,
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

        setExercisePhase('processing');

        const measurement = measureToneConsistency(
          repetitionSamplesRef.current,
          repetitionFFTFramesRef.current,
          sampleRate,
          EXERCISE_FFT_SIZE,
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

        setExercisePhase('results');
      } catch (errorMessage) {
        console.error('Tone consistency analysis error:', errorMessage);

        if (
          mountedRef.current &&
          !exitingRef.current &&
          !pausedRef.current &&
          !quitInProgressRef.current
        ) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          setExercisePhase('instructions');
        }
      } finally {
        finishingRef.current = false;
        startingRef.current = false;
      }
    },
    [clearTimers, currentTier, params, setExercisePhase],
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
      isLoadingParams ||
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
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setExercisePhase('countdown');

    let remaining = EXERCISE_COUNTDOWN_SECONDS;

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
        } catch (errorMessage) {
          console.error(
            'Failed to start tone consistency exercise:',
            errorMessage,
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
            setExercisePhase('instructions');
          }
        }
      })();
    }, 1000);
  }, [
    clearTimers,
    generatedTarget,
    isLoadingParams,
    setExercisePhase,
  ]);

  useEffect(() => {
    startExerciseRef.current = startExercise;

    return () => {
      startExerciseRef.current = null;
    };
  }, [startExercise]);

  const retryExercise = useCallback(() => {
    clearTimers();

    void disposeNotePlayer().catch(errorMessage => {
      console.warn('Failed to stop note player:', errorMessage);
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
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);

    setLiveTone({
      pitch: 0,
      note: '--',
      clarity: 0,
      volume: -100,
    });

    setExercisePhase('instructions');
  }, [clearTimers, isRecording, setExercisePhase]);

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

    void disposeNotePlayer().catch(errorMessage => {
      console.warn('Failed to pause reference note:', errorMessage);
    });

    if (
      phaseRef.current === 'recording' ||
      isRecordingRef.current ||
      isRecording
    ) {
      discardNextStopRef.current = true;
      finishingRef.current = true;

      if (isRecordingRef.current || isRecording) {
        void Promise.resolve(stopRecordingRef.current?.()).catch(
          errorMessage => {
            console.warn(
              'Failed to stop interrupted tone-consistency recording:',
              errorMessage,
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

    const previousScreen = phaseRef.current;

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
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);

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
      setExercisePhase('instructions');
      return;
    }

    setExercisePhase(previousScreen);
  }, [setExercisePhase]);

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

    void disposeNotePlayer().catch(errorMessage => {
      console.warn('Failed to stop reference note:', errorMessage);
    });

    if (isRecordingRef.current || isRecording) {
      discardNextStopRef.current = true;

      void Promise.resolve(stopRecordingRef.current?.()).catch(
        errorMessage => {
          console.warn(
            'Failed to stop recording while quitting:',
            errorMessage,
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

      void disposeNotePlayer().catch(errorMessage => {
        console.warn('Failed to dispose note player:', errorMessage);
      });
    };
  }, [clearTimers]);

  const listenProgress =
    clamp(
      listenElapsedSeconds / EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
      0,
      1,
    ) * 100;

  const recordingProgress =
    params.intervalSec > 0
      ? clamp(elapsedSeconds / params.intervalSec, 0, 1)
      : 0;

  const quitMessage =
    phase === 'recording'
      ? 'Your current repetition will be discarded. If you continue, the exercise will restart from the countdown.'
      : phase === 'listening'
        ? 'Reference-note playback will stop. If you continue, the exercise will restart from the countdown.'
        : phase === 'countdown'
          ? 'Your countdown will restart if you continue the exercise.'
          : phase === 'processing'
            ? 'Your completed repetitions are being analyzed. You can return to the exercise while analysis continues.'
            : phase === 'results'
              ? 'Are you sure you want to leave Tone Consistency? Your completed result has already been saved.'
              : 'Are you sure you want to leave Tone Consistency?';

  const quitModal = (
    <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit Exercise?"}
        message={quitMessage}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={quitExercise}
        continueLabel={"Continue Exercise"}
        quitLabel={"Quit Exercise"}
      />
  );

  const noAudioModal = (
    <ExerciseNoAudioModal
      visible={showNoAudioModal}
      onRedo={function redoExerciseRepetition() {
        setShowNoAudioModal(false);
        setErrorMessage('');
        void (async () => {
          const played = await listenToTargetNoteRef.current?.();

          if (played && mountedRef.current && !quitInProgressRef.current) {
            await startRecordingAttemptRef.current?.();
          }
        })();
      }}
      onQuit={() => {
        setShowNoAudioModal(false);
        quitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  if (phase === 'instructions' && isLoadingParams) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level and preparing your vocal range."
          icon="options-outline"
          iconSize={44}
        />

        {quitModal}
      </>
    );
  }

  if (phase === 'instructions') {
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
          errorMessage={errorMessage}
          startDisabled={isLoadingParams}
        />

        {quitModal}
        {noAudioModal}
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
          promptTitle="Your target note is"
          prompt={`${targetNote} • ${formatFrequency(targetFrequency)}`}
          onBack={goBack}
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
          title="Listen to the Note"
          currentRep={currentRep}
          repetitions={params.repetitions}
          elapsedSeconds={listenElapsedSeconds}
          targetDuration={EXERCISE_REFERENCE_NOTE_DURATION_SECONDS}
          promptTitle="Listen to the reference note"
          prompt="Listen carefully. After the note finishes, sing the same note."
          liveContent={
            <View style={exerciseStyles.sharedListenNoteBox}>
              <Text style={exerciseStyles.liveLabel}>TARGET NOTE</Text>
              <Text style={exerciseStyles.largeNote}>{targetNote}</Text>
              <Text style={exerciseStyles.stateFrequency}>
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

  if (phase === 'recording') {
    const hasPitch =
      Number.isFinite(liveTone.pitch) && liveTone.pitch > 0;

    const hasClarity =
      Number.isFinite(liveTone.clarity) && liveTone.clarity > 0;

    const displayElapsedSeconds = Math.min(
      elapsedSeconds,
      params.intervalSec,
    );
    return (
      <>
        <View style={exerciseStyles.recordingScreenVariant4}>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={exerciseStyles.recordingContentVariant5}
          >
            <Text style={exerciseStyles.phaseTitle}>
              Sing the Note
            </Text>

            <Text style={exerciseStyles.repPillTextVariant2}>
                Repetition {currentRep} of {params.repetitions}
              </Text>

            <View style={exerciseStyles.targetNoteCard}>
              <View style={exerciseStyles.targetNoteHeading}>

                <View style={exerciseStyles.feedbackContent}>
                  <Text style={exerciseStyles.targetNoteLabel}>
                    YOUR TARGET NOTE
                  </Text>
                </View>
              </View>

              <View style={exerciseStyles.targetNoteValueContainer}>
                <Text style={exerciseStyles.targetNoteValue}>
                  {targetNote}
                </Text>

                <Text style={exerciseStyles.pitchTargetFrequency}>
                  {formatFrequency(targetFrequency)}
                </Text>
              </View>
            </View>

            <LiveToneMonitorCard>


              <LiveToneWaveform
                pitch={liveTone.pitch}
                volume={liveTone.volume}
                elapsedSeconds={displayElapsedSeconds}
              />

              <View style={exerciseStyles.liveMetricsRowVariant1}>
                <View style={exerciseStyles.liveMetricVariant1}>
                  <Text style={exerciseStyles.liveLabelVariant5}>DETECTED NOTE</Text>

                  <Text style={exerciseStyles.liveValueVariant2}>
                    {hasPitch ? liveTone.note : '--'}
                  </Text>

                  <Text style={exerciseStyles.metricHintVariant2}>
                    {hasPitch
                      ? formatFrequency(liveTone.pitch)
                      : 'Waiting for pitch'}
                  </Text>
                </View>

                <View style={exerciseStyles.liveDividerVariant1} />

                <View style={exerciseStyles.liveMetricVariant1}>
                  <Text style={exerciseStyles.liveLabelVariant5}>CLARITY</Text>

                  <Text style={exerciseStyles.liveValueVariant2}>
                    {hasClarity
                      ? `${Math.round(
                          clamp(liveTone.clarity, 0, 1) * 100,
                        )}%`
                      : '--'}
                  </Text>

                  <Text style={exerciseStyles.metricHintVariant2}>
                    {hasClarity
                      ? 'Vocal signal'
                      : 'Listening for tone'}
                  </Text>
                </View>

                <View style={exerciseStyles.liveDividerVariant1} />

                <View style={exerciseStyles.liveMetricVariant1}>
                  <Text style={exerciseStyles.liveLabelVariant5}>VOLUME</Text>

                  <Text style={exerciseStyles.liveValueSmall}>
                    {formatVolume(liveTone.volume)}
                  </Text>

                  <Text style={exerciseStyles.metricHintVariant2}>
                    Live level
                  </Text>
                </View>
              </View>
            </LiveToneMonitorCard>

            <View style={exerciseStyles.recordingProgressSectionVariant3}>
              <View style={exerciseStyles.repetitionHeader}>
                <Text style={exerciseStyles.progressLabelVariant1}>
                  RECORDING
                </Text>

              </View>

              <View
                style={exerciseStyles.progressTrackVariant7}
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
                    exerciseStyles.progressFill,
                    { width: `${recordingProgress * 100}%` },
                  ]}
                />
              </View>

            </View>

          </ScrollView>
        </View>

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
          message="Comparing your repetitions for tone and vocal consistency."
        />

        {quitModal}
      </>
    );
  }

  if (phase === 'results' && result) {
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
          <View style={exerciseStyles.resultCard}>
            <Text style={exerciseStyles.resultCardTitle}>
              Tone Consistency
            </Text>

            <View style={exerciseStyles.resultTarget}>
              <Text style={exerciseStyles.comparisonLabel}>
                TARGET NOTE
              </Text>

              <Text style={exerciseStyles.targetNote}>
                {targetNote}
              </Text>

              <Text style={exerciseStyles.scoreRowLabel}>
                {formatFrequency(targetFrequency)}
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.resultsGrid}>
            <MetricCard
              label="OVERALL SCORE"
              variant="toneConsistency"
              value={`${result.score}%`}
            />

            <MetricCard
              label="AVG. CENTROID"
              variant="toneConsistency"
              value={
                result.averageCentroidHz > 0
                  ? `${Math.round(result.averageCentroidHz)} Hz`
                  : '--'
              }
            />

            <MetricCard
              label="AVG. AMPLITUDE"
              variant="toneConsistency"
              value={
                result.averageAmplitude > 0
                  ? result.averageAmplitude.toFixed(3)
                  : '--'
              }
            />

            <MetricCard
              label="REPETITIONS"
              variant="toneConsistency"
              value={String(params.repetitions)}
            />
          </View>

          <View style={exerciseStyles.feedbackCardVariant2}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={COLORS.brown}
            />

            <View style={exerciseStyles.feedbackContent}>
              <Text style={exerciseStyles.resultDetailValue}>Feedback</Text>

              <Text style={exerciseStyles.feedbackText}>
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
