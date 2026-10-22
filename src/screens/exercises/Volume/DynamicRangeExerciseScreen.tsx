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
} from '@/constants/exercises/volume';
import {
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
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
const COUNTDOWN_SECONDS = 3;
const PROCESSING_MIN_DURATION_MS = 350;

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

  return Math.max(
    0,
    Math.min(1, (value - DBFS_MIN) / (DBFS_MAX - DBFS_MIN)),
  );
}

function referenceHeight(index: number): number {
  const middle = (BAR_COUNT - 1) / 2;
  const distance = Math.abs(index - middle) / middle;

  return 0.18 + (1 - distance) * 0.72;
}

/* Dynamic Range visualizer */

function DynamicRangeVisualizer({
  liveHistory,
}: {
  liveHistory: number[];
}) {
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
                {
                  height:
                    height > 0
                      ? `${Math.max(5, height * 82)}%`
                      : '0%',
                },
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

  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [countdownFor, setCountdownFor] =
    useState<CountdownFor>('start');

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

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const targetMin = params.targetDbRange[0];
  const targetMax = params.targetDbRange[1];

  const rampSeconds = Math.max(1, params.durationSec);
  const repetitions = Math.max(1, params.repetitions);
  const totalSeconds = rampSeconds * PHASES_PER_REPETITION;

  /* Synchronous refs for async flows */

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

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const stopRecordingRef =
    useRef<(() => void | Promise<void>) | null>(null);

  const pendingStopRef = useRef<Promise<void> | null>(null);

  const setCurrentPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearCountdown = useCallback(() => {
    countdownRunIdRef.current += 1;
  }, []);

  const stopRecordingSafely = useCallback((): Promise<void> => {
    const stop = stopRecordingRef.current;

    if (!stop) return Promise.resolve();

    const task = Promise.resolve(stop()).then(() => undefined);
    pendingStopRef.current = task;

    return task;
  }, []);

  /* Load the reference note from the user's assessment */

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

  /* Load adaptive exercise parameters */

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

          if (cancelled) return;

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

          if (cancelled) return;

          const recentRecords = records
            .filter(
              record =>
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
            .map(record => Number(record.scorePct ?? 0));

          if (referenceScores.length === 0) {
            const assessment = await getLatestAssessment();

            if (cancelled) return;

            const assessmentScore = assessment?.scores.find(
              item => item.componentId === 'volume',
            )?.scorePct;

            if (typeof assessmentScore === 'number') {
              referenceScores = [assessmentScore];
            }
          }
        }

        if (cancelled) return;

        const generatedParams = generateDynamicRangeParams({
          tier: currentTier,
          recentScores: referenceScores,
        });

        setResolvedTier(currentTier);
        setParams(generatedParams);
      } catch (error) {
        console.error(
          'Unable to initialize Dynamic Range adaptive parameters:',
          error,
        );

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

  /* Reference note playback */

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
      await playSingleNote(
        referenceNote.frequency,
        REFERENCE_NOTE_DURATION_SEC,
      );
    } catch (error) {
      console.error('Unable to play reference note:', error);

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

  /* Audio recorder — shared hook remains unchanged */

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
        return next.length > BAR_COUNT
          ? next.slice(-BAR_COUNT)
          : next;
      });
    },

    onStop: (samples, sampleRate) => {
      recordingActiveRef.current = false;
      acceptFramesRef.current = false;

      // Stopping a paused or cancelled repetition must never score it.
      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        shouldSaveResultRef.current = false;
        finishingRef.current = false;
        return;
      }

      const processingSession =
        phaseRef.current === 'processing' &&
        shouldSaveResultRef.current;

      // A modal pauses normal exercise callbacks, but must not
      // accidentally cancel an already completed processing session.
      if (
        !mountedRef.current ||
        quitInProgressRef.current ||
        (!processingSession &&
          (pausedRef.current || showQuitModalRef.current))
      ) {
        finishingRef.current = false;
        shouldSaveResultRef.current = false;
        return;
      }

      if (!shouldSaveResultRef.current) {
        finishingRef.current = false;
        return;
      }

      // Consume this flag before the async work to prevent duplicates.
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

          // Check cancellation immediately before saving.
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
            console.error(
              'Unable to save Dynamic Range progress:',
              saveError,
            );
          }
        } catch (error) {
          console.error(
            'Unable to measure Dynamic Range:',
            error,
          );

          if (
            mountedRef.current &&
            !cancelProcessingRef.current &&
            !quitInProgressRef.current
          ) {
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
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  useEffect(() => {
    recordingActiveRef.current = isRecording;
  }, [isRecording]);

  /* Component lifecycle */

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
        void Promise.resolve(stopRecordingRef.current?.()).catch(
          error => {
            console.error(
              'Unable to stop Dynamic Range recording during cleanup:',
              error,
            );
          },
        );
      } catch (error) {
        console.error(
          'Unable to stop Dynamic Range recording during cleanup:',
          error,
        );
      }
    };
  }, []);

  /* Reset exercise state */

  const resetExercise = useCallback(() => {
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
    discardNextStopRef.current = false;
    cancelProcessingRef.current = false;
  }, []);

  /* Shared countdown used for the first start and every repetition */

  const runCountdown = useCallback(
    async (runId: number, purpose: CountdownFor) => {
      setCountdownFor(purpose);
      setCountdown(COUNTDOWN_SECONDS);
      setCurrentPhase('countdown');

      for (
        let value = COUNTDOWN_SECONDS;
        value >= 1;
        value--
      ) {
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

  /* Start a new session */

  const startExercise = useCallback(async () => {
    if (
      loadingParams ||
      pausedRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const runId = ++countdownRunIdRef.current;

    resetExercise();

    try {
      const countdownFinished = await runCountdown(
        runId,
        'start',
      );

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
      acceptFramesRef.current = true;

      setSeconds(0);
      setCurrentPhase('exercise');
    } catch (error) {
      console.error(
        'Unable to start Dynamic Range recording:',
        error,
      );

      acceptFramesRef.current = false;
      shouldSaveResultRef.current = false;
      recordingActiveRef.current = false;

      if (
        mountedRef.current &&
        runId === countdownRunIdRef.current
      ) {
        setCurrentPhase('directions');
      }
    }
  }, [
    loadingParams,
    resetExercise,
    runCountdown,
    startRecording,
    stopRecording,
    setCurrentPhase,
  ]);

  const tryAgain = useCallback(() => {
    if (quitInProgressRef.current) return;

    pausedRef.current = false;
    showQuitModalRef.current = false;
    setShowQuitModal(false);

    void startExercise();
  }, [startExercise]);

  /* Pause the exercise and show the quit confirmation */

  const pauseForExitPrompt = useCallback(() => {
    if (
      !mountedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    const currentPhase = phaseRef.current;

    pausedPhaseRef.current = currentPhase;
    pausedHadRecordingRef.current = recordingActiveRef.current;

    // Let a completed session continue processing behind the modal.
    pausedRef.current = currentPhase !== 'processing';
    showQuitModalRef.current = true;

    clearCountdown();
    acceptFramesRef.current = false;

    if (currentPhase === 'exercise') {
      // This repetition is interrupted, so discard its stop callback.
      discardNextStopRef.current = true;
      shouldSaveResultRef.current = false;
      finishingRef.current = true;

      setSeconds(0);
      setLiveFrame(null);
      setLiveHistory([]);

      void stopRecordingSafely().catch(error => {
        console.error(
          'Unable to stop Dynamic Range while paused:',
          error,
        );
      });
    } else if (currentPhase === 'countdown') {
      setCountdown(COUNTDOWN_SECONDS);
    }

    setShowQuitModal(true);
  }, [clearCountdown, stopRecordingSafely]);

  /* Continue after the modal */

  const continueExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    const interruptedPhase = pausedPhaseRef.current;
    const hadRecording = pausedHadRecordingRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    pausedRef.current = false;

    if (interruptedPhase === 'processing') {
      // Do not start a second recording or duplicate analysis.
      finishingRef.current = true;
      return;
    }

    if (
      interruptedPhase === 'exercise' ||
      interruptedPhase === 'countdown'
    ) {
      const runId = ++countdownRunIdRef.current;

      finishingRef.current = false;
      shouldSaveResultRef.current = false;

      setSeconds(0);
      setLiveFrame(null);
      setLiveHistory([]);

      // Wait for the interrupted recording to finish stopping
      // before attempting to create another recording.
      if (interruptedPhase === 'exercise') {
        try {
          await pendingStopRef.current;
        } catch (error) {
          console.error(
            'Unable to finish stopping the interrupted recording:',
            error,
          );
        }

        if (
          !mountedRef.current ||
          quitInProgressRef.current ||
          runId !== countdownRunIdRef.current
        ) {
          return;
        }

        discardNextStopRef.current = false;
      }

      const countdownFinished = await runCountdown(
        runId,
        interruptedPhase === 'countdown'
          ? countdownFor
          : 'repetition',
      );

      if (
        !countdownFinished ||
        !mountedRef.current ||
        pausedRef.current ||
        quitInProgressRef.current ||
        runId !== countdownRunIdRef.current
      ) {
        return;
      }

      // If the recording was interrupted during the actual exercise,
      // restart it. Otherwise the continuous recording is still active.
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
        } catch (error) {
          console.error(
            'Unable to resume Dynamic Range recording:',
            error,
          );

          if (mountedRef.current) {
            setCurrentPhase('directions');
          }

          return;
        }
      }

      acceptFramesRef.current = true;
      setSeconds(0);
      setCurrentPhase('exercise');
    }
  }, [
    countdownFor,
    runCountdown,
    startRecording,
    stopRecording,
    setCurrentPhase,
  ]);

  /* Quit and navigate away */

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
    console.error(
      'Unable to stop Dynamic Range recording:',
      error,
    );
  } finally {
    recordingActiveRef.current = false;

    if (mountedRef.current) {
      router.replace('/dashboard?tab=exercises');
    }
  }
}, [clearCountdown, stopRecordingSafely]);

  const handleBack = useCallback(() => {
    pauseForExitPrompt();
  }, [pauseForExitPrompt]);

  /* Android hardware back button */

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (
          showQuitModalRef.current ||
          quitInProgressRef.current
        ) {
          return true;
        }

        handleBack();
        return true;
      },
    );

    return () => subscription.remove();
  }, [handleBack]);

  /* Timer: only runs on the independent exercise screen */

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

      if (seconds >= totalSeconds - 1) {
        if (rep < repetitions) {
          // Keep the continuous recording active between repetitions.
          acceptFramesRef.current = false;

          const runId = ++countdownRunIdRef.current;
          const nextRep = rep + 1;

          setRep(nextRep);
          setSeconds(0);
          setLiveHistory([]);
          setLiveFrame(null);

          void (async () => {
            const countdownFinished = await runCountdown(
              runId,
              'repetition',
            );

            if (
              !countdownFinished ||
              !mountedRef.current ||
              pausedRef.current ||
              quitInProgressRef.current ||
              runId !== countdownRunIdRef.current
            ) {
              return;
            }

            // Resume accepting frames from the same recording.
            acceptFramesRef.current = true;
            setSeconds(0);
            setCurrentPhase('exercise');
          })();

          return;
        }

        // All repetitions are complete. Show a dedicated processing
        // screen while the recording is stopped and analyzed.
        if (!finishingRef.current) {
          finishingRef.current = true;
          shouldSaveResultRef.current = true;
          acceptFramesRef.current = false;

          setCurrentPhase('processing');

          void stopRecordingSafely().catch(error => {
            console.error(
              'Unable to finish Dynamic Range recording:',
              error,
            );

            finishingRef.current = false;
            shouldSaveResultRef.current = false;

            if (
              mountedRef.current &&
              !quitInProgressRef.current
            ) {
              setCurrentPhase('directions');
            }
          });
        }

        return;
      }

      setSeconds(previous => previous + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [
    phase,
    isRecording,
    seconds,
    rep,
    repetitions,
    totalSeconds,
    runCountdown,
    stopRecordingSafely,
    setCurrentPhase,
  ]);

  /* Instruction text */

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

  const progress = Math.min(
    100,
    (seconds / totalSeconds) * 100,
  );

  /* Quit confirmation modal */

  const quitModal = (
    <Modal
      visible={showQuitModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        void continueExercise();
      }}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}>
            <Ionicons
              name="exit-outline"
              size={30}
              color={BROWN}
            />
          </View>

          <Text style={styles.modalTitle}>Quit exercise?</Text>

          <Text style={styles.modalMessage}>
            {pausedPhaseRef.current === 'directions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Dynamic Range?'
              : pausedPhaseRef.current === 'exercise'
                ? 'Your exercise is paused. Your current repetition will restart when you continue.'
                : pausedPhaseRef.current === 'countdown'
                  ? 'Your exercise is paused. Continue to restart the countdown and carry on with your exercise.'
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
            <Text style={styles.continueButtonText}>
              Continue Exercise
            </Text>
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

  /* Preparing screen */

  if (loadingParams) {
    return (
      <>
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

        {quitModal}
      </>
    );
  }

  /* Directions screen */

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
          onBack={handleBack}
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
                <Ionicons name="play" size={17} color={BROWN} />
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

        {quitModal}
      </>
    );
  }

  /* Shared countdown screen for starting and repeating */

  if (phase === 'countdown') {
    const repetitionCountdown = countdownFor === 'repetition';

    return (
      <>
        <View style={styles.countdownScreen}>
          <View style={styles.countdownContent}>
            <View style={styles.countdownCircle}>
              <Text style={styles.countdownNumber}>
                {countdown}
              </Text>
            </View>

            <Text style={styles.countdownTitle}>
              {repetitionCountdown
                ? `Repetition ${rep}`
                : 'Get Ready'}
            </Text>

            <Text style={styles.countdownPrompt}>
              {repetitionCountdown
                ? 'Get ready to repeat the volume pattern.'
                : 'Recording starts when the countdown ends.'}
            </Text>

            <Text style={styles.countdownHint}>
              Prepare to sing {referenceNote.name}. Start
              softly, then follow the volume prompts.
            </Text>
          </View>
        </View>

        {quitModal}
      </>
    );
  }

  /* Independent Dynamic Range exercise screen.
     This intentionally does not render ExerciseListeningScreen. */

  if (phase === 'exercise') {
    return (
      <>
        <View style={styles.exerciseScreen}>
          <View style={styles.exerciseHeader}>
            <View style={styles.exerciseHeaderText}>
              <Text style={styles.exerciseHeaderTitle}>
                Dynamic Range
              </Text>
              <Text style={styles.exerciseHeaderSubtitle}>
                VOLUME CONTROL
              </Text>
            </View>
          </View>

          <View style={styles.exercisePromptCard}>
            <Text style={styles.exercisePromptTitle}>
              {instructionTitle}
            </Text>
            <Text style={styles.exercisePromptText}>
              {instructionPrompt} Sing {referenceNote.name}
              {' '}throughout the pattern.
            </Text>
          </View>

          <ScrollView
            style={styles.exerciseScroll}
            contentContainerStyle={styles.exerciseScrollContent}
            showsVerticalScrollIndicator={false}
          >
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

              <View style={styles.exerciseFooter}>
                <Text style={styles.exerciseFooterText}>
                  Repetition {rep} of {repetitions}
                </Text>
              </View>
            </View>
          </ScrollView>
        </View>

        {quitModal}
      </>
    );
  }

  /* Independent processing screen */

  if (phase === 'processing') {
    return (
      <>
        <View style={styles.processingScreen}>
          <View style={styles.processingIconCircle}>
            <Ionicons
              name="analytics-outline"
              size={44}
              color={BROWN}
            />
          </View>

          <Text style={styles.processingTitle}>
            Analyzing Your Performance
          </Text>

          <Text style={styles.processingSubtitle}>
            Measuring your volume control and checking how
            consistently you followed the pattern.
          </Text>

          <View style={styles.processingStatus}>
            <ActivityIndicator size="large" color={BROWN} />
            <Text style={styles.processingStatusText}>
              Calculating your results...
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={handleBack}
            style={({ pressed }) => [
              styles.processingExitButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.processingExitText}>
              Exit exercise
            </Text>
          </Pressable>
        </View>

        {quitModal}
      </>
    );
  }

  /* Results screen */

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
        onExit={handleBack}
        children={null}
      />

      {quitModal}
    </>
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

  /* Reference note */

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

  /* Exercise screen */

  exerciseScreen: {
    position: 'absolute',
    top: 90,
    right: 8,
    bottom: 0,
    left: 8,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: WHITE,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  exerciseHeaderText: {
    flex: 1,
  },
  exerciseHeaderTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
  },
  exerciseHeaderSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 2,
  },
  exercisePromptCard: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: PINK,
    marginBottom: 14,
  },
  exercisePromptTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
  },
  exercisePromptText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: BROWN,
    marginTop: 5,
  },
  exerciseScroll: {
    flex: 1,
  },
  exerciseScrollContent: {
    paddingBottom: 24,
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
    width: 34,
    height: 34,
    borderRadius: 17,
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

  /* Visualizer */

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
  targetRow: {
    marginTop: 12,
    minHeight: 60,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  targetLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: ACCENT,
  },
  targetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
    marginTop: 1,
  },
  pattern: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  /* Session and progress */

  sessionRow: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  sessionPart: {
    flex: 1,
    alignItems: 'center',
  },
  sessionLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },
  sessionValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
    marginTop: 2,
  },
  sessionDivider: {
    width: 1,
    height: 29,
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
  exerciseFooter: {
    alignItems: 'center',
    marginTop: 14,
  },
  exerciseFooterText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  /* Processing screen */

  processingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  processingIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  processingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  processingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 21,
    color: MUTED,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 320,
  },
  processingStatus: {
    alignItems: 'center',
    marginTop: 28,
    gap: 12,
  },
  processingStatusText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: MUTED,
  },
  processingExitButton: {
    marginTop: 28,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  processingExitText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
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
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
  },
  resultValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
  },

  /* Quit confirmation modal */

  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: WHITE,
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT,
    marginBottom: 15,
  },
  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
    textAlign: 'center',
  },
  modalMessage: {
    marginTop: 10,
    marginBottom: 23,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: MUTED,
    textAlign: 'center',
  },
  continueButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: PINK,
  },
  continueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
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
    borderColor: BORDER,
    backgroundColor: WHITE,
  },
  quitButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: MUTED,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});