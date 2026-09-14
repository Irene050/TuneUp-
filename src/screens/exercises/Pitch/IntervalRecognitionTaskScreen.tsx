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
  INTERVAL_RECOGNITION_PARAMS,
  Tier,
} from '@/constants/exercises/pitch';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  measureIntervalRecognition,
} from '@/services/measurement/pitch/intervalRecognitionTask';

import {
  IntervalRecognitionScoreResult,
  scoreIntervalRecognitionTask,
} from '@/services/scoring/pitch/intervalRecognitionTask';

import {
  playNoteSequence,
} from '@/services/assessment/notePlayer';

import {
  createMusicalNote,
} from '@/utils/music/notes';

import {
  calcLiveStability,
  calcPitchAccuracy,
  frequencyToNote,
} from '@/utils/dsp/pitch';

// ============================================================
// COLORS
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';

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

// ============================================================
// INTERVALS
// ============================================================

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

// ============================================================
// GENERATE INTERVAL
// ============================================================

function generateInterval(
  tier: Tier
): GeneratedInterval {
  const availableIntervals =
    tier === 'advanced'
      ? INTERVALS
      : INTERVALS.filter(
          (interval) =>
            interval.name !== 'Octave'
        );

  const interval =
    availableIntervals[
      Math.floor(
        Math.random() *
          availableIntervals.length
      )
    ];

  /*
   * Keep generated notes in a practical
   * singing range.
   */
  const minRoot =
    interval.semitones >= 12
      ? 48
      : 55;

  const maxRoot =
    interval.semitones >= 12
      ? 60
      : 67 -
        interval.semitones;

  const rootMidi =
    minRoot +
    Math.floor(
      Math.random() *
        (maxRoot - minRoot + 1)
    );

  const targetMidi =
    rootMidi +
    interval.semitones;

  const rootNote =
    createMusicalNote(rootMidi);

  const targetNote =
    createMusicalNote(targetMidi);

  return {
    rootNote,
    targetNote,
    interval: {
      ...interval,
      ratio:
        targetNote.frequency /
        rootNote.frequency,
    },
  };
}

// ============================================================
// SCREEN
// ============================================================

export default function IntervalRecognitionTaskScreen({
  tier = 'beginner',
}: Props) {
  const params =
    INTERVAL_RECOGNITION_PARAMS[tier];

  // ==========================================================
  // STATE
  // ==========================================================

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(3);

  const [rootNote, setRootNote] =
    useState(() =>
      createMusicalNote(60)
    );

  const [targetNote, setTargetNote] =
    useState(() =>
      createMusicalNote(67)
    );

  const [interval, setIntervalValue] =
    useState<IntervalDefinition>(
      INTERVALS[2]
    );

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(
      null
    );

  const [liveFrequencies, setLiveFrequencies] =
    useState<number[]>([]);

  const [recordingElapsedMs, setRecordingElapsedMs] =
    useState(0);

  const [result, setResult] =
    useState<IntervalRecognitionScoreResult | null>(
      null
    );

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  // ==========================================================
  // REFS
  // ==========================================================

  const mountedRef =
    useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null
    );

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null
    );

  const recordingRef =
    useRef(false);

  const stopRequestedRef =
    useRef(false);

  const processingRef =
    useRef(false);

  const recordingElapsedRef =
    useRef(0);

  const pitchHistoryRef =
    useRef<number[]>([]);

  const stopRecordingRef =
    useRef<
      (() => Promise<void>) | null
    >(null);

  /*
   * IMPORTANT:
   * Stores the exact generated exercise.
   *
   * This prevents playback/scoring from using
   * stale React state.
   */
  const currentExerciseRef =
    useRef<GeneratedInterval | null>(
      null
    );

  // ==========================================================
  // CLEANUP
  // ==========================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current
        );

        countdownTimerRef.current =
          null;
      }

      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current
        );

        recordingTimerRef.current =
          null;
      }

      if (recordingRef.current) {
        stopRecordingRef.current?.();
      }
    };
  }, []);

  // ==========================================================
  // LIVE AUDIO
  // ==========================================================

  const handleLiveFrame =
    useCallback(
      (frame: LiveAudioFrame) => {
        if (!mountedRef.current) {
          return;
        }

        setLiveFrame(frame);

        if (
          Number.isFinite(
            frame.pitch
          ) &&
          frame.pitch > 0
        ) {
          pitchHistoryRef.current = [
            ...pitchHistoryRef.current,
            frame.pitch,
          ].slice(-30);

          setLiveFrequencies(
            pitchHistoryRef.current
          );
        }
      },
      []
    );

  // ==========================================================
  // RECORDING STOP
  // ==========================================================

  const handleRecordingStop =
    useCallback(
      (
        samples: Float32Array,
        sampleRate: number
      ) => {
        if (!mountedRef.current) {
          return;
        }

        if (
          processingRef.current
        ) {
          return;
        }

        processingRef.current =
          true;

        recordingRef.current =
          false;

        if (
          recordingTimerRef.current
        ) {
          clearInterval(
            recordingTimerRef.current
          );

          recordingTimerRef.current =
            null;
        }

        setPhase('processing');

        try {
          const exercise =
            currentExerciseRef.current;

          if (!exercise) {
            throw new Error(
              'No current interval exercise.'
            );
          }

          const measurement =
            measureIntervalRecognition(
              samples,
              sampleRate,
              params.minClarity
            );

          const score =
            scoreIntervalRecognitionTask(
              measurement,
              exercise.interval.ratio,
              exercise.interval.name,
              tier
            );

          console.log(
            '🎯 INTERVAL EXERCISE',
            {
              root:
                exercise.rootNote.name,
              rootHz:
                exercise.rootNote.frequency,
              target:
                exercise.targetNote.name,
              targetHz:
                exercise.targetNote.frequency,
              interval:
                exercise.interval.name,
            }
          );

          if (!mountedRef.current) {
            return;
          }

          setResult(score);
          setPhase('results');
        } catch (error) {
          console.error(
            '❌ INTERVAL PROCESSING ERROR:',
            error
          );

          if (
            mountedRef.current
          ) {
            setErrorMessage(
              'We could not analyze your recording. Please try again.'
            );

            setPhase(
              'instructions'
            );
          }
        } finally {
          processingRef.current =
            false;

          stopRequestedRef.current =
            false;
        }
      },
      [
        params.minClarity,
        tier,
      ]
    );

  // ==========================================================
  // AUDIO RECORDER
  // ==========================================================

  const {
    startRecording,
    stopRecording,
    isRecording,
  } =
    useAudioRecorder({
      onFrame:
        handleLiveFrame,

      onStop:
        handleRecordingStop,
    });

  // ==========================================================
  // STOP REF
  // ==========================================================

  useEffect(() => {
    stopRecordingRef.current =
      stopRecording;

    return () => {
      stopRecordingRef.current =
        null;
    };
  }, [stopRecording]);

  // ==========================================================
  // BEGIN RECORDING
  // ==========================================================

  const beginRecording =
    useCallback(
      async () => {
        if (
          !mountedRef.current ||
          recordingRef.current
        ) {
          return;
        }

        try {
          pitchHistoryRef.current = [];

          setLiveFrequencies([]);
          setLiveFrame(null);

          recordingElapsedRef.current =
            0;

          setRecordingElapsedMs(0);

          stopRequestedRef.current =
            false;

          processingRef.current =
            false;

          setPhase('recording');

          await startRecording();

          if (!mountedRef.current) {
            return;
          }

          recordingRef.current =
            true;

          const durationMs =
            Math.max(
              3000,
              params.totalDurationSec *
                1000
            );

          recordingTimerRef.current =
            setInterval(() => {
              if (
                !mountedRef.current ||
                !recordingRef.current ||
                stopRequestedRef.current
              ) {
                return;
              }

              recordingElapsedRef.current +=
                100;

              const elapsed =
                recordingElapsedRef.current;

              setRecordingElapsedMs(
                elapsed
              );

              if (
                elapsed >=
                durationMs
              ) {
                if (
                  recordingTimerRef.current
                ) {
                  clearInterval(
                    recordingTimerRef.current
                  );

                  recordingTimerRef.current =
                    null;
                }

                if (
                  stopRequestedRef.current
                ) {
                  return;
                }

                stopRequestedRef.current =
                  true;

                stopRecording().catch(
                  (error) => {
                    console.error(
                      '❌ FAILED TO STOP INTERVAL RECORDING:',
                      error
                    );

                    recordingRef.current =
                      false;

                    stopRequestedRef.current =
                      false;

                    if (
                      mountedRef.current
                    ) {
                      setErrorMessage(
                        'We could not finish the recording. Please try again.'
                      );

                      setPhase(
                        'instructions'
                      );
                    }
                  }
                );
              }
            }, 100);
        } catch (error) {
          console.error(
            '❌ FAILED TO START INTERVAL RECORDING:',
            error
          );

          recordingRef.current =
            false;

          stopRequestedRef.current =
            false;

          if (
            mountedRef.current
          ) {
            setPhase(
              'instructions'
            );

            Alert.alert(
              'Microphone Error',
              'Unable to start the microphone. Please check your microphone permission and try again.'
            );
          }
        }
      },
      [
        params.totalDurationSec,
        startRecording,
        stopRecording,
      ]
    );

  // ==========================================================
  // PLAY INTERVAL
  // ==========================================================

  const playIntervalAndRecord =
    useCallback(
      async (
        exercise: GeneratedInterval
      ) => {
        if (!mountedRef.current) {
          return;
        }

        try {
          setPhase('playing');

          console.log(
            '🔊 PLAYING GENERATED INTERVAL',
            {
              root:
                exercise.rootNote.name,
              rootHz:
                exercise.rootNote.frequency,
              target:
                exercise.targetNote.name,
              targetHz:
                exercise.targetNote.frequency,
              interval:
                exercise.interval.name,
            }
          );

          await playNoteSequence([
            {
              frequencyHz:
                exercise.rootNote.frequency,
              durationSec: 0.8,
            },
            {
              frequencyHz:
                exercise.targetNote.frequency,
              durationSec: 0.8,
            },
          ]);

          if (!mountedRef.current) {
            return;
          }

          await beginRecording();
        } catch (error) {
          console.error(
            '❌ FAILED TO PLAY INTERVAL:',
            error
          );

          if (
            mountedRef.current
          ) {
            setPhase(
              'instructions'
            );

            Alert.alert(
              'Audio Error',
              'Unable to play the target interval. Please try again.'
            );
          }
        }
      },
      [beginRecording]
    );

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  const startCountdown =
    useCallback(() => {
      const generated =
        generateInterval(tier);

      /*
       * Store the exact generated exercise
       * immediately.
       */
      currentExerciseRef.current =
        generated;

      /*
       * State is only used for displaying
       * the exercise.
       */
      setRootNote(
        generated.rootNote
      );

      setTargetNote(
        generated.targetNote
      );

      setIntervalValue(
        generated.interval
      );

      setResult(null);
      setErrorMessage(null);

      setLiveFrame(null);
      setLiveFrequencies([]);

      pitchHistoryRef.current = [];

      recordingElapsedRef.current =
        0;

      setRecordingElapsedMs(0);

      processingRef.current =
        false;

      stopRequestedRef.current =
        false;

      recordingRef.current =
        false;

      setCountdown(3);
      setPhase('countdown');

      let value = 3;

      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current
        );
      }

      countdownTimerRef.current =
        setInterval(() => {
          value--;

          if (value <= 0) {
            if (
              countdownTimerRef.current
            ) {
              clearInterval(
                countdownTimerRef.current
              );

              countdownTimerRef.current =
                null;
            }

            /*
             * IMPORTANT:
             * Pass `generated`, not React state.
             */
            playIntervalAndRecord(
              generated
            );

            return;
          }

          setCountdown(value);
        }, 1000);
    }, [
      playIntervalAndRecord,
      tier,
    ]);

  // ==========================================================
  // RETRY
  // ==========================================================

  const retry =
    useCallback(() => {
      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current
        );

        countdownTimerRef.current =
          null;
      }

      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current
        );

        recordingTimerRef.current =
          null;
      }

      currentExerciseRef.current =
        null;

      setResult(null);
      setLiveFrame(null);
      setLiveFrequencies([]);

      pitchHistoryRef.current = [];

      recordingElapsedRef.current =
        0;

      setRecordingElapsedMs(0);

      processingRef.current =
        false;

      stopRequestedRef.current =
        false;

      recordingRef.current =
        false;

      setPhase(
        'instructions'
      );
    }, []);

  // ==========================================================
  // RECORDING PROGRESS
  // ==========================================================

  const recordingDurationMs =
    params.totalDurationSec *
    1000;

  const recordingProgress =
    recordingDurationMs > 0
      ? Math.min(
          1,
          recordingElapsedMs /
            recordingDurationMs
        )
      : 0;

  /*
   * The live UI uses the halfway point only
   * as a visual guide.
   *
   * Final scoring uses the actual pause
   * between the sung notes.
   */
  const liveTarget =
    recordingProgress < 0.5
      ? rootNote
      : targetNote;

  const liveAccuracy =
    liveFrame &&
    liveFrame.pitch > 0
      ? calcPitchAccuracy(
          liveFrame.pitch,
          liveTarget.frequency
        )
      : 0;

  const liveStability =
    calcLiveStability(
      liveFrequencies
    );

  // ==========================================================
  // INSTRUCTIONS
  // ==========================================================

  if (
    phase === 'instructions'
  ) {
    return (
      <View style={styles.screen}>
        <Pressable
          style={styles.backButton}
          onPress={() =>
            router.replace(
              '/dashboard/exercises'
            )
          }
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={BROWN}
          />
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.content
          }
        >
          <View
            style={styles.iconCircle}
          >
            <Ionicons
              name="swap-vertical-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.title}
          >
            Interval Recognition Task
          </Text>

          <Text
            style={styles.subtitle}
          >
            Pitch
          </Text>

          <View
            style={
              styles.instructionCard
            }
          >
            <View
              style={
                styles.prepareCard
              }
            >
              <View
                style={
                  styles.prepareHeader
                }
              >
                <Ionicons
                  name="mic-outline"
                  size={21}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareTitle
                  }
                >
                  Before You Begin
                </Text>
              </View>

              <View
                style={
                  styles.prepareItem
                }
              >
                <Ionicons
                  name="volume-mute-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareText
                  }
                >
                  Find a quiet room or area
                  with minimal background
                  noise.
                </Text>
              </View>

              <View
                style={
                  styles.prepareItem
                }
              >
                <Ionicons
                  name="body-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareText
                  }
                >
                  Sit upright or stand with
                  your back straight and
                  your shoulders relaxed.
                </Text>
              </View>

              <View
                style={
                  styles.prepareItem
                }
              >
                <Ionicons
                  name="mic-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareText
                  }
                >
                  If available, an external
                  microphone or audio
                  recording equipment is
                  recommended for clearer
                  audio capture.
                </Text>
              </View>
            </View>

            <Text
              style={styles.cardTitle}
            >
              Instructions
            </Text>

            <Text
              style={styles.instruction}
            >
              Listen carefully to the two
              reference notes.
            </Text>

            <Text
              style={styles.instruction}
            >
              After the reference interval
              finishes, sing the first note,
              pause briefly, then sing the
              second note.
            </Text>

            <Text
              style={styles.instruction}
            >
              Try to reproduce the same
              distance between the two
              notes.
            </Text>

            <View
              style={styles.targetBox}
            >
              <Ionicons
                name="swap-vertical"
                size={25}
                color={BROWN}
              />

              <Text
                style={styles.targetText}
              >
                Match the interval
              </Text>
            </View>

            <Text
              style={styles.helperText}
            >
              The exercise evaluates how
              accurately you reproduce the
              pitch relationship between the
              two notes.
            </Text>
          </View>

          <View
            style={styles.tipCard}
          >
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text
              style={styles.tipText}
            >
              Leave a short, clear pause
              between your first and second
              notes so TuneUp! can detect
              them separately.
            </Text>
          </View>

          <View
            style={
              styles.difficultyRow
            }
          >
            <Text
              style={
                styles.difficultyLabel
              }
            >
              Difficulty
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {tier}
            </Text>
          </View>

          <Pressable
            style={styles.startButton}
            onPress={startCountdown}
          >
            <Text
              style={
                styles.startButtonText
              }
            >
              Start Exercise
            </Text>

            <Ionicons
              name="arrow-forward"
              size={18}
              color={WHITE}
            />
          </Pressable>

          {errorMessage && (
            <Text
              style={
                styles.errorText
              }
            >
              {errorMessage}
            </Text>
          )}
        </ScrollView>
      </View>
    );
  }

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  if (
    phase === 'countdown'
  ) {
    return (
      <View
        style={styles.centerScreen}
      >
        <View
          style={styles.iconCircle}
        >
          <Ionicons
            name="musical-notes-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Get Ready
        </Text>

        <Text
          style={styles.countdownText}
        >
          {countdown}
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Listen carefully to the
          interval.
        </Text>
      </View>
    );
  }

  // ==========================================================
  // PLAYING
  // ==========================================================

  if (
    phase === 'playing'
  ) {
    return (
      <View
        style={styles.centerScreen}
      >
        <View
          style={styles.iconCircle}
        >
          <Ionicons
            name="volume-high-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Listen to the Interval
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Listen to the two reference
          notes.
        </Text>

        <View
          style={styles.intervalPreview}
        >
          <View
            style={styles.intervalNote}
          >
            <Text
              style={
                styles.intervalNoteLabel
              }
            >
              START
            </Text>

            <Text
              style={
                styles.intervalNoteName
              }
            >
              {rootNote.name}
            </Text>
          </View>

          <Ionicons
            name="arrow-forward"
            size={25}
            color={BROWN}
          />

          <View
            style={styles.intervalNote}
          >
            <Text
              style={
                styles.intervalNoteLabel
              }
            >
              TARGET
            </Text>

            <Text
              style={
                styles.intervalNoteName
              }
            >
              {targetNote.name}
            </Text>
          </View>
        </View>

        <View
          style={styles.intervalNameBadge}
        >
          <Text
            style={
              styles.intervalNameText
            }
          >
            {interval.name}
          </Text>
        </View>

        <ActivityIndicator
          size="small"
          color={BROWN}
          style={
            styles.playingIndicator
          }
        />
      </View>
    );
  }

  // ==========================================================
  // RECORDING
  // ==========================================================

  if (
    phase === 'recording'
  ) {
    const firstHalf =
      recordingProgress < 0.5;

    return (
      <View
        style={styles.centerScreen}
      >
        <View
          style={
            styles.recordingIcon
          }
        >
          <Ionicons
            name="mic"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Sing the Interval
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          {firstHalf
            ? `Sing ${rootNote.name}, then pause.`
            : `Now sing ${targetNote.name}.`}
        </Text>

        <View
          style={styles.liveCard}
        >
          <Text
            style={styles.liveLabel}
          >
            Current Target
          </Text>

          <Text
            style={styles.liveTarget}
          >
            {liveTarget.name}
          </Text>

          <View
            style={styles.liveDivider}
          />

          <Text
            style={styles.liveLabel}
          >
            Your Note
          </Text>

          <Text
            style={styles.liveNote}
          >
            {liveFrame?.note ?? '--'}
          </Text>

          <Text
            style={
              styles.liveFrequency
            }
          >
            {liveFrame &&
            liveFrame.pitch > 0
              ? `${Math.round(
                  liveFrame.pitch
                )} Hz`
              : '--'}
          </Text>

          <View
            style={styles.liveStats}
          >
            <View
              style={styles.liveStat}
            >
              <Text
                style={
                  styles.liveStatLabel
                }
              >
                Accuracy
              </Text>

              <Text
                style={
                  styles.liveStatValue
                }
              >
                {Math.round(
                  liveAccuracy
                )}
                %
              </Text>
            </View>

            <View
              style={styles.liveStat}
            >
              <Text
                style={
                  styles.liveStatLabel
                }
              >
                Stability
              </Text>

              <Text
                style={
                  styles.liveStatValue
                }
              >
                {Math.round(
                  liveStability
                )}
                %
              </Text>
            </View>
          </View>
        </View>

        <View
          style={
            styles.intervalProgress
          }
        >
          <View
            style={[
              styles.intervalProgressNote,
              firstHalf &&
                styles.intervalProgressActive,
            ]}
          >
            <Text
              style={[
                styles.intervalProgressText,
                firstHalf &&
                  styles.intervalProgressTextActive,
              ]}
            >
              {rootNote.name}
            </Text>
          </View>

          <View
            style={
              styles.progressLine
            }
          />

          <View
            style={[
              styles.intervalProgressNote,
              !firstHalf &&
                styles.intervalProgressActive,
            ]}
          >
            <Text
              style={[
                styles.intervalProgressText,
                !firstHalf &&
                  styles.intervalProgressTextActive,
              ]}
            >
              {targetNote.name}
            </Text>
          </View>
        </View>

        <View
          style={
            styles.recordingIndicator
          }
        >
          <View
            style={
              styles.recordingDot
            }
          />

          <Text
            style={
              styles.recordingText
            }
          >
            {isRecording
              ? 'Recording...'
              : 'Preparing microphone...'}
          </Text>
        </View>
      </View>
    );
  }

  // ==========================================================
  // PROCESSING
  // ==========================================================

  if (
    phase === 'processing'
  ) {
    return (
      <View
        style={styles.centerScreen}
      >
        <View
          style={styles.iconCircle}
        >
          <Ionicons
            name="analytics-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Analyzing Your Singing
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Checking your interval accuracy.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={
            styles.processingIndicator
          }
        />
      </View>
    );
  }

  // ==========================================================
  // RESULTS
  // ==========================================================

  if (
    phase === 'results' &&
    result
  ) {
    const detectedNote1 =
      result.freq1 > 0
        ? frequencyToNote(
            result.freq1
          )
        : '--';

    const detectedNote2 =
      result.freq2 > 0
        ? frequencyToNote(
            result.freq2
          )
        : '--';

    return (
      <View style={styles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.resultsContent
          }
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
              name={
                result.passed
                  ? 'checkmark'
                  : 'refresh'
              }
              size={40}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.resultTitle}
          >
            {result.passed
              ? 'Great Job!'
              : 'Keep Practicing!'}
          </Text>

          <Text
            style={
              styles.resultSubtitle
            }
          >
            Interval Recognition Result
          </Text>

          <View
            style={styles.scoreCard}
          >
            <Text
              style={styles.scoreLabel}
            >
              Overall Score
            </Text>

            <Text
              style={styles.scoreValue}
            >
              {result.score}%
            </Text>

            <Text
              style={
                styles.scoreDescription
              }
            >
              {result.passed
                ? 'Your interval was within the target tolerance.'
                : 'Try to reproduce the distance between the notes more accurately.'}
            </Text>
          </View>

          <View
            style={
              styles.intervalResultCard
            }
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Target Interval
            </Text>

            <View
              style={
                styles.intervalResultDisplay
              }
            >
              <View
                style={
                  styles.intervalResultNote
                }
              >
                <Text
                  style={
                    styles.intervalResultLabel
                  }
                >
                  START
                </Text>

                <Text
                  style={
                    styles.intervalResultNoteName
                  }
                >
                  {rootNote.name}
                </Text>
              </View>

              <View
                style={
                  styles.intervalArrow
                }
              >
                <Ionicons
                  name="arrow-forward"
                  size={23}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.intervalArrowLabel
                  }
                >
                  {result.intervalName}
                </Text>
              </View>

              <View
                style={
                  styles.intervalResultNote
                }
              >
                <Text
                  style={
                    styles.intervalResultLabel
                  }
                >
                  TARGET
                </Text>

                <Text
                  style={
                    styles.intervalResultNoteName
                  }
                >
                  {targetNote.name}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={styles.resultCard}
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Your Performance
            </Text>

            <View
              style={styles.resultRow}
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Detected first note
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {detectedNote1}
              </Text>
            </View>

            <View
              style={styles.resultRow}
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Detected second note
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {detectedNote2}
              </Text>
            </View>

            <View
              style={styles.resultRow}
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Target ratio
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {result.targetRatio.toFixed(
                  3
                )}
              </Text>
            </View>

            <View
              style={styles.resultRow}
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Detected ratio
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {result.detectedRatio > 0
                  ? result.detectedRatio.toFixed(
                      3
                    )
                  : '--'}
              </Text>
            </View>

            <View
              style={styles.resultRow}
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Interval deviation
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {result.deviationPct.toFixed(
                  1
                )}
                %
              </Text>
            </View>
          </View>

          <View
            style={styles.resultCard}
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Audio Quality
            </Text>

            <View
              style={styles.resultRow}
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                First note clarity
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {Math.round(
                  result.firstNoteClarity *
                    100
                )}
                %
              </Text>
            </View>

            <View
              style={styles.resultRow}
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Second note clarity
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {Math.round(
                  result.secondNoteClarity *
                    100
                )}
                %
              </Text>
            </View>
          </View>

          <View
            style={styles.tipCard}
          >
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text
              style={styles.tipText}
            >
              {result.passed
                ? 'Nice interval matching! Keep focusing on hearing the distance between notes before you sing.'
                : 'Listen carefully to the reference notes, then pause briefly between your two sung notes so the interval can be reproduced accurately.'}
            </Text>
          </View>

          <Pressable
            style={styles.startButton}
            onPress={retry}
          >
            <Text
              style={
                styles.startButtonText
              }
            >
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
            onPress={() =>
              router.replace(
                '/dashboard/exercises'
              )
            }
          >
            <Text
              style={
                styles.doneButtonText
              }
            >
              Done
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return null;
}

// ============================================================
// STYLES
// ============================================================

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
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
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

  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 12,
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
    borderColor: '#F2DDE5',
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
    borderColor: '#F2DDE5',
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
    backgroundColor: '#F2DDE5',
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

  intervalProgress: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
  },

  intervalProgressNote: {
    minWidth: 58,
    height: 42,
    borderRadius: 14,
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
    fontSize: 12,
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

  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
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

  processingIndicator: {
    marginTop: 28,
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
    borderColor: '#F2DDE5',
  },

  resultCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
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
});