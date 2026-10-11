import {
  ARPEGGIO_SPEED_DRILL_PARAMS,
  type Tier,
} from '@/constants/exercises/agility';
import ExerciseScreen from '@/screens/exercises/ExerciseScreen';
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
import { playNoteSequence } from '@/utils/music/notePlayer';
import { frequencyToNoteName } from '@/utils/music/notes';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
// ============================================================
// COLORS
// ============================================================
const BROWN = '#4E2F1F';

const PINK = '#FCD6DD';

const LIGHT_PINK = '#FFF8FA';

const WHITE = '#FFFFFF';

const MUTED = '#8E7770';

const LIGHT_GRAY = '#F2F2F2';

const BORDER = '#F2DDE5';
// ============================================================
// CONFIG
// ============================================================
const SAMPLE_RATE = 44100;

const BUFFER_SIZE = 4410;

const MAX_RECORDING_SECONDS = 10;

const COUNTDOWN_SECONDS = 3;
// ============================================================
// TYPES
// ============================================================
type Phase =
  | 'instructions'
  | 'reference'
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
  averageNoteDurationMs: number;
  durationMs: number;
};
// ============================================================
// HELPERS
// ============================================================
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// Lightweight autocorrelation estimate used only for on-screen guidance.
// Final exercise scoring continues to use measureArpeggioSpeed().
const estimateLiveFrequency = (samples: number[], sampleRate: number): number | null => {
  if (samples.length < 1024) return null;

  const data = samples.slice(-2048);
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;

  let energy = 0;
  let peakToPeakMin = Infinity;
  let peakToPeakMax = -Infinity;
  const centered = new Array<number>(data.length);
  for (let i = 0; i < data.length; i++) {
    const value = data[i] - mean;
    centered[i] = value;
    energy += value * value;
    peakToPeakMin = Math.min(peakToPeakMin, value);
    peakToPeakMax = Math.max(peakToPeakMax, value);
  }

  const rms = Math.sqrt(energy / data.length);
  const peakToPeak = peakToPeakMax - peakToPeakMin;

  // Ignore silence, room noise, and very weak microphone input.
  if (rms < 0.015 || peakToPeak < 0.04) return null;

  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.min(Math.floor(sampleRate / 70), data.length - 1);
  let bestLag = -1;
  let bestCorrelation = 0;

  // Normalized autocorrelation helps reject noise that otherwise produces
  // a plausible-looking frequency even when the user is not singing.
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

  // Require a clear periodic signal before treating it as a sung note.
  if (bestLag < 1 || bestCorrelation < 0.65) return null;

  const frequency = sampleRate / bestLag;
  return frequency >= 70 && frequency <= 1000 ? frequency : null;
};

const pitchDistanceInSemitones = (actualHz: number, targetHz: number) =>
  Math.abs(12 * Math.log2(actualHz / targetHz));

// ============================================================
// COMPONENT
// ============================================================
export default function ArpeggioSpeedDrillScreen() {
  // ----------------------------------------------------------
  // CURRENT USER + TIER
  // ----------------------------------------------------------
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
        console.error(
          '❌ Failed to load current Agility tier:',
          error,
        );
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
  // ----------------------------------------------------------
  // ACTIVE TIER + BASE CONFIG
  // ----------------------------------------------------------
  const activeTier: Tier = tier ?? 'beginner';
  const baseConfig = useMemo(
    () => ARPEGGIO_SPEED_DRILL_PARAMS[activeTier],
    [activeTier],
  );
  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------
  const [config, setConfig] = useState(baseConfig);
  const [phase, setPhase] =
    useState<Phase>('instructions');
  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);
  const [recordingTime, setRecordingTime] =
    useState(0);
  const [livePitchHz, setLivePitchHz] = useState<number | null>(null);
  const [referenceNoteIndex, setReferenceNoteIndex] = useState<number | null>(null);
  const [isPlayingReference, setIsPlayingReference] = useState(false);

  const [result, setResult] =
    useState<Result | null>(null);
  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------
  const audioContextRef =
    useRef<AudioContext | null>(null);
  const recorderRef =
    useRef<AudioRecorder | null>(null);
  const samplesRef =
    useRef<number[]>([]);
  const recordingStartRef =
    useRef<number | null>(null);
  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );
  const processingRef =
    useRef(false);
  // ----------------------------------------------------------
  // ADAPTIVE DIFFICULTY SCALING
  // ----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const loadAdaptiveParameters = async () => {
      if (tierLoading || !tier) {
        return;
      }
      const user = auth.currentUser;
      if (!user) {
        if (!cancelled) {
          setConfig(baseConfig);
        }
        return;
      }
      try {
        const records = await fetchExerciseRecords(
          user.uid,
          'agility',
        );
        if (cancelled) {
          return;
        }
        const currentExerciseRecords = records
          .filter(
            (record) =>
              record.templateId ===
                'arpeggioSpeedDrill' &&
              record.tier === tier,
          )
          .sort(
            (a, b) =>
              a.timestamp - b.timestamp,
          );
        let recentScores: number[] = [];
        // ----------------------------------------------------
        // USE LATEST FIVE COMPLETED EXERCISES
        // ----------------------------------------------------
        if (currentExerciseRecords.length > 0) {
          recentScores =
            currentExerciseRecords
              .slice(-5)
              .map(
                (record) =>
                  record.scorePct,
              );
        } else {
          // --------------------------------------------------
          // COLD START:
          // USE LATEST ASSESSMENT SCORE IF AVAILABLE
          // --------------------------------------------------
          const latestAssessment =
            await getLatestAssessment();
          if (cancelled) {
            return;
          }
          const agilityAssessmentScore =
            latestAssessment?.scores.find(
              (score) =>
                score.componentId ===
                'agility',
            )?.scorePct;
          if (
            typeof agilityAssessmentScore ===
            'number'
          ) {
            recentScores = [
              agilityAssessmentScore,
            ];
          }
        }
        // ----------------------------------------------------
        // GENERATE ADAPTIVE PARAMETERS
        // ----------------------------------------------------
        const generated =
          generateArpeggioSpeedDrillParams({
            tier,
            recentScores,
          });
        if (!cancelled) {
          setConfig(generated);
        }
      } catch (error) {
        console.error(
          '❌ Failed to load Arpeggio Speed Drill adaptive parameters:',
          error,
        );
        if (!cancelled) {
          setConfig(baseConfig);
        }
      }
    };
    void loadAdaptiveParameters();
    return () => {
      cancelled = true;
    };
  }, [
    tier,
    tierLoading,
    baseConfig,
  ]);
  // ----------------------------------------------------------
  // CLEANUP
  // ----------------------------------------------------------
  useEffect(() => {
    return () => {
      stopRecording();
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {}
      }
    };
  }, []);
  // ----------------------------------------------------------
  // MICROPHONE PERMISSION
  // ----------------------------------------------------------
  const requestMicrophonePermission =
    async (): Promise<boolean> => {
      try {
        const permission =
          await AudioManager.requestRecordingPermissions();
        return permission === 'Granted';
      } catch (error) {
        console.warn(
          'Microphone permission request failed:',
          error,
        );
        return false;
      }
    };
  // ----------------------------------------------------------
  // REFERENCE PLAYBACK
  // ----------------------------------------------------------
  const playReference = async () => {
    if (isPlayingReference || !config.frequencies.length) return;

    setIsPlayingReference(true);
    setReferenceNoteIndex(null);

    const sequence = config.frequencies.map((frequencyHz) => ({
      frequencyHz,
      durationSec: config.noteDurationSec,
    }));

    try {
      // Play through the existing shared player, while highlighting the
      // corresponding card only during that note's expected sounding window.
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
  // ----------------------------------------------------------
  // BEGIN EXERCISE
  // ----------------------------------------------------------
  const beginExercise = async () => {
    const permission =
      await requestMicrophonePermission();
    if (!permission) {
      return;
    }
    setPhase('reference');
  };
  // ----------------------------------------------------------
  // START COUNTDOWN
  // ----------------------------------------------------------
  const startCountdown = async () => {
    setPhase('countdown');
    for (
      let value = COUNTDOWN_SECONDS;
      value >= 1;
      value--
    ) {
      setCountdown(value);
      await sleep(1000);
    }
    await startRecording();
  };
  // ----------------------------------------------------------
  // START RECORDING
  // ----------------------------------------------------------
  const startRecording = async () => {
    try {
      processingRef.current = false;
      samplesRef.current = [];
      setLivePitchHz(null);
      const recorder =
        new AudioRecorder();
      recorderRef.current = recorder;
      const callbackResult =
        recorder.onAudioReady(
          {
            sampleRate: SAMPLE_RATE,
            bufferLength:
              BUFFER_SIZE,
            channelCount: 1,
          },
          ({
            buffer,
            numFrames,
          }) => {
            try {
              const channelData =
                buffer.getChannelData(0);
              const frameCount =
                Math.min(
                  numFrames,
                  channelData.length,
                );
              for (
                let i = 0;
                i < frameCount;
                i++
              ) {
                samplesRef.current.push(
                  channelData[i],
                );
              }
              const liveWindow = Array.from(
                channelData.slice(Math.max(0, frameCount - 2048), frameCount),
              );
              const detectedHz = estimateLiveFrequency(liveWindow, SAMPLE_RATE);
              setLivePitchHz(detectedHz);
            } catch {}
          },
        );
      if (
        callbackResult.status ===
        'error'
      ) {
        console.warn(
          callbackResult.message,
        );
        recorderRef.current = null;
        setPhase('instructions');
        return;
      }
      const startResult =
        await recorder.start();
      if (
        startResult.status ===
        'error'
      ) {
        console.warn(
          'Could not start recorder:',
          startResult.message,
        );
        try {
          recorder.clearOnAudioReady();
        } catch {}
        recorderRef.current = null;
        setPhase('instructions');
        return;
      }
      recordingStartRef.current =
        Date.now();
      setRecordingTime(0);
      setPhase('recording');
      recordingTimerRef.current =
        setInterval(() => {
          const start =
            recordingStartRef.current;
          if (!start) {
            return;
          }
          const elapsed =
            (Date.now() - start) /
            1000;
          setRecordingTime(
            Math.min(
              elapsed,
              MAX_RECORDING_SECONDS,
            ),
          );
          if (
            elapsed >=
            MAX_RECORDING_SECONDS
          ) {
            void processRecording();
          }
        }, 100);
    } catch (error) {
      console.warn(
        'Recording failed:',
        error,
      );
      setPhase('instructions');
    }
  };
  // ----------------------------------------------------------
  // STOP RECORDING
  // ----------------------------------------------------------
  const stopRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(
        recordingTimerRef.current,
      );
      recordingTimerRef.current =
        null;
    }
    if (recorderRef.current) {
      try {
        recorderRef.current.clearOnAudioReady();
      } catch {}
      try {
        recorderRef.current.stop();
      } catch {}
      recorderRef.current = null;
    }
    recordingStartRef.current =
      null;
  };
  // ----------------------------------------------------------
  // PROCESS RECORDING
  // ----------------------------------------------------------
  const processRecording = async () => {
    if (processingRef.current) {
      return;
    }
    processingRef.current = true;
    stopRecording();
    setPhase('processing');
    await sleep(500);
    try {
      const samples =
        new Float32Array(
          samplesRef.current,
        );
      const measurement =
        measureArpeggioSpeed(
          samples,
          SAMPLE_RATE,
          config.frequencies,
          config.pitchTolerancePercent,
        );
      const scored =
        scoreArpeggioSpeed(
          measurement,
        );
      // ----------------------------------------------------
      // SAVE EXERCISE PROGRESS
      // ----------------------------------------------------
      try {
        if (tier) {
          await saveCompletedExercise(
            'agility',
            'arpeggioSpeedDrill',
            tier,
            scored.overall,
          );
        }
        console.log(
          '💾 Arpeggio Speed Drill progress saved:',
          scored.overall,
        );
      } catch (saveError) {
        console.error(
          '❌ Failed to save Arpeggio Speed Drill progress:',
          saveError,
        );
      }
      // ----------------------------------------------------
      // RESULTS
      // ----------------------------------------------------
      setResult({
        overall: scored.overall,
        pitchScore: scored.pitchScore,
        sequenceScore:
          scored.sequenceScore,
        speedScore: scored.speedScore,
        passed: scored.passed,
        feedback: scored.feedback,
        noteCount: measurement.noteCount,
        correctNoteCount:
          measurement.correctNoteCount,
        notesPerSecond:
          measurement.notesPerSecond,
        averageNoteDurationMs:
          measurement.averageNoteDurationMs,
        durationMs:
          measurement.durationMs,
      });
      setPhase('results');
    } catch (error) {
      console.warn(
        'Processing failed:',
        error,
      );
      processingRef.current = false;
      setPhase('instructions');
    }
  };
  // ----------------------------------------------------------
  // RESET
  // ----------------------------------------------------------
  const resetExercise = () => {
    processingRef.current = false;
    setResult(null);
    setRecordingTime(0);
    setCountdown(
      COUNTDOWN_SECONDS,
    );
    samplesRef.current = [];
    setPhase('instructions');
  };
  // ============================================================
  // INSTRUCTIONS
  // ============================================================
  const renderInstructions = () => {
    const difficulty =
      tier
        ? tier.charAt(0).toUpperCase() +
          tier.slice(1)
        : 'Beginner';
    return (
      <ExerciseScreen
        title="Arpeggio Speed Drill"
        category="Vocal Agility"
        icon="flash-outline"
        instructions="Listen carefully to the reference arpeggio, then sing the notes in order while gradually maintaining accuracy at the required speed."
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
            value: difficulty,
          },
          {
            label: 'SPEED',
            value: config.speedLabel,
          },
          {
            label: 'NOTES',
            value: String(
              config.frequencies.length,
            ),
          },
          {
            label: 'NOTE DURATION',
            value: `${config.noteDurationSec.toFixed(
              2,
            )}s`,
          },
          {
            label: 'ARPEGGIO',
            value: config.notes.join(
              ' • ',
            ),
          },
        ]}
        tip="Focus on matching each note accurately first. Gradually build speed while keeping the sequence clear and controlled."
        tier={tier}
        startDisabled={tierLoading}
        startLabel={
          tierLoading
            ? 'Preparing Exercise...'
            : 'Start Exercise'
        }
        onBack={() => router.back()}
        onStart={beginExercise}
      />
    );
  };
  // ============================================================
  // REFERENCE
  // ============================================================
  const renderReference = () => (
    <View style={styles.content}>
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
        Listen to the complete arpeggio,
        then sing the same notes in order.
      </Text>
      <View style={styles.paceGuideCard}>
        <View style={styles.paceGuideHeader}>
          <Ionicons name="speedometer-outline" size={18} color={BROWN} />
          <Text style={styles.paceGuideTitle}>Your Pace Guide</Text>
        </View>
        <Text style={styles.paceGuideDescription}>
          Sing one note at a time. Keep each note clear, then move to the next note after the short gap.
        </Text>
        <View style={styles.paceGuideStats}>
          <View style={styles.paceGuideStat}>
            <Text style={styles.paceGuideLabel}>NOTE DURATION</Text>
            <Text style={styles.paceGuideValue}>{config.noteDurationSec.toFixed(2)} s</Text>
          </View>
          <View style={styles.paceGuideDivider} />
          <View style={styles.paceGuideStat}>
            <Text style={styles.paceGuideLabel}>GAP BETWEEN NOTES</Text>
            <Text style={styles.paceGuideValue}>{config.gapSec.toFixed(2)} s</Text>
          </View>
        </View>
        <Text style={styles.paceGuideHint}>
          Tip: Follow the reference timing instead of rushing. Accuracy comes first.
        </Text>
      </View>
      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>
          REFERENCE ARPEGGIO
        </Text>
        <View style={styles.noteSequence}>
          {config.frequencies.map(
            (frequency, index) => (
              <View
                key={`${frequency}-${index}`}
                style={[
                  styles.notePill,
                  referenceNoteIndex === index && styles.referenceNoteActive,
                ]}
              >
                <Text
                  style={styles.noteNumber}
                >
                  {index + 1}
                </Text>
                <Text style={styles.noteText}>
                  {frequencyToNoteName(
                    frequency,
                  )}
                </Text>
              </View>
            ),
          )}
        </View>
        <Text style={styles.referenceHint}>
          Listen to the complete pattern
          before starting.
        </Text>
      </View>
      <Pressable
        style={styles.referenceButton}
        disabled={isPlayingReference}
        onPress={() => void playReference()}
      >
        <Ionicons
          name="play"
          size={18}
          color={BROWN}
        />
        <Text
          style={
            styles.referenceButtonText
          }
        >
          {isPlayingReference ? 'Playing Reference...' : 'Play Reference'}
        </Text>
      </Pressable>
      <Pressable
        style={styles.startButton}
        onPress={startCountdown}
      >
        <Text style={styles.startButtonText}>
          I'm Ready
        </Text>
      </Pressable>
    </View>
  );
  // ============================================================
  // COUNTDOWN
  // ============================================================
  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="flash-outline"
          size={34}
          color={BROWN}
        />
      </View>
      <Text style={styles.phaseTitle}>
        Get Ready
      </Text>
      <Text style={styles.countdownText}>
        {countdown}
      </Text>
      <Text style={styles.phaseSubtitle}>
        Prepare to sing the arpeggio in
        sequence.
      </Text>
    </View>
  );
  // ============================================================
  // RECORDING
  // ============================================================
  const renderRecording = () => {
    const progress = Math.min(
      recordingTime /
        MAX_RECORDING_SECONDS,
      1,
    );
    return (
      <View style={styles.content}>
        <View style={styles.recordingIcon}>
          <Ionicons
            name="mic"
            size={34}
            color={BROWN}
          />
        </View>
        <Text style={styles.recordingTitle}>
          Sing the Arpeggio
        </Text>
        <Text style={styles.recordingSubtitle}>
          Follow the notes in order while
          keeping each note accurate and
          clear.
        </Text>
        <View style={styles.recordingPaceCard}>
          <Ionicons name="timer-outline" size={18} color={BROWN} />
          <View style={styles.recordingPaceTextWrap}>
            <Text style={styles.recordingPaceTitle}>Stay on the beat</Text>
            <Text style={styles.recordingPaceText}>
              Hold each note for {config.noteDurationSec.toFixed(2)} s, then leave a {config.gapSec.toFixed(2)} s gap before the next one.
            </Text>
          </View>
        </View>
        <View style={styles.referenceCard}>
          <Text style={styles.cardTitle}>
            Sing This Sequence
          </Text>
          <View style={styles.noteSequence}>
            {config.frequencies.map(
              (frequency, index) => (
                <View
                  key={`${frequency}-${index}`}
                  style={[
                    styles.notePill,
                    (() => {
                      const interval = Math.max(0.05, config.noteDurationSec + config.gapSec);
                      const targetIndex = Math.min(
                        config.frequencies.length - 1,
                        Math.floor(recordingTime / interval),
                      );
                      if (index !== targetIndex || livePitchHz === null) return styles.notePending;
                      const distance = pitchDistanceInSemitones(livePitchHz, frequency);
                      if (distance <= 0.5) return styles.noteCorrect;
                      if (distance <= 1.5) return styles.noteClose;
                      return styles.noteIncorrect;
                    })(),
                  ]}
                >
                  <Text style={styles.noteNumber}>{index + 1}</Text>
                  <Text style={styles.noteText}>{frequencyToNoteName(frequency)}</Text>
                  {(() => {
                    const interval = Math.max(0.05, config.noteDurationSec + config.gapSec);
                    const targetIndex = Math.min(
                      config.frequencies.length - 1,
                      Math.floor(recordingTime / interval),
                    );
                    if (index !== targetIndex || livePitchHz === null) return null;
                    const distance = pitchDistanceInSemitones(livePitchHz, frequency);
                    const label = distance <= 0.5 ? 'Correct' : distance <= 1.5 ? 'Close' : 'Off pitch';
                    const labelColor = distance <= 0.5 ? '#218653' : distance <= 1.5 ? '#B7791F' : '#C43D4B';
                    return <Text style={[styles.noteStatus, { color: labelColor }]}>{label}</Text>;
                  })()}
                </View>
              ),
            )}
          </View>
        </View>
        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />
          <Text
            style={
              styles.recordingBadgeText
            }
          >
            RECORDING
          </Text>
        </View>
        <Text style={styles.timerText}>
          Recording Time:{' '}
          {recordingTime.toFixed(1)}s
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
        <Pressable
          style={styles.finishButton}
          onPress={processRecording}
        >
          <Ionicons
            name="stop"
            size={18}
            color={BROWN}
          />
          <Text
            style={
              styles.finishButtonText
            }
          >
            Finish Recording
          </Text>
        </Pressable>
      </View>
    );
  };
  // ============================================================
  // PROCESSING
  // ============================================================
  const renderProcessing = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <ActivityIndicator
          size="large"
          color={BROWN}
        />
      </View>
      <Text style={styles.phaseTitle}>
        Analyzing Your Singing
      </Text>
      <Text style={styles.phaseSubtitle}>
        Measuring pitch accuracy, note
        sequence, and singing speed.
      </Text>
    </View>
  );
  // ============================================================
  // RESULTS
  // ============================================================
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
            name={
              result.passed
                ? 'checkmark'
                : 'refresh'
            }
            size={40}
            color={BROWN}
          />
        </View>
        <Text style={styles.resultTitle}>
          {result.passed
            ? 'Great Job!'
            : 'Keep Practicing!'}
        </Text>
        <Text style={styles.resultSubtitle}>
          Arpeggio Speed Drill Result
        </Text>
        {/* Overall */}
        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>
            OVERALL SCORE
          </Text>
          <Text style={styles.scoreValue}>
            {result.overall}
          </Text>
          <Text
            style={styles.scoreDescription}
          >
            out of 100
          </Text>
        </View>
        {/* Breakdown */}
        <View style={styles.resultCard}>
          <Text
            style={styles.resultCardTitle}
          >
            Performance Breakdown
          </Text>
          <View style={styles.scoreRow}>
            <View
              style={styles.scoreRowHeader}
            >
              <Text
                style={styles.scoreRowLabel}
              >
                Pitch Accuracy
              </Text>
              <Text
                style={styles.scoreRowValue}
              >
                {result.pitchScore}%
              </Text>
            </View>
            <View
              style={styles.progressBackground}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(
                      Math.max(
                        result.pitchScore,
                        0,
                      ),
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>
          <View style={styles.scoreRow}>
            <View
              style={styles.scoreRowHeader}
            >
              <Text
                style={styles.scoreRowLabel}
              >
                Sequence Accuracy
              </Text>
              <Text
                style={styles.scoreRowValue}
              >
                {result.sequenceScore}%
              </Text>
            </View>
            <View
              style={styles.progressBackground}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(
                      Math.max(
                        result.sequenceScore,
                        0,
                      ),
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>
          <View style={styles.scoreRowLast}>
            <View
              style={styles.scoreRowHeader}
            >
              <Text
                style={styles.scoreRowLabel}
              >
                Speed Score
              </Text>
              <Text
                style={styles.scoreRowValue}
              >
                {result.speedScore}%
              </Text>
            </View>
            <View
              style={styles.progressBackground}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(
                      Math.max(
                        result.speedScore,
                        0,
                      ),
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>
        {/* Metrics */}
        <View style={styles.resultCard}>
          <Text
            style={styles.resultCardTitle}
          >
            Performance Metrics
          </Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>
              Correct Notes
            </Text>
            <Text style={styles.metricValue}>
              {result.correctNoteCount}/
              {result.noteCount}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>
              Notes per Second
            </Text>
            <Text style={styles.metricValue}>
              {result.notesPerSecond.toFixed(
                2,
              )}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>
              Average Note Duration
            </Text>
            <Text style={styles.metricValue}>
              {result.averageNoteDurationMs > 0
                ? result.averageNoteDurationMs.toFixed(
                    0,
                  )
                : '0'}{' '}
              ms
            </Text>
          </View>
          <View
            style={[
              styles.metricRow,
              styles.metricRowLast,
            ]}
          >
            <Text style={styles.metricLabel}>
              Duration
            </Text>
            <Text style={styles.metricValue}>
              {(
                result.durationMs / 1000
              ).toFixed(1)}
              s
            </Text>
          </View>
        </View>
        {/* Feedback */}
        <View style={styles.tipCard}>
          <Ionicons
            name="bulb-outline"
            size={20}
            color={BROWN}
          />
          <Text style={styles.tipText}>
            {result.feedback}
          </Text>
        </View>
        {/* Retry */}
        <Pressable
          style={styles.startButton}
          onPress={resetExercise}
        >
          <Ionicons
            name="refresh"
            size={18}
            color={WHITE}
          />
          <Text
            style={styles.startButtonText}
          >
            Try Again
          </Text>
        </Pressable>
        {/* Done */}
        <Pressable
          style={styles.doneButton}
          onPress={() =>
            router.replace(
              '/dashboard?tab=exercises',
            )
          }
        >
          <Text style={styles.doneButtonText}>
            Done
          </Text>
        </Pressable>
      </View>
    );
  };
  // ============================================================
  // MAIN RENDER
  // ============================================================
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={
        phase === 'results'
          ? styles.resultsWrapper
          : undefined
      }
      showsVerticalScrollIndicator={false}
    >
      {phase === 'instructions' &&
        renderInstructions()}
      {phase === 'reference' &&
        renderReference()}
      {phase === 'countdown' &&
        renderCountdown()}
      {phase === 'recording' &&
        renderRecording()}
      {phase === 'processing' &&
        renderProcessing()}
      {phase === 'results' &&
        renderResults()}
    </ScrollView>
  );
}
// ============================================================
// STYLES
// ============================================================
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 92,
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
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
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
  },
  paceGuideCard: {
    width: '100%',
    marginTop: 18,
    padding: 16,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
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
    color: BROWN,
  },
  paceGuideDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
  },
  paceGuideStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 13,
    backgroundColor: LIGHT_PINK,
  },
  paceGuideStat: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  paceGuideDivider: {
    width: 1,
    height: 34,
    backgroundColor: BORDER,
  },
  paceGuideLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    letterSpacing: 0.4,
    color: MUTED,
    textAlign: 'center',
  },
  paceGuideValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginTop: 4,
  },
  paceGuideHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: BROWN,
    textAlign: 'center',
    marginTop: 11,
  },
  recordingPaceCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 13,
    marginTop: 16,
    borderRadius: 15,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
  },
  recordingPaceTextWrap: {
    flex: 1,
  },
  recordingPaceTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
    marginBottom: 3,
  },
  recordingPaceText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
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
  referenceNoteActive: {
    backgroundColor: PINK,
    borderWidth: 1,
    borderColor: '#E88FA2',
  },
  notePending: {
    backgroundColor: '#F1EDEB',
  },
  noteCorrect: {
    backgroundColor: '#CDEEDB',
    borderWidth: 1,
    borderColor: '#218653',
  },
  noteClose: {
    backgroundColor: '#FBE6B8',
    borderWidth: 1,
    borderColor: '#B7791F',
  },
  noteIncorrect: {
    backgroundColor: '#F8D3D7',
    borderWidth: 1,
    borderColor: '#C43D4B',
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
    height: 54,
    borderRadius: 27,
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
  finishButton: {
    width: '100%',
    height: 53,
    borderRadius: 27,
    backgroundColor: LIGHT_GRAY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  finishButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
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
    backgroundColor: BROWN,
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
    marginTop: 22,
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
  },
  liveDivider: {
    width: '100%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 15,
  },
  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 6,
  },
  liveStat: {
    flex: 1,
    alignItems: 'center',
  },
  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginTop: 3,
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
    backgroundColor: PINK,
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
});
