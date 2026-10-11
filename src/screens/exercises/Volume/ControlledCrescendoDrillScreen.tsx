import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import ExerciseScreen, {
  ExerciseListeningScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';

import {
  CONTROLLED_CRESCENDO_PARAMS,
  type Tier,
} from '@/constants/exercises/volume';

import {
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import { auth } from '@/services/firebase/config';

import {
  generateControlledCrescendoParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  measureControlledCrescendo,
} from '@/services/measurement/volume/controlledCrescendoDrill';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  scoreControlledCrescendo,
} from '@/services/scoring/volume/controlledCrescendoDrill';

import { playSingleNote } from '@/utils/music/notePlayer';
import { createMusicalNote } from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT = '#FFF8FA';
const BORDER = '#F1DCE2';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';

const WINDOW_MS = 50;
const BAR_COUNT = 32;
const DBFS_MIN = -60;
const DBFS_MAX = -10;

const REFERENCE_NOTE = createMusicalNote(60);
const REFERENCE_NOTE_DURATION_SEC = 1.5;

type ControlledCrescendoParams =
  typeof CONTROLLED_CRESCENDO_PARAMS.beginner;

interface ControlledCrescendoExerciseProps {
  tier?: Tier;
}

interface ResultItemProps {
  label: string;
  value: string;
}

interface VolumeVisualizerProps {
  liveHistory: number[];
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return clamp(
    (value - DBFS_MIN) / (DBFS_MAX - DBFS_MIN),
    0,
    1,
  );
}

function targetHeight(index: number): number {
  const progress = index / (BAR_COUNT - 1);
  return 0.18 + progress * 0.65;
}

function calculateLiveSmoothness(values: number[]): number {
  if (values.length < 3) {
    return 0;
  }

  const derivatives: number[] = [];

  for (let index = 1; index < values.length; index += 1) {
    derivatives.push(values[index] - values[index - 1]);
  }

  const meanDerivative =
    derivatives.reduce((sum, value) => sum + value, 0) /
    derivatives.length;

  // A crescendo should trend upward. A flat or decreasing
  // signal should not be treated as a smooth crescendo.
  if (
    !Number.isFinite(meanDerivative) ||
    meanDerivative <= 0
  ) {
    return 0;
  }

  const derivativeVariance =
    derivatives.reduce(
      (sum, value) => sum + (value - meanDerivative) ** 2,
      0,
    ) / derivatives.length;

  return clamp(
    100 - (derivativeVariance / meanDerivative) * 100,
    0,
    100,
  );
}

function estimateLiveSmoothness(history: number[]): number {
  if (history.length < 4) {
    return 0;
  }

  const values = history.map(
    (value) => DBFS_MIN + value * (DBFS_MAX - DBFS_MIN),
  );

  return Math.round(calculateLiveSmoothness(values));
}

function VolumeVisualizer({
  liveHistory,
}: VolumeVisualizerProps) {
  const actualBars = Array.from(
    { length: BAR_COUNT },
    (_, index) => liveHistory[index] ?? 0,
  );

  return (
    <View style={styles.visualizer}>
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
    </View>
  );
}

function ResultItem({ label, value }: ResultItemProps) {
  return (
    <View style={styles.resultItem}>
      <Text style={styles.resultItemLabel}>{label}</Text>
      <Text style={styles.resultItemValue}>{value}</Text>
    </View>
  );
}

export default function ControlledCrescendoExercise({
  tier,
}: ControlledCrescendoExerciseProps) {
  const [phase, setPhase] = useState<
    'directions' | 'exercise' | 'results'
  >('directions');

  const [resolvedTier, setResolvedTier] = useState<Tier>(
    tier ?? 'beginner',
  );

  const [params, setParams] =
    useState<ControlledCrescendoParams>(
      CONTROLLED_CRESCENDO_PARAMS.beginner,
    );

  const [rep, setRep] = useState(1);
  const [seconds, setSeconds] = useState(0);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [liveHistory, setLiveHistory] = useState<number[]>([]);
  const [smoothness, setSmoothness] = useState(0);
  const [repResults, setRepResults] = useState<number[]>([]);
  const [rangeReached, setRangeReached] = useState(false);

  const [startDb, setStartDb] = useState(0);
  const [endDb, setEndDb] = useState(0);
  const [minDb, setMinDb] = useState(0);
  const [maxDb, setMaxDb] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const finishingRef = useRef(false);
  const completedNaturallyRef = useRef(false);
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const targetMin = params.targetDbRange[0];
  const targetMax = params.targetDbRange[1];
  const rampSeconds = params.durationSec;
  const repetitions = params.repetitions;
  const smoothnessTarget = params.smoothnessThreshold;

  /*
   * Adaptive difficulty initialization:
   * 1. Use the explicitly supplied tier, if present.
   * 2. Otherwise use the saved Volume tier.
   * 3. Use the latest five matching exercise scores.
   * 4. Use the latest Volume assessment only as a cold-start fallback.
   */
  useEffect(() => {
    let cancelled = false;

    async function initializeAdaptiveParams() {
      let currentTier: Tier = tier ?? 'beginner';

      try {
        const user = auth.currentUser;

        if (user && !tier) {
          const progress = await fetchComponentProgress(
            user.uid,
            'volume',
          );

          if (progress?.currentTier) {
            currentTier = progress.currentTier;
          }
        }

        if (cancelled) {
          return;
        }

        setResolvedTier(currentTier);

        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'volume',
          );

          const matchingRecords = records
            .filter(
              (record) =>
                record.templateId === 'controlledCrescendo' &&
                record.tier === currentTier,
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          recentScores = matchingRecords
            .slice(-5)
            .map((record) => record.scorePct);
        }

        if (cancelled) {
          return;
        }

        if (recentScores.length === 0) {
          try {
            const assessment = await getLatestAssessment();

            if (assessment) {
              const scores = assessment.scores as Array<{
                componentId?: string;
                score?: number;
                scorePct?: number;
              }>;

              const volumeScore = scores.find(
                (score) => score.componentId === 'volume',
              );

              const assessmentScore = Number(
                volumeScore?.scorePct ?? volumeScore?.score,
              );

              if (Number.isFinite(assessmentScore)) {
                recentScores = [assessmentScore];
              }
            }
          } catch (assessmentError) {
            console.warn(
              'Unable to load the Volume assessment for Controlled Crescendo:',
              assessmentError,
            );
          }
        }

        const generatedParams =
          generateControlledCrescendoParams({
            tier: currentTier,
            recentScores,
          });

        if (cancelled) {
          return;
        }

        setParams(generatedParams);
        setRepResults(
          Array(generatedParams.repetitions).fill(0),
        );
      } catch (initializationError) {
        console.error(
          'Unable to initialize Controlled Crescendo parameters:',
          initializationError,
        );

        if (cancelled) {
          return;
        }

        const fallbackParams =
          CONTROLLED_CRESCENDO_PARAMS[currentTier];

        setResolvedTier(currentTier);
        setParams(fallbackParams);
        setRepResults(
          Array(fallbackParams.repetitions).fill(0),
        );
      }
    }

    void initializeAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  const playReferenceNote = useCallback(async () => {
    try {
      await playSingleNote(
        REFERENCE_NOTE.frequency,
        REFERENCE_NOTE_DURATION_SEC,
      );
    } catch (playbackError) {
      console.error(
        'Reference note playback failed:',
        playbackError,
      );
    }
  }, []);

  useEffect(() => {
    if (phase === 'directions') {
      void playReferenceNote();
    }
  }, [phase, playReferenceNote]);

  const clearLiveState = useCallback(() => {
    setSeconds(0);
    setRep(1);
    setLiveFrame(null);
    setLiveHistory([]);
  }, []);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (phaseRef.current !== 'exercise') {
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
       * A manual stop or navigation cancels the attempt.
       * Only a naturally completed recording is scored and saved.
       */
      if (!completedNaturallyRef.current) {
        finishingRef.current = false;
        clearLiveState();
        return;
      }

      try {
        const measurement = measureControlledCrescendo(
          samples,
          sampleRate,
          {
            windowMs: WINDOW_MS,
            targetRange: [targetMin, targetMax],
            expectedDurationSeconds: rampSeconds * repetitions,
            repetitions,
            volumeIncreaseThreshold:
              params.volumeIncreaseThreshold,
          },
        );

        const result = scoreControlledCrescendo(
          measurement,
          {
            passingScore: smoothnessTarget,
          },
        );

        const finalScore = Math.round(result.overallScore);

        setSmoothness(finalScore);

        setRepResults(
          measurement.repetitionSmoothness.map(
            (value) => Math.round(value),
          ),
        );

        setRangeReached(result.targetReached);

        setStartDb(
          Math.round(measurement.startDb * 10) / 10,
        );

        setEndDb(
          Math.round(measurement.endDb * 10) / 10,
        );

        setMinDb(
          Math.round(measurement.minDb * 10) / 10,
        );

        setMaxDb(
          Math.round(measurement.maxDb * 10) / 10,
        );

        setPhase('results');

        void saveCompletedExercise(
          'volume',
          'controlledCrescendo',
          resolvedTier,
          finalScore,
        ).catch((saveError) => {
          console.error(
            'Unable to save Controlled Crescendo result:',
            saveError,
          );
        });
      } catch (measurementError) {
        console.error(
          'Unable to measure Controlled Crescendo:',
          measurementError,
        );

        setErrorMessage(
          'We could not analyze this recording. Please try the exercise again.',
        );

        setPhase('directions');
      } finally {
        clearLiveState();
        finishingRef.current = false;
        completedNaturallyRef.current = false;
      }
    },
  });

  /*
   * Run one countdown for each repetition.
   * Stop recording only after the final repetition finishes.
   */
  useEffect(() => {
    if (phase !== 'exercise') {
      return;
    }

    const interval = setInterval(() => {
      setSeconds((previousSeconds) => {
        if (previousSeconds + 1 < rampSeconds) {
          return previousSeconds + 1;
        }

        if (rep < repetitions) {
          setRep((previousRep) => previousRep + 1);
          setLiveHistory([]);
          return 0;
        }

        if (
          !finishingRef.current &&
          !completedNaturallyRef.current
        ) {
          finishingRef.current = true;
          completedNaturallyRef.current = true;

          void stopRecording().catch((stopError) => {
            console.error(
              'Unable to finish Controlled Crescendo recording:',
              stopError,
            );

            finishingRef.current = false;
            completedNaturallyRef.current = false;
            setErrorMessage(
              'The recording could not be completed. Please try again.',
            );
            setPhase('directions');
          });
        }

        return rampSeconds;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, rep, rampSeconds, repetitions, stopRecording]);

  const startExercise = useCallback(async () => {
    setErrorMessage(undefined);
    setRep(1);
    setSeconds(0);
    setSmoothness(0);
    setRepResults(Array(repetitions).fill(0));
    setRangeReached(false);
    setStartDb(0);
    setEndDb(0);
    setMinDb(0);
    setMaxDb(0);
    setLiveFrame(null);
    setLiveHistory([]);

    finishingRef.current = false;
    completedNaturallyRef.current = false;

    try {
      await startRecording();
      setPhase('exercise');
    } catch (recordingError) {
      console.error(
        'Unable to start Controlled Crescendo recording:',
        recordingError,
      );

      setErrorMessage(
        'Microphone recording could not start. Check microphone permission and try again.',
      );

      setPhase('directions');
    }
  }, [repetitions, startRecording]);

  const cancelExercise = useCallback(async () => {
    completedNaturallyRef.current = false;
    finishingRef.current = true;

    try {
      if (isRecording) {
        await stopRecording();
      }
    } catch (stopError) {
      console.error(
        'Unable to stop Controlled Crescendo recording:',
        stopError,
      );
    } finally {
      finishingRef.current = false;
      clearLiveState();
      setPhase('directions');
    }
  }, [clearLiveState, isRecording, stopRecording]);

  const handleBackFromExercise = useCallback(async () => {
    completedNaturallyRef.current = false;
    finishingRef.current = true;

    try {
      if (isRecording) {
        await stopRecording();
      }
    } catch (stopError) {
      console.error(
        'Unable to stop recording before leaving:',
        stopError,
      );
    } finally {
      finishingRef.current = false;
      router.back();
    }
  }, [isRecording, stopRecording]);

  const tryAgain = useCallback(() => {
    void startExercise();
  }, [startExercise]);

  const liveSmoothness = estimateLiveSmoothness(liveHistory);

  const instruction =
    seconds < 1
      ? {
          title: 'START SOFT',
          subtitle: 'Begin with a gentle voice',
        }
      : seconds < rampSeconds - 1
        ? {
            title: 'CRESCENDO',
            subtitle: 'Gradually increase your volume',
          }
        : {
            title: 'REACH TARGET',
            subtitle: 'Finish at the target loudness',
          };

  const tierLabel =
    resolvedTier.charAt(0).toUpperCase() +
    resolvedTier.slice(1);

  const passed =
    smoothness >= smoothnessTarget && rangeReached;

  if (phase === 'directions') {
    return (
      <ExerciseScreen
        title="Controlled Crescendo"
        category="VOLUME CONTROL"
        icon="volume-high-outline"
        tier={resolvedTier}
        instructions={`1. Begin with a soft voice.
          2. Gradually increase your volume.
          3. Keep the increase smooth and even.
          4. Reach the target volume.
          5. Repeat the exercise ${repetitions} times.`}
        summary={[
          {
            label: 'Reference note',
            value: REFERENCE_NOTE.name,
          },
          {
            label: 'Target range',
            value: `${targetMin}–${targetMax} dB`,
          },
          {
            label: 'Duration per repetition',
            value: `${rampSeconds} seconds`,
          },
        ]}
        targetValue={`${targetMin}–${targetMax} dB`}
        targetHint="Start softly and gradually increase your volume."
        repetitions={repetitions}
        tip="Sing the reference note while increasing your volume. Keep your pitch comfortable and avoid straining your voice."
        onBack={() => router.back()}
        onStart={startExercise}
        error={errorMessage}
        startLabel="Start Exercise"
      >
        <View style={styles.referenceCard}>
          <View style={styles.referenceHeader}>
            <View style={styles.referenceIcon}>
              <Ionicons
                name="musical-note"
                size={18}
                color={BROWN}
              />
            </View>

            <View style={styles.referenceText}>
              <Text style={styles.referenceLabel}>
                BEFORE YOU BEGIN
              </Text>

              <Text style={styles.referenceNote}>
                {REFERENCE_NOTE.name}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.replayButton}
              onPress={() => void playReferenceNote()}
              activeOpacity={0.85}
            >
              <Ionicons
                name="play"
                size={13}
                color={BROWN}
              />

              <Text style={styles.replayButtonText}>
                Play note
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.referenceDescription}>
            Listen to the reference note first. During the exercise,
            sing the same note while gradually increasing your volume.
          </Text>
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
                      height: `${targetHeight(index) * 80}%`,
                    },
                  ]}
                />
              ),
            )}
          </View>

          <View style={styles.previewLabels}>
            <Text style={styles.previewLabel}>Soft</Text>
            <Text style={styles.previewLabel}>Loud</Text>
          </View>
        </View>
      </ExerciseScreen>
    );
  }

  if (phase === 'exercise') {
    const progress = clamp(seconds / rampSeconds, 0, 1);

    return (
      <ExerciseListeningScreen
        icon="volume-high-outline"
        title="Controlled Crescendo"
        currentRep={rep}
        repetitions={repetitions}
        elapsed={seconds}
        targetDuration={rampSeconds}
        promptTitle={instruction.title}
        prompt={instruction.subtitle}
        progress={progress}
        onBack={handleBackFromExercise}
        liveContent={
          <View style={styles.liveContent}>
            <View style={styles.exerciseReference}>
              <Ionicons
                name="musical-note-outline"
                size={15}
                color={BROWN}
              />

              <Text style={styles.exerciseReferenceText}>
                Sing {REFERENCE_NOTE.name} while following the crescendo.
              </Text>

              <TouchableOpacity
                style={styles.exerciseReplayButton}
                onPress={() => void playReferenceNote()}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="play"
                  size={11}
                  color={BROWN}
                />

                <Text style={styles.exerciseReplayText}>
                  Replay
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.visualizerCard}>
              <View style={styles.visualizerHeader}>
                <View>
                  <Text style={styles.visualizerTitle}>
                    Your Performance
                  </Text>

                  <Text style={styles.visualizerSubtitle}>
                    Match the target crescendo
                  </Text>
                </View>

                <View style={styles.micCircle}>
                  <Ionicons
                    name="mic"
                    size={18}
                    color={BROWN}
                  />
                </View>
              </View>

              <View style={styles.visualizerLegend}>
                <View style={styles.legendDot} />
                <Text style={styles.legendText}>
                  Your voice
                </Text>
              </View>

              <VolumeVisualizer liveHistory={liveHistory} />

              <View style={styles.visualizerLabels}>
                <Text style={styles.visualizerLabel}>
                  SOFT
                </Text>

                <Text style={styles.visualizerLabel}>
                  LOUD
                </Text>
              </View>
            </View>

            <View style={styles.voiceRow}>
              <View style={styles.voiceLeft}>
                <View style={styles.smallMic}>
                  <Ionicons
                    name="mic-outline"
                    size={17}
                    color={BROWN}
                  />
                </View>

                <View>
                  <Text style={styles.voiceTitle}>
                    Your voice
                  </Text>

                  <Text style={styles.voiceSubtitle}>
                    {liveFrame
                      ? 'Microphone receiving audio'
                      : 'Listening for your voice…'}
                  </Text>
                </View>
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
                <Text style={styles.targetLabel}>
                  TARGET RANGE
                </Text>

                <Text style={styles.targetValue}>
                  {targetMin}–{targetMax} dB
                </Text>
              </View>

              <Text style={styles.patternText}>
                Soft → Loud
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
                  TIME
                </Text>

                <Text style={styles.sessionValue}>
                  0:{String(seconds).padStart(2, '0')}
                </Text>
              </View>

              <View style={styles.sessionDivider} />

              <View style={styles.sessionPart}>
                <Text style={styles.sessionLabel}>
                  SMOOTHNESS
                </Text>

                <Text style={styles.sessionValue}>
                  {liveSmoothness}%
                </Text>
              </View>
            </View>

            <Pressable
              style={styles.stopButton}
              onPress={() => void cancelExercise()}
            >
              <Ionicons
                name="stop"
                size={15}
                color={BROWN}
              />

              <Text style={styles.stopButtonText}>
                Stop Exercise
              </Text>
            </Pressable>
          </View>
        }
      />
    );
  }

  return (
    <ExerciseResultsScreen
      title="Controlled Crescendo"
      subtitle={
        passed
          ? 'Great job! Your crescendo was smooth and controlled.'
          : 'Keep practicing to make your volume increase smoother.'
      }
      score={smoothness}
      scoreSuffix="%"
      scoreMessage={
        passed
          ? 'Exercise Passed'
          : 'Needs More Practice'
      }
      resultIcon={
        passed
          ? 'checkmark-circle-outline'
          : 'refresh-circle-outline'
      }
      scoreDetails={
        <View style={styles.referenceCard}>
          <ResultItem
            label="Target reached"
            value={rangeReached ? 'Yes' : 'No'}
          />
          <ResultItem
            label="Observed range"
            value={`${minDb}–${maxDb} dB`}
          />
          <ResultItem
            label="Start → End"
            value={`${startDb} → ${endDb} dB`}
          />
          <ResultItem
            label="Target smoothness"
            value={`${smoothnessTarget}%`}
          />
          <ResultItem
            label="Difficulty tier"
            value={tierLabel}
          />
        </View>
      }
      onBack={() => router.back()}
      onRetry={tryAgain}
      onExit={() => router.replace('/exercises/volume')}
    >
      <View style={styles.resultDetails}>
        {repResults.map((value, index) => (
          <ResultItem
            key={`rep-${index}`}
            label={`Repetition ${index + 1}`}
            value={`${value}%`}
          />
        ))}

        <ResultItem
          label="Target reached"
          value={rangeReached ? 'Yes' : 'No'}
        />

        <ResultItem
          label="Observed range"
          value={`${minDb}–${maxDb} dB`}
        />

        <ResultItem
          label="Start → End"
          value={`${startDb} → ${endDb} dB`}
        />

        <ResultItem
          label="Difficulty tier"
          value={tierLabel}
        />
      </View>
    </ExerciseResultsScreen>
  );
}

const styles = StyleSheet.create({
  referenceCard: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 13,
    marginTop: 12,
  },
  referenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  referenceIcon: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  referenceText: {
    flex: 1,
  },
  referenceLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    letterSpacing: 1,
    color: ACCENT,
  },
  referenceNote: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginTop: 1,
  },
  replayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: PINK,
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  replayButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    color: BROWN,
  },
  referenceDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 16,
    color: MUTED,
    marginTop: 9,
  },
  previewCard: {
    width: '100%',
    backgroundColor: LIGHT,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 10,
  },
  previewTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },
  previewVisualizer: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 7,
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
    marginTop: 3,
  },
  previewLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  liveContent: {
    width: '100%',
    gap: 8,
  },
  exerciseReference: {
    minHeight: 39,
    borderRadius: 13,
    backgroundColor: LIGHT,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  exerciseReferenceText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: BROWN,
    marginLeft: 6,
  },
  exerciseReplayButton: {
    height: 27,
    paddingHorizontal: 9,
    borderRadius: 14,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  exerciseReplayText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    color: BROWN,
  },
  visualizerCard: {
    width: '100%',
    minHeight: 185,
    backgroundColor: WHITE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 13,
  },
  visualizerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  visualizerTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
  visualizerSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
    marginTop: 2,
  },
  micCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualizerLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 7,
  },
  legendDot: {
    width: 14,
    height: 4,
    borderRadius: 2,
    backgroundColor: BROWN,
  },
  legendText: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,
  },
  visualizer: {
    height: 76,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#FFFAFB',
    borderWidth: 1,
    borderColor: '#F4E5E9',
    overflow: 'hidden',
    justifyContent: 'center',
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
  visualizerLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  visualizerLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    color: MUTED,
  },
  voiceRow: {
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: LIGHT,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  voiceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  smallMic: {
    width: 33,
    height: 33,
    borderRadius: 17,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  voiceTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: BROWN,
  },
  voiceSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,
    marginTop: 1,
  },
  voiceValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
  voiceUnit: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,
  },
  targetRow: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  targetLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    letterSpacing: 0.8,
    color: ACCENT,
  },
  targetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    marginTop: 1,
  },
  patternText: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  sessionRow: {
    minHeight: 48,
    borderRadius: 14,
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
    fontSize: 7,
    color: MUTED,
  },
  sessionValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    marginTop: 2,
  },
  sessionDivider: {
    width: 1,
    height: 29,
    backgroundColor: BORDER,
  },
  stopButton: {
    minHeight: 43,
    borderRadius: 22,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 2,
  },
  stopButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: BROWN,
  },
  resultDetails: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 13,
    marginTop: 12,
  },
  resultItem: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F5E9EC',
    gap: 12,
  },
  resultItemLabel: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  resultItemValue: {
    flexShrink: 1,
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    color: BROWN,
    textAlign: 'right',
  },
});