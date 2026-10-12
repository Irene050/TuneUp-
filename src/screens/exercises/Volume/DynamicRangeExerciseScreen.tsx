
import {
  DYNAMIC_RANGE_PARAMS,
  type DynamicRangeParams,
  type Tier,
} from '@/constants/exercises/volume';
import {
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
  ExerciseListeningScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import {
  generateDynamicRangeParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';
import {
  auth,
} from '@/services/firebase/config';
import {
  measureDynamicRange,
} from '@/services/measurement/volume/dynamicRangeExercise';
import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
  scoreDynamicRange,
} from '@/services/scoring/volume/dynamicRangeExercise';
import {
  playSingleNote,
} from '@/utils/music/notePlayer';
import {
  createMusicalNote,
} from '@/utils/music/notes';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const BORDER = '#F2DDE5';
const ACCENT = '#D86C89';
const BAR_COUNT = 32;
const DBFS_MIN = -60;
const DBFS_MAX = -10;
const PHASES_PER_REPETITION = 3;
const WINDOW_MS = 50;
const REFERENCE_NOTE = createMusicalNote(60);
const REFERENCE_NOTE_DURATION_SEC = 1.5;
type Phase = 'directions' | 'countdown' | 'exercise' | 'results';
interface DynamicRangeExerciseProps {
  tier?: Tier;
}
function normalizeVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(
      1,
      (value - DBFS_MIN) / (DBFS_MAX - DBFS_MIN),
    ),
  );
}
function referenceHeight(index: number): number {
  const middle = (BAR_COUNT - 1) / 2;
  const distance = Math.abs(index - middle) / middle;
  return 0.18 + (1 - distance) * 0.72;
}
/* =========================================================
   DYNAMIC RANGE VISUALIZER
   ========================================================= */
function DynamicRangeVisualizer({
  liveHistory,
}: {
  liveHistory: number[];
}) {
  const actualBars = Array.from(
    { length: BAR_COUNT },
    (_, index) => liveHistory[index] ?? 0,
  );
  return (
    <View style={styles.visualizer}>
      <View style={styles.targetBand} />
      <View style={styles.actualBars}>
        {actualBars.map((height, index) => (
          <View
            key={`actual-${index}`}
            style={[
              styles.actualBar,
              {
                height:
                  height > 0
                    ? `${Math.max(5, height * 82)}%`
                    : '0%',
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.centerLine} />
      <View style={styles.targetMarker}>
        <Text style={styles.targetMarkerText}>
          TARGET
        </Text>
      </View>
    </View>
  );
}
/* =========================================================
   MAIN SCREEN
   ========================================================= */
export default function DynamicRangeExercise({
  tier,
}: DynamicRangeExerciseProps) {
  const initialTier = tier ?? 'beginner';
  const [resolvedTier, setResolvedTier] =
    useState<Tier>(initialTier);
  const [params, setParams] =
    useState<DynamicRangeParams>(
      DYNAMIC_RANGE_PARAMS[initialTier],
    );
  const [phase, setPhase] = useState<Phase>('directions');
  const [countdown, setCountdown] = useState(3);
  const countdownRunIdRef = useRef(0);
  const [rep, setRep] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);
  const [liveHistory, setLiveHistory] =
    useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [rangeAccuracy, setRangeAccuracy] = useState(0);
  const [rampConsistency, setRampConsistency] = useState(0);
  const [passed, setPassed] = useState(false);
  const shouldSaveResultRef = useRef(false);
  const finishingRef = useRef(false);
  const targetMin = params.targetDbRange[0];
  const targetMax = params.targetDbRange[1];
  const rampSeconds = Math.max(1, params.durationSec);
  const repetitions = Math.max(1, params.repetitions);
  const totalSeconds = rampSeconds * PHASES_PER_REPETITION;
  useEffect(() => {
    return () => {
      countdownRunIdRef.current += 1;
    };
  }, []);
  /* =======================================================
     ADAPTIVE DIFFICULTY SCALING
     ======================================================= */
  useEffect(() => {
    let cancelled = false;
    async function initializeAdaptiveParams() {
      try {
        let currentTier: Tier = tier ?? 'beginner';
        let referenceScores: number[] = [];
        const user = auth.currentUser;
        if (!tier && user) {
          const componentProgress =
            await fetchComponentProgress(user.uid, 'volume');
          if (
            componentProgress?.currentTier === 'beginner' ||
            componentProgress?.currentTier === 'intermediate' ||
            componentProgress?.currentTier === 'advanced'
          ) {
            currentTier = componentProgress.currentTier;
          }
          const records = await fetchExerciseRecords(
            user.uid,
            'volume',
          );
          const recentRecords = records
            .filter(
              (record) =>
                record.templateId === 'dynamicRange' &&
                record.tier === currentTier,
            )
            .sort(
              (a, b) =>
                Number(a.timestamp ?? 0) -
                Number(b.timestamp ?? 0),
            );
          referenceScores = recentRecords
            .slice(-5)
            .map((record) => Number(record.scorePct ?? 0));
          /*
           * Assessment is a cold-start fallback.
           * Do not mix it into an existing exercise history.
           */
          if (referenceScores.length === 0) {
            const latestAssessment =
              await getLatestAssessment();
            const assessmentScore =
              latestAssessment?.scores.find(
                (item) => item.componentId === 'volume',
              )?.scorePct;
            if (typeof assessmentScore === 'number') {
              referenceScores = [assessmentScore];
            }
          }
        }
        const generatedParams = generateDynamicRangeParams({
          tier: currentTier,
          recentScores: referenceScores,
        });
        if (cancelled) {
          return;
        }
        setResolvedTier(currentTier);
        setParams(generatedParams);
      } catch (error) {
        console.error(
          'Unable to initialize Dynamic Range adaptive parameters:',
          error,
        );
        if (cancelled) {
          return;
        }
        const fallbackTier = tier ?? 'beginner';
        setResolvedTier(fallbackTier);
        setParams(
          generateDynamicRangeParams({
            tier: fallbackTier,
            recentScores: [],
          }),
        );
      }
    }
    void initializeAdaptiveParams();
    return () => {
      cancelled = true;
    };
  }, [tier]);
  /* =======================================================
     REFERENCE NOTE
     ======================================================= */
  const playReferenceNote = useCallback(async () => {
    try {
      await playSingleNote(
        REFERENCE_NOTE.frequency,
        REFERENCE_NOTE_DURATION_SEC,
      );
    } catch (error) {
      console.error('Unable to play reference note:', error);
    }
  }, []);
  /* =======================================================
     AUDIO RECORDER
     ======================================================= */
  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (phase !== 'exercise') {
        return;
      }
      setLiveFrame(frame);
      const normalized = normalizeVolume(frame.volume);
      setLiveHistory((previous) => {
        const next = [...previous, normalized];
        return next.length > BAR_COUNT
          ? next.slice(-BAR_COUNT)
          : next;
      });
    },
    onStop: (samples, sampleRate) => {
      /*
       * Manual cancellation must never save an exercise.
       */
      if (!shouldSaveResultRef.current) {
        setSeconds(0);
        setRep(1);
        setLiveFrame(null);
        setLiveHistory([]);
        finishingRef.current = false;
        return;
      }
      /*
       * Clear this before processing to prevent duplicate saves.
       */
      shouldSaveResultRef.current = false;
      try {
        const measurement = measureDynamicRange(
          samples,
          sampleRate,
          {
            windowMs: WINDOW_MS,
            targetRange: [targetMin, targetMax],
            expectedDurationSeconds:
              rampSeconds *
              PHASES_PER_REPETITION *
              repetitions,
          },
        );
        console.log(
          'DYNAMIC RANGE MEASUREMENT:',
          JSON.stringify(measurement, null, 2),
        );
        const result = scoreDynamicRange(measurement);
        console.log(
          'DYNAMIC RANGE SCORE:',
          JSON.stringify(result, null, 2),
        );
        setRangeAccuracy(result.rangeAccuracy);
        setRampConsistency(result.rampConsistency);
        setScore(Math.round(result.overallScore));
        setPassed(result.passed);
        /*
         * Only a naturally completed recording reaches this branch.
         */
        void saveCompletedExercise(
          'volume',
          'dynamicRange',
          resolvedTier,
          Math.round(result.overallScore),
        );
        setPhase('results');
      } catch (error) {
        console.error(
          'Unable to measure Dynamic Range:',
          error,
        );
        /*
         * Do not save a failed measurement as a valid exercise.
         * Return to the directions screen so the user can retry.
         */
        setPhase('directions');
      } finally {
        setSeconds(0);
        setRep(1);
        setLiveFrame(null);
        setLiveHistory([]);
        finishingRef.current = false;
      }
    },
  });
  /* =======================================================
     EXERCISE TIMER
     ======================================================= */
  useEffect(() => {
    if (phase !== 'exercise' || !isRecording) {
      return;
    }
    const interval = setInterval(() => {
      setSeconds((previous) => {
        if (previous >= totalSeconds - 1) {
          /*
           * Advance to the next repetition.
           */
          if (rep < repetitions) {
            setRep((current) => current + 1);
            setLiveHistory([]);
            return 0;
          }
          /*
           * Mark completion before stopping the recorder.
           */
          if (!finishingRef.current) {
            finishingRef.current = true;
            shouldSaveResultRef.current = true;
            void stopRecording().catch((error) => {
              console.error(
                'Unable to finish Dynamic Range recording:',
                error,
              );
              finishingRef.current = false;
              shouldSaveResultRef.current = false;
              setPhase('directions');
            });
          }
          return previous;
        }
        return previous + 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [
    phase,
    isRecording,
    rep,
    repetitions,
    totalSeconds,
    stopRecording,
  ]);
  /* =======================================================
     CURRENT INSTRUCTION
     ======================================================= */
  let instructionTitle = 'SOFT → LOUD';
  let instructionPrompt = 'Gradually increase your volume.';
  if (seconds >= rampSeconds * 2) {
    instructionTitle = 'LOUD → SOFT';
    instructionPrompt = 'Gradually decrease your volume.';
  } else if (seconds >= rampSeconds) {
    instructionTitle = 'LOUD';
    instructionPrompt = 'Reach and maintain your loud target.';
  }
  const secondsUntilChange =
    rampSeconds - (seconds % rampSeconds);
  /* =======================================================
     START / RETRY / CANCEL
     ======================================================= */
  const resetExercise = () => {
    setRep(1);
    setSeconds(0);
    setScore(0);
    setRangeAccuracy(0);
    setRampConsistency(0);
    setPassed(false);
    setLiveFrame(null);
    setLiveHistory([]);
    finishingRef.current = false;
    shouldSaveResultRef.current = false;
  };
  const startExercise = async () => {
    const runId = ++countdownRunIdRef.current;
    resetExercise();
    setCountdown(3);
    setPhase('countdown');

    for (let value = 3; value >= 1; value--) {
      if (runId !== countdownRunIdRef.current) {
        return;
      }
      setCountdown(value);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }

    if (runId !== countdownRunIdRef.current) {
      return;
    }

    try {
      setPhase('exercise');
      await startRecording();
    } catch (error) {
      console.error(
        'Unable to start Dynamic Range recording:',
        error,
      );
      if (runId === countdownRunIdRef.current) {
        setPhase('directions');
      }
    }
  };
  const tryAgain = () => {
    void startExercise();
  };
const acceptFramesRef = useRef(false);
const stopIncompleteExercise = async (
  navigateBack = false,
) => {
  countdownRunIdRef.current += 1;
  // Immediately ignore any new live frames.
  acceptFramesRef.current = false;
  // Prevent this attempt from being saved.
  shouldSaveResultRef.current = false;
  finishingRef.current = false;
  try {
    await stopRecording();
  } catch (error) {
    console.error(
      'Unable to stop Dynamic Range recording:',
      error,
    );
  } finally {
    setSeconds(0);
    setRep(1);
    setLiveFrame(null);
    setLiveHistory([]);
    if (navigateBack) {
      router.back();
    } else {
      setPhase('directions');
    }
  }
};
  /* =======================================================
     DIRECTIONS
     ======================================================= */
  if (phase === 'directions') {
    return (
      <ExerciseScreen
        title="Dynamic Range"
        category="VOLUME CONTROL"
        icon="volume-high-outline"
        instructions="Practice changing your vocal volume smoothly while singing the same reference note."
        preparationSteps={[
          {
            icon: 'ear-outline',
            text: `Listen to the reference note (${REFERENCE_NOTE.name}) before starting.`,
          },
          {
            icon: 'volume-low-outline',
            text: 'Begin softly, then gradually increase your volume.',
          },
          {
            icon: 'volume-high-outline',
            text: 'Reach the loud target, then gradually return to a soft voice.',
          },
        ]}
        summary={[
          {
            label: 'TARGET RANGE',
            value: `${targetMin}–${targetMax} dB`,
            hint: 'relative microphone level',
          },
          {
            label: 'RAMP DURATION',
            value: `${rampSeconds}s`,
            hint: 'per phase',
          },
          {
            label: 'REPETITIONS',
            value: String(repetitions),
            hint: 'complete patterns',
          },
        ]}
        tip="Keep the same note throughout the exercise. Change your vocal volume gradually instead of changing pitch."
        tier={resolvedTier}
        onBack={() => router.back()}
        onStart={startExercise}
      >
        <View style={styles.referenceCard}>
          <View style={styles.referenceHeader}>
            <Ionicons
              name="musical-note"
              size={21}
              color={BROWN}
            />
            <View style={styles.referenceText}>
              <Text style={styles.referenceLabel}>
                REFERENCE NOTE
              </Text>
              <Text style={styles.referenceNote}>
                {REFERENCE_NOTE.name}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.referenceButton}
            onPress={playReferenceNote}
            activeOpacity={0.85}
          >
            <Ionicons
              name="play"
              size={16}
              color={WHITE}
            />
            <Text style={styles.referenceButtonText}>
              Play Reference Note
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>
            Follow this pattern
          </Text>
          <View style={styles.previewVisualizer}>
            {Array.from({ length: BAR_COUNT }, (_, index) => (
              <View
                key={`preview-${index}`}
                style={[
                  styles.previewBar,
                  {
                    height: `${referenceHeight(index) * 80}%`,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.previewLabels}>
            <Text style={styles.previewLabel}>Soft</Text>
            <Text style={styles.previewLabel}>Loud</Text>
            <Text style={styles.previewLabel}>Soft</Text>
          </View>
        </View>
      </ExerciseScreen>
    );
  }
  if (phase === 'countdown') {
    return (
      <View style={styles.countdownScreen}>
        <TouchableOpacity
          style={styles.countdownCancelButton}
          onPress={() => {
            countdownRunIdRef.current += 1;
            setCountdown(3);
            setPhase('directions');
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="close" size={22} color={BROWN} />
          <Text style={styles.countdownCancelText}>Cancel</Text>
        </TouchableOpacity>

        <View style={styles.countdownContent}>
          <View style={styles.countdownCircle}>
            <Text style={styles.countdownNumber}>{countdown}</Text>
          </View>
          <Text style={styles.countdownTitle}>Get Ready</Text>
          <Text style={styles.countdownPrompt}>
            Recording starts when the countdown ends.
          </Text>
          <Text style={styles.countdownHint}>
            Prepare to sing {REFERENCE_NOTE.name}. Start softly, then follow the volume prompts.
          </Text>
        </View>
      </View>
    );
  }

  /* =======================================================
     LIVE EXERCISE
     ======================================================= */
  if (phase === 'exercise') {
    const progress = Math.min(
      100,
      (seconds / totalSeconds) * 100,
    );
    const liveContent = (
      <View style={styles.liveContent}>
        <View style={styles.visualizerHeader}>
          <View>
            <Text style={styles.visualizerTitle}>
              Your Performance
            </Text>
            <Text style={styles.visualizerSubtitle}>
              Follow the reference pattern
            </Text>
          </View>
          <View style={styles.micCircle}>
            <Ionicons
              name="mic"
              size={20}
              color={BROWN}
            />
          </View>
        </View>
        <View style={styles.phaseCountdownCard}>
          <Text style={styles.phaseCountdownLabel}>NEXT PHASE IN</Text>
          <Text style={styles.phaseCountdownValue}>{secondsUntilChange}s</Text>
        </View>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={styles.actualDot} />
            <Text style={styles.legendText}>Your voice</Text>
          </View>
        </View>
        <DynamicRangeVisualizer
          liveHistory={liveHistory}
        />
        <View style={styles.visualizerLabels}>
          <Text style={styles.visualizerLabel}>SOFT</Text>
          <Text style={styles.visualizerLabel}>LOUD</Text>
          <Text style={styles.visualizerLabel}>SOFT</Text>
        </View>
        <View style={styles.voiceRow}>
          <View style={styles.voiceLeft}>
            <Ionicons
              name="mic-outline"
              size={20}
              color={BROWN}
            />
            <Text style={styles.voiceLabel}>
              {liveFrame ? 'Voice signal' : 'Listening...'}
            </Text>
          </View>
          <Text style={styles.voiceValue}>
            {liveFrame &&
            Number.isFinite(liveFrame.volume)
              ? liveFrame.volume.toFixed(1)
              : '--'}
            <Text style={styles.voiceUnit}> dBFS</Text>
          </Text>
        </View>
        <View style={styles.targetRow}>
          <View>
            <Text style={styles.targetLabel}>TARGET RANGE</Text>
            <Text style={styles.targetValue}>
              {targetMin}–{targetMax} dB
            </Text>
          </View>
          <Text style={styles.pattern}>
            Soft → Loud → Soft
          </Text>
        </View>
        <View style={styles.sessionRow}>
          <View style={styles.sessionPart}>
            <Text style={styles.sessionLabel}>
              REPETITION
            </Text>
            <Text style={styles.sessionValue}>
              {rep} / {repetitions}
            </Text>
          </View>
          <View style={styles.sessionDivider} />
          <View style={styles.sessionPart}>
            <Text style={styles.sessionLabel}>
              ELAPSED
            </Text>
            <Text style={styles.sessionValue}>
              {Math.floor(seconds / 60)}:
              {String(seconds % 60).padStart(2, '0')}
            </Text>
          </View>
        </View>
        <View style={styles.liveProgressTrack}>
          <View
            style={[
              styles.liveProgressFill,
              { width: `${progress}%` },
            ]}
          />
        </View>
        <TouchableOpacity
          style={styles.stopButton}
          onPress={() => {
            void stopIncompleteExercise(false);
          }}
          activeOpacity={0.85}
        >
          <Ionicons
            name="stop"
            size={16}
            color={BROWN}
          />
          <Text style={styles.stopButtonText}>
            Stop Exercise
          </Text>
        </TouchableOpacity>
      </View>
    );
    return (
      <ExerciseListeningScreen
        icon="volume-high-outline"
        title="Dynamic Range"
        currentRep={rep}
        repetitions={repetitions}
        elapsed={seconds}
        targetDuration={totalSeconds}
        promptTitle={instructionTitle}
        prompt={`${instructionPrompt} Sing ${REFERENCE_NOTE.name} throughout the pattern.`}
        liveContent={liveContent}
        progress={progress}
        onBack={() => {
          void stopIncompleteExercise(true);
        }}
      />
    );
  }
  /* =======================================================
     RESULTS
     ======================================================= */
  return (
    <ExerciseResultsScreen
      title={passed ? 'Exercise Passed' : 'Needs More Practice'}
      subtitle={
        passed
          ? 'Great job! You controlled your vocal volume.'
          : 'Keep practicing smooth and controlled volume changes.'
      }
      score={score}
      resultIcon={passed ? 'checkmark-circle-outline' : 'refresh-outline'}
      scoreMessage={
        passed
          ? 'You met the passing requirements.'
          : 'Try to follow the soft-to-loud-to-soft pattern more consistently.'
      }
      onRetry={tryAgain}
      onExit={() => router.replace('/exercises/volume')}
    >
      <View style={styles.resultsDetails}>
        <ResultRow
          label="Range Accuracy"
          value={`${rangeAccuracy}%`}
        />
        <ResultRow
          label="Ramp Consistency"
          value={`${rampConsistency}%`}
        />
        <ResultRow
          label="Target Range"
          value={`${targetMin}–${targetMax} dB`}
        />
        <ResultRow
          label="Difficulty"
          value={
            resolvedTier.charAt(0).toUpperCase() +
            resolvedTier.slice(1)
          }
        />
      </View>
    </ExerciseResultsScreen>
  );
}
/* =========================================================
   RESULT ROW
   ========================================================= */
function ResultRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={styles.resultValue}>{value}</Text>
    </View>
  );
}
/* =========================================================
   SCREEN-SPECIFIC STYLES
   ========================================================= */
const styles = StyleSheet.create({
  countdownScreen: {
    flex: 1,
    width: '100%',
    backgroundColor: WHITE,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  countdownCancelButton: {
    position: 'absolute',
    top: 54,
    left: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingRight: 12,
    zIndex: 2,
  },
  countdownCancelText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
  },
  countdownContent: {
    alignItems: 'center',
    width: '100%',
  },
  countdownCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  countdownNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 54,
    color: BROWN,
  },
  countdownTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 26,
    color: BROWN,
    textAlign: 'center',
  },
  countdownPrompt: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
    textAlign: 'center',
    marginTop: 10,
  },
  countdownHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 280,
  },
  referenceCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 18,
  },
  referenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  referenceText: {
    flex: 1,
  },
  referenceLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.8,
  },
  referenceNote: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
    marginTop: 2,
  },
  referenceButton: {
    height: 42,
    borderRadius: 22,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 12,
  },
  referenceButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: WHITE,
  },
  previewCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 12,
  },
  previewTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: BROWN,
  },
  previewVisualizer: {
    height: 65,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  previewBar: {
    flex: 1,
    maxWidth: 7,
    backgroundColor: '#EAA5B6',
    borderRadius: 4,
  },
  previewLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  previewLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  liveContent: {
    width: '100%',
  },
  visualizerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visualizerTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
  },
  visualizerSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 3,
  },
  micCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseCountdownCard: {
    marginTop: 12,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: LIGHT,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  phaseCountdownLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color: MUTED,
  },
  phaseCountdownValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: ACCENT,
  },
  legend: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actualDot: {
    width: 15,
    height: 4,
    borderRadius: 2,
    backgroundColor: BROWN,
  },
  legendText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  visualizer: {
    height: 155,
    borderRadius: 15,
    backgroundColor: '#FFFAFB',
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
  },
  targetBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '19%',
    height: '27%',
    backgroundColor: 'rgba(252, 214, 221, 0.32)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#F3D3DA',
  },
  actualBars: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  actualBar: {
    flex: 1,
    maxWidth: 8,
    backgroundColor: BROWN,
    borderRadius: 5,
  },
  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: '#F1E0E4',
  },
  targetMarker: {
    position: 'absolute',
    right: 7,
    top: '18%',
    backgroundColor: WHITE,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 4,
  },
  targetMarkerText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    color: ACCENT,
  },
  visualizerLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  visualizerLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    color: MUTED,
  },
  voiceRow: {
    minHeight: 46,
    marginTop: 12,
    borderRadius: 13,
    backgroundColor: LIGHT,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  voiceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },
  voiceValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },
  voiceUnit: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  targetRow: {
    minHeight: 48,
    marginTop: 8,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  targetLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    letterSpacing: 0.5,
    color: ACCENT,
  },
  targetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginTop: 2,
  },
  pattern: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  sessionRow: {
    minHeight: 48,
    marginTop: 8,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionPart: {
    flex: 1,
    alignItems: 'center',
  },
  sessionLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  sessionValue: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginTop: 2,
  },
  sessionDivider: {
    width: 1,
    height: 30,
    backgroundColor: BORDER,
  },
  liveProgressTrack: {
    height: 6,
    marginTop: 10,
    backgroundColor: '#F3E4E8',
    borderRadius: 3,
    overflow: 'hidden',
  },
  liveProgressFill: {
    height: '100%',
    backgroundColor: ACCENT,
    borderRadius: 3,
  },
  stopButton: {
    height: 44,
    marginTop: 12,
    borderRadius: 22,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  stopButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },
  resultsDetails: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  resultRow: {
    minHeight: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F5E9EC',
  },
  resultLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },
  resultValue: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },
});
