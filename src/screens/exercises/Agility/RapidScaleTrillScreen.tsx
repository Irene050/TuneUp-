import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  AudioContext,
  AudioManager,
  AudioRecorder,
} from 'react-native-audio-api';

import {
  RAPID_SCALE_TRILL_PARAMS,
  type Tier,
} from '@/constants/agility';
import ExerciseScreen from '@/screens/exercises/ExerciseScreen';
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
import { frequencyToNoteName } from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const GUIDE_GREEN = '#4F9B67';
const GUIDE_YELLOW = '#D9A72E';
const GUIDE_RED = '#D64F5A';

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const MAX_RECORDING_BUFFER_SECONDS = 20;
const COUNTDOWN_SECONDS = 3;
const MIN_RECORDING_SECONDS = 0.25;
const MIN_RECORDING_RMS = 0.001;

const GOOD_NOTE_SEMITONES = 0.5;
const CLOSE_NOTE_SEMITONES = 1.5;

const MIN_PITCH_HZ = 65;
const MAX_PITCH_HZ = 1000;
const MIN_PITCH_CONFIDENCE = 0.65;

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

type PitchStatus = 'match' | 'close' | 'miss' | null;

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

function estimatePitchHz(
  input: Float32Array,
  sampleRate: number,
): number | null {
  if (input.length < 1024) return null;

  const samples: number[] = [];

  for (let i = 0; i < input.length; i += 2) {
    samples.push(input[i]);
  }

  const effectiveSampleRate = sampleRate / 2;
  const sampleCount = samples.length;

  if (sampleCount < 512) return null;

  let mean = 0;

  for (let i = 0; i < sampleCount; i++) {
    mean += samples[i];
  }

  mean /= sampleCount;

  const centered = new Float32Array(sampleCount);
  let sumSquares = 0;

  for (let i = 0; i < sampleCount; i++) {
    centered[i] = samples[i] - mean;
    sumSquares += centered[i] * centered[i];
  }

  const rms = Math.sqrt(sumSquares / sampleCount);

  if (!Number.isFinite(rms) || rms < MIN_RECORDING_RMS) {
    return null;
  }

  const minLag = Math.max(
    2,
    Math.floor(effectiveSampleRate / MAX_PITCH_HZ),
  );

  const maxLag = Math.min(
    Math.floor(effectiveSampleRate / MIN_PITCH_HZ),
    Math.floor(sampleCount / 2),
  );

  if (maxLag <= minLag) return null;

  let bestLag = -1;
  let bestCorrelation = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;
    let energyA = 0;
    let energyB = 0;

    const limit = sampleCount - lag;

    for (let i = 0; i < limit; i++) {
      const a = centered[i];
      const b = centered[i + lag];

      correlation += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const denominator = Math.sqrt(energyA * energyB);

    if (denominator <= 0) continue;

    const normalizedCorrelation = correlation / denominator;

    if (normalizedCorrelation > bestCorrelation) {
      bestCorrelation = normalizedCorrelation;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestCorrelation < MIN_PITCH_CONFIDENCE) {
    return null;
  }

  const frequency = effectiveSampleRate / bestLag;

  if (
    !Number.isFinite(frequency) ||
    frequency < MIN_PITCH_HZ ||
    frequency > MAX_PITCH_HZ
  ) {
    return null;
  }

  return frequency;
}

function getSemitoneDistance(
  detectedFrequency: number,
  targetFrequency: number,
): number {
  if (
    detectedFrequency <= 0 ||
    targetFrequency <= 0 ||
    !Number.isFinite(detectedFrequency) ||
    !Number.isFinite(targetFrequency)
  ) {
    return Infinity;
  }

  return Math.abs(
    12 * Math.log2(detectedFrequency / targetFrequency),
  );
}

function getPitchStatus(
  detectedFrequency: number | null,
  targetFrequency: number | undefined,
): PitchStatus {
  if (
    detectedFrequency === null ||
    targetFrequency === undefined ||
    targetFrequency <= 0
  ) {
    return 'miss';
  }

  const distance = getSemitoneDistance(
    detectedFrequency,
    targetFrequency,
  );

  if (distance <= GOOD_NOTE_SEMITONES) return 'match';
  if (distance <= CLOSE_NOTE_SEMITONES) return 'close';

  return 'miss';
}

function getPitchStatusColor(
  status: PitchStatus,
): string | null {
  switch (status) {
    case 'match':
      return GUIDE_GREEN;
    case 'close':
      return GUIDE_YELLOW;
    case 'miss':
      return GUIDE_RED;
    default:
      return null;
  }
}

function isTier(value: unknown): value is Tier {
  return (
    value === 'beginner' ||
    value === 'intermediate' ||
    value === 'advanced'
  );
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
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [currentRepetition, setCurrentRepetition] = useState(1);
  const [recordingTime, setRecordingTime] = useState(0);

  const [result, setResult] =
    useState<RapidScaleTrillResult | null>(null);

  const [confirmation, setConfirmation] =
    useState<Confirmation>(null);
  const [isQuitting, setIsQuitting] = useState(false);

  const [referencePlaying, setReferencePlaying] = useState(false);
  const [activeReferenceNoteIndex, setActiveReferenceNoteIndex] =
    useState<number | null>(null);

  const [activeExerciseNoteIndex, setActiveExerciseNoteIndex] =
    useState<number | null>(null);

  const [livePitchHz, setLivePitchHz] = useState<number | null>(
    null,
  );
  const [livePitchStatus, setLivePitchStatus] =
    useState<PitchStatus>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);

  const samplesRef = useRef<Float32Array>(
    new Float32Array(
      SAMPLE_RATE * MAX_RECORDING_BUFFER_SECONDS,
    ),
  );

  const sampleCountRef = useRef(0);
  const recordingStartRef = useRef<number | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const countdownTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const processingRef = useRef(false);
  const countdownRunRef = useRef(0);
  const referenceRunRef = useRef(0);

  const referencePlayingRef = useRef(false);
  const savedAttemptRef = useRef(false);

  const repetitionStartSampleCountRef = useRef(0);
  const activeExerciseNoteIndexRef = useRef<number | null>(null);

  const phaseRef = useRef<Phase>('instructions');
  const confirmationRef = useRef<Confirmation>(null);
  const pausedPhaseRef = useRef<Phase | null>(null);

  const resumeInterruptedRepetitionRef = useRef(false);
  const quittingRef = useRef(false);
  const mountedRef = useRef(true);

  const frequencies = config?.frequencies ?? [];
  const noteDurationSec = config?.noteDurationSec ?? 0;

  const repetitions =
    config?.repetitions ??
    RAPID_SCALE_TRILL_PARAMS.beginner.repetitions;

  const accuracyThreshold =
    config?.accuracyThreshold ??
    RAPID_SCALE_TRILL_PARAMS.beginner.accuracyThreshold;

  const targetSequenceDurationSeconds =
    frequencies.length * noteDurationSec;

  const expectedTargetNoteCount =
    frequencies.length * repetitions;

  const hasUsableSequence =
    frequencies.length > 0 && noteDurationSec > 0;

  const setCurrentPhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const setCurrentConfirmation = useCallback(
    (nextConfirmation: Confirmation) => {
      confirmationRef.current = nextConfirmation;
      setConfirmation(nextConfirmation);
    },
    [],
  );

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load the user's current Agility tier.
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

        const candidate = progress?.currentTier;

        if (!cancelled) {
          setTier(
            isTier(candidate) ? candidate : 'beginner',
          );
        }
      } catch (error) {
        console.error('Failed to load Agility tier:', error);

        if (!cancelled) setTier('beginner');
      } finally {
        if (!cancelled) setTierLoading(false);
      }
    }

    void loadTier();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  // Load adaptive parameters and the assessed vocal range.
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

        if (!generated.frequencies.length) {
          setVocalRangeError(
            'Your assessed vocal range could not produce a suitable note sequence. Please update your vocal assessment and try again.',
          );
          return;
        }

        if (!cancelled) setConfig(generated);
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

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingStartRef.current = null;

    const recorder = recorderRef.current;
    recorderRef.current = null;

    if (recorder) {
      try {
        recorder.clearOnAudioReady();
      } catch (error) {
        console.warn(
          'Could not clear the audio callback:',
          error,
        );
      }

      try {
        void recorder.stop();
      } catch (error) {
        console.warn('Could not stop the recorder:', error);
      }
    }
  }, []);

  const cancelReferencePlayback = useCallback(() => {
    referenceRunRef.current += 1;
    referencePlayingRef.current = false;

    setReferencePlaying(false);
    setActiveReferenceNoteIndex(null);
  }, []);

  const closeAudioContext = useCallback(() => {
    const context = audioContextRef.current;
    audioContextRef.current = null;

    if (context) {
      try {
        void context.close();
      } catch (error) {
        console.warn(
          'Could not close the audio context:',
          error,
        );
      }
    }
  }, []);

  const requestMicrophonePermission =
    useCallback(async (): Promise<boolean> => {
      try {
        return (
          (await AudioManager.requestRecordingPermissions()) ===
          'Granted'
        );
      } catch (error) {
        console.warn(
          'Microphone permission request failed:',
          error,
        );

        return false;
      }
    }, []);

  const playReference = useCallback(async () => {
    if (
      referencePlayingRef.current ||
      phaseRef.current !== 'reference' ||
      confirmationRef.current !== null ||
      quittingRef.current ||
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
          sampleRate: SAMPLE_RATE,
        });

        audioContextRef.current = context;
      }

      await context.resume();

      for (const [index, frequency] of frequencies.entries()) {
        if (
          referenceRunRef.current !== runId ||
          quittingRef.current ||
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

        setActiveReferenceNoteIndex(index);

        oscillator.start(startTime);
        oscillator.stop(startTime + noteDurationSec);

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

  const startRecording = useCallback(async () => {
    if (
      !config ||
      quittingRef.current ||
      confirmationRef.current !== null
    ) {
      return;
    }

    try {
      processingRef.current = false;

      repetitionStartSampleCountRef.current =
        sampleCountRef.current;

      setLivePitchHz(null);
      setLivePitchStatus(null);

      const recorder = new AudioRecorder();
      recorderRef.current = recorder;

      const callbackResult = recorder.onAudioReady(
        {
          sampleRate: SAMPLE_RATE,
          bufferLength: BUFFER_SIZE,
          channelCount: 1,
        },
        ({ buffer, numFrames }) => {
          if (
            recorderRef.current !== recorder ||
            quittingRef.current ||
            confirmationRef.current !== null ||
            phaseRef.current !== 'recording'
          ) {
            return;
          }

          try {
            const channelData = buffer.getChannelData(0);

            const frameCount = Math.min(
              numFrames,
              channelData.length,
            );

            const remaining =
              samplesRef.current.length -
              sampleCountRef.current;

            const count = Math.min(frameCount, remaining);

            for (let i = 0; i < count; i++) {
              samplesRef.current[
                sampleCountRef.current + i
              ] = channelData[i];
            }

            sampleCountRef.current += count;

            const pitch = estimatePitchHz(
              channelData.subarray(0, frameCount),
              SAMPLE_RATE,
            );

            const activeIndex =
              activeExerciseNoteIndexRef.current;

            if (activeIndex !== null) {
              setLivePitchHz(pitch);

              setLivePitchStatus(
                getPitchStatus(
                  pitch,
                  config.frequencies[activeIndex],
                ),
              );
            }
          } catch (error) {
            console.warn(
              'Failed to capture or analyze audio frame:',
              error,
            );
          }
        },
      );

      if (callbackResult.status === 'error') {
        throw new Error(callbackResult.message);
      }

      if (
        quittingRef.current ||
        confirmationRef.current !== null
      ) {
        stopRecording();
        return;
      }

      const startResult = await recorder.start();

      if (startResult.status === 'error') {
        throw new Error(startResult.message);
      }

      if (
        quittingRef.current ||
        confirmationRef.current !== null
      ) {
        stopRecording();
        return;
      }

      recordingStartRef.current = Date.now();
      setRecordingTime(0);
      setCurrentPhase('recording');

      recordingTimerRef.current = setInterval(() => {
        const startedAt = recordingStartRef.current;

        if (
          startedAt === null ||
          processingRef.current ||
          quittingRef.current ||
          confirmationRef.current !== null ||
          phaseRef.current !== 'recording'
        ) {
          return;
        }

        const elapsed = (Date.now() - startedAt) / 1000;

        setRecordingTime(
          Math.min(elapsed, targetSequenceDurationSeconds),
        );

        const noteDurationMs = Math.max(
          1,
          noteDurationSec * 1000,
        );

        const sequenceDurationMs =
          noteDurationMs * frequencies.length;

        const elapsedMs = elapsed * 1000;

        let nextNoteIndex: number | null = null;

        if (
          frequencies.length > 0 &&
          elapsedMs < sequenceDurationMs
        ) {
          nextNoteIndex = Math.min(
            frequencies.length - 1,
            Math.floor(
              (elapsedMs % sequenceDurationMs) /
                noteDurationMs,
            ),
          );
        }

        if (
          nextNoteIndex !== activeExerciseNoteIndexRef.current
        ) {
          activeExerciseNoteIndexRef.current = nextNoteIndex;

          setActiveExerciseNoteIndex(nextNoteIndex);
          setLivePitchHz(null);
          setLivePitchStatus(null);
        }

        if (elapsed >= targetSequenceDurationSeconds) {
          activeExerciseNoteIndexRef.current = null;

          setActiveExerciseNoteIndex(null);
          setLivePitchHz(null);
          setLivePitchStatus(null);

          stopRecording();

          if (currentRepetition < repetitions) {
            setCurrentRepetition(previous => previous + 1);
            setCurrentPhase('reference');
          } else {
            void processRecording();
          }
        }
      }, 30);
    } catch (error) {
      console.error('Failed to start recording:', error);

      stopRecording();

      if (
        !mountedRef.current ||
        quittingRef.current ||
        confirmationRef.current !== null
      ) {
        return;
      }

      Alert.alert(
        'Recording Error',
        error instanceof Error
          ? error.message
          : 'The recording could not be started. Please try again.',
      );

      setCurrentPhase('reference');
    }
  }, [
    config,
    currentRepetition,
    frequencies.length,
    noteDurationSec,
    repetitions,
    stopRecording,
    targetSequenceDurationSeconds,
  ]);

  const startCountdown = useCallback(async () => {
    if (
      referencePlayingRef.current ||
      phaseRef.current !== 'reference' ||
      confirmationRef.current !== null ||
      !hasUsableSequence ||
      quittingRef.current
    ) {
      return;
    }

    const runId = ++countdownRunRef.current;

    clearCountdownTimer();

    setCountdown(COUNTDOWN_SECONDS);
    setCurrentPhase('countdown');

    for (
      let value = COUNTDOWN_SECONDS;
      value >= 1;
      value--
    ) {
      if (
        countdownRunRef.current !== runId ||
        quittingRef.current ||
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
      quittingRef.current ||
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

  const showZeroScoreResult = useCallback(
    (feedback: string, durationMs: number) => {
      if (
        quittingRef.current ||
        confirmationRef.current !== null
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

  const processRecording = useCallback(async () => {
    if (
      processingRef.current ||
      !config ||
      quittingRef.current ||
      confirmationRef.current !== null
    ) {
      return;
    }

    processingRef.current = true;

    stopRecording();

    setActiveExerciseNoteIndex(null);
    activeExerciseNoteIndexRef.current = null;
    setLivePitchHz(null);
    setLivePitchStatus(null);
    setCurrentPhase('processing');

    try {
      const sampleCount = sampleCountRef.current;

      if (sampleCount < SAMPLE_RATE * MIN_RECORDING_SECONDS) {
        showZeroScoreResult(
          'Your recording was too short to detect singing. Your score is 0%. Please sing the full pattern and try again.',
          (sampleCount / SAMPLE_RATE) * 1000,
        );

        return;
      }

      const samples = samplesRef.current.subarray(
        0,
        sampleCount,
      );

      let sumSquares = 0;

      for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
      }

      const rms = Math.sqrt(sumSquares / samples.length);

      if (rms < MIN_RECORDING_RMS) {
        showZeroScoreResult(
          'No clear singing was detected. Move closer to the microphone and sing in a quiet area.',
          (sampleCount / SAMPLE_RATE) * 1000,
        );

        return;
      }

      const measurement = measureRapidScaleTrill(
        samples,
        SAMPLE_RATE,
        config.frequencies,
        config.repetitions,
      );

      const scored = scoreRapidScaleTrill(
        measurement,
        config.accuracyThreshold,
      );

      if (
        !mountedRef.current ||
        quittingRef.current ||
        confirmationRef.current === 'quit'
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
        quittingRef.current ||
        confirmationRef.current === 'quit'
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
  }, [
    config,
    setCurrentPhase,
    showZeroScoreResult,
    stopRecording,
    tier,
  ]);

  const beginExercise = useCallback(async () => {
    if (
      quittingRef.current ||
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

    const permission = await requestMicrophonePermission();

    if (
      quittingRef.current ||
      confirmationRef.current !== null
    ) {
      return;
    }

    if (!permission) {
      Alert.alert(
        'Microphone Permission Required',
        'Allow microphone access to record your singing.',
      );

      return;
    }

    quittingRef.current = false;
    savedAttemptRef.current = false;
    processingRef.current = false;

    sampleCountRef.current = 0;

    samplesRef.current = new Float32Array(
      SAMPLE_RATE * MAX_RECORDING_BUFFER_SECONDS,
    );

    repetitionStartSampleCountRef.current = 0;

    setCurrentRepetition(1);
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
    requestMicrophonePermission,
    setCurrentPhase,
    setCurrentConfirmation,
    vocalRange,
    vocalRangeError,
  ]);

  /**
   * Pause the current exercise before showing the quit modal.
   * If recording was interrupted, discard only the samples from
   * the current repetition. Earlier completed repetitions remain.
   */
  const pauseForExitPrompt = useCallback(() => {
    if (
      !mountedRef.current ||
      confirmationRef.current !== null ||
      quittingRef.current
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
      setCountdown(COUNTDOWN_SECONDS);
    }

    if (interruptedPhase === 'recording') {
      stopRecording();

      // Remove only the unfinished repetition's samples.
      sampleCountRef.current =
        repetitionStartSampleCountRef.current;

      setRecordingTime(0);
      setActiveExerciseNoteIndex(null);
      activeExerciseNoteIndexRef.current = null;
      setLivePitchHz(null);
      setLivePitchStatus(null);
    }

    // Stop reference playback without changing the current
    // repetition or the samples from completed repetitions.
    cancelReferencePlayback();

    setCurrentConfirmation('quit');
  }, [
    cancelReferencePlayback,
    clearCountdownTimer,
    setCurrentConfirmation,
    stopRecording,
  ]);

  /**
   * Resume the interrupted exercise.
   * Recording and countdown interruptions restart the current
   * repetition from the beginning.
   */
  const continueExercise = useCallback(() => {
    if (quittingRef.current) return;

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

      // Let React close the modal before starting the countdown.
      setTimeout(() => {
        if (
          mountedRef.current &&
          !quittingRef.current &&
          confirmationRef.current === null &&
          phaseRef.current === 'reference'
        ) {
          void startCountdown();
        }
      }, 100);

      return;
    }

    // For reference, instructions, results, or processing,
    // dismissing the modal leaves the current phase in place.
  }, [
    hasUsableSequence,
    setCurrentConfirmation,
    setCurrentPhase,
    startCountdown,
  ]);

  const quitExercise = useCallback(() => {
    if (quittingRef.current) return;

    quittingRef.current = true;
    setIsQuitting(true);

    // Invalidate any pending countdown or reference playback.
    countdownRunRef.current += 1;
    referenceRunRef.current += 1;

    clearCountdownTimer();
    cancelReferencePlayback();
    stopRecording();
    closeAudioContext();

    processingRef.current = false;
    resumeInterruptedRepetitionRef.current = false;
    pausedPhaseRef.current = null;

    setCurrentConfirmation(null);

    // Do not save incomplete work when the user quits.
    router.replace('/exercises/agility');
  }, [
    cancelReferencePlayback,
    clearCountdownTimer,
    closeAudioContext,
    setCurrentConfirmation,
    stopRecording,
  ]);

  const resetExercise = useCallback(() => {
    if (quittingRef.current) return;

    countdownRunRef.current += 1;

    clearCountdownTimer();
    cancelReferencePlayback();
    stopRecording();

    processingRef.current = false;
    savedAttemptRef.current = false;
    quittingRef.current = false;

    resumeInterruptedRepetitionRef.current = false;
    pausedPhaseRef.current = null;

    sampleCountRef.current = 0;

    samplesRef.current = new Float32Array(
      SAMPLE_RATE * MAX_RECORDING_BUFFER_SECONDS,
    );

    repetitionStartSampleCountRef.current = 0;
    activeExerciseNoteIndexRef.current = null;

    setResult(null);
    setRecordingTime(0);
    setCountdown(COUNTDOWN_SECONDS);
    setCurrentRepetition(1);

    setLivePitchHz(null);
    setLivePitchStatus(null);

    setActiveReferenceNoteIndex(null);
    setActiveExerciseNoteIndex(null);

    setIsQuitting(false);
    setCurrentConfirmation(null);
    setCurrentPhase('instructions');
  }, [
    cancelReferencePlayback,
    clearCountdownTimer,
    setCurrentConfirmation,
    setCurrentPhase,
    stopRecording,
  ]);

  // Handle Android hardware back presses.
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

  // Release native audio resources when this screen unmounts.
  useEffect(() => {
    return () => {
      countdownRunRef.current += 1;
      referenceRunRef.current += 1;

      clearCountdownTimer();
      stopRecording();

      referencePlayingRef.current = false;

      closeAudioContext();
    };
  }, [
    clearCountdownTimer,
    closeAudioContext,
    stopRecording,
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
    <View style={styles.content}>
      <Pressable
        style={styles.backButton}
        onPress={pauseForExitPrompt}
        accessibilityRole="button"
        accessibilityLabel="Open exit options"
      >
        <Ionicons
          name="chevron-back"
          size={25}
          color={BROWN}
        />
      </Pressable>

      <View style={styles.iconCircle}>
        <Ionicons
          name="musical-notes-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>
        Listen to the Reference
      </Text>

      <Text style={styles.phaseSubtitle}>
        Repetition {currentRepetition} of {repetitions}
      </Text>

      <View style={styles.referenceCard}>
        <Text style={styles.cardTitle}>
          Reference Sequence
        </Text>

        <View style={styles.noteSequence}>
          {frequencies.map((frequency, index) => {
            const active = activeReferenceNoteIndex === index;

            return (
              <View
                key={`${frequency}-${index}`}
                style={[
                  styles.notePill,
                  active && styles.notePillActive,
                ]}
              >
                <Text
                  style={[
                    styles.noteNumber,
                    active && styles.activeText,
                  ]}
                >
                  {index + 1}
                </Text>

                <Text
                  style={[
                    styles.noteText,
                    active && styles.activeText,
                  ]}
                >
                  {frequencyToNoteName(frequency)}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.referenceHint}>
          Range: {vocalRange?.lowHz.toFixed(0)}–
          {vocalRange?.highHz.toFixed(0)} Hz
        </Text>
      </View>

      <Pressable
        style={[
          styles.startButton,
          referencePlaying && styles.disabledButton,
        ]}
        disabled={referencePlaying}
        onPress={() => void playReference()}
      >
        {referencePlaying ? (
          <ActivityIndicator color={WHITE} />
        ) : (
          <Ionicons name="play" size={20} color={WHITE} />
        )}

        <Text style={styles.startButtonText}>
          {referencePlaying
            ? 'Playing Reference...'
            : 'Play Reference'}
        </Text>
      </Pressable>

      <Pressable
        style={[
          styles.doneButton,
          referencePlaying && styles.disabledButton,
        ]}
        disabled={referencePlaying}
        onPress={() => void startCountdown()}
      >
        <Text style={styles.doneButtonText}>
          Start Repetition {currentRepetition}
        </Text>
      </Pressable>
    </View>
  );

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="flash-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.phaseTitle}>Get Ready</Text>

      <Text style={styles.countdownText}>
        {countdown}
      </Text>

      <Text style={styles.phaseSubtitle}>
        Prepare for repetition {currentRepetition} of {repetitions}.
      </Text>
    </View>
  );

  const renderRecording = () => {
    const progress =
      targetSequenceDurationSeconds > 0
        ? Math.min(
            recordingTime / targetSequenceDurationSeconds,
            1,
          )
        : 0;

    const statusColor = getPitchStatusColor(livePitchStatus);

    return (
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="mic" size={34} color={BROWN} />
        </View>

        <Text style={styles.phaseTitle}>Sing the Scale</Text>

        <Text style={styles.phaseSubtitle}>
          Repetition {currentRepetition} of {repetitions}
        </Text>

        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingBadgeText}>
            RECORDING
          </Text>
        </View>

        <View style={styles.liveCard}>
          <Text style={styles.cardTitle}>
            Sing This Sequence
          </Text>

          <View style={styles.noteSequence}>
            {frequencies.map((frequency, index) => {
              const active =
                activeExerciseNoteIndex === index;

              return (
                <View
                  key={`${frequency}-${index}`}
                  style={[
                    styles.notePill,
                    active && styles.notePillActive,
                    active && statusColor
                      ? {
                          backgroundColor: statusColor,
                          borderColor: statusColor,
                        }
                      : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.noteNumber,
                      active && styles.activeText,
                    ]}
                  >
                    {index + 1}
                  </Text>

                  <Text
                    style={[
                      styles.noteText,
                      active && styles.activeText,
                    ]}
                  >
                    {frequencyToNoteName(frequency)}
                  </Text>
                </View>
              );
            })}
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: GUIDE_GREEN },
                ]}
              />
              <Text style={styles.legendText}>In tune</Text>
            </View>

            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: GUIDE_YELLOW },
                ]}
              />
              <Text style={styles.legendText}>Close</Text>
            </View>

            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: GUIDE_RED },
                ]}
              />
              <Text style={styles.legendText}>Off target</Text>
            </View>
          </View>

          <Text style={styles.detectedPitchText}>
            {livePitchHz !== null
              ? `Detected pitch: ${frequencyToNoteName(livePitchHz)} · ${livePitchHz.toFixed(0)} Hz`
              : 'Sing the active note to check your pitch.'}
          </Text>
        </View>

        <Text style={styles.timerText}>
          Recording Time: {recordingTime.toFixed(1)}s /{' '}
          {targetSequenceDurationSeconds.toFixed(1)}s
        </Text>

        <View style={styles.timerTrack}>
          <View
            style={[
              styles.timerFill,
              { width: `${progress * 100}%` },
            ]}
          />
        </View>
      </View>
    );
  };

  const renderProcessing = () => (
    <View style={styles.centerScreen}>
      <ActivityIndicator size="large" color={BROWN} />

      <Text style={styles.phaseTitle}>
        Analyzing Your Singing
      </Text>

      <Text style={styles.phaseSubtitle}>
        Measuring pitch accuracy, sequence accuracy, transitions,
        and speed.
      </Text>
    </View>
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
      <View style={styles.resultsContent}>
        <View style={styles.iconCircle}>
          <Ionicons
            name={result.passed ? 'checkmark' : 'refresh'}
            size={40}
            color={BROWN}
          />
        </View>

        <Text style={styles.resultTitle}>
          {result.passed ? 'Great Job!' : 'Keep Practicing!'}
        </Text>

        <Text style={styles.phaseSubtitle}>
          Rapid Scale Trill Result
        </Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>OVERALL SCORE</Text>

          <Text style={styles.scoreValue}>
            {Math.round(result.overall)}
          </Text>

          <Text style={styles.scoreDescription}>
            out of 100
          </Text>
        </View>

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

        <View style={styles.tipCard}>
          <Ionicons
            name="bulb-outline"
            size={20}
            color={BROWN}
          />

          <Text style={styles.tipText}>{result.feedback}</Text>
        </View>

        <Pressable
          style={styles.startButton}
          onPress={() => setCurrentConfirmation('tryAgain')}
        >
          <Ionicons name="refresh" size={18} color={WHITE} />

          <Text style={styles.startButtonText}>
            Try Again
          </Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={pauseForExitPrompt}
        >
          <Text style={styles.doneButtonText}>
            Back to Exercises
          </Text>
        </Pressable>
      </View>
    );
  };

  const isPreparing = tierLoading || isLoadingAdaptiveParams;

  const quitMessage =
    pausedPhaseRef.current === 'instructions' ||
    pausedPhaseRef.current === 'results'
      ? 'Are you sure you want to leave Rapid Scale Trill?'
      : pausedPhaseRef.current === 'recording'
        ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
        : pausedPhaseRef.current === 'countdown'
          ? 'Your exercise is paused. Your completed repetitions will be kept. Continue to restart the countdown for the current repetition.'
          : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.';

  return (
    <>
      {isPreparing ? (
        <View style={styles.preparingScreen}>
          <View style={styles.iconCircle}>
            <Ionicons
              name="options-outline"
              size={40}
              color={BROWN}
            />
          </View>

          <Text style={styles.phaseTitle}>
            Preparing Your Exercise
          </Text>

          <Text style={styles.phaseSubtitle}>
            Loading your difficulty level and vocal range from your
            assessment.
          </Text>

          <ActivityIndicator
            size="large"
            color={BROWN}
            style={styles.spinner}
          />
        </View>
      ) : (
        <ScrollView
          style={styles.screen}
          contentContainerStyle={
            phase === 'results'
              ? styles.resultsWrapper
              : undefined
          }
          showsVerticalScrollIndicator={false}
        >
          {phase === 'instructions' && renderInstructions()}
          {phase === 'reference' && renderReference()}
          {phase === 'countdown' && renderCountdown()}
          {phase === 'recording' && renderRecording()}
          {phase === 'processing' && renderProcessing()}
          {phase === 'results' && renderResults()}
        </ScrollView>
      )}

      {/* Quit exercise modal: matches Sustained Exhale's design. */}
      <Modal
        visible={confirmation === 'quit'}
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
              Quit exercise?
            </Text>

            <Text style={styles.modalMessage}>
              {quitMessage}
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
              onPress={quitExercise}
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

      {/* Keep Try Again as a separate confirmation. */}
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
                color={BROWN}
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
    backgroundColor: WHITE,
  },

  preparingScreen: {
    flex: 1,
    minHeight: 600,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: WHITE,
  },

  spinner: {
    marginTop: 24,
  },

  content: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 130,
    paddingBottom: 48,
    backgroundColor: WHITE,
  },

  resultsContent: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 48,
    backgroundColor: WHITE,
  },

  resultsWrapper: {
    flexGrow: 1,
    width: '100%',
  },

  centerScreen: {
    flexGrow: 1,
    minHeight: 620,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: WHITE,
  },

  backButton: {
    position: 'absolute',
    top: 48,
    left: 24,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
  },

  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PINK,
    marginBottom: 18,
  },

  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
    marginTop: 10,
  },

  phaseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 330,
  },

  referenceCard: {
    width: '100%',
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: LIGHT_PINK,
    marginTop: 20,
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginBottom: 12,
  },

  noteSequence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },

  notePill: {
    minWidth: 54,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: PINK,
    borderWidth: 1,
    borderColor: PINK,
  },

  notePillActive: {
    backgroundColor: '#E85D83',
    borderWidth: 1,
    borderColor: '#C93E68',
  },

  activeText: {
    color: WHITE,
  },

  noteNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: MUTED,
    marginBottom: 2,
  },

  noteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  referenceHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 14,
  },

  startButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: 26,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: BROWN,
    marginTop: 14,
  },

  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  doneButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: LIGHT_GRAY,
    marginTop: 10,
  },

  doneButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  disabledButton: {
    opacity: 0.5,
  },

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 76,
    color: BROWN,
    marginTop: 20,
  },

  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 13,
    marginTop: 18,
  },

  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GUIDE_RED,
    marginRight: 7,
  },

  recordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
    letterSpacing: 0.7,
  },

  liveCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },

  detectedPitchText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
  },

  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 18,
    marginBottom: 7,
    textAlign: 'center',
  },

  timerTrack: {
    width: '100%',
    height: 8,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 5,
  },

  timerFill: {
    height: '100%',
    backgroundColor: '#E85D83',
    borderRadius: 4,
  },

  legendRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 14,
  },

  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  legendText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  resultTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
  },

  scoreCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 22,
    padding: 22,
    marginTop: 20,
  },

  scoreLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
  },

  scoreValue: {
    fontFamily: 'FredokaBold',
    fontSize: 52,
    color: BROWN,
    marginVertical: 3,
  },

  scoreDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
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
    borderBottomColor: BORDER,
  },

  metricLabel: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    marginLeft: 12,
    textAlign: 'right',
  },

  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 15,
    borderRadius: 18,
    backgroundColor: PINK,
    marginTop: 14,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: BROWN,
  },

  // Quit modal styles matching SustainedExhaleScreen.
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