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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  FREQUENCY_ZONE_STABILITY_PARAMS,
  type FrequencyZoneStabilityParams,
  type Tier,
} from '@/constants/exercises/tone';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
  ExerciseCountdownScreen,
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
import {
  classifyFrequencyZone,
  type FrequencyZone,
} from '@/utils/dsp/spectral';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const BORDER = '#F2DDE5';
const GUIDE_GREEN = '#4F9B67';
const GUIDE_RED = '#D64F5A';

const COUNTDOWN_SECONDS = 3;
const REST_SECONDS = 2;
const RECORDING_INTERVAL_MS = 100;
const WAVEFORM_BAR_COUNT = 30;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number, decimals = 1) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

function zoneLabel(zone: FrequencyZone) {
  return zone
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

// -----------------------------------------------------------------------------
// Live frequency waveform
// -----------------------------------------------------------------------------

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

  // These bars are a visual pitch indicator, not raw audio samples.
  const bars = useMemo(
    () =>
      Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
        const center = (WAVEFORM_BAR_COUNT - 1) / 2;
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
    <View style={styles.waveformContainer}>
      <View
        style={styles.waveformBars}
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
              styles.waveformBar,
              {
                height,
                backgroundColor: hasPitch ? color : GUIDE_RED,
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
            { backgroundColor: hasPitch ? color : GUIDE_RED },
          ]}
        />

        <Text
          style={[
            styles.waveformStatus,
            { color: hasPitch ? color : GUIDE_RED },
          ]}
        >
          {statusText}
        </Text>
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Screen
// -----------------------------------------------------------------------------

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

  const [loadingParams, setLoadingParams] = useState(true);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [restCountdown, setRestCountdown] = useState(REST_SECONDS);
  const [repetition, setRepetition] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);

  const [liveFrame, setLiveFrame] = useState<LiveAudioFrame | null>(null);
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

  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------

  const phaseRef = useRef<Phase>('instructions');

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

  const recordingRef = useRef(false);
  const processingRef = useRef(false);
  const finishingRef = useRef(false);
  const stopRequestedRef = useRef(false);

  const elapsedRef = useRef(0);
  const repetitionRef = useRef(1);
  const resultsRef = useRef<RepetitionResult[]>([]);
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

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  const setCurrentPhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

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

  // ---------------------------------------------------------------------------
  // Live audio frame handler
  // ---------------------------------------------------------------------------

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

    setLiveFrame(frame);

    if (Number.isFinite(frame.pitch) && frame.pitch > 0) {
      pitchHistoryRef.current.push(frame.pitch);
      setLiveZone(classifyFrequencyZone(frame.pitch));
    } else {
      setLiveZone(null);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Load adaptive exercise parameters
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function loadParams() {
      setLoadingParams(true);

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
      } catch (error) {
        console.error(
          'Failed to load Frequency Zone Stability parameters:',
          error,
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
          setLoadingParams(false);
        }
      }
    }

    void loadParams();

    return () => {
      cancelled = true;
    };
  }, [tier, user]);

  // ---------------------------------------------------------------------------
  // Finish and score the exercise
  // ---------------------------------------------------------------------------

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
        setCurrentPhase('instructions');
        return;
      }

      finishingRef.current = true;
      setCurrentPhase('processing');

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
      } catch (error) {
        console.error(
          'Failed to save Frequency Zone Stability result:',
          error,
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
      setCurrentPhase('results');
    },
    [setCurrentPhase, user],
  );

  useEffect(() => {
    finishExerciseRef.current = finishExercise;
  }, [finishExercise]);

  // ---------------------------------------------------------------------------
  // Handle recording completion
  // ---------------------------------------------------------------------------

  const handleRecordingStop = useCallback(() => {
    recordingRef.current = false;

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
        ...resultsRef.current,
        repetitionResult,
      ];

      resultsRef.current = updatedResults;

      setRepetitionResults(updatedResults);
      setLiveFrame(null);
      setLiveZone(null);
      pitchHistoryRef.current = [];

      if (repetitionRef.current < paramsRef.current.repetitions) {
        setRestCountdown(REST_SECONDS);
        setCurrentPhase('rest');
      } else {
        setCurrentPhase('processing');
        void finishExerciseRef.current?.(updatedResults);
      }
    } catch (error) {
      console.error(
        'Failed to analyze Frequency Zone Stability recording:',
        error,
      );

      if (mountedRef.current) {
        setErrorMessage(
          'We could not analyze your recording. Please try again.',
        );
        setCurrentPhase('instructions');
      }
    } finally {
      processingRef.current = false;
    }
  }, [setCurrentPhase]);

  // ---------------------------------------------------------------------------
  // Audio recorder
  // ---------------------------------------------------------------------------

  const { startRecording, stopRecording } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  // ---------------------------------------------------------------------------
  // Start a recording repetition
  // ---------------------------------------------------------------------------

  const startRecordingPhase = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      recordingRef.current ||
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

      recordingRef.current = true;
      stopRequestedRef.current = false;

      setLiveFrame(null);
      setLiveZone(null);
      setCurrentPhase('recording');

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

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        elapsedRef.current += RECORDING_INTERVAL_MS;
        setElapsedMs(elapsedRef.current);

        if (
          elapsedRef.current >=
          paramsRef.current.durationSec * 1000
        ) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }

          if (!stopRequestedRef.current) {
            stopRequestedRef.current = true;

            try {
              void Promise.resolve(
                stopRecordingRef.current?.(),
              ).catch(error => {
                console.error(
                  'Failed to stop Frequency Zone Stability recording:',
                  error,
                );
              });
            } catch (error) {
              console.error(
                'Failed to stop Frequency Zone Stability recording:',
                error,
              );
            }
          }
        }
      }, RECORDING_INTERVAL_MS);
    } catch (error) {
      console.error('Failed to start recording:', error);

      recordingRef.current = false;
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
        setCurrentPhase('instructions');
      }
    }
  }, [clearTimers, setCurrentPhase]);

  // ---------------------------------------------------------------------------
  // Countdown before recording
  // ---------------------------------------------------------------------------

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
    setCountdown(COUNTDOWN_SECONDS);
    setElapsedMs(0);
    elapsedRef.current = 0;
    setLiveFrame(null);
    setLiveZone(null);
    setCurrentPhase('countdown');

    let value = COUNTDOWN_SECONDS;

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
  }, [clearTimers, setCurrentPhase, startRecordingPhase]);

  useEffect(() => {
    beginCountdownRef.current = beginCountdown;
  }, [beginCountdown]);

  // ---------------------------------------------------------------------------
  // Rest between repetitions
  // ---------------------------------------------------------------------------

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

        repetitionRef.current += 1;
        setRepetition(repetitionRef.current);

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

  // ---------------------------------------------------------------------------
  // Exit prompt and pause handling
  // ---------------------------------------------------------------------------

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
      stopRequestedRef.current = true;
      recordingRef.current = false;
      processingRef.current = false;

      setElapsedMs(0);
      elapsedRef.current = 0;
      setLiveFrame(null);
      setLiveZone(null);
      pitchHistoryRef.current = [];

      try {
        void Promise.resolve(
          stopRecordingRef.current?.(),
        ).catch(error => {
          console.error('Failed to stop recording while pausing:', error);
        });
      } catch (error) {
        console.error('Failed to stop recording while pausing:', error);
      }
    } else if (currentPhase === 'countdown') {
      setCountdown(COUNTDOWN_SECONDS);
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
      recordingRef.current = false;
      processingRef.current = false;
      finishingRef.current = false;
      stopRequestedRef.current = false;
      discardNextStopRef.current = false;

      setElapsedMs(0);
      elapsedRef.current = 0;
      setLiveFrame(null);
      setLiveZone(null);
      pitchHistoryRef.current = [];

      beginCountdownRef.current?.();
      return;
    }

    if (pausedPhase === 'rest') {
      setCurrentPhase('rest');
      beginRestRef.current?.();
      return;
    }

    if (pausedPhase === 'processing') {
      if (progressSavedRef.current) {
        const savedResults = resultsRef.current;

        const averageScore =
          savedResults.reduce(
            (sum, item) => sum + item.score.score,
            0,
          ) / Math.max(savedResults.length, 1);

        setResult({
          score: Math.round(clamp(averageScore, 0, 100)),
          passed: savedResults.every(item => item.score.passed),
        });

        setCurrentPhase('results');
        return;
      }

      if (!finishingRef.current) {
        void finishExerciseRef.current?.(resultsRef.current);
      }
    }
  }, [setCurrentPhase]);

  // ---------------------------------------------------------------------------
  // Start or restart the exercise
  // ---------------------------------------------------------------------------

  const startExercise = useCallback(() => {
    if (
      !paramsRef.current ||
      !tierRef.current ||
      loadingParams ||
      quitInProgressRef.current
    ) {
      return;
    }

    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    quitInProgressRef.current = false;
    discardNextStopRef.current = false;
    stopRequestedRef.current = false;
    recordingRef.current = false;
    processingRef.current = false;
    finishingRef.current = false;
    progressSavedRef.current = false;

    resultsRef.current = [];
    repetitionRef.current = 1;
    pitchHistoryRef.current = [];
    elapsedRef.current = 0;

    setRepetitionResults([]);
    setResult(null);
    setRepetition(1);
    setElapsedMs(0);
    setLiveFrame(null);
    setLiveZone(null);
    setErrorMessage(null);
    setCountdown(COUNTDOWN_SECONDS);
    setRestCountdown(REST_SECONDS);
    setShowQuitModal(false);
    setIsQuitting(false);

    beginCountdown();
  }, [beginCountdown, clearTimers, loadingParams]);

  const handleRetry = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    stopRequestedRef.current = true;
    recordingRef.current = false;
    processingRef.current = false;
    finishingRef.current = false;

    try {
      void Promise.resolve(
        stopRecordingRef.current?.(),
      ).catch(error => {
        console.error(
          'Failed to stop recording before retry:',
          error,
        );
      });
    } catch (error) {
      console.error('Failed to stop recording before retry:', error);
    }

    resultsRef.current = [];
    repetitionRef.current = 1;
    pitchHistoryRef.current = [];
    elapsedRef.current = 0;
    progressSavedRef.current = false;

    setRepetitionResults([]);
    setResult(null);
    setRepetition(1);
    setElapsedMs(0);
    setLiveFrame(null);
    setLiveZone(null);
    setErrorMessage(null);
    setCountdown(COUNTDOWN_SECONDS);
    setRestCountdown(REST_SECONDS);
    setShowQuitModal(false);
    setIsQuitting(false);
    setCurrentPhase('instructions');
  }, [clearTimers, setCurrentPhase]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;
    stopRequestedRef.current = true;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();

    recordingRef.current = false;
    processingRef.current = false;
    finishingRef.current = true;

    try {
      await Promise.resolve(stopRecordingRef.current?.());
    } catch (error) {
      console.error(
        'Failed to stop recording before leaving:',
        error,
      );
    } finally {
      if (mountedRef.current) {
        router.replace('/dashboard?tab=exercises');
      }
    }
  }, [clearTimers]);

  const handleBack = useCallback(() => {
    pauseForExitPrompt();
  }, [pauseForExitPrompt]);

  // ---------------------------------------------------------------------------
  // Hardware back button
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

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
        ).catch(error => {
          console.error(
            'Failed to stop recording during cleanup:',
            error,
          );
        });
      } catch (error) {
        console.error(
          'Failed to stop recording during cleanup:',
          error,
        );
      }
    };
  }, [clearTimers]);

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const recordingProgress =
    params.durationSec > 0
      ? clamp(
          (elapsedMs / 1000 / params.durationSec) * 100,
          0,
          100,
        )
      : 0;

  const livePitch =
    liveFrame &&
    Number.isFinite(liveFrame.pitch) &&
    liveFrame.pitch > 0
      ? liveFrame.pitch
      : null;

  const liveIndicator =
    livePitch === null || !liveZone
      ? {
          color: GUIDE_RED,
          title: 'Listening for your voice',
          subtitle: 'Start singing to activate the frequency pulse.',
        }
      : {
          color: GUIDE_GREEN,
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

  // ---------------------------------------------------------------------------
  // Instructions screen content
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Quit confirmation modal
  // ---------------------------------------------------------------------------

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
            <Ionicons name="exit-outline" size={30} color={BROWN} />
          </View>

          <Text style={styles.modalTitle}>Quit exercise?</Text>

          <Text style={styles.modalMessage}>
            {pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Frequency Zone Stability?'
              : pausedPhaseRef.current === 'recording'
                ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                : pausedPhaseRef.current === 'countdown'
                  ? 'Your exercise is paused. Your completed repetitions will be kept, and the countdown will restart when you continue.'
                  : pausedPhaseRef.current === 'rest'
                    ? 'Your exercise is paused. Your completed repetitions will be kept, and your rest period will resume when you continue.'
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

  // ---------------------------------------------------------------------------
  // Loading screen
  // ---------------------------------------------------------------------------

  if (loadingParams) {
    return (
      <>
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
            Adjusting the exercise to your current difficulty level and
            preparing your vocal range.
          </Text>

          <ActivityIndicator
            size="large"
            color={BROWN}
            style={styles.preparingSpinner}
          />
        </View>

        {quitModal}
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Instructions screen
  // ---------------------------------------------------------------------------

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
          error={errorMessage}
        >
          <View style={styles.disclaimerCard}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={BROWN}
            />

            <Text style={styles.disclaimerText}>
              This is a frequency-based training indicator, not a direct
              measurement of physical resonance placement.
            </Text>
          </View>
        </ExerciseScreen>

        {quitModal}
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Countdown screen
  // ---------------------------------------------------------------------------

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="pulse"
          title="Frequency Zone Stability"
          currentRep={repetition}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Get Ready"
          prompt="Prepare to sing steadily and maintain a consistent frequency zone."
          onBack={handleBack}
        />

        {quitModal}
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Recording screen
  // ---------------------------------------------------------------------------

  if (phase === 'recording') {
    const elapsedSeconds = elapsedMs / 1000;
    const remainingSeconds = Math.max(
      0,
      params.durationSec - elapsedSeconds,
    );

    return (
      <>
        <View style={styles.recordingScreen}>
          <ScrollView
            style={styles.recordingScroll}
            contentContainerStyle={styles.recordingContent}
            showsVerticalScrollIndicator={false}
          >

            <Text style={styles.recordingTitle}>
              Hold Your Frequency
            </Text>

            <Text style={styles.recordingSubtitle}>
              Maintain a steady tone and keep your voice within the target
              frequency zone.
            </Text>

            <View style={styles.repPill}>
              <Ionicons
                name="repeat-outline"
                size={16}
                color={BROWN}
              />

              <Text style={styles.repPillText}>
                REPETITION {repetition} OF {params.repetitions}
              </Text>
            </View>

            <View style={styles.recordingProgressSection}>
              <View style={styles.recordingProgressLabels}>
                <Text style={styles.progressLabel}>RECORDING</Text>

                <Text style={styles.progressTime}>
                  {formatNumber(elapsedSeconds)}s / {params.durationSec}s
                </Text>
              </View>

              <View
                style={styles.progressTrack}
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
                    styles.progressFill,
                    { width: `${recordingProgress}%` },
                  ]}
                />
              </View>

              <Text style={styles.remainingText}>
                {formatNumber(remainingSeconds)} seconds remaining
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
                    Live Frequency Monitor
                  </Text>

                  <Text style={styles.liveCardSubtitle}>
                    Real-time microphone feedback
                  </Text>
                </View>

                <View style={styles.liveIndicatorPill}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.liveIndicatorText}>LIVE</Text>
                </View>
              </View>

              <FrequencyLiveWaveform
                pitch={livePitch}
                zone={liveZone}
                color={liveIndicator.color}
              />

              <View style={styles.liveMetricsRow}>
                <View style={styles.liveMetric}>
                  <Text style={styles.liveLabel}>
                    DETECTED FREQUENCY
                  </Text>

                  <Text style={styles.liveValue}>
                    {livePitch !== null
                      ? formatNumber(livePitch, 1)
                      : '--'}
                  </Text>

                  <Text style={styles.metricHint}>
                    {livePitch !== null ? 'Hz' : 'Waiting for pitch'}
                  </Text>
                </View>

                <View style={styles.liveDivider} />

                <View style={styles.liveMetric}>
                  <Text style={styles.liveLabel}>CURRENT ZONE</Text>

                  <Text
                    style={[
                      styles.liveValue,
                      {
                        color: liveZone ? GUIDE_GREEN : GUIDE_RED,
                      },
                    ]}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                  >
                    {liveZone ? zoneLabel(liveZone) : '--'}
                  </Text>

                  <Text style={styles.metricHint}>
                    Detected frequency zone
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
                Keep your voice steady until the timer finishes. Aim to
                remain in the target frequency zone without sudden shifts.
              </Text>
            </View>
          </ScrollView>
        </View>

        {quitModal}
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Rest screen
  // ---------------------------------------------------------------------------

  if (phase === 'rest') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="pulse"
          title="Frequency Zone Stability"
          currentRep={repetition}
          repetitions={params.repetitions}
          countdown={restCountdown}
          promptTitle="Rest"
          prompt="Relax your voice and prepare for the next repetition."
          onBack={handleBack}
        />

        {quitModal}
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Processing screen
  // ---------------------------------------------------------------------------

  if (phase === 'processing') {
    return (
      <>
        <ExerciseProcessingScreen
          icon="pulse"
          title="Analyzing Your Performance"
          message="Analyzing your frequency stability..."
          onBack={handleBack}
        />

        {quitModal}
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Results screen
  // ---------------------------------------------------------------------------

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
          <View style={styles.resultDetailsCard}>
            <View style={styles.resultDetailRow}>
              <Text style={styles.resultDetailLabel}>Stability</Text>
              <Text style={styles.resultDetailValue}>
                {formatNumber(averageStability)}%
              </Text>
            </View>

            <View style={styles.resultDivider} />

            <View style={styles.resultDetailRow}>
              <Text style={styles.resultDetailLabel}>Repetitions</Text>
              <Text style={styles.resultDetailValue}>
                {passedRepetitions}/{repetitionResults.length}
              </Text>
            </View>

            <View style={styles.resultDivider} />

            <View style={styles.resultDetailRow}>
              <Text style={styles.resultDetailLabel}>Average Score</Text>
              <Text style={styles.resultDetailValue}>
                {averageScore}%
              </Text>
            </View>
          </View>
        </ExerciseResultsScreen>

        {quitModal}
      </>
    );
  }

  return <>{quitModal}</>;
}

// -----------------------------------------------------------------------------
// Styles — only styles used by this screen
// -----------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Loading
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
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 285,
  },
  preparingSpinner: {
    marginTop: 24,
  },

  // Instructions disclaimer
  disclaimerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  disclaimerText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    marginLeft: 9,
  },

  // Recording screen
  recordingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    paddingHorizontal: 22,
    paddingTop: 60,
    paddingBottom: 20,
  },
  recordingScroll: {
    flex: 1,
  },
  recordingContent: {
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 28,
  },
  recordingTitle: {
    marginTop: 12,
    paddingHorizontal: 8,
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
  },
  recordingSubtitle: {
    width: '100%',
    maxWidth: 320,
    marginTop: 6,
    paddingHorizontal: 4,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
    textAlign: 'center',
  },
  repPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 22,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: PINK,
  },
  repPillText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.6,
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

  // Live monitor card
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
  liveIndicatorText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.7,
    color: GUIDE_RED,
  },

  // Waveform
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
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    textAlign: 'center',
  },

  // Live metrics
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
    marginBottom: 5,
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: MUTED,
    textAlign: 'center',
  },
  liveValue: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    textAlign: 'center',
  },
  metricHint: {
    marginTop: 3,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    textAlign: 'center',
  },

  // Recording tip
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

  // Results
  resultDetailsCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    marginBottom: 2,
  },
  resultDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultDetailLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
  },
  resultDetailValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },
  resultDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },

  // Quit modal
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