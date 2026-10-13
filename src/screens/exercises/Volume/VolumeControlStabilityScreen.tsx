
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

import {
  SafeAreaView,
} from 'react-native-safe-area-context';

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

import {
  createMusicalNote,
} from '@/utils/music/notes';

import {
  playSingleNote,
} from '@/utils/music/notePlayer';

/* =========================================================
   DEFAULT CONFIGURATION
========================================================= */

const CURRENT_TIER: Tier = 'beginner';

const DEFAULT_VOLUME_CONTROL_STABILITY =
  VOLUME_CONTROL_STABILITY_PARAMS[CURRENT_TIER];

const NOTE = 'C4';

const REFERENCE_NOTE =
  createMusicalNote(60);
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
  ReturnType<
    typeof measureVolumeControlStability
  >;

type ScoreResult =
  ReturnType<
    typeof scoreVolumeControlStability
  >;

/* =========================================================
   COMPONENT
========================================================= */

export default function VolumeControlStabilityScreen({
  tier,
}: {
  tier?: Tier;
}) {
  const [phase, setPhase] =
    useState<Phase>(
      'directions',
    );

  const [countdown, setCountdown] =
    useState(
      COUNTDOWN_SECONDS,
    );

  const [
    remainingSeconds,
    setRemainingSeconds,
  ] = useState(
    DEFAULT_VOLUME_CONTROL_STABILITY.durationSec *
      DEFAULT_VOLUME_CONTROL_STABILITY.repetitions,
  );

  const [liveVolume, setLiveVolume] =
    useState(-60);

  const [livePitch, setLivePitch] =
    useState<number | null>(null);

  const [liveNote, setLiveNote] =
    useState('--');

  const [
    liveStability,
    setLiveStability,
  ] = useState(0);

  const liveHistoryRef = useRef<number[]>([]);

  const [
    measurement,
    setMeasurement,
  ] = useState<MeasurementResult | null>(
    null,
  );

  const [score, setScore] =
    useState<ScoreResult | null>(
      null,
    );

  const [
    hasPlayedReference,
    setHasPlayedReference,
  ] = useState(false);

  const [
    referencePlaying,
    setReferencePlaying,
  ] = useState(false);

  const [
    referenceError,
    setReferenceError,
  ] = useState<string | null>(
    null,
  );

  const [
    isStarting,
    setIsStarting,
  ] = useState(false);

  const [
    resolvedTier,
    setResolvedTier,
  ] = useState<Tier>(
    tier ?? CURRENT_TIER,
  );

  const [
    exerciseParams,
    setExerciseParams,
  ] = useState(
    DEFAULT_VOLUME_CONTROL_STABILITY,
  );

  const [
    paramsReady,
    setParamsReady,
  ] = useState(false);

  const durationSeconds =
    exerciseParams.durationSec;

  const repetitions =
    exerciseParams.repetitions;

  const targetStability =
    exerciseParams.stabilityThreshold;

  const amplitudeVariancePercent =
    exerciseParams.amplitudeVariancePct;

  const totalExerciseSeconds =
    durationSeconds * repetitions;

  const mountedRef =
    useRef(true);

  const exerciseStartedAtRef =
    useRef<number | null>(
      null,
    );

  const recordingFinishedRef =
    useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadParameters = async () => {
      try {
        const user =
          auth.currentUser;

        let selectedTier: Tier =
          tier ?? CURRENT_TIER;

        let recentScores: number[] =
          [];

        if (user) {
          if (!tier) {
            const progress =
              await fetchComponentProgress(
                user.uid,
                'volume',
              );

            selectedTier =
              progress?.currentTier ??
              CURRENT_TIER;
          }

          const records =
            await fetchExerciseRecords(
              user.uid,
              'volume',
            );

          const matchingRecords =
            records
              .filter(
                (record) =>
                  record.templateId ===
                    'volumeControlStability' &&
                  record.tier ===
                    selectedTier,
              )
              .sort(
                (a, b) =>
                  a.timestamp -
                  b.timestamp,
              );

          recentScores =
            matchingRecords
              .slice(-5)
              .map(
                (record) =>
                  record.scorePct,
              );

          if (
            recentScores.length === 0
          ) {
            const latestAssessment =
              await getLatestAssessment();

            const assessmentScore =
              latestAssessment?.scores.find(
                (score) =>
                  score.componentId ===
                  'volume',
              )?.scorePct;

            if (
              Number.isFinite(
                assessmentScore,
              )
            ) {
              recentScores = [
                assessmentScore!,
              ];
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

        setResolvedTier(
          selectedTier,
        );

        setExerciseParams(
          generatedParams,
        );

        setParamsReady(true);
      } catch (error) {
        console.error(
          'Failed to load Volume Control Stability parameters:',
          error,
        );

        if (!cancelled) {
          setResolvedTier(
            tier ?? CURRENT_TIER,
          );

          setExerciseParams(
            DEFAULT_VOLUME_CONTROL_STABILITY,
          );

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

  const playReferenceNote =
    useCallback(async () => {
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

        if (
          mountedRef.current
        ) {
          setHasPlayedReference(true);
        }
      } catch (error) {
        console.error(
          'C4 reference playback error:',
          error,
        );

        if (
          mountedRef.current
        ) {
          setHasPlayedReference(false);

          setReferenceError(
            'Unable to play the C4 reference note.',
          );
        }
      } finally {

        if (
          mountedRef.current
        ) {
          setReferencePlaying(false);
        }
      }
    }, [referencePlaying]);

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({

    onFrame: (frame) => {
      if (
        !mountedRef.current ||
        phase !== 'exercise'
      ) {
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
  isVoiced && typeof frame.note === 'string' ? frame.note : '--',
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
    Math.min(100, 100 - coefficientOfVariation * 100),
  ),
);      
    },

    onStop: (
      samples,
      sampleRate,
    ) => {
      if (
        !mountedRef.current ||
        recordingFinishedRef.current
      ) {
        return;
      }

      recordingFinishedRef.current =
        true;

      const measured =
        measureVolumeControlStability(
          samples,
          sampleRate,
          durationSeconds,
          repetitions,
        );

      const scored =
        scoreVolumeControlStability(
          measured,
          {
            passingScore:
              targetStability,
          },
        );

      setMeasurement(
        measured,
      );

      setScore(
        scored,
      );

      setPhase('results');

      void saveCompletedExercise(
        'volume',
        'volumeControlStability',
        resolvedTier,
        scored.overallScore,
      );
    },
  });

  const beginRecording =
    useCallback(async () => {
      try {
        recordingFinishedRef.current =
          false;

        await startRecording();

        if (
          !mountedRef.current
        ) {
          return;
        }

        exerciseStartedAtRef.current =
          Date.now();

        setLiveVolume(-60);
        setLiveStability(0);
        liveHistoryRef.current = [];
        setLivePitch(null);
        setLiveNote('--');

        setRemainingSeconds(
          totalExerciseSeconds,
        );

        setPhase(
          'exercise',
        );
      } catch (error) {
        console.error(
          'Unable to start recording:',
          error,
        );

        if (
          mountedRef.current
        ) {
          setPhase(
            'directions',
          );

          setReferenceError(
            'Microphone could not be started. Please check microphone permission.',
          );
        }
      }
    }, [
      startRecording,
      totalExerciseSeconds,
    ]);

  useEffect(() => {
    if (
      phase !== 'countdown'
    ) {
      return;
    }

    setCountdown(
      COUNTDOWN_SECONDS,
    );

    const interval =
      setInterval(() => {
        setCountdown(
          (value) => {
            if (value <= 1) {
              clearInterval(
                interval,
              );

              void beginRecording();

              return 0;
            }
            return value - 1;
          },
        );
      }, 1000);

    return () => {
      clearInterval(
        interval,
      );
    };
  }, [
    phase,
    beginRecording,
  ]);

  useEffect(() => {
    if (
      phase !== 'exercise'
    ) {
      return;
    }

    const interval =
      setInterval(() => {
        const startedAt =
          exerciseStartedAtRef.current;

        if (!startedAt) {
          return;
        }

        const elapsed =
          (Date.now() -
            startedAt) /
          1000;

        const remaining =
          Math.max(
            0,
            Math.ceil(
              totalExerciseSeconds -
                elapsed,
            ),
          );

        setRemainingSeconds(
          remaining,
        );

        if (
          elapsed >=
          totalExerciseSeconds
        ) {
          clearInterval(
            interval,
          );

          void stopRecording();
        }
      }, 100);

    return () => {
      clearInterval(
        interval,
      );
    };
  }, [
    phase,
    stopRecording,
    totalExerciseSeconds,
  ]);

  const startExercise =

    useCallback(() => {
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
      setRemainingSeconds(
        totalExerciseSeconds,
      );

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setReferenceError(null);

      setPhase(
        'countdown',
      );

      setTimeout(() => {
        if (
          mountedRef.current
        ) {
          setIsStarting(false);
        }
      }, 400);
    }, [
      paramsReady,
      hasPlayedReference,
      isStarting,
      totalExerciseSeconds,
    ]);

  /* =======================================================
     RESET
     ======================================================= */

  const resetExercise =
    useCallback(() => {
      setMeasurement(null);
      setScore(null);
      setLiveVolume(-60);
      setLiveStability(0);
      liveHistoryRef.current = [];

      setRemainingSeconds(
        totalExerciseSeconds,
      );

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setReferenceError(null);
      setHasPlayedReference(
        false,
      );

      setReferencePlaying(
        false,
      );

      recordingFinishedRef.current = false;
      exerciseStartedAtRef.current = null;

      setPhase(
        'directions',
      );
    }, [
      totalExerciseSeconds,
    ]);

  const voiceDetected =
    livePitch !== null &&
    Number.isFinite(livePitch) &&
    livePitch > 0 &&
    liveNote !== '--';

  const centsFromTarget =
    voiceDetected && livePitch !== null
      ? Math.round(
          1200 *
            Math.log2(
              livePitch / REFERENCE_NOTE.frequency,
            ),
        )
      : null;

  const pitchOnTarget =
    centsFromTarget !== null &&
    Math.abs(centsFromTarget) <= 50;

  const pitchMarkerPercent =
    centsFromTarget === null
      ? 50
      : Math.max(
          4,
          Math.min(
            96,
            50 + centsFromTarget / 2,
          ),
        );

  const pitchGuideText =
    !voiceDetected
      ? `Sing ${NOTE} on “Ah” to start tracking your pitch.`
      : pitchOnTarget
        ? `Great — you're close to ${NOTE}. Keep the note and volume steady.`
        : `You're singing ${liveNote}. Gently adjust toward ${NOTE} and follow the marker.`;

  const cancelAndLeave = useCallback(() => {
    if (phase === 'exercise') {
      recordingFinishedRef.current = true;
      void stopRecording();
    }
    router.back();
  }, [phase, stopRecording]);

  /* =======================================================
     PREPARING YOUR EXERCISE
  ======================================================= */

  if (!paramsReady) {
    return (
      <SafeAreaView style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons
            name="options-outline"
            size={32}
            color="#D86C89"
          />
        </View>

        <Text style={styles.preparingTitle}>
          Preparing Your Exercise
        </Text>

        <Text style={styles.preparingSubtitle}>
          Adjusting the exercise to your current difficulty level and preparing your session.
        </Text>

        <ActivityIndicator
          size="large"
          color="#D86C89"
          style={styles.preparingSpinner}
        />
      </SafeAreaView>
    );
  }

  if (phase === 'directions') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ExerciseScreen
          title="Volume Control Stability"
          category="VOLUME CONTROL"
          icon="options-outline"
          instructions={`Listen to the ${NOTE} reference note, sing it on “Ah,” and keep your volume as steady as possible.`}
          preparationSteps={[
            { icon: 'musical-note-outline', text: `Play the ${NOTE} reference note and listen carefully.` },
            { icon: 'mic-outline', text: 'Take a comfortable breath before singing.' },
            { icon: 'pulse-outline', text: `Sing ${NOTE} on “Ah” and keep your volume steady.` },
            { icon: 'timer-outline', text: `Hold the note for ${durationSeconds} seconds per repetition.` },
          ]}
          summary={[
            { label: 'Duration', value: `${durationSeconds} sec`, hint: 'per repetition' },
            { label: 'Repetitions', value: String(repetitions) },
            { label: 'Stability target', value: `${Math.round(targetStability)}%` },
          ]}
          targetValue={`${Math.round(targetStability)}%`}
          targetHint="Keep your volume consistent throughout the note."
          repetitions={repetitions}
          tip="Choose a comfortable volume first. Avoid sudden changes in loudness while sustaining the note."
          tier={resolvedTier}
          onBack={cancelAndLeave}
          onStart={startExercise}
          startDisabled={!paramsReady || referencePlaying || isStarting}
          startLabel={paramsReady ? 'Start Exercise' : 'Loading Exercise...'}
          error={referenceError}
        >
          <View style={styles.referenceCard}>
            <View style={styles.referenceTopRow}>
              <View>
                <Text style={styles.referenceLabel}>REFERENCE NOTE</Text>
                <Text style={styles.referenceNote}>{NOTE}</Text>
              </View>
              <View style={styles.noteIconCircle}>
                <Ionicons name="musical-note" size={22} color="#4E2F1F" />
              </View>
            </View>
            <Text style={styles.referenceInstruction}>Play the note, then sing it on “Ah” while keeping your volume steady.</Text>
            <Pressable
              style={[styles.referenceButton, referencePlaying && styles.disabled]}
              disabled={referencePlaying}
              onPress={() => void playReferenceNote()}
            >
              <Ionicons name={referencePlaying ? 'volume-high' : 'play'} size={17} color="#D86C89" />
              <Text style={styles.referenceButtonText}>{referencePlaying ? 'Playing...' : `Play ${NOTE}`}</Text>
            </Pressable>
          </View>
          <View style={styles.referenceCard}>
            <Text style={styles.referenceLabel}>WHAT TO FOCUS ON</Text>
            <Text style={styles.referenceInstruction}>The exercise evaluates how consistently you sustain your voice and maintain the sound over time. It does not directly measure airflow or calibrated sound pressure.</Text>
          </View>
        </ExerciseScreen>
      </SafeAreaView>
    );
  }

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="pulse-outline"
        title="Get Ready"
        countdown={countdown}
        promptTitle={`Prepare to sing ${NOTE}.`}
        prompt={`Start singing on “Ah” when the countdown reaches zero. Keep your volume steady for ${durationSeconds} seconds per repetition.`}
        onBack={cancelAndLeave}
      />
    );
  }

  if (phase === 'exercise') {
    const elapsedTotal = Math.max(0, totalExerciseSeconds - remainingSeconds);
    const currentRep = Math.min(repetitions, Math.floor(elapsedTotal / Math.max(1, durationSeconds)) + 1);
    const currentRepElapsed = elapsedTotal % Math.max(1, durationSeconds);

    return (
      <SafeAreaView style={styles.safeArea}>
        <ExerciseListeningScreen
          icon="pulse-outline"
          title="Volume Control Stability"
          currentRep={currentRep}
          repetitions={repetitions}
          elapsed={Math.min(durationSeconds, currentRepElapsed)}
          targetDuration={durationSeconds}
          promptTitle="Keep your voice steady"
          prompt={`Sing ${NOTE} on “Ah” at a comfortable volume. Avoid sudden loudness changes until the timer ends.`}
          progress={Math.min(100, (elapsedTotal / Math.max(1, totalExerciseSeconds)) * 100)}
          onBack={cancelAndLeave}
          liveContent={
            <View style={styles.liveContent}>
              <Pressable
                style={[styles.referenceButton, referencePlaying && styles.disabled]}
                disabled={referencePlaying}
                onPress={() => void playReferenceNote()}
              >
                <Ionicons name={referencePlaying ? 'volume-high' : 'play'} size={17} color="#D86C89" />
                <Text style={styles.referenceButtonText}>{referencePlaying ? 'Playing...' : `Replay ${NOTE}`}</Text>
              </Pressable>
              <View style={styles.liveCard}>
                <Text style={styles.eyebrow}>YOUR LIVE VOLUME</Text>
                <View style={styles.liveVolumeRow}>
                  <Text style={styles.liveVolume}>{liveVolume > -60 ? Math.round(liveVolume + 70) : '--'}</Text>
                  <Text style={styles.liveUnit}>level</Text>
                </View>
                <View style={styles.statusBadge}>
                  <View style={[styles.statusDot, { backgroundColor: liveStability >= targetStability ? '#D86C89' : '#8E7770' }]} />
                  <Text style={styles.statusText}>{liveStability >= targetStability ? 'STEADY SO FAR' : 'KEEP IT STEADY'}</Text>
                </View>
              </View>
              <View style={styles.liveCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>Volume stability</Text>
                  <Text style={styles.targetRange}>{Math.round(liveStability)}%</Text>
                </View>
                <Text style={styles.mutedSmall}>A live estimate of how consistent your detected volume has been.</Text>
                <View style={styles.stabilityTrack}>
                  <View style={[styles.stabilityFill, { width: `${Math.max(0, Math.min(100, liveStability))}%` }]} />
                  <View style={styles.stabilityTargetMarker} />
                </View>
                <View style={styles.rowBetween}>
                  <Text style={styles.scaleText}>Less steady</Text>
                  <Text style={styles.scaleText}>More steady</Text>
                </View>
              </View>
              <View style={styles.liveCard}>
                <Text style={styles.cardTitle}>Detected note</Text>
                <Text style={styles.referenceNote}>{voiceDetected ? liveNote : 'Listening...'}</Text>
                <Text style={styles.mutedSmall}>{voiceDetected && livePitch !== null ? `${livePitch.toFixed(1)} Hz` : 'Sing near the microphone to show the detected note.'}</Text>
              </View>
            </View>
          }
        />
      </SafeAreaView>
    );
  }

  /* =======================================================
     RESULTS
  ======================================================= */

  const finalScore =
    score?.overallScore ?? 0;

  const stabilityScore =
    measurement?.stability ?? 0;

  const durationScore =
    measurement?.durationScore ??
    0;

  const voicedCoverage =
    measurement?.voicedCoveragePercent ??
    0;

  const resultPassed =
    score?.passed ?? false;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExerciseResultsScreen
        title="Volume Stability Results"
        subtitle={score?.feedback ?? 'Your result reflects volume consistency and sustained vocal coverage during the exercise.'}
        score={Math.round(finalScore)}
        scoreSuffix="/100"
        resultIcon={resultPassed ? 'checkmark-circle' : 'refresh-circle'}
        scoreMessage={resultPassed ? 'Exercise passed' : 'Keep practicing'}
        scoreDetails={
          <View style={styles.resultCard}>
            {[
              { label: 'Repetition 1', value: `${Math.round(measurement?.repStability?.[0] ?? 0)}%` },
              { label: 'Repetition 2', value: `${Math.round(measurement?.repStability?.[1] ?? 0)}%` },
              { label: 'Volume Stability', value: `${Math.round(stabilityScore)}%` },
              { label: 'Duration Score', value: `${Math.round(durationScore)}%` },
              {
                label: 'Average microphone level',
                value: measurement?.averageDb !== undefined
                  ? `${Math.max(0, Math.min(70, Math.round(measurement.averageDb + 70)))}/70 relative level`
                  : '--',
              },
              { label: 'Voiced Coverage', value: `${Math.round(voicedCoverage)}%` },
              { label: 'Measurement Quality', value: `${Math.round(measurement?.measurementQuality ?? 0)}%` },
            ].map((item, index, rows) => (
              <View
                key={item.label}
                style={[
                  styles.resultRow,
                  index === rows.length - 1 && styles.lastResultRow,
                ]}
              >
                <Text style={styles.resultLabel}>{item.label}</Text>
                <Text style={styles.resultValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        }
        onRetry={startExercise}
        onExit={() => router.back()}
      >
        {resultPassed && (
          <Pressable style={styles.nextButton} onPress={() => router.replace('/exercises/volume' as any)}>
            <Ionicons name="arrow-forward" size={18} color="#D86C89" />
            <Text style={styles.nextButtonText}>Next Exercise</Text>
          </Pressable>
        )}
      </ExerciseResultsScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  preparingScreen: {
    flex: 1,
    backgroundColor: '#FFF8FA',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },

  preparingIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },

  preparingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    fontWeight: '800',
    color: '#4E2F1F',
    textAlign: 'center',
  },

  preparingSubtitle: {
    marginTop: 6,
    maxWidth: 285,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
    color: '#8E7770',
    textAlign: 'center',
  },

  preparingSpinner: {
    marginTop: 24,
  },

  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  disabled: { opacity: 0.55 },
  liveContent: { gap: 12 },
  liveCard: { padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F2DDE5' },
  eyebrow: { color: '#8E7770', fontFamily: 'FredokaBold', fontSize: 10, letterSpacing: 1 },
  liveVolumeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 4 },
  liveVolume: { color: '#4E2F1F', fontFamily: 'FredokaBold', fontSize: 32 },
  liveUnit: { color: '#8E7770', fontFamily: 'FredokaRegular', fontSize: 12 },
  statusBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#FFF8FA' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: '#765D63', fontFamily: 'FredokaBold', fontSize: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#4E2F1F', fontFamily: 'FredokaSemiBold', fontSize: 15 },
  targetRange: { color: '#D86C89', fontFamily: 'FredokaSemiBold', fontSize: 12 },
  mutedSmall: { marginTop: 4, color: '#8E7770', fontFamily: 'FredokaRegular', fontSize: 11, lineHeight: 16 },
  stabilityTrack: { position: 'relative', height: 12, marginTop: 12, borderRadius: 8, backgroundColor: '#FFF8FA', overflow: 'hidden' },
  stabilityFill: { height: '100%', borderRadius: 8, backgroundColor: '#D86C89' },
  scaleText: { color: '#8E7770', fontFamily: 'FredokaRegular', fontSize: 9 },
  resultCard: {
    width: '100%',
    marginTop: 8,
    paddingHorizontal: 15,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },
  resultRow: {
    minHeight: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F4E9EC',
    gap: 12,
  },
  lastResultRow: {
    borderBottomWidth: 0,
  },
  resultLabel: {
    flex: 1,
    color: '#765D63',
    fontFamily: 'FredokaRegular',
    fontSize: 12,
  },
  resultValue: {
    color: '#4E2F1F',
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    textAlign: 'right',
    flexShrink: 1,
  },
  nextButton: { marginTop: 12, minHeight: 46, borderRadius: 15, borderWidth: 1, borderColor: '#F2DDE5', backgroundColor: '#FFF8FA', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  nextButtonText: { color: '#4E2F1F', fontFamily: 'FredokaSemiBold', fontSize: 13 },

  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  headerSide: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },

  headerTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    fontWeight: '800',
    color: '#4E2F1F',
  },

  headerSubtitle: {
    marginTop: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: '#8E7770',
  },

  /* SCROLL */

  scrollContent: {
    paddingTop: 8,
    gap: 12,
  },

  /* HERO */

  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },

  screenTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
    color: '#4E2F1F',
    textAlign: 'center',
  },

  screenDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: '#8E7770',
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  /* REFERENCE */

  referenceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    elevation: 2,
  },

  referenceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  referenceLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#8E7770',
  },

  referenceNote: {
    marginTop: 1,
    fontFamily: 'FredokaBold',
    fontSize: 31,
    fontWeight: '900',
    color: '#D86C89',
  },

  noteIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFF8FA',
    alignItems: 'center',
    justifyContent: 'center',
  },

  referenceInstruction: {
    marginTop: 8,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
    color: '#765D63',
  },

  referenceButton: {
    marginTop: 12,
    minHeight: 47,
    borderRadius: 14,
    backgroundColor: '#D86C89',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  referenceButtonDisabled: {
    opacity: 0.7,
  },

  referenceButtonText: {
    color: '#FFFFFF',
    fontFamily: 'FredokaBold',
    fontSize: 13,
    fontWeight: '800',
  },

  referenceReadyRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  referenceReadyText: {
    flex: 1,
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: '#2E9B62',
    fontWeight: '600',
  },

  errorText: {
    marginTop: 8,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: '#C54545',
  },

  parameterCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    elevation: 2,
  },

  sectionLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '800',
    color: '#8E7770',
  },

  parameterGrid: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },

  parameterItem: {
    width: '48%',
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: '#FFF8FA',
    alignItems: 'center',
    justifyContent: 'center',
  },

  parameterValue: {
    marginTop: 3,
    fontFamily: 'FredokaBold',
    fontSize: 16,
    fontWeight: '800',
    color: '#4E2F1F',
  },

  parameterLabel: {
    marginTop: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: '#8D858A',
    textAlign: 'center',
  },

  /* DIRECTIONS */

  directionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    elevation: 2,
  },

  directionRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },

  directionNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  directionNumberText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    fontWeight: '800',
    color: '#D86C89',
  },

  directionText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
    color: '#765D63',
  },

  tipCard: {
    minHeight: 48,
    borderRadius: 15,
    paddingHorizontal: 13,
    backgroundColor: '#FFF8FA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: '#765D63',
  },

  varianceText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: '#8E878B',
    textAlign: 'center',
  },

  helperText: {
    marginTop: -4,
    textAlign: 'center',
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: '#8E7770',
  },

  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: '#D86C89',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },

  primaryButtonDisabled: {
    backgroundColor: '#D9B4C2',
  },

  primaryButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  /* COUNTDOWN */

  countdownScreen: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 35,
  },

  countdownTop: {
    alignItems: 'center',
  },

  countdownTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    fontWeight: '900',
    color: '#4E2F1F',
  },

  countdownInstruction: {
    marginTop: 6,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: '#7C7479',
    textAlign: 'center',
  },

  countdownCircle: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
  },

  countdownNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    fontWeight: '900',
    color: '#D86C89',
  },

  countdownBottom: {
    alignItems: 'center',
  },

  readyNoteBadge: {
    minHeight: 37,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: '#FFF8FA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  readyNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    fontWeight: '700',
    color: '#5F575C',
  },

  countdownHint: {
    marginTop: 8,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: '#8A8287',
  },

  exerciseContainer: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    gap: 13,
    paddingTop: 13,
    paddingBottom: 18,
    backgroundColor: '#FFF8FA',
  },

  exerciseTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  exerciseLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.15,
    color: '#B67A91',
  },

  exerciseNote: {
    marginTop: 2,
    fontFamily: 'FredokaBold',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '900',
    color: '#4E2F1F',
  },

  timerBadge: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F2DDE5',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    elevation: 2,
  },

  timerText: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    lineHeight: 19,
    fontWeight: '900',
    color: '#4E2F1F',
  },

  /* LIVE PITCH TRACKER */

  pitchTargetBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 13,
    backgroundColor: '#FFF8FA',
    alignItems: 'center',
  },

  pitchTargetText: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.45,
    color: '#D86C89',
  },

  pitchReadoutLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#8E7770',
  },

  pitchFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: '#8E7770',
  },

  pitchStatusBadge: {
    minHeight: 26,
    paddingHorizontal: 8,
    borderRadius: 13,
    backgroundColor: '#FFF8FA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  pitchStatusIdle: {
    backgroundColor: '#F2F2F2',
  },

  pitchStatusMatched: {
    backgroundColor: '#EAF7EF',
  },

  pitchStatusOffTarget: {
    backgroundColor: '#FFF8FA',
  },

  pitchStatusText: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    fontWeight: '900',
    color: '#D86C89',
  },

  pitchStatusTextMatched: {
    color: '#278451',
  },

  pitchGauge: {
    position: 'relative',
    marginTop: 3,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F2DDE5',
    overflow: 'visible',
  },

  pitchGaugeCenter: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: '#927482',
  },

  pitchGaugeMarker: {
    position: 'absolute',
    top: 2,
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: '#D86C89',
    elevation: 3,
  },

  pitchGaugeLabels: {
    marginTop: -7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  pitchGaugeLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: '#8E7770',
  },

  pitchGaugeLabelTarget: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    fontWeight: '900',
    color: '#927482',
  },

  pitchFeedbackCard: {
    marginTop: 0,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: '#FFF8FA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  pitchFeedbackCardMatched: {
    backgroundColor: '#EFF8F2',
  },

  pitchFeedbackText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: '#765D63',
  },

  pitchFeedbackTextMatched: {
    color: '#278451',
  },

  /* STABILITY */

  stabilityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 15,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    elevation: 2,
  },

  stabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  stabilityTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    fontWeight: '900',
    color: '#4E2F1F',
  },

  stabilitySubtitle: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: '#8E7770',
  },

  stabilityValue: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    fontWeight: '900',
    color: '#D86C89',
  },

  progressTrack: {
    marginTop: 12,
    height: 10,
    borderRadius: 6,
    backgroundColor: '#F2DDE5',
    overflow: 'hidden',
    position: 'relative',
  },

  progressFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#D86C89',
  },

  progressLabels: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  progressLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    fontWeight: '600',
    color: '#8E7770',
  },

  exerciseHeadingCopy: {
    flex: 1,
    gap: 1,
  },

  exerciseGoal: {
    marginTop: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 14,
    color: '#8E7770',
  },

  timerCaption: {
    fontFamily: 'FredokaBold',
    fontSize: 7,
    lineHeight: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: '#8E7770',
  },

  pitchCoachCard: {
    padding: 15,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F2DDE5',
    elevation: 3,
    gap: 12,
  },

  pitchCoachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  pitchCoachIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: '#FFF8FA',
    alignItems: 'center',
    justifyContent: 'center',
  },

  pitchCoachHeaderCopy: {
    flex: 1,
  },

  pitchCoachTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    fontWeight: '900',
    color: '#4B303A',
  },

  pitchCoachSubtitle: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 14,
    color: '#8E7770',
  },

  pitchTargetFrequency: {
    marginTop: 2,
    fontFamily: 'FredokaBold',
    fontSize: 8,
    fontWeight: '700',
    color: '#D86C89',
  },

  pitchReadoutPanel: {
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 18,
    alignItems: 'center',
    backgroundColor: '#FFF8FA',
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  pitchDetectedNote: {
    marginTop: 1,
    fontFamily: 'FredokaBold',
    fontSize: 42,
    lineHeight: 47,
    fontWeight: '900',
    color: '#D86C89',
    textAlign: 'center',
  },

  pitchDetectedNoteMatched: {
    color: '#278451',
  },

  pitchDetectedNoteWaiting: {
    fontFamily: 'FredokaRegular',
    fontSize: 30,
    color: '#B9A7A3',
  },

  pitchGaugeHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: -5,
  },

  pitchSectionLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#4E2F1F',
  },

  pitchSectionHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: '#8E7770',
  },

  pitchTargetZone: {
    position: 'absolute',
    left: '25%',
    width: '50%',
    top: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: '#EAF7EF',
    borderWidth: 1,
    borderColor: '#D3EDDC',
  },

  pitchGaugeTick: {
    position: 'absolute',
    top: 7,
    bottom: 7,
    width: 1,
    backgroundColor: '#E1D0D8',
  },

  pitchGaugeMarkerMatched: {
    backgroundColor: '#278451',
  },

  stabilityTitleCopy: {
    flex: 1,
  },

  stabilityTargetMarker: {
    position: 'absolute',
    left: '60%',
    top: -2,
    bottom: -2,
    width: 2,
    borderRadius: 1,
    backgroundColor: '#4E2F1F',
  },

  resultsScreen: {
    flex: 1,
    backgroundColor: '#FFF8FA',
  },

  resultsHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  resultsHeaderCenter: {
    flex: 1,
    alignItems: 'center'
  },

  resultsScroll: {
    flex: 1,
  },

  resultsScrollContent: {
    paddingTop: 7,
    paddingBottom: 10,
  },

  resultStatusBadge: {
    alignSelf: 'center',
    minHeight: 25,
    paddingHorizontal: 10,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  resultStatusPassed: {
    backgroundColor: '#2E9B62',
  },

  resultStatusPractice: {
    backgroundColor: '#D86C89',
  },

  resultStatusText: {
    color: '#FFFFFF',
    fontFamily: 'FredokaBold',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.7,
  },

  resultTitle: {
    marginTop: 8,
    fontFamily: 'FredokaBold',
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
    color: '#4E2F1F',
    textAlign: 'center',
  },

  resultDescription: {
    marginTop: 4,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: '#8E7770',
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  resultScoreSection: {
    marginTop: 9,
    alignItems: 'center',
  },

  resultScoreCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
  },

  resultScoreNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 31,
    lineHeight: 35,
    fontWeight: '900',
    color: '#2F252A',
  },

  resultScoreOutOf: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: '#8E7770',
  },

  resultScoreLabel: {
    marginTop: 3,
    fontFamily: 'FredokaBold',
    fontSize: 8.5,
    fontWeight: '700',
    color: '#D86C89',
  },

  compactResultsCard: {
    marginTop: 9,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },

  compactResultRow: {
    minHeight: 27,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  compactResultRowBorder: {
    borderBottomWidth:
      StyleSheet.hairlineWidth,
    borderBottomColor: '#F2DDE5',
  },

  compactResultLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: '#8E7770',
  },

  compactResultValue: {
    fontFamily: 'FredokaBold',
    fontSize: 9.5,
    fontWeight: '800',
    color: '#4E2F1F',
  },

  formulaCard: {
    marginTop: 7,
    borderRadius: 14,
    backgroundColor: '#FFF8FA',
    paddingHorizontal: 11,
    paddingVertical: 8,
  },

  formulaTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 8,
    fontWeight: '800',
    color: '#765D63',
  },

  formulaMain: {
    marginTop: 2,
    fontFamily: 'FredokaBold',
    fontSize: 9.5,
    fontWeight: '800',
    color: '#D86C89',
  },

  formulaDescription: {
    marginTop: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 7.5,
    lineHeight: 11,
    color: '#8E7770',
  },

  targetCompactCard: {
    marginTop: 7,
    minHeight: 47,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    elevation: 1,
  },

  targetCompactItem: {
    flex: 1,
    alignItems: 'center',
  },

  targetCompactLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 7.5,
    color: '#8E7770',
  },

  targetCompactValue: {
    marginTop: 2,
    fontFamily: 'FredokaBold',
    fontSize: 10,
    fontWeight: '800',
    color: '#4E2F1F',
  },

  targetCompactDivider: {
    width: StyleSheet.hairlineWidth,
    height: 25,
    backgroundColor: '#F2DDE5',
  },

  resultsFooter: {
    paddingTop: 7,
    backgroundColor: '#FFF8FA',
  },

  backToListButton: {
    minHeight: 44,
    marginTop: 8,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },

  backToListButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    fontWeight: '800',
    color: '#D86C89',
  },

});
