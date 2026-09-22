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

const SAMPLE_RATE = 44100;
const BUFFER_LENGTH = 4410; // 100 ms
const MAX_RECORDING_SECONDS = 10;

const COLORS = {
  background: '#FFF7FB',
  card: '#FFFFFF',
  pink: '#E85C9E',
  pinkDark: '#C83F80',
  pinkLight: '#F9D7E8',
  text: '#2B1D25',
  secondary: '#806875',
  border: '#F0D6E3',
  success: '#43A047',
  danger: '#D94A6A',
};

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

const audioRecorder = new AudioRecorder();
const audioContext = new AudioContext({
  sampleRate: SAMPLE_RATE,
});

AudioManager.setAudioSessionOptions({
  iosCategory: 'playAndRecord',
  iosMode: 'default',
  iosOptions: [],
});

export default function ArpeggioSpeedDrillScreen({
  tier,
}: Props) {
  const config = ARPEGGIOS[tier];

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] = useState(3);

  const [recordingTime, setRecordingTime] =
    useState(0);

  const [isPlayingReference, setIsPlayingReference] =
    useState(false);

  const [result, setResult] =
    useState<ResultData | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const samplesRef = useRef<Float32Array[]>([]);
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
        clearInterval(recordingTimerRef.current);
      }

      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }

      if (referenceTimeoutRef.current) {
        clearTimeout(referenceTimeoutRef.current);
      }

      try {
        audioContext.close();
      } catch {
        // Audio context may already be closed.
      }
    };
  }, [phase]);

  const playReferenceArpeggio = async () => {
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

      for (const frequency of config.frequencies) {
        const oscillator =
          audioContext.createOscillator();

        const gain =
          audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;

        gain.gain.value = 0.18;

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start(currentTime);

        oscillator.stop(
          currentTime + noteDuration,
        );

        currentTime += noteDuration + gap;
      }

      const totalDuration =
        config.frequencies.length *
          (noteDuration + gap) +
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
        'Unable to play the reference pattern.',
      );
    }
  };

  const startCountdown = () => {
    setPhase('countdown');
    setCountdown(3);

    let value = 3;

    countdownTimerRef.current =
      setInterval(() => {
        value -= 1;

        if (value <= 0) {
          if (countdownTimerRef.current) {
            clearInterval(
              countdownTimerRef.current,
            );
          }

          startRecording();
          return;
        }

        setCountdown(value);
      }, 1000);
  };

  const startRecording = async () => {
    try {
      setError(null);

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
        throw new Error(startResult.message);
      }

      recordingStartedAtRef.current =
        Date.now();

      setRecordingTime(0);
      setPhase('recording');

      recordingTimerRef.current =
        setInterval(() => {
          const elapsed =
            (Date.now() -
              recordingStartedAtRef.current) /
            1000;

          setRecordingTime(elapsed);

          if (
            elapsed >=
            MAX_RECORDING_SECONDS
          ) {
            stopRecording();
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

  const stopRecording = async () => {
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

  const startExercise = () => {
    setResult(null);
    setError(null);
    setPhase('reference');
  };

  const beginAfterReference = () => {
    startCountdown();
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

  const renderHeader = () => (
    <View style={styles.header}>
      <Pressable
        onPress={goBack}
        style={styles.backButton}
      >
        <Text style={styles.backText}>‹</Text>
      </Pressable>

      <View style={styles.headerCenter}>
        <Text style={styles.componentLabel}>
          VOCAL AGILITY
        </Text>

        <Text style={styles.headerTitle}>
          Arpeggio Speed Drill
        </Text>
      </View>

      <View style={styles.headerSpacer} />
    </View>
  );

  const renderInstructions = () => (
    <>
      <View style={styles.heroCard}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>♪</Text>
        </View>

        <Text style={styles.heroTitle}>
          Arpeggio Speed Drill
        </Text>

        <Text style={styles.heroDescription}>
          Practice singing a sequence of
          arpeggiated notes accurately while
          gradually developing speed.
        </Text>
      </View>

      <View style={styles.infoCard}>
        <InfoRow
          label="Level"
          value={
            tier.charAt(0).toUpperCase() +
            tier.slice(1)
          }
        />

        <InfoRow
          label="Pattern"
          value={config.name}
        />

        <InfoRow
          label="Speed"
          value={config.speedLabel}
        />

        <InfoRow
          label="Notes"
          value={config.notes.join(' • ')}
        />
      </View>

      <View style={styles.instructionCard}>
        <Text style={styles.sectionTitle}>
          How to do it
        </Text>

        <InstructionRow
          number="1"
          text="Listen carefully to the reference arpeggio."
        />

        <InstructionRow
          number="2"
          text="Sing the same notes in the same order."
        />

        <InstructionRow
          number="3"
          text="Keep each transition clean and controlled."
        />

        <InstructionRow
          number="4"
          text="Maintain accuracy while increasing speed."
        />
      </View>

      {error && (
        <ErrorBox message={error} />
      )}

      <Pressable
        onPress={startExercise}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>
          Start Exercise
        </Text>
      </Pressable>
    </>
  );

  const renderReference = () => (
    <>
      <View style={styles.phaseCard}>
        <Text style={styles.phaseLabel}>
          STEP 1
        </Text>

        <Text style={styles.phaseTitle}>
          Listen to the Reference
        </Text>

        <Text style={styles.phaseDescription}>
          Listen to the complete arpeggio before
          attempting to sing it.
        </Text>

        <View style={styles.noteSequence}>
          {config.notes.map((note, index) => (
            <View
              key={`${note}-${index}`}
              style={styles.notePill}
            >
              <Text style={styles.noteText}>
                {note}
              </Text>
            </View>
          ))}
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
          <Text style={styles.referenceButtonText}>
            {isPlayingReference
              ? 'Playing...'
              : '▶  Play Reference'}
          </Text>
        </Pressable>

        {isPlayingReference && (
          <ActivityIndicator
            size="small"
            color={COLORS.pink}
            style={styles.loader}
          />
        )}
      </View>

      <Pressable
        onPress={beginAfterReference}
        disabled={isPlayingReference}
        style={[
          styles.primaryButton,
          isPlayingReference &&
            styles.disabledButton,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {isPlayingReference
            ? 'Listen First'
            : 'Continue'}
        </Text>
      </Pressable>
    </>
  );

  const renderCountdown = () => (
    <View style={styles.centerPhase}>
      <Text style={styles.phaseLabel}>
        GET READY
      </Text>

      <View style={styles.countdownCircle}>
        <Text style={styles.countdownText}>
          {countdown}
        </Text>
      </View>

      <Text style={styles.readyText}>
        Prepare to sing the arpeggio
      </Text>
    </View>
  );

  const renderRecording = () => (
    <View style={styles.centerPhase}>
      <Text style={styles.phaseLabel}>
        RECORDING
      </Text>

      <View style={styles.recordingCircle}>
        <View style={styles.recordingDot} />
      </View>

      <Text style={styles.recordingTitle}>
        Sing the arpeggio
      </Text>

      <Text style={styles.recordingTime}>
        {recordingTime.toFixed(1)}s
      </Text>

      <View style={styles.liveNotes}>
        {config.notes.map((note, index) => (
          <View
            key={`${note}-${index}`}
            style={styles.liveNote}
          >
            <Text style={styles.liveNoteText}>
              {note}
            </Text>
          </View>
        ))}
      </View>

      <Pressable
        onPress={stopRecording}
        style={styles.stopButton}
      >
        <View style={styles.stopIcon} />

        <Text style={styles.stopButtonText}>
          Stop Recording
        </Text>
      </Pressable>
    </View>
  );

  const renderProcessing = () => (
    <View style={styles.centerPhase}>
      <ActivityIndicator
        size="large"
        color={COLORS.pink}
      />

      <Text style={styles.processingTitle}>
        Analyzing your performance
      </Text>

      <Text style={styles.processingText}>
        Checking pitch accuracy, note sequence,
        and speed...
      </Text>
    </View>
  );

  const renderResults = () => {
    if (!result) {
      return null;
    }

    const { score, measurement } =
      result;

    return (
      <>
        <View style={styles.resultHero}>
          <View
            style={[
              styles.resultCircle,
              {
                borderColor: score.passed
                  ? COLORS.success
                  : COLORS.pink,
              },
            ]}
          >
            <Text style={styles.resultScore}>
              {score.overall}
            </Text>

            <Text style={styles.resultOutOf}>
              /100
            </Text>
          </View>

          <Text style={styles.resultTitle}>
            {score.passed
              ? 'Great Job!'
              : 'Keep Practicing!'}
          </Text>

          <Text style={styles.resultFeedback}>
            {score.feedback}
          </Text>
        </View>

        <View style={styles.scoreCard}>
          <Text style={styles.sectionTitle}>
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
          />
        </View>

        <View style={styles.metricsCard}>
          <Text style={styles.sectionTitle}>
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
            value={`${measurement.averageNoteDurationMs.toFixed(0)} ms`}
          />

          <MetricRow
            label="Recording Duration"
            value={`${(
              measurement.durationMs / 1000
            ).toFixed(1)} s`}
          />
        </View>

        <Pressable
          onPress={restartExercise}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>
            Try Again
          </Text>
        </Pressable>

        <Pressable
          onPress={goBack}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>
            Back to Agility
          </Text>
        </Pressable>
      </>
    );
  };

  return (
    <View style={styles.screen}>
      {renderHeader()}

      <ScrollView
        contentContainerStyle={
          styles.scrollContent
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
    </View>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>
        {label}
      </Text>

      <Text style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

function InstructionRow({
  number,
  text,
}: {
  number: string;
  text: string;
}) {
  return (
    <View style={styles.instructionRow}>
      <View style={styles.numberCircle}>
        <Text style={styles.numberText}>
          {number}
        </Text>
      </View>

      <Text style={styles.instructionText}>
        {text}
      </Text>
    </View>
  );
}

function ScoreRow({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <View style={styles.scoreRow}>
      <View style={styles.scoreRowHeader}>
        <Text style={styles.scoreLabel}>
          {label}
        </Text>

        <Text style={styles.scoreValue}>
          {value}
        </Text>
      </View>

      <View style={styles.progressBackground}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.max(
                0,
                Math.min(100, value),
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
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricRow}>
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
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  header: {
    minHeight: 76,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.pinkLight,
  },

  backText: {
    color: COLORS.pinkDark,
    fontSize: 32,
    lineHeight: 34,
    marginTop: -4,
  },

  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },

  headerSpacer: {
    width: 42,
  },

  componentLabel: {
    color: COLORS.pink,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },

  headerTitle: {
    marginTop: 3,
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
  },

  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },

  heroCard: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 18,
  },

  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.pinkLight,
    marginBottom: 16,
  },

  iconText: {
    color: COLORS.pink,
    fontSize: 38,
    fontWeight: '700',
  },

  heroTitle: {
    color: COLORS.text,
    fontSize: 27,
    fontWeight: '800',
    textAlign: 'center',
  },

  heroDescription: {
    marginTop: 10,
    maxWidth: 350,
    color: COLORS.secondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },

  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
  },

  infoLabel: {
    color: COLORS.secondary,
    fontSize: 14,
  },

  infoValue: {
    maxWidth: '65%',
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },

  instructionCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 18,
  },

  sectionTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 14,
  },

  instructionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },

  numberCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.pinkLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  numberText: {
    color: COLORS.pinkDark,
    fontWeight: '800',
  },

  instructionText: {
    flex: 1,
    color: COLORS.secondary,
    fontSize: 14,
    lineHeight: 20,
  },

  primaryButton: {
    minHeight: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.pink,
    marginTop: 4,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },

  secondaryButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 12,
  },

  secondaryButtonText: {
    color: COLORS.pinkDark,
    fontSize: 15,
    fontWeight: '700',
  },

  disabledButton: {
    opacity: 0.55,
  },

  errorBox: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FDECEF',
    borderWidth: 1,
    borderColor: '#F4B7C5',
    marginBottom: 16,
  },

  errorText: {
    color: COLORS.danger,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },

  phaseCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    marginTop: 10,
  },

  phaseLabel: {
    color: COLORS.pink,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    textAlign: 'center',
  },

  phaseTitle: {
    marginTop: 8,
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },

  phaseDescription: {
    marginTop: 9,
    color: COLORS.secondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },

  noteSequence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
    marginTop: 22,
  },

  notePill: {
    minWidth: 60,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: COLORS.pinkLight,
    alignItems: 'center',
  },

  noteText: {
    color: COLORS.pinkDark,
    fontWeight: '800',
    fontSize: 15,
  },

  referenceButton: {
    marginTop: 28,
    minWidth: 210,
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: 18,
    backgroundColor: COLORS.pinkLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  referenceButtonText: {
    color: COLORS.pinkDark,
    fontWeight: '800',
    fontSize: 15,
  },

  loader: {
    marginTop: 14,
  },

  centerPhase: {
    flex: 1,
    minHeight: 550,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },

  countdownCircle: {
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: COLORS.pinkLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 28,
  },

  countdownText: {
    color: COLORS.pinkDark,
    fontSize: 72,
    fontWeight: '900',
  },

  readyText: {
    color: COLORS.secondary,
    fontSize: 15,
    textAlign: 'center',
  },

  recordingCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#FDECEF',
    borderWidth: 8,
    borderColor: COLORS.pinkLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 25,
  },

  recordingDot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.pink,
  },

  recordingTitle: {
    color: COLORS.text,
    fontSize: 23,
    fontWeight: '800',
  },

  recordingTime: {
    marginTop: 7,
    color: COLORS.pink,
    fontSize: 18,
    fontWeight: '700',
  },

  liveNotes: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 24,
  },

  liveNote: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: COLORS.pinkLight,
  },

  liveNoteText: {
    color: COLORS.pinkDark,
    fontWeight: '800',
  },

  stopButton: {
    marginTop: 30,
    minHeight: 54,
    minWidth: 190,
    paddingHorizontal: 20,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.pink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },

  stopIcon: {
    width: 13,
    height: 13,
    borderRadius: 3,
    backgroundColor: COLORS.pink,
  },

  stopButtonText: {
    color: COLORS.pinkDark,
    fontWeight: '800',
  },

  processingTitle: {
    marginTop: 24,
    color: COLORS.text,
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
  },

  processingText: {
    marginTop: 9,
    color: COLORS.secondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 300,
  },

  resultHero: {
    alignItems: 'center',
    paddingVertical: 18,
  },

  resultCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
  },

  resultScore: {
    color: COLORS.text,
    fontSize: 48,
    fontWeight: '900',
  },

  resultOutOf: {
    color: COLORS.secondary,
    fontSize: 13,
    marginTop: -4,
  },

  resultTitle: {
    marginTop: 16,
    color: COLORS.text,
    fontSize: 25,
    fontWeight: '800',
  },

  resultFeedback: {
    marginTop: 8,
    maxWidth: 340,
    color: COLORS.secondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },

  scoreCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 12,
  },

  scoreRow: {
    marginBottom: 16,
  },

  scoreRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  scoreLabel: {
    color: COLORS.secondary,
    fontSize: 14,
  },

  scoreValue: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },

  progressBackground: {
    height: 9,
    borderRadius: 5,
    backgroundColor: '#F3E6EC',
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: COLORS.pink,
  },

  metricsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 12,
    marginBottom: 18,
  },

  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F6EAF0',
  },

  metricLabel: {
    color: COLORS.secondary,
    fontSize: 14,
  },

  metricValue: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
  },
});