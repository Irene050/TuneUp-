import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
  EXERCISE_MAX_RECORDING_SECONDS,
} from '@/constants/appConstants';
import {
  RAPID_NOTE_TRANSITION_PARAMS,
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
  ExerciseNoAudioModal,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseQuitModal,
  ExerciseRecordingScreen,
  ExerciseResultsScreen
} from '@/screens/exercises/ExerciseScreen';
import { generateRapidNoteTransitionParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureRapidNoteTransition } from '@/services/measurement/agility/rapidNoteTransitionExercise';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreRapidNoteTransition } from '@/services/scoring/agility/rapidNoteTransitionExercise';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { average, clampScore } from '@/utils/math';
import {
  disposeNotePlayer,
  playNoteSequence,
  type NoteToPlay,
} from '@/utils/music/notePlayer';
import {
  createMusicalNote,
  frequencyToMidi,
} from '@/utils/music/notes';

const REFERENCE_NOTE_GAP_SECONDS = 0.08;

type Phase =
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

        const exerciseRecords = await fetchExerciseRecords(
          user.uid,
          'agility',
        );

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
        Math.min(
          baseParams.repetitions,
          Math.round(adaptiveParams.repetitions),
        ),
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

  const [screenState, setScreenState] = useState<Phase>('instructions');
  const [confirmation, setConfirmation] = useState<'tryAgain' | 'quit' | null>(
    null,
  );
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const [isPreparingResume, setIsPreparingResume] = useState(false);

  const pausedRepetitionRef = useRef(1);
  const pausedScreenRef = useRef<Phase>('instructions');
  const screenRef = useRef<Phase>('instructions');

  const setScreen = useCallback((nextScreen: Phase) => {
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

  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeGuideNoteIndex, setActiveGuideNoteIndex] =
    useState<number | null>(null);
  const [isPlayingReference, setIsPlayingReference] = useState(false);

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
    EXERCISE_MAX_RECORDING_SECONDS,
    Math.max(2, recordingSequenceDurationSeconds + 0.75),
  );

  const [currentRep, setCurrentRep] = useState(1);
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
      }
    }

    previousPitchRef.current = frame.pitch;

    if (recordingStartRef.current !== null) {
      const elapsed = (Date.now() - recordingStartRef.current) / 1000;

      if (elapsed > 0) {
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

      if (!hasSufficientRecordedSignal(samples)) {
        playingSequenceRef.current = false;
        resetLiveState();
        setScreen('instructions');
        setShowNoAudioModal(true);
        return;
      }

      try {
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
          repetition: currentRep,
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

        attempt = createFailedAttempt(currentRep);
      }

      const updatedAttempts = [...attemptResultsRef.current, attempt];

      attemptResultsRef.current = updatedAttempts;

      if (!mountedRef.current) {
        return;
      }

      if (currentRep < exerciseConfig.repetitions) {
        setCurrentRep(currentRep + 1);
        resetLiveState();
        playingSequenceRef.current = false;
        setErrorMessage('');
        setScreen('listening');
        return;
      }

      const failedAttemptFeedback = createFailedAttempt(1).feedback;
      const hasFailedAttempt = updatedAttempts.some(
        item => item.feedback === failedAttemptFeedback,
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
      currentRep,
      exerciseConfig.accuracyThreshold,
      exerciseConfig.repetitions,
      exerciseConfig.sequence.frequencies,
      exerciseConfig.targetSpeed,
      resetLiveState,
      setScreen,
      tier,
    ],
  );

  const { startRecording, stopRecording, isRecording } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (
          confirmation !== null ||
          screenRef.current === 'processing'
        ) {
          return true;
        }

        pausedRepetitionRef.current = currentRep;
        pausedScreenRef.current = screenRef.current;

        clearTimers();
        playingSequenceRef.current = false;
        setIsPlayingReference(false);
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
          setCountdown(EXERCISE_COUNTDOWN_SECONDS);
        }

        setConfirmation('quit');
        return true;
      },
    );

    return () => subscription.remove();
  }, [
    confirmation,
    currentRep,
    clearTimers,
    resetLiveState,
    setScreen,
    stopRecording,
  ]);

  const playReferenceSequence = useCallback(async () => {
    if (playingSequenceRef.current || screenRef.current !== 'listening') {
      return;
    }

    playingSequenceRef.current = true;
    setIsPlayingReference(true);
    clearTimers();
    setErrorMessage('');

    try {
      if (!mountedRef.current) {
        return;
      }

      await playNoteSequence(
        exerciseConfig.sequence.notes,
        REFERENCE_NOTE_GAP_SECONDS,
        index => {
          if (mountedRef.current && screenRef.current === 'listening') {
            setActiveGuideNoteIndex(index);
          }
        },
        () =>
          mountedRef.current &&
          screenRef.current === 'listening' &&
          playingSequenceRef.current,
      );
    } catch (error) {
      console.error('Reference playback failed:', error);

      if (!mountedRef.current) {
        return;
      }

      setActiveGuideNoteIndex(null);
      setErrorMessage('The reference sequence could not be played. Please try again.');
    } finally {
      playingSequenceRef.current = false;
      if (mountedRef.current) {
        setIsPlayingReference(false);
        setActiveGuideNoteIndex(null);
      }
    }
  }, [
    clearTimers,
    exerciseConfig.sequence.notes,
    setActiveGuideNoteIndex,
  ]);

  const continueFromReference = useCallback(() => {
    if (playingSequenceRef.current || screenRef.current !== 'listening') {
      return;
    }

    setActiveGuideNoteIndex(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setScreen('countdown');
  }, [setScreen]);

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
    if (screen !== 'countdown') {
      return;
    }

    clearTimers();
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);

    let remaining = EXERCISE_COUNTDOWN_SECONDS;

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
    playingSequenceRef.current = false;
    setCurrentRep(1);
    setResult(null);
    setErrorMessage('');
    setActiveGuideNoteIndex(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setScreen('listening');
  }, [
    clearTimers,
    isLoadingAdaptiveParams,
    resetLiveState,
    setScreen,
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
    playingSequenceRef.current = false;
    setCurrentRep(1);
    setResult(null);
    setErrorMessage('');
    setActiveGuideNoteIndex(null);
    setExerciseConfigVersion(version => version + 1);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setScreen('instructions');
  }, [clearTimers, resetLiveState, setScreen]);

  const renderRepetitionProgress = () => (
    <View style={styles.repetitionProgressCard}>
      <View style={styles.repetitionProgressHeader}>
        <Text style={styles.repetitionProgressLabel}>REPETITION</Text>
        <Text style={styles.repetitionProgressCount}>
          {currentRep} OF {exerciseConfig.repetitions}
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
      setCurrentRep(pausedRepetitionRef.current);
      setElapsedSeconds(0);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      resetLiveState();
      playingSequenceRef.current = false;
      setIsPreparingResume(true);

      setTimeout(() => {
        if (!mountedRef.current) {
          return;
        }

        setIsPreparingResume(false);
        setActiveGuideNoteIndex(null);
        setScreen('listening');
      }, 900);
    }
  };

  const redoExerciseRepetition = () => {
    setShowNoAudioModal(false);
    setErrorMessage('');
    playingSequenceRef.current = false;
    resetLiveState();
    setActiveGuideNoteIndex(null);
    setScreen('listening');
  };

  const renderInstructions = () => (
    <ExerciseScreen
      title="Rapid Note Transition"
      category="VOCAL AGILITY"
      icon="flash-outline"
      instructions={
        'Listen carefully to the reference sequence. ' +
        'Sing the same notes in the same order. ' +
        'Move quickly and smoothly between each note. ' +
        'Focus on maintaining accurate pitch throughout the sequence.'
      }
      preparationSteps={[
        {
          icon: 'volume-mute-outline',
          text: 'Find a quiet area with minimal background noise.',
        },
        {
          icon: 'body-outline',
          text: 'Stand or sit upright with your shoulders relaxed.',
        },
        {
          icon: 'mic-outline',
          text: 'Keep a comfortable distance from the microphone while singing.',
        },
      ]}
      summary={[
        {
          label: 'Difficulty',
          value: tier.charAt(0).toUpperCase() + tier.slice(1),
        },
        {
          label: 'Notes',
          value: String(exerciseConfig.noteCount),
        },
        {
          label: 'Pitch Range',
          value: assessedVocalRangeHz
            ? `${assessedVocalRangeHz.lowHz.toFixed(0)} → ${assessedVocalRangeHz.highHz.toFixed(0)} Hz (assessment)`
            : 'Tier pitch range (assessment unavailable)',
        },
        {
          label: 'Target Speed',
          value: `${exerciseConfig.targetSpeed.toFixed(1)} notes/sec`,
        },
        {
          label: 'Repetitions',
          value: String(exerciseConfig.repetitions),
        },
        {
          label: 'Accuracy Goal',
          value: `${exerciseConfig.accuracyThreshold}%`,
        },
      ]}
      tip="Focus on accurate notes first. Increase your speed as your transitions become more consistent."
      tier={tier}
      error={errorMessage}
      startDisabled={isLoadingAdaptiveParams}
      startLabel={
        isLoadingAdaptiveParams ? 'Preparing Exercise...' : 'Start Exercise'
      }
      onBack={() => setConfirmation('quit')}
      onStart={startExercise}
    />
  );

  const renderListening = () => (
    <ExerciseListeningScreen
      icon="musical-notes-outline"
      title="Rapid Note Transition"
      currentRep={currentRep}
      repetitions={exerciseConfig.repetitions}
      promptTitle="Listen to the Reference"
      prompt="Listen to the sequence, then sing the same notes in order. Replay it as often as you need before you begin."
      liveContent={
        <AgilitySequenceGuide
          names={exerciseConfig.sequence.names}
          activeIndex={currentGuideNoteIndex}
          caption="The pink highlight follows the note being played."
        />
      }
      error={errorMessage || null}
      isPlayingReference={isPlayingReference}
      onPlayReference={() => void playReferenceSequence()}
      onContinue={continueFromReference}
      onBack={() => setConfirmation('quit')}
    />
  );

  const renderCountdown = () => (
    <ExerciseCountdownScreen
      icon="flash-outline"
      title="Get Ready"
      currentRep={currentRep}
      repetitions={exerciseConfig.repetitions}
      countdown={countdown}
      promptTitle="Prepare to sing"
      prompt={`Sing the same ${exerciseConfig.sequence.names.length} notes in order, keeping your pitch accurate as you move between notes.`}
      onBack={() => setConfirmation('quit')}
    />
  );

  const renderRecording = () => {
    const progress = Math.min(elapsedSeconds / recordingDurationSeconds, 1);

    return (
      <ExerciseRecordingScreen
        title="Sing the Sequence"
        currentRep={currentRep}
        repetitions={exerciseConfig.repetitions}
        onBack={() => setConfirmation('quit')}
      >
        {renderRepetitionProgress()}

        <AgilitySequenceGuide
          names={exerciseConfig.sequence.names}
          activeIndex={currentGuideNoteIndex}
          liveNote={livePitch.note}
          showFeedback
          caption="Follow the highlighted note as you sing. The note color shows your pitch accuracy."
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

        <Pressable
          style={styles.stopButton}
          onPress={finishRecording}
          disabled={!isRecording}
        >
          <Ionicons name="stop-circle-outline" size={20} color={COLORS.white} />
          <Text style={styles.stopButtonText}>Finish Recording</Text>
        </Pressable>
      </ExerciseRecordingScreen>
    );
  };

  const renderProcessing = () => (
    <ExerciseProcessingScreen
      icon="analytics-outline"
      title="Analyzing Your Singing"
      message="Measuring note transitions, speed, sequence accuracy, and pitch accuracy."
    />
  );

  const renderResults = () => {
    if (!result) {
      return null;
    }

    return (
      <ExerciseResultsScreen
        title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
        subtitle="Rapid Note Transition Result"
        score={result.overall}
        scoreSuffix="/ 100"
        resultIcon={result.passed ? 'checkmark-circle-outline' : 'refresh-circle-outline'}
        scoreMessage={result.feedback}
        scoreDetails={`${result.attempts.length} of ${exerciseConfig.repetitions} repetitions completed`}
        onRetry={() => setConfirmation('tryAgain')}
        onExit={() => setConfirmation('quit')}
        onBack={() => setConfirmation('quit')}
      >
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
      </ExerciseResultsScreen>
    );
  };

  if (isLoadingAdaptiveParams) {
    return (
      <ExercisePreparingScreen
        title="Preparing Your Exercise"
        message="Adjusting the exercise to your current difficulty level and preparing your vocal range."
        icon="options-outline"
        iconSize={44}
      />
    );
  }

  if (isPreparingResume) {
    return (
      <ExercisePreparingScreen
        title="Preparing Your Repetition"
        message="Getting your reference notes ready. Your completed repetitions are preserved."
        icon="musical-notes-outline"
      />
    );
  }

  return (
    <>
      <View style={styles.screen}>
        {screen === 'instructions' && renderInstructions()}
        {screen === 'countdown' && renderCountdown()}
        {screen === 'listening' && renderListening()}
        {screen === 'recording' && renderRecording()}
        {screen === 'processing' && renderProcessing()}

        {screen === 'results' && (
          <ScrollView
            ref={scrollViewRef}
            style={styles.resultsScroll}
            contentContainerStyle={styles.resultsWrapper}
            showsVerticalScrollIndicator={false}
          >
            {renderResults()}
          </ScrollView>
        )}
      </View>

      <ExerciseQuitModal
        visible={confirmation !== null}
        title={confirmation === 'tryAgain' ? 'Try again?' : 'Quit exercise?'}
        message={confirmation === 'tryAgain'
                ? 'Are you sure you want to repeat this exercise?'
                : 'Are you sure you want to leave this exercise?'}
        isQuitting={false}
        onContinue={closeConfirmation}
        onQuit={() => {
                  const action = confirmation;
                  setConfirmation(null);

                  if (action === 'tryAgain') {
                    retryExercise();
                  } else if (action === 'quit') {
                    router.replace('/exercises/agility');
                  }
                }}
        continueLabel={"Continue Exercise"}
        quitLabel={confirmation === 'tryAgain' ? 'Try Again' : 'Quit Exercise'}
      />
      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={redoExerciseRepetition}
        onQuit={() => {
          setShowNoAudioModal(false);
          router.replace('/exercises/agility');
        }}
        isQuitting={false}
      />
    </>
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
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  resultsScroll: {
    flex: 1,
  },
  resultsWrapper: {
    flexGrow: 1,
    width: '100%',
    paddingBottom: 24,
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
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
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
    color: COLORS.muted,
    marginBottom: -10,
  },
  repetitionProgressCount: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: COLORS.brown,
    marginBottom: -10,
  },
  timerText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 6,
  },
  timerTrack: {
    width: '100%',
    height: 8,
    backgroundColor: COLORS.lightGray,
    borderRadius: 5,
    overflow: 'hidden',
  },
  timerFill: {
    height: '100%',
    backgroundColor: COLORS.pink,
  },
  liveCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 16,
    marginTop: 12,
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
    marginTop: 2,
  },
  liveFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: COLORS.muted,
  },
  stopButton: {
    width: '100%',
    minHeight: 50,
    marginTop: 16,
    borderRadius: 25,
    backgroundColor: COLORS.brown,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  stopButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: COLORS.white,
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
  attemptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
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
    color: COLORS.brown,
  },
  attemptSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 4,
    lineHeight: 15,
  },
  attemptScore: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: COLORS.brown,
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