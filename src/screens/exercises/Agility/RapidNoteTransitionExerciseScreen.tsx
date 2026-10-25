import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  RAPID_NOTE_TRANSITION_PARAMS,
  type Tier,
} from '@/constants/agility';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import { generateRapidNoteTransitionParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureRapidNoteTransition } from '@/services/measurement/agility/rapidNoteTransitionExercise';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreRapidNoteTransition } from '@/services/scoring/agility/rapidNoteTransitionExercise';
import {
  disposeNotePlayer,
  playNoteSequence,
  type NoteToPlay,
} from '@/utils/music/notePlayer';
import { createMusicalNote } from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const ACTIVE_REFERENCE_PINK = '#D76587';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';
const GUIDE_GREEN = '#4F9B67';
const GUIDE_YELLOW = '#D9A72E';
const GUIDE_RED = '#D64F5A';

const COUNTDOWN_SECONDS = 3;
const MAX_RECORDING_SECONDS = 10;
const REFERENCE_NOTE_GAP_SECONDS = 0.08;

type Screen =
  | 'instructions'
  | 'countdown'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'results';

type Props = {
  tier?: Tier;
};

type LiveState = {
  pitch: number;
  note: string;
  clarity: number;
};

type ExerciseSequence = {
  notes: NoteToPlay[];
  frequencies: number[];
  names: string[];
};

type AttemptResult = {
  repetition: number;
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
  transitionCount: number;
  transitionsPerSecond: number;
  averageTransitionTimeMs: number;
};

type ExerciseResult = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
  transitionCount: number;
  transitionsPerSecond: number;
  averageTransitionTimeMs: number;
  attempts: AttemptResult[];
};

function getRandomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

function noteNameToMidi(noteName: string | undefined): number | null {
  if (!noteName) {
    return null;
  }

  const match = noteName.trim().match(/^([A-G])([#b]?)(-?\d+)$/i);

  if (!match) {
    return null;
  }

  const semitones: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };

  const letter = match[1].toUpperCase();
  const accidental = match[2];
  const octave = Number(match[3]);
  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;

  return (octave + 1) * 12 + semitones[letter] + offset;
}

function getGuideFeedbackColor(
  targetNote: string,
  liveNote: string | undefined,
): string | null {
  if (!liveNote || liveNote === '--') {
    return null;
  }

  const targetMidi = noteNameToMidi(targetNote);
  const liveMidi = noteNameToMidi(liveNote);

  if (targetMidi === null || liveMidi === null) {
    return null;
  }

  const difference = Math.abs(targetMidi - liveMidi);

  if (difference === 0) {
    return GUIDE_GREEN;
  }

  if (difference === 1) {
    return GUIDE_YELLOW;
  }

  return GUIDE_RED;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function generateExerciseSequence(
  minMidi: number,
  maxMidi: number,
  noteCount: number,
  noteDurationSeconds: number,
): ExerciseSequence {
  const midiNotes: number[] = [];

  for (let index = 0; index < noteCount; index += 1) {
    let midi = getRandomInteger(minMidi, maxMidi);

    if (index > 0 && midi === midiNotes[index - 1]) {
      midi = midi === maxMidi ? midi - 1 : midi + 1;
    }

    midiNotes.push(midi);
  }

  const musicalNotes = midiNotes.map(createMusicalNote);

  return {
    notes: musicalNotes.map(note => ({
      frequencyHz: note.frequency,
      durationSec: noteDurationSeconds,
    })),
    frequencies: musicalNotes.map(note => note.frequency),
    names: musicalNotes.map(note => note.name),
  };
}

function createFailedAttempt(repetition: number): AttemptResult {
  return {
    repetition,
    overall: 0,
    pitchScore: 0,
    sequenceScore: 0,
    speedScore: 0,
    passed: false,
    feedback:
      'We could not detect enough usable notes for this repetition, so it received 0%. Sing clearly near the microphone in a quiet area.',
    transitionCount: 0,
    transitionsPerSecond: 0,
    averageTransitionTimeMs: 0,
  };
}

function buildExerciseResult(
  attempts: AttemptResult[],
  accuracyThreshold: number,
  forceFail = false,
): ExerciseResult {
  const overall = Math.round(
    average(attempts.map(attempt => attempt.overall)),
  );
  const pitchScore = Math.round(
    average(attempts.map(attempt => attempt.pitchScore)),
  );
  const sequenceScore = Math.round(
    average(attempts.map(attempt => attempt.sequenceScore)),
  );
  const speedScore = Math.round(
    average(attempts.map(attempt => attempt.speedScore)),
  );
  const transitionCount = Math.round(
    average(attempts.map(attempt => attempt.transitionCount)),
  );
  const transitionsPerSecond = average(
    attempts.map(attempt => attempt.transitionsPerSecond),
  );
  const averageTransitionTimeMs = average(
    attempts.map(attempt => attempt.averageTransitionTimeMs),
  );

  const passed =
    !forceFail &&
    overall >= accuracyThreshold &&
    pitchScore >= 60 &&
    sequenceScore >= 60;

  const feedback = forceFail
    ? `You completed all ${attempts.length} repetitions. One or more attempts could not be analyzed, so those attempts received 0%. Check your microphone and try again in a quiet area.`
    : passed
      ? `You completed all ${attempts.length} repetitions and met the ${accuracyThreshold}% exercise goal. Keep practicing for smoother, more consistent transitions.`
      : `You completed all ${attempts.length} repetitions. Your average score was ${overall}%, below the ${accuracyThreshold}% exercise goal. Focus on accurate notes before increasing speed.`;

  return {
    overall,
    pitchScore,
    sequenceScore,
    speedScore,
    passed,
    feedback,
    transitionCount,
    transitionsPerSecond,
    averageTransitionTimeMs,
    attempts,
  };
}

export default function RapidNoteTransitionExerciseScreen({
  tier = 'beginner',
}: Props) {
  const baseParams = useMemo(
    () => RAPID_NOTE_TRANSITION_PARAMS[tier],
    [tier],
  );

  const [adaptiveParams, setAdaptiveParams] = useState(baseParams);
  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] = useState(true);
  const [assessedVocalRangeHz, setAssessedVocalRangeHz] = useState<{
    lowHz: number;
    highHz: number;
  } | null>(null);
  const [exerciseConfigVersion, setExerciseConfigVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadAdaptiveParams = async () => {
      setIsLoadingAdaptiveParams(true);

      try {
        const user = auth.currentUser;

        if (!user) {
          if (!cancelled) {
            setAdaptiveParams(baseParams);
            setAssessedVocalRangeHz(null);
          }
          return;
        }

        const exerciseRecords = await fetchExerciseRecords(user.uid, 'agility');

        if (cancelled) {
          return;
        }

        const matchingRecords = exerciseRecords
          .filter(
            record =>
              record.templateId === 'rapidNoteTransition' &&
              record.tier === tier,
          )
          .sort((a, b) => a.timestamp - b.timestamp);

        let latestAssessment:
          | Awaited<ReturnType<typeof getLatestAssessment>>
          | null = null;

        try {
          latestAssessment = await getLatestAssessment();

          if (cancelled) {
            return;
          }

          const lowHz =
            latestAssessment?.vocalRange?.lowHz ??
            latestAssessment?.vocalRangeLowHz;
          const highHz =
            latestAssessment?.vocalRange?.highHz ??
            latestAssessment?.vocalRangeHighHz;

          const validRange =
            typeof lowHz === 'number' &&
            Number.isFinite(lowHz) &&
            lowHz > 0 &&
            typeof highHz === 'number' &&
            Number.isFinite(highHz) &&
            highHz > lowHz &&
            Math.floor(frequencyToMidi(highHz)) -
              Math.ceil(frequencyToMidi(lowHz)) >=
              2;

          setAssessedVocalRangeHz(
            validRange ? { lowHz, highHz } : null,
          );
        } catch (error) {
          setAssessedVocalRangeHz(null);
          console.warn('Could not load assessment vocal range:', error);
        }

        if (cancelled) {
          return;
        }

        let recentScores = matchingRecords
          .slice(-5)
          .map(record => record.scorePct);

        if (matchingRecords.length === 0) {
          const assessmentScore = latestAssessment?.scores.find(
            score => score.componentId === 'agility',
          )?.scorePct;

          if (
            typeof assessmentScore === 'number' &&
            Number.isFinite(assessmentScore)
          ) {
            recentScores = [assessmentScore];
          }
        }

        setAdaptiveParams(
          generateRapidNoteTransitionParams({
            tier,
            recentScores,
          }),
        );
      } catch (error) {
        console.error('Failed to load adaptive parameters:', error);

        if (!cancelled) {
          setAdaptiveParams(baseParams);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
        }
      }
    };

    void loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [baseParams, tier]);

  const exerciseConfig = useMemo(() => {
    const minNotes = Math.max(
      1,
      Math.min(
        baseParams.maxNotes,
        Math.max(baseParams.minNotes, Math.ceil(adaptiveParams.minNotes)),
      ),
    );
    const maxNotes = Math.max(
      minNotes,
      Math.min(baseParams.maxNotes, Math.floor(adaptiveParams.maxNotes)),
    );
    const noteCount = getRandomInteger(minNotes, maxNotes);

    const minSpeed = Math.max(
      baseParams.minSpeed,
      Math.min(baseParams.maxSpeed, adaptiveParams.minSpeed),
    );
    const maxSpeed = Math.max(
      minSpeed,
      Math.min(baseParams.maxSpeed, adaptiveParams.maxSpeed),
    );
    const shortestAllowedDuration = Math.max(
      0.05,
      1 / maxSpeed - REFERENCE_NOTE_GAP_SECONDS,
    );
    const longestAllowedDuration = Math.max(
      shortestAllowedDuration,
      1 / minSpeed - REFERENCE_NOTE_GAP_SECONDS,
    );
    const noteDurationSec = Math.min(
      longestAllowedDuration,
      Math.max(shortestAllowedDuration, adaptiveParams.noteDurationSec),
    );
    const targetSpeed =
      1 / (noteDurationSec + REFERENCE_NOTE_GAP_SECONDS);

    const assessedMinMidi = assessedVocalRangeHz
      ? Math.max(
          adaptiveParams.minMidi,
          Math.ceil(frequencyToMidi(assessedVocalRangeHz.lowHz)),
        )
      : adaptiveParams.minMidi;
    const assessedMaxMidi = assessedVocalRangeHz
      ? Math.min(
          adaptiveParams.maxMidi,
          Math.floor(frequencyToMidi(assessedVocalRangeHz.highHz)),
        )
      : adaptiveParams.maxMidi;
    const hasUsableRange = assessedMaxMidi - assessedMinMidi >= 2;

    const minMidi = hasUsableRange
      ? assessedMinMidi
      : adaptiveParams.minMidi;
    const maxMidi = hasUsableRange
      ? assessedMaxMidi
      : adaptiveParams.maxMidi;

    return {
      noteCount,
      targetSpeed,
      repetitions: Math.max(
        1,
        Math.min(baseParams.repetitions, Math.round(adaptiveParams.repetitions)),
      ),
      accuracyThreshold: baseParams.accuracyThreshold,
      noteDurationSec,
      sequence: generateExerciseSequence(
        minMidi,
        maxMidi,
        noteCount,
        noteDurationSec,
      ),
    };
  }, [
    adaptiveParams,
    assessedVocalRangeHz,
    baseParams,
    exerciseConfigVersion,
  ]);

  const [screenState, setScreenState] = useState<Screen>('instructions');
  const [confirmation, setConfirmation] = useState<'tryAgain' | 'quit' | null>(null);
  const [isPreparingResume, setIsPreparingResume] = useState(false);
  const pausedRepetitionRef = useRef(1);
  const pausedScreenRef = useRef<Screen>('instructions');
  const screenRef = useRef<Screen>('instructions');

  const setScreen = useCallback((nextScreen: Screen) => {
    screenRef.current = nextScreen;
    setScreenState(nextScreen);
  }, []);

  const screen = screenState;
  const scrollViewRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (screen !== 'results') {
      return;
    }

    const timeout = setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }, 50);

    return () => clearTimeout(timeout);
  }, [screen]);

  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [playReferenceOnNextRender, setPlayReferenceOnNextRender] =
    useState(false);
  const [activeGuideNoteIndex, setActiveGuideNoteIndex] =
    useState<number | null>(null);
  const guideNoteDurationSeconds = Math.max(
    0.05,
    exerciseConfig.sequence.notes[0]?.durationSec ??
      exerciseConfig.noteDurationSec,
  );
  const guideBeatDurationSeconds =
    guideNoteDurationSeconds + REFERENCE_NOTE_GAP_SECONDS;
  const recordingBeatPosition =
    guideBeatDurationSeconds > 0
      ? elapsedSeconds % guideBeatDurationSeconds
      : 0;
  const recordingSequenceDurationSeconds =
    exerciseConfig.sequence.names.length * guideBeatDurationSeconds;
  const currentGuideNoteIndex =
    screen === 'recording' &&
    exerciseConfig.sequence.names.length > 0 &&
    elapsedSeconds < recordingSequenceDurationSeconds
      ? recordingBeatPosition < guideNoteDurationSeconds
        ? Math.floor(elapsedSeconds / guideBeatDurationSeconds)
        : null
      : screen === 'listening'
        ? activeGuideNoteIndex
        : null;

  const recordingDurationSeconds = Math.min(
    MAX_RECORDING_SECONDS,
    Math.max(2, recordingSequenceDurationSeconds + 0.75),
  );

  const [currentRepetition, setCurrentRepetition] = useState(1);
  const [attemptResults, setAttemptResults] = useState<AttemptResult[]>([]);
  const [liveTransitionCount, setLiveTransitionCount] = useState(0);
  const [liveTransitionSpeed, setLiveTransitionSpeed] = useState(0);
  const [livePitch, setLivePitch] = useState<LiveState>({
    pitch: 0,
    note: '--',
    clarity: 0,
  });
  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const mountedRef = useRef(true);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const previousPitchRef = useRef(0);
  const transitionCountRef = useRef(0);
  const finishingRef = useRef(false);
  const recordingStopHandledRef = useRef(false);
  const playingSequenceRef = useRef(false);
  const referenceStartedRef = useRef(false);
  const attemptResultsRef = useRef<AttemptResult[]>([]);

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

  const resetLiveState = useCallback(() => {
    previousPitchRef.current = 0;
    transitionCountRef.current = 0;
    recordingStartRef.current = null;
    finishingRef.current = false;
    setLiveTransitionCount(0);
    setLiveTransitionSpeed(0);
    setElapsedSeconds(0);
    setActiveGuideNoteIndex(null);
    setLivePitch({ pitch: 0, note: '--', clarity: 0 });
  }, []);

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (!mountedRef.current || screenRef.current !== 'recording') {
      return;
    }

    setLivePitch({
      pitch: frame.pitch,
      note: frame.note || '--',
      clarity: frame.clarity,
    });

    if (!Number.isFinite(frame.pitch) || frame.pitch <= 0) {
      return;
    }

    const previousPitch = previousPitchRef.current;

    if (previousPitch > 0 && Number.isFinite(previousPitch)) {
      const semitoneChange = 12 * Math.log2(frame.pitch / previousPitch);

      if (Number.isFinite(semitoneChange) && Math.abs(semitoneChange) >= 1) {
        transitionCountRef.current += 1;
        setLiveTransitionCount(transitionCountRef.current);
      }
    }

    previousPitchRef.current = frame.pitch;

    if (recordingStartRef.current !== null) {
      const elapsed = (Date.now() - recordingStartRef.current) / 1000;

      if (elapsed > 0) {
        setLiveTransitionSpeed(transitionCountRef.current / elapsed);
      }
    }
  }, []);

  const handleRecordingStop = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      if (
        screenRef.current !== 'recording' ||
        recordingStopHandledRef.current
      ) {
        return;
      }

      recordingStopHandledRef.current = true;
      clearTimers();

      if (!mountedRef.current) {
        return;
      }

      setScreen('processing');

      let attempt: AttemptResult;

      try {
        if (!samples?.length) {
          throw new Error('No audio samples were recorded.');
        }

        if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
          throw new Error('The recording has an invalid sample rate.');
        }

        const measurement = measureRapidNoteTransition(
          samples,
          sampleRate,
          exerciseConfig.sequence.frequencies,
        );

        if (
          measurement.detectedPitches.length < 2 ||
          measurement.detectedNotes.length < 2 ||
          measurement.transitionCount < 1
        ) {
          throw new Error('Not enough clear note transitions were detected.');
        }

        const scored = scoreRapidNoteTransition(
          measurement,
          exerciseConfig.targetSpeed,
          exerciseConfig.accuracyThreshold,
        );

        attempt = {
          repetition: currentRepetition,
          overall: clampScore(scored.overall),
          pitchScore: clampScore(scored.pitchScore),
          sequenceScore: clampScore(scored.sequenceScore),
          speedScore: clampScore(scored.speedScore),
          passed: scored.passed,
          feedback: scored.feedback,
          transitionCount: measurement.transitionCount,
          transitionsPerSecond: measurement.transitionsPerSecond,
          averageTransitionTimeMs: measurement.averageTransitionTimeMs,
        };
      } catch (error) {
        console.log(
          'Rapid Note Transition attempt could not be scored:',
          error instanceof Error ? error.message : String(error),
        );
        attempt = createFailedAttempt(currentRepetition);
      }

      const updatedAttempts = [...attemptResultsRef.current, attempt];
      attemptResultsRef.current = updatedAttempts;
      setAttemptResults(updatedAttempts);

      if (!mountedRef.current) {
        return;
      }

      if (currentRepetition < exerciseConfig.repetitions) {
        setCurrentRepetition(currentRepetition + 1);
        resetLiveState();
        referenceStartedRef.current = false;
        playingSequenceRef.current = false;
        setErrorMessage('');
        setPlayReferenceOnNextRender(true);
        return;
      }

      const hasFailedAttempt = updatedAttempts.some(
        item => item.feedback === createFailedAttempt(item.repetition).feedback,
      );
      const finalResult = buildExerciseResult(
        updatedAttempts,
        exerciseConfig.accuracyThreshold,
        hasFailedAttempt,
      );

      setResult(finalResult);

      try {
        await saveCompletedExercise(
          'agility',
          'rapidNoteTransition',
          tier,
          finalResult.overall,
        );
      } catch (error) {
        console.error('Failed to save exercise result:', error);
      }

      if (mountedRef.current) {
        setScreen('results');
      }
    },
    [
      clearTimers,
      currentRepetition,
      exerciseConfig.accuracyThreshold,
      exerciseConfig.repetitions,
      exerciseConfig.sequence.frequencies,
      exerciseConfig.targetSpeed,
      resetLiveState,
      setScreen,
      tier,
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
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (confirmation !== null || screenRef.current === 'processing') {
          return true;
        }

        pausedRepetitionRef.current = currentRepetition;
        pausedScreenRef.current = screenRef.current;
        clearTimers();
        referenceStartedRef.current = false;
        playingSequenceRef.current = false;
        setActiveGuideNoteIndex(null);

        if (screenRef.current === 'recording') {
          setScreen('instructions');
          void stopRecording();
          resetLiveState();
        } else if (
          screenRef.current === 'countdown' ||
          screenRef.current === 'listening'
        ) {
          setScreen('instructions');
          setCountdown(COUNTDOWN_SECONDS);
        }

        setConfirmation('quit');
        return true;
      },
    );

    return () => subscription.remove();
  }, [
    confirmation,
    currentRepetition,
    clearTimers,
    resetLiveState,
    setScreen,
    stopRecording,
  ]);

  const startStaffGuidePlayback = useCallback(async () => {
    const noteCount = exerciseConfig.sequence.names.length;

    if (noteCount === 0) {
      setActiveGuideNoteIndex(null);
      return;
    }

    for (let index = 0; index < noteCount; index += 1) {
      if (
        !mountedRef.current ||
        screenRef.current !== 'listening'
      ) {
        setActiveGuideNoteIndex(null);
        return;
      }

      setActiveGuideNoteIndex(index);

      await new Promise<void>(resolve =>
        setTimeout(resolve, guideNoteDurationSeconds * 1000),
      );

      if (
        !mountedRef.current ||
        screenRef.current !== 'listening'
      ) {
        setActiveGuideNoteIndex(null);
        return;
      }

      setActiveGuideNoteIndex(null);

      if (index < noteCount - 1 && REFERENCE_NOTE_GAP_SECONDS > 0) {
        await new Promise<void>(resolve =>
          setTimeout(resolve, REFERENCE_NOTE_GAP_SECONDS * 1000),
        );
      }
    }

    setActiveGuideNoteIndex(null);
  }, [
    exerciseConfig.sequence.names.length,
    guideNoteDurationSeconds,
  ]);

  const playReferenceSequence = useCallback(async () => {
    if (playingSequenceRef.current || referenceStartedRef.current) {
      return;
    }

    referenceStartedRef.current = true;
    playingSequenceRef.current = true;
    clearTimers();

    try {
      if (!mountedRef.current) {
        return;
      }

      resetLiveState();
      setScreen('listening');

      await Promise.all([
        playNoteSequence(
          exerciseConfig.sequence.notes,
          REFERENCE_NOTE_GAP_SECONDS,
        ),
        startStaffGuidePlayback(),
      ]);

      if (!mountedRef.current) {
        return;
      }

      setActiveGuideNoteIndex(null);
      setCountdown(COUNTDOWN_SECONDS);
      setScreen('countdown');
    } catch (error) {
      console.error('Reference playback failed:', error);

      if (!mountedRef.current) {
        return;
      }

      clearTimers();
      setActiveGuideNoteIndex(null);
      setErrorMessage(
        'The reference sequence could not be played. Please try again.',
      );
      setScreen('instructions');
    } finally {
      playingSequenceRef.current = false;
    }
  }, [
    clearTimers,
    exerciseConfig.sequence.notes,
    resetLiveState,
    setScreen,
    startStaffGuidePlayback,
  ]);

  const startRecordingExercise = useCallback(async () => {
    try {
      if (!mountedRef.current) {
        return;
      }

      recordingStopHandledRef.current = false;
      setScreen('recording');
      await startRecording();

      if (!mountedRef.current) {
        return;
      }

      recordingStartRef.current = Date.now();
      setElapsedSeconds(0);

      let elapsed = 0;

      recordingTimerRef.current = setInterval(() => {
        if (!mountedRef.current) {
          return;
        }

        elapsed += 0.1;
        setElapsedSeconds(Math.min(elapsed, recordingDurationSeconds));

        if (elapsed >= recordingDurationSeconds) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }

          if (!finishingRef.current) {
            finishingRef.current = true;
            void stopRecording();
          }
        }
      }, 100);
    } catch (error) {
      console.error('Could not start recording:', error);

      if (!mountedRef.current) {
        return;
      }

      clearTimers();
      setErrorMessage(
        'The microphone could not be started. Check microphone permission and try again.',
      );
      setScreen('instructions');
    }
  }, [
    clearTimers,
    recordingDurationSeconds,
    setScreen,
    startRecording,
    stopRecording,
  ]);

  useEffect(() => {
    if (!playReferenceOnNextRender) {
      return;
    }

    setPlayReferenceOnNextRender(false);
    void playReferenceSequence();
  }, [playReferenceOnNextRender, playReferenceSequence]);

  useEffect(() => {
    if (screen !== 'countdown') {
      return;
    }

    clearTimers();
    setCountdown(COUNTDOWN_SECONDS);

    let remaining = COUNTDOWN_SECONDS;

    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;

      if (!mountedRef.current) {
        return;
      }

      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }

      clearTimers();
      setCountdown(0);
      void startRecordingExercise();
    }, 1000);

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [screen, clearTimers, startRecordingExercise]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearTimers();
      void disposeNotePlayer();
      void stopRecording();
    };
  }, [clearTimers, stopRecording]);

  const startExercise = useCallback(() => {
    if (
      screenRef.current !== 'instructions' ||
      isLoadingAdaptiveParams
    ) {
      return;
    }

    clearTimers();
    resetLiveState();
    attemptResultsRef.current = [];
    setAttemptResults([]);
    referenceStartedRef.current = false;
    playingSequenceRef.current = false;
    setCurrentRepetition(1);
    setResult(null);
    setErrorMessage('');
    setPlayReferenceOnNextRender(false);
    setCountdown(COUNTDOWN_SECONDS);
    void playReferenceSequence();
  }, [
    clearTimers,
    isLoadingAdaptiveParams,
    playReferenceSequence,
    resetLiveState,
  ]);

  const finishRecording = useCallback(async () => {
    if (
      finishingRef.current ||
      !isRecording ||
      screenRef.current !== 'recording'
    ) {
      return;
    }

    finishingRef.current = true;
    clearTimers();

    try {
      await stopRecording();
    } catch (error) {
      console.error('Failed to stop recording:', error);

      if (!mountedRef.current) {
        return;
      }

      setErrorMessage(
        'We could not stop the recording. Please restart the exercise.',
      );
      setScreen('instructions');
    }
  }, [clearTimers, isRecording, setScreen, stopRecording]);

  const retryExercise = useCallback(() => {
    clearTimers();
    resetLiveState();
    attemptResultsRef.current = [];
    setAttemptResults([]);
    referenceStartedRef.current = false;
    playingSequenceRef.current = false;
    setCurrentRepetition(1);
    setResult(null);
    setErrorMessage('');
    setPlayReferenceOnNextRender(false);
    setExerciseConfigVersion(version => version + 1);
    setCountdown(COUNTDOWN_SECONDS);
    setScreen('instructions');
  }, [clearTimers, resetLiveState, setScreen]);

  const renderRepetitionProgress = () => (
    <View style={styles.repetitionProgressCard}>
      <View style={styles.repetitionProgressHeader}>
        <Text style={styles.repetitionProgressLabel}>REPETITION</Text>
        <Text style={styles.repetitionProgressCount}>
          {currentRepetition} OF {exerciseConfig.repetitions}
        </Text>
      </View>
    </View>
  );

  const closeConfirmation = () => {
    const action = confirmation;
    setConfirmation(null);

    if (
      action === 'quit' &&
      pausedScreenRef.current !== 'instructions' &&
      pausedScreenRef.current !== 'results'
    ) {
      setCurrentRepetition(pausedRepetitionRef.current);
      setElapsedSeconds(0);
      setCountdown(COUNTDOWN_SECONDS);
      resetLiveState();
      referenceStartedRef.current = false;
      playingSequenceRef.current = false;
      setIsPreparingResume(true);

      setTimeout(() => {
        if (!mountedRef.current) {
          return;
        }

        setIsPreparingResume(false);
        setPlayReferenceOnNextRender(true);
      }, 900);
    }
  };

  const renderInstructions = () => (
    <View style={styles.content}>
      <Pressable
        style={styles.backButton}
        onPress={() => setConfirmation('quit')}
        hitSlop={10}
      >
        <Ionicons name="arrow-back" size={24} color={BROWN} />
      </Pressable>

      <View style={styles.iconCircle}>
        <Ionicons name="flash-outline" size={34} color={BROWN} />
      </View>

      <Text style={styles.title}>Rapid Note Transition</Text>
      <Text style={styles.subtitle}>VOCAL AGILITY</Text>

      <View style={styles.instructionCard}>
        <Text style={[styles.cardTitle, { marginTop: 14 }]}>
          Exercise Instructions
        </Text>

        {[
          'Listen carefully to the reference sequence.',
          'Sing the same notes in the same order.',
          'Move quickly and smoothly between each note.',
          'Focus on maintaining accurate pitch throughout the sequence.',
        ].map(item => (
          <View key={item} style={styles.prepareItem}>
            <Text style={styles.prepareText}>{item}</Text>
          </View>
        ))}

        <View style={styles.prepareCard}>
          <View style={styles.prepareHeader}>
            <Ionicons
              name="information-circle-outline"
              size={21}
              color={BROWN}
            />
            <Text style={styles.prepareTitle}>Before You Begin</Text>
          </View>

          {[
            {
              icon: 'volume-mute-outline' as const,
              text: 'Find a quiet area with minimal background noise.',
            },
            {
              icon: 'body-outline' as const,
              text: 'Stand or sit upright with your shoulders relaxed.',
            },
            {
              icon: 'mic-outline' as const,
              text: 'Keep a comfortable distance from the microphone while singing.',
            },
          ].map(item => (
            <View key={item.text} style={styles.prepareItem}>
              <Ionicons name={item.icon} size={17} color={BROWN} />
              <Text style={styles.prepareText}>{item.text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.cardTitle}>Exercise Details</Text>

        <DetailRow
          label="Difficulty"
          value={tier.charAt(0).toUpperCase() + tier.slice(1)}
        />
        <DetailRow
          label="Notes"
          value={String(exerciseConfig.noteCount)}
        />
        <DetailRow
          label="Pitch Range"
          value={
            assessedVocalRangeHz
              ? `${assessedVocalRangeHz.lowHz.toFixed(0)} → ${assessedVocalRangeHz.highHz.toFixed(0)} Hz (assessment)`
              : 'Tier pitch range (assessment unavailable)'
          }
        />
        <DetailRow
          label="Target Speed"
          value={`${exerciseConfig.targetSpeed.toFixed(1)} notes/sec`}
        />
        <DetailRow
          label="Repetitions"
          value={String(exerciseConfig.repetitions)}
        />
        <DetailRow
          label="Accuracy Goal"
          value={`${exerciseConfig.accuracyThreshold}%`}
        />
      </View>

      {errorMessage ? (
        <View style={styles.errorCard}>
          <Ionicons
            name="alert-circle-outline"
            size={18}
            color={BROWN}
          />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <View style={styles.tipCard}>
        <Ionicons name="bulb-outline" size={19} color={BROWN} />
        <Text style={styles.tipText}>
          Coach tip: sing each note clearly, then connect them smoothly.
          Accuracy comes first; speed will follow!
        </Text>
      </View>

      <Pressable
        style={styles.startButton}
        onPress={startExercise}
        disabled={isLoadingAdaptiveParams}
      >
        {isLoadingAdaptiveParams ? (
          <ActivityIndicator size="small" color={WHITE} />
        ) : (
          <Ionicons name="play" size={18} color={WHITE} />
        )}
        <Text style={styles.startButtonText}>
          {isLoadingAdaptiveParams ? 'Preparing Exercise...' : 'Start Exercise'}
        </Text>
      </Pressable>
    </View>
  );

  const renderCountdown = () => (
    <View style={styles.countdownScreen}>
      <View style={styles.countdownIconCircle}>
        <Ionicons name="flash-outline" size={34} color={BROWN} />
      </View>
      <Text style={styles.countdownTitle}>Get Ready</Text>
      <Text style={styles.countdownNumber}>{countdown}</Text>
      <Text style={styles.countdownSubtitle}>
        Prepare for repetition {currentRepetition} of {exerciseConfig.repetitions}.
      </Text>
    </View>
  );

  const renderListening = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons name="musical-notes-outline" size={34} color={BROWN} />
      </View>
      <Text style={styles.phaseTitle}>Listen to the Sequence</Text>
      {renderRepetitionProgress()}
      <Text style={styles.phaseSubtitle}>
        Listen for the pitch and order. After the reference finishes, a
        3-second countdown gives you time to prepare.
      </Text>
      <StaffSequenceGuide
        names={exerciseConfig.sequence.names}
        activeIndex={currentGuideNoteIndex}
        caption="Watch the pink highlight follow each sounding note. The countdown begins after the sequence ends."
      />
      <ActivityIndicator
        size="small"
        color={BROWN}
        style={{ marginTop: 20 }}
      />
      <Text style={styles.phaseSubtitle}>
        Listen carefully; the countdown starts after all reference notes finish.
      </Text>
    </View>
  );

  const renderRecording = () => {
    const progress = Math.min(elapsedSeconds / recordingDurationSeconds, 1);

    return (
      <View style={styles.recordingContent}>
        <View style={styles.recordingIcon}>
          <Ionicons name="mic" size={34} color={BROWN} />
        </View>
        <Text style={styles.recordingTitle}>Sing the Sequence</Text>
        {renderRepetitionProgress()}

        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingBadgeText}>RECORDING</Text>
        </View>

        <StaffSequenceGuide
          names={exerciseConfig.sequence.names}
          activeIndex={currentGuideNoteIndex}
          liveNote={livePitch.note}
          showFeedback
          caption="Follow the highlighted note as you sing. Green means correct, yellow means close, and red means off pitch."
        />

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>CURRENT NOTE</Text>
          <Text style={styles.liveCurrentNote}>{livePitch.note}</Text>
          <Text style={styles.liveFrequency}>
            {livePitch.pitch > 0 ? `${livePitch.pitch.toFixed(1)} Hz` : '--'}
          </Text>
        </View>

        <Text style={styles.timerText}>
          Recording Time: {elapsedSeconds.toFixed(1)}s /{' '}
          {recordingDurationSeconds.toFixed(1)}s
        </Text>
        <View style={styles.timerTrack}>
          <View style={[styles.timerFill, { width: `${progress * 100}%` }]} />
        </View>

      </View>
    );
  };

  const renderProcessing = () => (
    <View style={styles.analyzingScreen}>
      <View style={styles.analyzingIconCircle}>
        <ActivityIndicator size="large" color={BROWN} />
      </View>
      <Text style={styles.analyzingTitle}>Analyzing Your Singing</Text>
      <Text style={styles.analyzingSubtitle}>
        Measuring note transitions, speed, sequence accuracy, and pitch
        accuracy.
      </Text>
    </View>
  );

  const renderResults = () => {
    if (!result) {
      return null;
    }

    return (
      <View style={styles.resultsContent}>
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
          Rapid Note Transition Result
        </Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>AVERAGE OVERALL SCORE</Text>
          <Text style={styles.scoreValue}>{result.overall}</Text>
          <Text style={styles.scoreDescription}>
            out of 100 · {result.attempts.length} of{' '}
            {exerciseConfig.repetitions} repetitions completed
          </Text>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>Repetition Scores</Text>
          {result.attempts.map((attempt, index) => (
            <View
              key={`attempt-${attempt.repetition}`}
              style={[
                styles.attemptRow,
                index === result.attempts.length - 1 &&
                  styles.attemptRowLast,
              ]}
            >
              <View style={styles.attemptTextGroup}>
                <Text style={styles.attemptTitle}>
                  Repetition {attempt.repetition}
                </Text>
                <Text style={styles.attemptSubtitle}>
                  Pitch {Math.round(attempt.pitchScore)}% · Sequence{' '}
                  {Math.round(attempt.sequenceScore)}% · Speed{' '}
                  {Math.round(attempt.speedScore)}%
                </Text>
              </View>
              <Text style={styles.attemptScore}>
                {Math.round(attempt.overall)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Average Performance Breakdown
          </Text>
          <ScoreBar label="Pitch Accuracy" value={result.pitchScore} />
          <ScoreBar label="Sequence Accuracy" value={result.sequenceScore} />
          <ScoreBar
            label="Transition Speed"
            value={result.speedScore}
            last
          />
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Average Performance Metrics
          </Text>
          <MetricRow
            label="Transitions per attempt"
            value={String(result.transitionCount)}
          />
          <MetricRow
            label="Transitions/sec"
            value={result.transitionsPerSecond.toFixed(1)}
          />
          <MetricRow
            label="Average Transition Time"
            value={`${result.averageTransitionTimeMs.toFixed(0)} ms`}
            last
          />
        </View>

        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={20} color={BROWN} />
          <Text style={styles.tipText}>{result.feedback}</Text>
        </View>

        <Pressable style={styles.startButton} onPress={() => setConfirmation('tryAgain')}>
          <Ionicons name="refresh" size={18} color={WHITE} />
          <Text style={styles.startButtonText}>Try Again</Text>
        </Pressable>

        <Pressable
          style={styles.doneButton}
          onPress={() => setConfirmation('quit')}
        >
          <Text style={styles.doneButtonText}>Back to Exercises</Text>
        </Pressable>
      </View>
    );
  };

  if (isLoadingAdaptiveParams) {
    return (
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons name="options-outline" size={44} color={BROWN} />
        </View>
        <Text style={styles.preparingTitle}>Preparing Your Exercise</Text>
        <Text style={styles.preparingSubtitle}>
          Adjusting the exercise to your current difficulty level and preparing
          your vocal range.
        </Text>
        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  }

  if (isPreparingResume) {
    return (
      <View style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons name="musical-notes-outline" size={44} color={BROWN} />
        </View>
        <Text style={styles.preparingTitle}>Preparing Your Repetition</Text>
        <Text style={styles.preparingSubtitle}>
          Getting your reference notes ready. Your completed repetitions are preserved.
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
        ref={scrollViewRef}
        style={styles.screen}
        contentContainerStyle={screen === 'results' ? styles.resultsWrapper : undefined}
        showsVerticalScrollIndicator={false}
      >
        {screen === 'instructions' && renderInstructions()}
        {screen === 'countdown' && renderCountdown()}
        {screen === 'listening' && renderListening()}
        {screen === 'recording' && renderRecording()}
        {screen === 'processing' && renderProcessing()}
        {screen === 'results' && renderResults()}
      </ScrollView>

      <Modal
        visible={confirmation !== null}
        transparent
        animationType="fade"
        onRequestClose={closeConfirmation}
        statusBarTranslucent
      >
        <View style={styles.confirmationOverlay}>
          <View style={styles.confirmationCard}>
            <View style={styles.confirmationIconCircle}>
              <Ionicons
                name={confirmation === 'tryAgain' ? 'refresh' : 'log-out-outline'}
                size={24}
                color={BROWN}
              />
            </View>
            <Text style={styles.confirmationTitle}>
              {confirmation === 'tryAgain' ? 'Try again?' : 'Quit exercise?'}
            </Text>
            <Text style={styles.confirmationMessage}>
              {confirmation === 'tryAgain'
                ? 'Are you sure you want to repeat this exercise?'
                : 'Are you sure you want to leave this exercise?'}
            </Text>
            <View style={styles.confirmationActions}>
              <Pressable
                style={styles.confirmationPrimaryButton}
                onPress={closeConfirmation}
                accessibilityRole="button"
              >
                <Text style={styles.confirmationPrimaryText}>Continue Exercise</Text>
              </Pressable>
              <Pressable
                style={styles.confirmationSecondaryButton}
                onPress={() => {
                  const action = confirmation;
                  setConfirmation(null);
                  if (action === 'tryAgain') {
                    retryExercise();
                  } else if (action === 'quit') {
                    router.replace('/exercises/agility');
                  }
                }}
                accessibilityRole="button"
              >
                <Text style={styles.confirmationSecondaryText}>
                  {confirmation === 'tryAgain' ? 'Try Again' : 'Quit Exercise'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function StaffSequenceGuide({
  names,
  caption = 'Follow the notes from left to right',
  activeIndex = null,
  liveNote,
  showFeedback = false,
}: {
  names: string[];
  caption?: string;
  activeIndex?: number | null;
  liveNote?: string;
  showFeedback?: boolean;
}) {
  const noteToStep = (name: string) => {
    const match = name.match(/^([A-G])(#|b)?(-?\d+)$/i);

    if (!match) {
      return 2;
    }

    const letter = match[1].toUpperCase();
    const octave = Number(match[3]);
    const steps: Record<string, number> = {
      C: 0,
      D: 1,
      E: 2,
      F: 3,
      G: 4,
      A: 5,
      B: 6,
    };

    return (octave - 4) * 7 + steps[letter];
  };

  const stepValues = names.map(noteToStep);
  const minStep = Math.min(...stepValues, 0);
  const maxStep = Math.max(...stepValues, 4);
  const range = Math.max(4, maxStep - minStep);
  const itemWidth = 38;
  const staffWidth = Math.max(210, names.length * itemWidth + 42);

  return (
    <View style={styles.staffGuideCard}>
      <View style={styles.staffGuideHeading}>
        <Ionicons
          name="musical-notes-outline"
          size={18}
          color={BROWN}
        />
        <Text style={styles.staffGuideTitle}>Your note path</Text>
      </View>
      <Text style={styles.staffGuideCaption}>{caption}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.staffScrollContent}
      >
        <View style={[styles.staffCanvas, { width: staffWidth }]}>
          {[0, 1, 2, 3, 4].map(line => (
            <View
              key={`staff-line-${line}`}
              style={[styles.staffLine, { top: 12 + line * 10 }]}
            />
          ))}

          <View style={styles.staffTreble}>
            <Text style={styles.trebleClef}>𝄞</Text>
          </View>

          {names.map((name, index) => {
            const normalized = (stepValues[index] - minStep) / range;
            const top = 48 - normalized * 34;
            const left = 34 + index * itemWidth;
            const isActive = activeIndex === index;
            const feedbackColor =
              isActive && showFeedback
                ? getGuideFeedbackColor(name, liveNote)
                : null;
            const isReferenceActive = isActive && !showFeedback;
            const noteColor =
              feedbackColor ??
              (isReferenceActive ? ACTIVE_REFERENCE_PINK : BROWN);

            return (
              <View key={`${name}-${index}`}>
                <View
                  style={[
                    styles.staffNoteHalo,
                    isActive
                      ? {
                          backgroundColor: isReferenceActive ? '#FFE1E9' : PINK,
                          borderColor: isReferenceActive
                            ? ACTIVE_REFERENCE_PINK
                            : feedbackColor ?? '#D68DA0',
                          borderWidth: 2,
                        }
                      : styles.staffNoteHaloInactive,
                    { left: left - 5, top: top - 5 },
                  ]}
                />
                <View
                  style={[
                    styles.staffNoteHead,
                    {
                      left,
                      top,
                      backgroundColor: noteColor,
                      borderColor: noteColor,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.staffNoteStem,
                    {
                      left: left + 9,
                      top: top - 15,
                      backgroundColor: noteColor,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.staffNoteNumber,
                    {
                      left: left - 5,
                      color: isActive ? noteColor : MUTED,
                    },
                  ]}
                >
                  {index + 1}
                </Text>
                <Text
                  style={[
                    styles.staffNoteName,
                    {
                      left: left - 10,
                      color: isActive ? noteColor : BROWN,
                    },
                  ]}
                >
                  {name}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.staffLegend}>
        {[
          { color: PINK, label: 'Highlighted note = sing this now', border: true },
          { color: GUIDE_GREEN, label: 'Correct' },
          { color: GUIDE_YELLOW, label: 'Close' },
          { color: GUIDE_RED, label: 'Off pitch' },
        ].map(item => (
          <View key={item.label} style={styles.staffLegendItem}>
            <View
              style={[
                styles.staffLegendDot,
                {
                  backgroundColor: item.color,
                  borderColor: item.border ? '#D68DA0' : item.color,
                  borderWidth: item.border ? 1 : 0,
                },
              ]}
            />
            <Text style={styles.staffLegendText}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ScoreBar({
  label,
  value,
  last = false,
}: {
  label: string;
  value: number;
  last?: boolean;
}) {
  const safeValue = clampScore(value);

  return (
    <View style={last ? styles.scoreRowLast : styles.scoreRow}>
      <View style={styles.scoreRowHeader}>
        <Text style={styles.scoreRowLabel}>{label}</Text>
        <Text style={styles.scoreRowValue}>{Math.round(safeValue)}%</Text>
      </View>
      <View style={styles.progressBackground}>
        <View
          style={[
            styles.progressFill,
            { width: `${safeValue}%` },
          ]}
        />
      </View>
    </View>
  );
}

function MetricRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.metricRow, last && styles.metricRowLast]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
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
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 78,
    paddingBottom: 36,
    alignItems: 'center',
  },
  resultsContent: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 78,
    paddingBottom: 32,
    alignItems: 'center',
  },
  resultsWrapper: {
    flexGrow: 1,
    width: '100%',
  },
  backButton: {
    position: 'absolute',
    top: 42,
    left: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    color: BROWN,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
    marginTop: 3,
    marginBottom: 18,
  },
  instructionCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 26,
    padding: 18,
    borderWidth: 1.2,
    borderColor: BORDER,
  },
  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 20,
    padding: 15,
    marginTop: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  prepareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  prepareTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
    marginLeft: 9,
  },
  prepareItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 10,
  },
  prepareText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 19,
    color: BROWN,
    marginLeft: 9,
  },
  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
    marginTop: 10,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  detailLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },
  detailValue: {
    flex: 1,
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'right',
    marginLeft: 16,
  },
  errorCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  errorText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 9,
  },
  startButton: {
    width: '100%',
    height: 58,
    borderRadius: 29,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },
  staffGuideCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 10,
    paddingHorizontal: 11,
    marginTop: 10,
  },
  staffGuideHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  staffGuideTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
  staffGuideCaption: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
    marginTop: 4,
  },
  staffScrollContent: {
    flexGrow: 1,
    minWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 2,
  },
  staffCanvas: {
    height: 86,
    marginTop: 2,
    alignSelf: 'center',
  },
  staffLine: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: '#F3C5D2',
  },
  staffTreble: {
    position: 'absolute',
    left: 0,
    top: 3,
    width: 24,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  trebleClef: {
    fontSize: 32,
    lineHeight: 38,
    color: BROWN,
    fontFamily: 'serif',
    includeFontPadding: false,
  },
  staffNoteHalo: {
    position: 'absolute',
    width: 23,
    height: 18,
    borderRadius: 10,
    borderWidth: 2,
    zIndex: 0,
  },
  staffNoteHaloInactive: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidth: 0,
  },
  staffNoteHead: {
    position: 'absolute',
    width: 12,
    height: 8,
    borderRadius: 6,
    borderWidth: 1,
    transform: [{ rotate: '-20deg' }],
    zIndex: 1,
  },
  staffNoteStem: {
    position: 'absolute',
    width: 1.5,
    height: 18,
    zIndex: 1,
  },
  staffNoteNumber: {
    position: 'absolute',
    top: 57,
    width: 24,
    textAlign: 'center',
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  staffNoteName: {
    position: 'absolute',
    top: 70,
    width: 32,
    textAlign: 'center',
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
  },
  staffLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 6,
  },
  staffLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  staffLegendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: BROWN,
  },
  staffLegendText: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
  repetitionProgressCard: {
    width: '100%',
    maxWidth: 340,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: LIGHT_PINK,
  },
  repetitionProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  repetitionProgressLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    letterSpacing: 0.7,
    color: MUTED,
    marginBottom: -10,
  },
  repetitionProgressCount: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginBottom: -10,
  },
  countdownScreen: {
    flexGrow: 1,
    minHeight: 700,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  countdownIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  countdownTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
    marginTop: 20,
  },
  countdownSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },
  countdownNumber: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
  },
  centerScreen: {
    flexGrow: 1,
    minHeight: 620,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  analyzingScreen: {
    flexGrow: 1,
    minHeight: 700,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  analyzingIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  analyzingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
    marginTop: 20,
  },
  analyzingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },
  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
    marginTop: 16,
  },
  phaseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 22,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },
  recordingContent: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 120,
    paddingBottom: 24,
    alignItems: 'center',
  },
  recordingIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  recordingBadge: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: BORDER,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BROWN,
    marginRight: 7,
  },
  recordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: BROWN,
  },
  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 6,
  },
  timerTrack: {
    width: '100%',
    height: 8,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 5,
    overflow: 'hidden',
  },
  timerFill: {
    height: '100%',
    backgroundColor: PINK,
  },
  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 16,
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
    marginTop: 2,
  },
  liveFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
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
    borderRadius: 26,
    padding: 24,
    alignItems: 'center',
  },
  scoreLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
    textAlign: 'center',
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
  attemptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  attemptRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  attemptTextGroup: {
    flex: 1,
    paddingRight: 12,
  },
  attemptTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },
  attemptSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 4,
    lineHeight: 15,
  },
  attemptScore: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
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
  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 20,
    padding: 16,
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
  doneButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  doneButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
  confirmationOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  confirmationCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: WHITE,
  },
  confirmationIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
    marginBottom: 15,
  },
  confirmationTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
    textAlign: 'center',
  },
  confirmationMessage: {
    marginTop: 10,
    marginBottom: 23,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: MUTED,
    textAlign: 'center',
  },
  confirmationActions: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  confirmationPrimaryButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: PINK,
  },
  confirmationPrimaryText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
  confirmationSecondaryButton: {
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
  confirmationSecondaryText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
});