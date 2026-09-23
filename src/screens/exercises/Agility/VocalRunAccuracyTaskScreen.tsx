import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  RAPID_VOCAL_RUN_PARAMS,
  type Tier,
} from '@/constants/exercises/agility';

import {
  measureVocalRunAccuracy,
} from '@/services/measurement/agility/vocalRunAccuracyTask';

import {
  scoreVocalRunAccuracy,
} from '@/services/scoring/agility/vocalRunAccuracyTask';

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

const GREEN = '#39734A';
const RED = '#A04444';

// ============================================================
// CONFIG
// ============================================================

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4410;
const COUNTDOWN_SECONDS = 3;
const MAX_RECORDING_SECONDS = 10;

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

type ExerciseResult = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  transitionScore: number;

  passed: boolean;
  feedback: string;

  noteCount: number;
  correctNoteCount: number;

  transitionCount: number;
  correctTransitionCount: number;

  notesPerSecond: number;
  durationMs: number;
};

// ============================================================
// HELPERS
// ============================================================

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const frequencyToNoteName = (
  frequency: number,
): string => {
  if (
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return '--';
  }

  const noteNames = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];

  const midi = Math.round(
    69 +
      12 *
        Math.log2(frequency / 440),
  );

  const noteIndex =
    ((midi % 12) + 12) % 12;

  const octave =
    Math.floor(midi / 12) - 1;

  return `${noteNames[noteIndex]}${octave}`;
};

// ============================================================
// COMPONENT
// ============================================================

export default function VocalRunAccuracyTaskScreen({
  tier,
}: {
  tier: Tier;
}) {
  const config =
    RAPID_VOCAL_RUN_PARAMS[tier];

  // ==========================================================
  // STATE
  // ==========================================================

  const [phase, setPhase] =
    useState<Phase>('instructions');

  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);

  const [recordingTime, setRecordingTime] =
    useState(0);

  const [result, setResult] =
    useState<ExerciseResult | null>(null);

  const [errorMessage, setErrorMessage] =
    useState('');

  // ==========================================================
  // REFS
  // ==========================================================

  const mountedRef =
    useRef(true);

  const audioContextRef =
    useRef<AudioContext | null>(null);

  const recorderRef =
    useRef<AudioRecorder | null>(null);

  const samplesRef =
    useRef<number[]>([]);

  const recordingStartRef =
    useRef<number | null>(null);

  const recordingTimerRef =
    useRef<
      ReturnType<typeof setInterval> | null
    >(null);

  const processingRef =
    useRef(false);

  const phaseRef =
    useRef<Phase>('instructions');

  // ==========================================================
  // SET PHASE
  // ==========================================================

  const setExercisePhase =
    useCallback((next: Phase) => {
      phaseRef.current = next;
      setPhase(next);
    }, []);

  // ==========================================================
  // TIMER CLEANUP
  // ==========================================================

  const clearRecordingTimer =
    useCallback(() => {
      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current,
        );

        recordingTimerRef.current =
          null;
      }
    }, []);

  // ==========================================================
  // STOP RECORDING
  // ==========================================================

  const stopRecording =
    useCallback(() => {
      clearRecordingTimer();

      const recorder =
        recorderRef.current;

      if (recorder) {
        try {
          recorder.clearOnAudioReady();
        } catch {}

        try {
          void recorder.stop();
        } catch {}

        recorderRef.current = null;
      }

      recordingStartRef.current =
        null;

      try {
        void AudioManager.setAudioSessionActivity(
          false,
        );
      } catch {}
    }, [clearRecordingTimer]);

  // ==========================================================
  // UNMOUNT CLEANUP
  // ==========================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      stopRecording();

      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {}

        audioContextRef.current =
          null;
      }
    };
  }, [stopRecording]);

  // ==========================================================
  // MICROPHONE PERMISSION
  // ==========================================================

  const requestMicrophonePermission =
    useCallback(
      async (): Promise<boolean> => {
        try {
          const permission =
            await AudioManager.requestRecordingPermissions();

          if (
            permission !== 'Granted'
          ) {
            setErrorMessage(
              'Microphone permission is required to perform this exercise.',
            );

            return false;
          }

          return true;
        } catch (error) {
          console.warn(
            'Microphone permission request failed:',
            error,
          );

          if (mountedRef.current) {
            setErrorMessage(
              'We could not access the microphone. Please check your microphone permissions.',
            );
          }

          return false;
        }
      },
      [],
    );

  // ==========================================================
  // REFERENCE PLAYBACK
  // ==========================================================

  const playReference =
    useCallback(async () => {
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

        for (
          const frequency of config.frequencies
        ) {
          if (!mountedRef.current) {
            return;
          }

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
              config.noteDurationSec,
          );

          await sleep(
            config.noteDurationSec *
              1000,
          );
        }
      } catch (error) {
        console.warn(
          'Reference playback failed:',
          error,
        );

        if (mountedRef.current) {
          setErrorMessage(
            'The reference sequence could not be played. Please try again.',
          );
        }
      }
    }, [config]);

  // ==========================================================
  // BEGIN EXERCISE
  // ==========================================================

  const beginExercise =
    useCallback(async () => {
      setErrorMessage('');

      const permission =
        await requestMicrophonePermission();

      if (!permission) {
        return;
      }

      setExercisePhase(
        'reference',
      );
    }, [
      requestMicrophonePermission,
      setExercisePhase,
    ]);

  // ==========================================================
  // START REFERENCE
  // ==========================================================

  const handlePlayReference =
    useCallback(async () => {
      setErrorMessage('');

      await playReference();
    }, [playReference]);

  // ==========================================================
  // START COUNTDOWN
  // ==========================================================

  const startCountdown =
    useCallback(async () => {
      setErrorMessage('');

      setExercisePhase(
        'countdown',
      );

      for (
        let value =
          COUNTDOWN_SECONDS;
        value >= 1;
        value--
      ) {
        if (!mountedRef.current) {
          return;
        }

        setCountdown(value);

        await sleep(1000);
      }

      if (!mountedRef.current) {
        return;
      }

      await startRecording();
    }, [setExercisePhase]);

  // ==========================================================
  // START RECORDING
  // ==========================================================

  const startRecording =
    useCallback(async () => {
      if (
        recorderRef.current
      ) {
        return;
      }

      try {
        processingRef.current =
          false;

        samplesRef.current = [];

        setRecordingTime(0);

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
                  let index = 0;
                  index <
                  frameCount;
                  index++
                ) {
                  const sample =
                    channelData[
                      index
                    ];

                  if (
                    Number.isFinite(
                      sample,
                    )
                  ) {
                    samplesRef.current.push(
                      sample,
                    );
                  }
                }
              } catch (error) {
                console.warn(
                  'Could not read audio buffer:',
                  error,
                );
              }
            },
          );

        if (
          callbackResult.status ===
          'error'
        ) {
          throw new Error(
            callbackResult.message,
          );
        }

        await AudioManager.setAudioSessionActivity(
          true,
        );

        const startResult =
          await recorder.start();

        if (
          startResult.status ===
          'error'
        ) {
          throw new Error(
            startResult.message,
          );
        }

        if (!mountedRef.current) {
          stopRecording();
          return;
        }

        recordingStartRef.current =
          Date.now();

        setRecordingTime(0);

        setExercisePhase(
          'recording',
        );

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

            if (!mountedRef.current) {
              return;
            }

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

        stopRecording();

        if (mountedRef.current) {
          setErrorMessage(
            'We could not start the recording. Please try again.',
          );

          setExercisePhase(
            'instructions',
          );
        }
      }
    }, [setExercisePhase, stopRecording]);

  // ==========================================================
  // PROCESS RECORDING
  // ==========================================================

  const processRecording =
    useCallback(async () => {
      if (
        processingRef.current
      ) {
        return;
      }

      if (
        phaseRef.current !==
        'recording'
      ) {
        return;
      }

      processingRef.current =
        true;

      stopRecording();

      if (mountedRef.current) {
        setExercisePhase(
          'processing',
        );
      }

      await sleep(300);

      try {
        const samples =
          new Float32Array(
            samplesRef.current,
          );

        if (samples.length === 0) {
          throw new Error(
            'No audio samples were captured.',
          );
        }

        const measurement =
          measureVocalRunAccuracy(
            samples,
            SAMPLE_RATE,
            config.frequencies,
          );

        const score =
          scoreVocalRunAccuracy(
            measurement,
          );

        if (!mountedRef.current) {
          return;
        }

        setResult({
          overall:
            score.overall,

          pitchScore:
            score.pitchScore,

          sequenceScore:
            score.sequenceScore,

          transitionScore:
            score.transitionScore,

          passed:
            score.passed,

          feedback:
            score.feedback,

          noteCount:
            measurement.noteCount,

          correctNoteCount:
            measurement.correctNoteCount,

          transitionCount:
            measurement.transitionCount,

          correctTransitionCount:
            measurement.correctTransitionCount,

          notesPerSecond:
            measurement.notesPerSecond,

          durationMs:
            measurement.durationMs,
        });

        setExercisePhase(
          'results',
        );
      } catch (error) {
        console.warn(
          'Vocal Run Accuracy processing failed:',
          error,
        );

        if (mountedRef.current) {
          setErrorMessage(
            'We could not analyze this recording. Please try again.',
          );

          setExercisePhase(
            'instructions',
          );
        }
      } finally {
        processingRef.current =
          false;
      }
    }, [
      config.frequencies,
      setExercisePhase,
      stopRecording,
    ]);

  // ==========================================================
  // FINISH RECORDING
  // ==========================================================

  const finishRecording =
    useCallback(() => {
      if (
        !recorderRef.current ||
        processingRef.current
      ) {
        return;
      }

      void processRecording();
    }, [processRecording]);

  // ==========================================================
  // RESET
  // ==========================================================

  const resetExercise =
    useCallback(() => {
      stopRecording();

      processingRef.current =
        false;

      samplesRef.current = [];

      setResult(null);

      setRecordingTime(0);

      setCountdown(
        COUNTDOWN_SECONDS,
      );

      setErrorMessage('');

      setExercisePhase(
        'instructions',
      );
    }, [
      setExercisePhase,
      stopRecording,
    ]);

  // ==========================================================
  // INSTRUCTIONS
  // ==========================================================

  const renderInstructions =
    () => (
      <View style={styles.content}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
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
            name="flash-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text style={styles.title}>
          Vocal Run Accuracy
        </Text>

        <Text style={styles.subtitle}>
          VOCAL AGILITY
        </Text>

        <View
          style={
            styles.instructionCard
          }
        >
          <View
            style={
              styles.prepareCard
            }
          >
            <View
              style={
                styles.prepareHeader
              }
            >
              <Ionicons
                name="information-circle-outline"
                size={21}
                color={BROWN}
              />

              <Text
                style={
                  styles.prepareTitle
                }
              >
                Before You Begin
              </Text>
            </View>

            <View
              style={
                styles.prepareItem
              }
            >
              <Ionicons
                name="volume-mute-outline"
                size={17}
                color={BROWN}
              />

              <Text
                style={
                  styles.prepareText
                }
              >
                Find a quiet area with minimal background noise.
              </Text>
            </View>

            <View
              style={
                styles.prepareItem
              }
            >
              <Ionicons
                name="body-outline"
                size={17}
                color={BROWN}
              />

              <Text
                style={
                  styles.prepareText
                }
              >
                Stand or sit upright with your shoulders relaxed.
              </Text>
            </View>

            <View
              style={
                styles.prepareItem
              }
            >
              <Ionicons
                name="mic-outline"
                size={17}
                color={BROWN}
              />

              <Text
                style={
                  styles.prepareText
                }
              >
                Keep a comfortable distance from the microphone while singing.
              </Text>
            </View>
          </View>

          <Text
            style={styles.cardTitle}
          >
            Exercise Details
          </Text>

          <View style={styles.detailRow}>
            <Text
              style={
                styles.detailLabel
              }
            >
              Difficulty
            </Text>

            <Text
              style={
                styles.detailValue
              }
            >
              {config.label}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <Text
              style={
                styles.detailLabel
              }
            >
              Speed
            </Text>

            <Text
              style={
                styles.detailValue
              }
            >
              {config.speedLabel}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <Text
              style={
                styles.detailLabel
              }
            >
              Notes
            </Text>

            <Text
              style={
                styles.detailValue
              }
            >
              {config.frequencies.length}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <Text
              style={
                styles.detailLabel
              }
            >
              Note Duration
            </Text>

            <Text
              style={
                styles.detailValue
              }
            >
              {config.noteDurationSec.toFixed(
                2,
              )}{' '}
              sec
            </Text>
          </View>

          <Text
            style={[
              styles.cardTitle,
              {
                marginTop: 14,
              },
            ]}
          >
            Instructions
          </Text>

          <View
            style={
              styles.prepareItem
            }
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={17}
              color={BROWN}
            />

            <Text
              style={
                styles.prepareText
              }
            >
              Listen carefully to the reference vocal run.
            </Text>
          </View>

          <View
            style={
              styles.prepareItem
            }
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={17}
              color={BROWN}
            />

            <Text
              style={
                styles.prepareText
              }
            >
              Sing every note in the same order.
            </Text>
          </View>

          <View
            style={
              styles.prepareItem
            }
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={17}
              color={BROWN}
            />

            <Text
              style={
                styles.prepareText
              }
            >
              Keep your pitch accurate throughout the run.
            </Text>
          </View>

          <View
            style={
              styles.prepareItem
            }
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={17}
              color={BROWN}
            />

            <Text
              style={
                styles.prepareText
              }
            >
              Move smoothly between each note.
            </Text>
          </View>
        </View>

        <View
          style={
            styles.referenceCard
          }
        >
          <Text
            style={styles.cardTitle}
          >
            Reference Sequence
          </Text>

          <Text
            style={
              styles.referenceLabel
            }
          >
            LISTEN AND FOLLOW THE NOTE ORDER
          </Text>

          <View
            style={
              styles.noteSequence
            }
          >
            {config.frequencies.map(
              (
                frequency,
                index,
              ) => (
                <View
                  key={`${frequency}-${index}`}
                  style={
                    styles.notePill
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
                      styles.noteText
                    }
                  >
                    {frequencyToNoteName(
                      frequency,
                    )}
                  </Text>
                </View>
              ),
            )}
          </View>

          <Text
            style={
              styles.referenceHint
            }
          >
            The reference run will play before recording begins.
          </Text>
        </View>

        {errorMessage ? (
          <View
            style={
              styles.errorCard
            }
          >
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={BROWN}
            />

            <Text
              style={
                styles.errorText
              }
            >
              {errorMessage}
            </Text>
          </View>
        ) : null}

        <View style={styles.tipCard}>
          <Ionicons
            name="bulb-outline"
            size={19}
            color={BROWN}
          />

          <Text
            style={styles.tipText}
          >
            Focus on accurate notes and smooth transitions. Speed should come naturally with practice.
          </Text>
        </View>

        <View
          style={
            styles.difficultyRow
          }
        >
          <Text
            style={
              styles.difficultyLabel
            }
          >
            Difficulty
          </Text>

          <Text
            style={
              styles.difficultyValue
            }
          >
            {config.label}
          </Text>
        </View>

        <Pressable
          style={styles.startButton}
          onPress={beginExercise}
        >
          <Ionicons
            name="play"
            size={18}
            color={WHITE}
          />

          <Text
            style={
              styles.startButtonText
            }
          >
            Start Exercise
          </Text>
        </Pressable>
      </View>
    );

  // ==========================================================
  // REFERENCE
  // ==========================================================

  const renderReference =
    () => (
      <View style={styles.content}>
        <Pressable
          style={styles.backButton}
          onPress={() =>
            setExercisePhase(
              'instructions',
            )
          }
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

        <Text
          style={styles.title}
        >
          Listen First
        </Text>

        <Text
          style={styles.subtitle}
        >
          REFERENCE SEQUENCE
        </Text>

        <View
          style={
            styles.referenceCard
          }
        >
          <Text
            style={styles.cardTitle}
          >
            Note Sequence
          </Text>

          <Text
            style={
              styles.referenceLabel
            }
          >
            FOLLOW THE NOTES IN ORDER
          </Text>

          <View
            style={
              styles.noteSequence
            }
          >
            {config.frequencies.map(
              (
                frequency,
                index,
              ) => (
                <View
                  key={`${frequency}-${index}`}
                  style={
                    styles.notePill
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
                      styles.noteText
                    }
                  >
                    {frequencyToNoteName(
                      frequency,
                    )}
                  </Text>
                </View>
              ),
            )}
          </View>

          <Text
            style={
              styles.referenceHint
            }
          >
            Listen to the complete run before you begin singing.
          </Text>
        </View>

        <Pressable
          style={styles.startButton}
          onPress={
            handlePlayReference
          }
        >
          <Ionicons
            name="play"
            size={18}
            color={WHITE}
          />

          <Text
            style={
              styles.startButtonText
            }
          >
            Play Reference
          </Text>
        </Pressable>

        <Pressable
          style={styles.finishButton}
          onPress={
            startCountdown
          }
        >
          <Ionicons
            name="arrow-forward"
            size={18}
            color={BROWN}
          />

          <Text
            style={
              styles.finishButtonText
            }
          >
            Continue
          </Text>
        </Pressable>
      </View>
    );

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  const renderCountdown =
    () => (
      <View
        style={
          styles.centerScreen
        }
      >
        <View
          style={styles.iconCircle}
        >
          <Ionicons
            name="flash-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={
            styles.phaseTitle
          }
        >
          Get Ready
        </Text>

        <Text
          style={
            styles.countdownText
          }
        >
          {countdown}
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Prepare to sing the vocal run.
        </Text>
      </View>
    );

  // ==========================================================
  // RECORDING
  // ==========================================================

  const renderRecording =
    () => {
      const progress =
        Math.min(
          recordingTime /
            MAX_RECORDING_SECONDS,
          1,
        );

      return (
        <View
          style={styles.content}
        >
          <View
            style={
              styles.recordingIcon
            }
          >
            <Ionicons
              name="mic"
              size={34}
              color={BROWN}
            />
          </View>

          <Text
            style={
              styles.recordingTitle
            }
          >
            Sing the Vocal Run
          </Text>

          <Text
            style={
              styles.recordingSubtitle
            }
          >
            Follow the sequence as accurately and smoothly as possible.
          </Text>

          <View
            style={
              styles.recordingBadge
            }
          >
            <View
              style={
                styles.recordingDot
              }
            />

            <Text
              style={
                styles.recordingBadgeText
              }
            >
              RECORDING
            </Text>
          </View>

          <View
            style={
              styles.liveCard
            }
          >
            <Text
              style={
                styles.liveLabel
              }
            >
              TARGET SEQUENCE
            </Text>

            <View
              style={
                styles.liveSequence
              }
            >
              {config.frequencies.map(
                (
                  frequency,
                  index,
                ) => (
                  <View
                    key={`${frequency}-${index}`}
                    style={
                      styles.liveNote
                    }
                  >
                    <Text
                      style={
                        styles.liveNoteNumber
                      }
                    >
                      {index + 1}
                    </Text>

                    <Text
                      style={
                        styles.liveNoteText
                      }
                    >
                      {frequencyToNoteName(
                        frequency,
                      )}
                    </Text>
                  </View>
                ),
              )}
            </View>

            <View
              style={
                styles.liveDivider
              }
            />

            <View
              style={
                styles.liveStats
              }
            >
              <View
                style={
                  styles.liveStat
                }
              >
                <Text
                  style={
                    styles.liveStatLabel
                  }
                >
                  Notes
                </Text>

                <Text
                  style={
                    styles.liveStatValue
                  }
                >
                  {config.frequencies.length}
                </Text>
              </View>

              <View
                style={
                  styles.liveStat
                }
              >
                <Text
                  style={
                    styles.liveStatLabel
                  }
                >
                  Target Speed
                </Text>

                <Text
                  style={
                    styles.liveStatValue
                  }
                >
                  {config.speedLabel}
                </Text>
              </View>
            </View>
          </View>

          <Text
            style={styles.timerText}
          >
            Recording Time:{' '}
            {recordingTime.toFixed(1)}
            s
          </Text>

          <View
            style={
              styles.timerTrack
            }
          >
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
            style={
              styles.finishButton
            }
            onPress={
              finishRecording
            }
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

  // ==========================================================
  // PROCESSING
  // ==========================================================

  const renderProcessing =
    () => (
      <View
        style={
          styles.centerScreen
        }
      >
        <View
          style={
            styles.iconCircle
          }
        >
          <ActivityIndicator
            size="large"
            color={BROWN}
          />
        </View>

        <Text
          style={
            styles.phaseTitle
          }
        >
          Analyzing Your Singing
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Measuring pitch accuracy, sequence accuracy, transitions, and performance speed.
        </Text>
      </View>
    );

  // ==========================================================
  // RESULTS
  // ==========================================================

  const renderResults =
    () => {
      if (!result) {
        return null;
      }

      return (
        <View
          style={
            styles.resultsContent
          }
        >
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

          <Text
            style={
              styles.resultTitle
            }
          >
            {result.passed
              ? 'Great Job!'
              : 'Keep Practicing!'}
          </Text>

          <Text
            style={
              styles.resultSubtitle
            }
          >
            Vocal Run Accuracy Result
          </Text>

          <View
            style={
              styles.scoreCard
            }
          >
            <Text
              style={
                styles.scoreLabel
              }
            >
              OVERALL SCORE
            </Text>

            <Text
              style={
                styles.scoreValue
              }
            >
              {Math.round(
                result.overall,
              )}
            </Text>

            <Text
              style={
                styles.scoreDescription
              }
            >
              out of 100
            </Text>
          </View>

          <View
            style={
              styles.statusBadge
            }
          >
            <Text
              style={[
                styles.statusText,
                result.passed
                  ? styles.statusPassedText
                  : styles.statusNeedsWorkText,
              ]}
            >
              {result.passed
                ? 'PASSED'
                : 'KEEP PRACTICING'}
            </Text>
          </View>

          <View
            style={
              styles.resultCard
            }
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Accuracy Breakdown
            </Text>

            <View
              style={
                styles.scoreRow
              }
            >
              <View
                style={
                  styles.scoreRowHeader
                }
              >
                <Text
                  style={
                    styles.scoreRowLabel
                  }
                >
                  Pitch Accuracy
                </Text>

                <Text
                  style={
                    styles.scoreRowValue
                  }
                >
                  {Math.round(
                    result.pitchScore,
                  )}
                  %
                </Text>
              </View>

              <View
                style={
                  styles.progressBackground
                }
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

            <View
              style={
                styles.scoreRow
              }
            >
              <View
                style={
                  styles.scoreRowHeader
                }
              >
                <Text
                  style={
                    styles.scoreRowLabel
                  }
                >
                  Sequence Accuracy
                </Text>

                <Text
                  style={
                    styles.scoreRowValue
                  }
                >
                  {Math.round(
                    result.sequenceScore,
                  )}
                  %
                </Text>
              </View>

              <View
                style={
                  styles.progressBackground
                }
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

            <View
              style={
                styles.scoreRowLast
              }
            >
              <View
                style={
                  styles.scoreRowHeader
                }
              >
                <Text
                  style={
                    styles.scoreRowLabel
                  }
                >
                  Transition Accuracy
                </Text>

                <Text
                  style={
                    styles.scoreRowValue
                  }
                >
                  {Math.round(
                    result.transitionScore,
                  )}
                  %
                </Text>
              </View>

              <View
                style={
                  styles.progressBackground
                }
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(
                        Math.max(
                          result.transitionScore,
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

          <View
            style={
              styles.resultCard
            }
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Performance Metrics
            </Text>

            <View
              style={
                styles.metricRow
              }
            >
              <Text
                style={
                  styles.metricLabel
                }
              >
                Correct Notes
              </Text>

              <Text
                style={
                  styles.metricValue
                }
              >
                {result.correctNoteCount}/
                {result.noteCount}
              </Text>
            </View>

            <View
              style={
                styles.metricRow
              }
            >
              <Text
                style={
                  styles.metricLabel
                }
              >
                Correct Transitions
              </Text>

              <Text
                style={
                  styles.metricValue
                }
              >
                {
                  result.correctTransitionCount
                }
                /
                {
                  result.transitionCount
                }
              </Text>
            </View>

            <View
              style={
                styles.metricRow
              }
            >
              <Text
                style={
                  styles.metricLabel
                }
              >
                Notes/sec
              </Text>

              <Text
                style={
                  styles.metricValue
                }
              >
                {result.notesPerSecond.toFixed(
                  2,
                )}
              </Text>
            </View>

            <View
              style={[
                styles.metricRow,
                styles.metricRowLast,
              ]}
            >
              <Text
                style={
                  styles.metricLabel
                }
              >
                Duration
              </Text>

              <Text
                style={
                  styles.metricValue
                }
              >
                {(
                  result.durationMs /
                  1000
                ).toFixed(1)}
                s
              </Text>
            </View>
          </View>

          <View
            style={
              styles.tipCard
            }
          >
            <Ionicons
              name="bulb-outline"
              size={20}
              color={BROWN}
            />

            <Text
              style={
                styles.tipText
              }
            >
              {result.feedback}
            </Text>
          </View>

          <Pressable
            style={
              styles.startButton
            }
            onPress={
              resetExercise
            }
          >
            <Ionicons
              name="refresh"
              size={18}
              color={WHITE}
            />

            <Text
              style={
                styles.startButtonText
              }
            >
              Try Again
            </Text>
          </Pressable>

          <Pressable
            style={
              styles.doneButton
            }
            onPress={() =>
              router.replace(
                '/dashboard/exercises',
              )
            }
          >
            <Text
              style={
                styles.doneButtonText
              }
            >
              Done
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
      showsVerticalScrollIndicator={
        false
      }
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
  // ==========================================================
  // SCREEN / CONTENT
  // ==========================================================

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

  // ==========================================================
  // BACK BUTTON
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
  // GENERAL ICON / TITLE
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
  // INSTRUCTIONS
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

  // ==========================================================
  // REFERENCE
  // ==========================================================

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
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
  },

  noteNumber: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
    marginBottom: 2,
  },

  noteText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  // ==========================================================
  // COUNTDOWN / CENTER STATES
  // ==========================================================

  centerScreen: {
    flexGrow: 1,
    minHeight: 700,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
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

  liveSequence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },

  liveNote: {
    minWidth: 52,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 13,
    backgroundColor: PINK,
    alignItems: 'center',
  },

  liveNoteNumber: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
    marginBottom: 1,
  },

  liveNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
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
    fontSize: 14,
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

  statusBadge: {
    marginTop: 14,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: LIGHT_PINK,
  },

  statusText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 0.6,
  },

  statusPassedText: {
    color: GREEN,
  },

  statusNeedsWorkText: {
    color: RED,
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
});