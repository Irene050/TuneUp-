import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

/* =========================================================
   COLORS
   ========================================================= */

const BROWN = '#4E2F1F';
const DARK = '#5A343D';
const PINK = '#FCD6DD';
const LIGHT = '#FFF8FA';
const PALE = '#FFF0F3';
const BORDER = '#F1DCE2';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';

/* =========================================================
   VOLUME RANGE
   ========================================================= */

const DBFS_MIN = -60;
const DBFS_MAX = -10;

/* =========================================================
   GRAPH
   ========================================================= */

const BAR_COUNT = 32;

/* =========================================================
   TYPES
   ========================================================= */

type Phase =
  | 'ready'
  | 'exercise';

/* =========================================================
   NORMALIZE VOLUME
   ========================================================= */

function normalizeVolume(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      1,
      (value - DBFS_MIN) /
        (DBFS_MAX - DBFS_MIN)
    )
  );
}

/* =========================================================
   LIVE STABILITY
   ========================================================= */

function calculateStability(
  values: number[]
) {
  if (values.length < 2) {
    return 0;
  }

  const validValues =
    values.filter(
      (value) =>
        Number.isFinite(value)
    );

  if (validValues.length < 2) {
    return 0;
  }

  /*
   * Convert dB back to linear amplitude.
   */
  const amplitudes =
    validValues.map(
      (db) =>
        Math.pow(
          10,
          db / 20
        )
    );

  const mean =
    amplitudes.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    amplitudes.length;

  if (
    mean <= 0 ||
    !Number.isFinite(mean)
  ) {
    return 0;
  }

  const variance =
    amplitudes.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) /
    amplitudes.length;

  const standardDeviation =
    Math.sqrt(variance);

  const stability =
    100 -
    (standardDeviation /
      mean) *
      100;

  return Math.max(
    0,
    Math.min(
      100,
      stability
    )
  );
}

/* =========================================================
   VOLUME VISUALIZER
   ========================================================= */

function VolumeVisualizer({
  liveHistory,
}: {
  liveHistory: number[];
}) {
  const actualBars =
    Array.from(
      {
        length: BAR_COUNT,
      },
      (_, index) => {
        if (
          index <
          liveHistory.length
        ) {
          return liveHistory[
            index
          ];
        }

        return 0;
      }
    );

  return (
    <View
      style={
        styles.visualizer
      }
    >
      {/* Center reference line */}

      <View
        style={
          styles.centerLine
        }
      />

      {/* Live bars */}

      <View
        style={
          styles.actualBars
        }
      >
        {actualBars.map(
          (
            value,
            index
          ) => (
            <View
              key={`bar-${index}`}
              style={[
                styles.actualBar,
                {
                  height:
                    value > 0
                      ? `${Math.max(
                          5,
                          value *
                            82
                        )}%`
                      : '0%',
                },
              ]}
            />
          )
        )}
      </View>

      {liveHistory.length ===
        0 && (
        <Text
          style={
            styles.visualizerPlaceholder
          }
        >
          Start singing to see your
          volume
        </Text>
      )}
    </View>
  );
}

/* =========================================================
   MAIN SCREEN
   ========================================================= */

export default function VolumeFreeModeScreen() {
  const insets =
    useSafeAreaInsets();

  const {
    width,
    height,
  } = useWindowDimensions();

  const horizontalPadding =
    Math.min(
      22,
      width * 0.055
    );

  const isSmallScreen =
    height < 700;

  /* =======================================================
     STATE
     ======================================================= */

  const [
    phase,
    setPhase,
  ] = useState<Phase>(
    'ready'
  );

  const [
    liveVolume,
    setLiveVolume,
  ] = useState<number | null>(
    null
  );

  const [
    liveStability,
    setLiveStability,
  ] = useState(0);

  const [
    liveHistory,
    setLiveHistory,
  ] = useState<number[]>(
    []
  );

  const [
    elapsedSeconds,
    setElapsedSeconds,
  ] = useState(0);

  const [
    isStarting,
    setIsStarting,
  ] = useState(false);

  /* =======================================================
     REFS
     ======================================================= */

  const startedAtRef =
    useRef<number | null>(
      null
    );

  const timerRef =
    useRef<
      ReturnType<
        typeof setInterval
      > | null
    >(null);

  /* =======================================================
     CLEANUP
     ======================================================= */

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(
          timerRef.current
        );
      }
    };
  }, []);

  /* =======================================================
     AUDIO RECORDER
     ======================================================= */

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (
        phase !== 'exercise'
      ) {
        return;
      }

      if (
        !Number.isFinite(
          frame.volume
        )
      ) {
        return;
      }

      const db =
        frame.volume;

      setLiveVolume(db);

      const normalized =
        normalizeVolume(db);

      setLiveHistory(
        (previous) => {
          const next = [
            ...previous,
            normalized,
          ].slice(
            -BAR_COUNT
          );

          return next;
        }
      );
    },
  });

  /* =======================================================
     CALCULATE LIVE STABILITY
     ======================================================= */

  useEffect(() => {
    if (
      phase !== 'exercise'
    ) {
      return;
    }

    /*
     * Convert the normalized graph values back into
     * dB values for stability calculation.
     */
    const dbHistory =
      liveHistory.map(
        (normalized) =>
          DBFS_MIN +
          normalized *
            (DBFS_MAX -
              DBFS_MIN)
      );

    setLiveStability(
      calculateStability(
        dbHistory
      )
    );
  }, [
    liveHistory,
    phase,
  ]);

  /* =======================================================
     TIMER
     ======================================================= */

  useEffect(() => {
    if (
      phase !== 'exercise'
    ) {
      return;
    }

    startedAtRef.current =
      Date.now();

    timerRef.current =
      setInterval(() => {
        if (
          startedAtRef.current
        ) {
          const elapsed =
            Math.floor(
              (Date.now() -
                startedAtRef.current) /
                1000
            );

          setElapsedSeconds(
            elapsed
          );
        }
      }, 250);

    return () => {
      if (
        timerRef.current
      ) {
        clearInterval(
          timerRef.current
        );

        timerRef.current =
          null;
      }
    };
  }, [phase]);

  /* =======================================================
     START FREE MODE
     ======================================================= */

  const startFreeMode =
    async () => {
      if (
        isStarting ||
        phase === 'exercise'
      ) {
        return;
      }

      try {
        setIsStarting(true);

        setLiveVolume(null);

        setLiveStability(0);

        setLiveHistory([]);

        setElapsedSeconds(0);

        await startRecording();

        startedAtRef.current =
          Date.now();

        setPhase(
          'exercise'
        );
      } catch (error) {
        console.error(
          'Unable to start Volume Free Mode:',
          error
        );
      } finally {
        setIsStarting(false);
      }
    };

  /* =======================================================
     STOP FREE MODE
     ======================================================= */

  const stopFreeMode =
    async () => {
      try {
        await stopRecording();
      } catch (error) {
        console.error(
          'Unable to stop Volume Free Mode:',
          error
        );
      }

      if (
        timerRef.current
      ) {
        clearInterval(
          timerRef.current
        );

        timerRef.current =
          null;
      }

      startedAtRef.current =
        null;

      /*
       * Free Mode does NOT calculate
       * a score or save progress.
       */
      setPhase('ready');

      setLiveVolume(null);

      setLiveStability(0);

      setLiveHistory([]);

      setElapsedSeconds(0);
    };

  /* =======================================================
     FORMATTED TIME
     ======================================================= */

  const formattedTime =
    useMemo(() => {
      const minutes =
        Math.floor(
          elapsedSeconds / 60
        );

      const seconds =
        elapsedSeconds % 60;

      return `${String(
        minutes
      ).padStart(
        2,
        '0'
      )}:${String(
        seconds
      ).padStart(
        2,
        '0'
      )}`;
    }, [
      elapsedSeconds,
    ]);

  /* =======================================================
     READY SCREEN
     ======================================================= */

  if (
    phase === 'ready'
  ) {
    return (
      <SafeAreaView
        style={[
          styles.screen,
          {
            paddingBottom:
              insets.bottom,
          },
        ]}
      >
        {/* HEADER */}

        <View
          style={[
            styles.header,
            {
              paddingHorizontal:
                horizontalPadding,
            },
          ]}
        >
          <Pressable
            style={
              styles.backButton
            }
            onPress={() => {}}
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={BROWN}
            />
          </Pressable>

          <Text
            style={
              styles.headerTitle
            }
          >
            Volume Free Mode
          </Text>

          <View
            style={
              styles.headerSpacer
            }
          />
        </View>

        {/* CONTENT */}

        <View
          style={[
            styles.readyContent,
            {
              paddingHorizontal:
                horizontalPadding,
            },
          ]}
        >
          <View
            style={
              styles.modeIcon
            }
          >
            <Ionicons
              name="musical-notes"
              size={34}
              color={ACCENT}
            />
          </View>

          <Text
            style={
              styles.pageTitle
            }
          >
            Volume Free Mode
          </Text>

          <Text
            style={
              styles.pageDescription
            }
          >
            Practice your volume freely
            without a target volume band
            or structured exercise.
          </Text>

          {/* WHAT YOU CAN SEE */}

          <View
            style={
              styles.infoCard
            }
          >
            <Text
              style={
                styles.infoTitle
              }
            >
              LIVE FEEDBACK
            </Text>

            <View
              style={
                styles.infoRow
              }
            >
              <View
                style={
                  styles.infoIcon
                }
              >
                <Ionicons
                  name="volume-medium-outline"
                  size={20}
                  color={ACCENT}
                />
              </View>

              <View
                style={
                  styles.infoText
                }
              >
                <Text
                  style={
                    styles.infoName
                  }
                >
                  Volume Level
                </Text>

                <Text
                  style={
                    styles.infoDescription
                  }
                >
                  See your current vocal
                  volume in real time.
                </Text>
              </View>
            </View>

            <View
              style={
                styles.infoRow
              }
            >
              <View
                style={
                  styles.infoIcon
                }
              >
                <Ionicons
                  name="analytics-outline"
                  size={20}
                  color={ACCENT}
                />
              </View>

              <View
                style={
                  styles.infoText
                }
              >
                <Text
                  style={
                    styles.infoName
                  }
                >
                  Consistency
                </Text>

                <Text
                  style={
                    styles.infoDescription
                  }
                >
                  Observe how steady your
                  vocal volume remains.
                </Text>
              </View>
            </View>
          </View>

          {/* NOTE */}

          <View
            style={
              styles.noTargetCard
            }
          >
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={ACCENT}
            />

            <Text
              style={
                styles.noTargetText
              }
            >
              There is no target volume
              band in Free Mode. Sing at
              any comfortable volume.
            </Text>
          </View>
        </View>

        {/* START BUTTON */}

        <View
          style={[
            styles.bottomAction,
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
          <Pressable
            style={
              styles.startButton
            }
            onPress={
              startFreeMode
            }
            disabled={
              isStarting
            }
          >
            {isStarting ? (
              <ActivityIndicator
                color={WHITE}
              />
            ) : (
              <>
                <Ionicons
                  name="mic"
                  size={19}
                  color={WHITE}
                />

                <Text
                  style={
                    styles.startButtonText
                  }
                >
                  Start Free Mode
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  /* =======================================================
     EXERCISE SCREEN
     ======================================================= */

  return (
    <SafeAreaView
      style={[
        styles.screen,
        {
          paddingBottom:
            insets.bottom,
        },
      ]}
    >
      {/* HEADER */}

      <View
        style={[
          styles.header,
          {
            paddingHorizontal:
              horizontalPadding,
          },
        ]}
      >
        <Pressable
          style={
            styles.backButton
          }
          onPress={
            stopFreeMode
          }
        >
          <Ionicons
            name="arrow-back"
            size={20}
            color={BROWN}
          />
        </Pressable>

        <Text
          style={
            styles.headerTitle
          }
        >
          Volume Free Mode
        </Text>

        <View
          style={
            styles.headerSpacer
          }
        />
      </View>

      {/* MAIN */}

      <View
        style={[
          styles.exerciseContent,
          {
            paddingHorizontal:
              horizontalPadding,
          },
        ]}
      >
        {/* TOP INFO */}

        <View
          style={
            styles.exerciseTopRow
          }
        >
          <View>
            <Text
              style={
                styles.modeLabel
              }
            >
              FREE PRACTICE
            </Text>

            <Text
              style={
                styles.exerciseSubtitle
              }
            >
              Explore your natural volume
            </Text>
          </View>

          <View
            style={
              styles.timeBadge
            }
          >
            <Ionicons
              name="time-outline"
              size={16}
              color={ACCENT}
            />

            <Text
              style={
                styles.timeText
              }
            >
              {formattedTime}
            </Text>
          </View>
        </View>

        {/* MAIN VOLUME CARD */}

        <View
          style={[
            styles.volumeCard,
            isSmallScreen &&
              styles.volumeCardSmall,
          ]}
        >
          <Text
            style={
              styles.volumeLabel
            }
          >
            CURRENT VOLUME
          </Text>

          <Text
            style={[
              styles.volumeValue,
              isSmallScreen &&
                styles.volumeValueSmall,
            ]}
          >
            {liveVolume !==
            null
              ? liveVolume.toFixed(
                  1
                )
              : '--'}
          </Text>

          <Text
            style={
              styles.volumeUnit
            }
          >
            dBFS
          </Text>

          <View
            style={
              styles.micCircle
            }
          >
            <Ionicons
              name="mic"
              size={
                isSmallScreen
                  ? 30
                  : 36
              }
              color={WHITE}
            />
          </View>

          <Text
            style={
              styles.volumeHint
            }
          >
            {liveVolume !==
            null
              ? 'Voice detected'
              : 'Listening...'}
          </Text>
        </View>

        {/* CONSISTENCY */}

        <View
          style={
            styles.consistencyCard
          }
        >
          <View
            style={
              styles.consistencyHeader
            }
          >
            <View>
              <Text
                style={
                  styles.consistencyTitle
                }
              >
                Volume Consistency
              </Text>

              <Text
                style={
                  styles.consistencySub
                }
              >
                Live stability
              </Text>
            </View>

            <Text
              style={
                styles.consistencyValue
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
                styles.progressValue,
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
              Fluctuating
            </Text>

            <Text
              style={
                styles.progressLabel
              }
            >
              Steady
            </Text>
          </View>
        </View>

        {/* VISUALIZER */}

        <View
          style={
            styles.visualizerCard
          }
        >
          <View
            style={
              styles.visualizerHeader
            }
          >
            <View>
              <Text
                style={
                  styles.visualizerTitle
                }
              >
                Your Volume
              </Text>

              <Text
                style={
                  styles.visualizerSub
                }
              >
                Live volume pattern
              </Text>
            </View>

            <View
              style={
                styles.visualizerMic
              }
            >
              <Ionicons
                name="pulse-outline"
                size={18}
                color={ACCENT}
              />
            </View>
          </View>

          <VolumeVisualizer
            liveHistory={
              liveHistory
            }
          />

          <View
            style={
              styles.visualizerLabels
            }
          >
            <Text
              style={
                styles.visualizerLabel
              }
            >
              QUIET
            </Text>

            <Text
              style={
                styles.visualizerLabel
              }
            >
              LOUD
            </Text>
          </View>
        </View>

        {/* FREE MODE MESSAGE */}

        <View
          style={
            styles.freeModeMessage
          }
        >
          <Ionicons
            name="musical-note-outline"
            size={19}
            color={ACCENT}
          />

          <Text
            style={
              styles.freeModeMessageText
            }
          >
            No target volume. Sing
            naturally and observe how
            your volume changes.
          </Text>
        </View>
      </View>

      {/* STOP BUTTON */}

      <View
        style={[
          styles.bottomAction,
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
        <Pressable
          style={
            styles.stopButton
          }
          onPress={
            stopFreeMode
          }
        >
          <Ionicons
            name="stop"
            size={18}
            color={WHITE}
          />

          <Text
            style={
              styles.startButtonText
            }
          >
            Stop Free Mode
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/* =========================================================
   STYLES
   ========================================================= */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: LIGHT,
  },

  /* HEADER */

  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
  },

  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: BROWN,
  },

  headerSpacer: {
    width: 36,
  },

  /* READY */

  readyContent: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 20,
  },

  modeIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pageTitle: {
    marginTop: 12,
    fontSize: 27,
    fontWeight: '900',
    color: BROWN,
    textAlign: 'center',
  },

  pageDescription: {
    marginTop: 6,
    maxWidth: 330,
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
    textAlign: 'center',
  },

  infoCard: {
    width: '100%',
    marginTop: 20,
    backgroundColor: WHITE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },

  infoTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: MUTED,
  },

  infoRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },

  infoIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: PALE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  infoText: {
    flex: 1,
    marginLeft: 11,
  },

  infoName: {
    fontSize: 13,
    fontWeight: '800',
    color: DARK,
  },

  infoDescription: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
  },

  noTargetCard: {
    width: '100%',
    marginTop: 12,
    padding: 13,
    borderRadius: 15,
    backgroundColor: PALE,
    flexDirection: 'row',
    alignItems: 'center',
  },

  noTargetText: {
    flex: 1,
    marginLeft: 9,
    fontSize: 11,
    lineHeight: 16,
    color: DARK,
  },

  /* BOTTOM ACTION */

  bottomAction: {
    backgroundColor: LIGHT,
    paddingTop: 8,
  },

  startButton: {
    minHeight: 51,
    borderRadius: 16,
    backgroundColor: ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  stopButton: {
    minHeight: 51,
    borderRadius: 16,
    backgroundColor: DARK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  startButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: WHITE,
  },

  /* EXERCISE */

  exerciseContent: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 5,
  },

  exerciseTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  modeLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    color: MUTED,
  },

  exerciseSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700',
    color: DARK,
  },

  timeBadge: {
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  timeText: {
    fontSize: 12,
    fontWeight: '800',
    color: BROWN,
  },

  /* VOLUME CARD */

  volumeCard: {
    minHeight: 190,
    borderRadius: 22,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },

  volumeCardSmall: {
    minHeight: 155,
  },

  volumeLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    color: MUTED,
  },

  volumeValue: {
    marginTop: 2,
    fontSize: 42,
    lineHeight: 46,
    fontWeight: '900',
    color: BROWN,
  },

  volumeValueSmall: {
    fontSize: 34,
    lineHeight: 38,
  },

  volumeUnit: {
    marginTop: -1,
    fontSize: 10,
    color: MUTED,
  },

  micCircle: {
    marginTop: 7,
    width: 55,
    height: 55,
    borderRadius: 27.5,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  volumeHint: {
    marginTop: 6,
    fontSize: 10,
    color: MUTED,
  },

  /* CONSISTENCY */

  consistencyCard: {
    backgroundColor: WHITE,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 13,
  },

  consistencyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  consistencyTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: DARK,
  },

  consistencySub: {
    marginTop: 1,
    fontSize: 9,
    color: MUTED,
  },

  consistencyValue: {
    fontSize: 22,
    fontWeight: '900',
    color: ACCENT,
  },

  progressTrack: {
    marginTop: 8,
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F0E4E7',
    overflow: 'hidden',
  },

  progressValue: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: ACCENT,
  },

  progressLabels: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  progressLabel: {
    fontSize: 8,
    color: MUTED,
  },

  /* VISUALIZER CARD */

  visualizerCard: {
    backgroundColor: WHITE,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },

  visualizerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  visualizerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: DARK,
  },

  visualizerSub: {
    marginTop: 1,
    fontSize: 9,
    color: MUTED,
  },

  visualizerMic: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: PALE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  visualizer: {
    marginTop: 8,
    height: 75,
    borderRadius: 11,
    backgroundColor: '#FFF8FA',
    overflow: 'hidden',
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 4,
  },

  actualBars: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },

  actualBar: {
    width: 4,
    minHeight: 4,
    borderRadius: 2,
    backgroundColor: ACCENT,
  },

  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: '#F0DDE2',
  },

  visualizerPlaceholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '34%',
    fontSize: 9,
    color: MUTED,
    textAlign: 'center',
  },

  visualizerLabels: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  visualizerLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: MUTED,
  },

  /* MESSAGE */

  freeModeMessage: {
    minHeight: 43,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: PALE,
    flexDirection: 'row',
    alignItems: 'center',
  },

  freeModeMessageText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 10,
    lineHeight: 15,
    color: DARK,
  },
});