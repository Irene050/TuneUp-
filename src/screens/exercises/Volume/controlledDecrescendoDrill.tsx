import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import { measureControlledDecrescendo } from '@/services/measurement/volume/controlledDecrescendoDrill';
import { scoreControlledDecrescendo } from '@/services/scoring/volume/controlledDecrescendoDrill';

const BROWN = '#4E2F1F';
const DARK = '#5A343D';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const BORDER = '#F0DEE3';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';
const SOFT_TEXT = '#765D63';

const START_VOLUME = 50;
const END_VOLUME = 40;
const DURATION_SECONDS = 4;
const REPETITIONS = 2;
const SMOOTHNESS_TARGET = 70;
const TOTAL_DURATION_MS =
  DURATION_SECONDS * REPETITIONS * 1000;

const BAR_COUNT = 28;
const DISPLAY_MAX_DB = 60;

type Phase = 'directions' | 'exercise' | 'results';

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function volumeToHeight(db: number): number {
  if (!Number.isFinite(db)) return 0;

  return clamp(db / DISPLAY_MAX_DB, 0, 1);
}

function formatDb(db: number): string {
  if (!Number.isFinite(db) || db <= 0) {
    return '--';
  }

  return String(Math.round(db));
}

function formatTimer(ms: number): string {
  const seconds = Math.max(
    0,
    Math.ceil(ms / 1000),
  );

  return `0:${String(seconds).padStart(2, '0')}`;
}

/**
 * Target goes DOWN from 50 dB to 40 dB.
 */
function buildTargetCurve(): number[] {
  return Array.from(
    { length: BAR_COUNT },
    (_, index) => {
      const progress =
        index / Math.max(BAR_COUNT - 1, 1);

      const targetDb =
        START_VOLUME -
        progress * (START_VOLUME - END_VOLUME);

      return volumeToHeight(targetDb);
    },
  );
}

function buildActualCurve(
  history: number[],
): number[] {
  if (history.length === 0) {
    return Array(BAR_COUNT).fill(0);
  }

  if (history.length === 1) {
    return Array(BAR_COUNT).fill(
      volumeToHeight(history[0]),
    );
  }

  return Array.from(
    { length: BAR_COUNT },
    (_, index) => {
      const position =
        (index / (BAR_COUNT - 1)) *
        (history.length - 1);

      const left = Math.floor(position);
      const right = Math.min(
        Math.ceil(position),
        history.length - 1,
      );

      const fraction = position - left;

      const db =
        history[left] * (1 - fraction) +
        history[right] * fraction;

      return volumeToHeight(db);
    },
  );
}

function getTrend(
  history: number[],
): 'down' | 'flat' | 'up' {
  if (history.length < 4) {
    return 'flat';
  }

  const recent =
    history.slice(-4);

  const change =
    recent[recent.length - 1] -
    recent[0];

  if (change <= -2) {
    return 'down';
  }

  if (change >= 2) {
    return 'up';
  }

  return 'flat';
}

function DirectionIndicator({
  trend,
}: {
  trend: 'down' | 'flat' | 'up';
}) {
  if (trend === 'down') {
    return (
      <View style={styles.trendGood}>
        <Ionicons
          name="arrow-down"
          size={16}
          color={ACCENT}
        />

        <Text style={styles.trendGoodText}>
          Going softer
        </Text>
      </View>
    );
  }

  if (trend === 'up') {
    return (
      <View style={styles.trendBad}>
        <Ionicons
          name="arrow-up"
          size={16}
          color="#A95E6A"
        />

        <Text style={styles.trendBadText}>
          Getting louder
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.trendNeutral}>
      <Ionicons
        name="remove"
        size={16}
        color={MUTED}
      />

      <Text style={styles.trendNeutralText}>
        Keep the decrease steady
      </Text>
    </View>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable
        style={styles.backButton}
        onPress={() => router.back()}
      >
        <Ionicons
          name="arrow-back"
          size={20}
          color={BROWN}
        />
      </Pressable>

      <Text style={styles.headerTitle}>
        Volume Control
      </Text>

      <View style={styles.headerSpacer} />
    </View>
  );
}

function TargetCurveChart({
  history,
}: {
  history: number[];
}) {
  const targetBars = useMemo(
    () => buildTargetCurve(),
    [],
  );

  const actualBars = useMemo(
    () => buildActualCurve(history),
    [history],
  );

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartHeader}>
        <View>
          <Text style={styles.chartTitle}>
            Your Decrescendo
          </Text>

          <Text style={styles.chartSubtitle}>
            Follow the target downward
          </Text>
        </View>

        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={styles.targetDot} />
            <Text style={styles.legendText}>
              Target
            </Text>
          </View>

          <View style={styles.legendItem}>
            <View style={styles.actualDot} />
            <Text style={styles.legendText}>
              You
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.chart}>
        <View style={styles.chartGrid}>
          <View style={styles.gridLine} />
          <View style={styles.gridLine} />
          <View style={styles.gridLine} />
          <View style={styles.gridLine} />
        </View>

        <View style={styles.chartLayer}>
          {targetBars.map(
            (height, index) => (
              <View
                key={`target-${index}`}
                style={[
                  styles.bar,
                  styles.targetBar,
                  {
                    height: `${Math.max(
                      8,
                      height * 78,
                    )}%`,
                  },
                ]}
              />
            ),
          )}
        </View>

        <View style={styles.chartLayer}>
          {actualBars.map(
            (height, index) => (
              <View
                key={`actual-${index}`}
                style={[
                  styles.bar,
                  styles.actualBar,
                  {
                    height:
                      height > 0
                        ? `${Math.max(
                            5,
                            height * 78,
                          )}%`
                        : '0%',
                  },
                ]}
              />
            ),
          )}
        </View>
      </View>

      <View style={styles.chartScale}>
        <Text style={styles.scaleText}>
          {START_VOLUME} dB
        </Text>

        <Text style={styles.scaleText}>
          {END_VOLUME} dB
        </Text>
      </View>
    </View>
  );
}

function InstructionRow({
  number,
  children,
}: {
  number: string;
  children: string;
}) {
  return (
    <View style={styles.instructionRow}>
      <View style={styles.instructionNumber}>
        <Text
          style={
            styles.instructionNumberText
          }
        >
          {number}
        </Text>
      </View>

      <Text style={styles.instructionText}>
        {children}
      </Text>
    </View>
  );
}

function ResultRow({
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
        styles.resultRow,
        last && styles.lastResultRow,
      ]}
    >
      <Text style={styles.resultLabel}>
        {label}
      </Text>

      <Text style={styles.resultValue}>
        {value}
      </Text>
    </View>
  );
}

export default function ControlledDecrescendoDrill() {
  const [phase, setPhase] =
    useState<Phase>('directions');

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [liveHistory, setLiveHistory] =
    useState<number[]>([]);

  const [score, setScore] =
    useState(0);

  const [repScores, setRepScores] =
    useState<number[]>([0, 0]);

  const [startDb, setStartDb] =
    useState(0);

  const [endDb, setEndDb] =
    useState(0);

  const [targetReached, setTargetReached] =
    useState(false);

  const [directionCorrect, setDirectionCorrect] =
    useState(false);

  const [measurementQuality, setMeasurementQuality] =
    useState(0);

  const finishingRef =
    useRef(false);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (phase !== 'exercise') {
        return;
      }

      setLiveFrame(frame);

      /*
       * Your existing recorder returns dBFS.
       * The Volume exercises display its magnitude
       * as a positive dB value.
       */
      const liveDb =
        Number.isFinite(frame.volume)
          ? Math.abs(frame.volume)
          : 0;

      if (liveDb <= 0) {
        return;
      }

      setLiveHistory(
        (previous) => {
          const next = [
            ...previous,
            liveDb,
          ];

          return next.length > 60
            ? next.slice(-60)
            : next;
        },
      );
    },

    onStop: (
      samples,
      sampleRate,
    ) => {
      const measurement =
        measureControlledDecrescendo(
          samples,
          sampleRate,
        );

      const result =
        scoreControlledDecrescendo(
          measurement,
        );

      setScore(
        result.overallScore,
      );

      setRepScores(
        measurement.repSmoothness.map(
          (value) =>
            Math.round(value),
        ),
      );

      setStartDb(
        measurement.startDb,
      );

      setEndDb(
        measurement.endDb,
      );

      setTargetReached(
        result.targetReached,
      );

      setDirectionCorrect(
        result.directionCorrect,
      );

      setMeasurementQuality(
        result.measurementQuality,
      );

      setLiveFrame(null);
      setPhase('results');
    },
  });

  useEffect(() => {
    if (phase !== 'exercise') {
      return;
    }

    const timer = setInterval(() => {
      setElapsedMs(
        (previous) => {
          const next = Math.min(
            previous + 50,
            DURATION_SECONDS *
              REPETITIONS *
              1000,
          );

          if (
            next >=
              DURATION_SECONDS *
                REPETITIONS *
                1000 &&
            !finishingRef.current
          ) {
            finishingRef.current =
              true;

            void stopRecording();
          }

          return next;
        },
      );
    }, 50);

    return () => {
      clearInterval(timer);
    };
  }, [
    phase,
    stopRecording,
  ]);

  const startExercise = async () => {
    setElapsedMs(0);
    setLiveFrame(null);
    setLiveHistory([]);
    setScore(0);
    setRepScores([0, 0]);
    setStartDb(0);
    setEndDb(0);
    setTargetReached(false);
    setDirectionCorrect(false);
    setMeasurementQuality(0);
    finishingRef.current = false;

    setPhase('exercise');

    try {
      await startRecording();
    } catch (error) {
      console.error(
        'CONTROLLED DECRESCENDO START ERROR:',
        error,
      );

      setPhase('directions');
      finishingRef.current =
        false;
    }
  };

  const repDurationMs =
    DURATION_SECONDS * 1000;

  const currentRep = Math.min(
    REPETITIONS,
    Math.floor(
      elapsedMs / repDurationMs,
    ) + 1,
  );

  const currentRepElapsed =
    elapsedMs % repDurationMs;

  const progress =
    clamp(
      currentRepElapsed /
        repDurationMs,
      0,
      1,
    );

  const currentVolume =
    liveFrame &&
    Number.isFinite(
      liveFrame.volume,
    )
      ? formatDb(
          Math.abs(
            liveFrame.volume,
          ),
        )
      : '--';

  const liveDb =
    liveFrame &&
    Number.isFinite(
      liveFrame.volume,
    )
      ? Math.abs(
          liveFrame.volume,
        )
      : 0;

  const trend =
    getTrend(liveHistory);

  const guidance =
    trend === 'down'
      ? 'Good. Keep getting softer.'
      : trend === 'up'
        ? 'You are getting louder. Ease the volume down.'
        : liveDb === 0
          ? 'Start singing around 50 dB.'
          : 'Gradually lower your volume.';

  /*
   * ==========================================================
   * DIRECTIONS
   * ==========================================================
   */

  if (phase === 'directions') {
    return (
      <SafeAreaView
        style={styles.container}
      >
        <Header />

        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.pageContent
          }
        >
          <View style={styles.badge}>
            <Ionicons
              name="volume-low-outline"
              size={15}
              color={ACCENT}
            />

            <Text style={styles.badgeText}>
              VOLUME CONTROL
            </Text>
          </View>

          <Text style={styles.title}>
            Controlled Decrescendo
          </Text>

          <Text style={styles.subtitle}>
            Practice gradually making your
            voice softer while keeping the
            decrease smooth and controlled.
          </Text>

          <View
            style={styles.targetCard}
          >
            <Text
              style={styles.targetEyebrow}
            >
              YOUR TARGET
            </Text>

            <View
              style={styles.targetRow}
            >
              <View
                style={
                  styles.targetPoint
                }
              >
                <Text
                  style={
                    styles.targetNumber
                  }
                >
                  50
                </Text>

                <Text
                  style={
                    styles.targetUnit
                  }
                >
                  dB START
                </Text>
              </View>

              <Ionicons
                name="arrow-forward"
                size={23}
                color={ACCENT}
              />

              <View
                style={
                  styles.targetPoint
                }
              >
                <Text
                  style={
                    styles.targetNumber
                  }
                >
                  40
                </Text>

                <Text
                  style={
                    styles.targetUnit
                  }
                >
                  dB END
                </Text>
              </View>
            </View>

            <View
              style={styles.metaRow}
            >
              <View
                style={styles.metaPill}
              >
                <Ionicons
                  name="timer-outline"
                  size={15}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.metaText
                  }
                >
                  4 seconds
                </Text>
              </View>

              <View
                style={styles.metaPill}
              >
                <Ionicons
                  name="repeat-outline"
                  size={15}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.metaText
                  }
                >
                  2 reps
                </Text>
              </View>

              <View
                style={styles.metaPill}
              >
                <Ionicons
                  name="trending-down-outline"
                  size={15}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.metaText
                  }
                >
                  Smooth
                </Text>
              </View>
            </View>
          </View>

          <View
            style={styles.instructionsCard}
          >
            <Text
              style={styles.sectionTitle}
            >
              How to do it
            </Text>

            <InstructionRow number="1">
              Start your voice around
              50 dB.
            </InstructionRow>

            <InstructionRow number="2">
              Slowly reduce your volume
              over 4 seconds.
            </InstructionRow>

            <InstructionRow number="3">
              Finish around 40 dB.
            </InstructionRow>

            <InstructionRow number="4">
              Do not suddenly drop or
              cut off the sound.
            </InstructionRow>
          </View>

          <View style={styles.tipCard}>
            <Ionicons
              name="bulb-outline"
              size={20}
              color={ACCENT}
            />

            <View
              style={styles.tipCopy}
            >
              <Text
                style={styles.tipTitle}
              >
                Think “fade”
              </Text>

              <Text
                style={styles.tipText}
              >
                Imagine slowly turning a
                volume knob down instead of
                switching your voice off.
              </Text>
            </View>
          </View>

          <Pressable
            style={
              styles.primaryButton
            }
            onPress={() =>
              void startExercise()
            }
          >
            <Ionicons
              name="play"
              size={18}
              color={WHITE}
            />

            <Text
              style={
                styles.primaryButtonText
              }
            >
              Start Exercise
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /*
   * ==========================================================
   * ACTUAL EXERCISE
   * ==========================================================
   */

  if (phase === 'exercise') {
    return (
      <SafeAreaView
        style={styles.container}
      >
        <Header />

        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.exerciseContent
          }
        >
          <View
            style={
              styles.exerciseTopRow
            }
          >
            <View>
              <Text
                style={
                  styles.exerciseEyebrow
                }
              >
                CONTROLLED DECRESCENDO
              </Text>

              <Text
                style={
                  styles.exerciseTitle
                }
              >
                Get softer gradually
              </Text>
            </View>

            <View
              style={
                styles.repBadge
              }
            >
              <Text
                style={
                  styles.repBadgeText
                }
              >
                REP {currentRep}/
                {REPETITIONS}
              </Text>
            </View>
          </View>

          <View
            style={styles.timerRow}
          >
            <View
              style={styles.timerBadge}
            >
              <Ionicons
                name="time-outline"
                size={15}
                color={ACCENT}
              />

              <Text
                style={styles.timerText}
              >
                {formatTimer(
                  repDurationMs -
                    currentRepElapsed,
                )}
              </Text>
            </View>

            <Text
              style={styles.rangeHint}
            >
              50 → 40 dB
            </Text>
          </View>

          <View
            style={styles.progressTrack}
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progress * 100}%`,
                },
              ]}
            />
          </View>

          <View
            style={
              styles.liveReadoutCard
            }
          >
            <Text
              style={styles.liveLabel}
            >
              YOUR VOICE
            </Text>

            <View
              style={styles.liveVolumeRow}
            >
              <Text
                style={
                  styles.liveVolume
                }
              >
                {currentVolume}
              </Text>

              <Text
                style={styles.liveUnit}
              >
                dB
              </Text>
            </View>

            <DirectionIndicator
              trend={trend}
            />

            <Text
              style={styles.guidance}
            >
              {guidance}
            </Text>
          </View>

          <TargetCurveChart
            history={liveHistory}
          />

          <View
            style={styles.bottomInfo}
          >
            <View>
              <Text
                style={
                  styles.bottomLabel
                }
              >
                TARGET
              </Text>

              <Text
                style={
                  styles.bottomValue
                }
              >
                50 → 40 dB
              </Text>
            </View>

            <View
              style={
                styles.smoothnessBadge
              }
            >
              <Text
                style={
                  styles.smoothnessNumber
                }
              >
                70%
              </Text>

              <Text
                style={
                  styles.smoothnessLabel
                }
              >
                smoothness target
              </Text>
            </View>
          </View>

          {!isRecording && (
            <Text
              style={styles.waitingText}
            >
              Starting microphone...
            </Text>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  /*
   * ==========================================================
   * RESULTS
   * ==========================================================
   */

  const passed =
    score >= SMOOTHNESS_TARGET;

  return (
    <SafeAreaView
      style={styles.container}
    >
      <Header />

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
            styles.statusPill,
            passed
              ? styles.passPill
              : styles.tryPill,
          ]}
        >
          <Ionicons
            name={
              passed
                ? 'checkmark-circle'
                : 'refresh-circle'
            }
            size={18}
            color={ACCENT}
          />

          <Text
            style={styles.statusText}
          >
            {passed
              ? 'EXERCISE PASSED'
              : 'KEEP PRACTICING'}
          </Text>
        </View>

        <Text
          style={styles.resultTitle}
        >
          Decrescendo Results
        </Text>

        <Text
          style={
            styles.resultSubtitle
          }
        >
          {passed
            ? 'Nice control. Your voice followed the downward movement.'
            : 'Try making the decrease more gradual and even.'}
        </Text>

        <View
          style={styles.scoreCircle}
        >
          <Text
            style={styles.scoreNumber}
          >
            {score}
          </Text>

          <Text
            style={styles.scoreOutOf}
          >
            /100
          </Text>
        </View>

        <Text
          style={styles.scoreCaption}
        >
          Smoothness Score
        </Text>

        <View
          style={styles.resultCard}
        >
          <ResultRow
            label="Repetition 1"
            value={`${repScores[0]}%`}
          />

          <ResultRow
            label="Repetition 2"
            value={`${repScores[1]}%`}
          />

          <ResultRow
            label="Start Volume"
            value={`${formatDb(startDb)} dB`}
          />

          <ResultRow
            label="End Volume"
            value={`${formatDb(endDb)} dB`}
          />

          <ResultRow
            label="Direction"
            value={
              directionCorrect
                ? 'Descending ✓'
                : 'Not descending'
            }
          />

          <ResultRow
            label="Target"
            value={
              targetReached
                ? '50 → 40 dB ✓'
                : 'Target not reached'
            }
            last
          />
        </View>

        <View
          style={styles.qualityCard}
        >
          <View
            style={styles.qualityCopy}
          >
            <Text
              style={styles.qualityTitle}
            >
              Measurement quality
            </Text>

            <Text
              style={styles.qualityText}
            >
              {measurementQuality}% of
              expected audio windows
              were available.
            </Text>
          </View>

          <Text
            style={styles.qualityValue}
          >
            {measurementQuality}%
          </Text>
        </View>

        <Pressable
          style={
            styles.primaryButton
          }
          onPress={() =>
            void startExercise()
          }
        >
          <Ionicons
            name="refresh"
            size={18}
            color={WHITE}
          />

          <Text
            style={
              styles.primaryButtonText
            }
          >
            Try Again
          </Text>
        </Pressable>

        {passed && (
          <Pressable
            style={
              styles.secondaryButton
            }
            onPress={() =>
              router.replace(
                '/exercises/volume' as any,
              )
            }
          >
            <Text
              style={
                styles.secondaryButtonText
              }
            >
              Next Exercise
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WHITE,
  },

  header: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: DARK,
    marginRight: 36,
  },

  headerSpacer: {
    width: 36,
  },

  pageContent: {
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 30,
  },

  badge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: PINK,
  },

  badgeText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },

  title: {
    marginTop: 14,
    color: DARK,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    textAlign: 'center',
  },

  subtitle: {
    marginTop: 10,
    color: SOFT_TEXT,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },

  targetCard: {
    marginTop: 24,
    padding: 20,
    borderRadius: 24,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  targetEyebrow: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },

  targetRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },

  targetPoint: {
    minWidth: 82,
    alignItems: 'center',
  },

  targetNumber: {
    color: BROWN,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '900',
  },

  targetUnit: {
    marginTop: 4,
    color: MUTED,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },

  metaRow: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },

  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  metaText: {
    color: BROWN,
    fontSize: 12,
    fontWeight: '800',
  },

  instructionsCard: {
    marginTop: 18,
    padding: 18,
    borderRadius: 22,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  sectionTitle: {
    color: DARK,
    fontSize: 18,
    fontWeight: '900',
  },

  instructionRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  instructionNumber: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  instructionNumberText: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '900',
  },

  instructionText: {
    flex: 1,
    color: SOFT_TEXT,
    fontSize: 14,
    lineHeight: 20,
  },

  tipCard: {
    marginTop: 16,
    padding: 15,
    borderRadius: 18,
    backgroundColor: '#FFF9FB',
    borderWidth: 1,
    borderColor: '#F3DCE3',
    flexDirection: 'row',
    gap: 10,
  },

  tipCopy: {
    flex: 1,
  },

  tipTitle: {
    color: DARK,
    fontSize: 13,
    fontWeight: '900',
  },

  tipText: {
    marginTop: 2,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
  },

  primaryButton: {
    marginTop: 20,
    height: 56,
    borderRadius: 28,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },

  primaryButtonText: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '900',
  },

  exerciseContent: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 30,
  },

  exerciseTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },

  exerciseEyebrow: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },

  exerciseTitle: {
    marginTop: 5,
    color: DARK,
    fontSize: 23,
    fontWeight: '900',
  },

  repBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: PINK,
  },

  repBadgeText: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '900',
  },

  timerRow: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  timerBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 15,
    backgroundColor: LIGHT_PINK,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  timerText: {
    color: DARK,
    fontSize: 13,
    fontWeight: '900',
  },

  rangeHint: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '800',
  },

  progressTrack: {
    marginTop: 12,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F5E9EC',
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: ACCENT,
  },

  liveReadoutCard: {
    marginTop: 18,
    paddingVertical: 18,
    borderRadius: 24,
    alignItems: 'center',
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  liveLabel: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
  },

  liveVolumeRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'baseline',
  },

  liveVolume: {
    color: DARK,
    fontSize: 54,
    lineHeight: 62,
    fontWeight: '900',
  },

  liveUnit: {
    marginLeft: 6,
    color: MUTED,
    fontSize: 16,
    fontWeight: '800',
  },

  trendGood: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  trendGoodText: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '900',
  },

  trendBad: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  trendBadText: {
    color: '#A95E6A',
    fontSize: 12,
    fontWeight: '900',
  },

  trendNeutral: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  trendNeutralText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '800',
  },

  guidance: {
    marginTop: 5,
    color: SOFT_TEXT,
    fontSize: 12,
    fontWeight: '700',
  },

  chartCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 22,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  chartTitle: {
    color: DARK,
    fontSize: 16,
    fontWeight: '900',
  },

  chartSubtitle: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11,
  },

  legend: {
    flexDirection: 'row',
    gap: 10,
  },

  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  targetDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#E9AAB9',
  },

  actualDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },

  legendText: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '800',
  },

  chart: {
    position: 'relative',
    height: 190,
    marginTop: 14,
    borderRadius: 16,
    backgroundColor: '#FFF9FB',
    overflow: 'hidden',
    paddingHorizontal: 8,
    justifyContent: 'flex-end',
  },

  chartGrid: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-around',
    paddingVertical: 28,
  },

  gridLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#F3E3E7',
  },

  chartLayer: {
    ...StyleSheet.absoluteFill,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },

  bar: {
    flex: 1,
    minWidth: 3,
    borderRadius: 5,
  },

  targetBar: {
    backgroundColor: '#E9AAB9',
    opacity: 0.6,
  },

  actualBar: {
    backgroundColor: ACCENT,
    opacity: 0.9,
  },

  chartScale: {
    marginTop: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  scaleText: {
    color: MUTED,
    fontSize: 10,
    fontWeight: '800',
  },

  bottomInfo: {
    marginTop: 15,
    padding: 15,
    borderRadius: 18,
    backgroundColor: LIGHT_PINK,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  bottomLabel: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },

  bottomValue: {
    marginTop: 3,
    color: BROWN,
    fontSize: 16,
    fontWeight: '900',
  },

  smoothnessBadge: {
    alignItems: 'flex-end',
  },

  smoothnessNumber: {
    color: ACCENT,
    fontSize: 18,
    fontWeight: '900',
  },

  smoothnessLabel: {
    marginTop: 1,
    color: MUTED,
    fontSize: 9,
  },

  waitingText: {
    marginTop: 10,
    textAlign: 'center',
    color: MUTED,
    fontSize: 11,
  },

  resultsContent: {
    paddingHorizontal: 22,
    paddingTop: 25,
    paddingBottom: 30,
    alignItems: 'center',
  },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 17,
  },

  passPill: {
    backgroundColor: PINK,
  },

  tryPill: {
    backgroundColor: '#FFF1F3',
  },

  statusText: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.9,
  },

  resultTitle: {
    marginTop: 15,
    color: DARK,
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
  },

  resultSubtitle: {
    marginTop: 8,
    color: SOFT_TEXT,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },

  scoreCircle: {
    marginTop: 20,
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scoreNumber: {
    color: DARK,
    fontSize: 50,
    lineHeight: 54,
    fontWeight: '900',
  },

  scoreOutOf: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '800',
  },

  scoreCaption: {
    marginTop: 8,
    color: ACCENT,
    fontSize: 12,
    fontWeight: '900',
  },

  resultCard: {
    width: '100%',
    marginTop: 18,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  resultRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F4E9EC',
  },

  lastResultRow: {
    borderBottomWidth: 0,
  },

  resultLabel: {
    color: SOFT_TEXT,
    fontSize: 13,
  },

  resultValue: {
    color: DARK,
    fontSize: 13,
    fontWeight: '900',
  },

  qualityCard: {
    width: '100%',
    marginTop: 14,
    padding: 14,
    borderRadius: 17,
    backgroundColor: LIGHT_PINK,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },

  qualityCopy: {
    flex: 1,
  },

  qualityTitle: {
    color: DARK,
    fontSize: 12,
    fontWeight: '900',
  },

  qualityText: {
    marginTop: 2,
    color: MUTED,
    fontSize: 10,
    lineHeight: 16,
  },

  qualityValue: {
    color: ACCENT,
    fontSize: 18,
    fontWeight: '900',
  },

  secondaryButton: {
    width: '100%',
    height: 54,
    marginTop: 10,
    borderRadius: 27,
    borderWidth: 1.5,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  secondaryButtonText: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '900',
  },
});