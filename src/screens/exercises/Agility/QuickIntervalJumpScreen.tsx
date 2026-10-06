// src/screens/exercises/Agility/QuickIntervalJumpScreen.tsx

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  AudioContext,
  AudioManager,
  AudioRecorder,
} from 'react-native-audio-api';

import {
  QUICK_INTERVAL_JUMP_PARAMS,
  type Tier,
} from '@/constants/exercises/agility';

import { auth } from '@/services/firebase/config';

import { measureQuickIntervalJump } from '@/services/measurement/agility/quickIntervalJump';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { scoreQuickIntervalJump } from '@/services/scoring/agility/quickIntervalJump';

import { generateQuickIntervalJumpParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import { frequencyToNoteName } from '@/utils/music/notes';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

// ============================================================
// COLORS
// ============================================================

import ExerciseScreen from '@/screens/exercises/ExerciseScreen';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';


// ============================================================
// CONFIG
// ============================================================

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const MAX_RECORDING_SECONDS = 10;
const COUNTDOWN_SECONDS = 3;

// ============================================================
// TYPES
// ============================================================

type Phase =
  | 'instructions'
  | 'reference'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

// ============================================================
// HELPERS
// ============================================================

const sleep = (ms: number) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, ms),
  );

// ============================================================
// COMPONENT
// ============================================================

export default function QuickIntervalJumpScreen() {
  const [tier, setTier] =
    useState<Tier>('beginner');

  const [tierLoading, setTierLoading] =
    useState(true);
  // ----------------------------------------------------------
  // BASE CONFIG
  // ----------------------------------------------------------

  const baseConfig =
    QUICK_INTERVAL_JUMP_PARAMS[tier];

  // ----------------------------------------------------------
  // ADAPTIVE PARAMETERS
  // ----------------------------------------------------------

  const [
    adaptiveConfig,
    setAdaptiveConfig,
  ] = useState(baseConfig);

  const [
    isLoadingAdaptiveParams,
    setIsLoadingAdaptiveParams,
  ] = useState(true);

  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);

  const [recordingTime, setRecordingTime] =
    useState(0);

  const [result, setResult] = useState<{
    overall: number;
    pitchScore: number;
    intervalScore: number;
    speedScore: number;
    passed: boolean;
    feedback: string;
    noteCount: number;
    correctNoteCount: number;
    transitionCount: number;
    correctTransitionCount: number;
    averageTransitionTimeMs: number;
    durationMs: number;
  } | null>(null);

  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------

  const audioContextRef =
    useRef<AudioContext | null>(null);

  const recorderRef =
    useRef<AudioRecorder | null>(null);

  const samplesRef =
    useRef<number[]>([]);

  const recordingStartRef =
    useRef<number | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const processingRef =
    useRef(false);

    // ==========================================================
// LOAD COMPONENT TIER
// ==========================================================

useEffect(() => {
  let cancelled = false;

  const loadComponentTier = async () => {
    const user = auth.currentUser;

    if (!user) {
      if (!cancelled) {
        setTier('beginner');
        setTierLoading(false);
      }

      return;
    }

    try {
      const progress =
        await fetchComponentProgress(
          user.uid,
          'agility',
        );

      if (!cancelled) {
        setTier(
          (progress?.currentTier as Tier) ??
            'beginner',
        );
      }
    } catch (error) {
      console.warn(
        'Failed to load agility component tier:',
        error,
      );

      if (!cancelled) {
        setTier('beginner');
      }
    } finally {
      if (!cancelled) {
        setTierLoading(false);
      }
    }
  };

  void loadComponentTier();

  return () => {
    cancelled = true;
  };
}, []);

  // ==========================================================
  // LOAD ADAPTIVE PARAMETERS
  // ==========================================================

useEffect(() => {
  let cancelled = false;

  const loadAdaptiveParameters =
    async () => {
      if (tierLoading) {
        return;
      }

      setIsLoadingAdaptiveParams(true);

        /*
         * Always reset to the current tier's
         * base parameters while loading.
         *
         * This prevents parameters from a previous
         * tier from appearing temporarily.
         */
        const currentBaseParams =
          QUICK_INTERVAL_JUMP_PARAMS[tier];

        setAdaptiveConfig(
          currentBaseParams,
        );

        const user =
          auth.currentUser;

        /*
         * If there is no authenticated user,
         * use the base parameters.
         */
        if (!user) {
          if (!cancelled) {
            setIsLoadingAdaptiveParams(false);
          }

          return;
        }

        try {
          const records =
            await fetchExerciseRecords(
              user.uid,
              'agility',
            );

          if (cancelled) {
            return;
          }

          /*
           * Continuous ADS history:
           *
           * - component: agility
           * - template: quickIntervalJump
           * - tier: current tier
           * - latest five completed exercise scores
           *
           * No assessment score is used here.
           */
          const recentScores =
            records
              .filter(
                (exercise) =>
                  exercise.templateId ===
                    'quickIntervalJump' &&
                  exercise.tier === tier,
              )
              .slice(-5)
              .map(
                (exercise) =>
                  exercise.scorePct,
              );

          const generatedParams =
            generateQuickIntervalJumpParams({
              tier,
              recentScores,
            });

          if (!cancelled) {
            setAdaptiveConfig(
              generatedParams,
            );
          }
        } catch (error) {
          console.warn(
            'Failed to load Quick Interval Jump adaptive parameters:',
            error,
          );

          if (!cancelled) {
            setAdaptiveConfig(
              currentBaseParams,
            );
          }
        } finally {
          if (!cancelled) {
            setIsLoadingAdaptiveParams(false);
          }
        }
      };

    void loadAdaptiveParameters();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  // ==========================================================
  // CLEANUP
  // ==========================================================

  useEffect(() => {
    return () => {
      stopRecording();

      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {}
      }
    };
  }, []);

  // ==========================================================
  // MICROPHONE PERMISSION
  // ==========================================================

  const requestMicrophonePermission =
    async (): Promise<boolean> => {
      try {
        const permission =
          await AudioManager.requestRecordingPermissions();

        return permission === 'Granted';
      } catch {
        return false;
      }
    };

  // ==========================================================
  // REFERENCE PLAYBACK
  // ==========================================================

  const playReference =
    async () => {
      try {
        const context =
          audioContextRef.current ??
          new AudioContext({
            sampleRate: SAMPLE_RATE,
          });

        audioContextRef.current = context;

        await context.resume();

        /*
         * The current Quick Interval Jump
         * configuration contains:
         *
         * - label
         * - frequencies
         * - speedLabel
         * - accuracyThreshold
         *
         * It does NOT contain noteDurationSec
         * or gapSec.
         *
         * Therefore reference timing is derived
         * from the current tier.
         */
        const noteDurationSec =
          tier === 'beginner'
            ? 0.5
            : tier === 'intermediate'
              ? 0.4
              : 0.3;

        const gapSec = 0.1;

        for (
          const frequency of adaptiveConfig.frequencies
        ) {
          const oscillator =
            context.createOscillator();

          const gain =
            context.createGain();

          oscillator.frequency.value =
            frequency;

          gain.gain.value = 0.12;

          oscillator.connect(gain);
          gain.connect(
            context.destination,
          );

          const startTime =
            context.currentTime;

          oscillator.start(startTime);

          oscillator.stop(
            startTime +
              noteDurationSec,
          );

          await sleep(
            noteDurationSec * 1000 +
              gapSec * 1000,
          );
        }
      } catch (error) {
        console.warn(
          'Reference playback failed:',
          error,
        );
      }
    };

  // ==========================================================
  // BEGIN EXERCISE
  // ==========================================================

  const beginExercise =
    async () => {
      if (isLoadingAdaptiveParams) {
        return;
      }

      const permission =
        await requestMicrophonePermission();

      if (!permission) {
        return;
      }

      setPhase('reference');
    };

  // ==========================================================
  // START COUNTDOWN
  // ==========================================================

  const startCountdown =
    async () => {
      setPhase('countdown');

      for (
        let value = COUNTDOWN_SECONDS;
        value >= 1;
        value--
      ) {
        setCountdown(value);

        await sleep(1000);
      }

      await startRecording();
    };

  // ==========================================================
  // START RECORDING
  // ==========================================================

  const startRecording =
    async () => {
      try {
        processingRef.current = false;

        samplesRef.current = [];

        const recorder =
          new AudioRecorder();

        recorderRef.current =
          recorder;

        const callbackResult =
          recorder.onAudioReady(
            {
              sampleRate: SAMPLE_RATE,
              bufferLength:
                BUFFER_SIZE,
              channelCount: 1,
            },
            ({
              buffer,
              numFrames,
            }) => {
              try {
                const channelData =
                  buffer.getChannelData(
                    0,
                  );

                const frameCount =
                  Math.min(
                    numFrames,
                    channelData.length,
                  );

                for (
                  let i = 0;
                  i < frameCount;
                  i++
                ) {
                  samplesRef.current.push(
                    channelData[i],
                  );
                }
              } catch {}
            },
          );

        if (
          callbackResult.status ===
          'error'
        ) {
          console.warn(
            callbackResult.message,
          );

          recorderRef.current =
            null;

          setPhase('instructions');

          return;
        }

        const startResult =
          await recorder.start();

        if (
          startResult.status ===
          'error'
        ) {
          console.warn(
            'Could not start recorder:',
            startResult.message,
          );

          try {
            recorder.clearOnAudioReady();
          } catch {}

          recorderRef.current =
            null;

          setPhase('instructions');

          return;
        }

        recordingStartRef.current =
          Date.now();

        setRecordingTime(0);
        setPhase('recording');

        recordingTimerRef.current =
          setInterval(() => {
            const start =
              recordingStartRef.current;

            if (!start) {
              return;
            }

            const elapsed =
              (Date.now() - start) /
              1000;

            setRecordingTime(
              Math.min(
                elapsed,
                MAX_RECORDING_SECONDS,
              ),
            );

            if (
              elapsed >=
              MAX_RECORDING_SECONDS
            ) {
              void processRecording();
            }
          }, 100);
      } catch (error) {
        console.warn(
          'Recording failed:',
          error,
        );

        setPhase('instructions');
      }
    };

  // ==========================================================
  // STOP RECORDING
  // ==========================================================

  const stopRecording =
    () => {
      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current,
        );

        recordingTimerRef.current =
          null;
      }

      if (recorderRef.current) {
        try {
          recorderRef.current.clearOnAudioReady();
        } catch {}

        try {
          recorderRef.current.stop();
        } catch {}

        recorderRef.current =
          null;
      }
    };

  // ==========================================================
  // PROCESS RECORDING
  // ==========================================================

  const processRecording =
    async () => {
      if (processingRef.current) {
        return;
      }

      processingRef.current = true;

      stopRecording();

      setPhase('processing');

      await sleep(500);

      try {
        const samples =
          new Float32Array(
            samplesRef.current,
          );

        const measurement =
          measureQuickIntervalJump(
            samples,
            SAMPLE_RATE,
            adaptiveConfig.frequencies,
          );

        const scored =
          scoreQuickIntervalJump(
            measurement,
          );

        const finalScore =
          Math.round(
            scored.overall,
          );

        // ------------------------------------------------------
        // SAVE EXERCISE PROGRESS
        // ------------------------------------------------------

        try {
          await saveCompletedExercise(
            'agility',
            'quickIntervalJump',
            tier,
            finalScore,
          );

          console.log(
            '💾 Quick Interval Jump progress saved:',
            {
              componentId:
                'agility',
              templateId:
                'quickIntervalJump',
              tier,
              scorePct:
                finalScore,
            },
          );
        } catch (saveError) {
          console.error(
            '❌ Failed to save Quick Interval Jump progress:',
            saveError,
          );
        }

        // ------------------------------------------------------
        // SET RESULTS
        // ------------------------------------------------------

        setResult({
          overall:
            scored.overall,

          pitchScore:
            scored.pitchScore,

          intervalScore:
            scored.intervalScore,

          speedScore:
            scored.speedScore,

          passed:
            scored.passed,

          feedback:
            scored.feedback,

          noteCount:
            measurement.noteCount,

          correctNoteCount:
            measurement.correctNoteCount,

          transitionCount:
            measurement.transitionCount,

          correctTransitionCount:
            measurement.correctTransitionCount,

          averageTransitionTimeMs:
            measurement.averageTransitionTimeMs,

          durationMs:
            measurement.durationMs,
        });

        setPhase('results');
      } catch (error) {
        console.warn(
          'Processing failed:',
          error,
        );

        processingRef.current =
          false;

        setPhase('instructions');
      }
    };

  // ==========================================================
  // RESET
  // ==========================================================

  const resetExercise =
    () => {
      processingRef.current = false;

      setResult(null);

      setRecordingTime(0);

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      samplesRef.current = [];

      setPhase('instructions');
    };


    const renderInstructions = () => (
    <ExerciseScreen
      title="Quick Interval Jump"
      category="Vocal Agility"
      icon="swap-horizontal-outline"
      instructions="Listen carefully to the reference note pattern, identify each target pitch, then sing each interval accurately and smoothly."
      preparationSteps={[
        { icon: 'volume-mute-outline', text: 'Find a quiet area with minimal background noise.' },
        { icon: 'body-outline', text: 'Sit or stand upright with relaxed shoulders.' },
        { icon: 'mic-outline', text: 'Keep a comfortable distance from the microphone.' },
      ]}
      summary={[
        { label: 'DIFFICULTY', value: adaptiveConfig.label },
        { label: 'SPEED', value: adaptiveConfig.speedLabel },
        { label: 'NOTES', value: String(adaptiveConfig.frequencies.length) },
      ]}
      tip="Focus on accurate interval jumps first. Smoothness and speed should develop naturally."
      tier={tier}
      startDisabled={isLoadingAdaptiveParams}
      startLabel={isLoadingAdaptiveParams ? 'Preparing Exercise...' : 'Start Exercise'}
      onBack={() => router.back()}
      onStart={beginExercise}
    />
  );

  // REFERENCE
  // ==========================================================

  const renderReference = () => (
    <View style={styles.content}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="swap-horizontal-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>
        Listen to the Reference
      </Text>

      <Text style={styles.phaseSubtitle}>
        Listen carefully to the note sequence, then sing the same interval jumps.
      </Text>

      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>
          REFERENCE SEQUENCE
        </Text>

        <View style={styles.noteSequence}>
          {adaptiveConfig.frequencies.map(
            (frequency, index) => (
              <View
                key={`${frequency}-${index}`}
                style={styles.notePill}
              >
                <Text style={styles.noteNumber}>
                  {index + 1}
                </Text>

                <Text style={styles.noteText}>
                  {frequencyToNoteName(frequency)}
                </Text>
              </View>
            ),
          )}
        </View>

        <Text style={styles.referenceHint}>
          Listen to the complete pattern before starting.
        </Text>
      </View>

      <Pressable
        style={styles.startButton}
        onPress={playReference}
      >
        <Ionicons
          name="play"
          size={18}
          color={WHITE}
        />

        <Text style={styles.startButtonText}>
          Play Reference
        </Text>
      </Pressable>

      <Pressable
        style={styles.doneButton}
        onPress={startCountdown}
      >
        <Text style={styles.doneButtonText}>
          I'm Ready
        </Text>
      </Pressable>
    </View>
  );

  // COUNTDOWN
  // ==========================================================

  const renderCountdown =
    () => (
      <View
        style={styles.centerScreen}
      >
        <View style={styles.iconCircle}>
          <Ionicons
            name="flash-outline"
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
          Prepare for the interval jumps.
        </Text>
      </View>
    );

  // ==========================================================
  // RECORDING
  // ==========================================================

  const renderRecording =
    () => {
      const progress = Math.min(
        recordingTime /
          MAX_RECORDING_SECONDS,
        1,
      );

      return (
        <View style={styles.content}>
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
            style={styles.recordingTitle}
          >
            Jump Between Notes
          </Text>

          <Text
            style={styles.recordingSubtitle}
          >
            Sing each target note clearly and make each interval change precise.
          </Text>

          <View
            style={styles.recordingBadge}
          >
            <View
              style={styles.recordingDot}
            />

            <Text
              style={
                styles.recordingBadgeText
              }
            >
              RECORDING
            </Text>
          </View>

          <View
            style={styles.liveCard}
          >
            <Text
              style={styles.liveLabel}
            >
              RECORDING TIME
            </Text>

            <Text
              style={styles.liveCurrentNote}
            >
              {recordingTime.toFixed(1)}s
            </Text>

            <View
              style={styles.liveDivider}
            />

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
                  Target Notes
                </Text>

                <Text
                  style={
                    styles.liveStatValue
                  }
                >
                  {
                    adaptiveConfig
                      .frequencies
                      .length
                  }
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
                  Max Time
                </Text>

                <Text
                  style={
                    styles.liveStatValue
                  }
                >
                  {MAX_RECORDING_SECONDS}s
                </Text>
              </View>
            </View>
          </View>

          <Text
            style={styles.timerText}
          >
            Recording Time:{' '}
            {recordingTime.toFixed(1)}s
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

          <View
            style={styles.referenceCard}
          >
            <Text
              style={styles.cardTitle}
            >
              Sing This Sequence
            </Text>

            <View
              style={styles.noteSequence}
            >
              {adaptiveConfig.frequencies.map(
                (
                  frequency,
                  index,
                ) => (
                  <View
                    key={`${frequency}-${index}`}
                    style={
                      styles.notePill
                    }
                  >
                    <Text
                      style={
                        styles.noteNumber
                      }
                    >
                      {index + 1}
                    </Text>

                    <Text
                      style={
                        styles.noteText
                      }
                    >
                      {frequencyToNoteName(
                        frequency,
                      )}
                    </Text>
                  </View>
                ),
              )}
            </View>
          </View>

          <Pressable
            style={styles.finishButton}
            onPress={
              processRecording
            }
          >
            <Ionicons
              name="stop"
              size={18}
              color={BROWN}
            />

            <Text
              style={
                styles.finishButtonText
              }
            >
              Finish Recording
            </Text>
          </Pressable>
        </View>
      );
    };

  // ==========================================================
  // PROCESSING
  // ==========================================================

  const renderProcessing =
    () => (
      <View
        style={styles.centerScreen}
      >
        <View style={styles.iconCircle}>
          <ActivityIndicator
            size="large"
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
          Measuring pitch accuracy, interval accuracy, and transition speed.
        </Text>
      </View>
    );

  // ==========================================================
  // RESULTS
  // ==========================================================

  const renderResults =
    () => {
      if (!result) {
        return null;
      }

      return (
        <View
          style={styles.resultsContent}
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
            Quick Interval Jump Result
          </Text>

          {/* Overall */}
          <View
            style={styles.scoreCard}
          >
            <Text
              style={styles.scoreLabel}
            >
              OVERALL SCORE
            </Text>

            <Text
              style={styles.scoreValue}
            >
              {Math.round(
                result.overall,
              )}
            </Text>

            <Text
              style={
                styles.scoreDescription
              }
            >
              out of 100
            </Text>
          </View>

          {/* Breakdown */}
          <View
            style={styles.resultCard}
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Performance Breakdown
            </Text>

            <View
              style={styles.scoreRow}
            >
              <View
                style={
                  styles.scoreRowHeader
                }
              >
                <Text
                  style={
                    styles.scoreRowLabel
                  }
                >
                  Pitch Accuracy
                </Text>

                <Text
                  style={
                    styles.scoreRowValue
                  }
                >
                  {Math.round(
                    result.pitchScore,
                  )}
                  %
                </Text>
              </View>

              <View
                style={
                  styles.progressBackground
                }
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(
                        Math.max(
                          result.pitchScore,
                          0,
                        ),
                        100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>

            <View
              style={styles.scoreRow}
            >
              <View
                style={
                  styles.scoreRowHeader
                }
              >
                <Text
                  style={
                    styles.scoreRowLabel
                  }
                >
                  Interval Accuracy
                </Text>

                <Text
                  style={
                    styles.scoreRowValue
                  }
                >
                  {Math.round(
                    result.intervalScore,
                  )}
                  %
                </Text>
              </View>

              <View
                style={
                  styles.progressBackground
                }
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(
                        Math.max(
                          result.intervalScore,
                          0,
                        ),
                        100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>

            <View
              style={styles.scoreRowLast}
            >
              <View
                style={
                  styles.scoreRowHeader
                }
              >
                <Text
                  style={
                    styles.scoreRowLabel
                  }
                >
                  Transition Speed
                </Text>

                <Text
                  style={
                    styles.scoreRowValue
                  }
                >
                  {Math.round(
                    result.speedScore,
                  )}
                  %
                </Text>
              </View>

              <View
                style={
                  styles.progressBackground
                }
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(
                        Math.max(
                          result.speedScore,
                          0,
                        ),
                        100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          </View>

          {/* Metrics */}
          <View
            style={styles.resultCard}
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Performance Metrics
            </Text>

            <View
              style={styles.metricRow}
            >
              <Text
                style={styles.metricLabel}
              >
                Correct Notes
              </Text>

              <Text
                style={styles.metricValue}
              >
                {result.correctNoteCount}/
                {result.noteCount}
              </Text>
            </View>

            <View
              style={styles.metricRow}
            >
              <Text
                style={styles.metricLabel}
              >
                Correct Jumps
              </Text>

              <Text
                style={styles.metricValue}
              >
                {
                  result.correctTransitionCount
                }
                /
                {
                  result.transitionCount
                }
              </Text>
            </View>

            <View
              style={styles.metricRow}
            >
              <Text
                style={styles.metricLabel}
              >
                Average Transition
              </Text>

              <Text
                style={styles.metricValue}
              >
                {result.averageTransitionTimeMs >
                0
                  ? result.averageTransitionTimeMs.toFixed(
                      0,
                    )
                  : '0'}{' '}
                ms
              </Text>
            </View>

            <View
              style={[
                styles.metricRow,
                styles.metricRowLast,
              ]}
            >
              <Text
                style={styles.metricLabel}
              >
                Duration
              </Text>

              <Text
                style={styles.metricValue}
              >
                {(
                  result.durationMs /
                  1000
                ).toFixed(1)}
                s
              </Text>
            </View>
          </View>

          {/* Feedback */}
          <View style={styles.tipCard}>
            <Ionicons
              name="bulb-outline"
              size={20}
              color={BROWN}
            />

            <Text style={styles.tipText}>
              {result.feedback}
            </Text>
          </View>

          {/* Retry */}
          <Pressable
            style={styles.startButton}
            onPress={resetExercise}
          >
            <Ionicons
              name="refresh"
              size={18}
              color={WHITE}
            />

            <Text
              style={
                styles.startButtonText
              }
            >
              Try Again
            </Text>
          </Pressable>

          {/* Done */}
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
        </View>
      );
    };

  // ==========================================================
  // MAIN RENDER
  // ==========================================================

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={
        phase === 'results'
          ? styles.resultsWrapper
          : undefined
      }
      showsVerticalScrollIndicator={
        false
      }
    >
      {phase === 'instructions' &&
        renderInstructions()}

      {phase === 'reference' &&
        renderReference()}

      {phase === 'countdown' &&
        renderCountdown()}

      {phase === 'recording' &&
        renderRecording()}

      {phase === 'processing' &&
        renderProcessing()}

      {phase === 'results' &&
        renderResults()}
    </ScrollView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  // ==========================================================
  // SCREEN
  // ==========================================================

  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 92,
    paddingBottom: 60,
    alignItems: 'center',
  },

  resultsContent: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 92,
    paddingBottom: 50,
    alignItems: 'center',
  },

  resultsWrapper: {
    flexGrow: 1,
    width: '100%',
  },

  centerScreen: {
    flexGrow: 1,
    minHeight: 700,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  // ==========================================================
  // BACK
  // ==========================================================


  // ==========================================================
  // GENERAL HEADER
  // ==========================================================

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
    maxWidth: 320,
  },

  // ==========================================================
  // INSTRUCTIONS
  // ==========================================================







  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginTop: 10,
    marginBottom: 14,
  },




  // ==========================================================
  // REFERENCE
  // ==========================================================

  referenceCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 22,
  },

  referenceLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
    textAlign: 'center',
  },

  referenceHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 16,
  },

  noteSequence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
    marginTop: 16,
  },

  notePill: {
    minWidth: 60,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
  },

  noteNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: MUTED,
    marginBottom: 2,
  },

  noteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  // ==========================================================
  // TIP
  // ==========================================================

  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 15,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },





  // ==========================================================
  // BUTTONS
  // ==========================================================

  startButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },


  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
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

  doneButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },

  doneButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
  },

  // ==========================================================
  // RECORDING
  // ==========================================================

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
    maxWidth: 310,
  },

  recordingBadge: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: BORDER,
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

  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    marginTop: 22,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
  },

  liveCurrentNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    marginTop: 4,
  },

  liveDivider: {
    width: '100%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 15,
  },

  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 6,
  },

  liveStat: {
    flex: 1,
    alignItems: 'center',
  },

  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginTop: 3,
  },

  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 20,
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

  // ==========================================================
  // RESULTS
  // ==========================================================

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
    lineHeight: 16,
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
    marginBottom: 14,
  },

  scoreRow: {
    marginBottom: 14,
  },

  scoreRowLast: {
    marginBottom: 0,
  },

  scoreRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 7,
  },

  scoreRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  scoreRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  progressBackground: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: PINK,
  },

  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  metricRowLast: {
    borderBottomWidth: 0,
  },

  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    flex: 1,
  },

  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'right',
    marginLeft: 12,
  },
});