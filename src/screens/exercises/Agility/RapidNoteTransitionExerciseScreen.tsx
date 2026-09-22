import Ionicons from '@expo/vector-icons/Ionicons';
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
const GREEN = '#39734A';
const RED = '#A04444';

// ============================================================
// CONFIG
// ============================================================

const COUNTDOWN_SECONDS = 3;
const NOTE_DURATION_SECONDS = 0.35;
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

/**
 * Creates a temporary tier-based note sequence.
 *
 * Beginner:
 * C4-C5
 *
 * Intermediate:
 * A3-E5
 *
 * Advanced:
 * G3-G5
 *
 * The generated range can later be replaced by the
 * user's detected vocal range from the Initial Assessment.
 */
function generateExerciseSequence(
  tier: Tier,
  noteCount: number,
): ExerciseSequence {
  let minMidi = 60;
  let maxMidi = 72;

  if (tier === 'intermediate') {
    minMidi = 57;
    maxMidi = 76;
  }

  if (tier === 'advanced') {
    minMidi = 55;
    maxMidi = 79;
  }

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
      midi =
        midi === maxMidi
          ? midi - 1
          : midi + 1;
    }

    midiNotes.push(midi);
  }

  const musicalNotes =
    midiNotes.map(
      createMusicalNote,
    );

  return {
    notes: musicalNotes.map(
      note => ({
        frequencyHz:
          note.frequency,
        durationSec:
          NOTE_DURATION_SECONDS,
      }),
    ),

    frequencies:
      musicalNotes.map(
        note => note.frequency,
      ),

    names:
      musicalNotes.map(
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
      RAPID_NOTE_TRANSITION_PARAMS[
        tier
      ],
    [tier],
  );

  // ----------------------------------------------------------
  // EXERCISE CONFIGURATION
  // ----------------------------------------------------------

  const exerciseConfig = useMemo(() => {
    const noteCount =
      getRandomInteger(
        params.minNotes,
        params.maxNotes,
      );

    return {
      noteCount,

      targetSpeed:
        params.minSpeed +
        Math.random() *
          (
            params.maxSpeed -
            params.minSpeed
          ),

      repetitions:
        params.repetitions,

      accuracyThreshold:
        params.accuracyThreshold,

      sequence:
        generateExerciseSequence(
          tier,
          noteCount,
        ),
    };
  }, [params, tier]);

  // ----------------------------------------------------------
  // SCREEN STATE
  // ----------------------------------------------------------

  const [screen, setScreen] =
    useState<Screen>(
      'instructions',
    );

  const [countdown, setCountdown] =
    useState(
      COUNTDOWN_SECONDS,
    );

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
    useState<ExerciseResult | null>(
      null,
    );

  const [errorMessage, setErrorMessage] =
    useState('');

  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------

  const mountedRef =
    useRef(true);

  const countdownTimerRef =
    useRef<
      ReturnType<
        typeof setInterval
      > | null
    >(null);

  const recordingTimerRef =
    useRef<
      ReturnType<
        typeof setInterval
      > | null
    >(null);

  const recordingStartRef =
    useRef<number | null>(
      null,
    );

  const previousPitchRef =
    useRef(0);

  const transitionCountRef =
    useRef(0);

  const finishingRef =
    useRef(false);

  const playingSequenceRef =
    useRef(false);

  // ----------------------------------------------------------
  // TIMER CLEANUP
  // ----------------------------------------------------------

  const clearTimers =
    useCallback(() => {
      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current,
        );

        countdownTimerRef.current =
          null;
      }

      if (
        recordingTimerRef.current
      ) {
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
      previousPitchRef.current =
        0;

      transitionCountRef.current =
        0;

      recordingStartRef.current =
        null;

      finishingRef.current =
        false;

      setLiveTransitionCount(
        0,
      );

      setLiveTransitionSpeed(
        0,
      );

      setElapsedSeconds(
        0,
      );

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
        if (
          !mountedRef.current
        ) {
          return;
        }

        setLivePitch({
          pitch: frame.pitch,
          note:
            frame.note || '--',
          clarity:
            frame.clarity,
          volume:
            frame.volume,
          stability:
            frame.stability,
        });

        if (
          !Number.isFinite(
            frame.pitch,
          ) ||
          frame.pitch <= 0
        ) {
          return;
        }

        const previousPitch =
          previousPitchRef.current;

        if (
          previousPitch > 0 &&
          Number.isFinite(
            previousPitch,
          )
        ) {
          const semitoneChange =
            12 *
            Math.log2(
              frame.pitch /
                previousPitch,
            );

          if (
            Number.isFinite(
              semitoneChange,
            ) &&
            Math.abs(
              semitoneChange,
            ) >= 1
          ) {
            transitionCountRef.current +=
              1;

            setLiveTransitionCount(
              transitionCountRef.current,
            );
          }
        }

        previousPitchRef.current =
          frame.pitch;

        if (
          recordingStartRef.current
        ) {
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

        if (
          !mountedRef.current
        ) {
          return;
        }

        setScreen(
          'processing',
        );

        try {
          /*
           * IMPORTANT:
           *
           * measureRapidNoteTransition()
           * accepts exactly:
           *
           * samples
           * sampleRate
           * targetFrequencies
           */
          const measurement =
            measureRapidNoteTransition(
              samples,
              sampleRate,
              exerciseConfig
                .sequence
                .frequencies,
            );

          /*
           * IMPORTANT:
           *
           * scoreRapidNoteTransition()
           * accepts only the measurement.
           */
          const scored =
            scoreRapidNoteTransition(
              measurement,
            );

          if (
            !mountedRef.current
          ) {
            return;
          }

          setResult({
            overall:
              scored.overall,

            pitchScore:
              scored.pitchScore,

            sequenceScore:
              scored.sequenceScore,

            speedScore:
              scored.speedScore,

            passed:
              scored.passed,

            feedback:
              scored.feedback,

            transitionCount:
              measurement.transitionCount,

            transitionsPerSecond:
              measurement.transitionsPerSecond,

            averageTransitionTimeMs:
              measurement.averageTransitionTimeMs,
          });

          setScreen(
            'results',
          );
        } catch (error) {
          console.error(
            'Rapid Note Transition processing failed:',
            error,
          );

          if (
            !mountedRef.current
          ) {
            return;
          }

          setErrorMessage(
            'We could not analyze this recording. Please try again.',
          );

          setScreen(
            'instructions',
          );
        }
      },
      [
        clearTimers,
        exerciseConfig
          .sequence
          .frequencies,
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
    onFrame:
      handleLiveFrame,

    onStop:
      handleRecordingStop,
  });

  // ----------------------------------------------------------
  // PLAY REFERENCE SEQUENCE
  // ----------------------------------------------------------

  const playReferenceSequence =
    useCallback(
      async () => {
        if (
          playingSequenceRef.current
        ) {
          return;
        }

        playingSequenceRef.current =
          true;

        try {
          setScreen(
            'listening',
          );

          /*
           * Play the reference sequence
           * before recording starts.
           */
          await playNoteSequence(
            exerciseConfig
              .sequence
              .notes,
          );

          if (
            !mountedRef.current
          ) {
            return;
          }

          await startRecording();

          if (
            !mountedRef.current
          ) {
            return;
          }

          recordingStartRef.current =
            Date.now();

          setScreen(
            'recording',
          );

          let elapsed = 0;

          recordingTimerRef.current =
            setInterval(() => {
              elapsed += 0.1;

              if (
                !mountedRef.current
              ) {
                return;
              }

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
                clearTimers();

                if (
                  !finishingRef.current
                ) {
                  finishingRef.current =
                    true;

                  void stopRecording();
                }
              }
            }, 100);
        } catch (error) {
          console.error(
            'Failed to play Rapid Note Transition reference sequence:',
            error,
          );

          if (
            !mountedRef.current
          ) {
            return;
          }

          setErrorMessage(
            'The reference sequence could not be played. Please try again.',
          );

          setScreen(
            'instructions',
          );
        } finally {
          playingSequenceRef.current =
            false;
        }
      },
      [
        clearTimers,
        exerciseConfig
          .sequence
          .notes,
        startRecording,
        stopRecording,
      ],
    );

  // ----------------------------------------------------------
  // COUNTDOWN
  // ----------------------------------------------------------

  useEffect(() => {
    if (
      screen !==
      'countdown'
    ) {
      return;
    }

    setCountdown(
      COUNTDOWN_SECONDS,
    );

    let remaining =
      COUNTDOWN_SECONDS;

    countdownTimerRef.current =
      setInterval(() => {
        remaining -= 1;

        if (
          !mountedRef.current
        ) {
          return;
        }

        if (
          remaining > 0
        ) {
          setCountdown(
            remaining,
          );

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
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;

      clearTimers();

      void disposeNotePlayer();

      if (isRecording) {
        void stopRecording();
      }
    };
  }, [
    clearTimers,
    isRecording,
    stopRecording,
  ]);

  // ----------------------------------------------------------
  // START EXERCISE
  // ----------------------------------------------------------

  const startExercise =
    useCallback(() => {
      clearTimers();

      resetLiveState();

      setErrorMessage('');

      setResult(null);

      setCurrentRepetition(
        1,
      );

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setScreen(
        'countdown',
      );
    }, [
      clearTimers,
      resetLiveState,
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

        finishingRef.current =
          true;

        clearTimers();

        try {
          await stopRecording();
        } catch (error) {
          console.error(
            'Failed to stop Rapid Note Transition recording:',
            error,
          );

          if (
            !mountedRef.current
          ) {
            return;
          }

          setErrorMessage(
            'We could not stop the recording. Please try again.',
          );

          setScreen(
            'instructions',
          );

          finishingRef.current =
            false;
        }
      },
      [
        clearTimers,
        isRecording,
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

      setResult(null);

      setErrorMessage('');

      setCurrentRepetition(
        1,
      );

      setScreen(
        'instructions',
      );
    }, [
      clearTimers,
      resetLiveState,
    ]);

  // ============================================================
  // INSTRUCTIONS
  // ============================================================

  const renderInstructions =
    () => (
      <View
        style={
          styles.content
        }
      >
        <View
          style={
            styles.exerciseHeader
          }
        >
          <Ionicons
            name="flash-outline"
            size={20}
            color={BROWN}
          />

          <Text
            style={
              styles.eyebrow
            }
          >
            AGILITY
          </Text>
        </View>

        <Text
          style={
            styles.title
          }
        >
          Rapid Note-Transition Exercise
        </Text>

        <Text
          style={
            styles.description
          }
        >
          Quickly sing through a sequence of notes
          while maintaining accurate pitch and
          smooth transitions.
        </Text>

        <View
          style={
            styles.infoCard
          }
        >
          <Text
            style={
              styles.infoTitle
            }
          >
            Exercise Details
          </Text>

          <View
            style={
              styles.infoRow
            }
          >
            <Text
              style={
                styles.infoLabel
              }
            >
              Notes
            </Text>

            <Text
              style={
                styles.infoValue
              }
            >
              {
                exerciseConfig
                  .noteCount
              }
            </Text>
          </View>

          <View
            style={
              styles.infoRow
            }
          >
            <Text
              style={
                styles.infoLabel
              }
            >
              Target Speed
            </Text>

            <Text
              style={
                styles.infoValue
              }
            >
              {
                exerciseConfig
                  .targetSpeed
                  .toFixed(1)
              }{' '}
              notes/sec
            </Text>
          </View>

          <View
            style={
              styles.infoRow
            }
          >
            <Text
              style={
                styles.infoLabel
              }
            >
              Repetitions
            </Text>

            <Text
              style={
                styles.infoValue
              }
            >
              {
                exerciseConfig
                  .repetitions
              }
            </Text>
          </View>

          <View
            style={
              styles.infoRow
            }
          >
            <Text
              style={
                styles.infoLabel
              }
            >
              Accuracy Goal
            </Text>

            <Text
              style={
                styles.infoValue
              }
            >
              {
                exerciseConfig
                  .accuracyThreshold
              }%
            </Text>
          </View>
        </View>

        <View
          style={
            styles.sequencePreviewCard
          }
        >
          <Text
            style={
              styles.cardTitle
            }
          >
            Reference Sequence
          </Text>

          <View
            style={
              styles.noteRow
            }
          >
            {
              exerciseConfig
                .sequence
                .names
                .map(
                  (
                    name,
                    index,
                  ) => (
                    <View
                      key={`${name}-${index}`}
                      style={
                        styles.noteCircle
                      }
                    >
                      <Text
                        style={
                          styles.noteText
                        }
                      >
                        {name}
                      </Text>
                    </View>
                  ),
                )
            }
          </View>

          <Text
            style={
              styles.previewHint
            }
          >
            Listen to the sequence first, then
            sing it back as quickly and accurately
            as possible.
          </Text>
        </View>

        <View
          style={
            styles.directionCard
          }
        >
          <Text
            style={
              styles.directionTitle
            }
          >
            Directions
          </Text>

          <Text
            style={
              styles.directionText
            }
          >
            1. Listen carefully to the reference
            sequence.
          </Text>

          <Text
            style={
              styles.directionText
            }
          >
            2. Sing the same notes in sequence.
          </Text>

          <Text
            style={
              styles.directionText
            }
          >
            3. Move quickly between notes.
          </Text>

          <Text
            style={
              styles.directionText
            }
          >
            4. Keep your pitch accurate.
          </Text>
        </View>

        {errorMessage ? (
          <View
            style={
              styles.errorCard
            }
          >
            <Text
              style={
                styles.errorText
              }
            >
              {errorMessage}
            </Text>
          </View>
        ) : null}

        <Pressable
          style={
            styles.primaryButton
          }
          onPress={
            startExercise
          }
        >
          <Text
            style={
              styles.primaryButtonText
            }
          >
            Start Exercise
          </Text>
        </Pressable>
      </View>
    );

  // ============================================================
  // COUNTDOWN
  // ============================================================

  const renderCountdown =
    () => (
      <View
        style={
          styles.centerContent
        }
      >
        <Text
          style={
            styles.eyebrow
          }
        >
          GET READY
        </Text>

        <Text
          style={
            styles.countdownText
          }
        >
          {countdown}
        </Text>

        <Text
          style={
            styles.subtitle
          }
        >
          Get ready to listen to the reference
          sequence.
        </Text>
      </View>
    );

  // ============================================================
  // LISTENING
  // ============================================================

  const renderListening =
    () => (
      <View
        style={
          styles.centerContent
        }
      >
        <ActivityIndicator
          size="large"
          color={BROWN}
        />

        <Text
          style={
            styles.eyebrow
          }
        >
          LISTEN
        </Text>

        <Text
          style={
            styles.title
          }
        >
          Listen to the sequence
        </Text>

        <View
          style={
            styles.sequenceListenCard
          }
        >
          <Text
            style={
              styles.cardTitle
            }
          >
            Reference Notes
          </Text>

          <View
            style={
              styles.noteRow
            }
          >
            {
              exerciseConfig
                .sequence
                .names
                .map(
                  (
                    name,
                    index,
                  ) => (
                    <View
                      key={`${name}-${index}`}
                      style={
                        styles.noteCircleLarge
                      }
                    >
                      <Text
                        style={
                          styles.noteTextLarge
                        }
                      >
                        {name}
                      </Text>
                    </View>
                  ),
                )
            }
          </View>
        </View>

        <Text
          style={
            styles.subtitle
          }
        >
          The microphone will start after the
          reference sequence finishes.
        </Text>
      </View>
    );

  // ============================================================
  // RECORDING
  // ============================================================

  const renderRecording =
    () => (
      <View
        style={
          styles.content
        }
      >
        <Text
          style={
            styles.eyebrow
          }
        >
          RECORDING
        </Text>

        <Text
          style={
            styles.title
          }
        >
          Sing the sequence
        </Text>

        <View
          style={
            styles.repetitionCard
          }
        >
          <Text
            style={
              styles.repetitionLabel
            }
          >
            REPETITION
          </Text>

          <Text
            style={
              styles.repetitionNumber
            }
          >
            {currentRepetition} /{' '}
            {
              exerciseConfig
                .repetitions
            }
          </Text>
        </View>

        <View
          style={
            styles.timerCard
          }
        >
          <Text
            style={
              styles.timerValue
            }
          >
            {
              elapsedSeconds
                .toFixed(1)
            }s
          </Text>

          <Text
            style={
              styles.timerLabel
            }
          >
            Recording Time
          </Text>
        </View>

        <View
          style={
            styles.metricsCard
          }
        >
          <View
            style={
              styles.metric
            }
          >
            <Text
              style={
                styles.metricValue
              }
            >
              {
                liveTransitionCount
              }
            </Text>

            <Text
              style={
                styles.metricLabel
              }
            >
              Transitions
            </Text>
          </View>

          <View
            style={
              styles.metric
            }
          >
            <Text
              style={
                styles.metricValue
              }
            >
              {
                liveTransitionSpeed
                  .toFixed(1)
              }
            </Text>

            <Text
              style={
                styles.metricLabel
              }
            >
              Notes/sec
            </Text>
          </View>

          <View
            style={
              styles.metric
            }
          >
            <Text
              style={
                styles.metricValue
              }
            >
              {
                livePitch.note
              }
            </Text>

            <Text
              style={
                styles.metricLabel
              }
            >
              Current Note
            </Text>
          </View>
        </View>

        <View
          style={
            styles.sequenceCard
          }
        >
          <Text
            style={
              styles.sequenceTitle
            }
          >
            Sing This Sequence
          </Text>

          <View
            style={
              styles.noteRow
            }
          >
            {
              exerciseConfig
                .sequence
                .names
                .map(
                  (
                    name,
                    index,
                  ) => (
                    <View
                      key={`${name}-${index}`}
                      style={
                        styles.noteCircle
                      }
                    >
                      <Text
                        style={
                          styles.noteText
                        }
                      >
                        {name}
                      </Text>
                    </View>
                  ),
                )
            }
          </View>
        </View>

        <View
          style={
            styles.pitchCard
          }
        >
          <Text
            style={
              styles.cardTitle
            }
          >
            Live Voice
          </Text>

          <Text
            style={
              styles.pitchNote
            }
          >
            {
              livePitch.note
            }
          </Text>

          <Text
            style={
              styles.frequencyText
            }
          >
            {livePitch.pitch > 0
              ? `${livePitch.pitch.toFixed(
                  1,
                )} Hz`
              : '--'}
          </Text>

          <View
            style={
              styles.liveRow
            }
          >
            <Text
              style={
                styles.liveLabel
              }
            >
              Clarity
            </Text>

            <Text
              style={
                styles.liveValue
              }
            >
              {Math.round(
                livePitch.clarity *
                  100,
              )}
              %
            </Text>
          </View>

          <View
            style={
              styles.liveRow
            }
          >
            <Text
              style={
                styles.liveLabel
              }
            >
              Stability
            </Text>

            <Text
              style={
                styles.liveValue
              }
            >
              {Math.round(
                livePitch.stability,
              )}
              %
            </Text>
          </View>
        </View>

        <Pressable
          style={
            styles.stopButton
          }
          onPress={
            finishRecording
          }
          disabled={
            !isRecording
          }
        >
          <Text
            style={
              styles.stopButtonText
            }
          >
            Finish Recording
          </Text>
        </Pressable>
      </View>
    );

  // ============================================================
  // PROCESSING
  // ============================================================

  const renderProcessing =
    () => (
      <View
        style={
          styles.centerContent
        }
      >
        <ActivityIndicator
          size="large"
          color={BROWN}
        />

        <Text
          style={
            styles.eyebrow
          }
        >
          PROCESSING
        </Text>

        <Text
          style={
            styles.title
          }
        >
          Analyzing your performance...
        </Text>

        <Text
          style={
            styles.subtitle
          }
        >
          Measuring note transitions, speed, sequence
          accuracy, and pitch accuracy.
        </Text>
      </View>
    );

  // ============================================================
  // RESULTS
  // ============================================================

  const renderResults =
    () => {
      if (!result) {
        return null;
      }

      return (
        <View
          style={
            styles.content
          }
        >
          <Text
            style={
              styles.eyebrow
            }
          >
            RESULTS
          </Text>

          <Text
            style={
              styles.title
            }
          >
            Rapid Note-Transition Results
          </Text>

          {/* OVERALL SCORE */}

          <View
            style={
              styles.scoreCard
            }
          >
            <Text
              style={
                styles.scoreLabel
              }
            >
              OVERALL SCORE
            </Text>

            <Text
              style={
                styles.scoreValue
              }
            >
              {
                result.overall
              }
            </Text>

            <Text
              style={
                styles.scoreOutOf
              }
            >
              / 100
            </Text>

            <View
              style={[
                styles.statusBadge,
                result.passed
                  ? styles.statusPassed
                  : styles.statusNeedsWork,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  result.passed
                    ? styles.statusPassedText
                    : styles.statusNeedsWorkText,
                ]}
              >
                {result.passed
                  ? 'PASSED'
                  : 'KEEP PRACTICING'}
              </Text>
            </View>
          </View>

          {/* PERFORMANCE METRICS */}

          <View
            style={
              styles.metricsCard
            }
          >
            <View
              style={
                styles.metric
              }
            >
              <Text
                style={
                  styles.metricValue
                }
              >
                {
                  result.transitionCount
                }
              </Text>

              <Text
                style={
                  styles.metricLabel
                }
              >
                Transitions
              </Text>
            </View>

            <View
              style={
                styles.metric
              }
            >
              <Text
                style={
                  styles.metricValue
                }
              >
                {
                  result.transitionsPerSecond.toFixed(
                    1,
                  )
                }
              </Text>

              <Text
                style={
                  styles.metricLabel
                }
              >
                Transitions/sec
              </Text>
            </View>

            <View
              style={
                styles.metric
              }
            >
              <Text
                style={
                  styles.metricValue
                }
              >
                {
                  result.averageTransitionTimeMs.toFixed(
                    0,
                  )
                }
                ms
              </Text>

              <Text
                style={
                  styles.metricLabel
                }
              >
                Avg. Transition
              </Text>
            </View>
          </View>

          {/* SCORE BREAKDOWN */}

          <View
            style={
              styles.breakdownCard
            }
          >
            <Text
              style={
                styles.cardTitle
              }
            >
              Score Breakdown
            </Text>

            <View
              style={
                styles.liveRow
              }
            >
              <Text
                style={
                  styles.liveLabel
                }
              >
                Pitch Accuracy
              </Text>

              <Text
                style={
                  styles.liveValue
                }
              >
                {
                  result.pitchScore
                }%
              </Text>
            </View>

            <View
              style={
                styles.liveRow
              }
            >
              <Text
                style={
                  styles.liveLabel
                }
              >
                Sequence Accuracy
              </Text>

              <Text
                style={
                  styles.liveValue
                }
              >
                {
                  result.sequenceScore
                }%
              </Text>
            </View>

            <View
              style={
                styles.liveRow
              }
            >
              <Text
                style={
                  styles.liveLabel
                }
              >
                Transition Speed
              </Text>

              <Text
                style={
                  styles.liveValue
                }
              >
                {
                  result.speedScore
                }%
              </Text>
            </View>

            <View
              style={
                styles.liveRow
              }
            >
              <Text
                style={
                  styles.liveLabel
                }
              >
                Target Accuracy
              </Text>

              <Text
                style={
                  styles.liveValue
                }
              >
                {
                  exerciseConfig
                    .accuracyThreshold
                }%
              </Text>
            </View>
          </View>

          {/* FEEDBACK */}

          <View
            style={
              styles.feedbackCard
            }
          >
            <View
              style={
                styles.feedbackHeader
              }
            >
              <Ionicons
                name="bulb-outline"
                size={20}
                color={BROWN}
              />

              <Text
                style={
                  styles.feedbackTitle
                }
              >
                Feedback
              </Text>
            </View>

            <Text
              style={
                styles.feedbackText
              }
            >
              {
                result.feedback
              }
            </Text>
          </View>

          <Pressable
            style={
              styles.primaryButton
            }
            onPress={
              retryExercise
            }
          >
            <Text
              style={
                styles.primaryButtonText
              }
            >
              Try Again
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
      style={
        styles.safeArea
      }
      contentContainerStyle={
        styles.container
      }
      showsVerticalScrollIndicator={
        false
      }
    >
      {screen ===
        'instructions' &&
        renderInstructions()}

      {screen ===
        'countdown' &&
        renderCountdown()}

      {screen ===
        'listening' &&
        renderListening()}

      {screen ===
        'recording' &&
        renderRecording()}

      {screen ===
        'processing' &&
        renderProcessing()}

      {screen ===
        'results' &&
        renderResults()}
    </ScrollView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles =
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor:
        LIGHT_PINK,
    },

    container: {
      flexGrow: 1,
      padding: 24,
    },

    content: {
      flex: 1,
    },

    centerContent: {
      flex: 1,
      minHeight: 600,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },

    exerciseHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },

    eyebrow: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 2,
      color: BROWN,
      marginBottom: 10,
    },

    title: {
      fontSize: 28,
      fontWeight: '800',
      color: BROWN,
      marginBottom: 12,
    },

    description: {
      fontSize: 16,
      lineHeight: 24,
      color: MUTED,
      marginBottom: 24,
    },

    subtitle: {
      fontSize: 16,
      lineHeight: 24,
      textAlign: 'center',
      color: MUTED,
      marginTop: 12,
      maxWidth: 330,
    },

    infoCard: {
      backgroundColor: WHITE,
      borderRadius: 20,
      padding: 20,
      marginBottom: 16,
    },

    infoTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: BROWN,
      marginBottom: 14,
    },

    infoRow: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      paddingVertical: 8,
    },

    infoLabel: {
      fontSize: 15,
      color: MUTED,
    },

    infoValue: {
      fontSize: 15,
      fontWeight: '700',
      color: BROWN,
    },

    sequencePreviewCard: {
      backgroundColor: WHITE,
      borderRadius: 20,
      padding: 20,
      marginBottom: 16,
    },

    sequenceListenCard: {
      backgroundColor: WHITE,
      borderRadius: 20,
      padding: 22,
      marginTop: 24,
    },

    directionCard: {
      backgroundColor: PINK,
      borderRadius: 20,
      padding: 20,
      marginBottom: 24,
    },

    directionTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: BROWN,
      marginBottom: 12,
    },

    directionText: {
      fontSize: 15,
      lineHeight: 23,
      color: BROWN,
      marginBottom: 6,
    },

    previewHint: {
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
      color: MUTED,
      marginTop: 16,
    },

    errorCard: {
      backgroundColor: '#FDECEC',
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
    },

    errorText: {
      fontSize: 14,
      lineHeight: 20,
      color: RED,
    },

    primaryButton: {
      backgroundColor: BROWN,
      borderRadius: 16,
      minHeight: 56,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },

    primaryButtonText: {
      color: WHITE,
      fontSize: 16,
      fontWeight: '700',
    },

    countdownText: {
      fontSize: 96,
      fontWeight: '800',
      color: BROWN,
    },

    repetitionCard: {
      backgroundColor: WHITE,
      borderRadius: 20,
      padding: 20,
      alignItems: 'center',
      marginBottom: 16,
    },

    repetitionLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.5,
      color: MUTED,
    },

    repetitionNumber: {
      fontSize: 30,
      fontWeight: '800',
      color: BROWN,
      marginTop: 6,
    },

    timerCard: {
      backgroundColor: PINK,
      borderRadius: 20,
      padding: 18,
      alignItems: 'center',
      marginBottom: 16,
    },

    timerValue: {
      fontSize: 34,
      fontWeight: '800',
      color: BROWN,
    },

    timerLabel: {
      fontSize: 12,
      color: MUTED,
      marginTop: 4,
    },

    metricsCard: {
      flexDirection: 'row',
      backgroundColor: WHITE,
      borderRadius: 20,
      paddingVertical: 22,
      marginBottom: 16,
    },

    metric: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 4,
    },

    metricValue: {
      fontSize: 22,
      fontWeight: '800',
      color: BROWN,
      textAlign: 'center',
    },

    metricLabel: {
      fontSize: 12,
      color: MUTED,
      marginTop: 5,
      textAlign: 'center',
    },

    sequenceCard: {
      backgroundColor: WHITE,
      borderRadius: 20,
      padding: 20,
      marginBottom: 16,
    },

    sequenceTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: BROWN,
      marginBottom: 18,
    },

    noteRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: 10,
    },

    noteCircle: {
      minWidth: 48,
      height: 48,
      borderRadius: 24,
      paddingHorizontal: 10,
      backgroundColor: PINK,
      alignItems: 'center',
      justifyContent: 'center',
    },

    noteText: {
      fontSize: 14,
      fontWeight: '700',
      color: BROWN,
    },

    noteCircleLarge: {
      minWidth: 58,
      height: 58,
      borderRadius: 29,
      paddingHorizontal: 12,
      backgroundColor: PINK,
      alignItems: 'center',
      justifyContent: 'center',
    },

    noteTextLarge: {
      fontSize: 16,
      fontWeight: '800',
      color: BROWN,
    },

    pitchCard: {
      backgroundColor: WHITE,
      borderRadius: 20,
      padding: 20,
      marginBottom: 16,
      alignItems: 'center',
    },

    cardTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: BROWN,
      marginBottom: 14,
    },

    pitchNote: {
      fontSize: 42,
      fontWeight: '800',
      color: BROWN,
    },

    frequencyText: {
      fontSize: 14,
      color: MUTED,
      marginTop: 4,
      marginBottom: 16,
    },

    liveRow: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      width: '100%',
      paddingVertical: 7,
    },

    liveLabel: {
      fontSize: 14,
      color: MUTED,
    },

    liveValue: {
      fontSize: 14,
      fontWeight: '700',
      color: BROWN,
    },

    stopButton: {
      backgroundColor: BROWN,
      borderRadius: 16,
      minHeight: 56,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },

    stopButtonText: {
      color: WHITE,
      fontSize: 16,
      fontWeight: '700',
    },

    scoreCard: {
      backgroundColor: WHITE,
      borderRadius: 24,
      padding: 28,
      alignItems: 'center',
      marginBottom: 16,
    },

    scoreLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.5,
      color: MUTED,
    },

    scoreValue: {
      fontSize: 72,
      fontWeight: '800',
      color: BROWN,
      marginTop: 4,
    },

    scoreOutOf: {
      fontSize: 15,
      color: MUTED,
    },

    statusBadge: {
      marginTop: 16,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },

    statusPassed: {
      backgroundColor: '#E8F6EC',
    },

    statusNeedsWork: {
      backgroundColor: '#FFF0F0',
    },

    statusText: {
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1,
    },

    statusPassedText: {
      color: GREEN,
    },

    statusNeedsWorkText: {
      color: RED,
    },

    breakdownCard: {
      backgroundColor: WHITE,
      borderRadius: 20,
      padding: 20,
      marginBottom: 16,
    },

    feedbackCard: {
      backgroundColor: PINK,
      borderRadius: 20,
      padding: 20,
      marginBottom: 24,
    },

    feedbackHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },

    feedbackTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: BROWN,
    },

    feedbackText: {
      fontSize: 15,
      lineHeight: 23,
      color: BROWN,
    },
  });