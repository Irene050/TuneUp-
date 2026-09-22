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
    measureRapidScaleTrill,
} from '@/services/measurement/agility/rapidScaleTrill';

import {
    scoreRapidScaleTrill,
} from '@/services/scoring/agility/rapidScaleTrill';

type Phase =
  | 'instructions'
  | 'reference'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

type TierConfig = {
  label: string;
  frequencies: number[];
  speedLabel: string;
  accuracyThreshold: number;
};

const TIER_CONFIGS: Record<
  Tier,
  TierConfig
> = {
  beginner: {
    label: 'Beginner',
    frequencies: [
      261.63,
      293.66,
      329.63,
      293.66,
      261.63,
      293.66,
      329.63,
      293.66,
    ],
    speedLabel: 'Slow',
    accuracyThreshold: 60,
  },

  intermediate: {
    label: 'Intermediate',
    frequencies: [
      293.66,
      329.63,
      369.99,
      329.63,
      293.66,
      329.63,
      369.99,
      415.3,
      369.99,
      329.63,
    ],
    speedLabel: 'Moderate',
    accuracyThreshold: 70,
  },

  advanced: {
    label: 'Advanced',
    frequencies: [
      392.0,
      440.0,
      493.88,
      554.37,
      493.88,
      440.0,
      392.0,
      440.0,
      493.88,
      554.37,
      622.25,
      554.37,
      493.88,
      440.0,
    ],
    speedLabel: 'Fast',
    accuracyThreshold: 80,
  },
};

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const MAX_RECORDING_SECONDS = 10;

const sleep = (ms: number) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, ms),
  );

export default function RapidScaleTrillScreen({
  tier,
}: {
  tier: Tier;
}) {
  const config =
    TIER_CONFIGS[tier];

  const [phase, setPhase] =
    useState<Phase>(
      'instructions',
    );

  const [countdown, setCountdown] =
    useState(3);

  const [recordingTime, setRecordingTime] =
    useState(0);

  const [result, setResult] = useState<{
    overall: number;
    pitchScore: number;
    sequenceScore: number;
    transitionScore: number;
    speedScore: number;
    passed: boolean;
    feedback: string;
    noteCount: number;
    correctNoteCount: number;
    transitionCount: number;
    correctTransitionCount: number;
    averageTransitionTimeMs: number;
    notesPerSecond: number;
    durationMs: number;
  } | null>(null);

  const audioContextRef =
    useRef<AudioContext | null>(
      null,
    );

  const recorderRef =
    useRef<AudioRecorder | null>(
      null,
    );

  const samplesRef =
    useRef<number[]>([]);

  const recordingStartRef =
    useRef<number | null>(
      null,
    );

  const recordingTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const processingRef =
    useRef(false);

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

  const requestMicrophonePermission =
    async (): Promise<boolean> => {
      try {
        const permission =
          await AudioManager.requestRecordingPermissions();

        return permission === 'Granted';
      } catch {
        return false;
      }
    };

  const playReference =
    async () => {
      try {
        const context =
          audioContextRef.current ??
          new AudioContext({
            sampleRate:
              SAMPLE_RATE,
          });

        audioContextRef.current =
          context;

        await context.resume();

        const noteDuration =
          tier === 'beginner'
            ? 0.32
            : tier === 'intermediate'
              ? 0.24
              : 0.18;

        for (
          const frequency of
          config.frequencies
        ) {
          const oscillator =
            context.createOscillator();

          const gain =
            context.createGain();

          oscillator.frequency.value =
            frequency;

          gain.gain.value = 0.12;

          oscillator.connect(gain);
          gain.connect(
            context.destination,
          );

          const startTime =
            context.currentTime;

          oscillator.start(
            startTime,
          );

          oscillator.stop(
            startTime +
              noteDuration,
          );

          await sleep(
            noteDuration * 1000,
          );
        }
      } catch (error) {
        console.warn(
          'Reference playback failed:',
          error,
        );
      }
    };

  const beginExercise =
    async () => {
      const permission =
        await requestMicrophonePermission();

      if (!permission) {
        return;
      }

      setPhase('reference');
    };

  const startCountdown =
    async () => {
      setPhase('countdown');

      for (
        let value = 3;
        value >= 1;
        value--
      ) {
        setCountdown(value);
        await sleep(1000);
      }

      await startRecording();
    };

  const startRecording =
    async () => {
      try {
        processingRef.current =
          false;

        samplesRef.current = [];

        const recorder =
          new AudioRecorder();

        recorderRef.current =
          recorder;

        const callbackResult =
          recorder.onAudioReady(
            {
              sampleRate:
                SAMPLE_RATE,
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
                  buffer.getChannelData(
                    0,
                  );

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

          recorderRef.current =
            null;

          setPhase(
            'instructions',
          );

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

          recorderRef.current =
            null;

          setPhase(
            'instructions',
          );

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
              (Date.now() -
                start) /
              1000;

            setRecordingTime(
              elapsed,
            );

            if (
              elapsed >=
              MAX_RECORDING_SECONDS
            ) {
              processRecording();
            }
          }, 100);
      } catch (error) {
        console.warn(
          'Recording failed:',
          error,
        );

        setPhase(
          'instructions',
        );
      }
    };

  const stopRecording =
    () => {
      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current,
        );

        recordingTimerRef.current =
          null;
      }

      if (
        recorderRef.current
      ) {
        try {
          recorderRef.current.clearOnAudioReady();
        } catch {}

        try {
          recorderRef.current.stop();
        } catch {}

        recorderRef.current =
          null;
      }
    };

  const processRecording =
    async () => {
      if (
        processingRef.current
      ) {
        return;
      }

      processingRef.current =
        true;

      stopRecording();

      setPhase('processing');

      await sleep(500);

      try {
        const samples =
          new Float32Array(
            samplesRef.current,
          );

        const measurement =
          measureRapidScaleTrill(
            samples,
            SAMPLE_RATE,
            config.frequencies,
          );

        const scored =
          scoreRapidScaleTrill(
            measurement,
          );

        setResult({
          overall:
            scored.overall,
          pitchScore:
            scored.pitchScore,
          sequenceScore:
            scored.sequenceScore,
          transitionScore:
            scored.transitionScore,
          speedScore:
            scored.speedScore,
          passed:
            scored.passed,
          feedback:
            scored.feedback,

          noteCount:
            measurement.noteCount,

          correctNoteCount:
            measurement.correctNoteCount,

          transitionCount:
            measurement.transitionCount,

          correctTransitionCount:
            measurement.correctTransitionCount,

          averageTransitionTimeMs:
            measurement.averageTransitionTimeMs,

          notesPerSecond:
            measurement.notesPerSecond,

          durationMs:
            measurement.durationMs,
        });

        setPhase('results');
      } catch (error) {
        console.warn(
          'Processing failed:',
          error,
        );

        processingRef.current =
          false;

        setPhase(
          'instructions',
        );
      }
    };

  const resetExercise =
    () => {
      processingRef.current =
        false;

      setResult(null);
      setRecordingTime(0);
      setCountdown(3);
      samplesRef.current = [];

      setPhase(
        'instructions',
      );
    };

  const renderInstructions =
    () => (
      <View style={styles.content}>
        <Text style={styles.eyebrow}>
          VOCAL AGILITY
        </Text>

        <Text style={styles.title}>
          Rapid Scale Trill
        </Text>

        <Text
          style={styles.description}
        >
          Sing the repeating scale pattern
          quickly and accurately while
          maintaining consistent pitch and
          smooth note transitions.
        </Text>

        <View style={styles.card}>
          <Text
            style={styles.cardTitle}
          >
            How to perform
          </Text>

          <Text style={styles.step}>
            1. Listen to the reference
            pattern.
          </Text>

          <Text style={styles.step}>
            2. Follow the notes in order.
          </Text>

          <Text style={styles.step}>
            3. Sing the scale pattern
            rapidly.
          </Text>

          <Text style={styles.step}>
            4. Keep every note clear and
            controlled.
          </Text>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoBox}>
            <Text
              style={styles.infoLabel}
            >
              LEVEL
            </Text>

            <Text
              style={styles.infoValue}
            >
              {config.label}
            </Text>
          </View>

          <View style={styles.infoBox}>
            <Text
              style={styles.infoLabel}
            >
              SPEED
            </Text>

            <Text
              style={styles.infoValue}
            >
              {config.speedLabel}
            </Text>
          </View>
        </View>

        <Pressable
          style={styles.primaryButton}
          onPress={
            beginExercise
          }
        >
          <Text
            style={
              styles.primaryButtonText
            }
          >
            Start Exercise
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() =>
            router.back()
          }
        >
          <Text
            style={
              styles.secondaryButtonText
            }
          >
            Back
          </Text>
        </Pressable>
      </View>
    );

  const renderReference =
    () => (
      <View style={styles.content}>
        <Text style={styles.eyebrow}>
          REFERENCE
        </Text>

        <Text style={styles.title}>
          Listen First
        </Text>

        <Text
          style={styles.description}
        >
          Listen to the scale pattern,
          then reproduce the same sequence
          with consistent transitions.
        </Text>

        <View
          style={styles.noteSequence}
        >
          {config.frequencies.map(
            (frequency, index) => (
              <View
                key={`${frequency}-${index}`}
                style={
                  styles.noteBubble
                }
              >
                <Text
                  style={
                    styles.noteNumber
                  }
                >
                  {index + 1}
                </Text>

                <Text
                  style={
                    styles.noteFrequency
                  }
                >
                  {Math.round(
                    frequency,
                  )}{' '}
                  Hz
                </Text>
              </View>
            ),
          )}
        </View>

        <Pressable
          style={styles.primaryButton}
          onPress={
            playReference
          }
        >
          <Text
            style={
              styles.primaryButtonText
            }
          >
            ▶ Play Reference
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={
            startCountdown
          }
        >
          <Text
            style={
              styles.secondaryButtonText
            }
          >
            Continue
          </Text>
        </Pressable>
      </View>
    );

  const renderCountdown =
    () => (
      <View
        style={
          styles.centerContent
        }
      >
        <Text style={styles.eyebrow}>
          GET READY
        </Text>

        <Text
          style={styles.countdown}
        >
          {countdown}
        </Text>

        <Text
          style={styles.description}
        >
          Prepare for the rapid scale
          pattern.
        </Text>
      </View>
    );

  const renderRecording =
    () => (
      <View
        style={
          styles.centerContent
        }
      >
        <View
          style={
            styles.recordingIndicator
          }
        />

        <Text style={styles.eyebrow}>
          RECORDING
        </Text>

        <Text style={styles.title}>
          Sing the Scale
        </Text>

        <Text
          style={styles.timer}
        >
          {recordingTime.toFixed(1)}
          s
        </Text>

        <Text
          style={styles.description}
        >
          Follow the pattern quickly,
          but keep each transition
          accurate.
        </Text>

        <View
          style={styles.noteSequence}
        >
          {config.frequencies.map(
            (frequency, index) => (
              <View
                key={`${frequency}-${index}`}
                style={
                  styles.smallNoteBubble
                }
              >
                <Text
                  style={
                    styles.smallNoteText
                  }
                >
                  {index + 1}
                </Text>
              </View>
            ),
          )}
        </View>

        <Pressable
          style={styles.stopButton}
          onPress={
            processRecording
          }
        >
          <Text
            style={
              styles.stopButtonText
            }
          >
            Stop Recording
          </Text>
        </Pressable>
      </View>
    );

  const renderProcessing =
    () => (
      <View
        style={
          styles.centerContent
        }
      >
        <ActivityIndicator
          size="large"
        />

        <Text style={styles.title}>
          Analyzing...
        </Text>

        <Text
          style={styles.description}
        >
          Measuring your pitch,
          sequence accuracy,
          transitions, and speed.
        </Text>
      </View>
    );

  const renderResults =
    () => {
      if (!result) {
        return null;
      }

      return (
        <ScrollView
          contentContainerStyle={
            styles.resultsContainer
          }
        >
          <Text style={styles.eyebrow}>
            RESULTS
          </Text>

          <Text style={styles.title}>
            Rapid Scale Results
          </Text>

          <View
            style={
              styles.overallCard
            }
          >
            <Text
              style={
                styles.overallLabel
              }
            >
              OVERALL SCORE
            </Text>

            <Text
              style={
                styles.overallScore
              }
            >
              {Math.round(
                result.overall,
              )}
            </Text>

            <Text
              style={[
                styles.statusText,
                result.passed
                  ? styles.passed
                  : styles.needsPractice,
              ]}
            >
              {result.passed
                ? 'PASSED'
                : 'KEEP PRACTICING'}
            </Text>
          </View>

          <View
            style={styles.scoreCard}
          >
            <Text
              style={styles.scoreLabel}
            >
              Pitch Accuracy
            </Text>

            <Text
              style={styles.scoreValue}
            >
              {Math.round(
                result.pitchScore,
              )}
              %
            </Text>
          </View>

          <View
            style={styles.scoreCard}
          >
            <Text
              style={styles.scoreLabel}
            >
              Sequence Accuracy
            </Text>

            <Text
              style={styles.scoreValue}
            >
              {Math.round(
                result.sequenceScore,
              )}
              %
            </Text>
          </View>

          <View
            style={styles.scoreCard}
          >
            <Text
              style={styles.scoreLabel}
            >
              Transition Accuracy
            </Text>

            <Text
              style={styles.scoreValue}
            >
              {Math.round(
                result.transitionScore,
              )}
              %
            </Text>
          </View>

          <View
            style={styles.scoreCard}
          >
            <Text
              style={styles.scoreLabel}
            >
              Speed Score
            </Text>

            <Text
              style={styles.scoreValue}
            >
              {Math.round(
                result.speedScore,
              )}
              %
            </Text>
          </View>

          <View
            style={styles.statsGrid}
          >
            <View
              style={styles.statBox}
            >
              <Text
                style={styles.statValue}
              >
                {result.correctNoteCount}/
                {result.noteCount}
              </Text>

              <Text
                style={styles.statLabel}
              >
                Correct Notes
              </Text>
            </View>

            <View
              style={styles.statBox}
            >
              <Text
                style={styles.statValue}
              >
                {result.correctTransitionCount}/
                {result.transitionCount}
              </Text>

              <Text
                style={styles.statLabel}
              >
                Correct Transitions
              </Text>
            </View>

            <View
              style={styles.statBox}
            >
              <Text
                style={styles.statValue}
              >
                {result.averageTransitionTimeMs > 0
                  ? result.averageTransitionTimeMs.toFixed(
                      0,
                    )
                  : '0'}
                ms
              </Text>

              <Text
                style={styles.statLabel}
              >
                Avg. Transition
              </Text>
            </View>

            <View
              style={styles.statBox}
            >
              <Text
                style={styles.statValue}
              >
                {result.notesPerSecond.toFixed(
                  2,
                )}
              </Text>

              <Text
                style={styles.statLabel}
              >
                Notes / Sec
              </Text>
            </View>

            <View
              style={styles.statBox}
            >
              <Text
                style={styles.statValue}
              >
                {(
                  result.durationMs /
                  1000
                ).toFixed(1)}
                s
              </Text>

              <Text
                style={styles.statLabel}
              >
                Duration
              </Text>
            </View>
          </View>

          <View
            style={
              styles.feedbackCard
            }
          >
            <Text
              style={
                styles.feedbackTitle
              }
            >
              Feedback
            </Text>

            <Text
              style={
                styles.feedbackText
              }
            >
              {result.feedback}
            </Text>
          </View>

          <Pressable
            style={
              styles.primaryButton
            }
            onPress={
              resetExercise
            }
          >
            <Text
              style={
                styles.primaryButtonText
              }
            >
              Try Again
            </Text>
          </Pressable>

          <Pressable
            style={
              styles.secondaryButton
            }
            onPress={() =>
              router.back()
            }
          >
            <Text
              style={
                styles.secondaryButtonText
              }
            >
              Back to Exercises
            </Text>
          </Pressable>
        </ScrollView>
      );
    };

  return (
    <View style={styles.container}>
      {phase ===
        'instructions' &&
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
    </View>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#FFF7FB',
    },

    content: {
      flex: 1,
      padding: 24,
      justifyContent:
        'center',
    },

    centerContent: {
      flex: 1,
      padding: 24,
      alignItems: 'center',
      justifyContent:
        'center',
    },

    resultsContainer: {
      padding: 24,
      paddingBottom: 40,
    },

    eyebrow: {
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 2,
      color: '#C45A91',
      marginBottom: 8,
    },

    title: {
      fontSize: 30,
      fontWeight: '800',
      color: '#3A2531',
      marginBottom: 12,
    },

    description: {
      fontSize: 16,
      lineHeight: 24,
      color: '#765F6A',
      marginBottom: 24,
      textAlign: 'center',
    },

    card: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 20,
      padding: 20,
      marginBottom: 20,
    },

    cardTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: '#3A2531',
      marginBottom: 14,
    },

    step: {
      fontSize: 15,
      color: '#765F6A',
      lineHeight: 24,
      marginBottom: 8,
    },

    infoRow: {
      flexDirection:
        'row',
      gap: 12,
      marginBottom: 24,
    },

    infoBox: {
      flex: 1,
      backgroundColor:
        '#FFFFFF',
      borderRadius: 16,
      padding: 16,
    },

    infoLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: '#A98796',
      letterSpacing: 1,
      marginBottom: 6,
    },

    infoValue: {
      fontSize: 16,
      fontWeight: '700',
      color: '#3A2531',
    },

    primaryButton: {
      backgroundColor:
        '#D96FA3',
      borderRadius: 18,
      paddingVertical: 16,
      alignItems: 'center',
      marginBottom: 12,
    },

    primaryButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '800',
    },

    secondaryButton: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 18,
      paddingVertical: 16,
      alignItems: 'center',
      borderWidth: 1,
      borderColor:
        '#E8D6DF',
    },

    secondaryButtonText: {
      color: '#7D5367',
      fontSize: 16,
      fontWeight: '700',
    },

    noteSequence: {
      flexDirection:
        'row',
      flexWrap: 'wrap',
      justifyContent:
        'center',
      gap: 10,
      marginBottom: 28,
    },

    noteBubble: {
      width: 82,
      height: 82,
      borderRadius: 20,
      backgroundColor:
        '#FFFFFF',
      alignItems: 'center',
      justifyContent:
        'center',
    },

    noteNumber: {
      fontSize: 22,
      fontWeight: '800',
      color: '#D96FA3',
    },

    noteFrequency: {
      fontSize: 11,
      color: '#765F6A',
      marginTop: 4,
    },

    smallNoteBubble: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor:
        '#FFFFFF',
      alignItems: 'center',
      justifyContent:
        'center',
    },

    smallNoteText: {
      fontSize: 15,
      fontWeight: '800',
      color: '#D96FA3',
    },

    countdown: {
      fontSize: 96,
      fontWeight: '900',
      color: '#D96FA3',
      marginBottom: 20,
    },

    recordingIndicator: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor:
        '#D96FA3',
      marginBottom: 20,
    },

    timer: {
      fontSize: 48,
      fontWeight: '800',
      color: '#D96FA3',
      marginBottom: 20,
    },

    stopButton: {
      marginTop: 20,
      backgroundColor:
        '#FFFFFF',
      borderWidth: 2,
      borderColor:
        '#D96FA3',
      borderRadius: 18,
      paddingVertical: 16,
      paddingHorizontal: 40,
    },

    stopButtonText: {
      color: '#D96FA3',
      fontSize: 16,
      fontWeight: '800',
    },

    overallCard: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 24,
      padding: 24,
      alignItems: 'center',
      marginBottom: 16,
    },

    overallLabel: {
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1,
      color: '#A98796',
    },

    overallScore: {
      fontSize: 64,
      fontWeight: '900',
      color: '#D96FA3',
      marginVertical: 6,
    },

    statusText: {
      fontSize: 13,
      fontWeight: '900',
      letterSpacing: 1,
    },

    passed: {
      color: '#5B9A76',
    },

    needsPractice: {
      color: '#C45A91',
    },

    scoreCard: {
      backgroundColor:
        '#FFFFFF',
      borderRadius: 18,
      padding: 18,
      marginBottom: 10,
      flexDirection:
        'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
    },

    scoreLabel: {
      fontSize: 15,
      fontWeight: '700',
      color: '#5E4753',
    },

    scoreValue: {
      fontSize: 20,
      fontWeight: '900',
      color: '#D96FA3',
    },

    statsGrid: {
      flexDirection:
        'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 6,
      marginBottom: 16,
    },

    statBox: {
      width: '48%',
      backgroundColor:
        '#FFFFFF',
      borderRadius: 18,
      padding: 16,
    },

    statValue: {
      fontSize: 19,
      fontWeight: '900',
      color: '#3A2531',
      marginBottom: 4,
    },

    statLabel: {
      fontSize: 12,
      color: '#8A707C',
    },

    feedbackCard: {
      backgroundColor:
        '#FBE8F1',
      borderRadius: 20,
      padding: 20,
      marginBottom: 20,
    },

    feedbackTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: '#3A2531',
      marginBottom: 8,
    },

    feedbackText: {
      fontSize: 15,
      lineHeight: 23,
      color: '#765F6A',
    },
  });