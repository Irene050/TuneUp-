import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { AudioContext } from 'react-native-audio-api';

import { usePhaseState } from '@/hooks/usePhaseState';
import {
  AssessmentCompletionModal,
  AssessmentProgressActions,
} from '@/components/assessment/AssessmentProgress';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';

import {
  ExerciseCountdownScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import {
  calculateSingingAssessmentScore,
  getSingingScoreMessage,
  MARY_MELODY,
  SINGING_ASSESSMENT_BPM,
  type SingingAssessmentResult,
} from '@/services/assessment/singingAssessment';
import { auth, db } from '@/services/firebase/config';
import {
  midiToFrequency,
  midiToNoteName,
} from '@/utils/music/notes';

import { AUDIO_SAMPLE_RATE, COLORS, EXERCISE_COUNTDOWN_SECONDS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';

import {
  ExerciseQuitModal,
} from '@/components/exercises/ExerciseModals';

const BEAT_MS = 60_000 / SINGING_ASSESSMENT_BPM;
const BEAT_SECONDS = BEAT_MS / 1000;
const GUIDE_START_DELAY_SECONDS = 0.12;
const RECORDING_START_DELAY_SECONDS = 0.08;
const RECORDING_END_PADDING_MS = 500;

const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULER_LOOKAHEAD_SECONDS = 0.12;

const TOTAL_MELODY_BEATS = MARY_MELODY.reduce(
  (total, note) => total + note.beats,
  0,
);

const MELODY_DURATION_MS = TOTAL_MELODY_BEATS * BEAT_MS;
const RECORDING_DURATION_MS =
  MELODY_DURATION_MS + RECORDING_END_PADDING_MS;
const RECORDING_DURATION_SECONDS = RECORDING_DURATION_MS / 1000;

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

function getCurrentMelodyNoteIndex(elapsedSeconds: number): number {
  const elapsedBeats = Math.max(0, elapsedSeconds) / BEAT_SECONDS;
  let accumulatedBeats = 0;

  for (let index = 0; index < MARY_MELODY.length; index += 1) {
    accumulatedBeats += MARY_MELODY[index].beats;

    if (elapsedBeats < accumulatedBeats) {
      return index;
    }
  }

  return MARY_MELODY.length - 1;
}

function getCurrentBeatDot(elapsedSeconds: number): number {
  const elapsedBeats = Math.floor(
    Math.max(0, elapsedSeconds) / BEAT_SECONDS,
  );

  return elapsedBeats % 4;
}

function formatMelodyLyric(lyric: string): string {
  return lyric.replace(/-/g, '').trim();
}

async function playMelodyGuide(): Promise<void> {
  const context = new AudioContext({
    sampleRate: AUDIO_SAMPLE_RATE,
  });

  try {
    await context.resume();

    const startAt = context.currentTime + GUIDE_START_DELAY_SECONDS;
    let beatOffset = 0;

    for (const note of MARY_MELODY) {
      const start = startAt + beatOffset * BEAT_SECONDS;
      const duration = note.beats * BEAT_SECONDS * 0.88;

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(
        midiToFrequency(note.midi),
        start,
      );

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.025);
      gain.gain.setValueAtTime(
        0.18,
        Math.max(start + 0.03, start + duration - 0.04),
      );
      gain.gain.linearRampToValueAtTime(0.0001, start + duration);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);

      beatOffset += note.beats;
    }

    for (let beat = 0; beat < TOTAL_MELODY_BEATS; beat += 1) {
      const start = startAt + beat * BEAT_SECONDS;

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(
        beat % 4 === 0 ? 2200 : 1800,
        start,
      );

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.045, start + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(start);
      oscillator.stop(start + 0.06);
    }

    const totalMs =
      GUIDE_START_DELAY_SECONDS * 1000 +
      MELODY_DURATION_MS +
      250;

    await new Promise<void>((resolve) => {
      setTimeout(resolve, totalMs);
    });
  } finally {
    try {
      await context.close();
    } catch {
      // Ignore audio-context cleanup errors.
    }
  }
}

function playBeatClick(
  context: AudioContext,
  when: number,
  accent: boolean,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(
    accent ? 2200 : 1800,
    when,
  );

  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(0.09, when + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);

  oscillator.connect(gain);
  gain.connect(context.destination);

  oscillator.start(when);
  oscillator.stop(when + 0.075);
}

export default function SingingAssessmentScreen() {
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(
    null,
  );
  const [liveAudioFrame, setLiveAudioFrame] = useState<LiveAudioFrame | null>(null);
  const [result, setResult] = useState<SingingAssessmentResult | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGuidePlaying, setIsGuidePlaying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);

  const beatContextRef = useRef<AudioContext | null>(null);
  const beatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextBeatIndexRef = useRef(0);
  const recordingStartedAtRef = useRef<number | null>(null);

  const processingRef = useRef(false);
  const finishRequestedRef = useRef(false);
  const cancelNextStopRef = useRef(false);
  const quitRequestedRef = useRef(false);
  const exitPromptOpenRef = useRef(false);
  const cancelInProgressRef = useRef(false);
  const mountedRef = useRef(false);
  const backgroundNavigationRef = useRef(false);

  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingSamplesRef = useRef<Float32Array | null>(null);
  const pendingSampleRateRef = useRef(0);

  const cancelRecordingRef = useRef<(() => Promise<void>) | null>(null);

  useFocusEffect(
    useCallback(() => {
      backgroundNavigationRef.current = false;
    }, []),
  );


  const clearPendingProcessing = useCallback(() => {
    if (processingTimerRef.current) {
      clearTimeout(processingTimerRef.current);
      processingTimerRef.current = null;
    }

    pendingSamplesRef.current = null;
    pendingSampleRateRef.current = 0;
    processingRef.current = false;
  }, []);

  const stopBeatGuide = useCallback(async () => {
    if (beatTimerRef.current) {
      clearInterval(beatTimerRef.current);
      beatTimerRef.current = null;
    }

    const context = beatContextRef.current;
    beatContextRef.current = null;
    nextBeatIndexRef.current = 0;

    if (context) {
      try {
        await context.close();
      } catch {
        // Ignore audio-context cleanup errors.
      }
    }
  }, []);

  const saveResult = useCallback(
    async (assessment: SingingAssessmentResult) => {
      if (quitRequestedRef.current) return;

      const user = auth.currentUser;

      if (!user) {
        if (mountedRef.current && !quitRequestedRef.current) {
          setSaveMessage(
            'Assessment complete. Sign in to save this attempt to your account.',
          );
        }
        return;
      }

      try {
        await addDoc(
          collection(db, 'users', user.uid, 'singingAssessments'),
          {
            assessmentType: 'maryHadALittleLamb',
            guideMode: 'beat',
            tempoBpm: SINGING_ASSESSMENT_BPM,
            overallScore: assessment.overallScore,
            pitchAccuracy: assessment.pitchAccuracy,
            pitchStability: assessment.pitchStability,
            vocalConsistency: assessment.vocalConsistency,
            voicedFrameCount: assessment.voicedFrameCount,
            detectedNoteCount: assessment.detectedNoteCount,
            durationSeconds: assessment.durationSeconds,
            feedback: assessment.feedback,
            timestamp: serverTimestamp(),
          },
        );

        if (mountedRef.current && !quitRequestedRef.current) {
          setSaveMessage(
            'Your singing assessment has been saved to your singing assessment history.',
          );
        }
      } catch (saveError) {
        console.error(
          '[SingingAssessment] Failed to save result:',
          saveError,
        );

        if (mountedRef.current && !quitRequestedRef.current) {
          setSaveMessage(
            'Your score is ready, but we could not save this attempt. Check your connection and try again later.',
          );
        }
      }
    },
    [],
  );

  const handleRecordingComplete = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (cancelNextStopRef.current || quitRequestedRef.current) {
        cancelNextStopRef.current = false;
        return;
      }

      if (processingRef.current) return;

      processingRef.current = true;
      pendingSamplesRef.current = samples;
      pendingSampleRateRef.current = sampleRate;
      setPhase('processing');

      processingTimerRef.current = setTimeout(async () => {
        processingTimerRef.current = null;

        if (
          quitRequestedRef.current ||
          cancelNextStopRef.current ||
          !mountedRef.current
        ) {
          clearPendingProcessing();
          return;
        }

        const pendingSamples = pendingSamplesRef.current;
        const pendingSampleRate = pendingSampleRateRef.current;

        pendingSamplesRef.current = null;
        pendingSampleRateRef.current = 0;

        if (!pendingSamples || pendingSampleRate <= 0) {
          processingRef.current = false;
          setErrorMessage('No recording data was available to analyze.');
          setPhase('instructions');
          return;
        }

        try {
          const assessment = await calculateSingingAssessmentScore(
            pendingSamples,
            pendingSampleRate,
          );

          if (quitRequestedRef.current || !mountedRef.current) {
            setResult(null);
            return;
          }

          setResult(assessment);
          setErrorMessage(null);
          setPhase('results');
          setShowCompletionModal(true);

          void saveResult(assessment);
        } catch (processingError) {
          if (quitRequestedRef.current || !mountedRef.current) return;

          const message =
            processingError instanceof Error
              ? processingError.message
              : 'We could not analyze this recording. Please try again.';

          setErrorMessage(message);
          setResult(null);
          setPhase('instructions');

          if (backgroundNavigationRef.current) {
            backgroundNavigationRef.current = false;
            router.back();
          }
        } finally {
          processingRef.current = false;
        }
      }, 0);
    },
    [clearPendingProcessing, saveResult],
  );

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (quitRequestedRef.current || !mountedRef.current) return;
    setLiveAudioFrame(frame);
  }, []);

  const {
    startRecording,
    stopRecording,
    cancelRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingComplete,
  });

  useEffect(() => {
    cancelRecordingRef.current = cancelRecording;
  }, [cancelRecording]);

  const startBeatGuide = useCallback(async () => {
    await stopBeatGuide();

    if (quitRequestedRef.current) return;

    const context = new AudioContext({
      sampleRate: AUDIO_SAMPLE_RATE,
    });

    beatContextRef.current = context;

    try {
      await context.resume();

      if (
        quitRequestedRef.current ||
        beatContextRef.current !== context
      ) {
        try {
          await context.close();
        } catch {
          // Ignore audio-context cleanup errors.
        }
        return;
      }

      const firstBeatAt =
        context.currentTime + RECORDING_START_DELAY_SECONDS;

      const firstBeatWallTime =
        Date.now() + RECORDING_START_DELAY_SECONDS * 1000;

      recordingStartedAtRef.current = firstBeatWallTime;
      setRecordingStartedAt(firstBeatWallTime);
      setElapsedSeconds(0);

      nextBeatIndexRef.current = 0;

      const scheduleUpcomingBeats = () => {
        const activeContext = beatContextRef.current;

        if (
          !activeContext ||
          activeContext !== context ||
          quitRequestedRef.current ||
          phaseRef.current !== 'recording'
        ) {
          if (beatTimerRef.current) {
            clearInterval(beatTimerRef.current);
            beatTimerRef.current = null;
          }
          return;
        }

        const scheduleUntil =
          activeContext.currentTime + SCHEDULER_LOOKAHEAD_SECONDS;

        while (
          nextBeatIndexRef.current < TOTAL_MELODY_BEATS
        ) {
          const beatIndex = nextBeatIndexRef.current;
          const beatAt =
            firstBeatAt + beatIndex * BEAT_SECONDS;

          if (beatAt > scheduleUntil) break;

          playBeatClick(
            activeContext,
            beatAt,
            beatIndex % 4 === 0,
          );

          nextBeatIndexRef.current += 1;
        }

        if (
          nextBeatIndexRef.current >= TOTAL_MELODY_BEATS &&
          beatTimerRef.current
        ) {
          clearInterval(beatTimerRef.current);
          beatTimerRef.current = null;
        }
      };

      scheduleUpcomingBeats();

      if (nextBeatIndexRef.current < TOTAL_MELODY_BEATS) {
        beatTimerRef.current = setInterval(
          scheduleUpcomingBeats,
          SCHEDULER_INTERVAL_MS,
        );
      }
    } catch (guideError) {
      if (beatContextRef.current === context) {
        await stopBeatGuide();
      }
      throw guideError;
    }
  }, [stopBeatGuide]);

  const finishRecording = useCallback(async () => {
    if (
      finishRequestedRef.current ||
      quitRequestedRef.current ||
      phaseRef.current !== 'recording'
    ) {
      return;
    }

    finishRequestedRef.current = true;

    await stopBeatGuide();

    if (quitRequestedRef.current) return;

    try {
      await stopRecording();
    } catch (stopError) {
      console.error(
        '[SingingAssessment] Failed to finish recording:',
        stopError,
      );

      if (mountedRef.current && !quitRequestedRef.current) {
        setErrorMessage('Could not finish the recording. Please try again.');
        setPhase('instructions');
      }
    }
  }, [stopBeatGuide, stopRecording]);

  const beginRecording = useCallback(async () => {
    if (quitRequestedRef.current) return;

    setErrorMessage(null);
    setLiveAudioFrame(null);
    setElapsedSeconds(0);
    setRecordingStartedAt(null);
    recordingStartedAtRef.current = null;

    finishRequestedRef.current = false;
    cancelNextStopRef.current = false;
    setPhase('recording');

    try {
      await startRecording();

      if (quitRequestedRef.current) {
        await cancelRecording();
        return;
      }

      await startBeatGuide();

      if (quitRequestedRef.current) {
        await stopBeatGuide();
        await cancelRecording();
      }
    } catch (startError) {
      await stopBeatGuide();

      if (quitRequestedRef.current || !mountedRef.current) return;

      setRecordingStartedAt(null);
      recordingStartedAtRef.current = null;
      setPhase('instructions');

      const message =
        startError instanceof Error
          ? startError.message
          : 'Could not start microphone recording.';

      setErrorMessage(message);
    }
  }, [
    startRecording,
    cancelRecording,
    startBeatGuide,
    stopBeatGuide,
  ]);

  useEffect(() => {
    if (phase !== 'countdown' || quitRequestedRef.current) return;

    if (countdown <= 0) {
      void beginRecording();
      return;
    }

    const timeout = setTimeout(() => {
      setCountdown((current) => current - 1);
    }, 1000);

    return () => clearTimeout(timeout);
  }, [phase, countdown, beginRecording]);

  useEffect(() => {
    if (
      phase !== 'recording' ||
      recordingStartedAt === null ||
      quitRequestedRef.current
    ) {
      return;
    }

    const updateRecordingClock = () => {
      if (quitRequestedRef.current) return;

      const elapsedMs = Math.max(0, Date.now() - recordingStartedAt);
      const elapsedSeconds = Math.min(
        elapsedMs / 1000,
        RECORDING_DURATION_SECONDS,
      );

      setElapsedSeconds(elapsedSeconds);

      if (elapsedMs >= RECORDING_DURATION_MS) {
        void finishRecording();
      }
    };

    updateRecordingClock();

    const interval = setInterval(updateRecordingClock, 30);

    return () => clearInterval(interval);
  }, [phase, recordingStartedAt, finishRecording]);

  const requestQuitAssessment = useCallback(() => {
    if (cancelInProgressRef.current || exitPromptOpenRef.current) {
      return;
    }

    exitPromptOpenRef.current = true;
    setShowQuitModal(true);
  }, []);

  const dismissQuitModal = useCallback(() => {
    if (cancelInProgressRef.current) return;

    exitPromptOpenRef.current = false;
    setShowQuitModal(false);
  }, []);

  const confirmQuitAssessment = useCallback(async () => {
    if (cancelInProgressRef.current) return;

    cancelInProgressRef.current = true;
    quitRequestedRef.current = true;
    cancelNextStopRef.current = true;
    finishRequestedRef.current = true;

    clearPendingProcessing();

    setIsCancelling(true);
    setElapsedSeconds(0);
    setRecordingStartedAt(null);
    recordingStartedAtRef.current = null;
    setLiveAudioFrame(null);
    setResult(null);
    setSaveMessage(null);
    setErrorMessage(null);

    try {
      await stopBeatGuide();
      await cancelRecording();
    } catch (cancelError) {
      console.error(
        '[SingingAssessment] Failed to cancel assessment:',
        cancelError,
      );
    } finally {
      router.back();
    }
  }, [clearPendingProcessing, stopBeatGuide, cancelRecording]);

  const quitAssessmentModal = (
    <ExerciseQuitModal
      visible={showQuitModal}
      message="Are you sure you want to leave your Singing Assessment? Your current progress may not be saved."
      isQuitting={isCancelling}
      onContinue={dismissQuitModal}
      onQuit={() => void confirmQuitAssessment()}
      title="Quit assessment?"
      continueLabel="Continue Assessment"
      quitLabel="Quit Assessment"
      quittingLabel="Leaving…"
    />
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (quitRequestedRef.current || cancelInProgressRef.current) {
          return true;
        }

        requestQuitAssessment();
        return true;
      },
    );

    return () => subscription.remove();
  }, [requestQuitAssessment]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      quitRequestedRef.current = true;
      cancelNextStopRef.current = true;
      finishRequestedRef.current = true;
      clearPendingProcessing();

      if (beatTimerRef.current) {
        clearInterval(beatTimerRef.current);
        beatTimerRef.current = null;
      }

      const context = beatContextRef.current;
      beatContextRef.current = null;

      if (context) {
        void context.close().catch(() => undefined);
      }

      const cancel = cancelRecordingRef.current;

      if (cancel) {
        void cancel().catch((cancelError: unknown) => {
          console.error(
            '[SingingAssessment] Recorder cleanup failed:',
            cancelError,
          );
        });
      }
    };
  }, [clearPendingProcessing]);

  const handleStart = useCallback(() => {
    clearPendingProcessing();

    quitRequestedRef.current = false;
    backgroundNavigationRef.current = false;
    exitPromptOpenRef.current = false;
    cancelNextStopRef.current = false;
    finishRequestedRef.current = false;
    processingRef.current = false;
    cancelInProgressRef.current = false;
    recordingStartedAtRef.current = null;

    setShowQuitModal(false);
    setShowCompletionModal(false);
    setIsCancelling(false);
    setErrorMessage(null);
    setResult(null);
    setSaveMessage(null);
    setLiveAudioFrame(null);
    setElapsedSeconds(0);
    setRecordingStartedAt(null);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setPhase('countdown');
  }, [clearPendingProcessing]);

  const handleRetry = useCallback(async () => {
    clearPendingProcessing();

    quitRequestedRef.current = false;
    backgroundNavigationRef.current = false;
    exitPromptOpenRef.current = false;
    cancelNextStopRef.current = false;
    recordingStartedAtRef.current = null;

    await stopBeatGuide();

    setShowQuitModal(false);
    setShowCompletionModal(false);
    setResult(null);
    setSaveMessage(null);
    setErrorMessage(null);
    setElapsedSeconds(0);
    setRecordingStartedAt(null);
    setLiveAudioFrame(null);

    processingRef.current = false;
    finishRequestedRef.current = false;

    setIsCancelling(false);
    setPhase('instructions');
  }, [clearPendingProcessing, stopBeatGuide]);

  const openBackgroundRoute = useCallback(
    (tab: 'index' | 'exercises') => {
      if (backgroundNavigationRef.current) {
        return;
      }

      backgroundNavigationRef.current = true;
      router.push({
        pathname: '/dashboard',
        params: { tab },
      });
    },
    [],
  );

  const checkAssessmentResults = useCallback(() => {
    setShowCompletionModal(false);

    if (backgroundNavigationRef.current) {
      backgroundNavigationRef.current = false;
      router.back();
    }
  }, []);

  const playReference = useCallback(async () => {
    if (isGuidePlaying) return;

    setIsGuidePlaying(true);

    try {
      await playMelodyGuide();
    } catch (playError) {
      console.error(
        '[SingingAssessment] Reference playback failed:',
        playError,
      );
    } finally {
      if (mountedRef.current) {
        setIsGuidePlaying(false);
      }
    }
  }, [isGuidePlaying]);

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="musical-notes"
          title="Singing Assessment"
          countdown={countdown}
          promptTitle="Get ready to sing"
          prompt="Sing Mary Had a Little Lamb while following the steady beat. Rhythm is not part of your score."
          onBack={requestQuitAssessment}
        />

        {quitAssessmentModal}
      </>
    );
  }

  if (phase === 'recording') {
    const currentMelodyIndex = getCurrentMelodyNoteIndex(elapsedSeconds);
    const currentMelodyNote = MARY_MELODY[currentMelodyIndex];
    const activeBeatDot = getCurrentBeatDot(elapsedSeconds);

    const detectedPitch =
      liveAudioFrame?.pitch && liveAudioFrame.pitch > 0
        ? liveAudioFrame.note
        : 'Listening…';

    const remainingSeconds = Math.max(
      0,
      Math.ceil(RECORDING_DURATION_SECONDS - elapsedSeconds),
    );

    const progressPercent = Math.min(
      100,
      (elapsedSeconds / RECORDING_DURATION_SECONDS) * 100,
    );

    return (
      <View style={exerciseStyles.recordingScreen_SingingAssessment}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={exerciseStyles.backButton_SingingAssessment}
          disabled={isCancelling}
          onPress={requestQuitAssessment}
        >
          <Ionicons name="chevron-back" size={25} color={COLORS.brown} />
        </Pressable>

        <View style={exerciseStyles.recordingHeader_SingingAssessment}>
          <View style={exerciseStyles.recordingIconCircle}>
            <Ionicons name="musical-notes" size={28} color={COLORS.brown} />
          </View>

          <Text style={exerciseStyles.recordingTitle_SingingAssessment}>Your Turn to Sing!</Text>
          <Text style={exerciseStyles.liveFrequency}>
            Follow the highlighted words as you sing.
          </Text>
        </View>

        <View
          style={exerciseStyles.activeLyricCard}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Sing ${formatMelodyLyric(
            currentMelodyNote.lyric,
          )}. Target note ${midiToNoteName(currentMelodyNote.midi)}.`}
        >
          <View style={exerciseStyles.activeLyricBadge}>
            <View style={exerciseStyles.activeLyricBadgeDot} />
            <Text style={exerciseStyles.activeLyricBadgeText}>
              SING THIS NOW
            </Text>
          </View>

          <Text style={exerciseStyles.activeLyric}>
            {formatMelodyLyric(currentMelodyNote.lyric)}
          </Text>

          <View style={exerciseStyles.activeLyricDivider} />

          <View style={exerciseStyles.targetNoteRow}>
            <Ionicons name="musical-note" size={21} color={COLORS.brown} />

            <View style={exerciseStyles.targetNoteTextWrap}>
              <Text style={exerciseStyles.targetNoteCaption}>TARGET NOTE</Text>
              <Text style={exerciseStyles.targetNoteName}>
                {midiToNoteName(currentMelodyNote.midi)}
              </Text>
            </View>
          </View>

          <Text style={exerciseStyles.activeLyricProgress}>
            SYLLABLE {currentMelodyIndex + 1} OF {MARY_MELODY.length}
          </Text>
        </View>

        <View style={exerciseStyles.lyricStripCard}>
          <View style={exerciseStyles.lyricStripHeader}>
            <Text style={exerciseStyles.lyricStripTitle}>FOLLOW THE LYRICS</Text>
            <Text style={exerciseStyles.guideText}>Keep going!</Text>
          </View>

          <View style={exerciseStyles.lyricStripContent}>
            <View style={exerciseStyles.lyricStrip}>
              {MARY_MELODY.map((note, index) => {
                const isCurrent = index === currentMelodyIndex;
                const isPast = index < currentMelodyIndex;

                return (
                  <View
                    key={`${index}-${note.lyric}`}
                    style={[
                      exerciseStyles.lyricChip,
                      isCurrent && exerciseStyles.lyricChipActive,
                      isPast && exerciseStyles.lyricChipPast,
                    ]}
                  >
                    {isCurrent ? (
                      <Ionicons
                        name="arrow-up"
                        size={12}
                        color={COLORS.white}
                        style={exerciseStyles.currentChipIcon}
                      />
                    ) : null}

                    <Text
                      style={[
                        exerciseStyles.lyricChipText,
                        isCurrent && exerciseStyles.lyricChipTextActive,
                        isPast && exerciseStyles.liveNoteWaiting,
                      ]}
                    >
                      {formatMelodyLyric(note.lyric)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        <View style={exerciseStyles.liveCard_SingingAssessment}>
          <View style={exerciseStyles.liveCardHeader_SingingAssessment}>
            <View style={exerciseStyles.liveIndicator} />
            <Text style={exerciseStyles.targetNoteCaption}>YOUR VOICE</Text>
          </View>

          <Text style={exerciseStyles.liveNote_SingingAssessment}>{detectedPitch}</Text>

          <Text style={exerciseStyles.liveHint}>
            {liveAudioFrame?.pitch && liveAudioFrame.pitch > 0
              ? `Target: ${midiToNoteName(currentMelodyNote.midi)}`
              : 'Sing clearly into the microphone'}
          </Text>

          <View
            style={exerciseStyles.beatRow}
            accessibilityLabel={`Beat ${activeBeatDot + 1} of 4`}
          >
            {[0, 1, 2, 3].map((beat) => (
              <View
                key={beat}
                style={[
                  exerciseStyles.beatDot,
                  beat === activeBeatDot && exerciseStyles.beatDotActive,
                  beat === 0 && exerciseStyles.firstBeatDot,
                  beat === activeBeatDot &&
                    beat === 0 &&
                    exerciseStyles.firstBeatDotActive,
                ]}
              />
            ))}
          </View>

          <Text style={exerciseStyles.beatLabel}>
            {SINGING_ASSESSMENT_BPM} BPM · Beat guide active
          </Text>
        </View>

        <View style={exerciseStyles.timerWrap}>
          <Text style={exerciseStyles.timer}>
            {`0:${String(remainingSeconds).padStart(2, '0')}`}
          </Text>

          <View style={exerciseStyles.progressTrack_SingingAssessment}>
            <View
              style={[
                exerciseStyles.progressFill_SingingAssessment,
                { width: `${progressPercent}%` },
              ]}
            />
          </View>

          <Text style={exerciseStyles.footerHint}>
            Recording stops automatically when the song finishes.
          </Text>
        </View>

        {quitAssessmentModal}
      </View>
    );
  }

  if (phase === 'processing') {
    return (
      <View style={exerciseStyles.processingScreen}>
        <ExerciseProcessingScreen
          icon="analytics"
          title="Analyzing Your Singing"
          message="Checking your pitch accuracy, pitch stability, and vocal consistency…"
        >
          <AssessmentProgressActions
            onOpenDashboard={() => openBackgroundRoute('index')}
            onOpenExerciseLibrary={() => openBackgroundRoute('exercises')}
          />
        </ExerciseProcessingScreen>

        {quitAssessmentModal}
      </View>
    );
  }

  if (phase === 'results' && result) {
    return (
      <>
        <ExerciseResultsScreen
          title="Singing Assessment Results"
          subtitle="Mary Had a Little Lamb"
          score={result.overallScore}
          resultIcon="musical-notes"
          scoreMessage={getSingingScoreMessage(result.overallScore)}
          onRetry={() => void handleRetry()}
          onExit={requestQuitAssessment}
        >
          <View style={exerciseStyles.resultList}>
            <ScoreRow
              label="Pitch Accuracy"
              score={result.pitchAccuracy}
              weight="80% of score"
            />
            <ScoreRow
              label="Pitch Stability"
              score={result.pitchStability}
              weight="20% of score"
            />
            <ScoreRow
              label="Vocal Consistency"
              score={result.vocalConsistency}
              weight="Recording indicator"
            />
          </View>

          <View style={exerciseStyles.feedbackCard}>
            <Text style={exerciseStyles.feedbackTitle}>Your Feedback</Text>

            {result.feedback.map((item, index) => (
              <View
                style={exerciseStyles.feedbackRow}
                key={`${index}-${item}`}
              >
                <Ionicons
                  name="checkmark-circle-outline"
                  size={19}
                  color={COLORS.brown}
                />
                <Text style={exerciseStyles.feedbackText}>{item}</Text>
              </View>
            ))}

            <Text style={exerciseStyles.disclaimer}>
              Vocal consistency uses relative microphone-level measurements.
              It is not calibrated sound-pressure level (dB SPL) or a direct
              measure of vocal technique.
            </Text>
          </View>

          {saveMessage ? (
            <Text style={exerciseStyles.saveMessage}>{saveMessage}</Text>
          ) : null}
        </ExerciseResultsScreen>

        {quitAssessmentModal}
        <AssessmentCompletionModal
          visible={showCompletionModal}
          title="Assessment is done!"
          message="Your singing assessment is ready. You can close this message or view your results."
          onClose={() => setShowCompletionModal(false)}
          onCheckResults={checkAssessmentResults}
        />
      </>
    );
  }

  return (
    <>
      <ScrollView
        style={exerciseStyles.screen}
        contentContainerStyle={exerciseStyles.instructionsContent}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={exerciseStyles.backButton_SingingAssessment}
          disabled={isCancelling}
          onPress={requestQuitAssessment}
        >
          <Ionicons name="chevron-back" size={25} color={COLORS.brown} />
        </Pressable>

        <View style={exerciseStyles.hero}>
          <View style={exerciseStyles.iconCircle_SingingAssessment}>
            <Ionicons name="musical-notes" size={38} color={COLORS.brown} />
          </View>

          <Text style={exerciseStyles.resultTitle}>Singing Assessment</Text>
          <Text style={exerciseStyles.subtitle_SingingAssessment}>
            Check your singing performance
          </Text>
        </View>

        <View style={exerciseStyles.instructionCard}>
          <Text style={exerciseStyles.cardTitle_SingingAssessment}>Your Singing Task</Text>

          <Text style={exerciseStyles.bodyText}>
            Sing “Mary Had a Little Lamb” while following a steady beat.
            The beat is there to guide you; your rhythm will not affect
            your score.
          </Text>

          <View style={exerciseStyles.lyricsCard}>
            <Text style={exerciseStyles.lyricsLabel}>LYRICS</Text>
            <Text style={exerciseStyles.lyrics}>Mary had a little lamb,</Text>
            <Text style={exerciseStyles.lyrics}>Little lamb, little lamb,</Text>
            <Text style={exerciseStyles.lyrics}>Mary had a little lamb,</Text>
            <Text style={exerciseStyles.lyrics}>Its fleece was white as snow.</Text>
          </View>

          <View style={exerciseStyles.infoRow_SingingAssessment}>
            <Ionicons name="headset-outline" size={19} color={COLORS.brown} />
            <Text style={exerciseStyles.infoText_SingingAssessment}>
              Listen to the reference melody before starting.
            </Text>
          </View>

          <View style={exerciseStyles.infoRow_SingingAssessment}>
            <Ionicons name="musical-notes" size={19} color={COLORS.brown} />
            <Text style={exerciseStyles.infoText_SingingAssessment}>
              A steady {SINGING_ASSESSMENT_BPM} BPM beat will play while
              you sing.
            </Text>
          </View>

          <View style={exerciseStyles.infoRow_SingingAssessment}>
            <Ionicons name="analytics-outline" size={19} color={COLORS.brown} />
            <Text style={exerciseStyles.infoText_SingingAssessment}>
              Your score uses pitch accuracy, pitch stability, and vocal
              consistency.
            </Text>
          </View>

          <View style={exerciseStyles.tipCard_SingingAssessment}>
            <Ionicons name="bulb-outline" size={21} color={COLORS.brown} />
            <Text style={exerciseStyles.tipText_SingingAssessment}>
              Keep your phone a comfortable, consistent distance away.
              Sing naturally; you do not need to know music theory.
            </Text>
          </View>
        </View>

        {errorMessage ? (
          <View style={exerciseStyles.errorCard_SingingAssessment}>
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color="#A33A3A"
            />
            <Text style={exerciseStyles.errorText_SingingAssessment}>{errorMessage}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={isGuidePlaying || isCancelling}
          style={[
            exerciseStyles.secondaryButton_SingingAssessment,
            (isGuidePlaying || isCancelling) && exerciseStyles.disabled,
          ]}
          onPress={() => void playReference()}
        >
          <Ionicons
            name={isGuidePlaying ? 'volume-high' : 'play-circle-outline'}
            size={21}
            color={COLORS.brown}
          />
          <Text style={exerciseStyles.repResultTitle}>
            {isGuidePlaying
              ? 'Playing Reference Melody…'
              : 'Play Reference Melody + Beat'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={isCancelling}
          style={[
            exerciseStyles.startButton_SingingAssessment,
            isCancelling && exerciseStyles.disabled,
          ]}
          onPress={handleStart}
        >
          <Ionicons name="mic" size={20} color={COLORS.white} />
          <Text style={exerciseStyles.startButtonText_SingingAssessment}>Start Assessment</Text>
        </Pressable>
      </ScrollView>

      {quitAssessmentModal}
    </>
  );
}

function ScoreRow({
  label,
  score,
  weight,
}: {
  label: string;
  score: number;
  weight: string;
}) {
  return (
    <View style={exerciseStyles.scoreRow_SingingAssessment}>
      <View style={exerciseStyles.scoreRowHeader_SingingAssessment}>
        <View style={exerciseStyles.infoText}>
          <Text style={exerciseStyles.cardTitle}>{label}</Text>
          <Text style={exerciseStyles.repResultDetails}>{weight}</Text>
        </View>

        <Text style={exerciseStyles.resultDetailValue}>{score.toFixed(1)}%</Text>
      </View>

      <View style={exerciseStyles.progressTrack_SingingAssessment}>
        <View
          style={[
            exerciseStyles.progressFill_SingingAssessment,
            {
              width: `${Math.max(0, Math.min(100, score))}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}
