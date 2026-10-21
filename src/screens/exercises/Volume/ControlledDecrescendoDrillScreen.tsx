import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  CONTROLLED_DECRESCENDO_PARAMS,
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
import { generateControlledDecrescendoParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureControlledDecrescendo } from '@/services/measurement/volume/controlledDecrescendoDrill';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreControlledDecrescendo } from '@/services/scoring/volume/controlledDecrescendoDrill';
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
const BAR_COUNT = 28;
const DBFS_MIN = -60;
const DBFS_MAX = -10;
const REFERENCE_NOTE_DURATION_SEC = 1.5;
const COUNTDOWN_SECONDS = 3;

type ControlledDecrescendoParams =
  typeof CONTROLLED_DECRESCENDO_PARAMS.beginner;

type ExercisePhase =
  | 'directions'
  | 'countdown'
  | 'repCountdown'
  | 'exercise'
  | 'results';

interface ControlledDecrescendoExerciseProps {
  tier?: Tier;
}

interface ResultItemProps {
  label: string;
  value: string;
}

interface VolumeVisualizerProps {
  liveHistory: number[];
}

interface TargetDecrescendoGuideProps {
  seconds: number;
  durationSeconds: number;
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number): number {
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

/**
 * Tall bars represent louder volume; short bars represent softer volume.
 */
function targetHeight(index: number): number {
  const progress = index / Math.max(1, BAR_COUNT - 1);
  return 0.83 - progress * 0.65;
}

/**
 * Estimates how consistently the recorded volume decreases.
 * This is a live display indicator, not the final exercise score.
 */
function calculateLiveSmoothness(values: number[]): number {
  if (values.length < 3) {
    return 0;
  }

  const changes: number[] = [];

  for (let index = 1; index < values.length; index += 1) {
    changes.push(values[index] - values[index - 1]);
  }

  // Ignore very small changes caused by minor microphone fluctuations.
  const meaningfulChanges = changes.filter(
    (change) => Math.abs(change) >= 0.15,
  );

  if (meaningfulChanges.length === 0) {
    return 0;
  }

  const downwardChanges = meaningfulChanges.filter(
    (change) => change < 0,
  ).length;

  const directionalConsistency =
    (downwardChanges / meaningfulChanges.length) * 100;

  const totalDecrease = values[0] - values[values.length - 1];

  if (!Number.isFinite(totalDecrease) || totalDecrease <= 0) {
    return 0;
  }

  const decreaseStrength = clamp((totalDecrease / 8) * 100, 0, 100);

  return Math.round(
    clamp(
      directionalConsistency * 0.8 + decreaseStrength * 0.2,
      0,
      100,
    ),
  );
}

function estimateLiveSmoothness(history: number[]): number {
  if (history.length < 4) {
    return 0;
  }

  const dbValues = history.map(
    (value) => DBFS_MIN + value * (DBFS_MAX - DBFS_MIN),
  );

  return calculateLiveSmoothness(dbValues);
}

/* -------------------------------------------------------------------------- */
/* Visual components                                                          */
/* -------------------------------------------------------------------------- */

function TargetDecrescendoGuide({
  seconds,
  durationSeconds,
}: TargetDecrescendoGuideProps) {
  const progress = clamp(
    durationSeconds > 0 ? seconds / durationSeconds : 0,
    0,
    1,
  );

  const activeIndex = Math.min(
    BAR_COUNT - 1,
    Math.floor(progress * BAR_COUNT),
  );

  return (
    <View style={styles.guideCard}>
      <View style={styles.guideHeader}>
        <View style={styles.guideHeaderText}>
          <Text style={styles.guideTitle}>Follow the target</Text>
          <Text style={styles.guideSubtitle}>
            Gradually lower your volume from loud to soft
          </Text>
        </View>

        <View style={styles.guideIcon}>
          <Ionicons name="trending-down" size={18} color={BROWN} />
        </View>
      </View>

      <View style={styles.guideVisualizer}>
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const isActive = index === activeIndex;
          const hasPassed = index < activeIndex;

          return (
            <View
              key={`target-guide-${index}`}
              style={[
                styles.guideBar,
                {
                  height: `${targetHeight(index) * 100}%`,
                  backgroundColor: isActive
                    ? ACCENT
                    : hasPassed
                      ? '#EAA5B6'
                      : '#F5DDE4',
                },
              ]}
            />
          );
        })}

        <View
          style={[
            styles.guideIndicator,
            { left: `${progress * 100}%` },
          ]}
        />
      </View>

      <View style={styles.guideLabels}>
        <Text style={styles.guideLabel}>LOUD</Text>
        <Text style={styles.guideLabel}>SOFT</Text>
      </View>

      <View style={styles.guideProgressTrack}>
        <View
          style={[
            styles.guideProgressFill,
            { width: `${progress * 100}%` },
          ]}
        />
      </View>
    </View>
  );
}

function VolumeVisualizer({ liveHistory }: VolumeVisualizerProps) {
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

/* -------------------------------------------------------------------------- */
/* Main exercise                                                              */
/* -------------------------------------------------------------------------- */

export default function ControlledDecrescendoDrill({
  tier,
}: ControlledDecrescendoExerciseProps) {
  const [phase, setPhase] = useState<ExercisePhase>('directions');
  const [countdownSeconds, setCountdownSeconds] =
    useState(COUNTDOWN_SECONDS);

  const [loadingParams, setLoadingParams] = useState(true);
  const [resolvedTier, setResolvedTier] = useState<Tier>(
    tier ?? 'beginner',
  );

  const [params, setParams] =
    useState<ControlledDecrescendoParams>(
      CONTROLLED_DECRESCENDO_PARAMS.beginner,
    );

  const [referenceNote, setReferenceNote] = useState(() =>
    createMusicalNote(60),
  );
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [referencePlaybackError, setReferencePlaybackError] =
    useState<string | undefined>();

  const [rep, setRep] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [guideElapsed, setGuideElapsed] = useState(0);

  const [liveFrame, setLiveFrame] = useState<LiveAudioFrame | null>(null);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);

  const [smoothness, setSmoothness] = useState(0);
  const [actualSmoothness, setActualSmoothness] = useState(0);
  const [repResults, setRepResults] = useState<number[]>([]);

  const [rangeReached, setRangeReached] = useState(false);
  const [directionCorrect, setDirectionCorrect] = useState(false);

  const [startDb, setStartDb] = useState(0);
  const [endDb, setEndDb] = useState(0);
  const [minDb, setMinDb] = useState(0);
  const [maxDb, setMaxDb] = useState(0);

  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const finishingRef = useRef(false);
  const completedNaturallyRef = useRef(false);
  const interRepStopRef = useRef(false);
  const phaseRef = useRef<ExercisePhase>(phase);
  const repetitionSamplesRef = useRef<Float32Array[]>([]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const targetMin = params.targetDbRange[0];
  const targetMax = params.targetDbRange[1];
  const rampSeconds = params.durationSec;
  const repetitions = params.repetitions;
  const smoothnessTarget = params.smoothnessThreshold;

  /* -------------------------- Reference note ----------------------------- */

  useEffect(() => {
    let cancelled = false;

    async function loadReferenceNote() {
      try {
        const assessment = await getLatestAssessment();

        if (!assessment || cancelled) {
          return;
        }

        const lowHz = Number(
          assessment.vocalRange?.lowHz ??
            assessment.vocalRangeLowHz ??
            0,
        );

        const highHz = Number(
          assessment.vocalRange?.highHz ??
            assessment.vocalRangeHighHz ??
            0,
        );

        if (
          !Number.isFinite(lowHz) ||
          !Number.isFinite(highHz) ||
          lowHz <= 0 ||
          highHz <= 0 ||
          lowHz > highHz
        ) {
          return;
        }

        const midiForFrequency = (frequency: number) =>
          69 + 12 * Math.log2(frequency / 440);

        const lowestMidi = Math.ceil(midiForFrequency(lowHz));
        const highestMidi = Math.floor(midiForFrequency(highHz));
        const centerFrequency = Math.sqrt(lowHz * highHz);

        let midiNote = Math.round(
          midiForFrequency(centerFrequency),
        );

        if (lowestMidi <= highestMidi) {
          midiNote = clamp(midiNote, lowestMidi, highestMidi);
        }

        if (!cancelled) {
          setReferenceNote(createMusicalNote(midiNote));
        }
      } catch (assessmentError) {
        console.warn(
          'Unable to load the vocal range for Controlled Decrescendo:',
          assessmentError,
        );
      }
    }

    void loadReferenceNote();

    return () => {
      cancelled = true;
    };
  }, []);

  const playReferenceNote = useCallback(async () => {
    if (referencePlaying) {
      return;
    }

    setReferencePlaying(true);
    setReferencePlaybackError(undefined);

    try {
      await playSingleNote(
        referenceNote.frequency,
        REFERENCE_NOTE_DURATION_SEC,
      );
    } catch (playbackError) {
      console.error(
        'Reference note playback failed:',
        playbackError,
      );

      setReferencePlaybackError(
        'Unable to play the reference note. Please try again.',
      );
    } finally {
      setReferencePlaying(false);
    }
  }, [referenceNote, referencePlaying]);

  /* ---------------------- Adaptive difficulty --------------------------- */

  useEffect(() => {
    let cancelled = false;

    async function initializeAdaptiveParams() {
      let currentTier: Tier = tier ?? 'beginner';

      setLoadingParams(true);

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

          recentScores = records
            .filter(
              (record) =>
                record.templateId === 'controlledDecrescendo' &&
                record.tier === currentTier,
            )
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-5)
            .map((record) => record.scorePct);
        }

        if (cancelled) {
          return;
        }

        // Assessment scores are used only when there is no matching
        // completed exercise history for this tier and template.
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
              'Unable to load the Volume assessment for Controlled Decrescendo:',
              assessmentError,
            );
          }
        }

        const generatedParams = generateControlledDecrescendoParams({
          tier: currentTier,
          recentScores,
        });

        if (cancelled) {
          return;
        }

        setParams(generatedParams);
        setRepResults(Array(generatedParams.repetitions).fill(0));
      } catch (initializationError) {
        console.error(
          'Unable to initialize Controlled Decrescendo parameters:',
          initializationError,
        );

        if (cancelled) {
          return;
        }

        const fallbackParams = CONTROLLED_DECRESCENDO_PARAMS[currentTier];

        setResolvedTier(currentTier);
        setParams(fallbackParams);
        setRepResults(Array(fallbackParams.repetitions).fill(0));
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

  /* -------------------------- Live guide timer -------------------------- */

  useEffect(() => {
    if (phase !== 'exercise') {
      setGuideElapsed(0);
      return;
    }

    const startedAt = Date.now();
    setGuideElapsed(0);

    const interval = setInterval(() => {
      setGuideElapsed(
        Math.min((Date.now() - startedAt) / 1000, rampSeconds),
      );
    }, 50);

    return () => clearInterval(interval);
  }, [phase, rep, rampSeconds]);

  /* -------------------------- Audio recorder ---------------------------- */

  const clearLiveState = useCallback(() => {
    setSeconds(0);
    setGuideElapsed(0);
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
      // Save the completed repetition without including the countdown.
      if (interRepStopRef.current) {
        interRepStopRef.current = false;

        if (samples.length > 0) {
          repetitionSamplesRef.current.push(samples);
        }

        return;
      }

      // Manual cancellation must never produce a scored result.
      if (!completedNaturallyRef.current) {
        repetitionSamplesRef.current = [];
        finishingRef.current = false;
        clearLiveState();
        return;
      }

      try {
        const samplesPerRep = Math.floor(rampSeconds * sampleRate);

        const recordedSegments = [
          ...repetitionSamplesRef.current,
          samples,
        ].slice(0, repetitions);

        const trimmedSegments = recordedSegments.map(
          (segment) => segment.slice(0, samplesPerRep),
        );

        const totalSampleCount = trimmedSegments.reduce(
          (total, segment) => total + segment.length,
          0,
        );

        const exerciseSamples = new Float32Array(totalSampleCount);
        let sampleOffset = 0;

        // Join only recorded repetition audio. Do not pad with silence.
        for (const segment of trimmedSegments) {
          exerciseSamples.set(segment, sampleOffset);
          sampleOffset += segment.length;
        }

        repetitionSamplesRef.current = [];

        const measurement = measureControlledDecrescendo(
          exerciseSamples,
          sampleRate,
          {
            windowMs: WINDOW_MS,
            targetRange: [targetMin, targetMax],
            expectedDurationSeconds: rampSeconds * repetitions,
            repetitions,
            volumeDecreaseThreshold: params.volumeDecreaseThreshold,
          },
        );

        const result = scoreControlledDecrescendo(measurement, {
          passingScore: smoothnessTarget,
        });

        const finalScore = Math.round(result.overallScore);

        setSmoothness(finalScore);
        setActualSmoothness(Math.round(measurement.smoothness));
        setRepResults(
          measurement.repSmoothness.map((value) => Math.round(value)),
        );
        setRangeReached(result.targetReached);
        setDirectionCorrect(result.directionCorrect);

        setStartDb(Math.round(measurement.startDb * 10) / 10);
        setEndDb(Math.round(measurement.endDb * 10) / 10);
        setMinDb(Math.round(measurement.minDb * 10) / 10);
        setMaxDb(Math.round(measurement.maxDb * 10) / 10);

        phaseRef.current = 'results';
        setPhase('results');

        void saveCompletedExercise(
          'volume',
          'controlledDecrescendo',
          resolvedTier,
          finalScore,
        ).catch((saveError) => {
          console.error(
            'Unable to save Controlled Decrescendo result:',
            saveError,
          );
        });
      } catch (measurementError) {
        console.error(
          'Unable to measure Controlled Decrescendo:',
          measurementError,
        );

        setErrorMessage(
          'We could not analyze this recording. Please try the exercise again.',
        );

        phaseRef.current = 'directions';
        setPhase('directions');
      } finally {
        clearLiveState();
        finishingRef.current = false;
        completedNaturallyRef.current = false;
      }
    },
  });

  /* --------------------- Stop between repetitions ----------------------- */

  useEffect(() => {
    if (
      phase !== 'repCountdown' ||
      !isRecording ||
      finishingRef.current
    ) {
      return;
    }

    interRepStopRef.current = true;

    void stopRecording().catch((stopError) => {
      interRepStopRef.current = false;
      repetitionSamplesRef.current = [];
      finishingRef.current = false;

      console.error(
        'Unable to save the Controlled Decrescendo repetition:',
        stopError,
      );

      setErrorMessage(
        'The repetition could not be recorded. Please try the exercise again.',
      );

      phaseRef.current = 'directions';
      setPhase('directions');
    });
  }, [phase, isRecording, stopRecording]);

  /* ------------------------- Countdown handling ------------------------- */

  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'repCountdown') {
      return;
    }

    let cancelled = false;

    setCountdownSeconds(COUNTDOWN_SECONDS);

    const interval = setInterval(() => {
      setCountdownSeconds((previous) => {
        if (previous > 1) {
          return previous - 1;
        }

        clearInterval(interval);

        const isNextRepetition = phase === 'repCountdown';

        void (async () => {
          try {
            await startRecording();

            if (cancelled) {
              return;
            }

            if (isNextRepetition) {
              setRep((previousRep) =>
                Math.min(previousRep + 1, repetitions),
              );
            }

            setSeconds(0);
            setGuideElapsed(0);
            setLiveFrame(null);
            setLiveHistory([]);

            phaseRef.current = 'exercise';
            setPhase('exercise');
          } catch (recordingError) {
            if (cancelled) {
              return;
            }

            console.error(
              'Unable to start Controlled Decrescendo recording:',
              recordingError,
            );

            repetitionSamplesRef.current = [];
            interRepStopRef.current = false;
            completedNaturallyRef.current = false;
            finishingRef.current = false;

            setErrorMessage(
              'Microphone recording could not start. Check microphone permission and try again.',
            );

            phaseRef.current = 'directions';
            setPhase('directions');
          }
        })();

        return 0;
      });
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, startRecording, repetitions]);

  /* ---------------------- Exercise duration timer ----------------------- */

  useEffect(() => {
    if (phase !== 'exercise') {
      return;
    }

    const interval = setInterval(() => {
      setSeconds((previousSeconds) => {
        if (previousSeconds + 1 < rampSeconds) {
          return previousSeconds + 1;
        }

        // Each repetition is stopped and stored separately.
        if (rep < repetitions) {
          phaseRef.current = 'repCountdown';
          setPhase('repCountdown');
          return rampSeconds;
        }

        // Only the final repetition completes and triggers measurement.
        if (
          !finishingRef.current &&
          !completedNaturallyRef.current
        ) {
          finishingRef.current = true;
          completedNaturallyRef.current = true;

          void stopRecording().catch((stopError) => {
            console.error(
              'Unable to finish Controlled Decrescendo recording:',
              stopError,
            );

            finishingRef.current = false;
            completedNaturallyRef.current = false;
            repetitionSamplesRef.current = [];

            setErrorMessage(
              'The recording could not be completed. Please try again.',
            );

            phaseRef.current = 'directions';
            setPhase('directions');
          });
        }

        return rampSeconds;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, rep, rampSeconds, repetitions, stopRecording]);

  /* -------------------------- Exercise actions -------------------------- */

  const startExercise = useCallback(() => {
    setErrorMessage(undefined);

    setRep(1);
    setSeconds(0);
    setGuideElapsed(0);

    setSmoothness(0);
    setActualSmoothness(0);
    setRepResults(Array(repetitions).fill(0));

    setRangeReached(false);
    setDirectionCorrect(false);

    setStartDb(0);
    setEndDb(0);
    setMinDb(0);
    setMaxDb(0);

    setLiveFrame(null);
    setLiveHistory([]);

    finishingRef.current = false;
    completedNaturallyRef.current = false;
    interRepStopRef.current = false;
    repetitionSamplesRef.current = [];

    setCountdownSeconds(COUNTDOWN_SECONDS);

    phaseRef.current = 'countdown';
    setPhase('countdown');
  }, [repetitions]);

  const cancelExercise = useCallback(async () => {
    completedNaturallyRef.current = false;
    interRepStopRef.current = false;
    repetitionSamplesRef.current = [];
    finishingRef.current = true;

    try {
      if (isRecording) {
        await stopRecording();
      }
    } catch (stopError) {
      console.error(
        'Unable to stop Controlled Decrescendo recording:',
        stopError,
      );
    } finally {
      finishingRef.current = false;
      clearLiveState();

      phaseRef.current = 'directions';
      setPhase('directions');
    }
  }, [clearLiveState, isRecording, stopRecording]);

  const handleBackFromExercise = useCallback(async () => {
    completedNaturallyRef.current = false;
    interRepStopRef.current = false;
    repetitionSamplesRef.current = [];
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
    startExercise();
  }, [startExercise]);

  /* ---------------------------- Render states --------------------------- */

  if (loadingParams) {
    return (
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons name="options-outline" size={44} color={BROWN} />
        </View>

        <Text style={styles.preparingTitle}>
          Preparing Your Exercise
        </Text>

        <Text style={styles.preparingSubtitle}>
          Adjusting the exercise to your current difficulty level
          and preparing your vocal volume targets.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  }

  const liveSmoothness = estimateLiveSmoothness(liveHistory);

  const instruction =
    seconds < 1
      ? {
          title: 'START LOUD',
          subtitle: 'Begin with a comfortable, steady voice',
        }
      : seconds < rampSeconds - 1
        ? {
            title: 'DECRESCENDO',
            subtitle: 'Gradually decrease your volume',
          }
        : {
            title: 'FINISH SOFT',
            subtitle: 'End softly without stopping abruptly',
          };

  const tierLabel =
    resolvedTier.charAt(0).toUpperCase() + resolvedTier.slice(1);

  const passed = smoothness >= smoothnessTarget;

  /* ----------------------------- Directions ----------------------------- */

  if (phase === 'directions') {
    return (
      <ExerciseScreen
        title="Controlled Decrescendo"
        category="VOLUME CONTROL"
        icon="volume-low-outline"
        tier={resolvedTier}
        instructions={`1. Begin with a comfortable, steady voice.
2. Gradually decrease your volume.
3. Keep the decrease smooth and even.
4. Finish softly without abruptly stopping.
5. Repeat the exercise ${repetitions} times.`}
        summary={[
          {
            label: 'Reference note',
            value: referenceNote.name,
          },
          {
            label: 'Target range',
            value: `${targetMax}–${targetMin} dB`,
          },
          {
            label: 'Duration per repetition',
            value: `${rampSeconds} seconds`,
          },
        ]}
        targetValue={`${targetMax}–${targetMin} dB`}
        targetHint="Begin comfortably loud, then gradually lower your volume."
        repetitions={repetitions}
        tip="Sing the reference note while gradually reducing your volume. Keep your pitch steady and avoid letting the sound fade out too early."
        onBack={() => router.back()}
        onStart={startExercise}
        error={errorMessage}
        startLabel="Start Exercise"
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
            Play the note, then sing it while gradually decreasing your
            volume from loud to soft.
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
              <Ionicons name="play" size={17} color={BROWN} />
            )}

            <Text style={styles.referenceButtonText}>
              {referencePlaying
                ? 'Playing...'
                : `Play ${referenceNote.name}`}
            </Text>
          </TouchableOpacity>

          {referencePlaybackError && (
            <Text style={styles.playbackError}>
              {referencePlaybackError}
            </Text>
          )}
        </View>

        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>Follow this pattern</Text>

          <View style={styles.previewVisualizer}>
            {Array.from({ length: BAR_COUNT }, (_, index) => (
              <View
                key={`preview-${index}`}
                style={[
                  styles.previewBar,
                  { height: `${targetHeight(index) * 80}%` },
                ]}
              />
            ))}
          </View>

          <View style={styles.previewLabels}>
            <Text style={styles.previewLabel}>Loud</Text>
            <Text style={styles.previewLabel}>Soft</Text>
          </View>
        </View>
      </ExerciseScreen>
    );
  }

  /* ------------------------------ Countdown ----------------------------- */

  if (phase === 'countdown' || phase === 'repCountdown') {
    const isNextRepetition = phase === 'repCountdown';

    return (
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons name="musical-note" size={32} color={BROWN} />
        </View>

        <Text style={styles.preparingTitle}>
          {isNextRepetition
            ? `Repetition ${Math.min(rep + 1, repetitions)}`
            : 'Get Ready!'}
        </Text>

        <Text style={styles.preparingSubtitle}>
          {isNextRepetition
            ? 'Take a breath. Prepare to begin loudly, then gradually lower your volume.'
            : 'Get ready to sing the reference note. Begin comfortably loud when the countdown ends.'}
        </Text>

        <Text style={styles.countdownNumber}>
          {countdownSeconds}
        </Text>

        <Text style={styles.countdownCaption}>
          {isNextRepetition
            ? `NEXT REPETITION · ${Math.min(rep + 1, repetitions)} OF ${repetitions}`
            : 'YOUR EXERCISE STARTS IN'}
        </Text>
      </View>
    );
  }

  /* ------------------------------- Exercise ----------------------------- */

  if (phase === 'exercise') {
    const progress = clamp((seconds / rampSeconds) * 100, 0, 100);

    return (
      <ExerciseListeningScreen
        icon="volume-low-outline"
        title="Controlled Decrescendo"
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
                Sing {referenceNote.name} while following the decrescendo.
              </Text>

              <TouchableOpacity
                style={[
                  styles.exerciseReplayButton,
                  referencePlaying && styles.disabled,
                ]}
                onPress={() => void playReferenceNote()}
                disabled={referencePlaying}
                activeOpacity={0.85}
              >
                {referencePlaying ? (
                  <ActivityIndicator size="small" color={BROWN} />
                ) : (
                  <>
                    <Ionicons name="play" size={11} color={BROWN} />
                    <Text style={styles.exerciseReplayText}>
                      Replay
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TargetDecrescendoGuide
              seconds={guideElapsed}
              durationSeconds={rampSeconds}
            />

            <View style={styles.visualizerCard}>
              <View style={styles.visualizerHeader}>
                <View>
                  <Text style={styles.visualizerTitle}>
                    Your Performance
                  </Text>
                  <Text style={styles.visualizerSubtitle}>
                    Compare your voice with the target above
                  </Text>
                </View>

                <View style={styles.micCircle}>
                  <Ionicons name="mic" size={18} color={BROWN} />
                </View>
              </View>

              <View style={styles.visualizerLegend}>
                <View style={styles.legendDot} />
                <Text style={styles.legendText}>Your voice</Text>
              </View>

              <VolumeVisualizer liveHistory={liveHistory} />

              <View style={styles.visualizerLabels}>
                <Text style={styles.visualizerLabel}>LIVE AUDIO</Text>
                <Text style={styles.visualizerLabel}>RECENT VOLUME</Text>
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
                  <Text style={styles.voiceTitle}>Your voice</Text>
                  <Text style={styles.voiceSubtitle}>
                    {liveFrame
                      ? 'Microphone receiving audio'
                      : 'Listening for your voice…'}
                  </Text>
                </View>
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
                <Text style={styles.targetLabel}>TARGET RANGE</Text>
                <Text style={styles.targetValue}>
                  {targetMax}–{targetMin} dB
                </Text>
              </View>

              <Text style={styles.patternText}>Loud → Soft</Text>
            </View>

            <View style={styles.sessionRow}>
              <View style={styles.sessionPart}>
                <Text style={styles.sessionLabel}>REPETITION</Text>
                <Text style={styles.sessionValue}>
                  {rep} / {repetitions}
                </Text>
              </View>

              <View style={styles.sessionDivider} />

              <View style={styles.sessionPart}>
                <Text style={styles.sessionLabel}>TIME</Text>
                <Text style={styles.sessionValue}>
                  0:{String(seconds).padStart(2, '0')}
                </Text>
              </View>

              <View style={styles.sessionDivider} />

              <View style={styles.sessionPart}>
                <Text style={styles.sessionLabel}>SMOOTHNESS</Text>
                <Text style={styles.sessionValue}>
                  {liveSmoothness}%
                </Text>
              </View>
            </View>

            <Pressable
              style={styles.stopButton}
              onPress={() => void cancelExercise()}
            >
              <Ionicons name="stop" size={15} color={BROWN} />
              <Text style={styles.stopButtonText}>Stop Exercise</Text>
            </Pressable>
          </View>
        }
      />
    );
  }

  /* -------------------------------- Results ----------------------------- */

  return (
    <ExerciseResultsScreen
      title="Controlled Decrescendo"
      subtitle={
        passed
          ? 'Great job! Your decrescendo was smooth and controlled.'
          : 'Keep practicing to make your volume decrease more smoothly.'
      }
      score={smoothness}
      scoreSuffix="%"
      scoreMessage={passed ? 'Exercise Passed' : 'Needs More Practice'}
      resultIcon={
        passed
          ? 'checkmark-circle-outline'
          : 'refresh-circle-outline'
      }
      scoreDetails={
        <View style={styles.referenceCard}>
          <ResultItem
            label="Direction correct"
            value={directionCorrect ? 'Yes' : 'No'}
          />
          <ResultItem
            label="Target range reached"
            value={rangeReached ? 'Yes' : 'No'}
          />
          <ResultItem
            label="Observed range"
            value={`${minDb}–${maxDb} dBFS`}
          />
          <ResultItem
            label="Start → End"
            value={`${startDb} → ${endDb} dBFS`}
          />
          <ResultItem
            label="Actual smoothness"
            value={`${actualSmoothness}%`}
          />
          <ResultItem
            label="Target smoothness"
            value={`${smoothnessTarget}%`}
          />
          <ResultItem label="Difficulty tier" value={tierLabel} />
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
      </View>
    </ExerciseResultsScreen>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

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
  countdownNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 18,
  },
  countdownCaption: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    letterSpacing: 1,
    color: ACCENT,
    textAlign: 'center',
    marginTop: 8,
  },

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
    marginTop: 7,
    overflow: 'hidden',
  },
  previewBar: {
    flex: 1,
    maxWidth: 7,
    backgroundColor: '#EAA5B6',
    borderRadius: 4,
    marginHorizontal: 1,
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
    minHeight: 27,
    paddingHorizontal: 9,
    borderRadius: 14,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseReplayText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    color: BROWN,
    marginLeft: 4,
  },

  guideCard: {
    width: '100%',
    backgroundColor: LIGHT,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  guideHeaderText: {
    flex: 1,
    paddingRight: 8,
  },
  guideTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },
  guideSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    lineHeight: 14,
    color: MUTED,
    marginTop: 2,
  },
  guideIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideVisualizer: {
    height: 55,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    marginTop: 8,
    position: 'relative',
  },
  guideBar: {
    flex: 1,
    maxWidth: 7,
    borderRadius: 4,
    marginHorizontal: 1,
  },
  guideIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: BROWN,
    opacity: 0.8,
  },
  guideLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  guideLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    letterSpacing: 0.5,
    color: MUTED,
  },
  guideProgressTrack: {
    height: 4,
    borderRadius: 3,
    backgroundColor: '#F3E3E8',
    overflow: 'hidden',
    marginTop: 8,
  },
  guideProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: ACCENT,
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
    marginLeft: 6,
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
  },
  actualBar: {
    flex: 1,
    maxWidth: 8,
    backgroundColor: BROWN,
    borderRadius: 5,
    marginHorizontal: 1,
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
    marginTop: 2,
  },
  stopButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: BROWN,
    marginLeft: 6,
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
    paddingVertical: 7,
  },
  resultItemLabel: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginRight: 12,
  },
  resultItemValue: {
    flexShrink: 1,
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    color: BROWN,
    textAlign: 'right',
  },
});