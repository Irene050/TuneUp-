import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';

import { usePhaseState } from '@/hooks/usePhaseState';
import {
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
  EXERCISE_MAX_RECORDING_SECONDS
} from '@/constants/appConstants';
import {
  ARPEGGIO_SPEED_DRILL_PARAMS,
  type Tier,
} from '@/constants/params';

import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';

import { AgilitySequenceGuide } from '@/screens/exercises/Agility/AgilitySequenceGuide';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseRecordingScreen,
} from '@/screens/exercises/ExerciseScreen';

import { generateArpeggioSpeedDrillParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import {
  getLatestAssessment,
  getRecentAssessments,
} from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureArpeggioSpeed } from '@/services/measurement/agility/arpeggioSpeedDrill';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreArpeggioSpeed } from '@/services/scoring/agility/arpeggioSpeedDrill';

import { exerciseStyles } from '@/constants/exerciseStyles';
import { sleep } from '@/utils/async';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { average } from '@/utils/math';
import {
  AGILITY_NOTE_START_DELAY_MS,
  getActiveSequenceNoteIndex,
  playNoteSequence,
} from '@/utils/music/notePlayer';
import {
  frequencyToMidi,
  frequencyToNoteName,
  getSemitoneDistance,
  midiToFrequency,
} from '@/utils/music/notes';

import {
  ExerciseNoAudioModal,
  ExerciseQuitModal,
} from '@/components/exercises/ExerciseModals';

type Phase =
  | 'instructions'
  | 'listening'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

type ArpeggioExerciseConfig = {
  notes: string[];
  frequencies: number[];
  speedLabel: string;
  noteDurationSec: number;
  gapSec: number;
  pitchTolerancePercent: number;
};

type ExerciseResult = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  speedScore: number;
  passed: boolean;
  noteCount: number;
  correctNoteCount: number;
  notesPerSecond: number;
  averageNoteDurationMs: number;
  durationMs: number;
};

const findClosestTarget = (
  detectedHz: number,
  frequencies: number[],
): { index: number; distance: number } => {
  let index = -1;
  let distance = Infinity;

  frequencies.forEach((frequency, currentIndex) => {
    const currentDistance = getSemitoneDistance(
      detectedHz,
      frequency,
    );

    if (currentDistance < distance) {
      index = currentIndex;
      distance = currentDistance;
    }
  });

  return { index, distance };
};

const buildFinalResult = (
  attempts: ExerciseResult[],
  repetitionCount: number,
): ExerciseResult => {
  const passed =
    attempts.length === repetitionCount &&
    attempts.every((attempt) => attempt.passed);

  return {
    overall: Math.round(
      average(attempts.map((item) => item.overall)),
    ),
    pitchScore: Math.round(
      average(attempts.map((item) => item.pitchScore)),
    ),
    sequenceScore: Math.round(
      average(attempts.map((item) => item.sequenceScore)),
    ),
    speedScore: Math.round(
      average(attempts.map((item) => item.speedScore)),
    ),
    passed,
    noteCount: attempts.reduce(
      (sum, item) => sum + item.noteCount,
      0,
    ),
    correctNoteCount: attempts.reduce(
      (sum, item) => sum + item.correctNoteCount,
      0,
    ),
    notesPerSecond: average(
      attempts.map((item) => item.notesPerSecond),
    ),
    averageNoteDurationMs: average(
      attempts.map((item) => item.averageNoteDurationMs),
    ),
    durationMs: attempts.reduce(
      (sum, item) => sum + item.durationMs,
      0,
    ),
  };
};

const generateArpeggioFromVocalRange = (
  lowHz: number,
  highHz: number,
): {
  notes: string[];
  frequencies: number[];
} | null => {
  if (
    !Number.isFinite(lowHz) ||
    !Number.isFinite(highHz) ||
    lowHz <= 0 ||
    highHz <= lowHz
  ) {
    return null;
  }

  const lowestMidi = Math.ceil(frequencyToMidi(lowHz));
  const highestMidi = Math.floor(frequencyToMidi(highHz));
  const availableSemitones = highestMidi - lowestMidi;

  const intervals =
    availableSemitones >= 12
      ? [0, 4, 7, 12]
      : availableSemitones >= 7
        ? [0, 3, 5, 7]
        : null;

  if (!intervals) return null;

  const maxRoot = highestMidi - Math.max(...intervals);

  const preferredRoot =
    Math.round((lowestMidi + highestMidi) / 2) -
    Math.round(Math.max(...intervals) / 2);

  const rootMidi = Math.max(
    lowestMidi,
    Math.min(preferredRoot, maxRoot),
  );

  const frequencies = intervals.map((interval) =>
    midiToFrequency(rootMidi + interval),
  );

  const notes = frequencies.map((frequency) =>
    frequencyToNoteName(frequency),
  );

  return {
    notes,
    frequencies,
  };
};

export default function ArpeggioSpeedDrillScreen() {
  const currentUserId = auth.currentUser?.uid ?? null;

  const [tier, setTier] = useState<Tier | null>(null);
  const [isLoadingTier, setIsLoadingTier] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadCurrentTier = async () => {
      setIsLoadingTier(true);

      if (!currentUserId) {
        if (!cancelled) {
          setTier('beginner');
          setIsLoadingTier(false);
        }
        return;
      }

      try {
        const progress = await fetchComponentProgress(
          currentUserId,
          'agility',
        );

        if (!cancelled) {
          setTier(progress?.currentTier ?? 'beginner');
          setIsLoadingTier(false);
        }
      } catch (errorMessage) {
        console.error(
          'Failed to load current Agility tier:',
          errorMessage,
        );

        if (!cancelled) {
          setTier('beginner');
          setIsLoadingTier(false);
        }
      }
    };

    void loadCurrentTier();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const activeTier: Tier = tier ?? 'beginner';

  const repetitionCount =
    activeTier === 'beginner'
      ? 3
      : activeTier === 'intermediate'
        ? 4
        : 5;

  const baseConfig = useMemo(
    () => ARPEGGIO_SPEED_DRILL_PARAMS[activeTier],
    [activeTier],
  );

  const [config, setConfig] =
    useState<ArpeggioExerciseConfig>({
      ...baseConfig,
      notes: [],
      frequencies: [],
    });

  const [paramsReady, setParamsReady] = useState(false);

  const [vocalRangeAvailable, setVocalRangeAvailable] =
    useState(false);

  const [vocalRangeMessage, setVocalRangeMessage] = useState(
    'Checking your saved vocal assessment.',
  );

  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');

  const [countdown, setCountdown] = useState(
    EXERCISE_COUNTDOWN_SECONDS,
  );

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [livePitchHz, setLivePitchHz] =
    useState<number | null>(null);

  const [referenceNoteIndex, setReferenceNoteIndex] =
    useState<number | null>(null);

  const [isPlayingReference, setIsPlayingReference] =
    useState(false);

  const [currentRep, setCurrentRep] = useState(1);

  const [result, setResult] = useState<ExerciseResult | null>(null);

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] =
    useState(false);

  const attemptResultsRef = useRef<ExerciseResult[]>([]);

  const recordingStartedAtRef = useRef<number | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const processingRef = useRef(false);

  const pausedPhaseRef = useRef<Phase>('instructions');

  const quitInProgressRef = useRef(false);

  const countdownRunIdRef = useRef(0);

  const mountedRef = useRef(true);

const noteCycleDuration = config.noteDurationSec + config.gapSec;
const sequenceCycleDuration =
  noteCycleDuration * config.frequencies.length;
const elapsedInSequence =
  sequenceCycleDuration > 0
    ? elapsedSeconds % sequenceCycleDuration
    : 0;
const timedNoteIndex = getActiveSequenceNoteIndex(
  elapsedInSequence,
  config.frequencies.length,
  config.noteDurationSec,
  config.gapSec,
);
const timedReferenceNoteIndex =
  phase === 'recording' ? timedNoteIndex : null;

const expectedNote =
  timedReferenceNoteIndex !== null
    ? config.notes[timedReferenceNoteIndex]
    : null;

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingStartedAtRef.current = null;
  }, []);

  const processRecordedSamples = useCallback(
    async (
      samples: Float32Array,
      sampleRate: number,
    ) => {
      if (!mountedRef.current || quitInProgressRef.current) {
        processingRef.current = false;
        return;
      }

      setPhase('processing');
      setLivePitchHz(null);

      try {
        console.log('[Arpeggio Speed Drill] Recording received:', {
          sampleRate,
          sampleCount: samples.length,
          durationSeconds: Number(
            (samples.length / sampleRate).toFixed(2),
          ),
          repetition: currentRep,
        });

        if (!hasSufficientRecordedSignal(samples)) {
          processingRef.current = false;

          setPhase('listening');
          setShowNoAudioModal(true);

          return;
        }

        const expectedNoteIntervalSec =
          config.noteDurationSec + config.gapSec;

        const measurement = measureArpeggioSpeed(
          samples,
          sampleRate,
          config.frequencies,
          config.pitchTolerancePercent,
          expectedNoteIntervalSec,
        );

        const scored = scoreArpeggioSpeed(measurement);

        const repetitionResult: ExerciseResult = {
          overall: scored.overall,
          pitchScore: scored.pitchScore,
          sequenceScore: scored.sequenceScore,
          speedScore: scored.speedScore,
          passed: scored.passed,
          noteCount: measurement.noteCount,
          correctNoteCount: measurement.correctNoteCount,
          notesPerSecond: measurement.notesPerSecond,
          averageNoteDurationMs: measurement.averageNoteDurationMs,
          durationMs: measurement.durationMs,
        };

        const completedAttempts = [
          ...attemptResultsRef.current,
          repetitionResult,
        ];

        attemptResultsRef.current = completedAttempts;

        console.log(
          `Arpeggio Speed Drill repetition ${currentRep}/${repetitionCount} completed:`,
          repetitionResult,
        );

        if (currentRep < repetitionCount) {
          if (!mountedRef.current) return;

          setCurrentRep((previous) => previous + 1);
          setElapsedSeconds(0);
          setCountdown(EXERCISE_COUNTDOWN_SECONDS);
          setReferenceNoteIndex(null);
          setLivePitchHz(null);

          processingRef.current = false;

          setPhase('listening');

          return;
        }

        const finalResult = buildFinalResult(
          completedAttempts,
          repetitionCount,
        );

        try {
          await saveCompletedExercise(
            'agility',
            'arpeggioSpeedDrill',
            activeTier,
            finalResult.overall,
          );

          console.log(
            'Arpeggio Speed Drill full-set progress saved:',
            finalResult.overall,
          );
        } catch (saveError) {
          console.error(
            'Failed to save Arpeggio Speed Drill progress:',
            saveError,
          );
        }

        if (!mountedRef.current || quitInProgressRef.current) {
          return;
        }

        setResult(finalResult);
        setPhase('results');
      } catch (errorMessage) {
        console.warn(
          'Arpeggio Speed Drill processing failed:',
          errorMessage,
        );

        if (!mountedRef.current) return;

        processingRef.current = false;
        attemptResultsRef.current = [];
        setCurrentRep(1);
        setPhase('instructions');
      }
    },
    [
      activeTier,
      setPhase,
      config,
      currentRep,
      repetitionCount,
    ],
  );

  const handleLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (
        !mountedRef.current ||
        phaseRef.current !== 'recording' ||
        quitInProgressRef.current
      ) {
        return;
      }

      const validPitch =
        Number.isFinite(frame.pitch) &&
        frame.pitch > 0;

      setLivePitchHz(validPitch ? frame.pitch : null);
    },
    [],
  );

  const handleRecordingStop = useCallback(
    async (
      samples: Float32Array,
      sampleRate: number,
    ) => {
      clearRecordingTimer();

      if (!mountedRef.current || quitInProgressRef.current) {
        processingRef.current = false;
        return;
      }

      await processRecordedSamples(samples, sampleRate);
    },
    [clearRecordingTimer, processRecordedSamples],
  );

  const {
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording,
    cancelRecording: cancelAudioRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  const stopActiveRecording = useCallback(async () => {
    clearRecordingTimer();

    try {
      await stopAudioRecording();
    } catch (errorMessage) {
      console.warn(
        'Failed to stop Arpeggio Speed Drill recorder:',
        errorMessage,
      );
    }
  }, [clearRecordingTimer, stopAudioRecording]);

  const cancelActiveRecording = useCallback(async () => {
    clearRecordingTimer();

    try {
      await cancelAudioRecording();
    } catch (errorMessage) {
      console.warn(
        'Failed to cancel Arpeggio Speed Drill recorder:',
        errorMessage,
      );
    }
  }, [clearRecordingTimer, cancelAudioRecording]);

  const pauseForExitPrompt = useCallback(() => {
    const activePhase = phaseRef.current;

    if (
      activePhase === 'processing' ||
      quitInProgressRef.current
    ) {
      return;
    }

    pausedPhaseRef.current = activePhase;
    setShowQuitModal(true);

    countdownRunIdRef.current += 1;

    if (
      activePhase === 'recording' ||
      activePhase === 'countdown'
    ) {
      void cancelActiveRecording();

      processingRef.current = false;

      setLivePitchHz(null);
      setElapsedSeconds(0);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      setReferenceNoteIndex(null);
    }
  }, [cancelActiveRecording]);

  const startCountdown = useCallback(async () => {
    if (
      processingRef.current ||
      isPlayingReference ||
      quitInProgressRef.current
    ) {
      return;
    }

    const runId = ++countdownRunIdRef.current;

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setPhase('countdown');

    for (
      let value = EXERCISE_COUNTDOWN_SECONDS;
      value >= 1;
      value--
    ) {
      if (
        runId !== countdownRunIdRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      setCountdown(value);

      await sleep(1000);
    }

    if (
      runId !== countdownRunIdRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    setCountdown(0);
    await sleep(AGILITY_NOTE_START_DELAY_MS);

    if (
      runId !== countdownRunIdRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    try {
      processingRef.current = false;

      setLivePitchHz(null);
      setElapsedSeconds(0);
      setPhase('recording');

      await startAudioRecording();

      if (
        !mountedRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        await cancelActiveRecording();
        return;
      }

  recordingStartedAtRef.current = Date.now();
  setElapsedSeconds(0);

  recordingTimerRef.current = setInterval(() => {
    const start = recordingStartedAtRef.current;

    if (
      start === null ||
      processingRef.current ||
      phaseRef.current !== 'recording'
    ) {
      return;
    }

    const elapsedSeconds = (Date.now() - start) / 1000;

    setElapsedSeconds(
      Math.min(elapsedSeconds, EXERCISE_MAX_RECORDING_SECONDS),
    );

    if (elapsedSeconds >= EXERCISE_MAX_RECORDING_SECONDS) {
      processingRef.current = true;

      clearRecordingTimer();

      setPhase('processing');
      setLivePitchHz(null);
      void stopActiveRecording();
    }
  }, 20);
    } catch (errorMessage) {
      console.error(
        'Arpeggio Speed Drill recording failed:',
        errorMessage,
      );

      clearRecordingTimer();

      processingRef.current = false;

      if (mountedRef.current && !quitInProgressRef.current) {
        setPhase('listening');
        setShowNoAudioModal(true);
      }
    }
  }, [
    cancelActiveRecording,
    setPhase,
    clearRecordingTimer,
    isPlayingReference,
    startAudioRecording,
    stopActiveRecording,
  ]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    const pausedPhase = pausedPhaseRef.current;

    setShowQuitModal(false);

    if (
      pausedPhase === 'recording' ||
      pausedPhase === 'countdown'
    ) {
      setLivePitchHz(null);
      setElapsedSeconds(0);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      setReferenceNoteIndex(null);

      processingRef.current = false;

      void startCountdown();

      return;
    }

    setPhase(pausedPhase);
  }, [setPhase, startCountdown]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;

    setIsQuitting(true);
    setShowQuitModal(false);

    countdownRunIdRef.current += 1;

    processingRef.current = false;

    await cancelActiveRecording();

    try {
      router.replace('/exercises/agility');
    } catch (errorMessage) {
      console.error(
        'Failed to leave Arpeggio Speed Drill:',
        errorMessage,
      );

      quitInProgressRef.current = false;
      setIsQuitting(false);
    }
  }, [cancelActiveRecording]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (phaseRef.current === 'processing') {
          return true;
        }

        pauseForExitPrompt();

        return true;
      },
    );

    return () => subscription.remove();
  }, [pauseForExitPrompt]);

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParameters = async () => {
      if (isLoadingTier || !tier) return;

      setParamsReady(false);
      setVocalRangeAvailable(false);

      try {
        const user = auth.currentUser;

        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'agility',
          );

          if (cancelled) return;

          const currentExerciseRecords = records
            .filter(
              (record) =>
                record.templateId === 'arpeggioSpeedDrill' &&
                record.tier === tier,
            )
            .sort(
              (a, b) => a.timestamp - b.timestamp,
            );

          if (currentExerciseRecords.length > 0) {
            recentScores = currentExerciseRecords
              .slice(-5)
              .map((record) => record.scorePct);
          } else {
            const latestAssessment =
              await getLatestAssessment();

            if (cancelled) return;

            const assessmentScore =
              latestAssessment?.scores.find(
                (score) => score.componentId === 'agility',
              )?.scorePct;

            if (typeof assessmentScore === 'number') {
              recentScores = [assessmentScore];
            }
          }
        }

        const generated =
          generateArpeggioSpeedDrillParams({
            tier,
            recentScores,
          });

        const vocalAssessments =
          await getRecentAssessments(10);

        if (cancelled) return;

        let arpeggio:
          | ReturnType<typeof generateArpeggioFromVocalRange>
          | null = null;

        for (const assessment of vocalAssessments) {
          const lowHz = Number(
            assessment.vocalRange?.lowHz ??
              assessment.vocalRangeLowHz ??
              0,
          );

          const highHz = Number(
            assessment.vocalRange?.highHz ??
              assessment.vocalRangeHighHz ??
              0,
          );

          const candidate =
            generateArpeggioFromVocalRange(
              lowHz,
              highHz,
            );

          if (candidate) {
            arpeggio = candidate;

            console.log(
              'Using saved vocal range for Arpeggio Speed Drill:',
              {
                assessmentId: assessment.id,
                lowHz,
                highHz,
                notes: candidate.notes,
              },
            );

            break;
          }
        }

        if (cancelled) return;

        setConfig({
          ...generated,
          notes: arpeggio?.notes ?? [],
          frequencies: arpeggio?.frequencies ?? [],
        });

        setVocalRangeAvailable(arpeggio !== null);

        setVocalRangeMessage(
          arpeggio
            ? ''
            : vocalAssessments.length === 0
              ? 'No saved vocal range assessment was found for this account. Check that you are signed in to the account used for the assessment.'
              : 'Your saved assessment was found, but none of the 10 most recent assessments has a range wide enough for this arpeggio. Please redo the vocal range assessment.',
        );

        if (vocalAssessments.length === 0) {
          console.warn(
            'No saved vocal range assessments found for current user.',
          );
        }

        setParamsReady(true);
      } catch (errorMessage) {
        console.error(
          'Failed to load Arpeggio Speed Drill adaptive parameters:',
          errorMessage,
        );

        if (!cancelled) {
          setConfig({
            ...baseConfig,
            notes: [],
            frequencies: [],
          });

          setVocalRangeAvailable(false);

          setVocalRangeMessage(
            'Unable to load your vocal assessment. Please check your connection and try again.',
          );

          setParamsReady(true);
        }
      }
    };

    void loadAdaptiveParameters();

    return () => {
      cancelled = true;
    };
  }, [tier, isLoadingTier, baseConfig]);

  const playReference = useCallback(async () => {
    if (
      isPlayingReference ||
      !config.frequencies.length
    ) {
      return;
    }

    setIsPlayingReference(true);
    setReferenceNoteIndex(null);

    const sequence = config.frequencies.map(
      (frequencyHz) => ({
        frequencyHz,
        durationSec: config.noteDurationSec,
      }),
    );

    try {
      await playNoteSequence(
        sequence,
        config.gapSec,
        setReferenceNoteIndex,
      );
    } catch (errorMessage) {
      console.error(
        'Reference playback failed:',
        errorMessage,
      );
    } finally {
      setReferenceNoteIndex(null);
      setIsPlayingReference(false);
    }
  }, [config, isPlayingReference]);

  const beginExercise = useCallback(() => {
    attemptResultsRef.current = [];

    setCurrentRep(1);
    setResult(null);

    processingRef.current = false;

    setLivePitchHz(null);
    setElapsedSeconds(0);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);

    setPhase('listening');
  }, [setPhase]);

  const resetExercise = useCallback(() => {
    countdownRunIdRef.current += 1;

    void cancelActiveRecording();

    setShowQuitModal(false);
    setShowNoAudioModal(false);

    processingRef.current = false;

    attemptResultsRef.current = [];

    setCurrentRep(1);
    setLivePitchHz(null);
    setResult(null);
    setElapsedSeconds(0);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setReferenceNoteIndex(null);

    setPhase('instructions');
  }, [cancelActiveRecording, setPhase]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      countdownRunIdRef.current += 1;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      void cancelAudioRecording();
    };
  }, [cancelAudioRecording]);

  const renderInstructions = () => {
    const difficulty = tier
      ? tier.charAt(0).toUpperCase() + tier.slice(1)
      : 'Beginner';

    return (
      <ExerciseScreen
        title="Arpeggio Speed Drill"
        category="Vocal Agility"
        icon="flash-outline"
        instructions="Listen carefully to the listening arpeggio, then sing the notes in order while maintaining accuracy at the required speed."
        preparationSteps={[
          {
            icon: 'volume-mute-outline',
            text: 'Find a quiet area with minimal background noise.',
          },
          {
            icon: 'body-outline',
            text: 'Sit or stand upright with relaxed shoulders.',
          },
          {
            icon: 'mic-outline',
            text: 'Keep a comfortable distance from the microphone.',
          },
        ]}
        summary={[
          { label: 'DIFFICULTY', value: difficulty },
          { label: 'SPEED', value: config.speedLabel },
          {
            label: 'NOTES',
            value: String(config.frequencies.length),
          },
          {
            label: 'REPETITIONS',
            value: String(repetitionCount),
          },
          {
            label: 'NOTE DURATION',
            value: `${config.noteDurationSec.toFixed(2)}s`,
          },
          {
            label: 'ARPEGGIO',
            value: config.notes.join(' • '),
          },
        ]}
        tip={
          vocalRangeAvailable
            ? 'Focus on matching each note accurately first. Gradually build speed while keeping the sequence clear and controlled.'
            : vocalRangeMessage
        }
        tier={tier}
        startDisabled={
          isLoadingTier ||
          !paramsReady ||
          !vocalRangeAvailable ||
          !config.frequencies.length
        }
        startLabel={
          isLoadingTier || !paramsReady
            ? 'Preparing Exercise...'
            : vocalRangeAvailable
              ? 'Start Exercise'
              : vocalRangeMessage.startsWith(
                    'No saved vocal range',
                  )
                ? 'Vocal Assessment Required'
                : 'Vocal Range Needs Review'
        }
        onBack={pauseForExitPrompt}
        onStart={beginExercise}
      />
    );
  };

  const renderReference = () => (
    <ExerciseListeningScreen
      icon="musical-notes-outline"
      title="Arpeggio Speed Drill"
      currentRep={currentRep}
      repetitions={repetitionCount}
      promptTitle="Listen to the Reference"
      prompt="Listen to the full arpeggio, then sing the notes in order while following its timing."
      liveContent={
        <AgilitySequenceGuide
          names={config.frequencies.map(
            frequencyToNoteName,
          )}
          activeIndex={referenceNoteIndex}
          noteDurationSec={config.noteDurationSec}
          gapSec={config.gapSec}
        />
      }
      isPlayingReference={isPlayingReference}
      onPlayReference={() => void playReference()}
      onContinue={() => void startCountdown()}
      onBack={pauseForExitPrompt}
    />
  );

  const renderCountdown = () => (
    <ExerciseCountdownScreen
      icon="flash-outline"
      title="Get Ready"
      currentRep={currentRep}
      repetitions={repetitionCount}
      countdown={countdown}
      promptTitle="Prepare to sing"
      prompt="Sing the arpeggio in sequence."
      onBack={pauseForExitPrompt}
    />
  );

const renderRecording = () => {
  const progress = Math.min(
    elapsedSeconds / EXERCISE_MAX_RECORDING_SECONDS,
    1,
  );

  const liveMatch =
    livePitchHz === null
      ? { index: -1, distance: Infinity }
      : findClosestTarget(
          livePitchHz,
          config.frequencies,
        );

  const liveDetectedNote =
    liveMatch.index >= 0 &&
    liveMatch.distance <= 1.5
      ? config.notes[liveMatch.index]
      : null;

  const isSingingWindow =
    timedReferenceNoteIndex !== null && expectedNote !== null;

  return (
    <ExerciseRecordingScreen
      title="Sing the Arpeggio"
      currentRep={currentRep}
      repetitions={repetitionCount}
      onBack={pauseForExitPrompt}
    >
      <AgilitySequenceGuide
        names={config.notes}
        activeIndex={timedReferenceNoteIndex}
        noteDurationSec={config.noteDurationSec}
        gapSec={config.gapSec}
        liveNote={liveDetectedNote ?? undefined}
        showFeedback
        caption={
          isSingingWindow
            ? `Sing ${expectedNote} now!`
            : expectedNote
              ? `Get ready for ${expectedNote}...`
              : 'Follow the highlighted notes.'
        }
      />
      <View style={exerciseStyles.liveCardVariant2}>
        <Text style={exerciseStyles.liveLabel}>
          DETECTED NOTE
        </Text>

        <Text style={exerciseStyles.targetNote}>
          {liveDetectedNote ??
            (livePitchHz === null
              ? '--'
              : 'Unmatched')}
        </Text>

        <Text style={exerciseStyles.liveStatValue}>
          {livePitchHz !== null
            ? `${livePitchHz.toFixed(1)} Hz`
            : 'Listening...'}
        </Text>
      </View>

      <View style={exerciseStyles.timerTrack}>
        <View
          style={[
            exerciseStyles.timerFill,
            { width: `${progress * 100}%` },
          ]}
        />
      </View>

      <Text style={exerciseStyles.timerTextVariant2}>
        Recording Time: {elapsedSeconds.toFixed(1)}s
      </Text>
    </ExerciseRecordingScreen>
  );
};

  const renderProcessing = () => (
    <ExerciseProcessingScreen
      icon="analytics-outline"
      title="Analyzing Your Singing"
      message={`Repetition ${currentRep} of ${repetitionCount}. Measuring pitch accuracy, note sequence, and singing speed.`}
    />
  );

  const renderResults = () => {
    if (!result) return null;

    return (
      <View style={exerciseStyles.resultsContentVariant1}>
        <View
          style={[
            exerciseStyles.resultIcon,
            result.passed
              ? exerciseStyles.resultIconPassed
              : exerciseStyles.resultIconFailed,
          ]}
        >
          <Ionicons
            name={result.passed ? 'checkmark' : 'refresh'}
            size={40}
            color={COLORS.brown}
          />
        </View>

        <Text style={exerciseStyles.resultTitle}>
          {result.passed
            ? 'Great Job!'
            : 'Keep Practicing!'}
        </Text>

        <Text style={exerciseStyles.resultSubtitle}>
          Arpeggio Speed Drill Result
        </Text>

        <View style={exerciseStyles.scoreCard}>
          <Text style={exerciseStyles.scoreLabel}>
            OVERALL SCORE
          </Text>

          <Text style={exerciseStyles.scoreValue}>
            {result.overall}
          </Text>

          <Text style={exerciseStyles.scoreDescriptionVariant1}>
            out of 100 · Average across {repetitionCount} repetitions
          </Text>
        </View>

        <View style={exerciseStyles.resultCard}>
          <Text style={exerciseStyles.resultCardTitle}>
            Performance Breakdown
          </Text>

          <View style={exerciseStyles.scoreRow}>
            <View style={exerciseStyles.scoreRowHeader}>
              <Text style={exerciseStyles.scoreRowLabel}>
                Pitch Accuracy
              </Text>

              <Text style={exerciseStyles.scoreRowValue}>
                {result.pitchScore}%
              </Text>
            </View>

            <View style={exerciseStyles.progressBackground}>
              <View
                style={[
                  exerciseStyles.progressFill,
                  {
                    width: `${Math.min(
                      Math.max(result.pitchScore, 0),
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>

          <View style={exerciseStyles.scoreRow}>
            <View style={exerciseStyles.scoreRowHeader}>
              <Text style={exerciseStyles.scoreRowLabel}>
                Sequence Accuracy
              </Text>

              <Text style={exerciseStyles.scoreRowValue}>
                {result.sequenceScore}%
              </Text>
            </View>

            <View style={exerciseStyles.progressBackground}>
              <View
                style={[
                  exerciseStyles.progressFill,
                  {
                    width: `${Math.min(
                      Math.max(result.sequenceScore, 0),
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>

          <View style={exerciseStyles.scoreRowLast}>
            <View style={exerciseStyles.scoreRowHeader}>
              <Text style={exerciseStyles.scoreRowLabel}>
                Speed Score
              </Text>

              <Text style={exerciseStyles.scoreRowValue}>
                {result.speedScore}%
              </Text>
            </View>

            <View style={exerciseStyles.progressBackground}>
              <View
                style={[
                  exerciseStyles.progressFill,
                  {
                    width: `${Math.min(
                      Math.max(result.speedScore, 0),
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <View style={exerciseStyles.resultCard}>
          <Text style={exerciseStyles.resultCardTitle}>
            Performance Metrics
          </Text>

          <View style={exerciseStyles.metricRow}>
            <Text style={exerciseStyles.resultRowLabel}>
              Correct Notes
            </Text>

            <Text style={exerciseStyles.metricValue}>
              {result.correctNoteCount}/{result.noteCount}
            </Text>
          </View>

          <View style={exerciseStyles.metricRow}>
            <Text style={exerciseStyles.resultRowLabel}>
              Notes per Second
            </Text>

            <Text style={exerciseStyles.metricValue}>
              {result.notesPerSecond.toFixed(2)}
            </Text>
          </View>

          <View style={exerciseStyles.metricRow}>
            <Text style={exerciseStyles.resultRowLabel}>
              Average Note Duration
            </Text>

            <Text style={exerciseStyles.metricValue}>
              {result.averageNoteDurationMs > 0
                ? result.averageNoteDurationMs.toFixed(0)
                : '0'}{' '}
              ms
            </Text>
          </View>

          <View
            style={[
              exerciseStyles.metricRow,
              exerciseStyles.metricRowLast,
            ]}
          >
            <Text style={exerciseStyles.resultRowLabel}>
              Duration
            </Text>

            <Text style={exerciseStyles.metricValue}>
              {(result.durationMs / 1000).toFixed(1)}s
            </Text>
          </View>
        </View>

        <Pressable
          style={exerciseStyles.startButtonVariant1}
          onPress={resetExercise}
        >
          <Ionicons
            name="refresh"
            size={18}
            color={COLORS.white}
          />

          <Text style={exerciseStyles.startButtonText}>
            Try Again
          </Text>
        </Pressable>

        <Pressable
          style={exerciseStyles.doneButtonVariant1}
          onPress={pauseForExitPrompt}
        >
          <Text style={exerciseStyles.infoName}>
            Back to Exercises
          </Text>
        </Pressable>
      </View>
    );
  };

  if (isLoadingTier || !paramsReady) {
    return (
      <ExercisePreparingScreen
        title="Preparing Your Exercise"
        message="Adjusting the exercise to your current difficulty level and preparing your vocal range."
        icon="options-outline"
        iconSize={44}
      />
    );
  }

  const activeContent =
    phase === 'instructions'
      ? renderInstructions()
      : phase === 'listening'
        ? renderReference()
        : phase === 'countdown'
          ? renderCountdown()
          : phase === 'recording'
            ? renderRecording()
            : phase === 'processing'
              ? renderProcessing()
              : null;

  return (
    <View style={exerciseStyles.screen}>
      {phase === 'results' ? (
        <ScrollView
          style={exerciseStyles.screen}
          contentContainerStyle={exerciseStyles.resultsWrapper}
          showsVerticalScrollIndicator={false}
        >
          {renderResults()}
        </ScrollView>
      ) : (
        activeContent
      )}

      <ExerciseQuitModal
        visible={showQuitModal}
        title="Quit exercise?"
        message={
          pausedPhaseRef.current === 'instructions' ||
          pausedPhaseRef.current === 'results'
            ? 'Are you sure you want to leave Arpeggio Speed Drill?'
            : pausedPhaseRef.current === 'recording'
              ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
              : pausedPhaseRef.current === 'countdown'
                ? 'Your exercise is paused. Your completed repetitions will be kept. The countdown will restart when you continue.'
                : pausedPhaseRef.current === 'listening'
                  ? 'Your exercise is paused. Your completed repetitions will be kept. Continue to return to the listening arpeggio.'
                  : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'
        }
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => void quitExercise()}
        continueLabel="Continue Exercise"
        quitLabel={
          isQuitting ? 'Stopping...' : 'Quit Exercise'
        }
      />

      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={() => {
          setShowNoAudioModal(false);

          processingRef.current = false;

          setCountdown(EXERCISE_COUNTDOWN_SECONDS);
          setReferenceNoteIndex(null);
          setLivePitchHz(null);
          setElapsedSeconds(0);

          void startCountdown();
        }}
        onQuit={() => {
          setShowNoAudioModal(false);
          void quitExercise();
        }}
        isQuitting={isQuitting}
      />
    </View>
  );
}
