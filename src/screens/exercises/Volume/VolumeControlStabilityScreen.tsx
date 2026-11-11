import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePhaseState } from '@/hooks/usePhaseState';
import {
  VOLUME_CONTROL_STABILITY_PARAMS,
  type Tier,
  type VolumeControlStabilityParams,
} from '@/constants/params';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExercisePreparingScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateVolumeControlStabilityParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureVolumeControlStability } from '@/services/measurement/volume/volumeControlStability';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';
import { scoreVolumeControlStability } from '@/services/scoring/volume/volumeControlStability';
import { playSingleNote } from '@/utils/music/notePlayer';
import {
  createMusicalNote,
  getVocalRangeMidiBounds,
  midiToNoteName,
} from '@/utils/music/notes';

import {
  COLORS,
  EXERCISE_COUNTDOWN_SECONDS,
  EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
} from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import {
  concatenateRepetitions,
  fixedDurationSamples,
  hasSufficientRecordedSignal,
} from '@/utils/audioSignal';

import {
  ExerciseNoAudioModal,
  ExerciseQuitModal,
} from '@/components/exercises/ExerciseModals';

const DEFAULT_REFERENCE_MIDI = 60;
const MAX_LIVE_HISTORY = 40;
const MIN_VOICE_CLARITY = 0.45;

type Phase =
  | 'instructions'
  | 'listening'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

type MeasurementResult =
  ReturnType<typeof measureVolumeControlStability>;

type ScoreResult =
  ReturnType<typeof scoreVolumeControlStability>;

function getAssessmentReferenceMidi(
  assessment: unknown,
): number | null {
  if (
    !assessment ||
    typeof assessment !== 'object'
  ) {
    return null;
  }

  const data = assessment as Record<string, unknown>;
  const vocalRange = data.vocalRange;

  if (
    !vocalRange ||
    typeof vocalRange !== 'object'
  ) {
    return null;
  }

  const range = vocalRange as {
    lowHz?: unknown;
    highHz?: unknown;
  };

  if (
    typeof range.lowHz !== 'number' ||
    typeof range.highHz !== 'number' ||
    !Number.isFinite(range.lowHz) ||
    !Number.isFinite(range.highHz)
  ) {
    return null;
  }

  const bounds = getVocalRangeMidiBounds({
    lowHz: range.lowHz,
    highHz: range.highHz,
  });

  if (!bounds) {
    return null;
  }

  return Math.round(
    (bounds.lowMidi + bounds.highMidi) / 2,
  );

}

export default function VolumeControlStabilityScreen({
  tier,
}: {
  tier?: Tier;
}) {
  const { phase, setPhase } = usePhaseState<Phase>('instructions');

  const [referenceMidi, setReferenceMidi] =
    useState(DEFAULT_REFERENCE_MIDI);

  const NOTE = midiToNoteName(referenceMidi);
  const REFERENCE_NOTE = createMusicalNote(referenceMidi);

  const [countdown, setCountdown] =
    useState(EXERCISE_COUNTDOWN_SECONDS);

  const [remainingSeconds, setRemainingSeconds] =
    useState(0);

  const [liveVolume, setLiveVolume] =
    useState(-60);

  const [livePitch, setLivePitch] =
    useState<number | null>(null);

  const [liveNote, setLiveNote] =
    useState('--');

  const [liveStability, setLiveStability] =
    useState(0);

  const [measurement, setMeasurement] =
    useState<MeasurementResult | null>(null);

  const [score, setScore] =
    useState<ScoreResult | null>(null);

  const [referencePlaying, setReferencePlaying] =
    useState(false);

  const [referenceError, setReferenceError] =
    useState<string | null>(null);

  const [isStarting, setIsStarting] =
    useState(false);

  const initialTier: Tier = tier ?? 'beginner';

  const [resolvedTier, setResolvedTier] =
    useState<Tier>(initialTier);

  const [exerciseParams, setExerciseParams] =
    useState<VolumeControlStabilityParams>(
      VOLUME_CONTROL_STABILITY_PARAMS[initialTier],
    );

  const [paramsReady, setParamsReady] =
    useState(false);

  const [showQuitModal, setShowQuitModal] =
    useState(false);
  const [showNoAudioModal, setShowNoAudioModal] =
    useState(false);
  const [noAudioRepetition, setNoAudioRepetition] =
    useState(1);

  const [isQuitting, setIsQuitting] =
    useState(false);

  const [isPausing, setIsPausing] =
    useState(false);

  const liveHistoryRef = useRef<number[]>([]);
  const mountedRef = useRef(true);

  const exerciseStartedAtRef =
    useRef<number | null>(null);

  const repetitionSamplesRef =
    useRef<Array<Float32Array | null>>([]);
  const retryingRepetitionRef =
    useRef<number | null>(null);
  const recordingDurationSecondsRef =
    useRef(0);

  const recordingFinishedRef = useRef(false);

  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);

  const pausedPhaseRef =
    useRef<Phase>('instructions');

  const pauseStopPendingRef = useRef(false);

  const durationSeconds = exerciseParams.durationSec;
  const repetitions = exerciseParams.repetitions;

  const targetStability =
    exerciseParams.stabilityThreshold;

  const totalExerciseSeconds =
    durationSeconds * repetitions;

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadReferenceNote = async () => {
      try {
        const assessment =
          await getLatestAssessment();

        const assessedMidi =
          getAssessmentReferenceMidi(assessment);

        if (
          !cancelled &&
          assessedMidi !== null
        ) {
          setReferenceMidi(assessedMidi);
        }
      } catch (errorMessage) {
        console.warn(
          'Unable to load assessed vocal range for reference note:',
          errorMessage,
        );
      }
    };

    void loadReferenceNote();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setParamsReady(false);

    const loadParameters = async () => {
      try {
        const user = auth.currentUser;

        let selectedTier: Tier = tier ?? 'beginner';

        let recentScores: number[] = [];

        if (user) {
          if (!tier) {
            const progress =
              await fetchComponentProgress(
                user.uid,
                'volume',
              );

            const progressTier = progress?.currentTier;

            if (
              progressTier === 'beginner' ||
              progressTier === 'intermediate' ||
              progressTier === 'advanced'
            ) {
              selectedTier = progressTier;
            }
          }

          const records =
            await fetchExerciseRecords(
              user.uid,
              'volume',
            );

          const matchingRecords = records
            .filter(
              (record) =>
                record.templateId ===
                  'volumeControlStability' &&
                record.tier === selectedTier,
            )
            .sort(
              (a, b) =>
                Number(a.timestamp ?? 0) -
                Number(b.timestamp ?? 0),
            );

          recentScores = matchingRecords
            .slice(-5)
            .map((record) => record.scorePct);

          if (recentScores.length === 0) {
            const latestAssessment =
              await getLatestAssessment();

            const assessmentScore =
              latestAssessment?.scores.find(
                (item) =>
                  item.componentId === 'volume',
              )?.scorePct;

            if (
              typeof assessmentScore === 'number' &&
              Number.isFinite(assessmentScore)
            ) {
              recentScores = [assessmentScore];
            }
          }
        }

        const generatedParams =
          generateVolumeControlStabilityParams({
            tier: selectedTier,
            recentScores,
          });

        if (cancelled) {
          return;
        }

        setResolvedTier(selectedTier);
        setExerciseParams(generatedParams);
        setRemainingSeconds(
          generatedParams.durationSec *
            generatedParams.repetitions,
        );
        setParamsReady(true);
      } catch (errorMessage) {
        console.error(
          'Failed to load Volume Control Stability parameters:',
          errorMessage,
        );

        if (cancelled) {
          return;
        }

        const fallbackTier: Tier = tier ?? 'beginner';

        setResolvedTier(fallbackTier);

        const fallbackParams =
          generateVolumeControlStabilityParams({
            tier: fallbackTier,
            recentScores: [],
          });

        setExerciseParams(fallbackParams);
        setRemainingSeconds(
          fallbackParams.durationSec *
            fallbackParams.repetitions,
        );
        setParamsReady(true);
      }
    };

    void loadParameters();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  const playReferenceNote = useCallback(async () => {
    if (
      referencePlaying ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    setReferenceError(null);
    setReferencePlaying(true);

    try {
      await Promise.race([
        playSingleNote(
          REFERENCE_NOTE.frequency,
          EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
        ),
        new Promise<void>((resolve) => {
          setTimeout(
            resolve,
            EXERCISE_REFERENCE_NOTE_DURATION_SECONDS * 1000 +
              300,
          );
        }),
      ]);
    } catch (errorMessage) {
      console.error(
        `${NOTE} reference playback error:`,
        errorMessage,
      );

      if (mountedRef.current) {
        setReferenceError(
          `Unable to play the ${NOTE} reference note.`,
        );
      }
    } finally {
      if (mountedRef.current) {
        setReferencePlaying(false);
      }
    }
  }, [
    referencePlaying,
    REFERENCE_NOTE.frequency,
    NOTE,
  ]);

  const finishMeasurement = useCallback(
    (segments: Array<Float32Array | null>, sampleRate: number) => {
      const samples = concatenateRepetitions(segments);
      const measured = measureVolumeControlStability(
        samples,
        sampleRate,
        durationSeconds,
        repetitions,
      );
      const scored = scoreVolumeControlStability(measured, {
        passingScore: targetStability,
      });

      setMeasurement(measured);
      setScore(scored);
      setPhase('processing');

      void saveCompletedExercise(
        'volume',
        'volumeControlStability',
        resolvedTier,
        scored.overallScore,
      ).catch((errorMessage) => {
        console.error(
          'Unable to save completed recording:',
          errorMessage,
        );
      });
    },
    [
      durationSeconds,
      repetitions,
      targetStability,
      resolvedTier,
    ],
  );

  useEffect(() => {
    if (phase !== 'processing') return;

    const timeout = setTimeout(() => setPhase('results'), 100);
    return () => clearTimeout(timeout);
  }, [phase]);

  const { startRecording, stopRecording } =
    useAudioRecorder({
      onFrame: (frame) => {
        if (
          !mountedRef.current ||
          phase !== 'recording' ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current
        ) {
          return;
        }

        const db =
          Number.isFinite(frame.volume) &&
          frame.volume > -100
            ? frame.volume
            : -60;

        setLiveVolume(db);

        const isVoiced =
          Number.isFinite(frame.pitch) &&
          frame.pitch > 0 &&
          Number.isFinite(frame.clarity) &&
          frame.clarity >= MIN_VOICE_CLARITY &&
          typeof frame.note === 'string' &&
          frame.note !== '--';

        setLivePitch(
          isVoiced ? frame.pitch : null,
        );

        setLiveNote(
          isVoiced ? frame.note : '--',
        );

        if (!isVoiced) {
          setLiveStability(0);
          return;
        }

        const amplitudes =
          liveHistoryRef.current;

        amplitudes.push(10 ** (db / 20));

        if (
          amplitudes.length > MAX_LIVE_HISTORY
        ) {
          amplitudes.shift();
        }

        if (amplitudes.length < 2) {
          setLiveStability(0);
          return;
        }

        const mean =
          amplitudes.reduce(
            (sum, value) => sum + value,
            0,
          ) / amplitudes.length;

        if (
          mean <= 0 ||
          !Number.isFinite(mean)
        ) {
          setLiveStability(0);
          return;
        }

        const variance =
          amplitudes.reduce(
            (sum, value) =>
              sum + (value - mean) ** 2,
            0,
          ) / amplitudes.length;

        const coefficientOfVariation =
          Math.sqrt(variance) / mean;

        const stability = Math.max(
          0,
          Math.min(
            100,
            100 -
              coefficientOfVariation * 100,
          ),
        );

        setLiveStability(stability);
      },

      onStop: (samples, sampleRate) => {
        if (
          !mountedRef.current ||
          recordingFinishedRef.current ||
          pausedRef.current ||
          showQuitModalRef.current ||
          quitInProgressRef.current ||
          pauseStopPendingRef.current
        ) {
          if (pauseStopPendingRef.current) {
            pauseStopPendingRef.current = false;
          }

          return;
        }

        recordingFinishedRef.current = true;

        exerciseStartedAtRef.current = null;

        const retryingRepetition = retryingRepetitionRef.current;
        let repetitionSamples = repetitionSamplesRef.current;

        if (retryingRepetition !== null) {
          if (!hasSufficientRecordedSignal(samples)) {
            setNoAudioRepetition(retryingRepetition + 1);
            setShowNoAudioModal(true);
            setPhase('instructions');
            recordingDurationSecondsRef.current = totalExerciseSeconds;
            return;
          }

          repetitionSamples = [...repetitionSamples];
          repetitionSamples[retryingRepetition] = fixedDurationSamples(
            samples,
            sampleRate,
            durationSeconds,
          );
          repetitionSamplesRef.current = repetitionSamples;
          retryingRepetitionRef.current = null;
        } else {
          repetitionSamples = Array.from(
            { length: repetitions },
            (_, index) => {
              const start = Math.round(
                index * durationSeconds * sampleRate,
              );
              const end = Math.min(
                samples.length,
                Math.round((index + 1) * durationSeconds * sampleRate),
              );
              const repetition = samples.subarray(start, end);

              return hasSufficientRecordedSignal(repetition)
                ? fixedDurationSamples(repetition, sampleRate, durationSeconds)
                : null;
            },
          );
          repetitionSamplesRef.current = repetitionSamples;
        }

        recordingDurationSecondsRef.current = totalExerciseSeconds;

        const missingRepetition = repetitionSamples.findIndex(
          repetition => repetition === null,
        );
        if (missingRepetition !== -1) {
          setNoAudioRepetition(missingRepetition + 1);
          setShowNoAudioModal(true);
          setPhase('instructions');
          return;
        }

        finishMeasurement(repetitionSamples, sampleRate);
      },
    });

  const beginRecording = useCallback(async () => {
    if (
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    try {
      recordingFinishedRef.current = false;

      await startRecording();

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        recordingFinishedRef.current = true;
        pauseStopPendingRef.current = true;

        try {
          await stopRecording();
        } catch (errorMessage) {
          console.warn(
            'Unable to stop recording after interruption:',
            errorMessage,
          );
        } finally {
          pauseStopPendingRef.current = false;
        }

        return;
      }

      exerciseStartedAtRef.current = Date.now();

      liveHistoryRef.current = [];

      setLiveVolume(-60);
      setLiveStability(0);
      setLivePitch(null);
      setLiveNote('--');

      setRemainingSeconds(
        recordingDurationSecondsRef.current || totalExerciseSeconds,
      );
      setPhase('recording');
    } catch (errorMessage) {
      console.error(
        'Unable to start recording:',
        errorMessage,
      );

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current
      ) {
        return;
      }

      setPhase('instructions');

      setReferenceError(
        'Microphone could not be started. Please check microphone permission.',
      );
    }
  }, [
    startRecording,
    stopRecording,
    totalExerciseSeconds,
  ]);

  useEffect(() => {
    if (
      phase !== 'countdown' ||
      pausedRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);

    const interval = setInterval(() => {
      if (
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        clearInterval(interval);
        return;
      }

      setCountdown((value) => {
        if (value <= 1) {
          clearInterval(interval);
          void beginRecording();
          return 0;
        }

        return value - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [phase, beginRecording]);

  useEffect(() => {
    if (
      phase !== 'recording' ||
      pausedRef.current ||
      showQuitModalRef.current
    ) {
      return;
    }

    const interval = setInterval(() => {
      if (
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        clearInterval(interval);
        return;
      }

      const startedAt =
        exerciseStartedAtRef.current;

      if (startedAt === null) {
        return;
      }

      const elapsedSeconds =
        (Date.now() - startedAt) / 1000;

      const recordingDuration =
        recordingDurationSecondsRef.current || totalExerciseSeconds;
      const remaining = Math.max(
        0,
        Math.ceil(
          recordingDuration - elapsedSeconds,
        ),
      );

      setRemainingSeconds(remaining);

      if (elapsedSeconds >= recordingDuration) {
        clearInterval(interval);
        void stopRecording();
      }
    }, 100);

    return () => {
      clearInterval(interval);
    };
  }, [
    phase,
    stopRecording,
    totalExerciseSeconds,
  ]);

  const startExercise = useCallback(() => {
    if (
      !paramsReady ||
      isStarting ||
      referencePlaying ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    setIsStarting(true);

    setMeasurement(null);
    setScore(null);
    repetitionSamplesRef.current = Array(repetitions).fill(null);
    retryingRepetitionRef.current = null;
    recordingDurationSecondsRef.current = totalExerciseSeconds;

    recordingFinishedRef.current = false;
    exerciseStartedAtRef.current = null;

    liveHistoryRef.current = [];

    setLiveVolume(-60);
    setLiveStability(0);
    setLivePitch(null);
    setLiveNote('--');

    setRemainingSeconds(totalExerciseSeconds);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setReferenceError(null);

    setPhase('countdown');

    setTimeout(() => {
      if (mountedRef.current) {
        setIsStarting(false);
      }
    }, 400);
  }, [
    paramsReady,
    isStarting,
    referencePlaying,
    repetitions,
    totalExerciseSeconds,
  ]);

  const redoExerciseRepetition = useCallback(() => {
    if (
      !paramsReady ||
      pausedRef.current ||
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    retryingRepetitionRef.current = noAudioRepetition - 1;
    recordingDurationSecondsRef.current = durationSeconds;
    recordingFinishedRef.current = false;
    exerciseStartedAtRef.current = null;
    liveHistoryRef.current = [];
    setLiveVolume(-60);
    setLiveStability(0);
    setLivePitch(null);
    setLiveNote('--');
    setRemainingSeconds(durationSeconds);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setShowNoAudioModal(false);
    setPhase('countdown');
  }, [durationSeconds, noAudioRepetition, paramsReady]);

  const resetExercise = useCallback(() => {
    setMeasurement(null);
    setScore(null);

    setLiveVolume(-60);
    setLiveStability(0);
    setLivePitch(null);
    setLiveNote('--');

    liveHistoryRef.current = [];

    setRemainingSeconds(totalExerciseSeconds);
    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setReferenceError(null);

    recordingFinishedRef.current = false;
    exerciseStartedAtRef.current = null;

    setPhase('instructions');
  }, [totalExerciseSeconds]);

  const pauseForExitPrompt = useCallback(async () => {
    if (
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    pausedPhaseRef.current = phase;

    pausedRef.current = true;
    showQuitModalRef.current = true;

    setShowQuitModal(true);
    setIsQuitting(false);

    if (phase === 'recording') {
      setIsPausing(true);

      recordingFinishedRef.current = true;
      exerciseStartedAtRef.current = null;
      pauseStopPendingRef.current = true;

      try {
        await stopRecording();
      } catch (errorMessage) {
        console.warn(
          'Unable to stop recording while opening quit modal:',
          errorMessage,
        );
      } finally {
        pauseStopPendingRef.current = false;

        if (mountedRef.current) {
          setIsPausing(false);
        }
      }
    }
  }, [phase, stopRecording]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) {
      return;
    }

    const previousPhase =
      pausedPhaseRef.current;

    showQuitModalRef.current = false;
    pausedRef.current = false;

    setShowQuitModal(false);
    setIsQuitting(false);
    setIsPausing(false);

    if (previousPhase === 'recording') {
      setMeasurement(null);
      setScore(null);

      liveHistoryRef.current = [];

      setLiveVolume(-60);
      setLiveStability(0);
      setLivePitch(null);
      setLiveNote('--');

      setRemainingSeconds(totalExerciseSeconds);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      setReferenceError(null);

      recordingFinishedRef.current = false;
      exerciseStartedAtRef.current = null;
      setPhase('countdown');
      return;
    }

    setPhase(previousPhase);
  }, [totalExerciseSeconds]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) {
      return;
    }

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;

    setIsQuitting(true);
    setShowQuitModal(false);

    recordingFinishedRef.current = true;
    exerciseStartedAtRef.current = null;

    if (pausedPhaseRef.current === 'recording') {
      pauseStopPendingRef.current = true;

      try {
        await stopRecording();
      } catch (errorMessage) {
        console.warn(
          'Unable to stop recording while quitting:',
          errorMessage,
        );
      } finally {
        pauseStopPendingRef.current = false;
      }
    }

    router.replace('/exercises/volume' as any);
  }, [stopRecording]);

  useEffect(() => {
    const subscription =
      BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          if (quitInProgressRef.current) {
            return true;
          }

          if (showQuitModalRef.current) {
            return true;
          }

          void pauseForExitPrompt();

          return true;
        },
      );

    return () => {
      subscription.remove();
    };
  }, [pauseForExitPrompt]);

  const voiceDetected =
    livePitch !== null &&
    Number.isFinite(livePitch) &&
    livePitch > 0 &&
    liveNote !== '--';

  const quitModal = (
    <>
      <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit recording?"}
        message={pausedPhaseRef.current === 'recording'
              ? 'Your recording has been stopped. If you continue, this recording will restart from the countdown.'
              : pausedPhaseRef.current === 'countdown'
                ? 'Your recording is paused. Continue when you are ready to start the countdown again.'
                : 'Are you sure you want to leave this recording?'}
        isQuitting={isQuitting || isPausing}
        onContinue={continueExercise}
        onQuit={() => {
              void quitExercise();
            }}
        continueLabel={isPausing
                ? 'Pausing...'
                : 'Continue Exercise'}
        quitLabel={isQuitting
                ? 'Stopping...'
                : 'Quit Exercise'}
      />
      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={redoExerciseRepetition}
        onQuit={() => {
          void quitExercise();
        }}
        isQuitting={isQuitting || isPausing}
      />
    </>
  );

  if (!paramsReady) {
    return (
      <ExercisePreparingScreen
        title="Preparing Your Exercise"
        message="Adjusting the recording to your current difficulty level and preparing your vocal range."
        icon="options-outline"
        iconSize={44}
        headerContent={quitModal}
      />
    );
  }

  if (phase === 'instructions') {
    return (
      <SafeAreaView style={exerciseStyles.screen}>
        <ExerciseScreen
          title="Volume Control Stability"
          category="VOLUME CONTROL"
          icon="options-outline"
          instructions={`Listen to the ${NOTE} reference note, sing it on “Ah,” and keep your volume as steady as possible.`}
          preparationSteps={[
            {
              icon: 'musical-note-outline',
              text: `Optionally play the ${NOTE} reference note and listen carefully.`,
            },
            {
              icon: 'mic-outline',
              text: 'Take a comfortable breath before singing.',
            },
            {
              icon: 'pulse-outline',
              text: `Sing ${NOTE} on “Ah” and keep your volume steady.`,
            },
            {
              icon: 'timer-outline',
              text: `Hold the note for ${durationSeconds} seconds per repetition.`,
            },
          ]}
          summary={[
            {
              label: 'Duration',
              value: `${durationSeconds} sec`,
              hint: 'per repetition',
            },
            {
              label: 'Repetitions',
              value: String(repetitions),
            },
            {
              label: 'Stability target',
              value: `${Math.round(targetStability)}%`,
            },
          ]}
          targetValue={`${Math.round(targetStability)}%`}
          targetHint="Keep your volume consistent throughout the note."
          repetitions={repetitions}
          tip="Choose a comfortable volume first. Avoid sudden changes in loudness while sustaining the note."
          tier={resolvedTier}
          onBack={() => void pauseForExitPrompt()}
          onStart={() => setPhase('listening')}
          startDisabled={
            !paramsReady ||
            referencePlaying ||
            isStarting
          }
          startLabel={
            isStarting
              ? 'Preparing...'
              : 'Start Exercise'
          }
          errorMessage={referenceError}
        >
          <View style={exerciseStyles.referenceCardVariant4}>
            <View style={exerciseStyles.referenceTopRow}>
              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.referenceLabelVariant1}>
                  OPTIONAL REFERENCE NOTE
                </Text>

                <Text style={exerciseStyles.referenceNoteVariant2}>
                  {NOTE}
                </Text>
              </View>

              <View style={exerciseStyles.liveMicCircle}>
                <Ionicons
                  name="musical-note"
                  size={22}
                  color={ COLORS.brown}
                />
              </View>
            </View>

            <Text style={exerciseStyles.referenceInstructionVariant2}>
              Play the note if you want a pitch guide.
              You can start the recording without playing it.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Play ${NOTE} reference note`}
              style={[
                exerciseStyles.referenceButtonVariant2,
                referencePlaying && exerciseStyles.quitModalButtonDisabled,
              ]}
              disabled={referencePlaying}
              onPress={() => {
                void playReferenceNote();
              }}
            >
              <Ionicons
                name={
                  referencePlaying
                    ? 'volume-high'
                    : 'play'
                }
                size={17}
                color={ COLORS.brown}
              />

              <Text style={exerciseStyles.referenceButtonText}>
                {referencePlaying
                  ? 'Playing...'
                  : `Play ${NOTE}`}
              </Text>
            </Pressable>
          </View>
        </ExerciseScreen>

        {quitModal}
      </SafeAreaView>
    );
  }

  if (phase === 'listening') {
    return (
      <SafeAreaView style={exerciseStyles.screen}>
        <ExerciseListeningScreen
          icon="pulse-outline"
          title="Volume Control Stability"
          currentRep={1}
          repetitions={repetitions}
          promptTitle="Listen to the Reference"
          prompt={`Listen to the ${NOTE} note, then sing it steadily on “Ah.”`}
          isPlayingReference={referencePlaying}
          onPlayReference={() => void playReferenceNote()}
          onContinue={startExercise}
          onBack={() => void pauseForExitPrompt()}
          errorMessage={referenceError ?? undefined}
          liveContent={
            <View style={exerciseStyles.referenceCardVariant4}>
              <Text style={exerciseStyles.referenceLabelVariant1}>REFERENCE NOTE</Text>
              <Text style={exerciseStyles.referenceNoteVariant2}>{NOTE}</Text>
            </View>
          }
        />
        {quitModal}
      </SafeAreaView>
    );
  }

  if (phase === 'countdown') {
    return (
      <SafeAreaView style={exerciseStyles.screen}>
        <ExerciseCountdownScreen
          icon="pulse-outline"
          title="Get Ready"
          countdown={countdown}
          promptTitle={`Prepare to sing ${NOTE}.`}
          prompt={`Start singing on “Ah” when the countdown reaches zero. Keep your volume steady for ${durationSeconds} seconds per repetition.`}
          onBack={() => void pauseForExitPrompt()}
        />

        {quitModal}
      </SafeAreaView>
    );
  }

  if (phase === 'recording') {
    const startedAt = exerciseStartedAtRef.current;

    const elapsedTotal =
      startedAt === null
        ? 0
        : Math.max(
            0,
            Math.min(
              totalExerciseSeconds,
              (Date.now() - startedAt) / 1000,
            ),
          );

    const liveVolumeDisplay =
      liveVolume > -60
        ? Math.round(liveVolume + 70)
        : '--';

    const clampedStability = Math.max(
      0,
      Math.min(100, liveStability),
    );

    const clampedTarget = Math.max(
      0,
      Math.min(100, targetStability),
    );

    const meetsLiveTarget =
      voiceDetected &&
      clampedStability >= targetStability;

    const overallProgress =
      (elapsedTotal /
        Math.max(1, totalExerciseSeconds)) *
      100;

    return (
      <SafeAreaView style={exerciseStyles.screen}>
        <View style={exerciseStyles.screenVariant1}>
          <View style={exerciseStyles.exerciseHeaderVariant1}>
            <View style={exerciseStyles.exerciseHeaderText}>
              <Text style={exerciseStyles.exerciseTitle}>
                Volume Stability
              </Text>

              <Text style={exerciseStyles.exerciseEyebrow}>
                VOLUME CONTROL
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.liveCardVariant11}>
            <View style={exerciseStyles.rowBetween}>
              <View style={exerciseStyles.flex}>
                <Text style={exerciseStyles.cardTitle}>
                  Volume Stability
                </Text>

                <Text style={exerciseStyles.mutedSmallVariant1}>
                  Live consistency estimate
                </Text>
              </View>

              <Text style={exerciseStyles.stabilityValueVariant1}>
                {Math.round(clampedStability)}%
              </Text>
            </View>

            <View style={exerciseStyles.stabilityTrackVariant2}>
              <View
                style={[
                  exerciseStyles.stabilityFillVariant2,
                  {
                    width: `${clampedStability}%`,
                  },
                ]}
              />

              <View
                style={[
                  exerciseStyles.stabilityTargetMarker,
                  {
                    left: `${clampedTarget}%`,
                  },
                ]}
              />
            </View>

            <View style={exerciseStyles.scaleRow}>
              <Text style={exerciseStyles.scaleText}>
                Less steady
              </Text>

              <Text style={exerciseStyles.scaleText}>
                Target: {Math.round(targetStability)}%
              </Text>

              <Text style={exerciseStyles.scaleText}>
                More steady
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.liveCardVariant11}>
            <View style={exerciseStyles.liveCardHeaderVariant3}>
              <View style={exerciseStyles.liveIconCircle}>
                <Ionicons
                  name="volume-medium-outline"
                  size={18}
                  color={COLORS.accent}
                />
              </View>

              <View style={exerciseStyles.flex}>
                <Text style={exerciseStyles.cardTitle}>
                  Your Live Volume
                </Text>

                <Text style={exerciseStyles.mutedSmallVariant1}>
                  Relative microphone level
                </Text>
              </View>

              <View
                style={[
                  exerciseStyles.noteStatusBadge,
                  voiceDetected &&
                    exerciseStyles.noteStatusBadgeActive,
                ]}
              >
                <View
                  style={[
                    exerciseStyles.statusDot,
                    {
                      backgroundColor: voiceDetected
                        ? COLORS.guideGreen
                        : COLORS.muted,
                    },
                  ]}
                />

                <Text
                  style={[
                    exerciseStyles.noteStatusTextVariant1,
                    voiceDetected &&
                      exerciseStyles.statusTextSuccess,
                  ]}
                >
                  {voiceDetected
                    ? 'DETECTED'
                    : 'LISTENING'}
                </Text>
              </View>
            </View>

            <View style={exerciseStyles.liveVolumeRow}>
              <Text style={exerciseStyles.pageTitle}>
                {liveVolumeDisplay}
              </Text>

              <Text style={exerciseStyles.scoreDescriptionVariant2}>
                / 70 level
              </Text>
            </View>

            <View style={exerciseStyles.statusBadge}>
              <View
                style={[
                  exerciseStyles.statusDot,
                  {
                    backgroundColor: meetsLiveTarget
                      ? COLORS.guideGreen
                      : COLORS.muted,
                  },
                ]}
              />

              <Text
                style={[
                  exerciseStyles.statusText,
                  meetsLiveTarget &&
                    exerciseStyles.statusTextSuccess,
                ]}
              >
                {!voiceDetected
                  ? 'WAITING FOR YOUR VOICE'
                  : meetsLiveTarget
                    ? 'STEADY SO FAR'
                    : 'KEEP IT STEADY'}
              </Text>
            </View>

            <View style={exerciseStyles.resultDivider} />

            <View style={exerciseStyles.liveCardHeaderVariant3}>
              <View style={exerciseStyles.liveIconCircle}>
                <Ionicons
                  name="musical-note-outline"
                  size={18}
                  color={COLORS.accent}
                />
              </View>

              <View style={exerciseStyles.flex}>
                <Text style={exerciseStyles.cardTitle}>
                  Detected Note
                </Text>
              </View>
            </View>

            <View style={exerciseStyles.detectedNotePanel}>
              <Text
                style={[
                  exerciseStyles.detectedNote,
                  !voiceDetected &&
                    exerciseStyles.detectedNoteWaiting,
                ]}
              >
                {voiceDetected ? liveNote : '--'}
              </Text>

              <Text style={exerciseStyles.summaryLabel}>
                {voiceDetected &&
                livePitch !== null
                  ? `${livePitch.toFixed(1)} Hz`
                  : 'Waiting for a clear vocal sound'}
              </Text>
            </View>
          </View>
          <View style={exerciseStyles.progressTrackVariant7}>
              <View
                style={[
                  exerciseStyles.progressFill,
                  {
                    width: `${Math.min(
                      100,
                      overallProgress,
                    )}%`,
                  },
                ]}
              />
            </View>
        </View>

        {quitModal}
      </SafeAreaView>
    );
  }

  if (phase === 'processing') {
    return (
      <SafeAreaView style={exerciseStyles.screen}>
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing Your Performance"
          message="Measuring volume stability across all repetitions."
        />
        {quitModal}
      </SafeAreaView>
    );
  }

  const finalScore = score?.overallScore ?? 0;
  const stabilityScore = measurement?.stability ?? 0;
  const durationScore = measurement?.durationScore ?? 0;

  const voicedCoverage =
    measurement?.voicedCoveragePercent ?? 0;

  const resultPassed = score?.passed ?? false;

  const repStability =
    measurement?.repStability ?? [];

  const resultRows = [
    ...Array.from(
      { length: repetitions },
      (_, index) => {
        const value = repStability[index];

        return {
          label: `Repetition ${index + 1}`,
          value:
            value !== undefined &&
            Number.isFinite(value)
              ? `${Math.round(value)}%`
              : '--',
        };
      },
    ),
    {
      label: 'Volume Stability',
      value: `${Math.round(stabilityScore)}%`,
    },
    {
      label: 'Duration Score',
      value: `${Math.round(durationScore)}%`,
    },
    {
      label: 'Average microphone level',
      value:
        measurement?.averageDb !== undefined
          ? `${Math.max(
              0,
              Math.min(
                70,
                Math.round(
                  measurement.averageDb + 70,
                ),
              ),
            )}/70 relative level`
          : '--',
    },
    {
      label: 'Voiced Coverage',
      value: `${Math.round(voicedCoverage)}%`,
    },
    {
      label: 'Measurement Quality',
      value: `${Math.round(
        measurement?.measurementQuality ?? 0,
      )}%`,
    },
  ];

  return (
    <SafeAreaView style={exerciseStyles.screen}>
      <ExerciseResultsScreen
        title="Volume Stability Results"
        subtitle={
          score?.feedback ??
          'Your result reflects volume consistency and sustained vocal coverage during the recording.'
        }
        score={Math.round(finalScore)}
        scoreSuffix="/100"
        resultIcon={
          resultPassed
            ? 'checkmark-circle'
            : 'refresh-circle'
        }
        scoreMessage={
          resultPassed
            ? 'Exercise passed'
            : 'Keep practicing'
        }
        onRetry={resetExercise}
        onExit={() => {
          void pauseForExitPrompt();
        }}
>
  <View style={exerciseStyles.resultCardVariant4}>
    {resultRows.map((item, index) => (
      <View
        key={item.label}
        style={[
          exerciseStyles.resultRowVariant4,
          index === resultRows.length - 1 &&
            exerciseStyles.metricRowLast,
        ]}
      >
        <Text style={exerciseStyles.resultLabel}>
          {item.label}
        </Text>

        <Text style={exerciseStyles.resultValue}>
          {item.value}
        </Text>
      </View>
    ))}
  </View>
</ExerciseResultsScreen>

      {quitModal}
    </SafeAreaView>
  );
}
