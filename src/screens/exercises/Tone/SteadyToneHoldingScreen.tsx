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
} from '@/constants/exercises/tone';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
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
import { frequencyToNote } from '@/utils/dsp/pitch';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const BORDER = '#F2DDE5';

const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;
const COUNTDOWN_SECONDS = 3;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

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
  return Number.isFinite(value)
    ? value.toFixed(decimals)
    : '--';
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
  const processingTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const recordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const processingRef = useRef(false);
  const finishingRef = useRef(false);
  const savedRef = useRef(false);
  const elapsedRef = useRef(0);

  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');
  const processingResultRef = useRef<{
    measurement: SteadyToneHoldingMeasurement;
    result: SteadyToneHoldingScoreResult;
  } | null>(null);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const beginRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const startCountdownRef =
    useRef<(() => void) | null>(null);
  const finishProcessingRef =
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

    if (processingTimerRef.current) {
      clearTimeout(processingTimerRef.current);
      processingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    tierRef.current = currentTier;
  }, [currentTier]);

  // Load adaptive difficulty parameters.
  useEffect(() => {
    let cancelled = false;

    const loadParams = async () => {
      try {
        setLoadingParams(true);

        const user = auth.currentUser;

        if (!user) {
          if (!cancelled) {
            setCurrentTier(fallbackTier);
            setParams(STEADY_TONE_HOLDING_PARAMS[fallbackTier]);
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
          .map(record => record.scorePct);

        // Assessment is used only as the initial reference.
        if (recentScores.length === 0) {
          const latestAssessment = await getLatestAssessment();

          const toneScore = latestAssessment?.scores.find(
            score => score.componentId === 'tone',
          )?.scorePct;

          if (
            toneScore !== undefined &&
            Number.isFinite(toneScore)
          ) {
            recentScores = [toneScore];
          }
        }

        const generatedParams = generateSteadyToneHoldingParams({
          tier: resolvedTier,
          recentScores,
        });

        if (!cancelled) {
          paramsRef.current = generatedParams;
          tierRef.current = resolvedTier;
          setCurrentTier(resolvedTier);
          setParams(generatedParams);
        }
      } catch (error) {
        console.error(
          '❌ FAILED TO LOAD STEADY TONE HOLDING PARAMETERS:',
          error,
        );

        if (!cancelled) {
          paramsRef.current =
            STEADY_TONE_HOLDING_PARAMS[fallbackTier];
          tierRef.current = fallbackTier;
          setCurrentTier(fallbackTier);
          setParams(STEADY_TONE_HOLDING_PARAMS[fallbackTier]);
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

  const handleLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        discardNextStopRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      setLiveFrame(frame);
    },
    [],
  );

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: async (
      samples: Float32Array,
      sampleRate: number,
    ) => {
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
          throw new Error(
            'The tone score could not be calculated.',
          );
        }

        if (
          !mountedRef.current ||
          pausedRef.current ||
          quitInProgressRef.current
        ) {
          processingResultRef.current = {
            measurement: measured,
            result: scored,
          };
          return;
        }

        processingResultRef.current = {
          measurement: measured,
          result: scored,
        };

        setMeasurement(measured);
        setResult(scored);

        // Save once. Resume never reruns the analysis or save.
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
          quitInProgressRef.current
        ) {
          return;
        }

        setCurrentPhase('results');
      } catch (error) {
        console.error(
          '❌ STEADY TONE HOLDING PROCESSING ERROR:',
          error,
        );

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
      quitInProgressRef.current ||
      recordingRef.current ||
      processingRef.current ||
      loadingParams
    ) {
      return;
    }

    try {
      setErrorMessage(null);
      setLiveFrame(null);
      setMeasurement(null);
      setResult(null);

      elapsedRef.current = 0;
      setElapsedMs(0);
      stopRequestedRef.current = false;
      discardNextStopRef.current = false;
      processingRef.current = false;

      setCurrentPhase('recording');

      await startRecordingRef.current?.();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        discardNextStopRef.current = true;
        recordingRef.current = false;
        void stopRecordingRef.current?.();
        return;
      }

      recordingRef.current = true;

      const durationMs =
        paramsRef.current.durationSec * 1000;

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          quitInProgressRef.current ||
          !recordingRef.current ||
          stopRequestedRef.current
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

          if (stopRequestedRef.current) {
            return;
          }

          stopRequestedRef.current = true;

          void stopRecordingRef.current?.().catch(error => {
            console.error(
              '❌ FAILED TO STOP STEADY TONE RECORDING:',
              error,
            );

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
      console.error(
        '❌ FAILED TO START STEADY TONE RECORDING:',
        error,
      );

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

    setCountdown(COUNTDOWN_SECONDS);
    setCurrentPhase('countdown');

    let value = COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
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
    if (quitInProgressRef.current || showQuitModalRef.current) {
      return;
    }

    const activePhase = phaseRef.current;

    pausedPhaseRef.current = activePhase;
    pausedRef.current = true;
    showQuitModalRef.current = true;

    clearTimers();

    if (activePhase === 'recording' || recordingRef.current) {
      // Ignore the recorder callback generated by stopping this
      // interrupted attempt. The user will restart this attempt.
      discardNextStopRef.current = true;
      stopRequestedRef.current = true;
      recordingRef.current = false;
      processingRef.current = false;

      void stopRecordingRef.current?.().catch(error => {
        console.warn(
          'Unable to stop interrupted steady-tone recording:',
          error,
        );
      });

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
    if (quitInProgressRef.current) {
      return;
    }

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

      if (cached) {
        setMeasurement(cached.measurement);
        setResult(cached.result);

        // If saving was already completed, show results without
        // re-running the analysis or saving another record.
        if (savedRef.current) {
          setCurrentPhase('results');
        } else {
          setCurrentPhase('processing');
        }
      } else {
        setCurrentPhase('processing');
      }

      return;
    }

    setCurrentPhase(previousPhase);
  }, [setCurrentPhase]);

  const quitExercise = useCallback(() => {
    if (quitInProgressRef.current) {
      return;
    }

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();

    if (recordingRef.current || isRecording) {
      discardNextStopRef.current = true;
      stopRequestedRef.current = true;
      recordingRef.current = false;

      void stopRecordingRef.current?.().catch(error => {
        console.warn(
          'Unable to stop steady-tone recording while quitting:',
          error,
        );
      });
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
      void stopRecordingRef.current?.().catch(error => {
        console.warn('Unable to stop recording before retry:', error);
      });
    }

    recordingRef.current = false;
    stopRequestedRef.current = false;
    processingRef.current = false;
    finishingRef.current = false;
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

  // Intercept Android hardware back while this exercise is mounted.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (quitInProgressRef.current) {
          return true;
        }

        if (showQuitModalRef.current) {
          return true;
        }

        pauseForExitPrompt();
        return true;
      },
    );

    return () => subscription.remove();
  }, [pauseForExitPrompt]);

  // Stop all asynchronous work and recording on unmount.
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      showQuitModalRef.current = false;
      discardNextStopRef.current = true;

      clearTimers();

      if (recordingRef.current) {
        void stopRecordingRef.current?.().catch(() => undefined);
      }

      recordingRef.current = false;
      stopRequestedRef.current = false;
    };
  }, [clearTimers]);

  const recordingProgress =
    params.durationSec > 0
      ? clamp(
          elapsedMs / 1000 / params.durationSec,
          0,
          1,
        )
      : 0;

  const livePitchNote =
    liveFrame &&
    Number.isFinite(liveFrame.pitch) &&
    liveFrame.pitch > 0
      ? frequencyToNote(liveFrame.pitch)
      : '--';

  const livePitchHz =
    liveFrame &&
    Number.isFinite(liveFrame.pitch) &&
    liveFrame.pitch > 0
      ? `${Math.round(liveFrame.pitch)} Hz`
      : '--';

  const liveClarity =
    liveFrame &&
    Number.isFinite(liveFrame.clarity)
      ? `${Math.round(liveFrame.clarity * 100)}%`
      : '--';

  const liveVolume =
    liveFrame &&
    Number.isFinite(liveFrame.volume)
      ? `${Math.round(liveFrame.volume)} dB`
      : '--';

  const quitMessage =
    phase === 'recording'
      ? 'Your exercise is paused. Your current recording will be discarded if you continue, and you will restart this attempt.'
      : phase === 'processing'
        ? 'Your exercise is paused while we analyze your performance. Continue to return to your results.'
        : phase === 'results'
          ? 'Are you sure you want to leave this exercise? Your completed result has already been saved.'
          : 'Are you sure you want to leave Steady Tone Holding? Your exercise progress will be saved only after a completed recording is analyzed.';

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

          <Text style={styles.modalTitle}>
            Leave Exercise?
          </Text>

          <Text style={styles.modalMessage}>
            {quitMessage}
          </Text>

          <Pressable
            accessibilityRole="button"
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
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons
            name="options-outline"
            size={32}
            color={BROWN}
          />
        </View>

        <Text style={styles.preparingTitle}>
          Preparing Your Exercise
        </Text>

        <Text style={styles.preparingSubtitle}>
          Adjusting the exercise to your current difficulty level and preparing your vocal range.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.preparingSpinner}
        />

        {quitModal}
      </View>
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
          tip="Think of keeping the voice balanced and relaxed rather than trying to make it artificially still."
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
        <ExerciseListeningScreen
          icon="mic"
          title="Steady Tone Holding"
          elapsed={elapsedMs / 1000}
          targetDuration={params.durationSec}
          promptTitle="Hold Your Tone"
          prompt="Keep your tone, loudness, and pitch steady for the full duration."
          progress={recordingProgress * 100}
          liveContent={
            <View style={styles.liveContent}>
              <Text style={styles.liveLabel}>
                LIVE AUDIO
              </Text>

              <Text style={styles.liveNote}>
                {livePitchNote}
              </Text>

              <Text style={styles.liveFrequency}>
                {livePitchHz}
              </Text>

              <View style={styles.liveStats}>
                <View style={styles.liveStat}>
                  <Text style={styles.liveStatLabel}>
                    Clarity
                  </Text>
                  <Text style={styles.liveStatValue}>
                    {liveClarity}
                  </Text>
                </View>

                <View style={styles.liveStat}>
                  <Text style={styles.liveStatLabel}>
                    Volume
                  </Text>
                  <Text style={styles.liveStatValue}>
                    {liveVolume}
                  </Text>
                </View>
              </View>

              <View style={styles.recordingStatus}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingStatusText}>
                  {isRecording
                    ? 'Listening to your voice...'
                    : 'Starting microphone...'}
                </Text>
              </View>
            </View>
          }
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
          title={
            result.passed
              ? 'Great Tone Control!'
              : 'Keep Practicing'
          }
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
                {formatNumber(
                  measurement.amplitudeStabilityPct,
                  0,
                )}
                %
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultRowLabel}>
                Pitch stability
              </Text>
              <Text style={styles.resultRowValue}>
                {formatNumber(
                  measurement.pitchStabilityPct,
                  0,
                )}
                %
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultRowLabel}>
                Duration
              </Text>
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
    fontSize: 20,
    color: BROWN,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
    color: '#9A817D',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 285,
  },
  preparingSpinner: {
    marginTop: 24,
  },
  liveContent: {
    width: '100%',
    alignItems: 'center',
  },
  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.7,
  },
  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 40,
    color: BROWN,
    marginTop: 4,
  },
  liveFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },
  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  liveStat: {
    alignItems: 'center',
  },
  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginTop: 2,
  },
  recordingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BROWN,
    marginRight: 7,
  },
  recordingStatusText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
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