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

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const MUTED = '#8E7770';
const BORDER = '#F2DDE5';
const WHITE = '#FFFFFF';

const COUNTDOWN_SECONDS = 3;
const BEAT_MS = 60_000 / SINGING_ASSESSMENT_BPM;
const GUIDE_SAMPLE_RATE = 44100;
const GUIDE_START_DELAY_SECONDS = 0.12;
const RECORDING_END_PADDING_MS = 500;
const PROCESSING_DELAY_MS = 250;

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

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
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
      const start = startAt + (beatOffset * BEAT_MS) / 1000;
      const duration = ((note.beats * BEAT_MS) / 1000) * 0.88;

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
      gain.gain.linearRampToValueAtTime(
        0.0001,
        start + duration,
      );

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);

      beatOffset += note.beats;
    }

    for (let beat = 0; beat < TOTAL_MELODY_BEATS; beat += 1) {
      const start = startAt + (beat * BEAT_MS) / 1000;

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(
        beat % 4 === 0 ? 2200 : 1800,
        start,
      );

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.045, start + 0.004);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        start + 0.055,
      );

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

async function playBeatClick(
  context: AudioContext,
  when: number,
  accent: boolean,
): Promise<void> {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(
    accent ? 2200 : 1800,
    when,
  );

  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(0.09, when + 0.004);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    when + 0.07,
  );

  oscillator.connect(gain);
  gain.connect(context.destination);

  oscillator.start(when);
  oscillator.stop(when + 0.075);
}

export default function SingingAssessmentScreen() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [liveFrame, setLiveFrame] = useState<LiveAudioFrame | null>(null);
  const [result, setResult] = useState<SingingAssessmentResult | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guidePlaying, setGuidePlaying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showQuitModal, setShowQuitModal] = useState(false);

  const beatContextRef = useRef<AudioContext | null>(null);
  const beatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatIndexRef = useRef(0);

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

          Alert.alert('Assessment could not be scored', message);
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

      beatIndexRef.current = 0;

      const firstBeatAt = context.currentTime + 0.08;
      await playBeatClick(context, firstBeatAt, true);
      beatIndexRef.current = 1;

      if (
        quitRequestedRef.current ||
        beatContextRef.current !== context
      ) {
        return;
      }

      beatTimerRef.current = setInterval(() => {
        const activeContext = beatContextRef.current;

        if (
          !activeContext ||
          phaseRef.current !== 'recording' ||
          quitRequestedRef.current
        ) {
          return;
        }

        if (beatIndexRef.current >= TOTAL_MELODY_BEATS) {
          if (beatTimerRef.current) {
            clearInterval(beatTimerRef.current);
            beatTimerRef.current = null;
          }
          return;
        }

        const scheduledAt = activeContext.currentTime + 0.025;

        void playBeatClick(
          activeContext,
          scheduledAt,
          beatIndexRef.current % 4 === 0,
        );

        beatIndexRef.current += 1;
      }, BEAT_MS);
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

      setPhase('intro');

      const message =
        startError instanceof Error
          ? startError.message
          : 'Could not start microphone recording.';

      setError(message);
      Alert.alert('Microphone unavailable', message);
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
    if (phase !== 'recording' || quitRequestedRef.current) return;

    setElapsed(0);
    const startedAt = Date.now();

    const interval = setInterval(() => {
      if (quitRequestedRef.current) {
        clearInterval(interval);
        return;
      }

      const elapsedMs = Date.now() - startedAt;
      const elapsedSeconds = Math.min(
        elapsedMs / 1000,
        RECORDING_DURATION_SECONDS,
      );

      setElapsed(elapsedSeconds);

      if (elapsedMs >= RECORDING_DURATION_MS) {
        clearInterval(interval);
        void finishRecording();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [phase, finishRecording]);

  /**
   * Open the same custom quit modal from every back/cancel control.
   */
  const requestQuitAssessment = useCallback(() => {
    if (cancelInProgressRef.current || exitPromptOpenRef.current) {
      return;
    }

    exitPromptOpenRef.current = true;
    setShowQuitModal(true);
  }, []);

  /**
   * Dismiss the modal and continue the assessment.
   */
  const dismissQuitModal = useCallback(() => {
    if (cancelInProgressRef.current) return;

    exitPromptOpenRef.current = false;
    setShowQuitModal(false);
  }, []);

  /**
   * Confirm quitting:
   * - Stop pending score processing.
   * - Stop the beat guide.
   * - Cancel the microphone recording.
   * - Return to the previous screen without saving the unfinished attempt.
   */
  const confirmQuitAssessment = useCallback(async () => {
    if (cancelInProgressRef.current) return;

    cancelInProgressRef.current = true;
    quitRequestedRef.current = true;
    cancelNextStopRef.current = true;
    finishRequestedRef.current = true;

    clearPendingProcessing();

    setIsCancelling(true);
    setElapsed(0);
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

  /**
   * Android hardware Back opens the same modal.
   */
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

    setShowQuitModal(false);
    setIsCancelling(false);
    setError(null);
    setResult(null);
    setSaveMessage(null);
    setLiveFrame(null);
    setElapsed(0);
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');
  }, [clearPendingProcessing]);

  const handleRetry = useCallback(async () => {
    clearPendingProcessing();

    quitRequestedRef.current = false;
    exitPromptOpenRef.current = false;
    cancelNextStopRef.current = false;

    await stopBeatGuide();

    setShowQuitModal(false);
    setResult(null);
    setSaveMessage(null);
    setError(null);
    setElapsed(0);
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

      Alert.alert(
        'Reference playback unavailable',
        'The reference melody could not be played on this device. You can still try the assessment using the beat guide.',
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
    const note =
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
          <View style={styles.iconCircle}>
            <Ionicons name="mic" size={38} color={BROWN} />
          </View>

          <Text style={styles.title}>Sing with the Beat</Text>
          <Text style={styles.subtitle}>
            Follow the beat. Sing at a comfortable pitch.
          </Text>
        </View>

        <ScrollView
          style={styles.recordingLyricsScroll}
          contentContainerStyle={styles.recordingLyricsContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.recordingLyricsCard}>
            <Text style={styles.recordingLyricsLabel}>
              SING THESE LYRICS
            </Text>
            <Text style={styles.recordingLyricsLine}>
              Mary had a little lamb,
            </Text>
            <Text style={styles.recordingLyricsLine}>
              Little lamb, little lamb,
            </Text>
            <Text style={styles.recordingLyricsLine}>
              Mary had a little lamb,
            </Text>
            <Text style={styles.recordingLyricsLine}>
              Its fleece was white as snow.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>CURRENT NOTE</Text>
          <Text style={styles.liveNote}>{note}</Text>
          <Text style={styles.liveHint}>
            {liveFrame?.pitch
              ? 'Voice detected'
              : 'Sing clearly into the microphone'}
          </Text>

          <View style={styles.beatRow}>
            {[0, 1, 2, 3].map((beat) => (
              <View
                key={beat}
                style={[
                  styles.beatDot,
                  beat === beatIndexRef.current % 4 &&
                    styles.beatDotActive,
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

        <Pressable
          accessibilityRole="button"
          disabled={isCancelling}
          style={[
            styles.stopButton,
            isCancelling && styles.disabledButton,
          ]}
          onPress={() => void finishRecording()}
        >
          <Ionicons
            name="stop-circle-outline"
            size={21}
            color={WHITE}
          />
          <Text style={styles.stopButtonText}>Finish Singing</Text>
        </Pressable>

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

        <Pressable
          accessibilityRole="button"
          disabled={isCancelling}
          style={[
            styles.processingCancelButton,
            isCancelling && styles.disabledButton,
          ]}
          onPress={requestQuitAssessment}
        >
          <Ionicons
            name="close-circle-outline"
            size={20}
            color={BROWN}
          />
          <Text style={styles.processingCancelText}>
            Cancel Assessment
          </Text>
        </Pressable>

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
              weight="50% of score"
            />
            <ScoreRow
              label="Pitch Stability"
              score={result.pitchStability}
              weight="30% of score"
            />
            <ScoreRow
              label="Vocal Consistency"
              score={result.vocalConsistency}
              weight="20% of score"
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

/**
 * Shared TuneUp! quit confirmation modal.
 */
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
      <View style={styles.quitOverlay}>
        <View style={styles.quitCard}>
          <View style={styles.quitIconCircle}>
            <Ionicons
              name="mic-off-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.quitTitle}>Quit Assessment?</Text>

          <Text style={styles.quitMessage}>
            Are you sure you want to quit assessment?
          </Text>

          <Text style={styles.quitHint}>
            Your current progress will not be saved.
          </Text>

          <View style={styles.quitButtonRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="No, continue assessment"
              disabled={isQuitting}
              style={({ pressed }) => [
                styles.quitContinueButton,
                pressed && !isQuitting && styles.quitButtonPressed,
                isQuitting && styles.quitButtonDisabled,
              ]}
              onPress={onContinue}
            >
              <Text style={styles.quitContinueText}>
                No, Continue
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yes, quit assessment"
              disabled={isQuitting}
              style={({ pressed }) => [
                styles.quitConfirmButton,
                pressed && !isQuitting && styles.quitButtonPressed,
                isQuitting && styles.quitButtonDisabled,
              ]}
              onPress={onConfirm}
            >
              {isQuitting ? (
                <ActivityIndicator size="small" color={WHITE} />
              ) : (
                <Text style={styles.quitConfirmText}>Yes, Quit</Text>
              )}
            </Pressable>
          </View>
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
    marginBottom: 14,
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
  recordingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    paddingHorizontal: 24,
    paddingTop: 58,
    paddingBottom: 28,
    justifyContent: 'space-between',
  },
  recordingHeader: {
    alignItems: 'center',
    marginTop: 8,
  },
  liveCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 24,
    alignItems: 'center',
  },
  liveLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: MUTED,
    letterSpacing: 0.8,
  },
  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 42,
    color: BROWN,
    marginTop: 5,
  },
  liveHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
    marginTop: 3,
  },
  beatRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  beatDot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#E7DDE0',
  },
  beatDotActive: {
    backgroundColor: '#D86C89',
    transform: [{ scale: 1.25 }],
  },
  beatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 10,
  },
  timerWrap: {
    alignItems: 'center',
  },
  timer: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    marginBottom: 12,
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
    backgroundColor: '#D86C89',
    borderRadius: 4,
  },
  footerHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 9,
  },
  stopButton: {
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  stopButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: WHITE,
  },
  processingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    justifyContent: 'center',
  },
  processingCancelButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 46,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 23,
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  processingCancelText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: BROWN,
  },
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
  recordingLyricsScroll: {
    flexGrow: 0,
    maxHeight: 150,
    marginTop: 12,
    marginBottom: 12,
  },
  recordingLyricsContent: {
    flexGrow: 1,
  },
  recordingLyricsCard: {
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  recordingLyricsLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: MUTED,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  recordingLyricsLine: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 22,
    color: BROWN,
    textAlign: 'center',
  },

  // Quit assessment modal
  quitOverlay: {
    flex: 1,
    backgroundColor: 'rgba(35, 22, 17, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  quitCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: WHITE,
    borderRadius: 26,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    elevation: 10,
    shadowColor: BROWN,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },
  quitIconCircle: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
  },
  quitTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    lineHeight: 31,
    color: BROWN,
    textAlign: 'center',
    marginBottom: 10,
  },
  quitMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: BROWN,
    textAlign: 'center',
  },
  quitHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  quitButtonRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  quitContinueButton: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: BROWN,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quitConfirmButton: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 24,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quitContinueText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    textAlign: 'center',
  },
  quitConfirmText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: WHITE,
    textAlign: 'center',
  },
  quitButtonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  quitButtonDisabled: {
    opacity: 0.65,
  },
});