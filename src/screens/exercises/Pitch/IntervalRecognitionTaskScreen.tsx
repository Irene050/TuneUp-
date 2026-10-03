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
  type IntervalRecognitionParams,
  type Tier,
} from '@/constants/exercises/pitch';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  measureIntervalRecognition,
} from '@/services/measurement/pitch/intervalRecognitionTask';

import {
  playNoteSequence,
} from '@/utils/music/notePlayer';

import {
  scoreIntervalRecognitionTask,
  type IntervalRecognitionScoreResult,
} from '@/services/scoring/pitch/intervalRecognitionTask';

import {
  createMusicalNote,
} from '@/utils/music/notes';

import {
  calcLiveStability,
  calcPitchAccuracy,
  frequencyToNote,
} from '@/utils/dsp/pitch';

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
// RECORDING TIMING
// ============================================================

/*
 * The ADS duration remains the desired exercise duration.
 *
 * A minimum response duration is also enforced so that the
 * singer has enough time to complete every requested
 * repetition.
 */
const MIN_RESPONSE_TIME_PER_REPETITION_SEC = 1.8;
const RECORDING_BUFFER_SEC = 0.8;

function getRecordingDurationSec(
  params: IntervalRecognitionParams,
): number {
  const repetitionDuration =
    params.repetitions *
    MIN_RESPONSE_TIME_PER_REPETITION_SEC;

  return Math.max(
    params.totalDurationSec,
    repetitionDuration +
      RECORDING_BUFFER_SEC,
  );
}

// ============================================================
// GENERATE INTERVAL
// ============================================================

function generateInterval(
  tier: Tier,
): GeneratedInterval {
  const availableIntervals =
    tier === 'advanced'
      ? INTERVALS
      : INTERVALS.filter(
          interval =>
            interval.name !== 'Octave',
        );

  const interval =
    availableIntervals[
      Math.floor(
        Math.random() *
          availableIntervals.length,
      )
    ];

  const minRoot =
    interval.semitones >= 12
      ? 48
      : 55;

  const maxRoot =
    interval.semitones >= 12
      ? 60
      : 67 - interval.semitones;

  const rootMidi =
    minRoot +
    Math.floor(
      Math.random() *
        (maxRoot - minRoot + 1),
    );

  const targetMidi =
    rootMidi + interval.semitones;

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
  tier,
}: Props) {
  const [currentTier, setCurrentTier] =
    useState<Tier>(
      tier ?? 'beginner',
    );

  const [params, setParams] =
    useState<IntervalRecognitionParams>(
      INTERVAL_RECOGNITION_PARAMS[
        tier ?? 'beginner'
      ],
    );

  const [
    isLoadingAdaptiveParams,
    setIsLoadingAdaptiveParams,
  ] = useState(true);

  const [phase, setPhase] =
    useState<Phase>(
      'instructions',
    );

  const [countdown, setCountdown] =
    useState(3);

  const [rootNote, setRootNote] =
    useState(() =>
      createMusicalNote(60),
    );

  const [targetNote, setTargetNote] =
    useState(() =>
      createMusicalNote(67),
    );

  const [
    interval,
    setIntervalValue,
  ] =
    useState<IntervalDefinition>(
      INTERVALS[2],
    );

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(
      null,
    );

  const [
    liveFrequencies,
    setLiveFrequencies,
  ] = useState<number[]>([]);

  const [
    recordingElapsedMs,
    setRecordingElapsedMs,
  ] = useState(0);

  const [result, setResult] =
    useState<IntervalRecognitionScoreResult | null>(
      null,
    );

  const [
    errorMessage,
    setErrorMessage,
  ] = useState<string | null>(
    null,
  );

  // ==========================================================
  // REFS
  // ==========================================================

  const mountedRef =
    useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const recordingRef =
    useRef(false);

  const stopRequestedRef =
    useRef(false);

  /*
   * When true, the current recording is deliberately
   * discarded, such as when the user presses Try Again
   * or leaves the screen.
   */
  const discardRecordingRef =
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

  const currentExerciseRef =
    useRef<GeneratedInterval | null>(
      null,
    );

  // ==========================================================
  // LOAD ADAPTIVE PARAMETERS
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParameters() {
      setIsLoadingAdaptiveParams(true);

      try {
        const user =
          (
            await import(
              '@/services/firebase/config'
            )
          ).auth.currentUser;

        if (!user) {
          const fallbackTier =
            tier ?? 'beginner';

          if (!cancelled) {
            setCurrentTier(
              fallbackTier,
            );

            setParams(
              INTERVAL_RECOGNITION_PARAMS[
                fallbackTier
              ],
            );

            setIsLoadingAdaptiveParams(
              false,
            );
          }

          return;
        }

        const progress =
          await fetchComponentProgress(
            user.uid,
            'pitch',
          );

        const resolvedTier =
          tier ??
          progress?.currentTier ??
          'beginner';

        if (cancelled) {
          return;
        }

        setCurrentTier(
          resolvedTier,
        );

        const records =
          await fetchExerciseRecords(
            user.uid,
            'pitch',
          );

        const currentTierScores =
          records
            .filter(
              record =>
                record.tier ===
                  resolvedTier &&
                record.templateId ===
                  'intervalRecognitionTask',
            )
            .sort(
              (a, b) =>
                a.timestamp -
                b.timestamp,
            )
            .slice(-5)
            .map(
              record =>
                record.scorePct,
            );

        let recentScores =
          currentTierScores;

        /*
         * If there is no exercise history for this
         * component and tier, use the latest Initial
         * Assessment pitch score as the ADS reference.
         */
        if (
          recentScores.length === 0
        ) {
          const assessment =
            await getLatestAssessment();

          const pitchScore =
            assessment?.scores.find(
              score =>
                score.componentId ===
                'pitch',
            );

          if (pitchScore) {
            recentScores = [
              pitchScore.scorePct,
            ];
          }
        }

        if (cancelled) {
          return;
        }

        const {
          generateIntervalRecognitionParams,
        } =
          await import(
            '@/services/adaptiveDifficultyScaling/parameterGenerator'
          );

        const adaptiveParams =
          generateIntervalRecognitionParams({
            tier: resolvedTier,
            recentScores,
          });

        if (!cancelled) {
          setParams(
            adaptiveParams,
          );
        }
      } catch (error) {
        console.error(
          '❌ Failed to load interval recognition ADS:',
          error,
        );

        if (!cancelled) {
          const fallbackTier =
            tier ?? 'beginner';

          setCurrentTier(
            fallbackTier,
          );

          setParams(
            INTERVAL_RECOGNITION_PARAMS[
              fallbackTier
            ],
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(
            false,
          );
        }
      }
    }

    loadAdaptiveParameters();

    return () => {
      cancelled = true;
    };
  }, [tier]);

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

      /*
       * Do not process the recording when
       * leaving the screen.
       */
      discardRecordingRef.current =
        true;

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
        if (
          !mountedRef.current
        ) {
          return;
        }

        setLiveFrame(frame);

        if (
          Number.isFinite(
            frame.pitch,
          ) &&
          frame.pitch > 0
        ) {
          pitchHistoryRef.current =
            [
              ...pitchHistoryRef.current,
              frame.pitch,
            ].slice(-30);

          setLiveFrequencies(
            pitchHistoryRef.current,
          );
        }
      },
      [],
    );

  // ==========================================================
  // RECORDING STOP
  // ==========================================================

  const handleRecordingStop =
    useCallback(
      async (
        samples: Float32Array,
        sampleRate: number,
      ) => {
        /*
         * Ignore recordings deliberately discarded
         * by Retry or screen cleanup.
         *
         * This check must happen before processing so
         * the old recording cannot accidentally receive
         * a score after the user presses Try Again.
         */
        if (
          discardRecordingRef.current
        ) {
          discardRecordingRef.current =
            false;

          recordingRef.current =
            false;

          stopRequestedRef.current =
            false;

          processingRef.current =
            false;

          return;
        }

        if (
          !mountedRef.current ||
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
            recordingTimerRef.current,
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
              'No current interval exercise.',
            );
          }

          const measurement =
            measureIntervalRecognition(
              samples,
              sampleRate,
              params.minClarity,
              params.repetitions,
            );

          const score =
            scoreIntervalRecognitionTask(
              measurement,
              exercise.interval.ratio,
              exercise.interval.name,
              params,
            );

          await saveCompletedExercise(
            'pitch',
            'intervalRecognitionTask',
            currentTier,
            score.score,
          );

          if (
            !mountedRef.current
          ) {
            return;
          }

          setResult(score);
          setPhase('results');
        } catch (error) {
          console.error(
            '❌ INTERVAL PROCESSING ERROR:',
            error,
          );

          if (
            mountedRef.current
          ) {
            setErrorMessage(
              'We could not analyze your recording. Please try again.',
            );

            setPhase(
              'instructions',
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
        currentTier,
        params,
      ],
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
          /*
           * A new recording must never inherit the
           * discard state of a previous Retry.
           */
          discardRecordingRef.current =
            false;

          pitchHistoryRef.current =
            [];

          setLiveFrequencies([]);

          setLiveFrame(null);

          recordingElapsedRef.current =
            0;

          setRecordingElapsedMs(
            0,
          );

          stopRequestedRef.current =
            false;

          processingRef.current =
            false;

          setPhase('recording');

          await startRecording();

          if (
            !mountedRef.current
          ) {
            return;
          }

          recordingRef.current =
            true;

          const recordingDurationSec =
            getRecordingDurationSec(
              params,
            );

          const durationMs =
            recordingDurationSec *
            1000;

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
                elapsed,
              );

              if (
                elapsed >=
                durationMs
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
                  stopRequestedRef.current
                ) {
                  return;
                }

                stopRequestedRef.current =
                  true;

                stopRecording().catch(
                  error => {
                    console.error(
                      '❌ FAILED TO STOP INTERVAL RECORDING:',
                      error,
                    );

                    recordingRef.current =
                      false;

                    stopRequestedRef.current =
                      false;

                    if (
                      mountedRef.current
                    ) {
                      setErrorMessage(
                        'We could not finish the recording. Please try again.',
                      );

                      setPhase(
                        'instructions',
                      );
                    }
                  },
                );
              }
            }, 100);
        } catch (error) {
          console.error(
            '❌ FAILED TO START INTERVAL RECORDING:',
            error,
          );

          recordingRef.current =
            false;

          stopRequestedRef.current =
            false;

          discardRecordingRef.current =
            false;

          if (
            mountedRef.current
          ) {
            setPhase(
              'instructions',
            );

            Alert.alert(
              'Microphone Error',
              'Unable to start the microphone. Please check your microphone permission and try again.',
            );
          }
        }
      },
      [
        params,
        startRecording,
        stopRecording,
      ],
    );

  // ==========================================================
  // PLAY SAME INTERVAL REPEATEDLY
  // ==========================================================

  const playIntervalAndRecord =
    useCallback(
      async (
        exercise: GeneratedInterval,
      ) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        try {
          setPhase('playing');

          const repetitionCount =
            Math.max(
              1,
              Math.round(
                params.repetitions,
              ),
            );

          for (
            let i = 0;
            i < repetitionCount;
            i++
          ) {
            if (
              !mountedRef.current
            ) {
              return;
            }

            await playNoteSequence([
              {
                frequencyHz:
                  exercise
                    .rootNote
                    .frequency,
                durationSec: 0.8,
              },
              {
                frequencyHz:
                  exercise
                    .targetNote
                    .frequency,
                durationSec: 0.8,
              },
            ]);

            if (
              i <
              repetitionCount - 1
            ) {
              await new Promise(
                resolve =>
                  setTimeout(
                    resolve,
                    350,
                  ),
              );
            }
          }

          if (
            !mountedRef.current
          ) {
            return;
          }

          await beginRecording();
        } catch (error) {
          console.error(
            '❌ FAILED TO PLAY INTERVAL:',
            error,
          );

          if (
            mountedRef.current
          ) {
            setPhase(
              'instructions',
            );

            Alert.alert(
              'Audio Error',
              'Unable to play the target interval. Please try again.',
            );
          }
        }
      },
      [
        beginRecording,
        params.repetitions,
      ],
    );

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  const startCountdown =
    useCallback(() => {
      if (
        isLoadingAdaptiveParams
      ) {
        return;
      }

      const generated =
        generateInterval(
          currentTier,
        );

      currentExerciseRef.current =
        generated;

      setRootNote(
        generated.rootNote,
      );

      setTargetNote(
        generated.targetNote,
      );

      setIntervalValue(
        generated.interval,
      );

      setResult(null);
      setErrorMessage(null);

      setLiveFrame(null);
      setLiveFrequencies([]);

      pitchHistoryRef.current =
        [];

      recordingElapsedRef.current =
        0;

      setRecordingElapsedMs(0);

      processingRef.current =
        false;

      stopRequestedRef.current =
        false;

      discardRecordingRef.current =
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
          countdownTimerRef.current,
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
                countdownTimerRef.current,
              );

              countdownTimerRef.current =
                null;
            }

            playIntervalAndRecord(
              generated,
            );

            return;
          }

          setCountdown(value);
        }, 1000);
    }, [
      currentTier,
      isLoadingAdaptiveParams,
      playIntervalAndRecord,
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

      /*
       * Mark the current recording as discarded
       * BEFORE stopping it.
       *
       * handleRecordingStop() will see this flag
       * and discard the old recording instead of
       * analyzing or saving it.
       */
      if (recordingRef.current) {
        discardRecordingRef.current =
          true;

        stopRequestedRef.current =
          true;

        stopRecording().catch(
          error => {
            console.error(
              '❌ FAILED TO STOP RECORDING DURING RETRY:',
              error,
            );

            discardRecordingRef.current =
              false;

            stopRequestedRef.current =
              false;
          },
        );
      } else {
        /*
         * There is no active recording, so there is
         * nothing that needs to be discarded.
         */
        discardRecordingRef.current =
          false;
      }

      currentExerciseRef.current =
        null;

      setResult(null);
      setLiveFrame(null);
      setLiveFrequencies([]);

      pitchHistoryRef.current =
        [];

      recordingElapsedRef.current =
        0;

      setRecordingElapsedMs(0);

      processingRef.current =
        false;

      stopRequestedRef.current =
        false;

      recordingRef.current =
        false;

      setErrorMessage(null);

      setPhase(
        'instructions',
      );
    }, [stopRecording]);

  // ==========================================================
  // RECORDING PROGRESS
  // ==========================================================

  const recordingDurationSec =
    getRecordingDurationSec(
      params,
    );

  const recordingDurationMs =
    recordingDurationSec *
    1000;

  const recordingProgress =
    recordingDurationMs > 0
      ? Math.min(
          1,
          recordingElapsedMs /
            recordingDurationMs,
        )
      : 0;

  const repetitionCount =
    Math.max(
      1,
      Math.round(
        params.repetitions,
      ),
    );

  const repetitionProgress =
    Math.min(
      repetitionCount - 1,
      Math.floor(
        recordingProgress *
          repetitionCount,
      ),
    );

  const currentRepetition =
    repetitionProgress + 1;

  const phaseProgress =
    (
      recordingProgress *
      repetitionCount
    ) % 1;

  const firstHalf =
    phaseProgress < 0.5;

  const liveTarget =
    firstHalf
      ? rootNote
      : targetNote;

  const liveAccuracy =
    liveFrame &&
    liveFrame.pitch > 0
      ? calcPitchAccuracy(
          liveFrame.pitch,
          liveTarget.frequency,
        )
      : 0;

  const liveStability =
    calcLiveStability(
      liveFrequencies,
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
              '/dashboard?tab=exercises',
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
            <Text
              style={styles.cardTitle}
            >
              Exercise Instructions
            </Text>

            <Text
              style={styles.instruction}
            >
              Listen carefully to the
              reference interval.
            </Text>

            <Text
              style={styles.instruction}
            >
              The same interval will be
              repeated {repetitionCount}{' '}
              times.
            </Text>

            <Text
              style={styles.instruction}
            >
              After the reference playback,
              sing the first note, pause
              briefly, then sing the second
              note. Repeat the same interval
              for each repetition.
            </Text>

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
              Each detected repetition is
              scored individually, then combined
              into the final exercise score.
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
              between each pair of sung notes
              so TuneUp! can detect every
              repetition separately.
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
              {currentTier}
            </Text>
          </View>

          <Pressable
            style={[
              styles.startButton,
              isLoadingAdaptiveParams && {
                opacity: 0.6,
              },
            ]}
            disabled={
              isLoadingAdaptiveParams
            }
            onPress={
              startCountdown
            }
          >
            {isLoadingAdaptiveParams ? (
              <ActivityIndicator
                size="small"
                color={WHITE}
              />
            ) : (
              <>
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
              </>
            )}
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
          repeated interval.
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
          The same interval is being
          repeated {repetitionCount} times.
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
          Repeat the same interval{' '}
          {repetitionCount} times. Leave a
          short pause between notes and
          repetitions.
        </Text>

        <View
          style={styles.repetitionBadge}
        >
          <Text
            style={
              styles.repetitionBadgeText
            }
          >
            Repetition {currentRepetition}{' '}
            of {repetitionCount}
          </Text>
        </View>

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
                  liveFrame.pitch,
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
                  liveAccuracy,
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
                  liveStability,
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

        <View
          style={styles.recordingBar}
        >
          <View
            style={[
              styles.recordingBarFill,
              {
                width: `${Math.round(
                  recordingProgress *
                    100,
                )}%`,
              },
            ]}
          />
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
          Checking your repeated interval
          accuracy.
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
            result.freq1,
          )
        : '--';

    const detectedNote2 =
      result.freq2 > 0
        ? frequencyToNote(
            result.freq2,
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
                ? 'Your repeated interval attempts were within the target tolerance.'
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
              Repetition Results
            </Text>

            <View
              style={styles.resultRow}
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Requested repetitions
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {repetitionCount}
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
                Detected repetitions
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {
                  result.repetitionsCompleted
                }
              </Text>
            </View>

            {result.repetitionScores.map(
              (
                repetitionScore,
                index,
              ) => (
                <View
                  key={`repetition-${index}`}
                  style={
                    styles.resultRow
                  }
                >
                  <Text
                    style={
                      styles.resultRowLabel
                    }
                  >
                    Repetition {index + 1}
                  </Text>

                  <Text
                    style={
                      styles.resultRowValue
                    }
                  >
                    {repetitionScore}%
                  </Text>
                </View>
              ),
            )}
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
                  3,
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
                Median detected ratio
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {result.detectedRatio > 0
                  ? result.detectedRatio.toFixed(
                      3,
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
                Average interval deviation
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {result.deviationPct.toFixed(
                  1,
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
                    100,
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
                    100,
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
                : 'Listen carefully to the reference interval and keep a clear pause between every sung note pair.'}
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
                '/dashboard?tab=exercises',
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
    borderColor: BORDER,
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

  repetitionBadge: {
    backgroundColor: PINK,
    borderRadius: 15,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 16,
  },

  repetitionBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    marginTop: 20,
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

  recordingBar: {
    width: '100%',
    height: 5,
    borderRadius: 3,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 16,
  },

  recordingBarFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 3,
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
    borderColor: BORDER,
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