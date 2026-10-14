import {
  VOLUME_BAND_TARGETING_PARAMS,
  type Tier,
  type VolumeBandTargetingParams,
} from '@/constants/exercises/volume';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateVolumeBandTargetingParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureVolumeBandTargeting } from '@/services/measurement/volume/volumeBandTargeting';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreVolumeBandTargeting } from '@/services/scoring/volume/volumeBandTargeting';
import { playSingleNote } from '@/utils/music/notePlayer';
import { createMusicalNote } from '@/utils/music/notes';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

/* =========================================================
   CONSTANTS
   ========================================================= */
const BROWN = '#4E2F1F';
const DARK = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const BORDER = '#F2DDE5';
const ACCENT = '#D86C89';
const MUTED = '#8E7770';
const WHITE = '#FFFFFF';
const SOFT_TEXT = '#765D63';
const REFERENCE_NOTE_DURATION_SEC = 1.5;
const PREPARATION_COUNTDOWN_SECONDS = 3;
const HISTORY_LIMIT = 60;
const WINDOW_MS = 50;
/** Extra time per repetition without changing the tier configuration. */
const REP_DURATION_EXTENSION_SEC = 2;
/** Minimum number of usable live volume frames for a valid attempt. */
const MIN_VOICED_FRAMES = 8;
/**
 * Minimum level for live volume display, expressed in dBFS.
 * This is a microphone-input threshold, not acoustic dB SPL.
 */
const MIN_LIVE_INPUT_DBFS = -60;
/** Offset used to present the relative microphone level in the UI. */
const LIVE_LEVEL_OFFSET = 70;
type Phase = 'directions' | 'countdown' | 'exercise' | 'results';
type VoiceStatus = 'low' | 'inside' | 'high' | 'none';

/* =========================================================
   HELPERS
   ========================================================= */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
function formatDb(value: number): string {
  if (!Number.isFinite(value)) {
    return '--';
  }
  return String(Math.round(value));
}
function formatTargetRange(targetRange: [number, number]): string {
  const min = Math.round(Math.min(targetRange[0], targetRange[1]));
  const max = Math.round(Math.max(targetRange[0], targetRange[1]));
  return `${min}–${max} dB`;
}
function normalizeBandPosition(db: number): number {
  return clamp((db - 30) / 40, 0, 1);
}
function getLiveStatus(
  db: number,
  targetRange: [number, number],
): VoiceStatus {
  if (!Number.isFinite(db) || db <= 0) {
    return 'none';
  }
  const targetMin = Math.min(targetRange[0], targetRange[1]);
  const targetMax = Math.max(targetRange[0], targetRange[1]);
  if (db < targetMin) return 'low';
  if (db > targetMax) return 'high';
  return 'inside';
}
function getStatusMessage(status: VoiceStatus): string {
  switch (status) {
    case 'low':
      return 'A little louder';
    case 'high':
      return 'A little softer';
    case 'inside':
      return 'Perfect — stay here';
    default:
      return 'Sing around the target band';
  }
}
function getStatusColor(status: VoiceStatus): string {
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
/**
 * Volume Band Targeting measures loudness, not pitch.
 *
 * Do not require frame.pitch, frame.clarity, or frame.note here.
 * Those checks can discard usable loudness measurements when the
 * microphone captures a voice but the pitch detector cannot identify it.
 *
 * The level threshold still filters very quiet microphone input.
 */
function isUsableVoiceFrame(
  frame: LiveAudioFrame | null | undefined,
): frame is LiveAudioFrame {
  return Boolean(
    frame &&
      Number.isFinite(frame.volume) &&
      frame.volume > MIN_LIVE_INPUT_DBFS,
  );
}
/**
 * Convert the microphone's relative dBFS reading to the UI scale.
 * This is not calibrated acoustic dB SPL.
 */
function getLiveDisplayLevel(
  frame: LiveAudioFrame | null | undefined,
): number {
  if (!isUsableVoiceFrame(frame)) {
    return 0;
  }
  return clamp(frame.volume + LIVE_LEVEL_OFFSET, 0, 70);
}
/**
 * Reject recordings containing only silence or very low-level input.
 *
 * This check examines the actual recorded PCM samples, independently
 * of live pitch-detection results.
 */
function hasSufficientRecordedSignal(samples: Float32Array): boolean {
  if (!samples || samples.length === 0) {
    return false;
  }
  let sumSquares = 0;
  let peak = 0;
  let activeSamples = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    const absolute = Math.abs(value);
    sumSquares += value * value;
    peak = Math.max(peak, absolute);
    if (absolute >= 0.005) {
      activeSamples += 1;
    }
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  const activeRatio = activeSamples / samples.length;
  return rms >= 0.002 && peak >= 0.01 && activeRatio >= 0.01;
}

/* =========================================================
   TARGET BAND METER
   ========================================================= */
function TargetBandMeter({
  liveDb,
  targetRange,
}: {
  liveDb: number;
  targetRange: [number, number];
}) {
  const currentPosition = normalizeBandPosition(liveDb);
  const targetMin = Math.min(targetRange[0], targetRange[1]);
  const targetMax = Math.max(targetRange[0], targetRange[1]);
  const bandLeft = normalizeBandPosition(targetMin) * 100;
  const bandWidth =
    (normalizeBandPosition(targetMax) -
      normalizeBandPosition(targetMin)) *
    100;
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Target Volume</Text>
          <Text style={styles.mutedSmall}>
            Move into the pink band and hold steady.
          </Text>
        </View>
        <Text style={styles.targetRange}>
          {formatTargetRange(targetRange)}
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
        {liveDb > 0 && (
          <View
            style={[
              styles.marker,
              { left: `${currentPosition * 100}%` },
            ]}
          >
            <View style={styles.markerDot} />
            <View style={styles.markerStem} />
          </View>
        )}
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.scaleText}>30</Text>
        <Text style={styles.scaleText}>40</Text>
        <Text style={styles.scaleText}>55</Text>
        <Text style={styles.scaleText}>70 dB</Text>
      </View>
    </View>
  );
}

/* =========================================================
   LIVE VOICE HISTORY
   ========================================================= */
function StabilityHistory({
  history,
  targetRange,
}: {
  history: number[];
  targetRange: [number, number];
}) {
  const visibleHistory = history.slice(-30);
  const bars = Array.from({ length: 30 }, (_, index) => {
    return visibleHistory[index] ?? null;
  });
  const targetMin = Math.min(targetRange[0], targetRange[1]);
  const targetMax = Math.max(targetRange[0], targetRange[1]);
  const targetTop = (1 - normalizeBandPosition(targetMax)) * 100;
  const targetHeight =
    (normalizeBandPosition(targetMax) -
      normalizeBandPosition(targetMin)) *
    100;
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Your Live Voice</Text>
          <Text style={styles.mutedSmall}>
            Bars show your detected microphone level over time.
          </Text>
        </View>
        <Ionicons name="pulse-outline" size={22} color={ACCENT} />
      </View>
      <View style={styles.history}>
        <View
          style={[
            styles.historyTarget,
            {
              top: `${targetTop}%`,
              height: `${Math.max(targetHeight, 4)}%`,
            },
          ]}
        />
        <View style={styles.historyBars}>
          {history.length === 0 && (
            <View style={styles.historyEmpty}>
              <Text style={styles.historyEmptyText}>
                Sing on “Ah” to see your live voice track.
              </Text>
            </View>
          )}
          {bars.map((db, index) => {
            const position =
              db === null ? 0 : normalizeBandPosition(db);
            return (
              <View
                key={`bar-${index}`}
                style={[
                  styles.historyBar,
                  {
                    height:
                      db !== null && db > 0
                        ? `${Math.max(5, position * 90)}%`
                        : '0%',
                    opacity: db === null ? 0 : 1,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.scaleText}>Too soft</Text>
        <Text style={styles.targetRange}>TARGET BAND</Text>
        <Text style={styles.scaleText}>Too loud</Text>
      </View>
    </View>
  );
}
function ReferenceNoteButton({
  playing,
  onPress,
  label,
}: {
  playing: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      style={[styles.referenceButton, playing && styles.disabled]}
      disabled={playing}
      onPress={onPress}
    >
      <Ionicons
        name={playing ? 'volume-high' : 'play'}
        size={17}
        color={ACCENT}
      />
      <Text style={styles.referenceButtonText}>
        {playing ? 'Playing...' : label}
      </Text>
    </Pressable>
  );
}

/* =========================================================
   MAIN SCREEN
   ========================================================= */
export default function VolumeBandTargeting({
  tier: tierProp,
}: {
  tier?: Tier;
}) {
  const [phase, setPhase] = useState<Phase>('directions');
  const phaseRef = useRef<Phase>('directions');
  phaseRef.current = phase;
  const [resolvedTier, setResolvedTier] = useState<Tier>(
    tierProp ?? 'beginner',
  );
  const [params, setParams] = useState<VolumeBandTargetingParams>(
    VOLUME_BAND_TARGETING_PARAMS[tierProp ?? 'beginner'],
  );
  const paramsRef = useRef(params);
  const resolvedTierRef = useRef(resolvedTier);
  const [parametersReady, setParametersReady] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [countdown, setCountdown] = useState(
    PREPARATION_COUNTDOWN_SECONDS,
  );
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [referenceNote, setReferenceNote] = useState(() => createMusicalNote(60));
  const [referenceNoteReady, setReferenceNoteReady] = useState(false);
  const [liveFrame, setLiveFrame] = useState<LiveAudioFrame | null>(null);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [averageDb, setAverageDb] = useState(0);
  const [consistency, setConsistency] = useState(0);
  const [targetReached, setTargetReached] = useState(false);
  const [passed, setPassed] = useState(false);
  const [measurementQuality, setMeasurementQuality] = useState(0);
  const [repScores, setRepScores] = useState<number[]>([]);
  const [recordingNotice, setRecordingNotice] = useState<string | null>(
    null,
  );
  const [noVoiceDetected, setNoVoiceDetected] = useState(false);
  /**
   * The effective duration includes two extra seconds per repetition.
   * The tier's base duration remains unchanged.
   */
  const exerciseDurationSec =
    params.durationSec + REP_DURATION_EXTENSION_SEC;
  const totalDurationMs =
    exerciseDurationSec * params.repetitions * 1000;
  // Recording lifecycle guards.
  const finishingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const recordingFinishedRef = useRef(false);
  const shouldProcessResultRef = useRef(false);
  const cancelledRecordingRef = useRef(false);
  const voicedFrameCountRef = useRef(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);
  useEffect(() => {
    resolvedTierRef.current = resolvedTier;
  }, [resolvedTier]);
  /* ---------------------------------------------------------
     ADAPTIVE PARAMETER LOADING
     --------------------------------------------------------- */
  useEffect(() => {
    let active = true;
    const loadParameters = async () => {
      try {
        const user = auth.currentUser;
        let nextTier: Tier = tierProp ?? 'beginner';
        if (!tierProp && user) {
          const progress = await fetchComponentProgress(
            user.uid,
            'volume',
          );
          nextTier = progress?.currentTier ?? 'beginner';
        }
        let recentScores: number[] = [];
        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'volume',
          );
          recentScores = records
            .filter(
              (record) =>
                record.templateId === 'volumeBandTargeting' &&
                record.tier === nextTier,
            )
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-5)
            .map((record) => Number(record.scorePct))
            .filter(Number.isFinite);
        }
        /**
         * Use assessment results only when there are no completed
         * records for this exercise and tier.
         *
         * Assessment scores are not mixed into ongoing exercise history.
         */
        if (recentScores.length === 0 && user) {
          const assessment = await getLatestAssessment();
          const assessmentScore = assessment?.scores.find(
            (item) => item.componentId === 'volume',
          )?.scorePct;
          if (
            assessmentScore !== undefined &&
            Number.isFinite(Number(assessmentScore))
          ) {
            recentScores = [Number(assessmentScore)];
          }
        }
        const generated = generateVolumeBandTargetingParams({
          tier: nextTier,
          recentScores,
        });
        if (!active) return;
        setResolvedTier(nextTier);
        resolvedTierRef.current = nextTier;
        setParams(generated);
        paramsRef.current = generated;
        setParametersReady(true);
      } catch (error) {
        console.error('VOLUME BAND PARAMETER LOAD ERROR:', error);
        if (!active) return;
        const fallbackTier: Tier = tierProp ?? 'beginner';
        const fallbackParams =
          VOLUME_BAND_TARGETING_PARAMS[fallbackTier];
        setResolvedTier(fallbackTier);
        resolvedTierRef.current = fallbackTier;
        setParams(fallbackParams);
        paramsRef.current = fallbackParams;
        setParametersReady(true);
      }
    };
    void loadParameters();
    return () => {
      active = false;
    };
  }, [tierProp]);
  /* ---------------------------------------------------------
     REFERENCE NOTE
     --------------------------------------------------------- */
  useEffect(() => {
    let active = true;
    const loadReferenceNote = async () => {
      try {
        const assessment = await getLatestAssessment();
        const vocalRange = assessment?.vocalRange;
        const lowHz = Number(
          vocalRange?.lowHz ?? assessment?.vocalRangeLowHz,
        );
        const highHz = Number(
          vocalRange?.highHz ?? assessment?.vocalRangeHighHz,
        );
        if (
          Number.isFinite(lowHz) &&
          Number.isFinite(highHz) &&
          lowHz > 0 &&
          highHz > lowHz
        ) {
          const lowMidi = Math.ceil(69 + 12 * Math.log2(lowHz / 440));
          const highMidi = Math.floor(69 + 12 * Math.log2(highHz / 440));
          if (lowMidi <= highMidi) {
            const midpointHz = Math.sqrt(lowHz * highHz);
            const midpointMidi = Math.round(
              69 + 12 * Math.log2(midpointHz / 440),
            );
            const selectedMidi = clamp(midpointMidi, lowMidi, highMidi);
            if (active) {
              setReferenceNote(createMusicalNote(selectedMidi));
            }
          }
        }
      } catch (error) {
        console.error(
          'Unable to load assessed vocal range for reference note:',
          error,
        );
      } finally {
        if (active) {
          setReferenceNoteReady(true);
        }
      }
    };
    void loadReferenceNote();
    return () => {
      active = false;
    };
  }, []);
  const playReferenceNote = async (): Promise<boolean> => {
    if (referencePlaying) {
      return false;
    }
    try {
      setReferencePlaying(true);
      await playSingleNote(
        referenceNote.frequency,
        REFERENCE_NOTE_DURATION_SEC,
      );
      return true;
    } catch (error) {
      console.error('VOLUME BAND REFERENCE NOTE ERROR:', error);
      return false;
    } finally {
      setReferencePlaying(false);
    }
  };
  /* ---------------------------------------------------------
     AUDIO RECORDER
     --------------------------------------------------------- */
  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (
        phaseRef.current !== 'exercise' ||
        cancelledRecordingRef.current ||
        recordingFinishedRef.current
      ) {
        return;
      }
      if (!isUsableVoiceFrame(frame)) {
        setLiveFrame(null);
        // Record a gap so the history does not imply a continuous signal.
        setLiveHistory((previous) =>
          [...previous, 0].slice(-HISTORY_LIMIT),
        );
        return;
      }
      voicedFrameCountRef.current += 1;
      setLiveFrame(frame);
      const displayLevel = getLiveDisplayLevel(frame);
      setLiveHistory((previous) =>
        [...previous, displayLevel].slice(-HISTORY_LIMIT),
      );
    },
    onStop: (samples, sampleRate) => {
      if (recordingFinishedRef.current) {
        return;
      }
      recordingFinishedRef.current = true;
      recordingStartedAtRef.current = null;
      setLiveFrame(null);
      if (cancelledRecordingRef.current) {
        finishingRef.current = false;
        stopRequestedRef.current = false;
        shouldProcessResultRef.current = false;
        return;
      }
      if (!shouldProcessResultRef.current) {
        finishingRef.current = false;
        stopRequestedRef.current = false;
        setRecordingNotice(
          'The recording stopped before the exercise finished. Please try again.',
        );
        setPhase('directions');
        return;
      }
      shouldProcessResultRef.current = false;
      const currentParams = paramsRef.current;
      const currentExerciseDurationSec =
        currentParams.durationSec + REP_DURATION_EXTENSION_SEC;
      /**
       * Validate both the live input and the actual PCM recording.
       * Pitch detection is deliberately not required for volume scoring.
       */
      if (
        voicedFrameCountRef.current < MIN_VOICED_FRAMES ||
        !hasSufficientRecordedSignal(samples)
      ) {
        setNoVoiceDetected(true);
        setScore(0);
        setConsistency(0);
        setAverageDb(0);
        setTargetReached(false);
        setPassed(false);
        setMeasurementQuality(0);
        setRepScores(
          Array.from(
            { length: currentParams.repetitions },
            () => 0,
          ),
        );
        setLiveHistory([]);
        finishingRef.current = false;
        stopRequestedRef.current = false;
        setPhase('results');
        return;
      }
      try {
        const measurement = measureVolumeBandTargeting(
          samples,
          sampleRate,
          {
            windowMs: WINDOW_MS,
            targetDbRange: currentParams.targetDbRange,
            durationSec: currentExerciseDurationSec,
            repetitions: currentParams.repetitions,
            toleranceDb: currentParams.toleranceDb,
          },
        );
        const result = scoreVolumeBandTargeting(measurement, {
          passingScore: currentParams.consistencyThreshold,
        });
        setNoVoiceDetected(false);
        setScore(result.overallScore);
        setConsistency(result.consistency);
        setAverageDb(measurement.averageDb);
        setTargetReached(result.targetReached);
        setPassed(result.passed);
        setMeasurementQuality(result.measurementQuality);
        setRepScores(
          measurement.repConsistency.map((value) => Math.round(value)),
        );
        // Save completed attempts only after a usable recording is measured.
        void saveCompletedExercise(
          'volume',
          'volumeBandTargeting',
          resolvedTierRef.current,
          result.overallScore,
        ).catch((error) => {
          console.error(
            'VOLUME BAND PROGRESS SAVE ERROR:',
            error,
          );
        });
        setPhase('results');
      } catch (error) {
        console.error('VOLUME BAND MEASUREMENT ERROR:', error);
        setRecordingNotice(
          'The recording could not be measured. Please try the exercise again.',
        );
        setPhase('directions');
      } finally {
        setLiveFrame(null);
        setLiveHistory([]);
        recordingStartedAtRef.current = null;
        finishingRef.current = false;
        stopRequestedRef.current = false;
      }
    },
  });
  const stopRecordingRef = useRef(stopRecording);
  stopRecordingRef.current = stopRecording;
  /* ---------------------------------------------------------
     RECORDING DURATION TIMER
     --------------------------------------------------------- */
  useEffect(() => {
    if (phase !== 'exercise') return;
    const timer = setInterval(() => {
      const startedAt = recordingStartedAtRef.current;
      if (startedAt === null || finishingRef.current) {
        return;
      }
      const nextElapsed = Math.min(
        Date.now() - startedAt,
        totalDurationMs,
      );
      setElapsedMs(nextElapsed);
      if (
        nextElapsed >= totalDurationMs &&
        !stopRequestedRef.current
      ) {
        finishingRef.current = true;
        stopRequestedRef.current = true;
        shouldProcessResultRef.current = true;
        void (async () => {
          try {
            await stopRecordingRef.current();
          } catch (error) {
            console.error(
              'VOLUME BAND TARGETING STOP ERROR:',
              error,
            );
            shouldProcessResultRef.current = false;
            finishingRef.current = false;
            stopRequestedRef.current = false;
            recordingFinishedRef.current = false;
            recordingStartedAtRef.current = null;
            setRecordingNotice(
              'The recording could not be finalized. Please try again.',
            );
            setPhase('directions');
          }
        })();
      }
    }, 50);
    return () => clearInterval(timer);
  }, [phase, totalDurationMs]);
  /* ---------------------------------------------------------
     BEGIN RECORDING
     --------------------------------------------------------- */
  const beginRecording = async () => {
    finishingRef.current = false;
    stopRequestedRef.current = false;
    recordingFinishedRef.current = false;
    shouldProcessResultRef.current = false;
    cancelledRecordingRef.current = false;
    voicedFrameCountRef.current = 0;
    recordingStartedAtRef.current = null;
    try {
      await startRecording();
      // The user may have left the screen while the recorder was starting.
      if (cancelledRecordingRef.current) {
        if (!stopRequestedRef.current) {
          stopRequestedRef.current = true;
          void stopRecordingRef.current().catch((error) => {
            console.error(
              'VOLUME BAND CANCEL STOP ERROR:',
              error,
            );
          });
        }
        return;
      }
      recordingStartedAtRef.current = Date.now();
      setElapsedMs(0);
      setPhase('exercise');
    } catch (error) {
      console.error('VOLUME BAND TARGETING START ERROR:', error);
      recordingStartedAtRef.current = null;
      finishingRef.current = false;
      stopRequestedRef.current = false;
      recordingFinishedRef.current = false;
      shouldProcessResultRef.current = false;
      setRecordingNotice(
        'The microphone could not start. Please check microphone permission and try again.',
      );
      setPhase('directions');
    }
  };
  /* ---------------------------------------------------------
     START EXERCISE
     --------------------------------------------------------- */
  const startExercise = () => {
    if (
      !parametersReady ||
      referencePlaying ||
      isRecording ||
      phase === 'countdown' ||
      phase === 'exercise'
    ) {
      return;
    }
    setElapsedMs(0);
    setRecordingNotice(null);
    setNoVoiceDetected(false);
    shouldProcessResultRef.current = false;
    cancelledRecordingRef.current = false;
    voicedFrameCountRef.current = 0;
    recordingStartedAtRef.current = null;
    setCountdown(PREPARATION_COUNTDOWN_SECONDS);
    setLiveFrame(null);
    setLiveHistory([]);
    setScore(0);
    setAverageDb(0);
    setConsistency(0);
    setTargetReached(false);
    setPassed(false);
    setMeasurementQuality(0);
    setRepScores(
      Array.from({ length: params.repetitions }, () => 0),
    );
    finishingRef.current = false;
    stopRequestedRef.current = false;
    recordingFinishedRef.current = false;
    // Reference-note playback remains manual.
    setPhase('countdown');
  };
  /* ---------------------------------------------------------
     COUNTDOWN TIMER
     --------------------------------------------------------- */
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      void beginRecording();
      return;
    }
    const timeout = setTimeout(() => {
      setCountdown((previous) => Math.max(0, previous - 1));
    }, 1000);
    return () => clearTimeout(timeout);
  }, [phase, countdown]);
  /* ---------------------------------------------------------
     CANCEL / EXIT
     --------------------------------------------------------- */
  const cancelAndLeave = () => {
    cancelledRecordingRef.current = true;
    shouldProcessResultRef.current = false;
    finishingRef.current = true;
    recordingStartedAtRef.current = null;
    if (isRecording && !stopRequestedRef.current) {
      stopRequestedRef.current = true;
      void stopRecordingRef.current().catch((error) => {
        console.error(
          'VOLUME BAND CANCEL RECORDING ERROR:',
          error,
        );
      });
    }
    router.back();
  };
  /* ---------------------------------------------------------
     LIVE DISPLAY VALUES
     --------------------------------------------------------- */
  const currentRep = Math.min(
    params.repetitions,
    Math.floor(elapsedMs / (exerciseDurationSec * 1000)) + 1,
  );
  const currentRepElapsed =
    elapsedMs % (exerciseDurationSec * 1000);
  const progress = clamp(
    currentRepElapsed / (exerciseDurationSec * 1000),
    0,
    1,
  );
  const liveDb = getLiveDisplayLevel(liveFrame);
  const status = getLiveStatus(liveDb, params.targetDbRange);
  const statusColor = getStatusColor(status);
  const targetRangeText = formatTargetRange(params.targetDbRange);
  /* =========================================================
     PREPARING YOUR EXERCISE
     ========================================================= */
  if (!parametersReady || !referenceNoteReady) {
    return (
      <SafeAreaView style={styles.preparingScreen}>
        <View style={styles.preparingIconCircle}>
          <Ionicons name="options-outline" size={32} color={BROWN} />
        </View>
        <Text style={styles.preparingTitle}>Preparing Your Exercise</Text>
        <Text style={styles.preparingSubtitle}>
          Adjusting the exercise to your current difficulty level and preparing your vocal range.
        </Text>
        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.preparingSpinner}
        />
      </SafeAreaView>
    );
  }
  /* =========================================================
     DIRECTIONS
     ========================================================= */
  if (phase === 'directions') {
    const startDisabled =
      !parametersReady || referencePlaying || isRecording;
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.directionHeader}>
          <Pressable
            onPress={cancelAndLeave}
            hitSlop={12}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons
              name="arrow-back"
              size={23}
              color={BROWN}
            />
          </Pressable>
          <Text style={styles.directionHeaderText}>
            VOLUME CONTROL
          </Text>
          <View style={styles.backButtonPlaceholder} />
        </View>
        <ScrollView
          style={styles.directionsScroll}
          contentContainerStyle={styles.directionsScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.directionIntro}>
            <View style={styles.directionIcon}>
              <Ionicons
                name="options-outline"
                size={30}
                color={BROWN}
              />
            </View>
            <Text style={styles.directionTitle}>
              Volume Band Targeting
            </Text>
            <Text style={styles.directionSubtitle}>
              Practice keeping your voice within a target volume
              range while singing a reference note.
            </Text>
            <View style={styles.tierPill}>
              <Text style={styles.tierPillText}>
                {resolvedTier.toUpperCase()} LEVEL
              </Text>
            </View>
          </View>
          <View style={styles.directionCard}>
            <Text style={styles.directionCardTitle}>
              How to do the exercise
            </Text>
            {[
              {
                icon: 'musical-note-outline' as const,
                title: 'Listen to the reference note',
                description: `Play ${referenceNote.name} using the button below.`,
              },
              {
                icon: 'mic-outline' as const,
                title: 'Sing on “Ah”',
                description: `Match the ${referenceNote.name} note comfortably.`,
              },
              {
                icon: 'options-outline' as const,
                title: 'Control your volume',
                description: `Adjust your voice to stay inside the ${targetRangeText} target band.`,
              },
              {
                icon: 'timer-outline' as const,
                title: 'Hold your volume steady',
                description: `Continue for ${exerciseDurationSec} seconds per repetition.`,
              },
            ].map((step, index) => (
              <View
                key={step.title}
                style={styles.directionStep}
              >
                <View style={styles.directionStepIcon}>
                  <Ionicons
                    name={step.icon}
                    size={20}
                    color={ACCENT}
                  />
                </View>
                <View style={styles.directionStepContent}>
                  <Text style={styles.directionStepTitle}>
                    {index + 1}. {step.title}
                  </Text>
                  <Text style={styles.directionStepText}>
                    {step.description}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          <View style={styles.referenceCard}>
            <View style={styles.referenceTopRow}>
              <View>
                <Text style={styles.eyebrow}>
                  REFERENCE NOTE
                </Text>
                <Text style={styles.referenceNote}>
                  {referenceNote.name}
                </Text>
              </View>
              <View style={styles.referenceIconCircle}>
                <Ionicons
                  name="musical-note"
                  size={22}
                  color={BROWN}
                />
              </View>
            </View>
            <Text style={styles.referenceInstruction}>
              Play the note when needed, then sing it on “Ah” while
              controlling your volume.
            </Text>
            <ReferenceNoteButton
              playing={referencePlaying}
              label={`Play ${referenceNote.name}`}
              onPress={() => void playReferenceNote()}
            />
          </View>
          <TargetBandMeter
            liveDb={0}
            targetRange={params.targetDbRange}
          />
          <View style={styles.directionSummary}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                {exerciseDurationSec}s
              </Text>
              <Text style={styles.summaryLabel}>
                Per repetition
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                {params.repetitions}
              </Text>
              <Text style={styles.summaryLabel}>
                Repetitions
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                {params.consistencyThreshold}%
              </Text>
              <Text style={styles.summaryLabel}>
                Target score
              </Text>
            </View>
          </View>
          <Text style={styles.directionTip}>
            Tip: Don't chase the number. Find a comfortable
            loudness first, then make small adjustments to stay
            inside the band.
          </Text>
          <Text style={styles.directionDisclaimer}>
            The displayed volume is a relative microphone-level
            indicator. It is not calibrated acoustic dB SPL.
          </Text>
          {recordingNotice && (
            <View style={styles.directionError}>
              <Ionicons
                name="alert-circle-outline"
                size={19}
                color="#A05D6C"
              />
              <Text style={styles.directionErrorText}>
                {recordingNotice}
              </Text>
            </View>
          )}
        </ScrollView>
        <View style={styles.directionFooter}>
          <Pressable
            style={({ pressed }) => [
              styles.startExerciseButton,
              pressed && !startDisabled
                ? styles.startExercisePressed
                : null,
              startDisabled
                ? styles.startExerciseDisabled
                : null,
            ]}
            disabled={startDisabled}
            onPress={() => {
              console.log(
                '[VolumeBandTargeting] Start Exercise pressed',
              );
              startExercise();
            }}
            accessibilityRole="button"
            accessibilityLabel="Start Exercise"
            accessibilityState={{
              disabled: startDisabled,
            }}
          >
            {startDisabled ? (
              <ActivityIndicator
                size="small"
                color={BROWN}
              />
            ) : (
              <Ionicons
                name="play"
                size={19}
                color={WHITE}
              />
            )}
            <Text style={styles.startExerciseText}>
              {startDisabled
                ? referencePlaying
                  ? 'Reference Note Playing...'
                  : 'Preparing Exercise...'
                : 'Start Exercise'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
  /* =========================================================
     COUNTDOWN
     ========================================================= */
  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="musical-note-outline"
        title="Get Ready"
        countdown={countdown}
        promptTitle={`Prepare to sing ${referenceNote.name}.`}
        prompt={`Start singing on “Ah” when the countdown reaches zero. Keep your volume inside the ${targetRangeText} target band for ${exerciseDurationSec} seconds per repetition.`}
        onBack={cancelAndLeave}
      />
    );
  }
  /* =========================================================
     ACTIVE EXERCISE
     ========================================================= */
  if (phase === 'exercise') {
    return (
      <SafeAreaView style={styles.container}>
        <ExerciseListeningScreen
          icon="options-outline"
          title="Volume Band Targeting"
          currentRep={currentRep}
          repetitions={params.repetitions}
          elapsed={Math.floor(currentRepElapsed / 1000)}
          targetDuration={exerciseDurationSec}
          promptTitle="Hold the zone"
          prompt={`Sing ${referenceNote.name} on “Ah.” Move your volume into the ${targetRangeText} target band and keep it steady.`}
          progress={progress * 100}
          onBack={cancelAndLeave}
          liveContent={
            <View style={styles.liveContent}>
              <ReferenceNoteButton
                playing={referencePlaying}
                label={`Replay ${referenceNote.name}`}
                onPress={() => void playReferenceNote()}
              />
              <View
                style={[
                  styles.liveCard,
                  { borderColor: statusColor },
                ]}
              >
                <Text style={styles.eyebrow}>YOUR VOLUME</Text>
                <View style={styles.liveVolumeRow}>
                  <Text style={styles.liveVolume}>
                    {liveDb > 0 ? formatDb(liveDb) : '--'}
                  </Text>
                  <Text style={styles.liveUnit}>dB</Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: `${statusColor}18` },
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: statusColor },
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusText,
                      { color: statusColor },
                    ]}
                  >
                    {getStatusMessage(status)}
                  </Text>
                </View>
              </View>
              <TargetBandMeter
                liveDb={liveDb}
                targetRange={params.targetDbRange}
              />
              <StabilityHistory
                history={liveHistory}
                targetRange={params.targetDbRange}
              />
              {!isRecording && (
                <Text style={styles.waitingText}>
                  Starting microphone...
                </Text>
              )}
            </View>
          }
        />
      </SafeAreaView>
    );
  }
  /* =========================================================
     RESULTS
     ========================================================= */
  return (
    <SafeAreaView style={styles.container}>
      <ExerciseResultsScreen
        title="Volume Band Results"
        subtitle={
          noVoiceDetected
            ? `No usable singing signal was detected. No score was calculated or saved. Sing ${referenceNote.name} on “Ah” near the microphone, then try again.`
            : passed
              ? 'Nice control. You stayed inside the target band consistently.'
              : targetReached
                ? 'You reached the band. Now work on keeping the volume steadier.'
                : `Focus on finding and staying inside the ${targetRangeText} zone.`
        }
        score={noVoiceDetected ? 0 : score}
        scoreSuffix={noVoiceDetected ? 'NO INPUT' : '/100'}
        resultIcon={
          noVoiceDetected
            ? 'alert-circle-outline'
            : passed
              ? 'checkmark-circle'
              : 'refresh-circle'
        }
        scoreMessage={
          noVoiceDetected
            ? 'No score recorded'
            : passed
              ? 'Exercise passed'
              : 'Keep practicing'
        }
        scoreDetails={
          <View style={styles.resultCard}>
            {repScores.map((repScore, index) => (
              <View key={`rep-${index}`} style={styles.resultRow}>
                <Text style={styles.resultLabel}>
                  Repetition {index + 1}
                </Text>
                <Text style={styles.resultValue}>
                  {noVoiceDetected ? '—' : `${repScore}%`}
                </Text>
              </View>
            ))}
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Average Volume</Text>
              <Text style={styles.resultValue}>
                {noVoiceDetected
                  ? 'No input'
                  : `${formatDb(averageDb)} dB`}
              </Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Target Band</Text>
              <Text style={styles.resultValue}>
                {targetRangeText}
              </Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Consistency</Text>
              <Text style={styles.resultValue}>
                {noVoiceDetected ? '—' : `${consistency}%`}
              </Text>
            </View>
            <View style={[styles.resultRow, styles.lastResultRow]}>
              <Text style={styles.resultLabel}>Band Compliance</Text>
              <Text style={styles.resultValue}>
                {noVoiceDetected
                  ? 'No input'
                  : targetReached
                    ? 'Inside ✓'
                    : 'Outside'}
              </Text>
            </View>
            <View style={styles.qualityCard}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>
                  Measurement quality
                </Text>
                <Text style={styles.mutedSmall}>
                  {noVoiceDetected
                    ? 'No usable microphone signal was detected. This attempt was not scored or saved.'
                    : `${measurementQuality}% of expected audio windows were available.`}
                </Text>
              </View>
              <Text style={styles.targetRange}>
                {noVoiceDetected ? '—' : `${measurementQuality}%`}
              </Text>
            </View>
          </View>
        }
        onRetry={startExercise}
        onExit={() => router.back()}
      >
        {passed && !noVoiceDetected && (
          <Pressable
            style={styles.nextButton}
            onPress={() => router.replace('/exercises/volume' as any)}
          >
            <Ionicons
              name="arrow-forward"
              size={18}
              color={ACCENT}
            />
            <Text style={styles.nextButtonText}>
              Next Exercise
            </Text>
          </Pressable>
        )}
      </ExerciseResultsScreen>
    </SafeAreaView>
  );
}

/* =========================================================
   STYLES
   ========================================================= */
const styles = StyleSheet.create({
    directionHeader: {
    minHeight: 54,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: WHITE,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonPlaceholder: {
    width: 40,
    height: 40,
  },
  directionHeaderText: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  directionsScroll: {
    flex: 1,
  },
  directionsScrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
  },
  directionIntro: {
    alignItems: 'center',
    marginBottom: 8,
  },
  directionIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  directionTitle: {
    color: BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 23,
    textAlign: 'center',
  },
  directionSubtitle: {
    marginTop: 6,
    maxWidth: 320,
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  tierPill: {
    marginTop: 12,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
  },
  tierPillText: {
    color: ACCENT,
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.6,
  },
  directionCard: {
    marginTop: 12,
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
  },
  directionCardTitle: {
    marginBottom: 12,
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
  },
  directionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 10,
    gap: 11,
  },
  directionStepIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionStepContent: {
    flex: 1,
    paddingTop: 2,
  },
  directionStepTitle: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
  },
  directionStepText: {
    marginTop: 3,
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
  },
  directionSummary: {
    marginTop: 14,
    paddingVertical: 15,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 17,
    backgroundColor: LIGHT_PINK,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    color: BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 17,
  },
  summaryLabel: {
    marginTop: 3,
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    textAlign: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: BORDER,
  },
  directionTip: {
    marginTop: 14,
    color: SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
  },
  directionDisclaimer: {
    marginTop: 10,
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
  },
  directionError: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: LIGHT_PINK,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  directionErrorText: {
    flex: 1,
    color: '#A05D6C',
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
  },
  directionFooter: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: WHITE,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  startExerciseButton: {
    minHeight: 54,
    borderRadius: 18,
    paddingHorizontal: 18,
    backgroundColor: ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  startExercisePressed: {
    opacity: 0.8,
    transform: [{ scale: 0.99 }],
  },
  startExerciseDisabled: {
    backgroundColor: PINK,
    opacity: 0.75,
  },
  startExerciseText: {
    color: WHITE,
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
  },
  preparingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  preparingIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  preparingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 285,
  },
  preparingSpinner: {
    marginTop: 24,
  },
  container: {
    flex: 1,
    backgroundColor: WHITE,
  },
  flex: {
    flex: 1,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  mutedSmall: {
    marginTop: 4,
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
  },
  card: {
    marginTop: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardTitle: {
    color: DARK,
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
  },
  targetRange: {
    color: ACCENT,
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
  },
  meter: {
    position: 'relative',
    height: 42,
    marginTop: 14,
    marginBottom: 8,
    borderRadius: 22,
    backgroundColor: '#F5E9EC',
    overflow: 'hidden',
  },
  targetBand: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    borderRadius: 20,
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
  scaleText: {
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 9,
  },
  history: {
    position: 'relative',
    height: 125,
    marginTop: 12,
    marginBottom: 7,
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
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
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
  historyEmpty: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  historyEmptyText: {
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  referenceCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },
  referenceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: MUTED,
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  referenceNote: {
    marginTop: 2,
    color: BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 30,
  },
  referenceIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  referenceInstruction: {
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 21,
  },
  referenceButton: {
    marginTop: 2,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  referenceButtonText: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
  },
  disabled: {
    opacity: 0.65,
  },
  liveContent: {
    width: '100%',
    paddingBottom: 12,
  },
  liveCard: {
    marginTop: 12,
    padding: 15,
    borderRadius: 22,
    backgroundColor: LIGHT_PINK,
    borderWidth: 2,
    alignItems: 'center',
  },
  liveVolumeRow: {
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  liveVolume: {
    color: DARK,
    fontFamily: 'FredokaBold',
    fontSize: 46,
    lineHeight: 52,
    includeFontPadding: false,
  },
  liveUnit: {
    marginLeft: 6,
    color: MUTED,
    fontFamily: 'FredokaSemiBold',
    fontSize: 16,
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
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
  },
  resultCard: {
    width: '100%',
    paddingHorizontal: 15,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  resultRow: {
    minHeight: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F4E9EC',
    gap: 12,
  },
  lastResultRow: {
    borderBottomWidth: 0,
  },
  resultLabel: {
    color: SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
  },
  resultValue: {
    color: DARK,
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
  },
  qualityCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 15,
    backgroundColor: LIGHT_PINK,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nextButton: {
    minHeight: 50,
    marginTop: 12,
    paddingHorizontal: 18,
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  nextButtonText: {
    color: ACCENT,
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
  },
  waitingText: {
    marginTop: 10,
    textAlign: 'center',
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
  },
});
