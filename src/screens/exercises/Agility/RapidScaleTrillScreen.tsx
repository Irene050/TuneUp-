import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AudioContext } from 'react-native-audio-api';

import {
  AGILITY_CLOSE_NOTE_SEMITONES,
  AGILITY_GOOD_NOTE_SEMITONES,
  AUDIO_SAMPLE_RATE,
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
} from '@/constants/appConstants';
import {
  RAPID_SCALE_TRILL_PARAMS,
  type Tier,
} from '@/constants/params';
import { useAudioRecorder, type LiveAudioFrame } from '@/hooks/useAudioRecorder';
import { AgilitySequenceGuide } from '@/screens/exercises/Agility/AgilitySequenceGuide';
import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseNoAudioModal,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseQuitModal,
  ExerciseRecordingScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateRapidScaleTrillParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureRapidScaleTrill } from '@/services/measurement/agility/rapidScaleTrill';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreRapidScaleTrill } from '@/services/scoring/agility/rapidScaleTrill';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import {
  frequencyToNoteName,
  getSemitoneDistance,
} from '@/utils/music/notes';

const MIN_RECORDING_SECONDS = 0.25;
const MIN_RECORDING_RMS = 0.001;

const MIN_PITCH_HZ = 65;
const MAX_PITCH_HZ = 1000;

type VocalRange = {
  lowHz: number;
  highHz: number;
};

type Phase =
  | 'instructions'
  | 'reference'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

type Confirmation = 'tryAgain' | 'quit' | null;

type AdaptiveConfig = ReturnType<
  typeof generateRapidScaleTrillParams
>;

type PitchStatus = 'match' | 'close' | '--' | null;

type RapidScaleTrillResult = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  transitionScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
  noteCount: number;
  correctNoteCount: number;
  transitionCount: number;
  correctTransitionCount: number;
  averageTransitionTimeMs: number;
  notesPerSecond: number;
  durationMs: number;
};

function getPitchStatus(
  detectedFrequency: number | null,
  targetFrequency: number | undefined,
): PitchStatus {
  if (
    detectedFrequency === null ||
    targetFrequency === undefined ||
    targetFrequency <= 0
  ) {
    return '--';
  }

  const distance = getSemitoneDistance(
    detectedFrequency,
    targetFrequency,
  );

  if (distance <= AGILITY_GOOD_NOTE_SEMITONES) return 'match';
  if (distance <= AGILITY_CLOSE_NOTE_SEMITONES) return 'close';

  return '--';
}

function getPitchStatusColor(
  status: PitchStatus,
): string | null {
  switch (status) {
    case 'match':
      return COLORS.guideGreen;
    case 'close':
      return COLORS.guideYellow;
    case '--':
      return COLORS.guideRed;
    default:
      return null;
  }
}

function getAssessmentVocalRange(
  assessment: any,
): VocalRange | null {
  const lowHz =
    assessment?.vocalRange?.lowHz ??
    assessment?.vocalRangeLowHz;

  const highHz =
    assessment?.vocalRange?.highHz ??
    assessment?.vocalRangeHighHz;

  if (
    typeof lowHz !== 'number' ||
    typeof highHz !== 'number' ||
    !Number.isFinite(lowHz) ||
    !Number.isFinite(highHz) ||
    lowHz <= 0 ||
    highHz <= lowHz
  ) {
    return null;
  }

  return { lowHz, highHz };
}

export default function RapidScaleTrillScreen() {
  const currentUserId = auth.currentUser?.uid ?? null;

  const [tier, setTier] = useState<Tier | null>(null);
  const [tierLoading, setTierLoading] = useState(true);

  const [config, setConfig] = useState<AdaptiveConfig | null>(null);
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  const [vocalRange, setVocalRange] = useState<VocalRange | null>(
    null,
  );
  const [vocalRangeError, setVocalRangeError] = useState<
    string | null
  >(null);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(
    EXERCISE_COUNTDOWN_SECONDS,
  );
  const [currentRep, setCurrentRep] = useState(1);
  const [recordingTime, setRecordingTime] = useState(0);

  const [result, setResult] =
    useState<RapidScaleTrillResult | null>(null);

  const [confirmation, setConfirmation] =
    useState<Confirmation>(null);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

  const [referencePlaying, setReferencePlaying] = useState(false);
  const [activeReferenceNoteIndex, setActiveReferenceNoteIndex] =
    useState<number | null>(null);
  const [activeExerciseNoteIndex, setActiveExerciseNoteIndex] =
    useState<number | null>(null);

  const [livePitchHz, setLivePitchHz] = useState<number | null>(null);
  const [livePitchStatus, setLivePitchStatus] =
    useState<PitchStatus>(null);

  const audioContextRef = useRef<AudioContext | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const recordingStartRef = useRef<number | null>(null);
  const recordingStopRequestedRef = useRef(false);
  const processingRef = useRef(false);

  const countdownRunRef = useRef(0);
  const referenceRunRef = useRef(0);
  const referencePlayingRef = useRef(false);

  const savedAttemptRef = useRef(false);
  const activeExerciseNoteIndexRef = useRef<number | null>(null);

  const phaseRef = useRef<Phase>('instructions');
  const confirmationRef = useRef<Confirmation>(null);
  const pausedPhaseRef = useRef<Phase | null>(null);

  const resumeInterruptedRepetitionRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const mountedRef = useRef(true);

  const frequencies = config?.frequencies ?? [];
  const noteDurationSec = config?.noteDurationSec ?? 0;

  const repetitions =
    config?.repetitions ??
    RAPID_SCALE_TRILL_PARAMS.beginner.repetitions;

  const singleSequenceDurationSeconds =
    frequencies.length * noteDurationSec;

  const targetSequenceDurationSeconds =
    singleSequenceDurationSeconds * repetitions;

  const expectedTargetNoteCount =
    frequencies.length * repetitions;

  const hasUsableSequence =
    frequencies.length >= 2 &&
    noteDurationSec > 0 &&
    repetitions > 0;

  const setCurrentPhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;

    if (mountedRef.current) {
      setPhase(nextPhase);
    }
  }, []);

  const setCurrentConfirmation = useCallback(
    (nextConfirmation: Confirmation) => {
      confirmationRef.current = nextConfirmation;

      if (mountedRef.current) {
        setConfirmation(nextConfirmation);
      }
    },
    [],
  );

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingStartRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTier() {
      setTierLoading(true);

      try {
        if (!currentUserId) {
          if (!cancelled) setTier('beginner');
          return;
        }

        const progress = await fetchComponentProgress(
          currentUserId,
          'agility',
        );

        if (!cancelled) {
          setTier(progress?.currentTier ?? 'beginner');
        }
      } catch (error) {
        console.error('Failed to load Agility tier:', error);

        if (!cancelled) {
          setTier('beginner');
        }
      } finally {
        if (!cancelled) {
          setTierLoading(false);
        }
      }
    }

    void loadTier();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParameters() {
      if (tierLoading || !tier) return;

      setIsLoadingAdaptiveParams(true);
      setConfig(null);
      setVocalRange(null);
      setVocalRangeError(null);

      try {
        if (!currentUserId) {
          setVocalRangeError(
            'Sign in and complete a vocal assessment before starting this exercise.',
          );
          return;
        }

        const [records, assessment] = await Promise.all([
          fetchExerciseRecords(currentUserId, 'agility'),
          getLatestAssessment(),
        ]);

        if (cancelled) return;

        const recentScores = records
          .filter(
            record =>
              record.templateId === 'rapidScaleTrill' &&
              record.tier === tier &&
              Number.isFinite(record.scorePct),
          )
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-5)
          .map(record => record.scorePct);

        const assessedRange =
          getAssessmentVocalRange(assessment);

        if (!assessedRange) {
          setVocalRangeError(
            'A valid vocal range was not found in your latest assessment. Complete or update your vocal assessment, then try again.',
          );
          return;
        }

        setVocalRange(assessedRange);

        const generated = generateRapidScaleTrillParams({
          tier,
          recentScores,
          vocalRange: assessedRange,
        });

        if (
          !generated.frequencies ||
          generated.frequencies.length < 2
        ) {
          setVocalRangeError(
            'Your assessed vocal range could not produce a suitable note sequence. Please update your vocal assessment and try again.',
          );
          return;
        }

        if (!cancelled) {
          setConfig(generated);
        }
      } catch (error) {
        console.error(
          'Failed to load Rapid Scale Trill parameters:',
          error,
        );

        if (!cancelled) {
          setVocalRangeError(
            'Your exercise could not be prepared. Check your assessment and connection, then try again.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
        }
      }
    }

    void loadAdaptiveParameters();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, tier, tierLoading]);

  const cancelReferencePlayback = useCallback(() => {
    referenceRunRef.current += 1;
    referencePlayingRef.current = false;

    if (mountedRef.current) {
      setReferencePlaying(false);
      setActiveReferenceNoteIndex(null);
    }
  }, []);

  const closeAudioContext = useCallback(() => {
    const context = audioContextRef.current;
    audioContextRef.current = null;

    if (context) {
      try {
        void context.close();
      } catch (error) {
        console.warn('Could not close the audio context:', error);
      }
    }
  }, []);

  const playReference = useCallback(async () => {
    if (
      referencePlayingRef.current ||
      phaseRef.current !== 'reference' ||
      confirmationRef.current !== null ||
      quitInProgressRef.current ||
      !hasUsableSequence ||
      isLoadingAdaptiveParams
    ) {
      return;
    }

    const runId = ++referenceRunRef.current;

    referencePlayingRef.current = true;
    setReferencePlaying(true);

    try {
      let context = audioContextRef.current;

      if (!context) {
        context = new AudioContext({
          sampleRate: AUDIO_SAMPLE_RATE,
        });

        audioContextRef.current = context;
      }

      await context.resume();

      for (const [index, frequency] of frequencies.entries()) {
        if (
          referenceRunRef.current !== runId ||
          quitInProgressRef.current ||
          confirmationRef.current !== null
        ) {
          return;
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

        await new Promise<void>(resolve => {
          setTimeout(resolve, noteDurationSec * 1000);
        });

        if (referenceRunRef.current === runId) {
          setActiveReferenceNoteIndex(null);
        }
      }
    } catch (error) {
      if (referenceRunRef.current === runId) {
        console.warn('Reference playback failed:', error);

        Alert.alert(
          'Playback Error',
          'The reference sequence could not be played. Please try again.',
        );
      }
    } finally {
      if (referenceRunRef.current === runId) {
        referencePlayingRef.current = false;
        setReferencePlaying(false);
        setActiveReferenceNoteIndex(null);
      }
    }
  }, [
    frequencies,
    hasUsableSequence,
    isLoadingAdaptiveParams,
    noteDurationSec,
  ]);

  const handleLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (
        !mountedRef.current ||
        phaseRef.current !== 'recording' ||
        confirmationRef.current !== null ||
        quitInProgressRef.current
      ) {
        return;
      }

      const pitch =
        frame.pitch > 0 &&
        Number.isFinite(frame.pitch) &&
        frame.pitch >= MIN_PITCH_HZ &&
        frame.pitch <= MAX_PITCH_HZ
          ? frame.pitch
          : null;

      const activeIndex = activeExerciseNoteIndexRef.current;

      if (activeIndex === null) {
        return;
      }

      setLivePitchHz(pitch);

      setLivePitchStatus(
        getPitchStatus(pitch, frequencies[activeIndex]),
      );
    },
    [frequencies],
  );

  const showZeroScoreResult = useCallback(
    (feedback: string, durationMs: number) => {
      if (
        !mountedRef.current ||
        quitInProgressRef.current ||
        confirmationRef.current === 'quit'
      ) {
        return;
      }

      const targetNoteCount = expectedTargetNoteCount;

      const zeroResult: RapidScaleTrillResult = {
        overall: 0,
        pitchScore: 0,
        sequenceScore: 0,
        transitionScore: 0,
        speedScore: 0,
        passed: false,
        feedback,
        noteCount: targetNoteCount,
        correctNoteCount: 0,
        transitionCount: Math.max(0, targetNoteCount - 1),
        correctTransitionCount: 0,
        averageTransitionTimeMs: 0,
        notesPerSecond: 0,
        durationMs: Math.max(0, durationMs),
      };

      setResult(zeroResult);
      setCurrentPhase('results');

      if (tier && !savedAttemptRef.current) {
        savedAttemptRef.current = true;

        void saveCompletedExercise(
          'agility',
          'rapidScaleTrill',
          tier,
          0,
        ).catch(error => {
          console.error(
            'Failed to save Rapid Scale Trill zero score:',
            error,
          );
        });
      }
    },
    [expectedTargetNoteCount, setCurrentPhase, tier],
  );

  const processRecording = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      if (
        processingRef.current ||
        !config ||
        quitInProgressRef.current ||
        confirmationRef.current === 'quit'
      ) {
        return;
      }

      processingRef.current = true;

      setActiveExerciseNoteIndex(null);
      activeExerciseNoteIndexRef.current = null;
      setLivePitchHz(null);
      setLivePitchStatus(null);
      setCurrentPhase('processing');

      try {
        if (!hasSufficientRecordedSignal(samples)) {
          setCurrentPhase('reference');
          setShowNoAudioModal(true);
          return;
        }

        const durationSeconds = samples.length / sampleRate;
        const durationMs = durationSeconds * 1000;

        if (
          samples.length <
          sampleRate * MIN_RECORDING_SECONDS
        ) {
          showZeroScoreResult(
            'Your recording was too short to detect singing. Your score is 0%. Please sing the full pattern and try again.',
            durationMs,
          );
          return;
        }

        let sumSquares = 0;

        for (let i = 0; i < samples.length; i++) {
          sumSquares += samples[i] * samples[i];
        }

        const rms = Math.sqrt(sumSquares / samples.length);

        if (!Number.isFinite(rms) || rms < MIN_RECORDING_RMS) {
          showZeroScoreResult(
            'No clear singing was detected. Move closer to the microphone and sing in a quiet area.',
            durationMs,
          );
          return;
        }

        const measurement = measureRapidScaleTrill(
          samples,
          sampleRate,
          config.frequencies,
          config.repetitions,
        );

        const scored = scoreRapidScaleTrill(
          measurement,
          config.accuracyThreshold,
        );

        if (
          !mountedRef.current ||
          quitInProgressRef.current ||
          confirmationRef.current !== null
        ) {
          return;
        }

        const finalResult: RapidScaleTrillResult = {
          overall: scored.overall,
          pitchScore: scored.pitchScore,
          sequenceScore: scored.sequenceScore,
          transitionScore: scored.transitionScore,
          speedScore: scored.speedScore,
          passed: scored.passed,
          feedback: scored.feedback,
          noteCount: measurement.noteCount,
          correctNoteCount: measurement.correctNoteCount,
          transitionCount: measurement.transitionCount,
          correctTransitionCount:
            measurement.correctTransitionCount,
          averageTransitionTimeMs:
            measurement.averageTransitionTimeMs,
          notesPerSecond: measurement.notesPerSecond,
          durationMs: measurement.durationMs,
        };

        setResult(finalResult);
        setCurrentPhase('results');

        if (tier && !savedAttemptRef.current) {
          savedAttemptRef.current = true;

          void saveCompletedExercise(
            'agility',
            'rapidScaleTrill',
            tier,
            scored.overall,
          )
            .then(() => {
              console.log(
                'Rapid Scale Trill progress saved:',
                scored.overall,
              );
            })
            .catch(error => {
              console.error(
                'Failed to save Rapid Scale Trill progress:',
                error,
              );
            });
        }
      } catch (error) {
        console.error(
          'Rapid Scale Trill processing failed:',
          error,
        );

        if (
          !mountedRef.current ||
          quitInProgressRef.current ||
          confirmationRef.current !== null
        ) {
          return;
        }

        setCurrentPhase('instructions');

        Alert.alert(
          'Recording Not Processed',
          error instanceof Error
            ? error.message
            : 'Unable to process the recording. Please try again.',
          [
            {
              text: 'Try Again',
              onPress: resetExercise,
            },
          ],
        );
      } finally {
        processingRef.current = false;
      }
    },
    [
      config,
      setCurrentPhase,
      showZeroScoreResult,
      tier,
    ],
  );

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      clearRecordingTimer();

      if (
        !mountedRef.current ||
        phaseRef.current !== 'recording' ||
        quitInProgressRef.current ||
        confirmationRef.current !== null
      ) {
        return;
      }

      setActiveExerciseNoteIndex(null);
      activeExerciseNoteIndexRef.current = null;
      setLivePitchHz(null);
      setLivePitchStatus(null);

      if (!hasSufficientRecordedSignal(samples)) {
        setRecordingTime(0);
        setCurrentPhase('reference');
        setShowNoAudioModal(true);
        return;
      }

      void processRecording(samples, sampleRate);
    },
    [
      clearRecordingTimer,
      processRecording,
      setCurrentPhase,
    ],
  );

  const {
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording,
    cancelRecording: cancelAudioRecording,
  } = useAudioRecorder({
    analyzePitch: true,
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  const cancelActiveRecording = useCallback(async () => {
    clearRecordingTimer();

    recordingStopRequestedRef.current = true;

    try {
      await cancelAudioRecording();
    } catch (error) {
      console.warn('Could not cancel audio recording:', error);
    }
  }, [cancelAudioRecording, clearRecordingTimer]);

  const requestRecordingStop = useCallback(() => {
    if (
      recordingStopRequestedRef.current ||
      phaseRef.current !== 'recording' ||
      quitInProgressRef.current ||
      confirmationRef.current !== null
    ) {
      return;
    }

    recordingStopRequestedRef.current = true;
    clearRecordingTimer();

    void stopAudioRecording();
  }, [clearRecordingTimer, stopAudioRecording]);

  const startRecording = useCallback(async () => {
    if (
      !config ||
      quitInProgressRef.current ||
      confirmationRef.current !== null
    ) {
      return;
    }

    try {
      processingRef.current = false;
      recordingStopRequestedRef.current = false;

      recordingStartRef.current = null;

      activeExerciseNoteIndexRef.current = null;

      setLivePitchHz(null);
      setLivePitchStatus(null);
      setActiveExerciseNoteIndex(null);
      setRecordingTime(0);
      setCurrentPhase('recording');

      await startAudioRecording();

      if (
        !mountedRef.current ||
        quitInProgressRef.current ||
        confirmationRef.current !== null ||
        phaseRef.current !== 'recording'
      ) {
        await cancelAudioRecording();
        return;
      }

      recordingStartRef.current = Date.now();

      recordingTimerRef.current = setInterval(() => {
        const startedAt = recordingStartRef.current;

        if (
          startedAt === null ||
          processingRef.current ||
          recordingStopRequestedRef.current ||
          quitInProgressRef.current ||
          confirmationRef.current !== null ||
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        const elapsed = (Date.now() - startedAt) / 1000;

        setRecordingTime(
          Math.min(elapsed, targetSequenceDurationSeconds),
        );

        const completedRepetitions =
          singleSequenceDurationSeconds > 0
            ? Math.floor(elapsed / singleSequenceDurationSeconds)
            : 0;

        const nextRep = Math.min(
          repetitions,
          completedRepetitions + 1,
        );

        if (nextRep !== currentRep) {
          setCurrentRep(nextRep);
        }

        const elapsedWithinSequence =
          singleSequenceDurationSeconds > 0
            ? elapsed % singleSequenceDurationSeconds
            : 0;

        const nextNoteIndex =
          elapsed >= targetSequenceDurationSeconds
            ? null
            : Math.min(
                frequencies.length - 1,
                Math.floor(
                  elapsedWithinSequence / noteDurationSec,
                ),
              );

        if (
          nextNoteIndex !== activeExerciseNoteIndexRef.current
        ) {
          activeExerciseNoteIndexRef.current = nextNoteIndex;

          setActiveExerciseNoteIndex(nextNoteIndex);
          setLivePitchHz(null);
          setLivePitchStatus(null);
        }

        if (elapsed >= targetSequenceDurationSeconds) {
          requestRecordingStop();
        }
      }, 100);
    } catch (error) {
      console.error('Failed to start recording:', error);

      await cancelAudioRecording();

      if (
        !mountedRef.current ||
        quitInProgressRef.current ||
        confirmationRef.current !== null
      ) {
        return;
      }

      recordingStopRequestedRef.current = false;
      setCurrentPhase('reference');

      Alert.alert(
        'Recording Error',
        error instanceof Error
          ? error.message
          : 'The recording could not be started. Please try again.',
      );
    }
  }, [
    cancelAudioRecording,
    config,
    currentRep,
    frequencies.length,
    noteDurationSec,
    repetitions,
    requestRecordingStop,
    setCurrentPhase,
    singleSequenceDurationSeconds,
    startAudioRecording,
    targetSequenceDurationSeconds,
  ]);

  const startCountdown = useCallback(async () => {
    if (
      referencePlayingRef.current ||
      phaseRef.current !== 'reference' ||
      confirmationRef.current !== null ||
      !hasUsableSequence ||
      quitInProgressRef.current
    ) {
      return;
    }

    const runId = ++countdownRunRef.current;

    clearCountdownTimer();

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setCurrentPhase('countdown');

    for (
      let value = EXERCISE_COUNTDOWN_SECONDS;
      value >= 1;
      value--
    ) {
      if (
        countdownRunRef.current !== runId ||
        quitInProgressRef.current ||
        confirmationRef.current !== null
      ) {
        return;
      }

      setCountdown(value);

      await new Promise<void>(resolve => {
        countdownTimerRef.current = setTimeout(() => {
          countdownTimerRef.current = null;
          resolve();
        }, 1000);
      });
    }

    if (
      countdownRunRef.current !== runId ||
      quitInProgressRef.current ||
      confirmationRef.current !== null
    ) {
      return;
    }

    await startRecording();
  }, [
    clearCountdownTimer,
    hasUsableSequence,
    setCurrentPhase,
    startRecording,
  ]);

  const beginExercise = useCallback(() => {
    if (
      quitInProgressRef.current ||
      confirmationRef.current !== null
    ) {
      return;
    }

    if (!hasUsableSequence || !vocalRange) {
      Alert.alert(
        'Vocal Assessment Required',
        vocalRangeError ??
          'Complete a valid vocal assessment before starting this exercise.',
      );

      return;
    }

    savedAttemptRef.current = false;
    processingRef.current = false;
    recordingStopRequestedRef.current = false;

    setCurrentRep(1);
    setRecordingTime(0);
    setResult(null);
    setLivePitchHz(null);
    setLivePitchStatus(null);
    setActiveExerciseNoteIndex(null);
    activeExerciseNoteIndexRef.current = null;
    setActiveReferenceNoteIndex(null);

    setCurrentPhase('reference');
  }, [
    hasUsableSequence,
    setCurrentPhase,
    vocalRange,
    vocalRangeError,
  ]);

  const pauseForExitPrompt = useCallback(() => {
    if (
      !mountedRef.current ||
      confirmationRef.current !== null ||
      quitInProgressRef.current
    ) {
      return;
    }

    const interruptedPhase = phaseRef.current;

    pausedPhaseRef.current = interruptedPhase;

    resumeInterruptedRepetitionRef.current =
      interruptedPhase === 'recording' ||
      interruptedPhase === 'countdown';

    clearCountdownTimer();

    if (interruptedPhase === 'countdown') {
      countdownRunRef.current += 1;
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    }

    if (interruptedPhase === 'recording') {
      void cancelActiveRecording();

      setRecordingTime(0);
      setActiveExerciseNoteIndex(null);
      activeExerciseNoteIndexRef.current = null;
      setLivePitchHz(null);
      setLivePitchStatus(null);
    }

    cancelReferencePlayback();

    setCurrentConfirmation('quit');
  }, [
    cancelActiveRecording,
    cancelReferencePlayback,
    clearCountdownTimer,
    setCurrentConfirmation,
  ]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    const interruptedPhase = pausedPhaseRef.current;
    const shouldResume =
      resumeInterruptedRepetitionRef.current;

    setCurrentConfirmation(null);

    pausedPhaseRef.current = null;
    resumeInterruptedRepetitionRef.current = false;

    if (
      shouldResume &&
      hasUsableSequence &&
      (interruptedPhase === 'recording' ||
        interruptedPhase === 'countdown')
    ) {
      setCurrentPhase('reference');

      setTimeout(() => {
        if (
          mountedRef.current &&
          !quitInProgressRef.current &&
          confirmationRef.current === null &&
          phaseRef.current === 'reference'
        ) {
          void startCountdown();
        }
      }, 100);
    }
  }, [
    hasUsableSequence,
    setCurrentConfirmation,
    setCurrentPhase,
    startCountdown,
  ]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    setIsQuitting(true);

    countdownRunRef.current += 1;
    referenceRunRef.current += 1;

    clearCountdownTimer();
    cancelReferencePlayback();

    await cancelActiveRecording();

    closeAudioContext();

    processingRef.current = false;
    resumeInterruptedRepetitionRef.current = false;
    pausedPhaseRef.current = null;

    setCurrentConfirmation(null);

    router.replace('/exercises/agility');
  }, [
    cancelActiveRecording,
    cancelReferencePlayback,
    clearCountdownTimer,
    closeAudioContext,
    setCurrentConfirmation,
  ]);

  const resetExercise = useCallback(() => {
    if (quitInProgressRef.current) return;

    countdownRunRef.current += 1;

    clearCountdownTimer();
    cancelReferencePlayback();

    void cancelActiveRecording();

    processingRef.current = false;
    recordingStopRequestedRef.current = false;
    savedAttemptRef.current = false;
    quitInProgressRef.current = false;

    resumeInterruptedRepetitionRef.current = false;
    pausedPhaseRef.current = null;

    activeExerciseNoteIndexRef.current = null;

    setResult(null);
    setRecordingTime(0);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setCurrentRep(1);

    setLivePitchHz(null);
    setLivePitchStatus(null);

    setActiveReferenceNoteIndex(null);
    setActiveExerciseNoteIndex(null);

    setIsQuitting(false);
    setShowNoAudioModal(false);
    setCurrentConfirmation(null);
    setCurrentPhase('instructions');
  }, [
    cancelActiveRecording,
    cancelReferencePlayback,
    clearCountdownTimer,
    setCurrentConfirmation,
    setCurrentPhase,
  ]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (confirmationRef.current === 'quit') {
          return true;
        }

        if (confirmationRef.current === 'tryAgain') {
          setCurrentConfirmation(null);
          return true;
        }

        pauseForExitPrompt();
        return true;
      },
    );

    return () => subscription.remove();
  }, [pauseForExitPrompt, setCurrentConfirmation]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;

      countdownRunRef.current += 1;
      referenceRunRef.current += 1;

      clearCountdownTimer();
      clearRecordingTimer();

      referencePlayingRef.current = false;

      void cancelAudioRecording();
      closeAudioContext();
    };
  }, [
    cancelAudioRecording,
    clearCountdownTimer,
    clearRecordingTimer,
    closeAudioContext,
  ]);

  const renderInstructions = () => (
    <ExerciseScreen
      title="Rapid Scale Trill"
      category="Vocal Agility"
      icon="flash-outline"
      instructions="Listen to the reference scale pattern, then sing the notes in order while keeping each pitch clear and controlled."
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
        {
          label: 'DIFFICULTY',
          value: config?.label ?? (tier ?? 'beginner'),
        },
        {
          label: 'SPEED',
          value: config?.speedLabel ?? '—',
        },
        {
          label: 'NOTES',
          value: String(frequencies.length),
        },
        {
          label: 'REPETITIONS',
          value: String(repetitions),
        },
        {
          label: 'NOTE DURATION',
          value: config
            ? `${config.noteDurationSec.toFixed(2)}s`
            : '—',
        },
        {
          label: 'SEQUENCE',
          value:
            frequencies
              .map(frequencyToNoteName)
              .join(' • ') || 'Unavailable',
        },
      ]}
      tip={
        vocalRangeError ??
        'Focus on clean pitch changes first. Build speed naturally while maintaining accuracy.'
      }
      tier={tier ?? 'beginner'}
      startDisabled={
        tierLoading ||
        isLoadingAdaptiveParams ||
        !hasUsableSequence ||
        !vocalRange
      }
      startLabel={
        tierLoading || isLoadingAdaptiveParams
          ? 'Preparing Exercise...'
          : !vocalRange || !hasUsableSequence
            ? 'Vocal Assessment Required'
            : 'Start Exercise'
      }
      onBack={pauseForExitPrompt}
      onStart={beginExercise}
    />
  );

  const renderReference = () => (
    <ExerciseListeningScreen
      icon="musical-notes-outline"
      title="Rapid Scale Trill"
      currentRep={currentRep}
      repetitions={repetitions}
      promptTitle="Listen to the Reference"
      prompt="Listen to the full sequence, then sing the same notes in order."
      liveContent={
        <AgilitySequenceGuide
          names={frequencies.map(frequencyToNoteName)}
          activeIndex={activeReferenceNoteIndex}
          caption={`Range: ${vocalRange?.lowHz.toFixed(0)}-${vocalRange?.highHz.toFixed(0)} Hz`}
        />
      }
      isPlayingReference={referencePlaying}
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
      repetitions={repetitions}
      countdown={countdown}
      promptTitle="Prepare to Sing"
      prompt={`Get ready to sing repetition ${currentRep} of ${repetitions}.`}
      onBack={pauseForExitPrompt}
      contentStyle={styles.rapidScaleCountdown}
    />
  );

  const renderRecording = () => {
    const progress =
      targetSequenceDurationSeconds > 0
        ? Math.min(
            recordingTime / targetSequenceDurationSeconds,
            1,
          )
        : 0;

    const activeStatusColor =
      getPitchStatusColor(livePitchStatus);

    return (
      <ExerciseRecordingScreen
        title="Sing the Scale"
        currentRep={currentRep}
        repetitions={repetitions}
        onBack={pauseForExitPrompt}
      >
        <AgilitySequenceGuide
          names={frequencies.map(frequencyToNoteName)}
          activeIndex={activeExerciseNoteIndex}
          liveNote={
            livePitchHz === null
              ? undefined
              : frequencyToNoteName(livePitchHz)
          }
          showFeedback
          caption="Follow the highlighted note."
        />

        <View style={styles.liveCard}>

          <Text style={styles.liveLabel}>
            CURRENT NOTE
          </Text>

          <Text style={styles.detectedPitchText}>
            {livePitchHz  ?? '--' }
          </Text>

          <Text style={styles.detectedPitchTextSub}>
             {livePitchStatus ?? '--'}
          </Text>
        </View>

        <View style={styles.timerTrack}>
          <View
            style={[
              styles.timerFill,
              { width: `${progress * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.timerText}>
          Recording Time: {recordingTime.toFixed(1)}s
        </Text>
      </ExerciseRecordingScreen>
    );
  };

  const renderProcessing = () => (
    <ExerciseProcessingScreen
      icon="analytics-outline"
      title="Analyzing Your Singing"
      message="Measuring pitch accuracy, sequence accuracy, transitions, and speed."
    />
  );

  const renderResults = () => {
    if (!result) return null;

    const rows = [
      {
        label: 'Pitch Accuracy',
        score: result.pitchScore,
      },
      {
        label: 'Sequence Accuracy',
        score: result.sequenceScore,
      },
      {
        label: 'Transition Accuracy',
        score: result.transitionScore,
      },
      {
        label: 'Speed Score',
        score: result.speedScore,
      },
    ];

    return (
      <ExerciseResultsScreen
        title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
        subtitle="Rapid Scale Trill Result"
        score={Math.round(result.overall)}
        scoreSuffix="/ 100"
        resultIcon={result.passed ? 'checkmark' : 'refresh'}
        scoreMessage={result.feedback}
        scoreDetails={
          <Text style={styles.scoreDetailsText}>
            Correct notes: {result.correctNoteCount}/
            {result.noteCount}
          </Text>
        }
        onBack={pauseForExitPrompt}
        onRetry={() => setCurrentConfirmation('tryAgain')}
        onExit={pauseForExitPrompt}
      >
        <View style={styles.referenceCard}>
          <Text style={styles.cardTitle}>
            Performance Breakdown
          </Text>

          {rows.map(row => (
            <View key={row.label} style={styles.scoreRow}>
              <View style={styles.scoreRowHeader}>
                <Text style={styles.metricLabel}>
                  {row.label}
                </Text>

                <Text style={styles.metricValue}>
                  {Math.round(row.score)}%
                </Text>
              </View>

              <View style={styles.timerTrack}>
                <View
                  style={[
                    styles.timerFill,
                    {
                      width: `${Math.min(100, Math.max(0, row.score))}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>

        <View style={styles.referenceCard}>
          <Text style={styles.cardTitle}>
            Performance Metrics
          </Text>

          <MetricRow
            label="Correct Notes"
            value={`${result.correctNoteCount}/${result.noteCount}`}
          />

          <MetricRow
            label="Correct Transitions"
            value={`${result.correctTransitionCount}/${result.transitionCount}`}
          />

          <MetricRow
            label="Average Transition"
            value={`${Math.round(result.averageTransitionTimeMs)} ms`}
          />

          <MetricRow
            label="Notes per Second"
            value={result.notesPerSecond.toFixed(2)}
          />

          <MetricRow
            label="Duration"
            value={`${(result.durationMs / 1000).toFixed(1)}s`}
          />
        </View>
      </ExerciseResultsScreen>
    );
  };

  const isPreparing =
    tierLoading || isLoadingAdaptiveParams;

  const quitMessage =
    pausedPhaseRef.current === 'instructions' ||
    pausedPhaseRef.current === 'results'
      ? 'Are you sure you want to leave Rapid Scale Trill?'
      : pausedPhaseRef.current === 'recording'
        ? 'Your exercise is paused. Your current recording will be discarded. Continue to restart the current repetition.'
        : pausedPhaseRef.current === 'countdown'
          ? 'Your exercise is paused. Continue to restart the countdown for the current repetition.'
          : 'Your exercise is paused. Continue to resume your exercise.';

  return (
    <>
      {isPreparing ? (
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Loading your difficulty level and vocal range from your assessment."
          icon="options-outline"
          iconSize={40}
        />
      ) : (
        <View style={styles.screen}>
          {phase === 'instructions' && renderInstructions()}
          {phase === 'reference' && renderReference()}
          {phase === 'countdown' && renderCountdown()}
          {phase === 'recording' && renderRecording()}
          {phase === 'processing' && renderProcessing()}

          {phase === 'results' && (
            <ScrollView
              style={styles.screen}
              contentContainerStyle={styles.resultsWrapper}
              showsVerticalScrollIndicator={false}
            >
              {renderResults()}
            </ScrollView>
          )}
        </View>
      )}

      <ExerciseQuitModal
        visible={confirmation === 'quit'}
        title="Quit exercise?"
        message={quitMessage}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => void quitExercise()}
        continueLabel="Continue Exercise"
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />

      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={() => {
          setShowNoAudioModal(false);

          recordingStopRequestedRef.current = false;
          processingRef.current = false;

          setRecordingTime(0);
          setResult(null);
          setLivePitchHz(null);
          setLivePitchStatus(null);
          setActiveExerciseNoteIndex(null);
          activeExerciseNoteIndexRef.current = null;

          setCurrentRep(1);
          setCurrentPhase('reference');

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
        onRequestClose={() => setCurrentConfirmation(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <Ionicons
                name="refresh-outline"
                size={30}
                color={COLORS.brown}
              />
            </View>

            <Text style={styles.modalTitle}>
              Try Again?
            </Text>

            <Text style={styles.modalMessage}>
              Your current result will be cleared so you can repeat
              the exercise.
            </Text>

            <Pressable
              accessibilityRole="button"
              disabled={isQuitting}
              onPress={resetExercise}
              style={({ pressed }) => [
                styles.continueButton,
                pressed && styles.buttonPressed,
                isQuitting && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.continueButtonText}>
                Restart Exercise
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={isQuitting}
              onPress={() => setCurrentConfirmation(null)}
              style={({ pressed }) => [
                styles.quitButton,
                pressed && styles.buttonPressed,
                isQuitting && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.quitButtonText}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  rapidScaleCountdown: {
    paddingTop: 250,
  },
  resultsWrapper: {
    flexGrow: 1,
    width: '100%',
  },
  referenceCard: {
    width: '100%',
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    marginTop: 20,
  },
  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: COLORS.brown,
    marginBottom: 12,
  },
  liveCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 18,
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: COLORS.muted,
  },
  detectedPitchText: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: COLORS.brown,
    textAlign: 'center',
    marginTop: 8,
  },
  detectedPitchTextSub: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 4,
    textAlign: 'center',
  },
  pitchStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 4,
  },
  pitchStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 10,
    marginBottom: 6,
    textAlign: 'center',
  },
  timerTrack: {
    width: '100%',
    height: 8,
    backgroundColor: COLORS.background,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 10,
  },
  timerFill: {
    height: '100%',
    backgroundColor: COLORS.pink,
    borderRadius: 4,
  },
  scoreDetailsText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
  },
  scoreRow: {
    marginBottom: 14,
  },
  scoreRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  metricLabel: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
  },
  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: COLORS.brown,
    marginLeft: 12,
    textAlign: 'right',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: COLORS.transparentbrown,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: COLORS.white,
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    marginBottom: 15,
  },
  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: COLORS.brown,
    textAlign: 'center',
  },
  modalMessage: {
    marginTop: 10,
    marginBottom: 23,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.muted,
    textAlign: 'center',
  },
  continueButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: COLORS.pink,
  },
  continueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.brown,
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
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  quitButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: COLORS.muted,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});