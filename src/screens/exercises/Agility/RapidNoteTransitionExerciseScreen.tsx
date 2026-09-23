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

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

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
} from '@/services/assessment/notePlayer';

import {
  createMusicalNote,
} from '@/utils/music/notes';

// ============================================================
// COLORS
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const GREEN = '#39734A';
const RED = '#A04444';

// ============================================================
// CONFIG
// ============================================================

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
  volume: number;
  stability: number;
};

type ExerciseSequence = {
  notes: NoteToPlay[];
  frequencies: number[];
  names: string[];
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
};

// ============================================================
// HELPERS
// ============================================================

function getRandomInteger(
  min: number,
  max: number,
): number {
  return (
    Math.floor(
      Math.random() * (max - min + 1),
    ) + min
  );
}

function generateExerciseSequence(
  minMidi: number,
  maxMidi: number,
  noteCount: number,
  noteDurationSeconds: number,
): ExerciseSequence {
  const midiNotes: number[] = [];

  for (
    let index = 0;
    index < noteCount;
    index += 1
  ) {
    let midi = getRandomInteger(
      minMidi,
      maxMidi,
    );

    // Avoid identical consecutive notes.
    if (
      index > 0 &&
      midi === midiNotes[index - 1]
    ) {
      if (midi === maxMidi) {
        midi = midi - 1;
      } else {
        midi = midi + 1;
      }
    }

    midiNotes.push(midi);
  }

  const musicalNotes =
    midiNotes.map(createMusicalNote);

  return {
    notes: musicalNotes.map(note => ({
      frequencyHz: note.frequency,
      durationSec: noteDurationSeconds,
    })),

    frequencies: musicalNotes.map(
      note => note.frequency,
    ),

    names: musicalNotes.map(
      note => note.name,
    ),
  };
}

// ============================================================
// COMPONENT
// ============================================================

export default function RapidNoteTransitionExerciseScreen({
  tier = 'beginner',
}: Props) {
  // ----------------------------------------------------------
  // PARAMETERS
  // ----------------------------------------------------------

  const params = useMemo(
    () =>
      RAPID_NOTE_TRANSITION_PARAMS[tier],
    [tier],
  );

  // ----------------------------------------------------------
  // EXERCISE CONFIGURATION
  // ----------------------------------------------------------

  const exerciseConfig = useMemo(() => {
    const noteCount = getRandomInteger(
      params.minNotes,
      params.maxNotes,
    );

    return {
      noteCount,

      targetSpeed:
        params.minSpeed +
        Math.random() *
          (params.maxSpeed - params.minSpeed),

      repetitions: params.repetitions,

      accuracyThreshold:
        params.accuracyThreshold,

      sequence:
        generateExerciseSequence(
          params.minMidi,
          params.maxMidi,
          noteCount,
          params.noteDurationSec,
        ),
    };
  }, [params]);

  // ----------------------------------------------------------
  // SCREEN STATE
  // ----------------------------------------------------------

  const [screenState, setScreenState] =
    useState<Screen>('instructions');

  const screenRef =
    useRef<Screen>('instructions');

  const setScreen = useCallback(
    (nextScreen: Screen) => {
      screenRef.current = nextScreen;
      setScreenState(nextScreen);
    },
    [],
  );

  const screen = screenState;

  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);

  const [elapsedSeconds, setElapsedSeconds] =
    useState(0);

  const [currentRepetition, setCurrentRepetition] =
    useState(1);

  const [liveTransitionCount, setLiveTransitionCount] =
    useState(0);

  const [liveTransitionSpeed, setLiveTransitionSpeed] =
    useState(0);

  const [livePitch, setLivePitch] =
    useState<LiveState>({
      pitch: 0,
      note: '--',
      clarity: 0,
      volume: -100,
      stability: 0,
    });

  const [result, setResult] =
    useState<ExerciseResult | null>(null);

  const [errorMessage, setErrorMessage] =
    useState('');

  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------

  const mountedRef =
    useRef(true);

  const countdownTimerRef =
    useRef<
      ReturnType<typeof setInterval> | null
    >(null);

  const recordingTimerRef =
    useRef<
      ReturnType<typeof setInterval> | null
    >(null);

  const recordingStartRef =
    useRef<number | null>(null);

  const previousPitchRef =
    useRef(0);

  const transitionCountRef =
    useRef(0);

  const finishingRef =
    useRef(false);

  const playingSequenceRef =
    useRef(false);

  const referenceStartedRef =
    useRef(false);

  // ----------------------------------------------------------
  // TIMER CLEANUP
  // ----------------------------------------------------------

  const clearTimers =
    useCallback(() => {
      if (countdownTimerRef.current) {
        clearInterval(
          countdownTimerRef.current,
        );

        countdownTimerRef.current =
          null;
      }

      if (recordingTimerRef.current) {
        clearInterval(
          recordingTimerRef.current,
        );

        recordingTimerRef.current =
          null;
      }
    }, []);

  // ----------------------------------------------------------
  // RESET LIVE STATE
  // ----------------------------------------------------------

  const resetLiveState =
    useCallback(() => {
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
        volume: -100,
        stability: 0,
      });
    }, []);

  // ----------------------------------------------------------
  // LIVE AUDIO FRAME
  // ----------------------------------------------------------

  const handleLiveFrame =
    useCallback(
      (frame: {
        pitch: number;
        note: string;
        clarity: number;
        volume: number;
        stability: number;
      }) => {
        if (!mountedRef.current) {
          return;
        }

        if (
          screenRef.current !== 'recording'
        ) {
          return;
        }

        setLivePitch({
          pitch: frame.pitch,
          note: frame.note || '--',
          clarity: frame.clarity,
          volume: frame.volume,
          stability: frame.stability,
        });

        if (
          !Number.isFinite(frame.pitch) ||
          frame.pitch <= 0
        ) {
          return;
        }

        const previousPitch =
          previousPitchRef.current;

        if (
          previousPitch > 0 &&
          Number.isFinite(previousPitch)
        ) {
          const semitoneChange =
            12 *
            Math.log2(
              frame.pitch / previousPitch,
            );

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

        previousPitchRef.current =
          frame.pitch;

        if (recordingStartRef.current) {
          const elapsed =
            (
              Date.now() -
              recordingStartRef.current
            ) / 1000;

          if (elapsed > 0) {
            setLiveTransitionSpeed(
              transitionCountRef.current /
                elapsed,
            );
          }
        }
      },
      [],
    );

  // ----------------------------------------------------------
  // PROCESS COMPLETED RECORDING
  // ----------------------------------------------------------

  const handleRecordingStop =
    useCallback(
      (
        samples: Float32Array,
        sampleRate: number,
      ) => {
        clearTimers();

        if (!mountedRef.current) {
          return;
        }

        setScreen('processing');

        try {
          if (
            !samples ||
            samples.length === 0
          ) {
            throw new Error(
              'No audio samples were recorded.',
            );
          }

          const measurement =
            measureRapidNoteTransition(
              samples,
              sampleRate,
              exerciseConfig.sequence.frequencies,
            );

          const scored =
            scoreRapidNoteTransition(
              measurement,
            );

          if (!mountedRef.current) {
            return;
          }

          setResult({
            overall: scored.overall,
            pitchScore: scored.pitchScore,
            sequenceScore:
              scored.sequenceScore,
            speedScore: scored.speedScore,

            passed: scored.passed,
            feedback: scored.feedback,

            transitionCount:
              measurement.transitionCount,

            transitionsPerSecond:
              measurement.transitionsPerSecond,

            averageTransitionTimeMs:
              measurement.averageTransitionTimeMs,
          });

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
            'We could not analyze this recording. Please try again.',
          );

          setScreen('instructions');
        }
      },
      [
        clearTimers,
        exerciseConfig.sequence.frequencies,
        setScreen,
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
  // PLAY REFERENCE SEQUENCE
  // ----------------------------------------------------------

  const playReferenceSequence =
    useCallback(
      async () => {
        if (
          playingSequenceRef.current ||
          referenceStartedRef.current
        ) {
          return;
        }

        referenceStartedRef.current =
          true;

        playingSequenceRef.current =
          true;

        clearTimers();

        try {
          if (!mountedRef.current) {
            return;
          }

          console.log(
            '🎵 Starting Rapid Note Transition reference sequence',
          );

          setScreen('listening');

          await playNoteSequence(
            exerciseConfig.sequence.notes,
          );

          if (!mountedRef.current) {
            return;
          }

          console.log(
            '🎤 Reference finished. Starting recording...',
          );

          /*
           * Set the UI state before starting the recorder.
           * This makes sure live audio callbacks know
           * that we are now in the recording phase.
           */
          setScreen('recording');

          recordingStartRef.current =
            Date.now();

          setElapsedSeconds(0);

          await startRecording();

          if (!mountedRef.current) {
            return;
          }

          console.log(
            '🎤 Recording started successfully',
          );

          let elapsed = 0;

          recordingTimerRef.current =
            setInterval(() => {
              if (!mountedRef.current) {
                return;
              }

              elapsed += 0.1;

              setElapsedSeconds(
                Math.min(
                  elapsed,
                  MAX_RECORDING_SECONDS,
                ),
              );

              if (
                elapsed >=
                MAX_RECORDING_SECONDS
              ) {
                if (
                  recordingTimerRef.current
                ) {
                  clearInterval(
                    recordingTimerRef.current,
                  );

                  recordingTimerRef.current =
                    null;
                }

                if (
                  !finishingRef.current
                ) {
                  finishingRef.current =
                    true;

                  console.log(
                    '⏹️ Maximum recording time reached',
                  );

                  void stopRecording();
                }
              }
            }, 100);
        } catch (error) {
          console.error(
            'Failed to play Rapid Note Transition reference sequence:',
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
          playingSequenceRef.current =
            false;
        }
      },
      [
        clearTimers,
        exerciseConfig.sequence.notes,
        setScreen,
        startRecording,
        stopRecording,
      ],
    );

  // ----------------------------------------------------------
  // COUNTDOWN
  // ----------------------------------------------------------

  useEffect(() => {
    if (screen !== 'countdown') {
      return;
    }

    clearTimers();

    setCountdown(
      COUNTDOWN_SECONDS,
    );

    let remaining =
      COUNTDOWN_SECONDS;

    console.log(
      '⏱️ Rapid Note Transition countdown started',
    );

    countdownTimerRef.current =
      setInterval(() => {
        remaining -= 1;

        if (!mountedRef.current) {
          return;
        }

        console.log(
          '⏱️ Countdown:',
          remaining,
        );

        if (remaining > 0) {
          setCountdown(remaining);
          return;
        }

        clearTimers();

        setCountdown(0);

        console.log(
          '⏱️ Countdown finished',
        );

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

      /*
       * The recorder is stopped only during actual unmount.
       * Do not put isRecording in this effect's dependency list.
       */
      void stopRecording();
    };
  }, [
    clearTimers,
    stopRecording,
  ]);

  // ----------------------------------------------------------
  // START EXERCISE
  // ----------------------------------------------------------

  const startExercise =
    useCallback(() => {
      console.log(
        '▶️ Starting Rapid Note Transition exercise',
      );

      clearTimers();

      resetLiveState();

      referenceStartedRef.current =
        false;

      playingSequenceRef.current =
        false;

      setErrorMessage('');

      setResult(null);

      setCurrentRepetition(1);

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setScreen('countdown');
    }, [
      clearTimers,
      resetLiveState,
      setScreen,
    ]);

  // ----------------------------------------------------------
  // FINISH RECORDING
  // ----------------------------------------------------------

  const finishRecording =
    useCallback(
      async () => {
        if (
          finishingRef.current ||
          !isRecording
        ) {
          return;
        }

        console.log(
          '⏹️ User finished recording',
        );

        finishingRef.current = true;

        clearTimers();

        try {
          await stopRecording();
        } catch (error) {
          console.error(
            'Failed to stop Rapid Note Transition recording:',
            error,
          );

          if (!mountedRef.current) {
            return;
          }

          setErrorMessage(
            'We could not stop the recording. Please try again.',
          );

          setScreen('instructions');

          finishingRef.current =
            false;
        }
      },
      [
        clearTimers,
        isRecording,
        setScreen,
        stopRecording,
      ],
    );

  // ----------------------------------------------------------
  // RETRY
  // ----------------------------------------------------------

  const retryExercise =
    useCallback(() => {
      clearTimers();

      resetLiveState();

      referenceStartedRef.current =
        false;

      playingSequenceRef.current =
        false;

      setResult(null);

      setErrorMessage('');

      setCurrentRepetition(1);

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setScreen('instructions');
    }, [
      clearTimers,
      resetLiveState,
      setScreen,
    ]);

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
        <Ionicons name="arrow-back" size={24} color={BROWN} />
      </Pressable>

      <View style={styles.iconCircle}>
        <Ionicons name="flash-outline" size={34} color={BROWN} />
      </View>

      <Text style={styles.title}>Rapid Note Transition</Text>
      <Text style={styles.subtitle}>VOCAL AGILITY</Text>

      <View style={styles.instructionCard}>
        <View style={styles.prepareCard}>
          <View style={styles.prepareHeader}>
            <Ionicons name="information-circle-outline" size={21} color={BROWN} />
            <Text style={styles.prepareTitle}>Before You Begin</Text>
          </View>

          <View style={styles.prepareItem}>
            <Ionicons name="volume-mute-outline" size={17} color={BROWN} />
            <Text style={styles.prepareText}>
              Find a quiet area with minimal background noise.
            </Text>
          </View>

          <View style={styles.prepareItem}>
            <Ionicons name="body-outline" size={17} color={BROWN} />
            <Text style={styles.prepareText}>
              Stand or sit upright with your shoulders relaxed.
            </Text>
          </View>

          <View style={styles.prepareItem}>
            <Ionicons name="mic-outline" size={17} color={BROWN} />
            <Text style={styles.prepareText}>
              Keep a comfortable distance from the microphone while singing.
            </Text>
          </View>
        </View>

        <Text style={styles.cardTitle}>Exercise Details</Text>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Difficulty</Text>
          <Text style={styles.detailValue}>
            {tier.charAt(0).toUpperCase() + tier.slice(1)}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Notes</Text>
          <Text style={styles.detailValue}>{exerciseConfig.noteCount}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Target Speed</Text>
          <Text style={styles.detailValue}>
            {exerciseConfig.targetSpeed.toFixed(1)} notes/sec
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Repetitions</Text>
          <Text style={styles.detailValue}>{exerciseConfig.repetitions}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Accuracy Goal</Text>
          <Text style={styles.detailValue}>{exerciseConfig.accuracyThreshold}%</Text>
        </View>

        <Text style={[styles.cardTitle, { marginTop: 14 }]}>Instructions</Text>

        <View style={styles.prepareItem}>
          <Ionicons name="checkmark-circle-outline" size={17} color={BROWN} />
          <Text style={styles.prepareText}>Listen carefully to the reference sequence.</Text>
        </View>
        <View style={styles.prepareItem}>
          <Ionicons name="checkmark-circle-outline" size={17} color={BROWN} />
          <Text style={styles.prepareText}>Sing the same notes in the same order.</Text>
        </View>
        <View style={styles.prepareItem}>
          <Ionicons name="checkmark-circle-outline" size={17} color={BROWN} />
          <Text style={styles.prepareText}>Move quickly and smoothly between each note.</Text>
        </View>
        <View style={styles.prepareItem}>
          <Ionicons name="checkmark-circle-outline" size={17} color={BROWN} />
          <Text style={styles.prepareText}>Focus on maintaining accurate pitch throughout the sequence.</Text>
        </View>
      </View>

      <View style={styles.referenceCard}>
        <Text style={styles.cardTitle}>Reference Sequence</Text>
        <Text style={styles.referenceLabel}>LISTEN AND REMEMBER THE NOTE ORDER</Text>
        <View style={styles.noteSequence}>
          {exerciseConfig.sequence.names.map((name, index) => (
            <View key={`${name}-${index}`} style={styles.notePill}>
              <Text style={styles.noteText}>{name}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.referenceHint}>
          The sequence will play automatically before recording begins.
        </Text>
      </View>

      {errorMessage ? (
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={18} color={BROWN} />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <View style={styles.tipCard}>
        <Ionicons name="bulb-outline" size={19} color={BROWN} />
        <Text style={styles.tipText}>
          Focus on clean transitions first. Speed should come naturally after the notes are accurate.
        </Text>
      </View>

      <View style={styles.difficultyRow}>
        <Text style={styles.difficultyLabel}>Difficulty</Text>
        <Text style={styles.difficultyValue}>
          {tier.charAt(0).toUpperCase() + tier.slice(1)}
        </Text>
      </View>

      <Pressable style={styles.startButton} onPress={startExercise}>
        <Ionicons name="play" size={18} color={WHITE} />
        <Text style={styles.startButtonText}>Start Exercise</Text>
      </Pressable>
    </View>
  );

  // ============================================================
  // COUNTDOWN
  // ============================================================

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons name="flash-outline" size={34} color={BROWN} />
      </View>
      <Text style={styles.phaseTitle}>Get Ready</Text>
      <Text style={styles.countdownText}>{countdown}</Text>
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
        <Ionicons name="musical-notes-outline" size={34} color={BROWN} />
      </View>
      <Text style={styles.phaseTitle}>Listen to the Sequence</Text>
      <Text style={styles.phaseSubtitle}>
        Pay attention to the order and pitch of each note.
      </Text>

      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>REFERENCE NOTES</Text>
        <View style={styles.noteSequence}>
          {exerciseConfig.sequence.names.map((name, index) => (
            <View key={`${name}-${index}`} style={styles.notePill}>
              <Text style={styles.noteText}>{name}</Text>
            </View>
          ))}
        </View>
      </View>

      <ActivityIndicator size="small" color={BROWN} style={{ marginTop: 20 }} />
      <Text style={styles.phaseSubtitle}>
        The microphone will start after the reference sequence finishes.
      </Text>
    </View>
  );

  // ============================================================
  // RECORDING
  // ============================================================

  const renderRecording = () => {
    const progress = Math.min(elapsedSeconds / MAX_RECORDING_SECONDS, 1);

    return (
      <View style={styles.content}>
        <View style={styles.recordingIcon}>
          <Ionicons name="mic" size={34} color={BROWN} />
        </View>

        <Text style={styles.recordingTitle}>Sing the Sequence</Text>
        <Text style={styles.recordingSubtitle}>
          Follow the reference notes as quickly and accurately as possible.
        </Text>

        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingBadgeText}>RECORDING</Text>
        </View>

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>CURRENT NOTE</Text>
          <Text style={styles.liveCurrentNote}>{livePitch.note}</Text>
          <Text style={styles.liveFrequency}>
            {livePitch.pitch > 0 ? `${livePitch.pitch.toFixed(1)} Hz` : '--'}
          </Text>

          <View style={styles.liveDivider} />

          <View style={styles.liveStats}>
            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>Transitions</Text>
              <Text style={styles.liveStatValue}>{liveTransitionCount}</Text>
            </View>
            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>Notes/sec</Text>
              <Text style={styles.liveStatValue}>{liveTransitionSpeed.toFixed(1)}</Text>
            </View>
          </View>

          <View style={styles.liveStats}>
            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>Clarity</Text>
              <Text style={styles.liveStatValue}>{Math.round(livePitch.clarity * 100)}%</Text>
            </View>
            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>Stability</Text>
              <Text style={styles.liveStatValue}>{Math.round(livePitch.stability)}%</Text>
            </View>
          </View>
        </View>

        <Text style={styles.timerText}>Recording Time: {elapsedSeconds.toFixed(1)}s</Text>
        <View style={styles.timerTrack}>
          <View style={[styles.timerFill, { width: `${progress * 100}%` }]} />
        </View>

        <View style={styles.referenceCard}>
          <Text style={styles.cardTitle}>Sing This Sequence</Text>
          <View style={styles.noteSequence}>
            {exerciseConfig.sequence.names.map((name, index) => (
              <View key={`${name}-${index}`} style={styles.notePill}>
                <Text style={styles.noteText}>{name}</Text>
              </View>
            ))}
          </View>
        </View>

        <Pressable
          style={[styles.finishButton, !isRecording && styles.disabledButton]}
          onPress={finishRecording}
          disabled={!isRecording}
        >
          <Ionicons name="stop" size={18} color={BROWN} />
          <Text style={styles.finishButtonText}>Finish Recording</Text>
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
      <Text style={styles.phaseTitle}>Analyzing Your Singing</Text>
      <Text style={styles.phaseSubtitle}>
        Measuring note transitions, speed, sequence accuracy, and pitch accuracy.
      </Text>
    </View>
  );

  // ============================================================
  // RESULTS
  // ============================================================

  const renderResults = () => {
    if (!result) return null;

    return (
      <View style={styles.resultsContent}>
        <View
          style={[
            styles.resultIcon,
            result.passed ? styles.resultIconPassed : styles.resultIconFailed,
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
        <Text style={styles.resultSubtitle}>Rapid Note Transition Result</Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>OVERALL SCORE</Text>
          <Text style={styles.scoreValue}>{result.overall}</Text>
          <Text style={styles.scoreDescription}>out of 100</Text>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>Performance Breakdown</Text>

          <View style={styles.scoreRow}>
            <View style={styles.scoreRowHeader}>
              <Text style={styles.scoreRowLabel}>Pitch Accuracy</Text>
              <Text style={styles.scoreRowValue}>{result.pitchScore}%</Text>
            </View>
            <View style={styles.progressBackground}>
              <View style={[styles.progressFill, { width: `${Math.min(Math.max(result.pitchScore, 0), 100)}%` }]} />
            </View>
          </View>

          <View style={styles.scoreRow}>
            <View style={styles.scoreRowHeader}>
              <Text style={styles.scoreRowLabel}>Sequence Accuracy</Text>
              <Text style={styles.scoreRowValue}>{result.sequenceScore}%</Text>
            </View>
            <View style={styles.progressBackground}>
              <View style={[styles.progressFill, { width: `${Math.min(Math.max(result.sequenceScore, 0), 100)}%` }]} />
            </View>
          </View>

          <View style={styles.scoreRowLast}>
            <View style={styles.scoreRowHeader}>
              <Text style={styles.scoreRowLabel}>Transition Speed</Text>
              <Text style={styles.scoreRowValue}>{result.speedScore}%</Text>
            </View>
            <View style={styles.progressBackground}>
              <View style={[styles.progressFill, { width: `${Math.min(Math.max(result.speedScore, 0), 100)}%` }]} />
            </View>
          </View>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>Performance Metrics</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Transitions</Text>
            <Text style={styles.metricValue}>{result.transitionCount}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Transitions/sec</Text>
            <Text style={styles.metricValue}>{result.transitionsPerSecond.toFixed(1)}</Text>
          </View>
          <View style={[styles.metricRow, styles.metricRowLast]}>
            <Text style={styles.metricLabel}>Average Transition</Text>
            <Text style={styles.metricValue}>{result.averageTransitionTimeMs.toFixed(0)} ms</Text>
          </View>
        </View>

        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={20} color={BROWN} />
          <Text style={styles.tipText}>{result.feedback}</Text>
        </View>

        <Pressable style={styles.startButton} onPress={retryExercise}>
          <Ionicons name="refresh" size={18} color={WHITE} />
          <Text style={styles.startButtonText}>Try Again</Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={() => router.replace('/dashboard/exercises')}
        >
          <Text style={styles.doneButtonText}>Done</Text>
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
      {screen === 'instructions' &&
        renderInstructions()}

      {screen === 'countdown' &&
        renderCountdown()}

      {screen === 'listening' &&
        renderListening()}

      {screen === 'recording' &&
        renderRecording()}

      {screen === 'processing' &&
        renderProcessing()}

      {screen === 'results' &&
        renderResults()}
    </ScrollView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
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

  // ============================================================
  // SCREEN / CONTENT
  // ============================================================

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

  // ============================================================
  // GENERAL ICON / TITLE
  // ============================================================

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

  // ============================================================
  // INSTRUCTIONS
  // ============================================================

  instructionCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
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

  // ============================================================
  // BUTTONS
  // ============================================================

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

  // ============================================================
  // REFERENCE / SEQUENCE
  // ============================================================

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

  // ============================================================
  // COUNTDOWN / CENTER STATES
  // ============================================================

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

  // ============================================================
  // RECORDING
  // ============================================================

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
    marginTop: 3,
    maxWidth: 310,
  },

  microphoneArea: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 18,
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

  detectedLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.7,
    color: MUTED,
    textAlign: 'center',
  },

  liveNotes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },

  liveNote: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: PINK,
  },

  liveNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
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

  // ============================================================
  // RESULTS
  // ============================================================

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
    lineHeight: 16,
    color: MUTED,
    textAlign: 'center',
  },

  statusBadge: {
    marginTop: 14,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },

  statusPassed: {
    backgroundColor: PINK,
  },

  statusNeedsWork: {
    backgroundColor: LIGHT_GRAY,
  },

  statusText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
  },

  statusPassedText: {
    color: GREEN,
  },

  statusNeedsWorkText: {
    color: RED,
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

  difficultyRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 4,
  },

  difficultyLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  difficultyValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
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
  },

  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginTop: 3,
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

  feedbackText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
  },
});