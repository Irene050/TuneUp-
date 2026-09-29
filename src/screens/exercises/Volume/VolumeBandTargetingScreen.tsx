import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DimensionValue } from 'react-native';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  VOLUME_BAND_TARGETING_PARAMS,
  type Tier,
  type VolumeBandTargetingParams,
} from '@/constants/exercises/volume';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  auth,
} from '@/services/firebase/config';

import {
  measureVolumeBandTargeting,
} from '@/services/measurement/volume/volumeBandTargeting';

import {
  scoreVolumeBandTargeting,
} from '@/services/scoring/volume/volumeBandTargeting';

import {
  generateVolumeBandTargetingParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  createMusicalNote,
} from '@/utils/music/notes';

import {
  playSingleNote,
} from '@/services/assessment/notePlayer';

const BROWN = '#4E2F1F';
const DARK = '#5A343D';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const BORDER = '#F0DEE3';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';
const SOFT_TEXT = '#765D63';

const REFERENCE_NOTE = createMusicalNote(60);
const REFERENCE_NOTE_DURATION_SEC = 1.5;

const PREPARATION_COUNTDOWN_SECONDS = 3;

const HISTORY_LIMIT = 60;

const WINDOW_MS = 50;

type Phase =
  | 'directions'
  | 'countdown'
  | 'exercise'
  | 'results';

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

function formatDb(
  value: number,
): string {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return '--';
  }

  return String(
    Math.round(value),
  );
}

function formatTime(
  milliseconds: number,
): string {
  const seconds = Math.max(
    0,
    Math.ceil(milliseconds / 1000),
  );

  return `0:${String(
    seconds,
  ).padStart(2, '0')}`;
}

function formatTargetRange(
  targetRange: [number, number],
): string {
  const min = Math.round(
    Math.min(
      targetRange[0],
      targetRange[1],
    ),
  );

  const max = Math.round(
    Math.max(
      targetRange[0],
      targetRange[1],
    ),
  );

  return `${min}–${max} dB`;
}

function normalizeBandPosition(
  db: number,
): number {
  return clamp(
    (db - 30) / 40,
    0,
    1,
  );
}

function getLiveStatus(
  db: number,
  targetRange: [number, number],
):
  | 'low'
  | 'inside'
  | 'high'
  | 'none' {
  if (
    !Number.isFinite(db) ||
    db <= 0
  ) {
    return 'none';
  }

  const targetMin =
    Math.min(
      targetRange[0],
      targetRange[1],
    );

  const targetMax =
    Math.max(
      targetRange[0],
      targetRange[1],
    );

  if (db < targetMin) {
    return 'low';
  }

  if (db > targetMax) {
    return 'high';
  }

  return 'inside';
}

function getStatusMessage(
  status:
    | 'low'
    | 'inside'
    | 'high'
    | 'none',
): string {
  switch (status) {
    case 'low':
      return 'A little louder';

    case 'high':
      return 'A little softer';

    case 'inside':
      return 'Perfect — stay here';

    default:
      return 'Start singing around the target band';
  }
}

function getStatusColor(
  status:
    | 'low'
    | 'inside'
    | 'high'
    | 'none',
): string {
  switch (status) {
    case 'inside':
      return ACCENT;

    case 'low':
      return '#8D7A7D';

    case 'high':
      return '#A05D6C';

    default:
      return MUTED;
  }
}

function TargetBandMeter({
  liveDb,
  targetRange,
}: {
  liveDb: number;
  targetRange: [number, number];
}) {
  const currentPosition =
    normalizeBandPosition(
      liveDb,
    );

  const targetMin =
    Math.min(
      targetRange[0],
      targetRange[1],
    );

  const targetMax =
    Math.max(
      targetRange[0],
      targetRange[1],
    );

  const bandLeft =
    normalizeBandPosition(
      targetMin,
    ) * 100;

  const bandWidth =
    (
      normalizeBandPosition(
        targetMax,
      ) -
      normalizeBandPosition(
        targetMin,
      )
    ) * 100;

  return (
    <View style={styles.meterCard}>
      <View style={styles.meterHeader}>
        <View>
          <Text style={styles.meterTitle}>
            Target Volume
          </Text>

          <Text
            style={
              styles.meterSubtitle
            }
          >
            Keep your voice inside the pink band
          </Text>
        </View>

        <Text style={styles.meterRange}>
          {formatTargetRange(
            targetRange,
          )}
        </Text>
      </View>

      <View style={styles.meter}>
        <View
          style={[
            styles.targetBand,
            {
              left: `${bandLeft}%`,
              width: `${bandWidth}%`,
            },
          ]}
        />

        {Number.isFinite(liveDb) &&
          liveDb > 0 && (
            <View
              style={[
                styles.marker,
                {
                  left:
                    `${currentPosition * 100}%` as DimensionValue,
                },
              ]}
            >
              <View
                style={
                  styles.markerDot
                }
              />

              <View
                style={
                  styles.markerStem
                }
              />
            </View>
          )}
      </View>

      <View style={styles.meterScale}>
        <Text style={styles.scaleText}>
          30
        </Text>

        <Text style={styles.scaleText}>
          40
        </Text>

        <Text style={styles.scaleText}>
          55
        </Text>

        <Text style={styles.scaleText}>
          70 dB
        </Text>
      </View>
    </View>
  );
}

function StabilityHistory({
  history,
  targetRange,
}: {
  history: number[];
  targetRange: [number, number];
}) {
  const bars = useMemo(() => {
    if (history.length === 0) {
      return Array(30).fill(0);
    }

    return Array.from(
      { length: 30 },
      (_, index) => {
        const position =
          (index / 29) *
          Math.max(
            history.length - 1,
            1,
          );

        const left =
          Math.floor(position);

        const right =
          Math.min(
            Math.ceil(position),
            history.length - 1,
          );

        const fraction =
          position - left;

        return (
          history[left] *
            (1 - fraction) +
          history[right] *
            fraction
        );
      },
    );
  }, [history]);

  const targetMin =
    Math.min(
      targetRange[0],
      targetRange[1],
    );

  const targetMax =
    Math.max(
      targetRange[0],
      targetRange[1],
    );

  const targetTop =
    (1 -
      normalizeBandPosition(
        targetMax,
      )) * 100;

  const targetHeight =
    (
      normalizeBandPosition(
        targetMax,
      ) -
      normalizeBandPosition(
        targetMin,
      )
    ) * 100;

  return (
    <View style={styles.historyCard}>
      <View
        style={styles.historyHeader}
      >
        <View>
          <Text
            style={
              styles.historyTitle
            }
          >
            Your Volume
          </Text>

          <Text
            style={
              styles.historySubtitle
            }
          >
            Stay as steady as possible
          </Text>
        </View>

        <Ionicons
          name="pulse-outline"
          size={22}
          color={ACCENT}
        />
      </View>

      <View style={styles.history}>
        <View
          style={[
            styles.historyTarget,
            {
              top: `${targetTop}%`,
              height: `${Math.max(
                targetHeight,
                4,
              )}%`,
            },
          ]}
        />

        <View
          style={styles.historyBars}
        >
          {bars.map(
            (db, index) => {
              const position =
                normalizeBandPosition(
                  db,
                );

              return (
                <View
                  key={`bar-${index}`}
                  style={[
                    styles.historyBar,
                    {
                      height:
                        db > 0
                          ? `${Math.max(
                              5,
                              position * 90,
                            )}%`
                          : '0%',
                    },
                  ]}
                />
              );
            },
          )}
        </View>
      </View>

      <View
        style={
          styles.historyLegend
        }
      >
        <Text style={styles.legendLow}>
          Too soft
        </Text>

        <Text style={styles.legendTarget}>
          TARGET BAND
        </Text>

        <Text style={styles.legendHigh}>
          Too loud
        </Text>
      </View>
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

function Instruction({
  number,
  text,
}: {
  number: string;
  text: string;
}) {
  return (
    <View
      style={
        styles.instructionRow
      }
    >
      <View
        style={
          styles.instructionNumber
        }
      >
        <Text
          style={
            styles.instructionNumberText
          }
        >
          {number}
        </Text>
      </View>

      <Text
        style={styles.instructionText}
      >
        {text}
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
        last &&
          styles.lastResultRow,
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

export default function VolumeBandTargeting({
  tier: tierProp,
}: {
  tier?: Tier;
}) {
  const [phase, setPhase] =
    useState<Phase>('directions');

  const [resolvedTier, setResolvedTier] =
    useState<Tier>(
      tierProp ?? 'beginner',
    );

  const [params, setParams] =
    useState<VolumeBandTargetingParams>(
      VOLUME_BAND_TARGETING_PARAMS[
        tierProp ?? 'beginner'
      ],
    );

  const paramsRef =
    useRef<VolumeBandTargetingParams>(
      params,
    );

  const [parametersReady, setParametersReady] =
    useState(false);

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [countdown, setCountdown] =
    useState(
      PREPARATION_COUNTDOWN_SECONDS,
    );

  const [referencePlaying, setReferencePlaying] =
    useState(false);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(
      null,
    );

  const [liveHistory, setLiveHistory] =
    useState<number[]>([]);

  const [score, setScore] =
    useState(0);

  const [averageDb, setAverageDb] =
    useState(0);

  const [consistency, setConsistency] =
    useState(0);

  const [targetReached, setTargetReached] =
    useState(false);

  const [passed, setPassed] =
    useState(false);

  const [measurementQuality, setMeasurementQuality] =
    useState(0);

  const [repScores, setRepScores] =
    useState<number[]>([]);

  const finishingRef =
    useRef(false);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  /*
   * ==========================================================
   * RESOLVE TIER + GENERATE ADS PARAMETERS
   * ==========================================================
   */
  useEffect(() => {
    let active = true;

    const loadParameters =
      async () => {
        try {
          const user =
            auth.currentUser;

          let nextTier: Tier =
            tierProp ??
            'beginner';

          if (
            !tierProp &&
            user
          ) {
            const progress =
              await fetchComponentProgress(
                user.uid,
                'volume',
              );

            nextTier =
              progress?.currentTier ??
              'beginner';
          }

          let recentScores: number[] =
            [];

          if (user) {
            const records =
              await fetchExerciseRecords(
                user.uid,
                'volume',
              );

            recentScores =
              records
                .filter(
                  (record) =>
                    record.templateId ===
                      'volumeBandTargeting' &&
                    record.tier ===
                      nextTier,
                )
                .sort(
                  (a, b) =>
                    a.timestamp -
                    b.timestamp,
                )
                .slice(-5)
                .map(
                  (record) =>
                    Number(
                      record.scorePct,
                    ),
                )
                .filter(
                  Number.isFinite,
                );
          }

          /*
           * Cold start:
           * use the latest Volume Assessment score
           * only when no exercise history exists.
           */
          if (
            recentScores.length === 0 &&
            user
          ) {
            const assessment =
              await getLatestAssessment();

            const assessmentScore =
              assessment?.scores.find(
                (item) =>
                  item.componentId ===
                  'volume',
              )?.scorePct;

            if (
              assessmentScore !==
                undefined &&
              Number.isFinite(
                Number(
                  assessmentScore,
                ),
              )
            ) {
              recentScores = [
                Number(
                  assessmentScore,
                ),
              ];
            }
          }

          const generated =
            generateVolumeBandTargetingParams(
              {
                tier: nextTier,
                recentScores,
              },
            );

          if (!active) {
            return;
          }

          setResolvedTier(
            nextTier,
          );

          setParams(
            generated,
          );

          paramsRef.current =
            generated;

          setParametersReady(
            true,
          );
        } catch (error) {
          console.error(
            'VOLUME BAND PARAMETER LOAD ERROR:',
            error,
          );

          if (!active) {
            return;
          }

          const fallbackTier =
            tierProp ??
            'beginner';

          const fallbackParams =
            VOLUME_BAND_TARGETING_PARAMS[
              fallbackTier
            ];

          setResolvedTier(
            fallbackTier,
          );

          setParams(
            fallbackParams,
          );

          paramsRef.current =
            fallbackParams;

          setParametersReady(
            true,
          );
        }
      };

    void loadParameters();

    return () => {
      active = false;
    };
  }, [tierProp]);

  /*
   * ==========================================================
   * REFERENCE NOTE
   * ==========================================================
   */
  const playReferenceNote =
    async (): Promise<boolean> => {
      try {
        setReferencePlaying(
          true,
        );

        await playSingleNote(
          REFERENCE_NOTE.frequency,
          REFERENCE_NOTE_DURATION_SEC,
        );

        return true;
      } catch (error) {
        console.error(
          'VOLUME BAND REFERENCE NOTE ERROR:',
          error,
        );

        return false;
      } finally {
        setReferencePlaying(
          false,
        );
      }
    };

  /*
   * ==========================================================
   * AUDIO RECORDER
   * ==========================================================
   */
  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (
        phase !==
        'exercise'
      ) {
        return;
      }

      setLiveFrame(frame);

      const db =
        Number.isFinite(
          frame.volume,
        )
          ? Math.abs(
              frame.volume,
            )
          : 0;

      if (db <= 0) {
        return;
      }

      setLiveHistory(
        (previous) => {
          const next = [
            ...previous,
            db,
          ];

          return next.length >
            HISTORY_LIMIT
            ? next.slice(
                -HISTORY_LIMIT,
              )
            : next;
        },
      );
    },

    onStop: (
      samples,
      sampleRate,
    ) => {
      const currentParams =
        paramsRef.current;

      const measurement =
        measureVolumeBandTargeting(
          samples,
          sampleRate,
          {
            windowMs:
              WINDOW_MS,

            targetDbRange:
              currentParams.targetDbRange,

            durationSec:
              currentParams.durationSec,

            repetitions:
              currentParams.repetitions,

            toleranceDb:
              currentParams.toleranceDb,
          },
        );

      const result =
        scoreVolumeBandTargeting(
          measurement,
          {
            passingScore:
              currentParams.consistencyThreshold,
          },
        );

      setScore(
        result.overallScore,
      );

      setConsistency(
        result.consistency,
      );

      setAverageDb(
        measurement.averageDb,
      );

      setTargetReached(
        result.targetReached,
      );

      setPassed(
        result.passed,
      );

      setMeasurementQuality(
        result.measurementQuality,
      );

      setRepScores(
        measurement.repConsistency.map(
          (value) =>
            Math.round(value),
        ),
      );

      /*
       * Save only the naturally completed exercise.
       * The recorder reaches onStop here after the
       * configured duration has elapsed.
       */
      void saveCompletedExercise(
        'volume',
        'volumeBandTargeting',
        resolvedTier,
        result.overallScore,
      );

      setPhase('results');
      setLiveFrame(null);
    },
  });

  /*
   * ==========================================================
   * TIMER
   * ==========================================================
   */
  const totalDurationMs =
    params.durationSec *
    params.repetitions *
    1000;

  useEffect(() => {
    if (
      phase !==
      'exercise'
    ) {
      return;
    }

    const timer =
      setInterval(() => {
        setElapsedMs(
          (previous) => {
            const next =
              Math.min(
                previous + 50,
                totalDurationMs,
              );

            if (
              next >=
                totalDurationMs &&
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
      clearInterval(
        timer,
      );
    };
  }, [
    phase,
    stopRecording,
    totalDurationMs,
  ]);

  /*
   * ==========================================================
   * START RECORDING
   * ==========================================================
   */
  const beginRecording =
    async () => {
      finishingRef.current =
        false;

      try {
        await startRecording();

        setPhase(
          'exercise',
        );
      } catch (error) {
        console.error(
          'VOLUME BAND TARGETING START ERROR:',
          error,
        );

        finishingRef.current =
          false;

        setPhase(
          'directions',
        );
      }
    };

  /*
   * ==========================================================
   * START EXERCISE
   * ==========================================================
   */
  const startExercise =
    async () => {
      if (!parametersReady) {
        return;
      }

      setElapsedMs(0);

      setCountdown(
        PREPARATION_COUNTDOWN_SECONDS,
      );

      setLiveFrame(null);
      setLiveHistory([]);

      setScore(0);
      setAverageDb(0);
      setConsistency(0);
      setTargetReached(false);
      setPassed(false);
      setMeasurementQuality(0);

      setRepScores(
        Array.from(
          {
            length:
              params.repetitions,
          },
          () => 0,
        ),
      );

      finishingRef.current =
        false;

      /*
       * Let the user hear C4 first, then give
       * a short preparation countdown.
       */
      const referencePlayed =
        await playReferenceNote();

      if (!referencePlayed) {
        setPhase(
          'directions',
        );

        return;
      }

      setPhase(
        'countdown',
      );
    };

  /*
   * ==========================================================
   * COUNTDOWN
   * ==========================================================
   */
  useEffect(() => {
    if (
      phase !==
      'countdown'
    ) {
      return;
    }

    if (
      countdown <= 0
    ) {
      void beginRecording();

      return;
    }

    const timeout =
      setTimeout(() => {
        setCountdown(
          (previous) =>
            Math.max(
              0,
              previous - 1,
            ),
        );
      }, 1000);

    return () => {
      clearTimeout(
        timeout,
      );
    };
  }, [
    phase,
    countdown,
  ]);

  const currentRep =
    Math.min(
      params.repetitions,
      Math.floor(
        elapsedMs /
          (params.durationSec *
            1000),
      ) + 1,
    );

  const currentRepElapsed =
    elapsedMs %
    (params.durationSec *
      1000);

  const progress =
    clamp(
      currentRepElapsed /
        (params.durationSec *
          1000),
      0,
      1,
    );

  const liveDb =
    liveFrame &&
    Number.isFinite(
      liveFrame.volume,
    )
      ? Math.abs(
          liveFrame.volume,
        )
      : 0;

  const status =
    getLiveStatus(
      liveDb,
      params.targetDbRange,
    );

  const targetRangeText =
    formatTargetRange(
      params.targetDbRange,
    );

  /*
   * ==========================================================
   * DIRECTIONS
   * ==========================================================
   */
  if (
    phase ===
    'directions'
  ) {
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
              name="options-outline"
              size={15}
              color={ACCENT}
            />

            <Text
              style={styles.badgeText}
            >
              VOLUME CONTROL
            </Text>
          </View>

          <Text style={styles.title}>
            Volume Band Targeting
          </Text>

          <Text
            style={styles.subtitle}
          >
            Listen to the C4 reference note,
            sing the same note, and keep
            your voice inside the target band.
          </Text>

          <View
            style={styles.referenceCard}
          >
            <View
              style={styles.referenceIcon}
            >
              <Ionicons
                name="musical-note"
                size={20}
                color={ACCENT}
              />
            </View>

            <View
              style={styles.referenceCopy}
            >
              <Text
                style={
                  styles.referenceEyebrow
                }
              >
                REFERENCE NOTE
              </Text>

              <Text
                style={
                  styles.referenceNote
                }
              >
                {REFERENCE_NOTE.name}
              </Text>

              <Text
                style={
                  styles.referenceText
                }
              >
                Sing this note on “Ah” while
                controlling your volume.
              </Text>
            </View>

            <Pressable
              style={[
                styles.referenceButton,
                referencePlaying &&
                  styles.referenceButtonDisabled,
              ]}
              disabled={
                referencePlaying
              }
              onPress={() =>
                void playReferenceNote()
              }
            >
              <Ionicons
                name={
                  referencePlaying
                    ? 'volume-high'
                    : 'play'
                }
                size={16}
                color={WHITE}
              />

              <Text
                style={
                  styles.referenceButtonText
                }
              >
                {referencePlaying
                  ? 'Playing...'
                  : `Play ${REFERENCE_NOTE.name}`}
              </Text>
            </Pressable>
          </View>

          <View
            style={
              styles.bandPreview
            }
          >
            <Text
              style={
                styles.previewEyebrow
              }
            >
              TARGET BAND
            </Text>

            <Text
              style={
                styles.previewRange
              }
            >
              {targetRangeText}
            </Text>

            <View
              style={
                styles.previewBandTrack
              }
            >
              <View
                style={[
                  styles.previewBand,
                  {
                    left:
                      `${normalizeBandPosition(
                        Math.min(
                          ...params.targetDbRange,
                        ),
                      ) * 100}%`,
                    width:
                      `${(
                        normalizeBandPosition(
                          Math.max(
                            ...params.targetDbRange,
                          ),
                        ) -
                        normalizeBandPosition(
                          Math.min(
                            ...params.targetDbRange,
                          ),
                        )
                      ) * 100}%`,
                  },
                ]}
              />
            </View>

            <View
              style={
                styles.previewLabels
              }
            >
              <Text
                style={
                  styles.previewLabel
                }
              >
                {Math.round(
                  Math.min(
                    ...params.targetDbRange,
                  ),
                )}{' '}
                dB
              </Text>

              <Text
                style={
                  styles.previewLabel
                }
              >
                {Math.round(
                  Math.max(
                    ...params.targetDbRange,
                  ),
                )}{' '}
                dB
              </Text>
            </View>
          </View>

          <View
            style={styles.statsRow}
          >
            <View
              style={styles.statCard}
            >
              <Ionicons
                name="timer-outline"
                size={19}
                color={ACCENT}
              />

              <Text
                style={styles.statValue}
              >
                {params.durationSec} sec
              </Text>

              <Text
                style={styles.statLabel}
              >
                per rep
              </Text>
            </View>

            <View
              style={styles.statCard}
            >
              <Ionicons
                name="repeat-outline"
                size={19}
                color={ACCENT}
              />

              <Text
                style={styles.statValue}
              >
                {params.repetitions}
              </Text>

              <Text
                style={styles.statLabel}
              >
                repetitions
              </Text>
            </View>

            <View
              style={styles.statCard}
            >
              <Ionicons
                name="analytics-outline"
                size={19}
                color={ACCENT}
              />

              <Text
                style={styles.statValue}
              >
                {params.consistencyThreshold}%
              </Text>

              <Text
                style={styles.statLabel}
              >
                consistency
              </Text>
            </View>
          </View>

          <View
            style={
              styles.instructionsCard
            }
          >
            <Text
              style={styles.sectionTitle}
            >
              How to do it
            </Text>

            <Instruction
              number="1"
              text={`Tap Play ${REFERENCE_NOTE.name} and listen to the reference note.`}
            />

            <Instruction
              number="2"
              text={`Sing the same ${REFERENCE_NOTE.name} note on “Ah.”`}
            />

            <Instruction
              number="3"
              text={`Keep your volume inside the ${targetRangeText} target band.`}
            />

            <Instruction
              number="4"
              text={`Hold for ${params.durationSec} seconds, then repeat the exercise.`}
            />
          </View>

          <View
            style={styles.tipCard}
          >
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
                Don't chase the number
              </Text>

              <Text
                style={styles.tipText}
              >
                Find a comfortable loudness
                first, then make small
                adjustments to stay inside
                the band.
              </Text>
            </View>
          </View>

          <Pressable
            style={[
              styles.primaryButton,
              !parametersReady &&
                styles.disabledButton,
            ]}
            disabled={
              !parametersReady
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
              {parametersReady
                ? 'Start Exercise'
                : 'Loading Exercise...'}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /*
   * ==========================================================
   * PREPARATION COUNTDOWN
   * ==========================================================
   */
  if (
    phase ===
    'countdown'
  ) {
    return (
      <SafeAreaView
        style={styles.container}
      >
        <Header />

        <View
          style={
            styles.countdownContent
          }
        >
          <View
            style={
              styles.countdownIcon
            }
          >
            <Ionicons
              name="musical-note"
              size={28}
              color={ACCENT}
            />
          </View>

          <Text
            style={
              styles.countdownEyebrow
            }
          >
            GET READY
          </Text>

          <Text
            style={
              styles.countdownTitle
            }
          >
            Sing {REFERENCE_NOTE.name}
          </Text>

          <Text
            style={
              styles.countdownText
            }
          >
            Start singing on “Ah” when the countdown reaches zero.
            Keep your volume inside the {targetRangeText} target band.
          </Text>

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

          <Text
            style={
              styles.countdownHint
            }
          >
            Listen to {REFERENCE_NOTE.name} • Prepare your voice • Stay relaxed
          </Text>

          <Pressable
            style={
              styles.countdownReferenceButton
            }
            onPress={() =>
              void playReferenceNote()
            }
          >
            <Ionicons
              name="musical-note"
              size={16}
              color={ACCENT}
            />

            <Text
              style={
                styles.countdownReferenceText
              }
            >
              Replay {REFERENCE_NOTE.name}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  /*
   * ==========================================================
   * ACTUAL EXERCISE
   * ==========================================================
   */
  if (
    phase ===
    'exercise'
  ) {
    const statusColor =
      getStatusColor(
        status,
      );

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
                VOLUME BAND
              </Text>

              <Text
                style={
                  styles.exerciseTitle
                }
              >
                Hold the zone
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
                {params.repetitions}
              </Text>
            </View>
          </View>

          <Pressable
            style={
              styles.exerciseReferenceButton
            }
            onPress={() =>
              void playReferenceNote()
            }
          >
            <Ionicons
              name="musical-note"
              size={16}
              color={ACCENT}
            />

            <Text
              style={
                styles.exerciseReferenceText
              }
            >
              Replay {REFERENCE_NOTE.name} Reference
            </Text>
          </Pressable>

          <View
            style={
              styles.timerRow
            }
          >
            <View
              style={
                styles.timerBadge
              }
            >
              <Ionicons
                name="time-outline"
                size={15}
                color={ACCENT}
              />

              <Text
                style={styles.timerText}
              >
                {formatTime(
                  params.durationSec *
                    1000 -
                    currentRepElapsed,
                )}
              </Text>
            </View>

            <Text
              style={
                styles.rangeHint
              }
            >
              {targetRangeText}
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
                  width: `${progress * 100}%`,
                },
              ]}
            />
          </View>

          <View
            style={[
              styles.liveCard,
              {
                borderColor:
                  statusColor,
              },
            ]}
          >
            <Text
              style={
                styles.liveLabel
              }
            >
              YOUR VOLUME
            </Text>

            <View
              style={
                styles.liveVolumeRow
              }
            >
              <Text
                style={
                  styles.liveVolume
                }
              >
                {formatDb(
                  liveDb,
                )}
              </Text>

              <Text
                style={
                  styles.liveUnit
                }
              >
                dB
              </Text>
            </View>

            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor:
                    `${statusColor}18`,
                },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      statusColor,
                  },
                ]}
              />

              <Text
                style={[
                  styles.statusText,
                  {
                    color:
                      statusColor,
                  },
                ]}
              >
                {getStatusMessage(
                  status,
                )}
              </Text>
            </View>
          </View>

          <TargetBandMeter
            liveDb={liveDb}
            targetRange={
              params.targetDbRange
            }
          />

          <StabilityHistory
            history={
              liveHistory
            }
            targetRange={
              params.targetDbRange
            }
          />

          <View
            style={
              styles.goalCard
            }
          >
            <View
              style={
                styles.goalIcon
              }
            >
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color={ACCENT}
              />
            </View>

            <View
              style={
                styles.goalCopy
              }
            >
              <Text
                style={
                  styles.goalTitle
                }
              >
                Stay steady
              </Text>

              <Text
                style={
                  styles.goalText
                }
              >
                The goal is not to move up or
                down. Keep your voice inside
                the target zone.
              </Text>
            </View>
          </View>

          {!isRecording && (
            <Text
              style={
                styles.waitingText
              }
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
            style={
              styles.statusPillText
            }
          >
            {passed
              ? 'EXERCISE PASSED'
              : 'KEEP PRACTICING'}
          </Text>
        </View>

        <Text
          style={
            styles.resultTitle
          }
        >
          Volume Band Results
        </Text>

        <Text
          style={
            styles.resultSubtitle
          }
        >
          {passed
            ? 'Nice control. You stayed inside the target band consistently.'
            : targetReached
              ? 'You reached the band. Now work on keeping the volume steadier.'
              : `Focus on finding and staying inside the ${targetRangeText} zone.`}
        </Text>

        <View
          style={
            styles.scoreCircle
          }
        >
          <Text
            style={
              styles.scoreNumber
            }
          >
            {score}
          </Text>

          <Text
            style={
              styles.scoreOutOf
            }
          >
            /100
          </Text>
        </View>

        <Text
          style={
            styles.scoreCaption
          }
        >
          Consistency Score
        </Text>

        <View
          style={
            styles.resultCard
          }
        >
          {repScores.map(
            (repScore, index) => (
              <ResultRow
                key={`rep-${index}`}
                label={`Repetition ${
                  index + 1
                }`}
                value={`${repScore}%`}
                last={
                  index ===
                  repScores.length - 1
                }
              />
            ),
          )}

          <ResultRow
            label="Average Volume"
            value={`${formatDb(
              averageDb,
            )} dB`}
          />

          <ResultRow
            label="Target Band"
            value={
              targetRangeText
            }
          />

          <ResultRow
            label="Consistency"
            value={`${consistency}%`}
          />

          <ResultRow
            label="Band Compliance"
            value={
              targetReached
                ? 'Inside ✓'
                : 'Outside'
            }
            last
          />
        </View>

        <View
          style={
            styles.qualityCard
          }
        >
          <View
            style={
              styles.qualityCopy
            }
          >
            <Text
              style={
                styles.qualityTitle
              }
            >
              Measurement quality
            </Text>

            <Text
              style={
                styles.qualityText
              }
            >
              {measurementQuality}% of
              expected audio windows were
              available.
            </Text>
          </View>

          <Text
            style={
              styles.qualityValue
            }
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
            <Ionicons
              name="arrow-forward"
              size={18}
              color={ACCENT}
            />

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
    fontSize: 29,
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

  referenceCard: {
    marginTop: 18,
    padding: 14,
    borderRadius: 20,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  referenceIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  referenceCopy: {
    flex: 1,
  },

  referenceEyebrow: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },

  referenceNote: {
    marginTop: 1,
    color: DARK,
    fontSize: 22,
    fontWeight: '900',
  },

  referenceText: {
    marginTop: 1,
    color: MUTED,
    fontSize: 10,
    lineHeight: 15,
  },

  referenceButton: {
    minWidth: 82,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 19,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
  },

  referenceButtonText: {
    color: WHITE,
    fontSize: 10,
    fontWeight: '900',
  },

  exerciseReferenceButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 11,
    height: 38,
    borderRadius: 19,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },

  exerciseReferenceText: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '900',
  },

  bandPreview: {
    marginTop: 24,
    padding: 20,
    borderRadius: 24,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
  },

  previewEyebrow: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },

  previewRange: {
    marginTop: 6,
    color: BROWN,
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
  },

  previewBandTrack: {
    position: 'relative',
    height: 18,
    marginTop: 18,
    borderRadius: 9,
    backgroundColor: '#F4E8EB',
    overflow: 'hidden',
  },

  previewBand: {
    position: 'absolute',
    height: '100%',
    borderRadius: 9,
    backgroundColor: PINK,
    borderWidth: 2,
    borderColor: '#E89AAF',
  },

  previewLabels: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  previewLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: '800',
  },

  statsRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
  },

  statCard: {
    flex: 1,
    minHeight: 88,
    padding: 11,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  statValue: {
    marginTop: 5,
    color: DARK,
    fontSize: 14,
    fontWeight: '900',
  },

  statLabel: {
    marginTop: 2,
    color: MUTED,
    fontSize: 9,
    fontWeight: '700',
  },

  instructionsCard: {
    marginTop: 16,
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

  disabledButton: {
    opacity: 0.65,
  },

  primaryButtonText: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '900',
  },

  referenceButtonDisabled: {
    opacity: 0.75,
  },

  countdownContent: {
    flex: 1,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  countdownIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  countdownEyebrow: {
    marginTop: 18,
    color: ACCENT,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.3,
  },

  countdownTitle: {
    marginTop: 7,
    color: DARK,
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
  },

  countdownText: {
    marginTop: 10,
    color: SOFT_TEXT,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },

  countdownCircle: {
    marginTop: 26,
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: LIGHT_PINK,
    borderWidth: 3,
    borderColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  countdownNumber: {
    color: DARK,
    fontSize: 56,
    fontWeight: '900',
  },

  countdownHint: {
    marginTop: 16,
    color: MUTED,
    fontSize: 11,
    textAlign: 'center',
  },

  countdownReferenceButton: {
    marginTop: 17,
    height: 44,
    paddingHorizontal: 17,
    borderRadius: 22,
    borderWidth: 1.2,
    borderColor: PINK,
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },

  countdownReferenceText: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '900',
  },

  exerciseContent: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 30,
  },

  exerciseTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
    fontSize: 24,
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

  liveCard: {
    marginTop: 18,
    padding: 20,
    borderRadius: 24,
    backgroundColor: LIGHT_PINK,
    borderWidth: 2,
    alignItems: 'center',
  },

  liveLabel: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
  },

  liveVolumeRow: {
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
  },

  liveVolume: {
    color: DARK,
    fontSize: 54,
    lineHeight: 61,
    fontWeight: '900',
  },

  liveUnit: {
    marginLeft: 6,
    color: MUTED,
    fontSize: 16,
    fontWeight: '800',
  },

  statusBadge: {
    marginTop: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  statusText: {
    fontSize: 12,
    fontWeight: '900',
  },

  meterCard: {
    marginTop: 15,
    padding: 16,
    borderRadius: 22,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  meterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  meterTitle: {
    color: DARK,
    fontSize: 16,
    fontWeight: '900',
  },

  meterSubtitle: {
    marginTop: 3,
    color: MUTED,
    fontSize: 10,
  },

  meterRange: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '900',
  },

  meter: {
    position: 'relative',
    height: 52,
    marginTop: 18,
    borderRadius: 26,
    backgroundColor: '#F5E9EC',
    overflow: 'hidden',
  },

  targetBand: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    borderRadius: 22,
    backgroundColor: PINK,
    borderWidth: 1,
    borderColor: '#E6A3B3',
  },

  marker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    marginLeft: -1.5,
    alignItems: 'center',
  },

  markerDot: {
    marginTop: 9,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ACCENT,
  },

  markerStem: {
    flex: 1,
    width: 3,
    backgroundColor: ACCENT,
  },

  meterScale: {
    marginTop: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  scaleText: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '800',
  },

  historyCard: {
    marginTop: 15,
    padding: 16,
    borderRadius: 22,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  historyTitle: {
    color: DARK,
    fontSize: 16,
    fontWeight: '900',
  },

  historySubtitle: {
    marginTop: 2,
    color: MUTED,
    fontSize: 10,
  },

  history: {
    position: 'relative',
    height: 145,
    marginTop: 13,
    borderRadius: 16,
    backgroundColor: '#FFF9FB',
    overflow: 'hidden',
  },

  historyTarget: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#FADFE5',
    opacity: 0.85,
  },

  historyBars: {
    ...StyleSheet.absoluteFill,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },

  historyBar: {
    flex: 1,
    minWidth: 2,
    backgroundColor: ACCENT,
    borderRadius: 5,
  },

  historyLegend: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  legendLow: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '700',
  },

  legendTarget: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: '900',
  },

  legendHigh: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '700',
  },

  goalCard: {
    marginTop: 15,
    padding: 14,
    borderRadius: 18,
    backgroundColor: LIGHT_PINK,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  goalIcon: {
    width: 37,
    height: 37,
    borderRadius: 19,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  goalCopy: {
    flex: 1,
  },

  goalTitle: {
    color: DARK,
    fontSize: 13,
    fontWeight: '900',
  },

  goalText: {
    marginTop: 2,
    color: MUTED,
    fontSize: 10,
    lineHeight: 16,
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

  statusPillText: {
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
    flexDirection: 'row',
    gap: 7,
  },

  secondaryButtonText: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '900',
  },
});