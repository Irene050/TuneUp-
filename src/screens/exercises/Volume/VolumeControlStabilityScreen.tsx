import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  VOLUME_CONTROL_STABILITY_PARAMS,
  type Tier,
} from '@/constants/volume';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import ExerciseScreen, {
  ExerciseCountdownScreen,
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

const CURRENT_TIER: Tier = 'beginner';

const DEFAULT_PARAMS =
  VOLUME_CONTROL_STABILITY_PARAMS[CURRENT_TIER];

const DEFAULT_REFERENCE_MIDI = 60;
const REFERENCE_NOTE_DURATION_SEC = 1.5;
const COUNTDOWN_SECONDS = 3;
const MAX_LIVE_HISTORY = 40;
const MIN_VOICE_CLARITY = 0.45;

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const BORDER = '#F2DDE5';
const ACCENT = '#D86C89';
const MUTED = '#8E7770';
const SOFT_TEXT = '#765D63';
const WHITE = '#FFFFFF';
const GUIDE_GREEN = '#278451';
const SUCCESS_BG = '#EFF8F2';

type Phase =
  | 'directions'
  | 'countdown'
  | 'exercise'
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
  const [phase, setPhase] =
    useState<Phase>('directions');

  const [referenceMidi, setReferenceMidi] =
    useState(DEFAULT_REFERENCE_MIDI);

  const NOTE = midiToNoteName(referenceMidi);
  const REFERENCE_NOTE = createMusicalNote(referenceMidi);

  const [countdown, setCountdown] =
    useState(COUNTDOWN_SECONDS);

  const [remainingSeconds, setRemainingSeconds] =
    useState(
      DEFAULT_PARAMS.durationSec *
        DEFAULT_PARAMS.repetitions,
    );

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

  const [resolvedTier, setResolvedTier] =
    useState<Tier>(tier ?? CURRENT_TIER);

  const [exerciseParams, setExerciseParams] =
    useState(DEFAULT_PARAMS);

  const [paramsReady, setParamsReady] =
    useState(false);

  const [showQuitModal, setShowQuitModal] =
    useState(false);

  const [isQuitting, setIsQuitting] =
    useState(false);

  const [isPausing, setIsPausing] =
    useState(false);

  const liveHistoryRef = useRef<number[]>([]);
  const mountedRef = useRef(true);

  const exerciseStartedAtRef =
    useRef<number | null>(null);

  const recordingFinishedRef = useRef(false);

  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);

  const pausedPhaseRef =
    useRef<Phase>('directions');

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
      } catch (error) {
        console.warn(
          'Unable to load assessed vocal range for reference note:',
          error,
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

        let selectedTier: Tier =
          tier ?? CURRENT_TIER;

        let recentScores: number[] = [];

        if (user) {
          if (!tier) {
            const progress =
              await fetchComponentProgress(
                user.uid,
                'volume',
              );

            selectedTier =
              progress?.currentTier ??
              CURRENT_TIER;
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
                a.timestamp - b.timestamp,
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
        setParamsReady(true);
      } catch (error) {
        console.error(
          'Failed to load Volume Control Stability parameters:',
          error,
        );

        if (cancelled) {
          return;
        }

        const fallbackTier =
          tier ?? CURRENT_TIER;

        setResolvedTier(fallbackTier);

        setExerciseParams(
          VOLUME_CONTROL_STABILITY_PARAMS[
            fallbackTier
          ],
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
          REFERENCE_NOTE_DURATION_SEC,
        ),
        new Promise<void>((resolve) => {
          setTimeout(
            resolve,
            REFERENCE_NOTE_DURATION_SEC * 1000 +
              300,
          );
        }),
      ]);
    } catch (error) {
      console.error(
        `${NOTE} reference playback error:`,
        error,
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

  const { startRecording, stopRecording } =
    useAudioRecorder({
      onFrame: (frame) => {
        if (
          !mountedRef.current ||
          phase !== 'exercise' ||
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

        const measured =
          measureVolumeControlStability(
            samples,
            sampleRate,
            durationSeconds,
            repetitions,
          );

        const scored =
          scoreVolumeControlStability(
            measured,
            {
              passingScore: targetStability,
            },
          );

        setMeasurement(measured);
        setScore(scored);
        setPhase('results');

        void saveCompletedExercise(
          'volume',
          'volumeControlStability',
          resolvedTier,
          scored.overallScore,
        ).catch((error) => {
          console.error(
            'Unable to save completed exercise:',
            error,
          );
        });
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
        } catch (error) {
          console.warn(
            'Unable to stop recording after interruption:',
            error,
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

      setRemainingSeconds(totalExerciseSeconds);
      setPhase('exercise');
    } catch (error) {
      console.error(
        'Unable to start recording:',
        error,
      );

      if (
        !mountedRef.current ||
        pausedRef.current ||
        showQuitModalRef.current
      ) {
        return;
      }

      setPhase('directions');

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

    setCountdown(COUNTDOWN_SECONDS);

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
      phase !== 'exercise' ||
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

      const elapsed =
        (Date.now() - startedAt) / 1000;

      const remaining = Math.max(
        0,
        Math.ceil(
          totalExerciseSeconds - elapsed,
        ),
      );

      setRemainingSeconds(remaining);

      if (elapsed >= totalExerciseSeconds) {
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

    recordingFinishedRef.current = false;
    exerciseStartedAtRef.current = null;

    liveHistoryRef.current = [];

    setLiveVolume(-60);
    setLiveStability(0);
    setLivePitch(null);
    setLiveNote('--');

    setRemainingSeconds(totalExerciseSeconds);
    setCountdown(COUNTDOWN_SECONDS);
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
    totalExerciseSeconds,
  ]);

  const resetExercise = useCallback(() => {
    setMeasurement(null);
    setScore(null);

    setLiveVolume(-60);
    setLiveStability(0);
    setLivePitch(null);
    setLiveNote('--');

    liveHistoryRef.current = [];

    setRemainingSeconds(totalExerciseSeconds);
    setCountdown(COUNTDOWN_SECONDS);
    setReferenceError(null);

    recordingFinishedRef.current = false;
    exerciseStartedAtRef.current = null;

    setPhase('directions');
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

    if (phase === 'exercise') {
      setIsPausing(true);

      recordingFinishedRef.current = true;
      exerciseStartedAtRef.current = null;
      pauseStopPendingRef.current = true;

      try {
        await stopRecording();
      } catch (error) {
        console.warn(
          'Unable to stop recording while opening quit modal:',
          error,
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

    if (previousPhase === 'exercise') {
      setMeasurement(null);
      setScore(null);

      liveHistoryRef.current = [];

      setLiveVolume(-60);
      setLiveStability(0);
      setLivePitch(null);
      setLiveNote('--');

      setRemainingSeconds(totalExerciseSeconds);
      setCountdown(COUNTDOWN_SECONDS);
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

    if (pausedPhaseRef.current === 'exercise') {
      pauseStopPendingRef.current = true;

      try {
        await stopRecording();
      } catch (error) {
        console.warn(
          'Unable to stop recording while quitting:',
          error,
        );
      } finally {
        pauseStopPendingRef.current = false;
      }
    }

    router.replace('/dashboard?tab=exercises' as any);
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

          <Text style={styles.modalTitle}>
            Quit exercise?
          </Text>

          <Text style={styles.modalMessage}>
            {pausedPhaseRef.current === 'exercise'
              ? 'Your recording has been stopped. If you continue, this exercise will restart from the countdown.'
              : pausedPhaseRef.current === 'countdown'
                ? 'Your exercise is paused. Continue when you are ready to start the countdown again.'
                : 'Are you sure you want to leave this exercise?'}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue exercise"
            disabled={isQuitting || isPausing}
            onPress={continueExercise}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.buttonPressed,
              (isQuitting || isPausing) &&
                styles.buttonDisabled,
            ]}
          >
            <Text style={styles.continueButtonText}>
              {isPausing
                ? 'Pausing...'
                : 'Continue Exercise'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
            disabled={isQuitting || isPausing}
            onPress={() => {
              void quitExercise();
            }}
            style={({ pressed }) => [
              styles.quitButton,
              pressed && styles.buttonPressed,
              (isQuitting || isPausing) &&
                styles.buttonDisabled,
            ]}
          >
            <Text style={styles.quitButtonText}>
              {isQuitting
                ? 'Stopping...'
                : 'Quit Exercise'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  if (!paramsReady) {
    return (
      <View style={styles.preparingScreen}>
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
          Adjusting the exercise to your current
          difficulty level and preparing your vocal range.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />

        {quitModal}
      </View>
    );
  }

  if (phase === 'directions') {
    return (
      <SafeAreaView style={styles.safeArea}>
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
          onStart={startExercise}
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
          error={referenceError}
        >
          <View style={styles.referenceCard}>
            <View style={styles.referenceTopRow}>
              <View style={styles.referenceCopy}>
                <Text style={styles.referenceLabel}>
                  OPTIONAL REFERENCE NOTE
                </Text>

                <Text style={styles.referenceNote}>
                  {NOTE}
                </Text>
              </View>

              <View style={styles.noteIconCircle}>
                <Ionicons
                  name="musical-note"
                  size={22}
                  color={BROWN}
                />
              </View>
            </View>

            <Text style={styles.referenceInstruction}>
              Play the note if you want a pitch guide.
              You can start the exercise without playing it.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Play ${NOTE} reference note`}
              style={[
                styles.referenceButton,
                referencePlaying && styles.disabled,
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
                color={BROWN}
              />

              <Text style={styles.referenceButtonText}>
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

  if (phase === 'countdown') {
    return (
      <SafeAreaView style={styles.safeArea}>
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

  if (phase === 'exercise') {
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
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.exerciseScreen}>
          <View style={styles.exerciseHeader}>
            <View style={styles.exerciseHeaderText}>
              <Text style={styles.exerciseTitle}>
                Volume Stability
              </Text>

              <Text style={styles.exerciseEyebrow}>
                VOLUME CONTROL
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open quit exercise confirmation"
              hitSlop={10}
              style={styles.exerciseExitButton}
              onPress={() => {
                void pauseForExitPrompt();
              }}
            >
              <Ionicons
                name="close"
                size={22}
                color={BROWN}
              />
            </Pressable>
          </View>

          <View style={styles.singingPrompt}>
            <Text style={styles.singingPromptTitle}>
              Keep your voice steady
            </Text>

            <Text style={styles.singingPromptText}>
              Sing {NOTE} on “Ah” at a comfortable
              volume. Keep your volume as consistent as
              possible throughout the exercise.
            </Text>
          </View>

          <View style={styles.liveCard}>
            <View style={styles.rowBetween}>
              <View style={styles.stabilityHeading}>
                <Text style={styles.cardTitle}>
                  Volume Stability
                </Text>

                <Text style={styles.mutedSmall}>
                  Live consistency estimate
                </Text>
              </View>

              <Text style={styles.stabilityValue}>
                {Math.round(clampedStability)}%
              </Text>
            </View>

            <View style={styles.stabilityTrack}>
              <View
                style={[
                  styles.stabilityFill,
                  {
                    width: `${clampedStability}%`,
                  },
                ]}
              />

              <View
                style={[
                  styles.stabilityTargetMarker,
                  {
                    left: `${clampedTarget}%`,
                  },
                ]}
              />
            </View>

            <View style={styles.scaleRow}>
              <Text style={styles.scaleText}>
                Less steady
              </Text>

              <Text style={styles.scaleText}>
                Target: {Math.round(targetStability)}%
              </Text>

              <Text style={styles.scaleText}>
                More steady
              </Text>
            </View>
          </View>

          <View style={styles.liveCard}>
            <View style={styles.liveCardHeader}>
              <View style={styles.liveIconCircle}>
                <Ionicons
                  name="volume-medium-outline"
                  size={18}
                  color={ACCENT}
                />
              </View>

              <View style={styles.liveCardHeading}>
                <Text style={styles.cardTitle}>
                  Your Live Volume
                </Text>

                <Text style={styles.mutedSmall}>
                  Relative microphone level
                </Text>
              </View>

              <View
                style={[
                  styles.noteStatusBadge,
                  voiceDetected &&
                    styles.noteStatusBadgeActive,
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: voiceDetected
                        ? GUIDE_GREEN
                        : MUTED,
                    },
                  ]}
                />

                <Text
                  style={[
                    styles.noteStatusText,
                    voiceDetected &&
                      styles.statusTextSuccess,
                  ]}
                >
                  {voiceDetected
                    ? 'DETECTED'
                    : 'LISTENING'}
                </Text>
              </View>
            </View>

            <View style={styles.liveVolumeRow}>
              <Text style={styles.liveVolume}>
                {liveVolumeDisplay}
              </Text>

              <Text style={styles.liveUnit}>
                / 70 level
              </Text>
            </View>

            <View style={styles.statusBadge}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: meetsLiveTarget
                      ? GUIDE_GREEN
                      : MUTED,
                  },
                ]}
              />

              <Text
                style={[
                  styles.statusText,
                  meetsLiveTarget &&
                    styles.statusTextSuccess,
                ]}
              >
                {!voiceDetected
                  ? 'WAITING FOR YOUR VOICE'
                  : meetsLiveTarget
                    ? 'STEADY SO FAR'
                    : 'KEEP IT STEADY'}
              </Text>
            </View>

            <View style={styles.liveSectionDivider} />

            <View style={styles.liveCardHeader}>
              <View style={styles.liveIconCircle}>
                <Ionicons
                  name="musical-note-outline"
                  size={18}
                  color={ACCENT}
                />
              </View>

              <View style={styles.liveCardHeading}>
                <Text style={styles.cardTitle}>
                  Detected Note
                </Text>
              </View>
            </View>

            <View style={styles.detectedNotePanel}>
              <Text
                style={[
                  styles.detectedNote,
                  !voiceDetected &&
                    styles.detectedNoteWaiting,
                ]}
              >
                {voiceDetected ? liveNote : '--'}
              </Text>

              <Text style={styles.detectedFrequency}>
                {voiceDetected &&
                livePitch !== null
                  ? `${livePitch.toFixed(1)} Hz`
                  : 'Waiting for a clear vocal sound'}
              </Text>
            </View>
          </View>

          <View style={styles.progressCard}>
            <View style={styles.rowBetween}>
              <Text style={styles.mutedSmall}>
                    Repetition{' '}
                    {Math.min(
                      repetitions,
                      Math.floor(elapsedTotal / durationSeconds) + 1,
                    )}{' '}
                    of {repetitions}
              </Text>
              <Text style={styles.progressTime}>
                {Math.ceil(remainingSeconds)}s total left
              </Text>
            </View>

            <View style={styles.exerciseProgressTrack}>
              <View
                style={[
                  styles.exerciseProgressFill,
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
        </View>

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
    <SafeAreaView style={styles.safeArea}>
      <ExerciseResultsScreen
        title="Volume Stability Results"
        subtitle={
          score?.feedback ??
          'Your result reflects volume consistency and sustained vocal coverage during the exercise.'
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
  <View style={styles.resultCard}>
    {resultRows.map((item, index) => (
      <View
        key={item.label}
        style={[
          styles.resultRow,
          index === resultRows.length - 1 &&
            styles.lastResultRow,
        ]}
      >
        <Text style={styles.resultLabel}>
          {item.label}
        </Text>

        <Text style={styles.resultValue}>
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: WHITE,
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
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 2,
  },
  exerciseHeaderText: {
    flex: 1,
  },
  exerciseExitButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
    borderWidth: 1,
    borderColor: BORDER,
  },
  exerciseEyebrow: {
    color: ACCENT,
    fontFamily: 'FredokaBold',
    fontSize: 9,
    letterSpacing: 1,
  },
  exerciseTitle: {
    marginTop: 2,
    color: BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 21,
  },
  singingPrompt: {
    marginTop: 20,
    alignItems: 'center',
    padding: 14,
    borderRadius: 17,
    backgroundColor: WHITE,
  },
  singingPromptTitle: {
    color: BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 18,
    textAlign: 'center',
  },
  singingPromptText: {
    marginTop: 5,
    color: SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.55,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
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
  referenceCard: {
    marginTop: 12,
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
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
  referenceLabel: {
    color: MUTED,
    fontFamily: 'FredokaBold',
    fontSize: 10,
    letterSpacing: 1,
  },
  referenceNote: {
    marginTop: 2,
    color: BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 28,
  },
  noteIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
  },
  referenceInstruction: {
    marginTop: 7,
    color: SOFT_TEXT,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
  },
  referenceButton: {
    minHeight: 43,
    marginTop: 11,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  referenceButtonText: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 13,
  },
  liveCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
    marginBottom: 14,
  },
  liveCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  liveIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_PINK,
  },
  liveCardHeading: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
  },
  mutedSmall: {
    marginTop: 3,
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 14,
  },
  liveVolumeRow: {
    width: '100%',
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
  },
  liveVolume: {
    color: BROWN,
    fontFamily: 'FredokaBold',
    fontSize: 30,
    textAlign: 'center',
  },
  liveUnit: {
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    textAlign: 'center',
  },
  statusBadge: {
    alignSelf: 'center',
    minHeight: 25,
    marginTop: 7,
    paddingHorizontal: 9,
    borderRadius: 13,
    backgroundColor: LIGHT_PINK,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: MUTED,
  },
  statusText: {
    color: SOFT_TEXT,
    fontFamily: 'FredokaBold',
    fontSize: 9,
    letterSpacing: 0.25,
  },
  statusTextSuccess: {
    color: GUIDE_GREEN,
  },
  liveSectionDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },
  stabilityHeading: {
    flex: 1,
    minWidth: 0,
  },
  stabilityValue: {
    color: ACCENT,
    fontFamily: 'FredokaBold',
    fontSize: 30,
  },
  stabilityTrack: {
    height: 14,
    marginTop: 11,
    borderRadius: 6,
    backgroundColor: LIGHT_PINK,
    overflow: 'hidden',
    position: 'relative',
  },
  stabilityFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: ACCENT,
  },
  stabilityTargetMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: BROWN,
  },
  scaleRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  scaleText: {
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 9,
  },
  noteStatusBadge: {
    flexShrink: 0,
    minHeight: 23,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: '#F5F2F2',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  noteStatusBadgeActive: {
    backgroundColor: SUCCESS_BG,
  },
  noteStatusText: {
    color: MUTED,
    fontFamily: 'FredokaBold',
    fontSize: 8,
    letterSpacing: 0.2,
  },
  detectedNotePanel: {
    marginTop: 10,
    paddingVertical: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
  },
  detectedNote: {
    color: ACCENT,
    fontFamily: 'FredokaBold',
    fontSize: 34,
    lineHeight: 40,
  },
  detectedNoteWaiting: {
    color: '#B9A7A3',
  },
  detectedFrequency: {
    marginTop: 2,
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    textAlign: 'center',
  },
  progressCard: {
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 15,
    backgroundColor: WHITE,
  },
  progressTime: {
    color: BROWN,
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
  },
  exerciseProgressTrack: {
    height: 7,
    marginTop: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_PINK,
    overflow: 'hidden',
  },
  exerciseProgressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: ACCENT,
  },
  progressHint: {
    marginTop: 4,
    color: MUTED,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
  },
  resultCard: {
    width: '100%',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
  },
  resultRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F4E9EC',
    gap: 10,
    paddingVertical: 5,
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
});