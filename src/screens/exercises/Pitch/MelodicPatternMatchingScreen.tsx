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
  scoreMelodicPatternMatching,
  type MelodicPatternScoreResult,
} from '@/services/scoring/pitch/melodicPatternMatching';

import {
  playSingleNote,
} from '@/utils/music/notePlayer';

import {
  createMusicalNote,
  getRandomPitchNote,
} from '@/utils/music/notes';

import {
  frequencyToNote,
  segmentIntoNotes,
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

interface GeneratedPattern {
  notes: ReturnType<typeof createMusicalNote>[];
}

// ============================================================
// TIMING
// ============================================================

const NOTE_DURATION_SEC = 0.7;
const NOTE_GAP_SEC = 0.12;
const RECORDING_BUFFER_SEC = 0.8;

// ============================================================
// SCREEN
// ============================================================

export default function MelodicPatternMatchingScreen({
  tier,
}: Props) {
  const [currentTier, setCurrentTier] =
    useState<Tier>(
      tier ?? 'beginner',
    );

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

  const [phase, setPhase] =
    useState<Phase>(
      'instructions',
    );

  const [countdown, setCountdown] =
    useState(3);

  const [
    currentPattern,
    setCurrentPattern,
  ] = useState<GeneratedPattern | null>(
    null,
  );

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(
      null,
    );

  const [
    recordingElapsedMs,
    setRecordingElapsedMs,
  ] = useState(0);

  const [result, setResult] =
    useState<MelodicPatternScoreResult | null>(
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

  const discardRecordingRef =
    useRef(false);

  const processingRef =
    useRef(false);

  const recordingElapsedRef =
    useRef(0);

  const stopRecordingRef =
    useRef<
      (() => Promise<void>) | null
    >(null);

  const currentExerciseRef =
    useRef<GeneratedPattern | null>(
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
              MELODIC_PATTERN_MATCHING_PARAMS[
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
                  'melodicPatternMatching',
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
          generateMelodicPatternMatchingParams,
        } =
          await import(
            '@/services/adaptiveDifficultyScaling/parameterGenerator'
          );

        const adaptiveParams =
          generateMelodicPatternMatchingParams({
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
          '❌ Failed to load melodic pattern matching ADS:',
          error,
        );

        if (!cancelled) {
          const fallbackTier =
            tier ?? 'beginner';

          setCurrentTier(
            fallbackTier,
          );

          setParams(
            MELODIC_PATTERN_MATCHING_PARAMS[
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

          if (
            !exercise ||
            exercise.notes.length === 0
          ) {
            throw new Error(
              'No current melodic pattern exercise.',
            );
          }

          const targetFreqs =
            exercise.notes.map(
              note =>
                note.frequency,
            );

          const targetTimestamps =
            exercise.notes.map(
              (_, index) =>
                index *
                (
                  NOTE_DURATION_SEC +
                  NOTE_GAP_SEC
                ),
            );

          const segments =
            segmentIntoNotes(
              samples,
              exercise.notes.length,
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

          const score =
            scoreMelodicPatternMatching(
              measurement,
              targetFreqs,
              targetTimestamps,
              params,
            );

          await saveCompletedExercise(
            'pitch',
            'melodicPatternMatching',
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
            '❌ MELODIC PATTERN PROCESSING ERROR:',
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
        params.minClarity,
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
          discardRecordingRef.current =
            false;

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

          const patternDurationSec =
            params.noteCount *
              NOTE_DURATION_SEC +
            Math.max(
              0,
              params.noteCount - 1,
            ) *
              NOTE_GAP_SEC;

          const recordingDurationSec =
            patternDurationSec +
            RECORDING_BUFFER_SEC;

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
                      '❌ FAILED TO STOP MELODIC RECORDING:',
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
            '❌ FAILED TO START MELODIC RECORDING:',
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
        params.noteCount,
        startRecording,
        stopRecording,
      ],
    );

  // ==========================================================
  // PLAY PATTERN AND RECORD
  // ==========================================================

  const playPatternAndRecord =
    useCallback(
      async (
        pattern: GeneratedPattern,
      ) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        try {
          setPhase('playing');

          for (
            let i = 0;
            i < pattern.notes.length;
            i++
          ) {
            if (
              !mountedRef.current
            ) {
              return;
            }

            await playSingleNote(
              pattern.notes[i].frequency,
              NOTE_DURATION_SEC,
            );

            if (
              i <
              pattern.notes.length - 1
            ) {
              await new Promise(
                resolve =>
                  setTimeout(
                    resolve,
                    NOTE_GAP_SEC * 1000,
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
            '❌ FAILED TO PLAY MELODIC PATTERN:',
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
              'Unable to play the target melody. Please try again.',
            );
          }
        }
      },
      [
        beginRecording,
      ],
    );

  // ==========================================================
  // GENERATE PATTERN
  // ==========================================================

  const generatePattern =
    useCallback((): GeneratedPattern => {
      const notes =
        [];

      for (
        let i = 0;
        i < params.noteCount;
        i++
      ) {
        let note =
          getRandomPitchNote(
            currentTier,
          );

        /*
         * Avoid immediately repeating the exact
         * same note so the generated melody has
         * meaningful movement.
         */
        if (
          notes.length > 0 &&
          note.frequency ===
            notes[
              notes.length - 1
            ].frequency
        ) {
          let attempts = 0;

          while (
            note.frequency ===
              notes[
                notes.length - 1
              ].frequency &&
            attempts < 5
          ) {
            note =
              getRandomPitchNote(
                currentTier,
              );

            attempts++;
          }
        }

        notes.push(note);
      }

      return {
        notes,
      };
    }, [
      currentTier,
      params.noteCount,
    ]);

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
        generatePattern();

      currentExerciseRef.current =
        generated;

      setCurrentPattern(
        generated,
      );

      setResult(null);
      setErrorMessage(null);

      setLiveFrame(null);

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

            playPatternAndRecord(
              generated,
            );

            return;
          }

          setCountdown(value);
        }, 1000);
    }, [
      generatePattern,
      isLoadingAdaptiveParams,
      playPatternAndRecord,
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
        discardRecordingRef.current =
          false;
      }

      currentExerciseRef.current =
        null;

      setCurrentPattern(null);
      setResult(null);
      setLiveFrame(null);

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

  const patternNoteCount =
    Math.max(
      1,
      Math.round(
        params.noteCount,
      ),
    );

  const recordingDurationSec =
    patternNoteCount *
      NOTE_DURATION_SEC +
    Math.max(
      0,
      patternNoteCount - 1,
    ) *
      NOTE_GAP_SEC +
    RECORDING_BUFFER_SEC;

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

  const currentNoteIndex =
    Math.min(
      patternNoteCount - 1,
      Math.floor(
        recordingProgress *
          patternNoteCount,
      ),
    );

  const liveTarget =
    currentPattern?.notes[
      currentNoteIndex
    ] ?? null;

  const liveAccuracy =
    liveFrame &&
    liveTarget &&
    liveFrame.pitch > 0
      ? (() => {
          const deviation =
            Math.abs(
              liveFrame.pitch -
                liveTarget.frequency,
            ) /
            liveTarget.frequency;

          return Math.max(
            0,
            Math.min(
              100,
              100 - deviation * 100,
            ),
          );
        })()
      : 0;

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
              name="musical-notes-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.title}
          >
            Melodic Pattern Matching
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
              reference melody.
            </Text>

            <Text
              style={styles.instruction}
            >
              After the melody plays, sing
              the same sequence of notes in
              the same order.
            </Text>

            <Text
              style={styles.instruction}
            >
              Try to match each note as
              accurately as possible and keep
              the timing of the melody.
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
                name="musical-notes-outline"
                size={25}
                color={BROWN}
              />

              <Text
                style={styles.targetText}
              >
                Match the melody
              </Text>
            </View>

            <Text
              style={styles.helperText}
            >
              Your pitch accuracy and timing
              are combined into the final
              exercise score.
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
              Listen to the complete melody
              first, then reproduce the notes
              in the same order.
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
            style={styles.detailRow}
          >
            <Text
              style={styles.detailLabel}
            >
              Pattern length
            </Text>

            <Text
              style={styles.detailValue}
            >
              {patternNoteCount} notes
            </Text>
          </View>

          <View
            style={styles.detailRow}
          >
            <Text
              style={styles.detailLabel}
            >
              Pitch tolerance
            </Text>

            <Text
              style={styles.detailValue}
            >
              {params.tolerancePct.toFixed(
                1,
              )}
              %
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
          reference melody.
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
          Listen to the Melody
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Remember the notes and their
          order.
        </Text>

        <View
          style={styles.patternPreview}
        >
          {currentPattern?.notes.map(
            (note, index) => (
              <View
                key={`target-${index}`}
                style={
                  styles.patternNote
                }
              >
                <Text
                  style={
                    styles.patternNoteLabel
                  }
                >
                  {index + 1}
                </Text>

                <Text
                  style={
                    styles.patternNoteName
                  }
                >
                  {note.name}
                </Text>
              </View>
            ),
          )}
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
          Sing the Melody
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Match each note in the same order
          as the reference.
        </Text>

        <View
          style={
            styles.noteProgress
          }
        >
          {currentPattern?.notes.map(
            (note, index) => (
              <View
                key={`progress-${index}`}
                style={[
                  styles.noteProgressItem,
                  index ===
                    currentNoteIndex &&
                    styles.noteProgressActive,
                ]}
              >
                <Text
                  style={[
                    styles.noteProgressText,
                    index ===
                      currentNoteIndex &&
                      styles.noteProgressTextActive,
                  ]}
                >
                  {note.name}
                </Text>
              </View>
            ),
          )}
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
            {liveTarget?.name ?? '--'}
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
                Note
              </Text>

              <Text
                style={
                  styles.liveStatValue
                }
              >
                {Math.min(
                  currentNoteIndex + 1,
                  patternNoteCount,
                )}
                /{patternNoteCount}
              </Text>
            </View>
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
          Checking your pitch accuracy and
          melodic timing.
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
    const detectedNotes =
      result.noteAccuracies.map(
        (_, index) => {
          const frequency =
            currentExerciseRef.current
              ?.notes[index]
              ?.frequency;

          return frequency &&
            frequency > 0
            ? frequencyToNote(
                frequency,
              )
            : '--';
        },
      );

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
            Melodic Pattern Matching Result
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
                ? 'You matched the melodic pattern accurately.'
                : 'Try to match each note and its timing more closely.'}
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
              Pattern Results
            </Text>

            <View
              style={styles.resultRow}
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Pattern length
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {patternNoteCount} notes
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
                Pattern accuracy
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {Math.round(
                  result.patternAccuracy,
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
                Rhythm accuracy
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {Math.round(
                  result.rhythmAccuracy,
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
              Note Results
            </Text>

            {result.noteAccuracies.map(
              (
                accuracy,
                index,
              ) => (
                <View
                  key={`note-result-${index}`}
                  style={
                    styles.resultRow
                  }
                >
                  <Text
                    style={
                      styles.resultRowLabel
                    }
                  >
                    Note {index + 1}
                    {detectedNotes[index]
                      ? ` · ${detectedNotes[index]}`
                      : ''}
                  </Text>

                  <Text
                    style={
                      styles.resultRowValue
                    }
                  >
                    {Math.round(
                      accuracy,
                    )}
                    %
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
              Target Pattern
            </Text>

            <View
              style={
                styles.resultPattern
              }
            >
              {currentExerciseRef.current?.notes.map(
                (note, index) => (
                  <View
                    key={`result-target-${index}`}
                    style={
                      styles.resultPatternNote
                    }
                  >
                    <Text
                      style={
                        styles.resultPatternNumber
                      }
                    >
                      {index + 1}
                    </Text>

                    <Text
                      style={
                        styles.resultPatternName
                      }
                    >
                      {note.name}
                    </Text>
                  </View>
                ),
              )}
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
                ? 'Nice melodic matching! Keep listening to the complete pattern before singing it back.'
                : 'Listen carefully to each note and focus on reproducing the pattern in the same order and timing.'}
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
    marginBottom: 10,
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

  detailRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },

  detailLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  detailValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
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
    marginTop: 18,
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

  patternPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 28,
    maxWidth: 340,
  },

  patternNote: {
    minWidth: 58,
    backgroundColor: LIGHT_PINK,
    borderRadius: 15,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },

  patternNoteLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },

  patternNoteName: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginTop: 3,
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

  noteProgress: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 18,
  },

  noteProgressItem: {
    minWidth: 48,
    height: 38,
    borderRadius: 12,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },

  noteProgressActive: {
    backgroundColor: PINK,
  },

  noteProgressText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: MUTED,
  },

  noteProgressTextActive: {
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

  resultPattern: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },

  resultPatternNote: {
    minWidth: 52,
    backgroundColor: PINK,
    borderRadius: 13,
    paddingVertical: 9,
    paddingHorizontal: 8,
    alignItems: 'center',
  },

  resultPatternNumber: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,
  },

  resultPatternName: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginTop: 2,
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