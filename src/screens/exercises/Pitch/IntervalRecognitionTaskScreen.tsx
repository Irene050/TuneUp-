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
  INTERVAL_RECOGNITION_PARAMS,
  type IntervalRecognitionParams,
  type Tier,
} from '@/constants/exercises/pitch';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { measureIntervalRecognition } from '@/services/measurement/pitch/intervalRecognitionTask';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
  scoreIntervalRecognitionTask,
  type IntervalRecognitionScoreResult,
} from '@/services/scoring/pitch/intervalRecognitionTask';
import {
  calcLiveStability,
  calcPitchAccuracy,
} from '@/utils/dsp/pitch';
import { playNoteSequence } from '@/utils/music/notePlayer';
import {
  createMusicalNote, frequencyToNoteName, getRandomIntervalNotes,
  type VocalRange
} from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const GUIDE_GREEN = '#4F9B67';
const GUIDE_YELLOW = '#D9A72E';
const GUIDE_RED = '#D64F5A';

const GUIDE_MAX_CENTS = 100;
const MIN_RESPONSE_TIME_PER_REPETITION_SEC = 1.8;
const RECORDING_BUFFER_SEC = 0.8;
const PRE_RECORDING_DELAY_MS = 1500;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'playing'
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

interface PitchGuideStatus {
  cents: number | null;
  position: number;
  color: string;
  label: string;
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

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, value));
}

function getRecordingDurationSec(
  params: IntervalRecognitionParams,
): number {
  const minimumDuration =
    params.repetitions * MIN_RESPONSE_TIME_PER_REPETITION_SEC;

  return Math.max(
    params.totalDurationSec,
    minimumDuration + RECORDING_BUFFER_SEC,
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

function getPitchGuideStatus(
  pitch: number | null | undefined,
  targetFrequency: number,
): PitchGuideStatus {
  if (
    pitch == null ||
    !Number.isFinite(pitch) ||
    pitch <= 0 ||
    !Number.isFinite(targetFrequency) ||
    targetFrequency <= 0
  ) {
    return {
      cents: null,
      position: 50,
      color: MUTED,
      label: 'LISTENING',
    };
  }

  const cents =
    1200 * Math.log2(pitch / targetFrequency);

  const normalizedCents = clamp(
    cents / GUIDE_MAX_CENTS,
    -1,
    1,
  );

  // Flat pitches move left; sharp pitches move right.
  const position = clamp(
    50 + normalizedCents * 43,
    7,
    93,
  );

  const absoluteCents = Math.abs(cents);
  const direction = cents < 0 ? 'FLAT' : 'SHARP';

  if (absoluteCents <= 25) {
    return {
      cents,
      position,
      color: GUIDE_GREEN,
      label: absoluteCents <= 5 ? 'IN TUNE' : 'CLOSE',
    };
  }

  if (absoluteCents <= 50) {
    return {
      cents,
      position,
      color: GUIDE_YELLOW,
      label: `SLIGHTLY ${direction}`,
    };
  }

  return {
    cents,
    position,
    color: GUIDE_RED,
    label: `TOO ${direction}`,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatCents(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) {
    return 'Waiting for pitch...';
  }

  if (Math.abs(cents) < 1) {
    return '0 cents';
  }

  const sign = cents > 0 ? '+' : '−';

  return `${sign}${Math.round(Math.abs(cents))} cents`;
}

function QuitExerciseModal({
  visible,
  isQuitting,
  onContinue,
  onQuit,
}: QuitExerciseModalProps) {
  return (
    <Modal
  visible={visible}
  transparent
  animationType="fade"
  onRequestClose={onContinue}
>
  <View style={styles.modalOverlay}>
    <View style={styles.quitModalCard}>
      <View style={styles.quitIconCircle}>
        <Ionicons
          name="exit-outline"
          size={30}
          color={BROWN}
        />
      </View>

      <Text style={styles.quitModalTitle}>
        Leave Exercise?
      </Text>

      <Text style={styles.quitModalMessage}>
        Your current exercise progress may be lost.
        Are you sure you want to leave?
      </Text>

      <Pressable
        onPress={onContinue}
        disabled={isQuitting}
        style={({ pressed }) => [
          styles.continueButton,
          pressed && styles.modalButtonPressed,
          isQuitting && styles.buttonDisabled,
        ]}
      >
        <Text style={styles.continueButtonText}>
          {isQuitting ? 'Please wait...' : 'Continue Exercise'}
        </Text>
      </Pressable>

      <Pressable
        onPress={onQuit}
        disabled={isQuitting}
        style={({ pressed }) => [
          styles.quitButton,
          pressed && styles.modalButtonPressed,
          isQuitting && styles.buttonDisabled,
        ]}
      >
        <Text style={styles.quitButtonText}>
          {isQuitting ? 'Leaving...' : 'Quit Exercise'}
        </Text>
      </Pressable>
    </View>
  </View>
</Modal>
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

  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(3);
  const [showQuitModal, setShowQuitModal] = useState(false);

  const [rootNote, setRootNote] = useState(() =>
    createMusicalNote(60),
  );

  const [targetNote, setTargetNote] = useState(() =>
    createMusicalNote(67),
  );

  const [interval, setIntervalValue] =
    useState<IntervalDefinition>(INTERVALS[2]);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [liveFrequencies, setLiveFrequencies] =
    useState<number[]>([]);

  const [recordingElapsedMs, setRecordingElapsedMs] =
    useState(0);

  const [result, setResult] =
    useState<IntervalRecognitionScoreResult | null>(null);

  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const mountedRef = useRef(true);
  const phaseRef = useRef<Phase>('instructions');
  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const leavingRef = useRef(false);
  const playbackRunRef = useRef(0);

  const lastPitchTraceUpdateRef = useRef(0);

  const [isQuitting, setIsQuitting] = useState(false);

  const interruptedPhaseRef = useRef<Phase>('instructions');
  const isQuittingRef = useRef(false);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
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

  const setCurrentPhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

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
      setIsLoadingAdaptiveParams(true);

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
      } catch (error) {
        console.error(
          'Failed to load interval recognition ADS:',
          error,
        );

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';

          setCurrentTier(fallbackTier);
          setParams(INTERVAL_RECOGNITION_PARAMS[fallbackTier]);
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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      playbackRunRef.current += 1;
      clearTimers();

      discardRecordingRef.current = true;
      resumeAfterStopRef.current = false;

      if (recordingRef.current || recordingStartPendingRef.current) {
        void stopRecordingRef.current?.().catch(error => {
          console.error(
            'Failed to stop recording during cleanup:',
            error,
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

      // Update the live pitch indicator whenever a frame arrives.
      setLiveFrame(frame);

      // Keep the pitch trace history separate from the indicator updates.
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
      recordingRef.current = false;
      recordingStartPendingRef.current = false;
      stopInFlightRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      if (discardRecordingRef.current) {
        discardRecordingRef.current = false;
        stopRequestedRef.current = false;
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
        stopRequestedRef.current = false;
        return;
      }

      processingRef.current = true;
      setCurrentPhase('processing');

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
        setCurrentPhase('results');
      } catch (error) {
        console.error(
          'Interval recognition processing error:',
          error,
        );

        if (mountedRef.current && !leavingRef.current) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );

          setCurrentPhase('instructions');
        }
      } finally {
        processingRef.current = false;
        stopRequestedRef.current = false;
      }
    },
    [currentTier, params, setCurrentPhase],
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
      recordingRef.current ||
      recordingStartPendingRef.current ||
      processingRef.current ||
      stopInFlightRef.current
    ) {
      return;
    }

    try {
      discardRecordingRef.current = false;
      stopRequestedRef.current = false;
      processingRef.current = false;
      recordingStartPendingRef.current = true;

      pitchHistoryRef.current = [];
      recordingElapsedRef.current = 0;
      lastPitchTraceUpdateRef.current = 0;

      setLiveFrequencies([]);
      setLiveFrame(null);
      setRecordingElapsedMs(0);
      setCurrentPhase('recording');

      await startRecording();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        leavingRef.current
      ) {
        recordingStartPendingRef.current = false;
        discardRecordingRef.current = true;
        stopRequestedRef.current = true;

        if (!stopInFlightRef.current) {
          stopInFlightRef.current = true;

          try {
            await stopRecording();
          } catch (error) {
            stopInFlightRef.current = false;
            stopRequestedRef.current = false;

            console.error(
              'Failed to stop interrupted recording:',
              error,
            );
          }
        }

        return;
      }

      recordingStartPendingRef.current = false;
      recordingRef.current = true;

      const durationMs = getRecordingDurationSec(params) * 1000;

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          leavingRef.current ||
          !recordingRef.current ||
          stopRequestedRef.current
        ) {
          return;
        }

        recordingElapsedRef.current += 100;

        const elapsed = recordingElapsedRef.current;
        setRecordingElapsedMs(elapsed);

        if (elapsed < durationMs) {
          return;
        }

        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        if (stopRequestedRef.current) {
          return;
        }

        stopRequestedRef.current = true;
        stopInFlightRef.current = true;

        // Show the analyzing screen immediately.
        // Do not wait for the recorder's onStop callback.
        setRecordingElapsedMs(durationMs);
        setCurrentPhase('processing');

        void stopRecording().catch(error => {
          console.error(
            'Failed to stop interval recording:',
            error,
          );

          recordingRef.current = false;
          stopInFlightRef.current = false;
          stopRequestedRef.current = false;

          if (mountedRef.current && !leavingRef.current) {
            setErrorMessage(
              'We could not finish the recording. Please try again.',
            );

            setCurrentPhase('instructions');
          }
        });

      }, 100);
    } catch (error) {
      console.error(
        'Failed to start interval recording:',
        error,
      );

      recordingRef.current = false;
      recordingStartPendingRef.current = false;
      stopInFlightRef.current = false;
      stopRequestedRef.current = false;
      discardRecordingRef.current = false;
      resumeAfterStopRef.current = false;

      if (mountedRef.current && !leavingRef.current) {
        setCurrentPhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    }
  }, [
    params,
    setCurrentPhase,
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
        setCurrentPhase('playing');

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

        await delay(PRE_RECORDING_DELAY_MS);

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
      } catch (error) {
        console.error('Failed to play interval:', error);

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !leavingRef.current
        ) {
          setCurrentPhase('instructions');

          Alert.alert(
            'Audio Error',
            'Unable to play the target interval. Please try again.',
          );
        }
      }
    },
    [beginRecording, params.repetitions, setCurrentPhase],
  );

  const startCountdown = useCallback(
    (reuseCurrentExercise = false) => {
      if (
        isLoadingAdaptiveParams ||
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
      setLiveFrame(null);
      setLiveFrequencies([]);

      pitchHistoryRef.current = [];
      recordingElapsedRef.current = 0;
      setRecordingElapsedMs(0);

      processingRef.current = false;
      stopRequestedRef.current = false;
      recordingRef.current = false;
      recordingStartPendingRef.current = false;

      const runId = ++playbackRunRef.current;

      setCountdown(3);
      setCurrentPhase('countdown');

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
      isLoadingAdaptiveParams,
      playIntervalAndRecord,
      setCurrentPhase,
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

    interruptedPhaseRef.current = phaseRef.current;

    pausedRef.current = true;
    playbackRunRef.current += 1;

    clearTimers();

    setQuitModalVisible(true);

    if (
      recordingRef.current ||
      recordingStartPendingRef.current ||
      isRecording
    ) {
      discardRecordingRef.current = true;
      stopRequestedRef.current = true;

      if (!stopInFlightRef.current) {
        stopInFlightRef.current = true;

        void stopRecordingRef.current?.().catch(error => {
          console.error(
            'Failed to stop recording when pausing:',
            error,
          );

          stopInFlightRef.current = false;
          stopRequestedRef.current = false;
          recordingRef.current = false;
          recordingStartPendingRef.current = false;
          discardRecordingRef.current = true;
        });
      }
    }

    recordingElapsedRef.current = 0;
    setRecordingElapsedMs(0);
    setLiveFrame(null);
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

    setLiveFrame(null);
    setLiveFrequencies([]);
    setRecordingElapsedMs(0);

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

    recordingRef.current = false;
    recordingStartPendingRef.current = false;
    processingRef.current = false;
    stopRequestedRef.current = false;

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
        recordingRef.current ||
        recordingStartPendingRef.current ||
        isRecording
      ) {
        discardRecordingRef.current = true;
        stopRequestedRef.current = true;

        if (!stopInFlightRef.current) {
          stopInFlightRef.current = true;

          try {
            await stopRecordingRef.current?.();
          } catch (error) {
            console.error(
              'Failed to stop recording while quitting:',
              error,
            );
          } finally {
            stopInFlightRef.current = false;
            recordingRef.current = false;
            recordingStartPendingRef.current = false;
          }
        }
      }
    } finally {
      router.replace('/dashboard?tab=exercises');
    }
  }, [
    clearTimers,
    isRecording,
    setQuitModalVisible,
  ]);

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

    if (recordingRef.current || recordingStartPendingRef.current) {
      discardRecordingRef.current = true;
      stopRequestedRef.current = true;

      if (!stopInFlightRef.current) {
        stopInFlightRef.current = true;

        void stopRecording().catch(error => {
          console.error(
            'Failed to stop recording during retry:',
            error,
          );

          stopInFlightRef.current = false;
          discardRecordingRef.current = false;
          stopRequestedRef.current = false;
        });
      }
    } else {
      discardRecordingRef.current = false;
    }

    recordingRef.current = false;
    recordingStartPendingRef.current = false;
    processingRef.current = false;
    stopRequestedRef.current = false;

    currentExerciseRef.current = null;

    setResult(null);
    setLiveFrame(null);
    setLiveFrequencies([]);

    pitchHistoryRef.current = [];
    recordingElapsedRef.current = 0;

    setRecordingElapsedMs(0);
    setErrorMessage(null);
    setCurrentPhase('instructions');
  }, [clearTimers, setCurrentPhase, stopRecording]);

  const recordingDurationMs =
    getRecordingDurationSec(params) * 1000;

  const recordingProgress =
    recordingDurationMs > 0
      ? Math.min(1, recordingElapsedMs / recordingDurationMs)
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

  const currentRepetition = repetitionProgress + 1;

  const phaseProgress = isRecordingComplete
    ? 1
    : (recordingProgress * repetitionCount) % 1;

  const firstHalf = !isRecordingComplete && phaseProgress < 0.5;
  const liveTarget = firstHalf ? rootNote : targetNote;

  const liveAccuracy =
    liveFrame && liveFrame.pitch > 0
      ? calcPitchAccuracy(
          liveFrame.pitch,
          liveTarget.frequency,
        )
      : 0;

  const liveStability = calcLiveStability(liveFrequencies);

  const pitchGuide = getPitchGuideStatus(
    liveFrame?.pitch,
    liveTarget.frequency,
  );

  const pitchTrace = liveFrequencies
    .slice(-18)
    .map(frequency => {
      if (frequency <= 0 || liveTarget.frequency <= 0) {
        return 0;
      }

      return clamp(
        (1200 * Math.log2(frequency / liveTarget.frequency)) /
          GUIDE_MAX_CENTS,
        -1,
        1,
      );
    });

  if (phase === 'instructions' && isLoadingAdaptiveParams) {
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

        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={interruptedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
      </>
    );
  }

  if (phase === 'instructions') {
    return (
      <>
        <View style={styles.screen}>
          <Pressable
            style={styles.backButton}
            onPress={requestQuit}
          >
            <Ionicons
              name="arrow-back"
              size={22}
              color={BROWN}
            />
          </Pressable>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <View style={styles.iconCircle}>
              <Ionicons
                name="swap-vertical-outline"
                size={34}
                color={BROWN}
              />
            </View>

            <Text style={styles.title}>
              Interval Recognition Task
            </Text>

            <Text style={styles.subtitle}>Pitch</Text>

            <View style={styles.instructionCard}>
              <Text style={styles.cardTitle}>
                Exercise Instructions
              </Text>

              <Text style={styles.instruction}>
                Listen carefully to the reference interval.
              </Text>

              <Text style={styles.instruction}>
                The same interval will be repeated {repetitionCount} times.
              </Text>

              <Text style={styles.instruction}>
                After the reference playback, sing the first note, pause
                briefly, then sing the second note. Repeat the same interval
                for each repetition.
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
                    Find a quiet room or area with minimal background noise.
                  </Text>
                </View>

                <View style={styles.prepareItem}>
                  <Ionicons
                    name="body-outline"
                    size={17}
                    color={BROWN}
                  />

                  <Text style={styles.prepareText}>
                    Sit upright or stand with your back straight and your
                    shoulders relaxed.
                  </Text>
                </View>

                <View style={styles.prepareItem}>
                  <Ionicons
                    name="mic-outline"
                    size={17}
                    color={BROWN}
                  />

                  <Text style={styles.prepareText}>
                    If available, an external microphone or audio recording
                    equipment is recommended for clearer audio capture.
                  </Text>
                </View>
              </View>

              <View style={styles.targetBox}>
                <Ionicons
                  name="swap-vertical"
                  size={25}
                  color={BROWN}
                />

                <Text style={styles.targetText}>
                  Match the interval
                </Text>
              </View>

              <Text style={styles.helperText}>
                Each detected repetition is scored individually, then
                combined into the final exercise score.
              </Text>
            </View>

            <View style={styles.tipCard}>
              <Ionicons
                name="bulb-outline"
                size={21}
                color={BROWN}
              />

              <Text style={styles.tipText}>
                Leave a short, clear pause between each pair of sung notes
                so TuneUp! can detect every repetition separately.
              </Text>
            </View>

            <View style={styles.difficultyRow}>
              <Text style={styles.difficultyLabel}>
                Difficulty
              </Text>

              <Text style={styles.difficultyValue}>
                {currentTier}
              </Text>
            </View>

            <Pressable
              style={styles.startButton}
              disabled={isLoadingAdaptiveParams}
              onPress={() => startCountdown(false)}
            >
              {isLoadingAdaptiveParams ? (
                <ActivityIndicator
                  size="small"
                  color={WHITE}
                />
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
              <Text style={styles.errorText}>
                {errorMessage}
              </Text>
            )}
          </ScrollView>
        </View>

        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={interruptedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
      </>
    );
  }

  if (phase === 'countdown') {
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

          <Text style={styles.phaseTitle}>Get Ready</Text>

          <Text style={styles.countdownText}>{countdown}</Text>

          <Text style={styles.phaseSubtitle}>
            Listen carefully to the repeated interval.
          </Text>
        </View>
        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={interruptedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
      </>
    );
  }

  if (phase === 'playing') {
    return (
      <>
        <View style={styles.centerScreen}>
          <View style={styles.iconCircle}>
            <Ionicons
              name="volume-high-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.phaseTitle}>
            Listen to the Interval
          </Text>

          <Text style={styles.phaseSubtitle}>
            The same interval is being repeated {repetitionCount} times.
          </Text>

          <View style={styles.intervalPreview}>
            <View style={styles.intervalNote}>
              <Text style={styles.intervalNoteLabel}>START</Text>
              <Text style={styles.intervalNoteName}>
                {rootNote.name}
              </Text>
            </View>

            <Ionicons
              name="arrow-forward"
              size={25}
              color={BROWN}
            />

            <View style={styles.intervalNote}>
              <Text style={styles.intervalNoteLabel}>TARGET</Text>
              <Text style={styles.intervalNoteName}>
                {targetNote.name}
              </Text>
            </View>
          </View>

          <View style={styles.intervalNameBadge}>
            <Text style={styles.intervalNameText}>
              {interval.name}
            </Text>
          </View>

          <ActivityIndicator
            size="small"
            color={BROWN}
            style={styles.playingIndicator}
          />
        </View>

        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={interruptedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        <View style={styles.screen}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.recordingContent}
          >
            <View style={styles.recordingIcon}>
              <Ionicons
                name="mic"
                size={32}
                color={BROWN}
              />
            </View>

            <Text style={styles.phaseTitle}>
              Sing the Interval
            </Text>

            <Text style={styles.phaseSubtitle}>
              Repeat the same interval {repetitionCount} times. Leave a
              short pause between notes and repetitions.
            </Text>

            <View style={styles.repetitionBadge}>
              <Text style={styles.repetitionBadgeText}>
                Repetition {currentRepetition} of {repetitionCount}
              </Text>
            </View>

            <View style={styles.intervalProgress}>
              <View
                style={[
                  styles.intervalProgressNote,
                  firstHalf && styles.intervalProgressActive,
                ]}
              >
                <Text
                  style={[
                    styles.intervalProgressText,
                    firstHalf && styles.intervalProgressTextActive,
                  ]}
                >
                  {rootNote.name}
                </Text>
              </View>

              <View style={styles.progressLine} />

              <View
                style={[
                  styles.intervalProgressNote,
                  !firstHalf && styles.intervalProgressActive,
                ]}
              >
                <Text
                  style={[
                    styles.intervalProgressText,
                    !firstHalf && styles.intervalProgressTextActive,
                  ]}
                >
                  {targetNote.name}
                </Text>
              </View>
            </View>

            {/* Live pitch guide */}
            <View style={styles.pitchGuideCard}>
              <View style={styles.pitchGuideHeader}>
                <View style={styles.pitchGuideHeading}>
                  <View style={styles.pitchGuideTitleRow}>
                    <View style={styles.pitchGuideIcon}>
                      <Ionicons
                        name="pulse-outline"
                        size={17}
                        color={BROWN}
                      />
                    </View>

                    <Text style={styles.pitchGuideTitle}>
                      LIVE PITCH GUIDE
                    </Text>
                  </View>

                  <Text style={styles.pitchGuideSubtitle}>
                    Follow the marker to match the current note
                  </Text>
                </View>

                <View
                  style={[
                    styles.guideStatusPill,
                    {
                      backgroundColor:
                        pitchGuide.cents === null
                          ? WHITE
                          : `${pitchGuide.color}15`,
                      borderColor:
                        pitchGuide.cents === null
                          ? BORDER
                          : `${pitchGuide.color}66`,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.guideStatusDot,
                      { backgroundColor: pitchGuide.color },
                    ]}
                  />

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

              <View style={styles.pitchTargetSummary}>
                <View style={styles.pitchSummaryColumn}>
                  <Text style={styles.pitchTargetCaption}>
                    CURRENT TARGET
                  </Text>

                  <Text style={styles.pitchTargetValue}>
                    {liveTarget.name}
                  </Text>

                  <Text style={styles.pitchTargetFrequency}>
                    {Math.round(liveTarget.frequency)} Hz
                  </Text>
                </View>

                <View style={styles.pitchTargetDivider} />

                <View style={styles.pitchDetectedSummary}>
                  <Text style={styles.pitchTargetCaption}>
                    YOUR NOTE
                  </Text>

                  <Text
                    style={[
                      styles.pitchDetectedValue,
                      {
                        color:
                          pitchGuide.cents === null
                            ? BROWN
                            : pitchGuide.color,
                      },
                    ]}
                  >
                    {liveFrame && liveFrame.pitch > 0
                      ? liveFrame.note || frequencyToNoteName(liveFrame.pitch)
                      : '--'}
                  </Text>

                  <Text style={styles.pitchTargetFrequency}>
                    {liveFrame && liveFrame.pitch > 0
                      ? `${Math.round(liveFrame.pitch)} Hz`
                      : 'Waiting for voice'}
                  </Text>
                </View>
              </View>

              <View style={styles.horizontalPitchMeter}>
                <View style={styles.pitchMeterLabels}>
                  <Text style={styles.pitchMeterEdgeLabel}>
                    FLAT
                  </Text>

                  <Text style={styles.pitchMeterCenterLabel}>
                    IN TUNE
                  </Text>

                  <Text style={styles.pitchMeterEdgeLabel}>
                    SHARP
                  </Text>
                </View>

                <View style={styles.pitchMeterTrack}>
                  <View
                    style={[
                      styles.pitchMeterZone,
                      {
                        left: '0%',
                        width: '20%',
                        backgroundColor: GUIDE_RED,
                      },
                    ]}
                  />

                  <View
                    style={[
                      styles.pitchMeterZone,
                      {
                        left: '20%',
                        width: '15%',
                        backgroundColor: GUIDE_YELLOW,
                      },
                    ]}
                  />

                  <View
                    style={[
                      styles.pitchMeterZone,
                      {
                        left: '35%',
                        width: '30%',
                        backgroundColor: GUIDE_GREEN,
                      },
                    ]}
                  />

                  <View
                    style={[
                      styles.pitchMeterZone,
                      {
                        left: '65%',
                        width: '15%',
                        backgroundColor: GUIDE_YELLOW,
                      },
                    ]}
                  />

                  <View
                    style={[
                      styles.pitchMeterZone,
                      {
                        left: '80%',
                        width: '20%',
                        backgroundColor: GUIDE_RED,
                      },
                    ]}
                  />

                  <View style={styles.pitchMeterTargetLine} />

                  {pitchTrace.map((sample, index) => {
                    const position = clamp(
                      50 + sample * 43,
                      7,
                      93,
                    );

                    const deviation =
                      Math.abs(sample * GUIDE_MAX_CENTS);

                    const traceColor =
                      deviation <= 25
                        ? GUIDE_GREEN
                        : deviation <= 50
                          ? GUIDE_YELLOW
                          : GUIDE_RED;

                    return (
                      <View
                        key={`pitch-trace-${index}`}
                        style={[
                          styles.pitchMeterTrace,
                          {
                            left: `${position}%`,
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
                        left: `${pitchGuide.position}%`,
                        borderColor: pitchGuide.color,
                        backgroundColor:
                          pitchGuide.cents === null
                            ? WHITE
                            : pitchGuide.color,
                      },
                    ]}
                  >
                    {pitchGuide.cents !== null && (
                      <View style={styles.pitchMeterMarkerInner} />
                    )}
                  </View>
                </View>

                <View style={styles.pitchMeterScale}>
                  <Text style={styles.pitchMeterScaleText}>
                    -100¢
                  </Text>

                  <Text style={styles.pitchMeterScaleText}>
                    0¢
                  </Text>

                  <Text style={styles.pitchMeterScaleText}>
                    +100¢
                  </Text>
                </View>
              </View>

              <View style={styles.pitchGuideFooter}>
                <View style={styles.pitchDeviationInfo}>
                  <View
                    style={[
                      styles.pitchDeviationIcon,
                      {
                        backgroundColor:
                          pitchGuide.cents === null
                            ? WHITE
                            : `${pitchGuide.color}15`,
                      },
                    ]}
                  >
                    <Ionicons
                      name="analytics-outline"
                      size={17}
                      color={pitchGuide.color}
                    />
                  </View>

                  <View style={styles.pitchDeviationTextGroup}>
                    <Text style={styles.pitchDeviationLabel}>
                      PITCH DEVIATION
                    </Text>

                    <Text
                      style={[
                        styles.pitchDeviationValue,
                        { color: pitchGuide.color },
                      ]}
                    >
                      {formatCents(pitchGuide.cents)}
                    </Text>
                  </View>
                </View>

                <View style={styles.pitchAccuracyBadge}>
                  <Text style={styles.pitchAccuracyBadgeLabel}>
                    MATCH
                  </Text>

                  <Text
                    style={[
                      styles.pitchAccuracyBadgeValue,
                      {
                        color:
                          pitchGuide.cents === null
                            ? MUTED
                            : pitchGuide.color,
                      },
                    ]}
                  >
                    {liveFrame && liveFrame.pitch > 0
                      ? `${Math.round(clamp(liveAccuracy, 0, 100))}%`
                      : '--'}
                  </Text>
                </View>
              </View>

              <View style={styles.pitchGuideLegend}>
                <View style={styles.pitchLegendItem}>
                  <View
                    style={[
                      styles.pitchLegendDot,
                      { backgroundColor: GUIDE_GREEN },
                    ]}
                  />

                  <Text style={styles.pitchLegendText}>
                    On target
                  </Text>
                </View>

                <View style={styles.pitchLegendItem}>
                  <View
                    style={[
                      styles.pitchLegendDot,
                      { backgroundColor: GUIDE_YELLOW },
                    ]}
                  />

                  <Text style={styles.pitchLegendText}>
                    Slightly off
                  </Text>
                </View>

                <View style={styles.pitchLegendItem}>
                  <View
                    style={[
                      styles.pitchLegendDot,
                      { backgroundColor: GUIDE_RED },
                    ]}
                  />

                  <Text style={styles.pitchLegendText}>
                    Far from target
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.recordingIndicator}>
              <View
                style={[
                  styles.recordingDot,
                  {
                    backgroundColor: isRecording
                      ? GUIDE_RED
                      : GUIDE_YELLOW,
                  },
                ]}
              />

              <Text style={styles.recordingText}>
                {isRecording
                  ? 'Listening to your voice...'
                  : 'Preparing microphone...'}
              </Text>
            </View>

            <View style={styles.recordingBar}>
              <View
                style={[
                  styles.recordingBarFill,
                  {
                    width: `${Math.round(recordingProgress * 100)}%`,
                  },
                ]}
              />
            </View>

            <Text style={styles.recordingProgressLabel}>
              {Math.round(recordingProgress * 100)}% complete
            </Text>
          </ScrollView>
        </View>

        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={interruptedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
      </>
    );
  }

  if (phase === 'processing') {
    return (
      <>
        <View style={styles.centerScreen}>
          <View style={styles.iconCircle}>
            <Ionicons
              name="analytics-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.phaseTitle}>
            Analyzing Your Singing
          </Text>

          <Text style={styles.phaseSubtitle}>
            Checking your repeated interval accuracy.
          </Text>

          <ActivityIndicator
            size="large"
            color={BROWN}
            style={styles.processingIndicator}
          />
        </View>

        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={interruptedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
/>
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
              Interval Recognition Result
            </Text>

            <View style={styles.scoreCard}>
              <Text style={styles.scoreLabel}>Overall Score</Text>

              <Text style={styles.scoreValue}>{result.score}%</Text>

              <Text style={styles.scoreDescription}>
                {result.passed
                  ? 'Your repeated interval attempts were within the target tolerance.'
                  : 'Try to reproduce the distance between the notes more accurately.'}
              </Text>
            </View>

            <View style={styles.intervalResultCard}>
              <Text style={styles.resultCardTitle}>
                Target Interval
              </Text>

              <View style={styles.intervalResultDisplay}>
                <View style={styles.intervalResultNote}>
                  <Text style={styles.intervalResultLabel}>START</Text>

                  <Text style={styles.intervalResultNoteName}>
                    {rootNote.name}
                  </Text>
                </View>

                <View style={styles.intervalArrow}>
                  <Ionicons
                    name="arrow-forward"
                    size={23}
                    color={BROWN}
                  />

                  <Text style={styles.intervalArrowLabel}>
                    {result.intervalName}
                  </Text>
                </View>

                <View style={styles.intervalResultNote}>
                  <Text style={styles.intervalResultLabel}>TARGET</Text>

                  <Text style={styles.intervalResultNoteName}>
                    {targetNote.name}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>
                Repetition Results
              </Text>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  Requested repetitions
                </Text>

                <Text style={styles.resultRowValue}>
                  {repetitionCount}
                </Text>
              </View>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  Detected repetitions
                </Text>

                <Text style={styles.resultRowValue}>
                  {result.repetitionsCompleted}
                </Text>
              </View>

              {result.repetitionScores.map((repetitionScore, index) => (
                <View
                  key={`repetition-${index}`}
                  style={styles.resultRow}
                >
                  <Text style={styles.resultRowLabel}>
                    Repetition {index + 1}
                  </Text>

                  <Text style={styles.resultRowValue}>
                    {repetitionScore}%
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>
                Your Performance
              </Text>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  Detected first note
                </Text>

                <Text style={styles.resultRowValue}>
                  {detectedNote1}
                </Text>
              </View>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  Detected second note
                </Text>

                <Text style={styles.resultRowValue}>
                  {detectedNote2}
                </Text>
              </View>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  Target ratio
                </Text>

                <Text style={styles.resultRowValue}>
                  {result.targetRatio.toFixed(3)}
                </Text>
              </View>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  Median detected ratio
                </Text>

                <Text style={styles.resultRowValue}>
                  {result.detectedRatio > 0
                    ? result.detectedRatio.toFixed(3)
                    : '--'}
                </Text>
              </View>
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>
                Audio Quality
              </Text>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  First note clarity
                </Text>

                <Text style={styles.resultRowValue}>
                  {Math.round(result.firstNoteClarity * 100)}%
                </Text>
              </View>

              <View style={styles.resultRow}>
                <Text style={styles.resultRowLabel}>
                  Second note clarity
                </Text>

                <Text style={styles.resultRowValue}>
                  {Math.round(result.secondNoteClarity * 100)}%
                </Text>
              </View>
            </View>

            <View style={styles.tipCard}>
              <Ionicons
                name="bulb-outline"
                size={21}
                color={BROWN}
              />

              <Text style={styles.tipText}>
                {result.passed
                  ? 'Nice interval matching! Keep focusing on hearing the distance between notes before you sing.'
                  : 'Listen carefully to the reference interval and keep a clear pause between every sung note pair.'}
              </Text>
            </View>

            <Pressable
              style={styles.startButton}
              onPress={retry}
            >
              <Text style={styles.startButtonText}>
                Try Again
              </Text>

              <Ionicons
                name="refresh"
                size={18}
                color={WHITE}
              />
            </Pressable>

            <Pressable
              style={styles.doneButton}
              onPress={quitExercise}
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </Pressable>
          </ScrollView>
        </View>
        <QuitExerciseModal
          visible={showQuitModal}
          interruptedPhase={interruptedPhaseRef.current}
          isQuitting={isQuitting}
          onContinue={continueExercise}
          onQuit={() => {
            void quitExercise();
          }}
        />
      </>
    );
  }
  return (
    <QuitExerciseModal
      visible={showQuitModal}
      interruptedPhase={interruptedPhaseRef.current}
      isQuitting={isQuitting}
      onContinue={continueExercise}
      onQuit={() => {
        void quitExercise();
      }}
    />
  );
}

const styles = StyleSheet.create({
  // Screen layouts
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
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 100,
    paddingBottom: 60,
    alignItems: 'center',
  },
  recordingContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 34,
    paddingBottom: 42,
    alignItems: 'center',
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

  // General icons and typography
  largeIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
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
  processingIndicator: {
    marginTop: 28,
  },
  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 12,
  },

  // Instructions
  instructionCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
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
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  // Countdown and interval playback
  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
  },
  intervalPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginTop: 28,
  },
  intervalNote: {
    minWidth: 95,
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    paddingVertical: 17,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  intervalNoteLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
    letterSpacing: 0.5,
  },
  intervalNoteName: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    marginTop: 4,
  },
  intervalNameBadge: {
    backgroundColor: PINK,
    borderRadius: 15,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 18,
  },
  intervalNameText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
  },
  playingIndicator: {
    marginTop: 24,
  },
  repetitionBadge: {
    backgroundColor: PINK,
    borderRadius: 15,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 16,
  },
  repetitionBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  // Live pitch guide
  pitchGuideCard: {
    width: '100%',
    marginTop: 20,
    padding: 17,
    borderRadius: 24,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
  },
  pitchGuideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 9,
  },
  pitchGuideHeading: {
    flex: 1,
  },
  pitchGuideTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pitchGuideIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pitchGuideTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    letterSpacing: 0.4,
    color: BROWN,
  },
  pitchGuideSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: MUTED,
    marginTop: 7,
  },
  guideStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 8,
    maxWidth: '48%',
  },
  guideStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  guideStatusText: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  pitchTargetSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingHorizontal: 13,
    paddingVertical: 13,
    borderRadius: 17,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  pitchSummaryColumn: {
    flex: 1,
  },
  pitchTargetCaption: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.5,
    color: MUTED,
  },
  pitchTargetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 29,
    lineHeight: 35,
    color: BROWN,
    marginTop: 2,
  },
  pitchTargetFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 1,
  },
  pitchTargetDivider: {
    width: 1,
    height: 48,
    backgroundColor: BORDER,
    marginHorizontal: 13,
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
    marginTop: 23,
  },
  pitchMeterLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  pitchMeterEdgeLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    letterSpacing: 0.7,
    color: MUTED,
  },
  pitchMeterCenterLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color: GUIDE_GREEN,
  },
  pitchMeterTrack: {
    width: '100%',
    height: 20,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: WHITE,
    position: 'relative',
    borderWidth: 1,
    borderColor: BORDER,
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
    backgroundColor: WHITE,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(78, 47, 31, 0.2)',
    zIndex: 2,
  },
  pitchMeterTrace: {
    position: 'absolute',
    top: '50%',
    width: 5,
    height: 5,
    borderRadius: 3,
    marginLeft: -2.5,
    marginTop: -2.5,
    zIndex: 3,
  },
  pitchMeterMarker: {
    position: 'absolute',
    top: '50%',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    marginLeft: -12,
    marginTop: -12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    elevation: 3,
  },
  pitchMeterMarkerInner: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: WHITE,
  },
  pitchMeterScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  pitchMeterScaleText: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  pitchGuideFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 17,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  pitchDeviationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flex: 1,
  },
  pitchDeviationIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pitchDeviationTextGroup: {
    flex: 1,
  },
  pitchDeviationLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.5,
    color: MUTED,
  },
  pitchDeviationValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    marginTop: 3,
  },
  pitchAccuracyBadge: {
    minWidth: 66,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  pitchAccuracyBadgeLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    letterSpacing: 0.7,
    color: MUTED,
  },
  pitchAccuracyBadgeValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginTop: 1,
  },
  pitchGuideLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 15,
  },
  pitchLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pitchLegendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  pitchLegendText: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  
  // Interval progress
  intervalProgress: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  intervalProgressNote: {
    minWidth: 70,
    height: 70,
    borderRadius: 100,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  intervalProgressActive: {
    backgroundColor: PINK,
  },
  intervalProgressText: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: MUTED,
  },
  intervalProgressTextActive: {
    color: BROWN,
  },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: LIGHT_GRAY,
    marginHorizontal: 8,
  },

  // Recording
  recordingIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
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
    marginRight: 7,
  },
  recordingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  recordingBar: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 13,
  },
  recordingBarFill: {
    height: '100%',
    backgroundColor: GUIDE_GREEN,
    borderRadius: 3,
  },
  recordingProgressLabel: {
    alignSelf: 'flex-end',
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 6,
  },

  // Results
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
    color: MUTED,
    textAlign: 'center',
  },
  intervalResultCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
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
  intervalResultDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  intervalResultNote: {
    alignItems: 'center',
    minWidth: 72,
  },
  intervalResultLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  intervalResultNoteName: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
    marginTop: 3,
  },
  intervalArrow: {
    alignItems: 'center',
    minWidth: 70,
  },
  intervalArrowLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
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

  // Quit exercise modal — matches Note Matching
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(30, 18, 14, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  quitModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: WHITE,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 5,
    },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  quitIconCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  quitModalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
    textAlign: 'center',
  },
  quitModalMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 9,
    marginBottom: 22,
  },
  continueButton: {
    width: '100%',
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  continueButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
  },
  quitButton: {
    width: '100%',
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingHorizontal: 16,
  },
  quitButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: MUTED,
  },
  modalButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});