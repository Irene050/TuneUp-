import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { AudioContext } from 'react-native-audio-api';

import { usePhaseState } from '@/hooks/usePhaseState';
import {
  AGILITY_CLOSE_NOTE_SEMITONES,
  AGILITY_GOOD_NOTE_SEMITONES,
  AUDIO_SAMPLE_RATE,
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import {
  QUICK_INTERVAL_JUMP_PARAMS,
  type Tier,
} from '@/constants/params';
import { useAudioRecorder, type LiveAudioFrame } from '@/hooks/useAudioRecorder';
import { AgilitySequenceGuide } from '@/screens/exercises/Agility/AgilitySequenceGuide';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseRecordingScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateQuickIntervalJumpParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureQuickIntervalJump } from '@/services/measurement/agility/quickIntervalJump';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreQuickIntervalJump } from '@/services/scoring/agility/quickIntervalJump';
import { sleep } from '@/utils/async';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import {
  frequencyToNoteName,
  getSemitoneDistance,
} from '@/utils/music/notes';
import {
  AGILITY_NOTE_START_DELAY_MS,
  getActiveSequenceNoteIndex,
} from '@/utils/music/notePlayer';

import {
  ExerciseNoAudioModal,
  ExerciseQuitModal,
} from '@/components/exercises/ExerciseModals';

const MAX_RECORDING_SECONDS = 15;

type Phase =
  | 'instructions'
  | 'listening'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

type ExerciseResult = {
  overall: number;
  pitchScore: number;
  intervalScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
  noteCount: number;
  correctNoteCount: number;
  transitionCount: number;
  correctTransitionCount: number;
  averageTransitionTimeMs: number;
  durationMs: number;
};

type QuickIntervalJumpSettings = {
  repetitions: number;
  accuracyTarget: number;
};

type AdaptiveConfig = ReturnType<
  typeof generateQuickIntervalJumpParams
>;

const getQuickIntervalJumpSettings = (
  tier: Tier,
): QuickIntervalJumpSettings => {
  switch (tier) {
    case 'beginner':
      return { repetitions: 3, accuracyTarget: 60 };
    case 'intermediate':
      return { repetitions: 4, accuracyTarget: 70 };
    case 'advanced':
      return { repetitions: 5, accuracyTarget: 80 };
  }
};

const initialAdaptiveConfig: AdaptiveConfig = {
  ...QUICK_INTERVAL_JUMP_PARAMS.beginner,
  noteDurationSec: 0.3,
  gapSec: 0.35,
  frequencies: [],
};

export default function QuickIntervalJumpScreen() {
  const [tier, setTier] = useState<Tier>('beginner');
  const [isLoadingTier, setIsLoadingTier] = useState(true);

  const [adaptiveConfig, setAdaptiveConfig] =
    useState<AdaptiveConfig>(initialAdaptiveConfig);
  const [isLoadingParams, setIsLoadingParams] =
    useState(true);

  const [vocalRangeMessage, setVocalRangeMessage] = useState(
    'Loading your saved vocal range…',
  );
  const [hasUsableVocalRange, setHasUsableVocalRange] =
    useState(false);

  const [isPreparingResume, setIsPreparingResume] = useState(false);

  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [countdown, setCountdown] = useState(
    EXERCISE_COUNTDOWN_SECONDS,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentRep, setCurrentRep] = useState(1);

  const [isPlayingReference, setIsPlayingReference] = useState(false);
  const [activeReferenceNoteIndex, setActiveReferenceNoteIndex] =
    useState<number | null>(null);

  const [livePitchHz, setLivePitchHz] = useState<number | null>(null);
  const [liveDetectedNote, setLiveDetectedNote] =
    useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState(
    'Sing a clear, sustained note.',
  );

  const [result, setResult] = useState<ExerciseResult | null>(null);

  const [confirmation, setConfirmation] = useState<'tryAgain' | null>(
    null,
  );
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const completedAudioChunksRef = useRef<Float32Array[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const processingRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const countdownTokenRef = useRef(0);
  const playbackTokenRef = useRef(0);
  const referencePlayingRef = useRef(false);

  const showQuitModalRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');
  const pausedRepetitionRef = useRef(1);

  const { repetitions, accuracyTarget } =
    getQuickIntervalJumpSettings(tier);

  const noteDurationSec = adaptiveConfig.noteDurationSec;
  const gapSec = adaptiveConfig.gapSec;
  const notesPerRepetition = adaptiveConfig.frequencies.length;

  const repetitionDurationSec =
    notesPerRepetition * noteDurationSec +
    Math.max(0, notesPerRepetition - 1) * gapSec;

  const updateQuitModalVisibility = useCallback(
    (visible: boolean) => {
      showQuitModalRef.current = visible;

      if (mountedRef.current) {
        setShowQuitModal(visible);
      }
    },
    [],
  );

  const setExercisePhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;

    if (mountedRef.current) {
      setPhase(nextPhase);
    }
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingStartedAtRef.current = null;
  }, []);

  const resetLivePitch = useCallback(() => {
    setLivePitchHz(null);
    setLiveDetectedNote(null);
    setLiveStatus('Sing a clear, sustained note.');
  }, []);

  const updateLivePitch = useCallback(
    (frame: LiveAudioFrame) => {
      if (
        !mountedRef.current ||
        phaseRef.current !== 'recording' ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      const pitchHz =
        Number.isFinite(frame.pitch) && frame.pitch > 0
          ? frame.pitch
          : null;

      if (pitchHz === null) {
        setLivePitchHz(null);
        setLiveDetectedNote(null);
        setLiveStatus('Listening for a clear note…');
        return;
      }

      const detectedNote =
        frame.note || frequencyToNoteName(pitchHz);

      let closestDistance = Infinity;

      adaptiveConfig.frequencies.forEach((targetFrequency) => {
        const distance = getSemitoneDistance(
          pitchHz,
          targetFrequency,
        );

        if (distance < closestDistance) {
          closestDistance = distance;
        }
      });

      setLivePitchHz(pitchHz);
      setLiveDetectedNote(detectedNote);

      if (closestDistance <= AGILITY_GOOD_NOTE_SEMITONES) {
        setLiveStatus('Great! You are matching a target note.');
      } else if (
        closestDistance <= AGILITY_CLOSE_NOTE_SEMITONES
      ) {
        setLiveStatus('Close! Adjust your pitch slightly.');
      } else {
        setLiveStatus('Try matching one of the target notes.');
      }
    },
    [adaptiveConfig.frequencies],
  );

  useEffect(() => {
    let cancelled = false;

    const loadComponentTier = async () => {
      const user = auth.currentUser;

      if (!user) {
        setTier('beginner');
        setIsLoadingTier(false);
        return;
      }

      try {
        const progress = await fetchComponentProgress(
          user.uid,
          'agility',
        );

        if (cancelled) return;

        const savedTier = progress?.currentTier;

        const validTier: Tier =
          savedTier === 'beginner' ||
          savedTier === 'intermediate' ||
          savedTier === 'advanced'
            ? savedTier
            : 'beginner';

        setTier(validTier);
      } catch (errorMessage) {
        console.warn(
          'Failed to load agility component tier:',
          errorMessage,
        );

        if (!cancelled) {
          setTier('beginner');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTier(false);
        }
      }
    };

    void loadComponentTier();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isLoadingTier) return;

    let cancelled = false;

    const loadAdaptiveParameters = async () => {
      setIsLoadingParams(true);
      setHasUsableVocalRange(false);
      setVocalRangeMessage('Loading your saved vocal range…');

      const user = auth.currentUser;

      if (!user) {
        setAdaptiveConfig({
          ...generateQuickIntervalJumpParams({
            tier,
            recentScores: [],
            vocalRange: null,
          }),
          accuracyThreshold: accuracyTarget,
        });

        setVocalRangeMessage(
          'Sign in to the account where you completed your vocal range assessment.',
        );

        setIsLoadingParams(false);
        return;
      }

      let recentScores: number[] = [];

      try {
        const records = await fetchExerciseRecords(
          user.uid,
          'agility',
        );

        if (cancelled) return;

        recentScores = records
          .filter(
            (record) =>
              record.templateId === 'quickIntervalJump' &&
              record.tier === tier,
          )
          .slice(-5)
          .map((record) => record.scorePct)
          .filter((score) => Number.isFinite(score));
      } catch (errorMessage) {
        console.warn(
          'Could not load Quick Interval Jump score history:',
          errorMessage,
        );
      }

      let vocalRange: {
        lowHz: number;
        highHz: number;
      } | null = null;

      try {
        const assessment = await getLatestAssessment();

        if (cancelled) return;

        const lowHz =
          assessment?.vocalRange?.lowHz ??
          assessment?.vocalRangeLowHz;

        const highHz =
          assessment?.vocalRange?.highHz ??
          assessment?.vocalRangeHighHz;

        if (
          typeof lowHz === 'number' &&
          Number.isFinite(lowHz) &&
          lowHz > 0 &&
          typeof highHz === 'number' &&
          Number.isFinite(highHz) &&
          highHz > lowHz
        ) {
          vocalRange = { lowHz, highHz };
        }
      } catch (errorMessage) {
        console.warn(
          'Could not load the latest assessment vocal range:',
          errorMessage,
        );
      }

      if (cancelled) return;

      const generated = generateQuickIntervalJumpParams({
        tier,
        recentScores,
        vocalRange,
      });

      setAdaptiveConfig({
        ...generated,
        accuracyThreshold: accuracyTarget,
      });

      if (!vocalRange) {
        setHasUsableVocalRange(false);
        setVocalRangeMessage(
          'No valid saved vocal range was found. Complete a vocal range assessment using this account before starting this exercise.',
        );
      } else if (generated.frequencies.length < 2) {
        setHasUsableVocalRange(false);
        setVocalRangeMessage(
          'Your assessed vocal range does not contain enough distinct notes for this difficulty level. Please redo your vocal range assessment or select a suitable difficulty level.',
        );
      } else {
        setHasUsableVocalRange(true);
        setVocalRangeMessage(
          'Your saved vocal range is ready. Listen to the sequence before singing it.',
        );
      }

      setIsLoadingParams(false);
    };

    void loadAdaptiveParameters().catch((errorMessage) => {
      console.warn(
        'Failed to generate Quick Interval Jump parameters:',
        errorMessage,
      );

      if (!cancelled) {
        setAdaptiveConfig({
          ...generateQuickIntervalJumpParams({
            tier,
            recentScores: [],
            vocalRange: null,
          }),
          accuracyThreshold: accuracyTarget,
        });

        setHasUsableVocalRange(false);
        setVocalRangeMessage(
          'Unable to load your vocal range. Check your connection and try again.',
        );
        setIsLoadingParams(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [tier, isLoadingTier, accuracyTarget]);

  const processCombinedRecording = useCallback(
    async (
      audioChunks: Float32Array[],
      sampleRate: number,
    ) => {
      if (
        processingRef.current ||
        !mountedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      processingRef.current = true;
      setExercisePhase('processing');

      try {
        const totalSamples = audioChunks.reduce(
          (total, chunk) => total + chunk.length,
          0,
        );

        if (totalSamples === 0) {
          setExercisePhase('listening');
          setShowNoAudioModal(true);
          return;
        }

        const combinedSamples = new Float32Array(totalSamples);
        let offset = 0;

        for (const chunk of audioChunks) {
          combinedSamples.set(chunk, offset);
          offset += chunk.length;
        }

        console.log('[Quick Interval Jump] Combined recording:', {
          repetitions: audioChunks.length,
          totalSamples,
          sampleRate,
          durationSeconds: totalSamples / sampleRate,
        });

        if (!hasSufficientRecordedSignal(combinedSamples)) {
          setExercisePhase('listening');
          setShowNoAudioModal(true);
          return;
        }

        const targetFrequencies = Array.from(
          { length: repetitions },
          () => adaptiveConfig.frequencies,
        ).flat();

        const measurement = measureQuickIntervalJump(
          combinedSamples,
          sampleRate,
          targetFrequencies,
        );

        const scored = scoreQuickIntervalJump(measurement);
        const finalScore = Math.round(scored.overall);

        const accuracyScore =
          (scored.pitchScore + scored.intervalScore) / 2;

        const passed = accuracyScore >= accuracyTarget;

        const feedback =
          passed === scored.passed
            ? scored.feedback
            : passed
              ? `You met the ${accuracyTarget}% accuracy target for the ${tier} level. Keep practicing smooth, precise interval jumps.`
              : `Aim for at least ${accuracyTarget}% accuracy for the ${tier} level. Sing each sequence in order and focus on precise pitch changes.`;

        try {
          await saveCompletedExercise(
            'agility',
            'quickIntervalJump',
            tier,
            finalScore,
          );

          console.log(
            'Quick Interval Jump progress save call completed:',
            {
              componentId: 'agility',
              templateId: 'quickIntervalJump',
              tier,
              scorePct: finalScore,
            },
          );
        } catch (errorMessage) {
          console.error(
            'Failed to save Quick Interval Jump progress:',
            errorMessage,
          );
        }

        if (!mountedRef.current) return;

        setResult({
          overall: scored.overall,
          pitchScore: scored.pitchScore,
          intervalScore: scored.intervalScore,
          speedScore: scored.speedScore,
          passed,
          feedback,
          noteCount: measurement.noteCount,
          correctNoteCount: measurement.correctNoteCount,
          transitionCount: measurement.transitionCount,
          correctTransitionCount:
            measurement.correctTransitionCount,
          averageTransitionTimeMs:
            measurement.averageTransitionTimeMs,
          durationMs: measurement.durationMs,
        });

        setExercisePhase('results');
      } catch (errorMessage) {
        console.warn(
          'Quick Interval Jump processing failed:',
          errorMessage,
        );

        if (mountedRef.current) {
          setExercisePhase('instructions');
        }
      } finally {
        processingRef.current = false;
      }
    },
    [
      accuracyTarget,
      adaptiveConfig.frequencies,
      setExercisePhase,
      repetitions,
      tier,
    ],
  );

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      clearRecordingTimer();
      recordingStopRequestedRef.current = false;

      if (
        !mountedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      if (phaseRef.current !== 'recording') {
        return;
      }

      console.log('[Quick Interval Jump] Repetition recording stopped:', {
        repetition: currentRep,
        sampleCount: samples.length,
        sampleRate,
        durationSeconds: samples.length / sampleRate,
      });

      if (!hasSufficientRecordedSignal(samples)) {
        setExercisePhase('listening');
        setElapsedSeconds(0);
        resetLivePitch();
        setShowNoAudioModal(true);
        return;
      }

      completedAudioChunksRef.current.push(samples);

      if (currentRep < repetitions) {
        setCurrentRep((previous) => previous + 1);
        setElapsedSeconds(0);
        resetLivePitch();
        setExercisePhase('listening');
        return;
      }

      void processCombinedRecording(
        [...completedAudioChunksRef.current],
        sampleRate,
      );
    },
    [
      setExercisePhase,
      clearRecordingTimer,
      currentRep,
      processCombinedRecording,
      repetitions,
      resetLivePitch,
    ],
  );

  const {
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording,
    cancelRecording: cancelAudioRecording,
  } = useAudioRecorder({
    onFrame: updateLivePitch,
    onStop: handleRecordingStop,
  });

  const stopActiveRecording = useCallback(async () => {
    clearRecordingTimer();

    if (recordingStopRequestedRef.current) return;

    recordingStopRequestedRef.current = true;

    try {
      await stopAudioRecording();
    } catch (errorMessage) {
      console.warn(
        'Quick Interval Jump recording stop failed:',
        errorMessage,
      );

      recordingStopRequestedRef.current = false;

      if (
        mountedRef.current &&
        !quitInProgressRef.current
      ) {
        setExercisePhase('listening');
      }
    }
  }, [
    setExercisePhase,
    clearRecordingTimer,
    stopAudioRecording,
  ]);

  const cancelActiveRecording = useCallback(async () => {
    clearRecordingTimer();
    recordingStopRequestedRef.current = false;

    try {
      await cancelAudioRecording();
    } catch (errorMessage) {
      console.warn(
        'Quick Interval Jump recording cancellation failed:',
        errorMessage,
      );
    }
  }, [cancelAudioRecording, clearRecordingTimer]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      countdownTokenRef.current += 1;
      playbackTokenRef.current += 1;

      referencePlayingRef.current = false;
      quitInProgressRef.current = true;

      clearRecordingTimer();

      void cancelAudioRecording();

      const context = audioContextRef.current;
      audioContextRef.current = null;

      if (context) {
        try {
          void context.close();
        } catch {}
      }
    };
  }, [cancelAudioRecording, clearRecordingTimer]);

  const playReference = async () => {
    if (
      referencePlayingRef.current ||
      phaseRef.current !== 'listening' ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      isLoadingParams ||
      !hasUsableVocalRange ||
      notesPerRepetition < 2
    ) {
      return;
    }

    referencePlayingRef.current = true;
    setIsPlayingReference(true);

    const playbackToken = ++playbackTokenRef.current;

    try {
      const context =
        audioContextRef.current ??
        new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });

      audioContextRef.current = context;

      await context.resume();

      if (
        !mountedRef.current ||
        playbackToken !== playbackTokenRef.current
      ) {
        return;
      }

      for (const [
        index,
        frequency,
      ] of adaptiveConfig.frequencies.entries()) {
        if (
          !mountedRef.current ||
          playbackToken !== playbackTokenRef.current
        ) {
          break;
        }

        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.frequency.value = frequency;
        gain.gain.value = 0.12;

        oscillator.connect(gain);
        gain.connect(context.destination);

        const startTime = context.currentTime;

        oscillator.start(startTime);
        oscillator.stop(startTime + noteDurationSec);

        setActiveReferenceNoteIndex(index);

        await sleep(noteDurationSec * 1000);

        if (
          mountedRef.current &&
          playbackToken === playbackTokenRef.current
        ) {
          setActiveReferenceNoteIndex(null);
        }

        if (index < notesPerRepetition - 1) {
          await sleep(gapSec * 1000);
        }
      }
    } catch (errorMessage) {
      console.warn('Reference playback failed:', errorMessage);
    } finally {
      if (playbackToken === playbackTokenRef.current) {
        referencePlayingRef.current = false;

        if (mountedRef.current) {
          setIsPlayingReference(false);
          setActiveReferenceNoteIndex(null);
        }
      }
    }
  };

  const beginExercise = () => {
    if (
      isLoadingTier ||
      isLoadingParams ||
      !hasUsableVocalRange ||
      notesPerRepetition < 2 ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    completedAudioChunksRef.current = [];
    processingRef.current = false;
    recordingStopRequestedRef.current = false;

    setResult(null);
    setCurrentRep(1);
    setElapsedSeconds(0);
    resetLivePitch();

    setExercisePhase('listening');
  };

  const startRecording = async (countdownToken: number) => {
    if (
      !mountedRef.current ||
      countdownToken !== countdownTokenRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    try {
      processingRef.current = false;
      recordingStopRequestedRef.current = false;
      resetLivePitch();
      setElapsedSeconds(0);
      setExercisePhase('recording');

      await startAudioRecording();

      if (
        !mountedRef.current ||
        countdownToken !== countdownTokenRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        phaseRef.current !== 'recording'
      ) {
        await cancelAudioRecording();
        return;
      }

      recordingStartedAtRef.current = Date.now();

      recordingTimerRef.current = setInterval(() => {
        const start = recordingStartedAtRef.current;

        if (
          start === null ||
          !mountedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        const elapsedSeconds = (Date.now() - start) / 1000;

        setElapsedSeconds(
          Math.min(elapsedSeconds, repetitionDurationSec),
        );

        if (
          elapsedSeconds >= repetitionDurationSec ||
          elapsedSeconds >= MAX_RECORDING_SECONDS
        ) {
          void stopActiveRecording();
        }
      }, 20);
    } catch (errorMessage) {
      console.warn(
        'Quick Interval Jump recording failed to start:',
        errorMessage,
      );

      clearRecordingTimer();

      if (mountedRef.current) {
        setExercisePhase('listening');
        setVocalRangeMessage(
          'Unable to start microphone recording. Check microphone permission and try again.',
        );
      }
    }
  };

  const startCountdown = async () => {
    if (
      phaseRef.current !== 'listening' ||
      referencePlayingRef.current ||
      isPlayingReference ||
      isLoadingParams ||
      !hasUsableVocalRange ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const countdownToken = ++countdownTokenRef.current;

    playbackTokenRef.current += 1;

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setElapsedSeconds(0);
    setResult(null);
    resetLivePitch();

    processingRef.current = false;
    recordingStopRequestedRef.current = false;

    setExercisePhase('countdown');

    for (
      let value = EXERCISE_COUNTDOWN_SECONDS;
      value >= 1;
      value--
    ) {
      if (
        !mountedRef.current ||
        countdownToken !== countdownTokenRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      setCountdown(value);

      await sleep(1000);
    }

    if (
      !mountedRef.current ||
      countdownToken !== countdownTokenRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    setCountdown(0);
    await sleep(AGILITY_NOTE_START_DELAY_MS);

    if (
      !mountedRef.current ||
      countdownToken !== countdownTokenRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    await startRecording(countdownToken);
  };

  const resetExercise = () => {
    if (quitInProgressRef.current) return;

    countdownTokenRef.current += 1;
    playbackTokenRef.current += 1;

    referencePlayingRef.current = false;

    setIsPlayingReference(false);
    setActiveReferenceNoteIndex(null);

    processingRef.current = false;
    recordingStopRequestedRef.current = false;

    void cancelActiveRecording();

    completedAudioChunksRef.current = [];

    setResult(null);
    setElapsedSeconds(0);
    setCurrentRep(1);

    resetLivePitch();

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);

    setExercisePhase('instructions');
  };

  const pauseForExitPrompt = useCallback(async () => {
    if (
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phaseRef.current === 'processing' ||
      confirmation !== null
    ) {
      return;
    }

    const currentPhase = phaseRef.current;

    pausedPhaseRef.current = currentPhase;
    pausedRepetitionRef.current = currentRep;

    updateQuitModalVisibility(true);

    countdownTokenRef.current += 1;
    playbackTokenRef.current += 1;

    referencePlayingRef.current = false;

    setIsPlayingReference(false);
    setActiveReferenceNoteIndex(null);

    if (currentPhase === 'recording') {
      await cancelActiveRecording();

      setElapsedSeconds(0);
      resetLivePitch();
      setExercisePhase('listening');
    } else if (currentPhase === 'countdown') {
      setElapsedSeconds(0);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      setExercisePhase('listening');
    } else if (currentPhase === 'listening') {
      setExercisePhase('listening');
    }
  }, [
    cancelActiveRecording,
    confirmation,
    currentRep,
    setExercisePhase,
    resetLivePitch,
    updateQuitModalVisibility,
  ]);

  const continueExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    const previouslyPausedPhase = pausedPhaseRef.current;

    updateQuitModalVisibility(false);

    if (previouslyPausedPhase === 'processing') {
      return;
    }

    if (
      previouslyPausedPhase === 'recording' ||
      previouslyPausedPhase === 'countdown'
    ) {
      await cancelActiveRecording();

      if (quitInProgressRef.current || !mountedRef.current) {
        return;
      }

      setCurrentRep(pausedRepetitionRef.current);
      setElapsedSeconds(0);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);

      resetLivePitch();

      processingRef.current = false;
      recordingStopRequestedRef.current = false;

      setExercisePhase('listening');

      setIsPreparingResume(true);

      await sleep(500);

      if (mountedRef.current && !quitInProgressRef.current) {
        setIsPreparingResume(false);
      }

      return;
    }

    setExercisePhase(previouslyPausedPhase);
  }, [
    cancelActiveRecording,
    setExercisePhase,
    resetLivePitch,
    updateQuitModalVisibility,
  ]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    setIsQuitting(true);

    updateQuitModalVisibility(false);

    countdownTokenRef.current += 1;
    playbackTokenRef.current += 1;

    referencePlayingRef.current = false;

    setIsPlayingReference(false);
    setActiveReferenceNoteIndex(null);

    await cancelActiveRecording();

    completedAudioChunksRef.current = [];

    const context = audioContextRef.current;
    audioContextRef.current = null;

    if (context) {
      try {
        await context.close();
      } catch (errorMessage) {
        console.warn(
          'Could not close audio context while quitting:',
          errorMessage,
        );
      }
    }

    router.replace('/exercises/agility' as any);
  }, [cancelActiveRecording, updateQuitModalVisibility]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (
          showQuitModalRef.current ||
          quitInProgressRef.current
        ) {
          return true;
        }

        if (confirmation !== null) {
          setConfirmation(null);
          return true;
        }

        if (phaseRef.current === 'processing') {
          return true;
        }

        void pauseForExitPrompt();
        return true;
      },
    );

    return () => subscription.remove();
  }, [confirmation, pauseForExitPrompt]);

  const closeTryAgainConfirmation = () => {
    setConfirmation(null);
  };

  const handleTryAgainConfirmation = () => {
    if (confirmation !== 'tryAgain') return;

    setConfirmation(null);
    resetExercise();
  };

  const renderInstructions = () => (
    <ExerciseScreen
      title="Quick Interval Jump"
      category="Vocal Agility"
      icon="swap-horizontal-outline"
      instructions="Listen to the reference sequence, then sing the notes in the same order. The pitches are generated from your saved vocal range."
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
        { label: 'DIFFICULTY', value: adaptiveConfig.label },
        { label: 'SPEED', value: adaptiveConfig.speedLabel },
        { label: 'NOTES', value: String(notesPerRepetition) },
        { label: 'REPETITIONS', value: String(repetitions) },
        { label: 'ACCURACY TARGET', value: `${accuracyTarget}%` },
      ]}
      tip={vocalRangeMessage}
      tier={tier}
      startDisabled={
        isLoadingTier ||
        isLoadingParams ||
        !hasUsableVocalRange ||
        notesPerRepetition < 2
      }
      startLabel={
        isLoadingTier || isLoadingParams
          ? 'Preparing Exercise...'
          : !hasUsableVocalRange
            ? 'Vocal Assessment Required'
            : 'Start Exercise'
      }
      onBack={() => void pauseForExitPrompt()}
      onStart={beginExercise}
    />
  );

  const renderReference = () => (
    <ExerciseListeningScreen
      icon="swap-horizontal-outline"
      title="Quick Interval Jump"
      currentRep={currentRep}
      repetitions={repetitions}
      promptTitle="Listen to the Reference"
      prompt="Listen to the note sequence, then sing the same notes in order."
      liveContent={
        <AgilitySequenceGuide
          names={adaptiveConfig.frequencies.map(
            frequencyToNoteName,
          )}
          activeIndex={activeReferenceNoteIndex}
          noteDurationSec={noteDurationSec}
          gapSec={gapSec}
          caption="The highlight follows each note while it plays."
        />
      }
      isPlayingReference={isPlayingReference}
      onPlayReference={() => void playReference()}
      onContinue={() => void startCountdown()}
      onBack={() => void pauseForExitPrompt()}
    />
  );

  const renderCountdown = () => (
    <ExerciseCountdownScreen
      icon="flash-outline"
      title="Get Ready"
      currentRep={currentRep}
      repetitions={repetitions}
      countdown={countdown}
      promptTitle="Prepare to sing"
      prompt={`Get ready for repetition ${currentRep} of ${repetitions}.`}
      onBack={() => void pauseForExitPrompt()}
    />
  );

  const renderRecording = () => {
    const progress = Math.min(
      elapsedSeconds / repetitionDurationSec,
      1,
    );

    const activeRecordingNoteIndex = getActiveSequenceNoteIndex(
      elapsedSeconds,
      notesPerRepetition,
      noteDurationSec,
      gapSec,
    );

    const activeTargetFrequency =
      activeRecordingNoteIndex !== null
        ? adaptiveConfig.frequencies[
            activeRecordingNoteIndex
          ]
        : null;

    const activeTargetDistance =
      livePitchHz !== null && activeTargetFrequency !== null
        ? getSemitoneDistance(
            livePitchHz,
            activeTargetFrequency,
          )
        : Infinity;

    const liveStatusColor =
      livePitchHz === null || activeTargetFrequency === null
        ? COLORS.muted
        : activeTargetDistance <= AGILITY_GOOD_NOTE_SEMITONES
          ? COLORS.guideGreen
          : activeTargetDistance <= AGILITY_CLOSE_NOTE_SEMITONES
            ? COLORS.guideYellow
            : COLORS.guideRed;

    return (
      <ExerciseRecordingScreen
        title="Jump Between Notes"
        currentRep={currentRep}
        repetitions={repetitions}
        onBack={() => void pauseForExitPrompt()}
      >
        <AgilitySequenceGuide
          names={adaptiveConfig.frequencies.map(
            frequencyToNoteName,
          )}
          activeIndex={activeRecordingNoteIndex}
          noteDurationSec={noteDurationSec}
          gapSec={gapSec}
          liveNote={
            livePitchHz === null
              ? undefined
              : frequencyToNoteName(livePitchHz)
          }
          showFeedback
          caption="Follow the highlighted note. Green is in tune, yellow is close, and red is off pitch."
        />

        <View
          style={[
            exerciseStyles.liveCardVariant3,
            { borderColor: COLORS.border },
          ]}
        >
          <Text style={exerciseStyles.liveLabel}>
            CURRENT NOTE
          </Text>

          <Text style={exerciseStyles.liveCurrentNote}>
            {liveDetectedNote ?? '--'}
          </Text>

          <Text style={exerciseStyles.detectedPitchTextSub}>
            {livePitchHz !== null
              ? `${livePitchHz.toFixed(1)} Hz`
              : '--'}
          </Text>
        </View>

        <View style={exerciseStyles.timerTrackVariant1}>
          <View
            style={[
              exerciseStyles.timerFill,
              { width: `${progress * 100}%` },
            ]}
          />
        </View>
        <Text style={exerciseStyles.timerText}>
          Recording Time: {elapsedSeconds.toFixed(1)}s /{' '}
          {repetitionDurationSec.toFixed(1)}s
        </Text>
      </ExerciseRecordingScreen>
    );
  };

  const renderProcessing = () => (
    <ExerciseProcessingScreen
      icon="analytics-outline"
      title="Analyzing Your Singing"
      message="Measuring pitch accuracy, interval accuracy, and transition speed."
    />
  );

  const renderScoreRow = (
    label: string,
    score: number,
    isLast = false,
  ) => (
    <View style={isLast ? exerciseStyles.scoreRowLast : exerciseStyles.scoreRow}>
      <View style={exerciseStyles.scoreRowHeader}>
        <Text style={exerciseStyles.scoreRowLabel}>{label}</Text>
        <Text style={exerciseStyles.scoreRowValue}>
          {Math.round(score)}%
        </Text>
      </View>

      <View style={exerciseStyles.progressBackground}>
        <View
          style={[
            exerciseStyles.progressFill,
            {
              width: `${Math.min(
                100,
                Math.max(0, score),
              )}%`,
            },
          ]}
        />
      </View>
    </View>
  );

  const renderMetricRow = (
    label: string,
    value: string,
    isLast = false,
  ) => (
    <View
      style={[
        exerciseStyles.metricRow,
        isLast && exerciseStyles.metricRowLast,
      ]}
    >
      <Text style={exerciseStyles.resultRowLabel}>{label}</Text>
      <Text style={exerciseStyles.metricValue}>{value}</Text>
    </View>
  );

  const renderResults = () => {
    if (!result) return null;

    return (
      <View style={exerciseStyles.resultsContentVariant2}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to exercises"
          hitSlop={10}
          style={exerciseStyles.quitButtonTop}
          onPress={() => void pauseForExitPrompt()}
        >
          <Ionicons
            name="close"
            size={22}
            color={COLORS.brown}
          />
        </Pressable>

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
          {result.passed ? 'Great Job!' : 'Keep Practicing!'}
        </Text>

        <Text style={exerciseStyles.resultSubtitle}>
          Quick Interval Jump Result
        </Text>

        <View style={exerciseStyles.scoreCard}>
          <Text style={exerciseStyles.scoreLabel}>OVERALL SCORE</Text>

          <Text style={exerciseStyles.scoreValue}>
            {Math.round(result.overall)}
          </Text>

          <Text style={exerciseStyles.scoreDescriptionVariant1}>
            out of 100
          </Text>
        </View>

        <View style={exerciseStyles.resultCard}>
          <Text style={exerciseStyles.resultCardTitle}>
            Performance Breakdown
          </Text>

          {renderScoreRow('Pitch Accuracy', result.pitchScore)}
          {renderScoreRow(
            'Interval Accuracy',
            result.intervalScore,
          )}
          {renderScoreRow(
            'Transition Speed',
            result.speedScore,
            true,
          )}
        </View>

        <View style={exerciseStyles.resultCard}>
          <Text style={exerciseStyles.resultCardTitle}>
            Performance Metrics
          </Text>

          {renderMetricRow(
            'Correct Notes',
            `${result.correctNoteCount}/${result.noteCount}`,
          )}

          {renderMetricRow(
            'Correct Jumps',
            `${result.correctTransitionCount}/${result.transitionCount}`,
          )}

          {renderMetricRow(
            'Average Transition',
            `${
              result.averageTransitionTimeMs > 0
                ? result.averageTransitionTimeMs.toFixed(0)
                : '0'
            } ms`,
          )}

          {renderMetricRow(
            'Duration',
            `${(result.durationMs / 1000).toFixed(1)}s`,
            true,
          )}
        </View>

        <View style={exerciseStyles.tipCardVariant1}>
          <Ionicons
            name="bulb-outline"
            size={20}
            color={COLORS.brown}
          />
          <Text style={exerciseStyles.tipTextVariant1}>{result.feedback}</Text>
        </View>

        <Pressable
          style={exerciseStyles.startButtonVariant2}
          onPress={() => setConfirmation('tryAgain')}
          accessibilityRole="button"
          accessibilityLabel="Try the exercise again"
        >
          <Ionicons
            name="refresh"
            size={18}
            color={COLORS.white}
          />
          <Text style={exerciseStyles.startButtonText}>Try Again</Text>
        </Pressable>

        <Pressable
          style={exerciseStyles.doneButtonVariant2}
          onPress={() => void pauseForExitPrompt()}
          accessibilityRole="button"
          accessibilityLabel="Back to exercises"
        >
          <Ionicons
            name="arrow-back"
            size={15}
            color={COLORS.brown}
          />
          <Text style={exerciseStyles.infoName}>
            Back to Exercises
          </Text>
        </Pressable>
      </View>
    );
  };

  if (
    isLoadingTier ||
    isLoadingParams ||
    isPreparingResume
  ) {
    return (
      <ExercisePreparingScreen
        title={
          isPreparingResume
            ? 'Preparing Your Repetition'
            : 'Preparing Your Exercise'
        }
        message={
          isPreparingResume
            ? 'Getting your reference notes ready. Your completed repetitions are preserved.'
            : 'Loading your saved vocal range and preparing notes for your difficulty level.'
        }
        icon="musical-notes-outline"
        iconSize={44}
      />
    );
  }

  return (
    <>
      {phase === 'results' ? (
        <ScrollView
          style={exerciseStyles.screen}
          contentContainerStyle={exerciseStyles.resultsWrapper}
          showsVerticalScrollIndicator={false}
        >
          {renderResults()}
        </ScrollView>
      ) : (
        <View style={exerciseStyles.screen}>
          {phase === 'instructions' && renderInstructions()}
          {phase === 'listening' && renderReference()}
          {phase === 'countdown' && renderCountdown()}
          {phase === 'recording' && renderRecording()}
          {phase === 'processing' && renderProcessing()}
        </View>
      )}

      <ExerciseQuitModal
        visible={showQuitModal}
        title="Quit exercise?"
        message={
          pausedPhaseRef.current === 'instructions' ||
          pausedPhaseRef.current === 'results'
            ? 'Are you sure you want to leave Quick Interval Jump?'
            : pausedPhaseRef.current === 'recording'
              ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
              : pausedPhaseRef.current === 'countdown'
                ? 'Your exercise is paused. Your completed repetitions will be kept. Continue to restart the countdown for your current repetition.'
                : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'
        }
        isQuitting={isQuitting}
        onContinue={() => void continueExercise()}
        onQuit={() => void quitExercise()}
        continueLabel="Continue Exercise"
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />

      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={() => {
          setShowNoAudioModal(false);

          setElapsedSeconds(0);
          setResult(null);

          resetLivePitch();

          processingRef.current = false;
          recordingStopRequestedRef.current = false;

          setExercisePhase('listening');

          void startCountdown();
        }}
        onQuit={() => {
          setShowNoAudioModal(false);
          void quitExercise();
        }}
        isQuitting={isQuitting}
      />

      <Modal
        visible={confirmation === 'tryAgain'}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeTryAgainConfirmation}
      >
        <View style={exerciseStyles.modalOverlay}>
          <View style={exerciseStyles.modalCard}>
            <View style={exerciseStyles.modalIcon}>
              <Ionicons
                name="refresh"
                size={30}
                color={COLORS.brown}
              />
            </View>

            <Text style={exerciseStyles.modalTitle}>Try again?</Text>

            <Text style={exerciseStyles.modalMessage}>
              Are you sure you want to repeat this exercise? Your
              current result will be cleared.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel try again"
              onPress={closeTryAgainConfirmation}
              style={({ pressed }) => [
                exerciseStyles.continueButton,
                pressed && exerciseStyles.disabledButton,
              ]}
            >
              <Text style={exerciseStyles.cardTitle}>
                Cancel
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm try again"
              onPress={handleTryAgainConfirmation}
              style={({ pressed }) => [
                exerciseStyles.quitButton,
                pressed && exerciseStyles.disabledButton,
              ]}
            >
              <Text style={exerciseStyles.quitButtonText}>
                Try Again
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
