import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  type Tier,
  WAVEFORM_SMOOTHNESS_PARAMS,
  type WaveformSmoothnessParams,
} from '@/constants/tone';
import {
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
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
import {
  samplesToFFTFrames,
} from '@/utils/dsp/fft';
import {
  disposeNotePlayer,
  playSingleNote,
} from '@/utils/music/notePlayer';
import {
  frequencyToNoteName,
  getRandomPitchNote,
  type VocalRange,
} from '@/utils/music/notes';

import { COLORS } from '@/constants/appConstants';


const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;
const COUNTDOWN_SECONDS = 3;
const REFERENCE_NOTE_DURATION_SECONDS = 1.5;
const WAVEFORM_BAR_COUNT = 30;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'results';

interface RepetitionResult {
  targetNote: string;
  measurement: WaveformSmoothnessMeasurement;
  score: WaveformSmoothnessScoreResult;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number, decimals = 1): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

function LiveWaveform({
  frame,
  targetFrequency,
}: {
  frame: LiveAudioFrame | null;
  targetFrequency?: number;
}) {
  const pitch = frame?.pitch ?? 0;
  const hasPitch = Number.isFinite(pitch) && pitch > 0;

  const matchesTarget =
    hasPitch &&
    targetFrequency !== undefined &&
    Number.isFinite(targetFrequency) &&
    targetFrequency > 0 &&
    Math.abs(12 * Math.log2(pitch / targetFrequency)) <= 1;

  const waveformColor = !hasPitch
    ? COLORS.guideRed
    : matchesTarget
      ? COLORS.guideGreen
      : COLORS.guideYellow;

  const bars = useMemo(
    () =>
      Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
        const center = (WAVEFORM_BAR_COUNT - 1) / 2;
        const distance = Math.abs(index - center) / center;
        const envelope = 1 - distance * 0.65;
        const phaseOffset = index * 0.72;

        const variation = hasPitch
          ? 0.35 +
            Math.abs(Math.sin(phaseOffset + pitch * 0.001)) * 0.65
          : 0.12 +
            Math.abs(Math.sin(phaseOffset)) * 0.12;

        return Math.max(
          5,
          Math.round(38 * envelope * variation),
        );
      }),
    [hasPitch, pitch],
  );

  return (
    <View style={styles.waveformContainer}>
      <View
        style={styles.waveformBars}
        accessibilityLabel={
          !hasPitch
            ? 'No pitch detected'
            : matchesTarget
              ? 'Target pitch detected'
              : 'A different pitch detected'
        }
      >
        {bars.map((height, index) => (
          <View
            key={index}
            style={[
              styles.waveformBar,
              {
                height,
                backgroundColor: waveformColor,
                opacity: hasPitch ? 0.9 : 0.45,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.waveformStatusRow}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: waveformColor },
          ]}
        />
        <Text
          style={[
            styles.waveformStatus,
            { color: waveformColor },
          ]}
        >
          {!hasPitch
            ? 'Listening for your voice...'
            : matchesTarget
              ? 'Target note detected'
              : 'Adjust toward the target note'}
        </Text>
      </View>
    </View>
  );
}

function RecordingScreen({
  currentRep,
  repetitions,
  elapsedSeconds,
  durationSeconds,
  targetNote,
  targetFrequency,
  detectedNote,
  liveFrame,
  onBack,
}: {
  currentRep: number;
  repetitions: number;
  elapsedSeconds: number;
  durationSeconds: number;
  targetNote: string;
  targetFrequency?: number;
  detectedNote: string;
  liveFrame: LiveAudioFrame | null;
  onBack: () => void;
}) {
  const progress =
    durationSeconds > 0
      ? clamp(elapsedSeconds / durationSeconds, 0, 1)
      : 0;

  const remainingSeconds = Math.max(
    0,
    durationSeconds - elapsedSeconds,
  );

  return (
    <View style={styles.recordingScreen}>

        <Text style={styles.recordingTitle}>Sustain Smoothly</Text>
        <Text style={styles.recordingSubtitle}>
          Hold your note steadily. Keep your tone even and consistent.
        </Text>

        <View style={styles.recordingBody}>
          <View style={styles.repPill}>
            <Ionicons
              name="repeat-outline"
              size={16}
              color={COLORS.brown}
            />
            <Text style={styles.repPillText}>
              REPETITION {currentRep} OF {repetitions}
            </Text>
        </View>

        <View style={styles.liveCard}>
          <View style={styles.liveCardHeader}>
            <View style={styles.liveMicCircle}>
              <Ionicons
                name="mic"
                size={21}
                color={COLORS.guideGreen}
              />
            </View>
            <View style={styles.liveCardHeading}>
              <Text style={styles.liveCardTitle}>
                Live Voice Monitor
              </Text>
              <Text style={styles.liveCardSubtitle}>
                Your microphone feedback
              </Text>
            </View>
            <View style={styles.liveIndicatorPill}>
              <View style={styles.recordingDot} />
              <Text style={styles.liveIndicatorText}>LIVE</Text>
            </View>
          </View>

          <LiveWaveform
            frame={liveFrame}
            targetFrequency={targetFrequency}
          />

          <View style={styles.liveMetricsRow}>
            <View style={styles.liveMetric}>
              <Text style={styles.liveLabel}>TARGET NOTE</Text>
              <Text style={styles.liveValue}>{targetNote}</Text>
              <Text style={styles.metricHint}>Sing this note</Text>
            </View>

            <View style={styles.liveDivider} />

            <View style={styles.liveMetric}>
              <Text style={styles.liveLabel}>DETECTED NOTE</Text>
              <Text style={styles.liveValue}>{detectedNote}</Text>
              <Text style={styles.metricHint}>Current pitch</Text>
            </View>
          </View>
        </View>

        <View style={styles.recordingProgressSection}>
          <View style={styles.recordingProgressLabels}>
            <Text style={styles.progressLabel}>RECORDING</Text>
            <Text style={styles.progressTime}>
              {formatNumber(elapsedSeconds)}s / {durationSeconds}s
            </Text>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>

          <Text style={styles.remainingText}>
            {formatNumber(remainingSeconds)} seconds remaining
          </Text>
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
  const [loadingParams, setLoadingParams] = useState(true);
  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);
  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [countdownCycle, setCountdownCycle] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveFrame, setLiveFrame] = useState<LiveAudioFrame | null>(null);
  const [repetitionResults, setRepetitionResults] = useState<
    RepetitionResult[]
  >([]);
  const [finalResult, setFinalResult] =
    useState<WaveformSmoothnessScoreResult | null>(null);
  const [averageCentroidSmoothness, setAverageCentroidSmoothness] =
    useState(0);
  const [averageAmplitudeStability, setAverageAmplitudeStability] =
    useState(0);
  const [averageCentroid, setAverageCentroid] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const mountedRef = useRef(true);
  const leavingRef = useRef(false);
  const phaseRef = useRef<Phase>('instructions');

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const processingRef = useRef(false);
  const elapsedRef = useRef(0);
  const currentRepRef = useRef(1);
  const resultsRef = useRef<RepetitionResult[]>([]);

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

  const setCurrentPhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

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
          setLoadingParams(false);
        }
        return;
      }

      try {
        setLoadingParams(true);

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
      } catch (error) {
        console.error('Failed to load waveform smoothness data:', error);

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';
          setCurrentTier(fallbackTier);
          setParams(WAVEFORM_SMOOTHNESS_PARAMS[fallbackTier]);
        }
      } finally {
        if (!cancelled) {
          setLoadingParams(false);
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

    setLiveFrame(frame);
  }, []);

  const handleRecordingStop = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        recordingRef.current = false;
        stopRequestedRef.current = false;
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
      recordingRef.current = false;
      stopRequestedRef.current = false;
      clearTimers();

      setElapsedMs(0);
      elapsedRef.current = 0;
      setLiveFrame(null);
      setCurrentPhase('processing');

      try {
        if (samples.length === 0) {
          throw new Error('No audio samples were recorded.');
        }

        const fftFrames = samplesToFFTFrames(
          samples,
          FFT_SIZE,
          FFT_HOP_SIZE,
        );

        if (fftFrames.length === 0) {
          throw new Error('No FFT frames could be generated.');
        }

        const measurement = measureWaveformSmoothness(
          samples,
          fftFrames,
          sampleRate,
          FFT_SIZE,
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

        const nextResults = [...resultsRef.current, nextResult];
        resultsRef.current = nextResults;

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
          setFinalResult(aggregatedResult);

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
          setCurrentPhase('results');
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
        setCountdown(COUNTDOWN_SECONDS);
        setCurrentPhase('countdown');
      } catch (error) {
        console.error('Waveform smoothness processing error:', error);
        processingRef.current = false;

        if (
          mountedRef.current &&
          !leavingRef.current &&
          !quitInProgressRef.current
        ) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          setCurrentPhase('instructions');
        }
      }
    },
    [clearTimers, currentTier, params, setCurrentPhase],
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
      recordingRef.current ||
      processingRef.current
    ) {
      return;
    }

    const start = startRecordingRef.current;
    const stop = stopRecordingRef.current;

    if (!start || !stop) {
      setErrorMessage('The audio recorder is not ready. Please try again.');
      setCurrentPhase('instructions');
      return;
    }

    try {
      setErrorMessage(null);
      setLiveFrame(null);
      elapsedRef.current = 0;
      setElapsedMs(0);

      recordingRef.current = true;
      stopRequestedRef.current = false;
      processingRef.current = false;
      discardNextStopRef.current = false;

      setCurrentPhase('recording');

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

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          leavingRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          !recordingRef.current ||
          stopRequestedRef.current ||
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        elapsedRef.current += 100;
        setElapsedMs(elapsedRef.current);

        if (elapsedRef.current >= durationMs) {
          clearTimers();

          if (stopRequestedRef.current) return;
          stopRequestedRef.current = true;

          void Promise.resolve(stop()).catch(error => {
            console.error('Failed to stop waveform recording:', error);

            recordingRef.current = false;
            stopRequestedRef.current = false;
            processingRef.current = false;

            if (
              mountedRef.current &&
              !leavingRef.current &&
              !quitInProgressRef.current
            ) {
              setErrorMessage(
                'We could not finish the recording. Please try again.',
              );
              setCurrentPhase('instructions');
            }
          });
        }
      }, 100);
    } catch (error) {
      console.error('Failed to start waveform recording:', error);

      recordingRef.current = false;
      stopRequestedRef.current = false;
      processingRef.current = false;

      if (
        mountedRef.current &&
        !leavingRef.current &&
        !quitInProgressRef.current
      ) {
        setErrorMessage(
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
        setCurrentPhase('instructions');
      }
    }
  }, [clearTimers, params.durationSec, setCurrentPhase]);

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
      setCurrentPhase('listening');

      await playSingleNote(
        target.frequency,
        REFERENCE_NOTE_DURATION_SECONDS,
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
    } catch (error) {
      if (
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        leavingRef.current
      ) {
        return;
      }

      console.error('Failed to play waveform reference note:', error);

      if (mountedRef.current) {
        setErrorMessage(
          'We could not play the reference note. Please try again.',
        );
        setCurrentPhase('instructions');
      }
    }
  }, [beginRecording, setCurrentPhase]);

  useEffect(() => {
    if (phase !== 'countdown') return;

    let value = COUNTDOWN_SECONDS;
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
    if (loadingParams || !targetNote) return;

    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    quitInProgressRef.current = false;
    discardNextStopRef.current = false;
    leavingRef.current = false;

    resultsRef.current = [];
    setRepetitionResults([]);
    setFinalResult(null);
    setAverageCentroidSmoothness(0);
    setAverageAmplitudeStability(0);
    setAverageCentroid(0);
    setErrorMessage(null);

    currentRepRef.current = 1;
    setCurrentRep(1);
    setCountdown(COUNTDOWN_SECONDS);
    setElapsedMs(0);
    elapsedRef.current = 0;
    setLiveFrame(null);

    recordingRef.current = false;
    stopRequestedRef.current = false;
    processingRef.current = false;

    setIsQuitting(false);
    setShowQuitModal(false);
    setCurrentPhase('countdown');
  }, [clearTimers, loadingParams, setCurrentPhase, targetNote]);

  const retryExercise = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    recordingRef.current = false;
    stopRequestedRef.current = true;
    processingRef.current = false;

    try {
      void Promise.resolve(stopRecordingRef.current?.()).catch(error => {
        console.error(
          'Failed to stop waveform recording before retry:',
          error,
        );
      });
    } catch (error) {
      console.error(
        'Failed to stop waveform recording before retry:',
        error,
      );
    }

    disposeNotePlayer();

    resultsRef.current = [];
    setRepetitionResults([]);
    setFinalResult(null);
    setAverageCentroidSmoothness(0);
    setAverageAmplitudeStability(0);
    setAverageCentroid(0);
    setErrorMessage(null);

    currentRepRef.current = 1;
    setCurrentRep(1);
    setCountdown(COUNTDOWN_SECONDS);
    setElapsedMs(0);
    elapsedRef.current = 0;
    setLiveFrame(null);

    stopRequestedRef.current = false;
    setShowQuitModal(false);
    setIsQuitting(false);
    setCurrentPhase('countdown');
  }, [clearTimers, setCurrentPhase]);

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
      recordingRef.current = false;
      stopRequestedRef.current = true;
      processingRef.current = false;

      elapsedRef.current = 0;
      setElapsedMs(0);
      setLiveFrame(null);

      try {
        void Promise.resolve(stopRecordingRef.current?.()).catch(error => {
          console.error(
            'Failed to stop waveform recording while paused:',
            error,
          );
        });
      } catch (error) {
        console.error(
          'Failed to stop waveform recording while paused:',
          error,
        );
      }
    } else if (currentPhase === 'countdown') {
      setCountdown(COUNTDOWN_SECONDS);
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
      recordingRef.current = false;
      stopRequestedRef.current = false;
      processingRef.current = false;

      setElapsedMs(0);
      elapsedRef.current = 0;
      setLiveFrame(null);
      setCountdown(COUNTDOWN_SECONDS);

      if (phaseRef.current === 'countdown') {
        setCountdownCycle(value => value + 1);
      } else {
        setCurrentPhase('countdown');
      }

      return;
    }

    if (pausedPhase === 'processing') {
      processingRef.current = false;

      if (finalResult !== null) {
        setCurrentPhase('results');
      } else {
        setCurrentPhase('countdown');
      }
    }
  }, [finalResult, setCurrentPhase]);

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
    recordingRef.current = false;
    stopRequestedRef.current = true;
    processingRef.current = false;

    disposeNotePlayer();

    try {
      await Promise.resolve(stopRecordingRef.current?.());
    } catch (error) {
      console.error(
        'Failed to stop waveform recording before leaving:',
        error,
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
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      leavingRef.current = true;
      pausedRef.current = true;
      showQuitModalRef.current = false;
      discardNextStopRef.current = true;

      clearTimers();
      recordingRef.current = false;
      stopRequestedRef.current = true;
      processingRef.current = false;

      disposeNotePlayer();

      try {
        void Promise.resolve(stopRecordingRef.current?.()).catch(error => {
          console.error(
            'Failed to stop waveform recording during cleanup:',
            error,
          );
        });
      } catch (error) {
        console.error(
          'Failed to stop waveform recording during cleanup:',
          error,
        );
      }
    };
  }, [clearTimers]);

  const quitModal = (
    <Modal
      visible={showQuitModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={continueExercise}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}>
            <Ionicons name="exit-outline" size={30} color={COLORS.brown} />
          </View>

          <Text style={styles.modalTitle}>Quit exercise?</Text>

          <Text style={styles.modalMessage}>
            {pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Waveform Smoothness?'
              : pausedPhaseRef.current === 'recording' ||
                  pausedPhaseRef.current === 'listening' ||
                  pausedPhaseRef.current === 'countdown'
                ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            disabled={isQuitting}
            onPress={continueExercise}
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
            onPress={() => {
              void quitExercise();
            }}
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
        <View style={styles.preparingScreen}>
          <View style={styles.preparingIconCircle}>
            <Ionicons name="options-outline" size={44} color={COLORS.brown} />
          </View>

          <Text style={styles.preparingTitle}>
            Preparing Your Exercise
          </Text>

          <Text style={styles.preparingSubtitle}>
            Adjusting the exercise to your current difficulty level and
            preparing your vocal range.
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
          startDisabled={loadingParams || !targetNote}
          startLabel={loadingParams ? 'Loading...' : 'Start Exercise'}
          error={errorMessage}
        />
        {quitModal}
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
          onBack={handleBack}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'listening') {
    return (
      <>
        <ExerciseListeningScreen
          icon="musical-note-outline"
          title="Waveform Smoothness"
          currentRep={currentRep}
          repetitions={params.repetitions}
          promptTitle="Listen to the Reference"
          prompt="Listen carefully to the note, then sustain the same note smoothly."
          liveContent={
            <View style={styles.referenceCard}>
              <Text style={styles.referenceLabel}>SING THIS NOTE</Text>

              <Text style={styles.referenceNote}>
                {currentTarget?.name ?? '--'}
              </Text>

              <Text style={styles.referenceFrequency}>
                {currentTarget
                  ? `${formatNumber(currentTarget.frequency, 1)} Hz`
                  : '--'}
              </Text>
            </View>
          }
          onBack={handleBack}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'recording') {
    const elapsedSeconds = elapsedMs / 1000;

    const detectedNote =
      liveFrame &&
      Number.isFinite(liveFrame.pitch) &&
      liveFrame.pitch > 0
        ? frequencyToNoteName(liveFrame.pitch)
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
          liveFrame={liveFrame}
          onBack={handleBack}
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
          onBack={handleBack}
        />
        {quitModal}
      </>
    );
  }

  const score = finalResult?.score ?? 0;
  const passed = finalResult?.passed ?? false;

  return (
    <>
      <ExerciseResultsScreen
        title="Exercise Complete"
        subtitle="Waveform Smoothness"
        score={score}
        resultIcon={passed ? 'checkmark' : 'refresh-outline'}
        scoreMessage={
          passed
            ? 'Excellent work! Your tone remained smooth and your vocal output stayed consistent across the repetitions.'
            : 'Keep practicing. Focus on maintaining an even tone and steady vocal output throughout each sustained note.'
        }
        scoreDetails={
          <View style={styles.scoreDetails}>
            <View style={styles.scoreMetric}>
              <Text style={styles.scoreMetricLabel}>
                Spectral Smoothness
              </Text>
              <Text style={styles.scoreMetricValue}>
                {formatNumber(averageCentroidSmoothness)}%
              </Text>
            </View>

            <View style={styles.scoreMetric}>
              <Text style={styles.scoreMetricLabel}>
                Amplitude Stability
              </Text>
              <Text style={styles.scoreMetricValue}>
                {formatNumber(averageAmplitudeStability)}%
              </Text>
            </View>

            <View style={styles.scoreMetric}>
              <Text style={styles.scoreMetricLabel}>
                Average Centroid
              </Text>
              <Text style={styles.scoreMetricValue}>
                {formatNumber(averageCentroid)} Hz
              </Text>
            </View>
          </View>
        }
        onRetry={retryExercise}
        onExit={handleBack}
      >
        <View style={styles.resultsSection}>
          <Text style={styles.resultsSectionTitle}>
            Repetition Results
          </Text>

          {repetitionResults.map((item, index) => (
            <View
              key={`${item.targetNote}-${index}`}
              style={styles.repetitionCard}
            >
              <View style={styles.repetitionHeader}>
                <Text style={styles.repetitionTitle}>
                  Repetition {index + 1}
                </Text>
                <Text style={styles.repetitionScore}>
                  {item.score.score}%
                </Text>
              </View>

              <View style={styles.repetitionNoteRow}>
                <Ionicons
                  name="musical-note-outline"
                  size={18}
                  color={COLORS.brown}
                />
                <Text style={styles.repetitionNote}>
                  {item.targetNote}
                </Text>
              </View>

              <View style={styles.repetitionMetrics}>
                <Text style={styles.repetitionMetric}>
                  Smoothness:{' '}
                  {formatNumber(
                    item.measurement.centroidSmoothnessPct,
                  )}
                  %
                </Text>
                <Text style={styles.repetitionMetric}>
                  Stability:{' '}
                  {formatNumber(
                    item.measurement.amplitudeStabilityPct,
                  )}
                  %
                </Text>
              </View>
            </View>
          ))}
        </View>
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
  referenceCard: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  referenceLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    letterSpacing: 1,
    color: COLORS.muted,
    marginBottom: 6,
  },
  referenceNote: {
    fontFamily: 'FredokaBold',
    fontSize: 38,
    color: COLORS.brown,
  },
  referenceFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 2,
  },

  recordingScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    paddingHorizontal: 22,
    paddingTop: 150,
    paddingBottom: 20,
  },
  recordingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 52,
    paddingBottom: 18,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: 12,
  },
  headerEyebrow: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.muted,
  },
  headerTitle: {
    marginTop: 2,
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: COLORS.brown,
  },
  headerIconCircle: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: COLORS.pink,
    marginLeft: 8,
  },
  recordingBody: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 25,
  },
  repPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.pink,
  },
  repPillText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.6,
    color: COLORS.brown,
  },
  recordingTitle: {
    marginTop: 18,
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: COLORS.brown,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  recordingSubtitle: {
    width: '100%',
    maxWidth: 320,
    marginTop: 6,
    paddingHorizontal: 8,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.muted,
    textAlign: 'center',
    alignSelf: 'center',
  },
  recordingProgressSection: {
    width: '100%',
    marginTop: 26,
    marginBottom: 20,
  },
  recordingProgressLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  progressLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: COLORS.muted,
  },
  progressTime: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: COLORS.brown,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: COLORS.background,
  },
  progressFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: COLORS.pink,
  },
  remainingText: {
    marginTop: 7,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    textAlign: 'right',
  },
  liveCard: {
    marginTop: 20,
    width: '110%',
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 22,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  liveCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  liveMicCircle: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: COLORS.lightGreen,
  },
  liveCardHeading: {
    flex: 1,
    marginLeft: 10,
  },
  liveCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  liveCardSubtitle: {
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
  },
  liveIndicatorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: COLORS.background,
  },
  recordingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.guideRed,
  },
  liveIndicatorText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.7,
    color: COLORS.guideRed,
  },
  waveformContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 5,
    paddingBottom: 15,
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  waveformBars: {
    width: '100%',
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  waveformBar: {
    flex: 1,
    maxWidth: 6,
    minWidth: 2,
    borderRadius: 4,
  },
  waveformStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  waveformStatus: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    textAlign: 'center',
  },
  liveMetricsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveMetric: {
    flex: 1,
    alignItems: 'center',
  },
  liveDivider: {
    width: 1,
    height: 52,
    backgroundColor: COLORS.border,
  },
  liveLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: COLORS.muted,
    marginBottom: 5,
    textAlign: 'center',
  },
  liveValue: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: COLORS.brown,
  },
  metricHint: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
  },
  recordingTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 5,
  },
  recordingTipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.muted,
  },

  scoreDetails: {
    width: '100%',
    marginTop: 18,
    gap: 10,
  },
  scoreMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: COLORS.background,
  },
  scoreMetricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
  },
  scoreMetricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  resultsSection: {
    marginTop: 18,
  },
  resultsSectionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: COLORS.brown,
    marginBottom: 10,
  },
  repetitionCard: {
    padding: 14,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  repetitionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  repetitionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  repetitionScore: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: COLORS.brown,
  },
  repetitionNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },
  repetitionNote: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: COLORS.brown,
  },
  repetitionMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  repetitionMetric: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
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
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});