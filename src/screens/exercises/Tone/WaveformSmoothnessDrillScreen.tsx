import { router } from 'expo-router';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { BackHandler, Text, View } from 'react-native';

import {
    ExerciseNoAudioModal,
    ExerciseQuitModal,
} from '@/components/ExerciseModals';
import {
    createToneWaveformBars,
    LiveToneMonitorCard,
    type ToneWaveformProps,
} from '@/components/SharedToneComponent';
import {
    COLORS,
    EXERCISE_COUNTDOWN_SECONDS,
    EXERCISE_FFT_HOP_SIZE,
    EXERCISE_FFT_SIZE,
    EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import {
    type Tier,
    WAVEFORM_SMOOTHNESS_PARAMS,
    type WaveformSmoothnessParams,
} from '@/constants/params';
import {
    type LiveAudioFrame,
    useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { useMountedRefLifecycle } from '@/hooks/useMountedRefLifecycle';
import type {
  ExerciseTierProps,
  StandardExercisePhase,
} from '@/types/exercises';
import ExerciseScreen, {
    ExerciseCountdownScreen,
    ExerciseListeningScreen,
    ExercisePreparingScreen,
    ExerciseProcessingScreen,
    ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import {
    generateWaveformSmoothnessParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import {
    getLatestAssessment,
} from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import {
    measureWaveformSmoothness,
    type WaveformSmoothnessMeasurement,
} from '@/services/measurement/tone/waveformSmoothnessDrill';
import {
    saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';
import {
    fetchComponentProgress,
    fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
    scoreWaveformSmoothnessDrill,
    type WaveformSmoothnessScoreResult,
} from '@/services/scoring/tone/waveformSmoothnessDrill';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import {
    samplesToFFTFrames,
} from '@/utils/dsp/fft';
import { clamp } from '@/utils/math';
import {
    disposeNotePlayer,
    playSingleNote,
} from '@/utils/music/notePlayer';
import {
    frequencyToNoteName,
    getRandomPitchNote,
    getSemitoneDistance,
    type VocalRange,
} from '@/utils/music/notes';
import { formatNumber } from '@/utils/numberFormatting';

type Props = ExerciseTierProps;

type Phase = StandardExercisePhase;

interface RepetitionResult {
  targetNote: string;
  measurement: WaveformSmoothnessMeasurement;
  score: WaveformSmoothnessScoreResult;
}

function getWaveformSmoothnessDisplay(
  frame: LiveAudioFrame | null,
  targetFrequency?: number,
): ToneWaveformProps {
  const pitch = frame?.pitch ?? 0;
  const hasPitch = Number.isFinite(pitch) && pitch > 0;

  const matchesTarget =
    hasPitch &&
    targetFrequency !== undefined &&
    Number.isFinite(targetFrequency) &&
    targetFrequency > 0 &&
    getSemitoneDistance(pitch, targetFrequency) <= 1;

  const waveformColor = !hasPitch
    ? COLORS.guideRed
    : matchesTarget
      ? COLORS.guideGreen
      : COLORS.guideYellow;

  return {
    bars: createToneWaveformBars(pitch, hasPitch),
    color: waveformColor,
    hasPitch,
    accessibilityLabel:
      !hasPitch
        ? 'No pitch detected'
        : matchesTarget
          ? 'Target pitch detected'
          : 'A different pitch detected',
    statusText:
      !hasPitch
        ? 'Listening for your voice...'
        : matchesTarget
          ? 'Target note detected'
          : 'Adjust toward the target note',
    statusTextStyle: exerciseStyles.waveformStatus,
  };
}

function RecordingScreen({
  currentRep,
  repetitions,
  elapsedSeconds,
  durationSeconds,
  targetNote,
  targetFrequency,
  detectedNote,
  liveAudioFrame,
}: {
  currentRep: number;
  repetitions: number;
  elapsedSeconds: number;
  durationSeconds: number;
  targetNote: string;
  targetFrequency?: number;
  detectedNote: string;
  liveAudioFrame: LiveAudioFrame | null;
}) {
  const progress =
    durationSeconds > 0
      ? clamp(elapsedSeconds / durationSeconds, 0, 1)
      : 0;

  return (
    <View style={exerciseStyles.recordingScreenVariant6}>

        <Text style={exerciseStyles.recordingTitleVariant6}>Sustain Smoothly</Text>
        <Text style={exerciseStyles.repPillTextVariant3}>
              Repetition {currentRep} of {repetitions}
        </Text>
        <View style={exerciseStyles.recordingBodyVariant1}>
        <LiveToneMonitorCard
          waveform={getWaveformSmoothnessDisplay(
            liveAudioFrame,
            targetFrequency,
          )}
        >


          <View style={exerciseStyles.liveMetricsRow}>
            <View style={exerciseStyles.sessionPart}>
              <Text style={exerciseStyles.liveLabelVariant2}>TARGET NOTE</Text>
              <Text style={exerciseStyles.liveValueVariant1}>{targetNote}</Text>
              <Text style={exerciseStyles.metricHintVariant1}>Sing this note</Text>
            </View>

            <View style={exerciseStyles.liveDivider} />

            <View style={exerciseStyles.sessionPart}>
              <Text style={exerciseStyles.liveLabelVariant2}>DETECTED NOTE</Text>
              <Text style={exerciseStyles.liveValueVariant1}>{detectedNote}</Text>
              <Text style={exerciseStyles.metricHintVariant1}>Current pitch</Text>
            </View>
          </View>
        </LiveToneMonitorCard>

        <View style={exerciseStyles.recordingProgressSection}>
          <View style={exerciseStyles.progressTrack}>
            <View
              style={[
                exerciseStyles.progressFill,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>

        </View>
      </View>
    </View>
  );
}

export default function WaveformSmoothnessDrillScreen({
  tier,
}: Props) {
  const initialTier = tier ?? 'beginner';

  const [currentTier, setCurrentTier] = useState<Tier>(initialTier);
  const [params, setParams] = useState<WaveformSmoothnessParams>(
    WAVEFORM_SMOOTHNESS_PARAMS[initialTier],
  );
  const [isLoadingParams, setIsLoadingParams] = useState(true);
  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [countdownCycle, setCountdownCycle] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveAudioFrame, setLiveAudioFrame] = useState<LiveAudioFrame | null>(null);
  const [repetitionResults, setRepetitionResults] = useState<
    RepetitionResult[]
  >([]);
  const [result, setResult] =
    useState<WaveformSmoothnessScoreResult | null>(null);
  const [averageCentroidSmoothness, setAverageCentroidSmoothness] =
    useState(0);
  const [averageAmplitudeStability, setAverageAmplitudeStability] =
    useState(0);
  const [averageCentroid, setAverageCentroid] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

  const mountedRef = useRef(true);
  useMountedRefLifecycle(mountedRef);
  const leavingRef = useRef(false);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const isRecordingRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);
  const processingRef = useRef(false);
  const elapsedRef = useRef(0);
  const currentRepRef = useRef(1);
  const repetitionResultsRef = useRef<RepetitionResult[]>([]);

  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef =
    useRef<(() => void | Promise<void>) | null>(null);

  const targetNote = useMemo(
    () => getRandomPitchNote(currentTier, vocalRange),
    [currentTier, vocalRange],
  );

  const targetNoteRef =
    useRef<ReturnType<typeof getRandomPitchNote> | null>(null);

  useEffect(() => {
    targetNoteRef.current = targetNote;
  }, [targetNote]);

  const currentTarget = targetNote;

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadExerciseData = async () => {
      const user = auth.currentUser;

      if (!user) {
        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';
          setCurrentTier(fallbackTier);
          setParams(WAVEFORM_SMOOTHNESS_PARAMS[fallbackTier]);
          setIsLoadingParams(false);
        }
        return;
      }

      try {
        setIsLoadingParams(true);

        const assessment = await getLatestAssessment();

        if (!cancelled) {
          setVocalRange(assessment?.vocalRange ?? null);
        }

        const componentProgress = await fetchComponentProgress(
          user.uid,
          'tone',
        );

        const resolvedTier =
          tier ?? componentProgress?.currentTier ?? 'beginner';

        const records = await fetchExerciseRecords(user.uid, 'tone');

        const currentTierRecords = records
          .filter(
            record =>
              record.tier === resolvedTier &&
              record.templateId === 'waveformSmoothnessDrill',
          )
          .sort((a, b) => a.timestamp - b.timestamp);

        const recentScores = currentTierRecords
          .slice(-5)
          .map(record => Number(record.scorePct))
          .filter(Number.isFinite);

        let referenceScores = recentScores;

        if (referenceScores.length === 0) {
          const assessmentScore = assessment?.scores.find(
            score => score.componentId === 'tone',
          )?.scorePct;

          if (Number.isFinite(assessmentScore)) {
            referenceScores = [Number(assessmentScore)];
          }
        }

        const generatedParams = generateWaveformSmoothnessParams({
          tier: resolvedTier,
          recentScores: referenceScores,
        });

        if (cancelled) return;

        setCurrentTier(resolvedTier);
        setParams(generatedParams);
      } catch (errorMessage) {
        console.error('Failed to load waveform smoothness data:', errorMessage);

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';
          setCurrentTier(fallbackTier);
          setParams(WAVEFORM_SMOOTHNESS_PARAMS[fallbackTier]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingParams(false);
        }
      }
    };

    void loadExerciseData();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (
      !mountedRef.current ||
      leavingRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phaseRef.current !== 'recording'
    ) {
      return;
    }

    setLiveAudioFrame(frame);
  }, []);

  const handleRecordingStop = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        isRecordingRef.current = false;
        recordingStopRequestedRef.current = false;
        return;
      }

      if (
        !mountedRef.current ||
        leavingRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        processingRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      processingRef.current = true;
      isRecordingRef.current = false;
      recordingStopRequestedRef.current = false;
      clearTimers();

      setElapsedMs(0);
      elapsedRef.current = 0;
      setLiveAudioFrame(null);
      setPhase('processing');

      if (!hasSufficientRecordedSignal(samples)) {
        processingRef.current = false;
        setPhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      try {
        const fftFrames = samplesToFFTFrames(
          samples,
          EXERCISE_FFT_SIZE,
          EXERCISE_FFT_HOP_SIZE,
        );

        if (fftFrames.length === 0) {
          throw new Error('No FFT frames could be generated.');
        }

        const measurement = measureWaveformSmoothness(
          samples,
          fftFrames,
          sampleRate,
          EXERCISE_FFT_SIZE,
        );

        const scored = scoreWaveformSmoothnessDrill(
          measurement,
          params,
        );

        const target = targetNoteRef.current;

        const nextResult: RepetitionResult = {
          targetNote: target?.name ?? '--',
          measurement,
          score: scored,
        };

        const nextResults = [...repetitionResultsRef.current, nextResult];
        repetitionResultsRef.current = nextResults;

        if (!mountedRef.current || leavingRef.current) {
          processingRef.current = false;
          return;
        }

        setRepetitionResults(nextResults);

        if (currentRepRef.current >= params.repetitions) {
          const totalScore =
            nextResults.reduce(
              (sum, item) => sum + item.score.score,
              0,
            ) / nextResults.length;

          const allPassed = nextResults.every(
            item => item.score.passed,
          );

          const centroidSmoothness =
            nextResults.reduce(
              (sum, item) =>
                sum + item.measurement.centroidSmoothnessPct,
              0,
            ) / nextResults.length;

          const amplitudeStability =
            nextResults.reduce(
              (sum, item) =>
                sum + item.measurement.amplitudeStabilityPct,
              0,
            ) / nextResults.length;

          const averageCentroidHz =
            nextResults.reduce(
              (sum, item) =>
                sum + item.measurement.averageCentroidHz,
              0,
            ) / nextResults.length;

          const roundedScore = Math.round(clamp(totalScore, 0, 100));

          const aggregatedResult: WaveformSmoothnessScoreResult = {
            score: roundedScore,
            passed: allPassed,
          };

          setAverageCentroidSmoothness(centroidSmoothness);
          setAverageAmplitudeStability(amplitudeStability);
          setAverageCentroid(averageCentroidHz);
          setResult(aggregatedResult);

          await saveCompletedExercise(
            'tone',
            'waveformSmoothnessDrill',
            currentTier,
            roundedScore,
          );

          if (
            !mountedRef.current ||
            leavingRef.current ||
            pausedRef.current ||
            showQuitModalRef.current ||
            quitInProgressRef.current
          ) {
            processingRef.current = false;
            return;
          }

          processingRef.current = false;
          setPhase('results');
          return;
        }

        if (
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current
        ) {
          processingRef.current = false;
          return;
        }

        const nextRep = currentRepRef.current + 1;
        currentRepRef.current = nextRep;
        setCurrentRep(nextRep);
        processingRef.current = false;
        setCountdown(EXERCISE_COUNTDOWN_SECONDS);
        setPhase('countdown');
      } catch (errorMessage) {
        console.error('Waveform smoothness processing error:', errorMessage);
        processingRef.current = false;

        if (
          mountedRef.current &&
          !leavingRef.current &&
          !quitInProgressRef.current
        ) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          setPhase('instructions');
        }
      }
    },
    [clearTimers, currentTier, params, setPhase],
  );

  const { startRecording, stopRecording } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const beginRecording = useCallback(async () => {
    if (
      !mountedRef.current ||
      leavingRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      isRecordingRef.current ||
      processingRef.current
    ) {
      return;
    }

    const start = startRecordingRef.current;
    const stop = stopRecordingRef.current;

    if (!start || !stop) {
      setErrorMessage('The audio recorder is not ready. Please try again.');
      setPhase('instructions');
      return;
    }

    try {
      setErrorMessage(null);
      setLiveAudioFrame(null);
      elapsedRef.current = 0;
      setElapsedMs(0);

      isRecordingRef.current = true;
      recordingStopRequestedRef.current = false;
      processingRef.current = false;
      discardNextStopRef.current = false;

      setPhase('recording');

      await start();

      if (
        !mountedRef.current ||
        leavingRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      const durationMs = params.durationSec * 1000;
      let lastTickAt = Date.now();

      recordingTimerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsedDelta = now - lastTickAt;
        lastTickAt = now;

        if (
          !mountedRef.current ||
          leavingRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          !isRecordingRef.current ||
          recordingStopRequestedRef.current ||
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        elapsedRef.current += elapsedDelta;
        setElapsedMs(elapsedRef.current);

        if (elapsedRef.current >= durationMs) {
          clearTimers();

          if (recordingStopRequestedRef.current) return;
          recordingStopRequestedRef.current = true;

          void Promise.resolve(stop()).catch(errorMessage => {
            console.error('Failed to stop waveform recording:', errorMessage);

            isRecordingRef.current = false;
            recordingStopRequestedRef.current = false;
            processingRef.current = false;

            if (
              mountedRef.current &&
              !leavingRef.current &&
              !quitInProgressRef.current
            ) {
              setErrorMessage(
                'We could not finish the recording. Please try again.',
              );
              setPhase('instructions');
            }
          });
        }
      }, 100);
    } catch (errorMessage) {
      console.error('Failed to start waveform recording:', errorMessage);

      isRecordingRef.current = false;
      recordingStopRequestedRef.current = false;
      processingRef.current = false;

      if (
        mountedRef.current &&
        !leavingRef.current &&
        !quitInProgressRef.current
      ) {
        setErrorMessage(
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
        setPhase('instructions');
      }
    }
  }, [clearTimers, params.durationSec, setPhase]);

  const playCurrentReference = useCallback(async () => {
    const target = targetNoteRef.current;

    if (
      !target ||
      !mountedRef.current ||
      leavingRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    try {
      setErrorMessage(null);
      setPhase('listening');

      await playSingleNote(
        target.frequency,
        EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
      );

      if (
        !mountedRef.current ||
        leavingRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      await beginRecording();
    } catch (errorMessage) {
      if (
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        leavingRef.current
      ) {
        return;
      }

      console.error('Failed to play waveform reference note:', errorMessage);

      if (mountedRef.current) {
        setErrorMessage(
          'We could not play the reference note. Please try again.',
        );
        setPhase('instructions');
      }
    }
  }, [beginRecording, setPhase]);

  useEffect(() => {
    if (phase !== 'countdown') return;

    let value = EXERCISE_COUNTDOWN_SECONDS;
    setCountdown(value);

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        leavingRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      value -= 1;

      if (value <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }

        void playCurrentReference();
        return;
      }

      setCountdown(value);
    }, 1000);

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [phase, countdownCycle, playCurrentReference]);

  const startExercise = useCallback(() => {
    if (isLoadingParams || !targetNote) return;

    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    quitInProgressRef.current = false;
    discardNextStopRef.current = false;
    leavingRef.current = false;

    repetitionResultsRef.current = [];
    setRepetitionResults([]);
    setResult(null);
    setAverageCentroidSmoothness(0);
    setAverageAmplitudeStability(0);
    setAverageCentroid(0);
    setErrorMessage(null);

    currentRepRef.current = 1;
    setCurrentRep(1);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setElapsedMs(0);
    elapsedRef.current = 0;
    setLiveAudioFrame(null);

    isRecordingRef.current = false;
    recordingStopRequestedRef.current = false;
    processingRef.current = false;

    setIsQuitting(false);
    setShowQuitModal(false);
    setPhase('countdown');
  }, [clearTimers, isLoadingParams, setPhase, targetNote]);

  const retryExercise = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    isRecordingRef.current = false;
    recordingStopRequestedRef.current = true;
    processingRef.current = false;

    try {
      void Promise.resolve(stopRecordingRef.current?.()).catch(errorMessage => {
        console.error(
          'Failed to stop waveform recording before retry:',
          errorMessage,
        );
      });
    } catch (errorMessage) {
      console.error(
        'Failed to stop waveform recording before retry:',
        errorMessage,
      );
    }

    disposeNotePlayer();

    repetitionResultsRef.current = [];
    setRepetitionResults([]);
    setResult(null);
    setAverageCentroidSmoothness(0);
    setAverageAmplitudeStability(0);
    setAverageCentroid(0);
    setErrorMessage(null);

    currentRepRef.current = 1;
    setCurrentRep(1);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setElapsedMs(0);
    elapsedRef.current = 0;
    setLiveAudioFrame(null);

    recordingStopRequestedRef.current = false;
    setShowQuitModal(false);
    setIsQuitting(false);
    setPhase('countdown');
  }, [clearTimers, setPhase]);

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
    pausedRef.current = true;
    showQuitModalRef.current = true;

    clearTimers();

    if (currentPhase === 'recording') {
      discardNextStopRef.current = true;
      isRecordingRef.current = false;
      recordingStopRequestedRef.current = true;
      processingRef.current = false;

      elapsedRef.current = 0;
      setElapsedMs(0);
      setLiveAudioFrame(null);

      try {
        void Promise.resolve(stopRecordingRef.current?.()).catch(errorMessage => {
          console.error(
            'Failed to stop waveform recording while paused:',
            errorMessage,
          );
        });
      } catch (errorMessage) {
        console.error(
          'Failed to stop waveform recording while paused:',
          errorMessage,
        );
      }
    } else if (currentPhase === 'countdown') {
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    } else if (currentPhase === 'listening') {
      disposeNotePlayer();
    }

    setShowQuitModal(true);
  }, [clearTimers]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    const pausedPhase = pausedPhaseRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    pausedRef.current = false;

    if (
      pausedPhase === 'countdown' ||
      pausedPhase === 'recording' ||
      pausedPhase === 'listening'
    ) {
      isRecordingRef.current = false;
      recordingStopRequestedRef.current = false;
      processingRef.current = false;

      setElapsedMs(0);
      elapsedRef.current = 0;
      setLiveAudioFrame(null);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);

      if (phaseRef.current === 'countdown') {
        setCountdownCycle(value => value + 1);
      } else {
        setPhase('countdown');
      }

      return;
    }

    if (pausedPhase === 'processing') {
      processingRef.current = false;

      if (result !== null) {
        setPhase('results');
      } else {
        setPhase('countdown');
      }
    }
  }, [result, setPhase]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    leavingRef.current = true;
    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();
    isRecordingRef.current = false;
    recordingStopRequestedRef.current = true;
    processingRef.current = false;

    disposeNotePlayer();

    try {
      await Promise.resolve(stopRecordingRef.current?.());
    } catch (errorMessage) {
      console.error(
        'Failed to stop waveform recording before leaving:',
        errorMessage,
      );
    } finally {
      if (mountedRef.current) {
        router.replace('/exercises/tone');
      }
    }
  }, [clearTimers]);

  const handleBack = useCallback(() => {
    pauseForExitPrompt();
  }, [pauseForExitPrompt]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) return true;
        handleBack();
        return true;
      },
    );

    return () => subscription.remove();
  }, [handleBack]);

  useEffect(() => {
    return () => {
      leavingRef.current = true;
      pausedRef.current = true;
      showQuitModalRef.current = false;
      discardNextStopRef.current = true;

      clearTimers();
      isRecordingRef.current = false;
      recordingStopRequestedRef.current = true;
      processingRef.current = false;

      disposeNotePlayer();

      try {
        void Promise.resolve(stopRecordingRef.current?.()).catch(errorMessage => {
          console.error(
            'Failed to stop waveform recording during cleanup:',
            errorMessage,
          );
        });
      } catch (errorMessage) {
        console.error(
          'Failed to stop waveform recording during cleanup:',
          errorMessage,
        );
      }
    };
  }, [clearTimers]);

  const quitModal = (
    <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit exercise?"}
        message={pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Waveform Smoothness?'
              : pausedPhaseRef.current === 'recording' ||
                  pausedPhaseRef.current === 'listening' ||
                  pausedPhaseRef.current === 'countdown'
                ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => {
              void quitExercise();
            }}
        continueLabel={"Continue Exercise"}
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />
  );

  const noAudioModal = (
    <ExerciseNoAudioModal
      visible={showNoAudioModal}
      onRedo={function redoExerciseRepetition() {
        setShowNoAudioModal(false);
        setErrorMessage(null);
        setCountdown(EXERCISE_COUNTDOWN_SECONDS);
        setPhase('countdown');
      }}
      onQuit={() => {
        setShowNoAudioModal(false);
        void quitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  if (isLoadingParams) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level and preparing your vocal range."
          icon="options-outline"
          iconSize={44}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'instructions') {
    return (
      <>
        <ExerciseScreen
          title="Waveform Smoothness"
          category="Tone"
          icon="pulse-outline"
          instructions="Sustain each assigned note with a smooth, steady tone and consistent vocal output."
          preparationSteps={[
            {
              icon: 'volume-mute-outline',
              text: 'Find a quiet room or area with minimal background noise.',
            },
            {
              icon: 'body-outline',
              text: 'Sit upright or stand comfortably with your shoulders relaxed.',
            },
            {
              icon: 'mic-outline',
              text: 'Keep a comfortable distance from the microphone.',
            },
            {
              icon: 'musical-note-outline',
              text: 'Listen to each reference note, then sustain the same note steadily.',
            },
          ]}
          summary={[
            {
              label: 'Difficulty',
              value:
                currentTier.charAt(0).toUpperCase() +
                currentTier.slice(1),
            },
            {
              label: 'Hold Duration',
              value: `${params.durationSec} sec`,
            },
            {
              label: 'Repetitions',
              value: `${params.repetitions}`,
            },
            {
              label: 'Smoothness Target',
              value: `${params.smoothnessThreshold}%`,
            },
          ]}
          tip="Focus on keeping your tone smooth and your vocal output steady rather than changing your pitch."
          tier={currentTier}
          onBack={handleBack}
          onStart={startExercise}
          startDisabled={isLoadingParams || !targetNote}
          startLabel={isLoadingParams ? 'Loading...' : 'Start Exercise'}
          errorMessage={errorMessage}
        />

        {quitModal}
        {noAudioModal}
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="pulse-outline"
          title="Waveform Smoothness"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Get Ready"
          prompt={
            currentTarget
              ? `Prepare to sing ${currentTarget.name}.`
              : 'Prepare to sing the assigned note.'
          }

        />
        {quitModal}
      </>
    );
  }

  if (phase === 'listening') {
    return (
      <>
        <ExerciseListeningScreen
          title="Waveform Smoothness"
          prompt="Listen carefully to the note, then sustain the same note smoothly."
          referenceNotes={currentTarget ? [currentTarget.name] : []}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'recording') {
    const elapsedSeconds = elapsedMs / 1000;

    const detectedNote =
      liveAudioFrame &&
      Number.isFinite(liveAudioFrame.pitch) &&
      liveAudioFrame.pitch > 0
        ? frequencyToNoteName(liveAudioFrame.pitch)
        : '--';

    return (
      <>
        <RecordingScreen
          currentRep={currentRep}
          repetitions={params.repetitions}
          elapsedSeconds={elapsedSeconds}
          durationSeconds={params.durationSec}
          targetNote={currentTarget?.name ?? '--'}
          targetFrequency={currentTarget?.frequency}
          detectedNote={detectedNote}
          liveAudioFrame={liveAudioFrame}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'processing') {
    const isFinalRep = currentRep >= params.repetitions;

    return (
      <>
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title={
            isFinalRep
              ? 'Analyzing Your Results'
              : 'Analyzing Your Tone'
          }
          message={
            isFinalRep
              ? 'Calculating your overall waveform smoothness score.'
              : `Processing repetition ${currentRep}.`
          }
        />
        {quitModal}
      </>
    );
  }

  const score = result?.score ?? 0;
  const passed = result?.passed ?? false;

  return (
    <>
      <ExerciseResultsScreen
        title="Exercise Complete"
        subtitle="Waveform Smoothness"
        score={score}
        repetitionScores={repetitionResults.map((item, index) => ({
          repetition: index + 1,
          score: item.score.score,
          passed: item.score.passed,
          components: [
            { label: 'Target note', value: item.targetNote },
            {
              label: 'Spectral smoothness',
              value: `${Math.round(item.measurement.centroidSmoothnessPct)}%`,
            },
            {
              label: 'Amplitude stability',
              value: `${Math.round(item.measurement.amplitudeStabilityPct)}%`,
            },
          ],
        }))}
        resultIcon={passed ? 'checkmark' : 'refresh-outline'}
        scoreMessage={
          passed
            ? 'Excellent work! Your tone remained smooth and your vocal output stayed consistent across the repetitions.'
            : 'Keep practicing. Focus on maintaining an even tone and steady vocal output throughout each sustained note.'
        }
        scoreDetails={
          <View style={exerciseStyles.scoreDetailsVariant1}>
            <View style={exerciseStyles.scoreMetric}>
              <Text style={exerciseStyles.scoreMetricLabel}>
                Spectral Smoothness
              </Text>
              <Text style={exerciseStyles.infoName}>
                {formatNumber(averageCentroidSmoothness)}%
              </Text>
            </View>

            <View style={exerciseStyles.scoreMetric}>
              <Text style={exerciseStyles.scoreMetricLabel}>
                Amplitude Stability
              </Text>
              <Text style={exerciseStyles.infoName}>
                {formatNumber(averageAmplitudeStability)}%
              </Text>
            </View>

            <View style={exerciseStyles.scoreMetric}>
              <Text style={exerciseStyles.scoreMetricLabel}>
                Average Centroid
              </Text>
              <Text style={exerciseStyles.infoName}>
                {formatNumber(averageCentroid)} Hz
              </Text>
            </View>
          </View>
        }
        onRetry={retryExercise}
        onExit={handleBack}
      />
      {quitModal}
    </>
  );
}
