import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    BackHandler,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import {
    CONTROLLED_DECRESCENDO_PARAMS,
    type Tier,
} from '@/constants/params';
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

import { COLORS } from '@/constants/appConstants';

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

interface QuitExerciseModalProps {
  visible: boolean;
  isQuitting: boolean;
  onContinue: () => void;
  onQuit: () => void;
}

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

function targetHeight(index: number): number {
  const progress = index / Math.max(1, BAR_COUNT - 1);
  return 0.83 - progress * 0.65;
}

function calculateLiveSmoothness(values: number[]): number {
  if (values.length < 3) {
    return 0;
  }

  const changes: number[] = [];

  for (let index = 1; index < values.length; index += 1) {
    changes.push(values[index] - values[index - 1]);
  }

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
          <Ionicons name="trending-down" size={18} color={COLORS.brown} />
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
                    ? COLORS.accent
                    : hasPassed
                      ? COLORS.otherpink
                      : COLORS.border,
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

function QuitExerciseModal({
  visible,
  isQuitting,
  onContinue,
  onQuit,
}: QuitExerciseModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onContinue}
    >
      <View style={styles.quitModalOverlay}>
        <View style={styles.quitModalCard}>
          <View style={styles.quitModalIconCircle}>
            <Ionicons name="exit-outline" size={30} color={COLORS.brown} />
          </View>

          <Text style={styles.quitModalTitle}>Quit exercise?</Text>

          <Text style={styles.quitModalSubtitle}>
            Your exercise is paused. Your completed repetitions will be
            kept. Continue to resume your exercise.
          </Text>

          <TouchableOpacity
            style={[
              styles.continueButton,
              isQuitting && styles.modalButtonDisabled,
            ]}
            onPress={onContinue}
            activeOpacity={0.75}
            disabled={isQuitting}
          >
            <Text style={styles.continueButtonText}>
              Continue Exercise
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.quitButton,
              isQuitting && styles.modalButtonDisabled,
            ]}
            onPress={onQuit}
            activeOpacity={0.75}
            disabled={isQuitting}
          >
            <Text style={styles.quitButtonText}>
              {isQuitting ? 'Stopping...' : 'Quit Exercise'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}


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

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const finishingRef = useRef(false);
  const completedNaturallyRef = useRef(false);
  const interRepStopRef = useRef(false);
  const discardInterruptedStopRef = useRef(false);
  const phaseRef = useRef<ExercisePhase>(phase);
  const showQuitModalRef = useRef(false);
  const pausedPhaseRef = useRef<ExercisePhase>('directions');
  const quitInProgressRef = useRef(false);
  const repetitionSamplesRef = useRef<Float32Array[]>([]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    showQuitModalRef.current = showQuitModal;
  }, [showQuitModal]);

  const targetMin = params.targetDbRange[0];
  const targetMax = params.targetDbRange[1];
  const rampSeconds = params.durationSec;
  const repetitions = params.repetitions;
  const smoothnessTarget = params.smoothnessThreshold;

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
      if (
        phaseRef.current !== 'exercise' ||
        showQuitModalRef.current
      ) {
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
      if (discardInterruptedStopRef.current) {
        discardInterruptedStopRef.current = false;
        clearLiveState();
        return;
      }

      if (interRepStopRef.current) {
        interRepStopRef.current = false;

        if (samples.length > 0) {
          repetitionSamplesRef.current.push(samples);
        }

        return;
      }

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
    expectedDurationSeconds: rampSeconds,
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

  const openQuitModal = useCallback(() => {
    if (
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phaseRef.current === 'results'
    ) {
      return;
    }

    pausedPhaseRef.current = phaseRef.current;
    showQuitModalRef.current = true;
    setShowQuitModal(true);

    if (
      phaseRef.current === 'exercise' &&
      isRecording
    ) {
      discardInterruptedStopRef.current = true;
      interRepStopRef.current = false;
      completedNaturallyRef.current = false;
      finishingRef.current = false;

      void stopRecording().catch((stopError) => {
        discardInterruptedStopRef.current = false;

        console.error(
          'Unable to pause Controlled Decrescendo recording:',
          stopError,
        );
      });
    }
  }, [isRecording, stopRecording]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) {
      return;
    }

    const pausedPhase = pausedPhaseRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);

    if (pausedPhase === 'exercise') {
      setSeconds(0);
      setGuideElapsed(0);
      setLiveFrame(null);
      setLiveHistory([]);
      setCountdownSeconds(COUNTDOWN_SECONDS);

      phaseRef.current = 'countdown';
      setPhase('countdown');
      return;
    }

    if (
      pausedPhase === 'countdown' ||
      pausedPhase === 'repCountdown'
    ) {
      setCountdownSeconds(COUNTDOWN_SECONDS);
      phaseRef.current = pausedPhase;
      setPhase(pausedPhase);
    }
  }, []);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) {
      return;
    }

    quitInProgressRef.current = true;
    setIsQuitting(true);

    completedNaturallyRef.current = false;
    interRepStopRef.current = false;
    discardInterruptedStopRef.current = false;
    repetitionSamplesRef.current = [];
    finishingRef.current = true;

    try {
      if (isRecording) {
        await stopRecording();
      }
    } catch (stopError) {
      console.error(
        'Unable to stop Controlled Decrescendo recording before quitting:',
        stopError,
      );
    } finally {
      clearLiveState();
      finishingRef.current = false;

      showQuitModalRef.current = false;
      setShowQuitModal(false);

      phaseRef.current = 'directions';

      router.replace('/exercises/volume');
    }
  }, [clearLiveState, isRecording, stopRecording]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) {
          return true;
        }

        if (phaseRef.current === 'results') {
          return false;
        }

        openQuitModal();
        return true;
      },
    );

    return () => subscription.remove();
  }, [openQuitModal]);

  useEffect(() => {
    if (showQuitModal || phase !== 'exercise') {
      return;
    }

    const startedAt = Date.now() - guideElapsed * 1000;

    const interval = setInterval(() => {
      setGuideElapsed(
        Math.min((Date.now() - startedAt) / 1000, rampSeconds),
      );
    }, 50);

    return () => clearInterval(interval);
  }, [phase, rep, rampSeconds, showQuitModal]);

  useEffect(() => {
    if (
      showQuitModal ||
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
  }, [phase, isRecording, showQuitModal, stopRecording]);

  useEffect(() => {
    if (
      showQuitModal ||
      (phase !== 'countdown' && phase !== 'repCountdown')
    ) {
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
              try {
                await stopRecording();
              } catch {
                // The effect has already been cancelled.
              }
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
  }, [
    phase,
    showQuitModal,
    startRecording,
    stopRecording,
    repetitions,
  ]);

  useEffect(() => {
    if (showQuitModal || phase !== 'exercise') {
      return;
    }

    const interval = setInterval(() => {
      setSeconds((previousSeconds) => {
        if (previousSeconds + 1 < rampSeconds) {
          return previousSeconds + 1;
        }

        if (rep < repetitions) {
          phaseRef.current = 'repCountdown';
          setPhase('repCountdown');
          return rampSeconds;
        }

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
  }, [
    phase,
    rep,
    rampSeconds,
    repetitions,
    showQuitModal,
    stopRecording,
  ]);

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
    discardInterruptedStopRef.current = false;
    repetitionSamplesRef.current = [];

    pausedPhaseRef.current = 'countdown';
    quitInProgressRef.current = false;
    showQuitModalRef.current = false;
    setShowQuitModal(false);
    setIsQuitting(false);

    setCountdownSeconds(COUNTDOWN_SECONDS);

    phaseRef.current = 'countdown';
    setPhase('countdown');
  }, [repetitions]);

  const tryAgain = useCallback(() => {
    startExercise();
  }, [startExercise]);

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

  const quitModal = (
    <QuitExerciseModal
      visible={showQuitModal}
      isQuitting={isQuitting}
      onContinue={continueExercise}
      onQuit={() => void quitExercise()}
    />
  );

  if (loadingParams) {
    return (
      <>
        <View style={styles.preparingScreen}>
          <View style={styles.preparingIconCircle}>
            <Ionicons name="options-outline" size={44} color={COLORS.brown} />
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
            color={COLORS.brown}
            style={styles.spinner}
          />
        </View>

        {quitModal}
      </>
    );
  }

  if (phase === 'directions') {
    return (
      <>
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
              value: `${targetMax} → ${targetMin} dB`,
            },
            {
              label: 'Duration per repetition',
              value: `${rampSeconds} seconds`,
            },
          ]}
          targetValue={`${targetMax} → ${targetMin} dB`}
          targetHint="Begin comfortably loud, then gradually lower your volume."
          repetitions={repetitions}
          tip="Sing the reference note while gradually reducing your volume. Keep your pitch steady and avoid letting the sound fade out too early."
          onBack={openQuitModal}
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
                  color={COLORS.brown}
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
                <ActivityIndicator size="small" color={COLORS.brown} />
              ) : (
                <Ionicons name="play" size={17} color={COLORS.brown} />
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

        {quitModal}
      </>
    );
  }

  if (phase === 'countdown' || phase === 'repCountdown') {
    const isNextRepetition = phase === 'repCountdown';
    const upcomingRep = isNextRepetition
      ? Math.min(rep + 1, repetitions)
      : rep;

    return (
      <>
        <ExerciseListeningScreen
          icon="volume-low-outline"
          title="Controlled Decrescendo"
          currentRep={upcomingRep}
          repetitions={repetitions}
          elapsed={0}
          targetDuration={rampSeconds}
          promptTitle={
            isNextRepetition
              ? `Get ready for repetition ${upcomingRep}`
              : 'Get ready to begin'
          }
          prompt={
            isNextRepetition
              ? 'Take a breath. Begin loudly, then gradually lower your volume.'
              : 'Prepare your voice. Begin comfortably loud when the countdown ends.'
          }
          progress={0}
          onBack={openQuitModal}
          liveContent={
            <View style={styles.countdownContent}>
              <Text style={styles.countdownEyebrow}>
                {isNextRepetition
                  ? 'NEXT REPETITION STARTS IN'
                  : 'YOUR EXERCISE STARTS IN'}
              </Text>

              <View style={styles.countdownCircle}>
                <Text style={styles.countdownNumber}>
                  {countdownSeconds}
                </Text>
              </View>

              <Text style={styles.countdownSubtitle}>
                Start comfortably loud and gradually become softer.
              </Text>

              <TargetDecrescendoGuide
                seconds={0}
                durationSeconds={rampSeconds}
              />
            </View>
          }
        />

        {quitModal}
      </>
    );
  }

  if (phase === 'exercise') {
    const progress = clamp(seconds / rampSeconds, 0, 1);

    return (
      <>
        <View style={styles.exerciseScreen}>
          <View style={styles.exerciseHeader}>
            <View style={styles.exerciseHeaderCopy}>
              <Text style={styles.exerciseScreenTitle}>
                Controlled Decrescendo
              </Text>
              <Text style={styles.exerciseScreenSubtitle}>
                Repetition {rep} of {repetitions}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.exerciseHeaderClose}
              onPress={openQuitModal}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Pause or quit exercise"
            >
              <Ionicons
                name="close"
                size={23}
                color={COLORS.brown}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.exerciseProgressTrack}>
            <View
              style={[
                styles.exerciseProgressFill,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>

          <View style={styles.exercisePrompt}>
            <Text style={styles.exercisePromptTitle}>
              {instruction.title}
            </Text>
            <Text style={styles.exercisePromptSubtitle}>
              {instruction.subtitle}
            </Text>
          </View>

          <ScrollView
            style={styles.exerciseScroll}
            contentContainerStyle={styles.exerciseScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.liveContent}>
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
                    <Ionicons name="mic" size={18} color={COLORS.brown} />
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
                      color={COLORS.brown}
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
            </View>
          </ScrollView>
        </View>

        {quitModal}
      </>
    );
  }

  return (
    <>
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
              value={`${minDb} → ${maxDb} dBFS`}
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
        <></>
      </ExerciseResultsScreen>

      {quitModal}
    </>
  );
}

const styles = StyleSheet.create({
  preparingScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  preparingIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  preparingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: COLORS.brown,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },
  countdownNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 44,
    color: COLORS.brown,
  },

  referenceCard: {
    width: '100%',
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 9,
  },
  referenceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 0,
  },
  referenceCopy: {
    flex: 1,
  },
  eyebrow: {
    color: COLORS.muted,
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.7,
  },
  referenceNote: {
    marginTop: 2,
    color: COLORS.brown,
    fontFamily: 'FredokaBold',
    fontSize: 29,
    lineHeight: 36,
  },
  referenceIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  referenceInstruction: {
    color: COLORS.muted,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
  },
  referenceButton: {
    width: '100%',
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: COLORS.pink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  referenceButtonText: {
    color: COLORS.brown,
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
  },
  playbackError: {
    marginTop: 6,
    color: COLORS.error,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
  },
  disabled: {
    opacity: 0.6,
  },

  previewCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginTop: 10,
  },
  previewTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: COLORS.brown,
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
    backgroundColor: COLORS.otherpink,
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
    color: COLORS.muted,
  },

  exerciseScreen: {
    position: 'absolute',
    top: 90,
    right: 8,
    bottom: 0,
    left: 8,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: COLORS.white,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  exerciseHeaderCopy: {
    flex: 1,
  },
  exerciseHeaderClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseScreenTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: COLORS.brown,
  },
  exerciseScreenSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 2,
  },
  exerciseProgressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.background,
    overflow: 'hidden',
    marginBottom: 16,
  },
  exerciseProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: COLORS.accent,
  },
  exercisePrompt: {
    alignItems: 'center',
    marginBottom: 12,
  },
  exercisePromptTitle: {
    marginTop: 20,
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: COLORS.brown,
    textAlign: 'center',
  },
  exercisePromptSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 3,
    marginBottom: 8,
  },
  exerciseScroll: {
    flex: 1,
  },
  exerciseScrollContent: {
    paddingBottom: 24,
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
    color: COLORS.accent,
    textAlign: 'center',
  },
  countdownCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    textAlign: 'center',
    marginBottom: 2,
  },

  liveContent: {
    width: '100%',
    gap: 8,
  },
  guideCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    color: COLORS.brown,
  },
  guideSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    lineHeight: 14,
    color: COLORS.muted,
    marginTop: 2,
  },
  guideIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.pink,
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
    backgroundColor: COLORS.brown,
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
    color: COLORS.muted,
  },
  guideProgressTrack: {
    height: 4,
    borderRadius: 3,
    backgroundColor: COLORS.background,
    overflow: 'hidden',
    marginTop: 8,
  },
  guideProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: COLORS.accent,
  },

  visualizerCard: {
    width: '100%',
    minHeight: 185,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    color: COLORS.brown,
  },
  visualizerSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: COLORS.muted,
    marginTop: 2,
  },
  micCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.pink,
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
    backgroundColor: COLORS.brown,
  },
  legendText: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: COLORS.muted,
    marginLeft: 6,
  },
  visualizer: {
    height: 76,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    backgroundColor: COLORS.brown,
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
    color: COLORS.muted,
  },

  voiceRow: {
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: COLORS.background,
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
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  voiceTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: COLORS.brown,
  },
  voiceSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: COLORS.muted,
    marginTop: 1,
  },
  voiceValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  voiceUnit: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: COLORS.muted,
  },

  targetRow: {
    minHeight: 60,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: COLORS.pink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  targetLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: COLORS.accent,
  },
  targetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: COLORS.brown,
    marginTop: 1,
  },
  patternText: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: COLORS.muted,
  },

  sessionRow: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionPart: {
    flex: 1,
    alignItems: 'center',
  },
  sessionLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
  },
  sessionValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: COLORS.brown,
    marginTop: 2,
  },
  sessionDivider: {
    width: 1,
    height: 29,
    backgroundColor: COLORS.border,
  },
  quitModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  quitModalCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: COLORS.white,
  },
  quitModalIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    marginBottom: 15,
  },
  quitModalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: COLORS.brown,
    textAlign: 'center',
  },
  quitModalSubtitle: {
    marginTop: 10,
    marginBottom: 23,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.muted,
    textAlign: 'center',
  },
  continueButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: COLORS.pink,
  },
  continueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  quitButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  quitButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.muted,
  },
  modalButtonDisabled: {
    opacity: 0.5,
  },

  resultItem: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 7,
  },
  resultItemLabel: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    marginRight: 12,
  },
  resultItemValue: {
    flexShrink: 1,
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    color: COLORS.brown,
    textAlign: 'right',
  },
});