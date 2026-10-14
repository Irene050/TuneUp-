
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

const NOTE_DURATION_SEC = 0.7;
const NOTE_GAP_SEC = 0.12;
const RECORDING_BUFFER_SEC = 0.8;

/**
 * Reusable result row.
 */
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

/**
 * Reusable note chip.
 */
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

  const [
    isLoadingAdaptiveParams,
    setIsLoadingAdaptiveParams,
  ] = useState(true);

  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(3);

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

  /*
   * Load adaptive parameters.
   *
   * Prefer the latest five exercise scores for
   * the same template and tier. If there is no
   * matching exercise history, use the latest
   * assessment pitch score as the initial reference.
   */
  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParams = async () => {
      setIsLoadingAdaptiveParams(true);

      try {
        const { auth } = await import(
          '@/services/firebase/config'
        );

        const user = auth.currentUser;

        if (!user) {
          if (!cancelled) {
            const fallbackTier = tier ?? 'beginner';

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

        if (!cancelled) {
          setCurrentTier(resolvedTier);
        }

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

        if (!cancelled) {
          setVocalRange(
            assessment?.vocalRange ?? null,
          );
        }

        let recentScores = recentExerciseScores;

        /*
         * Assessment is used only when no matching
         * exercise history is available.
         */
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
    };

    loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  /*
   * Cleanup timers and microphone recording.
   */
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      discardRecordingRef.current = true;

      if (recordingRef.current) {
        stopRecordingRef.current?.();
      }
    };
  }, []);

  /*
   * Live microphone frames.
   */
  const handleLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (!mountedRef.current) {
        return;
      }

      setLiveFrame(frame);
    },
    [],
  );

  /*
   * Handle the end of one recording.
   */
  const handleRecordingStop = useCallback(
    async (
      samples: Float32Array,
      sampleRate: number,
    ) => {
      recordingRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      if (
        !mountedRef.current ||
        discardRecordingRef.current ||
        processingRef.current
      ) {
        return;
      }

      const pattern = currentExerciseRef.current;

      if (!pattern) {
        setPhase('instructions');
        return;
      }

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

        const completedRepetitions =
          measurementsRef.current.length;

        /*
         * Continue with the next repetition
         * using the same reference pattern.
         */
        if (completedRepetitions < params.repetitions) {
          const nextRep = completedRepetitions + 1;

          continueRepetitionRef.current = true;
          processingRef.current = false;
          stopRequestedRef.current = false;
          discardRecordingRef.current = false;

          setCurrentRep(nextRep);
          setLiveFrame(null);

          recordingElapsedRef.current = 0;
          setRecordingElapsedMs(0);

          setPhase('playing');
          return;
        }

        /*
         * Process the final repetition.
         */
        processingRef.current = true;
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

        processingRef.current = false;

        setErrorMessage(
          'Something went wrong while analyzing your recording. Please try again.',
        );

        setPhase('instructions');
      }
    },
    [currentTier, params],
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

  /*
   * Start microphone recording.
   */
  const beginRecording = useCallback(
    async () => {
      if (
        !mountedRef.current ||
        recordingRef.current
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

        const recordingDurationSec =
          params.noteCount *
            (NOTE_DURATION_SEC + NOTE_GAP_SEC) +
          RECORDING_BUFFER_SEC;

        const recordingDurationMs =
          recordingDurationSec * 1000;

        recordingTimerRef.current = setInterval(() => {
          if (!mountedRef.current) {
            return;
          }

          recordingElapsedRef.current += 100;

          setRecordingElapsedMs(
            recordingElapsedRef.current,
          );

          if (
            recordingElapsedRef.current >=
            recordingDurationMs
          ) {
            if (recordingTimerRef.current) {
              clearInterval(recordingTimerRef.current);
              recordingTimerRef.current = null;
            }

            if (
              recordingRef.current &&
              !stopRequestedRef.current
            ) {
              stopRequestedRef.current = true;

              stopRecording().catch(error => {
                console.error(
                  'Failed to stop recording:',
                  error,
                );
              });
            }
          }
        }, 100);
      } catch (error) {
        console.error(
          'Failed to start recording:',
          error,
        );

        recordingRef.current = false;

        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

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
      params.noteCount,
      startRecording,
      stopRecording,
    ],
  );

  /*
   * Play the reference melody before recording.
   */
  const playPatternAndRecord = useCallback(
    async (pattern: GeneratedPattern) => {
      if (!mountedRef.current) {
        return;
      }

      try {
        setPhase('playing');

        for (
          let i = 0;
          i < pattern.notes.length;
          i++
        ) {
          if (!mountedRef.current) {
            return;
          }

          await playSingleNote(
            pattern.notes[i].frequency,
            NOTE_DURATION_SEC,
          );

          if (i < pattern.notes.length - 1) {
            await new Promise<void>(resolve =>
              setTimeout(
                resolve,
                NOTE_GAP_SEC * 1000,
              ),
            );
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

        setErrorMessage(
          'Unable to play the reference melody. Please try again.',
        );

        setPhase('instructions');
      }
    },
    [beginRecording],
  );

  /*
   * Start the next repetition after the previous
   * recording has been measured.
   */
  useEffect(() => {
    if (!continueRepetitionRef.current) {
      return;
    }

    continueRepetitionRef.current = false;

    const pattern = currentExerciseRef.current;

    if (!pattern || !mountedRef.current) {
      return;
    }

    playPatternAndRecord(pattern);
  }, [currentRep, playPatternAndRecord]);

  /*
   * Generate one melodic pattern.
   */
  const generatePattern = useCallback(
    (): GeneratedPattern => {
      const notes: ReturnType<
        typeof createMusicalNote
      >[] = [];

      for (
        let i = 0;
        i < params.noteCount;
        i++
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
    },
    [
      currentTier,
      params.noteCount,
      vocalRange,
    ],
  );

  /*
   * Start the complete exercise.
   */
  const startCountdown = useCallback(() => {
    if (
      isLoadingAdaptiveParams ||
      !mountedRef.current
    ) {
      return;
    }

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

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

    processingRef.current = false;
    stopRequestedRef.current = false;
    discardRecordingRef.current = false;
    recordingRef.current = false;

    setCountdown(3);
    setPhase('countdown');

    let remaining = 3;

    countdownTimerRef.current = setInterval(() => {
      if (!mountedRef.current) {
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

      playPatternAndRecord(generated);
    }, 1000);
  }, [
    generatePattern,
    isLoadingAdaptiveParams,
    playPatternAndRecord,
  ]);

  /*
   * Retry from the instructions screen.
   */
  const retry = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (recordingRef.current) {
      discardRecordingRef.current = true;
      stopRequestedRef.current = true;

      stopRecording().catch(error => {
        console.error(
          'Failed to stop recording during retry:',
          error,
        );
      });
    } else {
      discardRecordingRef.current = false;
    }

    measurementsRef.current = [];
    continueRepetitionRef.current = false;

    setCurrentRep(1);

    currentExerciseRef.current = null;

    setCurrentPattern(null);
    setResult(null);
    setLiveFrame(null);

    recordingElapsedRef.current = 0;
    setRecordingElapsedMs(0);

    processingRef.current = false;
    stopRequestedRef.current = false;
    recordingRef.current = false;

    setErrorMessage(null);
    setPhase('instructions');
  }, [stopRecording]);

  const goToExercises = useCallback(() => {
    router.replace('/dashboard?tab=exercises');
  }, []);

  /*
   * Determine the current target note.
   */
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

  /*
   * Adaptive parameter loading screen.
   */
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
            color="#4E2F1F"
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
          color="#4E2F1F"
          style={styles.spinner}
        />
      </View>
    );
  }

  /*
   * Instructions screen.
   */
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
            value: String(params.repetitions),
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

  /*
   * Countdown screen.
   */
  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="musical-notes-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={params.repetitions}
        countdown={countdown}
        promptTitle="Listen carefully"
        prompt="You will hear the reference melody before singing it."
        onBack={goToExercises}
      />
    );
  }

  /*
   * Reference melody playback screen.
   */
  if (phase === 'playing') {
    return (
      <View style={styles.playbackScreen}>
        <View style={styles.playbackIconCircle}>
          <Ionicons
            name="musical-notes-outline"
            size={44}
            color="#4E2F1F"
          />
        </View>

        <Text style={styles.playbackTitle}>
          Listen to the Pattern
        </Text>

        <Text style={styles.playbackSubtitle}>
          Repetition {currentRep} of {params.repetitions}
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
          color="#4E2F1F"
          style={styles.playbackSpinner}
        />
      </View>
    );
  }

  /*
   * Live listening and recording screen.
   */
  if (phase === 'recording') {
    const targetDuration =
      params.noteCount *
        (NOTE_DURATION_SEC + NOTE_GAP_SEC) +
      RECORDING_BUFFER_SEC;

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
      Number.isFinite(liveFrame.pitch);

    const liveContent = (
      <View>
        <View style={styles.liveNoteContainer}>
          <Text style={styles.liveNote}>
            {liveFrame?.note ?? '--'}
          </Text>

          <Text style={styles.liveFrequency}>
            {hasValidPitch
              ? `${Math.round(liveFrame.pitch)} Hz`
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
              {liveFrame?.note ?? '--'}
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
      </View>
    );

    return (
      <ExerciseListeningScreen
        icon="mic-outline"
        title="Melodic Pattern Matching"
        currentRep={currentRep}
        repetitions={params.repetitions}
        elapsed={elapsed}
        targetDuration={targetDuration}
        promptTitle="Your Turn"
        prompt="Match each note in the same order as the reference melody."
        liveContent={
          <View>
            {liveContent}

            <View style={styles.recordingNoteList}>
              {currentPattern?.notes.map(
                (note, index) => (
                  <NoteChip
                    key={`${note.name}-${index}`}
                    note={note.name}
                    active={
                      index === currentNoteIndex
                    }
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

  /*
   * Processing screen.
   */
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

  /*
   * Results screen.
   */
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
              value={`${result.repetitionsCompleted}/${params.repetitions}`}
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
            color="#4E2F1F"
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

/*
 * All screen styles.
 */
const styles = StyleSheet.create({
  centerScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  largeIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  processingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: '#4E2F1F',
    textAlign: 'center',
  },
  processingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: '#8E7770',
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },

  // Reference melody playback
  playbackScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  playbackIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  playbackTitle: {
    color: '#4E2F1F',
    fontSize: 26,
    fontFamily: 'FredokaBold',
    textAlign: 'center',
  },
  playbackSubtitle: {
    color: '#8E7770',
    fontSize: 15,
    fontFamily: 'FredokaRegular',
    textAlign: 'center',
    marginTop: 6,
  },
  playbackDescription: {
    color: '#8E7770',
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

  // Reusable note chips
  noteChip: {
    minWidth: 48,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFF8FA',
    borderWidth: 1,
    borderColor: '#F2DDE5',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  noteChipActive: {
    backgroundColor: '#FCD6DD',
  },
  noteChipText: {
    color: '#4E2F1F',
    fontSize: 14,
    fontFamily: 'FredokaSemiBold',
  },

  // Live recording
  liveNoteContainer: {
    alignItems: 'center',
    marginBottom: 18,
  },
  liveNote: {
    color: '#4E2F1F',
    fontSize: 40,
    fontFamily: 'FredokaBold',
  },
  liveFrequency: {
    color: '#8E7770',
    fontSize: 13,
    fontFamily: 'FredokaRegular',
    marginTop: 3,
  },
  liveStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F2DDE5',
    paddingTop: 14,
  },
  liveStat: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    color: '#8E7770',
    fontSize: 11,
    fontFamily: 'FredokaRegular',
  },
  statValue: {
    color: '#4E2F1F',
    fontSize: 14,
    fontFamily: 'FredokaSemiBold',
    marginTop: 3,
  },
  recordingNoteList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
  },

  // Results cards
  resultCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F2DDE5',
    borderRadius: 18,
    padding: 17,
    marginBottom: 14,
  },
  targetPatternCard: {
    backgroundColor: '#FFF8FA',
    borderWidth: 1,
    borderColor: '#F2DDE5',
    borderRadius: 18,
    padding: 17,
    marginBottom: 14,
  },
  resultCardTitle: {
    color: '#4E2F1F',
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
    borderBottomColor: '#F2DDE5',
  },
  resultRowLast: {
    borderBottomWidth: 0,
  },
  resultLabel: {
    flex: 1,
    color: '#8E7770',
    fontSize: 13,
    fontFamily: 'FredokaRegular',
  },
  resultValue: {
    color: '#4E2F1F',
    fontSize: 14,
    fontFamily: 'FredokaSemiBold',
    textAlign: 'right',
  },
  scoreDetails: {
    width: '100%',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F2DDE5',
  },
  targetNoteList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },

  // Tip
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF8FA',
    borderRadius: 16,
    padding: 15,
    marginBottom: 4,
  },
  tipText: {
    flex: 1,
    color: '#4E2F1F',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'FredokaRegular',
    marginLeft: 10,
  },
});