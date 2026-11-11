import { ExerciseNoAudioModal, ExerciseQuitModal } from '@/components/ExerciseModals';
import { COLORS, EXERCISE_COUNTDOWN_SECONDS, EXERCISE_REFERENCE_NOTE_DURATION_SECONDS, PITCH_GUIDE_MAX_CENTS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { NOTE_MATCHING_PARAMS, type Tier } from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { LivePitchIndicator as ExerciseLivePitchIndicator } from '@/screens/exercises/Pitch/LivePitchIndicator';
import { generateNoteMatchingParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureNoteMatching } from '@/services/measurement/pitch/noteMatching';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreNoteMatching } from '@/services/scoring/pitch/noteMatching';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { calcLiveStability, calcPitchAccuracy } from '@/utils/dsp/pitch';
import { clamp } from '@/utils/math';
import { disposeNotePlayer, playSingleNote } from '@/utils/music/notePlayer';
import { frequencyToNoteName, getRandomPitchNote, type VocalRange } from '@/utils/music/notes';
import { formatFrequency } from '@/utils/numberFormatting';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, ScrollView, Text, View } from 'react-native';
import ExerciseScreen, { ExerciseCountdownScreen, ExerciseListeningScreen, ExercisePreparingScreen, ExerciseProcessingScreen, ExerciseResultsScreen, MetricCard } from '../ExerciseScreen';

const RECORDING_DURATION_SECONDS = 4;
const PITCH_HISTORY_LIMIT = 20;
const GUIDE_TRACE_LIMIT = 18;

type Phase =
  | 'instructions'
  | 'countdown'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'results';

type Props = {
  tier?: Tier;
};

type LivePitchState = {
  pitch: number;
  note: string;
  stability: number;
};

type ExerciseResult = {
  score: number;
  passed: boolean;
  detectedFrequency: number;
  averageClarity: number;
  voicedFrames: number;
};

type PitchGuideStatus = {
  label: string;
  color: string;
  cents: number | null;
  position: number;
  hint: string;
};

function calculateCentsDifference(
  detectedFrequency: number,
  targetFrequency: number,
): number {
  if (
    !Number.isFinite(detectedFrequency) ||
    !Number.isFinite(targetFrequency) ||
    detectedFrequency <= 0 ||
    targetFrequency <= 0
  ) {
    return 0;
  }

  return 1200 * Math.log2(detectedFrequency / targetFrequency);
}



function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return '--';
  if (Math.abs(cents) < 0.5) return '0 cents';

  return `${cents > 0 ? '+' : ''}${Math.round(cents)} cents`;
}

function getFeedback(
  result: ExerciseResult,
  cents: number,
  targetNote: string,
): string {
  if (result.detectedFrequency <= 0) {
    return `We couldn't detect enough reliable pitch information. Try singing closer to the microphone and hold ${targetNote} steadily.`;
  }

  if (result.passed) {
    return `Excellent pitch matching! Your voice stayed close to ${targetNote} across the repetitions. Keep practicing controlled and steady pitch placement.`;
  }

  if (Math.abs(cents) <= 50) {
    return `You were very close to ${targetNote}. Listen carefully to the reference note and make small adjustments while sustaining it.`;
  }

  if (cents > 0) {
    return `Your detected pitch was higher than ${targetNote}. Try relaxing your voice slightly and aim a little lower.`;
  }

  return `Your detected pitch was lower than ${targetNote}. Try supporting the note steadily and aim slightly higher.`;
}

export default function NoteMatchingScreen({ tier }: Props) {
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [currentTier, setCurrentTier] = useState<Tier>(
    tier ?? 'beginner',
  );
  const [adaptiveParams, setAdaptiveParams] = useState(
    NOTE_MATCHING_PARAMS[tier ?? 'beginner'],
  );
  const [isLoadingParams, setIsLoadingParams] =
    useState(true);
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [livePitch, setLivePitch] = useState<LivePitchState>({
    pitch: 0,
    note: '--',
    stability: 0,
  });
  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [pitchTrace, setPitchTrace] = useState<number[]>([]);

  const mountedRef = useRef(true);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const pausedRepetitionRef = useRef(1);
  const pausedPhaseRef = useRef<Phase>('instructions');
  const pitchHistoryRef = useRef<number[]>([]);
  const repetitionResultsRef = useRef<ExerciseResult[]>([]);
  const currentRepRef = useRef(1);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const startingRef = useRef(false);
  const finishingRef = useRef(false);

  const startRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const startRecordingAttemptRef =
    useRef<(() => Promise<void>) | null>(null);
  const beginCountdownRef = useRef<(() => void) | null>(null);
  const continueAfterProcessingRef = useRef<(() => void) | null>(null);

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

  const resetLivePitch = useCallback(() => {
    pitchHistoryRef.current = [];
    setPitchTrace([]);
    setLivePitch({
      pitch: 0,
      note: '--',
      stability: 0,
    });
  }, []);

  const target = useMemo(
    () => getRandomPitchNote(currentTier, vocalRange),
    [currentTier, vocalRange],
  );

  const targetFrequency = target.frequency;
  const targetNote = target.name;





  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParameters() {
      setIsLoadingParams(true);

      try {
        const user = auth.currentUser;
        let resolvedTier: Tier = tier ?? 'beginner';

        if (!tier && user) {
          const progress = await fetchComponentProgress(
            user.uid,
            'pitch',
          );

          resolvedTier = progress?.currentTier ?? 'beginner';
        }

        if (cancelled) return;

        setCurrentTier(resolvedTier);

        let recentScores: number[] = [];
        const assessment = await getLatestAssessment();

        if (cancelled) return;

        setVocalRange(assessment?.vocalRange ?? null);

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'pitch',
          );

          if (cancelled) return;

          const matchingRecords = records
            .filter(
              record =>
                record.tier === resolvedTier &&
                record.templateId === 'noteMatchingExercise',
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          recentScores = matchingRecords
            .slice(-5)
            .map(record => record.scorePct);
        }

        if (recentScores.length === 0) {
          const assessmentScore = assessment?.scores.find(
            score => score.componentId === 'pitch',
          );

          if (typeof assessmentScore?.scorePct === 'number') {
            recentScores = [assessmentScore.scorePct];
          }
        }

        if (cancelled) return;

        setAdaptiveParams(
          generateNoteMatchingParams({
            tier: resolvedTier,
            recentScores,
          }),
        );
      } catch (errorMessage) {
        console.error('Note Matching ADS error:', errorMessage);

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';
          setCurrentTier(fallbackTier);
          setAdaptiveParams(NOTE_MATCHING_PARAMS[fallbackTier]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingParams(false);
        }
      }
    }

    void loadAdaptiveParameters();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  const handleLiveFrame = useCallback(
    (frame: { pitch: number; note: string; clarity: number }) => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      if (Number.isFinite(frame.pitch) && frame.pitch > 0) {
        const history = [
          ...pitchHistoryRef.current,
          frame.pitch,
        ].slice(-PITCH_HISTORY_LIMIT);

        pitchHistoryRef.current = history;

        setLivePitch({
          pitch: frame.pitch,
          note: frame.note || '--',
          stability: calcLiveStability(history),
        });

        const cents = calculateCentsDifference(
          frame.pitch,
          targetFrequency,
        );

        const normalized = clamp(
          cents / PITCH_GUIDE_MAX_CENTS,
          -1,
          1,
        );

        setPitchTrace(previous =>
          [...previous, normalized].slice(-GUIDE_TRACE_LIMIT),
        );

        return;
      }

      setLivePitch(previous => ({
        ...previous,
        pitch: 0,
        note: '--',
      }));
    },
    [targetFrequency],
  );

  const processCompletedResults = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const results = repetitionResultsRef.current;

    if (results.length === 0) {
      finishingRef.current = false;
      startingRef.current = false;
      setPhase('instructions');
      setErrorMessage(
        'No repetition results were available. Please try again.',
      );
      return;
    }

    if (results.length < adaptiveParams.repetitions) {
      const nextRep = results.length + 1;

      currentRepRef.current = nextRep;
      setCurrentRep(nextRep);
      setElapsedSeconds(0);
      resetLivePitch();

      finishingRef.current = false;
      startingRef.current = false;
      beginCountdownRef.current?.();

      return;
    }

    const finalScore = Math.round(
      results.reduce((sum, item) => sum + item.score, 0) /
        results.length,
    );

    const detectedResults = results.filter(
      item => item.detectedFrequency > 0,
    );

    const averageDetectedFrequency =
      detectedResults.length > 0
        ? detectedResults.reduce(
            (sum, item) => sum + item.detectedFrequency,
            0,
          ) / detectedResults.length
        : 0;

    const averageClarity =
      results.reduce((sum, item) => sum + item.averageClarity, 0) /
      results.length;

    const totalVoicedFrames = results.reduce(
      (sum, item) => sum + item.voicedFrames,
      0,
    );

    const passed = results.every(item => item.passed);

    try {
      await saveCompletedExercise(
        'pitch',
        'noteMatchingExercise',
        currentTier,
        finalScore,
      );
    } catch (errorMessage) {
      console.error('Failed to save Note Matching progress:', errorMessage);
    }

    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    setResult({
      score: finalScore,
      passed,
      detectedFrequency: averageDetectedFrequency,
      averageClarity,
      voicedFrames: totalVoicedFrames,
    });

    finishingRef.current = false;
    startingRef.current = false;
    setPhase('results');
  }, [
    adaptiveParams.repetitions,
    setPhase,
    currentTier,
    resetLivePitch,
    targetFrequency,
  ]);

  useEffect(() => {
    continueAfterProcessingRef.current = () => {
      void processCompletedResults();
    };
  }, [processCompletedResults]);

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: (samples: Float32Array, sampleRate: number) => {
      clearTimers();

      if (
        !mountedRef.current ||
        quitInProgressRef.current ||
        discardNextStopRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        phaseRef.current !== 'recording'
      ) {
        discardNextStopRef.current = false;
        startingRef.current = false;
        finishingRef.current = false;
        return;
      }

      finishingRef.current = true;

      if (!hasSufficientRecordedSignal(samples)) {
        finishingRef.current = false;
        startingRef.current = false;
        resetLivePitch();
        setPhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      setPhase('processing');

      try {
        const measurement = measureNoteMatching(
          samples,
          sampleRate,
          adaptiveParams.minClarity,
        );

        const scored = scoreNoteMatching(
          measurement,
          targetFrequency,
          adaptiveParams,
        );

        const repetitionResult: ExerciseResult = {
          score: scored.score,
          passed: scored.passed,
          detectedFrequency: scored.detectedFrequency,
          averageClarity: scored.averageClarity,
          voicedFrames: measurement.voicedFrames,
        };

        repetitionResultsRef.current = [
          ...repetitionResultsRef.current,
          repetitionResult,
        ];

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current
        ) {
          return;
        }

        void processCompletedResults();
      } catch (errorMessage) {
        console.error('Note Matching analysis error:', errorMessage);

        if (mountedRef.current && !pausedRef.current) {
          setErrorMessage(
            'We could not analyze your recording. Please try again.',
          );
          setPhase('instructions');
        }

        finishingRef.current = false;
        startingRef.current = false;
      }
    },
  });

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  const startRecordingAttempt = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      startingRef.current
    ) {
      return;
    }

    const start = startRecordingRef.current;

    if (!start) {
      setErrorMessage(
        'The audio recorder is not ready. Please try again.',
      );
      setPhase('instructions');
      return;
    }

    clearTimers();
    resetLivePitch();
    setElapsedSeconds(0);

    startingRef.current = true;
    finishingRef.current = false;
    setPhase('recording');

    try {
      await start();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      const startTime = Date.now();

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          finishingRef.current ||
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        const elapsedSeconds = (Date.now() - startTime) / 1000;

        setElapsedSeconds(
          Math.min(elapsedSeconds, RECORDING_DURATION_SECONDS),
        );

        if (elapsedSeconds >= RECORDING_DURATION_SECONDS) {
          clearTimers();

          if (!finishingRef.current) {
            finishingRef.current = true;

            try {
              stopRecordingRef.current?.();
            } catch (errorMessage) {
              console.error('Failed to stop recording:', errorMessage);
              finishingRef.current = false;
            }
          }
        }
      }, 100);
    } catch (errorMessage) {
      console.error('Failed to start Note Matching recording:', errorMessage);

      clearTimers();
      startingRef.current = false;
      finishingRef.current = false;

      if (mountedRef.current && !pausedRef.current) {
        setErrorMessage(
          'We could not start recording. Please check your microphone permission and try again.',
        );
        setPhase('instructions');
      }
    }
  }, [setPhase, clearTimers, resetLivePitch]);

  useEffect(() => {
    startRecordingAttemptRef.current = startRecordingAttempt;
  }, [startRecordingAttempt]);

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
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setPhase('countdown');

    let remaining = EXERCISE_COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      remaining -= 1;

      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }

      clearTimers();
      setCountdown(0);
      setPhase('listening');

      void playSingleNote(
        targetFrequency,
        EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
      )
        .then(async () => {
          if (
            !mountedRef.current ||
            pausedRef.current ||
            showQuitModalRef.current ||
            quitInProgressRef.current
          ) {
            return;
          }

          await startRecordingAttemptRef.current?.();
        })
        .catch(errorMessage => {
          console.error('Failed to start Note Matching:', errorMessage);

          startingRef.current = false;

          if (mountedRef.current && !pausedRef.current) {
            setErrorMessage(
              'We could not start the exercise. Please check your microphone permission and try again.',
            );
            setPhase('instructions');
          }
        });
    }, 1000);
  }, [setPhase, clearTimers, targetFrequency]);

  useEffect(() => {
    beginCountdownRef.current = beginCountdown;
  }, [beginCountdown]);

  const openQuitModal = useCallback(() => {
    if (quitInProgressRef.current || showQuitModalRef.current) {
      return;
    }

    const activeScreen = phaseRef.current;

    pausedPhaseRef.current = activeScreen;
    pausedRepetitionRef.current = currentRepRef.current;

    pausedRef.current = true;
    showQuitModalRef.current = true;
    clearTimers();

    if (activeScreen === 'recording') {
      discardNextStopRef.current = true;
      startingRef.current = false;
      finishingRef.current = true;
      setElapsedSeconds(0);
      resetLivePitch();

      try {
        void Promise.resolve(
          stopRecordingRef.current?.(),
        ).catch(errorMessage => {
          console.error(
            'Failed to stop interrupted recording:',
            errorMessage,
          );
        });
      } catch (errorMessage) {
        console.error(
          'Failed to stop interrupted recording:',
          errorMessage,
        );
      }
    }

    setShowQuitModal(true);
  }, [clearTimers, resetLivePitch]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    const interruptedScreen = pausedPhaseRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    pausedRef.current = false;

    if (
      interruptedScreen === 'instructions' ||
      interruptedScreen === 'results'
    ) {
      return;
    }

    if (interruptedScreen === 'processing') {
      startingRef.current = false;
      finishingRef.current = true;
      continueAfterProcessingRef.current?.();
      return;
    }

    currentRepRef.current = pausedRepetitionRef.current;
    setCurrentRep(pausedRepetitionRef.current);
    setElapsedSeconds(0);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    resetLivePitch();

    startingRef.current = false;
    finishingRef.current = false;
    discardNextStopRef.current = false;

    beginCountdownRef.current?.();
  }, [resetLivePitch]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();
    startingRef.current = false;
    finishingRef.current = true;

    try {
      await Promise.resolve(stopRecordingRef.current?.());
    } catch (errorMessage) {
      console.error(
        'Failed to stop recording before leaving:',
        errorMessage,
      );
    }

    try {
      await disposeNotePlayer();
    } catch (errorMessage) {
      console.warn('Failed to dispose note player:', errorMessage);
    }

    if (mountedRef.current) {
      router.replace('/exercises/pitch');
    }
  }, [clearTimers]);

  const goBack = useCallback(() => {
    openQuitModal();
  }, [openQuitModal]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) return true;

        openQuitModal();
        return true;
      },
    );

    return () => subscription.remove();
  }, [openQuitModal]);

  const startExercise = useCallback(() => {
    if (
      startingRef.current ||
      isLoadingParams ||
      pausedRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    clearTimers();

    startingRef.current = false;
    finishingRef.current = false;
    pausedRef.current = false;
    quitInProgressRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = false;

    pitchHistoryRef.current = [];
    repetitionResultsRef.current = [];
    currentRepRef.current = 1;

    setCurrentRep(1);
    setErrorMessage('');
    setResult(null);
    setShowQuitModal(false);
    setIsQuitting(false);
    setElapsedSeconds(0);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    resetLivePitch();
    beginCountdown();
  }, [
    beginCountdown,
    clearTimers,
    isLoadingParams,
    resetLivePitch,
  ]);

  const retryExercise = useCallback(() => {
    clearTimers();

    pausedRef.current = false;
    quitInProgressRef.current = false;
    showQuitModalRef.current = false;
    discardNextStopRef.current = true;

    startingRef.current = false;
    finishingRef.current = true;

    try {
      void Promise.resolve(
        stopRecordingRef.current?.(),
      ).catch(errorMessage => {
        console.error('Failed to stop recorder before retry:', errorMessage);
      });
    } catch (errorMessage) {
      console.error('Failed to stop recorder before retry:', errorMessage);
    }

    pitchHistoryRef.current = [];
    repetitionResultsRef.current = [];
    currentRepRef.current = 1;

    setShowQuitModal(false);
    setIsQuitting(false);
    setCurrentRep(1);
    setResult(null);
    setErrorMessage('');
    setElapsedSeconds(0);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    resetLivePitch();

    finishingRef.current = false;
    setPhase('instructions');
  }, [setPhase, clearTimers, resetLivePitch]);

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
          console.warn(
            'Failed to stop recorder during cleanup:',
            errorMessage,
          );
        });
      } catch (errorMessage) {
        console.warn(
          'Failed to stop recorder during cleanup:',
          errorMessage,
        );
      }

      void disposeNotePlayer().catch(errorMessage => {
        console.warn('Failed to dispose note player:', errorMessage);
      });
    };
  }, [clearTimers]);

  const quitModal = (
    <>
      <ExerciseQuitModal
        visible={showQuitModal}
        title="Quit exercise?"
        message={
          pausedPhaseRef.current === 'instructions' ||
          pausedPhaseRef.current === 'results'
            ? 'Are you sure you want to leave Note Matching?'
            : pausedPhaseRef.current === 'recording'
              ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
              : pausedPhaseRef.current === 'processing'
                ? 'Your exercise is paused. Continue to resume processing your current results.'
                : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'
        }
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => {
          void quitExercise();
        }}
        continueLabel="Continue Exercise"
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />

      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={() => {
          setShowNoAudioModal(false);
          currentRepRef.current = repetitionResultsRef.current.length + 1;
          setCurrentRep(currentRepRef.current);
          setElapsedSeconds(0);
          setErrorMessage('');
          finishingRef.current = false;
          startingRef.current = false;
          resetLivePitch();
          beginCountdownRef.current?.();
        }}
        onQuit={() => {
          void quitExercise();
        }}
        isQuitting={isQuitting}
      />
    </>
  );

  if (phase === 'instructions' && isLoadingParams) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level"
          icon="options-outline"
          iconSize={44}
          containerStyle={exerciseStyles.centerScreen}
        />
        {quitModal}
      </>
    );
  }

  return (
    <>
      {phase === 'instructions' && (
        <ExerciseScreen
          title="Note Matching Exercise"
          category="Pitch"
          icon="musical-note-outline"
          instructions={
            'Listen carefully to the target note first.\n\n' +
            'After the target note finishes, sing the same note back.\n\n' +
            'Hold the note steadily and try to match the pitch as closely as possible.'
          }
          preparationSteps={[
            {
              icon: 'volume-mute-outline',
              text: 'Find a quiet room or area with minimal background noise.',
            },
            {
              icon: 'body-outline',
              text: 'Sit upright or stand with your back straight and your shoulders relaxed.',
            },
            {
              icon: 'mic-outline',
              text: 'If available, an external microphone or audio recording equipment is recommended.',
            },
          ]}
          summary={[
            { label: 'Target Note', value: targetNote },
            {
              label: 'Frequency',
              value: formatFrequency(targetFrequency),
            },
            {
              label: 'Repetitions',
              value: String(adaptiveParams.repetitions),
            },
          ]}
          tip="Sing comfortably and make small adjustments until your pitch matches the target."
          tier={currentTier}
          onBack={goBack}
          onStart={beginCountdown}
          errorMessage={errorMessage}
          startDisabled={isLoadingParams}
        />
      )}

      {phase === 'countdown' && (
        <ExerciseCountdownScreen
          icon="musical-notes-outline"
          title="Get Ready"
          currentRep={currentRep}
          repetitions={adaptiveParams.repetitions}
          countdown={countdown}
          promptTitle="Your target note is"
          prompt={`${targetNote} • ${formatFrequency(targetFrequency)}`}
          onBack={goBack}
        />
      )}

      {phase === 'listening' && (
        <ExerciseListeningScreen
          icon="volume-high-outline"
          title="Listen to the Note"
          currentRep={currentRep}
          repetitions={adaptiveParams.repetitions}
          promptTitle="Listen to the reference note"
          prompt="Listen to the reference note, then sing the same note."
          liveContent={
            <View style={exerciseStyles.sharedListenNoteBox}>
              <Text style={exerciseStyles.liveLabel}>TARGET NOTE</Text>
              <Text style={exerciseStyles.largeNote}>{targetNote}</Text>
              <Text style={exerciseStyles.stateFrequency}>
                {formatFrequency(targetFrequency)}
              </Text>
            </View>
          }
          progress={100}
        />
      )}

      {phase === 'recording' && (
        <View style={exerciseStyles.screen}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={exerciseStyles.recordingContentVariant2}
          >
            <View style={exerciseStyles.recordingIcon}>
              <Ionicons name="mic" size={30} color={COLORS.brown} />
            </View>

            <Text style={exerciseStyles.phaseTitle}>Sing the Note</Text>
            <Text style={exerciseStyles.recordingSubtitle}>
              Repetition {currentRep} of {adaptiveParams.repetitions}
            </Text>

            <ExerciseLivePitchIndicator
              targetNote={targetNote}
              targetFrequency={targetFrequency}
              detectedNote={livePitch.pitch > 0 ? livePitch.note : null}
              detectedFrequency={livePitch.pitch > 0 ? livePitch.pitch : null}
              pitchTrace={pitchTrace}
            >
              <View style={exerciseStyles.metricsGridInline}>
                <MetricCard
                  label="ACCURACY"
                  variant="noteMatching"
                  value={
                    livePitch.pitch > 0
                      ? `${Math.round(
                          clamp(
                            calcPitchAccuracy(
                              livePitch.pitch,
                              targetFrequency,
                            ),
                            0,
                            100,
                          ),
                        )}%`
                      : '--'
                  }
                />

                <MetricCard
                  label="STABILITY"
                  variant="noteMatching"
                  value={
                    livePitch.pitch > 0
                      ? `${Math.round(livePitch.stability)}%`
                      : '--'
                  }
                />

                <MetricCard
                  label="FREQUENCY"
                  variant="noteMatching"
                  value={
                    livePitch.pitch > 0
                      ? `${livePitch.pitch.toFixed(0)} Hz`
                      : '-- Hz'
                  }
                />
              </View>
            </ExerciseLivePitchIndicator>

            <View style={exerciseStyles.timerTrack}>
              <View
                style={[
                  exerciseStyles.timerFill,
                  {
                    width: `${
                      clamp(
                        elapsedSeconds / RECORDING_DURATION_SECONDS,
                        0,
                        1,
                      ) * 100
                    }%`,
                  },
                ]}
              />
            </View>
          </ScrollView>
        </View>
      )}

      {phase === 'processing' && (
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing Your Singing"
          message={
            currentRep < adaptiveParams.repetitions
              ? `Checking repetition ${currentRep} of ${adaptiveParams.repetitions}.`
              : 'Calculating your final Note Matching result.'
          }
        />
      )}

      {phase === 'results' && result && (
        <ExerciseResultsScreen
          title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
          subtitle={`Note Matching Result • ${adaptiveParams.repetitions} repetitions`}
          score={result.score}
          resultIcon={result.passed ? 'checkmark' : 'refresh'}
          scoreMessage={
            result.passed
              ? 'You matched the target note accurately across all repetitions.'
              : 'Keep practicing your pitch placement across each repetition.'
          }
          onRetry={retryExercise}
          onExit={goBack}
        >
          <View style={exerciseStyles.resultCard}>
            <Text style={exerciseStyles.resultCardTitle}>
              Pitch Comparison
            </Text>

            <View style={exerciseStyles.resultDetailRow}>
              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.comparisonLabel}>TARGET</Text>
                <Text style={exerciseStyles.comparisonNote}>{targetNote}</Text>
                <Text style={exerciseStyles.comparisonFrequency}>
                  {formatFrequency(targetFrequency)}
                </Text>
              </View>

              <Ionicons
                name="arrow-forward"
                size={23}
                color={COLORS.muted}
              />

              <View
                style={[
                  exerciseStyles.infoText,
                  exerciseStyles.detectedComparison,
                ]}
              >
                <Text style={exerciseStyles.comparisonLabel}>
                  AVERAGE DETECTED
                </Text>
                <Text style={exerciseStyles.comparisonNote}>
                  {result.detectedFrequency > 0
                    ? frequencyToNoteName(result.detectedFrequency)
                    : '--'}
                </Text>
                <Text style={exerciseStyles.comparisonFrequency}>
                  {formatFrequency(result.detectedFrequency)}
                </Text>
              </View>
            </View>
          </View>

          <View style={exerciseStyles.resultsGrid}>
            <MetricCard
              label="PITCH ACCURACY"
              variant="noteMatching"
              value={`${result.score}%`}
            />

            <MetricCard
              label="DEVIATION"
              variant="noteMatching"
              value={
                result.detectedFrequency > 0
                  ? formatCents(
                      calculateCentsDifference(
                        result.detectedFrequency,
                        targetFrequency,
                      ),
                    )
                  : '--'
              }
            />

            <MetricCard
              label="AVG. CLARITY"
              variant="noteMatching"
              value={`${Math.round(result.averageClarity * 100)}%`}
            />

            <MetricCard
              label="VOICED FRAMES"
              variant="noteMatching"
              value={String(result.voicedFrames)}
            />
          </View>

          <View style={exerciseStyles.feedbackCardVariant2}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={COLORS.brown}
            />

            <View style={exerciseStyles.feedbackContent}>
              <Text style={exerciseStyles.resultDetailValue}>Feedback</Text>
              <Text style={exerciseStyles.feedbackBodyText}>
                {getFeedback(
                  result,
                  result.detectedFrequency > 0
                    ? calculateCentsDifference(
                        result.detectedFrequency,
                        targetFrequency,
                      )
                    : 0,
                  targetNote,
                )}
              </Text>
            </View>
          </View>
        </ExerciseResultsScreen>
      )}

      {quitModal}
    </>
  );
}
