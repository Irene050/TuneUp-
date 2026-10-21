import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
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

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const MUTED = '#8E7770';
const BORDER = '#F2DDE5';
const WHITE = '#FFFFFF';
const DEEP_PINK = '#D94F78';
const COMPLETED_PINK = '#F5E8EC';

const COUNTDOWN_SECONDS = 3;
const BEAT_MS = 60_000 / SINGING_ASSESSMENT_BPM;
const BEAT_SECONDS = BEAT_MS / 1000;
const GUIDE_SAMPLE_RATE = 44100;
const GUIDE_START_DELAY_SECONDS = 0.12;
const RECORDING_START_DELAY_SECONDS = 0.08;
const RECORDING_END_PADDING_MS = 500;
const PROCESSING_DELAY_MS = 250;

// Audio scheduler settings. The scheduler wakes frequently but schedules
// clicks against AudioContext.currentTime, not against JavaScript timer timing.
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
  | 'intro'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

/**
 * Determines the active melody item using the shared elapsed clock.
 * Each melody item stays active for its own number of beats.
 */
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

/**
 * Uses the same beat clock as the metronome and lyrics.
 * The four dots represent beats 1, 2, 3, and 4 in the measure.
 */
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
    sampleRate: GUIDE_SAMPLE_RATE,
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
  const [phase, setPhase] = useState<Phase>('intro');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [recordingStartAt, setRecordingStartAt] = useState<number | null>(
    null,
  );
  const [liveFrame, setLiveFrame] = useState<LiveAudioFrame | null>(null);
  const [result, setResult] = useState<SingingAssessmentResult | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guidePlaying, setGuidePlaying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showQuitModal, setShowQuitModal] = useState(false);

  const beatContextRef = useRef<AudioContext | null>(null);
  const beatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextBeatIndexRef = useRef(0);

  // This timestamp is aligned with the first scheduled metronome click.
  const recordingStartAtRef = useRef<number | null>(null);

  const processingRef = useRef(false);
  const finishRequestedRef = useRef(false);
  const cancelNextStopRef = useRef(false);
  const quitRequestedRef = useRef(false);
  const exitPromptOpenRef = useRef(false);
  const phaseRef = useRef<Phase>('intro');
  const cancelInProgressRef = useRef(false);
  const mountedRef = useRef(false);

  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingSamplesRef = useRef<Float32Array | null>(null);
  const pendingSampleRateRef = useRef(0);

  const cancelRecordingRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

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

      processingTimerRef.current = setTimeout(() => {
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
          setError('No recording data was available to analyze.');
          setPhase('intro');
          return;
        }

        try {
          const assessment = calculateSingingAssessmentScore(
            pendingSamples,
            pendingSampleRate,
          );

          if (quitRequestedRef.current || !mountedRef.current) {
            setResult(null);
            return;
          }

          setResult(assessment);
          setError(null);
          setPhase('results');

          void saveResult(assessment);
        } catch (processingError) {
          if (quitRequestedRef.current || !mountedRef.current) return;

          const message =
            processingError instanceof Error
              ? processingError.message
              : 'We could not analyze this recording. Please try again.';

          setError(message);
          setResult(null);
          setPhase('intro');
        } finally {
          processingRef.current = false;
        }
      }, PROCESSING_DELAY_MS);
    },
    [clearPendingProcessing, saveResult],
  );

  const handleLiveFrame = useCallback((frame: LiveAudioFrame) => {
    if (quitRequestedRef.current || !mountedRef.current) return;
    setLiveFrame(frame);
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

  /**
   * Starts the metronome and shared clock.
   *
   * All clicks are scheduled against the Web Audio clock. JavaScript's
   * interval only fills the audio schedule ahead of time; it does not decide
   * the exact time each click is played.
   */
  const startBeatGuide = useCallback(async () => {
    await stopBeatGuide();

    if (quitRequestedRef.current) return;

    const context = new AudioContext({
      sampleRate: GUIDE_SAMPLE_RATE,
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

      // Align the UI's elapsed clock to the first audio-clock beat.
      const firstBeatWallTime =
        Date.now() + RECORDING_START_DELAY_SECONDS * 1000;

      recordingStartAtRef.current = firstBeatWallTime;
      setRecordingStartAt(firstBeatWallTime);
      setElapsed(0);

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

      // Schedule the first click immediately, then fill the audio queue
      // ahead of time to avoid JavaScript timer drift.
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
        setError('Could not finish the recording. Please try again.');
        setPhase('intro');
      }
    }
  }, [stopBeatGuide, stopRecording]);

  const beginRecording = useCallback(async () => {
    if (quitRequestedRef.current) return;

    setError(null);
    setLiveFrame(null);
    setElapsed(0);
    setRecordingStartAt(null);
    recordingStartAtRef.current = null;

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

      setRecordingStartAt(null);
      recordingStartAtRef.current = null;
      setPhase('intro');

      const message =
        startError instanceof Error
          ? startError.message
          : 'Could not start microphone recording.';

      setError(message);
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

  /**
   * The recording timer waits until the audio guide establishes its start
   * timestamp. Lyrics, beat dots, progress, and automatic stop all use this
   * exact shared start timestamp.
   */
  useEffect(() => {
    if (
      phase !== 'recording' ||
      recordingStartAt === null ||
      quitRequestedRef.current
    ) {
      return;
    }

    const updateRecordingClock = () => {
      if (quitRequestedRef.current) return;

      const elapsedMs = Math.max(0, Date.now() - recordingStartAt);
      const elapsedSeconds = Math.min(
        elapsedMs / 1000,
        RECORDING_DURATION_SECONDS,
      );

      setElapsed(elapsedSeconds);

      if (elapsedMs >= RECORDING_DURATION_MS) {
        void finishRecording();
      }
    };

    updateRecordingClock();

    const interval = setInterval(updateRecordingClock, 30);

    return () => clearInterval(interval);
  }, [phase, recordingStartAt, finishRecording]);

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
    setElapsed(0);
    setRecordingStartAt(null);
    recordingStartAtRef.current = null;
    setLiveFrame(null);
    setResult(null);
    setSaveMessage(null);
    setError(null);

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
    exitPromptOpenRef.current = false;
    cancelNextStopRef.current = false;
    finishRequestedRef.current = false;
    processingRef.current = false;
    cancelInProgressRef.current = false;
    recordingStartAtRef.current = null;

    setShowQuitModal(false);
    setIsCancelling(false);
    setError(null);
    setResult(null);
    setSaveMessage(null);
    setLiveFrame(null);
    setElapsed(0);
    setRecordingStartAt(null);
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');
  }, [clearPendingProcessing]);

  const handleRetry = useCallback(async () => {
    clearPendingProcessing();

    quitRequestedRef.current = false;
    exitPromptOpenRef.current = false;
    cancelNextStopRef.current = false;
    recordingStartAtRef.current = null;

    await stopBeatGuide();

    setShowQuitModal(false);
    setResult(null);
    setSaveMessage(null);
    setError(null);
    setElapsed(0);
    setRecordingStartAt(null);
    setLiveFrame(null);

    processingRef.current = false;
    finishRequestedRef.current = false;

    setIsCancelling(false);
    setPhase('intro');
  }, [clearPendingProcessing, stopBeatGuide]);

  const playReference = useCallback(async () => {
    if (guidePlaying) return;

    setGuidePlaying(true);

    try {
      await playMelodyGuide();
    } catch (playError) {
      console.error(
        '[SingingAssessment] Reference playback failed:',
        playError,
      );
    } finally {
      if (mountedRef.current) {
        setGuidePlaying(false);
      }
    }
  }, [guidePlaying]);

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

        <QuitAssessmentModal
          visible={showQuitModal}
          isQuitting={isCancelling}
          onContinue={dismissQuitModal}
          onConfirm={() => void confirmQuitAssessment()}
          onRequestClose={dismissQuitModal}
        />
      </>
    );
  }

  if (phase === 'recording') {
    const currentMelodyIndex = getCurrentMelodyNoteIndex(elapsed);
    const currentMelodyNote = MARY_MELODY[currentMelodyIndex];
    const activeBeatDot = getCurrentBeatDot(elapsed);

    const detectedPitch =
      liveFrame?.pitch && liveFrame.pitch > 0
        ? liveFrame.note
        : 'Listening…';

    const remainingSeconds = Math.max(
      0,
      Math.ceil(RECORDING_DURATION_SECONDS - elapsed),
    );

    const progressPercent = Math.min(
      100,
      (elapsed / RECORDING_DURATION_SECONDS) * 100,
    );

    return (
      <View style={styles.recordingScreen}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backButton}
          disabled={isCancelling}
          onPress={requestQuitAssessment}
        >
          <Ionicons name="chevron-back" size={25} color={BROWN} />
        </Pressable>

        <View style={styles.recordingHeader}>
          <View style={styles.recordingIconCircle}>
            <Ionicons name="musical-notes" size={28} color={BROWN} />
          </View>

          <Text style={styles.recordingTitle}>Your Turn to Sing!</Text>
          <Text style={styles.recordingSubtitle}>
            Follow the highlighted words as you sing.
          </Text>
        </View>

        <View
          style={styles.activeLyricCard}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Sing ${formatMelodyLyric(
            currentMelodyNote.lyric,
          )}. Target note ${midiToNoteName(currentMelodyNote.midi)}.`}
        >
          <View style={styles.activeLyricBadge}>
            <View style={styles.activeLyricBadgeDot} />
            <Text style={styles.activeLyricBadgeText}>
              SING THIS NOW
            </Text>
          </View>

          <Text style={styles.activeLyric}>
            {formatMelodyLyric(currentMelodyNote.lyric)}
          </Text>

          <View style={styles.activeLyricDivider} />

          <View style={styles.targetNoteRow}>
            <Ionicons name="musical-note" size={21} color={BROWN} />

            <View style={styles.targetNoteTextWrap}>
              <Text style={styles.targetNoteCaption}>TARGET NOTE</Text>
              <Text style={styles.targetNoteName}>
                {midiToNoteName(currentMelodyNote.midi)}
              </Text>
            </View>
          </View>

          <Text style={styles.activeLyricProgress}>
            SYLLABLE {currentMelodyIndex + 1} OF {MARY_MELODY.length}
          </Text>
        </View>

        <View style={styles.lyricStripCard}>
          <View style={styles.lyricStripHeader}>
            <Text style={styles.lyricStripTitle}>FOLLOW THE LYRICS</Text>
            <Text style={styles.lyricStripHint}>Keep going!</Text>
          </View>

          <View style={styles.lyricStripContent}>
            <View style={styles.lyricStrip}>
              {MARY_MELODY.map((note, index) => {
                const isCurrent = index === currentMelodyIndex;
                const isPast = index < currentMelodyIndex;

                return (
                  <View
                    key={`${index}-${note.lyric}`}
                    style={[
                      styles.lyricChip,
                      isCurrent && styles.lyricChipActive,
                      isPast && styles.lyricChipPast,
                    ]}
                  >
                    {isCurrent ? (
                      <Ionicons
                        name="arrow-up"
                        size={12}
                        color={WHITE}
                        style={styles.currentChipIcon}
                      />
                    ) : null}

                    <Text
                      style={[
                        styles.lyricChipText,
                        isCurrent && styles.lyricChipTextActive,
                        isPast && styles.lyricChipTextPast,
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

        <View style={styles.liveCard}>
          <View style={styles.liveCardHeader}>
            <View style={styles.liveIndicator} />
            <Text style={styles.liveLabel}>YOUR VOICE</Text>
          </View>

          <Text style={styles.liveNote}>{detectedPitch}</Text>

          <Text style={styles.liveHint}>
            {liveFrame?.pitch && liveFrame.pitch > 0
              ? `Target: ${midiToNoteName(currentMelodyNote.midi)}`
              : 'Sing clearly into the microphone'}
          </Text>

          <View
            style={styles.beatRow}
            accessibilityLabel={`Beat ${activeBeatDot + 1} of 4`}
          >
            {[0, 1, 2, 3].map((beat) => (
              <View
                key={beat}
                style={[
                  styles.beatDot,
                  beat === activeBeatDot && styles.beatDotActive,
                  beat === 0 && styles.firstBeatDot,
                  beat === activeBeatDot &&
                    beat === 0 &&
                    styles.firstBeatDotActive,
                ]}
              />
            ))}
          </View>

          <Text style={styles.beatLabel}>
            {SINGING_ASSESSMENT_BPM} BPM · Beat guide active
          </Text>
        </View>

        <View style={styles.timerWrap}>
          <Text style={styles.timer}>
            {`0:${String(remainingSeconds).padStart(2, '0')}`}
          </Text>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${progressPercent}%` },
              ]}
            />
          </View>

          <Text style={styles.footerHint}>
            Recording stops automatically when the song finishes.
          </Text>
        </View>

        <QuitAssessmentModal
          visible={showQuitModal}
          isQuitting={isCancelling}
          onContinue={dismissQuitModal}
          onConfirm={() => void confirmQuitAssessment()}
          onRequestClose={dismissQuitModal}
        />
      </View>
    );
  }

  if (phase === 'processing') {
    return (
      <View style={styles.processingScreen}>
        <ExerciseProcessingScreen
          icon="analytics"
          title="Analyzing Your Singing"
          message="Checking your pitch accuracy, pitch stability, and vocal consistency…"
        />

        <QuitAssessmentModal
          visible={showQuitModal}
          isQuitting={isCancelling}
          onContinue={dismissQuitModal}
          onConfirm={() => void confirmQuitAssessment()}
          onRequestClose={dismissQuitModal}
        />
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
          <View style={styles.resultList}>
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

          <View style={styles.feedbackCard}>
            <Text style={styles.feedbackTitle}>Your Feedback</Text>

            {result.feedback.map((item, index) => (
              <View
                style={styles.feedbackRow}
                key={`${index}-${item}`}
              >
                <Ionicons
                  name="checkmark-circle-outline"
                  size={19}
                  color={BROWN}
                />
                <Text style={styles.feedbackText}>{item}</Text>
              </View>
            ))}

            <Text style={styles.disclaimer}>
              Vocal consistency uses relative microphone-level measurements.
              It is not calibrated sound-pressure level (dB SPL) or a direct
              measure of vocal technique.
            </Text>
          </View>

          {saveMessage ? (
            <Text style={styles.saveMessage}>{saveMessage}</Text>
          ) : null}
        </ExerciseResultsScreen>

        <QuitAssessmentModal
          visible={showQuitModal}
          isQuitting={isCancelling}
          onContinue={dismissQuitModal}
          onConfirm={() => void confirmQuitAssessment()}
          onRequestClose={dismissQuitModal}
        />
      </>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.introScreen}
        contentContainerStyle={styles.introContent}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backButton}
          disabled={isCancelling}
          onPress={requestQuitAssessment}
        >
          <Ionicons name="chevron-back" size={25} color={BROWN} />
        </Pressable>

        <View style={styles.hero}>
          <View style={styles.iconCircle}>
            <Ionicons name="musical-notes" size={38} color={BROWN} />
          </View>

          <Text style={styles.title}>Singing Assessment</Text>
          <Text style={styles.subtitle}>
            Check your singing performance
          </Text>
        </View>

        <View style={styles.instructionCard}>
          <Text style={styles.cardTitle}>Your Singing Task</Text>

          <Text style={styles.bodyText}>
            Sing “Mary Had a Little Lamb” while following a steady beat.
            The beat is there to guide you; your rhythm will not affect
            your score.
          </Text>

          <View style={styles.lyricsCard}>
            <Text style={styles.lyricsLabel}>LYRICS</Text>
            <Text style={styles.lyrics}>Mary had a little lamb,</Text>
            <Text style={styles.lyrics}>Little lamb, little lamb,</Text>
            <Text style={styles.lyrics}>Mary had a little lamb,</Text>
            <Text style={styles.lyrics}>Its fleece was white as snow.</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="headset-outline" size={19} color={BROWN} />
            <Text style={styles.infoText}>
              Listen to the reference melody before starting.
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="musical-notes" size={19} color={BROWN} />
            <Text style={styles.infoText}>
              A steady {SINGING_ASSESSMENT_BPM} BPM beat will play while
              you sing.
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="analytics-outline" size={19} color={BROWN} />
            <Text style={styles.infoText}>
              Your score uses pitch accuracy, pitch stability, and vocal
              consistency.
            </Text>
          </View>

          <View style={styles.tipCard}>
            <Ionicons name="bulb-outline" size={21} color={BROWN} />
            <Text style={styles.tipText}>
              Keep your phone a comfortable, consistent distance away.
              Sing naturally; you do not need to know music theory.
            </Text>
          </View>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color="#A33A3A"
            />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={guidePlaying || isCancelling}
          style={[
            styles.secondaryButton,
            (guidePlaying || isCancelling) && styles.disabledButton,
          ]}
          onPress={() => void playReference()}
        >
          <Ionicons
            name={guidePlaying ? 'volume-high' : 'play-circle-outline'}
            size={21}
            color={BROWN}
          />
          <Text style={styles.secondaryButtonText}>
            {guidePlaying
              ? 'Playing Reference Melody…'
              : 'Play Reference Melody + Beat'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={isCancelling}
          style={[
            styles.startButton,
            isCancelling && styles.disabledButton,
          ]}
          onPress={handleStart}
        >
          <Ionicons name="mic" size={20} color={WHITE} />
          <Text style={styles.startButtonText}>Start Assessment</Text>
        </Pressable>
      </ScrollView>

      <QuitAssessmentModal
        visible={showQuitModal}
        isQuitting={isCancelling}
        onContinue={dismissQuitModal}
        onConfirm={() => void confirmQuitAssessment()}
        onRequestClose={dismissQuitModal}
      />
    </>
  );
}

function QuitAssessmentModal({
  visible,
  isQuitting,
  onContinue,
  onConfirm,
  onRequestClose,
}: {
  visible: boolean;
  isQuitting: boolean;
  onContinue: () => void;
  onConfirm: () => void;
  onRequestClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onRequestClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}>
            <Ionicons name="exit-outline" size={30} color={BROWN} />
          </View>

          <Text style={styles.modalTitle}>Quit assessment?</Text>

          <Text style={styles.modalMessage}>
            Are you sure you want to leave your Singing Assessment?
            Your current progress may not be saved.
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={isQuitting}
            onPress={onContinue}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.disabledButton,
            ]}
          >
            <Text style={styles.continueButtonText}>
              Continue Assessment
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={isQuitting}
            onPress={onConfirm}
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.disabledButton,
            ]}
          >
            <Text style={styles.quitButtonText}>
              {isQuitting ? 'Leaving…' : 'Quit Assessment'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
    <View style={styles.scoreRow}>
      <View style={styles.scoreRowHeader}>
        <View style={styles.scoreRowLabelWrap}>
          <Text style={styles.scoreRowLabel}>{label}</Text>
          <Text style={styles.scoreRowWeight}>{weight}</Text>
        </View>

        <Text style={styles.scoreRowValue}>{score.toFixed(1)}%</Text>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.max(0, Math.min(100, score))}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  introScreen: {
    flex: 1,
    backgroundColor: WHITE,
  },
  introContent: {
    paddingHorizontal: 24,
    paddingTop: 58,
    paddingBottom: 40,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  title: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 5,
  },
  instructionCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 9,
  },
  bodyText: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 22,
    color: MUTED,
  },
  lyricsCard: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 15,
    marginTop: 16,
    alignItems: 'center',
  },
  lyricsLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: MUTED,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  lyrics: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 23,
    color: BROWN,
    textAlign: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 15,
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: BROWN,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 15,
    padding: 13,
    marginTop: 17,
    gap: 10,
  },
  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 20,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
  },
  disabledButton: {
    opacity: 0.6,
  },
  startButton: {
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 12,
  },
  startButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
    color: WHITE,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF1F1',
    borderRadius: 14,
    padding: 13,
    marginTop: 17,
    gap: 9,
  },
  errorText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: '#A33A3A',
  },

  // Recording screen
  recordingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    paddingHorizontal: 20,
    paddingTop: 42,
    paddingBottom: 18,
    justifyContent: 'space-between',
  },
  recordingHeader: {
    alignItems: 'center',
    marginTop: -5,
    marginBottom: 10,
  },
  recordingIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: PINK,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    lineHeight: 29,
    color: BROWN,
    textAlign: 'center',
  },
  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
  },

  // Active lyric: smaller than the previous 54px version.
  activeLyricCard: {
    width: '100%',
    backgroundColor: '#FFF0F4',
    borderColor: DEEP_PINK,
    borderWidth: 2,
    borderRadius: 23,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: DEEP_PINK,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 3,
  },
  activeLyricBadge: {
    minHeight: 27,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: DEEP_PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  activeLyricBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: WHITE,
  },
  activeLyricBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: WHITE,
  },
  activeLyric: {
    fontFamily: 'FredokaBold',
    fontSize: 38,
    lineHeight: 46,
    color: BROWN,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 5,
    paddingHorizontal: 4,
  },
  activeLyricDivider: {
    width: '72%',
    height: 1,
    backgroundColor: '#EBC0CC',
    marginTop: 2,
    marginBottom: 7,
  },
  targetNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  targetNoteTextWrap: {
    alignItems: 'flex-start',
  },
  targetNoteCaption: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    letterSpacing: 0.9,
    color: MUTED,
  },
  targetNoteName: {
    fontFamily: 'FredokaBold',
    fontSize: 21,
    lineHeight: 25,
    color: BROWN,
  },
  activeLyricProgress: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    letterSpacing: 0.8,
    color: MUTED,
    marginTop: 6,
  },

  // Upcoming and completed lyric items
  lyricStripCard: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 7,
    marginTop: 9,
    marginBottom: 8,
  },
  lyricStripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  lyricStripTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: BROWN,
  },
  lyricStripHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  lyricStripContent: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  lyricStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  lyricChip: {
    minHeight: 28,
    minWidth: 34,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lyricChipActive: {
    minHeight: 34,
    minWidth: 40,
    paddingHorizontal: 9,
    backgroundColor: DEEP_PINK,
    borderColor: DEEP_PINK,
    borderWidth: 2,
    borderRadius: 10,
    transform: [{ scale: 1.04 }],
    shadowColor: DEEP_PINK,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  lyricChipPast: {
    backgroundColor: COMPLETED_PINK,
    borderColor: '#F0E2E6',
    opacity: 0.62,
  },
  currentChipIcon: {
    marginBottom: 1,
  },
  lyricChipText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'center',
  },
  lyricChipTextActive: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: WHITE,
  },
  lyricChipTextPast: {
    color: MUTED,
  },

  // Live pitch feedback
  liveCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 9,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  liveCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  liveIndicator: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#D86C89',
  },
  liveLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    color: MUTED,
    letterSpacing: 0.9,
  },
  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    lineHeight: 32,
    color: BROWN,
    marginTop: 1,
  },
  liveHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 1,
    textAlign: 'center',
  },
  beatRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beatDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#E7DDE0',
  },
  firstBeatDot: {
    borderWidth: 1,
    borderColor: '#D8B6C0',
  },
  beatDotActive: {
    backgroundColor: DEEP_PINK,
    transform: [{ scale: 1.4 }],
  },
  firstBeatDotActive: {
    backgroundColor: BROWN,
    borderColor: BROWN,
  },
  beatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 6,
  },

  timerWrap: {
    alignItems: 'center',
    marginTop: 8,
  },
  timer: {
    fontFamily: 'FredokaBold',
    fontSize: 21,
    color: BROWN,
    marginBottom: 6,
  },
  progressTrack: {
    height: 7,
    width: '100%',
    borderRadius: 4,
    backgroundColor: '#F2F2F2',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: DEEP_PINK,
    borderRadius: 4,
  },
  footerHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    textAlign: 'center',
    marginTop: 5,
  },
  stopButton: {
    minHeight: 47,
    borderRadius: 24,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 8,
  },
  stopButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: WHITE,
  },

  processingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    justifyContent: 'center',
  },

  // Results
  resultList: {
    backgroundColor: WHITE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 18,
    marginBottom: 16,
  },
  scoreRow: {
    gap: 8,
  },
  scoreRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  scoreRowLabelWrap: {
    flex: 1,
  },
  scoreRowLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
  scoreRowWeight: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },
  scoreRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },
  feedbackCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 12,
  },
  feedbackTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginBottom: 10,
  },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 8,
  },
  feedbackText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
  },
  disclaimer: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
    marginTop: 14,
  },
  saveMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    textAlign: 'center',
    marginVertical: 10,
  },

  // Quit confirmation modal
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
});