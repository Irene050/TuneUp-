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
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

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
import { auth } from '@/services/firebase/config';
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
import { playSingleNote } from '@/utils/music/notePlayer';
import { createMusicalNote } from '@/utils/music/notes';

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
const REFERENCE_NOTE_DURATION_SEC = 1.5;

type Phase = 'directions' | 'countdown' | 'exercise' | 'results';

interface DynamicRangeExerciseProps {
  tier?: Tier;
}

/* Helpers */

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

/* Dynamic range visualizer */

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
        <Text style={styles.targetMarkerText}>TARGET</Text>
      </View>
    </View>
  );
}

/* Main screen */

export default function DynamicRangeExercise({
  tier,
}: DynamicRangeExerciseProps) {
  const initialTier = tier ?? 'beginner';

  const [resolvedTier, setResolvedTier] =
    useState<Tier>(initialTier);

  const [params, setParams] = useState<DynamicRangeParams>(
    DYNAMIC_RANGE_PARAMS[initialTier],
  );

  const [referenceNote, setReferenceNote] = useState(() =>
    createMusicalNote(60),
  );

  const [phase, setPhase] = useState<Phase>('directions');
  const [loadingParams, setLoadingParams] = useState(true);

  const [countdown, setCountdown] = useState(3);
  const [rep, setRep] = useState(1);
  const [seconds, setSeconds] = useState(0);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [liveHistory, setLiveHistory] = useState<number[]>([]);

  const [score, setScore] = useState(0);
  const [rangeAccuracy, setRangeAccuracy] = useState(0);
  const [rampConsistency, setRampConsistency] = useState(0);
  const [passed, setPassed] = useState(false);

  const [referencePlaying, setReferencePlaying] = useState(false);
  const [referencePlaybackError, setReferencePlaybackError] =
    useState('');

  const countdownRunIdRef = useRef(0);
  const shouldSaveResultRef = useRef(false);
  const finishingRef = useRef(false);
  const acceptFramesRef = useRef(false);
  const referencePlayingRef = useRef(false);

  const targetMin = params.targetDbRange[0];
  const targetMax = params.targetDbRange[1];

  const rampSeconds = Math.max(1, params.durationSec);
  const repetitions = Math.max(1, params.repetitions);

  // Duration of one complete Soft → Loud → Soft pattern.
  const totalSeconds = rampSeconds * PHASES_PER_REPETITION;

  /* Load reference note from assessment */

  useEffect(() => {
    let cancelled = false;

    async function loadReferenceNote() {
      try {
        const assessment = await getLatestAssessment();
        const vocalRange = assessment?.vocalRange;

        const lowHz = Number(
          vocalRange?.lowHz ?? assessment?.vocalRangeLowHz,
        );

        const highHz = Number(
          vocalRange?.highHz ?? assessment?.vocalRangeHighHz,
        );

        if (
          !Number.isFinite(lowHz) ||
          !Number.isFinite(highHz) ||
          lowHz <= 0 ||
          highHz <= lowHz
        ) {
          return;
        }

        const lowMidi = Math.round(
          69 + 12 * Math.log2(lowHz / 440),
        );

        const highMidi = Math.round(
          69 + 12 * Math.log2(highHz / 440),
        );

        const midpointHz = Math.sqrt(lowHz * highHz);

        const midpointMidi = Math.round(
          69 + 12 * Math.log2(midpointHz / 440),
        );

        const midiNote = Math.max(
          lowMidi,
          Math.min(highMidi, midpointMidi),
        );

        if (!cancelled) {
          setReferenceNote(createMusicalNote(midiNote));
        }
      } catch (error) {
        console.error(
          'Unable to load assessed vocal range for Dynamic Range:',
          error,
        );
      }
    }

    void loadReferenceNote();

    return () => {
      cancelled = true;
    };
  }, []);

  /* Invalidate countdown when screen unmounts */

  useEffect(() => {
    return () => {
      countdownRunIdRef.current += 1;
      acceptFramesRef.current = false;
    };
  }, []);

  /* Adaptive difficulty scaling */

  useEffect(() => {
    let cancelled = false;

    async function initializeAdaptiveParams() {
      setLoadingParams(true);

      try {
        let currentTier: Tier = tier ?? 'beginner';
        let referenceScores: number[] = [];

        const user = auth.currentUser;

        if (!tier && user) {
          const componentProgress = await fetchComponentProgress(
            user.uid,
            'volume',
          );

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

          // Use assessment only as a cold-start fallback.
          // Do not mix assessment scores with existing exercise history.
          if (referenceScores.length === 0) {
            const latestAssessment = await getLatestAssessment();

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
      } finally {
        if (!cancelled) {
          setLoadingParams(false);
        }
      }
    }

    void initializeAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  /* Reference note playback */

  const playReferenceNote = useCallback(async () => {
    // Prevent rapid repeated taps before React rerenders.
    if (referencePlayingRef.current) {
      return;
    }

    referencePlayingRef.current = true;
    setReferencePlaying(true);
    setReferencePlaybackError('');

    try {
      await playSingleNote(
        referenceNote.frequency,
        REFERENCE_NOTE_DURATION_SEC,
      );
    } catch (error) {
      console.error('Unable to play reference note:', error);

      setReferencePlaybackError(
        'Unable to play the reference note. Please try again.',
      );
    } finally {
      referencePlayingRef.current = false;
      setReferencePlaying(false);
    }
  }, [referenceNote]);

  /* Audio recorder */

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      // Ignore stale frames after cancellation or completion.
      if (!acceptFramesRef.current) {
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
      // Stop accepting live frames as soon as recording stops.
      acceptFramesRef.current = false;

      // Manual cancellation must never save an exercise.
      if (!shouldSaveResultRef.current) {
        setSeconds(0);
        setRep(1);
        setLiveFrame(null);
        setLiveHistory([]);
        finishingRef.current = false;
        return;
      }

      // Clear before processing to prevent duplicate saves.
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
            repetitionDurationSeconds:
              rampSeconds * PHASES_PER_REPETITION,
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

        // Only a naturally completed recording reaches this branch.
        void saveCompletedExercise(
          'volume',
          'dynamicRange',
          resolvedTier,
          Math.round(result.overallScore),
        );

        setPhase('results');
      } catch (error) {
        console.error('Unable to measure Dynamic Range:', error);

        // Do not save a failed measurement as a valid exercise.
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

  /* Exercise timer */

  useEffect(() => {
    if (phase !== 'exercise' || !isRecording) {
      return;
    }

    const interval = setInterval(() => {
      setSeconds((previous) => {
        if (previous >= totalSeconds - 1) {
          // Advance to the next repetition.
          if (rep < repetitions) {
            setRep((current) => current + 1);
            setLiveHistory([]);
            setLiveFrame(null);

            return 0;
          }

          // Mark completion before stopping the recorder.
          if (!finishingRef.current) {
            finishingRef.current = true;
            shouldSaveResultRef.current = true;

            void stopRecording().catch((error) => {
              console.error(
                'Unable to finish Dynamic Range recording:',
                error,
              );

              acceptFramesRef.current = false;
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

    return () => {
      clearInterval(interval);
    };
  }, [
    phase,
    isRecording,
    rep,
    repetitions,
    totalSeconds,
    stopRecording,
  ]);

  /* Current instruction */

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

  /* Reset exercise */

  const resetExercise = () => {
    setRep(1);
    setSeconds(0);

    setScore(0);
    setRangeAccuracy(0);
    setRampConsistency(0);
    setPassed(false);

    setLiveFrame(null);
    setLiveHistory([]);

    acceptFramesRef.current = false;
    finishingRef.current = false;
    shouldSaveResultRef.current = false;
  };

  /* Start and retry */

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

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000);
      });
    }

    if (runId !== countdownRunIdRef.current) {
      return;
    }

    try {
      // Accept frames before recording starts so initial frames are kept.
      acceptFramesRef.current = true;
      setPhase('exercise');

      await startRecording();
    } catch (error) {
      console.error(
        'Unable to start Dynamic Range recording:',
        error,
      );

      acceptFramesRef.current = false;
      shouldSaveResultRef.current = false;

      if (runId === countdownRunIdRef.current) {
        setPhase('directions');
      }
    }
  };

  const tryAgain = () => {
    void startExercise();
  };

  /* Stop or cancel an incomplete exercise */

  const stopIncompleteExercise = async (
    navigateBack = false,
  ) => {
    countdownRunIdRef.current += 1;

    // Immediately ignore incoming live frames.
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

  /* Preparing screen */

  if (loadingParams) {
    return (
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons
            name="options-outline"
            size={44}
            color={BROWN}
          />
        </View>

        <Text style={styles.preparingTitle}>
          Preparing Your Exercise
        </Text>

        <Text style={styles.preparingSubtitle}>
          Adjusting the exercise to your current difficulty
          level and preparing your vocal range.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  }

  /* Directions */

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
            text: `Listen to the reference note (${referenceNote.name}) before starting.`,
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
            value: `${targetMin} → ${targetMax} dB`,
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
          <View style={styles.referenceTopRow}>
            <View style={styles.referenceCopy}>
              <Text style={styles.eyebrow}>REFERENCE NOTE</Text>

              <Text style={styles.referenceNote}>
                {referenceNote.name}
              </Text>
            </View>

            <View style={styles.referenceIconCircle}>
              <Ionicons
                name="musical-note"
                size={22}
                color={BROWN}
              />
            </View>
          </View>

          <Text style={styles.referenceInstruction}>
            Play the note, then sing it while gradually
            increasing your volume from soft to loud,
            before returning to soft.
          </Text>

          <TouchableOpacity
            style={[
              styles.referenceButton,
              referencePlaying && styles.disabled,
            ]}
            onPress={() => void playReferenceNote()}
            activeOpacity={0.85}
            disabled={referencePlaying}
          >
            {referencePlaying ? (
              <ActivityIndicator size="small" color={BROWN} />
            ) : (
              <Ionicons
                name="play"
                size={17}
                color={BROWN}
              />
            )}

            <Text style={styles.referenceButtonText}>
              {referencePlaying
                ? 'Playing...'
                : `Play ${referenceNote.name}`}
            </Text>
          </TouchableOpacity>

          {referencePlaybackError !== '' && (
            <Text style={styles.playbackError}>
              {referencePlaybackError}
            </Text>
          )}
        </View>

        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>
            Follow this pattern
          </Text>

          <View style={styles.previewVisualizer}>
            {Array.from(
              { length: BAR_COUNT },
              (_, index) => (
                <View
                  key={`preview-${index}`}
                  style={[
                    styles.previewBar,
                    {
                      height: `${referenceHeight(index) * 80}%`,
                    },
                  ]}
                />
              ),
            )}
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

  /* Countdown */

  if (phase === 'countdown') {
    return (
      <View style={styles.countdownScreen}>
        <TouchableOpacity
          style={styles.countdownCancelButton}
          onPress={() => {
            countdownRunIdRef.current += 1;
            acceptFramesRef.current = false;
            setCountdown(3);
            setPhase('directions');
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="close" size={22} color={BROWN} />

          <Text style={styles.countdownCancelText}>
            Cancel
          </Text>
        </TouchableOpacity>

        <View style={styles.countdownContent}>
          <View style={styles.countdownCircle}>
            <Text style={styles.countdownNumber}>
              {countdown}
            </Text>
          </View>

          <Text style={styles.countdownTitle}>Get Ready</Text>

          <Text style={styles.countdownPrompt}>
            Recording starts when the countdown ends.
          </Text>

          <Text style={styles.countdownHint}>
            Prepare to sing {referenceNote.name}. Start
            softly, then follow the volume prompts.
          </Text>
        </View>
      </View>
    );
  }

  /* Live exercise */

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
            <Ionicons name="mic" size={20} color={BROWN} />
          </View>
        </View>

        <View style={styles.phaseCountdownCard}>
          <Text style={styles.phaseCountdownLabel}>
            NEXT PHASE IN
          </Text>

          <Text style={styles.phaseCountdownValue}>
            {secondsUntilChange}s
          </Text>
        </View>

        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={styles.actualDot} />

            <Text style={styles.legendText}>Your voice</Text>
          </View>
        </View>

        <DynamicRangeVisualizer liveHistory={liveHistory} />

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
            {liveFrame && Number.isFinite(liveFrame.volume)
              ? liveFrame.volume.toFixed(1)
              : '--'}

            <Text style={styles.voiceUnit}> dBFS</Text>
          </Text>
        </View>

        <View style={styles.targetRow}>
          <View>
            <Text style={styles.targetLabel}>
              TARGET RANGE
            </Text>

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
            <Text style={styles.sessionLabel}>ELAPSED</Text>

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
          <Ionicons name="stop" size={16} color={BROWN} />

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
        prompt={`${instructionPrompt} Sing ${referenceNote.name} throughout the pattern.`}
        liveContent={liveContent}
        progress={progress}
        onBack={() => {
          void stopIncompleteExercise(true);
        }}
      />
    );
  }

  /* Results */

  return (
    <ExerciseResultsScreen
      title={passed ? 'Exercise Passed' : 'Needs More Practice'}
      subtitle={
        passed
          ? 'Great job! You controlled your vocal volume.'
          : 'Keep practicing smooth and controlled volume changes.'
      }
      score={score}
      resultIcon={
        passed
          ? 'checkmark-circle-outline'
          : 'refresh-outline'
      }
      scoreMessage={
        passed
          ? 'You met the passing requirements.'
          : 'Try to follow the soft-to-loud-to-soft pattern more consistently.'
      }
      scoreDetails={
        <View style={styles.resultsDetails}>
          <View style={styles.resultMetric}>
            <Text style={styles.resultValue}>
              {rangeAccuracy}%
            </Text>

            <Text style={styles.resultLabel}>
              Range Accuracy
            </Text>
          </View>

          <View style={styles.resultMetric}>
            <Text style={styles.resultValue}>
              {rampConsistency}%
            </Text>

            <Text style={styles.resultLabel}>
              Ramp Consistency
            </Text>
          </View>
        </View>
      }
      onRetry={tryAgain}
      onExit={() => router.replace('/exercises/volume')}
      children={null}
    />
  );
}

/* Styles */

const styles = StyleSheet.create({
  preparingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  preparingIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  preparingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },

  /* Countdown */
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

  /* Reference note card */
  referenceCard: {
    width: '100%',
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 9,
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
  eyebrow: {
    color: MUTED,
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.7,
  },
  referenceNote: {
    marginTop: 2,
    color: BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 29,
    lineHeight: 36,
  },
  referenceIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  referenceInstruction: {
    color: '#765D63',
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
  },
  referenceButton: {
    width: '100%',
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  referenceButtonText: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
  },
  playbackError: {
    marginTop: 6,
    color: '#C62828',
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
  },
  disabled: {
    opacity: 0.6,
  },

  /* Pattern preview */
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

  /* Live exercise */
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

  /* Live visualizer */
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

  /* Live volume */
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

  /* Target range */
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

  /* Session information */
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

  /* Progress */
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

  /* Stop button */
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

  /* Results */
  resultsDetails: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 12,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  resultMetric: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  resultLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
  },
  resultValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
  },
});