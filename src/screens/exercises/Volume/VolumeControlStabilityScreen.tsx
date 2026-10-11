
import { Ionicons } from '@expo/vector-icons';
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
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';

import {
  VOLUME_CONTROL_STABILITY_PARAMS,
  type Tier,
} from '@/constants/exercises/volume';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { generateVolumeControlStabilityParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureVolumeControlStability } from '@/services/measurement/volume/volumeControlStability';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreVolumeControlStability } from '@/services/scoring/volume/volumeControlStability';
import { playSingleNote } from '@/utils/music/notePlayer';
import { createMusicalNote } from '@/utils/music/notes';

const CURRENT_TIER: Tier = 'beginner';
const DEFAULT_PARAMS = VOLUME_CONTROL_STABILITY_PARAMS[CURRENT_TIER];

const NOTE = 'C4';
const REFERENCE_NOTE = createMusicalNote(60);
const REFERENCE_NOTE_DURATION_SEC = 1.5;
const COUNTDOWN_SECONDS = 3;

const PINK = '#FCD6DD';
const BROWN = '#4E2F1F';
const MUTED = '#8E7770';
const LIGHT_PINK = '#FFF8FA';
const BORDER = '#F2DDE5';
const WHITE = '#FFFFFF';
const LIGHT_GRAY = '#F2F2F2';

type Phase = 'directions' | 'countdown' | 'exercise' | 'results';

interface HistoryPoint {
  value: number;
  time: number;
}

type MeasurementResult = ReturnType<typeof measureVolumeControlStability>;
type ScoreResult = ReturnType<typeof scoreVolumeControlStability>;

export default function VolumeControlStabilityScreen({
  tier,
}: {
  tier?: Tier;
}) {
  const { height } = useWindowDimensions();
  const isSmallScreen = height < 700;

  const [phase, setPhase] = useState<Phase>('directions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [remainingSeconds, setRemainingSeconds] = useState(
    DEFAULT_PARAMS.durationSec * DEFAULT_PARAMS.repetitions,
  );

  const [liveVolume, setLiveVolume] = useState(-60);
  const [liveStability, setLiveStability] = useState(0);
  const [liveHistory, setLiveHistory] = useState<HistoryPoint[]>([]);

  const [measurement, setMeasurement] =
    useState<MeasurementResult | null>(null);
  const [score, setScore] = useState<ScoreResult | null>(null);

  const [hasPlayedReference, setHasPlayedReference] = useState(false);
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const [resolvedTier, setResolvedTier] = useState<Tier>(
    tier ?? CURRENT_TIER,
  );
  const [exerciseParams, setExerciseParams] = useState(DEFAULT_PARAMS);
  const [paramsReady, setParamsReady] = useState(false);

  const phaseRef = useRef<Phase>(phase);
  const mountedRef = useRef(true);
  const cancelledRef = useRef(false);

  // These flags have different purposes:
  // recordingFinishedRef prevents duplicate result processing.
  // stopRequestedRef prevents the timer from requesting stop repeatedly.
  const recordingFinishedRef = useRef(false);
  const stopRequestedRef = useRef(false);

  const exerciseStartedAtRef = useRef<number | null>(null);
  const stopRecordingRef = useRef<(() => void | Promise<void>) | null>(null);

  const paramsRef = useRef(exerciseParams);
  const tierRef = useRef(resolvedTier);

  phaseRef.current = phase;
  paramsRef.current = exerciseParams;
  tierRef.current = resolvedTier;

  const durationSeconds = exerciseParams.durationSec;
  const repetitions = exerciseParams.repetitions;
  const targetStability = exerciseParams.stabilityThreshold;
  const amplitudeVariancePercent = exerciseParams.amplitudeVariancePct;
  const totalExerciseSeconds = durationSeconds * repetitions;

  // Load the user's tier and adaptive exercise parameters.
  useEffect(() => {
    let cancelled = false;

    const loadParameters = async () => {
      try {
        const user = auth.currentUser;
        let selectedTier: Tier = tier ?? CURRENT_TIER;
        let recentScores: number[] = [];

        if (user) {
          if (!tier) {
            const progress = await fetchComponentProgress(user.uid, 'volume');
            selectedTier = progress?.currentTier ?? CURRENT_TIER;
          }

          const records = await fetchExerciseRecords(user.uid, 'volume');

          const matchingRecords = records
            .filter(
              (record) =>
                record.templateId === 'volumeControlStability' &&
                record.tier === selectedTier,
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          recentScores = matchingRecords
            .slice(-5)
            .map((record) => Number(record.scorePct))
            .filter(Number.isFinite);

          // Assessment is only a cold-start reference when no matching
          // same-template, same-tier exercise history exists.
          if (recentScores.length === 0) {
            const latestAssessment = await getLatestAssessment();
            const assessmentScore = latestAssessment?.scores.find(
              (item) => item.componentId === 'volume',
            )?.scorePct;

            if (
              assessmentScore !== undefined &&
              Number.isFinite(Number(assessmentScore))
            ) {
              recentScores = [Number(assessmentScore)];
            }
          }
        }

        const generatedParams = generateVolumeControlStabilityParams({
          tier: selectedTier,
          recentScores,
        });

        if (cancelled) return;

        setResolvedTier(selectedTier);
        tierRef.current = selectedTier;

        setExerciseParams(generatedParams);
        paramsRef.current = generatedParams;

        setRemainingSeconds(
          generatedParams.durationSec * generatedParams.repetitions,
        );

        setParamsReady(true);
      } catch (error) {
        console.error(
          'Failed to load Volume Control Stability parameters:',
          error,
        );

        if (!cancelled) {
          const fallbackTier = tier ?? CURRENT_TIER;

          setResolvedTier(fallbackTier);
          tierRef.current = fallbackTier;

          setExerciseParams(DEFAULT_PARAMS);
          paramsRef.current = DEFAULT_PARAMS;

          setRemainingSeconds(
            DEFAULT_PARAMS.durationSec * DEFAULT_PARAMS.repetitions,
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

  const playReferenceNote = useCallback(async () => {
    if (referencePlaying) return;

    setReferenceError(null);
    setReferencePlaying(true);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        playSingleNote(
          REFERENCE_NOTE.frequency,
          REFERENCE_NOTE_DURATION_SEC,
        ),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Reference note playback timed out')),
            4000,
          );
        }),
      ]);

      if (mountedRef.current) {
        setHasPlayedReference(true);
      }
    } catch (error) {
      console.error('[C4] Reference playback failed:', error);

      if (mountedRef.current) {
        setHasPlayedReference(false);
        setReferenceError(
          'Unable to play the C4 reference note. Please try again.',
        );
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);

      if (mountedRef.current) {
        setReferencePlaying(false);
      }
    }
  }, [referencePlaying]);

  const { startRecording, stopRecording } = useAudioRecorder({
    onFrame: (frame) => {
      if (
        !mountedRef.current ||
        phaseRef.current !== 'exercise' ||
        cancelledRef.current
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

      if (!isVoiced) return;

      const now = Date.now();

      setLiveHistory((previous) => {
        const next = [...previous, { value: db, time: now }].slice(-40);
        const amplitudes = next.map((item) => Math.pow(10, item.value / 20));

        if (amplitudes.length < 2) {
          setLiveStability(0);
          return next;
        }

        const mean =
          amplitudes.reduce((sum, value) => sum + value, 0) /
          amplitudes.length;

        if (mean <= 0 || !Number.isFinite(mean)) {
          setLiveStability(0);
          return next;
        }

        const variance =
          amplitudes.reduce(
            (sum, value) => sum + Math.pow(value - mean, 2),
            0,
          ) / amplitudes.length;

        const standardDeviation = Math.sqrt(variance);
        const stability = 100 - (standardDeviation / mean) * 100;

        setLiveStability(Math.max(0, Math.min(100, stability)));

        return next;
      });
    },

    onStop: (samples, sampleRate) => {
      if (!mountedRef.current || recordingFinishedRef.current) {
        return;
      }

      // Mark as finished only when the recorder has actually stopped.
      // Do not set this before stopRecording(), or this callback can skip
      // measurement, scoring, and saving.
      recordingFinishedRef.current = true;
      stopRequestedRef.current = false;
      exerciseStartedAtRef.current = null;

      if (cancelledRef.current) return;

      try {
        const currentParams = paramsRef.current;

        const measured = measureVolumeControlStability(
          samples,
          sampleRate,
          currentParams.durationSec,
          currentParams.repetitions,
        );

        const scored = scoreVolumeControlStability(measured, {
          passingScore: currentParams.stabilityThreshold,
        });

        setMeasurement(measured);
        setScore(scored);
        setPhase('results');

        void saveCompletedExercise(
          'volume',
          'volumeControlStability',
          tierRef.current,
          scored.overallScore,
        ).catch((error) => {
          console.error('Unable to save Volume Control Stability result:', error);
        });
      } catch (error) {
        console.error('Unable to process volume recording:', error);

        setReferenceError(
          'Unable to process the recording. Please try the exercise again.',
        );
        setPhase('directions');
      }
    },
  });

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  const beginRecording = useCallback(async () => {
    try {
      recordingFinishedRef.current = false;
      stopRequestedRef.current = false;
      cancelledRef.current = false;

      await startRecording();

      if (!mountedRef.current || cancelledRef.current) return;

      exerciseStartedAtRef.current = Date.now();

      setLiveVolume(-60);
      setLiveStability(0);
      setLiveHistory([]);
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

  // Countdown before the recorder starts.
  useEffect(() => {
    if (phase !== 'countdown') return;

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

    return () => clearInterval(interval);
  }, [phase, beginRecording]);

  // Exercise timer. stopRequestedRef prevents duplicate stop calls while
  // waiting for the recorder's onStop callback.
  useEffect(() => {
    if (phase !== 'exercise') return;

    const interval = setInterval(() => {
      const startedAt = exerciseStartedAtRef.current;
      if (startedAt === null) return;

      const elapsed = (Date.now() - startedAt) / 1000;
      const remaining = Math.max(
        0,
        Math.ceil(totalExerciseSeconds - elapsed),
      );

      setRemainingSeconds(remaining);

      if (
        elapsed >= totalExerciseSeconds &&
        !recordingFinishedRef.current &&
        !stopRequestedRef.current
      ) {
        stopRequestedRef.current = true;
        clearInterval(interval);

        Promise.resolve(stopRecordingRef.current?.()).catch((error) => {
          console.error('Unable to stop recording:', error);

          if (mountedRef.current) {
            stopRequestedRef.current = false;
            exerciseStartedAtRef.current = null;
            recordingFinishedRef.current = false;
            setReferenceError(
              'Unable to finish the recording. Please try again.',
            );
            setPhase('directions');
          }
        });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [phase, totalExerciseSeconds]);

  const startExercise = useCallback(() => {
    if (!paramsReady || !hasPlayedReference || isStarting) return;

    setIsStarting(true);
    setMeasurement(null);
    setScore(null);
    setLiveHistory([]);
    setLiveVolume(-60);
    setLiveStability(0);
    setRemainingSeconds(totalExerciseSeconds);
    setCountdown(COUNTDOWN_SECONDS);
    setReferenceError(null);

    cancelledRef.current = false;
    recordingFinishedRef.current = false;
    stopRequestedRef.current = false;
    exerciseStartedAtRef.current = null;

    setPhase('countdown');
    setIsStarting(false);
  }, [
    paramsReady,
    hasPlayedReference,
    isStarting,
    totalExerciseSeconds,
  ]);

  const resetExercise = useCallback(() => {
    cancelledRef.current = true;
    recordingFinishedRef.current = false;
    stopRequestedRef.current = false;
    exerciseStartedAtRef.current = null;

    setMeasurement(null);
    setScore(null);
    setLiveVolume(-60);
    setLiveStability(0);
    setLiveHistory([]);
    setRemainingSeconds(totalExerciseSeconds);
    setCountdown(COUNTDOWN_SECONDS);
    setReferenceError(null);
    setHasPlayedReference(false);
    setReferencePlaying(false);
    setPhase('directions');
  }, [totalExerciseSeconds]);

  const cancelAndGoBack = useCallback(() => {
    cancelledRef.current = true;
    recordingFinishedRef.current = true;
    stopRequestedRef.current = true;
    exerciseStartedAtRef.current = null;

    if (phaseRef.current === 'exercise') {
      void stopRecordingRef.current?.();
    }

    router.back();
  }, []);

  const graphBars = useMemo(
    () =>
      liveHistory.map((item, index) => {
        const normalized = (item.value + 60) / 60;

        return {
          id: `${item.time}-${index}`,
          height: Math.max(4, Math.min(100, normalized * 100)),
        };
      }),
    [liveHistory],
  );

  const currentRep = Math.min(
    repetitions,
    Math.max(
      1,
      Math.floor(
        (totalExerciseSeconds - remainingSeconds) / durationSeconds,
      ) + 1,
    ),
  );

  const currentRepElapsed = Math.max(
    0,
    durationSeconds -
      (remainingSeconds % durationSeconds || durationSeconds),
  );

  const exerciseProgress =
    totalExerciseSeconds > 0
      ? ((totalExerciseSeconds - remainingSeconds) / totalExerciseSeconds) *
        100
      : 0;

  // ------------------------------------------------------------
  // DIRECTIONS
  // ------------------------------------------------------------
  if (phase === 'directions') {
    return (
      <ExerciseScreen
        title="Volume Control Stability"
        category="VOLUME CONTROL"
        icon="options-outline"
        instructions="Sustain a comfortable C4 note while keeping your vocal volume as steady as possible."
        preparationSteps={[
          {
            icon: 'musical-note',
            text: 'Play and listen to the C4 reference note before beginning.',
          },
          {
            icon: 'mic-outline',
            text: 'Allow microphone access and sing toward your phone naturally.',
          },
          {
            icon: 'water-outline',
            text: 'Take a comfortable breath before each repetition.',
          },
          {
            icon: 'pulse-outline',
            text: 'Keep your volume consistent without forcing your voice.',
          },
        ]}
        summary={[
          { label: 'Reference', value: NOTE, hint: 'C4 note' },
          {
            label: 'Duration',
            value: `${durationSeconds} sec`,
            hint: 'per repetition',
          },
          { label: 'Repetitions', value: String(repetitions) },
          {
            label: 'Stability target',
            value: `${Math.round(targetStability)}%`,
          },
        ]}
        targetValue={`±${amplitudeVariancePercent}%`}
        targetHint="Target amplitude variation"
        repetitions={repetitions}
        tip="Avoid intentionally getting louder or softer. Focus on one steady vocal output."
        tier={resolvedTier}
        onBack={() => router.back()}
        onStart={startExercise}
        error={referenceError}
        startDisabled={!paramsReady || !hasPlayedReference || isStarting}
        startLabel={
          !paramsReady
            ? 'Preparing Exercise...'
            : isStarting
              ? 'Starting...'
              : 'Start Exercise'
        }
      >
        <View style={styles.referenceCard}>
          <View style={styles.referenceTopRow}>
            <View>
              <Text style={styles.referenceLabel}>REFERENCE NOTE</Text>
              <Text style={styles.referenceNote}>{NOTE}</Text>
            </View>

            <View style={styles.referenceIconCircle}>
              <Ionicons name="musical-note" size={22} color={BROWN} />
            </View>
          </View>

          <Text style={styles.referenceInstruction}>
            Listen to the C4 reference first, then sing the same note
            steadily during the exercise.
          </Text>

          <Pressable
            style={[
              styles.referenceButton,
              referencePlaying && styles.buttonDisabled,
            ]}
            onPress={() => void playReferenceNote()}
            disabled={referencePlaying}
          >
            {referencePlaying ? (
              <ActivityIndicator color={BROWN} />
            ) : (
              <>
                <Ionicons name="play" size={18} color={BROWN} />
                <Text style={styles.referenceButtonText}>
                  Play C4 Reference
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </ExerciseScreen>
    );
  }

  // ------------------------------------------------------------
  // GET READY
  // Uses the same shared layout, font, and colors as other exercises.
  // ------------------------------------------------------------
  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="options-outline"
        title="Get Ready"
        countdown={countdown}
        promptTitle="Prepare to sing a steady C4"
        prompt="Breathe comfortably and get ready to maintain a consistent volume."
        onBack={cancelAndGoBack}
      />
    );
  }

  // ------------------------------------------------------------
  // RECORDING / LIVE EXERCISE
  // The shared component owns the outer screen and prompt card.
  // This screen supplies only the live measurement content.
  // ------------------------------------------------------------
  if (phase === 'exercise') {
    return (
      <ExerciseListeningScreen
        icon="options-outline"
        title="Volume Control Stability"
        currentRep={currentRep}
        repetitions={repetitions}
        elapsed={currentRepElapsed}
        targetDuration={durationSeconds}
        promptTitle="Sing steadily"
        prompt="Sing C4 comfortably and keep your vocal volume as consistent as possible."
        progress={exerciseProgress}
        onBack={cancelAndGoBack}
        liveContent={
          <View style={styles.liveContent}>
            <View
              style={[
                styles.mainVolumeCard,
                isSmallScreen && styles.mainVolumeCardSmall,
              ]}
            >
              <Text style={styles.liveLabel}>YOUR VOLUME</Text>

              <Text
                style={[
                  styles.liveVolumeText,
                  isSmallScreen && styles.liveVolumeTextSmall,
                ]}
              >
                {Number.isFinite(liveVolume)
                  ? `${Math.round(liveVolume)} dB`
                  : '--'}
              </Text>

              <View style={styles.volumePulseCircle}>
                <Ionicons
                  name="mic"
                  size={isSmallScreen ? 31 : 38}
                  color={WHITE}
                />
              </View>

              <Text style={styles.volumeStatus}>
                Keep your voice steady
              </Text>
            </View>

            <View style={styles.stabilityCard}>
              <View style={styles.stabilityHeader}>
                <View>
                  <Text style={styles.stabilityTitle}>
                    Volume Stability
                  </Text>
                  <Text style={styles.stabilitySubtitle}>
                    Target: {Math.round(targetStability)}%
                  </Text>
                </View>

                <Text style={styles.stabilityValue}>
                  {Math.round(liveStability)}%
                </Text>
              </View>

              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(100, liveStability)}%`,
                    },
                  ]}
                />
              </View>

              <View style={styles.progressLabels}>
                <Text style={styles.progressLabel}>Unstable</Text>
                <Text style={styles.progressLabel}>Stable</Text>
              </View>
            </View>

            <View style={styles.graphCard}>
              <View style={styles.graphHeader}>
                <Text style={styles.graphTitle}>Live Volume</Text>
                <Text style={styles.graphUnit}>dB</Text>
              </View>

              <View
                style={[
                  styles.graph,
                  isSmallScreen && styles.graphSmall,
                ]}
              >
                <View style={styles.graphCenterLine} />

                {graphBars.length > 0 ? (
                  graphBars.map((bar) => (
                    <View
                      key={bar.id}
                      style={[
                        styles.graphBar,
                        { height: `${bar.height}%` },
                      ]}
                    />
                  ))
                ) : (
                  <Text style={styles.graphPlaceholder}>
                    Your live volume will appear here
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.exerciseHintCard}>
              <Ionicons
                name="ear-outline"
                size={19}
                color={BROWN}
              />
              <Text style={styles.exerciseHintText}>
                Sing comfortably and avoid sudden changes in volume.
              </Text>
            </View>
          </View>
        }
      />
    );
  }

  // ------------------------------------------------------------
  // RESULTS
  // ------------------------------------------------------------
  const finalScore = score?.overallScore ?? 0;
  const stabilityScore = measurement?.stability ?? 0;
  const durationScore = measurement?.durationScore ?? 0;
  const voicedCoverage = measurement?.voicedCoveragePercent ?? 0;
  const resultPassed = score?.passed ?? false;

  return (
    <ExerciseResultsScreen
      title="Volume Stability Results"
      subtitle={
        score?.feedback ??
        'Your result is based on volume stability and voiced coverage.'
      }
      score={Math.round(finalScore)}
      resultIcon={resultPassed ? 'checkmark-circle' : 'refresh-circle'}
      scoreSuffix="/100"
      scoreMessage={resultPassed ? 'Target reached' : 'Keep practicing'}
      onBack={() => router.back()}
      onRetry={resetExercise}
      onExit={() => router.back()}
    >
      <View style={styles.resultsDetails}>
        <View
          style={[
            styles.resultStatusBadge,
            resultPassed
              ? styles.resultStatusPassed
              : styles.resultStatusPractice,
          ]}
        >
          <Ionicons
            name={resultPassed ? 'checkmark-circle' : 'refresh-circle'}
            size={14}
            color={resultPassed ? WHITE : BROWN}
          />

          <Text
            style={[
              styles.resultStatusText,
              !resultPassed && styles.resultStatusTextPractice,
            ]}
          >
            {resultPassed ? 'TARGET REACHED' : 'KEEP PRACTICING'}
          </Text>
        </View>

        <View style={styles.compactResultsCard}>
          {Array.from({ length: repetitions }, (_, index) => (
            <CompactResultRow
              key={`repetition-${index + 1}`}
              label={`Repetition ${index + 1}`}
              value={`${Math.round(measurement?.repStability?.[index] ?? 0)}%`}
            />
          ))}

          <CompactResultRow
            label="Volume Stability"
            value={`${Math.round(stabilityScore)}%`}
          />
          <CompactResultRow
            label="Duration Score"
            value={`${Math.round(durationScore)}%`}
          />
          <CompactResultRow
            label="Average Volume"
            value={
              measurement?.averageDb !== undefined
                ? `${Math.round(measurement.averageDb)} dB`
                : '--'
            }
          />
          <CompactResultRow
            label="Voiced Coverage"
            value={`${Math.round(voicedCoverage)}%`}
          />
          <CompactResultRow
            label="Measurement Quality"
            value={`${Math.round(measurement?.measurementQuality ?? 0)}%`}
            isLast
          />
        </View>

        <View style={styles.formulaCard}>
          <Text style={styles.formulaTitle}>Score Formula</Text>
          <Text style={styles.formulaMain}>
            Stability × 70% + Duration × 30%
          </Text>
          <Text style={styles.formulaDescription}>
            The final score combines volume stability and sustained vocal
            coverage.
          </Text>
        </View>

        <View style={styles.targetCompactCard}>
          <TargetCompactItem label="Reference" value={NOTE} />
          <View style={styles.targetCompactDivider} />
          <TargetCompactItem
            label="Duration"
            value={`${durationSeconds} sec × ${repetitions}`}
          />
          <View style={styles.targetCompactDivider} />
          <TargetCompactItem
            label="Target"
            value={`${Math.round(targetStability)}%`}
          />
        </View>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.replace('/exercises/volume' as any)}
        >
          <Text style={styles.secondaryButtonText}>
            Back to Volume Exercises
          </Text>
          <Ionicons name="arrow-forward" size={18} color={BROWN} />
        </Pressable>
      </View>
    </ExerciseResultsScreen>
  );
}

function CompactResultRow({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View
      style={[
        styles.compactResultRow,
        !isLast && styles.compactResultRowBorder,
      ]}
    >
      <Text style={styles.compactResultLabel}>{label}</Text>
      <Text style={styles.compactResultValue}>{value}</Text>
    </View>
  );
}

function TargetCompactItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.targetCompactItem}>
      <Text style={styles.targetCompactLabel}>{label}</Text>
      <Text style={styles.targetCompactValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Reference note in the directions card
  referenceCard: {
    backgroundColor: WHITE,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },
  referenceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  referenceLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    letterSpacing: 0.5,
    color: MUTED,
  },
  referenceNote: {
    marginTop: 2,
    fontFamily: 'FredokaBold',
    fontSize: 30,
    color: BROWN,
  },
  referenceIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  referenceInstruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 21,
    color: MUTED,
  },
  referenceButton: {
    marginTop: 2,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  referenceButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },

  // Live measurement content inside ExerciseListeningScreen
  liveContent: {
    gap: 12,
    paddingBottom: 4,
  },
  mainVolumeCard: {
    minHeight: 180,
    borderRadius: 18,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  mainVolumeCardSmall: {
    minHeight: 145,
    paddingVertical: 9,
  },
  liveLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: MUTED,
  },
  liveVolumeText: {
    marginTop: 2,
    fontFamily: 'FredokaBold',
    fontSize: 38,
    lineHeight: 46,
    color: BROWN,
    includeFontPadding: false,
  },
  liveVolumeTextSmall: {
    fontSize: 30,
    lineHeight: 37,
  },
  volumePulseCircle: {
    marginTop: 6,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeStatus: {
    marginTop: 7,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  stabilityCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 13,
    borderWidth: 1,
    borderColor: BORDER,
  },
  stabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stabilityTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
  },
  stabilitySubtitle: {
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  stabilityValue: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
  },
  progressTrack: {
    marginTop: 9,
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
  progressLabels: {
    marginTop: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  graphCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  graphHeader: {
    marginBottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  graphTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
  },
  graphUnit: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  graph: {
    height: 68,
    borderRadius: 11,
    backgroundColor: LIGHT_PINK,
    overflow: 'hidden',
    paddingHorizontal: 4,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  graphSmall: {
    height: 52,
  },
  graphCenterLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: BORDER,
  },
  graphBar: {
    width: 4,
    minHeight: 4,
    borderRadius: 2,
    backgroundColor: BROWN,
  },
  graphPlaceholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '35%',
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    textAlign: 'center',
  },
  exerciseHintCard: {
    minHeight: 43,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: LIGHT_PINK,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exerciseHintText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
  },

  // Results details
  resultsDetails: {
    gap: 10,
    paddingBottom: 16,
  },
  resultStatusBadge: {
    alignSelf: 'center',
    minHeight: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  resultStatusPassed: {
    backgroundColor: '#2E9B62',
  },
  resultStatusPractice: {
    backgroundColor: PINK,
  },
  resultStatusText: {
    fontFamily: 'FredokaSemiBold',
    color: WHITE,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  resultStatusTextPractice: {
    color: BROWN,
  },
  compactResultsCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
    overflow: 'hidden',
  },
  compactResultRow: {
    minHeight: 38,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactResultRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  compactResultLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
  },
  compactResultValue: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
  },
  formulaCard: {
    borderRadius: 14,
    backgroundColor: LIGHT_PINK,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  formulaTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },
  formulaMain: {
    marginTop: 4,
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
  },
  formulaDescription: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
  },
  targetCompactCard: {
    minHeight: 64,
    borderRadius: 14,
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderWidth: 1,
    borderColor: BORDER,
  },
  targetCompactItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  targetCompactLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  targetCompactValue: {
    marginTop: 3,
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'center',
  },
  targetCompactDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: BORDER,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
  },
});
