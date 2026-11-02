import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';

import {
  ARPEGGIO_SPEED_DRILL_PARAMS,
  type Tier,
} from '@/constants/params';
import { AgilitySequenceGuide } from '@/screens/exercises/Agility/AgilitySequenceGuide';
import ExerciseScreen, {
  ExerciseListeningScreen,
  ExerciseNoAudioModal,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseQuitModal,
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
import { sleep } from '@/utils/async';
import { playNoteSequence } from '@/utils/music/notePlayer';
import {
  frequencyToMidi,
  frequencyToNoteName,
  getSemitoneDistance,
  midiToFrequency,
} from '@/utils/music/notes';

import {
  AUDIO_BUFFER_SIZE,
  AUDIO_SAMPLE_RATE,
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
  EXERCISE_MAX_RECORDING_SECONDS,
} from '@/constants/appConstants';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { average } from '@/utils/math';

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
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
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
  const [currentRep, setCurrentRep] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

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
    setShowQuitModal(true);

    countdownRunIdRef.current += 1;

    if (activePhase === 'recording' || activePhase === 'countdown') {
      stopRecording();
      samplesRef.current = [];
      liveSamplesRef.current = [];
      setLivePitchHz(null);
      setRecordingTime(0);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      setReferenceNoteIndex(null);
    }
  }, [stopRecording]);

  const continueExercise = () => {
    if (quitInProgressRef.current) return;

    const pausedPhase = pausedPhaseRef.current;
    setShowQuitModal(false);

    if (pausedPhase === 'recording' || pausedPhase === 'countdown') {
      samplesRef.current = [];
      liveSamplesRef.current = [];
      setLivePitchHz(null);
      setRecordingTime(0);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
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
    setShowQuitModal(false);
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
      await playNoteSequence(sequence, config.gapSec, setReferenceNoteIndex);
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
    setCurrentRep(1);
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
          sampleRate: AUDIO_SAMPLE_RATE,
          bufferLength: AUDIO_BUFFER_SIZE,
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
              estimateLiveFrequency(liveSamplesRef.current, AUDIO_SAMPLE_RATE),
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

        setRecordingTime(Math.min(elapsed, EXERCISE_MAX_RECORDING_SECONDS));

        if (elapsed >= EXERCISE_MAX_RECORDING_SECONDS) {
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

    for (let value = EXERCISE_COUNTDOWN_SECONDS; value >= 1; value--) {
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

      if (!hasSufficientRecordedSignal(samples)) {
        processingRef.current = false;
        setPhase('reference');
        setShowNoAudioModal(true);
        return;
      }

      const expectedNoteIntervalSec =
        config.noteDurationSec + config.gapSec;

      const measurement = measureArpeggioSpeed(
        samples,
        AUDIO_SAMPLE_RATE,
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
        `Arpeggio Speed Drill repetition ${currentRep}/${repetitionCount} completed:`,
        repetitionResult,
      );

      if (currentRep < repetitionCount) {
        setCurrentRep((previous) => previous + 1);
        setRecordingTime(0);
        setCountdown(EXERCISE_COUNTDOWN_SECONDS);
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
      setCurrentRep(1);
      setPhase('instructions');
    }
  };

  const resetExercise = () => {
    countdownRunIdRef.current += 1;
    stopRecording();
    setShowQuitModal(false);
    processingRef.current = false;
    samplesRef.current = [];
    liveSamplesRef.current = [];
    attemptResultsRef.current = [];
    setCurrentRep(1);
    setLivePitchHz(null);
    setResult(null);
    setRecordingTime(0);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
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
    <ExerciseListeningScreen
      icon="musical-notes-outline"
      title="Arpeggio Speed Drill"
      currentRep={currentRep}
      repetitions={repetitionCount}
      promptTitle="Listen to the Reference"
      prompt="Listen to the full arpeggio, then sing the notes in order while following its timing."
      liveContent={
        <AgilitySequenceGuide
          names={config.frequencies.map(frequencyToNoteName)}
          activeIndex={referenceNoteIndex}
          caption={`Note duration: ${config.noteDurationSec.toFixed(2)} s | Gap: ${config.gapSec.toFixed(2)} s`}
        />
      }
      isPlayingReference={isPlayingReference}
      onPlayReference={() => void playReference()}
      onContinue={() => void startCountdown()}
      onBack={pauseForExitPrompt}
    />
  );

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons name="flash-outline" size={34} color={COLORS.brown} />
      </View>

      <Text style={styles.phaseTitle}>Get Ready</Text>
      <Text style={styles.phaseSubtitle}>
        Repetition {currentRep} of {repetitionCount}
      </Text>
      <Text style={styles.countdownText}>{countdown}</Text>
      <Text style={styles.phaseSubtitle}>
        Prepare to sing the arpeggio in sequence.
      </Text>
    </View>
  );

  const renderRecording = () => {
    const progress = Math.min(recordingTime / EXERCISE_MAX_RECORDING_SECONDS, 1);

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
      <ExerciseRecordingScreen
        title="Sing the Arpeggio"
        currentRep={currentRep}
        repetitions={repetitionCount}
        onBack={pauseForExitPrompt}
      >

        <AgilitySequenceGuide
          names={config.frequencies.map(frequencyToNoteName)}
          activeIndex={timedReferenceNoteIndex}
          liveNote={liveDetectedNote ?? undefined}
          showFeedback
          caption="Follow the highlighted note in time with the sequence."
        />

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

        <Text style={styles.timerText}>
          Recording Time: {recordingTime.toFixed(1)}s
        </Text>

        <View style={styles.timerTrack}>
          <View style={[styles.timerFill, { width: `${progress * 100}%` }]} />
        </View>
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
      <ExercisePreparingScreen
        title="Preparing Your Exercise"
        message="Adjusting the exercise to your current difficulty level and preparing your vocal range."
        icon="options-outline"
        iconSize={44}
      />
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
      <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit exercise?"}
        message={pausedPhaseRef.current === 'instructions' ||
              pausedPhaseRef.current === 'results'
                ? 'Are you sure you want to leave Arpeggio Speed Drill?'
                : pausedPhaseRef.current === 'recording'
                  ? 'Your exercise is paused. Your completed repetitions will be kept, and you will restart the current repetition when you continue.'
                  : pausedPhaseRef.current === 'countdown'
                    ? 'Your exercise is paused. Your completed repetitions will be kept. The countdown will restart when you continue.'
                    : pausedPhaseRef.current === 'reference'
                      ? 'Your exercise is paused. Your completed repetitions will be kept. Continue to return to the reference arpeggio.'
                      : 'Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise.'}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => void quitExercise()}
        continueLabel={"Continue Exercise"}
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />
      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={function redoExerciseRepetition() {
          setShowNoAudioModal(false);
          processingRef.current = false;
          samplesRef.current = [];
          liveSamplesRef.current = [];
          setCountdown(EXERCISE_COUNTDOWN_SECONDS);
          setReferenceNoteIndex(null);
          setLivePitchHz(null);
          void startCountdown();
        }}
        onQuit={() => {
          setShowNoAudioModal(false);
          void quitExercise();
        }}
        isQuitting={isQuitting}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({

  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
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