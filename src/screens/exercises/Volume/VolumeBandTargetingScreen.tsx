import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  VOLUME_BAND_TARGETING_PARAMS,
  type Tier,
  type VolumeBandTargetingParams,
} from '@/constants/exercises/volume';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
  ExerciseCountdownScreen,
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

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const BORDER = '#F2DDE5';
const DARK_PINK = '#D86C89';
const SOFT_TEXT = '#765D63';
const GUIDE_GREEN = '#278451';
const GUIDE_RED = '#A05D6C';

const DEFAULT_TIER: Tier = 'beginner';
const REFERENCE_NOTE_DURATION_SEC = 1.5;
const PREPARATION_COUNTDOWN_SECONDS = 3;
const HISTORY_LIMIT = 60;
const WINDOW_MS = 50;
const REP_DURATION_EXTENSION_SEC = 2;
const MIN_VOICED_FRAMES = 8;
const MIN_LIVE_INPUT_DBFS = -60;
const LIVE_LEVEL_OFFSET = 70;

type Phase = 'directions' | 'countdown' | 'exercise' | 'results';
type VoiceStatus = 'low' | 'inside' | 'high' | 'none';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatDb(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : '--';
}

function formatTargetRange(targetRange: [number, number]): string {
  const min = Math.round(Math.min(targetRange[0], targetRange[1]));
  const max = Math.round(Math.max(targetRange[0], targetRange[1]));

  return `${min} → ${max} dB`;
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
      return DARK_PINK;
    case 'low':
      return '#8D7A7D';
    case 'high':
      return GUIDE_RED;
    default:
      return MUTED;
  }
}

function isUsableVoiceFrame(
  frame: LiveAudioFrame | null | undefined,
): frame is LiveAudioFrame {
  return Boolean(
    frame &&
      Number.isFinite(frame.volume) &&
      frame.volume > MIN_LIVE_INPUT_DBFS,
  );
}

function getLiveDisplayLevel(
  frame: LiveAudioFrame | null | undefined,
): number {
  if (!isUsableVoiceFrame(frame)) {
    return 0;
  }

  return clamp(frame.volume + LIVE_LEVEL_OFFSET, 0, 70);
}

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

  const status = getLiveStatus(liveDb, targetRange);
  const statusColor = getStatusColor(status);

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Target Volume</Text>
          <Text style={styles.mutedSmall}>
            Adjust your voice to reach the pink band.
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
            <View
              style={[
                styles.markerDot,
                { backgroundColor: statusColor },
              ]}
            />
            <View
              style={[
                styles.markerStem,
                { backgroundColor: statusColor },
              ]}
            />
          </View>
        )}
      </View>

      <View style={styles.rowBetween}>
        <Text style={styles.scaleText}>30</Text>
        <Text style={styles.scaleText}>40</Text>
        <Text style={styles.scaleText}>55</Text>
        <Text style={styles.scaleText}>70</Text>
      </View>

      <View style={styles.bandGuide}>
        <View style={styles.guideItem}>
          <View
            style={[
              styles.guideDot,
              { backgroundColor: '#8D7A7D' },
            ]}
          />
          <Text style={styles.guideText}>Too soft</Text>
        </View>

        <View style={styles.guideItem}>
          <View
            style={[
              styles.guideDot,
              { backgroundColor: DARK_PINK },
            ]}
          />
          <Text style={styles.guideText}>Target band</Text>
        </View>

        <View style={styles.guideItem}>
          <View
            style={[
              styles.guideDot,
              { backgroundColor: GUIDE_RED },
            ]}
          />
          <Text style={styles.guideText}>Too loud</Text>
        </View>
      </View>

      <Text style={[styles.bandStatus, { color: statusColor }]}>
        {getStatusMessage(status)}
      </Text>
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
  const visibleHistory = history.slice(-30);
  const bars = Array.from(
    { length: 30 },
    (_, index) => visibleHistory[index] ?? null,
  );

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

        <Ionicons name="pulse-outline" size={22} color={DARK_PINK} />
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
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: playing }}
    >
      <Ionicons
        name={playing ? 'volume-high' : 'play'}
        size={17}
        color={BROWN}
      />

      <Text style={styles.referenceButtonText}>
        {playing ? 'Playing...' : label}
      </Text>
    </Pressable>
  );
}

export default function VolumeBandTargeting({
  tier: tierProp,
}: {
  tier?: Tier;
}) {
  const [phase, setPhase] = useState<Phase>('directions');
  const phaseRef = useRef<Phase>('directions');

  phaseRef.current = phase;

  const [resolvedTier, setResolvedTier] = useState<Tier>(
    tierProp ?? DEFAULT_TIER,
  );

  const [params, setParams] = useState<VolumeBandTargetingParams>(
    VOLUME_BAND_TARGETING_PARAMS[tierProp ?? DEFAULT_TIER],
  );

  const paramsRef = useRef(params);
  const resolvedTierRef = useRef(resolvedTier);

  const [parametersReady, setParametersReady] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [countdown, setCountdown] = useState(
    PREPARATION_COUNTDOWN_SECONDS,
  );

  const [referencePlaying, setReferencePlaying] = useState(false);
  const [referencePlaybackError, setReferencePlaybackError] =
    useState<string | null>(null);
  const [hasPlayedReference, setHasPlayedReference] = useState(false);
  const [referenceNote, setReferenceNote] = useState(() =>
    createMusicalNote(60),
  );
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

  // Quit-modal state and refs.
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);

  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('directions');
  const pauseStopPendingRef = useRef(false);

  const exerciseDurationSec =
    params.durationSec + REP_DURATION_EXTENSION_SEC;
  const totalDurationMs =
    exerciseDurationSec * params.repetitions * 1000;

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

  useEffect(() => {
    let active = true;

    const loadParameters = async () => {
      try {
        const user = auth.currentUser;
        let nextTier: Tier = tierProp ?? DEFAULT_TIER;

        if (!tierProp && user) {
          const progress = await fetchComponentProgress(
            user.uid,
            'volume',
          );

          nextTier = progress?.currentTier ?? DEFAULT_TIER;
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

        const fallbackTier: Tier = tierProp ?? DEFAULT_TIER;
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
          const lowMidi = Math.ceil(
            69 + 12 * Math.log2(lowHz / 440),
          );
          const highMidi = Math.floor(
            69 + 12 * Math.log2(highHz / 440),
          );

          if (lowMidi <= highMidi) {
            const midpointHz = Math.sqrt(lowHz * highHz);
            const midpointMidi = Math.round(
              69 + 12 * Math.log2(midpointHz / 440),
            );
            const selectedMidi = clamp(
              midpointMidi,
              lowMidi,
              highMidi,
            );

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
    if (referencePlaying) return false;

    setReferencePlaybackError(null);

    const noteWithFrequency = referenceNote as typeof referenceNote & {
      frequencyHz?: number;
    };

    const frequency = Number(
      noteWithFrequency.frequency ??
        noteWithFrequency.frequencyHz,
    );

    if (!Number.isFinite(frequency) || frequency <= 0) {
      setHasPlayedReference(false);
      setReferencePlaybackError(
        'The reference note has an invalid frequency. Please reload the exercise.',
      );
      return false;
    }

    try {
      setReferencePlaying(true);

      await playSingleNote(
        frequency,
        REFERENCE_NOTE_DURATION_SEC,
      );

      setHasPlayedReference(true);
      return true;
    } catch (error) {
      console.error(
        '[VolumeBandTargeting] REFERENCE NOTE PLAYBACK ERROR:',
        error,
      );

      setHasPlayedReference(false);
      setReferencePlaybackError(
        'The note could not be played. Check your device media volume and try again.',
      );

      return false;
    } finally {
      setReferencePlaying(false);
    }
  };

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (
        phaseRef.current !== 'exercise' ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        cancelledRecordingRef.current ||
        recordingFinishedRef.current
      ) {
        return;
      }

      if (!isUsableVoiceFrame(frame)) {
        setLiveFrame(null);
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
      if (recordingFinishedRef.current) return;

      recordingFinishedRef.current = true;
      recordingStartedAtRef.current = null;
      setLiveFrame(null);

      // An interrupted recording must never be scored or saved.
      if (
        cancelledRecordingRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
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
          measurement.repConsistency.map((value) =>
            Math.round(value),
          ),
        );

        void saveCompletedExercise(
          'volume',
          'volumeBandTargeting',
          resolvedTierRef.current,
          result.overallScore,
        ).catch((error) => {
          console.error('VOLUME BAND PROGRESS SAVE ERROR:', error);
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

  /**
   * Opens the quit modal and safely interrupts an active recording.
   * This exercise records all repetitions as one continuous recording,
   * so an interrupted attempt restarts from the countdown.
   */
  const pauseForExitPrompt = () => {
    if (
      quitInProgressRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    pausedPhaseRef.current = phaseRef.current;
    pausedRef.current = true;
    showQuitModalRef.current = true;

    setShowQuitModal(true);
    setIsQuitting(false);
    setIsPausing(false);

    if (
      phaseRef.current === 'exercise' &&
      (isRecording || recordingStartedAtRef.current !== null)
    ) {
      cancelledRecordingRef.current = true;
      shouldProcessResultRef.current = false;
      finishingRef.current = true;
      recordingStartedAtRef.current = null;

      setLiveFrame(null);
      setLiveHistory([]);

      if (!stopRequestedRef.current) {
        stopRequestedRef.current = true;
        pauseStopPendingRef.current = true;
        setIsPausing(true);

        void (async () => {
          try {
            await stopRecordingRef.current();
          } catch (error) {
            console.error(
              'VOLUME BAND PAUSE RECORDING ERROR:',
              error,
            );
          } finally {
            pauseStopPendingRef.current = false;
            setIsPausing(false);
          }
        })();
      }
    }
  };

  /**
   * Closes the modal and returns to the previous phase.
   * If recording was interrupted, restart this exercise from the countdown.
   */
  const continueExercise = () => {
    if (
      isQuitting ||
      quitInProgressRef.current ||
      pauseStopPendingRef.current
    ) {
      return;
    }

    const previousPhase = pausedPhaseRef.current;

    showQuitModalRef.current = false;
    pausedRef.current = false;
    setShowQuitModal(false);

    if (previousPhase === 'exercise') {
      // Reset recording refs before restarting the full attempt.
      finishingRef.current = false;
      stopRequestedRef.current = false;
      recordingFinishedRef.current = false;
      shouldProcessResultRef.current = false;
      cancelledRecordingRef.current = false;
      voicedFrameCountRef.current = 0;
      recordingStartedAtRef.current = null;

      setElapsedMs(0);
      setCountdown(PREPARATION_COUNTDOWN_SECONDS);
      setLiveFrame(null);
      setLiveHistory([]);
      setRecordingNotice(null);
      setNoVoiceDetected(false);

      setScore(0);
      setAverageDb(0);
      setConsistency(0);
      setTargetReached(false);
      setPassed(false);
      setMeasurementQuality(0);
      setRepScores(
        Array.from({ length: paramsRef.current.repetitions }, () => 0),
      );

      setPhase('countdown');
      return;
    }

    // Countdown resumes from its current count; other phases stay unchanged.
    setPhase(previousPhase);
  };

  /**
   * Quits the exercise and returns to the exercise dashboard.
   */
  const quitExercise = async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    cancelledRecordingRef.current = true;
    shouldProcessResultRef.current = false;
    recordingStartedAtRef.current = null;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    setIsQuitting(true);

    try {
      if (isRecording && !stopRequestedRef.current) {
        stopRequestedRef.current = true;

        try {
          await stopRecordingRef.current();
        } catch (error) {
          console.error(
            'VOLUME BAND QUIT RECORDING ERROR:',
            error,
          );
        }
      }
    } finally {
      router.replace('/dashboard?tab=exercises');
    }
  };

  // Android hardware back opens the same quit modal.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) {
          return true;
        }

        pauseForExitPrompt();
        return true;
      },
    );

    return () => subscription.remove();
  }, [isRecording]);

  useEffect(() => {
    if (phase !== 'exercise') return;

    const timer = setInterval(() => {
      if (
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      const startedAt = recordingStartedAtRef.current;

      if (startedAt === null || finishingRef.current) return;

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

  const beginRecording = async () => {
    if (
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    finishingRef.current = false;
    stopRequestedRef.current = false;
    recordingFinishedRef.current = false;
    shouldProcessResultRef.current = false;
    cancelledRecordingRef.current = false;
    voicedFrameCountRef.current = 0;
    recordingStartedAtRef.current = null;

    try {
      await startRecording();

      if (
        cancelledRecordingRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        if (!stopRequestedRef.current) {
          stopRequestedRef.current = true;

          void stopRecordingRef.current().catch((error) => {
            console.error('VOLUME BAND CANCEL STOP ERROR:', error);
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

      if (!quitInProgressRef.current) {
        setRecordingNotice(
          'The microphone could not start. Please check microphone permission and try again.',
        );
        setPhase('directions');
      }
    }
  };

  const startExercise = () => {
    if (
      !parametersReady ||
      isRecording ||
      phase === 'countdown' ||
      phase === 'exercise' ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    setElapsedMs(0);
    setRecordingNotice(null);
    setReferencePlaybackError(null);
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

    pausedRef.current = false;
    setPhase('countdown');
  };

  useEffect(() => {
    if (
      phase !== 'countdown' ||
      pausedRef.current ||
      showQuitModal ||
      quitInProgressRef.current
    ) {
      return;
    }

    if (countdown <= 0) {
      void beginRecording();
      return;
    }

    const timeout = setTimeout(() => {
      setCountdown((previous) => Math.max(0, previous - 1));
    }, 1000);

    return () => clearTimeout(timeout);
  }, [phase, countdown, showQuitModal]);

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
  const targetRangeText = formatTargetRange(params.targetDbRange);

  // Shared quit modal UI, used on every phase of this screen.
  const quitModal = (
    <Modal
      visible={showQuitModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={continueExercise}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}>
            <Ionicons
              name="exit-outline"
              size={30}
              color={BROWN}
            />
          </View>

          <Text style={styles.modalTitle}>Quit exercise?</Text>

          <Text style={styles.modalMessage}>
            {pausedPhaseRef.current === 'exercise'
              ? 'Your recording has been stopped. If you continue, this exercise will restart from the countdown.'
              : pausedPhaseRef.current === 'countdown'
                ? 'Your exercise is paused. Continue when you are ready to start the countdown again.'
                : 'Are you sure you want to leave Volume Band Targeting?'}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            disabled={isQuitting || isPausing}
            onPress={continueExercise}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.buttonPressed,
              (isQuitting || isPausing) && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.continueButtonText}>
              {isPausing ? 'Pausing...' : 'Continue Exercise'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
            disabled={isQuitting}
            onPress={() => {
              void quitExercise();
            }}
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.buttonPressed,
              isQuitting && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.quitButtonText}>
              {isQuitting ? 'Stopping...' : 'Quit Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  if (!parametersReady || !referenceNoteReady) {
    return (
      <>
        {quitModal}

        <SafeAreaView style={styles.preparingScreen}>
          <View style={styles.preparingIconCircle}>
            <Ionicons
              name="options-outline"
              size={44}
              color={BROWN}
            />
          </View>

          <Text style={styles.preparingTitle}>
            Preparing Your Exercise
          </Text>

          <Text style={styles.preparingSubtitle}>
            Adjusting the exercise to your current difficulty level and
            preparing your vocal range.
          </Text>

          <ActivityIndicator
            size="large"
            color={BROWN}
            style={styles.spinner}
          />
        </SafeAreaView>
      </>
    );
  }

  if (phase === 'directions') {
    const startDisabled = !parametersReady || isRecording;

    return (
      <>
        {quitModal}

        <SafeAreaView style={styles.safeArea}>
          <ExerciseScreen
            title="Volume Band Targeting"
            category="VOLUME CONTROL"
            icon="options-outline"
            instructions={`Listen to the ${referenceNote.name} reference note, sing it on “Ah,” and keep your voice within the target volume band.`}
            preparationSteps={[
              {
                icon: 'musical-note-outline',
                text: `Play the ${referenceNote.name} reference note and listen carefully.`,
              },
              {
                icon: 'mic-outline',
                text: 'Take a comfortable breath before singing.',
              },
              {
                icon: 'options-outline',
                text: `Adjust your voice to stay within ${targetRangeText}.`,
              },
              {
                icon: 'timer-outline',
                text: `Hold the target volume for ${exerciseDurationSec} seconds per repetition.`,
              },
            ]}
            summary={[
              {
                label: 'Duration',
                value: `${exerciseDurationSec} sec`,
                hint: 'per repetition',
              },
              {
                label: 'Repetitions',
                value: String(params.repetitions),
              },
              {
                label: 'Target score',
                value: `${Math.round(params.consistencyThreshold)}%`,
              },
            ]}
            targetValue={targetRangeText}
            targetHint="Move your voice into the pink band and keep the volume steady."
            repetitions={params.repetitions}
            tip="Don't chase the number. Find a comfortable loudness first, then make small adjustments to stay inside the band."
            tier={resolvedTier}
            onBack={pauseForExitPrompt}
            onStart={startExercise}
            startDisabled={startDisabled}
            startLabel={
              isRecording
                ? 'Preparing Exercise...'
                : 'Start Exercise'
            }
            error={referencePlaybackError ?? recordingNotice ?? undefined}
          >
            <View style={styles.referenceCard}>
              <View style={styles.referenceTopRow}>
                <View style={styles.referenceCopy}>
                  <Text style={styles.eyebrow}>REFERENCE NOTE</Text>
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
                Play the note, then sing it on “Ah” while adjusting your
                volume to stay inside the target band.
              </Text>

              <ReferenceNoteButton
                playing={referencePlaying}
                label={`Play ${referenceNote.name}`}
                onPress={() => void playReferenceNote()}
              />

              {hasPlayedReference && (
                <View style={styles.referenceReadyRow}>
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color={GUIDE_GREEN}
                  />
                  <Text style={styles.referenceReadyText}>
                    Reference note played. You’re ready to begin.
                  </Text>
                </View>
              )}
            </View>

            <TargetBandMeter
              liveDb={0}
              targetRange={params.targetDbRange}
            />

            <View style={styles.infoCard}>
              <View style={styles.infoHeader}>
                <View style={styles.infoIconCircle}>
                  <Ionicons
                    name="information-circle-outline"
                    size={19}
                    color={DARK_PINK}
                  />
                </View>

                <Text style={styles.infoTitle}>What to focus on</Text>
              </View>

              <Text style={styles.infoText}>
                This exercise evaluates how consistently your detected
                microphone level stays within a target range. The displayed
                level is a relative audio indicator, not a calibrated
                sound-pressure measurement.
              </Text>
            </View>
          </ExerciseScreen>
        </SafeAreaView>
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        {quitModal}

        <SafeAreaView style={styles.safeArea}>
          <ExerciseCountdownScreen
            icon="musical-note-outline"
            title="Get Ready"
            countdown={countdown}
            promptTitle={`Prepare to sing ${referenceNote.name}.`}
            prompt={`Start singing on “Ah” when the countdown reaches zero. Keep your volume inside the ${targetRangeText} target band for ${exerciseDurationSec} seconds per repetition.`}
            onBack={pauseForExitPrompt}
          />
        </SafeAreaView>
      </>
    );
  }

  if (phase === 'exercise') {
    return (
      <>
        {quitModal}

        <SafeAreaView style={styles.safeArea}>
          <View style={styles.exerciseScreen}>
            <View style={styles.activeHeader}>
              <View style={styles.activeHeaderCopy}>
                <Text style={styles.activeTitle}>
                  Volume Band Targeting
                </Text>
                <Text style={styles.activeCategory}>
                  VOLUME CONTROL
                </Text>
              </View>
            </View>

            <View style={styles.activePromptBlock}>
              <Text style={styles.activePromptTitle}>Hold the zone</Text>
              <Text style={styles.activePrompt}>
                Sing {referenceNote.name} on “Ah”. Adjust your voice to
                reach the {targetRangeText} target band and keep it steady.
              </Text>
            </View>

            <ScrollView
              style={styles.activeScroll}
              contentContainerStyle={styles.liveContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              <TargetBandMeter
                liveDb={liveDb}
                targetRange={params.targetDbRange}
              />

              <StabilityHistory
                history={liveHistory}
                targetRange={params.targetDbRange}
              />

              <View style={styles.bottomRepCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.repLabel}>Repetition</Text>
                  <Text style={styles.repValue}>
                    {currentRep} of {params.repetitions}
                  </Text>
                </View>

                <View style={styles.repTrack}>
                  <View
                    style={[
                      styles.repProgress,
                      { width: `${progress * 100}%` },
                    ]}
                  />
                </View>

                <View style={styles.rowBetween}>
                  <Text style={styles.mutedSmall}>
                    Keep your volume steady
                  </Text>
                  <Text style={styles.repTimer}>
                    {Math.max(
                      0,
                      exerciseDurationSec -
                        Math.floor(currentRepElapsed / 1000),
                    )}
                    s left
                  </Text>
                </View>
              </View>

              {!isRecording && (
                <Text style={styles.waitingText}>
                  Starting microphone...
                </Text>
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      {quitModal}

      <SafeAreaView style={styles.safeArea}>
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

              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Band Compliance</Text>
                <Text style={styles.resultValue}>
                  {noVoiceDetected
                    ? 'No input'
                    : targetReached
                      ? 'Inside ✓'
                      : 'Outside'}
                </Text>
              </View>

              <View style={[styles.resultRow, styles.lastResultRow]}>
                <View style={styles.flex}>
                  <Text style={styles.resultLabel}>
                    Measurement quality
                  </Text>
                  <Text style={styles.mutedSmall}>
                    {noVoiceDetected
                      ? 'No usable microphone signal was detected. This attempt was not scored or saved.'
                      : `${measurementQuality}% of expected audio windows were available.`}
                  </Text>
                </View>

                <Text style={styles.resultValue}>
                  {noVoiceDetected ? '—' : `${measurementQuality}%`}
                </Text>
              </View>
            </View>
          }
          onRetry={startExercise}
          onExit={pauseForExitPrompt}
        >
          <></>
        </ExerciseResultsScreen>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: WHITE,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
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
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },
  preparingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },
  referenceCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 9,
  },
  referenceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  referenceCopy: {
    flex: 1,
  },
  eyebrow: {
    color: MUTED,
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.7,
  },
  referenceNote: {
    marginTop: 2,
    color: BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 29,
  },
  referenceIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  referenceInstruction: {
    color: SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
  },
  referenceButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  referenceButtonText: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
  },
  referenceReadyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  referenceReadyText: {
    flex: 1,
    color: GUIDE_GREEN,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
  },
  disabled: {
    opacity: 0.6,
  },
  exerciseScreen: {
    position: 'absolute',
    top: 90,
    right: 8,
    bottom: 0,
    left: 8,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: WHITE,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  activeHeader: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  activeHeaderCopy: {
    position: 'absolute',
    left: 50,
    right: 50,
    alignItems: 'center',
  },
  activeCategory: {
    color: DARK_PINK,
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  activeTitle: {
    marginTop: 2,
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 17,
    textAlign: 'center',
  },
  activePromptBlock: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
  },
  activePromptTitle: {
    color: BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 20,
    textAlign: 'center',
  },
  activePrompt: {
    marginTop: 4,
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 4,
  },
  activeScroll: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
  liveContent: {
    paddingBottom: 12,
  },
  bottomRepCard: {
    marginTop: 12,
    marginBottom: 8,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: LIGHT_PINK,
    gap: 9,
  },
  repLabel: {
    color: SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
  },
  repValue: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
  },
  repTrack: {
    height: 7,
    borderRadius: 5,
    backgroundColor: '#F1E3E7',
    overflow: 'hidden',
  },
  repProgress: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: DARK_PINK,
  },
  repTimer: {
    color: DARK_PINK,
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
  },
  infoCard: {
    marginTop: 12,
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: LIGHT_PINK,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHITE,
  },
  infoTitle: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
  },
  infoText: {
    marginTop: 8,
    color: SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
  },
  mutedSmall: {
    marginTop: 3,
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
  },
  card: {
    marginTop: 12,
    padding: 13,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardTitle: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
  },
  targetRange: {
    color: DARK_PINK,
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
  },
  meter: {
    position: 'relative',
    height: 38,
    marginTop: 13,
    marginBottom: 7,
    borderRadius: 20,
    backgroundColor: '#F5E9EC',
    overflow: 'hidden',
  },
  targetBand: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    borderRadius: 18,
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
    marginTop: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: DARK_PINK,
  },
  markerStem: {
    flex: 1,
    width: 3,
    backgroundColor: DARK_PINK,
  },
  scaleText: {
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 9,
  },
  bandGuide: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    gap: 5,
  },
  guideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  guideDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  guideText: {
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
  },
  bandStatus: {
    marginTop: 10,
    textAlign: 'center',
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
  },
  history: {
    position: 'relative',
    height: 115,
    marginTop: 11,
    marginBottom: 7,
    borderRadius: 14,
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
    backgroundColor: DARK_PINK,
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
  waitingText: {
    marginTop: 10,
    textAlign: 'center',
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
  },
  resultCard: {
    width: '100%',
    paddingHorizontal: 13,
    paddingVertical: 3,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  resultRow: {
    minHeight: 42,
    paddingVertical: 7,
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
    flex: 1,
    color: SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
  },
  resultValue: {
    flexShrink: 1,
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    textAlign: 'right',
  },

  // Quit modal styling.
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 24,
    backgroundColor: WHITE,
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
    marginBottom: 15,
  },
  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
    textAlign: 'center',
  },
  modalMessage: {
    marginTop: 10,
    marginBottom: 23,
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: MUTED,
    textAlign: 'center',
  },
  continueButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: PINK,
  },
  continueButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
  quitButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
  },
  quitButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: MUTED,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});