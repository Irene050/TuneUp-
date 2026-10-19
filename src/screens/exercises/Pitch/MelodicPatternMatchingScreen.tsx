import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  MELODIC_PATTERN_MATCHING_PARAMS,
  type MelodicPatternMatchingParams,
  type Tier,
} from '@/constants/exercises/pitch';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { measureMelodicPatternMatching } from '@/services/measurement/pitch/melodicPatternMatching';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
  scoreMelodicPatternMatchingRepetitions,
  type MelodicPatternScoreResult,
} from '@/services/scoring/pitch/melodicPatternMatching';
import { segmentIntoNotes } from '@/utils/dsp/pitch';
import { playSingleNote } from '@/utils/music/notePlayer';
import {
  createMusicalNote,
  getRandomPitchNote,
  type VocalRange,
} from '@/utils/music/notes';

import {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
  default as ExerciseScreen,
} from '@/screens/exercises/ExerciseScreen';

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

interface GeneratedPattern {
  notes: ReturnType<typeof createMusicalNote>[];
}

interface ResultRowProps {
  label: string;
  value: string;
  last?: boolean;
}

interface NoteChipProps {
  note: string;
  active?: boolean;
}

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const BORDER = '#F2DDE5';

const NOTE_DURATION_SEC = 0.7;
const NOTE_GAP_SEC = 0.12;
const RECORDING_BUFFER_SEC = 0.8;
const COUNTDOWN_SECONDS = 3;
const RECORDING_TIMER_INTERVAL_MS = 100;

function getRepetitionCount(
  params: MelodicPatternMatchingParams,
): number {
  return Math.max(1, Math.round(params.repetitions));
}

function getRecordingDurationSec(
  params: MelodicPatternMatchingParams,
): number {
  return (
    params.noteCount *
      (NOTE_DURATION_SEC + NOTE_GAP_SEC) +
    RECORDING_BUFFER_SEC
  );
}

function ResultRow({
  label,
  value,
  last = false,
}: ResultRowProps) {
  return (
    <View
      style={[
        styles.resultRow,
        last && styles.resultRowLast,
      ]}
    >
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={styles.resultValue}>{value}</Text>
    </View>
  );
}

function NoteChip({
  note,
  active = false,
}: NoteChipProps) {
  return (
    <View
      style={[
        styles.noteChip,
        active && styles.noteChipActive,
      ]}
    >
      <Text style={styles.noteChipText}>{note}</Text>
    </View>
  );
}

export default function MelodicPatternMatchingScreen({
  tier,
}: Props) {
  const [currentTier, setCurrentTier] =
    useState<Tier>(tier ?? 'beginner');

  const [params, setParams] =
    useState<MelodicPatternMatchingParams>(
      MELODIC_PATTERN_MATCHING_PARAMS[
        tier ?? 'beginner'
      ],
    );

  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);

  const [currentPattern, setCurrentPattern] =
    useState<GeneratedPattern | null>(null);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [recordingElapsedMs, setRecordingElapsedMs] =
    useState(0);

  const [currentRep, setCurrentRep] = useState(1);

  const [result, setResult] =
    useState<MelodicPatternScoreResult | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const [isQuitModalVisible, setIsQuitModalVisible] =
    useState(false);

  const [isStoppingForQuitModal, setIsStoppingForQuitModal] =
    useState(false);

  const mountedRef = useRef(true);
  const pausedRef = useRef(false);
  const playbackRunIdRef = useRef(0);

  const quitModalVisibleRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');
  const quittingRef = useRef(false);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingRef = useRef(false);
  const recordingStartInProgressRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const processingRef = useRef(false);
  const recordingElapsedRef = useRef(0);

  const stopRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const currentExerciseRef =
    useRef<GeneratedPattern | null>(null);

  const measurementsRef = useRef<
    ReturnType<typeof measureMelodicPatternMatching>[]
  >([]);

  const continueRepetitionRef = useRef(false);

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParams() {
      setIsLoadingAdaptiveParams(true);

      try {
        const { auth } = await import(
          '@/services/firebase/config'
        );

        const user = auth.currentUser;

        if (!user) {
          const fallbackTier = tier ?? 'beginner';

          if (!cancelled) {
            setCurrentTier(fallbackTier);
            setParams(
              MELODIC_PATTERN_MATCHING_PARAMS[
                fallbackTier
              ],
            );
          }

          return;
        }

        const progress = await fetchComponentProgress(
          user.uid,
          'pitch',
        );

        const resolvedTier: Tier =
          tier ??
          progress?.currentTier ??
          'beginner';

        if (cancelled) {
          return;
        }

        setCurrentTier(resolvedTier);

        const records = await fetchExerciseRecords(
          user.uid,
          'pitch',
        );

        if (cancelled) {
          return;
        }

        const recentExerciseScores = records
          .filter(
            record =>
              record.tier === resolvedTier &&
              record.templateId ===
                'melodicPatternMatching',
          )
          .sort(
            (a, b) => a.timestamp - b.timestamp,
          )
          .slice(-5)
          .map(record => record.scorePct);

        const assessment = await getLatestAssessment();

        if (cancelled) {
          return;
        }

        setVocalRange(assessment?.vocalRange ?? null);

        let recentScores = recentExerciseScores;

        if (recentScores.length === 0) {
          const pitchScore = assessment?.scores.find(
            score => score.componentId === 'pitch',
          );

          if (pitchScore) {
            recentScores = [pitchScore.scorePct];
          }
        }

        const {
          generateMelodicPatternMatchingParams,
        } = await import(
          '@/services/adaptiveDifficultyScaling/parameterGenerator'
        );

        const generatedParams =
          await generateMelodicPatternMatchingParams({
            tier: resolvedTier,
            recentScores,
          });

        if (!cancelled) {
          setParams(generatedParams);
        }
      } catch (error) {
        console.error(
          'Failed to load melodic pattern matching ADS parameters:',
          error,
        );

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';

          setCurrentTier(fallbackTier);
          setParams(
            MELODIC_PATTERN_MATCHING_PARAMS[
              fallbackTier
            ],
          );
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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      playbackRunIdRef.current += 1;
      quitModalVisibleRef.current = false;

      clearCountdownTimer();
      clearRecordingTimer();

      discardRecordingRef.current = true;
      continueRepetitionRef.current = false;

      if (
        recordingRef.current ||
        recordingStartInProgressRef.current
      ) {
        stopRequestedRef.current = true;

        void stopRecordingRef.current?.().catch(error => {
          console.error(
            'Failed to stop recording during cleanup:',
            error,
          );
        });
      }
    };
  }, [clearCountdownTimer, clearRecordingTimer]);

  const handleLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitModalVisibleRef.current ||
        quittingRef.current ||
        !recordingRef.current
      ) {
        return;
      }

      setLiveFrame(frame);
    },
    [],
  );

  const handleRecordingStop = useCallback(
    async (
      samples: Float32Array,
      sampleRate: number,
    ) => {
      recordingRef.current = false;
      clearRecordingTimer();

      // Discard interrupted audio instead of scoring an incomplete repetition.
      if (discardRecordingRef.current) {
        discardRecordingRef.current = false;
        stopRequestedRef.current = false;
        processingRef.current = false;
        return;
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitModalVisibleRef.current ||
        quittingRef.current ||
        processingRef.current
      ) {
        return;
      }

      const pattern = currentExerciseRef.current;

      if (!pattern) {
        processingRef.current = false;

        if (
          mountedRef.current &&
          !pausedRef.current
        ) {
          setErrorMessage(
            'The reference melody was not available. Please try again.',
          );
          setPhase('instructions');
        }

        return;
      }

      processingRef.current = true;

      try {
        const targetFreqs = pattern.notes.map(
          note => note.frequency,
        );

        const segmentDurationSec =
          NOTE_DURATION_SEC + NOTE_GAP_SEC;

        const targetTimestamps = pattern.notes.map(
          (_, index) => index * segmentDurationSec,
        );

        const segments = segmentIntoNotes(
          samples,
          pattern.notes.length,
          0.01,
          sampleRate,
        );

        const measurement =
          measureMelodicPatternMatching(
            segments,
            sampleRate,
            targetTimestamps,
            params.minClarity,
          );

        measurementsRef.current.push(measurement);

        const repetitionCount = getRepetitionCount(params);
        const completedRepetitions =
          measurementsRef.current.length;

        if (completedRepetitions < repetitionCount) {
          setCurrentRep(completedRepetitions + 1);
          setLiveFrame(null);

          recordingElapsedRef.current = 0;
          setRecordingElapsedMs(0);

          stopRequestedRef.current = false;
          discardRecordingRef.current = false;
          processingRef.current = false;
          continueRepetitionRef.current = true;

          setPhase('playing');
          return;
        }

        setPhase('processing');

        const score =
          scoreMelodicPatternMatchingRepetitions(
            measurementsRef.current,
            targetFreqs,
            targetTimestamps,
            params,
          );

        const { auth } = await import(
          '@/services/firebase/config'
        );

        const user = auth.currentUser;

        if (user) {
          await saveCompletedExercise(
            'pitch',
            'melodicPatternMatching',
            currentTier,
            score.score,
          );
        }

        if (
          !mountedRef.current ||
          quittingRef.current
        ) {
          return;
        }

        setResult(score);
        setPhase('results');
      } catch (error) {
        console.error(
          'Melodic pattern matching processing failed:',
          error,
        );

        if (!mountedRef.current) {
          return;
        }

        setErrorMessage(
          'Something went wrong while analyzing your recording. Please try again.',
        );

        setPhase('instructions');
      } finally {
        processingRef.current = false;
        stopRequestedRef.current = false;
      }
    },
    [
      clearRecordingTimer,
      currentTier,
      params,
    ],
  );

  const {
    startRecording,
    stopRecording,
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
      quitModalVisibleRef.current ||
      quittingRef.current ||
      recordingRef.current ||
      recordingStartInProgressRef.current ||
      processingRef.current
    ) {
      return;
    }

    recordingStartInProgressRef.current = true;

    try {
      discardRecordingRef.current = false;
      stopRequestedRef.current = false;

      recordingElapsedRef.current = 0;
      setRecordingElapsedMs(0);
      setLiveFrame(null);

      await startRecording();

      // If the quit modal opened during startup, stop and discard this recording.
      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitModalVisibleRef.current ||
        quittingRef.current
      ) {
        discardRecordingRef.current = true;
        stopRequestedRef.current = true;

        try {
          await stopRecording();
        } catch (error) {
          console.error(
            'Failed to stop recording after interruption:',
            error,
          );
        } finally {
          recordingStartInProgressRef.current = false;
          recordingRef.current = false;
          stopRequestedRef.current = false;

          if (
            mountedRef.current &&
            quitModalVisibleRef.current
          ) {
            setIsStoppingForQuitModal(false);
          }
        }

        return;
      }

      recordingStartInProgressRef.current = false;
      recordingRef.current = true;

      setPhase('recording');

      const recordingDurationMs =
        getRecordingDurationSec(params) * 1000;

      clearRecordingTimer();

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          quitModalVisibleRef.current ||
          quittingRef.current ||
          !recordingRef.current ||
          stopRequestedRef.current
        ) {
          return;
        }

        recordingElapsedRef.current +=
          RECORDING_TIMER_INTERVAL_MS;

        const elapsed = recordingElapsedRef.current;

        setRecordingElapsedMs(elapsed);

        if (elapsed >= recordingDurationMs) {
          clearRecordingTimer();

          if (
            !recordingRef.current ||
            stopRequestedRef.current
          ) {
            return;
          }

          stopRequestedRef.current = true;

          stopRecording().catch(error => {
            console.error(
              'Failed to stop melodic pattern recording:',
              error,
            );

            recordingRef.current = false;
            stopRequestedRef.current = false;
            processingRef.current = false;

            if (
              mountedRef.current &&
              !pausedRef.current &&
              !quittingRef.current
            ) {
              setErrorMessage(
                'We could not finish the recording. Please try again.',
              );
              setPhase('instructions');
            }
          });
        }
      }, RECORDING_TIMER_INTERVAL_MS);
    } catch (error) {
      console.error(
        'Failed to start melodic pattern recording:',
        error,
      );

      recordingStartInProgressRef.current = false;
      recordingRef.current = false;
      stopRequestedRef.current = false;
      discardRecordingRef.current = false;
      processingRef.current = false;

      clearRecordingTimer();

      if (
        mountedRef.current &&
        quitModalVisibleRef.current
      ) {
        setIsStoppingForQuitModal(false);
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        quittingRef.current
      ) {
        return;
      }

      setErrorMessage(
        'Unable to start microphone recording. Please check your microphone permission and try again.',
      );
      setPhase('instructions');
    }
  }, [
    clearRecordingTimer,
    params,
    startRecording,
    stopRecording,
  ]);

  const playPatternAndRecord = useCallback(
    async (pattern: GeneratedPattern) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitModalVisibleRef.current ||
        quittingRef.current
      ) {
        return;
      }

      const runId = ++playbackRunIdRef.current;

      const playbackWasInterrupted = () =>
        !mountedRef.current ||
        pausedRef.current ||
        quitModalVisibleRef.current ||
        quittingRef.current ||
        runId !== playbackRunIdRef.current;

      try {
        setPhase('playing');

        for (
          let index = 0;
          index < pattern.notes.length;
          index++
        ) {
          if (playbackWasInterrupted()) {
            return;
          }

          await playSingleNote(
            pattern.notes[index].frequency,
            NOTE_DURATION_SEC,
          );

          if (playbackWasInterrupted()) {
            return;
          }

          if (index < pattern.notes.length - 1) {
            await new Promise<void>(resolve => {
              setTimeout(
                resolve,
                NOTE_GAP_SEC * 1000,
              );
            });

            if (playbackWasInterrupted()) {
              return;
            }
          }
        }

        if (playbackWasInterrupted()) {
          return;
        }

        await beginRecording();
      } catch (error) {
        console.error(
          'Failed to play melodic pattern:',
          error,
        );

        if (playbackWasInterrupted()) {
          return;
        }

        recordingRef.current = false;
        stopRequestedRef.current = false;

        setErrorMessage(
          'Unable to play the reference melody. Please try again.',
        );

        setPhase('instructions');
      }
    },
    [beginRecording],
  );

  useEffect(() => {
    if (!continueRepetitionRef.current) {
      return;
    }

    continueRepetitionRef.current = false;

    const pattern = currentExerciseRef.current;

    if (
      !pattern ||
      !mountedRef.current ||
      pausedRef.current ||
      quitModalVisibleRef.current ||
      quittingRef.current
    ) {
      return;
    }

    void playPatternAndRecord(pattern);
  }, [currentRep, playPatternAndRecord]);

  const generatePattern = useCallback((): GeneratedPattern => {
    const notes: ReturnType<typeof createMusicalNote>[] = [];

    for (
      let index = 0;
      index < params.noteCount;
      index++
    ) {
      let note = getRandomPitchNote(
        currentTier,
        vocalRange,
      );

      if (
        notes.length > 0 &&
        note.frequency ===
          notes[notes.length - 1].frequency
      ) {
        let attempts = 0;

        while (
          note.frequency ===
            notes[notes.length - 1].frequency &&
          attempts < 5
        ) {
          note = getRandomPitchNote(
            currentTier,
            vocalRange,
          );

          attempts++;
        }
      }

      notes.push(note);
    }

    return { notes };
  }, [
    currentTier,
    params.noteCount,
    vocalRange,
  ]);

  const startCountdown = useCallback(() => {
    if (
      isLoadingAdaptiveParams ||
      !mountedRef.current ||
      pausedRef.current ||
      quitModalVisibleRef.current ||
      quittingRef.current ||
      recordingRef.current ||
      recordingStartInProgressRef.current ||
      processingRef.current
    ) {
      return;
    }

    clearCountdownTimer();
    clearRecordingTimer();

    const generated = generatePattern();

    currentExerciseRef.current = generated;
    setCurrentPattern(generated);

    measurementsRef.current = [];
    continueRepetitionRef.current = false;

    setCurrentRep(1);
    setResult(null);
    setErrorMessage(null);
    setLiveFrame(null);

    recordingElapsedRef.current = 0;
    setRecordingElapsedMs(0);

    recordingRef.current = false;
    stopRequestedRef.current = false;
    discardRecordingRef.current = false;
    processingRef.current = false;

    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');

    let remaining = COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitModalVisibleRef.current ||
        quittingRef.current
      ) {
        clearCountdownTimer();
        return;
      }

      remaining -= 1;

      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }

      clearCountdownTimer();
      void playPatternAndRecord(generated);
    }, 1000);
  }, [
    clearCountdownTimer,
    clearRecordingTimer,
    generatePattern,
    isLoadingAdaptiveParams,
    playPatternAndRecord,
  ]);

  const resumeCurrentRepetition = useCallback(() => {
    const pattern = currentExerciseRef.current;

    if (
      !pattern ||
      !mountedRef.current ||
      recordingStartInProgressRef.current ||
      quittingRef.current
    ) {
      return;
    }

    clearCountdownTimer();
    clearRecordingTimer();

    recordingRef.current = false;
    stopRequestedRef.current = false;
    processingRef.current = false;
    continueRepetitionRef.current = false;

    // Restart the interrupted repetition while retaining completed measurements.
    recordingElapsedRef.current = 0;
    setRecordingElapsedMs(0);
    setLiveFrame(null);
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');

    let remaining = COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitModalVisibleRef.current ||
        quittingRef.current
      ) {
        clearCountdownTimer();
        return;
      }

      remaining -= 1;

      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }

      clearCountdownTimer();

      if (
        !pausedRef.current &&
        !quitModalVisibleRef.current &&
        !quittingRef.current
      ) {
        void playPatternAndRecord(pattern);
      }
    }, 1000);
  }, [
    clearCountdownTimer,
    clearRecordingTimer,
    playPatternAndRecord,
  ]);

  const openQuitModal = useCallback(async () => {
    if (
      !mountedRef.current ||
      quittingRef.current ||
      quitModalVisibleRef.current
    ) {
      return;
    }

    // Avoid interrupting the final scoring/save operation.
    if (processingRef.current) {
      return;
    }

    pausedPhaseRef.current = phase;
    pausedRef.current = true;
    playbackRunIdRef.current += 1;
    quitModalVisibleRef.current = true;

    clearCountdownTimer();
    clearRecordingTimer();

    setIsQuitModalVisible(true);

    const recorderIsStarting =
      recordingStartInProgressRef.current;

    const recordingNeedsStopping =
      recordingRef.current || recorderIsStarting;

    setIsStoppingForQuitModal(recordingNeedsStopping);

    // beginRecording will stop the recorder once startup completes.
    if (recorderIsStarting && !recordingRef.current) {
      return;
    }

    if (!recordingRef.current) {
      return;
    }

    discardRecordingRef.current = true;
    stopRequestedRef.current = true;

    try {
      await stopRecording();
    } catch (error) {
      console.error(
        'Failed to stop recording while opening the quit modal:',
        error,
      );
    } finally {
      recordingRef.current = false;
      stopRequestedRef.current = false;
      processingRef.current = false;

      if (mountedRef.current) {
        setIsStoppingForQuitModal(false);
      }
    }
  }, [
    clearCountdownTimer,
    clearRecordingTimer,
    phase,
    stopRecording,
  ]);

  const continueExercise = useCallback(() => {
    if (
      isStoppingForQuitModal ||
      !quitModalVisibleRef.current ||
      !mountedRef.current ||
      quittingRef.current
    ) {
      return;
    }

    const interruptedPhase = pausedPhaseRef.current;

    quitModalVisibleRef.current = false;
    setIsQuitModalVisible(false);
    pausedRef.current = false;

    // Preparing or instructions: stay on the current screen.
    if (interruptedPhase === 'instructions') {
      return;
    }

    // Results are already complete; simply dismiss the modal.
    if (interruptedPhase === 'results') {
      return;
    }

    // Restart the interrupted repetition from its countdown.
    // Previously completed repetitions remain in measurementsRef.
    resumeCurrentRepetition();
  }, [
    isStoppingForQuitModal,
    resumeCurrentRepetition,
  ]);

  const quitExercise = useCallback(async () => {
    if (quittingRef.current) {
      return;
    }

    quittingRef.current = true;
    pausedRef.current = true;
    playbackRunIdRef.current += 1;
    quitModalVisibleRef.current = false;

    setIsStoppingForQuitModal(true);
    setIsQuitModalVisible(false);

    clearCountdownTimer();
    clearRecordingTimer();

    continueRepetitionRef.current = false;
    discardRecordingRef.current = true;

    if (
      recordingRef.current ||
      recordingStartInProgressRef.current
    ) {
      stopRequestedRef.current = true;

      try {
        await stopRecordingRef.current?.();
      } catch (error) {
        console.error(
          'Failed to stop recording before exiting:',
          error,
        );
      }
    }

    recordingStartInProgressRef.current = false;
    recordingRef.current = false;
    stopRequestedRef.current = false;
    processingRef.current = false;

    router.replace('/dashboard?tab=exercises');
  }, [
    clearCountdownTimer,
    clearRecordingTimer,
  ]);

  const retry = useCallback(async () => {
    pausedRef.current = true;
    playbackRunIdRef.current += 1;

    quitModalVisibleRef.current = false;
    setIsQuitModalVisible(false);

    clearCountdownTimer();
    clearRecordingTimer();

    continueRepetitionRef.current = false;
    discardRecordingRef.current = true;

    if (
      recordingRef.current ||
      recordingStartInProgressRef.current
    ) {
      stopRequestedRef.current = true;

      try {
        await stopRecordingRef.current?.();
      } catch (error) {
        console.error(
          'Failed to stop recording during retry:',
          error,
        );
      }
    }

    if (!mountedRef.current) {
      return;
    }

    measurementsRef.current = [];
    currentExerciseRef.current = null;

    setCurrentRep(1);
    setCurrentPattern(null);
    setResult(null);
    setLiveFrame(null);

    recordingElapsedRef.current = 0;
    setRecordingElapsedMs(0);

    recordingStartInProgressRef.current = false;
    recordingRef.current = false;
    stopRequestedRef.current = false;
    discardRecordingRef.current = false;
    processingRef.current = false;
    quittingRef.current = false;
    pausedRef.current = false;

    setIsStoppingForQuitModal(false);
    setErrorMessage(null);
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('instructions');
  }, [
    clearCountdownTimer,
    clearRecordingTimer,
  ]);

  const handleBack = useCallback(() => {
    void openQuitModal();
  }, [openQuitModal]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (quitModalVisibleRef.current) {
          return true;
        }

        void openQuitModal();
        return true;
      },
    );

    return () => subscription.remove();
  }, [openQuitModal]);

  const goToExercises = useCallback(() => {
    router.replace('/dashboard?tab=exercises');
  }, []);

  const repetitionCount = getRepetitionCount(params);

  const currentNoteIndex = Math.min(
    Math.floor(
      recordingElapsedMs /
        ((NOTE_DURATION_SEC + NOTE_GAP_SEC) * 1000),
    ),
    Math.max(
      0,
      (currentPattern?.notes.length ?? 1) - 1,
    ),
  );

  const currentTargetNote =
    currentPattern?.notes[currentNoteIndex] ?? null;

  const quitModalMessage =
    pausedPhaseRef.current === 'instructions'
      ? 'Are you sure you want to leave Melodic Pattern Matching?'
      : pausedPhaseRef.current === 'results'
        ? 'You have completed this exercise. Are you sure you want to leave?'
        : pausedPhaseRef.current === 'recording'
          ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
          : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.';

  // Keep the quit modal mounted throughout every screen phase,
  // including the adaptive-parameter preparation screen.
  const quitExerciseModal = (
    <Modal
      visible={isQuitModalVisible}
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
            Quit exercise?
          </Text>

          <Text style={styles.modalMessage}>
            {quitModalMessage}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            disabled={isStoppingForQuitModal}
            onPress={continueExercise}
            style={({ pressed }) => [
              styles.continueButton,
              pressed &&
                !isStoppingForQuitModal &&
                styles.buttonPressed,
              isStoppingForQuitModal &&
                styles.buttonDisabled,
            ]}
          >
            {isStoppingForQuitModal ? (
              <ActivityIndicator
                size="small"
                color={BROWN}
              />
            ) : (
              <Text style={styles.continueButtonText}>
                Continue Exercise
              </Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
            disabled={isStoppingForQuitModal}
            onPress={() => {
              void quitExercise();
            }}
            style={({ pressed }) => [
              styles.quitButton,
              pressed &&
                !isStoppingForQuitModal &&
                styles.buttonPressed,
              isStoppingForQuitModal &&
                styles.buttonDisabled,
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

  let screenContent: ReactNode;

  if (
    phase === 'instructions' &&
    isLoadingAdaptiveParams
  ) {
    screenContent = (
      <View style={styles.centerScreen}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quit exercise"
          onPress={handleBack}
          style={styles.quitButtonTop}
        >
          <Ionicons
            name="exit-outline"
            size={22}
            color={BROWN}
          />
        </Pressable>

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
          Adjusting the exercise to your current
          difficulty level
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  } else if (phase === 'instructions') {
    screenContent = (
      <View style={styles.screenWrapper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quit exercise"
          onPress={handleBack}
          style={styles.quitButtonTop}
        >
          <Ionicons
            name="exit-outline"
            size={22}
            color={BROWN}
          />
        </Pressable>

        <ExerciseScreen
          title="Melodic Pattern Matching"
          category="Pitch"
          icon="musical-notes-outline"
          instructions="Listen carefully to the reference melody, then sing the same notes in the same order. The pattern will be repeated several times to evaluate your consistency."
          preparationSteps={[
            {
              icon: 'volume-medium-outline',
              text: 'Listen carefully to the complete reference melody before singing.',
            },
            {
              icon: 'mic-outline',
              text: 'Position yourself close enough to the microphone for clear pitch detection.',
            },
            {
              icon: 'musical-note-outline',
              text: 'Match each note as accurately as possible while keeping the correct order.',
            },
          ]}
          summary={[
            {
              label: 'PATTERN',
              value: `${params.noteCount} notes`,
              hint: 'melodic sequence',
            },
            {
              label: 'TOLERANCE',
              value: `±${params.tolerancePct}%`,
              hint: 'pitch deviation',
            },
            {
              label: 'REPETITIONS',
              value: String(repetitionCount),
              hint: 'attempts',
            },
          ]}
          tip="Focus on accurate note transitions rather than singing loudly. The same reference melody is played before each repetition."
          tier={currentTier}
          onBack={handleBack}
          onStart={startCountdown}
          error={errorMessage}
          startDisabled={isLoadingAdaptiveParams}
          startLabel={
            isLoadingAdaptiveParams
              ? 'Preparing...'
              : 'Start Exercise'
          }
        />
      </View>
    );
  } else if (phase === 'countdown') {
    screenContent = (
      <ExerciseCountdownScreen
        icon="musical-notes-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={repetitionCount}
        countdown={countdown}
        promptTitle="Listen carefully"
        prompt="You will hear the reference melody before singing it."
        onBack={handleBack}
      />
    );
  } else if (phase === 'playing') {
    screenContent = (
      <View style={styles.playbackScreen}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quit exercise"
          onPress={handleBack}
          style={styles.quitButtonTop}
        >
          <Ionicons
            name="exit-outline"
            size={22}
            color={BROWN}
          />
        </Pressable>

        <View style={styles.playbackIconCircle}>
          <Ionicons
            name="musical-notes-outline"
            size={44}
            color={BROWN}
          />
        </View>

        <Text style={styles.playbackTitle}>
          Listen to the Pattern
        </Text>

        <Text style={styles.playbackSubtitle}>
          Repetition {currentRep} of {repetitionCount}
        </Text>

        <Text style={styles.playbackDescription}>
          Remember the notes and their order.
        </Text>

        <View style={styles.noteList}>
          {currentPattern?.notes.map((note, index) => (
            <NoteChip
              key={`${note.name}-${index}`}
              note={note.name}
            />
          ))}
        </View>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.playbackSpinner}
        />
      </View>
    );
  } else if (phase === 'recording') {
    const targetDuration =
      getRecordingDurationSec(params);

    const elapsed = recordingElapsedMs / 1000;

    const progress = Math.min(
      100,
      Math.max(0, (elapsed / targetDuration) * 100),
    );

    const hasValidPitch =
      typeof liveFrame?.pitch === 'number' &&
      Number.isFinite(liveFrame.pitch) &&
      liveFrame.pitch > 0;

    screenContent = (
      <View style={styles.listeningScreenContainer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quit exercise"
          onPress={handleBack}
          style={styles.quitButtonTop}
        >
          <Ionicons
            name="exit-outline"
            size={22}
            color={BROWN}
          />
        </Pressable>

        <ExerciseListeningScreen
          icon="mic-outline"
          title="Melodic Pattern Matching"
          currentRep={currentRep}
          repetitions={repetitionCount}
          elapsed={elapsed}
          targetDuration={targetDuration}
          promptTitle="Your Turn"
          prompt="Match each note in the same order as the reference melody."
          liveContent={
            <View style={styles.liveContent}>
              <View style={styles.liveNoteContainer}>
                <Text style={styles.liveNote}>
                  {hasValidPitch
                    ? liveFrame?.note ?? '--'
                    : '--'}
                </Text>

                <Text style={styles.liveFrequency}>
                  {hasValidPitch
                    ? `${Math.round(liveFrame!.pitch)} Hz`
                    : '-- Hz'}
                </Text>
              </View>

              <View style={styles.liveStatsRow}>
                <View style={styles.liveStat}>
                  <Text style={styles.statLabel}>
                    TARGET
                  </Text>

                  <Text style={styles.statValue}>
                    {currentTargetNote?.name ?? '--'}
                  </Text>
                </View>

                <View style={styles.liveStat}>
                  <Text style={styles.statLabel}>
                    YOUR NOTE
                  </Text>

                  <Text style={styles.statValue}>
                    {hasValidPitch
                      ? liveFrame?.note ?? '--'
                      : '--'}
                  </Text>
                </View>

                <View style={styles.liveStat}>
                  <Text style={styles.statLabel}>
                    NOTE
                  </Text>

                  <Text style={styles.statValue}>
                    {Math.min(
                      currentNoteIndex + 1,
                      params.noteCount,
                    )}
                    /{params.noteCount}
                  </Text>
                </View>
              </View>

              <View style={styles.recordingNoteList}>
                {currentPattern?.notes.map(
                  (note, index) => (
                    <NoteChip
                      key={`${note.name}-${index}`}
                      note={note.name}
                      active={index === currentNoteIndex}
                    />
                  ),
                )}
              </View>
            </View>
          }
          progress={progress}
          onBack={handleBack}
        />
      </View>
    );
  } else if (phase === 'processing') {
    screenContent = (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your Singing"
        message="Checking your pitch accuracy and melodic timing across all repetitions."
        onBack={handleBack}
      />
    );
  } else if (phase === 'results' && result) {
    screenContent = (
      <View style={styles.screenWrapper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quit exercise"
          onPress={handleBack}
          style={styles.quitButtonTop}
        >
          <Ionicons
            name="exit-outline"
            size={22}
            color={BROWN}
          />
        </Pressable>

        <ExerciseResultsScreen
          title={
            result.passed
              ? 'Great Job!'
              : 'Keep Practicing!'
          }
          subtitle={
            result.passed
              ? 'You completed all repetitions successfully.'
              : 'Review your results and try again to improve your accuracy.'
          }
          score={result.score}
          resultIcon={
            result.passed
              ? 'checkmark'
              : 'refresh-outline'
          }
          scoreDetails={
            <View style={styles.scoreDetails}>
              <ResultRow
                label="Repetitions completed"
                value={`${result.repetitionsCompleted}/${repetitionCount}`}
                last
              />
            </View>
          }
          scoreMessage={
            result.passed
              ? 'Your repetitions were consistently accurate.'
              : 'Focus on pitch accuracy and keeping the melodic sequence consistent.'
          }
          onRetry={retry}
          onExit={handleBack}
        >
          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>
              Pattern Results
            </Text>

            <ResultRow
              label="Pattern length"
              value={`${params.noteCount} notes`}
            />

            <ResultRow
              label="Pattern accuracy"
              value={`${Math.round(result.patternAccuracy)}%`}
            />

            <ResultRow
              label="Rhythm accuracy"
              value={`${Math.round(result.rhythmAccuracy)}%`}
              last
            />
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>
              Repetition Scores
            </Text>

            {result.repetitionScores.map((score, index) => (
              <ResultRow
                key={`repetition-${index}`}
                label={`Repetition ${index + 1}`}
                value={`${score}%`}
                last={
                  index === result.repetitionScores.length - 1
                }
              />
            ))}
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>
              Note Results
            </Text>

            {result.noteAccuracies.map((accuracy, index) => (
              <ResultRow
                key={`note-${index}`}
                label={`Note ${index + 1}`}
                value={`${Math.round(accuracy)}%`}
                last={
                  index === result.noteAccuracies.length - 1
                }
              />
            ))}
          </View>

          <View style={styles.targetPatternCard}>
            <Text style={styles.resultCardTitle}>
              Target Pattern
            </Text>

            <View style={styles.targetNoteList}>
              {currentPattern?.notes.map((note, index) => (
                <NoteChip
                  key={`${note.name}-${index}`}
                  note={note.name}
                />
              ))}
            </View>
          </View>

          <View style={styles.tipContainer}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text style={styles.tipText}>
              Focus on keeping each note accurate and
              maintaining the same melodic order
              throughout every repetition.
            </Text>
          </View>
        </ExerciseResultsScreen>
      </View>
    );
  } else {
    screenContent = <View style={styles.centerScreen} />;
  }

  return (
    <>
      {screenContent}
      {quitExerciseModal}
    </>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: WHITE,
  },
  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingVertical: 24,
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
  playbackScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  playbackIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  playbackTitle: {
    color: BROWN,
    fontSize: 26,
    fontFamily: 'FredokaBold',
    textAlign: 'center',
  },
  playbackSubtitle: {
    color: MUTED,
    fontSize: 15,
    fontFamily: 'FredokaRegular',
    textAlign: 'center',
    marginTop: 6,
  },
  playbackDescription: {
    color: MUTED,
    fontSize: 14,
    fontFamily: 'FredokaRegular',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 320,
  },
  noteList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 26,
  },
  playbackSpinner: {
    marginTop: 28,
  },
  noteChip: {
    minWidth: 48,
    height: 42,
    borderRadius: 21,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  noteChipActive: {
    backgroundColor: PINK,
    borderColor: PINK,
  },
  noteChipText: {
    color: BROWN,
    fontSize: 14,
    fontFamily: 'FredokaSemiBold',
  },
  liveContent: {
    width: '100%',
    alignItems: 'stretch',
  },
  liveNoteContainer: {
    alignItems: 'center',
    marginBottom: 18,
  },
  liveNote: {
    color: BROWN,
    fontSize: 40,
    fontFamily: 'FredokaBold',
  },
  liveFrequency: {
    color: MUTED,
    fontSize: 13,
    fontFamily: 'FredokaRegular',
    marginTop: 3,
  },
  liveStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 14,
  },
  liveStat: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  statLabel: {
    color: MUTED,
    fontSize: 11,
    fontFamily: 'FredokaRegular',
    textAlign: 'center',
  },
  statValue: {
    color: BROWN,
    fontSize: 14,
    fontFamily: 'FredokaSemiBold',
    marginTop: 3,
    textAlign: 'center',
  },
  recordingNoteList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
  },
  resultCard: {
    width: '100%',
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 17,
    marginBottom: 14,
  },
  targetPatternCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 17,
    marginBottom: 14,
  },
  resultCardTitle: {
    color: BROWN,
    fontSize: 17,
    fontFamily: 'FredokaBold',
    marginBottom: 8,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  resultRowLast: {
    borderBottomWidth: 0,
  },
  resultLabel: {
    flex: 1,
    color: MUTED,
    fontSize: 13,
    fontFamily: 'FredokaRegular',
  },
  resultValue: {
    color: BROWN,
    fontSize: 14,
    fontFamily: 'FredokaSemiBold',
    textAlign: 'right',
  },
  scoreDetails: {
    width: '100%',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  targetNoteList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  tipContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: LIGHT_PINK,
    borderRadius: 16,
    padding: 15,
    marginBottom: 4,
  },
  tipText: {
    flex: 1,
    color: BROWN,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'FredokaRegular',
    marginLeft: 10,
  },
  quitButtonTop: {
    position: 'absolute',
    top: 52,
    right: 22,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listeningScreenContainer: {
    flex: 1,
    backgroundColor: WHITE,
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