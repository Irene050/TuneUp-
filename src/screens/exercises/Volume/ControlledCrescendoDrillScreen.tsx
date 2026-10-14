import {
  CONTROLLED_CRESCENDO_PARAMS,
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
  generateControlledCrescendoParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import { auth } from '@/services/firebase/config';
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
  // Audio frames may report linear amplitude (0–1) instead of dBFS.
  // Convert amplitude to dBFS before mapping it to the visualizer range.
  const dbfs =
    value >= 0 && value <= 1
      ? 20 * Math.log10(Math.max(value, 0.001))
      : value;
  return clamp(
    (dbfs - DBFS_MIN) / (DBFS_MAX - DBFS_MIN),
    0,
    1,
  );
}

function targetHeight(index: number): number {
  const progress = index / (BAR_COUNT - 1);
  return 0.18 + progress * 0.65;
}

function guideCrescendoHeight(index: number): number {
  const progress = index / (BAR_COUNT - 1);
  // Make the rise from soft to loud much easier to recognize.
  return 0.08 + Math.pow(progress, 0.75) * 0.92;
}

function calculateLiveSmoothness(values: number[]): number {
  if (values.length < 4) {
    return 0;
  }
  const netRise = values[values.length - 1] - values[0];
  // Require a real increase in loudness; silence or a flat signal scores 0.
  if (!Number.isFinite(netRise) || netRise < 1.5) {
    return 0;
  }
  const derivatives: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    derivatives.push(values[index] - values[index - 1]);
  }
  const upwardChange = derivatives.reduce(
    (sum, value) => sum + Math.max(value, 0),
    0,
  );
  const downwardChange = derivatives.reduce(
    (sum, value) => sum + Math.abs(Math.min(value, 0)),
    0,
  );
  const totalChange = upwardChange + downwardChange;
  if (totalChange === 0) {
    return 0;
  }
  const directionConsistency = upwardChange / totalChange;
  const meanDerivative =
    derivatives.reduce((sum, value) => sum + value, 0) /
    derivatives.length;
  const derivativeVariance =
    derivatives.reduce(
      (sum, value) => sum + (value - meanDerivative) ** 2,
      0,
    ) / derivatives.length;
  const derivativeStdDev = Math.sqrt(derivativeVariance);
  const rampConsistency =
    1 / (1 + derivativeStdDev / Math.max(meanDerivative, 0.5));
  return clamp(
    directionConsistency * 65 + rampConsistency * 35,
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

function TargetCrescendoGuide({
  seconds,
  durationSeconds,
}: {
  seconds: number;
  durationSeconds: number;
}) {
  const progress = clamp(
    durationSeconds > 0 ? seconds / durationSeconds : 0,
    0,
    1,
  );
  const activeBarPosition = progress * (BAR_COUNT - 1);
  const activeBarIndex = Math.floor(activeBarPosition);
  const indicatorLeft = Math.min(progress * 100, 98.5);
  return (
    <View style={styles.guideCard}>
      <Text style={styles.guideTitle}>Follow this pattern</Text>
      <Text style={styles.guideSubtitle}>
        Start softly, then gradually get louder until the guide reaches Loud.
      </Text>
      <View style={styles.guideBars}>
        {Array.from({ length: BAR_COUNT }, (_, index) => (
          <View
            key={`guide-${index}`}
            style={[
              styles.guideBar,
              {
                height: `${guideCrescendoHeight(index) * 100}%`,
                backgroundColor:
                  index === activeBarIndex
                    ? ACCENT
                    : index < activeBarPosition
                      ? '#EAA5B6'
                      : '#F7DCE3',
              },
            ]}
          />
        ))}
        <View
          pointerEvents="none"
          style={[styles.guideIndicator, { left: `${indicatorLeft}%` }]}
        />
      </View>
      <View style={styles.guideLabels}>
        <Text style={styles.guideLabel}>SOFT</Text>
        <Text style={styles.guideLabel}>LOUD</Text>
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
    'directions' | 'exercise' | 'countdown' | 'results'
  >('directions');
  // Show the preparation screen while adaptive exercise parameters load.
  const [loadingParams, setLoadingParams] = useState(true);
  const [resolvedTier, setResolvedTier] = useState<Tier>(
    tier ?? 'beginner',
  );
  const [params, setParams] =
    useState<ControlledCrescendoParams>(
      CONTROLLED_CRESCENDO_PARAMS.beginner,
    );
  const [referenceNote, setReferenceNote] = useState(() =>
    createMusicalNote(60),
  );
  const [referenceNoteReady, setReferenceNoteReady] = useState(false);
  // Use the latest assessment's detected vocal range for the reference note.
  // Keep C4 as a fallback when no valid range is available.
  useEffect(() => {
    let cancelled = false;
    async function loadReferenceNote() {
      try {
        const assessment = await getLatestAssessment();
        if (!assessment || cancelled) {
          return;
        }
        const lowHz = Number(
          assessment.vocalRange?.lowHz ?? assessment.vocalRangeLowHz ?? 0,
        );
        const highHz = Number(
          assessment.vocalRange?.highHz ?? assessment.vocalRangeHighHz ?? 0,
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
        let midiNote = Math.round(midiForFrequency(centerFrequency));
        if (lowestMidi <= highestMidi) {
          midiNote = clamp(midiNote, lowestMidi, highestMidi);
        }
        if (!cancelled) {
          setReferenceNote(createMusicalNote(midiNote));
        }
      } catch (assessmentError) {
        console.warn(
          'Unable to load the vocal range for Controlled Crescendo reference note:',
          assessmentError,
        );
      } finally {
        if (!cancelled) {
          setReferenceNoteReady(true);
        }
      }
    }
    void loadReferenceNote();
    return () => {
      cancelled = true;
    };
  }, []);
  const [rep, setRep] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [countdownReady, setCountdownReady] = useState(false);
  const [guideElapsed, setGuideElapsed] = useState(0);
  const [, setLiveFrame] =
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
  const interRepStopRef = useRef(false);
  const repetitionSamplesRef = useRef<Float32Array[]>([]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const targetMin = params.targetDbRange[0];
  const targetMax = params.targetDbRange[1];
  const rampSeconds = params.durationSec;
  const repetitions = params.repetitions;
  const smoothnessTarget = params.smoothnessThreshold;
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
      setLoadingParams(true);
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
  const playReferenceNote = useCallback(async () => {
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
    }
  }, [referenceNote]);
  useEffect(() => {
    if (phase === 'directions' && !loadingParams && referenceNoteReady) {
      void playReferenceNote();
    }
  }, [phase, playReferenceNote, loadingParams, referenceNoteReady]);
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
      // Save this repetition's raw samples, then exclude the upcoming countdown
      // from the final measurement by combining only recorded segments.
      if (interRepStopRef.current) {
        interRepStopRef.current = false;
        if (samples.length > 0) {
          repetitionSamplesRef.current.push(samples);
        }
        return;
      }
      /*
       * A manual stop or navigation cancels the attempt.
       * Only a naturally completed recording is scored and saved.
       */
      if (!completedNaturallyRef.current) {
        repetitionSamplesRef.current = [];
        finishingRef.current = false;
        clearLiveState();
        return;
      }
      try {
        const recordedSegments = [
          ...repetitionSamplesRef.current,
          samples,
        ];
        const totalSampleCount = recordedSegments.reduce(
          (total, segment) => total + segment.length,
          0,
        );
        const completeSamples = new Float32Array(totalSampleCount);
        let sampleOffset = 0;
        for (const segment of recordedSegments) {
          completeSamples.set(segment, sampleOffset);
          sampleOffset += segment.length;
        }
        repetitionSamplesRef.current = [];
        const measurement = measureControlledCrescendo(
          completeSamples,
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
        console.log('🎤 CRESCENDO MEASUREMENT:', {
          validWindowCount: measurement.validWindowCount,
          durationSeconds: measurement.durationSeconds,
          startDb: measurement.startDb,
          endDb: measurement.endDb,
          meanDerivative: measurement.meanDerivative,
          smoothness: measurement.smoothness,
          targetReached: measurement.targetReached,
          quality: measurement.overallMeasurementQuality,
        });
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
  // The visible guide and timer run only during an active repetition.
  useEffect(() => {
    if (phase !== 'exercise') {
      return;
    }
    const interval = setInterval(() => {
      setSeconds((previousSeconds) =>
        Math.min(previousSeconds + 1, rampSeconds),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, rampSeconds]);
  // Stop between repetitions, collect that segment, then show a 3-second
  // preparation countdown. The recording pause is excluded from scoring.
  useEffect(() => {
    if (phase !== 'exercise' || seconds < rampSeconds) {
      return;
    }
    if (rep < repetitions) {
      if (finishingRef.current) {
        return;
      }
      finishingRef.current = true;
      interRepStopRef.current = true;
      phaseRef.current = 'countdown';
      setPhase('countdown');
      setRep((previousRep) => previousRep + 1);
      setSeconds(0);
      setCountdown(3);
      setCountdownReady(false);
      setLiveFrame(null);
      setLiveHistory([]);
      void stopRecording()
        .then(() => {
          finishingRef.current = false;
          setCountdownReady(true);
        })
        .catch((stopError) => {
          console.error(
            'Unable to pause before the next Controlled Crescendo repetition:',
            stopError,
          );
          interRepStopRef.current = false;
          repetitionSamplesRef.current = [];
          finishingRef.current = false;
          setErrorMessage('The recording could not continue. Please try again.');
          phaseRef.current = 'directions';
          setPhase('directions');
        });
      return;
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
        repetitionSamplesRef.current = [];
        setErrorMessage(
          'The recording could not be completed. Please try again.',
        );
        phaseRef.current = 'directions';
        setPhase('directions');
      });
    }
  }, [phase, seconds, rep, rampSeconds, repetitions, stopRecording]);
  // Countdown runs only after the previous recording segment has fully stopped.
  useEffect(() => {
    if (phase !== 'countdown' || !countdownReady) {
      return;
    }
    const timeout = setTimeout(() => {
      if (countdown > 1) {
        setCountdown((value) => value - 1);
        return;
      }
      setCountdownReady(false);
      setSeconds(0);
      setLiveFrame(null);
      setLiveHistory([]);
      phaseRef.current = 'exercise';
      void startRecording()
        .then(() => {
          setPhase('exercise');
        })
        .catch((recordingError) => {
          console.error(
            'Unable to restart Controlled Crescendo recording:',
            recordingError,
          );
          repetitionSamplesRef.current = [];
          phaseRef.current = 'directions';
          setErrorMessage(
            'Microphone recording could not restart. Please try again.',
          );
          setPhase('directions');
        });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [phase, countdown, countdownReady, startRecording]);
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
    interRepStopRef.current = false;
    repetitionSamplesRef.current = [];
    setCountdown(3);
    setCountdownReady(false);
    try {
      await playReferenceNote();
      phaseRef.current = 'countdown';
      setPhase('countdown');
      setCountdownReady(true);
    } catch (recordingError) {
      phaseRef.current = 'directions';
      repetitionSamplesRef.current = [];
      interRepStopRef.current = false;
      console.error(
        'Unable to start Controlled Crescendo recording:',
        recordingError,
      );
      setErrorMessage(
        'Microphone recording could not start. Check microphone permission and try again.',
      );
      setPhase('directions');
    }
  }, [playReferenceNote, repetitions]);
  const cancelExercise = useCallback(async () => {
    completedNaturallyRef.current = false;
    interRepStopRef.current = false;
    repetitionSamplesRef.current = [];
    finishingRef.current = true;
    phaseRef.current = 'directions';
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
      phaseRef.current = 'directions';
      setPhase('directions');
    }
  }, [clearLiveState, isRecording, stopRecording]);
  const handleBackFromExercise = useCallback(async () => {
    completedNaturallyRef.current = false;
    interRepStopRef.current = false;
    repetitionSamplesRef.current = [];
    finishingRef.current = true;
    phaseRef.current = 'directions';
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
      phaseRef.current = 'directions';
      router.back();
    }
  }, [isRecording, stopRecording]);
  const tryAgain = useCallback(() => {
    void startExercise();
  }, [startExercise]);
  if (loadingParams) {
    return (
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons name="options-outline" size={32} color={BROWN} />
        </View>
        <Text style={styles.preparingTitle}>Preparing Your Exercise</Text>
        <Text style={styles.preparingSubtitle}>
          Adjusting the exercise to your current difficulty level and preparing your vocal range.
        </Text>
        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.preparingSpinner}
        />
      </View>
    );
  }
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
            value: referenceNote.name,
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
                {referenceNote.name}
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
  if (phase === 'countdown') {
    return (
      <ExerciseListeningScreen
        icon="volume-high-outline"
        title="Controlled Crescendo"
        currentRep={rep}
        repetitions={repetitions}
        elapsed={0}
        targetDuration={rampSeconds}
        promptTitle={`Get ready for repetition ${rep}`}
        prompt="Take a breath. Begin softly when the countdown ends."
        progress={0}
        onBack={handleBackFromExercise}
        liveContent={
          <View style={styles.countdownContent}>
            <Text style={styles.countdownEyebrow}>NEXT REPETITION STARTS IN</Text>
            <View style={styles.countdownCircle}>
              <Text style={styles.countdownNumber}>{countdown}</Text>
            </View>
            <Text style={styles.countdownSubtitle}>
              Get ready to start softly, then build toward Loud.
            </Text>
            <TargetCrescendoGuide
              seconds={0}
              durationSeconds={rampSeconds}
            />
          </View>
        }
      />
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
                Sing {referenceNote.name} while following the crescendo.
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
            <TargetCrescendoGuide
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
            <View style={styles.targetRow}>
              <View>
                <Text style={styles.targetLabel}>
                  TARGET RANGE
                </Text>
                <Text style={styles.targetValue}>
                  {targetMin} → {targetMax} dB
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
    fontSize: 20,
    color: BROWN,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 285,
  },
  preparingSpinner: {
    marginTop: 24,
  },
  referenceCard:
  {
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
  guideCard: {
    width: '100%',
    backgroundColor: LIGHT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  guideTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: BROWN,
  },
  guideSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,
    marginTop: 2,
  },
  guideBars: {
    height: 54,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  guideBar: {
    flex: 1,
    minWidth: 1,
    borderRadius: 3,
  },
  guideIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    borderRadius: 2,
    backgroundColor: ACCENT,
    opacity: 0.95,
  },
  guideLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  guideLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 7,
    color: MUTED,
  },
  guideProgressTrack: {
    height: 3,
    marginTop: 5,
    borderRadius: 2,
    backgroundColor: '#F3E4E8',
    overflow: 'hidden',
  },
  guideProgressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
  countdownContent: {
    width: '100%',
    gap: 12,
    alignItems: 'center',
  },
  countdownEyebrow: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: ACCENT,
    textAlign: 'center',
  },
  countdownCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 44,
    color: BROWN,
  },
  countdownSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginBottom: 2,
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
