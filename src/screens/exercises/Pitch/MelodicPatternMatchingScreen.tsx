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

import {
  measureMelodicPatternMatching,
} from '@/services/measurement/pitch/melodicPatternMatching';

import {
  scoreMelodicPatternMatchingRepetitions,
  type MelodicPatternScoreResult,
} from '@/services/scoring/pitch/melodicPatternMatching';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  createMusicalNote,
  getRandomPitchNote,
  type VocalRange,
} from '@/utils/music/notes';

import {
  playSingleNote,
} from '@/utils/music/notePlayer';

import {
  segmentIntoNotes,
} from '@/utils/dsp/pitch';

import {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
  default as ExerciseScreen,
} from '@/screens/exercises/ExerciseScreen';

// ============================================================
// TYPES
// ============================================================

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

// ============================================================
// CONSTANTS
// ============================================================

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

// ============================================================
// HELPERS
// ============================================================

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

// ============================================================
// REUSABLE RESULT ROW
// ============================================================

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
      <Text style={styles.resultLabel}>
        {label}
      </Text>

      <Text style={styles.resultValue}>
        {value}
      </Text>
    </View>
  );
}

// ============================================================
// REUSABLE NOTE CHIP
// ============================================================

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
      <Text style={styles.noteChipText}>
        {note}
      </Text>
    </View>
  );
}

// ============================================================
// SCREEN
// ============================================================

export default function MelodicPatternMatchingScreen({
  tier,
}: Props) {
  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------

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

  const [currentRep, setCurrentRep] =
    useState(1);

  const [result, setResult] =
    useState<MelodicPatternScoreResult | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------

  const mountedRef = useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const recordingRef = useRef(false);
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

  // ----------------------------------------------------------
  // TIMER CLEANUP
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // LOAD ADAPTIVE PARAMETERS
  // ----------------------------------------------------------

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

        setVocalRange(
          assessment?.vocalRange ?? null,
        );

        let recentScores = recentExerciseScores;

        // Use the assessment only when no matching
        // exercise history exists for this tier/template.
        if (recentScores.length === 0) {
          const pitchScore =
            assessment?.scores.find(
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

    loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  // ----------------------------------------------------------
  // SCREEN CLEANUP
  // ----------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      clearCountdownTimer();
      clearRecordingTimer();

      // Any recording still in progress must be discarded.
      discardRecordingRef.current = true;
      continueRepetitionRef.current = false;

      if (recordingRef.current) {
        void stopRecordingRef.current?.().catch(
          error => {
            console.error(
              'Failed to stop recording during cleanup:',
              error,
            );
          },
        );
      }
    };
  }, [clearCountdownTimer, clearRecordingTimer]);

  // ----------------------------------------------------------
  // LIVE AUDIO
  // ----------------------------------------------------------

  const handleLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (!mountedRef.current) {
        return;
      }

      setLiveFrame(frame);
    },
    [],
  );

  // ----------------------------------------------------------
  // AUDIO RECORDER
  // ----------------------------------------------------------

  const handleRecordingStop = useCallback(
    async (
      samples: Float32Array,
      sampleRate: number,
    ) => {
      recordingRef.current = false;
      clearRecordingTimer();

      // Discard intentionally stopped recordings before
      // attempting any measurement or score calculation.
      if (discardRecordingRef.current) {
        discardRecordingRef.current = false;
        stopRequestedRef.current = false;
        processingRef.current = false;
        return;
      }

      if (
        !mountedRef.current ||
        processingRef.current
      ) {
        return;
      }

      const pattern = currentExerciseRef.current;

      if (!pattern) {
        processingRef.current = false;

        if (mountedRef.current) {
          setErrorMessage(
            'The reference melody was not available. Please try again.',
          );
          setPhase('instructions');
        }

        return;
      }

      // Lock processing to prevent duplicate callbacks from
      // processing the same recording more than once.
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

        const repetitionCount =
          getRepetitionCount(params);

        const completedRepetitions =
          measurementsRef.current.length;

        // ----------------------------------------------------
        // NEXT REPETITION
        // ----------------------------------------------------

        if (completedRepetitions < repetitionCount) {
          const nextRep = completedRepetitions + 1;

          setCurrentRep(nextRep);
          setLiveFrame(null);

          recordingElapsedRef.current = 0;
          setRecordingElapsedMs(0);

          stopRequestedRef.current = false;
          discardRecordingRef.current = false;

          // Release the processing lock before the next
          // reference playback begins.
          processingRef.current = false;
          continueRepetitionRef.current = true;

          setPhase('playing');
          return;
        }

        // ----------------------------------------------------
        // FINAL REPETITION
        // ----------------------------------------------------

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

        if (!mountedRef.current) {
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

  // ----------------------------------------------------------
  // STOP RECORDING REF
  // ----------------------------------------------------------

  useEffect(() => {
    stopRecordingRef.current = stopRecording;

    return () => {
      stopRecordingRef.current = null;
    };
  }, [stopRecording]);

  // ----------------------------------------------------------
  // BEGIN RECORDING
  // ----------------------------------------------------------

  const beginRecording = useCallback(
    async () => {
      if (
        !mountedRef.current ||
        recordingRef.current ||
        processingRef.current
      ) {
        return;
      }

      try {
        discardRecordingRef.current = false;
        stopRequestedRef.current = false;

        recordingElapsedRef.current = 0;
        setRecordingElapsedMs(0);
        setLiveFrame(null);
        setPhase('recording');

        await startRecording();

        if (!mountedRef.current) {
          return;
        }

        recordingRef.current = true;

        const recordingDurationMs =
          getRecordingDurationSec(params) * 1000;

        clearRecordingTimer();

        recordingTimerRef.current = setInterval(() => {
          if (
            !mountedRef.current ||
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

              if (mountedRef.current) {
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

        recordingRef.current = false;
        stopRequestedRef.current = false;
        discardRecordingRef.current = false;
        processingRef.current = false;

        clearRecordingTimer();

        if (!mountedRef.current) {
          return;
        }

        setErrorMessage(
          'Unable to start microphone recording. Please check your microphone permission and try again.',
        );

        setPhase('instructions');
      }
    },
    [
      clearRecordingTimer,
      params,
      startRecording,
      stopRecording,
    ],
  );

  // ----------------------------------------------------------
  // PLAY REFERENCE MELODY
  // ----------------------------------------------------------

  const playPatternAndRecord = useCallback(
    async (pattern: GeneratedPattern) => {
      if (!mountedRef.current) {
        return;
      }

      try {
        setPhase('playing');

        for (
          let index = 0;
          index < pattern.notes.length;
          index++
        ) {
          if (!mountedRef.current) {
            return;
          }

          await playSingleNote(
            pattern.notes[index].frequency,
            NOTE_DURATION_SEC,
          );

          if (index < pattern.notes.length - 1) {
            await new Promise<void>(resolve => {
              setTimeout(
                resolve,
                NOTE_GAP_SEC * 1000,
              );
            });
          }
        }

        if (!mountedRef.current) {
          return;
        }

        await beginRecording();
      } catch (error) {
        console.error(
          'Failed to play melodic pattern:',
          error,
        );

        if (!mountedRef.current) {
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

  // ----------------------------------------------------------
  // CONTINUE TO THE NEXT REPETITION
  // ----------------------------------------------------------

  useEffect(() => {
    if (!continueRepetitionRef.current) {
      return;
    }

    continueRepetitionRef.current = false;

    const pattern = currentExerciseRef.current;

    if (!pattern || !mountedRef.current) {
      return;
    }

    void playPatternAndRecord(pattern);
  }, [currentRep, playPatternAndRecord]);

  // ----------------------------------------------------------
  // GENERATE MELODIC PATTERN
  // ----------------------------------------------------------

  const generatePattern = useCallback(
    (): GeneratedPattern => {
      const notes: ReturnType<
        typeof createMusicalNote
      >[] = [];

      for (
        let index = 0;
        index < params.noteCount;
        index++
      ) {
        let note = getRandomPitchNote(
          currentTier,
          vocalRange,
        );

        // Avoid immediately repeating the same note when
        // another note can be generated.
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
    },
    [
      currentTier,
      params.noteCount,
      vocalRange,
    ],
  );

  // ----------------------------------------------------------
  // START EXERCISE
  // ----------------------------------------------------------

  const startCountdown = useCallback(() => {
    if (
      isLoadingAdaptiveParams ||
      !mountedRef.current ||
      recordingRef.current ||
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
      if (!mountedRef.current) {
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

  // ----------------------------------------------------------
  // RETRY
  // ----------------------------------------------------------

  const retry = useCallback(async () => {
    clearCountdownTimer();
    clearRecordingTimer();

    continueRepetitionRef.current = false;

    const shouldStopRecording =
      recordingRef.current;

    if (shouldStopRecording) {
      // Set this before stopping so onStop discards the
      // recording instead of scoring or saving it.
      discardRecordingRef.current = true;
      stopRequestedRef.current = true;

      try {
        await stopRecording();
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

    recordingRef.current = false;
    stopRequestedRef.current = false;
    discardRecordingRef.current = false;
    processingRef.current = false;

    setErrorMessage(null);
    setPhase('instructions');
  }, [
    clearCountdownTimer,
    clearRecordingTimer,
    stopRecording,
  ]);

  // ----------------------------------------------------------
  // NAVIGATION
  // ----------------------------------------------------------

  const goToExercises = useCallback(() => {
    router.replace('/dashboard?tab=exercises');
  }, []);

  // ----------------------------------------------------------
  // LIVE TARGET NOTE
  // ----------------------------------------------------------

  const repetitionCount =
    getRepetitionCount(params);

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

  // ----------------------------------------------------------
  // ADAPTIVE LOADING SCREEN
  // ----------------------------------------------------------

  if (
    phase === 'instructions' &&
    isLoadingAdaptiveParams
  ) {
    return (
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
  }

  // ----------------------------------------------------------
  // INSTRUCTIONS
  // ----------------------------------------------------------

  if (phase === 'instructions') {
    return (
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
        onBack={goToExercises}
        onStart={startCountdown}
        error={errorMessage}
        startDisabled={isLoadingAdaptiveParams}
        startLabel={
          isLoadingAdaptiveParams
            ? 'Preparing...'
            : 'Start Exercise'
        }
      />
    );
  }

  // ----------------------------------------------------------
  // COUNTDOWN
  // ----------------------------------------------------------

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="musical-notes-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={repetitionCount}
        countdown={countdown}
        promptTitle="Listen carefully"
        prompt="You will hear the reference melody before singing it."
        onBack={goToExercises}
      />
    );
  }

  // ----------------------------------------------------------
  // REFERENCE MELODY PLAYBACK
  // ----------------------------------------------------------

  if (phase === 'playing') {
    return (
      <View style={styles.playbackScreen}>
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
  }

  // ----------------------------------------------------------
  // RECORDING
  // ----------------------------------------------------------

  if (phase === 'recording') {
    const targetDuration =
      getRecordingDurationSec(params);

    const elapsed = recordingElapsedMs / 1000;

    const progress = Math.min(
      100,
      Math.max(
        0,
        (elapsed / targetDuration) * 100,
      ),
    );

    const hasValidPitch =
      typeof liveFrame?.pitch === 'number' &&
      Number.isFinite(liveFrame.pitch) &&
      liveFrame.pitch > 0;

    return (
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
        onBack={goToExercises}
      />
    );
  }

  // ----------------------------------------------------------
  // PROCESSING
  // ----------------------------------------------------------

  if (phase === 'processing') {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your Singing"
        message="Checking your pitch accuracy and melodic timing across all repetitions."
        onBack={goToExercises}
      />
    );
  }

  // ----------------------------------------------------------
  // RESULTS
  // ----------------------------------------------------------

  if (phase === 'results' && result) {
    return (
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
        onExit={goToExercises}
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

          {result.repetitionScores.map(
            (score, index) => (
              <ResultRow
                key={`repetition-${index}`}
                label={`Repetition ${index + 1}`}
                value={`${score}%`}
                last={
                  index ===
                  result.repetitionScores.length - 1
                }
              />
            ),
          )}
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Note Results
          </Text>

          {result.noteAccuracies.map(
            (accuracy, index) => (
              <ResultRow
                key={`note-${index}`}
                label={`Note ${index + 1}`}
                value={`${Math.round(accuracy)}%`}
                last={
                  index ===
                  result.noteAccuracies.length - 1
                }
              />
            ),
          )}
        </View>

        <View style={styles.targetPatternCard}>
          <Text style={styles.resultCardTitle}>
            Target Pattern
          </Text>

          <View style={styles.targetNoteList}>
            {currentPattern?.notes.map(
              (note, index) => (
                <NoteChip
                  key={`${note.name}-${index}`}
                  note={note.name}
                />
              ),
            )}
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
    );
  }

  return null;
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  // Loading
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

  // Reference playback
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

  // Note chips
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

  // Live recording
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

  // Results
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

  // Tip
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
});