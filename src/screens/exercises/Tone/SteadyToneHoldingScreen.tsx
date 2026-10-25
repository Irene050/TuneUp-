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
  Alert,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  STEADY_TONE_HOLDING_PARAMS,
  type SteadyToneHoldingParams,
  type Tier,
} from '@/constants/tone';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateSteadyToneHoldingParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import {
  measureSteadyToneHolding,
  type SteadyToneHoldingMeasurement,
} from '@/services/measurement/tone/steadyToneHolding';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
  scoreSteadyToneHolding,
  type SteadyToneHoldingScoreResult,
} from '@/services/scoring/tone/steadyToneHolding';
import { samplesToFFTFrames } from '@/utils/dsp/fft';
import { frequencyToNoteName } from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const BORDER = '#F2DDE5';
const GUIDE_GREEN = '#4F9B67';
const GUIDE_RED = '#D64F5A';

const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;
const COUNTDOWN_SECONDS = 3;
const WAVEFORM_BAR_COUNT = 30;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

interface ProcessingResult {
  measurement: SteadyToneHoldingMeasurement;
  result: SteadyToneHoldingScoreResult;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(
  value: number,
  decimals = 1,
): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

function LiveWaveform({
  frame,
}: {
  frame: LiveAudioFrame | null;
}) {
  const pitch = frame?.pitch ?? 0;
  const volume = frame?.volume ?? -60;
  const hasPitch = Number.isFinite(pitch) && pitch > 0;
  const waveformColor = hasPitch ? GUIDE_GREEN : GUIDE_RED;
  const volumeLevel = Number.isFinite(volume)
    ? clamp((volume + 60) / 60, 0, 1)
    : 0;

  const bars = useMemo(
    () =>
      Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
        const center = (WAVEFORM_BAR_COUNT - 1) / 2;
        const distance = Math.abs(index - center) / center;
        const envelope = 1 - distance * 0.65;

        const variation = hasPitch
          ? 0.35 +
            Math.abs(Math.sin(index * 0.72 + pitch * 0.001)) *
              (0.35 + volumeLevel * 0.3)
          : 0.12 + Math.abs(Math.sin(index * 0.72)) * 0.12;

        return Math.max(
          5,
          Math.round(38 * envelope * variation),
        );
      }),
    [hasPitch, pitch, volumeLevel],
  );

  return (
    <View style={styles.waveformContainer}>
      <View
        style={styles.waveformBars}
        accessibilityLabel={
          hasPitch ? 'Voice detected in waveform' : 'Waiting for voice'
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
          {hasPitch
            ? 'Voice detected — keep your tone steady'
            : 'Listening for your voice...'}
        </Text>
      </View>
    </View>
  );
}

function RecordingScreen({
  elapsedSeconds,
  durationSeconds,
  liveFrame,
  isRecording,
  onBack,
}: {
  elapsedSeconds: number;
  durationSeconds: number;
  liveFrame: LiveAudioFrame | null;
  isRecording: boolean;
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

  const pitch =
    liveFrame?.pitch !== undefined &&
    Number.isFinite(liveFrame.pitch) &&
    liveFrame.pitch > 0
      ? liveFrame.pitch
      : null;

  const clarity =
    liveFrame?.clarity !== undefined &&
    Number.isFinite(liveFrame.clarity)
      ? clamp(liveFrame.clarity, 0, 1) * 100
      : null;

  const detectedNote =
    pitch !== null ? frequencyToNoteName(pitch) : '--';

  return (
    <View style={styles.recordingScreen}>

      <Text style={styles.recordingTitle}>Hold Your Tone</Text>

      <Text style={styles.recordingSubtitle}>
        Sustain one comfortable note. Keep your tone smooth, your
        loudness steady, and your pitch as stable as possible.
      </Text>

      <View style={styles.recordingBody}>
        <View style={styles.repPill}>
          <Ionicons
            name="repeat-outline"
            size={16}
            color={BROWN}
          />
          <Text style={styles.repPillText}>
            STEADY TONE · SINGLE ATTEMPT
          </Text>
        </View>

        <View style={styles.recordingProgressSection}>
          <View style={styles.recordingProgressLabels}>
            <Text style={styles.progressLabel}>RECORDING</Text>
            <Text style={styles.progressTime}>
              {formatNumber(elapsedSeconds)}s / {durationSeconds}s
            </Text>
          </View>

          <View
            style={styles.progressTrack}
            accessibilityRole="progressbar"
            accessibilityLabel="Recording progress"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: Math.round(progress * 100),
            }}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>

          <Text style={styles.remainingText}>
            {Math.ceil(remainingSeconds)} seconds remaining
          </Text>
        </View>

        <View style={styles.liveCard}>
          <View style={styles.liveCardHeader}>
            <View style={styles.liveMicCircle}>
              <Ionicons
                name="mic"
                size={21}
                color={GUIDE_GREEN}
              />
            </View>

            <View style={styles.liveCardHeading}>
              <Text style={styles.liveCardTitle}>
                Live Voice Monitor
              </Text>
              <Text style={styles.liveCardSubtitle}>
                Real-time microphone feedback
              </Text>
            </View>

            <View style={styles.liveIndicatorPill}>
              <View
                style={[
                  styles.recordingDot,
                  !isRecording && styles.recordingDotInactive,
                ]}
              />
              <Text
                style={[
                  styles.liveIndicatorText,
                  !isRecording && styles.liveIndicatorTextInactive,
                ]}
              >
                {isRecording ? 'LIVE' : 'STARTING'}
              </Text>
            </View>
          </View>

          <LiveWaveform frame={liveFrame} />

          <View style={styles.liveMetricsRow}>
            <View style={styles.liveMetric}>
              <Text style={styles.liveLabel}>DETECTED NOTE</Text>
              <Text style={styles.liveValue} numberOfLines={1}>
                {detectedNote}
              </Text>
              <Text style={styles.metricHint}>
                {pitch !== null
                  ? `${formatNumber(pitch)} Hz`
                  : 'Waiting for pitch'}
              </Text>
            </View>

            <View style={styles.liveDivider} />

            <View style={styles.liveMetric}>
              <Text style={styles.liveLabel}>VOICE CLARITY</Text>
              <Text style={styles.liveValue}>
                {clarity !== null
                  ? `${Math.round(clarity)}%`
                  : '--'}
              </Text>
              <Text style={styles.metricHint}>
                {clarity !== null
                  ? 'Live clarity estimate'
                  : 'Waiting for voice'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.recordingTip}>
          <Ionicons
            name="information-circle-outline"
            size={19}
            color={MUTED}
          />
          <Text style={styles.recordingTipText}>
            Keep your volume and pitch steady until the timer finishes.
            Relax your throat and breathe naturally instead of forcing
            your voice to stay perfectly still.
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function SteadyToneHoldingScreen({
  tier,
}: Props) {
  const fallbackTier: Tier = tier ?? 'beginner';

  const [currentTier, setCurrentTier] =
    useState<Tier>(fallbackTier);
  const [params, setParams] =
    useState<SteadyToneHoldingParams>(
      STEADY_TONE_HOLDING_PARAMS[fallbackTier],
    );
  const [loadingParams, setLoadingParams] = useState(true);
  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);
  const [result, setResult] =
    useState<SteadyToneHoldingScoreResult | null>(null);
  const [measurement, setMeasurement] =
    useState<SteadyToneHoldingMeasurement | null>(null);
  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const mountedRef = useRef(true);
  const phaseRef = useRef<Phase>('instructions');
  const paramsRef = useRef(params);
  const tierRef = useRef(currentTier);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const processingRef = useRef(false);
  const savedRef = useRef(false);
  const elapsedRef = useRef(0);

  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');

  const processingResultRef = useRef<ProcessingResult | null>(null);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef =
    useRef<(() => void | Promise<void>) | null>(null);
  const beginRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const startCountdownRef =
    useRef<(() => void) | null>(null);

  const setCurrentPhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;

    if (mountedRef.current) {
      setPhase(nextPhase);
    }
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
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    tierRef.current = currentTier;
  }, [currentTier]);

  useEffect(() => {
    let cancelled = false;

    const loadParams = async () => {
      try {
        setLoadingParams(true);

        const user = auth.currentUser;

        if (!user) {
          if (!cancelled) {
            const defaults = STEADY_TONE_HOLDING_PARAMS[fallbackTier];

            paramsRef.current = defaults;
            tierRef.current = fallbackTier;
            setCurrentTier(fallbackTier);
            setParams(defaults);
          }
          return;
        }

        const componentProgress = await fetchComponentProgress(
          user.uid,
          'tone',
        );

        const resolvedTier: Tier =
          tier ?? componentProgress?.currentTier ?? 'beginner';

        const records = await fetchExerciseRecords(
          user.uid,
          'tone',
        );

        const matchingRecords = records
          .filter(
            record =>
              record.tier === resolvedTier &&
              record.templateId === 'steadyToneHolding',
          )
          .sort((a, b) => a.timestamp - b.timestamp);

        let recentScores = matchingRecords
          .slice(-5)
          .map(record => Number(record.scorePct))
          .filter(Number.isFinite);

        if (recentScores.length === 0) {
          const latestAssessment = await getLatestAssessment();

          const toneScore = latestAssessment?.scores.find(
            score => score.componentId === 'tone',
          )?.scorePct;

          if (
            toneScore !== undefined &&
            Number.isFinite(toneScore)
          ) {
            recentScores = [Number(toneScore)];
          }
        }

        const generatedParams = generateSteadyToneHoldingParams({
          tier: resolvedTier,
          recentScores,
        });

        if (cancelled) return;

        paramsRef.current = generatedParams;
        tierRef.current = resolvedTier;
        setCurrentTier(resolvedTier);
        setParams(generatedParams);
      } catch (error) {
        console.error(
          'Failed to load steady tone holding parameters:',
          error,
        );

        if (!cancelled) {
          const defaults = STEADY_TONE_HOLDING_PARAMS[fallbackTier];

          paramsRef.current = defaults;
          tierRef.current = fallbackTier;
          setCurrentTier(fallbackTier);
          setParams(defaults);
        }
      } finally {
        if (!cancelled) {
          setLoadingParams(false);
        }
      }
    };

    void loadParams();

    return () => {
      cancelled = true;
    };
  }, [tier, fallbackTier]);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      discardNextStopRef.current ||
      quitInProgressRef.current ||
      phaseRef.current !== 'recording'
    ) {
      return;
    }

    setLiveFrame(frame);
  }, []);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: async (samples: Float32Array, sampleRate: number) => {
      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        recordingRef.current = false;
        stopRequestedRef.current = false;
        processingRef.current = false;
        return;
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        processingRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      recordingRef.current = false;
      processingRef.current = true;
      clearTimers();
      setCurrentPhase('processing');

      try {
        if (samples.length === 0) {
          throw new Error('No audio samples were recorded.');
        }

        if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
          throw new Error('Invalid audio sample rate.');
        }

        const fftFrames = samplesToFFTFrames(
          samples,
          FFT_SIZE,
          FFT_HOP_SIZE,
        );

        if (fftFrames.length === 0) {
          throw new Error('No FFT frames could be generated.');
        }

        const measured = measureSteadyToneHolding(
          samples,
          fftFrames,
          sampleRate,
          FFT_SIZE,
        );

        const scored = scoreSteadyToneHolding(
          measured,
          paramsRef.current,
        );

        if (!Number.isFinite(scored.score)) {
          throw new Error('The tone score could not be calculated.');
        }

        const processed: ProcessingResult = {
          measurement: measured,
          result: scored,
        };

        processingResultRef.current = processed;

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current
        ) {
          return;
        }

        setMeasurement(measured);
        setResult(scored);

        if (!savedRef.current) {
          savedRef.current = true;

          await saveCompletedExercise(
            'tone',
            'steadyToneHolding',
            tierRef.current,
            scored.score,
          );
        }

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current
        ) {
          return;
        }

        setCurrentPhase('results');
      } catch (error) {
        console.error('Steady tone holding processing error:', error);

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !quitInProgressRef.current
        ) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          setCurrentPhase('instructions');
        }
      } finally {
        processingRef.current = false;
        stopRequestedRef.current = false;
      }
    },
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;

    return () => {
      startRecordingRef.current = null;
      stopRecordingRef.current = null;
    };
  }, [startRecording, stopRecording]);

  const beginRecording = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      recordingRef.current ||
      processingRef.current ||
      loadingParams
    ) {
      return;
    }

    const start = startRecordingRef.current;
    const stop = stopRecordingRef.current;

    if (!start || !stop) {
      setErrorMessage(
        'The audio recorder is not ready. Please try again.',
      );
      setCurrentPhase('instructions');
      return;
    }

    try {
      setErrorMessage(null);
      setLiveFrame(null);
      setMeasurement(null);
      setResult(null);
      processingResultRef.current = null;

      elapsedRef.current = 0;
      setElapsedMs(0);
      stopRequestedRef.current = false;
      discardNextStopRef.current = false;
      processingRef.current = false;

      setCurrentPhase('recording');
      await start();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        discardNextStopRef.current = true;
        recordingRef.current = false;
        void Promise.resolve(stop()).catch(error => {
          console.warn('Unable to stop interrupted recording:', error);
        });
        return;
      }

      recordingRef.current = true;

      const durationMs = paramsRef.current.durationSec * 1000;

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
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
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }

          if (stopRequestedRef.current) return;

          stopRequestedRef.current = true;

          void Promise.resolve(stop()).catch(error => {
            console.error('Failed to stop steady tone recording:', error);

            recordingRef.current = false;
            stopRequestedRef.current = false;

            if (
              mountedRef.current &&
              !pausedRef.current &&
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
      console.error('Failed to start steady tone recording:', error);

      recordingRef.current = false;
      stopRequestedRef.current = false;

      if (
        mountedRef.current &&
        !pausedRef.current &&
        !quitInProgressRef.current
      ) {
        setCurrentPhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    }
  }, [loadingParams, setCurrentPhase]);

  useEffect(() => {
    beginRecordingRef.current = beginRecording;

    return () => {
      beginRecordingRef.current = null;
    };
  }, [beginRecording]);

  const startCountdown = useCallback(() => {
    if (
      recordingRef.current ||
      processingRef.current ||
      pausedRef.current ||
      quitInProgressRef.current ||
      loadingParams
    ) {
      return;
    }

    clearTimers();

    setErrorMessage(null);
    setLiveFrame(null);
    setMeasurement(null);
    setResult(null);
    processingResultRef.current = null;

    elapsedRef.current = 0;
    setElapsedMs(0);
    recordingRef.current = false;
    stopRequestedRef.current = false;
    processingRef.current = false;
    discardNextStopRef.current = false;
    savedRef.current = false;

    setCountdown(COUNTDOWN_SECONDS);
    setCurrentPhase('countdown');

    let value = COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
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

        void beginRecordingRef.current?.();
        return;
      }

      setCountdown(value);
    }, 1000);
  }, [clearTimers, loadingParams, setCurrentPhase]);

  useEffect(() => {
    startCountdownRef.current = startCountdown;

    return () => {
      startCountdownRef.current = null;
    };
  }, [startCountdown]);

  const pauseForExitPrompt = useCallback(() => {
    if (
      !mountedRef.current ||
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    const activePhase = phaseRef.current;

    pausedPhaseRef.current = activePhase;
    pausedRef.current = true;
    showQuitModalRef.current = true;

    clearTimers();

    if (activePhase === 'recording' || recordingRef.current) {
      discardNextStopRef.current = true;
      stopRequestedRef.current = true;
      recordingRef.current = false;
      processingRef.current = false;

      const stop = stopRecordingRef.current;

      if (stop) {
        void Promise.resolve(stop()).catch(error => {
          console.warn(
            'Unable to stop interrupted steady-tone recording:',
            error,
          );
        });
      }

      elapsedRef.current = 0;
      setElapsedMs(0);
      setLiveFrame(null);
    }

    if (activePhase === 'countdown') {
      setCountdown(COUNTDOWN_SECONDS);
    }

    setShowQuitModal(true);
  }, [clearTimers]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    const previousPhase = pausedPhaseRef.current;

    pausedRef.current = false;
    showQuitModalRef.current = false;
    setShowQuitModal(false);

    if (
      previousPhase === 'recording' ||
      previousPhase === 'countdown'
    ) {
      recordingRef.current = false;
      processingRef.current = false;
      stopRequestedRef.current = false;
      discardNextStopRef.current = false;

      elapsedRef.current = 0;
      setElapsedMs(0);
      setLiveFrame(null);

      startCountdownRef.current?.();
      return;
    }

    if (previousPhase === 'processing') {
      const cached = processingResultRef.current;

      if (cached && savedRef.current) {
        setMeasurement(cached.measurement);
        setResult(cached.result);
        setCurrentPhase('results');
      } else {
        setCurrentPhase('processing');
      }

      return;
    }

    setCurrentPhase(previousPhase);
  }, [setCurrentPhase]);

  const quitExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();

    const stop = stopRecordingRef.current;

    if (recordingRef.current || isRecording) {
      stopRequestedRef.current = true;
      recordingRef.current = false;

      if (stop) {
        void Promise.resolve(stop()).catch(error => {
          console.warn(
            'Unable to stop steady-tone recording while quitting:',
            error,
          );
        });
      }
    }

    router.replace('/dashboard?tab=exercises');
  }, [clearTimers, isRecording]);

  const retry = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    quitInProgressRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    if (recordingRef.current || isRecording) {
      const stop = stopRecordingRef.current;

      if (stop) {
        void Promise.resolve(stop()).catch(error => {
          console.warn('Unable to stop recording before retry:', error);
        });
      }
    }

    recordingRef.current = false;
    stopRequestedRef.current = false;
    processingRef.current = false;
    savedRef.current = false;
    processingResultRef.current = null;

    setIsQuitting(false);
    setShowQuitModal(false);
    setCountdown(COUNTDOWN_SECONDS);
    setElapsedMs(0);
    elapsedRef.current = 0;
    setLiveFrame(null);
    setMeasurement(null);
    setResult(null);
    setErrorMessage(null);
    setCurrentPhase('instructions');
  }, [clearTimers, isRecording, setCurrentPhase]);

  const goBack = useCallback(() => {
    pauseForExitPrompt();
  }, [pauseForExitPrompt]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (quitInProgressRef.current || showQuitModalRef.current) {
          return true;
        }

        pauseForExitPrompt();
        return true;
      },
    );

    return () => subscription.remove();
  }, [pauseForExitPrompt]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      showQuitModalRef.current = false;
      discardNextStopRef.current = true;

      clearTimers();

      if (recordingRef.current) {
        const stop = stopRecordingRef.current;

        if (stop) {
          void Promise.resolve(stop()).catch(() => undefined);
        }
      }

      recordingRef.current = false;
      stopRequestedRef.current = false;
    };
  }, [clearTimers]);

  const elapsedSeconds = elapsedMs / 1000;

  const quitMessage =
    pausedPhaseRef.current === 'recording'
      ? 'Your exercise is paused. Your current recording will be discarded, and you will restart this attempt if you continue.'
      : pausedPhaseRef.current === 'processing'
        ? 'Your exercise is paused while we analyze your performance. Continue to return to your results when processing is complete.'
        : pausedPhaseRef.current === 'results'
          ? 'Are you sure you want to leave this exercise? Your completed result has already been saved.'
          : 'Are you sure you want to leave Steady Tone Holding? Your progress is saved after a completed recording is analyzed.';

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
            <Ionicons
              name="exit-outline"
              size={30}
              color={BROWN}
            />
          </View>

          <Text style={styles.modalTitle}>Leave Exercise?</Text>

          <Text style={styles.modalMessage}>{quitMessage}</Text>

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
            onPress={quitExercise}
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
          >
            {isQuitting ? (
              <ActivityIndicator color={BROWN} />
            ) : (
              <Text style={styles.quitButtonText}>
                Quit Exercise
              </Text>
            )}
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
            Adjusting the exercise to your current difficulty level
            and preparing your recording.
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

  if (phase === 'instructions') {
    return (
      <>
        <ExerciseScreen
          title="Steady Tone Holding"
          category="Tone"
          icon="pulse-outline"
          instructions="Sustain one comfortable note for the full exercise duration. Keep your tone quality smooth, your loudness steady, and your pitch as stable as possible."
          preparationSteps={[
            {
              icon: 'volume-mute-outline',
              text: 'Find a quiet area with minimal background noise.',
            },
            {
              icon: 'body-outline',
              text: 'Sit upright or stand with relaxed shoulders and comfortable posture.',
            },
            {
              icon: 'mic-outline',
              text: 'Keep your voice directed toward the microphone.',
            },
          ]}
          summary={[
            {
              label: 'DURATION',
              value: `${params.durationSec}s`,
              hint: 'sustained tone',
            },
            {
              label: 'REPETITIONS',
              value: '1',
              hint: 'attempt',
            },
            {
              label: 'QUALITY',
              value: `${params.qualityThreshold}%`,
              hint: 'required',
            },
          ]}
          tip="Focus on keeping your voice relaxed and balanced instead of trying to make it artificially still."
          tier={currentTier}
          onBack={goBack}
          onStart={startCountdown}
          error={errorMessage}
          startDisabled={loadingParams}
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
          title="Steady Tone Holding"
          countdown={countdown}
          promptTitle="Get Ready"
          prompt="Prepare to sustain one comfortable note."
          onBack={goBack}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        <RecordingScreen
          elapsedSeconds={elapsedSeconds}
          durationSeconds={params.durationSec}
          liveFrame={liveFrame}
          isRecording={isRecording}
          onBack={goBack}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'processing') {
    return (
      <>
        <ExerciseProcessingScreen
          icon="pulse-outline"
          title="Analyzing Your Tone"
          message="Measuring tone smoothness, loudness stability, pitch stability, and duration."
          onBack={goBack}
        />
        {quitModal}
      </>
    );
  }

  if (phase === 'results' && result && measurement) {
    return (
      <>
        <ExerciseResultsScreen
          title={result.passed ? 'Great Tone Control!' : 'Keep Practicing'}
          subtitle="Your steady-tone performance"
          score={result.score}
          resultIcon={
            result.passed
              ? 'checkmark-circle-outline'
              : 'refresh-outline'
          }
          scoreMessage={
            result.passed
              ? 'You kept the tone stable throughout the exercise.'
              : 'Work on keeping your tone, loudness, and pitch more consistent.'
          }
          onRetry={retry}
          onExit={goBack}
          onBack={goBack}
        >
          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>
              Your Performance
            </Text>

            <View style={styles.resultRow}>
              <Text style={styles.resultRowLabel}>
                Tone smoothness
              </Text>
              <Text style={styles.resultRowValue}>
                {formatNumber(measurement.smoothnessPct, 0)}%
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultRowLabel}>
                Loudness stability
              </Text>
              <Text style={styles.resultRowValue}>
                {formatNumber(measurement.amplitudeStabilityPct, 0)}%
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultRowLabel}>
                Pitch stability
              </Text>
              <Text style={styles.resultRowValue}>
                {formatNumber(measurement.pitchStabilityPct, 0)}%
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultRowLabel}>Duration</Text>
              <Text style={styles.resultRowValue}>
                {formatNumber(measurement.durationSec)}s
              </Text>
            </View>
          </View>

          <View style={styles.resultTip}>
            <Text style={styles.resultTipText}>
              {result.passed
                ? 'Nice work! Keep practicing relaxed, balanced sustained notes to maintain consistent tone quality.'
                : 'Try using steady breath support and a relaxed throat. Focus on keeping the same vocal quality, loudness, and pitch.'}
            </Text>
          </View>
        </ExerciseResultsScreen>
        {quitModal}
      </>
    );
  }

  return quitModal;
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
  recordingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    paddingHorizontal: 22,
    paddingTop: 60,
    paddingBottom: 20,
  },
  recordingTitle: {
    marginTop: 42,
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  recordingSubtitle: {
    width: '100%',
    maxWidth: 320,
    marginTop: 6,
    paddingHorizontal: 8,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
    textAlign: 'center',
    alignSelf: 'center',
  },
  recordingBody: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 22,
  },
  repPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: PINK,
  },
  repPillText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.5,
    color: BROWN,
  },
  recordingProgressSection: {
    width: '100%',
    marginTop: 24,
    marginBottom: 18,
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
    color: MUTED,
  },
  progressTime: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: LIGHT_PINK,
  },
  progressFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: PINK,
  },
  remainingText: {
    marginTop: 7,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'right',
  },

  liveCard: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 22,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
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
    backgroundColor: '#E5F2E8',
  },
  liveCardHeading: {
    flex: 1,
    marginLeft: 10,
  },
  liveCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
  liveCardSubtitle: {
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  liveIndicatorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#FCE9EC',
  },
  recordingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: GUIDE_RED,
  },
  recordingDotInactive: {
    backgroundColor: '#D7B6C0',
  },
  liveIndicatorText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.7,
    color: GUIDE_RED,
  },
  liveIndicatorTextInactive: {
    color: MUTED,
  },
  waveformContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 5,
    paddingBottom: 15,
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
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
    flexShrink: 1,
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
    paddingHorizontal: 4,
  },
  liveDivider: {
    width: 1,
    height: 52,
    backgroundColor: BORDER,
  },
  liveLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color: MUTED,
    marginBottom: 5,
    textAlign: 'center',
  },
  liveValue: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
  },
  metricHint: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    textAlign: 'center',
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
    color: MUTED,
  },

  resultCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
  },
  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 10,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  resultRowLabel: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    marginLeft: 12,
  },
  resultTip: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },
  resultTipText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
  },

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
    backgroundColor: LIGHT_PINK,
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