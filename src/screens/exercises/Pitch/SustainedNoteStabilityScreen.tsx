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
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  measureSustainedNoteStability,
  type SustainedNoteStabilityMeasurement,
} from '@/services/measurement/pitch/sustainedNoteStability';

import {
  scoreSustainedNoteStabilityRepetitions,
  type SustainedNoteStabilityScoreResult,
} from '@/services/scoring/pitch/sustainedNoteStability';

import {
  playSingleNote,
} from '@/utils/music/notePlayer';

import {
  createMusicalNote,
  getRandomPitchNote,
} from '@/utils/music/notes';

import {
  calcLiveStability,
  calcPitchAccuracy,
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

import {
  generateSustainedNoteStabilityParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';

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

export default function SustainedNoteStabilityScreen({
  tier,
}: Props) {
  const [currentTier, setCurrentTier] =
    useState<Tier>(
      tier ?? 'beginner',
    );

  const [params, setParams] =
    useState<SustainedNoteStabilityParams>(
      SUSTAINED_NOTE_STABILITY_PARAMS[
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

  const [currentRep, setCurrentRep] =
    useState(1);

  const [targetNote, setTargetNote] =
    useState(() =>
      createMusicalNote(60),
    );

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(
      null,
    );

  const [liveFrequencies, setLiveFrequencies] =
    useState<number[]>([]);

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [result, setResult] =
    useState<SustainedNoteStabilityScoreResult | null>(
      null,
    );

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

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

  const recordingRef =
    useRef(false);

  const stopRequestedRef =
    useRef(false);

  const processingRef =
    useRef(false);

  const elapsedRef =
    useRef(0);

  const currentRepRef =
    useRef(1);

  const measurementsRef =
    useRef<SustainedNoteStabilityMeasurement[]>(
      [],
    );

  const pitchHistoryRef =
    useRef<number[]>([]);

  const stopRecordingRef =
    useRef<
      (() => Promise<void>) | null
    >(null);

  /*
   * =====================================================
   * LOAD ADAPTIVE PARAMETERS
   * =====================================================
   */

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParams =
      async () => {
        setIsLoadingAdaptiveParams(true);

        let resolvedTier: Tier =
          tier ?? 'beginner';

        try {
          const resolvedUser =
            await import(
              '@/services/firebase/config'
            );

          const user =
            resolvedUser.auth.currentUser;

          /*
           * Resolve the user's current tier
           * only when no tier was explicitly
           * supplied.
           */
          if (!tier && user) {
            const progress =
              await fetchComponentProgress(
                user.uid,
                'pitch',
              );

            resolvedTier =
              progress?.currentTier ??
              'beginner';
          }

          if (cancelled) {
            return;
          }

          setCurrentTier(
            resolvedTier,
          );

          let recentScores: number[] =
            [];

          /*
           * Get the latest five completed
           * exercises for this component,
           * template, and tier.
           */
          if (user) {
            const records =
              await fetchExerciseRecords(
                user.uid,
                'pitch',
              );

            const currentTierRecords =
              records
                .filter(
                  record =>
                    record.tier ===
                      resolvedTier &&
                    record.templateId ===
                      'sustainedNoteStability',
                )
                .sort(
                  (a, b) =>
                    a.timestamp -
                    b.timestamp,
                );

            recentScores =
              currentTierRecords
                .slice(-5)
                .map(
                  record =>
                    record.scorePct,
                );
          }

          /*
           * Assessment is used only when there
           * is no completed exercise history for
           * the current tier.
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

          const generatedParams =
            generateSustainedNoteStabilityParams(
              {
                tier: resolvedTier,
                recentScores,
              },
            );

          if (cancelled) {
            return;
          }

          setParams(
            generatedParams,
          );
        } catch (error) {
          console.error(
            '❌ FAILED TO LOAD SUSTAINED NOTE ADAPTIVE PARAMETERS:',
            error,
          );

          if (!cancelled) {
            setCurrentTier(
              resolvedTier,
            );

            setParams(
              SUSTAINED_NOTE_STABILITY_PARAMS[
                resolvedTier
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
      };

    loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

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

      if (recordingRef.current) {
        stopRecordingRef.current?.();
      }
    };
  }, []);

  const handleLiveFrame =
    useCallback(
      (frame: LiveAudioFrame) => {
        if (!mountedRef.current) {
          return;
        }

        setLiveFrame(frame);

        if (
          Number.isFinite(
            frame.pitch,
          ) &&
          frame.pitch > 0
        ) {
          pitchHistoryRef.current = [
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

  const handleRecordingStop =
    useCallback(
      async (
        samples: Float32Array,
        sampleRate: number,
      ) => {
        if (!mountedRef.current) {
          return;
        }

        if (processingRef.current) {
          return;
        }

        processingRef.current =
          true;

        recordingRef.current =
          false;

        if (recordingTimerRef.current) {
          clearInterval(
            recordingTimerRef.current,
          );

          recordingTimerRef.current =
            null;
        }

        try {
          const measurement =
            measureSustainedNoteStability(
              samples,
              sampleRate,
              params.minClarity,
            );

          measurementsRef.current = [
            ...measurementsRef.current,
            measurement,
          ];

          const completedReps =
            measurementsRef.current
              .length;

          /*
           * Continue to the next repetition
           * until all configured repetitions
           * have been recorded.
           */
          if (
            completedReps <
            params.repetitions
          ) {
            const nextRep =
              completedReps + 1;

            currentRepRef.current =
              nextRep;

            setCurrentRep(
              nextRep,
            );

            pitchHistoryRef.current =
              [];

            setLiveFrequencies(
              [],
            );

            setLiveFrame(null);

            elapsedRef.current = 0;
            setElapsedMs(0);

            stopRequestedRef.current =
              false;

            processingRef.current =
              false;

            await playTargetAndRecord(
              targetNote,
            );

            return;
          }

          /*
           * All repetitions are complete.
           * Show the shared processing phase
           * while the complete exercise is
           * scored.
           */
          setPhase('processing');

          const score =
            scoreSustainedNoteStabilityRepetitions(
              measurementsRef.current,
              params,
            );

          /*
           * Save one exercise record for the
           * complete exercise, not one record
           * per repetition.
           */
          await saveCompletedExercise(
            'pitch',
            'sustainedNoteStability',
            currentTier,
            score.score,
          );

          if (!mountedRef.current) {
            return;
          }

          setResult(score);
          setPhase('results');
        } catch (error) {
          console.error(
            '❌ SUSTAINED NOTE PROCESSING ERROR:',
            error,
          );

          if (mountedRef.current) {
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
        targetNote,
      ],
    );

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

  useEffect(() => {
    stopRecordingRef.current =
      stopRecording;

    return () => {
      stopRecordingRef.current =
        null;
    };
  }, [stopRecording]);

  const beginRecording =
    useCallback(async () => {
      if (
        !mountedRef.current ||
        recordingRef.current ||
        processingRef.current
      ) {
        return;
      }

      try {
        pitchHistoryRef.current =
          [];

        setLiveFrequencies(
          [],
        );

        setLiveFrame(null);

        elapsedRef.current = 0;
        setElapsedMs(0);

        stopRequestedRef.current =
          false;

        setPhase('recording');

        await startRecording();

        if (!mountedRef.current) {
          return;
        }

        recordingRef.current =
          true;

        const durationMs =
          params.durationSec *
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

            elapsedRef.current +=
              100;

            setElapsedMs(
              elapsedRef.current,
            );

            if (
              elapsedRef.current >=
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
                    '❌ FAILED TO STOP SUSTAINED NOTE:',
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
          '❌ FAILED TO START SUSTAINED NOTE:',
          error,
        );

        recordingRef.current =
          false;

        stopRequestedRef.current =
          false;

        if (mountedRef.current) {
          setPhase(
            'instructions',
          );

          Alert.alert(
            'Microphone Error',
            'Unable to start the microphone. Please check your microphone permission and try again.',
          );
        }
      }
    }, [
      params.durationSec,
      startRecording,
      stopRecording,
    ]);

  const playTargetAndRecord =
    useCallback(
      async (
        note: ReturnType<
          typeof createMusicalNote
        >,
      ) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        try {
          setPhase('playing');

          await playSingleNote(
            note.frequency,
            1.5,
          );

          if (
            !mountedRef.current
          ) {
            return;
          }

          await beginRecording();
        } catch (error) {
          console.error(
            '❌ FAILED TO PLAY TARGET NOTE:',
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
              'Unable to play the target note. Please try again.',
            );
          }
        }
      },
      [beginRecording],
    );

  const startCountdown =
    useCallback(() => {
      const generated =
        getRandomPitchNote(
          currentTier,
        );

      setTargetNote(
        generated,
      );

      setResult(null);
      setErrorMessage(null);

      setCurrentRep(1);
      currentRepRef.current = 1;

      measurementsRef.current =
        [];

      setLiveFrame(null);
      setLiveFrequencies([]);

      pitchHistoryRef.current =
        [];

      elapsedRef.current = 0;
      setElapsedMs(0);

      processingRef.current =
        false;

      stopRequestedRef.current =
        false;

      recordingRef.current =
        false;

      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current,
        );
      }

      setCountdown(3);
      setPhase('countdown');

      let value = 3;

      countdownTimerRef.current =
        setInterval(() => {
          value -= 1;

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

            playTargetAndRecord(
              generated,
            );

            return;
          }

          setCountdown(
            value,
          );
        }, 1000);
    }, [
      currentTier,
      playTargetAndRecord,
    ]);

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

      setResult(null);

      setCurrentRep(1);
      currentRepRef.current = 1;

      measurementsRef.current =
        [];

      setLiveFrame(null);
      setLiveFrequencies([]);

      pitchHistoryRef.current =
        [];

      elapsedRef.current = 0;
      setElapsedMs(0);

      processingRef.current =
        false;

      stopRequestedRef.current =
        false;

      recordingRef.current =
        false;

      setPhase(
        'instructions',
      );
    }, []);

  const durationMs =
    params.durationSec * 1000;

  const progress =
    durationMs > 0
      ? Math.min(
          1,
          elapsedMs / durationMs,
        )
      : 0;

  const liveAccuracy =
    liveFrame &&
    liveFrame.pitch > 0
      ? Math.max(
          0,
          calcPitchAccuracy(
            liveFrame.pitch,
            targetNote.frequency,
          ),
        )
      : 0;

  const liveStability =
    calcLiveStability(
      liveFrequencies,
    );

  if (
    phase ===
    'instructions'
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
              name="radio-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.title}>
            Sustained Note Stability
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
              Listen to the reference note
              before each recording.
            </Text>

            <Text
              style={styles.instruction}
            >
              Sing the same comfortable
              note and hold it steadily
              for{' '}
              {params.durationSec}{' '}
              seconds.
            </Text>

            <Text
              style={styles.instruction}
            >
              Complete{' '}
              {params.repetitions}{' '}
              repetitions while keeping
              your pitch steady without
              drifting sharp or flat.
            </Text>

            <View
              style={styles.prepareCard}
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
                style={styles.prepareItem}
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
                style={styles.prepareItem}
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
                style={styles.prepareItem}
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
                  Speak or sing toward the
                  microphone for clearer
                  audio capture.
                </Text>
              </View>
            </View>

            <View
              style={styles.targetBox}
            >
              <Ionicons
                name="remove"
                size={25}
                color={BROWN}
              />

              <Text
                style={styles.targetText}
              >
                Keep the note steady
              </Text>
            </View>

            <Text
              style={styles.helperText}
            >
              TuneUp! measures pitch
              stability across all
              repetitions.
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
              Avoid intentionally changing
              pitch. Focus on maintaining
              one relaxed, consistent note.
            </Text>
          </View>

          <View
            style={styles.difficultyRow}
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
            style={
              styles.startButton
            }
            onPress={
              startCountdown
            }
            disabled={
              isLoadingAdaptiveParams
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
              style={styles.errorText}
            >
              {errorMessage}
            </Text>
          )}
        </ScrollView>
      </View>
    );
  }

  if (
    phase === 'countdown'
  ) {
    return (
      <ExerciseCountdownScreen
        icon="musical-notes-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={
          params.repetitions
        }
        countdown={countdown}
        promptTitle="Get ready"
        prompt="A reference note will play next."
        onBack={() =>
          router.replace(
            '/dashboard?tab=exercises',
          )
        }
      />
    );
  }

  if (
    phase === 'playing'
  ) {
    return (
      <ExerciseListeningScreen
        icon="volume-high-outline"
        title="Listen Carefully"
        currentRep={currentRep}
        repetitions={
          params.repetitions
        }
        promptTitle="Listen to the reference note"
        prompt="Listen to the reference note, then sing it steadily."
        liveContent={
          <View
            style={styles.targetCard}
          >
            <Text
              style={styles.targetLabel}
            >
              TARGET NOTE
            </Text>

            <Text
              style={styles.targetNote}
            >
              {targetNote.name}
            </Text>

            <Text
              style={
                styles.targetFrequency
              }
            >
              {Math.round(
                targetNote.frequency,
              )}{' '}
              Hz
            </Text>
          </View>
        }
        onBack={() =>
          router.replace(
            '/dashboard?tab=exercises',
          )
        }
      />
    );
  }

  if (
    phase === 'recording'
  ) {
    return (
      <View
        style={styles.centerScreen}
      >
        <View
          style={styles.recordingIcon}
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
          Hold {targetNote.name}
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Repetition {currentRep} of{' '}
          {params.repetitions}
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Keep your pitch as steady as
          possible.
        </Text>

        <View
          style={styles.liveCard}
        >
          <Text
            style={styles.liveLabel}
          >
            Target
          </Text>

          <Text
            style={styles.liveTarget}
          >
            {targetNote.name}
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
            styles.progressContainer
          }
        >
          <View
            style={
              styles.progressTrack
            }
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progress * 100}%`,
                },
              ]}
            />
          </View>

          <Text
            style={styles.progressText}
          >
            {(elapsedMs / 1000).toFixed(
              1,
            )}
            s / {params.durationSec}s
          </Text>
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

  if (
    phase === 'processing'
  ) {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your Singing"
        message="Measuring your pitch stability across all repetitions."
        onBack={() =>
          router.replace(
            '/dashboard?tab=exercises',
          )
        }
      />
    );
  }

  if (
    phase === 'results' &&
    result
  ) {
    return (
      <View
        style={styles.screen}
      >
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
            Sustained Note Stability
            Result
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
                ? 'Your pitch stability reached the target level across all repetitions.'
                : 'Focus on keeping your pitch steadier and maintaining the required duration across repetitions.'}
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
              Target Note
            </Text>

            <View
              style={styles.noteDisplay}
            >
              <Text
                style={styles.resultNote}
              >
                {targetNote.name}
              </Text>

              <Text
                style={
                  styles.resultFrequency
                }
              >
                {Math.round(
                  targetNote.frequency,
                )}{' '}
                Hz
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
                Repetitions completed
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {
                  result.repetitionsCompleted
                }{' '}
                / {params.repetitions}
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
                Average score
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {result.score}%
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
                Average pitch variation
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {result.stabilityCents.toFixed(
                  1,
                )}{' '}
                cents
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
                Required stability
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                ≤{' '}
                {
                  params.stabilityThresholdCents
                }{' '}
                cents
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
                Average duration
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {result.durationSec.toFixed(
                  1,
                )}{' '}
                s
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
              Scores by Repetition
            </Text>

            {result.repetitionScores.map(
              (repetitionScore, index) => (
                <View
                  key={`repetition-${index}`}
                  style={styles.resultRow}
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
                ? 'Nice work! Continue practicing sustained notes to build consistent pitch control across repetitions.'
                : 'Try relaxing your throat and supporting the note with steady breath while avoiding unnecessary pitch movement.'}
            </Text>
          </View>

          <Pressable
            style={
              styles.startButton
            }
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

  targetCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#F2DDE5',
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
    borderColor: '#F2DDE5',
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