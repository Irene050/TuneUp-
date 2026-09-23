// src/screens/exercises/Pitch/NoteMatchingScreen.tsx

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';

import {
  NOTE_MATCHING_PARAMS,
  Tier,
} from '@/constants/exercises/pitch';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import {
  measureNoteMatching,
} from '@/services/measurement/pitch/noteMatching';

import {
  scoreNoteMatching,
} from '@/services/scoring/pitch/noteMatching';

import {
  disposeNotePlayer,
  playSingleNote,
} from '@/services/assessment/notePlayer';

import {
  calcLiveStability,
  calcPitchAccuracy,
  frequencyToNote,
} from '@/utils/dsp/pitch';

import {
  getRandomPitchNote,
} from '@/utils/music/notes';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

// ============================================================
// COLORS
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';

// ============================================================
// EXERCISE CONFIG
// ============================================================

const COUNTDOWN_SECONDS = 3;
const TARGET_NOTE_DURATION_SECONDS = 1.5;
const RECORDING_DURATION_SECONDS = 4;

// ============================================================
// TYPES
// ============================================================

type Screen =
  | 'instructions'
  | 'countdown'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'results';

type Props = {
  tier?: Tier;
};

type LivePitchState = {
  pitch: number;
  note: string;
  clarity: number;
  volume: number;
  stability: number;
};

type ResultState = {
  score: number;
  passed: boolean;
  deviationPct: number;
  detectedFrequency: number;
  averageClarity: number;
  voicedFrames: number;
};

// ============================================================
// HELPERS
// ============================================================

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function calculateCentsDifference(
  detectedFrequency: number,
  targetFrequency: number
): number {
  if (
    !Number.isFinite(detectedFrequency) ||
    !Number.isFinite(targetFrequency) ||
    detectedFrequency <= 0 ||
    targetFrequency <= 0
  ) {
    return 0;
  }

  return (
    1200 *
    Math.log2(
      detectedFrequency /
        targetFrequency
    )
  );
}

function getPitchMessage(
  cents: number
): string {
  const absoluteCents =
    Math.abs(cents);

  if (absoluteCents <= 25) {
    return 'Great!';
  }

  if (absoluteCents <= 50) {
    return 'Close';
  }

  if (cents > 0) {
    return 'Too High';
  }

  return 'Too Low';
}

function formatFrequency(
  frequency: number
): string {
  if (
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return '--';
  }

  return `${frequency.toFixed(1)} Hz`;
}

function formatCents(
  cents: number
): string {
  if (!Number.isFinite(cents)) {
    return '--';
  }

  if (Math.abs(cents) < 0.5) {
    return '0 cents';
  }

  return `${
    cents > 0 ? '+' : ''
  }${Math.round(cents)} cents`;
}

function formatVolume(
  volume: number
): string {
  if (!Number.isFinite(volume)) {
    return '--';
  }

  return `${Math.round(volume)} dB`;
}

// ============================================================
// COMPONENT
// ============================================================

export default function NoteMatchingScreen({
  tier = 'beginner',
}: Props) {
  const [screen, setScreen] =
    useState<Screen>(
      'instructions'
    );

  const [countdown, setCountdown] =
    useState(
      COUNTDOWN_SECONDS
    );

  const [elapsedSeconds, setElapsedSeconds] =
    useState(0);

  const [livePitch, setLivePitch] =
    useState<LivePitchState>({
      pitch: 0,
      note: '--',
      clarity: 0,
      volume: -100,
      stability: 0,
    });

  const [result, setResult] =
    useState<ResultState | null>(
      null
    );

  const [errorMessage, setErrorMessage] =
    useState('');

  // ==========================================================
  // TARGET NOTE
  // ==========================================================

  const target = useMemo(
    () => getRandomPitchNote(tier),
    [tier]
  );

  const targetFrequency =
    target.frequency;

  const targetNote =
    target.name;

  // ==========================================================
  // REFS
  // ==========================================================

  const mountedRef =
    useRef(true);

  const pitchHistoryRef =
    useRef<number[]>([]);

  const countdownTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const startingRef =
    useRef(false);

  const finishingRef =
    useRef(false);

  // ==========================================================
  // TIMER CLEANUP
  // ==========================================================

  const clearTimers =
    useCallback(() => {
      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current
        );

        countdownTimerRef.current =
          null;
      }

      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current
        );

        recordingTimerRef.current =
          null;
      }
    }, []);

  // ==========================================================
  // LIVE AUDIO FRAME
  // ==========================================================

  const handleLiveFrame =
    useCallback(
      (frame: {
        pitch: number;
        note: string;
        clarity: number;
        volume: number;
        stability: number;
      }) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        if (
          Number.isFinite(frame.pitch) &&
          frame.pitch > 0
        ) {
          const history = [
            ...pitchHistoryRef.current,
            frame.pitch,
          ].slice(-20);

          pitchHistoryRef.current =
            history;

          const stability =
            calcLiveStability(
              history
            );

          setLivePitch({
            pitch: frame.pitch,
            note:
              frame.note || '--',
            clarity:
              frame.clarity,
            volume:
              frame.volume,
            stability,
          });

          return;
        }

        setLivePitch(previous => ({
          ...previous,
          pitch: 0,
          note: '--',
          clarity: frame.clarity,
          volume: frame.volume,
        }));
      },
      []
    );

  // ==========================================================
  // PROCESS COMPLETED RECORDING
  // ==========================================================

  const handleRecordingStop =
    useCallback(
      async (
        samples: Float32Array,
        sampleRate: number
      ) => {
        clearTimers();

        if (
          !mountedRef.current
        ) {
          return;
        }

        setScreen(
          'processing'
        );

        try {
          const measurement =
            measureNoteMatching(
              samples,
              sampleRate,
              NOTE_MATCHING_PARAMS[
                tier
              ].minClarity
            );

          const scored =
            scoreNoteMatching(
              measurement,
              targetFrequency,
              tier
            );

            await saveCompletedExercise(
  'pitch',
  'noteMatchingExercise',
  tier,
  scored.score,
);

          if (
            !mountedRef.current
          ) {
            return;
          }

          setResult({
            score: scored.score,
            passed: scored.passed,
            deviationPct:
              scored.deviationPct,
            detectedFrequency:
              scored.detectedFrequency,
            averageClarity:
              scored.averageClarity,
            voicedFrames:
              measurement.voicedFrames,
          });

          setScreen(
            'results'
          );
        } catch (error) {
          console.error(
            '❌ NOTE MATCHING ANALYSIS ERROR:',
            error
          );

          if (
            mountedRef.current
          ) {
            setErrorMessage(
              'We could not analyze your recording. Please try again.'
            );

            setScreen(
              'instructions'
            );
          }
        } finally {
          finishingRef.current =
            false;

          startingRef.current =
            false;
        }
      },
      [
        clearTimers,
        targetFrequency,
        tier,
      ]
    );

  // ==========================================================
  // AUDIO RECORDER
  // ==========================================================

  const {
    startRecording,
    stopRecording,
    isRecording,
  } =
    useAudioRecorder({
      onFrame:
        handleLiveFrame,

      onStop:
        handleRecordingStop,
    });

  // ==========================================================
  // UNMOUNT CLEANUP
  // ==========================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current =
        false;

      clearTimers();

      disposeNotePlayer().catch(
        error => {
          console.warn(
            '⚠️ Failed to dispose note player:',
            error
          );
        }
      );
    };
  }, [clearTimers]);

  // ==========================================================
  // START EXERCISE
  // ==========================================================

  const startExercise =
    useCallback(() => {
      if (
        startingRef.current
      ) {
        return;
      }

      startingRef.current =
        true;

      finishingRef.current =
        false;

      clearTimers();

      pitchHistoryRef.current =
        [];

      setErrorMessage('');

      setResult(null);

      setLivePitch({
        pitch: 0,
        note: '--',
        clarity: 0,
        volume: -100,
        stability: 0,
      });

      setElapsedSeconds(0);

      setCountdown(
        COUNTDOWN_SECONDS
      );

      setScreen(
        'countdown'
      );

      let remaining =
        COUNTDOWN_SECONDS;

      countdownTimerRef.current =
        setInterval(() => {
          remaining -= 1;

          if (
            !mountedRef.current
          ) {
            return;
          }

          if (remaining > 0) {
            setCountdown(
              remaining
            );

            return;
          }

          clearTimers();

          setCountdown(0);

          setScreen(
            'listening'
          );

          /*
           * Play the reference note BEFORE
           * starting the microphone.
           *
           * This prevents the generated
           * reference tone from being
           * included in the recording.
           */
          playSingleNote(
            targetFrequency,
            TARGET_NOTE_DURATION_SECONDS
          )
            .then(
              async () => {
                if (
                  !mountedRef.current
                ) {
                  return;
                }

                await startRecording();

                if (
                  !mountedRef.current
                ) {
                  return;
                }

                setScreen(
                  'recording'
                );

                setElapsedSeconds(
                  0
                );

                let elapsed = 0;

                recordingTimerRef.current =
                  setInterval(() => {
                    elapsed += 0.1;

                    if (
                      !mountedRef.current
                    ) {
                      return;
                    }

                    setElapsedSeconds(
                      Math.min(
                        elapsed,
                        RECORDING_DURATION_SECONDS
                      )
                    );

                    if (
                      elapsed >=
                      RECORDING_DURATION_SECONDS
                    ) {
                      clearTimers();

                      if (
                        !finishingRef.current
                      ) {
                        finishingRef.current =
                          true;

                        stopRecording();
                      }
                    }
                  }, 100);
              }
            )
            .catch(error => {
              console.error(
                '❌ FAILED TO START NOTE MATCHING:',
                error
              );

              startingRef.current =
                false;

              if (
                mountedRef.current
              ) {
                setErrorMessage(
                  'We could not start the exercise. Please check your microphone permission and try again.'
                );

                setScreen(
                  'instructions'
                );
              }
            });
        }, 1000);
    }, [
      clearTimers,
      startRecording,
      stopRecording,
      targetFrequency,
    ]);

  // ==========================================================
  // MANUAL FINISH
  // ==========================================================

  const finishRecording =
    useCallback(() => {
      if (
        !isRecording ||
        finishingRef.current
      ) {
        return;
      }

      finishingRef.current =
        true;

      clearTimers();

      stopRecording();
    }, [
      clearTimers,
      isRecording,
      stopRecording,
    ]);

  // ==========================================================
  // RETRY
  // ==========================================================

  const retryExercise =
    useCallback(() => {
      clearTimers();

      startingRef.current =
        false;

      finishingRef.current =
        false;

      pitchHistoryRef.current =
        [];

      setResult(null);

      setErrorMessage('');

      setElapsedSeconds(0);

      setCountdown(
        COUNTDOWN_SECONDS
      );

      setLivePitch({
        pitch: 0,
        note: '--',
        clarity: 0,
        volume: -100,
        stability: 0,
      });

      setScreen(
        'instructions'
      );
    }, [clearTimers]);

  // ==========================================================
  // GO BACK
  // ==========================================================

  const goBack =
    useCallback(() => {
      clearTimers();

      router.replace(
        '/dashboard/exercises'
      );
    }, [clearTimers]);

  // ==========================================================
  // INSTRUCTIONS
  // ==========================================================

  if (
    screen === 'instructions'
  ) {
    return (
      <View style={styles.screen}>
        <Pressable
          style={styles.backButton}
          onPress={goBack}
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={BROWN}
          />
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.content
          }
        >
          {/* ICON */}

          <View
            style={styles.iconCircle}
          >
            <Ionicons
              name="musical-note-outline"
              size={34}
              color={BROWN}
            />
          </View>

          {/* TITLE */}

          <Text style={styles.title}>
            Note Matching Exercise
          </Text>

          <Text style={styles.subtitle}>
            Pitch
          </Text>

          {/* INSTRUCTION CARD */}

          <View
            style={
              styles.instructionCard
            }
          >
            {/* BEFORE YOU BEGIN */}

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
                  name="mic-outline"
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
                  Find a quiet room or area
                  with minimal background
                  noise.
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
                  Sit upright or stand with
                  your back straight and
                  your shoulders relaxed.
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
                  If available, an external
                  microphone or audio
                  recording equipment is
                  recommended.
                </Text>
              </View>
            </View>

            {/* INSTRUCTIONS */}

            <Text
              style={styles.cardTitle}
            >
              Instructions
            </Text>

            <Text
              style={styles.instruction}
            >
              Listen carefully to the
              target note first.
            </Text>

            <Text
              style={styles.instruction}
            >
              After the target note
              finishes, sing the same note
              back.
            </Text>

            <Text
              style={styles.instruction}
            >
              Hold the note steadily and
              try to match the pitch as
              closely as possible.
            </Text>

            {/* TARGET */}

            <View
              style={styles.targetBox}
            >
              <Ionicons
                name="musical-note-outline"
                size={25}
                color={BROWN}
              />

              <View
                style={
                  styles.targetInfo
                }
              >
                <Text
                  style={
                    styles.targetLabel
                  }
                >
                  Target Note
                </Text>

                <Text
                  style={
                    styles.targetText
                  }
                >
                  {targetNote}
                </Text>
              </View>

              <Text
                style={
                  styles.targetFrequency
                }
              >
                {formatFrequency(
                  targetFrequency
                )}
              </Text>
            </View>

            <Text
              style={styles.helperText}
            >
              Focus on matching the target
              pitch comfortably without
              straining your voice.
            </Text>
          </View>

          {/* TIP */}

          <View
            style={styles.tipCard}
          >
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text
              style={styles.tipText}
            >
              Sing comfortably and make
              small adjustments until your
              pitch matches the target.
            </Text>
          </View>

          {/* DIFFICULTY */}

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
              {tier}
            </Text>
          </View>

          {/* ERROR */}

          {errorMessage ? (
            <View
              style={styles.errorCard}
            >
              <Ionicons
                name="alert-circle-outline"
                size={21}
                color={BROWN}
              />

              <Text
                style={styles.errorText}
              >
                {errorMessage}
              </Text>
            </View>
          ) : null}

          {/* START */}

          <Pressable
            style={styles.startButton}
            onPress={startExercise}
          >
            <Text
              style={
                styles.startButtonText
              }
            >
              Start Exercise
            </Text>

            <Ionicons
              name="arrow-forward"
              size={18}
              color={WHITE}
            />
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  if (
    screen === 'countdown'
  ) {
    return (
      <View
        style={styles.centerScreen}
      >
        <View
          style={styles.iconCircle}
        >
          <Ionicons
            name="musical-notes-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Get Ready
        </Text>

        <Text
          style={styles.countdownText}
        >
          {countdown}
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Your target note is
        </Text>

        <Text
          style={styles.largeNote}
        >
          {targetNote}
        </Text>

        <Text
          style={styles.stateFrequency}
        >
          {formatFrequency(
            targetFrequency
          )}
        </Text>
      </View>
    );
  }

  // ==========================================================
  // LISTENING
  // ==========================================================

  if (
    screen === 'listening'
  ) {
    return (
      <View
        style={styles.centerScreen}
      >
        <View
          style={styles.iconCircle}
        >
          <Ionicons
            name="volume-high-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Listen to the Note
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Listen carefully, then sing
          the same note.
        </Text>

        <View
          style={styles.listenNoteBox}
        >
          <Text
            style={styles.listenLabel}
          >
            TARGET NOTE
          </Text>

          <Text
            style={styles.largeNote}
          >
            {targetNote}
          </Text>

          <Text
            style={styles.stateFrequency}
          >
            {formatFrequency(
              targetFrequency
            )}
          </Text>
        </View>

        <ActivityIndicator
          size="small"
          color={BROWN}
          style={{
            marginTop: 24,
          }}
        />
      </View>
    );
  }

  // ==========================================================
  // RECORDING
  // ==========================================================

  if (
    screen === 'recording'
  ) {
    const cents =
      calculateCentsDifference(
        livePitch.pitch,
        targetFrequency
      );

    const accuracy =
      livePitch.pitch > 0
        ? calcPitchAccuracy(
            livePitch.pitch,
            targetFrequency
          )
        : 0;

    const progress =
      clamp(
        elapsedSeconds /
          RECORDING_DURATION_SECONDS,
        0,
        1
      );

    return (
      <View
        style={styles.screen}
      >
        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.recordingContent
          }
        >
          <View
            style={styles.recordingIcon}
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
            Sing the Note
          </Text>

          <Text
            style={
              styles.recordingSubtitle
            }
          >
            Match the target as closely
            as you can.
          </Text>

          {/* TARGET */}

          <View
            style={styles.smallTargetCard}
          >
            <View>
              <Text
                style={styles.smallLabel}
              >
                TARGET
              </Text>

              <Text
                style={styles.smallNote}
              >
                {targetNote}
              </Text>
            </View>

            <Text
              style={styles.smallHz}
            >
              {formatFrequency(
                targetFrequency
              )}
            </Text>
          </View>

          {/* MICROPHONE */}

          <View
            style={styles.microphoneArea}
          >
            <View
              style={
                styles.outerMicCircle
              }
            >
              <View
                style={
                  styles.innerMicCircle
                }
              >
                <Ionicons
                  name="mic"
                  size={52}
                  color={BROWN}
                />
              </View>
            </View>

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
          </View>

          {/* DETECTED PITCH */}

          <View
            style={styles.detectedArea}
          >
            <Text
              style={
                styles.detectedLabel
              }
            >
              DETECTED NOTE
            </Text>

            <Text
              style={
                styles.detectedNote
              }
            >
              {livePitch.note}
            </Text>

            <Text
              style={
                styles.detectedFrequency
              }
            >
              {formatFrequency(
                livePitch.pitch
              )}
            </Text>

            <Text
              style={
                styles.pitchMessage
              }
            >
              {livePitch.pitch > 0
                ? getPitchMessage(cents)
                : 'Listening...'}
            </Text>
          </View>

          {/* ACCURACY */}

          <View
            style={
              styles.accuracyTrack
            }
          >
            <View
              style={[
                styles.accuracyFill,
                {
                  width: `${clamp(
                    accuracy,
                    0,
                    100
                  )}%`,
                },
              ]}
            />
          </View>

          <Text
            style={styles.centsText}
          >
            {livePitch.pitch > 0
              ? formatCents(cents)
              : 'Waiting for pitch...'}
          </Text>

          {/* LIVE METRICS */}

          <View
            style={styles.metricsGrid}
          >
            <MetricCard
              label="ACCURACY"
              value={
                livePitch.pitch > 0
                  ? `${Math.round(
                      accuracy
                    )}%`
                  : '--'
              }
            />

            <MetricCard
              label="CLARITY"
              value={
                livePitch.clarity > 0
                  ? `${Math.round(
                      livePitch.clarity *
                        100
                    )}%`
                  : '--'
              }
            />

            <MetricCard
              label="STABILITY"
              value={
                livePitch.stability > 0
                  ? `${Math.round(
                      livePitch.stability
                    )}%`
                  : '--'
              }
            />

            <MetricCard
              label="VOLUME"
              value={formatVolume(
                livePitch.volume
              )}
            />
          </View>

          {/* TIMER */}

          <Text
            style={styles.timerText}
          >
            {elapsedSeconds.toFixed(
              1
            )}{' '}
            /{' '}
            {RECORDING_DURATION_SECONDS.toFixed(
              1
            )}
            s
          </Text>

          <View
            style={styles.timerTrack}
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

          {/* FINISH */}

          <Pressable
            style={styles.finishButton}
            onPress={
              finishRecording
            }
          >
            <Ionicons
              name="stop"
              size={20}
              color={BROWN}
            />

            <Text
              style={
                styles.finishButtonText
              }
            >
              Finish
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ==========================================================
  // PROCESSING
  // ==========================================================

  if (
    screen === 'processing'
  ) {
    return (
      <View
        style={styles.centerScreen}
      >
        <View
          style={styles.iconCircle}
        >
          <Ionicons
            name="analytics-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={styles.phaseTitle}
        >
          Analyzing Your Singing
        </Text>

        <Text
          style={styles.phaseSubtitle}
        >
          Checking your pitch accuracy.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={{
            marginTop: 28,
          }}
        />
      </View>
    );
  }

  // ==========================================================
  // RESULTS
  // ==========================================================

  if (
    screen === 'results' &&
    result
  ) {
    const detectedNote =
      result.detectedFrequency > 0
        ? frequencyToNote(
            result.detectedFrequency
          )
        : '--';

    const cents =
      calculateCentsDifference(
        result.detectedFrequency,
        targetFrequency
      );

    return (
      <View style={styles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
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
            style={styles.resultTitle}
          >
            {result.passed
              ? 'Great Job!'
              : 'Keep Practicing!'}
          </Text>

          <Text
            style={styles.resultSubtitle}
          >
            Note Matching Result
          </Text>

          {/* SCORE */}

          <View
            style={styles.scoreCard}
          >
            <Text
              style={styles.scoreLabel}
            >
              Overall Score
            </Text>

            <Text
              style={styles.scoreValue}
            >
              {result.score}%
            </Text>

            <Text
              style={
                styles.scoreDescription
              }
            >
              {result.passed
                ? 'You matched the target note accurately.'
                : 'Keep practicing your pitch placement.'}
            </Text>
          </View>

          {/* COMPARISON */}

          <View
            style={styles.resultCard}
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Pitch Comparison
            </Text>

            <View
              style={styles.comparisonRow}
            >
              <View
                style={
                  styles.comparisonSide
                }
              >
                <Text
                  style={
                    styles.comparisonLabel
                  }
                >
                  TARGET
                </Text>

                <Text
                  style={
                    styles.comparisonNote
                  }
                >
                  {targetNote}
                </Text>

                <Text
                  style={
                    styles.comparisonFrequency
                  }
                >
                  {formatFrequency(
                    targetFrequency
                  )}
                </Text>
              </View>

              <Ionicons
                name="arrow-forward"
                size={23}
                color={MUTED}
              />

              <View
                style={[
                  styles.comparisonSide,
                  styles.detectedComparison,
                ]}
              >
                <Text
                  style={
                    styles.comparisonLabel
                  }
                >
                  DETECTED
                </Text>

                <Text
                  style={
                    styles.comparisonNote
                  }
                >
                  {detectedNote}
                </Text>

                <Text
                  style={
                    styles.comparisonFrequency
                  }
                >
                  {formatFrequency(
                    result.detectedFrequency
                  )}
                </Text>
              </View>
            </View>
          </View>

          {/* METRICS */}

          <View
            style={styles.resultsGrid}
          >
            <MetricCard
              label="PITCH ACCURACY"
              value={`${result.score}%`}
            />

            <MetricCard
              label="DEVIATION"
              value={formatCents(cents)}
            />

            <MetricCard
              label="AVG. CLARITY"
              value={`${Math.round(
                result.averageClarity *
                  100
              )}%`}
            />

            <MetricCard
              label="VOICED FRAMES"
              value={String(
                result.voicedFrames
              )}
            />
          </View>

          {/* FEEDBACK */}

          <View
            style={styles.feedbackCard}
          >
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <View
              style={
                styles.feedbackContent
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
                {getFeedback(
                  result,
                  cents,
                  targetNote
                )}
              </Text>
            </View>
          </View>

          {/* RETRY */}

          <Pressable
            style={styles.startButton}
            onPress={
              retryExercise
            }
          >
            <Text
              style={
                styles.startButtonText
              }
            >
              Try Again
            </Text>

            <Ionicons
              name="refresh"
              size={18}
              color={WHITE}
            />
          </Pressable>

          <Pressable
            style={styles.doneButton}
            onPress={
              goBack
            }
          >
            <Text
              style={
                styles.doneButtonText
              }
            >
              Back to Exercises
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return null;
}

// ============================================================
// SMALL COMPONENTS
// ============================================================

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Text
        style={styles.metricLabel}
      >
        {label}
      </Text>

      <Text
        style={styles.metricValue}
      >
        {value}
      </Text>
    </View>
  );
}

// ============================================================
// FEEDBACK
// ============================================================

function getFeedback(
  result: ResultState,
  cents: number,
  targetNote: string
): string {
  if (
    result.detectedFrequency <= 0
  ) {
    return `We couldn't detect enough reliable pitch information. Try singing closer to the microphone and hold ${targetNote} steadily.`;
  }

  if (result.passed) {
    return `Excellent pitch matching! Your voice stayed close to ${targetNote}. Keep practicing controlled and steady pitch placement.`;
  }

  if (
    Math.abs(cents) <= 50
  ) {
    return `You were very close to ${targetNote}. Listen carefully to the reference note and make small adjustments while sustaining it.`;
  }

  if (cents > 0) {
    return `Your detected pitch was higher than ${targetNote}. Try relaxing your voice slightly and aim a little lower.`;
  }

  return `Your detected pitch was lower than ${targetNote}. Try supporting the note steadily and aim slightly higher.`;
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  // ========================================================
  // INSTRUCTIONS
  // ========================================================

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 100,
    paddingBottom: 60,
    alignItems: 'center',
  },

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,

    width: 40,
    height: 40,

    alignItems: 'center',
    justifyContent: 'center',
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

  instructionCard: {
    width: '100%',

    backgroundColor: LIGHT_PINK,

    borderRadius: 20,

    padding: 20,

    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  prepareCard: {
    width: '100%',

    backgroundColor: PINK,

    borderRadius: 18,

    padding: 16,

    marginBottom: 14,

    borderWidth: 1,
    borderColor: '#F2DDE5',
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

    marginBottom: 14,
  },

  instruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: BROWN,

    marginBottom: 10,
  },

  targetBox: {
    backgroundColor: PINK,

    borderRadius: 14,

    minHeight: 72,

    paddingVertical: 12,
    paddingHorizontal: 14,

    flexDirection: 'row',

    alignItems: 'center',

    marginVertical: 8,
  },

  targetInfo: {
    flex: 1,
    marginLeft: 9,
  },

  targetLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,

    textTransform: 'uppercase',
  },

  targetText: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,

    marginTop: 1,
  },

  targetFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  helperText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,

    textAlign: 'center',

    marginTop: 6,
  },

  tipCard: {
    width: '100%',

    flexDirection: 'row',
    alignItems: 'center',

    backgroundColor: PINK,

    borderRadius: 15,

    padding: 14,

    marginTop: 14,
  },

  tipText: {
    flex: 1,

    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,

    marginLeft: 10,
  },

  difficultyRow: {
    width: '100%',

    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',

    marginTop: 18,
    marginBottom: 20,
  },

  difficultyLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  difficultyValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,

    textTransform: 'capitalize',
  },

  errorCard: {
    width: '100%',

    flexDirection: 'row',
    alignItems: 'center',

    backgroundColor: LIGHT_PINK,

    borderRadius: 15,

    padding: 14,

    marginBottom: 14,

    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  errorText: {
    flex: 1,

    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,

    marginLeft: 9,
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
  },

  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  // ========================================================
  // CENTER STATES
  // ========================================================

  centerScreen: {
    flex: 1,

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
  },

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,

    marginTop: 20,
  },

  largeNote: {
    fontFamily: 'FredokaBold',
    fontSize: 55,
    color: BROWN,

    marginTop: 10,
  },

  stateFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,

    marginTop: 1,
  },

  listenNoteBox: {
    minWidth: 180,

    backgroundColor: PINK,

    borderRadius: 20,

    paddingVertical: 18,
    paddingHorizontal: 30,

    alignItems: 'center',

    marginTop: 22,
  },

  listenLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,

    letterSpacing: 0.8,
  },

  // ========================================================
  // RECORDING
  // ========================================================

  recordingContent: {
    flexGrow: 1,

    paddingHorizontal: 24,
    paddingTop: 82,
    paddingBottom: 50,

    alignItems: 'center',
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
  },

  smallTargetCard: {
    width: '100%',

    marginTop: 20,

    backgroundColor: LIGHT_PINK,

    borderRadius: 18,

    borderWidth: 1,
    borderColor: '#F2DDE5',

    paddingHorizontal: 18,
    paddingVertical: 13,

    flexDirection: 'row',

    alignItems: 'center',
    justifyContent: 'space-between',
  },

  smallLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,

    color: MUTED,

    letterSpacing: 0.7,
  },

  smallNote: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,

    marginTop: 1,
  },

  smallHz: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  microphoneArea: {
    alignItems: 'center',

    marginTop: 24,
    marginBottom: 18,
  },

  outerMicCircle: {
    width: 150,
    height: 150,

    borderRadius: 75,

    borderWidth: 8,
    borderColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',
  },

  innerMicCircle: {
    width: 118,
    height: 118,

    borderRadius: 59,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',
  },

  recordingBadge: {
    marginTop: 12,

    flexDirection: 'row',
    alignItems: 'center',

    backgroundColor: LIGHT_PINK,

    borderRadius: 20,

    paddingHorizontal: 13,
    paddingVertical: 7,
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

  detectedArea: {
    alignItems: 'center',
  },

  detectedLabel: {
    fontFamily: 'FredokaRegular',

    fontSize: 10,

    letterSpacing: 0.7,

    color: MUTED,
  },

  detectedNote: {
    fontFamily: 'FredokaBold',

    fontSize: 48,

    color: BROWN,

    marginTop: 2,
  },

  detectedFrequency: {
    fontFamily: 'FredokaRegular',

    fontSize: 12,

    color: MUTED,
  },

  pitchMessage: {
    fontFamily: 'FredokaBold',

    fontSize: 15,

    color: BROWN,

    marginTop: 5,
  },

  accuracyTrack: {
    width: '100%',

    height: 9,

    backgroundColor: LIGHT_GRAY,

    borderRadius: 5,

    overflow: 'hidden',

    marginTop: 17,
  },

  accuracyFill: {
    height: '100%',

    backgroundColor: PINK,

    borderRadius: 5,
  },

  centsText: {
    fontFamily: 'FredokaRegular',

    fontSize: 11,

    color: MUTED,

    textAlign: 'center',

    marginTop: 7,
  },

  metricsGrid: {
    width: '100%',

    flexDirection: 'row',

    flexWrap: 'wrap',

    gap: 10,

    marginTop: 18,
  },

  metricCard: {
    flex: 1,

    minWidth: '47%',

    backgroundColor: LIGHT_PINK,

    borderRadius: 16,

    padding: 14,

    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  metricLabel: {
    fontFamily: 'FredokaRegular',

    fontSize: 9,

    letterSpacing: 0.6,

    color: MUTED,
  },

  metricValue: {
    fontFamily: 'FredokaBold',

    fontSize: 17,

    color: BROWN,

    marginTop: 3,
  },

  timerText: {
    fontFamily: 'FredokaRegular',

    fontSize: 11,

    color: MUTED,

    textAlign: 'center',

    marginTop: 18,
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

  // ========================================================
  // RESULTS
  // ========================================================

  resultsContent: {
    flexGrow: 1,

    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 50,

    alignItems: 'center',
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
    borderColor: '#F2DDE5',
  },

  resultCardTitle: {
    fontFamily: 'FredokaBold',

    fontSize: 17,

    color: BROWN,

    marginBottom: 12,
  },

  comparisonRow: {
    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',
  },

  comparisonSide: {
    flex: 1,
  },

  detectedComparison: {
    alignItems: 'flex-end',
  },

  comparisonLabel: {
    fontFamily: 'FredokaRegular',

    fontSize: 10,

    letterSpacing: 0.7,

    color: MUTED,
  },

  comparisonNote: {
    fontFamily: 'FredokaBold',

    fontSize: 30,

    color: BROWN,

    marginTop: 2,
  },

  comparisonFrequency: {
    fontFamily: 'FredokaRegular',

    fontSize: 11,

    color: MUTED,

    marginTop: 1,
  },

  resultsGrid: {
    width: '100%',

    flexDirection: 'row',

    flexWrap: 'wrap',

    gap: 10,

    marginTop: 14,
  },

  feedbackCard: {
    width: '100%',

    flexDirection: 'row',

    backgroundColor: PINK,

    borderRadius: 15,

    padding: 14,

    marginTop: 14,

    marginBottom: 18,
  },

  feedbackContent: {
    flex: 1,

    marginLeft: 10,
  },

  feedbackTitle: {
    fontFamily: 'FredokaBold',

    fontSize: 16,

    color: BROWN,
  },

  feedbackText: {
    fontFamily: 'FredokaRegular',

    fontSize: 11,

    lineHeight: 16,

    color: BROWN,

    marginTop: 4,
  },

  doneButton: {
    width: '100%',

    height: 50,

    borderRadius: 25,

    backgroundColor: LIGHT_GRAY,

    alignItems: 'center',
    justifyContent: 'center',

    marginTop: 10,
  },

  doneButtonText: {
    fontFamily: 'FredokaBold',

    fontSize: 14,

    color: BROWN,
  },
});
