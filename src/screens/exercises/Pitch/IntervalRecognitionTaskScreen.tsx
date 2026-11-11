import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { INTERVAL_RECOGNITION_PARAMS, type IntervalRecognitionParams, type Tier } from '@/constants/params';
import { useAudioRecorder, type LiveAudioFrame } from '@/hooks/useAudioRecorder';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { measureIntervalRecognition } from '@/services/measurement/pitch/intervalRecognitionTask';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreIntervalRecognitionTask, type IntervalRecognitionScoreResult } from '@/services/scoring/pitch/intervalRecognitionTask';
import { sleep } from '@/utils/async';
import { calcPitchAccuracy } from '@/utils/dsp/pitch';
import { clamp } from '@/utils/math';
import { playNoteSequence } from '@/utils/music/notePlayer';
import { createMusicalNote, frequencyToNoteName, getRandomIntervalNotes, type VocalRange } from '@/utils/music/notes';
import { COLORS, EXERCISE_COUNTDOWN_SECONDS, EXERCISE_RECORDING_BUFFER_SECONDS, PITCH_GUIDE_MAX_CENTS } from '@/constants/appConstants';
import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
} from '@/screens/exercises/ExerciseScreen';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { LivePitchIndicator as ExerciseLivePitchIndicator } from '@/screens/exercises/Pitch/LivePitchIndicator';
import { ExerciseNoAudioModal, ExerciseQuitModal } from '@/components/exercises/ExerciseModals';
import { usePhaseState } from '@/hooks/usePhaseState';

const MIN_RESPONSE_TIME_PER_REPETITION_SECONDS = 1.8;
const PRE_RECORDING_DELAY_MS = 1500;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'results';

interface IntervalDefinition {
  name: string;
  ratio: number;
  semitones: number;
}

interface GeneratedInterval {
  rootNote: ReturnType<typeof createMusicalNote>;
  targetNote: ReturnType<typeof createMusicalNote>;
  interval: IntervalDefinition;
}

interface QuitExerciseModalProps {
  visible: boolean;
  interruptedPhase: Phase;
  isQuitting: boolean;
  onContinue: () => void;
  onQuit: () => void;
}



const INTERVALS: IntervalDefinition[] = [
  {
    name: 'Major 3rd',
    ratio: 2 ** (4 / 12),
    semitones: 4,
  },
  {
    name: 'Perfect 4th',
    ratio: 2 ** (5 / 12),
    semitones: 5,
  },
  {
    name: 'Perfect 5th',
    ratio: 2 ** (7 / 12),
    semitones: 7,
  },
  {
    name: 'Octave',
    ratio: 2,
    semitones: 12,
  },
];

function getRecordingDurationSec(
  params: IntervalRecognitionParams,
): number {
  const minimumDuration =
    params.repetitions * MIN_RESPONSE_TIME_PER_REPETITION_SECONDS;

  return Math.max(
    params.totalDurationSec,
    minimumDuration + EXERCISE_RECORDING_BUFFER_SECONDS,
  );
}

function generateInterval(
  tier: Tier,
  vocalRange: VocalRange | null,
): GeneratedInterval {
  const availableIntervals =
    tier === 'advanced'
      ? INTERVALS
      : INTERVALS.filter(item => item.name !== 'Octave');

  const selectedInterval =
    availableIntervals[
      Math.floor(Math.random() * availableIntervals.length)
    ];

  const [rootNote, targetNote] = getRandomIntervalNotes(
    tier,
    selectedInterval.semitones,
    vocalRange,
  );

  return {
    rootNote,
    targetNote,
    interval: {
      ...selectedInterval,
      ratio: targetNote.frequency / rootNote.frequency,
    },
  };
}



function QuitExerciseModal({
  visible,
  isQuitting,
  onContinue,
  onQuit,
}: QuitExerciseModalProps) {
  return (
    <ExerciseQuitModal
        visible={visible}
        title={"Leave Exercise?"}
        message={"Your current exercise progress may be lost. Are you sure you want to leave?"}
        isQuitting={isQuitting}
        onContinue={onContinue}
        onQuit={onQuit}
        continueLabel={isQuitting ? 'Please wait...' : 'Continue Exercise'}
        quitLabel="Quit Exercise"
        quittingLabel="Leaving..."
        statusBarTranslucent={false}
      />
  );
}

export default function IntervalRecognitionTaskScreen({
  tier,
}: Props) {
  const initialTier = tier ?? 'beginner';

  const [currentTier, setCurrentTier] =
    useState<Tier>(initialTier);

  const [params, setParams] =
    useState<IntervalRecognitionParams>(
      INTERVAL_RECOGNITION_PARAMS[initialTier],
    );

  const [isLoadingParams, setIsLoadingParams] =
    useState(true);

  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [isInitialListening, setIsInitialListening] = useState(false);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

  const [rootNote, setRootNote] = useState(() =>
    createMusicalNote(60),
  );

  const [targetNote, setTargetNote] = useState(() =>
    createMusicalNote(67),
  );

  const [interval, setIntervalValue] =
    useState<IntervalDefinition>(INTERVALS[2]);

  const [liveAudioFrame, setLiveAudioFrame] =
    useState<LiveAudioFrame | null>(null);

  const [liveFrequencies, setLiveFrequencies] =
    useState<number[]>([]);

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [result, setResult] =
    useState<IntervalRecognitionScoreResult | null>(null);

  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const mountedRef = useRef(true);
  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const leavingRef = useRef(false);
  const playbackRunRef = useRef(0);

  const lastPitchTraceUpdateRef = useRef(0);

  const [isQuitting, setIsQuitting] = useState(false);

  const pausedPhaseRef = useRef<Phase>('instructions');
  const isQuittingRef = useRef(false);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const isRecordingRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const processingRef = useRef(false);
  const recordingStartPendingRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const resumeAfterStopRef = useRef(false);

  const startCountdownRef = useRef<
    ((reuseCurrentExercise?: boolean) => void) | null
  >(null);

  const recordingElapsedRef = useRef(0);
  const pitchHistoryRef = useRef<number[]>([]);

  const stopRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const currentExerciseRef =
    useRef<GeneratedInterval | null>(null);

  const setQuitModalVisible = useCallback((visible: boolean) => {
    showQuitModalRef.current = visible;
    setShowQuitModal(visible);
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

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParameters() {
      setIsLoadingParams(true);

      try {
        const { auth } = await import('@/services/firebase/config');

        if (cancelled) {
          return;
        }

        const user = auth.currentUser;

        if (!user) {
          const fallbackTier = tier ?? 'beginner';

          setCurrentTier(fallbackTier);
          setParams(INTERVAL_RECOGNITION_PARAMS[fallbackTier]);
          return;
        }

        const progress = await fetchComponentProgress(
          user.uid,
          'pitch',
        );

        if (cancelled) {
          return;
        }

        const resolvedTier =
          tier ?? progress?.currentTier ?? 'beginner';

        setCurrentTier(resolvedTier);

        const records = await fetchExerciseRecords(
          user.uid,
          'pitch',
        );

        if (cancelled) {
          return;
        }

        const currentTierScores = records
          .filter(
            record =>
              record.tier === resolvedTier &&
              record.templateId === 'intervalRecognitionTask',
          )
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-5)
          .map(record => record.scorePct);

        const assessment = await getLatestAssessment();

        if (cancelled) {
          return;
        }

        setVocalRange(assessment?.vocalRange ?? null);

        let recentScores = currentTierScores;

        if (recentScores.length === 0) {
          const pitchScore = assessment?.scores.find(
            score => score.componentId === 'pitch',
          );

          if (pitchScore) {
            recentScores = [pitchScore.scorePct];
          }
        }

        const {
          generateIntervalRecognitionParams,
        } = await import(
          '@/services/adaptiveDifficultyScaling/parameterGenerator'
        );

        if (cancelled) {
          return;
        }

        const adaptiveParams =
          generateIntervalRecognitionParams({
            tier: resolvedTier,
            recentScores,
          });

        setParams(adaptiveParams);
      } catch (errorMessage) {
        console.error(
          'Failed to load interval recognition ADS:',
          errorMessage,
        );

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';

          setCurrentTier(fallbackTier);
          setParams(INTERVAL_RECOGNITION_PARAMS[fallbackTier]);
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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      playbackRunRef.current += 1;
      clearTimers();

      discardRecordingRef.current = true;
      resumeAfterStopRef.current = false;

      if (isRecordingRef.current || recordingStartPendingRef.current) {
        void stopRecordingRef.current?.().catch(errorMessage => {
          console.error(
            'Failed to stop recording during cleanup:',
            errorMessage,
          );
        });
      }
    };
  }, [clearTimers]);

  const handleLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      setLiveAudioFrame(frame);
      const now = Date.now();

      if (now - lastPitchTraceUpdateRef.current < 100) {
        return;
      }

      lastPitchTraceUpdateRef.current = now;

      if (
        Number.isFinite(frame.pitch) &&
        frame.pitch > 0
      ) {
        pitchHistoryRef.current = [
          ...pitchHistoryRef.current,
          frame.pitch,
        ].slice(-30);

        setLiveFrequencies(pitchHistoryRef.current);
      }
    },
    [],
  );

  const handleRecordingStop = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      isRecordingRef.current = false;
      recordingStartPendingRef.current = false;
      stopInFlightRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      if (discardRecordingRef.current) {
        discardRecordingRef.current = false;
        recordingStopRequestedRef.current = false;
        processingRef.current = false;

        if (
          resumeAfterStopRef.current &&
          mountedRef.current &&
          !pausedRef.current &&
          !showQuitModalRef.current &&
          !leavingRef.current
        ) {
          resumeAfterStopRef.current = false;
          startCountdownRef.current?.(true);
        }

        return;
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        leavingRef.current ||
        processingRef.current
      ) {
        recordingStopRequestedRef.current = false;
        return;
      }

      if (!hasSufficientRecordedSignal(samples)) {
        recordingStopRequestedRef.current = false;
        processingRef.current = false;
        setErrorMessage(null);
        setPhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      processingRef.current = true;
      setPhase('processing');

      try {
        const exercise = currentExerciseRef.current;

        if (!exercise) {
          throw new Error(
            'No current interval exercise was found.',
          );
        }

        const measurement = measureIntervalRecognition(
          samples,
          sampleRate,
          params.minClarity,
          params.repetitions,
          exercise.interval.ratio,
        );

        const score = scoreIntervalRecognitionTask(
          measurement,
          exercise.interval.ratio,
          exercise.interval.name,
          params,
        );

        if (
          !mountedRef.current ||
          pausedRef.current ||
          leavingRef.current
        ) {
          return;
        }

        await saveCompletedExercise(
          'pitch',
          'intervalRecognitionTask',
          currentTier,
          score.score,
        );

        if (!mountedRef.current || leavingRef.current) {
          return;
        }

        setResult(score);
        setPhase('results');
      } catch (errorMessage) {
        console.error(
          'Interval recognition processing error:',
          errorMessage,
        );

        if (mountedRef.current && !leavingRef.current) {
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
    [currentTier, params, setPhase],
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
    stopRecordingRef.current = stopRecording;

    return () => {
      stopRecordingRef.current = null;
    };
  }, [stopRecording]);

  const beginRecording = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      leavingRef.current ||
      isRecordingRef.current ||
      recordingStartPendingRef.current ||
      processingRef.current ||
      stopInFlightRef.current
    ) {
      return;
    }

    try {
      discardRecordingRef.current = false;
      recordingStopRequestedRef.current = false;
      processingRef.current = false;
      recordingStartPendingRef.current = true;

      pitchHistoryRef.current = [];
      recordingElapsedRef.current = 0;
      lastPitchTraceUpdateRef.current = 0;

      setLiveFrequencies([]);
      setLiveAudioFrame(null);
      setElapsedMs(0);
      setPhase('recording');

      await startRecording();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        leavingRef.current
      ) {
        recordingStartPendingRef.current = false;
        discardRecordingRef.current = true;
        recordingStopRequestedRef.current = true;

        if (!stopInFlightRef.current) {
          stopInFlightRef.current = true;

          try {
            await stopRecording();
          } catch (errorMessage) {
            stopInFlightRef.current = false;
            recordingStopRequestedRef.current = false;

            console.error(
              'Failed to stop interrupted recording:',
              errorMessage,
            );
          }
        }

        return;
      }

      recordingStartPendingRef.current = false;
      isRecordingRef.current = true;

      const durationMs = getRecordingDurationSec(params) * 1000;
      let lastTickAt = Date.now();

      recordingTimerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsedDelta = now - lastTickAt;
        lastTickAt = now;

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          leavingRef.current ||
          !isRecordingRef.current ||
          recordingStopRequestedRef.current
        ) {
          return;
        }

        recordingElapsedRef.current += elapsedDelta;

        const elapsedSeconds = recordingElapsedRef.current;
        setElapsedMs(elapsedSeconds);

        if (elapsedSeconds < durationMs) {
          return;
        }

        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        if (recordingStopRequestedRef.current) {
          return;
        }

        recordingStopRequestedRef.current = true;
        stopInFlightRef.current = true;
        setElapsedMs(durationMs);
        setPhase('processing');

        void stopRecording().catch(errorMessage => {
          console.error(
            'Failed to stop interval recording:',
            errorMessage,
          );

          isRecordingRef.current = false;
          stopInFlightRef.current = false;
          recordingStopRequestedRef.current = false;

          if (mountedRef.current && !leavingRef.current) {
            setErrorMessage(
              'We could not finish the recording. Please try again.',
            );

            setPhase('instructions');
          }
        });

      }, 100);
    } catch (errorMessage) {
      console.error(
        'Failed to start interval recording:',
        errorMessage,
      );

      isRecordingRef.current = false;
      recordingStartPendingRef.current = false;
      stopInFlightRef.current = false;
      recordingStopRequestedRef.current = false;
      discardRecordingRef.current = false;
      resumeAfterStopRef.current = false;

      if (mountedRef.current && !leavingRef.current) {
        setPhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    }
  }, [
    params,
    setPhase,
    startRecording,
    stopRecording,
  ]);

  const playIntervalAndRecord = useCallback(
    async (exercise: GeneratedInterval, runId: number) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        leavingRef.current ||
        runId !== playbackRunRef.current
      ) {
        return;
      }

      try {
        setPhase('listening');

        const repetitions = Math.max(
          1,
          Math.round(params.repetitions),
        );

        for (let index = 0; index < repetitions; index++) {
          if (
            !mountedRef.current ||
            pausedRef.current ||
            showQuitModalRef.current ||
            leavingRef.current ||
            runId !== playbackRunRef.current
          ) {
            return;
          }

          await playNoteSequence([
            {
              frequencyHz: exercise.rootNote.frequency,
              durationSec: 0.8,
            },
            {
              frequencyHz: exercise.targetNote.frequency,
              durationSec: 0.8,
            },
          ]);

          if (
            !mountedRef.current ||
            pausedRef.current ||
            showQuitModalRef.current ||
            leavingRef.current ||
            runId !== playbackRunRef.current
          ) {
            return;
          }

          if (index < repetitions - 1) {
            await new Promise<void>(resolve => {
              setTimeout(resolve, 350);
            });

            if (
              !mountedRef.current ||
              pausedRef.current ||
              showQuitModalRef.current ||
              leavingRef.current ||
              runId !== playbackRunRef.current
            ) {
              return;
            }
          }
        }

        await sleep(PRE_RECORDING_DELAY_MS);

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          leavingRef.current ||
          runId !== playbackRunRef.current
        ) {
          return;
        }

        await beginRecording();
      } catch (errorMessage) {
        console.error('Failed to play interval:', errorMessage);

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !leavingRef.current
        ) {
          setPhase('instructions');

          Alert.alert(
            'Audio Error',
            'Unable to play the target interval. Please try again.',
          );
        }
      }
    },
    [beginRecording, params.repetitions, setPhase],
  );

  const startCountdown = useCallback(
    (reuseCurrentExercise = false) => {
      if (
        isLoadingParams ||
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        leavingRef.current ||
        stopInFlightRef.current
      ) {
        return;
      }

      clearTimers();

      let generated = reuseCurrentExercise
        ? currentExerciseRef.current
        : null;

      if (!generated) {
        generated = generateInterval(currentTier, vocalRange);
        currentExerciseRef.current = generated;
      }

      setRootNote(generated.rootNote);
      setTargetNote(generated.targetNote);
      setIntervalValue(generated.interval);

      setResult(null);
      setErrorMessage(null);
      setLiveAudioFrame(null);
      setLiveFrequencies([]);
      setIsInitialListening(false);

      pitchHistoryRef.current = [];
      recordingElapsedRef.current = 0;
      setElapsedMs(0);

      processingRef.current = false;
      recordingStopRequestedRef.current = false;
      isRecordingRef.current = false;
      recordingStartPendingRef.current = false;

      const runId = ++playbackRunRef.current;

      setCountdown(3);
      setPhase('countdown');

      let remaining = 3;

      countdownTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          leavingRef.current ||
          runId !== playbackRunRef.current
        ) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }

          return;
        }

        remaining -= 1;

        if (remaining <= 0) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }

          void playIntervalAndRecord(generated!, runId);
          return;
        }

        setCountdown(remaining);
      }, 1000);
    },
    [
      clearTimers,
      currentTier,
      isLoadingParams,
      playIntervalAndRecord,
      setPhase,
      vocalRange,
    ],
  );

  useEffect(() => {
    startCountdownRef.current = startCountdown;

    return () => {
      startCountdownRef.current = null;
    };
  }, [startCountdown]);

  const requestQuit = useCallback(() => {
    if (
      !mountedRef.current ||
      leavingRef.current ||
      phaseRef.current === 'processing' ||
      showQuitModalRef.current ||
      isQuittingRef.current
    ) {
      return;
    }

    pausedPhaseRef.current = phaseRef.current;

    pausedRef.current = true;
    playbackRunRef.current += 1;

    clearTimers();

    setQuitModalVisible(true);

    if (
      isRecordingRef.current ||
      recordingStartPendingRef.current ||
      isRecording
    ) {
      discardRecordingRef.current = true;
      recordingStopRequestedRef.current = true;

      if (!stopInFlightRef.current) {
        stopInFlightRef.current = true;

        void stopRecordingRef.current?.().catch(errorMessage => {
          console.error(
            'Failed to stop recording when pausing:',
            errorMessage,
          );

          stopInFlightRef.current = false;
          recordingStopRequestedRef.current = false;
          isRecordingRef.current = false;
          recordingStartPendingRef.current = false;
          discardRecordingRef.current = true;
        });
      }
    }

    recordingElapsedRef.current = 0;
    setElapsedMs(0);
    setLiveAudioFrame(null);
    setLiveFrequencies([]);
    pitchHistoryRef.current = [];
  }, [
    clearTimers,
    isRecording,
    setQuitModalVisible,
  ]);

  const continueExercise = useCallback(() => {
    if (
      !mountedRef.current ||
      leavingRef.current ||
      isQuittingRef.current ||
      !showQuitModalRef.current
    ) {
      return;
    }

    setQuitModalVisible(false);
    pausedRef.current = false;

    setLiveAudioFrame(null);
    setLiveFrequencies([]);
    setElapsedMs(0);

    pitchHistoryRef.current = [];
    recordingElapsedRef.current = 0;

    if (
      stopInFlightRef.current ||
      discardRecordingRef.current ||
      recordingStartPendingRef.current
    ) {
      resumeAfterStopRef.current = true;
      return;
    }

    isRecordingRef.current = false;
    recordingStartPendingRef.current = false;
    processingRef.current = false;
    recordingStopRequestedRef.current = false;

    startCountdown(true);
  }, [
    setQuitModalVisible,
    startCountdown,
  ]);

  const quitExercise = useCallback(async () => {
    if (
      !mountedRef.current ||
      leavingRef.current ||
      isQuittingRef.current
    ) {
      return;
    }

    isQuittingRef.current = true;
    setIsQuitting(true);

    leavingRef.current = true;
    pausedRef.current = true;
    resumeAfterStopRef.current = false;
    playbackRunRef.current += 1;

    clearTimers();

    setQuitModalVisible(false);

    try {
      if (
        isRecordingRef.current ||
        recordingStartPendingRef.current ||
        isRecording
      ) {
        discardRecordingRef.current = true;
        recordingStopRequestedRef.current = true;

        if (!stopInFlightRef.current) {
          stopInFlightRef.current = true;

          try {
            await stopRecordingRef.current?.();
          } catch (errorMessage) {
            console.error(
              'Failed to stop recording while quitting:',
              errorMessage,
            );
          } finally {
            stopInFlightRef.current = false;
            isRecordingRef.current = false;
            recordingStartPendingRef.current = false;
          }
        }
      }
    } finally {
      router.replace('/exercises/pitch');
    }
  }, [
    clearTimers,
    isRecording,
    setQuitModalVisible,
  ]);

  const noAudioModal = (
    <ExerciseNoAudioModal
      visible={showNoAudioModal}
      onRedo={function redoExerciseRepetition() {
        setShowNoAudioModal(false);
        setErrorMessage(null);
        startCountdownRef.current?.(true);
      }}
      onQuit={() => {
        void quitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) {
          continueExercise();
          return true;
        }

        if (
          phaseRef.current === 'processing' ||
          leavingRef.current
        ) {
          return true;
        }

        requestQuit();
        return true;
      },
    );

    return () => subscription.remove();
  }, [continueExercise, requestQuit]);

  const retry = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    resumeAfterStopRef.current = false;
    playbackRunRef.current += 1;

    if (isRecordingRef.current || recordingStartPendingRef.current) {
      discardRecordingRef.current = true;
      recordingStopRequestedRef.current = true;

      if (!stopInFlightRef.current) {
        stopInFlightRef.current = true;

        void stopRecording().catch(errorMessage => {
          console.error(
            'Failed to stop recording during retry:',
            errorMessage,
          );

          stopInFlightRef.current = false;
          discardRecordingRef.current = false;
          recordingStopRequestedRef.current = false;
        });
      }
    } else {
      discardRecordingRef.current = false;
    }

    isRecordingRef.current = false;
    recordingStartPendingRef.current = false;
    processingRef.current = false;
    recordingStopRequestedRef.current = false;

    currentExerciseRef.current = null;

    setResult(null);
    setLiveAudioFrame(null);
    setLiveFrequencies([]);

    pitchHistoryRef.current = [];
    recordingElapsedRef.current = 0;

    setElapsedMs(0);
    setErrorMessage(null);
    setPhase('instructions');
  }, [clearTimers, setPhase, stopRecording]);

  const recordingDurationMs =
    getRecordingDurationSec(params) * 1000;

  const recordingProgress =
    recordingDurationMs > 0
      ? Math.min(1, elapsedMs / recordingDurationMs)
      : 0;

  const repetitionCount = Math.max(
    1,
    Math.round(params.repetitions),
  );

  const isRecordingComplete = recordingProgress >= 1;

  const repetitionProgress = Math.min(
    repetitionCount - 1,
    Math.floor(recordingProgress * repetitionCount),
  );

  const currentRep = repetitionProgress + 1;

  const phaseProgress = isRecordingComplete
    ? 1
    : (recordingProgress * repetitionCount) % 1;

  const firstHalf = !isRecordingComplete && phaseProgress < 0.5;
  const liveTarget = firstHalf ? rootNote : targetNote;

  const liveAccuracy =
    liveAudioFrame && liveAudioFrame.pitch > 0
      ? calcPitchAccuracy(
          liveAudioFrame.pitch,
          liveTarget.frequency,
        )
      : 0;



  const pitchTrace = liveFrequencies
    .slice(-18)
    .map(frequency => {
      if (frequency <= 0 || liveTarget.frequency <= 0) {
        return 0;
      }

      return clamp(
        (1200 * Math.log2(frequency / liveTarget.frequency)) /
          PITCH_GUIDE_MAX_CENTS,
        -1,
        1,
      );
    });

  if (phase === 'instructions' && isLoadingParams) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level"
          icon="options-outline"
          iconSize={44}
          containerStyle={exerciseStyles.centerScreen}
        />

        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={pausedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
        {noAudioModal}
      </>
    );
  }

  if (phase === 'instructions') {
    return (
      <>
        <View style={exerciseStyles.screenVariant2}>
          <ExerciseScreen
            title="Interval Recognition Task"
            category="Pitch"
            icon="swap-vertical-outline"
            instructions={`Listen carefully to the reference interval. The same interval will be repeated ${repetitionCount} times. After the reference playback, sing the first note, pause briefly, then sing the second note. Repeat the same interval for each repetition.`}
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
                text: 'If available, an external microphone or audio recording equipment is recommended for clearer audio capture.',
              },
            ]}
            summary={[
              {
                label: 'REPETITIONS',
                value: String(repetitionCount),
                hint: 'attempts',
              },
              {
                label: 'TARGET',
                value: 'Match the interval',
              },
            ]}
            tip="Leave a short, clear pause between each pair of sung notes so TuneUp! can detect every repetition separately."
            tier={currentTier}
            onBack={requestQuit}
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
        </View>

        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={pausedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
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
          countdown={countdown}
          promptTitle="Listen carefully"
          prompt="You will hear the reference interval before singing it."
        />
        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={pausedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
        {noAudioModal}
      </>
    );
  }

  if (phase === 'listening') {
    return (
      <>
        <ExerciseListeningScreen
          icon="volume-high-outline"
          title="Interval Recognition Task"
          promptTitle="Listen to the Interval"
          prompt={
            isInitialListening
              ? 'Listen to the reference interval before the countdown begins.'
              : `The same interval is being repeated ${repetitionCount} times.`
          }
          onContinue={
            isInitialListening
              ? () => {
                  setIsInitialListening(false);
                  startCountdown(false);
                }
              : undefined
          }
          onBack={requestQuit}
          liveContent={
            <>
              <View style={exerciseStyles.intervalPreview}>
                <View style={exerciseStyles.intervalNote}>
                  <Text style={exerciseStyles.intervalNoteLabel}>START</Text>
                  <Text style={exerciseStyles.intervalNoteName}>
                    {rootNote.name}
                  </Text>
                </View>

                <Ionicons
                  name="arrow-forward"
                  size={25}
                  color={COLORS.brown}
                />

                <View style={exerciseStyles.intervalNote}>
                  <Text style={exerciseStyles.intervalNoteLabel}>TARGET</Text>
                  <Text style={exerciseStyles.intervalNoteName}>
                    {targetNote.name}
                  </Text>
                </View>
              </View>

              <View style={exerciseStyles.intervalNameBadge}>
                <Text style={exerciseStyles.componentScore}>
                  {interval.name}
                </Text>
              </View>

              <ActivityIndicator
                size="small"
                color={COLORS.brown}
                style={exerciseStyles.playbackSpinner}
              />
            </>
          }
        />

        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={pausedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
        {noAudioModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        <View style={exerciseStyles.screenVariant2}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={exerciseStyles.recordingContentVariant1}
          >
            <View style={exerciseStyles.recordingIcon}>
              <Ionicons
                name="mic"
                size={32}
                color={COLORS.brown}
              />
            </View>

            <Text style={exerciseStyles.phaseTitleVariant1}>
              Sing the Interval
            </Text>

            <Text style={exerciseStyles.sessionLabel}>
                Repetition {currentRep} of {repetitionCount}
            </Text>

            <View style={exerciseStyles.intervalProgress}>
              <View
                style={[
                  exerciseStyles.intervalProgressNote,
                  firstHalf && exerciseStyles.resultIconPassed,
                ]}
              >
                <Text
                  style={[
                    exerciseStyles.intervalProgressText,
                    firstHalf && exerciseStyles.liveNoteDetected,
                  ]}
                >
                  {rootNote.name}
                </Text>
              </View>

              <View style={exerciseStyles.progressLine} />

              <View
                style={[
                  exerciseStyles.intervalProgressNote,
                  !firstHalf && exerciseStyles.resultIconPassed,
                ]}
              >
                <Text
                  style={[
                    exerciseStyles.intervalProgressText,
                    !firstHalf && exerciseStyles.liveNoteDetected,
                  ]}
                >
                  {targetNote.name}
                </Text>
              </View>
            </View>

            <ExerciseLivePitchIndicator
              targetNote={liveTarget.name}
              targetFrequency={liveTarget.frequency}
              detectedNote={liveAudioFrame && liveAudioFrame.pitch > 0 ? liveAudioFrame.note || frequencyToNoteName(liveAudioFrame.pitch) : null}
              detectedFrequency={liveAudioFrame && liveAudioFrame.pitch > 0 ? liveAudioFrame.pitch : null}
              pitchTrace={pitchTrace} />

            <View style={exerciseStyles.recordingBar}>
              <View
                style={[
                  exerciseStyles.exerciseProgressFill,
                  {
                    width: `${Math.round(recordingProgress * 100)}%`,
                  },
                ]}
              />
            </View>
          </ScrollView>
        </View>

        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={pausedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
        {noAudioModal}
      </>
    );
  }

  if (phase === 'processing') {
    return (
      <>
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing Your Singing"
          message="Checking your repeated interval accuracy."
        />

        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={pausedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
/>
{noAudioModal}
      </>
    );
  }

  if (phase === 'results' && result) {
    const detectedNote1 =
      result.freq1 > 0 ? frequencyToNoteName(result.freq1) : '--';

    const detectedNote2 =
      result.freq2 > 0 ? frequencyToNoteName(result.freq2) : '--';

    return (
      <>
        <View style={exerciseStyles.screenVariant2}>
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

            <Text style={exerciseStyles.resultSubtitle}>
              Interval Recognition Result
            </Text>

            <View style={exerciseStyles.scoreCard}>
              <Text style={exerciseStyles.scoreLabel}>Overall Score</Text>

              <Text style={exerciseStyles.scoreValue}>{result.score}%</Text>

              <Text style={exerciseStyles.scoreDescriptionVariant2}>
                {result.passed
                  ? 'Your repeated interval attempts were within the target tolerance.'
                  : 'Try to reproduce the distance between the notes more accurately.'}
              </Text>
            </View>

            <View style={exerciseStyles.resultCard}>
              <Text style={exerciseStyles.resultCardTitle}>
                Target Interval
              </Text>

              <View style={exerciseStyles.targetNoteRow}>
                <View style={exerciseStyles.intervalResultNote}>
                  <Text style={exerciseStyles.scaleText}>START</Text>

                  <Text style={exerciseStyles.intervalResultNoteName}>
                    {rootNote.name}
                  </Text>
                </View>

                <View style={exerciseStyles.intervalArrow}>
                  <Ionicons
                    name="arrow-forward"
                    size={23}
                    color={COLORS.brown}
                  />

                  <Text style={exerciseStyles.intervalArrowLabel}>
                    {result.intervalName}
                  </Text>
                </View>

                <View style={exerciseStyles.intervalResultNote}>
                  <Text style={exerciseStyles.scaleText}>TARGET</Text>

                  <Text style={exerciseStyles.intervalResultNoteName}>
                    {targetNote.name}
                  </Text>
                </View>
              </View>
            </View>

            <View style={exerciseStyles.resultCard}>
              <Text style={exerciseStyles.resultCardTitle}>
                Repetition Results
              </Text>

              <View style={exerciseStyles.resultRow}>
                <Text style={exerciseStyles.resultRowLabel}>
                  Requested repetitions
                </Text>

                <Text style={exerciseStyles.resultRowValue}>
                  {repetitionCount}
                </Text>
              </View>

              <View style={exerciseStyles.resultRow}>
                <Text style={exerciseStyles.resultRowLabel}>
                  Detected repetitions
                </Text>

                <Text style={exerciseStyles.resultRowValue}>
                  {result.repetitionsCompleted}
                </Text>
              </View>

              {result.repetitionScores.map((repetitionScore, index) => (
                <View
                  key={`repetition-${index}`}
                  style={exerciseStyles.resultRow}
                >
                  <Text style={exerciseStyles.resultRowLabel}>
                    Repetition {index + 1}
                  </Text>

                  <Text style={exerciseStyles.resultRowValue}>
                    {repetitionScore}%
                  </Text>
                </View>
              ))}
            </View>

            <View style={exerciseStyles.resultCard}>
              <Text style={exerciseStyles.resultCardTitle}>
                Your Performance
              </Text>

              <View style={exerciseStyles.resultRow}>
                <Text style={exerciseStyles.resultRowLabel}>
                  Detected first note
                </Text>

                <Text style={exerciseStyles.resultRowValue}>
                  {detectedNote1}
                </Text>
              </View>

              <View style={exerciseStyles.resultRow}>
                <Text style={exerciseStyles.resultRowLabel}>
                  Detected second note
                </Text>

                <Text style={exerciseStyles.resultRowValue}>
                  {detectedNote2}
                </Text>
              </View>

              <View style={exerciseStyles.resultRow}>
                <Text style={exerciseStyles.resultRowLabel}>
                  Target ratio
                </Text>

                <Text style={exerciseStyles.resultRowValue}>
                  {result.targetRatio.toFixed(3)}
                </Text>
              </View>

              <View style={exerciseStyles.resultRow}>
                <Text style={exerciseStyles.resultRowLabel}>
                  Median detected ratio
                </Text>

                <Text style={exerciseStyles.resultRowValue}>
                  {result.detectedRatio > 0
                    ? result.detectedRatio.toFixed(3)
                    : '--'}
                </Text>
              </View>
            </View>

            <View style={exerciseStyles.resultCard}>
              <Text style={exerciseStyles.resultCardTitle}>
                Audio Quality
              </Text>

              <View style={exerciseStyles.resultRow}>
                <Text style={exerciseStyles.resultRowLabel}>
                  First note clarity
                </Text>

                <Text style={exerciseStyles.resultRowValue}>
                  {Math.round(result.firstNoteClarity * 100)}%
                </Text>
              </View>

              <View style={exerciseStyles.resultRow}>
                <Text style={exerciseStyles.resultRowLabel}>
                  Second note clarity
                </Text>

                <Text style={exerciseStyles.resultRowValue}>
                  {Math.round(result.secondNoteClarity * 100)}%
                </Text>
              </View>
            </View>

            <View style={exerciseStyles.tipCard}>
              <Ionicons
                name="bulb-outline"
                size={21}
                color={COLORS.brown}
              />

              <Text style={exerciseStyles.tipText}>
                {result.passed
                  ? 'Nice interval matching! Keep focusing on hearing the distance between notes before you sing.'
                  : 'Listen carefully to the reference interval and keep a clear pause between every sung note pair.'}
              </Text>
            </View>

            <Pressable
              style={exerciseStyles.startButtonVariant4}
              onPress={retry}
            >
              <Text style={exerciseStyles.startButtonText}>
                Try Again
              </Text>

              <Ionicons
                name="refresh"
                size={18}
                color={COLORS.white}
              />
            </Pressable>

            <Pressable
              style={exerciseStyles.doneButton}
              onPress={quitExercise}
            >
              <Text style={exerciseStyles.componentScore}>Done</Text>
            </Pressable>
          </ScrollView>
        </View>
        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={pausedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
        {noAudioModal}
      </>
    );
  }
  return (
    <>
      <QuitExerciseModal
        visible={showQuitModal}
        interruptedPhase={pausedPhaseRef.current}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => {
          void quitExercise();
        }}
      />
      {noAudioModal}
    </>
  );
}
