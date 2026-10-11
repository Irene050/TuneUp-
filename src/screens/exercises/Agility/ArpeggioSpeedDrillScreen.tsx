import AppHeader from '@/components/appheader';
import {
  ARPEGGIO_SPEED_DRILL_PARAMS,
  type Tier,
} from '@/constants/exercises/agility';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import { generateArpeggioSpeedDrillParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureArpeggioSpeed } from '@/services/measurement/agility/arpeggioSpeedDrill';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreArpeggioSpeed } from '@/services/scoring/agility/arpeggioSpeedDrill';
import { frequencyToNote } from '@/utils/dsp/pitch';
import {
  disposeNotePlayer,
  playNoteSequence,
} from '@/utils/music/notePlayer';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const MAX_RECORDING_SECONDS = 10;
const COUNTDOWN_SECONDS = 3;
const SAMPLE_RATE_FALLBACK = 44100;
const RECENT_SCORE_LIMIT = 5;

type Phase =
  | 'loading'
  | 'ready'
  | 'playing'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

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
  durationMs: number;
};

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function formatSeconds(value: number): string {
  return `${Math.max(0, value).toFixed(1)}s`;
}

function isTier(value: unknown): value is Tier {
  return (
    value === 'beginner' ||
    value === 'intermediate' ||
    value === 'advanced'
  );
}

export default function ArpeggioSpeedDrillScreen() {
  const [tier, setTier] = useState<Tier>('beginner');
  const [phase, setPhase] = useState<Phase>('loading');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [recordingTime, setRecordingTime] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [livePitch, setLivePitch] = useState('--');
  const [tierLoading, setTierLoading] = useState(true);

  const [config, setConfig] = useState(
    ARPEGGIO_SPEED_DRILL_PARAMS.beginner,
  );

  const mountedRef = useRef(false);
  const phaseRef = useRef<Phase>('loading');

  const recordingRef = useRef(false);
  const processingRef = useRef(false);
  const busyRef = useRef(false);
  const cancelRef = useRef(false);
  const stopRequestedRef = useRef(false);

  const sessionIdRef = useRef(0);
  const activeSessionRef = useRef(0);
  const startTimeRef = useRef(0);

  const timerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const countdownRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const processSamplesRef = useRef<
    | ((
        samples: Float32Array,
        sampleRate: number,
        sessionId: number,
      ) => Promise<void>)
    | null
  >(null);

  const stopRecordingRef = useRef<() => Promise<void>>(
    async () => {},
  );

  const setPhaseSafe = useCallback((next: Phase) => {
    phaseRef.current = next;

    if (mountedRef.current) {
      setPhase(next);
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const isCurrentSession = useCallback((sessionId: number) => {
    return (
      mountedRef.current &&
      !cancelRef.current &&
      sessionId === sessionIdRef.current
    );
  }, []);

  // ----------------------------------------------------------
  // LIVE MICROPHONE INPUT
  // ----------------------------------------------------------

  const handleLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (
        !mountedRef.current ||
        !recordingRef.current ||
        phaseRef.current !== 'recording'
      ) {
        return;
      }

      const pitch = frame.pitch;

      if (Number.isFinite(pitch) && pitch > 0) {
        setLivePitch(frame.note || frequencyToNote(pitch));
      } else {
        setLivePitch('--');
      }
    },
    [],
  );

  // ----------------------------------------------------------
  // RECORDING STOP CALLBACK
  // ----------------------------------------------------------

  const handleRecordingStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      const sessionId = activeSessionRef.current;

      recordingRef.current = false;
      stopRequestedRef.current = false;
      clearTimers();

      if (
        !isCurrentSession(sessionId) ||
        processingRef.current
      ) {
        return;
      }

      const process = processSamplesRef.current;

      if (!process) {
        busyRef.current = false;
        setPhaseSafe('ready');

        Alert.alert(
          'Recording unavailable',
          'The recording processor is not ready. Please try again.',
        );
        return;
      }

      void process(
        samples,
        Number.isFinite(sampleRate) && sampleRate > 0
          ? sampleRate
          : SAMPLE_RATE_FALLBACK,
        sessionId,
      );
    },
    [clearTimers, isCurrentSession, setPhaseSafe],
  );

  const {
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  useEffect(() => {
    stopRecordingRef.current = stopAudioRecording;
  }, [stopAudioRecording]);

  // ----------------------------------------------------------
  // LOAD TIER AND ADAPTIVE PARAMETERS
  // ----------------------------------------------------------

  const loadTierAndParams = useCallback(async () => {
    setTierLoading(true);

    try {
      const user = auth.currentUser;

      let loadedTier: Tier = 'beginner';
      let recentScores: number[] = [];

      if (user) {
        // 1. Load the user's current agility tier.
        try {
          const progress = await fetchComponentProgress(
            user.uid,
            'agility',
          );

          if (isTier(progress?.currentTier)) {
            loadedTier = progress.currentTier;
          }
        } catch (error) {
          console.warn(
            'Unable to load agility progress:',
            error,
          );
        }

        if (!mountedRef.current) return;

        // 2. Prefer completed records for this exercise and tier.
        let historyLoaded = false;

        try {
          const records = await fetchExerciseRecords(
            user.uid,
            'agility',
          );

          historyLoaded = true;

          const matchingRecords = records
            .filter(
              record =>
                record.templateId === 'arpeggioSpeedDrill' &&
                record.tier === loadedTier &&
                Number.isFinite(record.scorePct) &&
                Number.isFinite(record.timestamp),
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          recentScores = matchingRecords
            .slice(-RECENT_SCORE_LIMIT)
            .map(record => clamp(record.scorePct));
        } catch (error) {
          console.warn(
            'Unable to load Arpeggio Speed Drill history:',
            error,
          );
        }

        if (!mountedRef.current) return;

        // 3. Only use assessment calibration when the history
        //    query succeeded and no matching exercise records exist.
        //
        //    If history loading failed, do not treat missing data
        //    as proof that the user has no exercise history.
        if (historyLoaded && recentScores.length === 0) {
          try {
            const assessment = await getLatestAssessment();

            const agilityScore = assessment?.scores.find(
              score => score.componentId === 'agility',
            )?.scorePct;

            if (
              typeof agilityScore === 'number' &&
              Number.isFinite(agilityScore)
            ) {
              recentScores = [clamp(agilityScore)];
            }
          } catch (error) {
            console.warn(
              'Unable to load assessment baseline:',
              error,
            );
          }
        }
      }

      if (!mountedRef.current) return;

      // 4. The generator is the single source of truth for
      //    exercise parameter generation.
      //
      //    An empty array preserves the tier's base values.
      const nextConfig = generateArpeggioSpeedDrillParams({
        tier: loadedTier,
        recentScores,
      });

      console.log('Arpeggio Speed Drill ADS:', {
        tier: loadedTier,
        baselineSource:
          recentScores.length === 0
            ? 'default parameters'
            : 'exercise history or initial assessment',
        recentScores,
        params: nextConfig,
      });

      setTier(loadedTier);
      setConfig(nextConfig);
      setPhaseSafe('ready');
    } catch (error) {
      console.error(
        'Unable to load Arpeggio Speed Drill configuration:',
        error,
      );

      if (mountedRef.current) {
        setTier('beginner');
        setConfig(ARPEGGIO_SPEED_DRILL_PARAMS.beginner);
        setPhaseSafe('ready');
      }
    } finally {
      if (mountedRef.current) {
        setTierLoading(false);
      }
    }
  }, [setPhaseSafe]);

  useEffect(() => {
    mountedRef.current = true;
    cancelRef.current = false;

    void loadTierAndParams();

    return () => {
      mountedRef.current = false;
      cancelRef.current = true;
      sessionIdRef.current += 1;
      recordingRef.current = false;

      clearTimers();

      void stopRecordingRef.current().catch(error => {
        console.warn('Recorder cleanup failed:', error);
      });

      void disposeNotePlayer().catch(() => {});
    };
  }, [clearTimers, loadTierAndParams]);

  // ----------------------------------------------------------
  // PLAY REFERENCE NOTES
  // ----------------------------------------------------------

  const playReference = useCallback(async () => {
    if (
      busyRef.current ||
      tierLoading ||
      phaseRef.current !== 'ready'
    ) {
      return;
    }

    busyRef.current = true;
    cancelRef.current = false;

    const sessionId = ++sessionIdRef.current;

    setResult(null);
    setLivePitch('--');
    setPhaseSafe('playing');

    try {
      await disposeNotePlayer();

      if (!isCurrentSession(sessionId)) return;

      const sequence = config.frequencies.map(frequencyHz => ({
        frequencyHz,
        durationSec: config.noteDurationSec,
      }));

      // Pass the tier-specific gap rather than relying on the
      // note player's default gap.
      await playNoteSequence(sequence, config.gapSec);

      if (!isCurrentSession(sessionId)) return;

      setPhaseSafe('ready');
    } catch (error) {
      console.warn('Reference playback failed:', error);

      if (isCurrentSession(sessionId)) {
        setPhaseSafe('ready');

        Alert.alert(
          'Playback unavailable',
          'The reference notes could not be played. Please try again.',
        );
      }
    } finally {
      if (sessionId === sessionIdRef.current) {
        busyRef.current = false;
      }
    }
  }, [
    config,
    isCurrentSession,
    setPhaseSafe,
    tierLoading,
  ]);

  // ----------------------------------------------------------
  // PROCESS RECORDING USING THE MEASUREMENT + SCORING SERVICES
  // ----------------------------------------------------------

  const processRecording = useCallback(
    async (
      samples: Float32Array,
      sampleRate: number,
      sessionId: number,
    ) => {
      if (
        processingRef.current ||
        !isCurrentSession(sessionId)
      ) {
        return;
      }

      processingRef.current = true;
      recordingRef.current = false;
      clearTimers();
      setPhaseSafe('processing');

      try {
        if (!samples || samples.length === 0) {
          throw new Error(
            'No audio was captured. Check your microphone and try again.',
          );
        }

        if (
          !Number.isFinite(sampleRate) ||
          sampleRate <= 0
        ) {
          throw new Error(
            'The recording has an invalid sample rate. Please try again.',
          );
        }

        // The measurement service is responsible for detecting
        // pitches and calculating the measurement values.
        const measurement = measureArpeggioSpeed(
          samples,
          sampleRate,
          config.frequencies,
          config.pitchTolerancePercent,
        );

        if (
          !Number.isFinite(measurement.durationMs) ||
          measurement.durationMs <= 0
        ) {
          throw new Error(
            'The recording was too short to analyze. Please sing the complete arpeggio.',
          );
        }

        if (
          !Number.isFinite(measurement.noteCount) ||
          measurement.noteCount < 1
        ) {
          throw new Error(
            'No usable notes were detected. Try singing closer to the microphone in a quiet area.',
          );
        }

        // The scoring service is the single source of truth for
        // overall score, component scores, pass status, and feedback.
        const scored = scoreArpeggioSpeed(measurement);

        const nextResult: Result = {
          overall: clamp(scored.overall),
          pitchScore: clamp(scored.pitchScore),
          sequenceScore: clamp(scored.sequenceScore),
          speedScore: clamp(scored.speedScore),
          passed: scored.passed,
          feedback: scored.feedback,
          noteCount: measurement.noteCount,
          correctNoteCount: measurement.correctNoteCount,
          notesPerSecond: Number.isFinite(
            measurement.notesPerSecond,
          )
            ? Math.max(0, measurement.notesPerSecond)
            : 0,
          durationMs: measurement.durationMs,
        };

        if (!isCurrentSession(sessionId)) return;

        // Save the score calculated by the scoring service.
        // Do not recalculate a second overall score in the screen.
        const user = auth.currentUser;

        if (user) {
          await saveCompletedExercise(
            'agility',
            'arpeggioSpeedDrill',
            tier,
            nextResult.overall,
          );
        }

        // Prevent an outdated session from changing the UI.
        if (!isCurrentSession(sessionId)) return;

        setResult(nextResult);
        setPhaseSafe('results');
      } catch (error) {
        console.error(
          'Arpeggio Speed Drill processing failed:',
          error,
        );

        if (isCurrentSession(sessionId)) {
          setPhaseSafe('ready');

          Alert.alert(
            'Could not process recording',
            error instanceof Error
              ? error.message
              : 'Please try the exercise again.',
          );
        }
      } finally {
        processingRef.current = false;

        if (sessionId === sessionIdRef.current) {
          busyRef.current = false;
        }
      }
    },
    [
      clearTimers,
      config,
      isCurrentSession,
      setPhaseSafe,
      tier,
    ],
  );

  useEffect(() => {
    processSamplesRef.current = processRecording;
  }, [processRecording]);

  // ----------------------------------------------------------
  // START RECORDING
  // ----------------------------------------------------------

  const startRecording = useCallback(async () => {
    if (
      busyRef.current ||
      tierLoading ||
      phaseRef.current !== 'countdown'
    ) {
      return;
    }

    busyRef.current = true;
    processingRef.current = false;
    stopRequestedRef.current = false;
    cancelRef.current = false;

    const sessionId = sessionIdRef.current;
    activeSessionRef.current = sessionId;

    setRecordingTime(0);
    setResult(null);
    setLivePitch('--');

    try {
      await startAudioRecording();

      if (!isCurrentSession(sessionId)) {
        await stopAudioRecording().catch(() => {});
        return;
      }

      recordingRef.current = true;
      startTimeRef.current = Date.now();

      setPhaseSafe('recording');

      timerRef.current = setInterval(() => {
        if (
          !isCurrentSession(sessionId) ||
          !recordingRef.current
        ) {
          return;
        }

        const elapsed =
          (Date.now() - startTimeRef.current) / 1000;

        setRecordingTime(
          Math.min(elapsed, MAX_RECORDING_SECONDS),
        );

        if (
          elapsed >= MAX_RECORDING_SECONDS &&
          !stopRequestedRef.current
        ) {
          stopRequestedRef.current = true;
          recordingRef.current = false;
          clearTimers();

          void stopRecordingRef.current().catch(error => {
            console.error(
              'Automatic recording stop failed:',
              error,
            );

            if (isCurrentSession(sessionId)) {
              busyRef.current = false;
              setPhaseSafe('ready');

              Alert.alert(
                'Recording error',
                'The recording could not be stopped. Please try again.',
              );
            }
          });
        }
      }, 100);
    } catch (error) {
      console.error('Unable to start recording:', error);

      recordingRef.current = false;
      busyRef.current = false;
      clearTimers();

      if (isCurrentSession(sessionId)) {
        setPhaseSafe('ready');

        Alert.alert(
          'Recording unavailable',
          error instanceof Error
            ? error.message
            : 'Unable to start recording. Please try again.',
        );
      }
    }
  }, [
    clearTimers,
    isCurrentSession,
    setPhaseSafe,
    startAudioRecording,
    stopAudioRecording,
    tierLoading,
  ]);

  // ----------------------------------------------------------
  // COUNTDOWN
  // ----------------------------------------------------------

  const beginCountdown = useCallback(() => {
    if (
      busyRef.current ||
      tierLoading ||
      phaseRef.current !== 'ready'
    ) {
      return;
    }

    busyRef.current = true;
    cancelRef.current = false;

    const sessionId = ++sessionIdRef.current;

    setCountdown(COUNTDOWN_SECONDS);
    setPhaseSafe('countdown');

    let remaining = COUNTDOWN_SECONDS;

    countdownRef.current = setInterval(() => {
      if (!isCurrentSession(sessionId)) {
        clearTimers();
        return;
      }

      remaining -= 1;
      setCountdown(Math.max(remaining, 0));

      if (remaining <= 0) {
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }

        busyRef.current = false;
        void startRecording();
      }
    }, 1000);
  }, [
    clearTimers,
    isCurrentSession,
    setPhaseSafe,
    startRecording,
    tierLoading,
  ]);

  // ----------------------------------------------------------
  // STOP RECORDING EARLY
  // ----------------------------------------------------------

  const stopEarly = useCallback(async () => {
    if (
      phaseRef.current !== 'recording' ||
      !recordingRef.current ||
      stopRequestedRef.current ||
      processingRef.current
    ) {
      return;
    }

    stopRequestedRef.current = true;
    recordingRef.current = false;
    clearTimers();

    try {
      await stopAudioRecording();
    } catch (error) {
      console.error('Unable to finish recording:', error);

      busyRef.current = false;

      if (mountedRef.current) {
        setPhaseSafe('ready');

        Alert.alert(
          'Recording error',
          'Unable to finish the recording. Please try again.',
        );
      }
    }
  }, [clearTimers, setPhaseSafe, stopAudioRecording]);

  // ----------------------------------------------------------
  // CANCEL CURRENT SESSION
  // ----------------------------------------------------------

  const cancelExercise = useCallback(async () => {
    // Invalidate the session before stopping audio so a late
    // recorder callback cannot process the canceled session.
    sessionIdRef.current += 1;
    cancelRef.current = true;
    recordingRef.current = false;
    stopRequestedRef.current = true;
    busyRef.current = false;

    clearTimers();

    try {
      await stopAudioRecording();
    } catch {
      // The recorder may already be stopped.
    }

    try {
      await disposeNotePlayer();
    } catch {
      // The player may already be disposed.
    }

    if (mountedRef.current) {
      setRecordingTime(0);
      setLivePitch('--');
      setResult(null);
      setPhaseSafe('ready');
    }
  }, [clearTimers, setPhaseSafe, stopAudioRecording]);

  const resetExercise = useCallback(async () => {
    await cancelExercise();
  }, [cancelExercise]);

  const isBusy =
    tierLoading ||
    phase === 'playing' ||
    phase === 'countdown' ||
    phase === 'recording' ||
    phase === 'processing';

  const targetDurationSec =
    config.frequencies.length * config.noteDurationSec +
    Math.max(0, config.frequencies.length - 1) *
      config.gapSec;

  // ----------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------

  return (
    <View style={styles.screen}>
      <AppHeader />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => {
            if (!isBusy) {
              router.back();
              return;
            }

            Alert.alert(
              'Exercise in progress',
              'Do you want to cancel this exercise and leave?',
              [
                { text: 'Stay', style: 'cancel' },
                {
                  text: 'Cancel exercise',
                  style: 'destructive',
                  onPress: () => {
                    void cancelExercise();
                    router.back();
                  },
                },
              ],
            );
          }}
          style={styles.backButton}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.title}>Arpeggio Speed Drill</Text>

        <Text style={styles.subtitle}>
          Sing each note in order, keeping your transitions clear
          and controlled.
        </Text>

        <View style={styles.tierCard}>
          <View style={styles.tierTextWrap}>
            <Text style={styles.eyebrow}>YOUR CURRENT LEVEL</Text>
            <Text style={styles.tierName}>
              {tierLoading ? 'Loading…' : tier.toUpperCase()}
            </Text>
          </View>

          <View style={styles.keyBadge}>
            <Text style={styles.keyName}>{config.name}</Text>
            <Text style={styles.keyNotes}>
              {config.notes.join('  ·  ')}
            </Text>
            <Text style={styles.speedLabel}>
              {config.speedLabel}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>How to practice</Text>

          {[
            'Listen to the reference notes.',
            'Sing the same notes in order after the countdown.',
            'Aim for accurate pitch, correct order, and smooth transitions.',
          ].map((instruction, index) => (
            <View key={instruction} style={styles.instructionRow}>
              <Text style={styles.stepNumber}>{index + 1}</Text>
              <Text style={styles.instruction}>{instruction}</Text>
            </View>
          ))}

          <View style={styles.infoStrip}>
            <Text style={styles.infoText}>
              Reference duration: approximately{' '}
              {formatSeconds(targetDurationSec)}
            </Text>
            <Text style={styles.infoText}>
              Pitch tolerance: ±{config.pitchTolerancePercent}%
            </Text>
          </View>
        </View>

        {(phase === 'ready' ||
          phase === 'playing' ||
          phase === 'countdown') && (
          <View style={styles.actionCard}>
            <View style={styles.statusCircle}>
              {phase === 'playing' ? (
                <ActivityIndicator color="#FFFFFF" size="large" />
              ) : (
                <Text style={styles.statusIcon}>
                  {phase === 'countdown' ? countdown : '♫'}
                </Text>
              )}
            </View>

            <Text style={styles.statusTitle}>
              {phase === 'playing'
                ? 'Listen to the notes'
                : phase === 'countdown'
                  ? 'Get ready to sing'
                  : 'Ready when you are'}
            </Text>

            <Text style={styles.statusDescription}>
              {phase === 'playing'
                ? 'Listen carefully to the reference pattern.'
                : phase === 'countdown'
                  ? 'Take a comfortable breath and prepare.'
                  : 'Play the reference first, then start your recording.'}
            </Text>

            <Pressable
              disabled={isBusy}
              onPress={() => void playReference()}
              style={[
                styles.primaryButton,
                isBusy && styles.disabledButton,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                Play Reference Notes
              </Text>
            </Pressable>

            <Pressable
              disabled={isBusy}
              onPress={beginCountdown}
              style={[
                styles.secondaryButton,
                isBusy && styles.disabledButton,
              ]}
            >
              <Text style={styles.secondaryButtonText}>
                I'm Ready — Record
              </Text>
            </Pressable>

            {(phase === 'playing' || phase === 'countdown') && (
              <Pressable
                onPress={() => void cancelExercise()}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelText}>
                  {phase === 'playing'
                    ? 'Cancel playback'
                    : 'Cancel countdown'}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {phase === 'recording' && (
          <View style={styles.actionCard}>
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingLabel}>RECORDING</Text>
            </View>

            <Text style={styles.timer}>
              {recordingTime.toFixed(1)}s
            </Text>

            <Text style={styles.statusDescription}>
              Sing the arpeggio pattern now. Recording ends
              automatically after {MAX_RECORDING_SECONDS} seconds.
            </Text>

            <View style={styles.livePitchCard}>
              <Text style={styles.eyebrow}>
                LIVE NOTE DETECTION
              </Text>
              <Text style={styles.livePitch}>{livePitch}</Text>
              <Text style={styles.helperText}>
                Live notes are estimates. Your final score is
                calculated from the complete recording.
              </Text>
            </View>

            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${
                      (recordingTime / MAX_RECORDING_SECONDS) * 100
                    }%`,
                  },
                ]}
              />
            </View>

            <Pressable
              disabled={stopRequestedRef.current}
              onPress={() => void stopEarly()}
              style={[
                styles.primaryButton,
                stopRequestedRef.current && styles.disabledButton,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                Finish Recording
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void cancelExercise()}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>
                Cancel Recording
              </Text>
            </Pressable>
          </View>
        )}

        {phase === 'processing' && (
          <View style={styles.actionCard}>
            <ActivityIndicator size="large" color="#B66A82" />
            <Text style={styles.statusTitle}>
              Analyzing your performance
            </Text>
            <Text style={styles.statusDescription}>
              Checking pitch accuracy, note sequence, and speed…
            </Text>
          </View>
        )}

        {phase === 'results' && result && (
          <View style={styles.resultsCard}>
            <View style={styles.resultHeader}>
              <View style={styles.resultHeading}>
                <Text style={styles.eyebrow}>EXERCISE RESULT</Text>
                <Text style={styles.resultTitle}>
                  {result.overall >= 85
                    ? 'Excellent work!'
                    : result.passed
                      ? 'Good progress!'
                      : 'Keep practicing!'}
                </Text>
              </View>

              <View style={styles.scoreCircle}>
                <Text style={styles.scoreNumber}>
                  {Math.round(result.overall)}
                </Text>
                <Text style={styles.scoreOutOf}>/100</Text>
              </View>
            </View>

            <Text style={styles.feedback}>{result.feedback}</Text>

            <View style={styles.scoreRow}>
              <ScoreItem label="Pitch" score={result.pitchScore} />
              <ScoreItem
                label="Sequence"
                score={result.sequenceScore}
              />
              <ScoreItem label="Speed" score={result.speedScore} />
            </View>

            <View style={styles.metricsGrid}>
              <Metric
                label="Notes detected"
                value={String(result.noteCount)}
              />
              <Metric
                label="Correct sequence notes"
                value={`${result.correctNoteCount}/${config.frequencies.length}`}
              />
              <Metric
                label="Note rate"
                value={`${result.notesPerSecond.toFixed(2)}/s`}
              />
              <Metric
                label="Recording duration"
                value={formatSeconds(result.durationMs / 1000)}
              />
            </View>

            <Text style={styles.disclaimer}>
              Note rate is estimated from detected notes and may
              differ from your actual singing speed if notes are
              missed or repeated.
            </Text>

            <Pressable
              onPress={() => void resetExercise()}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                Try Again
              </Text>
            </Pressable>

            <Pressable
              onPress={() => router.back()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>
                Back to Exercises
              </Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.footer}>
          Sing comfortably. Stop if your voice feels strained.
        </Text>
      </ScrollView>
    </View>
  );
}

function ScoreItem({
  label,
  score,
}: {
  label: string;
  score: number;
}) {
  const safeScore = clamp(score);

  return (
    <View style={styles.scoreItem}>
      <View style={styles.scoreItemHeader}>
        <Text style={styles.scoreLabel}>{label}</Text>
        <Text style={styles.scoreValue}>
          {Math.round(safeScore)}%
        </Text>
      </View>

      <View style={styles.miniTrack}>
        <View
          style={[
            styles.miniFill,
            { width: `${safeScore}%` },
          ]}
        />
      </View>
    </View>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFF8FA',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingRight: 16,
    marginBottom: 6,
  },
  backText: {
    color: '#4E2F1F',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    color: '#4E2F1F',
    fontSize: 27,
    fontWeight: '800',
    marginBottom: 6,
  },
  subtitle: {
    color: '#8E7770',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  tierCard: {
    backgroundColor: '#FCD6DD',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  tierTextWrap: {
    flex: 1,
  },
  eyebrow: {
    color: '#8E7770',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  tierName: {
    color: '#4E2F1F',
    fontSize: 18,
    fontWeight: '800',
  },
  keyBadge: {
    alignItems: 'flex-end',
    flexShrink: 1,
  },
  keyName: {
    color: '#4E2F1F',
    fontSize: 16,
    fontWeight: '800',
  },
  keyNotes: {
    color: '#704B48',
    fontSize: 11,
    marginTop: 4,
  },
  speedLabel: {
    color: '#704B48',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },
  sectionTitle: {
    color: '#4E2F1F',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 14,
  },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 10,
  },
  stepNumber: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: '#FCD6DD',
    color: '#4E2F1F',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontWeight: '800',
    overflow: 'hidden',
  },
  instruction: {
    flex: 1,
    color: '#604B43',
    fontSize: 13,
    lineHeight: 20,
    paddingTop: 2,
  },
  infoStrip: {
    backgroundColor: '#FFF8FA',
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginTop: 4,
  },
  infoText: {
    color: '#704B48',
    fontSize: 12,
    fontWeight: '600',
  },
  actionCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    padding: 22,
    marginBottom: 16,
  },
  statusCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#B66A82',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statusIcon: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
  },
  statusTitle: {
    color: '#4E2F1F',
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  statusDescription: {
    color: '#8E7770',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 18,
  },
  primaryButton: {
    backgroundColor: '#B66A82',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 18,
    width: '100%',
    alignItems: 'center',
    marginTop: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButton: {
    backgroundColor: '#FCD6DD',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 18,
    width: '100%',
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryButtonText: {
    color: '#4E2F1F',
    fontSize: 14,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.5,
  },
  cancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: {
    color: '#8E7770',
    fontSize: 13,
    fontWeight: '700',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#C94F67',
  },
  recordingLabel: {
    color: '#C94F67',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  timer: {
    color: '#4E2F1F',
    fontSize: 42,
    fontWeight: '900',
    marginBottom: 8,
  },
  livePitchCard: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: '#FFF8FA',
    padding: 16,
    alignItems: 'center',
    marginBottom: 14,
  },
  livePitch: {
    color: '#4E2F1F',
    fontSize: 30,
    fontWeight: '900',
    marginVertical: 4,
  },
  helperText: {
    color: '#8E7770',
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  progressTrack: {
    height: 8,
    width: '100%',
    borderRadius: 5,
    backgroundColor: '#F2DDE5',
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#B66A82',
    borderRadius: 5,
  },
  resultsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    padding: 18,
    marginBottom: 16,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  resultHeading: {
    flex: 1,
  },
  resultTitle: {
    color: '#4E2F1F',
    fontSize: 21,
    fontWeight: '900',
  },
  scoreCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#FCD6DD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNumber: {
    color: '#4E2F1F',
    fontSize: 25,
    fontWeight: '900',
  },
  scoreOutOf: {
    color: '#704B48',
    fontSize: 10,
    fontWeight: '700',
  },
  feedback: {
    color: '#704B48',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 18,
  },
  scoreRow: {
    gap: 14,
    marginBottom: 18,
  },
  scoreItem: {
    gap: 7,
  },
  scoreItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreLabel: {
    color: '#604B43',
    fontSize: 12,
    fontWeight: '700',
  },
  scoreValue: {
    color: '#4E2F1F',
    fontSize: 12,
    fontWeight: '900',
  },
  miniTrack: {
    height: 7,
    backgroundColor: '#F2DDE5',
    borderRadius: 5,
    overflow: 'hidden',
  },
  miniFill: {
    height: '100%',
    backgroundColor: '#B66A82',
    borderRadius: 5,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#FFF8FA',
    borderRadius: 12,
    padding: 12,
    minHeight: 76,
    justifyContent: 'center',
  },
  metricValue: {
    color: '#4E2F1F',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 5,
  },
  metricLabel: {
    color: '#8E7770',
    fontSize: 11,
    lineHeight: 15,
  },
  disclaimer: {
    color: '#8E7770',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 14,
  },
  footer: {
    color: '#A18E87',
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 4,
  },
});