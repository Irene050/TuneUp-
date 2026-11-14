import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { ExerciseNoAudioModal, ExerciseQuitModal } from '@/components/ExerciseModals';
import { COLORS, EXERCISE_COUNTDOWN_SECONDS, EXERCISE_REFERENCE_NOTE_DURATION_SECONDS, VOLUME_ANALYSIS_WINDOW_MS, VOLUME_DBFS_MAX, VOLUME_DBFS_MIN, VOLUME_HISTORY_BAR_COUNT } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { DYNAMIC_RANGE_PARAMS, type DynamicRangeParams, type Tier } from '@/constants/params';
import { useAudioRecorder, type LiveAudioFrame } from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { useMountedRefLifecycle } from '@/hooks/useMountedRefLifecycle';
import type {
  ExerciseTierProps,
  RecordingExercisePhase,
} from '@/types/exercises';
import ExerciseScreen, {
    ExerciseCountdownScreen,
    ExercisePreparingScreen,
    ExerciseProcessingScreen,
    ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateDynamicRangeParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureDynamicRange, type RepetitionInterval } from '@/services/measurement/volume/dynamicRangeExercise';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreDynamicRange } from '@/services/scoring/volume/dynamicRangeExercise';
import { sleep } from '@/utils/async';
import { concatenateRepetitions, fixedDurationSamples, hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { normalizeVolumeDbfs } from '@/utils/dsp/volumeAnalysis';
import { playSingleNote } from '@/utils/music/notePlayer';
import { createMusicalNote, frequencyToMidi } from '@/utils/music/notes';

const PHASES_PER_REPETITION = 3;
const PROCESSING_MIN_DURATION_MS = 100;
const TIMER_TICK_MS = 100;

type Phase = RecordingExercisePhase;

type CountdownFor = 'start' | 'repetition';

type DynamicRangeExerciseProps = ExerciseTierProps;

function referenceHeight(index: number): number {
  const middle = (VOLUME_HISTORY_BAR_COUNT - 1) / 2;
  const distance = Math.abs(index - middle) / middle;
  return 0.18 + (1 - distance) * 0.72;
}

function DynamicRangeVisualizer({ liveHistory }: { liveHistory: number[] }) {
  return (
    <View style={exerciseStyles.visualizer}>
      <View style={exerciseStyles.targetBand} />
      <View style={exerciseStyles.actualBars}>
        {Array.from({ length: VOLUME_HISTORY_BAR_COUNT }, (_, index) => {
          const height = liveHistory[index] ?? 0;
          return (
            <View
              key={`actual-${index}`}
              style={[
                exerciseStyles.actualBar,
                { height: height > 0 ? `${Math.max(5, height * 82)}%` : '0%' },
              ]}
            />
          );
        })}
      </View>
      <View style={exerciseStyles.centerLine} />
      <View style={exerciseStyles.targetMarker}>
        <Text style={exerciseStyles.targetMarkerText}>TARGET</Text>
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
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [isLoadingParams, setIsLoadingParams] = useState(true);
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [countdownFor, setCountdownFor] = useState<CountdownFor>('start');
  const [currentRep, setCurrentRep] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [, setLiveAudioFrame] = useState<LiveAudioFrame | null>(null);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [repetitionScores, setRepetitionScores] = useState<number[]>([]);
  const [rangeAccuracy, setRangeAccuracy] = useState(0);
  const [rampConsistency, setRampConsistency] = useState(0);
  const [passed, setPassed] = useState(false);
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [referencePlaybackError, setReferencePlaybackError] = useState('');
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
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
  useMountedRefLifecycle(mountedRef);
  const countdownRunIdRef = useRef(0);
  const shouldSaveResultRef = useRef(false);
  const finishingRef = useRef(false);
  const acceptFramesRef = useRef(false);
  const cancelProcessingRef = useRef(false);
  const pausedRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');
  const pausedHadRecordingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const referencePlayingRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const repetitionStartedAtRef = useRef<number | null>(null);
  const repetitionIntervalsRef = useRef<RepetitionInterval[]>([]);
  const repetitionSamplesRef = useRef<Array<Float32Array | null>>([]);
  const retryingRepetitionRef = useRef<number | null>(null);
  const currentRepetitionStartRef = useRef<number | null>(null);
  const stopRecordingRef = useRef<(() => void | Promise<void>) | null>(null);
  const pendingStopRef = useRef<Promise<void> | null>(null);

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

        const lowMidi = Math.round(frequencyToMidi(lowHz));
        const highMidi = Math.round(frequencyToMidi(highHz));
        const midpointHz = Math.sqrt(lowHz * highHz);
        const midpointMidi = Math.round(frequencyToMidi(midpointHz));
        const midiNote = Math.max(lowMidi, Math.min(highMidi, midpointMidi));

        if (!cancelled) setReferenceNote(createMusicalNote(midiNote));
      } catch (errorMessage) {
        console.error('[DynamicRange] Could not load vocal range:', errorMessage);
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
      setIsLoadingParams(true);

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
      } catch (errorMessage) {
        console.error('[DynamicRange] Could not load adaptive parameters:', errorMessage);
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
        if (!cancelled) setIsLoadingParams(false);
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
      return false;
    }

    referencePlayingRef.current = true;
    setReferencePlaying(true);
    setReferencePlaybackError('');

    try {
      await playSingleNote(referenceNote.frequency, EXERCISE_REFERENCE_NOTE_DURATION_SECONDS);
      return true;
    } catch (errorMessage) {
      console.error('[DynamicRange] Could not play reference note:', errorMessage);
      if (mountedRef.current) {
        setReferencePlaybackError(
          'Unable to play the reference note. Please try again.',
        );
      }
      return false;
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
    analyzePitch: false,
    onFrame: frame => {
      if (
        !mountedRef.current ||
        !acceptFramesRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      setLiveAudioFrame(frame);
      const normalized = normalizeVolumeDbfs(
        frame.volume,
        VOLUME_DBFS_MIN,
        VOLUME_DBFS_MAX,
      );
      setLiveHistory(previous => {
        const next = [...previous, normalized];
        return next.length > VOLUME_HISTORY_BAR_COUNT ? next.slice(-VOLUME_HISTORY_BAR_COUNT) : next;
      });
    },

    onStop: (samples, sampleRate) => {
      isRecordingRef.current = false;
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
        let repetitionSamples = repetitionSamplesRef.current;
        const retryingRepetition = retryingRepetitionRef.current;

        if (retryingRepetition !== null) {
          if (!hasSufficientRecordedSignal(samples)) {
            retryingRepetitionRef.current = null;
            finishingRef.current = false;
            setCurrentRep(retryingRepetition + 1);
            setShowNoAudioModal(true);
            setPhase('instructions');
            return;
          }

          repetitionSamples = [...repetitionSamples];
          repetitionSamples[retryingRepetition] = fixedDurationSamples(
            samples,
            sampleRate,
            totalSeconds,
          );
          repetitionSamplesRef.current = repetitionSamples;
          retryingRepetitionRef.current = null;
        } else {
          repetitionSamples = Array.from(
            { length: repetitions },
            (_, index) => {
              const interval = repetitionIntervalsRef.current[index];
              if (!interval) return null;

              const start = Math.max(
                0,
                Math.floor(interval.startSeconds * sampleRate),
              );
              const end = Math.min(
                samples.length,
                Math.ceil(interval.endSeconds * sampleRate),
              );
              const repetition = samples.subarray(start, end);

              return hasSufficientRecordedSignal(repetition)
                ? fixedDurationSamples(repetition, sampleRate, totalSeconds)
                : null;
            },
          );
          repetitionSamplesRef.current = repetitionSamples;
        }

        const missingRepetition = repetitionSamples.findIndex(
          repetition => repetition === null,
        );
        if (missingRepetition !== -1) {
          finishingRef.current = false;
          setCurrentRep(missingRepetition + 1);
          setShowNoAudioModal(true);
          setPhase('instructions');
          return;
        }

        await sleep(PROCESSING_MIN_DURATION_MS);

        if (
          !mountedRef.current ||
          cancelProcessingRef.current ||
          quitInProgressRef.current
        ) {
          finishingRef.current = false;
          return;
        }

        try {
          const analyzedSamples = concatenateRepetitions(repetitionSamples);
          const repetitionIntervals = repetitionSamples.map((_, index) => ({
            startSeconds: index * totalSeconds,
            endSeconds: (index + 1) * totalSeconds,
          }));

          const measurement = measureDynamicRange(analyzedSamples, sampleRate, {
            windowMs: VOLUME_ANALYSIS_WINDOW_MS,
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
          setRepetitionScores(result.repetitionScores);
          setPassed(result.passed);
          setPhase('results');

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
        } catch (errorMessage) {
          console.error('[DynamicRange] Measurement failed:', errorMessage);
          if (
            mountedRef.current &&
            !cancelProcessingRef.current &&
            !quitInProgressRef.current
          ) {
            setReferencePlaybackError(
              errorMessage instanceof Error
                ? errorMessage.message
                : 'We could not analyze this attempt. Please try again.',
            );
            setPhase('instructions');
          }
        } finally {
          finishingRef.current = false;
          if (mountedRef.current) {
            setSeconds(0);
            setCurrentRep(1);
            setLiveAudioFrame(null);
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
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    return () => {
      countdownRunIdRef.current += 1;
      acceptFramesRef.current = false;
      shouldSaveResultRef.current = false;
      cancelProcessingRef.current = true;
      pausedRef.current = true;
      showQuitModalRef.current = false;

      try {
        void Promise.resolve(stopRecordingRef.current?.()).catch(errorMessage => {
          console.error('[DynamicRange] Cleanup stop failed:', errorMessage);
        });
      } catch (errorMessage) {
        console.error('[DynamicRange] Cleanup stop failed:', errorMessage);
      }
    };
  }, []);

  const resetExercise = useCallback((preserveRepetitions = false) => {
    setCurrentRep(1);
    setSeconds(0);
    setScore(0);
    setRepetitionScores([]);
    setRangeAccuracy(0);
    setRampConsistency(0);
    setPassed(false);
    setLiveAudioFrame(null);
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
    retryingRepetitionRef.current = null;
    if (!preserveRepetitions) {
      repetitionSamplesRef.current = Array(repetitions).fill(null);
    }
  }, [repetitions]);

  const runCountdown = useCallback(
    async (runId: number, purpose: CountdownFor) => {
      setCountdownFor(purpose);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      setPhase('countdown');

      for (let value = EXERCISE_COUNTDOWN_SECONDS; value >= 1; value--) {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          quitInProgressRef.current ||
          runId !== countdownRunIdRef.current
        ) {
          return false;
        }
        setCountdown(value);
        await sleep(1000);
      }

      return (
        mountedRef.current &&
        !pausedRef.current &&
        !quitInProgressRef.current &&
        runId === countdownRunIdRef.current
      );
    },
    [setPhase],
  );

  const startExercise = useCallback(async (repetitionToRedo?: number) => {
    if (isLoadingParams || pausedRef.current || quitInProgressRef.current) return;

    const runId = ++countdownRunIdRef.current;
    resetExercise(repetitionToRedo !== undefined);
    if (repetitionToRedo === undefined) {
      repetitionSamplesRef.current = Array(repetitions).fill(null);
      retryingRepetitionRef.current = null;
    } else {
      retryingRepetitionRef.current = repetitionToRedo - 1;
      setCurrentRep(repetitionToRedo);
    }

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

      isRecordingRef.current = true;
      shouldSaveResultRef.current = false;
      finishingRef.current = false;
      beginRecordingSession();
      acceptFramesRef.current = true;
      setSeconds(0);
      setCurrentRep(repetitionToRedo ?? 1);
      setPhase('recording');
    } catch (errorMessage) {
      console.error('[DynamicRange] Could not start recording:', errorMessage);
      acceptFramesRef.current = false;
      shouldSaveResultRef.current = false;
      isRecordingRef.current = false;
      if (mountedRef.current && runId === countdownRunIdRef.current) {
        setPhase('instructions');
      }
    }
  }, [
    isLoadingParams,
    resetExercise,
    runCountdown,
    repetitions,
    startRecording,
    stopRecording,
    beginRecordingSession,
    setPhase,
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
    pausedHadRecordingRef.current = isRecordingRef.current;
    pausedRef.current = current !== 'processing';
    showQuitModalRef.current = true;
    clearCountdown();
    acceptFramesRef.current = false;

    if (current === 'recording') {
      discardNextStopRef.current = true;
      shouldSaveResultRef.current = false;
      finishingRef.current = true;
      setSeconds(0);
      setLiveAudioFrame(null);
      setLiveHistory([]);
      void stopRecordingSafely().catch(errorMessage => {
        console.error('[DynamicRange] Pause stop failed:', errorMessage);
      });
    } else if (current === 'countdown') {
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
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
      interruptedPhase !== 'recording' &&
      interruptedPhase !== 'countdown'
    ) {
      return;
    }

    const runId = ++countdownRunIdRef.current;

    if (interruptedPhase === 'recording') {
      finishingRef.current = false;
      shouldSaveResultRef.current = false;
      setCurrentRep(1);
      setSeconds(0);
      setLiveAudioFrame(null);
      setLiveHistory([]);
      repetitionSamplesRef.current = Array(repetitions).fill(null);
      retryingRepetitionRef.current = null;

      try {
        await pendingStopRef.current;
      } catch (errorMessage) {
        console.error('[DynamicRange] Interrupted stop failed:', errorMessage);
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

    if (interruptedPhase === 'recording' || !hadRecording) {
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

        isRecordingRef.current = true;
        beginRecordingSession();
        setCurrentRep(1);
      } catch (errorMessage) {
        console.error('[DynamicRange] Could not resume recording:', errorMessage);
        if (mountedRef.current) setPhase('instructions');
        return;
      }
    } else if (countdownFor === 'repetition') {
      currentRepetitionStartRef.current = getRecordingElapsedSeconds();
      repetitionStartedAtRef.current = Date.now();
    }

    acceptFramesRef.current = true;
    setSeconds(0);
    setPhase('recording');
  }, [
    beginRecordingSession,
    countdownFor,
    getRecordingElapsedSeconds,
    runCountdown,
    startExercise,
    startRecording,
    stopRecording,
    setPhase,
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
    } catch (errorMessage) {
      console.error('[DynamicRange] Quit stop failed:', errorMessage);
    } finally {
      isRecordingRef.current = false;
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
      phase !== 'recording' ||
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
        phaseRef.current !== 'recording' ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        finishingRef.current
      ) {
        return;
      }

      const repStartedAt = repetitionStartedAtRef.current;
      if (repStartedAt === null) return;

      const elapsedSeconds = Math.floor((Date.now() - repStartedAt) / 1000);
      setSeconds(Math.min(totalSeconds, elapsedSeconds));

      if (elapsedSeconds < totalSeconds) return;

      finishCurrentRepetition();

      if (retryingRepetitionRef.current === null && currentRep < repetitions) {
        acceptFramesRef.current = false;
        const runId = ++countdownRunIdRef.current;
        const nextRep = currentRep + 1;

        setCurrentRep(nextRep);
        setSeconds(0);
        setLiveHistory([]);
        setLiveAudioFrame(null);

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
          setPhase('recording');
        })();

        return;
      }

      if (!finishingRef.current) {
        finishingRef.current = true;
        shouldSaveResultRef.current = true;
        acceptFramesRef.current = false;
        setPhase('processing');

        void stopRecordingSafely().catch(errorMessage => {
          console.error('[DynamicRange] Final recording stop failed:', errorMessage);
          finishingRef.current = false;
          shouldSaveResultRef.current = false;
          if (mountedRef.current && !quitInProgressRef.current) {
            setPhase('instructions');
          }
        });
      }
    }, TIMER_TICK_MS);

    return () => clearInterval(interval);
  }, [
    phase,
    isRecording,
    currentRep,
    repetitions,
    totalSeconds,
    finishCurrentRepetition,
    getRecordingElapsedSeconds,
    runCountdown,
    stopRecordingSafely,
    setPhase,
  ]);

  let instructionTitle = 'SOFT → LOUD';
  let instructionPrompt = 'Gradually increase your volume.';

  if (seconds >= firstPhaseSeconds) {
    instructionTitle = 'LOUD';
    instructionPrompt = 'Reach and maintain your loud target.';
  }
  if (seconds >= secondPhaseEndSeconds) {
    instructionTitle = 'LOUD → SOFT';
    instructionPrompt = 'Gradually decrease your volume.';
  }

  const progress = Math.min(100, (seconds / totalSeconds) * 100);

  const quitModal = (
    <>
      <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit recording?"}
        message={pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Dynamic Range?'
              : pausedPhaseRef.current === 'recording'
                ? 'Your current recording will be discarded. Continuing restarts the recording from repetition 1.'
                : pausedPhaseRef.current === 'countdown'
                  ? 'The countdown is paused. Continue to restart the countdown and carry on.'
                  : 'Your results are being processed. Continue to return to your results, or quit to leave this recording.'}
        isQuitting={isQuitting}
        onContinue={() => void continueExercise()}
        onQuit={() => void quitExercise()}
        continueLabel={"Continue Exercise"}
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />
      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={function redoExerciseRepetition() {
          setShowNoAudioModal(false);
          void startExercise(currentRep);
        }}
        onQuit={() => void quitExercise()}
        isQuitting={isQuitting}
      />
    </>
  );

  if (isLoadingParams) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the recording to your current difficulty level and preparing your vocal range."
          icon="options-outline"
          iconSize={44}
          containerStyle={exerciseStyles.centerScreen}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'instructions') {
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
          tip="Keep the same note throughout the recording. Change your vocal volume gradually instead of changing pitch."
          tier={resolvedTier}
          onBack={handleBack}
          onStart={() => void startExercise()}
        >
          <View style={exerciseStyles.referenceCard}>
            <View style={exerciseStyles.referenceTopRow}>
              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.eyebrow}>REFERENCE NOTE</Text>
                <Text style={[exerciseStyles.referenceNote, { lineHeight: 36 }]}>
                  {referenceNote.name}
                </Text>
              </View>
              <View style={exerciseStyles.referenceIconCircle}>
                <Ionicons name="musical-note" size={22} color={COLORS.brown} />
              </View>
            </View>
            <Text style={exerciseStyles.referenceInstruction}>
              Play the note, then sing it while gradually increasing your volume
              from soft to loud, before returning to soft.
            </Text>
            <TouchableOpacity
              style={[exerciseStyles.referenceButton, referencePlaying && exerciseStyles.disabled]}
              onPress={() => void playReferenceNote()}
              activeOpacity={0.85}
              disabled={referencePlaying}
            >
              {referencePlaying ? (
                <ActivityIndicator size="small" color={COLORS.brown} />
              ) : (
                <Ionicons name="play" size={17} color={COLORS.brown} />
              )}
              <Text style={exerciseStyles.smallSemiBoldBrownText}>
                {referencePlaying ? 'Playing...' : `Play ${referenceNote.name}`}
              </Text>
            </TouchableOpacity>
            {referencePlaybackError !== '' && (
              <Text style={exerciseStyles.playbackError}>{referencePlaybackError}</Text>
            )}
          </View>

          <View style={exerciseStyles.previewCardVariant1}>
            <Text style={exerciseStyles.smallSemiBoldBrownText}>Follow this pattern</Text>
            <View style={exerciseStyles.previewVisualizerVariant1}>
              {Array.from({ length: VOLUME_HISTORY_BAR_COUNT }, (_, index) => (
                <View
                  key={`preview-${index}`}
                  style={[
                    exerciseStyles.previewBar,
                    { height: `${referenceHeight(index) * 80}%` },
                  ]}
                />
              ))}
            </View>
            <View style={exerciseStyles.previewLabelsVariant1}>
              <Text style={exerciseStyles.guideText}>Soft</Text>
              <Text style={exerciseStyles.guideText}>Loud</Text>
              <Text style={exerciseStyles.guideText}>Soft</Text>
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
        <ExerciseCountdownScreen
          icon="volume-high-outline"
          title={repetitionCountdown ? `Repetition ${currentRep}` : 'Get Ready'}
          currentRep={currentRep}
          repetitions={repetitions}
          countdown={countdown}
          promptTitle={
            repetitionCountdown ? 'Get ready to repeat' : 'Get ready to begin'
          }
          prompt={`Sing ${referenceNote.name}. Start softly, then follow the volume prompts.`}

        />
        {quitModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        <View style={exerciseStyles.screenVariant1}>
          <View style={exerciseStyles.exerciseHeader}>
            <View style={exerciseStyles.infoText}>
              <Text style={exerciseStyles.resultValueVariant1}>Dynamic Range</Text>
              <Text style={exerciseStyles.exerciseHeaderSubtitle}>VOLUME CONTROL</Text>
            </View>
          </View>

          <View style={exerciseStyles.exercisePromptCard}>
            <Text style={exerciseStyles.exercisePromptTitleVariant1}>{instructionTitle}</Text>
            <Text style={exerciseStyles.exercisePromptText}>
              {instructionPrompt} Sing {referenceNote.name} throughout the pattern.
            </Text>
          </View>

          <ScrollView
            style={exerciseStyles.infoText}
            contentContainerStyle={exerciseStyles.exerciseScrollContent}
            showsVerticalScrollIndicator={false}
          >

            <View style={exerciseStyles.legendVariant1}>
              <View style={exerciseStyles.actualDot} />
              <Text style={exerciseStyles.guideText}>Your voice</Text>
            </View>

            <DynamicRangeVisualizer liveHistory={liveHistory} />

            <View style={exerciseStyles.visualizerLabelsVariant1}>
              <Text style={exerciseStyles.visualizerLabelVariant1}>SOFT</Text>
              <Text style={exerciseStyles.visualizerLabelVariant1}>LOUD</Text>
              <Text style={exerciseStyles.visualizerLabelVariant1}>SOFT</Text>
            </View>

            <View style={exerciseStyles.sessionRowVariant1}>
              <View style={exerciseStyles.sessionPart}>
                <Text style={exerciseStyles.sessionLabel}>REPETITION</Text>
                <Text style={exerciseStyles.largeBrownValue}>{currentRep} / {repetitions}</Text>
              </View>
            </View>

            <View style={[exerciseStyles.progressTrack, { marginTop: 10 }]}>
              <View style={[exerciseStyles.progressFill, { width: `${progress}%` }]} />
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
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing Your Performance"
          message="Measuring your volume control and checking how consistently you followed the pattern. Calculating your results..."
        />
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
        repetitionScores={repetitionScores.map((repetitionScore, index) => ({
          repetition: index + 1,
          score: repetitionScore,
        }))}
        resultIcon={passed ? 'checkmark-circle-outline' : 'refresh-outline'}
        scoreMessage={
          passed
            ? 'You met the passing requirements.'
            : 'Try to follow the soft-to-loud-to-soft pattern more consistently.'
        }
        scoreDetails={
          <View style={exerciseStyles.resultsDetails}>
            <View style={exerciseStyles.resultMetric}>
              <Text style={exerciseStyles.resultValueVariant1}>{rangeAccuracy}%</Text>
              <Text style={exerciseStyles.resultLabelVariant2}>Range Accuracy</Text>
            </View>
            <View style={exerciseStyles.resultMetric}>
              <Text style={exerciseStyles.resultValueVariant1}>{rampConsistency}%</Text>
              <Text style={exerciseStyles.resultLabelVariant2}>Ramp Consistency</Text>
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
