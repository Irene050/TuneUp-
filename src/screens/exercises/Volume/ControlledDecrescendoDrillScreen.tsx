import {
  CONTROLLED_DECRESCENDO_PARAMS,
  type ControlledDecrescendoParams,
  type Tier,
} from '@/constants/exercises/volume';
import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import ExerciseScreen from '@/screens/exercises/ExerciseScreen';
import {
  generateControlledDecrescendoParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureControlledDecrescendo } from '@/services/measurement/volume/controlledDecrescendoDrill';
import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreControlledDecrescendo } from '@/services/scoring/volume/controlledDecrescendoDrill';
import {
  playSingleNote,
} from '@/utils/music/notePlayer';
import {
  createMusicalNote,
} from '@/utils/music/notes';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const BROWN = '#4E2F1F';
const DARK = '#5A343D';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const BORDER = '#F0DEE3';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';
const SOFT_TEXT = '#765D63';
const BAR_COUNT = 28;
const DISPLAY_MAX_DB = 60;
const WINDOW_MS = 50;
const REFERENCE_NOTE = createMusicalNote(60);
const REFERENCE_NOTE_DURATION_SEC = 1.5;

type Phase =
  | 'directions'
  | 'exercise'
  | 'countdown'
  | 'results';

interface ControlledDecrescendoDrillProps {
  tier?: Tier;
}

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
  db: number,
): string {
  if (
    !Number.isFinite(db) ||
    db <= 0
  ) {
    return '--';
  }
  return String(
    Math.round(db),
  );
}

function formatTimer(
  ms: number,
): string {
  const seconds =
    Math.max(
      0,
      Math.ceil(ms / 1000),
    );
  return `0:${String(
    seconds,
  ).padStart(2, '0')}`;
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
    recent[
    recent.length - 1
    ] -
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

function guideDecrescendoHeight(index: number): number {
  const progress = index / Math.max(BAR_COUNT - 1, 1);
  // A pronounced downward ramp: loud on the left, soft on the right.
  return 1 - Math.pow(progress, 0.75) * 0.9;
}

function TargetDecrescendoGuide({
  elapsedMs,
  durationMs,
}: {
  elapsedMs: number;
  durationMs: number;
}) {
  const progress = clamp(durationMs > 0 ? elapsedMs / durationMs : 0, 0, 1);
  const activeBarPosition = progress * (BAR_COUNT - 1);
  const activeBarIndex = Math.floor(activeBarPosition);
  const indicatorLeft = Math.min(progress * 100, 98.5);
  return (
    <View style={styles.targetGuideCard}>
      <Text style={styles.targetGuideTitle}>Follow this pattern</Text>
      <Text style={styles.targetGuideSubtitle}>
        Start loud, then gradually lower your voice until you reach Soft.
      </Text>
      <View style={styles.targetGuideBars}>
        {Array.from({ length: BAR_COUNT }, (_, index) => (
          <View
            key={`target-decrescendo-${index}`}
            style={[
              styles.targetGuideBar,
              {
                height: `${guideDecrescendoHeight(index) * 100}%`,
                backgroundColor:
                  index === activeBarIndex
                    ? ACCENT
                    : index < activeBarPosition
                      ? '#EAA5B6'
                      : '#F7DCE3',
              },
            ]}
          />
        ))}
        <View
          pointerEvents="none"
          style={[styles.targetGuideIndicator, { left: `${indicatorLeft}%` }]}
        />
      </View>
      <View style={styles.targetGuideLabels}>
        <Text style={styles.targetGuideLabel}>LOUD</Text>
        <Text style={styles.targetGuideLabel}>SOFT</Text>
      </View>
      <View style={styles.targetGuideProgressTrack}>
        <View
          style={[
            styles.targetGuideProgressFill,
            { width: `${progress * 100}%` },
          ]}
        />
      </View>
    </View>
  );
}

function InstructionRow({
  number,
  children,
}: {
  number: string;
  children: ReactNode;
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
/**
 * ComponentScore uses scorePct as the
 * assessment component score.
 *
 * Assessment scores are only used as
 * the cold-start seed for ADS.
 */

function getAssessmentScore(
  assessment: Awaited<
    ReturnType<typeof getLatestAssessment>
  >,
): number | null {
  if (!assessment) {
    return null;
  }
  const volumeScore =
    assessment.scores.find(
      (item) =>
        item.componentId ===
        'volume',
    );
  if (!volumeScore) {
    return null;
  }
  const score =
    Number(
      volumeScore.scorePct,
    );
  return Number.isFinite(score)
    ? score
    : null;
}

export default function ControlledDecrescendoDrill({
  tier: requestedTier,
}: ControlledDecrescendoDrillProps) {

  const [
    resolvedTier,
    setResolvedTier,
  ] = useState<Tier>(
    requestedTier ??
    'beginner',
  );

  const [
    params,
    setParams,
  ] =
    useState<ControlledDecrescendoParams>(
      CONTROLLED_DECRESCENDO_PARAMS.beginner,
    );

  const [
    paramsReady,
    setParamsReady,
  ] = useState(
    requestedTier !== undefined,
  );

  const [
    phase,
    setPhase,
  ] = useState<Phase>(
    'directions',
  );

  const [
    elapsedMs,
    setElapsedMs,
  ] = useState(0);

  const [countdown, setCountdown] = useState(3);

  const [countdownReady, setCountdownReady] = useState(false);

  const [
    liveFrame,
    setLiveFrame,
  ] =
    useState<LiveAudioFrame | null>(
      null,
    );

  const [
    liveHistory,
    setLiveHistory,
  ] = useState<number[]>([]);

  const [
    score,
    setScore,
  ] = useState(0);

  const [
    repScores,
    setRepScores,
  ] = useState<number[]>([]);

  const [
    startDb,
    setStartDb,
  ] = useState(0);

  const [
    endDb,
    setEndDb,
  ] = useState(0);

  const [
    targetReached,
    setTargetReached,
  ] = useState(false);

  const [
    directionCorrect,
    setDirectionCorrect,
  ] = useState(false);

  const [
    measurementQuality,
    setMeasurementQuality,
  ] = useState(0);

  const finishingRef = useRef(false);

  const interRepStopRef = useRef(false);

  const repetitionSamplesRef = useRef<Float32Array[]>([]);

  const lastHandledBoundaryRef = useRef<number | null>(null);

  /*
   * Resolve tier and generate ADS parameters.
   *
   * Priority:
   * 1. Explicit tier prop
   * 2. Saved Volume progress tier
   * 3. Beginner
   *
   * Continuous ADS:
   * - same component
   * - same template
   * - same tier
   * - latest five exercise scores
   *
   * Cold start:
   * - latest Volume assessment score
   */
  useEffect(() => {
    let cancelled = false;
    const loadParameters =
      async () => {
        try {
          let tier =
            requestedTier;
          const user =
            auth.currentUser;
          if (
            !tier &&
            user
          ) {
            const progress =
              await fetchComponentProgress(
                user.uid,
                'volume',
              );
            tier =
              progress?.currentTier;
          }
          const finalTier =
            tier ??
            'beginner';
          let recentScores:
            number[] = [];
          if (user) {
            const records =
              await fetchExerciseRecords(
                user.uid,
                'volume',
              );
            const history =
              records
                .filter(
                  (record) =>
                    record.templateId ===
                    'controlledDecrescendo' &&
                    record.tier ===
                    finalTier,
                )
                .sort(
                  (a, b) =>
                    a.timestamp -
                    b.timestamp,
                );
            recentScores =
              history
                .slice(-5)
                .map(
                  (record) =>
                    record.scorePct,
                );
            /*
             * Assessment is only a
             * cold-start seed.
             */
            if (
              recentScores.length ===
              0
            ) {
              const assessment =
                await getLatestAssessment();
              const assessmentScore =
                getAssessmentScore(
                  assessment,
                );
              if (
                assessmentScore !==
                null
              ) {
                recentScores = [
                  assessmentScore,
                ];
              }
            }
          }
          const generated =
            generateControlledDecrescendoParams(
              {
                tier:
                  finalTier,
                recentScores,
              },
            );
          if (cancelled) {
            return;
          }
          setResolvedTier(
            finalTier,
          );
          setParams(
            generated,
          );
          setParamsReady(
            true,
          );
        } catch (error) {
          console.error(
            'CONTROLLED DECRESCENDO PARAMETER LOAD ERROR:',
            error,
          );
          if (!cancelled) {
            const fallbackTier =
              requestedTier ??
              'beginner';
            setResolvedTier(
              fallbackTier,
            );
            setParams(
              CONTROLLED_DECRESCENDO_PARAMS[
              fallbackTier
              ],
            );
            setParamsReady(
              true,
            );
          }
        }
      };
    void loadParameters();
    return () => {
      cancelled = true;
    };
  }, [
    requestedTier,
  ]);

  const targetStart =
    params.targetDbRange[1];

  const targetEnd =
    params.targetDbRange[0];

  const durationSeconds =
    params.durationSec;

  const repetitions =
    params.repetitions;

  const totalDurationMs =
    durationSeconds *
    repetitions *
    1000;

  const repDurationMs =
    durationSeconds *
    1000;

  const playReferenceNote =
    async () => {
      try {
        await playSingleNote(
          REFERENCE_NOTE.frequency,
          REFERENCE_NOTE_DURATION_SEC,
        );
      } catch (error) {
        console.error(
          'REFERENCE NOTE PLAYBACK ERROR:',
          error,
        );
      }
    };

  const {
    startRecording,
    stopRecording,
    isRecording,
  } =
    useAudioRecorder({
      onFrame: (
        frame,
      ) => {
        if (
          phase !==
          'exercise'
        ) {
          return;
        }
        setLiveFrame(frame);
        const rawDbfs = frame.volume;
        const hasValidDbfs =
          Number.isFinite(rawDbfs) &&
          rawDbfs > -100 &&
          rawDbfs <= 0;
        // Convert negative dBFS to the exercise's 0-60 level scale.
        // -20 dBFS becomes level 40; silence near -100 becomes level 0.
        const liveLevel = hasValidDbfs
          ? clamp(DISPLAY_MAX_DB + rawDbfs, 0, DISPLAY_MAX_DB)
          : 0;
        // Keep recent non-silent samples for the trend guidance.
        if (liveLevel > 0) {
          setLiveHistory(previous => [...previous, liveLevel].slice(-60));
        }
      },
      onStop: (
        samples,
        sampleRate,
      ) => {
        // Save each completed repetition and exclude countdown silence from scoring.
        if (interRepStopRef.current) {
          interRepStopRef.current = false;
          if (samples.length > 0) {
            repetitionSamplesRef.current.push(samples);
          }
          return;
        }
        const recordedSegments = [
          ...repetitionSamplesRef.current,
          samples,
        ];
        const totalSampleCount = recordedSegments.reduce(
          (total, segment) => total + segment.length,
          0,
        );
        const completeSamples = new Float32Array(totalSampleCount);
        let sampleOffset = 0;
        for (const segment of recordedSegments) {
          completeSamples.set(segment, sampleOffset);
          sampleOffset += segment.length;
        }
        repetitionSamplesRef.current = [];
        const measurement =
          measureControlledDecrescendo(
            completeSamples,
            sampleRate,
            {
              windowMs:
                WINDOW_MS,
              targetRange:
                params.targetDbRange,
              expectedDurationSeconds:
                durationSeconds,
              repetitions,
              volumeDecreaseThreshold:
                params.volumeDecreaseThreshold,
            },
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
        setLiveHistory([]);
        setPhase('results');
        /*
         * Save only naturally completed
         * exercise results.
         */
        void saveCompletedExercise(
          'volume',
          'controlledDecrescendo',
          resolvedTier,
          result.overallScore,
        );
      },
    });

  useEffect(() => {
    // Start the timer only once the microphone recorder is actually active.
    if (phase !== 'exercise' || !isRecording) {
      return;
    }
    // Pause at exact repetition boundaries so the guide never runs ahead.
    if (
      elapsedMs > 0 &&
      elapsedMs % repDurationMs === 0 &&
      elapsedMs !== lastHandledBoundaryRef.current
    ) {
      lastHandledBoundaryRef.current = elapsedMs;
      if (elapsedMs < totalDurationMs) {
        if (finishingRef.current) {
          return;
        }
        finishingRef.current = true;
        interRepStopRef.current = true;
        setCountdown(3);
        setCountdownReady(false);
        setLiveFrame(null);
        setLiveHistory([]);
        setPhase('countdown');
        void stopRecording()
          .then(() => {
            finishingRef.current = false;
            setCountdownReady(true);
          })
          .catch((stopError) => {
            console.error(
              'Unable to pause before the next Controlled Decrescendo repetition:',
              stopError,
            );
            interRepStopRef.current = false;
            repetitionSamplesRef.current = [];
            finishingRef.current = false;
            setCountdownReady(false);
            setPhase('directions');
          });
        return;
      }
    }
    if (elapsedMs >= totalDurationMs) {
      if (!finishingRef.current) {
        finishingRef.current = true;
        void stopRecording().catch((stopError) => {
          console.error(
            'Unable to finish Controlled Decrescendo recording:',
            stopError,
          );
          finishingRef.current = false;
          repetitionSamplesRef.current = [];
          setPhase('directions');
        });
      }
      return;
    }
    const timer = setTimeout(() => {
      setElapsedMs((previous) => Math.min(previous + 50, totalDurationMs));
    }, 50);
    return () => clearTimeout(timer);
  }, [phase, isRecording, elapsedMs, repDurationMs, stopRecording, totalDurationMs]);

  // The next repetition starts only after the previous audio segment has stopped.
  useEffect(() => {
    if (phase !== 'countdown' || !countdownReady) {
      return;
    }
    const timer = setTimeout(() => {
      if (countdown > 1) {
        setCountdown((previous) => previous - 1);
        return;
      }
      setCountdownReady(false);
      setLiveFrame(null);
      setLiveHistory([]);
      finishingRef.current = false;
      setPhase('exercise');
      void startRecording()
        .then(() => {
          // Align the live chart's start with the restarted microphone segment.
        })
        .catch((recordingError) => {
          console.error(
            'Unable to restart Controlled Decrescendo recording:',
            recordingError,
          );
          interRepStopRef.current = false;
          repetitionSamplesRef.current = [];
          finishingRef.current = false;
          setPhase('directions');
        });
    }, 1000);
    return () => clearTimeout(timer);
  }, [phase, countdown, countdownReady, startRecording]);

  const startExercise =
    async () => {
      setElapsedMs(0);
      setLiveFrame(null);
      setLiveHistory([]);
      setScore(0);
      setRepScores(
        Array(
          repetitions,
        ).fill(0),
      );
      setStartDb(0);
      setEndDb(0);
      setTargetReached(false);
      setDirectionCorrect(false);
      setMeasurementQuality(0);
      finishingRef.current = false;
      interRepStopRef.current = false;
      repetitionSamplesRef.current = [];
      lastHandledBoundaryRef.current = null;
      setCountdown(3);
      setCountdownReady(false);
      try {
        /*
         * Play the shared reference note
         * before recording begins.
         */
        await playReferenceNote();
        setPhase('exercise');
        await startRecording();
        // Begin the displayed timing only when the microphone is active.
      } catch (error) {
        console.error(
          'CONTROLLED DECRESCENDO START ERROR:',
          error,
        );
        setPhase(
          'directions',
        );
        interRepStopRef.current = false;
        repetitionSamplesRef.current = [];
        finishingRef.current = false;
      }
    };

  const currentRep =
    Math.min(
      repetitions,
      Math.floor(
        elapsedMs /
        repDurationMs,
      ) + 1,
    );

  const currentRepElapsed =
    elapsedMs %
    repDurationMs;

  const progress =
    clamp(
      currentRepElapsed /
      repDurationMs,
      0,
      1,
    );

  const liveDbfs =
    liveFrame && Number.isFinite(liveFrame.volume)
      ? liveFrame.volume
      : -100;

  const liveDb =
    liveDbfs > -100 && liveDbfs <= 0
      ? clamp(DISPLAY_MAX_DB + liveDbfs, 0, DISPLAY_MAX_DB)
      : 0;

  const currentVolume = liveDb > 0 ? formatDb(liveDb) : '--';

  const trend =
    liveDb > 0 ? getTrend(liveHistory) : 'flat';

  const guidance =
    liveDb === 0
      ? `Start near ${targetStart} dB, then slowly fade down.`
      : trend === 'down'
        ? `Good! Keep fading down toward ${targetEnd} dB.`
        : trend === 'up'
          ? 'Your voice is getting louder. Gently lower it.'
          : `Lower your voice smoothly toward ${targetEnd} dB. Keep the sound going.`;

  const passed =
    score >= 75 &&
    targetReached &&
    directionCorrect;

  if (!paramsReady) {
    return (
      <SafeAreaView
        style={styles.container}
      >
        <Header />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent:
              'center',
            paddingHorizontal: 30,
          }}
        >
          <Text
            style={{
              color: DARK,
              fontSize: 18,
              fontWeight: '900',
            }}
          >
            Preparing your exercise...
          </Text>
          <Text
            style={{
              marginTop: 8,
              color: MUTED,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            Adjusting the exercise to
            your current practice level.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  /*
   * Instruction screen copied from the provided reference screen.
   * The exercise/countdown/results logic below remains unchanged.
   */
  if (phase === 'directions') {
    return (
      <ExerciseScreen
        title="Controlled Decrescendo"
        category="VOLUME CONTROL"
        icon="volume-low-outline"
        tier={resolvedTier}
        instructions={`1. Begin with a comfortable, steady voice.

2. Gradually decrease your volume.

3. Keep the decrease smooth and even.

4. Finish softly without abruptly stopping.

5. Repeat the exercise ${repetitions} times.`}
        summary={[
          {
            label: 'Reference note',
            value: REFERENCE_NOTE.name,
          },
          {
            label: 'Target range',
            value: `${targetStart}–${targetEnd} dB`,
          },
          {
            label: 'Duration per repetition',
            value: `${durationSeconds} seconds`,
          },
        ]}
        targetValue={`${targetStart}–${targetEnd} dB`}
        targetHint="Begin comfortably loud, then gradually lower your volume."
        repetitions={repetitions}
        tip="Sing the reference note while gradually reducing your volume. Keep your pitch steady and avoid letting the sound fade out too early."
        onBack={() => router.back()}
        onStart={startExercise}
        startLabel="Start Exercise"
      >
        <View style={styles.instructionReferenceCard}>
          <View style={styles.instructionReferenceHeader}>
            <View style={styles.instructionReferenceIcon}>
              <Ionicons
                name="musical-note"
                size={18}
                color={BROWN}
              />
            </View>
            <View style={styles.instructionReferenceText}>
              <Text style={styles.instructionReferenceLabel}>
                BEFORE YOU BEGIN
              </Text>
              <Text style={styles.instructionReferenceNote}>
                {REFERENCE_NOTE.name}
              </Text>
            </View>
            <Pressable
              style={styles.instructionReplayButton}
              onPress={() => void playReferenceNote()}
            >
              <Ionicons
                name="play"
                size={13}
                color={BROWN}
              />
              <Text style={styles.instructionReplayButtonText}>
                Play note
              </Text>
            </Pressable>
          </View>
          <Text style={styles.instructionReferenceDescription}>
            Listen to the reference note first. During the exercise,
            sing the same note while gradually decreasing your volume.
          </Text>
        </View>
        <View style={styles.instructionPreviewCard}>
          <Text style={styles.instructionPreviewTitle}>
            Follow this pattern
          </Text>
          <View style={styles.instructionPreviewVisualizer}>
            {Array.from({ length: BAR_COUNT }, (_, index) => (
              <View
                key={`instruction-preview-${index}`}
                style={[
                  styles.instructionPreviewBar,
                  {
                    height: `${guideDecrescendoHeight(index) * 80}%`,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.instructionPreviewLabels}>
            <Text style={styles.instructionPreviewLabel}>Loud</Text>
            <Text style={styles.instructionPreviewLabel}>Soft</Text>
          </View>
        </View>
      </ExerciseScreen>
    );
  }

  if (phase === 'countdown') {
    return (
      <SafeAreaView style={styles.container}>
        <Header />
        <View style={styles.countdownContent}>
          <Text style={styles.countdownEyebrow}>
            REPETITION {currentRep} OF {repetitions}
          </Text>
          <Text style={styles.countdownPrompt}>NEXT REPETITION STARTS IN</Text>
          <View style={styles.countdownCircle}>
            <Text style={styles.countdownNumber}>{countdown}</Text>
          </View>
          <Text style={styles.countdownSubtitle}>
            Get ready to begin loud, then gradually fade your voice to Soft.
          </Text>
          <TargetDecrescendoGuide elapsedMs={0} durationMs={repDurationMs} />
        </View>
      </SafeAreaView>
    );
  }

  if (
    phase ===
    'exercise'
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
                {repetitions}
              </Text>
            </View>
          </View>
          <View
            style={styles.timerRow}
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
                {formatTimer(
                  repDurationMs -
                  currentRepElapsed,
                )}
              </Text>
            </View>
            <Text
              style={
                styles.rangeHint
              }
            >
              {targetStart} → {targetEnd}{' '}
              dB
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
                  width:
                    `${progress * 100}%`,
                },
              ]}
            />
          </View>
          <TargetDecrescendoGuide
            elapsedMs={currentRepElapsed}
            durationMs={repDurationMs}
          />
          <View style={styles.exerciseGuideCard}>
            <View style={styles.exerciseGuideHeader}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={ACCENT}
              />
              <Text style={styles.exerciseGuideTitle}>YOUR GUIDE</Text>
            </View>
            <View style={styles.exerciseGuideSteps}>
              <View style={styles.exerciseGuideStep}>
                <View style={styles.exerciseGuideNumber}>
                  <Text style={styles.exerciseGuideNumberText}>1</Text>
                </View>
                <Text style={styles.exerciseGuideStepTitle}>START</Text>
                <Text style={styles.exerciseGuideStepText}>Near {targetStart} dB</Text>
              </View>
              <View style={styles.exerciseGuideStep}>
                <View style={styles.exerciseGuideNumber}>
                  <Text style={styles.exerciseGuideNumberText}>2</Text>
                </View>
                <Text style={styles.exerciseGuideStepTitle}>FADE</Text>
                <Text style={styles.exerciseGuideStepText}>Lower slowly</Text>
              </View>
              <View style={styles.exerciseGuideStep}>
                <View style={styles.exerciseGuideNumber}>
                  <Text style={styles.exerciseGuideNumberText}>3</Text>
                </View>
                <Text style={styles.exerciseGuideStepTitle}>FINISH</Text>
                <Text style={styles.exerciseGuideStepText}>Near {targetEnd} dB</Text>
              </View>
            </View>
            <Text style={styles.exerciseGuideNote}>
              Keep your voice continuous. Do not cut the sound off suddenly.
            </Text>
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
              style={
                styles.liveVolumeRow
              }
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
                {targetStart} → {targetEnd}{' '}
                dB
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
                {params.smoothnessThreshold}%
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
    <SafeAreaView style={styles.container}>
      <Header />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.resultsContent}
      >
        <View
          style={[
            styles.statusPill,
            passed ? styles.passPill : styles.tryPill,
          ]}
        >
          <Ionicons
            name={passed ? 'checkmark-circle' : 'refresh-circle'}
            size={15}
            color={ACCENT}
          />
          <Text style={styles.statusText}>
            {passed ? 'EXERCISE PASSED' : 'KEEP PRACTICING'}
          </Text>
        </View>
        <View style={styles.resultIconCircle}>
          <Ionicons
            name={passed ? 'checkmark-circle-outline' : 'refresh-outline'}
            size={30}
            color={BROWN}
          />
        </View>
        <Text style={styles.resultTitle}>
          {passed ? 'Exercise Passed' : 'Needs More Practice'}
        </Text>
        <Text style={styles.resultSubtitle}>
          {passed
            ? 'Great control! Your voice followed the loud-to-soft pattern.'
            : 'Keep practicing a gradual, smooth decrease in volume.'}
        </Text>
        <View style={styles.overallScoreCard}>
          <Text style={styles.overallScoreLabel}>OVERALL SCORE</Text>
          <View style={styles.overallScoreRow}>
            <Text style={styles.overallScoreNumber}>{score}</Text>
            <Text style={styles.overallScoreSuffix}>/100</Text>
          </View>
          <Text style={styles.overallScoreMessage}>
            {passed
              ? 'You reached the target and maintained a smooth decrease.'
              : 'Aim to start loud, then lower your voice smoothly toward soft.'}
          </Text>
        </View>
        <View style={styles.resultCard}>
          {repScores.map((repScore, index) => (
            <ResultRow
              key={`rep-${index}`}
              label={`Repetition ${index + 1}`}
              value={`${repScore}%`}
            />
          ))}
          <ResultRow label="Start Volume" value={`${formatDb(startDb)} dB`} />
          <ResultRow label="End Volume" value={`${formatDb(endDb)} dB`} />
          <ResultRow
            label="Direction"
            value={directionCorrect ? 'Descending ✓' : 'Not descending'}
          />
          <ResultRow
            label="Target Range"
            value={targetReached ? `${targetStart} → ${targetEnd} dB ✓` : 'Target not reached'}
            last
          />
        </View>
        <View style={styles.qualityCard}>
          <View style={styles.qualityCopy}>
            <Text style={styles.qualityTitle}>Measurement quality</Text>
            <Text style={styles.qualityText}>
              {measurementQuality}% of expected audio windows were available.
            </Text>
          </View>
          <Text style={styles.qualityValue}>{measurementQuality}%</Text>
        </View>
        <Pressable
          style={styles.resultTryAgainButton}
          onPress={() => void startExercise()}
        >
          <Ionicons name="refresh" size={16} color={BROWN} />
          <Text style={styles.resultTryAgainText}>Try Again</Text>
        </Pressable>
        <Pressable
          style={styles.resultBackButton}
          onPress={() => router.replace('/exercises/volume' as any)}
        >
          <Text style={styles.resultBackButtonText}>Back to Exercises</Text>
        </Pressable>
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
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
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
    marginTop: 8,
    color: DARK,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
    textAlign: 'center',
  },

  subtitle: {
    marginTop: 5,
    color: SOFT_TEXT,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },

  targetCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 20,
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
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },

  targetPoint: {
    minWidth: 72,
    alignItems: 'center',
  },

  targetNumber: {
    color: BROWN,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
  },

  targetUnit: {
    marginTop: 3,
    color: MUTED,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },

  metaRow: {
    marginTop: 11,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },

  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  metaText: {
    color: BROWN,
    fontSize: 11,
    fontWeight: '800',
  },

  instructionsCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  sectionTitle: {
    color: DARK,
    fontSize: 16,
    fontWeight: '900',
  },

  instructionRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },

  instructionNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  instructionNumberText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '900',
  },

  instructionText: {
    flex: 1,
    color: SOFT_TEXT,
    fontSize: 12,
    lineHeight: 17,
  },

  tipCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#FFF9FB',
    borderWidth: 1,
    borderColor: '#F3DCE3',
    flexDirection: 'row',
    gap: 8,
  },

  tipCopy: {
    flex: 1,
  },

  tipTitle: {
    color: DARK,
    fontSize: 12,
    fontWeight: '900',
  },

  tipText: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11,
    lineHeight: 15,
  },

  referenceCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  referenceEyebrow: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },

  referenceNote: {
    marginTop: 3,
    color: BROWN,
    fontSize: 16,
    fontWeight: '900',
  },

  referenceButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryButton: {
    marginTop: 12,
    height: 50,
    borderRadius: 25,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },

  primaryButtonText: {
    color: WHITE,
    fontSize: 15,
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

  targetGuideCard: {
    width: '100%',
    marginTop: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#FFF9FB',
    borderWidth: 1,
    borderColor: BORDER,
  },

  targetGuideTitle: {
    color: DARK,
    fontSize: 13,
    fontWeight: '900',
  },

  targetGuideSubtitle: {
    marginTop: 3,
    color: MUTED,
    fontSize: 10,
    lineHeight: 14,
  },

  targetGuideBars: {
    height: 66,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    overflow: 'hidden',
    position: 'relative',
  },

  targetGuideBar: {
    flex: 1,
    minWidth: 1,
    borderRadius: 3,
  },

  targetGuideIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    borderRadius: 2,
    backgroundColor: ACCENT,
    opacity: 0.95,
  },

  targetGuideLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },

  targetGuideLabel: {
    color: MUTED,
    fontSize: 8,
    fontWeight: '800',
  },

  targetGuideProgressTrack: {
    height: 4,
    marginTop: 6,
    borderRadius: 2,
    backgroundColor: '#F3E4E8',
    overflow: 'hidden',
  },

  targetGuideProgressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: ACCENT,
  },

  countdownContent: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },

  countdownEyebrow: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textAlign: 'center',
  },

  countdownPrompt: {
    color: DARK,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },

  countdownCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  countdownNumber: {
    color: BROWN,
    fontSize: 44,
    fontWeight: '900',
  },

  countdownSubtitle: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },

  exerciseGuideCard: {
    marginTop: 12,
    padding: 11,
    borderRadius: 18,
    backgroundColor: '#FFF9FB',
    borderWidth: 1,
    borderColor: BORDER,
  },

  exerciseGuideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },

  exerciseGuideTitle: {
    color: DARK,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },

  exerciseGuideSteps: {
    flexDirection: 'row',
    gap: 7,
  },

  exerciseGuideStep: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 3,
    borderRadius: 12,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: '#F3E3E7',
  },

  exerciseGuideNumber: {
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },

  exerciseGuideNumberText: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '900',
  },

  exerciseGuideStepTitle: {
    color: DARK,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.3,
  },

  exerciseGuideStepText: {
    marginTop: 2,
    color: SOFT_TEXT,
    fontSize: 9,
    lineHeight: 12,
    textAlign: 'center',
  },

  exerciseGuideNote: {
    marginTop: 8,
    color: MUTED,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },

  liveReadoutCard: {
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: 22,
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
    fontSize: 46,
    lineHeight: 52,
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

  bottomInfo: {
    marginTop: 12,
    padding: 13,
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
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 24,
    alignItems: 'center',
  },

  resultIconCircle: {
    width: 54,
    height: 54,
    marginTop: 12,
    borderRadius: 27,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  overallScoreCard: {
    width: '100%',
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 16,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },

  overallScoreLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  overallScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },

  overallScoreNumber: {
    color: DARK,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
  },

  overallScoreSuffix: {
    marginLeft: 2,
    color: DARK,
    fontSize: 13,
    fontWeight: '800',
  },

  overallScoreMessage: {
    marginTop: 4,
    color: BROWN,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
    textAlign: 'center',
  },

  resultTryAgainButton: {
    width: '100%',
    height: 44,
    marginTop: 12,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: BROWN,
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  resultTryAgainText: {
    color: BROWN,
    fontSize: 12,
    fontWeight: '800',
  },

  resultBackButton: {
    width: '100%',
    height: 44,
    marginTop: 8,
    marginBottom: 2,
    borderRadius: 23,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
  },

  resultBackButtonText: {
    color: WHITE,
    fontSize: 12,
    fontWeight: '800',
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

  instructionReferenceCard: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 13,
    marginTop: 12,
  },

  instructionReferenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  instructionReferenceIcon: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },

  instructionReferenceText: {
    flex: 1,
  },

  instructionReferenceLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    letterSpacing: 1,
    color: ACCENT,
    fontWeight: '700',
  },

  instructionReferenceNote: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    fontWeight: '800',
    marginTop: 1,
  },

  instructionReplayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PINK,
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  instructionReplayButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    color: BROWN,
    fontWeight: '700',
    marginLeft: 4,
  },

  instructionReferenceDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 16,
    color: MUTED,
    marginTop: 9,
  },

  instructionPreviewCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 10,
  },

  instructionPreviewTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
    fontWeight: '700',
  },

  instructionPreviewVisualizer: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 7,
    overflow: 'hidden',
  },

  instructionPreviewBar: {
    flex: 1,
    maxWidth: 7,
    backgroundColor: '#EAA5B6',
    borderRadius: 4,
    marginHorizontal: 1,
  },

  instructionPreviewLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },

  instructionPreviewLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
  },
});
