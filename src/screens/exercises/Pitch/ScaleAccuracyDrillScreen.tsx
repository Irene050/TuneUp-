// src/screens/exercises/Pitch/ScaleAccuracyDrillScreen.tsx

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
  SCALE_ACCURACY_PARAMS,
  Tier,
} from '@/constants/exercises/pitch';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  measureScaleAccuracyDrill,
} from '@/services/measurement/pitch/scaleAccuracyDrill';

import {
  ScaleAccuracyScoreResult,
  scoreScaleAccuracyDrill,
} from '@/services/scoring/pitch/scaleAccuracyDrill';

import {
  disposeNotePlayer,
  playNoteSequence,
} from '@/services/assessment/notePlayer';

import {
  createMusicalNote,
} from '@/utils/music/notes';

import {
  calcLiveStability,
  calcPitchAccuracy,
  frequencyToNote,
  segmentIntoNotes,
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

// ============================================================
// SCALE GENERATION
// ============================================================

function generateScale(tier: Tier) {
  const params = SCALE_ACCURACY_PARAMS[tier];

  /*
   * C major:
   *
   * Beginner:
   * C4 D4 E4 F4 G4
   *
   * Intermediate:
   * C4 D4 E4 F4 G4 A4 B4
   *
   * Advanced:
   * C4 D4 E4 F4 G4 A4 B4 C5
   */

  const baseMidi = 60;

  const scaleIntervals = [
    0,
    2,
    4,
    5,
    7,
    9,
    11,
    12,
  ];

  return scaleIntervals
    .slice(0, params.noteCount)
    .map((interval) =>
      createMusicalNote(
        baseMidi + interval
      )
    );
}

// ============================================================
// SCREEN
// ============================================================

export default function ScaleAccuracyDrillScreen({
  tier = 'beginner',
}: Props) {
  // ==========================================================
  // PARAMS
  // ==========================================================

  const params =
    SCALE_ACCURACY_PARAMS[tier];

  // ==========================================================
  // STATE
  // ==========================================================

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(3);

  const [currentNoteIndex, setCurrentNoteIndex] =
    useState(-1);

  const [targetNotes, setTargetNotes] =
    useState(() => generateScale(tier));

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [liveFrequencies, setLiveFrequencies] =
    useState<number[]>([]);

  const [result, setResult] =
    useState<ScaleAccuracyScoreResult | null>(
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

  /*
   * This is now an interval instead of a timeout.
   *
   * It is used to keep the currently displayed
   * target note synchronized with the recording.
   */
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null
    );

  const stopRequestedRef =
    useRef(false);

  const processingRef =
    useRef(false);

  const recordingRef =
    useRef(false);

  /*
   * Stores the pitch values received from the
   * live microphone frames.
   */
  const pitchHistoryRef =
    useRef<number[]>([]);

  /*
   * Keep track of how long the singer has been
   * recording.
   */
  const recordingElapsedRef =
    useRef(0);

  /*
   * Keep the latest stop function available
   * for unmount cleanup.
   */
  const stopRecordingRef =
    useRef<
      (() => Promise<void>) | null
    >(null);

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

        countdownTimerRef.current = null;
      }

      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current
        );

        recordingTimerRef.current = null;
      }

      /*
       * Stop recording if the user leaves
       * while the microphone is active.
       */
      if (
        recordingRef.current
      ) {
        stopRecordingRef.current?.();
      }

      disposeNotePlayer()
        .catch(() => {});
    };
  }, []);

  // ==========================================================
  // LIVE FRAME
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
          Number.isFinite(frame.pitch) &&
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
  // AUDIO STOP / PROCESSING
  // ==========================================================

  const handleRecordingStop =
    useCallback(
      (
        samples: Float32Array,
        sampleRate: number
      ) => {
        if (
          !mountedRef.current
        ) {
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

        /*
         * Stop the target-note timer immediately.
         */
        if (
          recordingTimerRef.current
        ) {
          clearInterval(
            recordingTimerRef.current
          );

          recordingTimerRef.current = null;
        }

        setPhase('processing');

        try {
          const targetFreqs =
            targetNotes.map(
              (note) =>
                note.frequency
            );

          /*
           * Divide the recording into one
           * segment for each target note.
           */
          const segments =
            segmentIntoNotes(
              samples,
              targetFreqs.length,
              0.01,
              sampleRate
            );

          const measurement =
            measureScaleAccuracyDrill(
              segments,
              targetFreqs,
              sampleRate,
              params.minClarity
            );

          const score =
            scoreScaleAccuracyDrill(
              measurement,
              tier
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
            '❌ SCALE PROCESSING ERROR:',
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
        targetNotes,
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
  // STOP FUNCTION REF
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
  // START RECORDING
  // ==========================================================

  const beginRecording =
    useCallback(
      async () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        if (
          recordingRef.current
        ) {
          return;
        }

        try {
          /*
           * Reset live data.
           */
          pitchHistoryRef.current = [];

          recordingElapsedRef.current = 0;

          setLiveFrequencies([]);

          setLiveFrame(null);

          stopRequestedRef.current =
            false;

          processingRef.current =
            false;

          /*
           * Start on the first note.
           */
          setCurrentNoteIndex(0);

          setPhase('recording');

          /*
           * Start the actual microphone
           * before beginning the UI timer.
           */
          await startRecording();

          if (
            !mountedRef.current
          ) {
            return;
          }

          recordingRef.current =
            true;

          /*
           * Give approximately 1.25 seconds
           * for each note.
           */
          const recordingDuration =
            Math.max(
              5,
              params.noteCount * 1250
            );

          /*
           * Each note receives an equal section
           * of the recording.
           *
           * This matches segmentIntoNotes(),
           * which divides the final recording
           * into equal-length segments.
           */
          const noteDuration =
            recordingDuration /
            params.noteCount;

          /*
           * Update the current target every
           * 100 milliseconds.
           */
          recordingTimerRef.current =
            setInterval(
              async () => {
                if (
                  !mountedRef.current ||
                  !recordingRef.current ||
                  stopRequestedRef.current
                ) {
                  return;
                }

                recordingElapsedRef.current += 100;

                const elapsedMs =
                  recordingElapsedRef.current;

                /*
                 * Determine which note the singer
                 * should currently be singing.
                 */
                const nextNoteIndex =
                  Math.min(
                    Math.floor(
                      elapsedMs /
                        noteDuration
                    ),
                    params.noteCount - 1
                  );

                setCurrentNoteIndex(
                  nextNoteIndex
                );

                /*
                 * Recording is complete.
                 */
                if (
                  elapsedMs >=
                  recordingDuration
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

                  try {
                    await stopRecording();
                  } catch (error) {
                    console.error(
                      '❌ FAILED TO STOP SCALE RECORDING:',
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
                }
              },
              100
            );
        } catch (error) {
          console.error(
            '❌ FAILED TO START SCALE RECORDING:',
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
        params.noteCount,
        startRecording,
        stopRecording,
      ]
    );

  // ==========================================================
  // PLAY SCALE THEN RECORD
  // ==========================================================

  const playScaleAndRecord =
    useCallback(
      async () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        try {
          setPhase('playing');

          setCurrentNoteIndex(0);

          const sequence =
            targetNotes.map(
              (note) => ({
                frequencyHz:
                  note.frequency,

                durationSec:
                  0.8,
              })
            );

          /*
           * Play the complete scale BEFORE
           * starting the microphone.
           *
           * This prevents the generated target
           * tone from being captured as the
           * singer's voice.
           */
          await playNoteSequence(
            sequence
          );

          if (
            !mountedRef.current
          ) {
            return;
          }

          /*
           * Now record the singer.
           */
          await beginRecording();
        } catch (error) {
          console.error(
            '❌ FAILED TO PLAY SCALE:',
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
              'Unable to play the target scale. Please try again.'
            );
          }
        }
      },
      [
        beginRecording,
        targetNotes,
      ]
    );

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  const startCountdown =
    useCallback(() => {
      /*
       * Generate a fresh scale every attempt.
       */
      const newScale =
        generateScale(tier);

      setTargetNotes(
        newScale
      );

      setResult(null);

      setErrorMessage(null);

      setLiveFrame(null);

      setLiveFrequencies([]);

      pitchHistoryRef.current = [];

      recordingElapsedRef.current = 0;

      stopRequestedRef.current =
        false;

      processingRef.current =
        false;

      recordingRef.current =
        false;

      setCurrentNoteIndex(-1);

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

          if (
            value <= 0
          ) {
            if (
              countdownTimerRef.current
            ) {
              clearInterval(
                countdownTimerRef.current
              );
            }

            countdownTimerRef.current =
              null;

            playScaleAndRecord();

            return;
          }

          setCountdown(
            value
          );
        }, 1000);
    }, [
      playScaleAndRecord,
      tier,
    ]);

  // ==========================================================
  // RETRY
  // ==========================================================

  const retry =
    useCallback(() => {
      /*
       * Make sure no previous timer survives
       * when retrying.
       */
      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current
        );

        countdownTimerRef.current = null;
      }

      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current
        );

        recordingTimerRef.current = null;
      }

      setResult(null);

      setLiveFrame(null);

      setLiveFrequencies([]);

      pitchHistoryRef.current = [];

      recordingElapsedRef.current = 0;

      processingRef.current =
        false;

      stopRequestedRef.current =
        false;

      recordingRef.current =
        false;

      setCurrentNoteIndex(-1);

      setPhase(
        'instructions'
      );
    }, []);

  // ==========================================================
  // CURRENT TARGET
  // ==========================================================

  const currentTarget =
    currentNoteIndex >= 0 &&
    currentNoteIndex <
      targetNotes.length
      ? targetNotes[
          currentNoteIndex
        ]
      : null;

  // ==========================================================
  // LIVE ACCURACY
  // ==========================================================

  const liveAccuracy =
    liveFrame &&
    currentTarget &&
    liveFrame.pitch > 0
      ? calcPitchAccuracy(
          liveFrame.pitch,
          currentTarget.frequency
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
              name="stats-chart-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.title}>
            Scale Accuracy Drill
          </Text>

          <Text style={styles.subtitle}>
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
                  recommended.
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
              Listen to the target scale
              first.
            </Text>

            <Text
              style={styles.instruction}
            >
              After the scale finishes,
              sing the notes back one at
              a time in the same order.
            </Text>

            <Text
              style={styles.instruction}
            >
              Try to land accurately on
              every note and make each
              transition smooth.
            </Text>

            <View
              style={styles.targetBox}
            >
              <Ionicons
                name="trending-up"
                size={25}
                color={BROWN}
              />

              <Text
                style={styles.targetText}
              >
                {params.noteCount} note scale
              </Text>
            </View>

            <Text
              style={styles.helperText}
            >
              Focus on accurate note
              changes rather than singing
              as quickly as possible.
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
              Sing each note clearly before
              moving to the next one.
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
            onPress={
              startCountdown
            }
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
              style={{
                fontFamily:
                  'FredokaRegular',
                fontSize: 11,
                color: MUTED,
                textAlign: 'center',
                marginTop: 12,
              }}
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
          scale.
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
          Listen to the Scale
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          The target scale is playing.
        </Text>

        <View
          style={styles.scalePreview}
        >
          {targetNotes.map(
            (note, index) => (
              <View
                key={`${note.name}-${index}`}
                style={
                  styles.previewNote
                }
              >
                <Text
                  style={
                    styles.previewNoteText
                  }
                >
                  {note.name}
                </Text>
              </View>
            )
          )}
        </View>

        <ActivityIndicator
          size="small"
          color={BROWN}
          style={{
            marginTop: 24,
          }}
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
          Sing the Scale
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Sing each note in the same
          order.
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
            {currentTarget?.name ?? '--'}
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
            style={styles.liveFrequency}
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
          style={styles.scalePreview}
        >
          {targetNotes.map(
            (note, index) => {
              const active =
                index ===
                currentNoteIndex;

              return (
                <View
                  key={`${note.name}-${index}`}
                  style={[
                    styles.previewNote,
                    active &&
                      styles.previewNoteActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.previewNoteText,
                      active &&
                        styles.previewNoteTextActive,
                    ]}
                  >
                    {note.name}
                  </Text>
                </View>
              );
            }
          )}
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
          Checking your note accuracy
          and transitions.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={{
            marginTop: 28,
          }}
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
            style={styles.resultSubtitle}
          >
            Scale Accuracy Result
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
              {result.correctNotes} of{' '}
              {result.totalNotes} notes
              matched accurately
            </Text>
          </View>

          <View
            style={styles.resultCard}
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Note Accuracy
            </Text>

            <View
              style={styles.resultRow}
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Accurate notes
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {Math.round(
                  result.noteAccuracy
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
                Transition smoothness
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {Math.round(
                  result.transitionSmoothness
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
                Average clarity
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {Math.round(
                  result.averageClarity *
                    100
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
              Your Notes
            </Text>

            {targetNotes.map(
              (target, index) => {
                const detected =
                  result.detectedFreqs[
                    index
                  ];

                const noteScore =
                  result.noteScores[
                    index
                  ] ?? 0;

                const noteName =
                  detected &&
                  detected > 0
                    ? frequencyToNote(
                        detected
                      )
                    : '--';

                const correct =
                  result.noteDeviations[
                    index
                  ] <=
                  params.tolerancePct;

                return (
                  <View
                    key={`${target.name}-${index}`}
                    style={
                      styles.noteResultRow
                    }
                  >
                    <View
                      style={
                        styles.noteNumber
                      }
                    >
                      <Text
                        style={
                          styles.noteNumberText
                        }
                      >
                        {index + 1}
                      </Text>
                    </View>

                    <View
                      style={
                        styles.noteResultInfo
                      }
                    >
                      <Text
                        style={
                          styles.targetNoteText
                        }
                      >
                        Target: {target.name}
                      </Text>

                      <Text
                        style={
                          styles.detectedNoteText
                        }
                      >
                        Detected: {noteName}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.noteStatus,
                        correct &&
                          styles.noteStatusCorrect,
                      ]}
                    >
                      <Ionicons
                        name={
                          correct
                            ? 'checkmark'
                            : 'close'
                        }
                        size={15}
                        color={BROWN}
                      />

                      <Text
                        style={
                          styles.noteStatusText
                        }
                      >
                        {noteScore}%
                      </Text>
                    </View>
                  </View>
                );
              }
            )}
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
                ? 'Your notes were mostly accurate. Continue practicing smooth transitions for even greater consistency.'
                : 'Focus on landing directly on each target note before moving to the next one.'}
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

  scalePreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    maxWidth: 350,
  },

  previewNote: {
    minWidth: 48,
    height: 44,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
  },

  previewNoteActive: {
    backgroundColor: PINK,
  },

  previewNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: MUTED,
  },

  previewNoteTextActive: {
    color: BROWN,
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
  },

  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  noteResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F2DDE5',
  },

  noteNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  noteNumberText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },

  noteResultInfo: {
    flex: 1,
    marginLeft: 10,
  },

  targetNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },

  detectedNoteText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 2,
  },

  noteStatus: {
    minWidth: 55,
    height: 30,
    borderRadius: 15,
    backgroundColor: LIGHT_GRAY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 7,
  },

  noteStatusCorrect: {
    backgroundColor: PINK,
  },

  noteStatusText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
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