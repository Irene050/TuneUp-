import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MELODIC_PATTERN_MATCHING_PARAMS, type MelodicPatternMatchingParams, type Tier } from '@/constants/params';
import { useAudioRecorder, type LiveAudioFrame } from '@/hooks/useAudioRecorder';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { measureMelodicPatternMatching } from '@/services/measurement/pitch/melodicPatternMatching';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreMelodicPatternMatchingRepetitions, type MelodicPatternScoreResult } from '@/services/scoring/pitch/melodicPatternMatching';
import { segmentIntoNotes } from '@/utils/dsp/pitch';
import { clamp } from '@/utils/math';
import { playSingleNote } from '@/utils/music/notePlayer';
import { createMusicalNote, getRandomPitchNote, type VocalRange } from '@/utils/music/notes';
import { ExerciseCountdownScreen, ExerciseListeningScreen, ExercisePreparingScreen, ExerciseProcessingScreen, ExerciseResultsScreen, default as ExerciseScreen } from '@/screens/exercises/ExerciseScreen';
import { COLORS, EXERCISE_COUNTDOWN_SECONDS, EXERCISE_RECORDING_BUFFER_SECONDS } from '@/constants/appConstants';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { LivePitchIndicator as ExerciseLivePitchIndicator } from '@/screens/exercises/Pitch/LivePitchIndicator';
import { ExerciseNoAudioModal, ExerciseQuitModal } from '@/components/exercises/ExerciseModals';
import { usePhaseState } from '@/hooks/usePhaseState';

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
  size?: number;
}



const NOTE_DURATION_SECONDS = 0.7;
const NOTE_GAP_SECONDS = 0.12;
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
      (NOTE_DURATION_SECONDS + NOTE_GAP_SECONDS) +
    EXERCISE_RECORDING_BUFFER_SECONDS
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
        exerciseStyles.resultRowVariant1,
        last && exerciseStyles.metricRowLast,
      ]}
    >
      <Text style={exerciseStyles.resultLabelVariant1}>{label}</Text>
      <Text style={exerciseStyles.resultValueVariant2}>{value}</Text>
    </View>
  );
}

function NoteChip({
  note,
  active = false,
  size = 60,
}: NoteChipProps) {
  const fontSize =
    size >= 60 ? 18 :
    size >= 54 ? 16 :
    14;

  return (
    <View
      style={[
        exerciseStyles.noteChip,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        active && exerciseStyles.resultIconPassed,
      ]}
    >
      <Text
        style={[
          exerciseStyles.noteChipText,
          { fontSize },
          active && exerciseStyles.periodTextActive,
        ]}
      >
        {note}
      </Text>
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
      MELODIC_PATTERN_MATCHING_PARAMS[tier ?? 'beginner'],
    );

  const [isLoadingParams, setIsLoadingParams] =
    useState(true);

  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  const { phase, setPhase } = usePhaseState<Phase>('instructions');
  const [isInitialListening, setIsInitialListening] = useState(false);
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);

  const [currentPattern, setCurrentPattern] =
    useState<GeneratedPattern | null>(null);

  const [liveAudioFrame, setLiveAudioFrame] =
    useState<LiveAudioFrame | null>(null);

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [currentRep, setCurrentRep] = useState(1);

  const [result, setResult] =
    useState<MelodicPatternScoreResult | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const [showQuitModal, setShowQuitModal] =
    useState(false);
  const [showNoAudioModal, setShowNoAudioModal] =
    useState(false);

  const [isStoppingForQuitModal, setIsStoppingForQuitModal] =
    useState(false);

  const mountedRef = useRef(true);
  const pausedRef = useRef(false);
  const playbackRunIdRef = useRef(0);

  const showQuitModalRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');
  const quitInProgressRef = useRef(false);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const isRecordingRef = useRef(false);
  const recordingStartInProgressRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);
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
      setIsLoadingParams(true);

      try {
        const { auth } = await import('@/services/firebase/config');
        const user = auth.currentUser;

        if (!user) {
          const fallbackTier = tier ?? 'beginner';

          if (!cancelled) {
            setCurrentTier(fallbackTier);
            setParams(
              MELODIC_PATTERN_MATCHING_PARAMS[fallbackTier],
            );
          }

          return;
        }

        const progress = await fetchComponentProgress(
          user.uid,
          'pitch',
        );

        const resolvedTier: Tier =
          tier ?? progress?.currentTier ?? 'beginner';

        if (cancelled) return;

        setCurrentTier(resolvedTier);

        const records = await fetchExerciseRecords(
          user.uid,
          'pitch',
        );

        if (cancelled) return;

        const recentExerciseScores = records
          .filter(
            record =>
              record.tier === resolvedTier &&
              record.templateId === 'melodicPatternMatching',
          )
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-5)
          .map(record => record.scorePct);

        const assessment = await getLatestAssessment();

        if (cancelled) return;

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
      } catch (errorMessage) {
        console.error(
          'Failed to load melodic pattern matching ADS parameters:',
          errorMessage,
        );

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';
          setCurrentTier(fallbackTier);
          setParams(
            MELODIC_PATTERN_MATCHING_PARAMS[fallbackTier],
          );
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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      playbackRunIdRef.current += 1;
      showQuitModalRef.current = false;

      clearCountdownTimer();
      clearRecordingTimer();

      discardRecordingRef.current = true;
      continueRepetitionRef.current = false;

      if (
        isRecordingRef.current ||
        recordingStartInProgressRef.current
      ) {
        recordingStopRequestedRef.current = true;

        void stopRecordingRef.current?.().catch(errorMessage => {
          console.error(
            'Failed to stop recording during cleanup:',
            errorMessage,
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
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        !isRecordingRef.current
      ) {
        return;
      }

      setLiveAudioFrame(frame);
    },
    [],
  );

  const handleRecordingStop = useCallback(
    async (
      samples: Float32Array,
      sampleRate: number,
    ) => {
      isRecordingRef.current = false;
      clearRecordingTimer();

      if (discardRecordingRef.current) {
        discardRecordingRef.current = false;
        recordingStopRequestedRef.current = false;
        processingRef.current = false;
        return;
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        processingRef.current
      ) {
        return;
      }

      const pattern = currentExerciseRef.current;

      if (!pattern) {
        processingRef.current = false;

        if (mountedRef.current && !pausedRef.current) {
          setErrorMessage(
            'The reference melody was not available. Please try again.',
          );
          setPhase('instructions');
        }

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

      try {
        const targetFreqs = pattern.notes.map(
          note => note.frequency,
        );

        const segmentDurationSec =
          NOTE_DURATION_SECONDS + NOTE_GAP_SECONDS;

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
          setLiveAudioFrame(null);

          recordingElapsedRef.current = 0;
          setElapsedMs(0);

          recordingStopRequestedRef.current = false;
          discardRecordingRef.current = false;
          processingRef.current = false;
          continueRepetitionRef.current = true;

          setPhase('listening');
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

        const { auth } = await import('@/services/firebase/config');
        const user = auth.currentUser;

        if (user) {
          await saveCompletedExercise(
            'pitch',
            'melodicPatternMatching',
            currentTier,
            score.score,
          );
        }

        if (!mountedRef.current || quitInProgressRef.current) return;

        setResult(score);
        setPhase('results');
      } catch (errorMessage) {
        console.error(
          'Melodic pattern matching processing failed:',
          errorMessage,
        );

        if (!mountedRef.current) return;

        setErrorMessage(
          'Something went wrong while analyzing your recording. Please try again.',
        );

        setPhase('instructions');
      } finally {
        processingRef.current = false;
        recordingStopRequestedRef.current = false;
      }
    },
    [clearRecordingTimer, currentTier, params],
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
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      isRecordingRef.current ||
      recordingStartInProgressRef.current ||
      processingRef.current
    ) {
      return;
    }

    recordingStartInProgressRef.current = true;

    try {
      discardRecordingRef.current = false;
      recordingStopRequestedRef.current = false;

      recordingElapsedRef.current = 0;
      setElapsedMs(0);
      setLiveAudioFrame(null);

      await startRecording();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        discardRecordingRef.current = true;
        recordingStopRequestedRef.current = true;

        try {
          await stopRecording();
        } catch (errorMessage) {
          console.error(
            'Failed to stop recording after interruption:',
            errorMessage,
          );
        } finally {
          recordingStartInProgressRef.current = false;
          isRecordingRef.current = false;
          recordingStopRequestedRef.current = false;

          if (mountedRef.current && showQuitModalRef.current) {
            setIsStoppingForQuitModal(false);
          }
        }

        return;
      }

      recordingStartInProgressRef.current = false;
      isRecordingRef.current = true;
      setPhase('recording');

      const recordingDurationMs =
        getRecordingDurationSec(params) * 1000;

      clearRecordingTimer();
      let lastTickAt = Date.now();

      recordingTimerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsedDelta = now - lastTickAt;
        lastTickAt = now;

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          !isRecordingRef.current ||
          recordingStopRequestedRef.current
        ) {
          return;
        }

        recordingElapsedRef.current += elapsedDelta;

        const elapsedSeconds = recordingElapsedRef.current;
        setElapsedMs(elapsedSeconds);

        if (elapsedSeconds >= recordingDurationMs) {
          clearRecordingTimer();

          if (
            !isRecordingRef.current ||
            recordingStopRequestedRef.current
          ) {
            return;
          }

          recordingStopRequestedRef.current = true;

          stopRecording().catch(errorMessage => {
            console.error(
              'Failed to stop melodic pattern recording:',
              errorMessage,
            );

            isRecordingRef.current = false;
            recordingStopRequestedRef.current = false;
            processingRef.current = false;

            if (
              mountedRef.current &&
              !pausedRef.current &&
              !quitInProgressRef.current
            ) {
              setErrorMessage(
                'We could not finish the recording. Please try again.',
              );
              setPhase('instructions');
            }
          });
        }
      }, RECORDING_TIMER_INTERVAL_MS);
    } catch (errorMessage) {
      console.error(
        'Failed to start melodic pattern recording:',
        errorMessage,
      );

      recordingStartInProgressRef.current = false;
      isRecordingRef.current = false;
      recordingStopRequestedRef.current = false;
      discardRecordingRef.current = false;
      processingRef.current = false;

      clearRecordingTimer();

      if (
        mountedRef.current &&
        showQuitModalRef.current
      ) {
        setIsStoppingForQuitModal(false);
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitInProgressRef.current
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
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      const runId = ++playbackRunIdRef.current;

      const playbackWasInterrupted = () =>
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        runId !== playbackRunIdRef.current;

      try {
        setPhase('listening');

        for (
          let index = 0;
          index < pattern.notes.length;
          index++
        ) {
          if (playbackWasInterrupted()) return;

          await playSingleNote(
            pattern.notes[index].frequency,
            NOTE_DURATION_SECONDS,
          );

          if (playbackWasInterrupted()) return;

          if (index < pattern.notes.length - 1) {
            await new Promise<void>(resolve => {
              setTimeout(resolve, NOTE_GAP_SECONDS * 1000);
            });

            if (playbackWasInterrupted()) return;
          }
        }

        if (playbackWasInterrupted()) return;

        await beginRecording();
      } catch (errorMessage) {
        console.error('Failed to play melodic pattern:', errorMessage);

        if (playbackWasInterrupted()) return;

        isRecordingRef.current = false;
        recordingStopRequestedRef.current = false;

        setErrorMessage(
          'Unable to play the reference melody. Please try again.',
        );
        setPhase('instructions');
      }
    },
    [beginRecording],
  );

  useEffect(() => {
    if (!continueRepetitionRef.current) return;

    continueRepetitionRef.current = false;
    const pattern = currentExerciseRef.current;

    if (
      !pattern ||
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    void playPatternAndRecord(pattern);
  }, [currentRep, playPatternAndRecord]);

  const generatePattern = useCallback((): GeneratedPattern => {
    const notes: ReturnType<typeof createMusicalNote>[] = [];

    for (let index = 0; index < params.noteCount; index++) {
      let note = getRandomPitchNote(currentTier, vocalRange);

      if (
        notes.length > 0 &&
        note.frequency === notes[notes.length - 1].frequency
      ) {
        let attempts = 0;

        while (
          note.frequency === notes[notes.length - 1].frequency &&
          attempts < 5
        ) {
          note = getRandomPitchNote(currentTier, vocalRange);
          attempts++;
        }
      }

      notes.push(note);
    }

    return { notes };
  }, [currentTier, params.noteCount, vocalRange]);

  const startCountdown = useCallback(() => {
    if (
      isLoadingParams ||
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      isRecordingRef.current ||
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
    setLiveAudioFrame(null);

    recordingElapsedRef.current = 0;
    setElapsedMs(0);

    isRecordingRef.current = false;
    recordingStopRequestedRef.current = false;
    discardRecordingRef.current = false;
    processingRef.current = false;
    setIsInitialListening(false);

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setPhase('countdown');

    let remaining = EXERCISE_COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
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
    isLoadingParams,
    playPatternAndRecord,
  ]);

  const restartCurrentRepetition = useCallback(() => {
    const pattern = currentExerciseRef.current;

    if (
      !pattern ||
      !mountedRef.current ||
      recordingStartInProgressRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    clearCountdownTimer();
    clearRecordingTimer();

    isRecordingRef.current = false;
    recordingStopRequestedRef.current = false;
    processingRef.current = false;
    continueRepetitionRef.current = false;

    recordingElapsedRef.current = 0;
    setElapsedMs(0);
    setLiveAudioFrame(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setPhase('countdown');

    let remaining = EXERCISE_COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
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
        !showQuitModalRef.current &&
        !quitInProgressRef.current
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
      quitInProgressRef.current ||
      showQuitModalRef.current ||
      processingRef.current
    ) {
      return;
    }

    pausedPhaseRef.current = phase;
    pausedRef.current = true;
    playbackRunIdRef.current += 1;
    showQuitModalRef.current = true;

    clearCountdownTimer();
    clearRecordingTimer();

    setShowQuitModal(true);

    const recorderIsStarting =
      recordingStartInProgressRef.current;

    const recordingNeedsStopping =
      isRecordingRef.current || recorderIsStarting;

    setIsStoppingForQuitModal(recordingNeedsStopping);

    if (recorderIsStarting && !isRecordingRef.current) return;
    if (!isRecordingRef.current) return;

    discardRecordingRef.current = true;
    recordingStopRequestedRef.current = true;

    try {
      await stopRecording();
    } catch (errorMessage) {
      console.error(
        'Failed to stop recording while opening the quit modal:',
        errorMessage,
      );
    } finally {
      isRecordingRef.current = false;
      recordingStopRequestedRef.current = false;
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
      !showQuitModalRef.current ||
      !mountedRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const interruptedPhase = pausedPhaseRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    pausedRef.current = false;

    if (
      interruptedPhase === 'instructions' ||
      interruptedPhase === 'results'
    ) {
      return;
    }

    restartCurrentRepetition();
  }, [isStoppingForQuitModal, restartCurrentRepetition]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    playbackRunIdRef.current += 1;
    showQuitModalRef.current = false;

    setIsStoppingForQuitModal(true);
    setShowQuitModal(false);

    clearCountdownTimer();
    clearRecordingTimer();

    continueRepetitionRef.current = false;
    discardRecordingRef.current = true;

    if (
      isRecordingRef.current ||
      recordingStartInProgressRef.current
    ) {
      recordingStopRequestedRef.current = true;

      try {
        await stopRecordingRef.current?.();
      } catch (errorMessage) {
        console.error(
          'Failed to stop recording before exiting:',
          errorMessage,
        );
      }
    }

    recordingStartInProgressRef.current = false;
    isRecordingRef.current = false;
    recordingStopRequestedRef.current = false;
    processingRef.current = false;

    router.replace('/exercises/pitch');
  }, [clearCountdownTimer, clearRecordingTimer]);

  const retry = useCallback(async () => {
    pausedRef.current = true;
    playbackRunIdRef.current += 1;

    showQuitModalRef.current = false;
    setShowQuitModal(false);

    clearCountdownTimer();
    clearRecordingTimer();

    continueRepetitionRef.current = false;
    discardRecordingRef.current = true;

    if (
      isRecordingRef.current ||
      recordingStartInProgressRef.current
    ) {
      recordingStopRequestedRef.current = true;

      try {
        await stopRecordingRef.current?.();
      } catch (errorMessage) {
        console.error(
          'Failed to stop recording during retry:',
          errorMessage,
        );
      }
    }

    if (!mountedRef.current) return;

    measurementsRef.current = [];
    currentExerciseRef.current = null;

    setCurrentRep(1);
    setCurrentPattern(null);
    setResult(null);
    setLiveAudioFrame(null);

    recordingElapsedRef.current = 0;
    setElapsedMs(0);

    recordingStartInProgressRef.current = false;
    isRecordingRef.current = false;
    recordingStopRequestedRef.current = false;
    discardRecordingRef.current = false;
    processingRef.current = false;
    quitInProgressRef.current = false;
    pausedRef.current = false;

    setIsStoppingForQuitModal(false);
    setErrorMessage(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setPhase('instructions');
  }, [clearCountdownTimer, clearRecordingTimer]);

  const handleBack = useCallback(() => {
    void openQuitModal();
  }, [openQuitModal]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) return true;

        void openQuitModal();
        return true;
      },
    );

    return () => subscription.remove();
  }, [openQuitModal]);

  const repetitionCount = getRepetitionCount(params);

  const noteChipSize =
    params.noteCount >= 8 ? 48 :
    params.noteCount >= 6 ? 54 :
    60;

  const noteChipGap =
    params.noteCount >= 8 ? 10 :
    params.noteCount >= 6 ? 12 :
    16;

  const currentNoteIndex = Math.min(
    Math.floor(
      elapsedMs /
        ((NOTE_DURATION_SECONDS + NOTE_GAP_SECONDS) * 1000),
    ),
    Math.max(0, (currentPattern?.notes.length ?? 1) - 1),
  );

  const currentTargetNote =
    currentPattern?.notes[currentNoteIndex] ?? null;

  const targetDuration = getRecordingDurationSec(params);
  const elapsedSeconds = elapsedMs / 1000;

  const recordingProgress = Math.min(
    100,
    Math.max(0, (elapsedSeconds / targetDuration) * 100),
  );

  const hasValidPitch =
    typeof liveAudioFrame?.pitch === 'number' &&
    Number.isFinite(liveAudioFrame.pitch) &&
    liveAudioFrame.pitch > 0;

  const quitModalMessage =
    pausedPhaseRef.current === 'instructions'
      ? 'Are you sure you want to leave Melodic Pattern Matching?'
      : pausedPhaseRef.current === 'results'
        ? 'You have completed this exercise. Are you sure you want to leave?'
        : pausedPhaseRef.current === 'recording'
          ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
          : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.';

  const quitExerciseModal = (
    <>
      <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit exercise?"}
        message={quitModalMessage}
        isQuitting={isStoppingForQuitModal}
        onContinue={continueExercise}
        onQuit={() => void quitExercise()}
        continueLabel={"Continue Exercise"}
        quitLabel={"Quit Exercise"}
      />
      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={function redoExerciseRepetition() {
          setShowNoAudioModal(false);
          setErrorMessage(null);
          restartCurrentRepetition();
        }}
        onQuit={() => {
          void quitExercise();
        }}
        isQuitting={isStoppingForQuitModal}
      />
    </>
  );

  let screenContent: ReactNode;

  if (phase === 'instructions' && isLoadingParams) {
    screenContent = (
      <ExercisePreparingScreen
        title="Preparing Your Exercise"
        message="Adjusting the exercise to your current difficulty level"
        icon="options-outline"
        iconSize={44}
        containerStyle={exerciseStyles.centerScreenVariant2}
        headerContent={<Pressable accessibilityRole="button" accessibilityLabel="Quit exercise" onPress={handleBack} style={exerciseStyles.quitButtonTopVariant1}>
            <Ionicons name="exit-outline" size={22} color={COLORS.brown}/>
          </Pressable>}
      />
    );
  } else if (phase === 'instructions') {
    screenContent = (
      <View style={exerciseStyles.screen}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quit exercise"
          onPress={handleBack}
          style={exerciseStyles.quitButtonTopVariant1}
        >
          <Ionicons name="exit-outline" size={22} color={COLORS.brown} />
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
  } else if (phase === 'listening') {
    screenContent = (
      <View style={exerciseStyles.screen}>
        <ExerciseListeningScreen
          icon="musical-notes-outline"
          title="Listen to the Pattern"
          currentRep={currentRep}
          repetitions={repetitionCount}
          elapsedSeconds={0}
          targetDuration={
            params.noteCount *
            (NOTE_DURATION_SECONDS + NOTE_GAP_SECONDS)
          }
          promptTitle="Remember the notes"
          prompt="Listen to the complete melody and remember the order. Recording will begin automatically afterward."
          liveContent={
            <View style={exerciseStyles.playbackNoteContainer}>
              <View style={exerciseStyles.resultsIconCircle}>
                <Ionicons
                  name="musical-notes-outline"
                  size={38}
                  color={COLORS.brown}
                />
              </View>

              <Text style={exerciseStyles.modalTitle}>
                Reference Melody
              </Text>

              <Text style={exerciseStyles.playbackDescription}>
                Repetition {currentRep} of {repetitionCount}
              </Text>

              <View
                style={[
                  exerciseStyles.noteList,
                  { gap: noteChipGap },
                ]}
              >
                {currentPattern?.notes.map((note, index) => (
                  <NoteChip
                    key={`${note.name}-${index}`}
                    note={note.name}
                    size={noteChipSize}
                  />
                ))}
              </View>

              <ActivityIndicator
                size="large"
                color={COLORS.brown}
                style={exerciseStyles.playbackSpinner}
              />
            </View>
          }
          progress={0}
          onBack={handleBack}
          onContinue={
            isInitialListening
              ? () => {
                  setIsInitialListening(false);
                  startCountdown();
                }
              : undefined
          }
        />
      </View>
    );
  } else if (phase === 'recording') {
    screenContent = (
      <View style={exerciseStyles.recordingScreen}>
        <View style={exerciseStyles.recordingHeaderVariant1}>

          <View style={exerciseStyles.recordingIcon}>
              <Ionicons name="mic" size={30} color={COLORS.brown} />
            </View>

          <Text style={exerciseStyles.recordingTitleVariant2}>
            Sing the Melody
          </Text>

          <Text style={exerciseStyles.repBadgeText}>
            Repetition {currentRep} of {repetitionCount}
          </Text>
        </View>

        <View
              style={[
                exerciseStyles.recordingNoteList,
                { gap: noteChipGap },
              ]}
            >
              {currentPattern?.notes.map((note, index) => (
                <NoteChip
                  key={`${note.name}-${index}`}
                  note={note.name}
                  active={index === currentNoteIndex}
                  size={noteChipSize}
                />
              ))}
            </View>

        <ScrollView
          style={exerciseStyles.infoText}
          contentContainerStyle={exerciseStyles.recordingScrollContent}
          showsVerticalScrollIndicator={false}
        >

          <View style={exerciseStyles.liveCardVariant7}>
            <View style={exerciseStyles.liveCardHeaderVariant1}>
              <View style={exerciseStyles.liveHeaderText}>
                <Text style={exerciseStyles.scoreRowValue}>
                  <View style={exerciseStyles.liveRecordingDot} />
                  LIVE PITCH GUIDE
                </Text>
              </View>

              <View style={exerciseStyles.liveRecordingBadge}>
                <Text style={exerciseStyles.liveRecordingBadgeText}>
                  LISTENING
                </Text>
              </View>
            </View>

            <View style={exerciseStyles.pitchComparison}>
              <View style={exerciseStyles.sessionPart}>
                <Text style={exerciseStyles.liveLabelVariant3}>TARGET NOTE</Text>
                <Text style={exerciseStyles.liveTarget}>
                  {currentTargetNote?.name ?? '--'}
                </Text>
                <Text style={exerciseStyles.liveFrequency}>
                  {currentTargetNote
                    ? `${Math.round(currentTargetNote.frequency)} Hz`
                    : '-- Hz'}
                </Text>
              </View>

              <View style={exerciseStyles.pitchComparisonDivider}>
                <Ionicons
                  name="mic-outline"
                  size={18}
                  color={COLORS.muted}
                />
              </View>

              <View style={exerciseStyles.sessionPart}>
                <Text style={exerciseStyles.liveLabelVariant3}>YOUR NOTE</Text>
                <Text
                  style={[
                    exerciseStyles.liveNote,
                    exerciseStyles.liveNoteCompact,
                    hasValidPitch
                      ? exerciseStyles.liveNoteDetected
                      : exerciseStyles.liveNoteWaiting,
                  ]}
                >
                  {hasValidPitch ? liveAudioFrame?.note ?? '--' : '--'}
                </Text>
                <Text style={exerciseStyles.liveFrequency}>
                  {hasValidPitch
                    ? `${Math.round(liveAudioFrame.pitch)} Hz`
                    : 'Waiting for voice'}
                </Text>
              </View>
            </View>

            <ExerciseLivePitchIndicator
              targetNote={currentTargetNote?.name ?? '--'}
              targetFrequency={currentTargetNote?.frequency ?? null}
              detectedNote={hasValidPitch ? liveAudioFrame.note : null}
              detectedFrequency={hasValidPitch ? liveAudioFrame.pitch : null}
            />

            <View style={exerciseStyles.liveStats}>
              <View style={exerciseStyles.liveMetric}>
                <View style={exerciseStyles.liveStatHeading}>
                  <Text style={exerciseStyles.scoreRowLabel}>Notes</Text>
                </View>
                <Text style={exerciseStyles.liveStatValueVariant1}>
                  {Math.min(currentNoteIndex + 1, params.noteCount)}
                  /{params.noteCount}
                </Text>
              </View>

              <View style={exerciseStyles.liveStatsDivider} />

              <View style={exerciseStyles.liveMetric}>
                <View style={exerciseStyles.liveStatHeading}>
                  <Text style={exerciseStyles.scoreRowLabel}>Pattern</Text>
                </View>
                <Text style={exerciseStyles.liveStatValueVariant1}>
                  {params.noteCount} notes
                </Text>
              </View>
            </View>
          </View>
          <View style={exerciseStyles.recordingProgressTrack}>
              <View
                style={[
                  exerciseStyles.progressFill,
                  { width: `${recordingProgress}%` },
                ]}
              />
            </View>
        </ScrollView>
      </View>
    );
  } else if (phase === 'processing') {
    screenContent = (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your Singing"
        message="Checking your pitch accuracy and melodic timing across all repetitions."
      />
    );
  } else if (phase === 'results' && result) {
    screenContent = (
      <View style={exerciseStyles.screen}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quit exercise"
          onPress={handleBack}
          style={exerciseStyles.quitButtonTopVariant1}
        >
          <Ionicons name="exit-outline" size={22} color={COLORS.brown} />
        </Pressable>

        <ExerciseResultsScreen
          title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
          subtitle={
            result.passed
              ? 'You completed all repetitions successfully.'
              : 'Review your results and try again to improve your accuracy.'
          }
          score={result.score}
          resultIcon={result.passed ? 'checkmark' : 'refresh-outline'}
          scoreDetails={
            <View style={exerciseStyles.scoreDetails}>
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
          <View style={exerciseStyles.resultCardVariant1}>
            <Text style={exerciseStyles.resultCardTitle}>Pattern Results</Text>
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

          <View style={exerciseStyles.resultCardVariant1}>
            <Text style={exerciseStyles.resultCardTitle}>Repetition Scores</Text>
            {result.repetitionScores.map((score, index) => (
              <ResultRow
                key={`repetition-${index}`}
                label={`Repetition ${index + 1}`}
                value={`${score}%`}
                last={index === result.repetitionScores.length - 1}
              />
            ))}
          </View>

          <View style={exerciseStyles.resultCardVariant1}>
            <Text style={exerciseStyles.resultCardTitle}>Note Results</Text>
            {result.noteAccuracies.map((accuracy, index) => (
              <ResultRow
                key={`note-${index}`}
                label={`Note ${index + 1}`}
                value={`${Math.round(accuracy)}%`}
                last={index === result.noteAccuracies.length - 1}
              />
            ))}
          </View>

          <View style={exerciseStyles.targetPatternCard}>
            <Text style={exerciseStyles.resultCardTitle}>Target Pattern</Text>
            <View
              style={[
                exerciseStyles.targetNoteList,
                { gap: noteChipGap },
              ]}
            >
              {currentPattern?.notes.map((note, index) => (
                <NoteChip
                  key={`${note.name}-${index}`}
                  note={note.name}
                  size={noteChipSize}
                />
              ))}
            </View>
          </View>

          <View style={exerciseStyles.tipContainer}>
            <Ionicons name="bulb-outline" size={21} color={COLORS.brown} />
            <Text style={exerciseStyles.tipTextVariant2}>
              Focus on keeping each note accurate and maintaining the
              same melodic order throughout every repetition.
            </Text>
          </View>
        </ExerciseResultsScreen>
      </View>
    );
  } else {
    screenContent = <View style={exerciseStyles.centerScreenVariant2} />;
  }

  return (
    <>
      {screenContent}
      {quitExerciseModal}
    </>
  );
}
