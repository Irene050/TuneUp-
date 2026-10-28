import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { AudioManager, AudioRecorder } from 'react-native-audio-api';

import {
  ARPEGGIO_SPEED_DRILL_PARAMS,
  type Tier,
} from '@/constants/agility';
import ExerciseScreen from '@/screens/exercises/ExerciseScreen';
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
import { playNoteSequence } from '@/utils/music/notePlayer';
import { frequencyToNoteName } from '@/utils/music/notes';

import { COLORS } from '@/constants/appConstants';

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const MAX_RECORDING_SECONDS = 10;
const COUNTDOWN_SECONDS = 3;
const LIVE_BUFFER_SIZE = 4096;
const LIVE_ANALYSIS_SIZE = 2048;

type Phase =
  | 'instructions'
  | 'reference'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

type ArpeggioExerciseConfig = {
  name: string;
  notes: string[];
  frequencies: number[];
  speedLabel: string;
  noteDurationSec: number;
  gapSec: number;
  pitchTolerancePercent: number;
};

type Result = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
  noteCount: number;
  correctNoteCount: number;
  notesPerSecond: number;
  averageNoteDurationMs: number;
  durationMs: number;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const average = (values: number[]): number =>
  values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

const pitchDistanceInSemitones = (
  actualHz: number,
  targetHz: number,
): number => Math.abs(12 * Math.log2(actualHz / targetHz));

const findClosestTarget = (
  detectedHz: number,
  frequencies: number[],
): { index: number; distance: number } => {
  let index = -1;
  let distance = Infinity;

  frequencies.forEach((frequency, currentIndex) => {
    const currentDistance = pitchDistanceInSemitones(
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
  attempts: Result[],
  repetitionCount: number,
): Result => {
  const passed =
    attempts.length === repetitionCount &&
    attempts.every((attempt) => attempt.passed);

  return {
    overall: Math.round(average(attempts.map((item) => item.overall))),
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
    feedback: passed
      ? `You completed all ${repetitionCount} repetitions successfully. Keep building speed while maintaining accuracy.`
      : `You completed all ${repetitionCount} repetitions. Review your pitch and sequence accuracy, then try again for more consistent arpeggios.`,
    noteCount: attempts.reduce((sum, item) => sum + item.noteCount, 0),
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

const estimateLiveFrequency = (
  samples: number[],
  sampleRate: number,
): number | null => {
  if (samples.length < LIVE_ANALYSIS_SIZE) return null;

  const data = samples.slice(-LIVE_ANALYSIS_SIZE);
  let mean = 0;

  for (let i = 0; i < data.length; i++) {
    mean += data[i];
  }

  mean /= data.length;

  const centered = new Array<number>(data.length);
  let energy = 0;
  let minValue = Infinity;
  let maxValue = -Infinity;

  for (let i = 0; i < data.length; i++) {
    const value = data[i] - mean;

    centered[i] = value;
    energy += value * value;
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
  }

  const rms = Math.sqrt(energy / data.length);
  const peakToPeak = maxValue - minValue;

  if (rms < 0.008 || peakToPeak < 0.025) return null;

  const minLag = Math.max(1, Math.floor(sampleRate / 1000));
  const maxLag = Math.min(
    Math.floor(sampleRate / 70),
    centered.length - 2,
  );

  let bestLag = -1;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0;
    let energyA = 0;
    let energyB = 0;

    for (let i = 0; i < centered.length - lag; i += 2) {
      const a = centered[i];
      const b = centered[i + lag];

      cross += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const denominator = Math.sqrt(energyA * energyB);
    if (denominator <= 0) continue;

    const correlation = cross / denominator;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag < 1 || bestCorrelation < 0.65) return null;

  const frequency = sampleRate / bestLag;

  return frequency >= 70 && frequency <= 1000 ? frequency : null;
};

const midiToFrequency = (midi: number): number =>
  440 * 2 ** ((midi - 69) / 12);

const generateArpeggioFromVocalRange = (
  lowHz: number,
  highHz: number,
): { name: string; notes: string[]; frequencies: number[] } | null => {
  if (
    !Number.isFinite(lowHz) ||
    !Number.isFinite(highHz) ||
    lowHz <= 0 ||
    highHz <= lowHz
  ) {
    return null;
  }

  const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
  const lowestMidi = Math.ceil(hzToMidi(lowHz));
  const highestMidi = Math.floor(hzToMidi(highHz));
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
  const rootMidi = Math.max(lowestMidi, Math.min(preferredRoot, maxRoot));
  const frequencies = intervals.map((interval) =>
    midiToFrequency(rootMidi + interval),
  );
  const notes = frequencies.map((frequency) => frequencyToNoteName(frequency));

  return {
    name: 'Personalized Arpeggio',
    notes,
    frequencies,
  };
};

export default function ArpeggioSpeedDrillScreen() {
  const currentUserId = auth.currentUser?.uid ?? null;

  const [tier, setTier] = useState<Tier | null>(null);
  const [tierLoading, setTierLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadCurrentTier = async () => {
      setTierLoading(true);

      if (!currentUserId) {
        if (!cancelled) {
          setTier('beginner');
          setTierLoading(false);
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
          setTierLoading(false);
        }
      } catch (error) {
        console.error('Failed to load current Agility tier:', error);

        if (!cancelled) {
          setTier('beginner');
          setTierLoading(false);
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

  const [config, setConfig] = useState<ArpeggioExerciseConfig>({
    ...baseConfig,
    name: 'Personalized Arpeggio',
    notes: [],
    frequencies: [],
  });
  const [paramsReady, setParamsReady] = useState(false);
  const [vocalRangeAvailable, setVocalRangeAvailable] = useState(false);
  const [vocalRangeMessage, setVocalRangeMessage] = useState(
    'Checking your saved vocal assessment.',
  );
  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [recordingTime, setRecordingTime] = useState(0);
  const [livePitchHz, setLivePitchHz] = useState<number | null>(null);
  const [referenceNoteIndex, setReferenceNoteIndex] = useState<number | null>(
    null,
  );
  const [isPlayingReference, setIsPlayingReference] = useState(false);
  const timedReferenceNoteIndex =
    phase === 'recording'
      ? (() => {
          const noteDurationMs = config.noteDurationSec * 1000;
          const gapMs = config.gapSec * 1000;
          const cycleMs = noteDurationMs + gapMs;
          if (cycleMs <= 0 || !config.frequencies.length) return null;
          const positionInSequence = recordingTime * 1000 % (cycleMs * config.frequencies.length);
          const index = Math.floor(positionInSequence / cycleMs);
          return positionInSequence - index * cycleMs < noteDurationMs
            ? index
            : null;
        })()
      : null;
  const [currentRepetition, setCurrentRepetition] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [showExitConfirmation, setShowExitConfirmation] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const attemptResultsRef = useRef<Result[]>([]);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const samplesRef = useRef<number[]>([]);
  const liveSamplesRef = useRef<number[]>([]);
  const recordingStartRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const processingRef = useRef(false);
  const phaseRef = useRef<Phase>('instructions');
  const pausedPhaseRef = useRef<Phase>('instructions');
  const quitInProgressRef = useRef(false);
  const countdownRunIdRef = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (recorderRef.current) {
      try {
        recorderRef.current.clearOnAudioReady();
      } catch {}

      try {
        void recorderRef.current.stop();
      } catch {}

      recorderRef.current = null;
    }

    recordingStartRef.current = null;
  }, []);

  const pauseForExitPrompt = useCallback(() => {
    const activePhase = phaseRef.current;

    if (activePhase === 'processing' || quitInProgressRef.current) return;

    pausedPhaseRef.current = activePhase;
    setShowExitConfirmation(true);

    countdownRunIdRef.current += 1;

    if (activePhase === 'recording' || activePhase === 'countdown') {
      stopRecording();
      samplesRef.current = [];
      liveSamplesRef.current = [];
      setLivePitchHz(null);
      setRecordingTime(0);
      setCountdown(COUNTDOWN_SECONDS);
      setReferenceNoteIndex(null);
    }
  }, [stopRecording]);

  const continueExercise = () => {
    if (quitInProgressRef.current) return;

    const pausedPhase = pausedPhaseRef.current;
    setShowExitConfirmation(false);

    if (pausedPhase === 'recording' || pausedPhase === 'countdown') {
      samplesRef.current = [];
      liveSamplesRef.current = [];
      setLivePitchHz(null);
      setRecordingTime(0);
      setCountdown(COUNTDOWN_SECONDS);
      setReferenceNoteIndex(null);
      processingRef.current = false;
      void startCountdown();
      return;
    }

    setPhase(pausedPhase);
  };

  const quitExercise = async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    setIsQuitting(true);
    setShowExitConfirmation(false);
    countdownRunIdRef.current += 1;
    stopRecording();

    try {
      await Promise.resolve();
      router.replace('/exercises/agility');
    } catch (error) {
      console.error('Failed to leave Arpeggio Speed Drill:', error);
      quitInProgressRef.current = false;
      setIsQuitting(false);
    }
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (phaseRef.current === 'processing') return true;
        pauseForExitPrompt();
        return true;
      },
    );

    return () => subscription.remove();
  }, [pauseForExitPrompt]);

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParameters = async () => {
      if (tierLoading || !tier) return;

      setParamsReady(false);
      setVocalRangeAvailable(false);

      try {
        const user = auth.currentUser;
        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(user.uid, 'agility');
          if (cancelled) return;

          const currentExerciseRecords = records
            .filter(
              (record) =>
                record.templateId === 'arpeggioSpeedDrill' &&
                record.tier === tier,
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          if (currentExerciseRecords.length > 0) {
            recentScores = currentExerciseRecords
              .slice(-5)
              .map((record) => record.scorePct);
          } else {
            const latestAssessment = await getLatestAssessment();
            if (cancelled) return;

            const assessmentScore = latestAssessment?.scores.find(
              (score) => score.componentId === 'agility',
            )?.scorePct;

            if (typeof assessmentScore === 'number') {
              recentScores = [assessmentScore];
            }
          }
        }

        const generated = generateArpeggioSpeedDrillParams({
          tier,
          recentScores,
        });

        const vocalAssessments = await getRecentAssessments(10);
        if (cancelled) return;

        let arpeggio: ReturnType<typeof generateArpeggioFromVocalRange> = null;

        for (const assessment of vocalAssessments) {
          const lowHz = Number(
            assessment.vocalRange?.lowHz ?? assessment.vocalRangeLowHz ?? 0,
          );
          const highHz = Number(
            assessment.vocalRange?.highHz ?? assessment.vocalRangeHighHz ?? 0,
          );

          const candidate = generateArpeggioFromVocalRange(lowHz, highHz);
          if (candidate) {
            arpeggio = candidate;
            console.log('Using saved vocal range for Arpeggio Speed Drill:', {
              assessmentId: assessment.id,
              lowHz,
              highHz,
              notes: candidate.notes,
            });
            break;
          }
        }

        if (!cancelled) {
          setConfig({
            ...generated,
            name: arpeggio?.name ?? 'Personalized Arpeggio',
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
            console.warn('No saved vocal range assessments found for current user.');
          }
          setParamsReady(true);
        }
      } catch (error) {
        console.error(
          'Failed to load Arpeggio Speed Drill adaptive parameters:',
          error,
        );

        if (!cancelled) {
          setConfig({
            ...baseConfig,
            name: 'Personalized Arpeggio',
            notes: [],
            frequencies: [],
          });
          setVocalRangeAvailable(false);
          setVocalRangeMessage('Unable to load your vocal assessment. Please check your connection and try again.');
          setParamsReady(true);
        }
      }
    };

    void loadAdaptiveParameters();

    return () => {
      cancelled = true;
    };
  }, [tier, tierLoading, baseConfig]);

  useEffect(
    () => () => {
      stopRecording();
    },
    [stopRecording],
  );

  const requestMicrophonePermission = async (): Promise<boolean> => {
    try {
      const permission = await AudioManager.requestRecordingPermissions();
      return permission === 'Granted';
    } catch (error) {
      console.warn('Microphone permission request failed:', error);
      return false;
    }
  };

  const playReference = async () => {
    if (isPlayingReference || !config.frequencies.length) return;

    setIsPlayingReference(true);
    setReferenceNoteIndex(null);

    const sequence = config.frequencies.map((frequencyHz) => ({
      frequencyHz,
      durationSec: config.noteDurationSec,
    }));

    try {
      const playbackPromise = playNoteSequence(sequence, config.gapSec);

      for (let index = 0; index < config.frequencies.length; index++) {
        setReferenceNoteIndex(index);
        await sleep(config.noteDurationSec * 1000);
        setReferenceNoteIndex(null);

        if (index < config.frequencies.length - 1) {
          await sleep(config.gapSec * 1000);
        }
      }

      await playbackPromise;
    } catch (error) {
      console.error('Reference playback failed:', error);
    } finally {
      setReferenceNoteIndex(null);
      setIsPlayingReference(false);
    }
  };

  const beginExercise = async () => {
    const permission = await requestMicrophonePermission();

    if (!permission) return;

    attemptResultsRef.current = [];
    setCurrentRepetition(1);
    setResult(null);
    processingRef.current = false;
    samplesRef.current = [];
    liveSamplesRef.current = [];
    setPhase('reference');
  };

  const startRecording = async () => {
    try {
      processingRef.current = false;
      samplesRef.current = [];
      liveSamplesRef.current = [];
      setLivePitchHz(null);
      setRecordingTime(0);

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
            phaseRef.current !== 'recording' &&
            recordingStartRef.current !== null
          ) {
            return;
          }

          try {
            const channelData = buffer.getChannelData(0);
            const frameCount = Math.min(numFrames, channelData.length);

            for (let i = 0; i < frameCount; i++) {
              const sample = channelData[i];

              samplesRef.current.push(sample);
              liveSamplesRef.current.push(sample);
            }

            if (liveSamplesRef.current.length > LIVE_BUFFER_SIZE) {
              liveSamplesRef.current.splice(
                0,
                liveSamplesRef.current.length - LIVE_BUFFER_SIZE,
              );
            }

            setLivePitchHz(
              estimateLiveFrequency(liveSamplesRef.current, SAMPLE_RATE),
            );
          } catch (error) {
            console.warn('Live pitch detection failed:', error);
            setLivePitchHz(null);
          }
        },
      );

      if (callbackResult.status === 'error') {
        console.warn(callbackResult.message);
        recorderRef.current = null;
        setPhase('instructions');
        return;
      }

      const startResult = await recorder.start();

      if (startResult.status === 'error') {
        console.warn('Could not start recorder:', startResult.message);

        try {
          recorder.clearOnAudioReady();
        } catch {}

        recorderRef.current = null;
        setPhase('instructions');
        return;
      }

      recordingStartRef.current = Date.now();
      setRecordingTime(0);
      setPhase('recording');

      recordingTimerRef.current = setInterval(() => {
        const start = recordingStartRef.current;

        if (start === null || processingRef.current) return;

        const elapsed = (Date.now() - start) / 1000;

        setRecordingTime(Math.min(elapsed, MAX_RECORDING_SECONDS));

        if (elapsed >= MAX_RECORDING_SECONDS) {
          void processRecording();
        }
      }, 100);
    } catch (error) {
      console.warn('Recording failed:', error);
      stopRecording();
      setPhase('instructions');
    }
  };

  const startCountdown = async () => {
    if (processingRef.current || isPlayingReference || quitInProgressRef.current) return;

    const runId = ++countdownRunIdRef.current;
    setPhase('countdown');

    for (let value = COUNTDOWN_SECONDS; value >= 1; value--) {
      if (
        runId !== countdownRunIdRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      setCountdown(value);
      await sleep(1000);
    }

    if (runId !== countdownRunIdRef.current || quitInProgressRef.current) return;
    await startRecording();
  };

  const processRecording = async () => {
    if (processingRef.current) return;

    processingRef.current = true;
    stopRecording();
    setLivePitchHz(null);
    setPhase('processing');

    await sleep(300);

    try {
      const samples = new Float32Array(samplesRef.current);
      const expectedNoteIntervalSec =
        config.noteDurationSec + config.gapSec;

      const measurement = measureArpeggioSpeed(
        samples,
        SAMPLE_RATE,
        config.frequencies,
        config.pitchTolerancePercent,
        expectedNoteIntervalSec,
      );

      const scored = scoreArpeggioSpeed(measurement);

      const repetitionResult: Result = {
        overall: scored.overall,
        pitchScore: scored.pitchScore,
        sequenceScore: scored.sequenceScore,
        speedScore: scored.speedScore,
        passed: scored.passed,
        feedback: scored.feedback,
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
        `Arpeggio Speed Drill repetition ${currentRepetition}/${repetitionCount} completed:`,
        repetitionResult,
      );

      if (currentRepetition < repetitionCount) {
        setCurrentRepetition((previous) => previous + 1);
        setRecordingTime(0);
        setCountdown(COUNTDOWN_SECONDS);
        setReferenceNoteIndex(null);
        setLivePitchHz(null);
        processingRef.current = false;
        setPhase('reference');
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

      setResult(finalResult);
      setPhase('results');
    } catch (error) {
      console.warn('Processing failed:', error);
      processingRef.current = false;
      attemptResultsRef.current = [];
      setCurrentRepetition(1);
      setPhase('instructions');
    }
  };

  const resetExercise = () => {
    countdownRunIdRef.current += 1;
    stopRecording();
    setShowExitConfirmation(false);
    processingRef.current = false;
    samplesRef.current = [];
    liveSamplesRef.current = [];
    attemptResultsRef.current = [];
    setCurrentRepetition(1);
    setLivePitchHz(null);
    setResult(null);
    setRecordingTime(0);
    setCountdown(COUNTDOWN_SECONDS);
    setReferenceNoteIndex(null);
    setPhase('instructions');
  };

  const renderInstructions = () => {
    const difficulty = tier
      ? tier.charAt(0).toUpperCase() + tier.slice(1)
      : 'Beginner';

    return (
      <ExerciseScreen
        title="Arpeggio Speed Drill"
        category="Vocal Agility"
        icon="flash-outline"
        instructions="Listen carefully to the reference arpeggio, then sing the notes in order while maintaining accuracy at the required speed."
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
          { label: 'NOTES', value: String(config.frequencies.length) },
          { label: 'REPETITIONS', value: String(repetitionCount) },
          {
            label: 'NOTE DURATION',
            value: `${config.noteDurationSec.toFixed(2)}s`,
          },
          { label: 'ARPEGGIO', value: config.notes.join(' • ') },
        ]}
        tip={
          vocalRangeAvailable
            ? 'Focus on matching each note accurately first. Gradually build speed while keeping the sequence clear and controlled.'
            : vocalRangeMessage
        }
        tier={tier}
        startDisabled={tierLoading || !paramsReady || !vocalRangeAvailable || !config.frequencies.length}
        startLabel={
          tierLoading || !paramsReady
            ? 'Preparing Exercise...'
            : vocalRangeAvailable
              ? 'Start Exercise'
              : vocalRangeMessage.startsWith('No saved vocal range')
                ? 'Vocal Assessment Required'
                : 'Vocal Range Needs Review'
        }
        onBack={pauseForExitPrompt}
        onStart={beginExercise}
      />
    );
  };

  const renderReference = () => (
    <View style={styles.content}>
      <View style={styles.iconCircle}>
        <Ionicons name="musical-notes-outline" size={34} color={COLORS.brown} />
      </View>

      <Text style={styles.phaseTitle}>Listen to the Reference</Text>
      <Text style={styles.phaseSubtitle}>
        Repetition {currentRepetition} of {repetitionCount}
      </Text>

      <View style={styles.paceGuideCard}>
        <View style={styles.paceGuideHeader}>
          <Ionicons name="speedometer-outline" size={18} color={COLORS.brown} />
          <Text style={styles.paceGuideTitle}>Your Pace Guide</Text>
        </View>

        <View style={styles.paceGuideStats}>
          <View style={styles.paceGuideStat}>
            <Text style={styles.paceGuideLabel}>NOTE DURATION</Text>
            <Text style={styles.paceGuideValue}>
              {config.noteDurationSec.toFixed(2)} s
            </Text>
          </View>

          <View style={styles.paceGuideDivider} />

          <View style={styles.paceGuideStat}>
            <Text style={styles.paceGuideLabel}>GAP BETWEEN NOTES</Text>
            <Text style={styles.paceGuideValue}>
              {config.gapSec.toFixed(2)} s
            </Text>
          </View>
        </View>

        <Text style={styles.paceGuideHint}>
          Tip: Follow the reference timing instead of rushing. Accuracy comes
          first.
        </Text>
      </View>

      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>REFERENCE ARPEGGIO</Text>

        <View style={styles.noteSequence}>
          {config.frequencies.map((frequency, index) => (
            <View
              key={`${frequency}-${index}`}
              style={[
                styles.notePill,
                referenceNoteIndex === index && styles.referenceNoteActive,
              ]}
            >
              <Text style={styles.noteNumber}>{index + 1}</Text>
              <Text style={styles.noteText}>
                {frequencyToNoteName(frequency)}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.referenceHint}>
          Listen to the complete pattern before starting.
        </Text>
      </View>

      <Pressable
        style={[
          styles.referenceButton,
          isPlayingReference && styles.buttonDisabled,
        ]}
        disabled={isPlayingReference}
        onPress={() => void playReference()}
      >
        <Ionicons name="play" size={18} color={COLORS.brown} />
        <Text style={styles.referenceButtonText}>
          {isPlayingReference ? 'Playing Reference...' : 'Play Reference'}
        </Text>
      </Pressable>

      <Pressable
        style={styles.startButton}
        disabled={isPlayingReference}
        onPress={() => void startCountdown()}
      >
        <Text style={styles.startButtonText}>I'm Ready</Text>
      </Pressable>
    </View>
  );

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons name="flash-outline" size={34} color={COLORS.brown} />
      </View>

      <Text style={styles.phaseTitle}>Get Ready</Text>
      <Text style={styles.phaseSubtitle}>
        Repetition {currentRepetition} of {repetitionCount}
      </Text>
      <Text style={styles.countdownText}>{countdown}</Text>
      <Text style={styles.phaseSubtitle}>
        Prepare to sing the arpeggio in sequence.
      </Text>
    </View>
  );

  const renderRecording = () => {
    const progress = Math.min(recordingTime / MAX_RECORDING_SECONDS, 1);

    const liveMatch =
      livePitchHz === null
        ? { index: -1, distance: Infinity }
        : findClosestTarget(livePitchHz, config.frequencies);

    const liveDetectedNote =
      liveMatch.index >= 0 && liveMatch.distance <= 1.5
        ? config.notes[liveMatch.index]
        : null;

    const liveStatus =
      livePitchHz === null
        ? 'No clear pitch detected'
        : liveMatch.distance <= 0.5
          ? 'Close pitch match'
          : liveMatch.distance <= 1.5
            ? 'Near the target pitch'
            : 'Pitch does not closely match a target';

    return (
      <View style={styles.content}>
        <View style={styles.recordingIcon}>
          <Ionicons name="mic" size={34} color={COLORS.brown} />
        </View>

        <Text style={styles.recordingTitle}>Sing the Arpeggio</Text>
        <Text style={styles.recordingSubtitle}>
          Repetition {currentRepetition} of {repetitionCount}
        </Text>

        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingBadgeText}>RECORDING</Text>
        </View>

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>LIVE DETECTED NOTE</Text>
          <Text style={styles.liveCurrentNote}>
            {liveDetectedNote ??
              (livePitchHz === null ? 'Listening...' : 'Unmatched')}
          </Text>
          <Text style={styles.liveStatValue}>
            {livePitchHz !== null
              ? `${livePitchHz.toFixed(1)} Hz`
              : 'Sing a clear, sustained note'}
          </Text>
          <View style={styles.liveDivider} />
          <Text style={styles.liveStatLabel}>{liveStatus}</Text>
        </View>

        <View style={styles.referenceCard}>
          <Text style={styles.cardTitle}>Sing This Sequence</Text>
          <Text style={styles.sequenceHint}>
            Follow the pink-highlighted note in time with the sequence. If you
            fall behind, use the highlighted note as your timing guide.
          </Text>

          <View style={styles.noteSequence}>
            {config.frequencies.map((frequency, index) => {
              const isDetectedNote =
                liveMatch.index === index && liveMatch.distance <= 1.5;

              const noteStyle = !isDetectedNote
                ? styles.notePending
                : liveMatch.distance <= 0.5
                  ? styles.noteCorrect
                  : styles.noteClose;

              const statusLabel = !isDetectedNote
                ? null
                : liveMatch.distance <= 0.5
                  ? 'Correct'
                  : 'Close';

              const statusColor =
                liveMatch.distance <= 0.5 ? COLORS.guideGreen : COLORS.guideYellow;

              return (
                <View
                  key={`${frequency}-${index}`}
                  style={[
                    styles.notePill,
                    (referenceNoteIndex === index && isPlayingReference) ||
                    timedReferenceNoteIndex === index
                      ? styles.referenceNoteActive
                      : noteStyle,
                  ]}
                >
                  <Text style={styles.noteNumber}>{index + 1}</Text>
                  <Text style={styles.noteText}>
                    {frequencyToNoteName(frequency)}
                  </Text>

                  {statusLabel !== null && (
                    <Text style={[styles.noteStatus, { color: statusColor }]}>
                      {statusLabel}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        <Text style={styles.timerText}>
          Recording Time: {recordingTime.toFixed(1)}s
        </Text>

        <View style={styles.timerTrack}>
          <View style={[styles.timerFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
    );
  };

  const renderProcessing = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <ActivityIndicator size="large" color={COLORS.brown} />
      </View>

      <Text style={styles.phaseTitle}>Analyzing Your Singing</Text>
      <Text style={styles.phaseSubtitle}>
        Repetition {currentRepetition} of {repetitionCount}
      </Text>
      <Text style={styles.phaseSubtitle}>
        Measuring pitch accuracy, note sequence, and singing speed.
      </Text>
    </View>
  );

  const renderResults = () => {
    if (!result) return null;

    return (
      <View style={styles.resultsContent}>
        <View
          style={[
            styles.resultIcon,
            result.passed ? styles.resultIconPassed : styles.resultIconFailed,
          ]}
        >
          <Ionicons
            name={result.passed ? 'checkmark' : 'refresh'}
            size={40}
            color={COLORS.brown}
          />
        </View>

        <Text style={styles.resultTitle}>
          {result.passed ? 'Great Job!' : 'Keep Practicing!'}
        </Text>
        <Text style={styles.resultSubtitle}>Arpeggio Speed Drill Result</Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>OVERALL SCORE</Text>
          <Text style={styles.scoreValue}>{result.overall}</Text>
          <Text style={styles.scoreDescription}>
            out of 100 · Average across {repetitionCount} repetitions
          </Text>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>Performance Breakdown</Text>

          <View style={styles.scoreRow}>
            <View style={styles.scoreRowHeader}>
              <Text style={styles.scoreRowLabel}>Pitch Accuracy</Text>
              <Text style={styles.scoreRowValue}>{result.pitchScore}%</Text>
            </View>
            <View style={styles.progressBackground}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(Math.max(result.pitchScore, 0), 100)}%`,
                  },
                ]}
              />
            </View>
          </View>

          <View style={styles.scoreRow}>
            <View style={styles.scoreRowHeader}>
              <Text style={styles.scoreRowLabel}>Sequence Accuracy</Text>
              <Text style={styles.scoreRowValue}>{result.sequenceScore}%</Text>
            </View>
            <View style={styles.progressBackground}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(Math.max(result.sequenceScore, 0), 100)}%`,
                  },
                ]}
              />
            </View>
          </View>

          <View style={styles.scoreRowLast}>
            <View style={styles.scoreRowHeader}>
              <Text style={styles.scoreRowLabel}>Speed Score</Text>
              <Text style={styles.scoreRowValue}>{result.speedScore}%</Text>
            </View>
            <View style={styles.progressBackground}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(Math.max(result.speedScore, 0), 100)}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>Performance Metrics</Text>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Correct Notes</Text>
            <Text style={styles.metricValue}>
              {result.correctNoteCount}/{result.noteCount}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Notes per Second</Text>
            <Text style={styles.metricValue}>
              {result.notesPerSecond.toFixed(2)}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Average Note Duration</Text>
            <Text style={styles.metricValue}>
              {result.averageNoteDurationMs > 0
                ? result.averageNoteDurationMs.toFixed(0)
                : '0'}{' '}
              ms
            </Text>
          </View>

          <View style={[styles.metricRow, styles.metricRowLast]}>
            <Text style={styles.metricLabel}>Duration</Text>
            <Text style={styles.metricValue}>
              {(result.durationMs / 1000).toFixed(1)}s
            </Text>
          </View>
        </View>

        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={20} color={COLORS.brown} />
          <Text style={styles.tipText}>{result.feedback}</Text>
        </View>

        <Pressable style={styles.startButton} onPress={resetExercise}>
          <Ionicons name="refresh" size={18} color={COLORS.white} />
          <Text style={styles.startButtonText}>Try Again</Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={pauseForExitPrompt}
        >
          <Text style={styles.doneButtonText}>Back to Exercises</Text>
        </Pressable>


      </View>
    );
  };

  if (tierLoading || !paramsReady) {
    return (
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons name="options-outline" size={44} color={COLORS.brown} />
        </View>

        <Text style={styles.preparingTitle}>Preparing Your Exercise</Text>
        <Text style={styles.preparingSubtitle}>
          Adjusting the exercise to your current difficulty level and preparing
          your vocal range.
        </Text>

        <ActivityIndicator
          size="large"
          color={COLORS.brown}
          style={styles.spinner}
        />
      </View>
    );
  }

  return (
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
      <Modal
        visible={showExitConfirmation}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={continueExercise}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <Ionicons name="exit-outline" size={30} color={COLORS.brown} />
            </View>

            <Text style={styles.modalTitle}>Quit exercise?</Text>

            <Text style={styles.modalMessage}>
              {pausedPhaseRef.current === 'instructions' ||
              pausedPhaseRef.current === 'results'
                ? 'Are you sure you want to leave Arpeggio Speed Drill?'
                : pausedPhaseRef.current === 'recording'
                  ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                  : pausedPhaseRef.current === 'countdown'
                    ? 'Your exercise is paused. Your completed repetitions will be kept. The countdown will restart when you continue.'
                    : pausedPhaseRef.current === 'reference'
                      ? 'Your exercise is paused. Your completed repetitions will be kept. Continue to return to the reference arpeggio.'
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
                isQuitting && styles.modalButtonDisabled,
              ]}
            >
              <Text style={styles.continueButtonText}>Continue Exercise</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quit exercise"
              disabled={isQuitting}
              onPress={() => void quitExercise()}
              style={({ pressed }) => [
                styles.quitButton,
                pressed && styles.buttonPressed,
                isQuitting && styles.modalButtonDisabled,
              ]}
            >
              <Text style={styles.quitButtonText}>
                {isQuitting ? 'Stopping...' : 'Quit Exercise'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  modalButtonDisabled: {
    opacity: 0.5,
  },

  preparingScreen: {
    flex: 1,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  preparingIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  preparingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: COLORS.brown,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 100,
    paddingBottom: 60,
    alignItems: 'center',
  },
  resultsContent: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 92,
    paddingBottom: 50,
    alignItems: 'center',
  },
  resultsWrapper: {
    flexGrow: 1,
    width: '100%',
  },
  centerScreen: {
    flexGrow: 1,
    minHeight: 700,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: COLORS.brown,
    textAlign: 'center',
    marginTop: 20,
  },
  phaseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },
  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: COLORS.brown,
    marginTop: 10,
    marginBottom: 8,
    textAlign: 'center',
  },
  paceGuideCard: {
    width: '100%',
    marginTop: 18,
    padding: 16,
    borderRadius: 18,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  paceGuideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  paceGuideTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: COLORS.brown,
  },
  paceGuideStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 13,
    backgroundColor: COLORS.background,
  },
  paceGuideStat: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  paceGuideDivider: {
    width: 1,
    height: 34,
    backgroundColor: COLORS.border,
  },
  paceGuideLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.4,
    color: COLORS.muted,
    textAlign: 'center',
  },
  paceGuideValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: COLORS.brown,
    marginTop: 4,
  },
  paceGuideHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: COLORS.brown,
    textAlign: 'center',
    marginTop: 11,
  },
  referenceCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 22,
  },
  referenceLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: COLORS.muted,
    textAlign: 'center',
  },
  referenceHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 16,
  },
  sequenceHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: COLORS.muted,
    textAlign: 'center',
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
    backgroundColor: COLORS.pink,
    alignItems: 'center',
  },
  referenceNoteActive: {
    backgroundColor: COLORS.otherpink,
    borderWidth: 1,
    borderColor: COLORS.otherpink,
  },
  notePending: {
    backgroundColor: COLORS.background,
  },
  noteCorrect: {
    backgroundColor: COLORS.lightGreen,
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  noteClose: {
    backgroundColor: COLORS.lightYellow,
    borderWidth: 1,
    borderColor: COLORS.guideYellow,
  },
  noteNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: COLORS.muted,
    marginBottom: 2,
  },
  noteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: COLORS.brown,
  },
  noteStatus: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    marginTop: 4,
    textAlign: 'center',
  },
  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.pink,
    borderRadius: 18,
    padding: 15,
    marginTop: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: COLORS.brown,
    marginLeft: 9,
  },
  referenceButton: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.pink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 22,
  },
  referenceButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  startButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.brown,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.white,
  },
  doneButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.lightGray,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  doneButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
  },
  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: COLORS.brown,
    marginTop: 20,
  },
  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 26,
    color: COLORS.brown,
    textAlign: 'center',
  },
  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 3,
    maxWidth: 310,
  },
  recordingBadge: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.brown,
    marginRight: 7,
  },
  recordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: COLORS.brown,
  },
  liveCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 20,
    marginTop: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    letterSpacing: 0.8,
    color: COLORS.muted,
  },
  liveCurrentNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: COLORS.brown,
    marginTop: 4,
  },
  liveDivider: {
    width: '100%',
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 15,
  },
  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    textAlign: 'center',
  },
  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.brown,
    marginTop: 3,
  },
  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 7,
  },
  timerTrack: {
    width: '100%',
    height: 7,
    backgroundColor: COLORS.lightGray,
    borderRadius: 4,
    overflow: 'hidden',
  },
  timerFill: {
    height: '100%',
    backgroundColor: COLORS.pink,
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
    backgroundColor: COLORS.pink,
  },
  resultIconFailed: {
    backgroundColor: COLORS.lightGray,
  },
  resultTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: COLORS.brown,
    textAlign: 'center',
  },
  resultSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 3,
    marginBottom: 22,
  },
  scoreCard: {
    width: '100%',
    backgroundColor: COLORS.pink,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
  },
  scoreLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.brown,
  },
  scoreValue: {
    fontFamily: 'FredokaBold',
    fontSize: 52,
    color: COLORS.brown,
    marginVertical: 3,
  },
  scoreDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.muted,
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: COLORS.brown,
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
    color: COLORS.muted,
  },
  scoreRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: COLORS.brown,
  },
  progressBackground: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.lightGray,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: COLORS.pink,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  metricRowLast: {
    borderBottomWidth: 0,
  },
  metricLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    flex: 1,
  },
  metricValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: COLORS.brown,
    textAlign: 'right',
    marginLeft: 12,
  },
});