import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Alert, BackHandler, Text, View } from 'react-native';

import {
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
  EXERCISE_RECORDING_INTERVAL_MS,
} from '@/constants/appConstants';
import {
  SCALE_ACCURACY_PARAMS,
  type ScaleAccuracyParams,
  type Tier,
} from '@/constants/params';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { generateScaleAccuracyParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureScaleAccuracyDrill } from '@/services/measurement/pitch/scaleAccuracyDrill';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import {
  scoreScaleAccuracyDrill,
  type ScaleAccuracyScoreResult,
} from '@/services/scoring/pitch/scaleAccuracyDrill';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import {
  calcLiveStability,
  calcPitchAccuracy,
  segmentIntoNotes,
} from '@/utils/dsp/pitch';
import { averageFinite } from '@/utils/math';
import {
  disposeNotePlayer,
  playNoteSequence,
} from '@/utils/music/notePlayer';
import {
  frequencyToNoteName,
  getRandomScale,
  type VocalRange,
} from '@/utils/music/notes';

import { exerciseStyles } from '@/constants/exerciseStyles';
import { LivePitchIndicator as ExerciseLivePitchIndicator } from '@/screens/exercises/Pitch/LivePitchIndicator';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
  MetricCard,
} from '../ExerciseScreen';

import {
  ExerciseNoAudioModal,
  ExerciseQuitModal,
} from '@/components/ExerciseModals';

const NOTE_DURATION_SECONDS = 0.8;
const RECORDING_MIN_DURATION_MS = 5000;
const RECORDING_MS_PER_NOTE = 1250;

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

interface SavedRecording {
  samples: Float32Array;
  sampleRate: number;
}



function generateScale(
  params: ScaleAccuracyParams,
  tier: Tier,
  vocalRange: VocalRange | null,
) {
  const noteCount = Math.min(
    Math.max(1, Math.round(params.noteCount)),
    8,
  );

  return getRandomScale(tier, noteCount, vocalRange);
}

function averagePositive(values: number[]): number {
  return averageFinite(
    values.filter(value => Number.isFinite(value) && value > 0),
  );
}

function aggregateScaleResults(
  results: ScaleAccuracyScoreResult[],
  targetFreqs: number[],
): ScaleAccuracyScoreResult {
  if (results.length === 0) {
    return {
      score: 0,
      passed: false,
      noteAccuracy: 0,
      transitionSmoothness: 0,
      correctNotes: 0,
      totalNotes: targetFreqs.length,
      detectedFreqs: targetFreqs.map(() => 0),
      targetFreqs,
      noteScores: targetFreqs.map(() => 0),
      noteDeviations: targetFreqs.map(() => 100),
      averageClarity: 0,
      voicedNotes: 0,
    };
  }

  return {
    score: Math.round(averageFinite(results.map(item => item.score))),
    passed: results.every(item => item.passed),
    noteAccuracy: averageFinite(results.map(item => item.noteAccuracy)),
    transitionSmoothness: averageFinite(
      results.map(item => item.transitionSmoothness),
    ),
    correctNotes: results.reduce(
      (sum, item) => sum + item.correctNotes,
      0,
    ),
    totalNotes: results.reduce(
      (sum, item) => sum + item.totalNotes,
      0,
    ),
    detectedFreqs: targetFreqs.map((_, index) =>
      averagePositive(
        results.map(item => item.detectedFreqs[index] ?? 0),
      ),
    ),
    targetFreqs,
    noteScores: targetFreqs.map((_, index) =>
      averageFinite(results.map(item => item.noteScores[index] ?? 0)),
    ),
    noteDeviations: targetFreqs.map((_, index) => {
      const deviations = results
        .map(item => item.noteDeviations[index])
        .filter(
          (value): value is number => Number.isFinite(value),
        );

      return deviations.length > 0 ? averageFinite(deviations) : 100;
    }),
    averageClarity: averageFinite(
      results.map(item => item.averageClarity),
    ),
    voicedNotes: results.reduce(
      (sum, item) => sum + item.voicedNotes,
      0,
    ),
  };
}



export default function ScaleAccuracyDrillScreen({ tier }: Props) {
  const initialTier = tier ?? 'beginner';

  const [currentTier, setCurrentTier] = useState<Tier>(initialTier);
  const [params, setParams] = useState<ScaleAccuracyParams>(
    SCALE_ACCURACY_PARAMS[initialTier],
  );
  const [isLoadingParams, setIsLoadingParams] =
    useState(true);

  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [currentNoteIndex, setCurrentNoteIndex] = useState(-1);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);
  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);

  const [targetNotes, setTargetNotes] = useState(() =>
    generateScale(
      SCALE_ACCURACY_PARAMS[initialTier],
      initialTier,
      null,
    ),
  );

  const [liveAudioFrame, setLiveAudioFrame] = useState<LiveAudioFrame | null>(null);
  const [liveFrequencies, setLiveFrequencies] = useState<number[]>([]);
  const [result, setResult] = useState<ScaleAccuracyScoreResult | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const mountedRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const isQuittingRef = useRef(false);
  const pausedRef = useRef(false);

  const targetNotesRef = useRef(targetNotes);
  const currentRepRef = useRef(1);
  const recordingsRef = useRef<SavedRecording[]>([]);
  const pitchHistoryRef = useRef<number[]>([]);
  const recordingElapsedRef = useRef(0);

  const isRecordingRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);
  const processingRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const stopPendingForQuitRef = useRef(false);
  const resumeAfterDiscardRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const transitionTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const beginRepCountdownRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }, []);

  const resetLiveData = useCallback(() => {
    pitchHistoryRef.current = [];
    recordingElapsedRef.current = 0;

    setLiveAudioFrame(null);
    setLiveFrequencies([]);
    setCurrentNoteIndex(-1);
    setRecordingElapsedMs(0);
  }, []);

  const resetRecordingState = useCallback(() => {
    isRecordingRef.current = false;
    startingRecordingRef.current = false;
    recordingStopRequestedRef.current = false;
    processingRef.current = false;
    recordingElapsedRef.current = 0;
    pitchHistoryRef.current = [];

    setLiveAudioFrame(null);
    setLiveFrequencies([]);
    setCurrentNoteIndex(-1);
    setRecordingElapsedMs(0);
  }, []);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      isQuittingRef.current ||
      discardNextStopRef.current ||
      !isRecordingRef.current
    ) {
      return;
    }

    setLiveAudioFrame(frame);

    if (Number.isFinite(frame.pitch) && frame.pitch > 0) {
      pitchHistoryRef.current = [
        ...pitchHistoryRef.current,
        frame.pitch,
      ].slice(-30);

      setLiveFrequencies(pitchHistoryRef.current);
    }
  }, []);

  const handleRecordingStop = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      isRecordingRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        stopPendingForQuitRef.current = false;
        startingRecordingRef.current = false;
        recordingStopRequestedRef.current = false;
        recordingElapsedRef.current = 0;
        pitchHistoryRef.current = [];

        if (mountedRef.current && !isQuittingRef.current) {
          setLiveAudioFrame(null);
          setLiveFrequencies([]);
          setCurrentNoteIndex(-1);
          setRecordingElapsedMs(0);
        }

        if (
          mountedRef.current &&
          resumeAfterDiscardRef.current &&
          !showQuitModalRef.current &&
          !isQuittingRef.current
        ) {
          resumeAfterDiscardRef.current = false;
          pausedRef.current = false;
          resetLiveData();
          beginRepCountdownRef.current();
        }

        return;
      }

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        isQuittingRef.current ||
        !recordingStopRequestedRef.current
      ) {
        return;
      }

      if (!hasSufficientRecordedSignal(samples)) {
        recordingStopRequestedRef.current = false;
        startingRecordingRef.current = false;
        processingRef.current = false;
        setErrorMessage(null);
        setPhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      recordingsRef.current.push({
        samples: new Float32Array(samples),
        sampleRate,
      });

      recordingStopRequestedRef.current = false;
      startingRecordingRef.current = false;
      recordingElapsedRef.current = 0;
      setRecordingElapsedMs(0);

      const isLastRep = currentRepRef.current >= params.repetitions;

      if (!isLastRep) {
        const nextRep = currentRepRef.current + 1;

        currentRepRef.current = nextRep;
        setCurrentRep(nextRep);
        resetLiveData();

        transitionTimerRef.current = setTimeout(() => {
          transitionTimerRef.current = null;

          if (
            !mountedRef.current ||
            pausedRef.current ||
            showQuitModalRef.current ||
            isQuittingRef.current
          ) {
            return;
          }

          beginRepCountdownRef.current();
        }, 500);

        return;
      }

      if (processingRef.current) {
        return;
      }

      processingRef.current = true;
      setPhase('processing');

      try {
        await new Promise<void>(resolve => {
          setTimeout(resolve, 150);
        });

        if (!mountedRef.current || isQuittingRef.current) {
          return;
        }

        const targetFreqs = targetNotesRef.current.map(
          note => note.frequency,
        );
        const scores: ScaleAccuracyScoreResult[] = [];

        for (const recording of recordingsRef.current) {
          if (!mountedRef.current || isQuittingRef.current) {
            return;
          }

          const segments = segmentIntoNotes(
            recording.samples,
            targetFreqs.length,
            0.01,
            recording.sampleRate,
          );

          const measurement = measureScaleAccuracyDrill(
            segments,
            targetFreqs,
            recording.sampleRate,
            params.minClarity,
          );

          scores.push(scoreScaleAccuracyDrill(measurement, params));
        }

        if (!mountedRef.current || isQuittingRef.current) {
          return;
        }

        const finalResult = aggregateScaleResults(scores, targetFreqs);

        await saveCompletedExercise(
          'pitch',
          'scaleAccuracyDrill',
          currentTier,
          finalResult.score,
        );

        if (!mountedRef.current || isQuittingRef.current) {
          return;
        }

        setResult(finalResult);
        setPhase('results');
      } catch (errorMessage) {
        console.error('Scale processing failed:', errorMessage);

        if (mountedRef.current && !isQuittingRef.current) {
          setErrorMessage(
            'We could not analyze your recordings. Please try again.',
          );
          setPhase('instructions');
        }
      } finally {
        processingRef.current = false;
        recordingStopRequestedRef.current = false;
      }
    },
    [currentTier, params, resetLiveData, setPhase],
  );

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    stopRecordingRef.current = stopRecording;

    return () => {
      stopRecordingRef.current = null;
    };
  }, [stopRecording]);

  const beginRecording = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      isQuittingRef.current ||
      discardNextStopRef.current ||
      stopPendingForQuitRef.current ||
      isRecordingRef.current ||
      startingRecordingRef.current ||
      processingRef.current
    ) {
      return;
    }

    startingRecordingRef.current = true;
    recordingStopRequestedRef.current = false;

    try {
      resetLiveData();
      setPhase('recording');

      await startRecording();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        isQuittingRef.current
      ) {
        discardNextStopRef.current = true;
        stopPendingForQuitRef.current = true;
        recordingStopRequestedRef.current = true;

        try {
          await stopRecording();
        } catch (errorMessage) {
          console.warn(
            'Failed to stop recording after interruption:',
            errorMessage,
          );
        }

        isRecordingRef.current = false;
        startingRecordingRef.current = false;
        return;
      }

      isRecordingRef.current = true;

      const noteCount = Math.max(1, targetNotesRef.current.length);
      const recordingDuration = Math.max(
        RECORDING_MIN_DURATION_MS,
        noteCount * RECORDING_MS_PER_NOTE,
      );
      const noteDuration = recordingDuration / noteCount;
      let lastTickAt = Date.now();

      recordingTimerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsedDelta = now - lastTickAt;
        lastTickAt = now;

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          isQuittingRef.current ||
          !isRecordingRef.current ||
          recordingStopRequestedRef.current
        ) {
          return;
        }

        recordingElapsedRef.current += elapsedDelta;

        const elapsedMs = recordingElapsedRef.current;
        setRecordingElapsedMs(elapsedMs);
        const nextNoteIndex = Math.min(
          Math.floor(elapsedMs / noteDuration),
          noteCount - 1,
        );

        setCurrentNoteIndex(nextNoteIndex);

        if (elapsedMs < recordingDuration) {
          return;
        }

        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        recordingStopRequestedRef.current = true;

        void stopRecordingRef.current?.().catch(errorMessage => {
          console.error('Failed to stop scale recording:', errorMessage);

          isRecordingRef.current = false;
          recordingStopRequestedRef.current = false;

          if (
            mountedRef.current &&
            !pausedRef.current &&
            !showQuitModalRef.current
          ) {
            setErrorMessage(
              'We could not finish the recording. Please try again.',
            );
            setPhase('instructions');
          }
        });
      }, EXERCISE_RECORDING_INTERVAL_MS);
    } catch (errorMessage) {
      console.error('Failed to start scale recording:', errorMessage);

      isRecordingRef.current = false;
      recordingStopRequestedRef.current = false;

      if (
        mountedRef.current &&
        !pausedRef.current &&
        !showQuitModalRef.current
      ) {
        setErrorMessage(
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
        setPhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    } finally {
      startingRecordingRef.current = false;
    }
  }, [resetLiveData, startRecording, stopRecording, setPhase]);

  const playScaleAndRecord = useCallback(async () => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      isQuittingRef.current
    ) {
      return;
    }

    try {
      setPhase('listening');
      setCurrentNoteIndex(0);

      const sequence = targetNotesRef.current.map(note => ({
        frequencyHz: note.frequency,
        durationSec: NOTE_DURATION_SECONDS,
      }));

      await playNoteSequence(sequence);

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        isQuittingRef.current
      ) {
        return;
      }

      await beginRecording();
    } catch (errorMessage) {
      if (
        pausedRef.current ||
        showQuitModalRef.current ||
        isQuittingRef.current
      ) {
        return;
      }

      console.error('Failed to play scale or start recording:', errorMessage);

      if (mountedRef.current) {
        setErrorMessage(
          'Unable to play the target scale or start recording. Please try again.',
        );
        setPhase('instructions');

        Alert.alert(
          'Audio Error',
          'Unable to play the target scale. Please try again.',
        );
      }
    }
  }, [beginRecording, setPhase]);

  const beginRepCountdown = useCallback(() => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      isQuittingRef.current ||
      stopPendingForQuitRef.current
    ) {
      return;
    }

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setCurrentNoteIndex(-1);
    setLiveAudioFrame(null);
    setLiveFrequencies([]);
    setPhase('countdown');

    let value = EXERCISE_COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        isQuittingRef.current
      ) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }

        return;
      }

      value--;

      if (value <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !showQuitModalRef.current &&
          !isQuittingRef.current
        ) {
          void playScaleAndRecord();
        }

        return;
      }

      setCountdown(value);
    }, 1000);
  }, [playScaleAndRecord, setPhase]);

  useEffect(() => {
    beginRepCountdownRef.current = beginRepCountdown;
  }, [beginRepCountdown]);

  const startCountdown = useCallback(() => {
    if (
      isLoadingParams ||
      showQuitModalRef.current ||
      isQuittingRef.current ||
      stopPendingForQuitRef.current
    ) {
      return;
    }

    clearTimers();

    const newScale = generateScale(params, currentTier, vocalRange);

    targetNotesRef.current = newScale;
    setTargetNotes(newScale);

    recordingsRef.current = [];
    currentRepRef.current = 1;
    setCurrentRep(1);

    pausedRef.current = false;
    discardNextStopRef.current = false;
    stopPendingForQuitRef.current = false;
    resumeAfterDiscardRef.current = false;

    resetRecordingState();
    setResult(null);
    setErrorMessage(null);
    beginRepCountdown();
  }, [
    beginRepCountdown,
    clearTimers,
    currentTier,
    isLoadingParams,
    params,
    resetRecordingState,
    vocalRange,
  ]);

  const retry = useCallback(() => {
    clearTimers();

    const recorderMayBeActive =
      isRecordingRef.current ||
      startingRecordingRef.current ||
      isRecording;

    pausedRef.current = true;
    showQuitModalRef.current = false;
    isQuittingRef.current = false;
    resumeAfterDiscardRef.current = false;

    setShowQuitModal(false);
    setIsQuitting(false);

    if (recorderMayBeActive || stopPendingForQuitRef.current) {
      discardNextStopRef.current = true;
      stopPendingForQuitRef.current = true;
      recordingStopRequestedRef.current = true;

      void stopRecordingRef.current?.().catch(errorMessage => {
        console.warn('Failed to stop recorder before retry:', errorMessage);
      });

      setErrorMessage(
        'The microphone is still stopping. Please retry in a moment.',
      );
      setPhase('instructions');
      return;
    }

    recordingsRef.current = [];
    currentRepRef.current = 1;
    setCurrentRep(1);

    discardNextStopRef.current = false;
    stopPendingForQuitRef.current = false;

    resetRecordingState();
    setResult(null);
    setErrorMessage(null);
    setPhase('instructions');
    pausedRef.current = false;
  }, [clearTimers, isRecording, resetRecordingState, setPhase]);

  const openQuitModal = useCallback(() => {
    if (showQuitModalRef.current || isQuittingRef.current) {
      return;
    }

    const interruptedPhase = phaseRef.current;

    pausedPhaseRef.current = interruptedPhase;
    pausedRef.current = true;
    showQuitModalRef.current = true;

    clearTimers();
    setShowQuitModal(true);

    void disposeNotePlayer().catch(errorMessage => {
      console.warn('Could not stop target audio:', errorMessage);
    });

    const recorderMayBeActive =
      isRecordingRef.current ||
      startingRecordingRef.current ||
      isRecording;

    if (recorderMayBeActive) {
      discardNextStopRef.current = true;
      stopPendingForQuitRef.current = true;
      recordingStopRequestedRef.current = true;
      isRecordingRef.current = false;
      startingRecordingRef.current = false;
      resumeAfterDiscardRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      try {
        const stopPromise = stopRecordingRef.current?.();

        if (stopPromise) {
          void stopPromise.catch(errorMessage => {
            console.warn(
              'Could not stop recording while opening quit modal:',
              errorMessage,
            );
          });
        }
      } catch (errorMessage) {
        console.warn(
          'Could not stop recording while opening quit modal:',
          errorMessage,
        );
      }
    }
  }, [clearTimers, isRecording]);

  const continueExercise = useCallback(() => {
    if (isQuittingRef.current) {
      return;
    }

    const interruptedPhase = pausedPhaseRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);

    if (
      interruptedPhase === 'instructions' ||
      interruptedPhase === 'results'
    ) {
      pausedRef.current = false;
      return;
    }

    if (interruptedPhase === 'processing') {
      pausedRef.current = false;
      return;
    }

    if (stopPendingForQuitRef.current) {
      resumeAfterDiscardRef.current = true;
      return;
    }

    pausedRef.current = false;

    resetLiveData();
    beginRepCountdownRef.current();
  }, [resetLiveData]);

  const quitExercise = useCallback(async () => {
    if (isQuittingRef.current) {
      return;
    }

    isQuittingRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    resumeAfterDiscardRef.current = false;

    setIsQuitting(true);
    setShowQuitModal(false);

    clearTimers();

    const recorderMayBeActive =
      isRecordingRef.current ||
      startingRecordingRef.current ||
      isRecording;

    if (recorderMayBeActive || stopPendingForQuitRef.current) {
      discardNextStopRef.current = true;
      stopPendingForQuitRef.current = true;
      recordingStopRequestedRef.current = true;
      isRecordingRef.current = false;
      startingRecordingRef.current = false;

      try {
        await Promise.resolve(stopRecordingRef.current?.());
      } catch (errorMessage) {
        console.warn('Could not stop recording while leaving:', errorMessage);
      }
    }

    try {
      await disposeNotePlayer();
    } catch (errorMessage) {
      console.warn('Could not dispose note player:', errorMessage);
    }

    router.replace('/exercises/pitch');
  }, [clearTimers, isRecording]);

  const goBack = useCallback(() => {
    openQuitModal();
  }, [openQuitModal]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
      showQuitModalRef.current = false;
      resumeAfterDiscardRef.current = false;

      clearTimers();

      if (isRecordingRef.current || startingRecordingRef.current) {
        discardNextStopRef.current = true;
        recordingStopRequestedRef.current = true;

        try {
          void stopRecordingRef.current?.().catch(errorMessage => {
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
      }

      void disposeNotePlayer().catch(errorMessage => {
        console.warn('Failed to dispose note player:', errorMessage);
      });
    };
  }, [clearTimers]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) {
          continueExercise();
          return true;
        }

        openQuitModal();
        return true;
      },
    );

    return () => subscription.remove();
  }, [continueExercise, openQuitModal]);

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParams() {
      setIsLoadingParams(true);

      try {
        const user = auth.currentUser;
        let resolvedTier: Tier = tier ?? 'beginner';

        if (!tier && user) {
          const progress = await fetchComponentProgress(
            user.uid,
            'pitch',
          );

          if (cancelled) return;

          resolvedTier = progress?.currentTier ?? 'beginner';
        }

        if (cancelled) return;

        setCurrentTier(resolvedTier);

        let recentScores: number[] = [];
        let assessmentVocalRange: VocalRange | null = null;

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'pitch',
          );

          if (cancelled) return;

          recentScores = records
            .filter(
              record =>
                record.tier === resolvedTier &&
                record.templateId === 'scaleAccuracyDrill',
            )
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-5)
            .map(record => record.scorePct);

          const assessment = await getLatestAssessment();

          if (cancelled) return;

          assessmentVocalRange = assessment?.vocalRange ?? null;
          setVocalRange(assessmentVocalRange);

          if (recentScores.length === 0) {
            const pitchScore = assessment?.scores.find(
              score => score.componentId === 'pitch',
            );

            if (typeof pitchScore?.scorePct === 'number') {
              recentScores = [pitchScore.scorePct];
            }
          }
        } else {
          setVocalRange(null);
        }

        const generatedParams = generateScaleAccuracyParams({
          tier: resolvedTier,
          recentScores,
        });

        if (cancelled) return;

        setParams(generatedParams);

        const newScale = generateScale(
          generatedParams,
          resolvedTier,
          assessmentVocalRange,
        );

        targetNotesRef.current = newScale;
        setTargetNotes(newScale);
      } catch (errorMessage) {
        console.error(
          'Failed to load scale accuracy parameters:',
          errorMessage,
        );

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';

          setCurrentTier(fallbackTier);
          setParams(SCALE_ACCURACY_PARAMS[fallbackTier]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingParams(false);
        }
      }
    }

    void loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  const currentTarget =
    currentNoteIndex >= 0 && currentNoteIndex < targetNotes.length
      ? targetNotes[currentNoteIndex]
      : null;

  const detectedFrequency =
    liveAudioFrame && Number.isFinite(liveAudioFrame.pitch) && liveAudioFrame.pitch > 0
      ? liveAudioFrame.pitch
      : null;

  const detectedNote = detectedFrequency
    ? liveAudioFrame?.note ?? null
    : null;

  const hasLivePitch = detectedFrequency !== null;

  const liveAccuracy =
    hasLivePitch && currentTarget
      ? calcPitchAccuracy(detectedFrequency, currentTarget.frequency)
      : 0;

  const liveStability = calcLiveStability(liveFrequencies);

  const modalMessage =
    pausedPhaseRef.current === 'instructions' ||
    pausedPhaseRef.current === 'results'
      ? 'Are you sure you want to leave Scale Accuracy Drill?'
      : pausedPhaseRef.current === 'recording'
        ? 'Your exercise is paused. Completed repetitions will be kept, and the current repetition will restart when you continue.'
        : pausedPhaseRef.current === 'processing'
          ? 'Your exercise is paused while your recordings are being analyzed. Continue to return to your exercise.'
          : 'Your exercise is paused. Completed repetitions will be kept. Continue to resume your exercise.';

  const quitModal = (
    <>
      <ExerciseQuitModal
        visible={showQuitModal}
        title="Quit exercise?"
        message={modalMessage}
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
          setErrorMessage(null);
          beginRepCountdownRef.current();
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

  if (phase === 'instructions') {
    return (
      <>
        <ExerciseScreen
          title="Scale Accuracy Drill"
          category="Pitch"
          icon="stats-chart-outline"
          tier={currentTier}
          instructions="Listen to the target scale first. After the scale finishes, sing the notes back one at a time in the same order. Try to land accurately on every note and make each transition smooth."
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
          targetValue={`${params.noteCount} notes`}
          tip="Sing each note clearly before moving to the next one."
          onBack={goBack}
          onStart={startCountdown}
          errorMessage={errorMessage ?? undefined}
          startDisabled={isLoadingParams}
          startLabel={
            isLoadingParams
              ? 'Preparing Exercise...'
              : 'Start Exercise'
          }
        />

        {quitModal}
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="musical-notes-outline"
          title="Get Ready"
          currentRep={currentRep}
          repetitions={params.repetitions}
          countdown={countdown}
          promptTitle="Listen carefully"
          prompt="Listen carefully to the target scale."
          onBack={goBack}
        />

        {quitModal}
      </>
    );
  }

  if (phase === 'listening') {
    return (
      <>
        <ExerciseListeningScreen
          icon="volume-high-outline"
          title="Listen to the Scale"
          currentRep={currentRep}
          repetitions={params.repetitions}
          promptTitle="Listen to the target scale"
          prompt="Listen to the target scale first. After it finishes, sing the notes back in the same order."
          liveContent={
            <View style={exerciseStyles.sharedScalePreview}>
              {targetNotes.map((note, index) => (
                <View
                  key={`${note.name}-${index}`}
                  style={exerciseStyles.sharedScaleNote}
                >
                  <Text style={exerciseStyles.scoreRowValue}>
                    {note.name}
                  </Text>
                </View>
              ))}
            </View>
          }
          progress={100}
        />

        {quitModal}
      </>
    );
  }

  const recordingDurationMs = Math.max(
    RECORDING_MIN_DURATION_MS,
    targetNotes.length * RECORDING_MS_PER_NOTE,
  );
  const recordingProgress = Math.min(
    recordingElapsedMs / recordingDurationMs,
    1,
  );

  if (phase === 'recording') {
    return (
      <>
        <View style={exerciseStyles.recordingScreenVariant1}>
          <View style={exerciseStyles.recordingIcon}>
            <Ionicons name="mic" size={34} color={COLORS.brown} />
          </View>

          <Text style={exerciseStyles.phaseTitleVariant1}>Sing the Scale</Text>

          <Text style={exerciseStyles.recordingSubtitleVariant1}>
            Repetition {currentRep} of {params.repetitions}
          </Text>

          <View style={exerciseStyles.scalePreview}>
            {targetNotes.map((note, index) => {
              const active = index === currentNoteIndex;
              const completed = index < currentNoteIndex;

              return (
                <View
                  key={`${note.name}-${index}`}
                  style={[
                    exerciseStyles.previewNote,
                    completed && exerciseStyles.previewNoteCompleted,
                    active && exerciseStyles.previewNoteActive,
                  ]}
                >
                  {completed && (
                    <Ionicons
                      name="checkmark"
                      size={11}
                      color={COLORS.guideGreen}
                      style={exerciseStyles.previewCheck}
                    />
                  )}

                  <Text
                    style={[
                      exerciseStyles.previewNoteText,
                      completed && exerciseStyles.statusTextSuccess,
                      active && exerciseStyles.liveNoteDetected,
                    ]}
                  >
                    {note.name}
                  </Text>
                </View>
              );
            })}
          </View>

          <ExerciseLivePitchIndicator
            targetNote={currentTarget?.name ?? '--'}
            targetFrequency={currentTarget?.frequency ?? null}
            detectedNote={detectedNote}
            detectedFrequency={detectedFrequency}
          >
            <View style={exerciseStyles.metricsGridInline}>
              <MetricCard
                label="ACCURACY"
                variant="noteMatching"
                value={
                  hasLivePitch && currentTarget
                    ? `${Math.round(liveAccuracy)}%`
                    : '--'
                }
              />
              <MetricCard
                label="STABILITY"
                variant="noteMatching"
                value={
                  liveFrequencies.length > 0
                    ? `${Math.round(liveStability)}%`
                    : '--'
                }
              />
              <MetricCard
                label="FREQUENCY"
                variant="noteMatching"
                value={
                  hasLivePitch
                    ? `${Math.round(detectedFrequency)} Hz`
                    : '-- Hz'
                }
              />
            </View>
          </ExerciseLivePitchIndicator>

          <View
            style={exerciseStyles.timerTrack}
            accessibilityRole="progressbar"
            accessibilityLabel="Recording progress"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: Math.round(recordingProgress * 100),
            }}
          >
            <View
              style={[
                exerciseStyles.timerFill,
                { width: `${recordingProgress * 100}%` },
              ]}
            />
          </View>
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
          title="Analyzing Your Singing"
          message={`Analyzing all ${params.repetitions} repetitions and calculating your final score...`}
        />

        {quitModal}
      </>
    );
  }

  if (phase === 'results' && result) {
    return (
      <>
        <ExerciseResultsScreen
          title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
          subtitle={`Scale Accuracy Result • ${params.repetitions} repetitions`}
          score={result.score}
          resultIcon={result.passed ? 'checkmark' : 'refresh'}
          scoreSuffix="%"
          scoreMessage={`${result.correctNotes} of ${result.totalNotes} notes matched across all repetitions`}
          onBack={goBack}
          onRetry={retry}
          onExit={goBack}
        >
          <View style={exerciseStyles.resultCard}>
            <Text style={exerciseStyles.resultCardTitle}>Note Accuracy</Text>

            <View style={exerciseStyles.resultRow}>
              <Text style={exerciseStyles.scoreRowLabel}>Accurate notes</Text>
              <Text style={exerciseStyles.timeText}>
                {Math.round(result.noteAccuracy)}%
              </Text>
            </View>

            <View style={exerciseStyles.resultRow}>
              <Text style={exerciseStyles.scoreRowLabel}>
                Transition smoothness
              </Text>
              <Text style={exerciseStyles.timeText}>
                {Math.round(result.transitionSmoothness)}%
              </Text>
            </View>

            <View style={exerciseStyles.resultRow}>
              <Text style={exerciseStyles.scoreRowLabel}>Average clarity</Text>
              <Text style={exerciseStyles.timeText}>
                {Math.round(result.averageClarity * 100)}%
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.resultCard}>
            <Text style={exerciseStyles.resultCardTitle}>Your Notes</Text>

            {targetNotes.map((target, index) => {
              const detected = result.detectedFreqs[index] ?? 0;
              const noteScore = result.noteScores[index] ?? 0;
              const deviation =
                result.noteDeviations[index] ?? Infinity;

              const noteName =
                detected > 0 ? frequencyToNoteName(detected) : '--';

              const correct =
                detected > 0 &&
                deviation <= params.tolerancePct;

              return (
                <View
                  key={`${target.name}-${index}`}
                  style={exerciseStyles.noteResultRow}
                >
                  <View style={exerciseStyles.noteNumberVariant1}>
                    <Text style={exerciseStyles.volumeGuideText}>
                      {index + 1}
                    </Text>
                  </View>

                  <View style={exerciseStyles.feedbackContent}>
                    <Text style={exerciseStyles.volumeGuideText}>
                      Target: {target.name}
                    </Text>

                    <Text style={exerciseStyles.assessmentDate}>
                      Detected: {noteName}
                    </Text>
                  </View>

                  <View
                    style={[
                      exerciseStyles.noteStatus,
                      correct && exerciseStyles.noteStatusCorrect,
                    ]}
                  >
                    <Ionicons
                      name={correct ? 'checkmark' : 'close'}
                      size={15}
                      color={COLORS.brown}
                    />

                    <Text style={exerciseStyles.noteStatusText}>
                      {Math.round(noteScore)}%
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          <View style={exerciseStyles.tipCard}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={COLORS.brown}
            />

            <Text style={exerciseStyles.tipText}>
              {result.passed
                ? 'Your notes were consistently accurate across the repetitions. Continue practicing smooth transitions for even greater consistency.'
                : 'Focus on landing directly on each target note and maintaining accuracy across every repetition.'}
            </Text>
          </View>
        </ExerciseResultsScreen>

        {quitModal}
      </>
    );
  }

  return quitModal;
}
