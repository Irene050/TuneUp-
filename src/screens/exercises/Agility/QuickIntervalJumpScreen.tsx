import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  QUICK_INTERVAL_JUMP_PARAMS,
  type Tier,
} from '@/constants/agility';
import ExerciseScreen from '@/screens/exercises/ExerciseScreen';
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
import { frequencyToNoteName } from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';
const ACTIVE_PINK = '#E85D83';

const GUIDE_GREEN = '#4F9B67';
const GUIDE_YELLOW = '#D9A72E';
const GUIDE_RED = '#D64F5A';

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const MAX_RECORDING_SECONDS = 15;
const MAX_SAMPLE_COUNT = SAMPLE_RATE * MAX_RECORDING_SECONDS;
const COUNTDOWN_SECONDS = 3;

const MIN_PITCH_HZ = 60;
const MAX_PITCH_HZ = 1000;
const MIN_RMS = 0.008;
const MIN_PITCH_CORRELATION = 0.7;
const CLOSE_NOTE_SEMITONES = 1.5;
const GOOD_NOTE_SEMITONES = 0.5;

type Phase =
  | 'instructions'
  | 'reference'
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

type AdaptiveConfig = ReturnType<typeof generateQuickIntervalJumpParams>;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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

const estimatePitch = (
  input: Float32Array,
  sampleRate: number,
): number | null => {
  if (input.length < 512 || sampleRate <= 0) {
    return null;
  }

  const downsampledLength = Math.floor(input.length / 2);

  if (downsampledLength < 256) {
    return null;
  }

  const samples = new Float32Array(downsampledLength);
  let mean = 0;

  for (let index = 0; index < downsampledLength; index++) {
    const value = input[index * 2];
    samples[index] = value;
    mean += value;
  }

  mean /= downsampledLength;

  let energy = 0;

  for (let index = 0; index < samples.length; index++) {
    samples[index] -= mean;
    energy += samples[index] * samples[index];
  }

  const rms = Math.sqrt(energy / samples.length);

  if (!Number.isFinite(rms) || rms < MIN_RMS) {
    return null;
  }

  const effectiveSampleRate = sampleRate / 2;
  const minLag = Math.max(
    2,
    Math.floor(effectiveSampleRate / MAX_PITCH_HZ),
  );
  const maxLag = Math.min(
    Math.floor(effectiveSampleRate / MIN_PITCH_HZ),
    Math.floor(samples.length / 2),
  );

  if (maxLag <= minLag) {
    return null;
  }

  let bestLag = -1;
  let bestCorrelation = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;

    const limit = samples.length - lag;

    for (let index = 0; index < limit; index++) {
      const left = samples[index];
      const right = samples[index + lag];

      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }

    const denominator = Math.sqrt(leftEnergy * rightEnergy);

    if (denominator <= 0) {
      continue;
    }

    const normalizedCorrelation = correlation / denominator;

    if (normalizedCorrelation > bestCorrelation) {
      bestCorrelation = normalizedCorrelation;
      bestLag = lag;
    }
  }

  if (
    bestLag < 0 ||
    bestCorrelation < MIN_PITCH_CORRELATION
  ) {
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
};

const getSemitoneDistance = (
  detectedFrequency: number,
  targetFrequency: number,
): number => {
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
};

export default function QuickIntervalJumpScreen() {
  const [tier, setTier] = useState<Tier>('beginner');
  const [tierLoading, setTierLoading] = useState(true);

  const [adaptiveConfig, setAdaptiveConfig] =
    useState<AdaptiveConfig>(initialAdaptiveConfig);
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  const [vocalRangeMessage, setVocalRangeMessage] = useState(
    'Loading your saved vocal range…',
  );
  const [hasUsableVocalRange, setHasUsableVocalRange] = useState(false);

  const [isPreparingResume, setIsPreparingResume] = useState(false);

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [recordingTime, setRecordingTime] = useState(0);
  const [currentRepetition, setCurrentRepetition] = useState(1);

  const [isPlayingReference, setIsPlayingReference] = useState(false);
  const [activeReferenceNoteIndex, setActiveReferenceNoteIndex] =
    useState<number | null>(null);

  const [livePitchHz, setLivePitchHz] = useState<number | null>(null);
  const [liveDetectedNote, setLiveDetectedNote] = useState<string | null>(
    null,
  );
  const [liveStatus, setLiveStatus] = useState(
    'Sing a clear, sustained note.',
  );

  const [result, setResult] = useState<ExerciseResult | null>(null);

  const [confirmation, setConfirmation] = useState<'tryAgain' | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const samplesRef = useRef<number[]>([]);
  const recordingStartRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const countdownTokenRef = useRef(0);
  const playbackTokenRef = useRef(0);
  const referencePlayingRef = useRef(false);
  const repetitionSampleStartRef = useRef(0);

  const showQuitModalRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');
  const pausedRepetitionRef = useRef(1);

  const { repetitions, accuracyTarget } = getQuickIntervalJumpSettings(tier);

  const noteDurationSec = adaptiveConfig.noteDurationSec;
  const gapSec = adaptiveConfig.gapSec;
  const notesPerRepetition = adaptiveConfig.frequencies.length;

  const repetitionDurationSec =
    notesPerRepetition * noteDurationSec +
    Math.max(0, notesPerRepetition - 1) * gapSec;

  const updateQuitModalVisibility = useCallback((visible: boolean) => {
    showQuitModalRef.current = visible;

    if (mountedRef.current) {
      setShowQuitModal(visible);
    }
  }, []);

  const resetLivePitch = useCallback(() => {
    setLivePitchHz(null);
    setLiveDetectedNote(null);
    setLiveStatus('Sing a clear, sustained note.');
  }, []);

  const updateLivePitch = useCallback(
    (audioSamples: Float32Array) => {
      const pitchHz = estimatePitch(audioSamples, SAMPLE_RATE);

      if (pitchHz === null) {
        setLivePitchHz(null);
        setLiveDetectedNote(null);
        setLiveStatus('Listening for a clear note…');
        return;
      }

      const detectedNote = frequencyToNoteName(pitchHz);

      let closestIndex = -1;
      let closestDistance = Infinity;

      adaptiveConfig.frequencies.forEach((targetFrequency, index) => {
        const distance = getSemitoneDistance(
          pitchHz,
          targetFrequency,
        );

        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      setLivePitchHz(pitchHz);
      setLiveDetectedNote(detectedNote);

      if (closestDistance <= GOOD_NOTE_SEMITONES) {
        setLiveStatus('Great! You are matching a target note.');
      } else if (closestDistance <= CLOSE_NOTE_SEMITONES) {
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
        setTierLoading(false);
        return;
      }

      try {
        const progress = await fetchComponentProgress(user.uid, 'agility');

        if (cancelled) return;

        const savedTier = progress?.currentTier;

        const validTier: Tier =
          savedTier === 'beginner' ||
          savedTier === 'intermediate' ||
          savedTier === 'advanced'
            ? savedTier
            : 'beginner';

        setTier(validTier);
      } catch (error) {
        console.warn('Failed to load agility component tier:', error);

        if (!cancelled) {
          setTier('beginner');
        }
      } finally {
        if (!cancelled) {
          setTierLoading(false);
        }
      }
    };

    void loadComponentTier();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tierLoading) return;

    let cancelled = false;

    const loadAdaptiveParameters = async () => {
      setIsLoadingAdaptiveParams(true);
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

        setIsLoadingAdaptiveParams(false);
        return;
      }

      let recentScores: number[] = [];

      try {
        const records = await fetchExerciseRecords(user.uid, 'agility');

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
      } catch (error) {
        console.warn(
          'Could not load Quick Interval Jump score history:',
          error,
        );
      }

      let vocalRange: { lowHz: number; highHz: number } | null = null;

      try {
        const assessment = await getLatestAssessment();

        if (cancelled) return;

        const lowHz =
          assessment?.vocalRange?.lowHz ?? assessment?.vocalRangeLowHz;

        const highHz =
          assessment?.vocalRange?.highHz ?? assessment?.vocalRangeHighHz;

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
      } catch (error) {
        console.warn(
          'Could not load the latest assessment vocal range:',
          error,
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

      setIsLoadingAdaptiveParams(false);
    };

    void loadAdaptiveParameters().catch((error) => {
      console.warn(
        'Failed to generate Quick Interval Jump parameters:',
        error,
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
        setIsLoadingAdaptiveParams(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [tier, tierLoading, accuracyTarget]);

  const requestMicrophonePermission = useCallback(
    async (): Promise<boolean> => {
      try {
        const permission = await AudioManager.requestRecordingPermissions();

        return permission === 'Granted';
      } catch (error) {
        console.warn('Microphone permission request failed:', error);
        return false;
      }
    },
    [],
  );

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingStartRef.current = null;

    const recorder = recorderRef.current;

    if (!recorder) return;

    recorderRef.current = null;

    try {
      recorder.clearOnAudioReady();
    } catch {}

    try {
      void recorder.stop();
    } catch {}
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      countdownTokenRef.current += 1;
      playbackTokenRef.current += 1;
      referencePlayingRef.current = false;
      quitInProgressRef.current = true;

      stopRecording();

      const context = audioContextRef.current;
      audioContextRef.current = null;

      if (context) {
        try {
          void context.close();
        } catch {}
      }
    };
  }, [stopRecording]);

  const playReference = async () => {
    if (
      referencePlayingRef.current ||
      phase !== 'reference' ||
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      isLoadingAdaptiveParams ||
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
        new AudioContext({ sampleRate: SAMPLE_RATE });

      audioContextRef.current = context;

      await context.resume();

      if (
        !mountedRef.current ||
        playbackToken !== playbackTokenRef.current
      ) {
        return;
      }

      for (const [index, frequency] of adaptiveConfig.frequencies.entries()) {
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
    } catch (error) {
      console.warn('Reference playback failed:', error);
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

  const beginExercise = async () => {
    if (
      tierLoading ||
      isLoadingAdaptiveParams ||
      !hasUsableVocalRange ||
      notesPerRepetition < 2 ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const permission = await requestMicrophonePermission();

    if (!mountedRef.current) return;

    if (!permission) {
      setVocalRangeMessage(
        'Microphone permission is required to record this exercise. Please allow microphone access in your device settings.',
      );
      return;
    }

    setResult(null);
    setCurrentRepetition(1);
    samplesRef.current = [];
    repetitionSampleStartRef.current = 0;
    resetLivePitch();
    setPhase('reference');
  };

  const processRecording = async () => {
    if (
      processingRef.current ||
      !mountedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    processingRef.current = true;

    countdownTokenRef.current += 1;
    stopRecording();
    setPhase('processing');

    await sleep(250);

    if (!mountedRef.current) {
      processingRef.current = false;
      return;
    }

    try {
      const samples = new Float32Array(samplesRef.current);

      const targetFrequencies = Array.from(
        { length: repetitions },
        () => adaptiveConfig.frequencies,
      ).flat();

      const measurement = measureQuickIntervalJump(
        samples,
        SAMPLE_RATE,
        targetFrequencies,
      );

      const scored = scoreQuickIntervalJump(measurement);
      const finalScore = Math.round(scored.overall);
      const accuracyScore = (scored.pitchScore + scored.intervalScore) / 2;
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

        console.log('Quick Interval Jump progress save call completed:', {
          componentId: 'agility',
          templateId: 'quickIntervalJump',
          tier,
          scorePct: finalScore,
        });
      } catch (error) {
        console.error('Failed to save Quick Interval Jump progress:', error);
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
        correctTransitionCount: measurement.correctTransitionCount,
        averageTransitionTimeMs: measurement.averageTransitionTimeMs,
        durationMs: measurement.durationMs,
      });

      setPhase('results');
    } catch (error) {
      console.warn('Quick Interval Jump processing failed:', error);

      if (mountedRef.current) {
        setPhase('instructions');
      }
    } finally {
      processingRef.current = false;
    }
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
      repetitionSampleStartRef.current = samplesRef.current.length;

      resetLivePitch();

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
            processingRef.current ||
            showQuitModalRef.current ||
            quitInProgressRef.current
          ) {
            return;
          }

          try {
            const channelData = buffer.getChannelData(0);
            const frameCount = Math.min(numFrames, channelData.length);

            if (frameCount > 0) {
              const currentFrame = channelData.slice(0, frameCount);
              updateLivePitch(currentFrame);
            }

            const remaining = MAX_SAMPLE_COUNT - samplesRef.current.length;

            const samplesToCopy = Math.min(
              frameCount,
              Math.max(0, remaining),
            );

            for (let index = 0; index < samplesToCopy; index++) {
              samplesRef.current.push(channelData[index]);
            }
          } catch (error) {
            console.warn('Could not read microphone audio buffer:', error);
          }
        },
      );

      if (callbackResult.status === 'error') {
        console.warn(
          'Could not initialize microphone recording:',
          callbackResult.message,
        );

        stopRecording();

        if (mountedRef.current) {
          setPhase('reference');
        }

        return;
      }

      if (
        !mountedRef.current ||
        countdownToken !== countdownTokenRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        stopRecording();
        return;
      }

      const startResult = await recorder.start();

      if (startResult.status === 'error') {
        console.warn('Could not start recorder:', startResult.message);

        stopRecording();

        if (mountedRef.current) {
          setPhase('reference');
        }

        return;
      }

      if (
        !mountedRef.current ||
        countdownToken !== countdownTokenRef.current ||
        recorderRef.current !== recorder ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        stopRecording();
        return;
      }

      recordingStartRef.current = Date.now();
      setRecordingTime(0);
      setPhase('recording');

      recordingTimerRef.current = setInterval(() => {
        const start = recordingStartRef.current;

        if (
          start === null ||
          !mountedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current
        ) {
          return;
        }

        const elapsed = (Date.now() - start) / 1000;

        setRecordingTime(Math.min(elapsed, repetitionDurationSec));

        if (elapsed >= repetitionDurationSec) {
          stopRecording();

          if (currentRepetition < repetitions) {
            setCurrentRepetition((previous) => previous + 1);
            setRecordingTime(0);
            resetLivePitch();
            setPhase('reference');
          } else {
            void processRecording();
          }
        }
      }, 100);
    } catch (error) {
      console.warn('Recording failed:', error);

      stopRecording();

      if (mountedRef.current) {
        setPhase('reference');
      }
    }
  };

  const startCountdown = async () => {
    if (
      phase !== 'reference' ||
      referencePlayingRef.current ||
      isPlayingReference ||
      isLoadingAdaptiveParams ||
      !hasUsableVocalRange ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const countdownToken = ++countdownTokenRef.current;

    playbackTokenRef.current += 1;

    setCountdown(COUNTDOWN_SECONDS);
    setRecordingTime(0);
    setResult(null);
    resetLivePitch();

    if (currentRepetition === 1) {
      samplesRef.current = [];
    }

    repetitionSampleStartRef.current = samplesRef.current.length;
    processingRef.current = false;

    setPhase('countdown');

    for (let value = COUNTDOWN_SECONDS; value >= 1; value--) {
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

    stopRecording();

    samplesRef.current = [];
    setResult(null);
    setRecordingTime(0);
    setCurrentRepetition(1);
    resetLivePitch();

    repetitionSampleStartRef.current = 0;
    pausedRepetitionRef.current = 1;

    setCountdown(COUNTDOWN_SECONDS);
    setPhase('instructions');
  };

  const pauseForExitPrompt = useCallback(() => {
    if (
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phase === 'processing' ||
      confirmation !== null
    ) {
      return;
    }

    pausedPhaseRef.current = phase;
    pausedRepetitionRef.current = currentRepetition;

    updateQuitModalVisibility(true);

    countdownTokenRef.current += 1;
    playbackTokenRef.current += 1;

    referencePlayingRef.current = false;

    setIsPlayingReference(false);
    setActiveReferenceNoteIndex(null);

    if (phase === 'recording') {
      samplesRef.current = samplesRef.current.slice(
        0,
        repetitionSampleStartRef.current,
      );

      stopRecording();
      setRecordingTime(0);
      resetLivePitch();
      setPhase('reference');
    } else if (phase === 'countdown') {
      setRecordingTime(0);
      setCountdown(COUNTDOWN_SECONDS);
      setPhase('reference');
    } else if (phase === 'reference') {
      setPhase('reference');
    }
  }, [
    confirmation,
    currentRepetition,
    phase,
    resetLivePitch,
    stopRecording,
    updateQuitModalVisibility,
  ]);

  const continueExercise = useCallback(() => {
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
      setCurrentRepetition(pausedRepetitionRef.current);
      setRecordingTime(0);
      setCountdown(COUNTDOWN_SECONDS);
      resetLivePitch();
      processingRef.current = false;

      setPhase('reference');
      setIsPreparingResume(true);

      setTimeout(() => {
        if (mountedRef.current) {
          setIsPreparingResume(false);
        }
      }, 500);

      return;
    }

    setPhase(previouslyPausedPhase);
  }, [resetLivePitch, updateQuitModalVisibility]);

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

    stopRecording();

    const context = audioContextRef.current;
    audioContextRef.current = null;

    if (context) {
      try {
        await context.close();
      } catch (error) {
        console.warn('Could not close audio context while quitting:', error);
      }
    }

    router.replace('/exercises/agility' as any);
  }, [stopRecording, updateQuitModalVisibility]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current || quitInProgressRef.current) {
          return true;
        }

        if (confirmation !== null) {
          setConfirmation(null);
          return true;
        }

        if (phase === 'processing') {
          return true;
        }

        pauseForExitPrompt();
        return true;
      },
    );

    return () => subscription.remove();
  }, [confirmation, phase, pauseForExitPrompt]);

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
        tierLoading ||
        isLoadingAdaptiveParams ||
        !hasUsableVocalRange ||
        notesPerRepetition < 2
      }
      startLabel={
        tierLoading || isLoadingAdaptiveParams
          ? 'Preparing Exercise...'
          : !hasUsableVocalRange
            ? 'Vocal Assessment Required'
            : 'Start Exercise'
      }
      onBack={pauseForExitPrompt}
      onStart={() => void beginExercise()}
    />
  );

  const renderReference = () => (
    <View style={styles.content}>

      <View style={styles.iconCircle}>
        <Ionicons name="swap-horizontal-outline" size={34} color={BROWN} />
      </View>

      <Text style={styles.phaseTitle}>Listen to the Reference</Text>

      <Text style={styles.phaseSubtitle}>
        Repetition {currentRepetition} of {repetitions}
      </Text>

      <Text style={styles.phaseSubtitle}>
        Listen to the note sequence, then sing the same notes.
      </Text>

      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>
          YOUR VOCAL-RANGE SEQUENCE
        </Text>

        <View style={styles.noteSequence}>
          {adaptiveConfig.frequencies.map((frequency, index) => {
            const active = activeReferenceNoteIndex === index;

            return (
              <View
                key={`${frequency}-${index}`}
                style={[
                  styles.notePill,
                  active && styles.referenceNotePlaying,
                ]}
              >
                <Text
                  style={[
                    styles.noteNumber,
                    active && styles.referenceNotePlayingText,
                  ]}
                >
                  {index + 1}
                </Text>

                <Text
                  style={[
                    styles.noteText,
                    active && styles.referenceNotePlayingText,
                  ]}
                >
                  {frequencyToNoteName(frequency)}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <Pressable
        style={[
          styles.referenceButton,
          isPlayingReference && styles.disabledButton,
        ]}
        disabled={isPlayingReference || !hasUsableVocalRange}
        onPress={() => void playReference()}
      >
        {isPlayingReference ? (
          <ActivityIndicator size="small" color={BROWN} />
        ) : (
          <Ionicons name="play" size={18} color={BROWN} />
        )}

        <Text style={styles.referenceButtonText}>
          {isPlayingReference ? 'Playing Reference...' : 'Play Reference'}
        </Text>
      </Pressable>

      <Pressable
        style={[
          styles.startButton,
          isPlayingReference && styles.disabledButton,
        ]}
        disabled={isPlayingReference || !hasUsableVocalRange}
        onPress={() => void startCountdown()}
      >
        <Text style={styles.startButtonText}>I'm Ready</Text>
      </Pressable>
    </View>
  );

  const renderCountdown = () => (
    <View style={styles.centerScreen}>

      <View style={styles.iconCircle}>
        <Ionicons name="flash-outline" size={34} color={BROWN} />
      </View>

      <Text style={styles.phaseTitle}>Get Ready</Text>

      <Text style={styles.countdownText}>{countdown}</Text>

      <Text style={styles.phaseSubtitle}>
        Prepare for repetition {currentRepetition} of {repetitions}.
      </Text>
    </View>
  );

  const renderRecording = () => {
    const progress = Math.min(recordingTime / repetitionDurationSec, 1);

    const noteSlotDurationSec = noteDurationSec + gapSec;
    const noteIndexByTime = Math.floor(
      recordingTime / noteSlotDurationSec,
    );

    const timeWithinNoteSlot =
      recordingTime - noteIndexByTime * noteSlotDurationSec;

    const activeRecordingNoteIndex =
      noteIndexByTime < notesPerRepetition &&
      timeWithinNoteSlot < noteDurationSec
        ? noteIndexByTime
        : null;

    const activeTargetFrequency =
      activeRecordingNoteIndex !== null
        ? adaptiveConfig.frequencies[activeRecordingNoteIndex]
        : null;

    const activeTargetDistance =
      livePitchHz !== null && activeTargetFrequency !== null
        ? getSemitoneDistance(livePitchHz, activeTargetFrequency)
        : Infinity;

    const liveStatusColor =
      livePitchHz === null || activeTargetFrequency === null
        ? MUTED
        : activeTargetDistance <= GOOD_NOTE_SEMITONES
          ? GUIDE_GREEN
          : activeTargetDistance <= CLOSE_NOTE_SEMITONES
            ? GUIDE_YELLOW
            : GUIDE_RED;

    return (
      <View style={styles.content}>

        <View style={styles.recordingIcon}>
          <Ionicons name="mic" size={34} color={BROWN} />
        </View>

        <Text style={styles.recordingTitle}>Jump Between Notes</Text>

        <Text style={styles.recordingSubtitle}>
          Repetition {currentRepetition} of {repetitions}
        </Text>

        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingBadgeText}>RECORDING</Text>
        </View>

        <View style={styles.referenceCard}>
          <Text style={styles.cardTitle}>Sing This Sequence</Text>

          <View style={styles.noteSequence}>
            {adaptiveConfig.frequencies.map((frequency, index) => {
              const isActive = activeRecordingNoteIndex === index;
              const distance =
                livePitchHz !== null
                  ? getSemitoneDistance(livePitchHz, frequency)
                  : Infinity;

              let noteColor: string | undefined;

              if (isActive && livePitchHz !== null) {
                if (distance <= GOOD_NOTE_SEMITONES) {
                  noteColor = GUIDE_GREEN;
                } else if (distance <= CLOSE_NOTE_SEMITONES) {
                  noteColor = GUIDE_YELLOW;
                } else {
                  noteColor = GUIDE_RED;
                }
              }

              return (
                <View
                  key={`${frequency}-${index}`}
                  style={[
                    styles.notePill,
                    isActive && styles.referenceNotePlaying,
                    noteColor
                      ? {
                          backgroundColor: noteColor,
                          borderWidth: 1,
                          borderColor: noteColor,
                        }
                      : undefined,
                  ]}
                >
                  <Text
                    style={[
                      styles.noteNumber,
                      (isActive || noteColor) &&
                        styles.referenceNotePlayingText,
                    ]}
                  >
                    {index + 1}
                  </Text>

                  <Text
                    style={[
                      styles.noteText,
                      (isActive || noteColor) &&
                        styles.referenceNotePlayingText,
                    ]}
                  >
                    {frequencyToNoteName(frequency)}
                  </Text>

                  <View
                    style={[
                      styles.noteIndicator,
                      {
                        backgroundColor:
                          noteColor ??
                          (isActive ? ACTIVE_PINK : BORDER),
                      },
                    ]}
                  />
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
            <Text style={styles.legendText}>Correct</Text>
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
            <Text style={styles.legendText}>Mismatch</Text>
          </View>
        </View>
        </View>

        <View
          style={[
            styles.liveCard,
            {
              borderColor: BORDER,
            },
          ]}
        >
          <Text style={styles.liveLabel}>LIVE PITCH DETECTION</Text>

          <Text style={styles.liveCurrentNote}>
            {liveDetectedNote ?? 'Listening…'}
          </Text>

          <Text style={styles.liveStatValue}>
            {livePitchHz !== null
              ? `${livePitchHz.toFixed(1)} Hz`
              : 'Waiting for a clear pitch'}
          </Text>

          <View style={styles.liveDivider} />

          <View style={styles.liveStatusRow}>
            <View
              style={[
                styles.liveStatusDot,
                { backgroundColor: liveStatusColor },
              ]}
            />

            <Text
              style={[
                styles.liveStatLabel,
                { color: liveStatusColor },
              ]}
            >
              {liveStatus}
            </Text>
          </View>
        </View>

        <Text style={styles.timerText}>
          Repetition time: {recordingTime.toFixed(1)}s /{' '}
          {repetitionDurationSec.toFixed(1)}s
        </Text>

        <View style={styles.timerTrack}>
          <View
            style={[
              styles.timerFill,
              {
                width: `${progress * 100}%`,
              },
            ]}
          />
        </View>
      </View>
    );
  };

  const renderProcessing = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <ActivityIndicator size="large" color={BROWN} />
      </View>

      <Text style={styles.phaseTitle}>Analyzing Your Singing</Text>

      <Text style={styles.phaseSubtitle}>
        Measuring pitch accuracy, interval accuracy, and transition speed.
      </Text>
    </View>
  );

  const renderScoreRow = (
    label: string,
    score: number,
    isLast = false,
  ) => (
    <View style={isLast ? styles.scoreRowLast : styles.scoreRow}>
      <View style={styles.scoreRowHeader}>
        <Text style={styles.scoreRowLabel}>{label}</Text>
        <Text style={styles.scoreRowValue}>{Math.round(score)}%</Text>
      </View>

      <View style={styles.progressBackground}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.min(100, Math.max(0, score))}%`,
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
    <View style={[styles.metricRow, isLast && styles.metricRowLast]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );

  const renderResults = () => {
    if (!result) return null;

    return (
      <View style={styles.resultsContent}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to exercises"
          hitSlop={10}
          style={styles.quitButtonTop}
          onPress={pauseForExitPrompt}
        >
          <Ionicons name="close" size={22} color={BROWN} />
        </Pressable>

        <View
          style={[
            styles.resultIcon,
            result.passed
              ? styles.resultIconPassed
              : styles.resultIconFailed,
          ]}
        >
          <Ionicons
            name={result.passed ? 'checkmark' : 'refresh'}
            size={40}
            color={BROWN}
          />
        </View>

        <Text style={styles.resultTitle}>
          {result.passed ? 'Great Job!' : 'Keep Practicing!'}
        </Text>

        <Text style={styles.resultSubtitle}>
          Quick Interval Jump Result
        </Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>OVERALL SCORE</Text>
          <Text style={styles.scoreValue}>
            {Math.round(result.overall)}
          </Text>
          <Text style={styles.scoreDescription}>out of 100</Text>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Performance Breakdown
          </Text>

          {renderScoreRow('Pitch Accuracy', result.pitchScore)}
          {renderScoreRow('Interval Accuracy', result.intervalScore)}
          {renderScoreRow('Transition Speed', result.speedScore, true)}
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
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
            `${result.averageTransitionTimeMs > 0 ? result.averageTransitionTimeMs.toFixed(0) : '0'} ms`,
          )}

          {renderMetricRow(
            'Duration',
            `${(result.durationMs / 1000).toFixed(1)}s`,
            true,
          )}
        </View>

        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={20} color={BROWN} />
          <Text style={styles.tipText}>{result.feedback}</Text>
        </View>

        <Pressable
          style={styles.startButton}
          onPress={() => setConfirmation('tryAgain')}
          accessibilityRole="button"
          accessibilityLabel="Try the exercise again"
        >
          <Ionicons name="refresh" size={18} color={WHITE} />
          <Text style={styles.startButtonText}>Try Again</Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={pauseForExitPrompt}
          accessibilityRole="button"
          accessibilityLabel="Back to exercises"
        >
          <Ionicons name="arrow-back" size={15} color={BROWN} />
          <Text style={styles.doneButtonText}>Back to Exercises</Text>
        </Pressable>
      </View>
    );
  };

  if (
    tierLoading ||
    isLoadingAdaptiveParams ||
    isPreparingResume
  ) {
    return (
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons
            name="musical-notes-outline"
            size={44}
            color={BROWN}
          />
        </View>

        <Text style={styles.preparingTitle}>
          {isPreparingResume
            ? 'Preparing Your Repetition'
            : 'Preparing Your Exercise'}
        </Text>

        <Text style={styles.preparingSubtitle}>
          {isPreparingResume
            ? 'Getting your reference notes ready. Your completed repetitions are preserved.'
            : 'Loading your saved vocal range and preparing notes for your difficulty level.'}
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={
          phase === 'results' ? styles.resultsWrapper : undefined
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
              <Ionicons
                name="exit-outline"
                size={30}
                color={BROWN}
              />
            </View>

            <Text style={styles.modalTitle}>Quit exercise?</Text>

            <Text style={styles.modalMessage}>
              {pausedPhaseRef.current === 'instructions' ||
              pausedPhaseRef.current === 'results'
                ? 'Are you sure you want to leave Quick Interval Jump?'
                : pausedPhaseRef.current === 'recording'
                  ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                  : pausedPhaseRef.current === 'countdown'
                    ? 'Your exercise is paused. Your completed repetitions will be kept. Continue to restart the countdown for your current repetition.'
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
              onPress={() => {
                void quitExercise();
              }}
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

      <Modal
        visible={confirmation === 'tryAgain'}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeTryAgainConfirmation}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <Ionicons
                name="refresh"
                size={30}
                color={BROWN}
              />
            </View>

            <Text style={styles.modalTitle}>Try again?</Text>

            <Text style={styles.modalMessage}>
              Are you sure you want to repeat this exercise? Your current
              result will be cleared.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel try again"
              onPress={closeTryAgainConfirmation}
              style={({ pressed }) => [
                styles.continueButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.continueButtonText}>Cancel</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm try again"
              onPress={handleTryAgainConfirmation}
              style={({ pressed }) => [
                styles.quitButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.quitButtonText}>Try Again</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },
  quitButtonTop: {
    alignSelf: 'flex-end',
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 120,
    paddingBottom: 60,
    alignItems: 'center',
  },
  resultsContent: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 52,
    paddingBottom: 50,
    alignItems: 'center',
  },
  resultsWrapper: {
    flexGrow: 1,
    width: '100%',
  },
  centerScreen: {
    flexGrow: 1,
    minHeight: 650,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
    marginTop: 20,
  },
  phaseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },
  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginTop: 10,
    marginBottom: 14,
    textAlign: 'center',
  },
  referenceCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 22,
  },
  referenceLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
    textAlign: 'center',
  },
  referenceHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 16,
  },
  noteSequence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
    marginTop: 16,
  },
  notePill: {
    minWidth: 60,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
  },
  referenceNotePlaying: {
    backgroundColor: ACTIVE_PINK,
    borderWidth: 1,
    borderColor: '#C93E68',
  },
  referenceNotePlayingText: {
    color: WHITE,
  },
  noteNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: MUTED,
    marginBottom: 2,
  },
  noteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },
  noteIndicator: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 6,
  },
  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 15,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },
  referenceButton: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 22,
  },
  referenceButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
  },
  startButton: {
    width: '100%',
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  disabledButton: {
    opacity: 0.55,
  },
  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },
  doneButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    gap: 8,
  },
  doneButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
  },
  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 26,
    color: BROWN,
    textAlign: 'center',
  },
  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
    maxWidth: 310,
  },
  recordingBadge: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: BORDER,
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
    letterSpacing: 0.6,
    color: BROWN,
  },
  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    marginTop: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: MUTED,
  },
  liveCurrentNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    marginTop: 4,
    textAlign: 'center',
  },
  liveStatValue: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    marginTop: 4,
    textAlign: 'center',
  },
  liveDivider: {
    height: 1,
    alignSelf: 'stretch',
    backgroundColor: BORDER,
    marginVertical: 14,
  },
  liveStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  liveStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  liveStatLabel: {
    flexShrink: 1,
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 7,
  },
  timerTrack: {
    width: '100%',
    height: 7,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 4,
    overflow: 'hidden',
  },
  timerFill: {
    height: '100%',
    backgroundColor: ACTIVE_PINK,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 16,
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
  resultIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  resultIconPassed: {
    backgroundColor: PINK,
  },
  resultIconFailed: {
    backgroundColor: LIGHT_GRAY,
  },
  resultTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
  },
  resultSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 3,
    marginBottom: 22,
  },
  scoreCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
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
    lineHeight: 16,
    color: MUTED,
    textAlign: 'center',
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
    marginBottom: 14,
  },
  scoreRow: {
    marginBottom: 14,
  },
  scoreRowLast: {
    marginBottom: 0,
  },
  scoreRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  scoreRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  scoreRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },
  progressBackground: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: PINK,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  metricRowLast: {
    borderBottomWidth: 0,
  },
  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    flex: 1,
  },
  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'right',
    marginLeft: 12,
  },
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
    opacity: 0.70,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});