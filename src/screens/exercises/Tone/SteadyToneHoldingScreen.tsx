import { router } from 'expo-router';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import { Alert, BackHandler, Text, View } from 'react-native';

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
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import {
    STEADY_TONE_HOLDING_PARAMS,
    type SteadyToneHoldingParams,
    type Tier,
} from '@/constants/params';
import {
    useAudioRecorder,
    type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { useMountedRefLifecycle } from '@/hooks/useMountedRefLifecycle';
import type { ExerciseTierProps, RecordingExercisePhase } from '@/types/exercises';
import ExerciseScreen, {
    ExerciseCountdownScreen,
    ExercisePreparingScreen,
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
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { samplesToFFTFrames } from '@/utils/dsp/fft';
import { clamp } from '@/utils/math';
import { frequencyToNoteName } from '@/utils/music/notes';
import { formatNumber } from '@/utils/numberFormatting';


type Props = ExerciseTierProps;

type Phase = RecordingExercisePhase;

interface ProcessingResult {
  measurement: SteadyToneHoldingMeasurement;
  result: SteadyToneHoldingScoreResult;
}

function getLiveToneWaveform(
  frame: LiveAudioFrame | null,
): ToneWaveformProps {
  const pitch = frame?.pitch ?? 0;
  const volume = frame?.volume ?? -60;
  const hasPitch = Number.isFinite(pitch) && pitch > 0;
  const waveformColor = hasPitch ? COLORS.guideGreen : COLORS.guideRed;
  const volumeLevel = Number.isFinite(volume)
    ? clamp((volume + 60) / 60, 0, 1)
    : 0;

  return {
    bars: createToneWaveformBars(
      pitch,
      hasPitch,
      0.35 + volumeLevel * 0.3,
    ),
    color: waveformColor,
    hasPitch,
    accessibilityLabel:
      hasPitch ? 'Voice detected in waveform' : 'Waiting for voice',
    statusText:
      hasPitch
        ? 'Voice detected — keep your tone steady'
        : 'Listening for your voice...',
    statusTextStyle: exerciseStyles.waveformStatusVariant1,
  };
}

function RecordingScreen({
  elapsedSeconds,
  durationSeconds,
  liveAudioFrame,
  isRecording,
}: {
  elapsedSeconds: number;
  durationSeconds: number;
  liveAudioFrame: LiveAudioFrame | null;
  isRecording: boolean;
}) {
  const progress =
    durationSeconds > 0
      ? clamp(elapsedSeconds / durationSeconds, 0, 1)
      : 0;



  const pitch =
    liveAudioFrame?.pitch !== undefined &&
    Number.isFinite(liveAudioFrame.pitch) &&
    liveAudioFrame.pitch > 0
      ? liveAudioFrame.pitch
      : null;

  const clarity =
    liveAudioFrame?.clarity !== undefined &&
    Number.isFinite(liveAudioFrame.clarity)
      ? clamp(liveAudioFrame.clarity, 0, 1) * 100
      : null;

  const detectedNote =
    pitch !== null ? frequencyToNoteName(pitch) : '--';

  return (
    <View style={exerciseStyles.recordingScreenVariant3}>

      <Text style={exerciseStyles.recordingTitleVariant4}>Hold Your Tone</Text>
      <Text style={exerciseStyles.repPillTextVariant1}>
            STEADY TONE · SINGLE ATTEMPT
          </Text>
      <View style={exerciseStyles.sessionPart}>
        <LiveToneMonitorCard waveform={getLiveToneWaveform(liveAudioFrame)}>


          <View style={exerciseStyles.liveMetricsRow}>
            <View style={exerciseStyles.liveMetric}>
              <Text style={exerciseStyles.liveLabelVariant4}>DETECTED NOTE</Text>
              <Text style={exerciseStyles.liveValueVariant1} numberOfLines={1}>
                {detectedNote}
              </Text>
              <Text style={exerciseStyles.metricHint}>
                {pitch !== null
                  ? `${formatNumber(pitch)} Hz`
                  : 'Waiting for pitch'}
              </Text>
            </View>

            <View style={exerciseStyles.liveDivider} />

            <View style={exerciseStyles.liveMetric}>
              <Text style={exerciseStyles.liveLabelVariant4}>CLARITY</Text>
              <Text style={exerciseStyles.liveValueVariant1}>
                {clarity !== null
                  ? `${Math.round(clarity)}%`
                  : '--'}
              </Text>
              <Text style={exerciseStyles.metricHint}>
                {clarity !== null
                  ? 'Live clarity estimate'
                  : 'Waiting for voice'}
              </Text>
            </View>
          </View>
        </LiveToneMonitorCard>

        <View style={exerciseStyles.recordingProgressSectionVariant2}>
          <View
            style={exerciseStyles.progressTrack}
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
  const [isLoadingParams, setIsLoadingParams] = useState(true);
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveAudioFrame, setLiveAudioFrame] =
    useState<LiveAudioFrame | null>(null);
  const [result, setResult] =
    useState<SteadyToneHoldingScoreResult | null>(null);
  const [measurement, setMeasurement] =
    useState<SteadyToneHoldingMeasurement | null>(null);
  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

  const mountedRef = useRef(true);
  useMountedRefLifecycle(mountedRef);
  const paramsRef = useRef(params);
  const tierRef = useRef(currentTier);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const isRecordingRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);
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

  const setExercisePhase = useCallback((nextPhase: Phase) => {
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
        setIsLoadingParams(true);

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
      } catch (errorMessage) {
        console.error(
          'Failed to load steady tone holding parameters:',
          errorMessage,
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
          setIsLoadingParams(false);
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

    setLiveAudioFrame(frame);
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
        isRecordingRef.current = false;
        recordingStopRequestedRef.current = false;
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

      isRecordingRef.current = false;
      processingRef.current = true;
      clearTimers();
      setExercisePhase('processing');

      if (!hasSufficientRecordedSignal(samples)) {
        processingRef.current = false;
        setExercisePhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      try {
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
          throw new Error('Invalid audio sample rate.');
        }

        const fftFrames = samplesToFFTFrames(
          samples,
          EXERCISE_FFT_SIZE,
          EXERCISE_FFT_HOP_SIZE,
        );

        if (fftFrames.length === 0) {
          throw new Error('No FFT frames could be generated.');
        }

        const measured = measureSteadyToneHolding(
          samples,
          fftFrames,
          sampleRate,
          EXERCISE_FFT_SIZE,
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

        setExercisePhase('results');
      } catch (errorMessage) {
        console.error('Steady tone holding processing error:', errorMessage);

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !quitInProgressRef.current
        ) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          setExercisePhase('instructions');
        }
      } finally {
        processingRef.current = false;
        recordingStopRequestedRef.current = false;
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
      isRecordingRef.current ||
      processingRef.current ||
      isLoadingParams
    ) {
      return;
    }

    const start = startRecordingRef.current;
    const stop = stopRecordingRef.current;

    if (!start || !stop) {
      setErrorMessage(
        'The audio recorder is not ready. Please try again.',
      );
      setExercisePhase('instructions');
      return;
    }

    try {
      setErrorMessage(null);
      setLiveAudioFrame(null);
      setMeasurement(null);
      setResult(null);
      processingResultRef.current = null;

      elapsedRef.current = 0;
      setElapsedMs(0);
      recordingStopRequestedRef.current = false;
      discardNextStopRef.current = false;
      processingRef.current = false;

      setExercisePhase('recording');
      await start();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        discardNextStopRef.current = true;
        isRecordingRef.current = false;
        void Promise.resolve(stop()).catch(errorMessage => {
          console.warn('Unable to stop interrupted recording:', errorMessage);
        });
        return;
      }

      isRecordingRef.current = true;

      const durationMs = paramsRef.current.durationSec * 1000;
      let lastTickAt = Date.now();

      recordingTimerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsedDelta = now - lastTickAt;
        lastTickAt = now;

        if (
          !mountedRef.current ||
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
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }

          if (recordingStopRequestedRef.current) return;

          recordingStopRequestedRef.current = true;

          void Promise.resolve(stop()).catch(errorMessage => {
            console.error('Failed to stop steady tone recording:', errorMessage);

            isRecordingRef.current = false;
            recordingStopRequestedRef.current = false;

            if (
              mountedRef.current &&
              !pausedRef.current &&
              !quitInProgressRef.current
            ) {
              setErrorMessage(
                'We could not finish the recording. Please try again.',
              );
              setExercisePhase('instructions');
            }
          });
        }
      }, 100);
    } catch (errorMessage) {
      console.error('Failed to start steady tone recording:', errorMessage);

      isRecordingRef.current = false;
      recordingStopRequestedRef.current = false;

      if (
        mountedRef.current &&
        !pausedRef.current &&
        !quitInProgressRef.current
      ) {
        setExercisePhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    }
  }, [isLoadingParams, setExercisePhase]);

  useEffect(() => {
    beginRecordingRef.current = beginRecording;

    return () => {
      beginRecordingRef.current = null;
    };
  }, [beginRecording]);

  const startCountdown = useCallback(() => {
    if (
      isRecordingRef.current ||
      processingRef.current ||
      pausedRef.current ||
      quitInProgressRef.current ||
      isLoadingParams
    ) {
      return;
    }

    clearTimers();

    setErrorMessage(null);
    setLiveAudioFrame(null);
    setMeasurement(null);
    setResult(null);
    processingResultRef.current = null;

    elapsedRef.current = 0;
    setElapsedMs(0);
    isRecordingRef.current = false;
    recordingStopRequestedRef.current = false;
    processingRef.current = false;
    discardNextStopRef.current = false;
    savedRef.current = false;

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setExercisePhase('countdown');

    let value = EXERCISE_COUNTDOWN_SECONDS;

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
  }, [clearTimers, isLoadingParams, setExercisePhase]);

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

    if (activePhase === 'recording' || isRecordingRef.current) {
      discardNextStopRef.current = true;
      recordingStopRequestedRef.current = true;
      isRecordingRef.current = false;
      processingRef.current = false;

      const stop = stopRecordingRef.current;

      if (stop) {
        void Promise.resolve(stop()).catch(errorMessage => {
          console.warn(
            'Unable to stop interrupted steady-tone recording:',
            errorMessage,
          );
        });
      }

      elapsedRef.current = 0;
      setElapsedMs(0);
      setLiveAudioFrame(null);
    }

    if (activePhase === 'countdown') {
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
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
      isRecordingRef.current = false;
      processingRef.current = false;
      recordingStopRequestedRef.current = false;
      discardNextStopRef.current = false;

      elapsedRef.current = 0;
      setElapsedMs(0);
      setLiveAudioFrame(null);

      startCountdownRef.current?.();
      return;
    }

    if (previousPhase === 'processing') {
      const cached = processingResultRef.current;

      if (cached && savedRef.current) {
        setMeasurement(cached.measurement);
        setResult(cached.result);
        setExercisePhase('results');
      } else {
        setExercisePhase('processing');
      }

      return;
    }

    setExercisePhase(previousPhase);
  }, [setExercisePhase]);

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

    if (isRecordingRef.current || isRecording) {
      recordingStopRequestedRef.current = true;
      isRecordingRef.current = false;

      if (stop) {
        void Promise.resolve(stop()).catch(errorMessage => {
          console.warn(
            'Unable to stop steady-tone recording while quitting:',
            errorMessage,
          );
        });
      }
    }

    router.replace('/exercises/tone');
  }, [clearTimers, isRecording]);

  const retry = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    quitInProgressRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    if (isRecordingRef.current || isRecording) {
      const stop = stopRecordingRef.current;

      if (stop) {
        void Promise.resolve(stop()).catch(errorMessage => {
          console.warn('Unable to stop recording before retry:', errorMessage);
        });
      }
    }

    isRecordingRef.current = false;
    recordingStopRequestedRef.current = false;
    processingRef.current = false;
    savedRef.current = false;
    processingResultRef.current = null;

    setIsQuitting(false);
    setShowQuitModal(false);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setElapsedMs(0);
    elapsedRef.current = 0;
    setLiveAudioFrame(null);
    setMeasurement(null);
    setResult(null);
    setErrorMessage(null);
    setExercisePhase('instructions');
  }, [clearTimers, isRecording, setExercisePhase]);

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
    return () => {
      pausedRef.current = true;
      showQuitModalRef.current = false;
      discardNextStopRef.current = true;

      clearTimers();

      if (isRecordingRef.current) {
        const stop = stopRecordingRef.current;

        if (stop) {
          void Promise.resolve(stop()).catch(() => undefined);
        }
      }

      isRecordingRef.current = false;
      recordingStopRequestedRef.current = false;
    };
  }, [clearTimers]);

  const elapsedSeconds = elapsedMs / 1000;

  const quitModal = (
    <ExerciseQuitModal
        visible={showQuitModal}
        title={"Leave Exercise?"}
        message={
          pausedPhaseRef.current === 'recording'
            ? 'Your exercise is paused. Your current recording will be discarded, and you will restart this attempt if you continue.'
            : pausedPhaseRef.current === 'processing'
              ? 'Your exercise is paused while we analyze your performance. Continue to return to your results when processing is complete.'
              : pausedPhaseRef.current === 'results'
                ? 'Are you sure you want to leave this exercise? Your completed result has already been saved.'
                : 'Are you sure you want to leave Steady Tone Holding? Your progress is saved after a completed recording is analyzed.'
        }
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={quitExercise}
        continueLabel={"Continue Exercise"}
        quitLabel={"Quit Exercise"}
      />
  );

  const noAudioModal = (
    <ExerciseNoAudioModal
      visible={showNoAudioModal}
      onRedo={function redoExerciseRepetition() {
        setShowNoAudioModal(false);
        startCountdownRef.current?.();
      }}
      onQuit={() => {
        setShowNoAudioModal(false);
        quitExercise();
      }}
      isQuitting={isQuitting}
    />
  );

  if (isLoadingParams) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level and preparing your recording."
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
          errorMessage={errorMessage}
          startDisabled={isLoadingParams}
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
          title="Steady Tone Holding"
          countdown={countdown}
          promptTitle="Get Ready"
          prompt="Prepare to sustain one comfortable note."

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
          liveAudioFrame={liveAudioFrame}
          isRecording={isRecording}
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
          repetitionScores={[{ repetition: 1, score: result.score }]}
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

        >
          <View
            style={[
              exerciseStyles.resultCardSurface,
              exerciseStyles.resultCardInsetPadding,
            ]}
          >
            <Text style={exerciseStyles.resultCardTitle}>
              Your Performance
            </Text>

            <View style={exerciseStyles.resultRow}>
              <Text style={exerciseStyles.resultRowLabel}>
                Tone smoothness
              </Text>
              <Text style={exerciseStyles.resultRowValue}>
                {formatNumber(measurement.smoothnessPct, 0)}%
              </Text>
            </View>

            <View style={exerciseStyles.resultRow}>
              <Text style={exerciseStyles.resultRowLabel}>
                Loudness stability
              </Text>
              <Text style={exerciseStyles.resultRowValue}>
                {formatNumber(measurement.amplitudeStabilityPct, 0)}%
              </Text>
            </View>

            <View style={exerciseStyles.resultRow}>
              <Text style={exerciseStyles.resultRowLabel}>
                Pitch stability
              </Text>
              <Text style={exerciseStyles.resultRowValue}>
                {formatNumber(measurement.pitchStabilityPct, 0)}%
              </Text>
            </View>

            <View style={exerciseStyles.resultRow}>
              <Text style={exerciseStyles.resultRowLabel}>Duration</Text>
              <Text style={exerciseStyles.resultRowValue}>
                {formatNumber(measurement.durationSec)}s
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.resultTip}>
            <Text style={exerciseStyles.resultTipText}>
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
