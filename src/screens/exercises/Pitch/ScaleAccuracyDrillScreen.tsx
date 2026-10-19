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
  SCALE_ACCURACY_PARAMS,
  type ScaleAccuracyParams,
  type Tier,
} from '@/constants/exercises/pitch';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
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
import {
  calcLiveStability,
  calcPitchAccuracy,
  frequencyToNote,
  segmentIntoNotes,
} from '@/utils/dsp/pitch';
import {
  disposeNotePlayer,
  playNoteSequence,
} from '@/utils/music/notePlayer';
import {
  getRandomScale,
  type VocalRange,
} from '@/utils/music/notes';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '../ExerciseScreen';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const COUNTDOWN_SECONDS = 3;
const NOTE_DURATION_SECONDS = 0.8;
const RECORDING_MIN_DURATION_MS = 5000;
const RECORDING_MS_PER_NOTE = 1250;
const RECORDING_INTERVAL_MS = 100;

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

interface QuitExerciseModalProps {
  visible: boolean;
  message: string;
  onContinue: () => void;
  onQuit: () => void;
  quitting: boolean;
}

function QuitExerciseModal({
  visible,
  message,
  onContinue,
  onQuit,
  quitting,
}: QuitExerciseModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onContinue}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.quitModalCard}>
          <View style={styles.quitIconCircle}>
            <Ionicons
              name="exit-outline"
              size={30}
              color={BROWN}
            />
          </View>

          <Text style={styles.quitModalTitle}>
            Quit exercise?
          </Text>

          <Text style={styles.quitModalMessage}>
            {message}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            disabled={quitting}
            onPress={onContinue}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.modalButtonPressed,
              quitting && styles.modalButtonDisabled,
            ]}
          >
            <Text style={styles.continueButtonText}>
              Continue Exercise
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
            disabled={quitting}
            onPress={onQuit}
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.modalButtonPressed,
              quitting && styles.modalButtonDisabled,
            ]}
          >
            <Text style={styles.quitButtonText}>
              {quitting ? 'Stopping...' : 'Quit Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
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

function average(values: number[]): number {
  const validValues = values.filter(Number.isFinite);

  if (validValues.length === 0) {
    return 0;
  }

  return (
    validValues.reduce((sum, value) => sum + value, 0) /
    validValues.length
  );
}

function averagePositive(values: number[]): number {
  return average(
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
    score: Math.round(average(results.map(item => item.score))),
    passed: results.every(item => item.passed),
    noteAccuracy: average(results.map(item => item.noteAccuracy)),
    transitionSmoothness: average(
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
      average(results.map(item => item.noteScores[index] ?? 0)),
    ),
    noteDeviations: targetFreqs.map((_, index) => {
      const deviations = results
        .map(item => item.noteDeviations[index])
        .filter(
          (value): value is number => Number.isFinite(value),
        );

      return deviations.length > 0 ? average(deviations) : 100;
    }),
    averageClarity: average(
      results.map(item => item.averageClarity),
    ),
    voicedNotes: results.reduce(
      (sum, item) => sum + item.voicedNotes,
      0,
    ),
  };
}

export default function ScaleAccuracyDrillScreen({
  tier,
}: Props) {
  const initialTier = tier ?? 'beginner';

  const [currentTier, setCurrentTier] = useState<Tier>(initialTier);
  const [params, setParams] = useState<ScaleAccuracyParams>(
    SCALE_ACCURACY_PARAMS[initialTier],
  );
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [currentNoteIndex, setCurrentNoteIndex] = useState(-1);
  const [currentRep, setCurrentRep] = useState(1);
  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  const [targetNotes, setTargetNotes] = useState(() =>
    generateScale(
      SCALE_ACCURACY_PARAMS[initialTier],
      initialTier,
      null,
    ),
  );

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);
  const [liveFrequencies, setLiveFrequencies] = useState<number[]>([]);
  const [result, setResult] =
    useState<ScaleAccuracyScoreResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const mountedRef = useRef(false);
  const phaseRef = useRef<Phase>('instructions');
  const showQuitModalRef = useRef(false);
  const isQuittingRef = useRef(false);
  const pausedRef = useRef(false);

  const targetNotesRef = useRef(targetNotes);
  const currentRepRef = useRef(1);
  const recordingsRef = useRef<SavedRecording[]>([]);
  const pitchHistoryRef = useRef<number[]>([]);
  const recordingElapsedRef = useRef(0);

  const recordingRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const processingRef = useRef(false);
  const discardNextStopRef = useRef(false);
  const stopPendingForQuitRef = useRef(false);
  const resumeAfterDiscardRef = useRef(false);
  const interruptedPhaseRef = useRef<Phase>('instructions');

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const transitionTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRecordingRef =
    useRef<(() => Promise<void>) | null>(null);
  const beginRepCountdownRef = useRef<() => void>(() => {});

  const updatePhase = useCallback((nextPhase: Phase) => {
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

    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }, []);

  const resetLiveData = useCallback(() => {
    pitchHistoryRef.current = [];
    recordingElapsedRef.current = 0;

    setLiveFrame(null);
    setLiveFrequencies([]);
    setCurrentNoteIndex(-1);
  }, []);

  const resetRecordingState = useCallback(() => {
    recordingRef.current = false;
    startingRecordingRef.current = false;
    stopRequestedRef.current = false;
    processingRef.current = false;
    recordingElapsedRef.current = 0;
    pitchHistoryRef.current = [];

    setLiveFrame(null);
    setLiveFrequencies([]);
    setCurrentNoteIndex(-1);
  }, []);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (
      !mountedRef.current ||
      pausedRef.current ||
      showQuitModalRef.current ||
      isQuittingRef.current ||
      discardNextStopRef.current ||
      !recordingRef.current
    ) {
      return;
    }

    setLiveFrame(frame);

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
      recordingRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      /*
       * Consume the stop callback for an interrupted recording.
       * Never score audio captured before or during the quit modal.
       */
      if (discardNextStopRef.current) {
        discardNextStopRef.current = false;
        stopPendingForQuitRef.current = false;
        startingRecordingRef.current = false;
        stopRequestedRef.current = false;
        recordingElapsedRef.current = 0;
        pitchHistoryRef.current = [];

        if (mountedRef.current && !isQuittingRef.current) {
          setLiveFrame(null);
          setLiveFrequencies([]);
          setCurrentNoteIndex(-1);
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
        !stopRequestedRef.current
      ) {
        return;
      }

      recordingsRef.current.push({
        samples: new Float32Array(samples),
        sampleRate,
      });

      stopRequestedRef.current = false;
      startingRecordingRef.current = false;
      recordingElapsedRef.current = 0;

      const isLastRep =
        currentRepRef.current >= params.repetitions;

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
      updatePhase('processing');

      try {
        await new Promise<void>(resolve => {
          setTimeout(resolve, 150);
        });

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          isQuittingRef.current
        ) {
          return;
        }

        const targetFreqs = targetNotesRef.current.map(
          note => note.frequency,
        );
        const scores: ScaleAccuracyScoreResult[] = [];

        for (const recording of recordingsRef.current) {
          if (
            !mountedRef.current ||
            pausedRef.current ||
            showQuitModalRef.current ||
            isQuittingRef.current
          ) {
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

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          isQuittingRef.current
        ) {
          return;
        }

        const finalResult = aggregateScaleResults(
          scores,
          targetFreqs,
        );

        await saveCompletedExercise(
          'pitch',
          'scaleAccuracyDrill',
          currentTier,
          finalResult.score,
        );

        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          isQuittingRef.current
        ) {
          return;
        }

        setResult(finalResult);
        updatePhase('results');
      } catch (error) {
        console.error('Scale processing failed:', error);

        if (
          mountedRef.current &&
          !pausedRef.current &&
          !showQuitModalRef.current &&
          !isQuittingRef.current
        ) {
          setErrorMessage(
            'We could not analyze your recordings. Please try again.',
          );
          updatePhase('instructions');
        }
      } finally {
        processingRef.current = false;
        stopRequestedRef.current = false;
      }
    },
    [
      currentTier,
      params,
      resetLiveData,
      updatePhase,
    ],
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
      recordingRef.current ||
      startingRecordingRef.current ||
      processingRef.current
    ) {
      return;
    }

    startingRecordingRef.current = true;
    stopRequestedRef.current = false;

    try {
      resetLiveData();
      updatePhase('recording');

      await startRecording();

      /*
       * The modal can open while native recording startup is pending.
       * Stop and discard that recording before allowing a restart.
       */
      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        isQuittingRef.current
      ) {
        discardNextStopRef.current = true;
        stopPendingForQuitRef.current = true;
        stopRequestedRef.current = true;

        try {
          await stopRecording();
        } catch (error) {
          console.warn(
            'Failed to stop recording after interruption:',
            error,
          );
        }

        recordingRef.current = false;
        startingRecordingRef.current = false;
        return;
      }

      recordingRef.current = true;

      const noteCount = Math.max(
        1,
        targetNotesRef.current.length,
      );
      const recordingDuration = Math.max(
        RECORDING_MIN_DURATION_MS,
        noteCount * RECORDING_MS_PER_NOTE,
      );
      const noteDuration = recordingDuration / noteCount;

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          isQuittingRef.current ||
          !recordingRef.current ||
          stopRequestedRef.current
        ) {
          return;
        }

        recordingElapsedRef.current += RECORDING_INTERVAL_MS;

        const elapsedMs = recordingElapsedRef.current;
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

        stopRequestedRef.current = true;

        void stopRecordingRef.current?.().catch(error => {
          console.error('Failed to stop scale recording:', error);

          recordingRef.current = false;
          stopRequestedRef.current = false;

          if (
            mountedRef.current &&
            !pausedRef.current &&
            !showQuitModalRef.current
          ) {
            setErrorMessage(
              'We could not finish the recording. Please try again.',
            );
            updatePhase('instructions');
          }
        });
      }, RECORDING_INTERVAL_MS);
    } catch (error) {
      console.error('Failed to start scale recording:', error);

      recordingRef.current = false;
      stopRequestedRef.current = false;

      if (
        mountedRef.current &&
        !pausedRef.current &&
        !showQuitModalRef.current
      ) {
        setErrorMessage(
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
        updatePhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    } finally {
      startingRecordingRef.current = false;
    }
  }, [resetLiveData, startRecording, updatePhase]);

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
      updatePhase('listening');
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
    } catch (error) {
      if (
        pausedRef.current ||
        showQuitModalRef.current ||
        isQuittingRef.current
      ) {
        return;
      }

      console.error('Failed to play scale or start recording:', error);

      if (mountedRef.current) {
        setErrorMessage(
          'Unable to play the target scale or start recording. Please try again.',
        );
        updatePhase('instructions');

        Alert.alert(
          'Audio Error',
          'Unable to play the target scale. Please try again.',
        );
      }
    }
  }, [beginRecording, updatePhase]);

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

    setCountdown(COUNTDOWN_SECONDS);
    setCurrentNoteIndex(-1);
    setLiveFrame(null);
    setLiveFrequencies([]);
    updatePhase('countdown');

    let value = COUNTDOWN_SECONDS;

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
  }, [playScaleAndRecord, updatePhase]);

  useEffect(() => {
    beginRepCountdownRef.current = beginRepCountdown;
  }, [beginRepCountdown]);

  const startCountdown = useCallback(() => {
    if (
      isLoadingAdaptiveParams ||
      showQuitModalRef.current ||
      isQuittingRef.current ||
      stopPendingForQuitRef.current
    ) {
      return;
    }

    clearTimers();

    const newScale = generateScale(
      params,
      currentTier,
      vocalRange,
    );

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
    isLoadingAdaptiveParams,
    params,
    resetRecordingState,
    vocalRange,
  ]);

  const retry = useCallback(() => {
    clearTimers();

    const recorderMayBeActive =
      recordingRef.current ||
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
      stopRequestedRef.current = true;

      void stopRecordingRef.current?.().catch(error => {
        console.warn('Failed to stop recorder before retry:', error);
      });

      // Do not start a new run while the previous native recorder is
      // still stopping. The user can retry again if stopping fails.
      setErrorMessage(
        'The microphone is still stopping. Please retry in a moment.',
      );
      updatePhase('instructions');
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
    updatePhase('instructions');
    pausedRef.current = false;
  }, [
    clearTimers,
    isRecording,
    resetRecordingState,
    updatePhase,
  ]);

  const openQuitModal = useCallback(() => {
    if (
      showQuitModalRef.current ||
      isQuittingRef.current
    ) {
      return;
    }

    const interruptedPhase = phaseRef.current;

    interruptedPhaseRef.current = interruptedPhase;
    pausedRef.current = true;
    showQuitModalRef.current = true;

    clearTimers();
    setShowQuitModal(true);

    void disposeNotePlayer().catch(error => {
      console.warn('Could not stop target audio:', error);
    });

    const recorderMayBeActive =
      recordingRef.current ||
      startingRecordingRef.current ||
      isRecording;

    if (recorderMayBeActive) {
      /*
       * AudioRecorder cannot safely pause and resume.
       * Discard the current repetition's recording and restart it
       * only after the interrupted stop callback has been consumed.
       */
      discardNextStopRef.current = true;
      stopPendingForQuitRef.current = true;
      stopRequestedRef.current = true;
      recordingRef.current = false;
      startingRecordingRef.current = false;
      resumeAfterDiscardRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      try {
        const stopPromise = stopRecordingRef.current?.();

        if (stopPromise) {
          void stopPromise.catch(error => {
            console.warn(
              'Could not stop recording while opening quit modal:',
              error,
            );
          });
        }
      } catch (error) {
        console.warn(
          'Could not stop recording while opening quit modal:',
          error,
        );
      }
    }
  }, [clearTimers, isRecording]);

  const continueExercise = useCallback(() => {
    if (isQuittingRef.current) {
      return;
    }

    const interruptedPhase = interruptedPhaseRef.current;

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
      /*
       * Processing already in progress is allowed to finish. If its
       * result is ready, return to the results screen.
       */
      pausedRef.current = false;

      if (result) {
        updatePhase('results');
      }

      return;
    }

    if (stopPendingForQuitRef.current) {
      /*
       * Keep the exercise paused until the recorder's interrupted
       * stop callback has been consumed. That callback resumes the
       * current repetition.
       */
      resumeAfterDiscardRef.current = true;
      return;
    }

    pausedRef.current = false;

    resetLiveData();
    beginRepCountdownRef.current();
  }, [resetLiveData, result, updatePhase]);

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
      recordingRef.current ||
      startingRecordingRef.current ||
      isRecording;

    if (recorderMayBeActive || stopPendingForQuitRef.current) {
      discardNextStopRef.current = true;
      stopPendingForQuitRef.current = true;
      stopRequestedRef.current = true;
      recordingRef.current = false;
      startingRecordingRef.current = false;

      try {
        await Promise.resolve(
          stopRecordingRef.current?.(),
        );
      } catch (error) {
        console.warn('Could not stop recording while leaving:', error);
      }
    }

    try {
      await disposeNotePlayer();
    } catch (error) {
      console.warn('Could not dispose note player:', error);
    }

    router.replace('/dashboard?tab=exercises');
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

      if (recordingRef.current || startingRecordingRef.current) {
        discardNextStopRef.current = true;
        stopRequestedRef.current = true;

        try {
          void stopRecordingRef.current?.().catch(error => {
            console.warn(
              'Failed to stop recorder during cleanup:',
              error,
            );
          });
        } catch (error) {
          console.warn(
            'Failed to stop recorder during cleanup:',
            error,
          );
        }
      }

      void disposeNotePlayer().catch(error => {
        console.warn('Failed to dispose note player:', error);
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
      setIsLoadingAdaptiveParams(true);

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
      } catch (error) {
        console.error(
          'Failed to load scale accuracy parameters:',
          error,
        );

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';

          setCurrentTier(fallbackTier);
          setParams(SCALE_ACCURACY_PARAMS[fallbackTier]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
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

  const liveAccuracy =
    liveFrame && currentTarget && liveFrame.pitch > 0
      ? calcPitchAccuracy(
          liveFrame.pitch,
          currentTarget.frequency,
        )
      : 0;

  const liveStability = calcLiveStability(liveFrequencies);

  const modalMessage =
    interruptedPhaseRef.current === 'instructions' ||
    interruptedPhaseRef.current === 'results'
      ? 'Are you sure you want to leave Scale Accuracy Drill?'
      : interruptedPhaseRef.current === 'recording'
        ? 'Your exercise is paused. Completed repetitions will be kept, and the current repetition will restart when you continue.'
        : interruptedPhaseRef.current === 'processing'
          ? 'Your exercise is paused while your recordings are being analyzed. Continue to return to your exercise.'
          : 'Your exercise is paused. Completed repetitions will be kept. Continue to resume your exercise.';

  const quitModal = (
    <QuitExerciseModal
      visible={showQuitModal}
      message={modalMessage}
      onContinue={continueExercise}
      onQuit={() => {
        void quitExercise();
      }}
      quitting={isQuitting}
    />
  );

  if (phase === 'instructions' && isLoadingAdaptiveParams) {
    return (
      <>
        <View style={styles.centerScreen}>
          <View style={styles.largeIconCircle}>
            <Ionicons
              name="options-outline"
              size={44}
              color={BROWN}
            />
          </View>

          <Text style={styles.processingTitle}>
            Preparing Your Exercise
          </Text>

          <Text style={styles.processingSubtitle}>
            Adjusting the exercise to your current difficulty level
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
          error={errorMessage ?? undefined}
          startDisabled={isLoadingAdaptiveParams}
          startLabel={
            isLoadingAdaptiveParams
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
            <View style={styles.sharedScalePreview}>
              {targetNotes.map((note, index) => (
                <View
                  key={`${note.name}-${index}`}
                  style={styles.sharedScaleNote}
                >
                  <Text style={styles.sharedScaleNoteText}>
                    {note.name}
                  </Text>
                </View>
              ))}
            </View>
          }
          progress={100}
          onBack={goBack}
        />

        {quitModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        <View style={styles.recordingScreen}>
          <View style={styles.recordingIcon}>
            <Ionicons name="mic" size={34} color={BROWN} />
          </View>

          <Text style={styles.recordingTitle}>Sing the Scale</Text>

          <Text style={styles.recordingSubtitle}>
            Repetition {currentRep} of {params.repetitions}
          </Text>

          <View style={styles.liveCard}>
            <Text style={styles.liveLabel}>Current Target</Text>

            <Text style={styles.liveTarget}>
              {currentTarget?.name ?? '--'}
            </Text>

            <View style={styles.liveDivider} />

            <Text style={styles.liveLabel}>Your Note</Text>

            <Text style={styles.liveNote}>
              {liveFrame?.note ?? '--'}
            </Text>

            <Text style={styles.liveFrequency}>
              {liveFrame && liveFrame.pitch > 0
                ? `${Math.round(liveFrame.pitch)} Hz`
                : '--'}
            </Text>

            <View style={styles.liveStats}>
              <View style={styles.liveStat}>
                <Text style={styles.liveStatLabel}>Accuracy</Text>
                <Text style={styles.liveStatValue}>
                  {Math.round(liveAccuracy)}%
                </Text>
              </View>

              <View style={styles.liveStat}>
                <Text style={styles.liveStatLabel}>Stability</Text>
                <Text style={styles.liveStatValue}>
                  {Math.round(liveStability)}%
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.scalePreview}>
            {targetNotes.map((note, index) => {
              const active = index === currentNoteIndex;

              return (
                <View
                  key={`${note.name}-${index}`}
                  style={[
                    styles.previewNote,
                    active && styles.previewNoteActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.previewNoteText,
                      active && styles.previewNoteTextActive,
                    ]}
                  >
                    {note.name}
                  </Text>
                </View>
              );
            })}
          </View>

          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />

            <Text style={styles.recordingText}>
              {isRecording
                ? 'Recording...'
                : 'Preparing microphone...'}
            </Text>
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
          onBack={goBack}
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
          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>Note Accuracy</Text>

            <View style={styles.resultRow}>
              <Text style={styles.resultRowLabel}>Accurate notes</Text>
              <Text style={styles.resultRowValue}>
                {Math.round(result.noteAccuracy)}%
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultRowLabel}>
                Transition smoothness
              </Text>
              <Text style={styles.resultRowValue}>
                {Math.round(result.transitionSmoothness)}%
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultRowLabel}>Average clarity</Text>
              <Text style={styles.resultRowValue}>
                {Math.round(result.averageClarity * 100)}%
              </Text>
            </View>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>Your Notes</Text>

            {targetNotes.map((target, index) => {
              const detected = result.detectedFreqs[index] ?? 0;
              const noteScore = result.noteScores[index] ?? 0;
              const deviation =
                result.noteDeviations[index] ?? Infinity;

              const noteName =
                detected > 0
                  ? frequencyToNote(detected)
                  : '--';

              const correct =
                detected > 0 &&
                deviation <= params.tolerancePct;

              return (
                <View
                  key={`${target.name}-${index}`}
                  style={styles.noteResultRow}
                >
                  <View style={styles.noteNumber}>
                    <Text style={styles.noteNumberText}>
                      {index + 1}
                    </Text>
                  </View>

                  <View style={styles.noteResultInfo}>
                    <Text style={styles.targetNoteText}>
                      Target: {target.name}
                    </Text>

                    <Text style={styles.detectedNoteText}>
                      Detected: {noteName}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.noteStatus,
                      correct && styles.noteStatusCorrect,
                    ]}
                  >
                    <Ionicons
                      name={correct ? 'checkmark' : 'close'}
                      size={15}
                      color={BROWN}
                    />

                    <Text style={styles.noteStatusText}>
                      {Math.round(noteScore)}%
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.resultTip}>
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text style={styles.tipText}>
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

const styles = StyleSheet.create({
  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  largeIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  processingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  processingSubtitle: {
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
  },
  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    marginTop: 25,
    alignItems: 'center',
  },
  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  liveTarget: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    marginTop: 3,
  },
  liveDivider: {
    width: '70%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },
  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 3,
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
  scalePreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    maxWidth: 350,
  },
  previewNote: {
    minWidth: 48,
    height: 44,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewNoteActive: {
    backgroundColor: PINK,
  },
  previewNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: MUTED,
  },
  previewNoteTextActive: {
    color: BROWN,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
  },
  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: BROWN,
    marginRight: 7,
  },
  recordingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  sharedScalePreview: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  sharedScaleNote: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharedScaleNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },
  resultCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
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
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },
  noteResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  noteNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteNumberText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },
  noteResultInfo: {
    flex: 1,
    marginLeft: 10,
  },
  targetNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },
  detectedNoteText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 2,
  },
  noteStatus: {
    minWidth: 55,
    height: 30,
    borderRadius: 15,
    backgroundColor: LIGHT_GRAY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 7,
  },
  noteStatusCorrect: {
    backgroundColor: PINK,
  },
  noteStatusText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
  },
  resultTip: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },
  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  quitModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: WHITE,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 26,
    alignItems: 'center',
  },
  quitIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  quitModalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
    textAlign: 'center',
  },
  quitModalMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: MUTED,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 23,
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
  modalButtonPressed: {
    opacity: 0.75,
  },
  modalButtonDisabled: {
    opacity: 0.5,
  },
});