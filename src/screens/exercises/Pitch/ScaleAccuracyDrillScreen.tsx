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
  type ScaleAccuracyParams,
  type Tier,
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
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  generateScaleAccuracyParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  createMusicalNote,
} from '@/utils/music/notes';

import {
  calcLiveStability,
  calcPitchAccuracy,
  frequencyToNote,
  segmentIntoNotes,
} from '@/utils/dsp/pitch';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  auth,
} from '@/services/firebase/config';

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

function generateScale(
  params: ScaleAccuracyParams
) {
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

  /*
   * The available scale contains eight
   * predefined notes. Clamp the generated
   * note count so the actual target sequence
   * always matches the available notes.
   */
  const noteCount = Math.min(
    Math.max(
      1,
      Math.round(params.noteCount)
    ),
    scaleIntervals.length
  );

  return scaleIntervals
    .slice(0, noteCount)
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
  tier,
}: Props) {
  // ==========================================================
  // ADAPTIVE PARAMETERS
  // ==========================================================

  const [currentTier, setCurrentTier] =
    useState<Tier>(
      tier ?? 'beginner'
    );

  const [params, setParams] =
    useState<ScaleAccuracyParams>(
      SCALE_ACCURACY_PARAMS[
        tier ?? 'beginner'
      ]
    );

  const [
    isLoadingAdaptiveParams,
    setIsLoadingAdaptiveParams,
  ] = useState(true);

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
    useState(() =>
      generateScale(
        SCALE_ACCURACY_PARAMS[
          tier ?? 'beginner'
        ]
      )
    );

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
  // LOAD ADAPTIVE PARAMETERS
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParams =
      async () => {
        setIsLoadingAdaptiveParams(true);

        try {
          const user =
            auth.currentUser;

          /*
           * If a tier was explicitly supplied
           * by the route, use it.
           *
           * Otherwise resolve the user's current
           * tier from Pitch component progress.
           */
          let resolvedTier: Tier =
            tier ?? 'beginner';

          if (
            !tier &&
            user
          ) {
            const progress =
              await fetchComponentProgress(
                user.uid,
                'pitch'
              );

            resolvedTier =
              progress?.currentTier ??
              'beginner';
          }

          if (cancelled) {
            return;
          }

          setCurrentTier(
            resolvedTier
          );

          let recentScores: number[] =
            [];

          /*
           * Retrieve completed exercise
           * history for the Pitch component.
           *
           * The repository already scopes the
           * records to:
           *
           * users/{uid}/progress/pitch/exercises
           *
           * Therefore only the current tier
           * needs to be filtered here.
           */
          if (user) {
            const records =
              await fetchExerciseRecords(
                user.uid,
                'pitch'
              );

            const currentTierRecords =
              records
                .filter(
                  record =>
                    record.tier === resolvedTier &&
                    record.templateId === 'scaleAccuracyDrill'
                )
                .sort(
                  (a, b) =>
                    a.timestamp -
                    b.timestamp
                );

            /*
             * Use the latest five completed
             * exercise scores for Pitch and
             * the current tier.
             */
            recentScores =
              currentTierRecords
                .slice(-5)
                .map(
                  record =>
                    record.scorePct
                );
          }

          /*
           * If there is no completed exercise
           * history for the current component
           * and tier, use the latest Assessment
           * Pitch score as the ADS reference.
           */
          if (
            recentScores.length === 0 &&
            user
          ) {
            const assessment =
              await getLatestAssessment();

            const pitchScore =
              assessment?.scores.find(
                score =>
                  score.componentId ===
                  'pitch'
              );

            if (
              pitchScore
            ) {
              recentScores = [
                pitchScore.scorePct,
              ];
            }
          }

          /*
           * Generate the actual exercise
           * parameters using the resolved tier
           * and ADS reference scores.
           */
          const generatedParams =
            generateScaleAccuracyParams({
              tier: resolvedTier,
              recentScores,
            });

          if (cancelled) {
            return;
          }

          setParams(
            generatedParams
          );
        } catch (error) {
          console.error(
            '❌ FAILED TO LOAD SCALE ACCURACY ADS PARAMETERS:',
            error
          );

          if (!cancelled) {
            /*
             * Preserve an explicitly supplied tier
             * as the fallback. Otherwise default to
             * Beginner.
             */
            const fallbackTier =
              tier ?? 'beginner';

            setCurrentTier(
              fallbackTier
            );

            setParams(
              SCALE_ACCURACY_PARAMS[
                fallbackTier
              ]
            );
          }
        } finally {
          if (!cancelled) {
            setIsLoadingAdaptiveParams(
              false
            );
          }
        }
      };

    loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

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
   * Used to keep the currently displayed
   * target note synchronized with recording.
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
   * Stores pitch values received from
   * live microphone frames.
   */
  const pitchHistoryRef =
    useRef<number[]>([]);

  /*
   * Tracks recording duration.
   */
  const recordingElapsedRef =
    useRef(0);

  /*
   * Keeps the latest stop function available
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
      async (
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
              note =>
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

          /*
           * Measure using the adaptive
           * minimum clarity.
           */
          const measurement =
            measureScaleAccuracyDrill(
              segments,
              targetFreqs,
              sampleRate,
              params.minClarity
            );

          /*
           * Score using the exact same
           * adaptive parameters used by
           * this exercise.
           */
          const score =
            scoreScaleAccuracyDrill(
              measurement,
              params
            );

          /*
           * Save under the user's actual
           * current Pitch tier.
           */
          await saveCompletedExercise(
            'pitch',
            'scaleAccuracyDrill',
            currentTier,
            score.score
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
        currentTier,
        params,
        targetNotes,
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

          recordingElapsedRef.current =
            0;

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
           * Start microphone first.
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
           * for each target note.
           *
           * Use targetNotes.length rather than
           * params.noteCount so recording duration
           * always matches the actual generated
           * scale.
           */
          const recordingDuration =
            Math.max(
              5,
              targetNotes.length * 1250
            );

          /*
           * Divide the recording equally among
           * the actual target notes.
           */
          const noteDuration =
            recordingDuration /
            targetNotes.length;

          /*
           * Update the target note every
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

                recordingElapsedRef.current +=
                  100;

                const elapsedMs =
                  recordingElapsedRef.current;

                /*
                 * Determine which note the
                 * singer should currently sing.
                 */
                const nextNoteIndex =
                  Math.min(
                    Math.floor(
                      elapsedMs /
                        noteDuration
                    ),
                    targetNotes.length - 1
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
        startRecording,
        stopRecording,
        targetNotes.length,
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
              note => ({
                frequencyHz:
                  note.frequency,

                durationSec:
                  0.8,
              })
            );

          /*
           * Play target scale first.
           *
           * The microphone starts only after
           * playback finishes so the generated
           * notes are not captured as the singer's
           * recording.
           */
          await playNoteSequence(
            sequence
          );

          if (
            !mountedRef.current
          ) {
            return;
          }

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
      if (
        isLoadingAdaptiveParams
      ) {
        return;
      }

      /*
       * Generate a fresh scale using the
       * current adaptive parameters.
       */
      const newScale =
        generateScale(params);

      setTargetNotes(
        newScale
      );

      setResult(null);

      setErrorMessage(null);

      setLiveFrame(null);

      setLiveFrequencies([]);

      pitchHistoryRef.current = [];

      recordingElapsedRef.current =
        0;

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
      isLoadingAdaptiveParams,
      params,
      playScaleAndRecord,
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

      recordingElapsedRef.current =
        0;

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
            <Text
              style={styles.cardTitle}
            >
              Exercise Instructions
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
                {targetNotes.length} note scale
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
              {currentTier}
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
              Scale Length
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {targetNotes.length} notes
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
              Pitch Tolerance
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              ±{params.tolerancePct}%
            </Text>
          </View>

          <Pressable
            style={[
              styles.startButton,
              isLoadingAdaptiveParams &&
                {
                  opacity: 0.6,
                },
            ]}
            onPress={startCountdown}
            disabled={
              isLoadingAdaptiveParams
            }
          >
            <Text
              style={styles.startButtonText}
            >
              {isLoadingAdaptiveParams
                ? 'Preparing Exercise...'
                : 'Start Exercise'}
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
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
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