import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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

import type { Tier } from '@/constants/exercises/agility';

import {
  measureArpeggioSpeed,
  type ArpeggioSpeedMeasurement,
} from '@/services/measurement/agility/arpeggioSpeedDrill';

import {
  scoreArpeggioSpeed,
  type ArpeggioSpeedScore,
} from '@/services/scoring/agility/arpeggioSpeedDrill';

import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';

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

const GREEN = '#39734A';
const RED = '#A04444';

// ============================================================
// CONFIG
// ============================================================

const SAMPLE_RATE = 44100;
const BUFFER_LENGTH = 4410; // 100 ms
const MAX_RECORDING_SECONDS = 10;

// ============================================================
// TYPES
// ============================================================

type Props = {
  tier: Tier;
};

type Phase =
  | 'instructions'
  | 'reference'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

type ResultData = {
  measurement: ArpeggioSpeedMeasurement;
  score: ArpeggioSpeedScore;
};

// ============================================================
// ARPEGGIO CONFIGURATION
// ============================================================

const ARPEGGIOS: Record<
  Tier,
  {
    name: string;
    notes: string[];
    frequencies: number[];
    speedLabel: string;
  }
> = {
  beginner: {
    name: 'C Major Arpeggio',
    notes: ['C4', 'E4', 'G4', 'C5'],
    frequencies: [261.63, 329.63, 392.0, 523.25],
    speedLabel: 'Slow',
  },

  intermediate: {
    name: 'A Minor Arpeggio',
    notes: ['A3', 'C4', 'E4', 'A4'],
    frequencies: [220.0, 261.63, 329.63, 440.0],
    speedLabel: 'Moderate',
  },

  advanced: {
    name: 'G Major Arpeggio',
    notes: ['G3', 'B3', 'D4', 'G4'],
    frequencies: [196.0, 246.94, 293.66, 392.0],
    speedLabel: 'Fast',
  },
};

// ============================================================
// AUDIO
// ============================================================

const audioRecorder = new AudioRecorder();

const audioContext = new AudioContext({
  sampleRate: SAMPLE_RATE,
});

AudioManager.setAudioSessionOptions({
  iosCategory: 'playAndRecord',
  iosMode: 'default',
  iosOptions: [],
});

// ============================================================
// COMPONENT
// ============================================================

export default function ArpeggioSpeedDrillScreen({
  tier,
}: Props) {
  const config = ARPEGGIOS[tier];

  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(3);

  const [recordingTime, setRecordingTime] =
    useState(0);

  const [isPlayingReference, setIsPlayingReference] =
    useState(false);

  const [result, setResult] =
    useState<ResultData | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------

  const samplesRef =
    useRef<Float32Array[]>([]);

  const recordingStartedAtRef =
    useRef<number>(0);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const referenceTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  const stoppingRef =
    useRef(false);

  // ----------------------------------------------------------
  // AUDIO CALLBACK
  // ----------------------------------------------------------

  useEffect(() => {
    audioRecorder.onAudioReady(
      {
        sampleRate: SAMPLE_RATE,
        bufferLength: BUFFER_LENGTH,
        channelCount: 1,
      },
      ({ buffer }) => {
        if (phase !== 'recording') {
          return;
        }

        const channelData =
          buffer.getChannelData(0);

        samplesRef.current.push(
          Float32Array.from(channelData),
        );
      },
    );

    return () => {
      audioRecorder.clearOnAudioReady();

      if (recordingTimerRef.current) {
        clearInterval(
          recordingTimerRef.current,
        );

        recordingTimerRef.current = null;
      }

      if (countdownTimerRef.current) {
        clearInterval(
          countdownTimerRef.current,
        );

        countdownTimerRef.current = null;
      }

      if (referenceTimeoutRef.current) {
        clearTimeout(
          referenceTimeoutRef.current,
        );

        referenceTimeoutRef.current = null;
      }

      try {
        audioContext.close();
      } catch {
        // Audio context may already be closed.
      }
    };
  }, [phase]);

  // ----------------------------------------------------------
  // PLAY REFERENCE
  // ----------------------------------------------------------

  const playReferenceArpeggio =
    async () => {
      if (isPlayingReference) {
        return;
      }

      setIsPlayingReference(true);
      setError(null);

      try {
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        const noteDuration =
          tier === 'beginner'
            ? 0.65
            : tier === 'intermediate'
              ? 0.45
              : 0.3;

        const gap =
          tier === 'beginner'
            ? 0.08
            : tier === 'intermediate'
              ? 0.06
              : 0.04;

        let currentTime =
          audioContext.currentTime + 0.05;

        for (
          const frequency of
          config.frequencies
        ) {
          const oscillator =
            audioContext.createOscillator();

          const gain =
            audioContext.createGain();

          oscillator.type = 'sine';
          oscillator.frequency.value =
            frequency;

          gain.gain.value = 0.18;

          oscillator.connect(gain);
          gain.connect(
            audioContext.destination,
          );

          oscillator.start(currentTime);

          oscillator.stop(
            currentTime + noteDuration,
          );

          currentTime +=
            noteDuration + gap;
        }

        const totalDuration =
          config.frequencies.length *
            (noteDuration + gap) *
            1000 +
          100;

        referenceTimeoutRef.current =
          setTimeout(() => {
            setIsPlayingReference(false);
          }, totalDuration);
      } catch (err) {
        console.error(
          'Reference playback error:',
          err,
        );

        setIsPlayingReference(false);

        setError(
          'Unable to play the reference sequence.',
        );
      }
    };

  // ----------------------------------------------------------
  // COUNTDOWN
  // ----------------------------------------------------------

  const startCountdown = () => {
    setPhase('countdown');
    setCountdown(3);

    let value = 3;

    if (countdownTimerRef.current) {
      clearInterval(
        countdownTimerRef.current,
      );
    }

    countdownTimerRef.current =
      setInterval(() => {
        value -= 1;

        if (value <= 0) {
          if (countdownTimerRef.current) {
            clearInterval(
              countdownTimerRef.current,
            );

            countdownTimerRef.current = null;
          }

          void startRecording();
          return;
        }

        setCountdown(value);
      }, 1000);
  };

  // ----------------------------------------------------------
  // START RECORDING
  // ----------------------------------------------------------

  const startRecording = async () => {
    try {
      setError(null);
      setResult(null);
      setRecordingTime(0);
      stoppingRef.current = false;

      const permission =
        await AudioManager.requestRecordingPermissions();

      if (permission !== 'Granted') {
        setError(
          'Microphone permission is required to perform this exercise.',
        );

        setPhase('instructions');
        return;
      }

      await AudioManager.setAudioSessionActivity(
        true,
      );

      samplesRef.current = [];

      const startResult =
        await audioRecorder.start();

      if (startResult.status === 'error') {
        throw new Error(
          startResult.message,
        );
      }

      recordingStartedAtRef.current =
        Date.now();

      setPhase('recording');

      if (recordingTimerRef.current) {
        clearInterval(
          recordingTimerRef.current,
        );
      }

      recordingTimerRef.current =
        setInterval(() => {
          const elapsed =
            (Date.now() -
              recordingStartedAtRef.current) /
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
            void stopRecording();
          }
        }, 100);
    } catch (err) {
      console.error(
        'Recording start error:',
        err,
      );

      try {
        await AudioManager.setAudioSessionActivity(
          false,
        );
      } catch {
        // Ignore cleanup failure.
      }

      setError(
        'Unable to start microphone recording.',
      );

      setPhase('instructions');
    }
  };

  // ----------------------------------------------------------
  // STOP RECORDING
  // ----------------------------------------------------------

  const stopRecording = async () => {
    if (stoppingRef.current) {
      return;
    }

    stoppingRef.current = true;

    if (recordingTimerRef.current) {
      clearInterval(
        recordingTimerRef.current,
      );

      recordingTimerRef.current = null;
    }

    try {
      await audioRecorder.stop();
    } catch (err) {
      console.error(
        'Recording stop error:',
        err,
      );
    }

    try {
      await AudioManager.setAudioSessionActivity(
        false,
      );
    } catch {
      // Ignore cleanup failure.
    }

    setPhase('processing');

    await processRecording();
  };

  // ----------------------------------------------------------
  // PROCESS RECORDING
  // ----------------------------------------------------------

  // ----------------------------------------------------------
// PROCESS RECORDING
// ----------------------------------------------------------

const processRecording = async () => {
  try {
    const chunks = samplesRef.current;

    const totalLength = chunks.reduce(
      (total, chunk) =>
        total + chunk.length,
      0,
    );

    if (totalLength === 0) {
      throw new Error(
        'No audio samples were captured.',
      );
    }

    const samples =
      new Float32Array(totalLength);

    let offset = 0;

    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }

    const measurement =
      measureArpeggioSpeed(
        samples,
        SAMPLE_RATE,
        config.frequencies,
      );

    const score =
      scoreArpeggioSpeed(
        measurement,
      );

    /*
     * ------------------------------------------
     * SAVE PROGRESS
     * ------------------------------------------
     */

    try {
      await saveCompletedExercise(
        'agility',
        'arpeggioSpeedDrill',
        tier,
        score.overall,
      );

      console.log(
        '💾 Arpeggio Speed Drill progress saved:',
        score.overall,
      );
    } catch (saveError) {
      /*
       * Saving failure should NOT prevent the
       * user from seeing their exercise results.
       */
      console.error(
        '❌ Failed to save Arpeggio Speed Drill progress:',
        saveError,
      );
    }

    setResult({
      measurement,
      score,
    });

    setPhase('results');
  } catch (err) {
    console.error(
      'Arpeggio processing error:',
      err,
    );

    setError(
      'We could not analyze your recording. Please try again.',
    );

    setPhase('instructions');
  }
};

  // ----------------------------------------------------------
  // START / RESTART
  // ----------------------------------------------------------

  const startExercise = () => {
    setResult(null);
    setError(null);
    setRecordingTime(0);
    setPhase('reference');
  };

  const restartExercise = () => {
    setResult(null);
    setError(null);
    setRecordingTime(0);
    setPhase('instructions');
  };

  const goBack = () => {
    router.back();
  };

  // ==========================================================
  // INSTRUCTIONS
  // ==========================================================

  const renderInstructions = () => (
    <View style={styles.content}>
      <Pressable
        style={styles.backButton}
        onPress={goBack}
        hitSlop={10}
      >
        <Ionicons
          name="arrow-back"
          size={24}
          color={BROWN}
        />
      </Pressable>

      <View style={styles.iconCircle}>
        <Ionicons
          name="musical-notes-outline"
          size={34}
          color={BROWN}
        />
      </View>

      <Text style={styles.title}>
        Arpeggio Speed Drill
      </Text>

      <Text style={styles.subtitle}>
        VOCAL AGILITY
      </Text>

      <View style={styles.instructionCard}>
        <View style={styles.prepareCard}>
          <View style={styles.prepareHeader}>
            <Ionicons
              name="information-circle-outline"
              size={21}
              color={BROWN}
            />

            <Text style={styles.prepareTitle}>
              Before You Begin
            </Text>
          </View>

          <View style={styles.prepareItem}>
            <Ionicons
              name="volume-mute-outline"
              size={17}
              color={BROWN}
            />

            <Text style={styles.prepareText}>
              Find a quiet area with minimal
              background noise.
            </Text>
          </View>

          <View style={styles.prepareItem}>
            <Ionicons
              name="body-outline"
              size={17}
              color={BROWN}
            />

            <Text style={styles.prepareText}>
              Stand or sit upright with your
              shoulders relaxed.
            </Text>
          </View>

          <View style={styles.prepareItem}>
            <Ionicons
              name="mic-outline"
              size={17}
              color={BROWN}
            />

            <Text style={styles.prepareText}>
              Keep a comfortable distance from
              the microphone while singing.
            </Text>
          </View>
        </View>

        <Text style={styles.cardTitle}>
          Exercise Details
        </Text>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Difficulty
          </Text>

          <Text style={styles.detailValue}>
            {tier.charAt(0).toUpperCase() +
              tier.slice(1)}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Pattern
          </Text>

          <Text style={styles.detailValue}>
            {config.name}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Speed
          </Text>

          <Text style={styles.detailValue}>
            {config.speedLabel}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            Notes
          </Text>

          <Text style={styles.detailValue}>
            {config.notes.join(' • ')}
          </Text>
        </View>

        <Text
          style={[
            styles.cardTitle,
            { marginTop: 14 },
          ]}
        >
          Instructions
        </Text>

        <InstructionItem
          icon="checkmark-circle-outline"
          text="Listen carefully to the reference arpeggio."
        />

        <InstructionItem
          icon="checkmark-circle-outline"
          text="Sing the same notes in the same order."
        />

        <InstructionItem
          icon="checkmark-circle-outline"
          text="Keep each transition clean and controlled."
        />

        <InstructionItem
          icon="checkmark-circle-outline"
          text="Maintain accurate pitch while developing speed."
        />
      </View>

      <View style={styles.referenceCard}>
        <Text style={styles.cardTitle}>
          Reference Arpeggio
        </Text>

        <Text style={styles.referenceLabel}>
          NOTES TO SING
        </Text>

        <View style={styles.noteSequence}>
          {config.notes.map(
            (note, index) => (
              <View
                key={`${note}-${index}`}
                style={styles.notePill}
              >
                <Text
                  style={styles.noteText}
                >
                  {note}
                </Text>
              </View>
            ),
          )}
        </View>

        <Text style={styles.referenceHint}>
          The reference arpeggio will play
          before recording begins.
        </Text>
      </View>

      {error ? (
        <ErrorBox message={error} />
      ) : null}

      <View style={styles.tipCard}>
        <Ionicons
          name="bulb-outline"
          size={19}
          color={BROWN}
        />

        <Text style={styles.tipText}>
          Focus on clean pitch transitions
          first. Speed should develop
          naturally as your accuracy improves.
        </Text>
      </View>

      <View style={styles.difficultyRow}>
        <Text style={styles.difficultyLabel}>
          Difficulty
        </Text>

        <Text style={styles.difficultyValue}>
          {tier.charAt(0).toUpperCase() +
            tier.slice(1)}
        </Text>
      </View>

      <Pressable
        style={styles.startButton}
        onPress={startExercise}
      >
        <Ionicons
          name="play"
          size={18}
          color={WHITE}
        />

        <Text style={styles.startButtonText}>
          Start Exercise
        </Text>
      </Pressable>
    </View>
  );

  // ==========================================================
  // REFERENCE
  // ==========================================================

  const renderReference = () => (
    <View style={styles.centerContent}>
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
        Listen carefully to the complete
        arpeggio before singing.
      </Text>

      <View style={styles.referenceCard}>
        <Text style={styles.referenceLabel}>
          REFERENCE NOTES
        </Text>

        <View style={styles.noteSequence}>
          {config.notes.map(
            (note, index) => (
              <View
                key={`${note}-${index}`}
                style={styles.notePill}
              >
                <Text
                  style={styles.noteText}
                >
                  {note}
                </Text>
              </View>
            ),
          )}
        </View>

        <Pressable
          onPress={playReferenceArpeggio}
          disabled={isPlayingReference}
          style={[
            styles.referenceButton,
            isPlayingReference &&
              styles.disabledButton,
          ]}
        >
          <Ionicons
            name={
              isPlayingReference
                ? 'volume-high-outline'
                : 'play'
            }
            size={18}
            color={BROWN}
          />

          <Text
            style={
              styles.referenceButtonText
            }
          >
            {isPlayingReference
              ? 'Playing...'
              : 'Play Reference'}
          </Text>
        </Pressable>

        {isPlayingReference ? (
          <ActivityIndicator
            size="small"
            color={BROWN}
            style={{
              marginTop: 16,
            }}
          />
        ) : null}
      </View>

      <Pressable
        onPress={startCountdown}
        disabled={isPlayingReference}
        style={[
          styles.startButton,
          isPlayingReference &&
            styles.disabledButton,
        ]}
      >
        <Text style={styles.startButtonText}>
          {isPlayingReference
            ? 'Listen First'
            : 'Continue'}
        </Text>
      </Pressable>
    </View>
  );

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  const renderCountdown = () => (
    <View style={styles.centerScreen}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="mic-outline"
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
        Prepare to sing the arpeggio.
      </Text>
    </View>
  );

  // ==========================================================
  // RECORDING
  // ==========================================================

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
          Follow the reference notes as
          accurately and smoothly as possible.
        </Text>

        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />

          <Text
            style={styles.recordingBadgeText}
          >
            RECORDING
          </Text>
        </View>

        <View style={styles.referenceCard}>
          <Text style={styles.referenceLabel}>
            SING THIS SEQUENCE
          </Text>

          <View style={styles.noteSequence}>
            {config.notes.map(
              (note, index) => (
                <View
                  key={`${note}-${index}`}
                  style={styles.notePill}
                >
                  <Text
                    style={styles.noteText}
                  >
                    {note}
                  </Text>
                </View>
              ),
            )}
          </View>
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
          onPress={() => void stopRecording()}
          style={styles.finishButton}
        >
          <Ionicons
            name="stop"
            size={18}
            color={BROWN}
          />

          <Text
            style={styles.finishButtonText}
          >
            Finish Recording
          </Text>
        </Pressable>
      </View>
    );
  };

  // ==========================================================
  // PROCESSING
  // ==========================================================

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

  // ==========================================================
  // RESULTS
  // ==========================================================

  const renderResults = () => {
    if (!result) {
      return null;
    }

    const {
      score,
      measurement,
    } = result;

    return (
      <View style={styles.resultsContent}>
        <View
          style={[
            styles.resultIcon,
            score.passed
              ? styles.resultIconPassed
              : styles.resultIconFailed,
          ]}
        >
          <Ionicons
            name={
              score.passed
                ? 'checkmark'
                : 'refresh'
            }
            size={40}
            color={BROWN}
          />
        </View>

        <Text style={styles.resultTitle}>
          {score.passed
            ? 'Great Job!'
            : 'Keep Practicing!'}
        </Text>

        <Text style={styles.resultSubtitle}>
          Arpeggio Speed Drill Result
        </Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>
            OVERALL SCORE
          </Text>

          <Text style={styles.scoreValue}>
            {score.overall}
          </Text>

          <Text style={styles.scoreDescription}>
            out of 100
          </Text>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Performance Breakdown
          </Text>

          <ScoreRow
            label="Pitch Accuracy"
            value={score.pitchScore}
          />

          <ScoreRow
            label="Sequence Accuracy"
            value={score.sequenceScore}
          />

          <ScoreRow
            label="Speed"
            value={score.speedScore}
            last
          />
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Exercise Metrics
          </Text>

          <MetricRow
            label="Correct Notes"
            value={`${measurement.correctNoteCount}/${measurement.noteCount}`}
          />

          <MetricRow
            label="Notes / Second"
            value={measurement.notesPerSecond.toFixed(
              2,
            )}
          />

          <MetricRow
            label="Average Note Duration"
            value={`${measurement.averageNoteDurationMs.toFixed(
              0,
            )} ms`}
          />

          <MetricRow
            label="Recording Duration"
            value={`${(
              measurement.durationMs / 1000
            ).toFixed(1)} s`}
            last
          />
        </View>

        <View style={styles.tipCard}>
          <Ionicons
            name="bulb-outline"
            size={20}
            color={BROWN}
          />

          <Text style={styles.tipText}>
            {score.feedback}
          </Text>
        </View>

        <Pressable
          onPress={restartExercise}
          style={styles.startButton}
        >
          <Ionicons
            name="refresh"
            size={18}
            color={WHITE}
          />

          <Text style={styles.startButtonText}>
            Try Again
          </Text>
        </Pressable>

        <Pressable
          onPress={goBack}
          style={styles.doneButton}
        >
          <Text style={styles.doneButtonText}>
            Back to Agility
          </Text>
        </Pressable>
      </View>
    );
  };

  // ==========================================================
  // MAIN RENDER
  // ==========================================================

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
// SMALL COMPONENTS
// ============================================================

function InstructionItem({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.prepareItem}>
      <Ionicons
        name={icon}
        size={17}
        color={BROWN}
      />

      <Text style={styles.prepareText}>
        {text}
      </Text>
    </View>
  );
}

function ScoreRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: number;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.scoreRow,
        last && styles.scoreRowLast,
      ]}
    >
      <View style={styles.scoreRowHeader}>
        <Text style={styles.scoreRowLabel}>
          {label}
        </Text>

        <Text style={styles.scoreRowValue}>
          {value}%
        </Text>
      </View>

      <View style={styles.progressBackground}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.min(
                Math.max(value, 0),
                100,
              )}%`,
            },
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
    <View
      style={[
        styles.metricRow,
        last && styles.metricRowLast,
      ]}
    >
      <Text style={styles.metricLabel}>
        {label}
      </Text>

      <Text style={styles.metricValue}>
        {value}
      </Text>
    </View>
  );
}

function ErrorBox({
  message,
}: {
  message: string;
}) {
  return (
    <View style={styles.errorCard}>
      <Ionicons
        name="alert-circle-outline"
        size={18}
        color={BROWN}
      />

      <Text style={styles.errorText}>
        {message}
      </Text>
    </View>
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

  centerContent: {
    flexGrow: 1,
    minHeight: 700,
    paddingHorizontal: 24,
    paddingTop: 92,
    paddingBottom: 60,
    alignItems: 'center',
  },

  centerScreen: {
    flexGrow: 1,
    minHeight: 700,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  // ==========================================================
  // BACK
  // ==========================================================

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHITE,
  },

  // ==========================================================
  // HERO
  // ==========================================================

  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
  },

  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 3,
    marginBottom: 24,
  },

  // ==========================================================
  // CARDS
  // ==========================================================

  instructionCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },

  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginTop: 14,
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
    marginTop: 8,
  },

  prepareText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginTop: 10,
    marginBottom: 14,
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

  // ==========================================================
  // NOTES
  // ==========================================================

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

  noteText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  // ==========================================================
  // BUTTONS
  // ==========================================================

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

  disabledButton: {
    opacity: 0.55,
  },

  // ==========================================================
  // ERROR / TIP
  // ==========================================================

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

  difficultyRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 4,
  },

  difficultyLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  difficultyValue: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  // ==========================================================
  // PHASES
  // ==========================================================

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

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
  },

  // ==========================================================
  // RECORDING
  // ==========================================================

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

  // ==========================================================
  // RESULTS
  // ==========================================================

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