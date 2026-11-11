import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  VOLUME_BAND_TARGETING_PARAMS,
  type Tier,
  type VolumeBandTargetingParams,
} from '@/constants/params';
import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
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
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import { playSingleNote } from '@/utils/music/notePlayer';
import {
  createMusicalNote,
  frequencyToMidi,
} from '@/utils/music/notes';

import {
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
  EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
  VOLUME_ANALYSIS_WINDOW_MS,
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { clamp } from '@/utils/math';

import {
  ExerciseNoAudioModal,
  ExerciseQuitModal,
} from '@/components/ExerciseModals';

const DEFAULT_TIER: Tier = 'beginner';
const HISTORY_LIMIT = 60;
const REP_DURATION_EXTENSION_SECONDS = 2;
const MIN_VOICED_FRAMES = 8;
const LIVE_LEVEL_OFFSET = 70;
const LIVE_SMOOTHING_ALPHA = 0.25;
const MAX_QUIET_FRAMES = 2;

type Phase =
  | 'instructions'
  | 'listening'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';
type VoiceStatus = 'low' | 'inside' | 'high' | 'none';
type StopReason = 'none' | 'rep' | 'final' | 'cancel';

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
      return COLORS.waveform;
    case 'low':
      return COLORS.gray;
    case 'high':
      return COLORS.guideRed;
    default:
      return COLORS.muted;
  }
}

function isUsableVoiceFrame(
  frame: LiveAudioFrame | null | undefined,
): frame is LiveAudioFrame {
  return Boolean(
    frame &&
      Number.isFinite(frame.volume) &&
      frame.volume >= -45 &&
      Number.isFinite(frame.pitch) &&
      frame.pitch >= 60 &&
      frame.pitch <= 1500 &&
      Number.isFinite(frame.clarity) &&
      frame.clarity >= 0.7 &&
      frame.note !== '--',
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

function combineRepSamples(
  chunks: Float32Array[],
  sampleRate: number,
  durationSec: number,
): Float32Array {
  const expectedSamplesPerRep = Math.max(
    1,
    Math.round(sampleRate * durationSec),
  );

  const result = new Float32Array(
    expectedSamplesPerRep * chunks.length,
  );

  chunks.forEach((chunk, index) => {
    const start = index * expectedSamplesPerRep;
    const copyLength = Math.min(
      chunk.length,
      expectedSamplesPerRep,
    );

    result.set(chunk.subarray(0, copyLength), start);
  });

  return result;
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
    <View style={exerciseStyles.cardVariant2}>
      <View style={exerciseStyles.rowBetween}>
        <Text style={exerciseStyles.repResultTitle}>Target Volume</Text>

        <Text style={exerciseStyles.targetRange}>
          {formatTargetRange(targetRange)}
        </Text>
      </View>

      <View style={exerciseStyles.meter}>
        <View
          style={[
            exerciseStyles.targetBandVariant1,
            {
              left: `${bandLeft}%`,
              width: `${bandWidth}%`,
            },
          ]}
        />

        {liveDb > 0 && (
          <View
            style={[
              exerciseStyles.marker,
              { left: `${currentPosition * 100}%` },
            ]}
          >
            <View
              style={[
                exerciseStyles.markerDot,
                { backgroundColor: statusColor },
              ]}
            />
            <View
              style={[
                exerciseStyles.markerStem,
                { backgroundColor: statusColor },
              ]}
            />
          </View>
        )}
      </View>

      <View style={exerciseStyles.rowBetween}>
        <Text style={exerciseStyles.scaleText}>30</Text>
        <Text style={exerciseStyles.scaleText}>40</Text>
        <Text style={exerciseStyles.scaleText}>55</Text>
        <Text style={exerciseStyles.scaleText}>70</Text>
      </View>

      <View style={exerciseStyles.bandGuide}>
        <View style={exerciseStyles.liveStatHeading}>
          <View
            style={[
              exerciseStyles.statusDot,
              { backgroundColor: COLORS.gray },
            ]}
          />
          <Text style={exerciseStyles.guideText}>Too soft</Text>
        </View>

        <View style={exerciseStyles.liveStatHeading}>
          <View
            style={[
              exerciseStyles.statusDot,
              { backgroundColor: COLORS.waveform },
            ]}
          />
          <Text style={exerciseStyles.guideText}>Target band</Text>
        </View>

        <View style={exerciseStyles.liveStatHeading}>
          <View
            style={[
              exerciseStyles.statusDot,
              { backgroundColor: COLORS.guideRed },
            ]}
          />
          <Text style={exerciseStyles.guideText}>Too loud</Text>
        </View>
      </View>

      <Text style={[exerciseStyles.bandStatus, { color: statusColor }]}>
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
    <View style={exerciseStyles.cardVariant2}>
      <View style={exerciseStyles.rowBetween}>
        <View style={exerciseStyles.flex}>
          <Text style={exerciseStyles.repResultTitle}>Your Live Voice</Text>
          <Text style={exerciseStyles.mutedSmall}>
            Bars show your detected microphone level over time.
          </Text>
        </View>
      </View>

      <View style={exerciseStyles.history}>
        <View
          style={[
            exerciseStyles.historyTarget,
            {
              top: `${targetTop}%`,
              height: `${Math.max(targetHeight, 4)}%`,
            },
          ]}
        />

        <View style={exerciseStyles.historyBars}>
          {history.length === 0 && (
            <View style={exerciseStyles.historyEmpty}>
              <Text style={exerciseStyles.scoreDescriptionVariant1}>
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
                  exerciseStyles.historyBar,
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
      style={[exerciseStyles.referenceButtonVariant1, playing && exerciseStyles.disabled]}
      disabled={playing}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: playing }}
    >
      <Ionicons
        name={playing ? 'volume-high' : 'play'}
        size={17}
        color={COLORS.brown}
      />

      <Text style={exerciseStyles.referenceButtonText}>
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
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');

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
    EXERCISE_COUNTDOWN_SECONDS,
  );
  const [currentRep, setCurrentRep] = useState(1);
  const currentRepRef = useRef(1);
  const repSamplesRef = useRef<Float32Array[]>([]);
  const repSampleRateRef = useRef<number | null>(null);
  const totalVoicedFrameCountRef = useRef(0);
  const stopReasonRef = useRef<StopReason>('none');

  const [referencePlaying, setReferencePlaying] = useState(false);
  const [referencePlaybackError, setReferencePlaybackError] =
    useState<string | null>(null);
  const [hasPlayedReference, setHasPlayedReference] = useState(false);
  const [referenceNote, setReferenceNote] = useState(() =>
    createMusicalNote(60),
  );
  const [referenceNoteReady, setReferenceNoteReady] = useState(false);

  const [liveHistory, setLiveHistory] = useState<number[]>([]);
  const [liveDisplayDb, setLiveDisplayDb] = useState(0);

  const smoothedLevelRef = useRef<number | null>(null);
  const quietFrameCountRef = useRef(0);

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
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);

  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');
  const pauseStopPendingRef = useRef(false);

  const exerciseDurationSec =
    params.durationSec + REP_DURATION_EXTENSION_SECONDS;
  const repDurationMs = exerciseDurationSec * 1000;

  const finishingRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);
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

  const resetLiveLevel = useCallback(() => {
    smoothedLevelRef.current = null;
    quietFrameCountRef.current = 0;

    setLiveDisplayDb(0);
    setLiveHistory([]);
  }, []);

  const resetAttemptRefs = useCallback(() => {
    finishingRef.current = false;
    recordingStopRequestedRef.current = false;
    recordingFinishedRef.current = false;
    shouldProcessResultRef.current = false;
    cancelledRecordingRef.current = false;
    voicedFrameCountRef.current = 0;
    totalVoicedFrameCountRef.current = 0;
    recordingStartedAtRef.current = null;
    stopReasonRef.current = 'none';
    repSamplesRef.current = [];
    repSampleRateRef.current = null;
    currentRepRef.current = 1;
  }, []);

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
      } catch (errorMessage) {
        console.error('VOLUME BAND PARAMETER LOAD ERROR:', errorMessage);

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
            frequencyToMidi(lowHz),
          );

          const highMidi = Math.floor(
            frequencyToMidi(highHz),
          );

          if (lowMidi <= highMidi) {
            const midpointHz = Math.sqrt(lowHz * highHz);

            const midpointMidi = Math.round(
              frequencyToMidi(midpointHz),
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
      } catch (errorMessage) {
        console.error(
          'Unable to load assessed vocal range for reference note:',
          errorMessage,
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
        'The reference note has an invalid frequency. Please reload the recording.',
      );

      return false;
    }

    try {
      setReferencePlaying(true);

      await playSingleNote(
        frequency,
        EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
      );

      setHasPlayedReference(true);
      return true;
    } catch (errorMessage) {
      console.error(
        '[VolumeBandTargeting] REFERENCE NOTE PLAYBACK ERROR:',
        errorMessage,
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

  const stopRecordingRef = useRef<() => Promise<void>>(
    async () => {},
  );

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (
        phaseRef.current !== 'recording' ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        cancelledRecordingRef.current ||
        recordingFinishedRef.current
      ) {
        return;
      }

      if (!isUsableVoiceFrame(frame)) {
        quietFrameCountRef.current += 1;

        setLiveHistory((previous) =>
          [...previous, 0].slice(-HISTORY_LIMIT),
        );

        if (quietFrameCountRef.current >= MAX_QUIET_FRAMES) {
          smoothedLevelRef.current = null;
          setLiveDisplayDb(0);
        }

        return;
      }

      quietFrameCountRef.current = 0;
      voicedFrameCountRef.current += 1;
      totalVoicedFrameCountRef.current += 1;


      const rawLevel = getLiveDisplayLevel(frame);
      const previousLevel = smoothedLevelRef.current;

      const nextLevel =
        previousLevel === null
          ? rawLevel
          : previousLevel +
            LIVE_SMOOTHING_ALPHA * (rawLevel - previousLevel);

      smoothedLevelRef.current = nextLevel;

      setLiveDisplayDb(nextLevel);

      setLiveHistory((previous) =>
        [...previous, nextLevel].slice(-HISTORY_LIMIT),
      );
    },

    onStop: (samples, sampleRate) => {
      if (recordingFinishedRef.current) return;

      recordingFinishedRef.current = true;
      recordingStartedAtRef.current = null;

      if (
        cancelledRecordingRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current ||
        stopReasonRef.current === 'cancel'
      ) {
        finishingRef.current = false;
        recordingStopRequestedRef.current = false;
        shouldProcessResultRef.current = false;
        resetLiveLevel();
        return;
      }

      if (!shouldProcessResultRef.current) {
        finishingRef.current = false;
        recordingStopRequestedRef.current = false;

        setRecordingNotice(
          'The recording stopped before the repetition finished. Please try again.',
        );

        resetLiveLevel();
        setPhase('instructions');
        return;
      }

      shouldProcessResultRef.current = false;

      const stopReason = stopReasonRef.current;
      const currentParams = paramsRef.current;
      const currentRepNumber = currentRepRef.current;

      const expectedRepDuration =
        currentParams.durationSec + REP_DURATION_EXTENSION_SECONDS;

      if (stopReason !== 'rep' && stopReason !== 'final') {
        finishingRef.current = false;
        recordingStopRequestedRef.current = false;

        setRecordingNotice(
          'The recording stopped unexpectedly. Please try again.',
        );

        resetLiveLevel();
        setPhase('instructions');
        return;
      }

      if (
        repSampleRateRef.current !== null &&
        repSampleRateRef.current !== sampleRate
      ) {
        finishingRef.current = false;
        recordingStopRequestedRef.current = false;

        setRecordingNotice(
          'The microphone sample rate changed during the recording. Please try again.',
        );

        resetLiveLevel();
        setPhase('instructions');
        return;
      }

      repSampleRateRef.current = sampleRate;

      if (!hasSufficientRecordedSignal(samples)) {
        totalVoicedFrameCountRef.current = Math.max(
          0,
          totalVoicedFrameCountRef.current - voicedFrameCountRef.current,
        );
        finishingRef.current = false;
        recordingStopRequestedRef.current = false;
        recordingFinishedRef.current = false;
        shouldProcessResultRef.current = false;
        voicedFrameCountRef.current = 0;
        recordingStartedAtRef.current = null;
        stopReasonRef.current = 'none';
        resetLiveLevel();
        setRecordingNotice(null);
        setPhase('instructions');
        setShowNoAudioModal(true);
        return;
      }

      repSamplesRef.current.push(samples);

      if (
        stopReason === 'rep' &&
        currentRepNumber < currentParams.repetitions
      ) {
        finishingRef.current = false;
        recordingStopRequestedRef.current = false;
        recordingFinishedRef.current = false;
        shouldProcessResultRef.current = false;
        stopReasonRef.current = 'none';
        voicedFrameCountRef.current = 0;

        const nextRep = currentRepNumber + 1;
        currentRepRef.current = nextRep;

        setCurrentRep(nextRep);
        setElapsedMs(0);

        resetLiveLevel();

        setCountdown(EXERCISE_COUNTDOWN_SECONDS);
        setPhase('countdown');
        return;
      }

      const recordedChunks = repSamplesRef.current;
      const recordedSampleRate = repSampleRateRef.current;

      if (
        recordedChunks.length !== currentParams.repetitions ||
        recordedSampleRate === null
      ) {
        finishingRef.current = false;
        recordingStopRequestedRef.current = false;

        setRecordingNotice(
          'Not all repetitions were recorded successfully. Please try again.',
        );

        resetLiveLevel();
        setPhase('instructions');
        return;
      }

      const combinedSamples = combineRepSamples(
        recordedChunks,
        recordedSampleRate,
        expectedRepDuration,
      );

      const totalExpectedVoicedFrames =
        totalVoicedFrameCountRef.current;

      try {
        if (
          totalExpectedVoicedFrames < MIN_VOICED_FRAMES ||
          !hasSufficientRecordedSignal(combinedSamples)
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

          resetLiveLevel();
          setPhase('processing');
          return;
        }

        const measurement = measureVolumeBandTargeting(
          combinedSamples,
          recordedSampleRate,
          {
            windowMs: VOLUME_ANALYSIS_WINDOW_MS,
            targetDbRange: currentParams.targetDbRange,
            durationSec: expectedRepDuration,
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
        ).catch((errorMessage) => {
          console.error('VOLUME BAND PROGRESS SAVE ERROR:', errorMessage);
        });

        setPhase('processing');
      } catch (errorMessage) {
        console.error('VOLUME BAND MEASUREMENT ERROR:', errorMessage);

        setRecordingNotice(
          'The recording could not be measured. Please try the recording again.',
        );

        resetLiveLevel();
        setPhase('instructions');
      } finally {
        resetLiveLevel();
        recordingStartedAtRef.current = null;
        finishingRef.current = false;
        recordingStopRequestedRef.current = false;
        stopReasonRef.current = 'none';
      }
    },
  });

  stopRecordingRef.current = stopRecording;

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
      phaseRef.current === 'recording' &&
      (isRecording || recordingStartedAtRef.current !== null)
    ) {
      cancelledRecordingRef.current = true;
      stopReasonRef.current = 'cancel';
      shouldProcessResultRef.current = false;
      finishingRef.current = true;
      recordingStartedAtRef.current = null;

      resetLiveLevel();

      if (!recordingStopRequestedRef.current) {
        recordingStopRequestedRef.current = true;
        pauseStopPendingRef.current = true;
        setIsPausing(true);

        void (async () => {
          try {
            await stopRecordingRef.current();
          } catch (errorMessage) {
            console.error(
              'VOLUME BAND PAUSE RECORDING ERROR:',
              errorMessage,
            );
          } finally {
            pauseStopPendingRef.current = false;
            setIsPausing(false);
          }
        })();
      }
    }
  };

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

    if (
      previousPhase === 'recording' ||
      previousPhase === 'countdown'
    ) {
      resetAttemptRefs();

      setCurrentRep(1);
      setElapsedMs(0);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);

      resetLiveLevel();

      setRecordingNotice(null);
      setNoVoiceDetected(false);

      setScore(0);
      setAverageDb(0);
      setConsistency(0);
      setTargetReached(false);
      setPassed(false);
      setMeasurementQuality(0);

      setRepScores(
        Array.from(
          { length: paramsRef.current.repetitions },
          () => 0,
        ),
      );

      setPhase('countdown');
      return;
    }

    setPhase(previousPhase);
  };

  const quitExercise = async () => {
    if (quitInProgressRef.current) return;

    quitInProgressRef.current = true;
    pausedRef.current = true;
    cancelledRecordingRef.current = true;
    stopReasonRef.current = 'cancel';
    shouldProcessResultRef.current = false;
    recordingStartedAtRef.current = null;

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    setIsQuitting(true);

    resetLiveLevel();

    try {
      if (isRecording && !recordingStopRequestedRef.current) {
        recordingStopRequestedRef.current = true;

        try {
          await stopRecordingRef.current();
        } catch (errorMessage) {
          console.error(
            'VOLUME BAND QUIT RECORDING ERROR:',
            errorMessage,
          );
        }
      }
    } finally {
      router.replace('/exercises/volume');
    }
  };

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
    if (phase !== 'recording') return;

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
        repDurationMs,
      );

      setElapsedMs(nextElapsed);

      if (
        nextElapsed >= repDurationMs &&
        !recordingStopRequestedRef.current
      ) {
        finishingRef.current = true;
        recordingStopRequestedRef.current = true;
        shouldProcessResultRef.current = true;

        const isFinalRep =
          currentRepRef.current >= paramsRef.current.repetitions;

        stopReasonRef.current = isFinalRep ? 'final' : 'rep';

        void (async () => {
          try {
            await stopRecordingRef.current();
          } catch (errorMessage) {
            console.error(
              'VOLUME BAND TARGETING STOP ERROR:',
              errorMessage,
            );

            shouldProcessResultRef.current = false;
            finishingRef.current = false;
            recordingStopRequestedRef.current = false;
            recordingFinishedRef.current = false;
            recordingStartedAtRef.current = null;
            stopReasonRef.current = 'none';

            setRecordingNotice(
              'The recording could not be finalized. Please try again.',
            );

            resetLiveLevel();
            setPhase('instructions');
          }
        })();
      }
    }, 50);

    return () => clearInterval(timer);
  }, [phase, repDurationMs, resetLiveLevel]);

  const beginRecording = async () => {
    if (
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    finishingRef.current = false;
    recordingStopRequestedRef.current = false;
    recordingFinishedRef.current = false;
    shouldProcessResultRef.current = false;
    cancelledRecordingRef.current = false;
    voicedFrameCountRef.current = 0;
    recordingStartedAtRef.current = null;
    stopReasonRef.current = 'none';

    try {
      await startRecording();

      if (
        cancelledRecordingRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        if (!recordingStopRequestedRef.current) {
          recordingStopRequestedRef.current = true;
          stopReasonRef.current = 'cancel';

          void stopRecordingRef.current().catch((errorMessage) => {
            console.error('VOLUME BAND CANCEL STOP ERROR:', errorMessage);
          });
        }

        return;
      }

      resetLiveLevel();

      recordingStartedAtRef.current = Date.now();
      setElapsedMs(0);
      setPhase('recording');
    } catch (errorMessage) {
      console.error('VOLUME BAND TARGETING START ERROR:', errorMessage);

      recordingStartedAtRef.current = null;
      finishingRef.current = false;
      recordingStopRequestedRef.current = false;
      recordingFinishedRef.current = false;
      shouldProcessResultRef.current = false;
      stopReasonRef.current = 'none';

      resetLiveLevel();

      if (!quitInProgressRef.current) {
        setRecordingNotice(
          'The microphone could not start. Please check microphone permission and try again.',
        );

        setPhase('instructions');
      }
    }
  };

  const startExercise = () => {
    if (
      !parametersReady ||
      isRecording ||
      phase === 'countdown' ||
      phase === 'recording' ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    resetAttemptRefs();
    resetLiveLevel();

    setCurrentRep(1);
    setElapsedMs(0);
    setRecordingNotice(null);
    setReferencePlaybackError(null);
    setNoVoiceDetected(false);

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);

    setScore(0);
    setAverageDb(0);
    setConsistency(0);
    setTargetReached(false);
    setPassed(false);
    setMeasurementQuality(0);

    setRepScores(
      Array.from({ length: params.repetitions }, () => 0),
    );

    pausedRef.current = false;
    setPhase('countdown');
  };

  useEffect(() => {
    if (phase !== 'processing') return;

    const timeout = setTimeout(() => setPhase('results'), 100);
    return () => clearTimeout(timeout);
  }, [phase]);

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
  }, [phase, countdown, showQuitModal, currentRep, setPhase]);

  const currentRepElapsed = elapsedMs;
  const progress = clamp(currentRepElapsed / repDurationMs, 0, 1);
  const liveDb = liveDisplayDb;
  const targetRangeText = formatTargetRange(params.targetDbRange);

  const quitModal = (
    <>
      <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit recording?"}
        message={pausedPhaseRef.current === 'recording'
          ? 'Your current repetition has been stopped. If you continue, the recording will restart from Rep 1.'
          : pausedPhaseRef.current === 'countdown'
            ? 'Your recording is paused. Continuing will restart from Rep 1.'
            : 'Are you sure you want to leave Volume Band Targeting?'}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => {
          void quitExercise();
        }}
        continueLabel={isPausing ? 'Pausing...' : 'Continue Exercise'}
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />
      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={function redoExerciseRepetition() {
          setShowNoAudioModal(false);
          setCountdown(EXERCISE_COUNTDOWN_SECONDS);
          setPhase('countdown');
        }}
        onQuit={() => {
          setShowNoAudioModal(false);
          void quitExercise();
        }}
        isQuitting={isQuitting}
      />
    </>
  );

  if (!parametersReady || !referenceNoteReady) {
    return (
      <>
        {quitModal}

        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the recording to your current difficulty level and preparing your vocal range."
          icon="options-outline"
          iconSize={44}
          useSafeArea
        />
      </>
    );
  }

  if (phase === 'instructions') {
    const startDisabled = !parametersReady || isRecording;

    return (
      <>
        {quitModal}

        <SafeAreaView style={exerciseStyles.screen}>
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
                text: `Hold the target volume for ${exerciseDurationSec} seconds per repetition. Each repetition has its own countdown.`,
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
            errorMessage={referencePlaybackError ?? recordingNotice ?? undefined}
          >
            <View style={exerciseStyles.referenceCardVariant3}>
              <View style={exerciseStyles.referenceTopRow}>
                <View style={exerciseStyles.infoText}>
                  <Text style={exerciseStyles.eyebrow}>REFERENCE NOTE</Text>
                  <Text style={exerciseStyles.referenceNote}>
                    {referenceNote.name}
                  </Text>
                </View>

                <View style={exerciseStyles.referenceIconCircle}>
                  <Ionicons
                    name="musical-note"
                    size={22}
                    color={COLORS.brown}
                  />
                </View>
              </View>

              <Text style={exerciseStyles.referenceInstructionVariant1}>
                Play the note, then sing it on “Ah” while adjusting your
                volume to stay inside the target band.
              </Text>

              <ReferenceNoteButton
                playing={referencePlaying}
                label={`Play ${referenceNote.name}`}
                onPress={() => void playReferenceNote()}
              />

              {hasPlayedReference && (
                <View style={exerciseStyles.referenceReadyRow}>
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color={COLORS.guideGreen}
                  />

                  <Text style={exerciseStyles.referenceReadyTextVariant1}>
                    Reference note played. You’re ready to begin.
                  </Text>
                </View>
              )}
            </View>

            <TargetBandMeter
              liveDb={0}
              targetRange={params.targetDbRange}
            />

            <View style={exerciseStyles.infoCardVariant1}>
              <View style={exerciseStyles.deltaRow}>
                <View style={exerciseStyles.infoIconCircle}>
                  <Ionicons
                    name="information-circle-outline"
                    size={19}
                    color={COLORS.waveform}
                  />
                </View>

                <Text style={exerciseStyles.repResultTitle}>What to focus on</Text>
              </View>

              <Text style={exerciseStyles.infoTextVariant1}>
                This recording evaluates how consistently your detected
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

        <SafeAreaView style={exerciseStyles.screen}>
          <ExerciseCountdownScreen
            icon="musical-note-outline"
            title="Get Ready"
            currentRep={currentRep}
            repetitions={params.repetitions}
            countdown={countdown}
            promptTitle={`Prepare to sing ${referenceNote.name}.`}
            prompt={`Repetition ${currentRep} of ${params.repetitions}. Start singing on “Ah” when the countdown reaches zero. Keep your volume inside the ${targetRangeText} target band for ${exerciseDurationSec} seconds.`}
            onBack={pauseForExitPrompt}
          />
        </SafeAreaView>
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        {quitModal}

        <SafeAreaView style={exerciseStyles.screen}>
          <View style={exerciseStyles.screenVariant1}>
                <Text style={exerciseStyles.activeTitle}>
                  Volume Band Targeting
                </Text>

                <Text style={exerciseStyles.activeCategory}>
                  VOLUME CONTROL
                </Text>

            <ScrollView
              style={exerciseStyles.activeScroll}
              contentContainerStyle={exerciseStyles.liveContentVariant1}
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

                <View style={exerciseStyles.repTrack}>
                  <View
                    style={[
                      exerciseStyles.progressFill,
                      { width: `${progress * 100}%` },
                    ]}
                  />
                </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </>
    );
  }

  if (phase === 'processing') {
    return (
      <>
        {quitModal}
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing Your Performance"
          message="Checking your volume consistency across all repetitions."
        />
      </>
    );
  }

  return (
    <>
      {quitModal}

      <SafeAreaView style={exerciseStyles.screen}>
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
            <View style={exerciseStyles.resultCardVariant3}>
              {repScores.map((repScore, index) => (
                <View key={`rep-${index}`} style={exerciseStyles.resultRowVariant3}>
                  <Text style={exerciseStyles.resultLabel}>
                    Repetition {index + 1}
                  </Text>

                  <Text style={exerciseStyles.resultValue}>
                    {noVoiceDetected ? '—' : `${repScore}%`}
                  </Text>
                </View>
              ))}

              <View style={exerciseStyles.resultRowVariant3}>
                <Text style={exerciseStyles.resultLabel}>Average Volume</Text>

                <Text style={exerciseStyles.resultValue}>
                  {noVoiceDetected
                    ? 'No input'
                    : `${formatDb(averageDb)} dB`}
                </Text>
              </View>

              <View style={exerciseStyles.resultRowVariant3}>
                <Text style={exerciseStyles.resultLabel}>Target</Text>

                <Text style={exerciseStyles.resultValue}>
                  {targetRangeText}
                </Text>
              </View>

              <View style={exerciseStyles.resultRowVariant3}>
                <Text style={exerciseStyles.resultLabel}>Consistency</Text>

                <Text style={exerciseStyles.resultValue}>
                  {noVoiceDetected ? '—' : `${consistency}%`}
                </Text>
              </View>

              <View style={exerciseStyles.resultRowVariant3}>
                <Text style={exerciseStyles.resultLabel}>Band Compliance</Text>

                <Text style={exerciseStyles.resultValue}>
                  {noVoiceDetected
                    ? 'No input'
                    : targetReached
                      ? 'Inside ✓'
                      : 'Outside'}
                </Text>
              </View>

              <View style={[exerciseStyles.resultRowVariant3, exerciseStyles.metricRowLast]}>
                <View style={exerciseStyles.flex}>
                  <Text style={exerciseStyles.resultLabel}>
                    Measurement quality
                  </Text>

                  <Text style={exerciseStyles.mutedSmall}>
                    {noVoiceDetected
                      ? 'No usable microphone signal was detected. This attempt was not scored or saved.'
                      : `${measurementQuality}% of expected audio windows were available.`}
                  </Text>
                </View>

                <Text style={exerciseStyles.resultValue}>
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
