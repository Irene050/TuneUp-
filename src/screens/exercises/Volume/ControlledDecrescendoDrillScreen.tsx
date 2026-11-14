import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Text, TouchableOpacity, View } from 'react-native';

import { ExerciseNoAudioModal, ExerciseQuitModal } from '@/components/ExerciseModals';
import {
    getVolumeRampTargetHeight,
    ResultItem,
    VolumeRampRecordingContent,
} from '@/components/SharedVolumeComponent';
import { COLORS, EXERCISE_COUNTDOWN_SECONDS, EXERCISE_REFERENCE_NOTE_DURATION_SECONDS, VOLUME_ANALYSIS_WINDOW_MS, VOLUME_DBFS_MAX, VOLUME_DBFS_MIN, VOLUME_RAMP_BAR_COUNT } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { CONTROLLED_DECRESCENDO_PARAMS, type Tier } from '@/constants/params';
import { useAudioRecorder, type LiveAudioFrame } from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import type { ExerciseTierProps } from '@/types/exercises';
import ExerciseScreen, {
    ExerciseCountdownScreen,
    ExercisePreparingScreen,
    ExerciseProcessingScreen,
    ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateControlledDecrescendoParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureControlledDecrescendo } from '@/services/measurement/volume/controlledDecrescendoDrill';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreControlledDecrescendo } from '@/services/scoring/volume/controlledDecrescendoDrill';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import {
    estimateVolumeRampSmoothness,
    normalizeVolumeDbfs,
} from '@/utils/dsp/volumeAnalysis';
import { clamp } from '@/utils/math';
import { playSingleNote } from '@/utils/music/notePlayer';
import { createMusicalNote, frequencyToMidi } from '@/utils/music/notes';

type ControlledDecrescendoParams =
  typeof CONTROLLED_DECRESCENDO_PARAMS.beginner;

type Phase =
  | 'directions'
  | 'countdown'
  | 'repCountdown'
  | 'exercise'
  | 'processing'
  | 'results';

type ControlledDecrescendoExerciseProps = ExerciseTierProps;

export default function ControlledDecrescendoDrill({
  tier,
}: ControlledDecrescendoExerciseProps) {
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('directions');
  const [countdownSeconds, setCountdownSeconds] =
    useState(EXERCISE_COUNTDOWN_SECONDS);

  const [isLoadingParams, setIsLoadingParams] = useState(true);
  const [resolvedTier, setResolvedTier] = useState<Tier>(
    tier ?? 'beginner',
  );

  const [params, setParams] =
    useState<ControlledDecrescendoParams>(
      CONTROLLED_DECRESCENDO_PARAMS.beginner,
    );

  const [referenceNote, setReferenceNote] = useState(() =>
    createMusicalNote(60),
  );
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [referencePlaybackError, setReferencePlaybackError] =
    useState<string | undefined>();

  const [currentRep, setCurrentRep] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [guideElapsed, setGuideElapsed] = useState(0);

  const [, setLiveAudioFrame] = useState<LiveAudioFrame | null>(null);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);

  const [smoothness, setSmoothness] = useState(0);
  const [actualSmoothness, setActualSmoothness] = useState(0);
  const [repetitionScores, setRepetitionScores] = useState<number[]>([]);

  const [rangeReached, setRangeReached] = useState(false);
  const [directionCorrect, setDirectionCorrect] = useState(false);

  const [startDb, setStartDb] = useState(0);
  const [endDb, setEndDb] = useState(0);
  const [minDb, setMinDb] = useState(0);
  const [maxDb, setMaxDb] = useState(0);

  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const finishingRef = useRef(false);
  const completedNaturallyRef = useRef(false);
  const interRepStopRef = useRef(false);
  const discardInterruptedStopRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('directions');
  const quitInProgressRef = useRef(false);
  const repetitionSamplesRef = useRef<Float32Array[]>([]);

  useEffect(() => {
    showQuitModalRef.current = showQuitModal;
  }, [showQuitModal]);

  const targetMin = params.targetDbRange[0];
  const targetMax = params.targetDbRange[1];
  const rampSeconds = params.durationSec;
  const repetitions = params.repetitions;
  const smoothnessTarget = params.smoothnessThreshold;

  useEffect(() => {
    let cancelled = false;

    async function loadReferenceNote() {
      try {
        const assessment = await getLatestAssessment();

        if (!assessment || cancelled) {
          return;
        }

        const lowHz = Number(
          assessment.vocalRange?.lowHz ??
            assessment.vocalRangeLowHz ??
            0,
        );

        const highHz = Number(
          assessment.vocalRange?.highHz ??
            assessment.vocalRangeHighHz ??
            0,
        );

        if (
          !Number.isFinite(lowHz) ||
          !Number.isFinite(highHz) ||
          lowHz <= 0 ||
          highHz <= 0 ||
          lowHz > highHz
        ) {
          return;
        }

        const lowestMidi = Math.ceil(frequencyToMidi(lowHz));
        const highestMidi = Math.floor(frequencyToMidi(highHz));
        const centerFrequency = Math.sqrt(lowHz * highHz);

        let midiNote = Math.round(
          frequencyToMidi(centerFrequency),
        );

        if (lowestMidi <= highestMidi) {
          midiNote = clamp(midiNote, lowestMidi, highestMidi);
        }

        if (!cancelled) {
          setReferenceNote(createMusicalNote(midiNote));
        }
      } catch (assessmentError) {
        console.warn(
          'Unable to load the vocal range for Controlled Decrescendo:',
          assessmentError,
        );
      }
    }

    void loadReferenceNote();

    return () => {
      cancelled = true;
    };
  }, []);

  const playReferenceNote = useCallback(async () => {
    if (referencePlaying) {
      return false;
    }

    setReferencePlaying(true);
    setReferencePlaybackError(undefined);

    try {
      await playSingleNote(
        referenceNote.frequency,
        EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
      );
      return true;
    } catch (playbackError) {
      console.error(
        'Reference note playback failed:',
        playbackError,
      );

      setReferencePlaybackError(
        'Unable to play the reference note. Please try again.',
      );
      return false;
    } finally {
      setReferencePlaying(false);
    }
  }, [referenceNote, referencePlaying]);

  useEffect(() => {
    let cancelled = false;

    async function initializeAdaptiveParams() {
      let currentTier: Tier = tier ?? 'beginner';

      setIsLoadingParams(true);

      try {
        const user = auth.currentUser;

        if (user && !tier) {
          const progress = await fetchComponentProgress(
            user.uid,
            'volume',
          );

          if (progress?.currentTier) {
            currentTier = progress.currentTier;
          }
        }

        if (cancelled) {
          return;
        }

        setResolvedTier(currentTier);

        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'volume',
          );

          recentScores = records
            .filter(
              (record) =>
                record.templateId === 'controlledDecrescendo' &&
                record.tier === currentTier,
            )
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-5)
            .map((record) => record.scorePct);
        }

        if (cancelled) {
          return;
        }

        if (recentScores.length === 0) {
          try {
            const assessment = await getLatestAssessment();

            if (assessment) {
              const scores = assessment.scores as Array<{
                componentId?: string;
                score?: number;
                scorePct?: number;
              }>;

              const volumeScore = scores.find(
                (score) => score.componentId === 'volume',
              );

              const assessmentScore = Number(
                volumeScore?.scorePct ?? volumeScore?.score,
              );

              if (Number.isFinite(assessmentScore)) {
                recentScores = [assessmentScore];
              }
            }
          } catch (assessmentError) {
            console.warn(
              'Unable to load the Volume assessment for Controlled Decrescendo:',
              assessmentError,
            );
          }
        }

        const generatedParams = generateControlledDecrescendoParams({
          tier: currentTier,
          recentScores,
        });

        if (cancelled) {
          return;
        }

        setParams(generatedParams);
      } catch (initializationError) {
        console.error(
          'Unable to initialize Controlled Decrescendo parameters:',
          initializationError,
        );

        if (cancelled) {
          return;
        }

        const fallbackParams = CONTROLLED_DECRESCENDO_PARAMS[currentTier];

        setResolvedTier(currentTier);
        setParams(fallbackParams);
      } finally {
        if (!cancelled) {
          setIsLoadingParams(false);
        }
      }
    }

    void initializeAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  const clearLiveState = useCallback(() => {
    setSeconds(0);
    setGuideElapsed(0);
    setLiveAudioFrame(null);
    setLiveHistory([]);
  }, []);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    analyzePitch: false,
    onFrame: (frame) => {
      if (
        phaseRef.current !== 'exercise' ||
        showQuitModalRef.current
      ) {
        return;
      }

      setLiveAudioFrame(frame);

      const normalized = normalizeVolumeDbfs(
        frame.volume,
        VOLUME_DBFS_MIN,
        VOLUME_DBFS_MAX,
      );

      setLiveHistory((previous) => {
        const next = [...previous, normalized];

        return next.length > VOLUME_RAMP_BAR_COUNT
          ? next.slice(-VOLUME_RAMP_BAR_COUNT)
          : next;
      });
    },

    onStop: (samples, sampleRate) => {
      if (discardInterruptedStopRef.current) {
        discardInterruptedStopRef.current = false;
        clearLiveState();
        return;
      }

      if (interRepStopRef.current) {
        interRepStopRef.current = false;

        if (!hasSufficientRecordedSignal(samples)) {
          setShowNoAudioModal(true);
          setCountdownSeconds(EXERCISE_COUNTDOWN_SECONDS);
          finishingRef.current = false;
          completedNaturallyRef.current = false;
          clearLiveState();
          phaseRef.current = 'directions';
          setPhase('directions');
          return;
        }

        repetitionSamplesRef.current.push(samples);
        return;
      }

      if (!completedNaturallyRef.current) {
        repetitionSamplesRef.current = [];
        finishingRef.current = false;
        clearLiveState();
        return;
      }

      if (!hasSufficientRecordedSignal(samples)) {
        setShowNoAudioModal(true);
        setCountdownSeconds(EXERCISE_COUNTDOWN_SECONDS);
        finishingRef.current = false;
        completedNaturallyRef.current = false;
        clearLiveState();
        phaseRef.current = 'directions';
        setPhase('directions');
        return;
      }

      try {
        const samplesPerRep = Math.floor(rampSeconds * sampleRate);

        const recordedSegments = [
          ...repetitionSamplesRef.current,
          samples,
        ].slice(0, repetitions);

        const trimmedSegments = recordedSegments.map(
          (segment) => segment.slice(0, samplesPerRep),
        );

        const totalSampleCount = trimmedSegments.reduce(
          (total, segment) => total + segment.length,
          0,
        );

        const exerciseSamples = new Float32Array(totalSampleCount);
        let sampleOffset = 0;

        for (const segment of trimmedSegments) {
          exerciseSamples.set(segment, sampleOffset);
          sampleOffset += segment.length;
        }

        repetitionSamplesRef.current = [];

        const measurement = measureControlledDecrescendo(
  exerciseSamples,
  sampleRate,
  {
    windowMs: VOLUME_ANALYSIS_WINDOW_MS,
    targetRange: [targetMin, targetMax],
    expectedDurationSeconds: rampSeconds,
    repetitions,
    volumeDecreaseThreshold: params.volumeDecreaseThreshold,
  },
);

        const result = scoreControlledDecrescendo(measurement, {
          passingScore: smoothnessTarget,
        });

        const finalScore = Math.round(result.overallScore);

        setSmoothness(finalScore);
        setRepetitionScores(measurement.repSmoothness);
        setActualSmoothness(Math.round(measurement.smoothness));
        setRangeReached(result.targetReached);
        setDirectionCorrect(result.directionCorrect);

        setStartDb(Math.round(measurement.startDb * 10) / 10);
        setEndDb(Math.round(measurement.endDb * 10) / 10);
        setMinDb(Math.round(measurement.minDb * 10) / 10);
        setMaxDb(Math.round(measurement.maxDb * 10) / 10);

        phaseRef.current = 'processing';
        setPhase('processing');

        void saveCompletedExercise(
          'volume',
          'controlledDecrescendo',
          resolvedTier,
          finalScore,
        ).catch((saveError) => {
          console.error(
            'Unable to save Controlled Decrescendo result:',
            saveError,
          );
        });
      } catch (measurementError) {
        console.error(
          'Unable to measure Controlled Decrescendo:',
          measurementError,
        );

        setErrorMessage(
          'We could not analyze this recording. Please try the exercise again.',
        );

        phaseRef.current = 'directions';
        setPhase('directions');
      } finally {
        clearLiveState();
        finishingRef.current = false;
        completedNaturallyRef.current = false;
      }
    },
  });

  const openQuitModal = useCallback(() => {
    if (
      showQuitModalRef.current ||
      quitInProgressRef.current ||
      phaseRef.current === 'results'
    ) {
      return;
    }

    pausedPhaseRef.current = phaseRef.current;
    showQuitModalRef.current = true;
    setShowQuitModal(true);

    if (
      phaseRef.current === 'exercise' &&
      isRecording
    ) {
      discardInterruptedStopRef.current = true;
      interRepStopRef.current = false;
      completedNaturallyRef.current = false;
      finishingRef.current = false;

      void stopRecording().catch((stopError) => {
        discardInterruptedStopRef.current = false;

        console.error(
          'Unable to pause Controlled Decrescendo recording:',
          stopError,
        );
      });
    }
  }, [isRecording, stopRecording]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) {
      return;
    }

    const pausedPhase = pausedPhaseRef.current;

    showQuitModalRef.current = false;
    setShowQuitModal(false);

    if (pausedPhase === 'exercise') {
      setSeconds(0);
      setGuideElapsed(0);
      setLiveAudioFrame(null);
      setLiveHistory([]);
      setCountdownSeconds(EXERCISE_COUNTDOWN_SECONDS);

      phaseRef.current = 'countdown';
      setPhase('countdown');
      return;
    }

    if (
      pausedPhase === 'countdown' ||
      pausedPhase === 'repCountdown'
    ) {
      setCountdownSeconds(EXERCISE_COUNTDOWN_SECONDS);
      phaseRef.current = pausedPhase;
      setPhase(pausedPhase);
      return;
    }

  }, [setPhase, phaseRef]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) {
      return;
    }

    quitInProgressRef.current = true;
    setIsQuitting(true);

    completedNaturallyRef.current = false;
    interRepStopRef.current = false;
    discardInterruptedStopRef.current = false;
    repetitionSamplesRef.current = [];
    finishingRef.current = true;

    try {
      if (isRecording) {
        await stopRecording();
      }
    } catch (stopError) {
      console.error(
        'Unable to stop Controlled Decrescendo recording before quitting:',
        stopError,
      );
    } finally {
      clearLiveState();
      finishingRef.current = false;

      showQuitModalRef.current = false;
      setShowQuitModal(false);

      phaseRef.current = 'directions';

      router.replace('/exercises/volume');
    }
  }, [clearLiveState, isRecording, stopRecording]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current) {
          return true;
        }

        if (phaseRef.current === 'results') {
          return false;
        }

        openQuitModal();
        return true;
      },
    );

    return () => subscription.remove();
  }, [openQuitModal]);

  useEffect(() => {
    if (showQuitModal || phase !== 'exercise') {
      return;
    }

    const startedAt = Date.now() - guideElapsed * 1000;

    const interval = setInterval(() => {
      setGuideElapsed(
        Math.min((Date.now() - startedAt) / 1000, rampSeconds),
      );
    }, 50);

    return () => clearInterval(interval);
  }, [phase, currentRep, rampSeconds, showQuitModal]);

  useEffect(() => {
    if (
      showQuitModal ||
      phase !== 'repCountdown' ||
      !isRecording ||
      finishingRef.current
    ) {
      return;
    }

    interRepStopRef.current = true;

    void stopRecording().catch((stopError) => {
      interRepStopRef.current = false;
      repetitionSamplesRef.current = [];
      finishingRef.current = false;

      console.error(
        'Unable to save the Controlled Decrescendo repetition:',
        stopError,
      );

      setErrorMessage(
        'The repetition could not be recorded. Please try the exercise again.',
      );

      phaseRef.current = 'directions';
      setPhase('directions');
    });
  }, [phase, isRecording, showQuitModal, stopRecording]);

  useEffect(() => {
    if (
      showQuitModal ||
      (phase !== 'countdown' && phase !== 'repCountdown')
    ) {
      return;
    }

    let cancelled = false;

    setCountdownSeconds(EXERCISE_COUNTDOWN_SECONDS);

    const interval = setInterval(() => {
      setCountdownSeconds((previous) => {
        if (previous > 1) {
          return previous - 1;
        }

        clearInterval(interval);

        const isNextRepetition = phase === 'repCountdown';

        void (async () => {
          try {
            await startRecording();

            if (cancelled) {
              try {
                await stopRecording();
              } catch {
                // The effect has already been cancelled.
              }
              return;
            }

            if (isNextRepetition) {
              setCurrentRep((previousRep) =>
                Math.min(previousRep + 1, repetitions),
              );
            }

            setSeconds(0);
            setGuideElapsed(0);
            setLiveAudioFrame(null);
            setLiveHistory([]);

            phaseRef.current = 'exercise';
            setPhase('exercise');
          } catch (recordingError) {
            if (cancelled) {
              return;
            }

            console.error(
              'Unable to start Controlled Decrescendo recording:',
              recordingError,
            );

            repetitionSamplesRef.current = [];
            interRepStopRef.current = false;
            completedNaturallyRef.current = false;
            finishingRef.current = false;

            setErrorMessage(
              'Microphone recording could not start. Check microphone permission and try again.',
            );

            phaseRef.current = 'directions';
            setPhase('directions');
          }
        })();

        return 0;
      });
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    phase,
    phaseRef,
    showQuitModal,
    startRecording,
    stopRecording,
    repetitions,
  ]);

  useEffect(() => {
    if (showQuitModal || phase !== 'exercise') {
      return;
    }

    const interval = setInterval(() => {
      setSeconds((previousSeconds) => {
        if (previousSeconds + 1 < rampSeconds) {
          return previousSeconds + 1;
        }

        if (currentRep < repetitions) {
          phaseRef.current = 'repCountdown';
          setPhase('repCountdown');
          return rampSeconds;
        }

        if (
          !finishingRef.current &&
          !completedNaturallyRef.current
        ) {
          finishingRef.current = true;
          completedNaturallyRef.current = true;

          void stopRecording().catch((stopError) => {
            console.error(
              'Unable to finish Controlled Decrescendo recording:',
              stopError,
            );

            finishingRef.current = false;
            completedNaturallyRef.current = false;
            repetitionSamplesRef.current = [];

            setErrorMessage(
              'The recording could not be completed. Please try again.',
            );

            phaseRef.current = 'directions';
            setPhase('directions');
          });
        }

        return rampSeconds;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [
    phase,
    currentRep,
    rampSeconds,
    repetitions,
    showQuitModal,
    stopRecording,
  ]);

  const startExercise = useCallback(() => {
    setErrorMessage(undefined);

    setCurrentRep(1);
    setSeconds(0);
    setGuideElapsed(0);

    setSmoothness(0);
    setRepetitionScores([]);
    setActualSmoothness(0);

    setRangeReached(false);
    setDirectionCorrect(false);

    setStartDb(0);
    setEndDb(0);
    setMinDb(0);
    setMaxDb(0);

    setLiveAudioFrame(null);
    setLiveHistory([]);

    finishingRef.current = false;
    completedNaturallyRef.current = false;
    interRepStopRef.current = false;
    discardInterruptedStopRef.current = false;
    repetitionSamplesRef.current = [];

    pausedPhaseRef.current = 'countdown';
    quitInProgressRef.current = false;
    showQuitModalRef.current = false;
    setShowQuitModal(false);
    setIsQuitting(false);

    setCountdownSeconds(EXERCISE_COUNTDOWN_SECONDS);

    phaseRef.current = 'countdown';
    setPhase('countdown');
  }, [repetitions, setPhase, phaseRef]);

  const tryAgain = useCallback(() => {
    startExercise();
  }, [startExercise]);

  useEffect(() => {
    if (phase !== 'processing') return;

    const timeout = setTimeout(() => {
      phaseRef.current = 'results';
      setPhase('results');
    }, 350);

    return () => clearTimeout(timeout);
  }, [phase]);

  const liveSmoothness = estimateVolumeRampSmoothness(
    liveHistory,
    VOLUME_DBFS_MIN,
    VOLUME_DBFS_MAX,
    'decrescendo',
  );

  const instruction =
    seconds < 1
      ? {
          title: 'START LOUD',
          subtitle: 'Begin with a comfortable, steady voice',
        }
      : seconds < rampSeconds - 1
        ? {
            title: 'DECRESCENDO',
            subtitle: 'Gradually decrease your volume',
          }
        : {
            title: 'FINISH SOFT',
            subtitle: 'End softly without stopping abruptly',
          };

  const tierLabel =
    resolvedTier.charAt(0).toUpperCase() + resolvedTier.slice(1);

  const passed = smoothness >= smoothnessTarget;

  const quitModal = (
    <>
      <ExerciseQuitModal
        visible={showQuitModal}
        title="Quit exercise?"
        message="Your exercise is paused. Your completed repetitions will be kept. Continue to resume your exercise."
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => void quitExercise()}
        continueLabel="Continue Exercise"
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />
      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={function redoExerciseRepetition() {
          setShowNoAudioModal(false);
          interRepStopRef.current = false;
          discardInterruptedStopRef.current = false;
          completedNaturallyRef.current = false;
          finishingRef.current = false;
          setCountdownSeconds(EXERCISE_COUNTDOWN_SECONDS);
          clearLiveState();
          phaseRef.current = 'countdown';
          setPhase('countdown');
        }}
        onQuit={() => void quitExercise()}
        isQuitting={isQuitting}
      />
    </>
  );

  if (isLoadingParams) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the exercise to your current difficulty level and preparing your vocal volume targets."
          icon="options-outline"
          iconSize={44}
        />

        {quitModal}
      </>
    );
  }

  if (phase === 'directions') {
    return (
      <>
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
              value: referenceNote.name,
            },
            {
              label: 'Target range',
              value: `${targetMax} → ${targetMin} dB`,
            },
            {
              label: 'Duration per repetition',
              value: `${rampSeconds} seconds`,
            },
          ]}
          targetValue={`${targetMax} → ${targetMin} dB`}
          targetHint="Begin comfortably loud, then gradually lower your volume."
          repetitions={repetitions}
          tip="Sing the reference note while gradually reducing your volume. Keep your pitch steady and avoid letting the sound fade out too early."
          onBack={openQuitModal}
          onStart={startExercise}
          errorMessage={errorMessage}
          startLabel="Start Exercise"
        >
          <View style={exerciseStyles.referenceCard}>
            <View style={exerciseStyles.referenceTopRowVariant1}>
              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.eyebrow}>REFERENCE NOTE</Text>
                <Text style={[exerciseStyles.referenceNote, { lineHeight: 36 }]}>
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

            <Text style={exerciseStyles.referenceInstruction}>
              Play the note, then sing it while gradually decreasing your
              volume from loud to soft.
            </Text>

            <TouchableOpacity
              style={[
                exerciseStyles.referenceButton,
                referencePlaying && exerciseStyles.disabled,
              ]}
              onPress={() => void playReferenceNote()}
              activeOpacity={0.85}
              disabled={referencePlaying}
            >
              {referencePlaying ? (
                <ActivityIndicator size="small" color={COLORS.brown} />
              ) : (
                <Ionicons name="play" size={17} color={COLORS.brown} />
              )}

              <Text style={exerciseStyles.smallSemiBoldBrownText}>
                {referencePlaying
                  ? 'Playing...'
                  : `Play ${referenceNote.name}`}
              </Text>
            </TouchableOpacity>

            {referencePlaybackError && (
              <Text style={exerciseStyles.playbackError}>
                {referencePlaybackError}
              </Text>
            )}
          </View>

          <View style={exerciseStyles.previewCard}>
            <Text style={exerciseStyles.progressTime}>Follow this pattern</Text>

            <View style={exerciseStyles.previewVisualizer}>
              {Array.from({ length: VOLUME_RAMP_BAR_COUNT }, (_, index) => (
                <View
                  key={`preview-${index}`}
                  style={[
                    exerciseStyles.previewBar,
                    { height: `${getVolumeRampTargetHeight(index, 'decrescendo') * 80}%` },
                  ]}
                />
              ))}
            </View>

            <View style={exerciseStyles.previewLabels}>
              <Text style={exerciseStyles.scaleText}>Loud</Text>
              <Text style={exerciseStyles.scaleText}>Soft</Text>
            </View>
          </View>
        </ExerciseScreen>

        {quitModal}
      </>
    );
  }

  if (phase === 'countdown' || phase === 'repCountdown') {
    const isNextRepetition = phase === 'repCountdown';
    const upcomingRep = isNextRepetition
      ? Math.min(currentRep + 1, repetitions)
      : currentRep;

    return (
      <>
        <ExerciseCountdownScreen
          icon="volume-low-outline"
          title="Get Ready"
          currentRep={upcomingRep}
          repetitions={repetitions}
          countdown={countdownSeconds}
          promptTitle={
            isNextRepetition
              ? `Get ready for repetition ${upcomingRep}`
              : 'Get ready to begin'
          }
          prompt={
            isNextRepetition
              ? 'Take a breath. Begin loudly, then gradually lower your volume.'
              : 'Prepare your voice. Begin comfortably loud when the countdown ends.'
          }

        />

        {quitModal}
      </>
    );
  }

  if (phase === 'exercise') {
    return (
      <>
        <VolumeRampRecordingContent
          direction="decrescendo"
          instruction={instruction}
          liveHistory={liveHistory}
          seconds={seconds}
          guideElapsed={guideElapsed}
          durationSeconds={rampSeconds}
          currentRep={currentRep}
          repetitions={repetitions}
          liveSmoothness={liveSmoothness}
        />

        {quitModal}
      </>
    );
  }

  if (phase === 'processing') {
    return (
      <>
        <ExerciseProcessingScreen
          icon="analytics-outline"
          title="Analyzing Your Performance"
          message="Measuring your volume control across all repetitions."
        />
        {quitModal}
      </>
    );
  }

  return (
    <>
      <ExerciseResultsScreen
        title="Controlled Decrescendo"
        subtitle={
          passed
            ? 'Great job! Your decrescendo was smooth and controlled.'
            : 'Keep practicing to make your volume decrease more smoothly.'
        }
        score={smoothness}
        repetitionScores={repetitionScores.map((repetitionScore, index) => ({
          repetition: index + 1,
          score: repetitionScore,
          components: [
            {
              label: 'Smoothness',
              value: `${Math.round(repetitionScore)}%`,
            },
          ],
        }))}
        scoreSuffix="%"
        scoreMessage={passed ? 'Exercise Passed' : 'Needs More Practice'}
        resultIcon={
          passed
            ? 'checkmark-circle-outline'
            : 'refresh-circle-outline'
        }
        scoreDetails={
          <View style={exerciseStyles.referenceCard}>
            <ResultItem
              label="Direction correct"
              value={directionCorrect ? 'Yes' : 'No'}
              variant="decrescendo"
            />
            <ResultItem
              label="Target range reached"
              value={rangeReached ? 'Yes' : 'No'}
              variant="decrescendo"
            />
            <ResultItem
              label="Observed range"
              value={`${minDb} → ${maxDb} dBFS`}
              variant="decrescendo"
            />
            <ResultItem
              label="Start → End"
              value={`${startDb} → ${endDb} dBFS`}
              variant="decrescendo"
            />
            <ResultItem
              label="Actual smoothness"
              value={`${actualSmoothness}%`}
              variant="decrescendo"
            />
            <ResultItem
              label="Target smoothness"
              value={`${smoothnessTarget}%`}
              variant="decrescendo"
            />
            <ResultItem
              label="Difficulty tier"
              value={tierLabel}
              variant="decrescendo"
            />
          </View>
        }

        onRetry={tryAgain}
        onExit={() => router.replace('/exercises/volume')}
      >
        <></>
      </ExerciseResultsScreen>

      {quitModal}
    </>
  );
}
