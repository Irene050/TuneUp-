
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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  RAPID_NOTE_TRANSITION_PARAMS,
  type Tier,
} from '@/constants/exercises/agility';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  measureRapidNoteTransition,
} from '@/services/measurement/agility/rapidNoteTransitionExercise';

import {
  scoreRapidNoteTransition,
} from '@/services/scoring/agility/rapidNoteTransitionExercise';

import {
  disposeNotePlayer,
  playNoteSequence,
  type NoteToPlay,
} from '@/utils/music/notePlayer';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  createMusicalNote,
} from '@/utils/music/notes';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { auth } from '@/services/firebase/config';

import {
  generateRapidNoteTransitionParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

// ============================================================
// COLORS AND CONFIGURATION
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const COUNTDOWN_SECONDS = 3;
const MAX_RECORDING_SECONDS = 10;

// ============================================================
// TYPES
// ============================================================

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

type LiveState = {
  pitch: number;
  note: string;
  clarity: number;
};

type ExerciseSequence = {
  notes: NoteToPlay[];
  frequencies: number[];
  names: string[];
};

type AttemptResult = {
  repetition: number;
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
  transitionCount: number;
  transitionsPerSecond: number;
  averageTransitionTimeMs: number;
};

type ExerciseResult = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
  transitionCount: number;
  transitionsPerSecond: number;
  averageTransitionTimeMs: number;
  attempts: AttemptResult[];
};

// ============================================================
// HELPERS
// ============================================================

function getRandomInteger(
  min: number,
  max: number,
): number {
  return (
    Math.floor(Math.random() * (max - min + 1)) +
    min
  );
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function average(
  values: number[],
): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

function generateExerciseSequence(
  minMidi: number,
  maxMidi: number,
  noteCount: number,
  noteDurationSeconds: number,
): ExerciseSequence {
  const midiNotes: number[] = [];

  for (let index = 0; index < noteCount; index += 1) {
    let midi = getRandomInteger(minMidi, maxMidi);

    // Avoid identical consecutive notes.
    if (
      index > 0 &&
      midi === midiNotes[index - 1]
    ) {
      if (midi === maxMidi) {
        midi -= 1;
      } else {
        midi += 1;
      }
    }

    midiNotes.push(midi);
  }

  const musicalNotes = midiNotes.map(createMusicalNote);

  return {
    notes: musicalNotes.map(note => ({
      frequencyHz: note.frequency,
      durationSec: noteDurationSeconds,
    })),

    frequencies: musicalNotes.map(
      note => note.frequency,
    ),

    names: musicalNotes.map(note => note.name),
  };
}

// ============================================================
// COMPONENT
// ============================================================

export default function RapidNoteTransitionExerciseScreen({
  tier = 'beginner',
}: Props) {
  // ----------------------------------------------------------
  // BASE PARAMETERS
  // ----------------------------------------------------------

  const baseParams = useMemo(
    () => RAPID_NOTE_TRANSITION_PARAMS[tier],
    [tier],
  );

  // ----------------------------------------------------------
  // ADAPTIVE PARAMETERS
  // ----------------------------------------------------------

  const [adaptiveParams, setAdaptiveParams] =
    useState(baseParams);

  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParams = async () => {
      setIsLoadingAdaptiveParams(true);

      try {
        const user = auth.currentUser;

        if (!user) {
          if (!cancelled) {
            setAdaptiveParams(baseParams);
          }

          return;
        }

        const exerciseRecords = await fetchExerciseRecords(
          user.uid,
          'agility',
        );

        if (cancelled) {
          return;
        }

        // Use only this exercise's records at the current tier.
        const matchingExerciseRecords = exerciseRecords
          .filter(
            record =>
              record.templateId === 'rapidNoteTransition' &&
              record.tier === tier,
          )
          .sort((a, b) => a.timestamp - b.timestamp);

        // Use up to five recent scores when exercise history exists.
        let recentScores = matchingExerciseRecords
          .slice(-5)
          .map(record => record.scorePct);

        // Assessment is only a cold-start fallback.
        if (matchingExerciseRecords.length === 0) {
          const latestAssessment = await getLatestAssessment();

          if (latestAssessment && !cancelled) {
            const agilityScore =
              latestAssessment.scores.find(
                score => score.componentId === 'agility',
              )?.scorePct;

            if (
              typeof agilityScore === 'number' &&
              Number.isFinite(agilityScore)
            ) {
              recentScores = [agilityScore];
            }
          }
        }

        if (cancelled) {
          return;
        }

        const generatedParams =
          generateRapidNoteTransitionParams({
            tier,
            recentScores,
          });

        console.log(
          'Rapid Note Transition ADS parameters:',
          {
            tier,
            recentScores,
            baseParams,
            generatedParams,
          },
        );

        setAdaptiveParams(generatedParams);
      } catch (error) {
        console.error(
          'Failed to load Rapid Note Transition ADS parameters:',
          error,
        );

        if (!cancelled) {
          setAdaptiveParams(baseParams);
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
  }, [baseParams, tier]);

  // ----------------------------------------------------------
  // EXERCISE CONFIGURATION
  // ----------------------------------------------------------

  const exerciseConfig = useMemo(() => {
    const noteCount = getRandomInteger(
      adaptiveParams.minNotes,
      adaptiveParams.maxNotes,
    );

    return {
      noteCount,

      targetSpeed:
        adaptiveParams.minSpeed +
        Math.random() *
          (adaptiveParams.maxSpeed - adaptiveParams.minSpeed),

      repetitions: adaptiveParams.repetitions,

      accuracyThreshold: adaptiveParams.accuracyThreshold,

      sequence: generateExerciseSequence(
        adaptiveParams.minMidi,
        adaptiveParams.maxMidi,
        noteCount,
        adaptiveParams.noteDurationSec,
      ),
    };
  }, [adaptiveParams]);

  // ----------------------------------------------------------
  // SCREEN STATE
  // ----------------------------------------------------------

  const [screenState, setScreenState] =
    useState<Screen>('instructions');

  const screenRef = useRef<Screen>('instructions');

  const setScreen = useCallback((nextScreen: Screen) => {
    screenRef.current = nextScreen;
    setScreenState(nextScreen);
  }, []);

  const screen = screenState;

  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);

  const [elapsedSeconds, setElapsedSeconds] =
    useState(0);

  const [currentRepetition, setCurrentRepetition] =
    useState(1);

  const [attemptResults, setAttemptResults] =
    useState<AttemptResult[]>([]);

  const [liveTransitionCount, setLiveTransitionCount] =
    useState(0);

  const [liveTransitionSpeed, setLiveTransitionSpeed] =
    useState(0);

  const [livePitch, setLivePitch] =
    useState<LiveState>({
      pitch: 0,
      note: '--',
      clarity: 0,
    });

  const [result, setResult] =
    useState<ExerciseResult | null>(null);

  const [errorMessage, setErrorMessage] = useState('');

  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------

  const mountedRef = useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingStartRef = useRef<number | null>(null);

  const previousPitchRef = useRef(0);

  const transitionCountRef = useRef(0);

  const finishingRef = useRef(false);

  const playingSequenceRef = useRef(false);

  const referenceStartedRef = useRef(false);

  // Keep completed attempts available to async callbacks.
  const attemptResultsRef = useRef<AttemptResult[]>([]);

  // ----------------------------------------------------------
  // TIMER CLEANUP
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // RESET LIVE STATE
  // ----------------------------------------------------------

  const resetLiveState = useCallback(() => {
    previousPitchRef.current = 0;
    transitionCountRef.current = 0;
    recordingStartRef.current = null;
    finishingRef.current = false;

    setLiveTransitionCount(0);
    setLiveTransitionSpeed(0);
    setElapsedSeconds(0);

    setLivePitch({
      pitch: 0,
      note: '--',
      clarity: 0,
    });
  }, []);

  // ----------------------------------------------------------
  // LIVE AUDIO FRAME
  // ----------------------------------------------------------

  const handleLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (
        !mountedRef.current ||
        screenRef.current !== 'recording'
      ) {
        return;
      }

      setLivePitch({
        pitch: frame.pitch,
        note: frame.note || '--',
        clarity: frame.clarity,
      });

      if (
        !Number.isFinite(frame.pitch) ||
        frame.pitch <= 0
      ) {
        return;
      }

      const previousPitch = previousPitchRef.current;

      if (
        previousPitch > 0 &&
        Number.isFinite(previousPitch)
      ) {
        const semitoneChange =
          12 * Math.log2(frame.pitch / previousPitch);

        if (
          Number.isFinite(semitoneChange) &&
          Math.abs(semitoneChange) >= 1
        ) {
          transitionCountRef.current += 1;

          setLiveTransitionCount(
            transitionCountRef.current,
          );
        }
      }

      previousPitchRef.current = frame.pitch;

      if (recordingStartRef.current !== null) {
        const elapsed =
          (Date.now() - recordingStartRef.current) / 1000;

        if (elapsed > 0) {
          setLiveTransitionSpeed(
            transitionCountRef.current / elapsed,
          );
        }
      }
    },
    [],
  );

  // ----------------------------------------------------------
  // PROCESS COMPLETED RECORDING
  // ----------------------------------------------------------

  const handleRecordingStop = useCallback(
    async (
      samples: Float32Array,
      sampleRate: number,
    ) => {
      clearTimers();

      if (!mountedRef.current) {
        return;
      }

      setScreen('processing');

      try {
        if (!samples || samples.length === 0) {
          throw new Error(
            'No audio samples were recorded. Please try this repetition again.',
          );
        }

        if (
          !Number.isFinite(sampleRate) ||
          sampleRate <= 0
        ) {
          throw new Error(
            'The recording has an invalid sample rate. Please try again.',
          );
        }

        const measurement = measureRapidNoteTransition(
          samples,
          sampleRate,
          exerciseConfig.sequence.frequencies,
        );

        // Do not score an attempt with no usable transitions.
        if (
          measurement.detectedPitches.length < 2 ||
          measurement.detectedNotes.length < 2 ||
          measurement.transitionCount < 1
        ) {
          throw new Error(
            'Not enough clear note transitions were detected. Please try this repetition again in a quiet area.',
          );
        }

        // Keep the existing per-attempt scoring service unchanged.
        const scored = scoreRapidNoteTransition(
          measurement,
          exerciseConfig.targetSpeed,
          exerciseConfig.accuracyThreshold,
        );

        const repetitionResult: AttemptResult = {
          repetition: currentRepetition,
          overall: clampScore(scored.overall),
          pitchScore: clampScore(scored.pitchScore),
          sequenceScore: clampScore(scored.sequenceScore),
          speedScore: clampScore(scored.speedScore),
          passed: scored.passed,
          feedback: scored.feedback,
          transitionCount: measurement.transitionCount,
          transitionsPerSecond:
            measurement.transitionsPerSecond,
          averageTransitionTimeMs:
            measurement.averageTransitionTimeMs,
        };

        const updatedAttempts = [
          ...attemptResultsRef.current,
          repetitionResult,
        ];

        attemptResultsRef.current = updatedAttempts;
        setAttemptResults(updatedAttempts);

        console.log(
          `Rapid Note Transition repetition ${currentRepetition}/${exerciseConfig.repetitions} completed:`,
          repetitionResult,
        );

        if (!mountedRef.current) {
          return;
        }

        // ----------------------------------------------------
        // MORE REPETITIONS REMAIN
        // ----------------------------------------------------

        if (
          currentRepetition <
          exerciseConfig.repetitions
        ) {
          const nextRepetition = currentRepetition + 1;

          setCurrentRepetition(nextRepetition);

          // Reset per-attempt recording and live state.
          resetLiveState();

          referenceStartedRef.current = false;
          playingSequenceRef.current = false;

          setErrorMessage('');

          console.log(
            `Preparing repetition ${nextRepetition}/${exerciseConfig.repetitions}`,
          );

          // The countdown effect starts the next attempt.
          setScreen('countdown');
          return;
        }

        // ----------------------------------------------------
        // ALL REPETITIONS COMPLETED
        // ----------------------------------------------------

        const overall = Math.round(
          average(updatedAttempts.map(item => item.overall)),
        );

        const pitchScore = Math.round(
          average(updatedAttempts.map(item => item.pitchScore)),
        );

        const sequenceScore = Math.round(
          average(updatedAttempts.map(item => item.sequenceScore)),
        );

        const speedScore = Math.round(
          average(updatedAttempts.map(item => item.speedScore)),
        );

        const transitionCount = Math.round(
          average(
            updatedAttempts.map(item => item.transitionCount),
          ),
        );

        const transitionsPerSecond = average(
          updatedAttempts.map(
            item => item.transitionsPerSecond,
          ),
        );

        const averageTransitionTimeMs = average(
          updatedAttempts.map(
            item => item.averageTransitionTimeMs,
          ),
        );

        // The tier's configured accuracy goal is used for the
        // aggregate exercise result.
        const passed =
          overall >= exerciseConfig.accuracyThreshold &&
          pitchScore >= 60 &&
          sequenceScore >= 60;

        const feedback = passed
          ? `You completed all ${exerciseConfig.repetitions} repetitions and met the ${exerciseConfig.accuracyThreshold}% exercise goal. Keep practicing for smoother, more consistent transitions.`
          : `You completed all ${exerciseConfig.repetitions} repetitions. Your average score was ${overall}%, below the ${exerciseConfig.accuracyThreshold}% exercise goal. Focus on accurate notes before increasing speed.`;

        const finalResult: ExerciseResult = {
          overall,
          pitchScore,
          sequenceScore,
          speedScore,
          passed,
          feedback,
          transitionCount,
          transitionsPerSecond,
          averageTransitionTimeMs,
          attempts: updatedAttempts,
        };

        setResult(finalResult);

        try {
          await saveCompletedExercise(
            'agility',
            'rapidNoteTransition',
            tier,
            finalResult.overall,
          );
        } catch (error) {
          console.error(
            'Failed to save Rapid Note Transition result:',
            error,
          );
        }

        if (!mountedRef.current) {
          return;
        }

        setResult(finalResult);
        setScreen('results');
      } catch (error) {
        console.error(
          'Rapid Note Transition processing failed:',
          error,
        );

        if (!mountedRef.current) {
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'We could not analyze this recording. Please try again.',
        );

        // Return to instructions so the user can restart the set.
        setScreen('instructions');
      }
    },
    [
      clearTimers,
      currentRepetition,
      exerciseConfig.accuracyThreshold,
      exerciseConfig.repetitions,
      exerciseConfig.sequence.frequencies,
      resetLiveState,
      setScreen,
      tier,
    ],
  );

  // ----------------------------------------------------------
  // AUDIO RECORDER
  // ----------------------------------------------------------

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  // ----------------------------------------------------------
  // PLAY REFERENCE AND RECORD ONE REPETITION
  // ----------------------------------------------------------

  const playReferenceSequence = useCallback(
    async () => {
      if (
        playingSequenceRef.current ||
        referenceStartedRef.current
      ) {
        return;
      }

      referenceStartedRef.current = true;
      playingSequenceRef.current = true;

      clearTimers();

      try {
        if (!mountedRef.current) {
          return;
        }

        resetLiveState();

        console.log(
          `Playing reference for repetition ${currentRepetition}/${exerciseConfig.repetitions}`,
        );

        setScreen('listening');

        await playNoteSequence(
          exerciseConfig.sequence.notes,
        );

        if (!mountedRef.current) {
          return;
        }

        setScreen('recording');

        const recordingStartedAt = Date.now();

        await startRecording();

        if (!mountedRef.current) {
          return;
        }

        recordingStartRef.current = recordingStartedAt;

        let elapsed = 0;

        recordingTimerRef.current = setInterval(() => {
          if (!mountedRef.current) {
            return;
          }

          elapsed += 0.1;

          setElapsedSeconds(
            Math.min(elapsed, MAX_RECORDING_SECONDS),
          );

          if (elapsed >= MAX_RECORDING_SECONDS) {
            if (recordingTimerRef.current) {
              clearInterval(recordingTimerRef.current);
              recordingTimerRef.current = null;
            }

            if (!finishingRef.current) {
              finishingRef.current = true;
              void stopRecording();
            }
          }
        }, 100);
      } catch (error) {
        console.error(
          'Failed to play the reference or start recording:',
          error,
        );

        if (!mountedRef.current) {
          return;
        }

        setErrorMessage(
          'The reference sequence could not be played or the microphone could not be started. Please try again.',
        );

        setScreen('instructions');
      } finally {
        playingSequenceRef.current = false;
      }
    },
    [
      clearTimers,
      currentRepetition,
      exerciseConfig.repetitions,
      exerciseConfig.sequence.notes,
      resetLiveState,
      setScreen,
      startRecording,
      stopRecording,
    ],
  );

  // ----------------------------------------------------------
  // COUNTDOWN FOR EACH REPETITION
  // ----------------------------------------------------------

  useEffect(() => {
    if (screen !== 'countdown') {
      return;
    }

    clearTimers();

    setCountdown(COUNTDOWN_SECONDS);

    let remaining = COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;

      if (!mountedRef.current) {
        return;
      }

      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }

      clearTimers();
      setCountdown(0);

      void playReferenceSequence();
    }, 1000);

    return clearTimers;
  }, [
    screen,
    clearTimers,
    playReferenceSequence,
  ]);

  // ----------------------------------------------------------
  // UNMOUNT CLEANUP
  // ----------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      clearTimers();

      void disposeNotePlayer();
      void stopRecording();
    };
  }, [clearTimers, stopRecording]);

  // ----------------------------------------------------------
  // START / RESTART THE COMPLETE SET
  // ----------------------------------------------------------

  const startExercise = useCallback(() => {
    if (
      screenRef.current !== 'instructions' ||
      isLoadingAdaptiveParams
    ) {
      return;
    }

    clearTimers();
    resetLiveState();

    attemptResultsRef.current = [];
    setAttemptResults([]);

    referenceStartedRef.current = false;
    playingSequenceRef.current = false;

    setCurrentRepetition(1);
    setResult(null);
    setErrorMessage('');
    setCountdown(COUNTDOWN_SECONDS);

    setScreen('countdown');
  }, [
    clearTimers,
    isLoadingAdaptiveParams,
    resetLiveState,
    setScreen,
  ]);

  // ----------------------------------------------------------
  // FINISH CURRENT REPETITION
  // ----------------------------------------------------------

  const finishRecording = useCallback(async () => {
    if (
      finishingRef.current ||
      !isRecording ||
      screenRef.current !== 'recording'
    ) {
      return;
    }

    finishingRef.current = true;
    clearTimers();

    try {
      await stopRecording();
    } catch (error) {
      console.error(
        'Failed to stop the recording:',
        error,
      );

      if (!mountedRef.current) {
        return;
      }

      setErrorMessage(
        'We could not stop the recording. Please restart the exercise.',
      );

      setScreen('instructions');
    }
  }, [
    clearTimers,
    isRecording,
    setScreen,
    stopRecording,
  ]);

  // ----------------------------------------------------------
  // RETRY THE COMPLETE SET
  // ----------------------------------------------------------

  const retryExercise = useCallback(() => {
    clearTimers();
    resetLiveState();

    attemptResultsRef.current = [];
    setAttemptResults([]);

    referenceStartedRef.current = false;
    playingSequenceRef.current = false;

    setCurrentRepetition(1);
    setResult(null);
    setErrorMessage('');
    setCountdown(COUNTDOWN_SECONDS);

    setScreen('instructions');
  }, [
    clearTimers,
    resetLiveState,
    setScreen,
  ]);

  // ============================================================
  // REUSABLE NOTE SEQUENCE
  // ============================================================

  const renderNoteSequence = () => (
    <View style={styles.noteSequence}>
      {exerciseConfig.sequence.names.map((name, index) => (
        <View
          key={`${name}-${index}`}
          style={styles.notePill}
        >
          <Text style={styles.noteText}>{name}</Text>
        </View>
      ))}
    </View>
  );

  // ============================================================
  // INSTRUCTIONS
  // ============================================================

  const renderInstructions = () => (
    <View style={styles.content}>
      <Pressable
        style={styles.backButton}
        onPress={() => router.back()}
        hitSlop={10}
      >
        <Ionicons
          name="arrow-back"
          size={24}
          color={BROWN}
        />
      </Pressable>

      <View style={styles.iconCircle}>
        <Ionicons
          name="flash-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.title}>
        Rapid Note Transition
      </Text>

      <Text style={styles.subtitle}>
        VOCAL AGILITY
      </Text>

      <View style={styles.instructionCard}>
        <View style={styles.prepareCard}>
          <View style={styles.prepareHeader}>
            <Ionicons
              name="information-circle-outline"
              size={21}
              color={BROWN}
            />
            <Text style={styles.prepareTitle}>
              Before You Begin
            </Text>
          </View>

          {[
            'Find a quiet area with minimal background noise.',
            'Stand or sit upright with your shoulders relaxed.',
            'Keep a comfortable distance from the microphone while singing.',
          ].map((item, index) => (
            <View
              key={item}
              style={styles.prepareItem}
            >
              <Ionicons
                name={
                  index === 0
                    ? 'volume-mute-outline'
                    : index === 1
                      ? 'body-outline'
                      : 'mic-outline'
                }
                size={17}
                color={BROWN}
              />
              <Text style={styles.prepareText}>
                {item}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.cardTitle}>
          Exercise Details
        </Text>

        <DetailRow
          label="Difficulty"
          value={tier.charAt(0).toUpperCase() + tier.slice(1)}
        />

        <DetailRow
          label="Notes"
          value={
            isLoadingAdaptiveParams
              ? '...'
              : String(exerciseConfig.noteCount)
          }
        />

        <DetailRow
          label="Target Speed"
          value={
            isLoadingAdaptiveParams
              ? '...'
              : `${exerciseConfig.targetSpeed.toFixed(1)} transitions/sec`
          }
        />

        <DetailRow
          label="Repetitions"
          value={
            isLoadingAdaptiveParams
              ? '...'
              : String(exerciseConfig.repetitions)
          }
        />

        <DetailRow
          label="Accuracy Goal"
          value={`${exerciseConfig.accuracyThreshold}%`}
        />

        <Text style={[styles.cardTitle, { marginTop: 14 }]}>
          Exercise Instructions
        </Text>

        {[
          'Listen carefully to the reference sequence.',
          'Sing the same notes in the same order.',
          'Move quickly and smoothly between each note.',
          'Focus on maintaining accurate pitch throughout the sequence.',
        ].map(item => (
          <View
            key={item}
            style={styles.prepareItem}
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={17}
              color={BROWN}
            />
            <Text style={styles.prepareText}>{item}</Text>
          </View>
        ))}
      </View>

      <View style={styles.referenceCard}>
        <Text style={styles.cardTitle}>
          Reference Sequence
        </Text>

        <Text style={styles.referenceLabel}>
          LISTEN AND REMEMBER THE NOTE ORDER
        </Text>

        {renderNoteSequence()}

        <Text style={styles.referenceHint}>
          The same sequence will play before each repetition.
        </Text>
      </View>

      {errorMessage ? (
        <View style={styles.errorCard}>
          <Ionicons
            name="alert-circle-outline"
            size={18}
            color={BROWN}
          />
          <Text style={styles.errorText}>
            {errorMessage}
          </Text>
        </View>
      ) : null}

      <View style={styles.tipCard}>
        <Ionicons
          name="bulb-outline"
          size={19}
          color={BROWN}
        />
        <Text style={styles.tipText}>
          Focus on clean transitions first. Speed should come naturally after the notes are accurate.
        </Text>
      </View>

      <Pressable
        style={[
          styles.startButton,
          isLoadingAdaptiveParams && styles.disabledButton,
        ]}
        onPress={startExercise}
        disabled={isLoadingAdaptiveParams}
      >
        {isLoadingAdaptiveParams ? (
          <ActivityIndicator size="small" color={WHITE} />
        ) : (
          <Ionicons name="play" size={18} color={WHITE} />
        )}

        <Text style={styles.startButtonText}>
          {isLoadingAdaptiveParams
            ? 'Preparing Exercise...'
            : 'Start Exercise'}
        </Text>
      </Pressable>
    </View>
  );

  // ============================================================
  // COUNTDOWN
  // ============================================================

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="flash-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>
        Get Ready
      </Text>

      <Text style={styles.phaseSubtitle}>
        Repetition {currentRepetition} of {exerciseConfig.repetitions}
      </Text>

      <Text style={styles.countdownText}>
        {countdown}
      </Text>

      <Text style={styles.phaseSubtitle}>
        Get ready to listen to the reference sequence.
      </Text>
    </View>
  );

  // ============================================================
  // LISTENING
  // ============================================================

  const renderListening = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="musical-notes-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>
        Listen to the Sequence
      </Text>

      <Text style={styles.phaseSubtitle}>
        Repetition {currentRepetition} of {exerciseConfig.repetitions}
      </Text>

      <Text style={styles.phaseSubtitle}>
        Pay attention to the order and pitch of each note.
      </Text>

      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>
          REFERENCE NOTES
        </Text>
        {renderNoteSequence()}
      </View>

      <ActivityIndicator
        size="small"
        color={BROWN}
        style={{ marginTop: 20 }}
      />

      <Text style={styles.phaseSubtitle}>
        The microphone will start after the reference sequence finishes.
      </Text>
    </View>
  );

  // ============================================================
  // RECORDING
  // ============================================================

  const renderRecording = () => {
    const progress = Math.min(
      elapsedSeconds / MAX_RECORDING_SECONDS,
      1,
    );

    return (
      <View style={styles.content}>
        <View style={styles.recordingIcon}>
          <Ionicons
            name="mic"
            size={34}
            color={BROWN}
          />
        </View>

        <Text style={styles.recordingTitle}>
          Sing the Sequence
        </Text>

        <Text style={styles.recordingSubtitle}>
          Repetition {currentRepetition} of {exerciseConfig.repetitions}
        </Text>

        <Text style={styles.recordingSubtitle}>
          Follow the reference notes as quickly and accurately as possible.
        </Text>

        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingBadgeText}>
            RECORDING
          </Text>
        </View>

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>
            CURRENT NOTE
          </Text>

          <Text style={styles.liveCurrentNote}>
            {livePitch.note}
          </Text>

          <Text style={styles.liveFrequency}>
            {livePitch.pitch > 0
              ? `${livePitch.pitch.toFixed(1)} Hz`
              : '--'}
          </Text>

          <View style={styles.liveDivider} />

          <View style={styles.liveStats}>
            <LiveStat
              label="Transitions"
              value={String(liveTransitionCount)}
            />
            <LiveStat
              label="Transitions/sec"
              value={liveTransitionSpeed.toFixed(1)}
            />
          </View>

          <View style={styles.liveStats}>
            <LiveStat
              label="Clarity"
              value={`${Math.round(livePitch.clarity * 100)}%`}
            />
          </View>
        </View>

        <Text style={styles.timerText}>
          Recording Time: {elapsedSeconds.toFixed(1)}s
        </Text>

        <View style={styles.timerTrack}>
          <View
            style={[
              styles.timerFill,
              { width: `${progress * 100}%` },
            ]}
          />
        </View>

        <View style={styles.referenceCard}>
          <Text style={styles.cardTitle}>
            Sing This Sequence
          </Text>
          {renderNoteSequence()}
        </View>

        <Pressable
          style={[
            styles.finishButton,
            !isRecording && styles.disabledButton,
          ]}
          onPress={finishRecording}
          disabled={!isRecording}
        >
          <Ionicons
            name="stop"
            size={18}
            color={BROWN}
          />
          <Text style={styles.finishButtonText}>
            Finish This Repetition
          </Text>
        </Pressable>
      </View>
    );
  };

  // ============================================================
  // PROCESSING
  // ============================================================

  const renderProcessing = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <ActivityIndicator size="large" color={BROWN} />
      </View>

      <Text style={styles.phaseTitle}>
        Analyzing Your Singing
      </Text>

      <Text style={styles.phaseSubtitle}>
        Repetition {currentRepetition} of {exerciseConfig.repetitions}
      </Text>

      <Text style={styles.phaseSubtitle}>
        Measuring note transitions, speed, sequence accuracy, and pitch accuracy.
      </Text>
    </View>
  );

  // ============================================================
  // RESULTS
  // ============================================================

  const renderResults = () => {
    if (!result) {
      return null;
    }

    return (
      <View style={styles.resultsContent}>
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
          Rapid Note Transition Result
        </Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>
            AVERAGE OVERALL SCORE
          </Text>

          <Text style={styles.scoreValue}>
            {result.overall}
          </Text>

          <Text style={styles.scoreDescription}>
            out of 100 · {result.attempts.length} of{' '}
            {exerciseConfig.repetitions} repetitions completed
          </Text>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Repetition Scores
          </Text>

          {result.attempts.map((attempt, index) => (
            <View
              key={`attempt-${attempt.repetition}`}
              style={[
                styles.attemptRow,
                index === result.attempts.length - 1 &&
                  styles.attemptRowLast,
              ]}
            >
              <View style={styles.attemptTextGroup}>
                <Text style={styles.attemptTitle}>
                  Repetition {attempt.repetition}
                </Text>
                <Text style={styles.attemptSubtitle}>
                  Pitch {Math.round(attempt.pitchScore)}% · Sequence{' '}
                  {Math.round(attempt.sequenceScore)}% · Speed{' '}
                  {Math.round(attempt.speedScore)}%
                </Text>
              </View>

              <Text style={styles.attemptScore}>
                {Math.round(attempt.overall)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Average Performance Breakdown
          </Text>

          <ScoreBar
            label="Pitch Accuracy"
            value={result.pitchScore}
          />

          <ScoreBar
            label="Sequence Accuracy"
            value={result.sequenceScore}
          />

          <ScoreBar
            label="Transition Speed"
            value={result.speedScore}
            last
          />
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Average Performance Metrics
          </Text>

          <MetricRow
            label="Transitions per attempt"
            value={String(result.transitionCount)}
          />

          <MetricRow
            label="Transitions/sec"
            value={result.transitionsPerSecond.toFixed(1)}
          />

          <MetricRow
            label="Average Transition Time"
            value={`${result.averageTransitionTimeMs.toFixed(0)} ms`}
            last
          />
        </View>

        <View style={styles.tipCard}>
          <Ionicons
            name="bulb-outline"
            size={20}
            color={BROWN}
          />
          <Text style={styles.tipText}>
            {result.feedback}
          </Text>
        </View>

        <Pressable
          style={styles.startButton}
          onPress={retryExercise}
        >
          <Ionicons
            name="refresh"
            size={18}
            color={WHITE}
          />
          <Text style={styles.startButtonText}>
            Try Again
          </Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={() =>
            router.replace('/dashboard?tab=exercises')
          }
        >
          <Text style={styles.doneButtonText}>
            Done
          </Text>
        </Pressable>
      </View>
    );
  };

  // ============================================================
  // MAIN RENDER
  // ============================================================

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={
        screen === 'results'
          ? styles.resultsWrapper
          : undefined
      }
      showsVerticalScrollIndicator={false}
    >
      {screen === 'instructions' && renderInstructions()}
      {screen === 'countdown' && renderCountdown()}
      {screen === 'listening' && renderListening()}
      {screen === 'recording' && renderRecording()}
      {screen === 'processing' && renderProcessing()}
      {screen === 'results' && renderResults()}
    </ScrollView>
  );
}

// ============================================================
// SMALL PRESENTATIONAL COMPONENTS
// ============================================================

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function LiveStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.liveStat}>
      <Text style={styles.liveStatLabel}>{label}</Text>
      <Text style={styles.liveStatValue}>{value}</Text>
    </View>
  );
}

function ScoreBar({
  label,
  value,
  last = false,
}: {
  label: string;
  value: number;
  last?: boolean;
}) {
  const safeValue = clampScore(value);

  return (
    <View style={last ? styles.scoreRowLast : styles.scoreRow}>
      <View style={styles.scoreRowHeader}>
        <Text style={styles.scoreRowLabel}>{label}</Text>
        <Text style={styles.scoreRowValue}>
          {Math.round(safeValue)}%
        </Text>
      </View>

      <View style={styles.progressBackground}>
        <View
          style={[
            styles.progressFill,
            { width: `${safeValue}%` },
          ]}
        />
      </View>
    </View>
  );
}

function MetricRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.metricRow,
        last && styles.metricRowLast,
      ]}
    >
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 92,
    paddingBottom: 60,
    alignItems: 'center',
  },

  resultsContent: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 92,
    paddingBottom: 50,
    alignItems: 'center',
  },

  resultsWrapper: {
    flexGrow: 1,
    width: '100%',
  },

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHITE,
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
    marginTop: 14,
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
    marginTop: 10,
    marginBottom: 14,
  },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },

  detailLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  detailValue: {
    flex: 1,
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'right',
    marginLeft: 16,
  },

  errorCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  errorText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 9,
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
    marginTop: 14,
  },

  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  finishButton: {
    width: '100%',
    height: 53,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },

  finishButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  disabledButton: {
    opacity: 0.55,
  },

  referenceCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 22,
  },

  referenceLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
    textAlign: 'center',
  },

  referenceHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 16,
  },

  noteSequence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
    marginTop: 16,
  },

  notePill: {
    minWidth: 60,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
  },

  noteText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  centerScreen: {
    flexGrow: 1,
    minHeight: 700,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
    marginTop: 20,
  },

  phaseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
  },

  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 26,
    color: BROWN,
    textAlign: 'center',
  },

  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    marginTop: 5,
    maxWidth: 310,
  },

  recordingBadge: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: BORDER,
  },

  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BROWN,
    marginRight: 7,
  },

  recordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: BROWN,
  },

  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 7,
  },

  timerTrack: {
    width: '100%',
    height: 7,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 4,
    overflow: 'hidden',
  },

  timerFill: {
    height: '100%',
    backgroundColor: PINK,
  },

  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    marginTop: 22,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
  },

  liveCurrentNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    marginTop: 4,
  },

  liveFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  liveDivider: {
    width: '100%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 15,
  },

  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 6,
  },

  liveStat: {
    flex: 1,
    alignItems: 'center',
  },

  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    textAlign: 'center',
  },

  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginTop: 3,
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
    textAlign: 'center',
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
    lineHeight: 16,
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
    marginBottom: 14,
  },

  attemptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  attemptRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },

  attemptTextGroup: {
    flex: 1,
    paddingRight: 12,
  },

  attemptTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  attemptSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 4,
    lineHeight: 15,
  },

  attemptScore: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
  },

  scoreRow: {
    marginBottom: 14,
  },

  scoreRowLast: {
    marginBottom: 0,
  },

  scoreRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 7,
  },

  scoreRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  scoreRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  progressBackground: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: PINK,
  },

  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  metricRowLast: {
    borderBottomWidth: 0,
  },

  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    flex: 1,
  },

  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'right',
    marginLeft: 12,
  },

  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 15,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },

  doneButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },

  doneButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
});
