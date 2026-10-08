// src/screens/exercises/Tone/WaveformSmoothnessDrillScreen.tsx

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
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  type Tier,
  WAVEFORM_SMOOTHNESS_PARAMS,
  type WaveformSmoothnessParams,
} from '@/constants/exercises/tone';

import {
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  generateWaveformSmoothnessParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  disposeNotePlayer,
  playSingleNote,
} from '@/utils/music/notePlayer';

import {
  measureWaveformSmoothness,
  type WaveformSmoothnessMeasurement,
} from '@/services/measurement/tone/waveformSmoothnessDrill';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  scoreWaveformSmoothnessDrill,
  type WaveformSmoothnessScoreResult,
} from '@/services/scoring/tone/waveformSmoothnessDrill';

import { auth } from '@/services/firebase/config';

import {
  samplesToFFTFrames,
} from '@/utils/dsp/fft';

import {
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
} from '@/screens/exercises/ExerciseScreen';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;
const COUNTDOWN_SECONDS = 3;
const REFERENCE_NOTE_DURATION_SECONDS = 1.5;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'results';

interface RepetitionResult {
  targetNote: string;
  measurement: WaveformSmoothnessMeasurement;
  score: WaveformSmoothnessScoreResult;
}

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

function formatNumber(
  value: number,
  decimals = 1,
): string {
  return Number.isFinite(value)
    ? value.toFixed(decimals)
    : '--';
}

export default function WaveformSmoothnessDrillScreen({
  tier,
}: Props) {
  const initialTier = tier ?? 'beginner';

  const [currentTier, setCurrentTier] =
    useState<Tier>(initialTier);

  const [params, setParams] =
    useState<WaveformSmoothnessParams>(
      WAVEFORM_SMOOTHNESS_PARAMS[
        initialTier
      ],
    );

  const [loadingParams, setLoadingParams] =
    useState(true);

  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);

  const [currentRep, setCurrentRep] =
    useState(1);

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [repetitionResults, setRepetitionResults] =
    useState<RepetitionResult[]>([]);

  const [finalResult, setFinalResult] =
    useState<WaveformSmoothnessScoreResult | null>(
      null,
    );

  const [averageCentroidSmoothness, setAverageCentroidSmoothness] =
    useState(0);

  const [averageAmplitudeStability, setAverageAmplitudeStability] =
    useState(0);

  const [averageCentroid, setAverageCentroid] =
    useState(0);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const mountedRef =
    useRef(true);

  const leavingRef =
    useRef(false);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

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

  const resultsRef =
    useRef<RepetitionResult[]>([]);

  /*
   * ----------------------------------------------------------
   * TARGET NOTES
   * ----------------------------------------------------------
   *
   * One reference note is generated for every repetition.
   * getRandomPitchNote uses the current tier and the user's
   * detected vocal range when one is available.
   */

  const targetNote = useMemo(
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

const targetNoteRef =
  useRef<ReturnType<typeof getRandomPitchNote> | null>(
    null,
  );

useEffect(() => {
  targetNoteRef.current =
    targetNote;
}, [targetNote]);

const currentTarget =
  targetNote;

  /*
   * ----------------------------------------------------------
   * LOAD ADAPTIVE PARAMETERS + VOCAL RANGE
   * ----------------------------------------------------------
   */

  useEffect(() => {
    let cancelled = false;

    const loadExerciseData =
      async () => {
        const user =
          auth.currentUser;

        if (!user) {
          if (!cancelled) {
            const fallbackTier =
              tier ?? 'beginner';

            setCurrentTier(
              fallbackTier,
            );

            setParams(
              WAVEFORM_SMOOTHNESS_PARAMS[
                fallbackTier
              ],
            );

            setLoadingParams(false);
          }

          return;
        }

        try {
          setLoadingParams(true);

          /*
           * The vocal range is independent of ADS history.
           * Always retrieve the latest assessment so target
           * notes can be constrained to the user's range.
           */
          const assessment =
            await getLatestAssessment();

          if (!cancelled) {
            setVocalRange(
              assessment?.vocalRange ?? null,
            );
          }

          /*
           * Resolve the current Tone tier.
           */
          const componentProgress =
            await fetchComponentProgress(
              user.uid,
              'tone',
            );

          const resolvedTier =
            tier ??
            componentProgress?.currentTier ??
            'beginner';

          /*
           * Get completed exercise history.
           */
          const records =
            await fetchExerciseRecords(
              user.uid,
              'tone',
            );

          const currentTierRecords =
            records
              .filter(
                record =>
                  record.tier ===
                    resolvedTier &&
                  record.templateId ===
                    'waveformSmoothnessDrill',
              )
              .sort(
                (a, b) =>
                  a.timestamp -
                  b.timestamp,
              );

          /*
           * Continuous ADS history uses only the latest
           * five completed exercises from this tier/template.
           */
          const recentScores =
            currentTierRecords
              .slice(-5)
              .map(record =>
                Number(
                  record.scorePct,
                ),
              )
              .filter(score =>
                Number.isFinite(score),
              );

          /*
           * Assessment score is only used as the cold-start
           * reference when no current-tier exercise history
           * exists.
           */
          let referenceScores =
            recentScores;

          if (
            referenceScores.length ===
            0
          ) {
            const toneAssessmentScore =
              assessment?.scores.find(
                score =>
                  score.componentId ===
                  'tone',
              )?.scorePct;

            if (
              Number.isFinite(
                toneAssessmentScore,
              )
            ) {
              referenceScores = [
                Number(
                  toneAssessmentScore,
                ),
              ];
            }
          }

          const generatedParams =
            generateWaveformSmoothnessParams(
              {
                tier:
                  resolvedTier,

                recentScores:
                  referenceScores,
              },
            );

          if (cancelled) {
            return;
          }

          setCurrentTier(
            resolvedTier,
          );

          setParams(
            generatedParams,
          );
        } catch (error) {
          console.error(
            '❌ FAILED TO LOAD WAVEFORM SMOOTHNESS DATA:',
            error,
          );

          if (!cancelled) {
            const fallbackTier =
              tier ?? 'beginner';

            setCurrentTier(
              fallbackTier,
            );

            setParams(
              WAVEFORM_SMOOTHNESS_PARAMS[
                fallbackTier
              ],
            );
          }
        } finally {
          if (!cancelled) {
            setLoadingParams(false);
          }
        }
      };

    void loadExerciseData();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  /*
   * ----------------------------------------------------------
   * CLEANUP
   * ----------------------------------------------------------
   */

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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      leavingRef.current = true;

      clearTimers();

      recordingRef.current = false;
      stopRequestedRef.current = true;

      disposeNotePlayer();
    };
  }, [clearTimers]);

  /*
   * ----------------------------------------------------------
   * LIVE AUDIO
   * ----------------------------------------------------------
   */

  const handleLiveFrame =
    useCallback(
      (frame: LiveAudioFrame) => {
        if (
          !mountedRef.current ||
          leavingRef.current
        ) {
          return;
        }

        setLiveFrame(frame);
      },
      [],
    );

  /*
   * ----------------------------------------------------------
   * RECORDER
   * ----------------------------------------------------------
   */

  const handleRecordingStop =
    useCallback(
      async (
        samples: Float32Array,
        sampleRate: number,
      ) => {
        if (
          !mountedRef.current ||
          leavingRef.current ||
          processingRef.current
        ) {
          return;
        }

        processingRef.current =
          true;

        recordingRef.current =
          false;

        stopRequestedRef.current =
          false;

        clearTimers();

        setElapsedMs(0);
        elapsedRef.current = 0;
        setLiveFrame(null);

        setPhase('processing');

        try {
          if (samples.length === 0) {
            throw new Error(
              'No audio samples were recorded.',
            );
          }

          const fftFrames =
            samplesToFFTFrames(
              samples,
              FFT_SIZE,
              FFT_HOP_SIZE,
            );

          if (fftFrames.length === 0) {
            throw new Error(
              'No FFT frames could be generated.',
            );
          }

          const measurement =
            measureWaveformSmoothness(
              samples,
              fftFrames,
              sampleRate,
              FFT_SIZE,
            );

          const scored =
            scoreWaveformSmoothnessDrill(
              measurement,
              params,
            );

          const repIndex =
            currentRepRef.current - 1;

          const target =
            targetNoteRef.current;

          const nextResult: RepetitionResult =
            {
              targetNote:
                target?.name ?? '--',

              measurement,

              score:
                scored,
            };

          const nextResults = [
            ...resultsRef.current,
            nextResult,
          ];

          resultsRef.current =
            nextResults;

          if (!mountedRef.current) {
            return;
          }

          setRepetitionResults(
            nextResults,
          );

          /*
           * Final repetition:
           * aggregate all repetition results.
           */
          if (
            currentRepRef.current >=
            params.repetitions
          ) {
            const totalScore =
              nextResults.reduce(
                (sum, item) =>
                  sum +
                  item.score.score,
                0,
              ) /
              nextResults.length;

            const allPassed =
              nextResults.every(
                item =>
                  item.score.passed,
              );

            const centroidSmoothness =
              nextResults.reduce(
                (sum, item) =>
                  sum +
                  item.measurement
                    .centroidSmoothnessPct,
                0,
              ) /
              nextResults.length;

            const amplitudeStability =
              nextResults.reduce(
                (sum, item) =>
                  sum +
                  item.measurement
                    .amplitudeStabilityPct,
                0,
              ) /
              nextResults.length;

            const averageCentroidHz =
              nextResults.reduce(
                (sum, item) =>
                  sum +
                  item.measurement
                    .averageCentroidHz,
                0,
              ) /
              nextResults.length;

            const roundedScore =
              Math.round(
                clamp(
                  totalScore,
                  0,
                  100,
                ),
              );

            const aggregatedResult:
              WaveformSmoothnessScoreResult =
              {
                score:
                  roundedScore,

                passed:
                  allPassed,
              };

            setAverageCentroidSmoothness(
              centroidSmoothness,
            );

            setAverageAmplitudeStability(
              amplitudeStability,
            );

            setAverageCentroid(
              averageCentroidHz,
            );

            setFinalResult(
              aggregatedResult,
            );

            await saveCompletedExercise(
              'tone',
              'waveformSmoothnessDrill',
              currentTier,
              roundedScore,
            );

            if (
              !mountedRef.current ||
              leavingRef.current
            ) {
              return;
            }

            processingRef.current =
              false;

            setPhase('results');

            return;
          }

          /*
           * More repetitions remain.
           */
          const nextRep =
            currentRepRef.current + 1;

          currentRepRef.current =
            nextRep;

          setCurrentRep(
            nextRep,
          );

          processingRef.current =
            false;

          setCountdown(
            COUNTDOWN_SECONDS,
          );

          setPhase('countdown');
        } catch (error) {
          console.error(
            '❌ WAVEFORM SMOOTHNESS PROCESSING ERROR:',
            error,
          );

          processingRef.current =
            false;

          if (
            mountedRef.current &&
            !leavingRef.current
          ) {
            setErrorMessage(
              'We could not analyze your recording. Please try again.',
            );

            setPhase(
              'instructions',
            );
          }
        }
      },
      [
        clearTimers,
        currentTier,
        params,
      ],
    );

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame:
      handleLiveFrame,

    onStop:
      handleRecordingStop,
  });

  /*
   * ----------------------------------------------------------
   * RECORDING
   * ----------------------------------------------------------
   */

  const beginRecording =
    useCallback(
      async () => {
        if (
          !mountedRef.current ||
          leavingRef.current ||
          recordingRef.current ||
          processingRef.current
        ) {
          return;
        }

        try {
          setErrorMessage(null);

          setLiveFrame(null);

          elapsedRef.current = 0;

          setElapsedMs(0);

          recordingRef.current =
            true;

          stopRequestedRef.current =
            false;

          setPhase('recording');

          await startRecording();

          if (
            !mountedRef.current ||
            leavingRef.current
          ) {
            return;
          }

          const durationMs =
            params.durationSec *
            1000;

          recordingTimerRef.current =
            setInterval(
              () => {
                if (
                  !mountedRef.current ||
                  leavingRef.current ||
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
                  clearTimers();

                  if (
                    stopRequestedRef.current
                  ) {
                    return;
                  }

                  stopRequestedRef.current =
                    true;

                  void stopRecording().catch(
                    error => {
                      console.error(
                        '❌ FAILED TO STOP WAVEFORM RECORDING:',
                        error,
                      );

                      recordingRef.current =
                        false;

                      stopRequestedRef.current =
                        false;

                      processingRef.current =
                        false;

                      if (
                        mountedRef.current &&
                        !leavingRef.current
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
              },
              100,
            );
        } catch (error) {
          console.error(
            '❌ FAILED TO START WAVEFORM RECORDING:',
            error,
          );

          recordingRef.current =
            false;

          stopRequestedRef.current =
            false;

          processingRef.current =
            false;

          if (
            mountedRef.current &&
            !leavingRef.current
          ) {
            setErrorMessage(
              'Unable to start the microphone. Please check your microphone permission and try again.',
            );

            setPhase(
              'instructions',
            );
          }
        }
      },
      [
        clearTimers,
        params.durationSec,
        startRecording,
        stopRecording,
      ],
    );

  /*
   * ----------------------------------------------------------
   * REFERENCE NOTE
   * ----------------------------------------------------------
   */

  const playCurrentReference =
    useCallback(
      async () => {
        const target =
          targetNoteRef.current;

        if (
          !target ||
          !mountedRef.current ||
          leavingRef.current
        ) {
          return;
        }

        try {
          setErrorMessage(null);

          setPhase('listening');

          await playSingleNote(
            target.frequency,
            REFERENCE_NOTE_DURATION_SECONDS,
          );

          if (
            !mountedRef.current ||
            leavingRef.current
          ) {
            return;
          }

          await beginRecording();
        } catch (error) {
          console.error(
            '❌ FAILED TO PLAY WAVEFORM REFERENCE NOTE:',
            error,
          );

          if (
            mountedRef.current &&
            !leavingRef.current
          ) {
            setErrorMessage(
              'We could not play the reference note. Please try again.',
            );

            setPhase(
              'instructions',
            );
          }
        }
      },
      [beginRecording],
    );

  /*
   * ----------------------------------------------------------
   * COUNTDOWN
   * ----------------------------------------------------------
   */

  useEffect(() => {
    if (
      phase !== 'countdown'
    ) {
      return;
    }

    let value =
      COUNTDOWN_SECONDS;

    setCountdown(value);

    if (
      countdownTimerRef.current
    ) {
      clearInterval(
        countdownTimerRef.current,
      );
    }

    countdownTimerRef.current =
      setInterval(
        () => {
          value -= 1;

          if (
            value <= 0
          ) {
            if (
              countdownTimerRef.current
            ) {
              clearInterval(
                countdownTimerRef.current,
              );

              countdownTimerRef.current =
                null;
            }

            void playCurrentReference();

            return;
          }

          if (
            mountedRef.current &&
            !leavingRef.current
          ) {
            setCountdown(
              value,
            );
          }
        },
        1000,
      );

    return () => {
      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current,
        );

        countdownTimerRef.current =
          null;
      }
    };
  }, [
    phase,
    playCurrentReference,
  ]);

  /*
   * ----------------------------------------------------------
   * START / RESET
   * ----------------------------------------------------------
   */

  const startExercise =
    useCallback(() => {
      if (
        loadingParams ||
        !targetNote
      ) {
        return;
      }

      resultsRef.current = [];

      setRepetitionResults([]);

      setFinalResult(null);

      setAverageCentroidSmoothness(0);

      setAverageAmplitudeStability(0);

      setAverageCentroid(0);

      setErrorMessage(null);

      currentRepRef.current = 1;

      setCurrentRep(1);

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setElapsedMs(0);

      setLiveFrame(null);

      processingRef.current =
        false;

      recordingRef.current =
        false;

      stopRequestedRef.current =
        false;

      setPhase('countdown');
    }, [
      loadingParams,
      targetNote,
    ]);

  const retryExercise =
    useCallback(() => {
      clearTimers();

      resultsRef.current = [];

      setRepetitionResults([]);

      setFinalResult(null);

      setAverageCentroidSmoothness(0);

      setAverageAmplitudeStability(0);

      setAverageCentroid(0);

      setErrorMessage(null);

      currentRepRef.current = 1;

      setCurrentRep(1);

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setElapsedMs(0);

      setLiveFrame(null);

      recordingRef.current =
        false;

      stopRequestedRef.current =
        false;

      processingRef.current =
        false;

      setPhase('countdown');
    }, [clearTimers]);

  const goBack =
    useCallback(() => {
      leavingRef.current = true;

      clearTimers();

      recordingRef.current =
        false;

      stopRequestedRef.current =
        true;

      disposeNotePlayer();

      router.back();
    }, [clearTimers]);

  /*
   * ----------------------------------------------------------
   * INSTRUCTIONS
   * ----------------------------------------------------------
   */

  if (phase === 'instructions') {
    return (
      <ExerciseScreen
        title="Waveform Smoothness"
        category="Tone"
        icon="pulse-outline"
        instructions="Sustain each assigned note with a smooth, steady tone and consistent vocal output."
        preparationSteps={[
          {
            icon: 'volume-mute-outline',
            text: 'Find a quiet room or area with minimal background noise.',
          },
          {
            icon: 'body-outline',
            text: 'Sit upright or stand comfortably with your shoulders relaxed.',
          },
          {
            icon: 'mic-outline',
            text: 'Keep a comfortable distance from the microphone.',
          },
          {
            icon: 'musical-note-outline',
            text: 'Listen to each reference note, then sustain the same note steadily.',
          },
        ]}
        summary={[
          {
            label: 'Difficulty',
            value:
              currentTier
                .charAt(0)
                .toUpperCase() +
              currentTier.slice(1),
          },
          {
            label: 'Hold Duration',
            value: `${params.durationSec} sec`,
          },
          {
            label: 'Repetitions',
            value: `${params.repetitions}`,
          },
          {
            label: 'Smoothness Target',
            value: `${params.smoothnessThreshold}%`,
          },
        ]}
        tip="Focus on keeping your tone smooth and your vocal output steady rather than changing your pitch."
        tier={currentTier}
        onBack={goBack}
        onStart={startExercise}
        startDisabled={
          loadingParams ||
          !targetNote
        }
        startLabel={
          loadingParams
            ? 'Loading...'
            : 'Start Exercise'
        }
        error={errorMessage}
      />
    );
  }

  /*
   * ----------------------------------------------------------
   * COUNTDOWN
   * ----------------------------------------------------------
   */

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="pulse-outline"
        title="Waveform Smoothness"
        currentRep={currentRep}
        repetitions={
          params.repetitions
        }
        countdown={countdown}
        promptTitle="Get Ready"
        prompt={
          currentTarget
            ? `Prepare to sing ${currentTarget.name}.`
            : 'Prepare to sing the assigned note.'
        }
        onBack={goBack}
      />
    );
  }

  /*
   * ----------------------------------------------------------
   * LISTENING
   * ----------------------------------------------------------
   */

  if (phase === 'listening') {
    return (
      <ExerciseListeningScreen
        icon="musical-note-outline"
        title="Waveform Smoothness"
        currentRep={currentRep}
        repetitions={
          params.repetitions
        }
        promptTitle="Listen to the Reference"
        prompt="Listen carefully to the note, then sustain the same note smoothly."
        liveContent={
          <View
            style={
              styles.referenceCard
            }
          >
            <Text
              style={
                styles.referenceLabel
              }
            >
              SING THIS NOTE
            </Text>

            <Text
              style={
                styles.referenceNote
              }
            >
              {currentTarget?.name ??
                '--'}
            </Text>

            <Text
              style={
                styles.referenceFrequency
              }
            >
              {currentTarget
                ? `${formatNumber(
                    currentTarget.frequency,
                    1,
                  )} Hz`
                : '--'}
            </Text>
          </View>
        }
        onBack={goBack}
      />
    );
  }

  /*
   * ----------------------------------------------------------
   * RECORDING
   * ----------------------------------------------------------
   */

  if (phase === 'recording') {
    const elapsedSeconds =
      elapsedMs / 1000;

    const progress =
      params.durationSec > 0
        ? clamp(
            elapsedSeconds /
              params.durationSec,
            0,
            1,
          )
        : 0;

    const detectedNote =
      liveFrame &&
      Number.isFinite(
        liveFrame.pitch,
      ) &&
      liveFrame.pitch > 0
        ? frequencyToNote(
            liveFrame.pitch,
          )
        : '--';

    return (
      <ExerciseListeningScreen
        icon="pulse-outline"
        title="Waveform Smoothness"
        currentRep={currentRep}
        repetitions={
          params.repetitions
        }
        elapsed={elapsedSeconds}
        targetDuration={
          params.durationSec
        }
        promptTitle="Sustain Smoothly"
        prompt={`Hold ${currentTarget?.name ?? 'the assigned note'} with a steady, consistent tone.`}
        progress={progress}
        liveContent={
          <View
            style={
              styles.liveCard
            }
          >
            <View
              style={
                styles.liveMetric
              }
            >
              <Text
                style={
                  styles.liveLabel
                }
              >
                TARGET
              </Text>

              <Text
                style={
                  styles.liveValue
                }
              >
                {currentTarget?.name ??
                  '--'}
              </Text>
            </View>

            <View
              style={
                styles.liveDivider
              }
            />

            <View
              style={
                styles.liveMetric
              }
            >
              <Text
                style={
                  styles.liveLabel
                }
              >
                DETECTED
              </Text>

              <Text
                style={
                  styles.liveValue
                }
              >
                {detectedNote}
              </Text>
            </View>
          </View>
        }
        onBack={goBack}
      />
    );
  }

  /*
   * ----------------------------------------------------------
   * PROCESSING
   * ----------------------------------------------------------
   */

  if (phase === 'processing') {
    const isFinalRep =
      currentRep >=
      params.repetitions;

    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title={
          isFinalRep
            ? 'Analyzing Your Results'
            : 'Analyzing Your Tone'
        }
        message={
          isFinalRep
            ? 'Calculating your overall waveform smoothness score.'
            : `Processing repetition ${currentRep}.`
        }
        onBack={goBack}
      />
    );
  }

  /*
   * ----------------------------------------------------------
   * RESULTS
   * ----------------------------------------------------------
   */

  const score =
    finalResult?.score ?? 0;

  const passed =
    finalResult?.passed ?? false;

  return (
    <ExerciseResultsScreen
      title="Exercise Complete"
      subtitle="Waveform Smoothness"
      score={score}
      resultIcon={
        passed
          ? 'checkmark'
          : 'refresh-outline'
      }
      scoreMessage={
        passed
          ? 'Excellent work! Your tone remained smooth and your vocal output stayed consistent across the repetitions.'
          : 'Keep practicing. Focus on maintaining an even tone and steady vocal output throughout each sustained note.'
      }
      scoreDetails={
        <View
          style={
            styles.scoreDetails
          }
        >
          <View
            style={
              styles.scoreMetric
            }
          >
            <Text
              style={
                styles.scoreMetricLabel
              }
            >
              Spectral Smoothness
            </Text>

            <Text
              style={
                styles.scoreMetricValue
              }
            >
              {formatNumber(
                averageCentroidSmoothness,
              )}
              %
            </Text>
          </View>

          <View
            style={
              styles.scoreMetric
            }
          >
            <Text
              style={
                styles.scoreMetricLabel
              }
            >
              Amplitude Stability
            </Text>

            <Text
              style={
                styles.scoreMetricValue
              }
            >
              {formatNumber(
                averageAmplitudeStability,
              )}
              %
            </Text>
          </View>

          <View
            style={
              styles.scoreMetric
            }
          >
            <Text
              style={
                styles.scoreMetricLabel
              }
            >
              Average Centroid
            </Text>

            <Text
              style={
                styles.scoreMetricValue
              }
            >
              {formatNumber(
                averageCentroid,
              )}{' '}
              Hz
            </Text>
          </View>
        </View>
      }
      onRetry={retryExercise}
      onExit={goBack}
    >
      <View
        style={
          styles.resultsSection
        }
      >
        <Text
          style={
            styles.resultsSectionTitle
          }
        >
          Repetition Results
        </Text>

        {repetitionResults.map(
          (item, index) => (
            <View
              key={`${item.targetNote}-${index}`}
              style={
                styles.repetitionCard
              }
            >
              <View
                style={
                  styles.repetitionHeader
                }
              >
                <Text
                  style={
                    styles.repetitionTitle
                  }
                >
                  Repetition {index + 1}
                </Text>

                <Text
                  style={
                    styles.repetitionScore
                  }
                >
                  {item.score.score}%
                </Text>
              </View>

              <View
                style={
                  styles.repetitionNoteRow
                }
              >
                <Ionicons
                  name="musical-note-outline"
                  size={18}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.repetitionNote
                  }
                >
                  {item.targetNote}
                </Text>
              </View>

              <View
                style={
                  styles.repetitionMetrics
                }
              >
                <Text
                  style={
                    styles.repetitionMetric
                  }
                >
                  Smoothness:{' '}
                  {formatNumber(
                    item.measurement
                      .centroidSmoothnessPct,
                  )}
                  %
                </Text>

                <Text
                  style={
                    styles.repetitionMetric
                  }
                >
                  Stability:{' '}
                  {formatNumber(
                    item.measurement
                      .amplitudeStabilityPct,
                  )}
                  %
                </Text>
              </View>
            </View>
          ),
        )}
      </View>
    </ExerciseResultsScreen>
  );
}

const styles = StyleSheet.create({
  referenceCard: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  referenceLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    letterSpacing: 1,
    color: MUTED,
    marginBottom: 6,
  },

  referenceNote: {
    fontFamily: 'FredokaBold',
    fontSize: 38,
    color: BROWN,
  },

  referenceFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    marginTop: 2,
  },

  liveCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  liveMetric: {
    flex: 1,
    alignItems: 'center',
  },

  liveDivider: {
    width: 1,
    height: 42,
    backgroundColor: BORDER,
  },

  liveLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: MUTED,
    marginBottom: 4,
  },

  liveValue: {
    fontFamily: 'FredokaBold',
    fontSize: 21,
    color: BROWN,
  },

  scoreDetails: {
    width: '100%',
    marginTop: 18,
    gap: 10,
  },

  scoreMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: LIGHT_PINK,
  },

  scoreMetricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
  },

  scoreMetricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  resultsSection: {
    marginTop: 18,
  },

  resultsSectionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginBottom: 10,
  },

  repetitionCard: {
    padding: 14,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  repetitionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  repetitionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  repetitionScore: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },

  repetitionNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },

  repetitionNote: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },

  repetitionMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },

  repetitionMetric: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },
});