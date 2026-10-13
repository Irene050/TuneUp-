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
  LiveAudioFrame,
  useAudioRecorder,
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

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
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

const NOTE_DURATION_SEC = 0.7;
const NOTE_GAP_SEC = 0.12;
const RECORDING_BUFFER_SEC = 0.8;

export default function MelodicPatternMatchingScreen({
  tier,
}: Props) {
  const [currentTier, setCurrentTier] = useState<Tier>(
    tier ?? 'beginner',
  );

  const [params, setParams] =
    useState<MelodicPatternMatchingParams>(
      MELODIC_PATTERN_MATCHING_PARAMS[tier ?? 'beginner'],
    );

  const [
    isLoadingAdaptiveParams,
    setIsLoadingAdaptiveParams,
  ] = useState(true);

  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] = useState(3);

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

  const mountedRef = useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const processingRef = useRef(false);
  const recordingElapsedRef = useRef(0);

  const stopRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const currentExerciseRef =
    useRef<GeneratedPattern | null>(null);

  const currentRepRef = useRef(1);

  const measurementsRef = useRef<
    ReturnType<typeof measureMelodicPatternMatching>[]
  >([]);

  const continueRepetitionRef = useRef(false);

  /*
   * Load adaptive parameters.
   *
   * Completed exercise history for the current
   * component/tier is preferred. If none exists,
   * the latest assessment pitch score is used
   * as the initial ADS reference.
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
              MELODIC_PATTERN_MATCHING_PARAMS[fallbackTier],
            );
          }

          return;
        }

        const progress = await fetchComponentProgress(
          user.uid,
          'pitch',
        );

        const resolvedTier =
          tier ?? progress?.currentTier ?? 'beginner';

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
          .sort((a, b) => a.timestamp - b.timestamp)
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
         * If there is no exercise history for this
         * component and tier, use the latest assessment
         * pitch score as the initial ADS reference.
         */
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
            MELODIC_PATTERN_MATCHING_PARAMS[fallbackTier],
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
   * Cleanup.
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

        const measurement = measureMelodicPatternMatching(
          segments,
          sampleRate,
          targetTimestamps,
          params.minClarity,
        );

        measurementsRef.current.push(measurement);

        const completedRepetitions =
          measurementsRef.current.length;

        /*
         * There are still repetitions left.
         * Replay the same reference pattern.
         */
        if (completedRepetitions < params.repetitions) {
          const nextRep = completedRepetitions + 1;

          currentRepRef.current = nextRep;
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
         * Final repetition.
         */
        processingRef.current = true;
        setPhase('processing');

        const score = scoreMelodicPatternMatchingRepetitions(
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
   * Play the reference melody.
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
   * Start the next repetition after the
   * previous recording has been measured.
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

      for (let i = 0; i < params.noteCount; i++) {
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
    [currentTier, params.noteCount, vocalRange],
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
    currentRepRef.current = 1;
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
    currentRepRef.current = 1;
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
   * Current note shown during recording.
   */
  const currentNoteIndex = Math.min(
    Math.floor(
      recordingElapsedMs /
        ((NOTE_DURATION_SEC + NOTE_GAP_SEC) * 1000),
    ),
    Math.max(0, (currentPattern?.notes.length ?? 1) - 1),
  );

  const currentTargetNote =
    currentPattern?.notes[currentNoteIndex] ?? null;

  /*
   * ADS loading screen.
   */
  if (
    phase === 'instructions' &&
    isLoadingAdaptiveParams
  ) {
    return (
      <View style={styles.loadingScreen}>
        <View style={styles.loadingIconCircle}>
          <Ionicons
            name="options-outline"
            size={44}
            color="#4E2F1F"
          />
        </View>

        <Text style={styles.loadingTitle}>
          Preparing Your Exercise
        </Text>

        <Text style={styles.loadingSubtitle}>
          Adjusting the exercise to your
          current difficulty level
        </Text>

        <ActivityIndicator
          size="large"
          color="#4E2F1F"
          style={styles.loadingSpinner}
        />
      </View>
    );
  }

  /*
   * Instructions phase.
   * Display this after ADS finishes loading.
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
   * Countdown phase.
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
   * Reference melody playback.
   */
  if (phase === 'playing') {
    return (
      <View style={styles.playingScreen}>
        <View style={styles.playingIconCircle}>
          <Ionicons
            name="musical-notes-outline"
            size={44}
            color="#4E2F1F"
          />
        </View>

        <Text style={styles.playingTitle}>
          Listen to the Pattern
        </Text>

        <Text style={styles.playingSubtitle}>
          Repetition {currentRep} of {params.repetitions}
        </Text>

        <Text style={styles.playingDescription}>
          Remember the notes and their order.
        </Text>

        <View style={styles.noteChipContainer}>
          {currentPattern?.notes.map((note, index) => (
            <View
              key={`${note.name}-${index}`}
              style={styles.playingNoteChip}
            >
              <Text style={styles.playingNoteText}>
                {note.name}
              </Text>
            </View>
          ))}
        </View>

        <ActivityIndicator
          size="large"
          color="#4E2F1F"
          style={styles.playingSpinner}
        />
      </View>
    );
  }

  /*
   * Listening/recording phase.
   */
  if (phase === 'recording') {
    const targetDuration =
      params.noteCount *
        (NOTE_DURATION_SEC + NOTE_GAP_SEC) +
      RECORDING_BUFFER_SEC;

    const elapsed = recordingElapsedMs / 1000;

    const progress = Math.min(
      100,
      Math.max(0, (elapsed / targetDuration) * 100),
    );

    const liveContent = (
      <View>
        <View style={styles.livePitchContainer}>
          <Text style={styles.livePitchNote}>
            {liveFrame?.note ?? '--'}
          </Text>

          <Text style={styles.livePitchFrequency}>
            {Number.isFinite(liveFrame?.pitch)
              ? `${Math.round(liveFrame!.pitch)} Hz`
              : '-- Hz'}
          </Text>
        </View>

        <View style={styles.liveMetricsRow}>
          <View style={styles.liveMetric}>
            <Text style={styles.liveMetricLabel}>
              TARGET
            </Text>

            <Text style={styles.liveMetricValue}>
              {currentTargetNote?.name ?? '--'}
            </Text>
          </View>

          <View style={styles.liveMetric}>
            <Text style={styles.liveMetricLabel}>
              YOUR NOTE
            </Text>

            <Text style={styles.liveMetricValue}>
              {liveFrame?.note ?? '--'}
            </Text>
          </View>

          <View style={styles.liveMetric}>
            <Text style={styles.liveMetricLabel}>
              NOTE
            </Text>

            <Text style={styles.liveMetricValue}>
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

            <View style={styles.recordingNoteChipContainer}>
              {currentPattern?.notes.map((note, index) => (
                <View
                  key={`${note.name}-${index}`}
                  style={[
                    styles.recordingNoteChip,
                    index === currentNoteIndex &&
                      styles.recordingNoteChipActive,
                  ]}
                >
                  <Text style={styles.recordingNoteText}>
                    {note.name}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        }
        progress={progress}
        onBack={goToExercises}
      />
    );
  }

  /*
   * Processing phase.
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
   * Results phase.
   */
  if (phase === 'results' && result) {
    return (
      <ExerciseResultsScreen
        title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
        subtitle={
          result.passed
            ? 'You completed all repetitions successfully.'
            : 'Review your results and try again to improve your accuracy.'
        }
        score={result.score}
        resultIcon={
          result.passed ? 'checkmark' : 'refresh-outline'
        }
        scoreDetails={
          <View style={styles.scoreDetailsContainer}>
            <View style={styles.scoreDetailRow}>
              <Text style={styles.scoreDetailLabel}>
                Repetitions completed
              </Text>

              <Text style={styles.scoreDetailValue}>
                {result.repetitionsCompleted}/{params.repetitions}
              </Text>
            </View>
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
        <View style={styles.resultsCard}>
          <Text style={styles.resultsCardTitle}>
            Pattern Results
          </Text>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>
              Pattern length
            </Text>

            <Text style={styles.resultValue}>
              {params.noteCount} notes
            </Text>
          </View>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>
              Pattern accuracy
            </Text>

            <Text style={styles.resultValue}>
              {Math.round(result.patternAccuracy)}%
            </Text>
          </View>

          <View style={[styles.resultRow, styles.resultRowLast]}>
            <Text style={styles.resultLabel}>
              Rhythm accuracy
            </Text>

            <Text style={styles.resultValue}>
              {Math.round(result.rhythmAccuracy)}%
            </Text>
          </View>
        </View>

        <View style={styles.resultsCard}>
          <Text style={styles.resultsCardTitle}>
            Repetition Scores
          </Text>

          {result.repetitionScores.map((score, index) => (
            <View
              key={`repetition-${index}`}
              style={[
                styles.scoreListRow,
                index === result.repetitionScores.length - 1 &&
                  styles.scoreListRowLast,
              ]}
            >
              <Text style={styles.resultLabel}>
                Repetition {index + 1}
              </Text>

              <Text style={styles.resultValue}>
                {score}%
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.resultsCard}>
          <Text style={styles.resultsCardTitle}>
            Note Results
          </Text>

          {result.noteAccuracies.map((accuracy, index) => (
            <View
              key={`note-${index}`}
              style={[
                styles.scoreListRow,
                index === result.noteAccuracies.length - 1 &&
                  styles.scoreListRowLast,
              ]}
            >
              <Text style={styles.resultLabel}>
                Note {index + 1}
              </Text>

              <Text style={styles.resultValue}>
                {Math.round(accuracy)}%
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.targetPatternCard}>
          <Text style={styles.resultsCardTitle}>
            Target Pattern
          </Text>

          <View style={styles.targetNoteChipContainer}>
            {currentPattern?.notes.map((note, index) => (
              <View
                key={`${note.name}-${index}`}
                style={styles.targetNoteChip}
              >
                <Text style={styles.targetNoteText}>
                  {note.name}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.tipCard}>
          <Ionicons
            name="bulb-outline"
            size={21}
            color="#4E2F1F"
          />

          <Text style={styles.tipText}>
            Focus on keeping each note accurate and
            maintaining the same melodic order throughout
            every repetition.
          </Text>
        </View>
      </ExerciseResultsScreen>
    );
  }

  return null;
}

/*
 * All styles for MelodicPatternMatchingScreen.
 */
const styles = StyleSheet.create({
  // ADS loading screen
  loadingScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  loadingIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  loadingTitle: {
    color: '#4E2F1F',
    fontSize: 25,
    fontFamily: 'FredokaBold',
    textAlign: 'center',
  },
  loadingSubtitle: {
    color: '#8E7770',
    fontSize: 15,
    fontFamily: 'FredokaRegular',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 22,
  },
  loadingSpinner: {
    marginTop: 28,
  },

  // Reference melody playback
  playingScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  playingIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  playingTitle: {
    color: '#4E2F1F',
    fontSize: 26,
    fontFamily: 'FredokaBold',
    textAlign: 'center',
  },
  playingSubtitle: {
    color: '#8E7770',
    fontSize: 15,
    fontFamily: 'FredokaRegular',
    textAlign: 'center',
    marginTop: 6,
  },
  playingDescription: {
    color: '#8E7770',
    fontSize: 14,
    fontFamily: 'FredokaRegular',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 320,
    lineHeight: 21,
  },
  noteChipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 26,
  },
  playingNoteChip: {
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
  playingNoteText: {
    color: '#4E2F1F',
    fontSize: 14,
    fontFamily: 'FredokaSemiBold',
  },
  playingSpinner: {
    marginTop: 28,
  },

  // Live pitch display
  livePitchContainer: {
    alignItems: 'center',
    marginBottom: 18,
  },
  livePitchNote: {
    color: '#4E2F1F',
    fontSize: 40,
    fontFamily: 'FredokaBold',
  },
  livePitchFrequency: {
    color: '#8E7770',
    fontSize: 13,
    fontFamily: 'FredokaRegular',
    marginTop: 3,
  },
  liveMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F2DDE5',
    paddingTop: 14,
  },
  liveMetric: {
    flex: 1,
    alignItems: 'center',
  },
  liveMetricLabel: {
    color: '#8E7770',
    fontSize: 11,
    fontFamily: 'FredokaRegular',
    textAlign: 'center',
  },
  liveMetricValue: {
    color: '#4E2F1F',
    fontSize: 14,
    fontFamily: 'FredokaSemiBold',
    marginTop: 3,
    textAlign: 'center',
  },

  // Note sequence during recording
  recordingNoteChipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
  },
  recordingNoteChip: {
    minWidth: 44,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F2DDE5',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  recordingNoteChipActive: {
    backgroundColor: '#FCD6DD',
  },
  recordingNoteText: {
    color: '#4E2F1F',
    fontSize: 13,
    fontFamily: 'FredokaSemiBold',
  },

  // Results summary
  scoreDetailsContainer: {
    width: '100%',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F2DDE5',
  },
  scoreDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  scoreDetailLabel: {
    color: '#8E7770',
    fontSize: 13,
    fontFamily: 'FredokaRegular',
  },
  scoreDetailValue: {
    color: '#4E2F1F',
    fontSize: 13,
    fontFamily: 'FredokaSemiBold',
  },

  // Results cards
  resultsCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F2DDE5',
    borderRadius: 18,
    padding: 17,
    marginBottom: 14,
  },
  resultsCardTitle: {
    color: '#4E2F1F',
    fontSize: 17,
    fontFamily: 'FredokaBold',
    marginBottom: 8,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2DDE5',
  },
  resultRowLast: {
    borderBottomWidth: 0,
  },
  resultLabel: {
    color: '#8E7770',
    fontSize: 13,
    fontFamily: 'FredokaRegular',
  },
  resultValue: {
    color: '#4E2F1F',
    fontSize: 14,
    fontFamily: 'FredokaSemiBold',
  },
  scoreListRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 42,
    borderBottomWidth: 1,
    borderBottomColor: '#F2DDE5',
  },
  scoreListRowLast: {
    borderBottomWidth: 0,
  },

  // Target pattern
  targetPatternCard: {
    backgroundColor: '#FFF8FA',
    borderWidth: 1,
    borderColor: '#F2DDE5',
    borderRadius: 18,
    padding: 17,
    marginBottom: 14,
  },
  targetNoteChipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  targetNoteChip: {
    minWidth: 48,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F2DDE5',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  targetNoteText: {
    color: '#4E2F1F',
    fontSize: 14,
    fontFamily: 'FredokaSemiBold',
  },

  // Practice tip
  tipCard: {
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