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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  SUSTAINED_NOTE_STABILITY_PARAMS,
  type SustainedNoteStabilityParams,
  type Tier,
} from '@/constants/exercises/pitch';

import {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
} from '@/screens/exercises/ExerciseScreen';

import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';

import {
  measureSustainedNoteStability,
  type SustainedNoteStabilityMeasurement,
} from '@/services/measurement/pitch/sustainedNoteStability';

import {
  scoreSustainedNoteStabilityRepetitions,
  type SustainedNoteStabilityScoreResult,
} from '@/services/scoring/pitch/sustainedNoteStability';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { getLatestAssessment } from '@/services/assessment/assessmentRepository';

import { generateSustainedNoteStabilityParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  createMusicalNote,
  getRandomPitchNote,
} from '@/utils/music/notes';

import { playSingleNote } from '@/utils/music/notePlayer';

import {
  calcLiveStability,
  calcPitchAccuracy,
} from '@/utils/dsp/pitch';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const EXERCISE_ID = 'sustainedNoteStability' as const;
const COMPONENT_ID = 'pitch' as const;
const RECORDING_INTERVAL_MS = 100;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'preparing'
  | 'countdown'
  | 'playing'
  | 'recording'
  | 'processing'
  | 'results';

type MusicalNote = ReturnType<typeof createMusicalNote>;

export default function SustainedNoteStabilityScreen({
  tier,
}: Props) {
  const [currentTier, setCurrentTier] = useState<Tier>(
    tier ?? 'beginner',
  );

  const [params, setParams] =
    useState<SustainedNoteStabilityParams>(
      SUSTAINED_NOTE_STABILITY_PARAMS[tier ?? 'beginner'],
    );

  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(3);
  const [currentRep, setCurrentRep] = useState(1);

  const [targetNote, setTargetNote] = useState<MusicalNote>(
    () => createMusicalNote(60),
  );

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [liveFrequencies, setLiveFrequencies] =
    useState<number[]>([]);

  const [elapsedMs, setElapsedMs] = useState(0);

  const [result, setResult] =
    useState<SustainedNoteStabilityScoreResult | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const mountedRef = useRef(true);
  const recordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const processingRef = useRef(false);
  const discardRecordingRef = useRef(false);

  const elapsedRef = useRef(0);
  const currentRepRef = useRef(1);

  const measurementsRef =
    useRef<SustainedNoteStabilityMeasurement[]>([]);

  const pitchHistoryRef = useRef<number[]>([]);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  // Store recorder methods in refs so callbacks can safely use them
  // without referencing variables declared later in the component.
  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const stopRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const playTargetAndRecordRef =
    useRef<((note: MusicalNote) => Promise<void>) | null>(null);

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

  const resetLiveMeasurements = useCallback(() => {
    pitchHistoryRef.current = [];
    setLiveFrequencies([]);
    setLiveFrame(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
  }, []);

  // Load the user's current tier and adaptive exercise parameters.
  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParams = async () => {
      setIsLoadingAdaptiveParams(true);

      let resolvedTier: Tier = tier ?? 'beginner';

      try {
        const { auth } = await import('@/services/firebase/config');
        const user = auth.currentUser;

        if (!tier && user) {
          const progress = await fetchComponentProgress(
            user.uid,
            COMPONENT_ID,
          );

          resolvedTier = progress?.currentTier ?? 'beginner';
        }

        if (cancelled) return;

        setCurrentTier(resolvedTier);

        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            COMPONENT_ID,
          );

          const matchingRecords = records
            .filter(
              record =>
                record.tier === resolvedTier &&
                record.templateId === EXERCISE_ID,
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          recentScores = matchingRecords
            .slice(-5)
            .map(record => record.scorePct);
        }

        // Use the assessment only when no matching exercise history exists.
        if (recentScores.length === 0) {
          const assessment = await getLatestAssessment();

          const pitchScore = assessment?.scores.find(
            score => score.componentId === COMPONENT_ID,
          );

          if (pitchScore) {
            recentScores = [pitchScore.scorePct];
          }
        }

        const generatedParams =
          generateSustainedNoteStabilityParams({
            tier: resolvedTier,
            recentScores,
          });

        if (cancelled) return;

        setParams(generatedParams);
      } catch (error) {
        console.error(
          'Failed to load sustained note adaptive parameters:',
          error,
        );

        if (!cancelled) {
          setCurrentTier(resolvedTier);
          setParams(
            SUSTAINED_NOTE_STABILITY_PARAMS[resolvedTier],
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
        }
      }
    };

    void loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  // Clean up timers and stop the microphone when leaving the screen.
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      clearCountdownTimer();
      clearRecordingTimer();

      if (recordingRef.current) {
        void stopRecordingRef.current?.().catch(error => {
          console.error(
            'Failed to stop recording during cleanup:',
            error,
          );
        });
      }
    };
  }, [clearCountdownTimer, clearRecordingTimer]);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (!mountedRef.current) return;

    setLiveFrame(frame);

    if (Number.isFinite(frame.pitch) && frame.pitch > 0) {
      pitchHistoryRef.current = [
        ...pitchHistoryRef.current,
        frame.pitch,
      ].slice(-30);

      setLiveFrequencies(pitchHistoryRef.current);
    }
  }, []);

  const beginRecording = useCallback(async () => {
    if (
      !mountedRef.current ||
      recordingRef.current ||
      processingRef.current
    ) {
      return;
    }

    try {
      resetLiveMeasurements();

      stopRequestedRef.current = false;
      discardRecordingRef.current = false;

      setPhase('recording');

      const start = startRecordingRef.current;

      if (!start) {
        throw new Error('Audio recorder is not ready.');
      }

      await start();

      if (!mountedRef.current) {
        // The screen was unmounted while the microphone was starting.
        void stopRecordingRef.current?.().catch(error => {
          console.error(
            'Failed to stop recording after unmount:',
            error,
          );
        });

        return;
      }

      recordingRef.current = true;

      const durationMs = params.durationSec * 1000;

      clearRecordingTimer();

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          !recordingRef.current ||
          stopRequestedRef.current
        ) {
          return;
        }

        elapsedRef.current += RECORDING_INTERVAL_MS;
        setElapsedMs(elapsedRef.current);

        if (elapsedRef.current < durationMs) return;

        clearRecordingTimer();

        if (stopRequestedRef.current) return;

        stopRequestedRef.current = true;

        const stop = stopRecordingRef.current;

        if (!stop) {
          recordingRef.current = false;
          stopRequestedRef.current = false;

          setErrorMessage(
            'The microphone could not be stopped. Please try again.',
          );
          setPhase('instructions');
          return;
        }

        void stop().catch(error => {
          console.error(
            'Failed to stop sustained note recording:',
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
      }, RECORDING_INTERVAL_MS);
    } catch (error) {
      console.error('Failed to start sustained note recording:', error);

      recordingRef.current = false;
      stopRequestedRef.current = false;

      if (mountedRef.current) {
        setPhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    }
  }, [
    clearRecordingTimer,
    params.durationSec,
    resetLiveMeasurements,
  ]);

  const playTargetAndRecord = useCallback(
    async (note: MusicalNote) => {
      if (!mountedRef.current) return;

      try {
        setPhase('playing');

        await playSingleNote(note.frequency, 1.5);

        if (!mountedRef.current) return;

        await beginRecording();
      } catch (error) {
        console.error('Failed to play target note:', error);

        if (mountedRef.current) {
          setPhase('instructions');

          Alert.alert(
            'Audio Error',
            'Unable to play the target note. Please try again.',
          );
        }
      }
    },
    [beginRecording],
  );

  // Keep the latest playback callback available to the stop handler.
  playTargetAndRecordRef.current = playTargetAndRecord;

  const handleRecordingStop = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      recordingRef.current = false;
      clearRecordingTimer();

      // A discarded recording must never be measured or saved.
      if (discardRecordingRef.current) {
        discardRecordingRef.current = false;
        stopRequestedRef.current = false;
        processingRef.current = false;
        return;
      }

      if (!mountedRef.current || processingRef.current) return;

      processingRef.current = true;

      try {
        const measurement = measureSustainedNoteStability(
          samples,
          sampleRate,
          params.minClarity,
        );

        measurementsRef.current = [
          ...measurementsRef.current,
          measurement,
        ];

        const completedReps = measurementsRef.current.length;

        if (completedReps < params.repetitions) {
          const nextRep = completedReps + 1;

          currentRepRef.current = nextRep;
          setCurrentRep(nextRep);

          resetLiveMeasurements();
          stopRequestedRef.current = false;
          processingRef.current = false;

          await playTargetAndRecordRef.current?.(targetNote);
          return;
        }

        setPhase('processing');

        const score = scoreSustainedNoteStabilityRepetitions(
          measurementsRef.current,
          params,
        );

        await saveCompletedExercise(
          COMPONENT_ID,
          EXERCISE_ID,
          currentTier,
          score.score,
        );

        if (!mountedRef.current) return;

        setResult(score);
        setPhase('results');
      } catch (error) {
        console.error(
          'Sustained note processing error:',
          error,
        );

        if (mountedRef.current) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          setPhase('instructions');
        }
      } finally {
        processingRef.current = false;
        stopRequestedRef.current = false;
      }
    },
    [
      clearRecordingTimer,
      currentTier,
      params,
      resetLiveMeasurements,
      targetNote,
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

  // Assign the recorder methods after the hook declares them.
  // Callbacks use these refs, avoiding use-before-declaration errors.
  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;

    return () => {
      startRecordingRef.current = null;
      stopRecordingRef.current = null;
    };
  }, [startRecording, stopRecording]);

  const startCountdown = useCallback(() => {
    if (isLoadingAdaptiveParams) return;

    clearCountdownTimer();

    const generatedNote = getRandomPitchNote(currentTier);

    setTargetNote(generatedNote);
    setResult(null);
    setErrorMessage(null);

    setCurrentRep(1);
    currentRepRef.current = 1;

    measurementsRef.current = [];
    resetLiveMeasurements();

    processingRef.current = false;
    stopRequestedRef.current = false;
    discardRecordingRef.current = false;
    recordingRef.current = false;

    let value = 3;

    setCountdown(value);
    setPhase('countdown');

    countdownTimerRef.current = setInterval(() => {
      value -= 1;

      if (value > 0) {
        setCountdown(value);
        return;
      }

      clearCountdownTimer();
      setCountdown(0);

      void playTargetAndRecordRef.current?.(generatedNote);
    }, 1000);
  }, [
    clearCountdownTimer,
    currentTier,
    isLoadingAdaptiveParams,
    resetLiveMeasurements,
  ]);

  const retry = useCallback(() => {
    clearCountdownTimer();
    clearRecordingTimer();

    setResult(null);
    setErrorMessage(null);

    setCurrentRep(1);
    currentRepRef.current = 1;

    measurementsRef.current = [];
    resetLiveMeasurements();

    processingRef.current = false;
    stopRequestedRef.current = false;
    discardRecordingRef.current = false;
    recordingRef.current = false;

    setCountdown(3);
    setPhase('instructions');
  }, [
    clearCountdownTimer,
    clearRecordingTimer,
    resetLiveMeasurements,
  ]);

  const durationMs = params.durationSec * 1000;

  const progress =
    durationMs > 0
      ? Math.min(1, elapsedMs / durationMs)
      : 0;

  const liveAccuracy =
    liveFrame && liveFrame.pitch > 0
      ? Math.max(
          0,
          calcPitchAccuracy(
            liveFrame.pitch,
            targetNote.frequency,
          ),
        )
      : 0;

  const liveStability = calcLiveStability(liveFrequencies);

  if (
    phase === 'preparing' ||
    (phase === 'instructions' && isLoadingAdaptiveParams)
  ) {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.iconCircle}>
          <Ionicons
            name="musical-notes-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text style={styles.title}>Preparing Your Exercise</Text>

        <Text style={styles.phaseSubtitle}>
          Setting up your personalized exercise...
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.loadingIndicator}
        />
      </View>
    );
  }

  if (phase === 'instructions') {
    return (
      <View style={styles.screen}>
        <Pressable
          style={styles.backButton}
          onPress={() =>
            router.replace('/dashboard?tab=exercises')
          }
        >
          <Ionicons name="arrow-back" size={22} color={BROWN} />
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.iconCircle}>
            <Ionicons
              name="radio-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.title}>
            Sustained Note Stability
          </Text>

          <Text style={styles.subtitle}>Pitch</Text>

          <View style={styles.instructionCard}>
            <Text style={styles.cardTitle}>
              Exercise Instructions
            </Text>

            <Text style={styles.instruction}>
              Listen to the reference note before each recording.
            </Text>

            <Text style={styles.instruction}>
              Sing the same comfortable note and hold it steadily
              for {params.durationSec} seconds.
            </Text>

            <Text style={styles.instruction}>
              Complete {params.repetitions} repetitions while
              keeping your pitch steady without drifting sharp
              or flat.
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
                  Find a quiet room or area with minimal
                  background noise.
                </Text>
              </View>

              <View style={styles.prepareItem}>
                <Ionicons
                  name="body-outline"
                  size={17}
                  color={BROWN}
                />
                <Text style={styles.prepareText}>
                  Sit upright or stand with your back straight
                  and your shoulders relaxed.
                </Text>
              </View>

              <View style={styles.prepareItem}>
                <Ionicons
                  name="mic-outline"
                  size={17}
                  color={BROWN}
                />
                <Text style={styles.prepareText}>
                  Sing toward the microphone for clearer
                  audio capture.
                </Text>
              </View>
            </View>

            <View style={styles.targetBox}>
              <Ionicons name="remove" size={25} color={BROWN} />
              <Text style={styles.targetText}>
                Keep the note steady
              </Text>
            </View>

            <Text style={styles.helperText}>
              TuneUp! measures pitch stability across all
              repetitions.
            </Text>
          </View>

          <View style={styles.tipCard}>
            <Ionicons name="bulb-outline" size={21} color={BROWN} />
            <Text style={styles.tipText}>
              Avoid intentionally changing pitch. Focus on
              maintaining one relaxed, consistent note.
            </Text>
          </View>

          <View style={styles.difficultyRow}>
            <Text style={styles.difficultyLabel}>Difficulty</Text>
            <Text style={styles.difficultyValue}>
              {currentTier}
            </Text>
          </View>

          <Pressable
            style={[
              styles.startButton,
              isLoadingAdaptiveParams && styles.disabledButton,
            ]}
            onPress={startCountdown}
            disabled={isLoadingAdaptiveParams}
          >
            {isLoadingAdaptiveParams ? (
              <ActivityIndicator size="small" color={WHITE} />
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
            <Text style={styles.errorText}>{errorMessage}</Text>
          )}
        </ScrollView>
      </View>
    );
  }

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="musical-notes-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={params.repetitions}
        countdown={countdown}
        promptTitle="Get ready"
        prompt="A reference note will play next."
        onBack={() =>
          router.replace('/dashboard?tab=exercises')
        }
      />
    );
  }

  if (phase === 'playing') {
    return (
      <ExerciseListeningScreen
        icon="volume-high-outline"
        title="Listen Carefully"
        currentRep={currentRep}
        repetitions={params.repetitions}
        promptTitle="Listen to the reference note"
        prompt="Listen to the reference note, then sing it steadily."
        liveContent={
          <View style={styles.targetCard}>
            <Text style={styles.targetLabel}>TARGET NOTE</Text>
            <Text style={styles.targetNote}>{targetNote.name}</Text>
            <Text style={styles.targetFrequency}>
              {Math.round(targetNote.frequency)} Hz
            </Text>
          </View>
        }
        onBack={() =>
          router.replace('/dashboard?tab=exercises')
        }
      />
    );
  }

  if (phase === 'recording') {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.recordingContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.recordingIcon}>
          <Ionicons name="mic" size={34} color={BROWN} />
        </View>

        <Text style={styles.phaseTitle}>
          Hold {targetNote.name}
        </Text>

        <Text style={styles.phaseSubtitle}>
          Repetition {currentRep} of {params.repetitions}
        </Text>

        <Text style={styles.phaseSubtitle}>
          Keep your pitch as steady as possible.
        </Text>

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>Target</Text>
          <Text style={styles.liveTarget}>{targetNote.name}</Text>

          <View style={styles.liveDivider} />

          <Text style={styles.liveLabel}>Your Note</Text>
          <Text style={styles.liveNote}>
            {liveFrame?.note ?? '--'}
          </Text>

          <Text style={styles.liveFrequency}>
            {liveFrame && liveFrame.pitch > 0
              ? `${Math.round(liveFrame.pitch)} Hz`
              : '--'}
          </Text>

          <View style={styles.liveStats}>
            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>Accuracy</Text>
              <Text style={styles.liveStatValue}>
                {Math.round(liveAccuracy)}%
              </Text>
            </View>

            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>Stability</Text>
              <Text style={styles.liveStatValue}>
                {Math.round(liveStability)}%
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>

          <Text style={styles.progressText}>
            {(elapsedMs / 1000).toFixed(1)}s / {params.durationSec}s
          </Text>
        </View>

        <View style={styles.recordingIndicator}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>
            {isRecording
              ? 'Recording...'
              : 'Preparing microphone...'}
          </Text>
        </View>
      </ScrollView>
    );
  }

  if (phase === 'processing') {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your Singing"
        message="Measuring your pitch stability across all repetitions."
        onBack={() =>
          router.replace('/dashboard?tab=exercises')
        }
      />
    );
  }

  if (phase === 'results' && result) {
    return (
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
            Sustained Note Stability Result
          </Text>

          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>Overall Score</Text>
            <Text style={styles.scoreValue}>{result.score}%</Text>
            <Text style={styles.scoreDescription}>
              {result.passed
                ? 'Your pitch stability reached the target level across all repetitions.'
                : 'Focus on keeping your pitch steadier and maintaining the required duration across repetitions.'}
            </Text>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>Target Note</Text>
            <View style={styles.noteDisplay}>
              <Text style={styles.resultNote}>{targetNote.name}</Text>
              <Text style={styles.resultFrequency}>
                {Math.round(targetNote.frequency)} Hz
              </Text>
            </View>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>
              Repetition Results
            </Text>

            <ResultRow
              label="Repetitions completed"
              value={`${result.repetitionsCompleted} / ${params.repetitions}`}
            />
            <ResultRow
              label="Average score"
              value={`${result.score}%`}
            />
            <ResultRow
              label="Average pitch variation"
              value={`${result.stabilityCents.toFixed(1)} cents`}
            />
            <ResultRow
              label="Required stability"
              value={`≤ ${params.stabilityThresholdCents} cents`}
            />
            <ResultRow
              label="Average duration"
              value={`${result.durationSec.toFixed(1)} s`}
            />
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>
              Scores by Repetition
            </Text>

            {result.repetitionScores.map(
              (repetitionScore, index) => (
                <ResultRow
                  key={`repetition-${index}`}
                  label={`Repetition ${index + 1}`}
                  value={`${repetitionScore}%`}
                />
              ),
            )}
          </View>

          <View style={styles.tipCard}>
            <Ionicons name="bulb-outline" size={21} color={BROWN} />
            <Text style={styles.tipText}>
              {result.passed
                ? 'Nice work! Continue practicing sustained notes to build consistent pitch control across repetitions.'
                : 'Try relaxing your throat and supporting the note with steady breath while avoiding unnecessary pitch movement.'}
            </Text>
          </View>

          <Pressable style={styles.startButton} onPress={retry}>
            <Text style={styles.startButtonText}>Try Again</Text>
            <Ionicons name="refresh" size={18} color={WHITE} />
          </Pressable>

          <Pressable
            style={styles.doneButton}
            onPress={() =>
              router.replace('/dashboard?tab=exercises')
            }
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return null;
}

function ResultRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultRowLabel}>{label}</Text>
      <Text style={styles.resultRowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 50,
    paddingBottom: 40,
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

  instructionCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
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
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },

  disabledButton: {
    opacity: 0.7,
  },

  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 12,
  },

  loadingIndicator: {
    marginTop: 20,
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

  targetCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    padding: 24,
    marginTop: 28,
  },

  targetLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.5,
  },

  targetNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    marginTop: 4,
  },

  targetFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },

  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    marginTop: 25,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  liveTarget: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    marginTop: 3,
  },

  liveDivider: {
    width: '70%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },

  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 3,
  },

  liveFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },

  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 18,
  },

  liveStat: {
    alignItems: 'center',
  },

  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginTop: 2,
  },

  progressContainer: {
    width: '100%',
    marginTop: 22,
    alignItems: 'center',
  },

  progressTrack: {
    width: '100%',
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 5,
  },

  progressText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 7,
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
    backgroundColor: BROWN,
    marginRight: 7,
  },

  recordingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

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
    textAlign: 'center',
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

  noteDisplay: {
    alignItems: 'center',
    paddingVertical: 4,
  },

  resultNote: {
    fontFamily: 'FredokaBold',
    fontSize: 31,
    color: BROWN,
  },

  resultFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
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
    flexShrink: 0,
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
});