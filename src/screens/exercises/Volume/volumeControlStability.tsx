import { Ionicons } from '@expo/vector-icons';
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
  View,
  useWindowDimensions,
} from 'react-native';
import { AudioContext } from 'react-native-audio-api';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import {
  measureVolumeControlStability,
} from '@/services/measurement/volume/volumeControlStability';

import {
  scoreVolumeControlStability,
} from '@/services/scoring/volume/volumeControlStability';


const REFERENCE_AUDIO = require(
  '../../../../assets/audio/volume/C4_reference.wav'
);

/* =========================================================
   FIXED BEGINNER PARAMETERS
   ========================================================= */

const NOTE = 'C4';

const DURATION_SECONDS = 5;

const REPETITIONS = 2;

const TARGET_STABILITY = 70;

const AMPLITUDE_VARIANCE_PERCENT = 10;

const TOTAL_EXERCISE_SECONDS =
  DURATION_SECONDS * REPETITIONS;

const COUNTDOWN_SECONDS = 3;

/* =========================================================
   TYPES
   ========================================================= */

type Phase =
  | 'directions'
  | 'countdown'
  | 'exercise'
  | 'results';

interface HistoryPoint {
  value: number;
  time: number;
}

/*
 * Using ReturnType here means this screen does not depend on
 * exported measurement/scoring type names.
 */
type MeasurementResult =
  ReturnType<
    typeof measureVolumeControlStability
  >;

type ScoreResult =
  ReturnType<
    typeof scoreVolumeControlStability
  >;

/* =========================================================
   COMPONENT
   ========================================================= */

export default function VolumeControlStabilityScreen() {
  const insets = useSafeAreaInsets();

  const { width, height } =
    useWindowDimensions();

  const horizontalPadding =
    Math.min(
      24,
      width * 0.06
    );

  const isSmallScreen =
    height < 700;

  /* =======================================================
     STATE
     ======================================================= */

  const [phase, setPhase] =
    useState<Phase>(
      'directions'
    );

  const [countdown, setCountdown] =
    useState(
      COUNTDOWN_SECONDS
    );

  const [
    remainingSeconds,
    setRemainingSeconds,
  ] = useState(
    TOTAL_EXERCISE_SECONDS
  );

  const [liveVolume, setLiveVolume] =
    useState(-60);

  const [
    liveStability,
    setLiveStability,
  ] = useState(0);

  const [
    liveHistory,
    setLiveHistory,
  ] = useState<
    HistoryPoint[]
  >([]);

  const [
    measurement,
    setMeasurement,
  ] = useState<
    MeasurementResult | null
  >(null);

  const [score, setScore] =
    useState<ScoreResult | null>(
      null
    );

  const [
    hasPlayedReference,
    setHasPlayedReference,
  ] = useState(false);

  const [
    referencePlaying,
    setReferencePlaying,
  ] = useState(false);

  const [
    referenceError,
    setReferenceError,
  ] = useState<string | null>(
    null
  );

  const [
    isStarting,
    setIsStarting,
  ] = useState(false);

  /* =======================================================
     REFS
     ======================================================= */

  const mountedRef =
    useRef(true);

  const exerciseStartedAtRef =
    useRef<number | null>(
      null
    );

  const audioContextRef =
    useRef<AudioContext | null>(
      null
    );

  const referenceBufferRef =
    useRef<
      Awaited<
        ReturnType<
          AudioContext['decodeAudioData']
        >
      > | null
    >(null);

  const referenceSourceRef =
    useRef<
      ReturnType<
        AudioContext['createBufferSource']
      > | null
    >(null);

  const referenceTimerRef =
    useRef<
      ReturnType<typeof setTimeout> | null
    >(null);

  const recordingFinishedRef =
    useRef(false);

  /* =======================================================
     CLEANUP
     ======================================================= */

  useEffect(() => {
    return () => {
      mountedRef.current =
        false;

      if (
        referenceTimerRef.current
      ) {
        clearTimeout(
          referenceTimerRef.current
        );
      }

      if (
        referenceSourceRef.current
      ) {
        try {
          referenceSourceRef.current.stop();
        } catch {}

        referenceSourceRef.current =
          null;
      }
    };
  }, []);

  /* =======================================================
     PLAY C4 REFERENCE
     ======================================================= */

  const playReferenceNote =
    useCallback(async () => {
      if (
        referencePlaying
      ) {
        return;
      }

      setReferenceError(null);

      setReferencePlaying(true);

      try {
        /*
         * Create AudioContext only once.
         */
        if (
          !audioContextRef.current
        ) {
          audioContextRef.current =
            new AudioContext();
        }

        const audioContext =
          audioContextRef.current;

        /*
         * Resume the audio context.
         */
        try {
          await audioContext.resume();
        } catch (error) {
          console.warn(
            'AudioContext resume warning:',
            error
          );
        }

        /*
         * Decode the bundled C4 WAV.
         */
        if (
          !referenceBufferRef.current
        ) {
          referenceBufferRef.current =
            await audioContext.decodeAudioData(
              REFERENCE_AUDIO
            );
        }

        /*
         * Stop previous reference playback.
         */
        if (
          referenceSourceRef.current
        ) {
          try {
            referenceSourceRef.current.stop();
          } catch {}

          referenceSourceRef.current =
            null;
        }

        /*
         * Create a fresh source every time.
         */
        const source =
          audioContext.createBufferSource();

        source.buffer =
          referenceBufferRef.current;

        /*
         * Direct connection:
         *
         * source
         *   ↓
         * destination / speaker
         */
        source.connect(
          audioContext.destination
        );

        referenceSourceRef.current =
          source;

        /*
         * Start immediately.
         */
        source.start(
          audioContext.currentTime
        );

        setHasPlayedReference(
          true
        );

        /*
         * Keep the button state synchronized
         * with the reference duration.
         */
        const duration =
          referenceBufferRef.current
            ?.duration ?? 1;

        if (
          referenceTimerRef.current
        ) {
          clearTimeout(
            referenceTimerRef.current
          );
        }

        referenceTimerRef.current =
          setTimeout(() => {
            if (
              !mountedRef.current
            ) {
              return;
            }

            setReferencePlaying(
              false
            );

            referenceSourceRef.current =
              null;
          }, duration * 1000);
      } catch (error) {
        console.error(
          'C4 reference playback error:',
          error
        );

        if (
          mountedRef.current
        ) {
          setReferencePlaying(
            false
          );

          setHasPlayedReference(
            false
          );

          setReferenceError(
            'Unable to play the C4 reference. Check that the C4_reference.wav file exists in assets/audio/volume.'
          );
        }
      }
    }, [referencePlaying]);

  /* =======================================================
     AUDIO RECORDER
     ======================================================= */

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (
        !mountedRef.current ||
        phase !== 'exercise'
      ) {
        return;
      }

      /*
       * Live digital volume.
       */
      const db =
        Number.isFinite(
          frame.volume
        ) &&
        frame.volume > -100
          ? frame.volume
          : -60;

      setLiveVolume(db);

      /*
       * Voice presence.
       *
       * We only consider a frame voiced when
       * pitch and clarity indicate an actual
       * vocal signal.
       */
      const isVoiced =
        Number.isFinite(
          frame.pitch
        ) &&
        frame.pitch > 0 &&
        Number.isFinite(
          frame.clarity
        ) &&
        frame.clarity >= 0.45 &&
        typeof frame.note ===
          'string' &&
        frame.note !== '--';

      if (!isVoiced) {
        return;
      }

      const now =
        Date.now();

      setLiveHistory(
        (previous) => {
          const next = [
            ...previous,
            {
              value: db,
              time: now,
            },
          ].slice(-40);

          /*
           * Convert dB back into amplitude so
           * stability is calculated from amplitude.
           */
          const amplitudes =
            next.map(
              (item) =>
                Math.pow(
                  10,
                  item.value / 20
                )
            );

          if (
            amplitudes.length < 2
          ) {
            setLiveStability(0);

            return next;
          }

          const mean =
            amplitudes.reduce(
              (
                sum,
                value
              ) =>
                sum + value,
              0
            ) /
            amplitudes.length;

          if (
            mean <= 0 ||
            !Number.isFinite(
              mean
            )
          ) {
            setLiveStability(0);

            return next;
          }

          const variance =
            amplitudes.reduce(
              (
                sum,
                value
              ) =>
                sum +
                Math.pow(
                  value - mean,
                  2
                ),
              0
            ) /
            amplitudes.length;

          const standardDeviation =
            Math.sqrt(
              variance
            );

          const stability =
            100 -
            (standardDeviation /
              mean) *
              100;

          setLiveStability(
            Math.max(
              0,
              Math.min(
                100,
                stability
              )
            )
          );

          return next;
        }
      );
    },

    onStop: (
      samples,
      sampleRate
    ) => {
      if (
        !mountedRef.current ||
        recordingFinishedRef.current
      ) {
        return;
      }

      recordingFinishedRef.current =
        true;

      /*
       * Measurement layer.
       */
      const measured =
        measureVolumeControlStability(
          samples,
          sampleRate,
          DURATION_SECONDS,
          REPETITIONS
        );

      /*
       * Scoring layer.
       */
      const scored =
        scoreVolumeControlStability(
          measured
        );

      setMeasurement(
        measured
      );

      setScore(
        scored
      );

      setPhase('results');
    },
  });

  /* =======================================================
     BEGIN RECORDING
     ======================================================= */

  const beginRecording =
    useCallback(async () => {
      try {
        recordingFinishedRef.current =
          false;

        await startRecording();

        if (
          !mountedRef.current
        ) {
          return;
        }

        exerciseStartedAtRef.current =
          Date.now();

        setLiveVolume(-60);

        setLiveStability(0);

        setLiveHistory([]);

        setRemainingSeconds(
          TOTAL_EXERCISE_SECONDS
        );

        setPhase(
          'exercise'
        );
      } catch (error) {
        console.error(
          'Unable to start recording:',
          error
        );

        if (
          mountedRef.current
        ) {
          setPhase(
            'directions'
          );

          setReferenceError(
            'Microphone could not be started. Please check microphone permission.'
          );
        }
      }
    }, [startRecording]);

  /* =======================================================
     COUNTDOWN
     ======================================================= */

  useEffect(() => {
    if (
      phase !== 'countdown'
    ) {
      return;
    }

    setCountdown(
      COUNTDOWN_SECONDS
    );

    const interval =
      setInterval(() => {
        setCountdown(
          (value) => {
            if (value <= 1) {
              clearInterval(
                interval
              );

              void beginRecording();

              return 0;
            }

            return value - 1;
          }
        );
      }, 1000);

    return () => {
      clearInterval(
        interval
      );
    };
  }, [
    phase,
    beginRecording,
  ]);

  /* =======================================================
     EXERCISE TIMER
     ======================================================= */

  useEffect(() => {
    if (
      phase !== 'exercise'
    ) {
      return;
    }

    const interval =
      setInterval(() => {
        const startedAt =
          exerciseStartedAtRef.current;

        if (!startedAt) {
          return;
        }

        const elapsed =
          (Date.now() -
            startedAt) /
          1000;

        const remaining =
          Math.max(
            0,
            Math.ceil(
              TOTAL_EXERCISE_SECONDS -
                elapsed
            )
          );

        setRemainingSeconds(
          remaining
        );

        if (
          elapsed >=
          TOTAL_EXERCISE_SECONDS
        ) {
          clearInterval(
            interval
          );

          void stopRecording();
        }
      }, 100);

    return () => {
      clearInterval(
        interval
      );
    };
  }, [
    phase,
    stopRecording,
  ]);

  /* =======================================================
     START EXERCISE
     ======================================================= */

  const startExercise =
    useCallback(() => {
      if (
        !hasPlayedReference ||
        isStarting
      ) {
        return;
      }

      setIsStarting(true);

      setMeasurement(null);

      setScore(null);

      setLiveHistory([]);

      setLiveVolume(-60);

      setLiveStability(0);

      setCountdown(
        COUNTDOWN_SECONDS
      );

      setReferenceError(null);

      setPhase(
        'countdown'
      );

      setTimeout(() => {
        if (
          mountedRef.current
        ) {
          setIsStarting(false);
        }
      }, 400);
    }, [
      hasPlayedReference,
      isStarting,
    ]);

  /* =======================================================
     RESET
     ======================================================= */

  const resetExercise =
    useCallback(() => {
      setMeasurement(null);

      setScore(null);

      setLiveVolume(-60);

      setLiveStability(0);

      setLiveHistory([]);

      setRemainingSeconds(
        TOTAL_EXERCISE_SECONDS
      );

      setCountdown(
        COUNTDOWN_SECONDS
      );

      setReferenceError(null);

      setHasPlayedReference(
        false
      );

      setReferencePlaying(
        false
      );

      recordingFinishedRef.current =
        false;

      exerciseStartedAtRef.current =
        null;

      setPhase(
        'directions'
      );
    }, []);

  /* =======================================================
     LIVE GRAPH
     ======================================================= */

  const graphBars =
    useMemo(() => {
      if (
        liveHistory.length === 0
      ) {
        return [];
      }

      const minValue = -60;
      const maxValue = 0;

      return liveHistory.map(
        (
          item,
          index
        ) => {
          const normalized =
            (item.value -
              minValue) /
            (maxValue -
              minValue);

          const barHeight =
            Math.max(
              4,
              Math.min(
                100,
                normalized *
                  100
              )
            );

          return {
            id: `${item.time}-${index}`,
            height:
              barHeight,
          };
        }
      );
    }, [liveHistory]);

  /* =======================================================
     HEADER
     ======================================================= */

  const renderHeader = () => (
    <View
      style={[
        styles.header,
        {
          paddingHorizontal:
            horizontalPadding,
        },
      ]}
    >
      <View
        style={styles.headerSide}
      >
        <Ionicons
          name="arrow-back"
          size={21}
          color="#222"
        />
      </View>

      <View
        style={
          styles.headerCenter
        }
      >
        <Text
          style={
            styles.headerTitle
          }
        >
          Volume Control
        </Text>

        <Text
          style={
            styles.headerSubtitle
          }
        >
          Exercise 5
        </Text>
      </View>

      <View
        style={styles.headerSide}
      />
    </View>
  );

  /* =======================================================
     DIRECTIONS
     ======================================================= */

  if (
    phase === 'directions'
  ) {
    return (
      <SafeAreaView
        style={styles.safeArea}
      >
        {renderHeader()}

        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingHorizontal:
                horizontalPadding,
              paddingBottom:
                insets.bottom +
                18,
            },
          ]}
        >
          <View
            style={styles.heroIcon}
          >
            <Ionicons
              name="options-outline"
              size={31}
              color="#EC5A93"
            />
          </View>

          <Text
            style={
              styles.screenTitle
            }
          >
            Volume Control Stability
          </Text>

          <Text
            style={
              styles.screenDescription
            }
          >
            Sustain a comfortable C4
            note while keeping your
            vocal volume as steady as
            possible.
          </Text>

          {/* REFERENCE */}

          <View
            style={
              styles.referenceCard
            }
          >
            <View
              style={
                styles.referenceTopRow
              }
            >
              <View>
                <Text
                  style={
                    styles.referenceLabel
                  }
                >
                  REFERENCE NOTE
                </Text>

                <Text
                  style={
                    styles.referenceNote
                  }
                >
                  {NOTE}
                </Text>
              </View>

              <View
                style={
                  styles.noteIconCircle
                }
              >
                <Ionicons
                  name="musical-note"
                  size={24}
                  color="#EC5A93"
                />
              </View>
            </View>

            <Text
              style={
                styles.referenceInstruction
              }
            >
              Listen to the C4 reference
              first, then sing the same
              note steadily during the
              exercise.
            </Text>

            <Pressable
              style={[
                styles.referenceButton,
                referencePlaying &&
                  styles.referenceButtonDisabled,
              ]}
              onPress={() =>
                void playReferenceNote()
              }
              disabled={
                referencePlaying
              }
            >
              {referencePlaying ? (
                <ActivityIndicator
                  color="#FFFFFF"
                />
              ) : (
                <>
                  <Ionicons
                    name="play"
                    size={18}
                    color="#FFFFFF"
                  />

                  <Text
                    style={
                      styles.referenceButtonText
                    }
                  >
                    Play C4 Reference
                  </Text>
                </>
              )}
            </Pressable>

            {hasPlayedReference && (
              <View
                style={
                  styles.referenceReadyRow
                }
              >
                <Ionicons
                  name="checkmark-circle"
                  size={17}
                  color="#2E9B62"
                />

                <Text
                  style={
                    styles.referenceReadyText
                  }
                >
                  C4 reference ready.
                </Text>
              </View>
            )}

            {referenceError && (
              <Text
                style={styles.errorText}
              >
                {referenceError}
              </Text>
            )}
          </View>

          {/* PARAMETERS */}

          <View
            style={
              styles.parameterCard
            }
          >
            <Text
              style={
                styles.sectionLabel
              }
            >
              EXERCISE TARGET
            </Text>

            <View
              style={
                styles.parameterGrid
              }
            >
              <ParameterItem
                icon="musical-note-outline"
                value="C4"
                label="Note"
              />

              <ParameterItem
                icon="timer-outline"
                value="5 sec"
                label="Per repetition"
              />

              <ParameterItem
                icon="repeat-outline"
                value="2"
                label="Repetitions"
              />

              <ParameterItem
                icon="analytics-outline"
                value="70%"
                label="Stability target"
              />
            </View>
          </View>

          {/* DIRECTIONS */}

          <View
            style={
              styles.directionsCard
            }
          >
            <Text
              style={
                styles.sectionLabel
              }
            >
              DIRECTIONS
            </Text>

            <DirectionRow
              number="1"
              text="Play the C4 reference and listen carefully."
            />

            <DirectionRow
              number="2"
              text="Take a comfortable breath before starting."
            />

            <DirectionRow
              number="3"
              text="Sing C4 steadily for 5 seconds."
            />

            <DirectionRow
              number="4"
              text="Keep your vocal volume as consistent as possible."
            />

            <DirectionRow
              number="5"
              text="Repeat the exercise twice."
            />
          </View>

          {/* TIP */}

          <View
            style={styles.tipCard}
          >
            <Ionicons
              name="bulb-outline"
              size={20}
              color="#EC5A93"
            />

            <Text
              style={styles.tipText}
            >
              Avoid intentionally getting
              louder or softer. Focus on
              one steady vocal output.
            </Text>
          </View>

          <Text
            style={styles.varianceText}
          >
            Target amplitude variation:
            ±
            {AMPLITUDE_VARIANCE_PERCENT}%
          </Text>

          {/* START */}

          <Pressable
            style={[
              styles.primaryButton,
              !hasPlayedReference &&
                styles.primaryButtonDisabled,
            ]}
            onPress={
              startExercise
            }
            disabled={
              !hasPlayedReference ||
              isStarting
            }
          >
            {isStarting ? (
              <ActivityIndicator
                color="#FFFFFF"
              />
            ) : (
              <>
                <Text
                  style={
                    styles.primaryButtonText
                  }
                >
                  Start Exercise
                </Text>

                <Ionicons
                  name="arrow-forward"
                  size={19}
                  color="#FFFFFF"
                />
              </>
            )}
          </Pressable>

          {!hasPlayedReference && (
            <Text
              style={styles.helperText}
            >
              Play the C4 reference
              before starting.
            </Text>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* =======================================================
     COUNTDOWN
     ======================================================= */

  if (
    phase === 'countdown'
  ) {
    return (
      <SafeAreaView
        style={styles.safeArea}
      >
        <View
          style={[
            styles.countdownScreen,
            {
              paddingHorizontal:
                horizontalPadding,
              paddingBottom:
                Math.max(
                  16,
                  insets.bottom
                ),
            },
          ]}
        >
          <View
            style={
              styles.countdownTop
            }
          >
            <Text
              style={
                styles.countdownTitle
              }
            >
              Get Ready
            </Text>

            <Text
              style={
                styles.countdownInstruction
              }
            >
              Prepare to sing a steady
              C4.
            </Text>
          </View>

          <View
            style={
              styles.countdownCircle
            }
          >
            <Text
              style={
                styles.countdownNumber
              }
            >
              {countdown}
            </Text>
          </View>

          <View
            style={
              styles.countdownBottom
            }
          >
            <View
              style={
                styles.readyNoteBadge
              }
            >
              <Ionicons
                name="musical-note"
                size={17}
                color="#EC5A93"
              />

              <Text
                style={
                  styles.readyNoteText
                }
              >
                Reference: C4
              </Text>
            </View>

            <Text
              style={
                styles.countdownHint
              }
            >
              Breathe comfortably and
              get ready.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  /* =======================================================
     ACTUAL EXERCISE
     ======================================================= */

  if (
    phase === 'exercise'
  ) {
    return (
      <SafeAreaView
        style={styles.safeArea}
      >
        <View
          style={[
            styles.exerciseContainer,
            {
              paddingHorizontal:
                horizontalPadding,
              paddingBottom:
                Math.max(
                  8,
                  insets.bottom
                ),
            },
          ]}
        >
          <View
            style={
              styles.exerciseTop
            }
          >
            <View>
              <Text
                style={
                  styles.exerciseLabel
                }
              >
                SING STEADILY
              </Text>

              <Text
                style={
                  styles.exerciseNote
                }
              >
                {NOTE}
              </Text>
            </View>

            <View
              style={
                styles.timerBadge
              }
            >
              <Ionicons
                name="time-outline"
                size={17}
                color="#EC5A93"
              />

              <Text
                style={
                  styles.timerText
                }
              >
                {remainingSeconds}s
              </Text>
            </View>
          </View>

          {/* LIVE VOLUME */}

          <View
            style={[
              styles.mainVolumeCard,
              isSmallScreen &&
                styles.mainVolumeCardSmall,
            ]}
          >
            <Text
              style={
                styles.liveLabel
              }
            >
              YOUR VOLUME
            </Text>

            <Text
              style={[
                styles.liveVolumeText,
                isSmallScreen &&
                  styles.liveVolumeTextSmall,
              ]}
            >
              {Number.isFinite(
                liveVolume
              )
                ? `${Math.round(
                    liveVolume
                  )} dB`
                : '--'}
            </Text>

            <View
              style={
                styles.volumePulseCircle
              }
            >
              <Ionicons
                name="mic"
                size={
                  isSmallScreen
                    ? 31
                    : 38
                }
                color="#FFFFFF"
              />
            </View>

            <Text
              style={
                styles.volumeStatus
              }
            >
              Keep your voice steady
            </Text>
          </View>

          {/* STABILITY */}

          <View
            style={
              styles.stabilityCard
            }
          >
            <View
              style={
                styles.stabilityHeader
              }
            >
              <View>
                <Text
                  style={
                    styles.stabilityTitle
                  }
                >
                  Volume Stability
                </Text>

                <Text
                  style={
                    styles.stabilitySubtitle
                  }
                >
                  Target: 70%
                </Text>
              </View>

              <Text
                style={
                  styles.stabilityValue
                }
              >
                {Math.round(
                  liveStability
                )}
                %
              </Text>
            </View>

            <View
              style={
                styles.progressTrack
              }
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(
                      100,
                      liveStability
                    )}%`,
                  },
                ]}
              />
            </View>

            <View
              style={
                styles.progressLabels
              }
            >
              <Text
                style={
                  styles.progressLabel
                }
              >
                Unstable
              </Text>

              <Text
                style={
                  styles.progressLabel
                }
              >
                Stable
              </Text>
            </View>
          </View>

          {/* GRAPH */}

          <View
            style={
              styles.graphCard
            }
          >
            <View
              style={
                styles.graphHeader
              }
            >
              <Text
                style={
                  styles.graphTitle
                }
              >
                Live Volume
              </Text>

              <Text
                style={
                  styles.graphUnit
                }
              >
                dB
              </Text>
            </View>

            <View
              style={[
                styles.graph,
                isSmallScreen &&
                  styles.graphSmall,
              ]}
            >
              <View
                style={
                  styles.graphCenterLine
                }
              />

              {graphBars.length >
              0 ? (
                graphBars.map(
                  (bar) => (
                    <View
                      key={bar.id}
                      style={[
                        styles.graphBar,
                        {
                          height: `${bar.height}%`,
                        },
                      ]}
                    />
                  )
                )
              ) : (
                <Text
                  style={
                    styles.graphPlaceholder
                  }
                >
                  Your live volume will
                  appear here
                </Text>
              )}
            </View>
          </View>

          {/* HINT */}

          <View
            style={
              styles.exerciseHintCard
            }
          >
            <Ionicons
              name="ear-outline"
              size={19}
              color="#EC5A93"
            />

            <Text
              style={
                styles.exerciseHintText
              }
            >
              Sing comfortably and avoid
              sudden changes in volume.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  /* =======================================================
     RESULTS
     ======================================================= */

  const finalScore =
    score?.overallScore ?? 0;

  const stabilityScore =
    measurement?.stability ?? 0;

  const durationScore =
    measurement?.durationScore ??
    0;

  const voicedCoverage =
    measurement?.voicedCoveragePercent ??
    0;

  const resultPassed =
    score?.passed ?? false;

  return (
    <SafeAreaView
      style={styles.safeArea}
    >
      <View
        style={
          styles.resultsScreen
        }
      >
        {/* RESULTS HEADER */}

        <View
          style={[
            styles.resultsHeader,
            {
              paddingHorizontal:
                horizontalPadding,
            },
          ]}
        >
          <View
            style={
              styles.headerSide
            }
          >
            <Ionicons
              name="arrow-back"
              size={21}
              color="#222"
            />
          </View>

          <View
            style={
              styles.resultsHeaderCenter
            }
          >
            <Text
              style={
                styles.headerTitle
              }
            >
              Volume Control
            </Text>

            <Text
              style={
                styles.headerSubtitle
              }
            >
              Exercise 5
            </Text>
          </View>

          <View
            style={
              styles.headerSide
            }
          />
        </View>

        {/* SCROLLABLE RESULTS */}

        <ScrollView
          style={
            styles.resultsScroll
          }
          contentContainerStyle={[
            styles.resultsScrollContent,
            {
              paddingHorizontal:
                horizontalPadding,
            },
          ]}
          showsVerticalScrollIndicator={
            false
          }
        >
          {/* STATUS */}

          <View
            style={[
              styles.resultStatusBadge,
              resultPassed
                ? styles.resultStatusPassed
                : styles.resultStatusPractice,
            ]}
          >
            <Ionicons
              name={
                resultPassed
                  ? 'checkmark-circle'
                  : 'refresh-circle'
              }
              size={13}
              color="#FFFFFF"
            />

            <Text
              style={
                styles.resultStatusText
              }
            >
              {resultPassed
                ? 'TARGET REACHED'
                : 'KEEP PRACTICING'}
            </Text>
          </View>

          <Text
            style={
              styles.resultTitle
            }
          >
            Volume Stability Results
          </Text>

          <Text
            style={
              styles.resultDescription
            }
          >
            {resultPassed
              ? 'Your vocal volume remained relatively stable during the exercise.'
              : 'A consistent vocal signal was not detected. Try singing C4 steadily and holding the same volume.'}
          </Text>

          {/* SCORE */}

          <View
            style={
              styles.resultScoreSection
            }
          >
            <View
              style={
                styles.resultScoreCircle
              }
            >
              <Text
                style={
                  styles.resultScoreNumber
                }
              >
                {Math.round(
                  finalScore
                )}
              </Text>

              <Text
                style={
                  styles.resultScoreOutOf
                }
              >
                /100
              </Text>
            </View>

            <Text
              style={
                styles.resultScoreLabel
              }
            >
              Overall Stability Score
            </Text>
          </View>

          {/* BREAKDOWN */}

          <View
            style={
              styles.compactResultsCard
            }
          >
            <CompactResultRow
              label="Repetition 1"
              value={`${Math.round(
                measurement
                  ?.repStability?.[0] ??
                  0
              )}%`}
            />

            <CompactResultRow
              label="Repetition 2"
              value={`${Math.round(
                measurement
                  ?.repStability?.[1] ??
                  0
              )}%`}
            />

            <CompactResultRow
              label="Volume Stability"
              value={`${Math.round(
                stabilityScore
              )}%`}
            />

            <CompactResultRow
              label="Duration Score"
              value={`${Math.round(
                durationScore
              )}%`}
            />

            <CompactResultRow
              label="Average Volume"
              value={
                measurement?.averageDb !==
                undefined
                  ? `${Math.round(
                      measurement.averageDb
                    )} dB`
                  : '--'
              }
            />

            <CompactResultRow
              label="Voiced Coverage"
              value={`${Math.round(
                voicedCoverage
              )}%`}
            />

            <CompactResultRow
              label="Measurement Quality"
              value={`${Math.round(
                measurement
                  ?.measurementQuality ??
                  0
              )}%`}
              isLast
            />
          </View>

          {/* FORMULA */}

          <View
            style={
              styles.formulaCard
            }
          >
            <Text
              style={
                styles.formulaTitle
              }
            >
              Score Formula
            </Text>

            <Text
              style={
                styles.formulaMain
              }
            >
              Stability × 70% + Duration × 30%
            </Text>

            <Text
              style={
                styles.formulaDescription
              }
            >
              The final score combines
              volume stability and
              sustained vocal coverage.
            </Text>
          </View>

          {/* TARGET */}

          <View
            style={
              styles.targetCompactCard
            }
          >
            <View
              style={
                styles.targetCompactItem
              }
            >
              <Text
                style={
                  styles.targetCompactLabel
                }
              >
                Reference
              </Text>

              <Text
                style={
                  styles.targetCompactValue
                }
              >
                C4
              </Text>
            </View>

            <View
              style={
                styles.targetCompactDivider
              }
            />

            <View
              style={
                styles.targetCompactItem
              }
            >
              <Text
                style={
                  styles.targetCompactLabel
                }
              >
                Duration
              </Text>

              <Text
                style={
                  styles.targetCompactValue
                }
              >
                5 sec × 2
              </Text>
            </View>

            <View
              style={
                styles.targetCompactDivider
              }
            />

            <View
              style={
                styles.targetCompactItem
              }
            >
              <Text
                style={
                  styles.targetCompactLabel
                }
              >
                Target
              </Text>

              <Text
                style={
                  styles.targetCompactValue
                }
              >
                70%
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* FIXED BOTTOM BUTTON */}

        <View
          style={[
            styles.resultsFooter,
            {
              paddingHorizontal:
                horizontalPadding,
              paddingBottom:
                Math.max(
                  10,
                  insets.bottom
                ),
            },
          ]}
        >
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

            <Ionicons
              name="refresh"
              size={19}
              color="#FFFFFF"
            />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

/* =========================================================
   PARAMETER ITEM
   ========================================================= */

function ParameterItem({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <View
      style={
        styles.parameterItem
      }
    >
      <Ionicons
        name={icon}
        size={19}
        color="#EC5A93"
      />

      <Text
        style={
          styles.parameterValue
        }
      >
        {value}
      </Text>

      <Text
        style={
          styles.parameterLabel
        }
      >
        {label}
      </Text>
    </View>
  );
}

/* =========================================================
   DIRECTION ROW
   ========================================================= */

function DirectionRow({
  number,
  text,
}: {
  number: string;
  text: string;
}) {
  return (
    <View
      style={
        styles.directionRow
      }
    >
      <View
        style={
          styles.directionNumber
        }
      >
        <Text
          style={
            styles.directionNumberText
          }
        >
          {number}
        </Text>
      </View>

      <Text
        style={
          styles.directionText
        }
      >
        {text}
      </Text>
    </View>
  );
}

/* =========================================================
   COMPACT RESULT ROW
   ========================================================= */

function CompactResultRow({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View
      style={[
        styles.compactResultRow,
        !isLast &&
          styles.compactResultRowBorder,
      ]}
    >
      <Text
        style={
          styles.compactResultLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.compactResultValue
        }
      >
        {value}
      </Text>
    </View>
  );
}

/* =========================================================
   STYLES
   ========================================================= */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFF8FB',
  },

  /* HEADER */

  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  headerSide: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },

  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#242124',
  },

  headerSubtitle: {
    marginTop: 1,
    fontSize: 10,
    color: '#8C8589',
  },

  /* SCROLL */

  scrollContent: {
    paddingTop: 8,
    gap: 12,
  },

  /* HERO */

  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFE5EF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },

  screenTitle: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
    color: '#2E272B',
    textAlign: 'center',
  },

  screenDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: '#777176',
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  /* REFERENCE */

  referenceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    elevation: 2,
  },

  referenceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  referenceLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#999197',
  },

  referenceNote: {
    marginTop: 1,
    fontSize: 31,
    fontWeight: '900',
    color: '#EC5A93',
  },

  noteIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFF0F6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  referenceInstruction: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: '#6F686D',
  },

  referenceButton: {
    marginTop: 12,
    minHeight: 47,
    borderRadius: 14,
    backgroundColor: '#EC5A93',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  referenceButtonDisabled: {
    opacity: 0.7,
  },

  referenceButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },

  referenceReadyRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  referenceReadyText: {
    flex: 1,
    fontSize: 11,
    color: '#2E9B62',
    fontWeight: '600',
  },

  errorText: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 16,
    color: '#C54545',
  },

  /* PARAMETERS */

  parameterCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    elevation: 2,
  },

  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '800',
    color: '#999197',
  },

  parameterGrid: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },

  parameterItem: {
    width: '48%',
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: '#FFF5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  parameterValue: {
    marginTop: 3,
    fontSize: 16,
    fontWeight: '800',
    color: '#302A2E',
  },

  parameterLabel: {
    marginTop: 1,
    fontSize: 10,
    color: '#8D858A',
    textAlign: 'center',
  },

  /* DIRECTIONS */

  directionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    elevation: 2,
  },

  directionRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },

  directionNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFE5EF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  directionNumberText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#EC5A93',
  },

  directionText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#4D474B',
  },

  tipCard: {
    minHeight: 48,
    borderRadius: 15,
    paddingHorizontal: 13,
    backgroundColor: '#FFF0F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  tipText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: '#655D62',
  },

  varianceText: {
    fontSize: 10,
    color: '#8E878B',
    textAlign: 'center',
  },

  helperText: {
    marginTop: -4,
    textAlign: 'center',
    fontSize: 10,
    color: '#A0989D',
  },

  /* BUTTON */

  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: '#EC5A93',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },

  primaryButtonDisabled: {
    backgroundColor: '#D9B4C2',
  },

  primaryButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  /* COUNTDOWN */

  countdownScreen: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 35,
  },

  countdownTop: {
    alignItems: 'center',
  },

  countdownTitle: {
    fontSize: 27,
    fontWeight: '900',
    color: '#2E272B',
  },

  countdownInstruction: {
    marginTop: 6,
    fontSize: 13,
    color: '#7C7479',
    textAlign: 'center',
  },

  countdownCircle: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#FFE5EF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  countdownNumber: {
    fontSize: 72,
    fontWeight: '900',
    color: '#EC5A93',
  },

  countdownBottom: {
    alignItems: 'center',
  },

  readyNoteBadge: {
    minHeight: 37,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: '#FFF0F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  readyNoteText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5F575C',
  },

  countdownHint: {
    marginTop: 8,
    fontSize: 11,
    color: '#8A8287',
  },

  /* EXERCISE */

  exerciseContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 7,
  },

  exerciseTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  exerciseLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#999197',
  },

  exerciseNote: {
    marginTop: 1,
    fontSize: 24,
    fontWeight: '900',
    color: '#EC5A93',
  },

  timerBadge: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    elevation: 1,
  },

  timerText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#3D363B',
  },

  mainVolumeCard: {
    minHeight: 195,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },

  mainVolumeCardSmall: {
    minHeight: 155,
  },

  liveLabel: {
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: '800',
    color: '#999197',
  },

  liveVolumeText: {
    marginTop: 2,
    fontSize: 40,
    lineHeight: 45,
    fontWeight: '900',
    color: '#282226',
  },

  liveVolumeTextSmall: {
    fontSize: 32,
    lineHeight: 37,
  },

  volumePulseCircle: {
    marginTop: 7,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#EC5A93',
    alignItems: 'center',
    justifyContent: 'center',
  },

  volumeStatus: {
    marginTop: 7,
    fontSize: 11,
    color: '#7D757A',
  },

  /* STABILITY */

  stabilityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    elevation: 2,
  },

  stabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  stabilityTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#332D31',
  },

  stabilitySubtitle: {
    marginTop: 1,
    fontSize: 10,
    color: '#8F878C',
  },

  stabilityValue: {
    fontSize: 23,
    fontWeight: '900',
    color: '#EC5A93',
  },

  progressTrack: {
    marginTop: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#F0E7EB',
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#EC5A93',
  },

  progressLabels: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  progressLabel: {
    fontSize: 9,
    color: '#A0989D',
  },

  /* GRAPH */

  graphCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 12,
    elevation: 2,
  },

  graphHeader: {
    marginBottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  graphTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#332D31',
  },

  graphUnit: {
    fontSize: 9,
    color: '#A0989D',
  },

  graph: {
    height: 72,
    borderRadius: 11,
    backgroundColor: '#FFF7FA',
    overflow: 'hidden',
    paddingHorizontal: 4,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },

  graphSmall: {
    height: 57,
  },

  graphCenterLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: '#F2DDE5',
  },

  graphBar: {
    width: 4,
    minHeight: 4,
    borderRadius: 2,
    backgroundColor: '#EC5A93',
  },

  graphPlaceholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '35%',
    textAlign: 'center',
    fontSize: 9,
    color: '#AAA1A7',
  },

  exerciseHintCard: {
    minHeight: 43,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: '#FFF0F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  exerciseHintText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    color: '#71696E',
  },

  /* RESULTS */

  resultsScreen: {
    flex: 1,
    backgroundColor: '#FFF8FB',
  },

  resultsHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  resultsHeaderCenter: {
    flex: 1,
    alignItems: 'center',
  },

  resultsScroll: {
    flex: 1,
  },

  resultsScrollContent: {
    paddingTop: 7,
    paddingBottom: 10,
  },

  resultStatusBadge: {
    alignSelf: 'center',
    minHeight: 25,
    paddingHorizontal: 10,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  resultStatusPassed: {
    backgroundColor: '#2E9B62',
  },

  resultStatusPractice: {
    backgroundColor: '#EC5A93',
  },

  resultStatusText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.7,
  },

  resultTitle: {
    marginTop: 8,
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
    color: '#3A3035',
    textAlign: 'center',
  },

  resultDescription: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 15,
    color: '#81777D',
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  resultScoreSection: {
    marginTop: 9,
    alignItems: 'center',
  },

  resultScoreCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#F9D5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },

  resultScoreNumber: {
    fontSize: 31,
    lineHeight: 35,
    fontWeight: '900',
    color: '#2F252A',
  },

  resultScoreOutOf: {
    fontSize: 8,
    color: '#81777D',
  },

  resultScoreLabel: {
    marginTop: 3,
    fontSize: 8.5,
    fontWeight: '700',
    color: '#EC5A93',
  },

  compactResultsCard: {
    marginTop: 9,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F0D9E2',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },

  compactResultRow: {
    minHeight: 27,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  compactResultRowBorder: {
    borderBottomWidth:
      StyleSheet.hairlineWidth,
    borderBottomColor: '#EDE3E7',
  },

  compactResultLabel: {
    fontSize: 9,
    color: '#81777D',
  },

  compactResultValue: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#3A3035',
  },

  formulaCard: {
    marginTop: 7,
    borderRadius: 14,
    backgroundColor: '#FFF0F6',
    paddingHorizontal: 11,
    paddingVertical: 8,
  },

  formulaTitle: {
    fontSize: 8,
    fontWeight: '800',
    color: '#534950',
  },

  formulaMain: {
    marginTop: 2,
    fontSize: 9.5,
    fontWeight: '800',
    color: '#EC5A93',
  },

  formulaDescription: {
    marginTop: 1,
    fontSize: 7.5,
    lineHeight: 11,
    color: '#81777D',
  },

  targetCompactCard: {
    marginTop: 7,
    minHeight: 47,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    elevation: 1,
  },

  targetCompactItem: {
    flex: 1,
    alignItems: 'center',
  },

  targetCompactLabel: {
    fontSize: 7.5,
    color: '#968D92',
  },

  targetCompactValue: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '800',
    color: '#3A3035',
  },

  targetCompactDivider: {
    width: StyleSheet.hairlineWidth,
    height: 25,
    backgroundColor: '#E8DEE2',
  },

  resultsFooter: {
    paddingTop: 7,
    backgroundColor: '#FFF8FB',
  },
});