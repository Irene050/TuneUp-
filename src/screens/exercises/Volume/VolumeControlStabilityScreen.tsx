
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import {
  VOLUME_CONTROL_STABILITY_PARAMS,
  type Tier,
} from '@/constants/exercises/volume';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import { measureVolumeControlStability } from '@/services/measurement/volume/volumeControlStability';
import { scoreVolumeControlStability } from '@/services/scoring/volume/volumeControlStability';

import {
  generateVolumeControlStabilityParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import { auth } from '@/services/firebase/config';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import { playSingleNote } from '@/utils/music/notePlayer';
import { createMusicalNote } from '@/utils/music/notes';

/* =========================================================
   CONFIGURATION
========================================================= */

const CURRENT_TIER: Tier = 'beginner';
const DEFAULT_VOLUME_CONTROL_STABILITY =
  VOLUME_CONTROL_STABILITY_PARAMS[CURRENT_TIER];

const NOTE = 'C4';

const REFERENCE_NOTE = createMusicalNote(60);
const REFERENCE_NOTE_DURATION_SEC = 1.5;
const COUNTDOWN_SECONDS = 3;

/* =========================================================
   TYPES
========================================================= */

type Phase =
  | 'directions'
  | 'countdown'
  | 'exercise'
  | 'results';

type MeasurementResult =
  ReturnType<typeof measureVolumeControlStability>;

type ScoreResult =
  ReturnType<typeof scoreVolumeControlStability>;

/* =========================================================
   COMPONENT
========================================================= */

export default function VolumeControlStabilityScreen({
  tier,
}: {
  tier?: Tier;
}) {
  const [phase, setPhase] = useState<Phase>('directions');

  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  const [remainingSeconds, setRemainingSeconds] = useState(
    DEFAULT_VOLUME_CONTROL_STABILITY.durationSec *
      DEFAULT_VOLUME_CONTROL_STABILITY.repetitions,
  );

  const [liveVolume, setLiveVolume] = useState(-60);
  const [livePitch, setLivePitch] = useState<number | null>(null);
  const [liveNote, setLiveNote] = useState('--');
  const [liveStability, setLiveStability] = useState(0);

  const liveHistoryRef = useRef<number[]>([]);

  const [measurement, setMeasurement] =
    useState<MeasurementResult | null>(null);

  const [score, setScore] = useState<ScoreResult | null>(null);

  const [hasPlayedReference, setHasPlayedReference] =
    useState(false);

  const [referencePlaying, setReferencePlaying] = useState(false);

  const [referenceError, setReferenceError] =
    useState<string | null>(null);

  const [isStarting, setIsStarting] = useState(false);

  const [resolvedTier, setResolvedTier] = useState<Tier>(
    tier ?? CURRENT_TIER,
  );

  const [exerciseParams, setExerciseParams] = useState(
    DEFAULT_VOLUME_CONTROL_STABILITY,
  );

  const [paramsReady, setParamsReady] = useState(false);

  const durationSeconds = exerciseParams.durationSec;
  const repetitions = exerciseParams.repetitions;
  const targetStability = exerciseParams.stabilityThreshold;
  const totalExerciseSeconds = durationSeconds * repetitions;

  const mountedRef = useRef(true);
  const exerciseStartedAtRef = useRef<number | null>(null);
  const recordingFinishedRef = useRef(false);

  /* =========================================================
     LOAD ADAPTIVE PARAMETERS
  ========================================================= */

  useEffect(() => {
    let cancelled = false;
    const loadParameters = async () => {
      try {
        const user = auth.currentUser;

        let selectedTier: Tier = tier ?? CURRENT_TIER;
        let recentScores: number[] = [];

        if (user) {
          if (!tier) {
            const progress = await fetchComponentProgress(
              user.uid,
              'volume',
            );

            selectedTier = progress?.currentTier ?? CURRENT_TIER;
          }

          const records = await fetchExerciseRecords(
            user.uid,
            'volume',
          );

          const matchingRecords = records
            .filter(
              (record) =>
                record.templateId === 'volumeControlStability' &&
                record.tier === selectedTier,
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          recentScores = matchingRecords
            .slice(-5)
            .map((record) => record.scorePct);

          if (recentScores.length === 0) {
            const latestAssessment = await getLatestAssessment();

            const assessmentScore = latestAssessment?.scores.find(
              (item) => item.componentId === 'volume',
            )?.scorePct;

            if (Number.isFinite(assessmentScore)) {
              recentScores = [assessmentScore!];
            }
          }
        }
        const generatedParams =
          generateVolumeControlStabilityParams({
            tier: selectedTier,
            recentScores,
          });
        if (cancelled) {
          return;
        }

        setResolvedTier(selectedTier);
        setExerciseParams(generatedParams);
        setParamsReady(true);
      } catch (error) {
        console.error(
          'Failed to load Volume Control Stability parameters:',
          error,
        );
        if (!cancelled) {
          setResolvedTier(tier ?? CURRENT_TIER);
          setExerciseParams(DEFAULT_VOLUME_CONTROL_STABILITY);
          setParamsReady(true);
        }
      }
    };

    void loadParameters();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* =========================================================
     REFERENCE NOTE
  ========================================================= */

  const playReferenceNote = useCallback(async () => {
    if (referencePlaying) {
      return;
    }

    setReferenceError(null);
    setReferencePlaying(true);

    try {
      await playSingleNote(
        REFERENCE_NOTE.frequency,
        REFERENCE_NOTE_DURATION_SEC,
      );

      if (mountedRef.current) {
        setHasPlayedReference(true);
      }
    } catch (error) {
      console.error('C4 reference playback error:', error);

      if (mountedRef.current) {
        setHasPlayedReference(false);
        setReferenceError(
          'Unable to play the C4 reference note.',
        );
      }
    } finally {
      if (mountedRef.current) {
        setReferencePlaying(false);
      }
    }
  }, [referencePlaying]);

  /* =========================================================
     AUDIO RECORDER
  ========================================================= */

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (!mountedRef.current || phase !== 'exercise') {
        return;
      }

      const db =
        Number.isFinite(frame.volume) && frame.volume > -100
          ? frame.volume
          : -60;

      setLiveVolume(db);
      const isVoiced =
        Number.isFinite(frame.pitch) &&
        frame.pitch > 0 &&
        Number.isFinite(frame.clarity) &&
        frame.clarity >= 0.45 &&
        typeof frame.note === 'string' &&
        frame.note !== '--';
      setLivePitch(isVoiced ? frame.pitch : null);
      setLiveNote(
        isVoiced && typeof frame.note === 'string'
          ? frame.note
          : '--',
      );
      if (!isVoiced) {
        setLiveStability(0);
        return;
      }

      const amplitudes = liveHistoryRef.current;
      amplitudes.push(Math.pow(10, db / 20));

      if (amplitudes.length > 40) {
        amplitudes.shift();
      }

      if (amplitudes.length < 2) {
        setLiveStability(0);
        return;
      }

      const mean =
        amplitudes.reduce((sum, value) => sum + value, 0) /
        amplitudes.length;

      if (mean <= 0 || !Number.isFinite(mean)) {
        setLiveStability(0);
        return;
      }

      const variance =
        amplitudes.reduce(
          (sum, value) => sum + Math.pow(value - mean, 2),
          0,
        ) / amplitudes.length;

      const coefficientOfVariation =
        Math.sqrt(variance) / mean;

      setLiveStability(
        Math.max(
          0,
          Math.min(
            100,
            100 - coefficientOfVariation * 100,
          ),
        ),
      );
    },

    onStop: (samples, sampleRate) => {
      if (
        !mountedRef.current ||
        recordingFinishedRef.current
      ) {
        return;
      }

      recordingFinishedRef.current = true;

      const measured = measureVolumeControlStability(
        samples,
        sampleRate,
        durationSeconds,
        repetitions,
      );

      const scored = scoreVolumeControlStability(
        measured,
        {
          passingScore: targetStability,
        },
      );

      setMeasurement(measured);
      setScore(scored);
      setPhase('results');
      void saveCompletedExercise(
        'volume',
        'volumeControlStability',
        resolvedTier,
        scored.overallScore,
      );
    },
  });

  /* =========================================================
     START RECORDING
  ========================================================= */

  const beginRecording = useCallback(async () => {
    try {
      recordingFinishedRef.current = false;

      await startRecording();

      if (!mountedRef.current) {
        return;
      }

      exerciseStartedAtRef.current = Date.now();

      setLiveVolume(-60);
      setLiveStability(0);
      liveHistoryRef.current = [];
      setLivePitch(null);
      setLiveNote('--');

      setRemainingSeconds(totalExerciseSeconds);
      setPhase('exercise');
    } catch (error) {
      console.error('Unable to start recording:', error);

      if (mountedRef.current) {
        setPhase('directions');
        setReferenceError(
          'Microphone could not be started. Please check microphone permission.',
        );
      }
    }
  }, [startRecording, totalExerciseSeconds]);

  /* =========================================================
     COUNTDOWN
  ========================================================= */

  useEffect(() => {
    if (phase !== 'countdown') {
      return;
    }

    setCountdown(COUNTDOWN_SECONDS);

    const interval = setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          clearInterval(interval);
          void beginRecording();
          return 0;
        }

        return value - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [phase, beginRecording]);

  /* =========================================================
     EXERCISE TIMER
  ========================================================= */

  useEffect(() => {
    if (phase !== 'exercise') {
      return;
    }

    const interval = setInterval(() => {
      const startedAt = exerciseStartedAtRef.current;

      if (!startedAt) {
        return;
      }

      const elapsed = (Date.now() - startedAt) / 1000;

      const remaining = Math.max(
        0,
        Math.ceil(totalExerciseSeconds - elapsed),
      );

      setRemainingSeconds(remaining);

      if (elapsed >= totalExerciseSeconds) {
        clearInterval(interval);
        void stopRecording();
      }
    }, 100);

    return () => {
      clearInterval(interval);
    };
  }, [phase, stopRecording, totalExerciseSeconds]);

  /* =========================================================
     START / RESET
  ========================================================= */

  const startExercise = useCallback(() => {
    if (
      !paramsReady ||
      !hasPlayedReference ||
      isStarting
    ) {
      return;
    }

    setIsStarting(true);
    setMeasurement(null);
    setScore(null);
    liveHistoryRef.current = [];
    setLiveVolume(-60);
    setLiveStability(0);
    setRemainingSeconds(totalExerciseSeconds);
    setCountdown(COUNTDOWN_SECONDS);
    setReferenceError(null);
    setPhase('countdown');

    setTimeout(() => {
      if (mountedRef.current) {
        setIsStarting(false);
      }
    }, 400);
  }, [
    paramsReady,
    hasPlayedReference,
    isStarting,
    totalExerciseSeconds,
  ]);

  const resetExercise = useCallback(() => {
    setMeasurement(null);
    setScore(null);
    setLiveVolume(-60);
    setLiveStability(0);
    liveHistoryRef.current = [];
    setRemainingSeconds(totalExerciseSeconds);
    setCountdown(COUNTDOWN_SECONDS);
    setReferenceError(null);
    setHasPlayedReference(false);
    setReferencePlaying(false);

    recordingFinishedRef.current = false;
    exerciseStartedAtRef.current = null;

    setPhase('directions');
  }, [totalExerciseSeconds]);

  const voiceDetected =
    livePitch !== null &&
    Number.isFinite(livePitch) &&
    livePitch > 0 &&
    liveNote !== '--';

  const cancelAndLeave = useCallback(() => {
    if (phase === 'exercise') {
      recordingFinishedRef.current = true;
      void stopRecording();
    }

    router.back();
  }, [phase, stopRecording]);

  /* =========================================================
     PREPARING
  ========================================================= */

  if (!paramsReady) {
    return (
      <SafeAreaView style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons
            name="options-outline"
            size={32}
            color={COLORS.ACCENT}
          />
        </View>

        <Text style={styles.preparingTitle}>
          Preparing Your Exercise
        </Text>

        <Text style={styles.preparingSubtitle}>
          Adjusting the exercise to your current difficulty
          level and preparing your session.
        </Text>

        <ActivityIndicator
          size="large"
          color={COLORS.ACCENT}
          style={styles.preparingSpinner}
        />
      </SafeAreaView>
    );
  }

  /* =========================================================
     DIRECTIONS
  ========================================================= */

  if (phase === 'directions') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ExerciseScreen
          title="Volume Control Stability"
          category="VOLUME CONTROL"
          icon="options-outline"
          instructions={`Listen to the ${NOTE} reference note, sing it on “Ah,” and keep your volume as steady as possible.`}
          preparationSteps={[
            {
              icon: 'musical-note-outline',
              text: `Play the ${NOTE} reference note and listen carefully.`,
            },
            {
              icon: 'mic-outline',
              text: 'Take a comfortable breath before singing.',
            },
            {
              icon: 'pulse-outline',
              text: `Sing ${NOTE} on “Ah” and keep your volume steady.`,
            },
            {
              icon: 'timer-outline',
              text: `Hold the note for ${durationSeconds} seconds per repetition.`,
            },
          ]}
          summary={[
            {
              label: 'Duration',
              value: `${durationSeconds} sec`,
              hint: 'per repetition',
            },
            {
              label: 'Repetitions',
              value: String(repetitions),
            },
            {
              label: 'Stability target',
              value: `${Math.round(targetStability)}%`,
            },
          ]}
          targetValue={`${Math.round(targetStability)}%`}
          targetHint="Keep your volume consistent throughout the note."
          repetitions={repetitions}
          tip="Choose a comfortable volume first. Avoid sudden changes in loudness while sustaining the note."
          tier={resolvedTier}
          onBack={cancelAndLeave}
          onStart={startExercise}
          startDisabled={
            !paramsReady ||
            !hasPlayedReference ||
            referencePlaying ||
            isStarting
          }
          startLabel={
            paramsReady
              ? hasPlayedReference
                ? 'Start Exercise'
                : 'Play the Reference Note First'
              : 'Loading Exercise...'
          }
          error={referenceError}
        >
          <View style={styles.referenceCard}>
            <View style={styles.referenceTopRow}>
              <View style={styles.referenceCopy}>
                <Text style={styles.referenceLabel}>
                  REFERENCE NOTE
                </Text>

                <Text style={styles.referenceNote}>
                  {NOTE}
                </Text>
              </View>

              <View style={styles.noteIconCircle}>
                <Ionicons
                  name="musical-note"
                  size={22}
                  color={COLORS.BROWN}
                />
              </View>
            </View>

            <Text style={styles.referenceInstruction}>
              Play the note, then sing it on “Ah” while
              keeping your volume steady.
            </Text>

            <Pressable
              style={[
                styles.referenceButton,
                referencePlaying && styles.disabled,
              ]}
              disabled={referencePlaying}
              onPress={() => void playReferenceNote()}
            >
              <Ionicons
                name={referencePlaying ? 'volume-high' : 'play'}
                size={17}
                color={COLORS.WHITE}
              />

              <Text style={styles.referenceButtonText}>
                {referencePlaying ? 'Playing...' : `Play ${NOTE}`}
              </Text>
            </Pressable>

            {hasPlayedReference && (
              <View style={styles.referenceReadyRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={15}
                  color={COLORS.SUCCESS}
                />

                <Text style={styles.referenceReadyText}>
                  Reference note played. You’re ready to begin.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.infoCard}>
            <View style={styles.infoHeader}>
              <View style={styles.infoIconCircle}>
                <Ionicons
                  name="information-circle-outline"
                  size={18}
                  color={COLORS.ACCENT}
                />
              </View>

              <Text style={styles.infoTitle}>
                What to focus on
              </Text>
            </View>

            <Text style={styles.referenceInstruction}>
              This exercise evaluates how consistently you
              sustain your voice and maintain its detected
              volume over time. The measurement uses relative
              audio levels; it does not directly measure airflow
              or calibrated sound pressure.
            </Text>
          </View>
        </ExerciseScreen>
      </SafeAreaView>
    );
  }

  /* =========================================================
     COUNTDOWN
  ========================================================= */

  if (phase === 'countdown') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ExerciseCountdownScreen
          icon="pulse-outline"
          title="Get Ready"
          countdown={countdown}
          promptTitle={`Prepare to sing ${NOTE}.`}
          prompt={`Start singing on “Ah” when the countdown reaches zero. Keep your volume steady for ${durationSeconds} seconds per repetition.`}
          onBack={cancelAndLeave}
        />
      </SafeAreaView>
    );
  }

  /* =========================================================
     ACTIVE EXERCISE
  ========================================================= */

  if (phase === 'exercise') {
    const elapsedTotal = Math.max(
      0,
      totalExerciseSeconds - remainingSeconds,
    );

    const currentRep = Math.min(
      repetitions,
      Math.floor(
        elapsedTotal / Math.max(1, durationSeconds),
      ) + 1,
    );

    const currentRepElapsed =
      elapsedTotal % Math.max(1, durationSeconds);

    const liveVolumeDisplay =
      liveVolume > -60
        ? Math.round(liveVolume + 70)
        : '--';

    const clampedStability = Math.max(
      0,
      Math.min(100, liveStability),
    );

    const meetsLiveTarget =
      voiceDetected &&
      liveStability >= targetStability;

    return (
      <SafeAreaView style={styles.safeArea}>
        <ExerciseListeningScreen
          icon="pulse-outline"
          title="Volume Control Stability"
          currentRep={currentRep}
          repetitions={repetitions}
          elapsed={Math.min(
            durationSeconds,
            currentRepElapsed,
          )}
          targetDuration={durationSeconds}
          promptTitle="Keep your voice steady"
          prompt={`Sing ${NOTE} on “Ah” at a comfortable volume. Avoid sudden loudness changes until the timer ends.`}
          progress={Math.min(
            100,
            (elapsedTotal /
              Math.max(1, totalExerciseSeconds)) *
              100,
          )}
          onBack={cancelAndLeave}
          liveContent={
            <View style={styles.liveContent}>
              <Pressable
                style={[
                  styles.replayButton,
                  referencePlaying && styles.disabled,
                ]}
                disabled={referencePlaying}
                onPress={() => void playReferenceNote()}
              >
                <Ionicons
                  name={referencePlaying ? 'volume-high' : 'play'}
                  size={16}
                  color={COLORS.ACCENT}
                />

                <Text style={styles.replayButtonText}>
                  {referencePlaying
                    ? 'Playing...'
                    : `Replay ${NOTE} Reference`}
                </Text>
              </Pressable>

              {/* LIVE VOLUME */}

              <View style={styles.liveCard}>
                <View style={styles.liveCardHeader}>
                  <View style={styles.liveIconCircle}>
                    <Ionicons
                      name="volume-medium-outline"
                      size={18}
                      color={COLORS.ACCENT}
                    />
                  </View>

                  <View style={styles.liveCardHeading}>
                    <Text style={styles.cardTitle}>
                      Your Live Volume
                    </Text>

                    <Text style={styles.mutedSmall}>
                      Relative microphone level
                    </Text>
                  </View>
                </View>

                <View style={styles.liveVolumeRow}>
                  <Text style={styles.liveVolume}>
                    {liveVolumeDisplay}
                  </Text>

                  <Text style={styles.liveUnit}>
                    / 70 level
                  </Text>
                </View>

                <View style={styles.statusBadge}>
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor: meetsLiveTarget
                          ? COLORS.SUCCESS
                          : COLORS.MUTED,
                      },
                    ]}
                  />

                  <Text
                    style={[
                      styles.statusText,
                      meetsLiveTarget && styles.statusTextSuccess,
                    ]}
                  >
                    {!voiceDetected
                      ? 'WAITING FOR YOUR VOICE'
                      : meetsLiveTarget
                        ? 'STEADY SO FAR'
                        : 'KEEP IT STEADY'}
                  </Text>
                </View>

                <Text style={styles.helperText}>
                  Relative level for feedback, not a calibrated
                  sound-pressure measurement.
                </Text>
              </View>

              {/* VOLUME STABILITY */}

              <View style={styles.liveCard}>
                <View style={styles.rowBetween}>
                  <View style={styles.stabilityHeading}>
                    <Text style={styles.cardTitle}>
                      Volume Stability
                    </Text>

                    <Text style={styles.mutedSmall}>
                      Live consistency estimate
                    </Text>
                  </View>

                  <Text style={styles.stabilityValue}>
                    {Math.round(clampedStability)}%
                  </Text>
                </View>

                <View style={styles.stabilityTrack}>
                  <View
                    style={[
                      styles.stabilityFill,
                      {
                        width: `${clampedStability}%`,
                      },
                    ]}
                  />

                  <View
                    style={[
                      styles.stabilityTargetMarker,
                      {
                        left: `${Math.max(
                          0,
                          Math.min(100, targetStability),
                        )}%`,
                      },
                    ]}
                  />
                </View>

                <View style={styles.scaleRow}>
                  <Text style={styles.scaleText}>
                    Less steady
                  </Text>

                  <Text style={styles.scaleText}>
                    Target: {Math.round(targetStability)}%
                  </Text>

                  <Text style={styles.scaleText}>
                    More steady
                  </Text>
                </View>

                <View style={styles.tipInline}>
                  <Ionicons
                    name="bulb-outline"
                    size={15}
                    color={COLORS.ACCENT}
                  />

                  <Text style={styles.tipInlineText}>
                    Keep a comfortable, even volume. Avoid
                    sudden increases or drops in loudness.
                  </Text>
                </View>
              </View>

              {/* DETECTED NOTE */}

              <View style={styles.liveCard}>
                <View style={styles.liveCardHeader}>
                  <View style={styles.liveIconCircle}>
                    <Ionicons
                      name="musical-note-outline"
                      size={18}
                      color={COLORS.ACCENT}
                    />
                  </View>

                  <View style={styles.liveCardHeading}>
                    <Text style={styles.cardTitle}>
                      Detected Note
                    </Text>

                    <Text style={styles.mutedSmall}>
                      Sing near the microphone
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.noteStatusBadge,
                      voiceDetected &&
                        styles.noteStatusBadgeActive,
                    ]}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        {
                          backgroundColor: voiceDetected
                            ? COLORS.SUCCESS
                            : COLORS.MUTED,
                        },
                      ]}
                    />

                    <Text
                      style={[
                        styles.noteStatusText,
                        voiceDetected &&
                          styles.statusTextSuccess,
                      ]}
                    >
                      {voiceDetected ? 'DETECTED' : 'LISTENING'}
                    </Text>
                  </View>
                </View>

                <View style={styles.detectedNotePanel}>
                  <Text
                    style={[
                      styles.detectedNote,
                      !voiceDetected && styles.detectedNoteWaiting,
                    ]}
                  >
                    {voiceDetected ? liveNote : '--'}
                  </Text>

                  <Text style={styles.detectedFrequency}>
                    {voiceDetected && livePitch !== null
                      ? `${livePitch.toFixed(1)} Hz`
                      : 'Waiting for a clear vocal sound'}
                  </Text>
                </View>

                <Text style={styles.mutedSmall}>
                  Try to sing close to {NOTE}. Pitch feedback
                  helps identify the note, while this exercise
                  focuses on volume consistency.
                </Text>
              </View>
            </View>
          }
        />
      </SafeAreaView>
    );
  }

  /* =========================================================
     RESULTS
  ========================================================= */

  const finalScore = score?.overallScore ?? 0;
  const stabilityScore = measurement?.stability ?? 0;
  const durationScore = measurement?.durationScore ?? 0;
  const voicedCoverage =
    measurement?.voicedCoveragePercent ?? 0;
  const resultPassed = score?.passed ?? false;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExerciseResultsScreen
        title="Volume Stability Results"
        subtitle={
          score?.feedback ??
          'Your result reflects volume consistency and sustained vocal coverage during the exercise.'
        }
        score={Math.round(finalScore)}
        scoreSuffix="/100"
        resultIcon={
          resultPassed
            ? 'checkmark-circle'
            : 'refresh-circle'
        }
        scoreMessage={
          resultPassed ? 'Exercise passed' : 'Keep practicing'
        }
        scoreDetails={
          <View style={styles.resultCard}>
            {[
              {
                label: 'Repetition 1',
                value: `${Math.round(
                  measurement?.repStability?.[0] ?? 0,
                )}%`,
              },
              {
                label: 'Repetition 2',
                value: `${Math.round(
                  measurement?.repStability?.[1] ?? 0,
                )}%`,
              },
              {
                label: 'Volume Stability',
                value: `${Math.round(stabilityScore)}%`,
              },
              {
                label: 'Duration Score',
                value: `${Math.round(durationScore)}%`,
              },
              {
                label: 'Average microphone level',
                value:
                  measurement?.averageDb !== undefined
                    ? `${Math.max(
                        0,
                        Math.min(
                          70,
                          Math.round(
                            measurement.averageDb + 70,
                          ),
                        ),
                      )}/70 relative level`
                    : '--',
              },
              {
                label: 'Voiced Coverage',
                value: `${Math.round(voicedCoverage)}%`,
              },
              {
                label: 'Measurement Quality',
                value: `${Math.round(
                  measurement?.measurementQuality ?? 0,
                )}%`,
              },
            ].map((item, index, rows) => (
              <View
                key={item.label}
                style={[
                  styles.resultRow,
                  index === rows.length - 1 &&
                    styles.lastResultRow,
                ]}
              >
                <Text style={styles.resultLabel}>
                  {item.label}
                </Text>

                <Text style={styles.resultValue}>
                  {item.value}
                </Text>
              </View>
            ))}
          </View>
        }
        onRetry={resetExercise}
        onExit={() => router.back()}
      >
        {resultPassed && (
          <Pressable
            style={styles.nextButton}
            onPress={() =>
              router.replace('/exercises/volume' as any)
            }
          >
            <Text style={styles.nextButtonText}>
              Next Exercise
            </Text>

            <Ionicons
              name="arrow-forward"
              size={18}
              color={COLORS.ACCENT}
            />
          </Pressable>
        )}
      </ExerciseResultsScreen>
    </SafeAreaView>
  );
}

/* =========================================================
   COLORS
========================================================= */

const COLORS = {
  BROWN: '#4E2F1F',
  PINK: '#FCD6DD',
  LIGHT_PINK: '#FFF8FA',
  BORDER: '#F2DDE5',
  ACCENT: '#D86C89',
  MUTED: '#8E7770',
  SOFT_TEXT: '#765D63',
  WHITE: '#FFFFFF',
  SUCCESS: '#278451',
  SUCCESS_BG: '#EFF8F2',
};

/* =========================================================
   STYLES
========================================================= */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.WHITE,
  },

  /* PREPARING */

  preparingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: COLORS.LIGHT_PINK,
  },

  preparingIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    backgroundColor: COLORS.PINK,
  },

  preparingTitle: {
    color: COLORS.BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 21,
    textAlign: 'center',
  },

  preparingSubtitle: {
    maxWidth: 285,
    marginTop: 7,
    color: COLORS.MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },

  preparingSpinner: {
    marginTop: 20,
  },

  /* SHARED */

  disabled: {
    opacity: 0.55,
  },

  liveContent: {
    gap: 9,
  },

  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },

  /* REFERENCE NOTE */

  referenceCard: {
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.WHITE,
  },
  referenceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  referenceCopy: {
    flex: 1,
  },

  referenceLabel: {
    color: COLORS.MUTED,
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 1,
  },
  referenceNote: {
    marginTop: 2,
    color: COLORS.ACCENT,
    fontFamily: 'FredokaBold',
    fontSize: 28,
  },
  noteIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.LIGHT_PINK,
  },
  referenceInstruction: {
    marginTop: 7,
    color: COLORS.SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
  },
  referenceButton: {
    minHeight: 43,
    marginTop: 11,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: COLORS.ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  referenceButtonText: {
    color: COLORS.WHITE,
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
  },
  referenceReadyRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  referenceReadyText: {
    flex: 1,
    color: COLORS.SUCCESS,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 15,
  },

  /* INFORMATION CARD */

  infoCard: {
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.LIGHT_PINK,
  },

  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  infoIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.WHITE,
  },

  infoTitle: {
    color: COLORS.BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
  },

  /* LIVE EXERCISE */

  replayButton: {
    minHeight: 39,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  replayButtonText: {
    color: COLORS.BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
  },

  liveCard: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.WHITE,
  },

  liveCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  liveIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.LIGHT_PINK,
  },

  liveCardHeading: {
    flex: 1,
    minWidth: 0,
  },

  cardTitle: {
    color: COLORS.BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
  },

  mutedSmall: {
    marginTop: 3,
    color: COLORS.MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 14,
  },

  liveVolumeRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },

  liveVolume: {
    color: COLORS.BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 30,
  },

  liveUnit: {
    color: COLORS.MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
  },

  statusBadge: {
    alignSelf: 'flex-start',
    minHeight: 25,
    marginTop: 7,
    paddingHorizontal: 9,
    borderRadius: 13,
    backgroundColor: COLORS.LIGHT_PINK,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.MUTED,
  },

  statusText: {
    color: COLORS.SOFT_TEXT,
    fontFamily: 'FredokaBold',
    fontSize: 9,
    letterSpacing: 0.25,
  },

  statusTextSuccess: {
    color: COLORS.SUCCESS,
  },

  helperText: {
    marginTop: 7,
    color: COLORS.MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 14,
  },

  /* STABILITY METER */

  stabilityHeading: {
    flex: 1,
    minWidth: 0,
  },
  stabilityValue: {
    color: COLORS.ACCENT,
    fontFamily: 'FredokaBold',
    fontSize: 23,
  },

  stabilityTrack: {
    height: 9,
    marginTop: 11,
    borderRadius: 6,
    backgroundColor: COLORS.LIGHT_PINK,
    overflow: 'hidden',
    position: 'relative',
  },

  stabilityFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: COLORS.ACCENT,
  },

  stabilityTargetMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: COLORS.BROWN,
  },

  scaleRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },

  scaleText: {
    color: COLORS.MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 9,
  },

  tipInline: {
    marginTop: 10,
    padding: 9,
    borderRadius: 11,
    backgroundColor: COLORS.LIGHT_PINK,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },

  tipInlineText: {
    flex: 1,
    color: COLORS.SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
  },

  /* DETECTED NOTE */

  noteStatusBadge: {
    flexShrink: 0,
    minHeight: 23,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: '#F5F2F2',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  noteStatusBadgeActive: {
    backgroundColor: COLORS.SUCCESS_BG,
  },

  noteStatusText: {
    color: COLORS.MUTED,
    fontFamily: 'FredokaBold',
    fontSize: 8,
    letterSpacing: 0.2,
  },

  detectedNotePanel: {
    marginTop: 10,
    paddingVertical: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.LIGHT_PINK,
    alignItems: 'center',
  },

  detectedNote: {
    color: COLORS.ACCENT,
    fontFamily: 'FredokaBold',
    fontSize: 34,
    lineHeight: 40,
  },

  detectedNoteWaiting: {
    color: '#B9A7A3',
  },

  detectedFrequency: {
    marginTop: 2,
    color: COLORS.MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    textAlign: 'center',
  },

  /* RESULTS */

  resultCard: {
    width: '100%',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.WHITE,
  },

  resultRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F4E9EC',
    gap: 10,
    paddingVertical: 5,
  },

  lastResultRow: {
    borderBottomWidth: 0,
  },

  resultLabel: {
    flex: 1,
    color: COLORS.SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
  },

  resultValue: {
    flexShrink: 1,
    color: COLORS.BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    textAlign: 'right',
  },

  nextButton: {
    minHeight: 44,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.LIGHT_PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  nextButtonText: {
    color: COLORS.BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
  },
});