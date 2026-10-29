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
    BackHandler,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import {
    DYNAMIC_RANGE_PARAMS,
    type DynamicRangeParams,
    type Tier,
} from '@/constants/params';
import {
    type LiveAudioFrame,
    useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
    ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateDynamicRangeParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import {
    measureDynamicRange,
    type RepetitionInterval,
} from '@/services/measurement/volume/dynamicRangeExercise';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
    fetchComponentProgress,
    fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreDynamicRange } from '@/services/scoring/volume/dynamicRangeExercise';
import { playSingleNote } from '@/utils/music/notePlayer';
import { createMusicalNote } from '@/utils/music/notes';

import { COLORS } from '@/constants/appConstants';

const BAR_COUNT = 32;
const DBFS_MIN = -60;
const DBFS_MAX = -10;
const PHASES_PER_REPETITION = 3;
const WINDOW_MS = 50;
const REFERENCE_NOTE_DURATION_SEC = 1.5;
const COUNTDOWN_SECONDS = 3;
const PROCESSING_MIN_DURATION_MS = 350;
const TIMER_TICK_MS = 100;

type Phase =
  | 'directions'
  | 'countdown'
  | 'exercise'
  | 'processing'
  | 'results';

type CountdownFor = 'start' | 'repetition';

interface DynamicRangeExerciseProps {
  tier?: Tier;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, (value - DBFS_MIN) / (DBFS_MAX - DBFS_MIN)));
}

function referenceHeight(index: number): number {
  const middle = (BAR_COUNT - 1) / 2;
  const distance = Math.abs(index - middle) / middle;
  return 0.18 + (1 - distance) * 0.72;
}

function DynamicRangeVisualizer({ liveHistory }: { liveHistory: number[] }) {
  return (
    <View style={styles.visualizer}>
      <View style={styles.targetBand} />
      <View style={styles.actualBars}>
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const height = liveHistory[index] ?? 0;
          return (
            <View
              key={`actual-${index}`}
              style={[
                styles.actualBar,
                { height: height > 0 ? `${Math.max(5, height * 82)}%` : '0%' },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.centerLine} />
      <View style={styles.targetMarker}>
        <Text style={styles.targetMarkerText}>TARGET</Text>
      </View>
    </View>
  );
}

export default function DynamicRangeExercise({
  tier,
}: DynamicRangeExerciseProps) {
  const initialTier = tier ?? 'beginner';

  const [resolvedTier, setResolvedTier] = useState<Tier>(initialTier);
  const [params, setParams] = useState<DynamicRangeParams>(
    DYNAMIC_RANGE_PARAMS[initialTier],
  );
  const [referenceNote, setReferenceNote] = useState(() => createMusicalNote(60));
  const [phase, setPhase] = useState<Phase>('directions');
  const [loadingParams, setLoadingParams] = useState(true);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [countdownFor, setCountdownFor] = useState<CountdownFor>('start');
  const [rep, setRep] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [liveFrame, setLiveFrame] = useState<LiveAudioFrame | null>(null);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [rangeAccuracy, setRangeAccuracy] = useState(0);
  const [rampConsistency, setRampConsistency] = useState(0);
  const [passed, setPassed] = useState(false);
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [referencePlaybackError, setReferencePlaybackError] = useState('');
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const targetMin = params.targetDbRange[0];
  const targetMax = params.targetDbRange[1];
  const totalSeconds = Math.max(
    PHASES_PER_REPETITION,
    Math.round(params.durationSec),
  );
  const repetitions = Math.max(1, Math.round(params.repetitions));

  const firstPhaseSeconds = Math.ceil(totalSeconds / PHASES_PER_REPETITION);
  const secondPhaseEndSeconds = Math.ceil(
    (totalSeconds * 2) / PHASES_PER_REPETITION,
  );

  const mountedRef = useRef(true);
  const phaseRef = useRef<Phase>('directions');
  const countdownRunIdRef = useRef(0);
  const shouldSaveResultRef = useRef(false);
  const finishingRef = useRef(false);
  const acceptFramesRef = useRef(false);
  const cancelProcessingRef = useRef(false);
  const pausedRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('directions');
  const pausedHadRecordingRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const referencePlayingRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const repetitionStartedAtRef = useRef<number | null>(null);
  const repetitionIntervalsRef = useRef<RepetitionInterval[]>([]);
  const currentRepetitionStartRef = useRef<number | null>(null);
  const stopRecordingRef = useRef<(() => void | Promise<void>) | null>(null);
  const pendingStopRef = useRef<Promise<void> | null>(null);

  const setCurrentPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearCountdown = useCallback(() => {
    countdownRunIdRef.current += 1;
  }, []);

  const getRecordingElapsedSeconds = useCallback(() => {
    const startedAt = recordingStartedAtRef.current;
    return startedAt === null ? 0 : Math.max(0, (Date.now() - startedAt) / 1000);
  }, []);

  const beginRecordingSession = useCallback(() => {
    recordingStartedAtRef.current = Date.now();
    repetitionStartedAtRef.current = Date.now();
    repetitionIntervalsRef.current = [];
    currentRepetitionStartRef.current = 0;
  }, []);

  const finishCurrentRepetition = useCallback(() => {
    const startSeconds = currentRepetitionStartRef.current;
    if (startSeconds === null) return;

    const endSeconds = getRecordingElapsedSeconds();
    if (endSeconds > startSeconds) {
      repetitionIntervalsRef.current.push({ startSeconds, endSeconds });
    }
    currentRepetitionStartRef.current = null;
    repetitionStartedAtRef.current = null;
  }, [getRecordingElapsedSeconds]);

  const stopRecordingSafely = useCallback((): Promise<void> => {
    const stop = stopRecordingRef.current;
    if (!stop) return Promise.resolve();

    const task = Promise.resolve(stop()).then(() => undefined);
    pendingStopRef.current = task;
    return task;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadReferenceNote() {
      try {
        const assessment = await getLatestAssessment();
        const vocalRange = assessment?.vocalRange;
        const lowHz = Number(vocalRange?.lowHz ?? assessment?.vocalRangeLowHz);
        const highHz = Number(vocalRange?.highHz ?? assessment?.vocalRangeHighHz);

        if (
          !Number.isFinite(lowHz) ||
          !Number.isFinite(highHz) ||
          lowHz <= 0 ||
          highHz <= lowHz
        ) {
          return;
        }

        const lowMidi = Math.round(69 + 12 * Math.log2(lowHz / 440));
        const highMidi = Math.round(69 + 12 * Math.log2(highHz / 440));
        const midpointHz = Math.sqrt(lowHz * highHz);
        const midpointMidi = Math.round(69 + 12 * Math.log2(midpointHz / 440));
        const midiNote = Math.max(lowMidi, Math.min(highMidi, midpointMidi));

        if (!cancelled) setReferenceNote(createMusicalNote(midiNote));
      } catch (error) {
        console.error('[DynamicRange] Could not load vocal range:', error);
      }
    }

    void loadReferenceNote();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initializeAdaptiveParams() {
      setLoadingParams(true);

      try {
        let currentTier: Tier = tier ?? 'beginner';
        let recentScores: number[] = [];
        const user = auth.currentUser;

        if (!tier && user) {
          const componentProgress = await fetchComponentProgress(user.uid, 'volume');
          if (cancelled) return;

          if (
            componentProgress?.currentTier === 'beginner' ||
            componentProgress?.currentTier === 'intermediate' ||
            componentProgress?.currentTier === 'advanced'
          ) {
            currentTier = componentProgress.currentTier;
          }

          const records = await fetchExerciseRecords(user.uid, 'volume');
          if (cancelled) return;

          const recentRecords = records
            .filter(
              record =>
                record.templateId === 'dynamicRange' &&
                record.tier === currentTier,
            )
            .sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));

          recentScores = recentRecords
            .slice(-5)
            .map(record => Number(record.scorePct ?? 0));

          if (recentScores.length === 0) {
            const assessment = await getLatestAssessment();
            if (cancelled) return;
            const assessmentScore = assessment?.scores.find(
              item => item.componentId === 'volume',
            )?.scorePct;
            if (typeof assessmentScore === 'number') {
              recentScores = [assessmentScore];
            }
          }
        }

        if (cancelled) return;
        setResolvedTier(currentTier);
        setParams(
          generateDynamicRangeParams({
            tier: currentTier,
            recentScores,
          }),
        );
      } catch (error) {
        console.error('[DynamicRange] Could not load adaptive parameters:', error);
        if (cancelled) return;
        const fallbackTier = tier ?? 'beginner';
        setResolvedTier(fallbackTier);
        setParams(
          generateDynamicRangeParams({
            tier: fallbackTier,
            recentScores: [],
          }),
        );
      } finally {
        if (!cancelled) setLoadingParams(false);
      }
    }

    void initializeAdaptiveParams();
    return () => {
      cancelled = true;
    };
  }, [tier]);

  const playReferenceNote = useCallback(async () => {
    if (
      referencePlayingRef.current ||
      pausedRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    referencePlayingRef.current = true;
    setReferencePlaying(true);
    setReferencePlaybackError('');

    try {
      await playSingleNote(referenceNote.frequency, REFERENCE_NOTE_DURATION_SEC);
    } catch (error) {
      console.error('[DynamicRange] Could not play reference note:', error);
      if (mountedRef.current) {
        setReferencePlaybackError(
          'Unable to play the reference note. Please try again.',
        );
      }
    } finally {
      referencePlayingRef.current = false;
      if (mountedRef.current) setReferencePlaying(false);
    }
  }, [referenceNote]);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: frame => {
      if (
        !mountedRef.current ||
        !acceptFramesRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'exercise'
      ) {
        return;
      }

      setLiveFrame(frame);
      const normalized = normalizeVolume(frame.volume);
      setLiveHistory(previous => {
        const next = [...previous, normalized];
        return next.length > BAR_COUNT ? next.slice(-BAR_COUNT) : next;
      });
    },

    onStop: (samples, sampleRate) => {
      recordingActiveRef.current = false;
      acceptFramesRef.current = false;

      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        shouldSaveResultRef.current = false;
        finishingRef.current = false;
        return;
      }

      const processingSession =
        phaseRef.current === 'processing' && shouldSaveResultRef.current;

      if (
        !mountedRef.current ||
        quitInProgressRef.current ||
        (!processingSession && (pausedRef.current || showQuitModalRef.current))
      ) {
        finishingRef.current = false;
        shouldSaveResultRef.current = false;
        return;
      }

      if (!shouldSaveResultRef.current) {
        finishingRef.current = false;
        return;
      }

      shouldSaveResultRef.current = false;

      void (async () => {
        await wait(PROCESSING_MIN_DURATION_MS);

        if (
          !mountedRef.current ||
          cancelProcessingRef.current ||
          quitInProgressRef.current
        ) {
          finishingRef.current = false;
          return;
        }

        try {
          const repetitionIntervals = repetitionIntervalsRef.current.map(
            interval => ({ ...interval }),
          );

          const measurement = measureDynamicRange(samples, sampleRate, {
            windowMs: WINDOW_MS,
            targetRange: [targetMin, targetMax],
            expectedDurationSeconds: totalSeconds * repetitions,
            repetitionDurationSeconds: totalSeconds,
            repetitionIntervals,
          });

          if (
            measurement.overallMeasurementQuality < 50 ||
            measurement.validWindowCount === 0 ||
            repetitionIntervals.length === 0
          ) {
            throw new Error(
              `Measurement quality too low (${measurement.overallMeasurementQuality}%). ` +
                'Please ensure the microphone captures your voice throughout each repetition.',
            );
          }

          const result = scoreDynamicRange(measurement);

          if (
            !mountedRef.current ||
            cancelProcessingRef.current ||
            quitInProgressRef.current
          ) {
            return;
          }

          setRangeAccuracy(result.rangeAccuracy);
          setRampConsistency(result.rampConsistency);
          setScore(Math.round(result.overallScore));
          setPassed(result.passed);
          setCurrentPhase('results');

          if (
            !mountedRef.current ||
            cancelProcessingRef.current ||
            quitInProgressRef.current
          ) {
            return;
          }

          try {
            await saveCompletedExercise(
              'volume',
              'dynamicRange',
              resolvedTier,
              Math.round(result.overallScore),
            );
          } catch (saveError) {
            console.error('[DynamicRange] Could not save progress:', saveError);
          }
        } catch (error) {
          console.error('[DynamicRange] Measurement failed:', error);
          if (
            mountedRef.current &&
            !cancelProcessingRef.current &&
            !quitInProgressRef.current
          ) {
            setReferencePlaybackError(
              error instanceof Error
                ? error.message
                : 'We could not analyze this attempt. Please try again.',
            );
            setCurrentPhase('directions');
          }
        } finally {
          finishingRef.current = false;
          if (mountedRef.current) {
            setSeconds(0);
            setRep(1);
            setLiveFrame(null);
            setLiveHistory([]);
          }
        }
      })();
    },
  });

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    recordingActiveRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      countdownRunIdRef.current += 1;
      acceptFramesRef.current = false;
      shouldSaveResultRef.current = false;
      cancelProcessingRef.current = true;
      pausedRef.current = true;
      showQuitModalRef.current = false;

      try {
        void Promise.resolve(stopRecordingRef.current?.()).catch(error => {
          console.error('[DynamicRange] Cleanup stop failed:', error);
        });
      } catch (error) {
        console.error('[DynamicRange] Cleanup stop failed:', error);
      }
    };
  }, []);

  const resetExercise = useCallback(() => {
    setRep(1);
    setSeconds(0);
    setScore(0);
    setRangeAccuracy(0);
    setRampConsistency(0);
    setPassed(false);
    setLiveFrame(null);
    setLiveHistory([]);
    setReferencePlaybackError('');

    acceptFramesRef.current = false;
    finishingRef.current = false;
    shouldSaveResultRef.current = false;
    discardNextStopRef.current = false;
    cancelProcessingRef.current = false;
    recordingStartedAtRef.current = null;
    repetitionStartedAtRef.current = null;
    repetitionIntervalsRef.current = [];
    currentRepetitionStartRef.current = null;
  }, []);

  const runCountdown = useCallback(
    async (runId: number, purpose: CountdownFor) => {
      setCountdownFor(purpose);
      setCountdown(COUNTDOWN_SECONDS);
      setCurrentPhase('countdown');

      for (let value = COUNTDOWN_SECONDS; value >= 1; value--) {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          quitInProgressRef.current ||
          runId !== countdownRunIdRef.current
        ) {
          return false;
        }
        setCountdown(value);
        await wait(1000);
      }

      return (
        mountedRef.current &&
        !pausedRef.current &&
        !quitInProgressRef.current &&
        runId === countdownRunIdRef.current
      );
    },
    [setCurrentPhase],
  );

  const startExercise = useCallback(async () => {
    if (loadingParams || pausedRef.current || quitInProgressRef.current) return;

    const runId = ++countdownRunIdRef.current;
    resetExercise();

    try {
      const countdownFinished = await runCountdown(runId, 'start');
      if (
        !countdownFinished ||
        !mountedRef.current ||
        pausedRef.current ||
        quitInProgressRef.current ||
        runId !== countdownRunIdRef.current
      ) {
        return;
      }

      acceptFramesRef.current = false;
      await startRecording();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitInProgressRef.current ||
        runId !== countdownRunIdRef.current
      ) {
        acceptFramesRef.current = false;
        discardNextStopRef.current = true;
        await stopRecording();
        return;
      }

      recordingActiveRef.current = true;
      shouldSaveResultRef.current = false;
      finishingRef.current = false;
      beginRecordingSession();
      acceptFramesRef.current = true;
      setSeconds(0);
      setRep(1);
      setCurrentPhase('exercise');
    } catch (error) {
      console.error('[DynamicRange] Could not start recording:', error);
      acceptFramesRef.current = false;
      shouldSaveResultRef.current = false;
      recordingActiveRef.current = false;
      if (mountedRef.current && runId === countdownRunIdRef.current) {
        setCurrentPhase('directions');
      }
    }
  }, [
    loadingParams,
    resetExercise,
    runCountdown,
    startRecording,
    stopRecording,
    beginRecordingSession,
    setCurrentPhase,
  ]);

  const tryAgain = useCallback(() => {
    if (quitInProgressRef.current) return;
    pausedRef.current = false;
    showQuitModalRef.current = false;
    setShowQuitModal(false);
    void startExercise();
  }, [startExercise]);

  const pauseForExitPrompt = useCallback(() => {
    if (
      !mountedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    const current = phaseRef.current;
    pausedPhaseRef.current = current;
    pausedHadRecordingRef.current = recordingActiveRef.current;
    pausedRef.current = current !== 'processing';
    showQuitModalRef.current = true;
    clearCountdown();
    acceptFramesRef.current = false;

    if (current === 'exercise') {
      discardNextStopRef.current = true;
      shouldSaveResultRef.current = false;
      finishingRef.current = true;
      setSeconds(0);
      setLiveFrame(null);
      setLiveHistory([]);
      void stopRecordingSafely().catch(error => {
        console.error('[DynamicRange] Pause stop failed:', error);
      });
    } else if (current === 'countdown') {
      setCountdown(COUNTDOWN_SECONDS);
    }

    setShowQuitModal(true);
  }, [clearCountdown, stopRecordingSafely]);

  const continueExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    const interruptedPhase = pausedPhaseRef.current;
    const hadRecording = pausedHadRecordingRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    pausedRef.current = false;

    if (interruptedPhase === 'processing') {
      finishingRef.current = true;
      return;
    }

    if (
      interruptedPhase !== 'exercise' &&
      interruptedPhase !== 'countdown'
    ) {
      return;
    }

    const runId = ++countdownRunIdRef.current;

    if (interruptedPhase === 'exercise') {
      finishingRef.current = false;
      shouldSaveResultRef.current = false;
      setRep(1);
      setSeconds(0);
      setLiveFrame(null);
      setLiveHistory([]);

      try {
        await pendingStopRef.current;
      } catch (error) {
        console.error('[DynamicRange] Interrupted stop failed:', error);
      }

      if (
        !mountedRef.current ||
        quitInProgressRef.current ||
        runId !== countdownRunIdRef.current
      ) {
        return;
      }

      discardNextStopRef.current = false;
      recordingStartedAtRef.current = null;
      repetitionStartedAtRef.current = null;
      repetitionIntervalsRef.current = [];
      currentRepetitionStartRef.current = null;
    }

    const purpose: CountdownFor =
      interruptedPhase === 'countdown' ? countdownFor : 'start';
    const countdownFinished = await runCountdown(runId, purpose);

    if (
      !countdownFinished ||
      !mountedRef.current ||
      pausedRef.current ||
      quitInProgressRef.current ||
      runId !== countdownRunIdRef.current
    ) {
      return;
    }

    if (interruptedPhase === 'exercise' || !hadRecording) {
      try {
        discardNextStopRef.current = false;
        await startRecording();

        if (
          !mountedRef.current ||
          pausedRef.current ||
          quitInProgressRef.current ||
          runId !== countdownRunIdRef.current
        ) {
          acceptFramesRef.current = false;
          discardNextStopRef.current = true;
          await stopRecording();
          return;
        }

        recordingActiveRef.current = true;
        beginRecordingSession();
        setRep(1);
      } catch (error) {
        console.error('[DynamicRange] Could not resume recording:', error);
        if (mountedRef.current) setCurrentPhase('directions');
        return;
      }
    } else if (countdownFor === 'repetition') {
      currentRepetitionStartRef.current = getRecordingElapsedSeconds();
      repetitionStartedAtRef.current = Date.now();
    }

    acceptFramesRef.current = true;
    setSeconds(0);
    setCurrentPhase('exercise');
  }, [
    beginRecordingSession,
    countdownFor,
    getRecordingElapsedSeconds,
    runCountdown,
    startRecording,
    stopRecording,
    setCurrentPhase,
  ]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    clearCountdown();
    acceptFramesRef.current = false;
    shouldSaveResultRef.current = false;
    cancelProcessingRef.current = true;
    discardNextStopRef.current = true;
    finishingRef.current = true;
    setIsQuitting(true);
    setShowQuitModal(false);

    try {
      await stopRecordingSafely();
    } catch (error) {
      console.error('[DynamicRange] Quit stop failed:', error);
    } finally {
      recordingActiveRef.current = false;
      if (mountedRef.current) router.replace('/dashboard?tab=exercises');
    }
  }, [clearCountdown, stopRecordingSafely]);

  const handleBack = useCallback(() => {
    pauseForExitPrompt();
  }, [pauseForExitPrompt]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showQuitModalRef.current || quitInProgressRef.current) return true;
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  useEffect(() => {
    if (
      phase !== 'exercise' ||
      !isRecording ||
      finishingRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const interval = setInterval(() => {
      if (
        phaseRef.current !== 'exercise' ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        finishingRef.current
      ) {
        return;
      }

      const repStartedAt = repetitionStartedAtRef.current;
      if (repStartedAt === null) return;

      const elapsed = Math.floor((Date.now() - repStartedAt) / 1000);
      setSeconds(Math.min(totalSeconds, elapsed));

      if (elapsed < totalSeconds) return;

      finishCurrentRepetition();

      if (rep < repetitions) {
        acceptFramesRef.current = false;
        const runId = ++countdownRunIdRef.current;
        const nextRep = rep + 1;

        setRep(nextRep);
        setSeconds(0);
        setLiveHistory([]);
        setLiveFrame(null);

        void (async () => {
          const countdownFinished = await runCountdown(runId, 'repetition');

          if (
            !countdownFinished ||
            !mountedRef.current ||
            pausedRef.current ||
            quitInProgressRef.current ||
            runId !== countdownRunIdRef.current
          ) {
            return;
          }

          currentRepetitionStartRef.current = getRecordingElapsedSeconds();
          repetitionStartedAtRef.current = Date.now();
          acceptFramesRef.current = true;
          setSeconds(0);
          setCurrentPhase('exercise');
        })();

        return;
      }

      if (!finishingRef.current) {
        finishingRef.current = true;
        shouldSaveResultRef.current = true;
        acceptFramesRef.current = false;
        setCurrentPhase('processing');

        void stopRecordingSafely().catch(error => {
          console.error('[DynamicRange] Final recording stop failed:', error);
          finishingRef.current = false;
          shouldSaveResultRef.current = false;
          if (mountedRef.current && !quitInProgressRef.current) {
            setCurrentPhase('directions');
          }
        });
      }
    }, TIMER_TICK_MS);

    return () => clearInterval(interval);
  }, [
    phase,
    isRecording,
    rep,
    repetitions,
    totalSeconds,
    finishCurrentRepetition,
    getRecordingElapsedSeconds,
    runCountdown,
    stopRecordingSafely,
    setCurrentPhase,
  ]);

  let instructionTitle = 'SOFT → LOUD';
  let instructionPrompt = 'Gradually increase your volume.';
  let secondsUntilChange = firstPhaseSeconds - seconds;

  if (seconds >= firstPhaseSeconds) {
    instructionTitle = 'LOUD';
    instructionPrompt = 'Reach and maintain your loud target.';
    secondsUntilChange = secondPhaseEndSeconds - seconds;
  }
  if (seconds >= secondPhaseEndSeconds) {
    instructionTitle = 'LOUD → SOFT';
    instructionPrompt = 'Gradually decrease your volume.';
    secondsUntilChange = totalSeconds - seconds;
  }
  secondsUntilChange = Math.max(0, secondsUntilChange);

  const progress = Math.min(100, (seconds / totalSeconds) * 100);

  const quitModal = (
    <Modal
      visible={showQuitModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => void continueExercise()}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}>
            <Ionicons name="exit-outline" size={30} color={COLORS.brown} />
          </View>
          <Text style={styles.modalTitle}>Quit exercise?</Text>
          <Text style={styles.modalMessage}>
            {pausedPhaseRef.current === 'directions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Dynamic Range?'
              : pausedPhaseRef.current === 'exercise'
                ? 'Your current recording will be discarded. Continuing restarts the exercise from repetition 1.'
                : pausedPhaseRef.current === 'countdown'
                  ? 'The countdown is paused. Continue to restart the countdown and carry on.'
                  : 'Your results are being processed. Continue to return to your results, or quit to leave this exercise.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            disabled={isQuitting}
            onPress={() => void continueExercise()}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.continueButtonText}>Continue Exercise</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
            disabled={isQuitting}
            onPress={() => void quitExercise()}
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.quitButtonText}>
              {isQuitting ? 'Stopping...' : 'Quit Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  if (loadingParams) {
    return (
      <>
        <View style={styles.centerScreen}>
          <View style={styles.largeIconCircle}>
            <Ionicons name="options-outline" size={44} color={COLORS.brown} />
          </View>
          <Text style={styles.screenTitle}>Preparing Your Exercise</Text>
          <Text style={styles.screenSubtitle}>
            Adjusting the exercise to your current difficulty level and preparing
            your vocal range.
          </Text>
          <ActivityIndicator size="large" color={COLORS.brown} style={styles.spinner} />
        </View>
        {quitModal}
      </>
    );
  }

  if (phase === 'directions') {
    return (
      <>
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
              label: 'PATTERN DURATION',
              value: `${totalSeconds}s`,
              hint: 'for all 3 phases combined',
            },
            {
              label: 'REPETITIONS',
              value: String(repetitions),
              hint: 'complete patterns',
            },
          ]}
          tip="Keep the same note throughout the exercise. Change your vocal volume gradually instead of changing pitch."
          tier={resolvedTier}
          onBack={handleBack}
          onStart={startExercise}
        >
          <View style={styles.referenceCard}>
            <View style={styles.referenceTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>REFERENCE NOTE</Text>
                <Text style={styles.referenceNote}>{referenceNote.name}</Text>
              </View>
              <View style={styles.referenceIconCircle}>
                <Ionicons name="musical-note" size={22} color={COLORS.brown} />
              </View>
            </View>
            <Text style={styles.referenceInstruction}>
              Play the note, then sing it while gradually increasing your volume
              from soft to loud, before returning to soft.
            </Text>
            <TouchableOpacity
              style={[styles.referenceButton, referencePlaying && styles.disabled]}
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
                {referencePlaying ? 'Playing...' : `Play ${referenceNote.name}`}
              </Text>
            </TouchableOpacity>
            {referencePlaybackError !== '' && (
              <Text style={styles.playbackError}>{referencePlaybackError}</Text>
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
                    { height: `${referenceHeight(index) * 80}%` },
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
        {quitModal}
      </>
    );
  }

  if (phase === 'countdown') {
    const repetitionCountdown = countdownFor === 'repetition';
    return (
      <>
        <View style={styles.centerScreen}>
          <View style={styles.countdownCircle}>
            <Text style={styles.countdownNumber}>{countdown}</Text>
          </View>
          <Text style={styles.screenTitle}>
            {repetitionCountdown ? `Repetition ${rep}` : 'Get Ready'}
          </Text>
          <Text style={styles.countdownPrompt}>
            {repetitionCountdown
              ? 'Get ready to repeat the volume pattern.'
              : 'Recording starts when the countdown ends.'}
          </Text>
          <Text style={styles.screenSubtitle}>
            Prepare to sing {referenceNote.name}. Start softly, then follow the
            volume prompts.
          </Text>
        </View>
        {quitModal}
      </>
    );
  }

  if (phase === 'exercise') {
    return (
      <>
        <View style={styles.exerciseScreen}>
          <View style={styles.exerciseHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.exerciseHeaderTitle}>Dynamic Range</Text>
              <Text style={styles.exerciseHeaderSubtitle}>VOLUME CONTROL</Text>
            </View>
          </View>

          <View style={styles.exercisePromptCard}>
            <Text style={styles.exercisePromptTitle}>{instructionTitle}</Text>
            <Text style={styles.exercisePromptText}>
              {instructionPrompt} Sing {referenceNote.name} throughout the pattern.
            </Text>
          </View>

          <ScrollView
            style={styles.exerciseScroll}
            contentContainerStyle={styles.exerciseScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.visualizerHeader}>
              <View>
                <Text style={styles.visualizerTitle}>Your Performance</Text>
                <Text style={styles.visualizerSubtitle}>Follow the reference pattern</Text>
              </View>
              <View style={styles.micCircle}>
                <Ionicons name="mic" size={20} color={COLORS.brown} />
              </View>
            </View>

            <View style={styles.phaseCountdownCard}>
              <Text style={styles.phaseCountdownLabel}>NEXT PHASE IN</Text>
              <Text style={styles.phaseCountdownValue}>{secondsUntilChange}s</Text>
            </View>

            <View style={styles.legend}>
              <View style={styles.actualDot} />
              <Text style={styles.legendText}>Your voice</Text>
            </View>

            <DynamicRangeVisualizer liveHistory={liveHistory} />

            <View style={styles.visualizerLabels}>
              <Text style={styles.visualizerLabel}>SOFT</Text>
              <Text style={styles.visualizerLabel}>LOUD</Text>
              <Text style={styles.visualizerLabel}>SOFT</Text>
            </View>

            <View style={styles.voiceRow}>
              <View style={styles.voiceLeft}>
                <Ionicons name="mic-outline" size={20} color={COLORS.brown} />
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
                <Text style={styles.targetLabel}>TARGET RANGE</Text>
                <Text style={styles.targetValue}>{targetMin}–{targetMax} dB</Text>
              </View>
              <Text style={styles.pattern}>Soft → Loud → Soft</Text>
            </View>

            <View style={styles.sessionRow}>
              <View style={styles.sessionPart}>
                <Text style={styles.sessionLabel}>REPETITION</Text>
                <Text style={styles.sessionValue}>{rep} / {repetitions}</Text>
              </View>
              <View style={styles.sessionDivider} />
              <View style={styles.sessionPart}>
                <Text style={styles.sessionLabel}>ELAPSED</Text>
                <Text style={styles.sessionValue}>
                  {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                </Text>
              </View>
            </View>

            <View style={styles.liveProgressTrack}>
              <View style={[styles.liveProgressFill, { width: `${progress}%` }]} />
            </View>
            <View style={styles.exerciseFooter}>
              <Text style={styles.exerciseFooterText}>
                Repetition {rep} of {repetitions}
              </Text>
            </View>
          </ScrollView>
        </View>
        {quitModal}
      </>
    );
  }

  if (phase === 'processing') {
    return (
      <>
        <View style={styles.centerScreen}>
          <View style={styles.largeIconCircle}>
            <Ionicons name="analytics-outline" size={44} color={COLORS.brown} />
          </View>
          <Text style={styles.screenTitle}>Analyzing Your Performance</Text>
          <Text style={styles.screenSubtitle}>
            Measuring your volume control and checking how consistently you
            followed the pattern.
          </Text>
          <View style={styles.processingStatus}>
            <ActivityIndicator size="large" color={COLORS.brown} />
            <Text style={styles.processingStatusText}>Calculating your results...</Text>
          </View>
        </View>
        {quitModal}
      </>
    );
  }

  return (
    <>
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
        scoreDetails={
          <View style={styles.resultsDetails}>
            <View style={styles.resultMetric}>
              <Text style={styles.resultValue}>{rangeAccuracy}%</Text>
              <Text style={styles.resultLabel}>Range Accuracy</Text>
            </View>
            <View style={styles.resultMetric}>
              <Text style={styles.resultValue}>{rampConsistency}%</Text>
              <Text style={styles.resultLabel}>Ramp Consistency</Text>
            </View>
          </View>
        }
        onRetry={tryAgain}
        onExit={handleBack}
        children={null}
      />
      {quitModal}
    </>
  );
}

const styles = StyleSheet.create({
  centerScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  largeIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  screenTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: COLORS.brown,
    textAlign: 'center',
  },
  screenSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 320,
  },
  spinner: { marginTop: 28 },
  countdownCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  countdownNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 54,
    color: COLORS.brown,
  },
  countdownPrompt: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: COLORS.brown,
    textAlign: 'center',
    marginTop: 10,
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
    gap: 10,
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
  disabled: { opacity: 0.6 },
  previewCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginTop: 12,
  },
  previewTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    color: COLORS.brown,
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
    backgroundColor: COLORS.otherpink,
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
  exerciseHeaderTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: COLORS.brown,
  },
  exerciseHeaderSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 2,
  },
  exercisePromptCard: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: COLORS.pink,
    marginBottom: 14,
  },
  exercisePromptTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: COLORS.brown,
  },
  exercisePromptText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.brown,
    marginTop: 5,
  },
  exerciseScroll: { flex: 1 },
  exerciseScrollContent: { paddingBottom: 24 },
  visualizerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visualizerTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: COLORS.brown,
  },
  visualizerSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 3,
  },
  micCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseCountdownCard: {
    marginTop: 12,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  phaseCountdownLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color: COLORS.muted,
  },
  phaseCountdownValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: COLORS.accent,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 8,
  },
  actualDot: {
    width: 15,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.brown,
  },
  legendText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
  },
  visualizer: {
    height: 155,
    borderRadius: 15,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    backgroundColor: COLORS.gray,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.pink,
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
    backgroundColor: COLORS.brown,
    borderRadius: 5,
  },
  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: COLORS.background,
  },
  targetMarker: {
    position: 'absolute',
    right: 7,
    top: '18%',
    backgroundColor: COLORS.white,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 4,
  },
  targetMarkerText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    color: COLORS.accent,
  },
  visualizerLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  visualizerLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    color: COLORS.muted,
  },
  voiceRow: {
    minHeight: 46,
    marginTop: 12,
    borderRadius: 13,
    backgroundColor: COLORS.background,
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
    color: COLORS.brown,
  },
  voiceValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: COLORS.brown,
  },
  voiceUnit: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: COLORS.muted,
  },
  targetRow: {
    marginTop: 12,
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
  pattern: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
  },
  sessionRow: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  sessionPart: { flex: 1, alignItems: 'center' },
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
  liveProgressTrack: {
    height: 6,
    marginTop: 10,
    backgroundColor: '#F3E4E8',
    borderRadius: 3,
    overflow: 'hidden',
  },
  liveProgressFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: 3,
  },
  exerciseFooter: { alignItems: 'center', marginTop: 14 },
  exerciseFooterText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
  },
  processingStatus: {
    alignItems: 'center',
    marginTop: 28,
    gap: 12,
  },
  processingStatusText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: COLORS.muted,
  },
  resultsDetails: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 12,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  resultMetric: { flex: 1, alignItems: 'center', gap: 4 },
  resultLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: COLORS.muted,
    textAlign: 'center',
  },
  resultValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: COLORS.brown,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: COLORS.transparentbrown,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: COLORS.white,
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    marginBottom: 15,
  },
  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: COLORS.brown,
    textAlign: 'center',
  },
  modalMessage: {
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
  buttonPressed: { opacity: 0.75 },
  buttonDisabled: { opacity: 0.5 },
});