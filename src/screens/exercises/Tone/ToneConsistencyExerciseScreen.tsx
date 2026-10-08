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
  TONE_CONSISTENCY_PARAMS,
  type ToneConsistencyParams,
} from '@/constants/exercises/tone';

import type { Tier } from '@/constants/exercises/pitch';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import {
  measureToneConsistency,
} from '@/services/measurement/tone/toneConsistencyExercise';

import {
  scoreToneConsistencyExercise,
} from '@/services/scoring/tone/toneConsistencyExercise';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  generateToneConsistencyParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import { auth } from '@/services/firebase/config';

import {
  samplesToFFTFrames,
} from '@/utils/dsp/fft';

import {
  disposeNotePlayer,
  playSingleNote,
} from '@/utils/music/notePlayer';

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
const BORDER = '#F2DDE5';

// ============================================================
// EXERCISE CONFIG
// ============================================================

const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;

const COUNTDOWN_SECONDS = 3;
const TARGET_NOTE_DURATION_SECONDS = 1.5;

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

type LiveToneState = {
  pitch: number;
  note: string;
  clarity: number;
  volume: number;
};

type ResultState = {
  score: number;
  passed: boolean;
  averageCentroidHz: number;
  averageAmplitude: number;
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

export default function ToneConsistencyExerciseScreen({
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

  const [params, setParams] =
    useState<ToneConsistencyParams>(
      TONE_CONSISTENCY_PARAMS[
        tier ?? 'beginner'
      ],
    );

  const [
    isLoadingAdaptiveParams,
    setIsLoadingAdaptiveParams,
  ] = useState(true);

  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  const [countdown, setCountdown] =
    useState(
      COUNTDOWN_SECONDS,
    );

  const [elapsedSeconds, setElapsedSeconds] =
    useState(0);

  const [listenElapsedSeconds, setListenElapsedSeconds] =
    useState(0);

  const [currentRep, setCurrentRep] =
    useState(1);

  const [liveTone, setLiveTone] =
    useState<LiveToneState>({
      pitch: 0,
      note: '--',
      clarity: 0,
      volume: -100,
    });

  const [result, setResult] =
    useState<ResultState | null>(
      null,
    );

  const [errorMessage, setErrorMessage] =
    useState('');

  // ==========================================================
  // TARGET NOTE
  // ==========================================================

  const generatedTarget = useMemo(
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

  /*
   * The generated target is shown on the instruction screen.
   * Once the exercise starts, the target is locked so every
   * repetition uses exactly the same note and frequency.
   */
  const lockedTargetRef =
    useRef<typeof generatedTarget | null>(
      null,
    );

  const activeTarget =
    lockedTargetRef.current ??
    generatedTarget;

  const targetFrequency =
    activeTarget.frequency;

  const targetNote =
    activeTarget.name;

  // ==========================================================
  // REFS
  // ==========================================================

  const mountedRef =
    useRef(true);

  const exitingRef =
    useRef(false);

  const startingRef =
    useRef(false);

  const finishingRef =
    useRef(false);

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

  const listeningTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const repetitionSamplesRef =
    useRef<Float32Array[]>([]);

  const repetitionFFTFramesRef =
    useRef<Float32Array[][]>([]);

  const startRecordingRef =
    useRef<
      (() => Promise<void>) | null
    >(null);

  const stopRecordingRef =
    useRef<
      (() => void) | null
    >(null);

  const isRecordingRef =
    useRef(false);

  // ==========================================================
  // ADAPTIVE DIFFICULTY
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParameters() {
      setIsLoadingAdaptiveParams(true);

      try {
        const user =
          auth.currentUser;

        let resolvedTier: Tier =
          tier ?? 'beginner';

        if (!tier && user) {
          const progress =
            await fetchComponentProgress(
              user.uid,
              'tone',
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

        if (user) {
          const records =
            await fetchExerciseRecords(
              user.uid,
              'tone',
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
                    'toneConsistencyExercise',
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

          const assessment =
            await getLatestAssessment();

          if (assessment) {
            setVocalRange(
              assessment.vocalRange ??
                null,
            );
          }

          if (
            recentScores.length ===
            0
          ) {
            const assessmentScore =
              assessment?.scores.find(
                score =>
                  score.componentId ===
                  'tone',
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
          generateToneConsistencyParams(
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
          '❌ TONE CONSISTENCY ADS ERROR:',
          error,
        );

        const fallbackTier =
          tier ?? 'beginner';

        if (!cancelled) {
          setCurrentTier(
            fallbackTier,
          );

          setParams(
            TONE_CONSISTENCY_PARAMS[
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

      if (
        listeningTimerRef.current
      ) {
        clearInterval(
          listeningTimerRef.current,
        );

        listeningTimerRef.current =
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
          !mountedRef.current ||
          exitingRef.current
        ) {
          return;
        }

        setLiveTone({
          pitch:
            Number.isFinite(
              frame.pitch,
            ) &&
            frame.pitch > 0
              ? frame.pitch
              : 0,
          note:
            frame.note || '--',
          clarity:
            frame.clarity,
          volume:
            frame.volume,
        });
      },
      [],
    );

  // ============================================================
  // LISTEN TO TARGET NOTE
  // ============================================================

  const listenToTargetNote =
    useCallback(async () => {
      if (
        !mountedRef.current ||
        exitingRef.current
      ) {
        return false;
      }

      clearTimers();

      setListenElapsedSeconds(
        0,
      );

      setScreen('listening');

      const startTime =
        Date.now();

      listeningTimerRef.current =
        setInterval(() => {
          if (
            !mountedRef.current ||
            exitingRef.current
          ) {
            return;
          }

          const elapsed =
            (Date.now() -
              startTime) /
            1000;

          setListenElapsedSeconds(
            Math.min(
              elapsed,
              TARGET_NOTE_DURATION_SECONDS,
            ),
          );
        }, 50);

      try {
        /*
         * Read the locked target at playback time so a
         * rerender cannot change the note during the run.
         */
        const targetToPlay =
          lockedTargetRef.current ??
          generatedTarget;

        await playSingleNote(
          targetToPlay.frequency,
          TARGET_NOTE_DURATION_SECONDS,
        );
      } catch (error) {
        console.error(
          '❌ FAILED TO PLAY TARGET NOTE:',
          error,
        );

        clearTimers();

        if (
          mountedRef.current &&
          !exitingRef.current
        ) {
          setErrorMessage(
            'We could not play the reference note. Please try again.',
          );

          setScreen(
            'instructions',
          );
        }

        return false;
      }

      clearTimers();

      if (
        !mountedRef.current ||
        exitingRef.current
      ) {
        return false;
      }

      setListenElapsedSeconds(
        TARGET_NOTE_DURATION_SECONDS,
      );

      return true;
    }, [
      clearTimers,
      generatedTarget,
    ]);

  // ============================================================
  // START A RECORDING REPETITION
  // ============================================================

  const startRecordingAttempt =
    useCallback(async () => {
      if (
        !mountedRef.current ||
        exitingRef.current ||
        !startRecordingRef.current ||
        isRecordingRef.current
      ) {
        return;
      }

      clearTimers();

      setLiveTone({
        pitch: 0,
        note: '--',
        clarity: 0,
        volume: -100,
      });

      setElapsedSeconds(0);
      setScreen('recording');

      try {
        await startRecordingRef.current();

        if (
          !mountedRef.current ||
          exitingRef.current
        ) {
          return;
        }

        isRecordingRef.current =
          true;
      } catch (error) {
        console.error(
          '❌ FAILED TO START RECORDING:',
          error,
        );

        isRecordingRef.current =
          false;

        if (
          mountedRef.current &&
          !exitingRef.current
        ) {
          setErrorMessage(
            'We could not start the exercise. Please check your microphone permission and try again.',
          );

          setScreen(
            'instructions',
          );
        }

        startingRef.current =
          false;

        return;
      }

      const startTime =
        Date.now();

      recordingTimerRef.current =
        setInterval(() => {
          if (
            !mountedRef.current ||
            exitingRef.current
          ) {
            return;
          }

          const elapsed =
            (Date.now() -
              startTime) /
            1000;

          setElapsedSeconds(
            Math.min(
              elapsed,
              params.intervalSec,
            ),
          );

          if (
            elapsed >=
            params.intervalSec
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
        }, 50);
    }, [
      clearTimers,
      params.intervalSec,
    ]);

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

          isRecordingRef.current =
            false;

          if (
            !mountedRef.current ||
            exitingRef.current
          ) {
            return;
          }

          try {
            if (
              samples.length ===
                0 ||
              sampleRate <= 0
            ) {
              throw new Error(
                'No usable recording data was captured.',
              );
            }

            const fftFrames =
              samplesToFFTFrames(
                samples,
                FFT_SIZE,
                FFT_HOP_SIZE,
              );

            repetitionSamplesRef.current.push(
              samples,
            );

            repetitionFFTFramesRef.current.push(
              fftFrames,
            );

            const isLastRepetition =
              currentRepRef.current >=
              params.repetitions;

            // ==================================================
            // NON-FINAL REPETITION
            // Recording → Listening → Recording
            // ==================================================

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
              setListenElapsedSeconds(
                0,
              );

              setLiveTone({
                pitch: 0,
                note: '--',
                clarity: 0,
                volume: -100,
              });

              const played =
                await listenToTargetNote();

              if (
                !played ||
                !mountedRef.current ||
                exitingRef.current
              ) {
                return;
              }

              await startRecordingAttempt();

              return;
            }

            // ==================================================
            // FINAL REPETITION
            // Recording → Processing → Results
            // ==================================================

            setScreen(
              'processing',
            );

            const measurement =
              measureToneConsistency(
                repetitionSamplesRef.current,
                repetitionFFTFramesRef.current,
                sampleRate,
                FFT_SIZE,
              );

            const scored =
              scoreToneConsistencyExercise(
                measurement,
                params,
              );

            const validCentroids =
              measurement.centroids.filter(
                centroid =>
                  Number.isFinite(
                    centroid,
                  ) &&
                  centroid > 0,
              );

            const averageCentroid =
              validCentroids.length >
              0
                ? validCentroids.reduce(
                    (
                      sum,
                      centroid,
                    ) =>
                      sum + centroid,
                    0,
                  ) /
                  validCentroids.length
                : 0;

            const validAmplitudes =
              measurement.amplitudes.filter(
                amplitude =>
                  Number.isFinite(
                    amplitude,
                  ),
              );

            const averageAmplitudeValue =
              validAmplitudes.length >
              0
                ? validAmplitudes.reduce(
                    (
                      sum,
                      amplitude,
                    ) =>
                      sum + amplitude,
                    0,
                  ) /
                  validAmplitudes.length
                : 0;

            await saveCompletedExercise(
              'tone',
              'toneConsistencyExercise',
              currentTier,
              scored.score,
            );

            if (
              !mountedRef.current ||
              exitingRef.current
            ) {
              return;
            }

            setResult({
              score: scored.score,
              passed: scored.passed,
              averageCentroidHz:
                averageCentroid,
              averageAmplitude:
                averageAmplitudeValue,
            });

            setScreen(
              'results',
            );
          } catch (error) {
            console.error(
              '❌ TONE CONSISTENCY ANALYSIS ERROR:',
              error,
            );

            if (
              mountedRef.current &&
              !exitingRef.current
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

  stopRecordingRef.current =
    stopRecording;

  startRecordingRef.current =
    startRecording;

  // ============================================================
  // UNMOUNT CLEANUP
  // ============================================================

  useEffect(() => {
    mountedRef.current = true;
    exitingRef.current = false;

    return () => {
      mountedRef.current =
        false;

      clearTimers();

      if (
        isRecordingRef.current
      ) {
        stopRecordingRef.current?.();
      }

      isRecordingRef.current =
        false;

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
        isLoadingAdaptiveParams ||
        !mountedRef.current
      ) {
        return;
      }

      startingRef.current =
        true;

      exitingRef.current =
        false;

      finishingRef.current =
        false;

      /*
       * Lock the generated target for this entire exercise run.
       */
      lockedTargetRef.current =
        generatedTarget;

      clearTimers();

      repetitionSamplesRef.current =
        [];

      repetitionFFTFramesRef.current =
        [];

      currentRepRef.current =
        1;

      setCurrentRep(1);

      setErrorMessage('');
      setResult(null);

      setLiveTone({
        pitch: 0,
        note: '--',
        clarity: 0,
        volume: -100,
      });

      setElapsedSeconds(0);
      setListenElapsedSeconds(0);

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
          if (
            !mountedRef.current ||
            exitingRef.current
          ) {
            return;
          }

          remaining -= 1;

          if (remaining > 0) {
            setCountdown(
              remaining,
            );

            return;
          }

          clearTimers();

          setCountdown(0);

          listenToTargetNote()
            .then(
              async played => {
                if (
                  !played ||
                  !mountedRef.current ||
                  exitingRef.current
                ) {
                  startingRef.current =
                    false;

                  return;
                }

                await startRecordingAttempt();
              },
            )
            .catch(error => {
              console.error(
                '❌ FAILED TO START TONE CONSISTENCY:',
                error,
              );

              startingRef.current =
                false;

              if (
                mountedRef.current &&
                !exitingRef.current
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
      generatedTarget,
      isLoadingAdaptiveParams,
      listenToTargetNote,
      startRecordingAttempt,
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

      disposeNotePlayer().catch(
        error => {
          console.warn(
            '⚠️ Failed to stop note player:',
            error,
          );
        },
      );

      startingRef.current =
        false;

      finishingRef.current =
        false;

      exitingRef.current =
        false;

      isRecordingRef.current =
        false;

      lockedTargetRef.current =
        null;

      repetitionSamplesRef.current =
        [];

      repetitionFFTFramesRef.current =
        [];

      currentRepRef.current =
        1;

      setCurrentRep(1);

      setResult(null);
      setErrorMessage('');

      setElapsedSeconds(0);
      setListenElapsedSeconds(0);

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setLiveTone({
        pitch: 0,
        note: '--',
        clarity: 0,
        volume: -100,
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
      exitingRef.current =
        true;

      clearTimers();

      disposeNotePlayer().catch(
        error => {
          console.warn(
            '⚠️ Failed to stop note player:',
            error,
          );
        },
      );

      if (
        isRecordingRef.current
      ) {
        stopRecordingRef.current?.();
      }

      isRecordingRef.current =
        false;

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
        style={
          styles.centerScreen
        }
      >
        <View
          style={
            styles.iconCircle
          }
        >
          <Ionicons
            name="musical-note-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={
            styles.phaseTitle
          }
        >
          Preparing Exercise
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
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
  // INSTRUCTIONS
  // ============================================================

  if (
    screen === 'instructions'
  ) {
    return (
      <ExerciseScreen
        title="Tone Consistency Exercise"
        category="Tone"
        icon="musical-note-outline"
        instructions={
          'Listen carefully to the target note first.\n\n' +
          'After the reference note finishes, sing the same note back.\n\n' +
          'Repeat the exercise while keeping your tone and vocal output as consistent as possible.'
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
              params.repetitions,
            ),
          },
          {
            label: 'Sing Duration',
            value: `${params.intervalSec}s`,
          },
        ]}
        tip={
          'Listen to the reference note before every repetition and use the same target note each time.'
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
  // COUNTDOWN
  // ============================================================

  if (
    screen === 'countdown'
  ) {
    return (
      <ExerciseCountdownScreen
        icon="musical-notes-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={params.repetitions}
        countdown={countdown}
        promptTitle="Your target note is"
        prompt={`${targetNote} • ${formatFrequency(
          targetFrequency,
        )}`}
      />
    );
  }

  // ============================================================
  // LISTENING
  // ============================================================

  if (
    screen === 'listening'
  ) {
    const listenProgress =
      clamp(
        listenElapsedSeconds /
          TARGET_NOTE_DURATION_SECONDS,
        0,
        1,
      ) * 100;

    return (
      <ExerciseListeningScreen
        icon="volume-high-outline"
        title="Listen to the Note"
        currentRep={currentRep}
        repetitions={params.repetitions}
        elapsed={
          listenElapsedSeconds
        }
        targetDuration={
          TARGET_NOTE_DURATION_SECONDS
        }
        promptTitle="Listen to the reference note"
        prompt={
          'Listen carefully. After the note finishes, sing the same note.'
        }
        liveContent={
          <View
            style={
              styles.sharedListenNoteBox
            }
          >
            <Text
              style={
                styles.listenLabel
              }
            >
              TARGET NOTE
            </Text>

            <Text
              style={
                styles.largeNote
              }
            >
              {targetNote}
            </Text>

            <Text
              style={
                styles.stateFrequency
              }
            >
              {formatFrequency(
                targetFrequency,
              )}
            </Text>
          </View>
        }
        progress={
          listenProgress
        }
      />
    );
  }

  // ============================================================
  // RECORDING
  // ============================================================

  if (
    screen === 'recording'
  ) {
    const progress =
      clamp(
        elapsedSeconds /
          params.intervalSec,
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
            {params.repetitions}
          </Text>

          <View
            style={
              styles.smallTargetCard
            }
          >
            <View>
              <Text
                style={
                  styles.smallLabel
                }
              >
                TARGET
              </Text>

              <Text
                style={
                  styles.smallNote
                }
              >
                {targetNote}
              </Text>
            </View>

            <Text
              style={
                styles.smallHz
              }
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
            style={
              styles.detectedArea
            }
          >
            <Text
              style={
                styles.detectedLabel
              }
            >
              CURRENT NOTE
            </Text>

            <Text
              style={
                styles.detectedNote
              }
            >
              {liveTone.note}
            </Text>

            <Text
              style={
                styles.detectedFrequency
              }
            >
              {formatFrequency(
                liveTone.pitch,
              )}
            </Text>

            <Text
              style={
                styles.pitchMessage
              }
            >
              {liveTone.pitch > 0
                ? 'Keep the tone steady'
                : 'Listening...'}
            </Text>
          </View>

          <View
            style={
              styles.metricsGrid
            }
          >
            <MetricCard
              label="PITCH"
              value={
                liveTone.pitch > 0
                  ? formatFrequency(
                      liveTone.pitch,
                    )
                  : '--'
              }
            />

            <MetricCard
              label="CLARITY"
              value={
                liveTone.clarity > 0
                  ? `${Math.round(
                      liveTone.clarity *
                        100,
                    )}%`
                  : '--'
              }
            />

            <MetricCard
              label="VOLUME"
              value={formatVolume(
                liveTone.volume,
              )}
            />

            <MetricCard
              label="REP"
              value={`${currentRep}/${params.repetitions}`}
            />
          </View>

          <Text
            style={styles.timerText}
          >
            {elapsedSeconds.toFixed(
              1,
            )}{' '}
            /{' '}
            {params.intervalSec.toFixed(
              1,
            )}
            s
          </Text>

          <View
            style={
              styles.timerTrack
            }
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
            style={
              styles.finishButton
            }
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
  // PROCESSING
  // ============================================================

  if (
    screen === 'processing'
  ) {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your Singing"
        message={
          'Comparing your repetitions for tone and vocal consistency.'
        }
      />
    );
  }

  // ============================================================
  // RESULTS
  // ============================================================

  if (
    screen === 'results' &&
    result
  ) {
    return (
      <ExerciseResultsScreen
        title={
          result.passed
            ? 'Great Job!'
            : 'Keep Practicing!'
        }
        subtitle={`Tone Consistency Result • ${params.repetitions} repetitions`}
        score={result.score}
        resultIcon={
          result.passed
            ? 'checkmark'
            : 'refresh'
        }
        scoreMessage={
          result.passed
            ? 'Your tone and vocal output stayed consistent across the repetitions.'
            : 'Keep practicing the same target note with a steady and consistent tone.'
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
            Tone Consistency
          </Text>

          <View
            style={
              styles.resultTarget
            }
          >
            <Text
              style={
                styles.resultTargetLabel
              }
            >
              TARGET NOTE
            </Text>

            <Text
              style={
                styles.resultTargetNote
              }
            >
              {targetNote}
            </Text>

            <Text
              style={
                styles.resultTargetFrequency
              }
            >
              {formatFrequency(
                targetFrequency,
              )}
            </Text>
          </View>
        </View>

        <View
          style={styles.resultsGrid}
        >
          <MetricCard
            label="OVERALL SCORE"
            value={`${result.score}%`}
          />

          <MetricCard
            label="AVG. CENTROID"
            value={
              result.averageCentroidHz >
              0
                ? `${Math.round(
                    result.averageCentroidHz,
                  )} Hz`
                : '--'
            }
          />

          <MetricCard
            label="AVG. AMPLITUDE"
            value={
              result.averageAmplitude >
              0
                ? result.averageAmplitude.toFixed(
                    3,
                  )
                : '--'
            }
          />

          <MetricCard
            label="REPETITIONS"
            value={String(
              params.repetitions,
            )}
          />
        </View>

        <View
          style={
            styles.feedbackCard
          }
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
              {result.passed
                ? `Excellent consistency! Your voice maintained a stable tone while repeating ${targetNote}. Keep practicing with the same controlled vocal output.`
                : `Your tone varied between repetitions. Listen carefully to the reference note before each attempt and focus on maintaining the same vocal quality throughout ${targetNote}.`}
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
    <View
      style={styles.metricCard}
    >
      <Text
        style={
          styles.metricLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.metricValue
        }
      >
        {value}
      </Text>
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
    borderColor: BORDER,
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
    borderColor: BORDER,
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

  // ==========================================================
  // RESULTS
  // ==========================================================

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
    marginBottom: 12,
  },

  resultTarget: {
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 18,
    paddingVertical: 18,
  },

  resultTargetLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.7,
  },

  resultTargetNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    marginTop: 4,
  },

  resultTargetFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
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