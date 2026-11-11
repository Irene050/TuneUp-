import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, BackHandler, ScrollView, Text, View } from 'react-native';

import { usePhaseState } from '@/hooks/usePhaseState';
import {
  FREQUENCY_ZONE_STABILITY_PARAMS,
  type FrequencyZoneStabilityParams,
  type Tier,
} from '@/constants/params';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
  type ExercisePreparationStep,
  type ExerciseSummaryItem,
} from '@/screens/exercises/ExerciseScreen';
import { generateFrequencyZoneStabilityParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureFrequencyZoneStability } from '@/services/measurement/tone/frequencyZoneStability';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreFrequencyZoneStability } from '@/services/scoring/tone/frequencyZoneStability';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import {
  classifyFrequencyZone,
  type FrequencyZone,
} from '@/utils/dsp/spectral';
import { formatNumber } from '@/utils/numberFormatting';

import {
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
  EXERCISE_RECORDING_INTERVAL_MS,
  TONE_WAVEFORM_BAR_COUNT,
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { LiveToneMonitorCard } from '@/screens/exercises/Tone/LiveToneMonitorCard';
import { clamp } from '@/utils/math';

import {
  ExerciseNoAudioModal,
  ExerciseQuitModal,
} from '@/components/exercises/ExerciseModals';

const REST_SECONDS = 2;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'rest'
  | 'processing'
  | 'results';

interface RepetitionResult {
  measurement: ReturnType<typeof measureFrequencyZoneStability>;
  score: ReturnType<typeof scoreFrequencyZoneStability>;
}

function zoneLabel(zone: FrequencyZone) {
  return zone
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function FrequencyLiveWaveform({
  pitch,
  zone,
  color,
}: {
  pitch: number | null;
  zone: FrequencyZone | null;
  color: string;
}) {
  const hasPitch =
    pitch !== null &&
    Number.isFinite(pitch) &&
    pitch > 0;

  const bars = useMemo(
    () =>
      Array.from({ length: TONE_WAVEFORM_BAR_COUNT }, (_, index) => {
        const center = (TONE_WAVEFORM_BAR_COUNT - 1) / 2;
        const distance = Math.abs(index - center) / center;
        const envelope = 1 - distance * 0.65;

        const variation = hasPitch
          ? 0.35 +
            Math.abs(
              Math.sin(index * 0.72 + (pitch ?? 0) * 0.001),
            ) *
              0.65
          : 0.12 + Math.abs(Math.sin(index * 0.72)) * 0.12;

        return Math.max(
          5,
          Math.round(38 * envelope * variation),
        );
      }),
    [hasPitch, pitch],
  );

  const statusText = !hasPitch
    ? 'Listening for your voice...'
    : zone
      ? `Frequency zone: ${zoneLabel(zone)}`
      : 'Voice detected — checking frequency';

  return (
    <View style={exerciseStyles.waveformContainer}>
      <View
        style={exerciseStyles.waveformBars}
        accessibilityLabel={
          !hasPitch
            ? 'No pitch detected'
            : zone
              ? `Frequency detected in ${zoneLabel(zone)} zone`
              : 'Frequency detected'
        }
      >
        {bars.map((height, index) => (
          <View
            key={index}
            style={[
              exerciseStyles.waveformBar,
              {
                height,
                backgroundColor: hasPitch ? color : COLORS.guideRed,
                opacity: hasPitch ? 0.9 : 0.45,
              },
            ]}
          />
        ))}
      </View>

      <View style={exerciseStyles.waveformStatusRow}>
        <View
          style={[
            exerciseStyles.statusDot,
            { backgroundColor: hasPitch ? color : COLORS.guideRed },
          ]}
        />

        <Text
          style={[
            exerciseStyles.waveformStatus,
            { color: hasPitch ? color : COLORS.guideRed },
          ]}
        >
          {statusText}
        </Text>
      </View>
    </View>
  );
}

export default function FrequencyZoneStabilityScreen({
  tier,
}: Props) {
  const user = auth.currentUser;

  const [currentTier, setCurrentTier] = useState<Tier>(
    tier ?? 'beginner',
  );

  const [params, setParams] = useState<FrequencyZoneStabilityParams>(
    FREQUENCY_ZONE_STABILITY_PARAMS[tier ?? 'beginner'],
  );

  const [isLoadingParams, setIsLoadingParams] = useState(true);

  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [restCountdown, setRestCountdown] = useState(REST_SECONDS);
  const [currentRep, setCurrentRep] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);

  const [liveAudioFrame, setLiveAudioFrame] = useState<LiveAudioFrame | null>(null);
  const [liveZone, setLiveZone] = useState<FrequencyZone | null>(null);

  const [repetitionResults, setRepetitionResults] = useState<
    RepetitionResult[]
  >([]);

  const [result, setResult] = useState<{
    score: number;
    passed: boolean;
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

  const paramsRef = useRef<FrequencyZoneStabilityParams>(
    FREQUENCY_ZONE_STABILITY_PARAMS[tier ?? 'beginner'],
  );

  const tierRef = useRef<Tier>(tier ?? 'beginner');
  const mountedRef = useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const restTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const isRecordingRef = useRef(false);
  const processingRef = useRef(false);
  const finishingRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);

  const elapsedRef = useRef(0);
  const currentRepRef = useRef(1);
  const repetitionResultsRef = useRef<RepetitionResult[]>([]);
  const pitchHistoryRef = useRef<number[]>([]);

  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const discardNextStopRef = useRef(false);

  const pausedPhaseRef = useRef<Phase>('instructions');
  const progressSavedRef = useRef(false);

  const startRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef =
    useRef<(() => void | Promise<void>) | null>(null);

  const beginCountdownRef = useRef<(() => void) | null>(null);
  const beginRestRef = useRef<(() => void) | null>(null);

  const finishExerciseRef =
    useRef<((results: RepetitionResult[]) => Promise<void>) | null>(
      null,
    );

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (restTimerRef.current) {
      clearInterval(restTimerRef.current);
      restTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phaseRef.current !== 'recording'
    ) {
      return;
    }

    setLiveAudioFrame(frame);

    if (Number.isFinite(frame.pitch) && frame.pitch > 0) {
      pitchHistoryRef.current.push(frame.pitch);
      setLiveZone(classifyFrequencyZone(frame.pitch));
    } else {
      setLiveZone(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadParams() {
      setIsLoadingParams(true);

      try {
        let resolvedTier: Tier = tier ?? 'beginner';

        if (user && !tier) {
          const progress = await fetchComponentProgress(
            user.uid,
            'tone',
          );

          resolvedTier = progress?.currentTier ?? 'beginner';
        }

        if (cancelled || !mountedRef.current) return;

        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(user.uid, 'tone');

          if (cancelled || !mountedRef.current) return;

          const matchingRecords = records
            .filter(
              record =>
                record.templateId === 'frequencyZoneStability' &&
                record.tier === resolvedTier,
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          recentScores = matchingRecords
            .slice(-5)
            .map(record => record.scorePct);

          if (recentScores.length === 0) {
            const assessment = await getLatestAssessment();

            if (cancelled || !mountedRef.current) return;

            const assessmentScore = assessment?.scores.find(
              score => score.componentId === 'tone',
            )?.scorePct;

            if (typeof assessmentScore === 'number') {
              recentScores = [assessmentScore];
            }
          }
        }

        if (cancelled || !mountedRef.current) return;

        const generatedParams = generateFrequencyZoneStabilityParams({
          tier: resolvedTier,
          recentScores,
        });

        paramsRef.current = generatedParams;
        tierRef.current = resolvedTier;

        setCurrentTier(resolvedTier);
        setParams(generatedParams);
      } catch (errorMessage) {
        console.error(
          'Failed to load Frequency Zone Stability parameters:',
          errorMessage,
        );

        if (cancelled || !mountedRef.current) return;

        const fallbackTier = tier ?? 'beginner';
        const fallbackParams =
          FREQUENCY_ZONE_STABILITY_PARAMS[fallbackTier];

        paramsRef.current = fallbackParams;
        tierRef.current = fallbackTier;

        setCurrentTier(fallbackTier);
        setParams(fallbackParams);
      } finally {
        if (!cancelled && mountedRef.current) {
          setIsLoadingParams(false);
        }
      }
    }

    void loadParams();

    return () => {
      cancelled = true;
    };
  }, [tier, user]);

  const finishExercise = useCallback(
    async (results: RepetitionResult[]) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        finishingRef.current
      ) {
        return;
      }

      if (results.length === 0) {
        setErrorMessage('No recording results were detected.');
        setPhase('instructions');
        return;
      }

      finishingRef.current = true;
      setPhase('processing');

      const averageScore =
        results.reduce((sum, item) => sum + item.score.score, 0) /
        results.length;

      const finalScore = Math.round(clamp(averageScore, 0, 100));
      const allPassed = results.every(item => item.score.passed);

      try {
        if (!progressSavedRef.current) {
          if (user) {
            await saveCompletedExercise(
              'tone',
              'frequencyZoneStability',
              tierRef.current,
              finalScore,
            );
          }

          progressSavedRef.current = true;
        }
      } catch (errorMessage) {
        console.error(
          'Failed to save Frequency Zone Stability result:',
          errorMessage,
        );

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !showQuitModalRef.current &&
          !quitInProgressRef.current
        ) {
          Alert.alert(
            'Progress Save Error',
            'Your score was calculated, but the progress could not be saved.',
          );
        }
      } finally {
        finishingRef.current = false;
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      setResult({ score: finalScore, passed: allPassed });
      setPhase('results');
    },
    [setPhase, user],
  );

  useEffect(() => {
    finishExerciseRef.current = finishExercise;
  }, [finishExercise]);

  const handleRecordingStop = useCallback((samples: Float32Array) => {
    isRecordingRef.current = false;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (discardNextStopRef.current) {
      discardNextStopRef.current = false;
      processingRef.current = false;
      return;
    }

    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phaseRef.current !== 'recording' ||
      processingRef.current
    ) {
      return;
    }

    if (!hasSufficientRecordedSignal(samples)) {
      processingRef.current = false;
      setPhase('instructions');
      setShowNoAudioModal(true);
      return;
    }

    processingRef.current = true;

    try {
      const measurement = measureFrequencyZoneStability(
        pitchHistoryRef.current,
        elapsedRef.current / 1000,
      );

      const score = scoreFrequencyZoneStability(
        measurement,
        paramsRef.current,
      );

      const repetitionResult: RepetitionResult = {
        measurement,
        score,
      };

      const updatedResults = [
        ...repetitionResultsRef.current,
        repetitionResult,
      ];

      repetitionResultsRef.current = updatedResults;

      setRepetitionResults(updatedResults);
      setLiveAudioFrame(null);
      setLiveZone(null);
      pitchHistoryRef.current = [];

      if (currentRepRef.current < paramsRef.current.repetitions) {
        setRestCountdown(REST_SECONDS);
        setPhase('rest');
      } else {
        setPhase('processing');
        void finishExerciseRef.current?.(updatedResults);
      }
    } catch (errorMessage) {
      console.error(
        'Failed to analyze Frequency Zone Stability recording:',
        errorMessage,
      );

      if (mountedRef.current) {
        setErrorMessage(
          'We could not analyze your recording. Please try again.',
        );
        setPhase('instructions');
      }
    } finally {
      processingRef.current = false;
    }
  }, [setPhase]);

  const { startRecording, stopRecording } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const startRecordingPhase = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      isRecordingRef.current ||
      processingRef.current
    ) {
      return;
    }

    try {
      clearTimers();

      setErrorMessage(null);
      setElapsedMs(0);
      elapsedRef.current = 0;
      pitchHistoryRef.current = [];

      isRecordingRef.current = true;
      recordingStopRequestedRef.current = false;

      setLiveAudioFrame(null);
      setLiveZone(null);
      setPhase('recording');

      discardNextStopRef.current = false;

      await startRecordingRef.current?.();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

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
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        elapsedRef.current += elapsedDelta;
        setElapsedMs(elapsedRef.current);

        if (
          elapsedRef.current >=
          paramsRef.current.durationSec * 1000
        ) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }

          if (!recordingStopRequestedRef.current) {
            recordingStopRequestedRef.current = true;

            try {
              void Promise.resolve(
                stopRecordingRef.current?.(),
              ).catch(errorMessage => {
                console.error(
                  'Failed to stop Frequency Zone Stability recording:',
                  errorMessage,
                );
              });
            } catch (errorMessage) {
              console.error(
                'Failed to stop Frequency Zone Stability recording:',
                errorMessage,
              );
            }
          }
        }
      }, EXERCISE_RECORDING_INTERVAL_MS);
    } catch (errorMessage) {
      console.error('Failed to start recording:', errorMessage);

      isRecordingRef.current = false;
      pitchHistoryRef.current = [];
      clearTimers();

      if (
        mountedRef.current &&
        !pausedRef.current &&
        !quitInProgressRef.current
      ) {
        setErrorMessage(
          'Unable to start recording. Please check microphone permission and try again.',
        );
        setPhase('instructions');
      }
    }
  }, [clearTimers, setPhase]);

  const beginCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    clearTimers();

    setErrorMessage(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setElapsedMs(0);
    elapsedRef.current = 0;
    setLiveAudioFrame(null);
    setLiveZone(null);
    setPhase('countdown');

    let value = EXERCISE_COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'countdown'
      ) {
        return;
      }

      value -= 1;

      if (value <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }

        void startRecordingPhase();
        return;
      }

      setCountdown(value);
    }, 1000);
  }, [clearTimers, setPhase, startRecordingPhase]);

  useEffect(() => {
    beginCountdownRef.current = beginCountdown;
  }, [beginCountdown]);

  const handleRest = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    if (restTimerRef.current) {
      clearInterval(restTimerRef.current);
      restTimerRef.current = null;
    }

    let value = REST_SECONDS;
    setRestCountdown(value);

    restTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'rest'
      ) {
        return;
      }

      value -= 1;

      if (value <= 0) {
        if (restTimerRef.current) {
          clearInterval(restTimerRef.current);
          restTimerRef.current = null;
        }

        currentRepRef.current += 1;
        setCurrentRep(currentRepRef.current);

        setElapsedMs(0);
        elapsedRef.current = 0;
        pitchHistoryRef.current = [];

        void startRecordingPhase();
        return;
      }

      setRestCountdown(value);
    }, 1000);
  }, [startRecordingPhase]);

  useEffect(() => {
    beginRestRef.current = handleRest;
  }, [handleRest]);

  useEffect(() => {
    if (phase === 'rest') {
      handleRest();
    }

    return () => {
      if (restTimerRef.current) {
        clearInterval(restTimerRef.current);
        restTimerRef.current = null;
      }
    };
  }, [phase, handleRest]);

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
      recordingStopRequestedRef.current = true;
      isRecordingRef.current = false;
      processingRef.current = false;

      setElapsedMs(0);
      elapsedRef.current = 0;
      setLiveAudioFrame(null);
      setLiveZone(null);
      pitchHistoryRef.current = [];

      try {
        void Promise.resolve(
          stopRecordingRef.current?.(),
        ).catch(errorMessage => {
          console.error('Failed to stop recording while pausing:', errorMessage);
        });
      } catch (errorMessage) {
        console.error('Failed to stop recording while pausing:', errorMessage);
      }
    } else if (currentPhase === 'countdown') {
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    } else if (currentPhase === 'rest') {
      setRestCountdown(REST_SECONDS);
    }

    setShowQuitModal(true);
  }, [clearTimers]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    pausedRef.current = false;

    const pausedPhase = pausedPhaseRef.current;

    if (
      pausedPhase === 'countdown' ||
      pausedPhase === 'recording'
    ) {
      isRecordingRef.current = false;
      processingRef.current = false;
      finishingRef.current = false;
      recordingStopRequestedRef.current = false;
      discardNextStopRef.current = false;

      setElapsedMs(0);
      elapsedRef.current = 0;
      setLiveAudioFrame(null);
      setLiveZone(null);
      pitchHistoryRef.current = [];

      beginCountdownRef.current?.();
      return;
    }

    if (pausedPhase === 'rest') {
      setPhase('rest');
      beginRestRef.current?.();
      return;
    }

    if (pausedPhase === 'processing') {
      if (progressSavedRef.current) {
        const savedResults = repetitionResultsRef.current;

        const averageScore =
          savedResults.reduce(
            (sum, item) => sum + item.score.score,
            0,
          ) / Math.max(savedResults.length, 1);

        setResult({
          score: Math.round(clamp(averageScore, 0, 100)),
          passed: savedResults.every(item => item.score.passed),
        });

        setPhase('results');
        return;
      }

      if (!finishingRef.current) {
        void finishExerciseRef.current?.(repetitionResultsRef.current);
      }
    }
  }, [setPhase]);

  const startExercise = useCallback(() => {
    if (
      !paramsRef.current ||
      !tierRef.current ||
      isLoadingParams ||
      quitInProgressRef.current
    ) {
      return;
    }

    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    quitInProgressRef.current = false;
    discardNextStopRef.current = false;
    recordingStopRequestedRef.current = false;
    isRecordingRef.current = false;
    processingRef.current = false;
    finishingRef.current = false;
    progressSavedRef.current = false;

    repetitionResultsRef.current = [];
    currentRepRef.current = 1;
    pitchHistoryRef.current = [];
    elapsedRef.current = 0;

    setRepetitionResults([]);
    setResult(null);
    setCurrentRep(1);
    setElapsedMs(0);
    setLiveAudioFrame(null);
    setLiveZone(null);
    setErrorMessage(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setRestCountdown(REST_SECONDS);
    setShowQuitModal(false);
    setIsQuitting(false);

    beginCountdown();
  }, [beginCountdown, clearTimers, isLoadingParams]);

  const handleRetry = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    recordingStopRequestedRef.current = true;
    isRecordingRef.current = false;
    processingRef.current = false;
    finishingRef.current = false;

    try {
      void Promise.resolve(
        stopRecordingRef.current?.(),
      ).catch(errorMessage => {
        console.error(
          'Failed to stop recording before retry:',
          errorMessage,
        );
      });
    } catch (errorMessage) {
      console.error('Failed to stop recording before retry:', errorMessage);
    }

    repetitionResultsRef.current = [];
    currentRepRef.current = 1;
    pitchHistoryRef.current = [];
    elapsedRef.current = 0;
    progressSavedRef.current = false;

    setRepetitionResults([]);
    setResult(null);
    setCurrentRep(1);
    setElapsedMs(0);
    setLiveAudioFrame(null);
    setLiveZone(null);
    setErrorMessage(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setRestCountdown(REST_SECONDS);
    setShowQuitModal(false);
    setIsQuitting(false);
    setPhase('instructions');
  }, [clearTimers, setPhase]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;
    recordingStopRequestedRef.current = true;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();

    isRecordingRef.current = false;
    processingRef.current = false;
    finishingRef.current = true;

    try {
      await Promise.resolve(stopRecordingRef.current?.());
    } catch (errorMessage) {
      console.error(
        'Failed to stop recording before leaving:',
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
        if (showQuitModalRef.current) {
          return true;
        }

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
      pausedRef.current = true;
      showQuitModalRef.current = false;
      discardNextStopRef.current = true;

      clearTimers();

      try {
        void Promise.resolve(
          stopRecordingRef.current?.(),
        ).catch(errorMessage => {
          console.error(
            'Failed to stop recording during cleanup:',
            errorMessage,
          );
        });
      } catch (errorMessage) {
        console.error(
          'Failed to stop recording during cleanup:',
          errorMessage,
        );
      }
    };
  }, [clearTimers]);

  const recordingProgress =
    params.durationSec > 0
      ? clamp(
          (elapsedMs / 1000 / params.durationSec) * 100,
          0,
          100,
        )
      : 0;

  const livePitch =
    liveAudioFrame &&
    Number.isFinite(liveAudioFrame.pitch) &&
    liveAudioFrame.pitch > 0
      ? liveAudioFrame.pitch
      : null;

  const liveIndicator =
    livePitch === null || !liveZone
      ? {
          color: COLORS.guideRed,
          title: 'Listening for your voice',
          subtitle: 'Start singing to activate the frequency pulse.',
        }
      : {
          color: COLORS.guideGreen,
          title: 'Frequency detected',
          subtitle: 'Keep singing steadily in your current zone.',
        };

  const averageScore =
    repetitionResults.length > 0
      ? Math.round(
          repetitionResults.reduce(
            (sum, item) => sum + item.score.score,
            0,
          ) / repetitionResults.length,
        )
      : 0;

  const averageStability =
    repetitionResults.length > 0
      ? repetitionResults.reduce(
          (sum, item) => sum + item.measurement.stabilityPct,
          0,
        ) / repetitionResults.length
      : 0;

  const passedRepetitions = repetitionResults.filter(
    item => item.score.passed,
  ).length;

  const preparationSteps: ExercisePreparationStep[] = [
    {
      icon: 'body-outline',
      text: 'Stand or sit comfortably with relaxed shoulders.',
    },
    {
      icon: 'mic-outline',
      text: 'Sing at a comfortable pitch without forcing your voice.',
    },
    {
      icon: 'musical-note-outline',
      text: 'Maintain a steady vocal frequency throughout the recording.',
    },
  ];

  const summary: ExerciseSummaryItem[] = [
    {
      label: 'DURATION',
      value: `${params.durationSec}s`,
      hint: 'per repetition',
    },
    {
      label: 'STABILITY',
      value: `${params.stabilityThreshold}%`,
      hint: 'minimum',
    },
    {
      label: 'REPETITIONS',
      value: String(params.repetitions),
      hint: 'attempts',
    },
  ];

  const quitModal = (
    <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit exercise?"}
        message={pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Frequency Zone Stability?'
              : pausedPhaseRef.current === 'recording'
                ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                : pausedPhaseRef.current === 'countdown'
                  ? 'Your exercise is paused. Your completed repetitions will be kept, and the countdown will restart when you continue.'
                  : pausedPhaseRef.current === 'rest'
                    ? 'Your exercise is paused. Your completed repetitions will be kept, and your rest period will resume when you continue.'
                    : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => void quitExercise()}
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
        processingRef.current = false;
        beginCountdownRef.current?.();
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
        {noAudioModal}
      </>
    );
  }

  if (phase === 'instructions') {
    return (
      <>
        <ExerciseScreen
          title="Frequency Zone Stability"
          category="Tone"
          icon="pulse"
          instructions="Sing steadily while maintaining a consistent frequency zone throughout each repetition."
          preparationSteps={preparationSteps}
          summary={summary}
          tip="Focus on keeping your voice steady rather than changing pitch during the repetition."
          tier={currentTier}
          onBack={handleBack}
          onStart={startExercise}
          errorMessage={errorMessage}
        >
          <View style={exerciseStyles.disclaimerCard}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={COLORS.brown}
            />

            <Text style={exerciseStyles.disclaimerText}>
              This is a frequency-based training indicator, not a direct
              measurement of physical resonance placement.
            </Text>
          </View>
        </ExerciseScreen>

        {quitModal}
        {noAudioModal}
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="pulse"
          title="Frequency Zone Stability"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Get Ready"
          prompt="Prepare to sing steadily and maintain a consistent frequency zone."
          onBack={handleBack}
        />

        {quitModal}
        {noAudioModal}
      </>
    );
  }

  if (phase === 'recording') {
    const elapsedSeconds = elapsedMs / 1000;
    const remainingSeconds = Math.max(
      0,
      params.durationSec - elapsedSeconds,
    );

    return (
      <>
        <View style={exerciseStyles.recordingScreenVariant2}>
          <ScrollView
            style={exerciseStyles.infoText}
            contentContainerStyle={exerciseStyles.recordingContentVariant4}
            showsVerticalScrollIndicator={false}
          >

            <Text style={exerciseStyles.recordingTitleVariant3}>
              Hold Your Frequency
            </Text>
              <Text style={exerciseStyles.repPillText}>
                Repetition {currentRep} of {params.repetitions}
              </Text>
            <LiveToneMonitorCard>


              <FrequencyLiveWaveform
                pitch={livePitch}
                zone={liveZone}
                color={liveIndicator.color}
              />

              <View style={exerciseStyles.liveMetricsRow}>
                <View style={exerciseStyles.liveMetric}>
                  <Text style={exerciseStyles.liveLabelVariant2}>
                    DETECTED FREQUENCY
                  </Text>

                  <Text style={exerciseStyles.quitModalTitle}>
                    {livePitch !== null
                      ? formatNumber(livePitch, 1)
                      : '--'}
                  </Text>

                  <Text style={exerciseStyles.metricHint}>
                    {livePitch !== null ? 'Hz' : 'Waiting for pitch'}
                  </Text>
                </View>

                <View style={exerciseStyles.liveDivider} />

                <View style={exerciseStyles.liveMetric}>
                  <Text style={exerciseStyles.liveLabelVariant2}>CURRENT ZONE</Text>

                  <Text
                    style={[
                      exerciseStyles.quitModalTitle,
                      {
                        color: liveZone ? COLORS.guideGreen : COLORS.guideRed,
                      },
                    ]}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                  >
                    {liveZone ? zoneLabel(liveZone) : '--'}
                  </Text>

                  <Text style={exerciseStyles.metricHint}>
                    Detected frequency zone
                  </Text>
                </View>
              </View>
            </LiveToneMonitorCard>

            <View style={exerciseStyles.recordingProgressSectionVariant1}>
              <View style={exerciseStyles.recordingProgressLabels}>
                <Text style={exerciseStyles.progressLabel}>RECORDING</Text>

                <Text style={exerciseStyles.progressTime}>
                  {formatNumber(elapsedSeconds)}s / {params.durationSec}s
                </Text>
              </View>

              <View
                style={exerciseStyles.progressTrackVariant1}
                accessibilityRole="progressbar"
                accessibilityLabel="Recording progress"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round(recordingProgress),
                }}
              >
                <View
                  style={[
                    exerciseStyles.progressFill,
                    { width: `${recordingProgress}%` },
                  ]}
                />
              </View>

              <Text style={exerciseStyles.remainingText}>
                {formatNumber(remainingSeconds)} seconds remaining
              </Text>
            </View>

          </ScrollView>
        </View>

        {quitModal}
        {noAudioModal}
      </>
    );
  }

  if (phase === 'rest') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="pulse"
          title="Frequency Zone Stability"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={restCountdown}
          promptTitle="Rest"
          prompt="Relax your voice and prepare for the next repetition."
          onBack={handleBack}
        />

        {quitModal}
        {noAudioModal}
      </>
    );
  }

  if (phase === 'processing') {
    return (
      <>
        <ExerciseProcessingScreen
          icon="pulse"
          title="Analyzing Your Performance"
          message="Analyzing your frequency stability..."
        />

        {quitModal}
        {noAudioModal}
      </>
    );
  }

  if (phase === 'results' && result) {
    return (
      <>
        <ExerciseResultsScreen
          title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
          subtitle="Frequency Zone Stability"
          score={result.score}
          resultIcon={
            result.passed ? 'checkmark-circle' : 'refresh-circle'
          }
          scoreMessage={
            result.passed
              ? 'You maintained good frequency stability.'
              : 'Try to keep your vocal frequency more consistent.'
          }
          onRetry={handleRetry}
          onExit={handleBack}
        >
          <View style={exerciseStyles.resultDetailsCard}>
            <View style={exerciseStyles.resultDetailRow}>
              <Text style={exerciseStyles.scoreMetricLabel}>Stability</Text>
              <Text style={exerciseStyles.resultDetailValue}>
                {formatNumber(averageStability)}%
              </Text>
            </View>

            <View style={exerciseStyles.resultDivider} />

            <View style={exerciseStyles.resultDetailRow}>
              <Text style={exerciseStyles.scoreMetricLabel}>Repetitions</Text>
              <Text style={exerciseStyles.resultDetailValue}>
                {passedRepetitions}/{repetitionResults.length}
              </Text>
            </View>

            <View style={exerciseStyles.resultDivider} />

            <View style={exerciseStyles.resultDetailRow}>
              <Text style={exerciseStyles.scoreMetricLabel}>Average Score</Text>
              <Text style={exerciseStyles.resultDetailValue}>
                {averageScore}%
              </Text>
            </View>
          </View>
        </ExerciseResultsScreen>

        {quitModal}
        {noAudioModal}
      </>
    );
  }

  return <>{quitModal}</>;
}
