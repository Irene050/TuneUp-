// src/screens/exercises/Pitch/NoteMatchingScreen.tsx

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
  NOTE_MATCHING_PARAMS,
  type Tier,
} from '@/constants/exercises/pitch';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import {
  measureNoteMatching,
} from '@/services/measurement/pitch/noteMatching';

import {
  scoreNoteMatching,
} from '@/services/scoring/pitch/noteMatching';

import {
  disposeNotePlayer,
  playSingleNote,
} from '@/utils/music/notePlayer';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { auth } from '@/services/firebase/config';

import {
  generateNoteMatchingParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  calcLiveStability,
  calcPitchAccuracy,
  frequencyToNote,
} from '@/utils/dsp/pitch';

import {
  getRandomPitchNote,
  type VocalRange,
} from '@/utils/music/notes';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '../ExerciseScreen';

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
// EXERCISE CONFIG
// ============================================================

const COUNTDOWN_SECONDS = 3;
const TARGET_NOTE_DURATION_SECONDS = 1.5;
const RECORDING_DURATION_SECONDS = 4;

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

type LivePitchState = {
  pitch: number;
  note: string;
  clarity: number;
  volume: number;
  stability: number;
};

type ResultState = {
  score: number;
  passed: boolean;
  deviationPct: number;
  detectedFrequency: number;
  averageClarity: number;
  voicedFrames: number;
};

// ============================================================
// HELPERS
// ============================================================

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

function calculateCentsDifference(
  detectedFrequency: number,
  targetFrequency: number,
): number {
  if (
    !Number.isFinite(detectedFrequency) ||
    !Number.isFinite(targetFrequency) ||
    detectedFrequency <= 0 ||
    targetFrequency <= 0
  ) {
    return 0;
  }

  return (
    1200 *
    Math.log2(
      detectedFrequency /
        targetFrequency,
    )
  );
}

function getPitchMessage(
  cents: number,
): string {
  const absoluteCents =
    Math.abs(cents);

  if (absoluteCents <= 25) {
    return 'Great!';
  }

  if (absoluteCents <= 50) {
    return 'Close';
  }

  if (cents > 0) {
    return 'Too High';
  }

  return 'Too Low';
}

function formatFrequency(
  frequency: number,
): string {
  if (
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return '--';
  }

  return `${frequency.toFixed(1)} Hz`;
}

function formatCents(
  cents: number,
): string {
  if (!Number.isFinite(cents)) {
    return '--';
  }

  if (Math.abs(cents) < 0.5) {
    return '0 cents';
  }

  return `${
    cents > 0 ? '+' : ''
  }${Math.round(cents)} cents`;
}

function formatVolume(
  volume: number,
): string {
  if (!Number.isFinite(volume)) {
    return '--';
  }

  return `${Math.round(volume)} dB`;
}

// ============================================================
// COMPONENT
// ============================================================

export default function NoteMatchingScreen({
  tier,
}: Props) {
  const [screen, setScreen] =
    useState<Screen>(
      'instructions',
    );

  const [currentTier, setCurrentTier] =
    useState<Tier>(
      tier ?? 'beginner',
    );

  const [adaptiveParams, setAdaptiveParams] =
    useState(
      NOTE_MATCHING_PARAMS[
        tier ?? 'beginner'
      ],
    );

  const [
    isLoadingAdaptiveParams,
    setIsLoadingAdaptiveParams,
  ] = useState(true);

  const [countdown, setCountdown] =
    useState(
      COUNTDOWN_SECONDS,
    );

  const [elapsedSeconds, setElapsedSeconds] =
    useState(0);

  const [currentRep, setCurrentRep] =
    useState(1);

  const [livePitch, setLivePitch] =
    useState<LivePitchState>({
      pitch: 0,
      note: '--',
      clarity: 0,
      volume: -100,
      stability: 0,
    });

  const [result, setResult] =
    useState<ResultState | null>(
      null,
    );

  const [errorMessage, setErrorMessage] =
    useState('');

  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  // ==========================================================
  // REFS
  // ==========================================================

  const mountedRef =
    useRef(true);

  const pitchHistoryRef =
    useRef<number[]>([]);

  const repResultsRef =
    useRef<ResultState[]>([]);

  const currentRepRef =
    useRef(1);

  const countdownTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const startingRef =
    useRef(false);

  const finishingRef =
    useRef(false);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(
      null,
    );

  // ==========================================================
  // ADAPTIVE DIFFICULTY
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParameters() {
      setIsLoadingAdaptiveParams(true);

      try {
        const user = auth.currentUser;

        let resolvedTier: Tier =
          tier ?? 'beginner';

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

        let recentScores: number[] = [];

        if (user) {
          const records =
            await fetchExerciseRecords(
              user.uid,
              'pitch',
            );

          if (cancelled) {
            return;
          }

          const currentTierRecords =
            records
              .filter(
                record =>
                  record.tier ===
                    resolvedTier &&
                  record.templateId ===
                    'noteMatchingExercise',
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

          if (
            recentScores.length === 0
          ) {
            const assessment =
              await getLatestAssessment();

            setVocalRange(
              assessment?.vocalRange ?? null,
            );

            if (cancelled) {
              return;
            }

            const assessmentScore =
              assessment?.scores.find(
                score =>
                  score.componentId ===
                  'pitch',
              );

            if (
              assessmentScore
            ) {
              recentScores = [
                assessmentScore.scorePct,
              ];
            }
          }
        }

        const generatedParams =
          generateNoteMatchingParams({
            tier: resolvedTier,
            recentScores,
          });

        if (cancelled) {
          return;
        }

        setAdaptiveParams(
          generatedParams,
        );
      } catch (error) {
        console.error(
          '❌ NOTE MATCHING ADS ERROR:',
          error,
        );

        const fallbackTier =
          tier ?? 'beginner';

        if (!cancelled) {
          setCurrentTier(
            fallbackTier,
          );

          setAdaptiveParams(
            NOTE_MATCHING_PARAMS[
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

  // ============================================================
  // TARGET NOTE
  // ============================================================

const target = useMemo(
  () =>
    getRandomPitchNote(
      currentTier,
      vocalRange,
    ),
  [
    currentTier,
    vocalRange,
  ],
);

  const targetFrequency =
    target.frequency;

  const targetNote =
    target.name;

  // ============================================================
  // TIMER CLEANUP
  // ============================================================

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

  // ============================================================
  // LIVE AUDIO FRAME
  // ============================================================

      const handleLiveFrame =
      useCallback(
        (frame: {
          pitch: number;
          note: string;
          clarity: number;
          volume: number;
        }) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        if (
          Number.isFinite(frame.pitch) &&
          frame.pitch > 0
        ) {
          const history = [
            ...pitchHistoryRef.current,
            frame.pitch,
          ].slice(-20);

          pitchHistoryRef.current =
            history;

          const stability =
            calcLiveStability(
              history,
            );

          setLivePitch({
            pitch: frame.pitch,
            note:
              frame.note || '--',
            clarity:
              frame.clarity,
            volume:
              frame.volume,
            stability,
          });

          return;
        }

        setLivePitch(previous => ({
          ...previous,
          pitch: 0,
          note: '--',
          clarity: frame.clarity,
          volume: frame.volume,
        }));
      },
      [],
    );

  // ============================================================
  // START A RECORDING REPETITION
  // ============================================================

  const startRecordingAttempt =
    useCallback(async () => {
      if (
        !mountedRef.current ||
        !startRecordingRef.current
      ) {
        return;
      }

      pitchHistoryRef.current =
        [];

      setLivePitch({
        pitch: 0,
        note: '--',
        clarity: 0,
        volume: -100,
        stability: 0,
      });

      setElapsedSeconds(0);

      setScreen('recording');

      await startRecordingRef.current();

      if (
        !mountedRef.current
      ) {
        return;
      }

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
              RECORDING_DURATION_SECONDS,
            ),
          );

          if (
            elapsed >=
            RECORDING_DURATION_SECONDS
          ) {
            clearTimers();

            if (
              !finishingRef.current
            ) {
              finishingRef.current =
                true;

              stopRecordingRef.current?.();
            }
          }
        }, 100);
    }, [clearTimers]);

  // ============================================================
  // RECORDER
  // ============================================================

  const {
    startRecording,
    stopRecording,
    isRecording,
  } =
    useAudioRecorder({
      onFrame:
        handleLiveFrame,

      onStop:
        async (
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
            const measurement =
              measureNoteMatching(
                samples,
                sampleRate,
                adaptiveParams.minClarity,
              );

            const scored =
              scoreNoteMatching(
                measurement,
                targetFrequency,
                adaptiveParams,
              );

            const repetitionResult: ResultState = {
              score: scored.score,
              passed: scored.passed,
              deviationPct:
                scored.deviationPct,
              detectedFrequency:
                scored.detectedFrequency,
              averageClarity:
                scored.averageClarity,
              voicedFrames:
                measurement.voicedFrames,
            };

            const updatedResults = [
              ...repResultsRef.current,
              repetitionResult,
            ];

            repResultsRef.current =
              updatedResults;

            const isLastRepetition =
              currentRepRef.current >=
              adaptiveParams.repetitions;

            if (
              !isLastRepetition
            ) {
              const nextRep =
                currentRepRef.current +
                1;

              currentRepRef.current =
                nextRep;

              setCurrentRep(
                nextRep,
              );

              finishingRef.current =
                false;

              setElapsedSeconds(0);

              pitchHistoryRef.current =
                [];

              setLivePitch({
                pitch: 0,
                note: '--',
                clarity: 0,
                volume: -100,
                stability: 0,
              });

              setScreen(
                'listening',
              );

              await playSingleNote(
                targetFrequency,
                TARGET_NOTE_DURATION_SECONDS,
              );

              if (
                !mountedRef.current
              ) {
                return;
              }

              await startRecordingAttempt();

              return;
            }

            const finalScore =
              Math.round(
                updatedResults.reduce(
                  (sum, item) =>
                    sum + item.score,
                  0,
                ) /
                  updatedResults.length,
              );

            const averageDeviation =
              updatedResults.reduce(
                (sum, item) =>
                  sum +
                  item.deviationPct,
                0,
              ) /
              updatedResults.length;

            const averageFrequency =
              updatedResults
                .filter(
                  item =>
                    item.detectedFrequency >
                    0,
                )
                .reduce(
                  (sum, item) =>
                    sum +
                    item.detectedFrequency,
                  0,
                );

            const detectedFrequencyCount =
              updatedResults.filter(
                item =>
                  item.detectedFrequency >
                  0,
              ).length;

            const averageDetectedFrequency =
              detectedFrequencyCount >
              0
                ? averageFrequency /
                  detectedFrequencyCount
                : 0;

            const averageClarity =
              updatedResults.reduce(
                (sum, item) =>
                  sum +
                  item.averageClarity,
                0,
              ) /
              updatedResults.length;

            const totalVoicedFrames =
              updatedResults.reduce(
                (sum, item) =>
                  sum +
                  item.voicedFrames,
                0,
              );

            const passed =
              updatedResults.every(
                item => item.passed,
              );

            await saveCompletedExercise(
              'pitch',
              'noteMatchingExercise',
              currentTier,
              finalScore,
            );

            if (
              !mountedRef.current
            ) {
              return;
            }

            setResult({
              score: finalScore,
              passed,
              deviationPct:
                averageDeviation,
              detectedFrequency:
                averageDetectedFrequency,
              averageClarity,
              voicedFrames:
                totalVoicedFrames,
            });

            setScreen(
              'results',
            );
          } catch (error) {
            console.error(
              '❌ NOTE MATCHING ANALYSIS ERROR:',
              error,
            );

            if (
              mountedRef.current
            ) {
              setErrorMessage(
                'We could not analyze your recording. Please try again.',
              );

              setScreen(
                'instructions',
              );
            }
          } finally {
            finishingRef.current =
              false;

            startingRef.current =
              false;
          }
        },
    });

  const stopRecordingRef =
    useRef<
      (() => void) | null
    >(null);

  stopRecordingRef.current =
    stopRecording;

  startRecordingRef.current =
    startRecording;

  // ============================================================
  // UNMOUNT CLEANUP
  // ============================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current =
        false;

      clearTimers();

      disposeNotePlayer().catch(
        error => {
          console.warn(
            '⚠️ Failed to dispose note player:',
            error,
          );
        },
      );
    };
  }, [clearTimers]);

  // ============================================================
  // START EXERCISE
  // ============================================================

  const startExercise =
    useCallback(() => {
      if (
        startingRef.current ||
        isLoadingAdaptiveParams
      ) {
        return;
      }

      startingRef.current =
        true;

      finishingRef.current =
        false;

      clearTimers();

      pitchHistoryRef.current =
        [];

      repResultsRef.current =
        [];

      currentRepRef.current =
        1;

      setCurrentRep(1);
      setErrorMessage('');
      setResult(null);

      setLivePitch({
        pitch: 0,
        note: '--',
        clarity: 0,
        volume: -100,
        stability: 0,
      });

      setElapsedSeconds(0);

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setScreen(
        'countdown',
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

          if (remaining > 0) {
            setCountdown(
              remaining,
            );

            return;
          }

          clearTimers();

          setCountdown(0);

          setScreen(
            'listening',
          );

          playSingleNote(
            targetFrequency,
            TARGET_NOTE_DURATION_SECONDS,
          )
            .then(
              async () => {
                if (
                  !mountedRef.current
                ) {
                  return;
                }

                await startRecordingAttempt();
              },
            )
            .catch(error => {
              console.error(
                '❌ FAILED TO START NOTE MATCHING:',
                error,
              );

              startingRef.current =
                false;

              if (
                mountedRef.current
              ) {
                setErrorMessage(
                  'We could not start the exercise. Please check your microphone permission and try again.',
                );

                setScreen(
                  'instructions',
                );
              }
            });
        }, 1000);
    }, [
      clearTimers,
      isLoadingAdaptiveParams,
      startRecordingAttempt,
      targetFrequency,
    ]);

  // ============================================================
  // MANUAL FINISH
  // ============================================================

  const finishRecording =
    useCallback(() => {
      if (
        !isRecording ||
        finishingRef.current
      ) {
        return;
      }

      finishingRef.current =
        true;

      clearTimers();

      stopRecording();
    }, [
      clearTimers,
      isRecording,
      stopRecording,
    ]);

  // ============================================================
  // RETRY
  // ============================================================

  const retryExercise =
    useCallback(() => {
      clearTimers();

      startingRef.current =
        false;

      finishingRef.current =
        false;

      pitchHistoryRef.current =
        [];

      repResultsRef.current =
        [];

      currentRepRef.current =
        1;

      setCurrentRep(1);

      setResult(null);

      setErrorMessage('');

      setElapsedSeconds(0);

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setLivePitch({
        pitch: 0,
        note: '--',
        clarity: 0,
        volume: -100,
        stability: 0,
      });

      setScreen(
        'instructions',
      );
    }, [clearTimers]);

  // ============================================================
  // GO BACK
  // ============================================================

  const goBack =
    useCallback(() => {
      clearTimers();

      router.replace(
        '/dashboard?tab=exercises',
      );
    }, [clearTimers]);

  // ============================================================
  // LOADING
  // ============================================================

  if (
    screen === 'instructions' &&
    isLoadingAdaptiveParams
  ) {
    return (
      <View
        style={styles.centerScreen}
      >
        <View
          style={styles.iconCircle}
        >
          <Ionicons
            name="musical-note-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Preparing Exercise
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Adjusting the exercise to your
          current progress.
        </Text>

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

  // ============================================================
  // INSTRUCTIONS — SHARED
  // ============================================================

  if (
    screen === 'instructions'
  ) {
    return (
      <ExerciseScreen
        title="Note Matching Exercise"
        category="Pitch"
        icon="musical-note-outline"
        instructions={
          'Listen carefully to the target note first.\n\n' +
          'After the target note finishes, sing the same note back.\n\n' +
          'Hold the note steadily and try to match the pitch as closely as possible.'
        }
        preparationSteps={[
          {
            icon: 'volume-mute-outline',
            text:
              'Find a quiet room or area with minimal background noise.',
          },
          {
            icon: 'body-outline',
            text:
              'Sit upright or stand with your back straight and your shoulders relaxed.',
          },
          {
            icon: 'mic-outline',
            text:
              'If available, an external microphone or audio recording equipment is recommended.',
          },
        ]}
        summary={[
          {
            label: 'Target Note',
            value: targetNote,
          },
          {
            label: 'Frequency',
            value:
              formatFrequency(
                targetFrequency,
              ),
          },
          {
            label: 'Repetitions',
            value: String(
              adaptiveParams.repetitions,
            ),
          },
        ]}
        tip={
          'Sing comfortably and make small adjustments until your pitch matches the target.'
        }
        tier={currentTier}
        onBack={goBack}
        onStart={startExercise}
        error={errorMessage}
        startDisabled={
          isLoadingAdaptiveParams
        }
      />
    );
  }

  // ============================================================
  // COUNTDOWN — SHARED
  // ============================================================

if (
  screen === 'countdown'
) {
  return (
    <ExerciseCountdownScreen
      icon="musical-notes-outline"
      title="Get Ready"
      currentRep={currentRep}
      repetitions={adaptiveParams.repetitions}
      countdown={countdown}
      promptTitle="Your target note is"
      prompt={`${targetNote} • ${formatFrequency(
        targetFrequency,
      )}`}
    />
  );
}

  // ============================================================
  // LISTENING — SHARED
  // ============================================================

if (
  screen === 'listening'
) {
  return (
    <ExerciseListeningScreen
      icon="volume-high-outline"
      title="Listen to the Note"
      currentRep={currentRep}
      repetitions={adaptiveParams.repetitions}
      promptTitle="Listen to the reference note"
      prompt="Listen to the reference note, then sing the same note."
      liveContent={
        <View
          style={styles.sharedListenNoteBox}
        >
          <Text
            style={styles.listenLabel}
          >
            TARGET NOTE
          </Text>

          <Text
            style={styles.largeNote}
          >
            {targetNote}
          </Text>

          <Text
            style={styles.stateFrequency}
          >
            {formatFrequency(
              targetFrequency,
            )}
          </Text>
        </View>
      }
      progress={100}
    />
  );
}

  // ============================================================
  // RECORDING — EXERCISE SPECIFIC
  // ============================================================

  if (
    screen === 'recording'
  ) {
    const cents =
      calculateCentsDifference(
        livePitch.pitch,
        targetFrequency,
      );

    const accuracy =
      livePitch.pitch > 0
        ? calcPitchAccuracy(
            livePitch.pitch,
            targetFrequency,
          )
        : 0;

    const progress =
      clamp(
        elapsedSeconds /
          RECORDING_DURATION_SECONDS,
        0,
        1,
      );

    return (
      <View
        style={styles.screen}
      >
        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.recordingContent
          }
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
            style={
              styles.recordingTitle
            }
          >
            Sing the Note
          </Text>

          <Text
            style={
              styles.recordingSubtitle
            }
          >
            Repetition {currentRep} of{' '}
            {adaptiveParams.repetitions}
          </Text>

          <View
            style={styles.smallTargetCard}
          >
            <View>
              <Text
                style={styles.smallLabel}
              >
                TARGET
              </Text>

              <Text
                style={styles.smallNote}
              >
                {targetNote}
              </Text>
            </View>

            <Text
              style={styles.smallHz}
            >
              {formatFrequency(
                targetFrequency,
              )}
            </Text>
          </View>

          <View
            style={
              styles.microphoneArea
            }
          >
            <View
              style={
                styles.outerMicCircle
              }
            >
              <View
                style={
                  styles.innerMicCircle
                }
              >
                <Ionicons
                  name="mic"
                  size={52}
                  color={BROWN}
                />
              </View>
            </View>

            <View
              style={
                styles.recordingBadge
              }
            >
              <View
                style={
                  styles.recordingDot
                }
              />

              <Text
                style={
                  styles.recordingBadgeText
                }
              >
                RECORDING
              </Text>
            </View>
          </View>

          <View
            style={styles.detectedArea}
          >
            <Text
              style={
                styles.detectedLabel
              }
            >
              DETECTED NOTE
            </Text>

            <Text
              style={
                styles.detectedNote
              }
            >
              {livePitch.note}
            </Text>

            <Text
              style={
                styles.detectedFrequency
              }
            >
              {formatFrequency(
                livePitch.pitch,
              )}
            </Text>

            <Text
              style={
                styles.pitchMessage
              }
            >
              {livePitch.pitch > 0
                ? getPitchMessage(cents)
                : 'Listening...'}
            </Text>
          </View>

          <View
            style={
              styles.accuracyTrack
            }
          >
            <View
              style={[
                styles.accuracyFill,
                {
                  width: `${clamp(
                    accuracy,
                    0,
                    100,
                  )}%`,
                },
              ]}
            />
          </View>

          <Text
            style={styles.centsText}
          >
            {livePitch.pitch > 0
              ? formatCents(cents)
              : 'Waiting for pitch...'}
          </Text>

          <View
            style={styles.metricsGrid}
          >
            <MetricCard
              label="ACCURACY"
              value={
                livePitch.pitch > 0
                  ? `${Math.round(
                      accuracy,
                    )}%`
                  : '--'
              }
            />

            <MetricCard
              label="CLARITY"
              value={
                livePitch.clarity > 0
                  ? `${Math.round(
                      livePitch.clarity *
                        100,
                    )}%`
                  : '--'
              }
            />

            <MetricCard
              label="STABILITY"
              value={
                livePitch.stability > 0
                  ? `${Math.round(
                      livePitch.stability,
                    )}%`
                  : '--'
              }
            />

            <MetricCard
              label="VOLUME"
              value={formatVolume(
                livePitch.volume,
              )}
            />
          </View>

          <Text
            style={styles.timerText}
          >
            {elapsedSeconds.toFixed(
              1,
            )}{' '}
            /{' '}
            {RECORDING_DURATION_SECONDS.toFixed(
              1,
            )}
            s
          </Text>

          <View
            style={styles.timerTrack}
          >
            <View
              style={[
                styles.timerFill,
                {
                  width: `${progress * 100}%`,
                },
              ]}
            />
          </View>

          <Pressable
            style={styles.finishButton}
            onPress={
              finishRecording
            }
          >
            <Ionicons
              name="stop"
              size={20}
              color={BROWN}
            />

            <Text
              style={
                styles.finishButtonText
              }
            >
              Finish
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ============================================================
  // PROCESSING — SHARED
  // ============================================================

  if (
    screen === 'processing'
  ) {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your Singing"
        message={
          currentRep <
          adaptiveParams.repetitions
            ? `Checking repetition ${currentRep} of ${adaptiveParams.repetitions}.`
            : 'Calculating your final Note Matching result.'
        }
      />
    );
  }

  // ============================================================
  // RESULTS — SHARED
  // ============================================================

  if (
    screen === 'results' &&
    result
  ) {
    const detectedNote =
      result.detectedFrequency > 0
        ? frequencyToNote(
            result.detectedFrequency,
          )
        : '--';

    const cents =
      calculateCentsDifference(
        result.detectedFrequency,
        targetFrequency,
      );

    return (
      <ExerciseResultsScreen
        title={
          result.passed
            ? 'Great Job!'
            : 'Keep Practicing!'
        }
        subtitle={`Note Matching Result • ${adaptiveParams.repetitions} repetitions`}
        score={result.score}
        resultIcon={
          result.passed
            ? 'checkmark'
            : 'refresh'
        }
        scoreMessage={
          result.passed
            ? 'You matched the target note accurately across all repetitions.'
            : 'Keep practicing your pitch placement across each repetition.'
        }
        onRetry={
          retryExercise
        }
        onExit={goBack}
      >
        <View
          style={styles.resultCard}
        >
          <Text
            style={
              styles.resultCardTitle
            }
          >
            Pitch Comparison
          </Text>

          <View
            style={styles.comparisonRow}
          >
            <View
              style={
                styles.comparisonSide
              }
            >
              <Text
                style={
                  styles.comparisonLabel
                }
              >
                TARGET
              </Text>

              <Text
                style={
                  styles.comparisonNote
                }
              >
                {targetNote}
              </Text>

              <Text
                style={
                  styles.comparisonFrequency
                }
              >
                {formatFrequency(
                  targetFrequency,
                )}
              </Text>
            </View>

            <Ionicons
              name="arrow-forward"
              size={23}
              color={MUTED}
            />

            <View
              style={[
                styles.comparisonSide,
                styles.detectedComparison,
              ]}
            >
              <Text
                style={
                  styles.comparisonLabel
                }
              >
                AVERAGE DETECTED
              </Text>

              <Text
                style={
                  styles.comparisonNote
                }
              >
                {detectedNote}
              </Text>

              <Text
                style={
                  styles.comparisonFrequency
                }
              >
                {formatFrequency(
                  result.detectedFrequency,
                )}
              </Text>
            </View>
          </View>
        </View>

        <View
          style={styles.resultsGrid}
        >
          <MetricCard
            label="PITCH ACCURACY"
            value={`${result.score}%`}
          />

          <MetricCard
            label="DEVIATION"
            value={formatCents(cents)}
          />

          <MetricCard
            label="AVG. CLARITY"
            value={`${Math.round(
              result.averageClarity *
                100,
            )}%`}
          />

          <MetricCard
            label="VOICED FRAMES"
            value={String(
              result.voicedFrames,
            )}
          />
        </View>

        <View
          style={styles.feedbackCard}
        >
          <Ionicons
            name="bulb-outline"
            size={21}
            color={BROWN}
          />

          <View
            style={
              styles.feedbackContent
            }
          >
            <Text
              style={
                styles.feedbackTitle
              }
            >
              Feedback
            </Text>

            <Text
              style={
                styles.feedbackText
              }
            >
              {getFeedback(
                result,
                cents,
                targetNote,
              )}
            </Text>
          </View>
        </View>
      </ExerciseResultsScreen>
    );
  }

  return null;
}

// ============================================================
// SMALL COMPONENTS
// ============================================================

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Text
        style={styles.metricLabel}
      >
        {label}
      </Text>

      <Text
        style={styles.metricValue}
      >
        {value}
      </Text>
    </View>
  );
}

// ============================================================
// FEEDBACK
// ============================================================

function getFeedback(
  result: ResultState,
  cents: number,
  targetNote: string,
): string {
  if (
    result.detectedFrequency <= 0
  ) {
    return `We couldn't detect enough reliable pitch information. Try singing closer to the microphone and hold ${targetNote} steadily.`;
  }

  if (result.passed) {
    return `Excellent pitch matching! Your voice stayed close to ${targetNote} across the repetitions. Keep practicing controlled and steady pitch placement.`;
  }

  if (
    Math.abs(cents) <= 50
  ) {
    return `You were very close to ${targetNote}. Listen carefully to the reference note and make small adjustments while sustaining it.`;
  }

  if (cents > 0) {
    return `Your detected pitch was higher than ${targetNote}. Try relaxing your voice slightly and aim a little lower.`;
  }

  return `Your detected pitch was lower than ${targetNote}. Try supporting the note steadily and aim slightly higher.`;
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

  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
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
  },

  // ==========================================================
  // LISTENING
  // ==========================================================

  sharedListenNoteBox: {
    minWidth: 180,
    backgroundColor: PINK,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 30,
    alignItems: 'center',
    marginTop: 22,
  },

  listenLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.8,
  },

  largeNote: {
    fontFamily: 'FredokaBold',
    fontSize: 55,
    color: BROWN,
    marginTop: 10,
  },

  stateFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 1,
  },

  // ==========================================================
  // RECORDING
  // ==========================================================

  recordingContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 82,
    paddingBottom: 50,
    alignItems: 'center',
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
    marginTop: 3,
  },

  smallTargetCard: {
    width: '100%',
    marginTop: 20,
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    paddingHorizontal: 18,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  smallLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.7,
  },

  smallNote: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    marginTop: 1,
  },

  smallHz: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  microphoneArea: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 18,
  },

  outerMicCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 8,
    borderColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  innerMicCircle: {
    width: 118,
    height: 118,
    borderRadius: 59,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recordingBadge: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
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

  detectedArea: {
    alignItems: 'center',
  },

  detectedLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.7,
    color: MUTED,
  },

  detectedNote: {
    fontFamily: 'FredokaBold',
    fontSize: 48,
    color: BROWN,
    marginTop: 2,
  },

  detectedFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  pitchMessage: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginTop: 5,
  },

  accuracyTrack: {
    width: '100%',
    height: 9,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 17,
  },

  accuracyFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 5,
  },

  centsText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 7,
  },

  metricsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18,
  },

  metricCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.6,
    color: MUTED,
  },

  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginTop: 3,
  },

  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 18,
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

  // ============================================================
  // RESULTS
  // ============================================================

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
    marginBottom: 12,
  },

  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  comparisonSide: {
    flex: 1,
  },

  detectedComparison: {
    alignItems: 'flex-end',
  },

  comparisonLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.7,
    color: MUTED,
  },

  comparisonNote: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    color: BROWN,
    marginTop: 2,
  },

  comparisonFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 1,
  },

  resultsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },

  feedbackCard: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
    marginBottom: 18,
  },

  feedbackContent: {
    flex: 1,
    marginLeft: 10,
  },

  feedbackTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },

  feedbackText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginTop: 4,
  },
});