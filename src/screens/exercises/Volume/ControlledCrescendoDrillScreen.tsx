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
import { CONTROLLED_CRESCENDO_PARAMS, type Tier } from '@/constants/params';
import { useAudioRecorder, type LiveAudioFrame } from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import type {
  ExerciseTierProps,
  RecordingExercisePhase,
} from '@/types/exercises';
import ExerciseScreen, {
    ExerciseCountdownScreen,
    ExercisePreparingScreen,
    ExerciseProcessingScreen,
    ExerciseResultsScreen,
} from '@/screens/exercises/ExerciseScreen';
import { generateControlledCrescendoParams } from '@/services/adaptiveDifficultyScaling/parameterGenerator';
import { getLatestAssessment } from '@/services/assessment/assessmentRepository';
import { auth } from '@/services/firebase/config';
import { measureControlledCrescendo } from '@/services/measurement/volume/controlledCrescendoDrill';
import { saveCompletedExercise } from '@/services/progress/exerciseProgressService';
import { fetchComponentProgress, fetchExerciseRecords } from '@/services/progress/progressRepo';
import { scoreControlledCrescendo } from '@/services/scoring/volume/controlledCrescendoDrill';
import { hasSufficientRecordedSignal } from '@/utils/audioSignal';
import {
    estimateVolumeRampSmoothness,
    normalizeVolumeDbfs,
} from '@/utils/dsp/volumeAnalysis';
import { clamp } from '@/utils/math';
import { playSingleNote } from '@/utils/music/notePlayer';
import { createMusicalNote, frequencyToMidi } from '@/utils/music/notes';

type ControlledCrescendoParams =
  typeof CONTROLLED_CRESCENDO_PARAMS.beginner;

type Phase = RecordingExercisePhase;

type ControlledCrescendoExerciseProps = ExerciseTierProps;

export default function ControlledCrescendoExercise({
  tier,
}: ControlledCrescendoExerciseProps) {
  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('instructions');

  const [isLoadingParams, setIsLoadingParams] = useState(true);
  const [resolvedTier, setResolvedTier] = useState<Tier>(
    tier ?? 'beginner',
  );

  const [params, setParams] = useState<ControlledCrescendoParams>(
    CONTROLLED_CRESCENDO_PARAMS.beginner,
  );

  const [referenceNote, setReferenceNote] = useState(() =>
    createMusicalNote(60),
  );

  const [hasPlayedReference, setHasPlayedReference] = useState(false);
  const [referencePlaybackError, setReferencePlaybackError] =
    useState<string | undefined>();
  const [referencePlaying, setReferencePlaying] = useState(false);

  const [currentRep, setCurrentRep] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [countdown, setCountdown] = useState(EXERCISE_COUNTDOWN_SECONDS);
  const [countdownReady, setCountdownReady] = useState(false);
  const [guideElapsed, setGuideElapsed] = useState(0);

  const [, setLiveAudioFrame] = useState<LiveAudioFrame | null>(null);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);

  const [smoothness, setSmoothness] = useState(0);
  const [repetitionResults, setRepetitionResults] = useState<number[]>([]);
  const [rangeReached, setRangeReached] = useState(false);

  const [startDb, setStartDb] = useState(0);
  const [endDb, setEndDb] = useState(0);
  const [minDb, setMinDb] = useState(0);
  const [maxDb, setMaxDb] = useState(0);

  const [errorMessage, setErrorMessage] = useState<
    string | undefined
  >();

  const [showQuitModal, setShowQuitModal] = useState(false);
  const [showNoAudioModal, setShowNoAudioModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const finishingRef = useRef(false);
  const completedNaturallyRef = useRef(false);
  const interRepStopRef = useRef(false);
  const repetitionSamplesRef = useRef<Float32Array[]>([]);
  const stoppedRepRef = useRef(1);
  const showNoAudioModalRef = useRef(false);

  const showQuitModalRef = useRef(false);
  const pausedRef = useRef(false);
  const quitInProgressRef = useRef(false);
  const discardInterruptedStopRef = useRef(false);
  const pausedPhaseRef = useRef<Phase>('instructions');

  const stopRecordingRef =
    useRef<(() => void | Promise<void>) | null>(null);

  const targetMin = params.targetDbRange[0];
  const targetMax = params.targetDbRange[1];
  const rampSeconds = params.durationSec;
  const repetitions = params.repetitions;
  const smoothnessTarget = params.smoothnessThreshold;

  const clearLiveState = useCallback(() => {
    setSeconds(0);
    setCurrentRep(1);
    setLiveAudioFrame(null);
    setLiveHistory([]);
  }, []);

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
          setHasPlayedReference(false);
          setReferencePlaybackError(undefined);
          setReferenceNote(createMusicalNote(midiNote));
        }
      } catch (assessmentError) {
        console.warn(
          'Unable to load the vocal range for Controlled Crescendo reference note:',
          assessmentError,
        );
      }
    }

    void loadReferenceNote();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initializeAdaptiveParams() {
      setIsLoadingParams(true);

      let currentTier: Tier = tier ?? 'beginner';

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

          if (cancelled) {
            return;
          }

          const matchingRecords = records
            .filter(
              record =>
                record.templateId === 'controlledCrescendo' &&
                record.tier === currentTier,
            )
            .sort((a, b) => a.timestamp - b.timestamp);

          recentScores = matchingRecords
            .slice(-5)
            .map(record => record.scorePct);
        }

        if (cancelled) {
          return;
        }

        if (recentScores.length === 0) {
          try {
            const assessment = await getLatestAssessment();

            if (cancelled) {
              return;
            }

            if (assessment) {
              const scores = assessment.scores as Array<{
                componentId?: string;
                score?: number;
                scorePct?: number;
              }>;

              const volumeScore = scores.find(
                score => score.componentId === 'volume',
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
              'Unable to load the Volume assessment for Controlled Crescendo:',
              assessmentError,
            );
          }
        }

        if (cancelled) {
          return;
        }

        const generatedParams = generateControlledCrescendoParams({
          tier: currentTier,
          recentScores,
        });

        if (cancelled) {
          return;
        }

        setParams(generatedParams);
        setRepetitionResults(Array(generatedParams.repetitions).fill(0));
      } catch (initializationError) {
        console.error(
          'Unable to initialize Controlled Crescendo parameters:',
          initializationError,
        );

        if (cancelled) {
          return;
        }

        const fallbackParams = CONTROLLED_CRESCENDO_PARAMS[currentTier];

        setResolvedTier(currentTier);
        setParams(fallbackParams);
        setRepetitionResults(Array(fallbackParams.repetitions).fill(0));
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

  const playReferenceNote = useCallback(async () => {
    if (referencePlaying || showQuitModalRef.current) {
      return false;
    }

    setReferencePlaying(true);
    setReferencePlaybackError(undefined);

    try {
      await playSingleNote(
        referenceNote.frequency,
        EXERCISE_REFERENCE_NOTE_DURATION_SECONDS,
      );

      setHasPlayedReference(true);
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

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    analyzePitch: false,
    onFrame: frame => {
      if (
        phaseRef.current !== 'recording' ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      setLiveAudioFrame(frame);

      const normalized = normalizeVolumeDbfs(
        frame.volume,
        VOLUME_DBFS_MIN,
        VOLUME_DBFS_MAX,
        true,
      );

      setLiveHistory(previous => {
        const next = [...previous, normalized];

        return next.length > VOLUME_RAMP_BAR_COUNT
          ? next.slice(-VOLUME_RAMP_BAR_COUNT)
          : next;
      });
    },

    onStop: (samples, sampleRate) => {
      if (discardInterruptedStopRef.current) {
        discardInterruptedStopRef.current = false;
        return;
      }

      if (interRepStopRef.current) {
        interRepStopRef.current = false;

        if (!hasSufficientRecordedSignal(samples)) {
          showNoAudioModalRef.current = true;
          setShowNoAudioModal(true);
          setCurrentRep(stoppedRepRef.current);
          setSeconds(0);
          setGuideElapsed(0);
          setCountdownReady(false);
          finishingRef.current = false;
          completedNaturallyRef.current = false;
          setPhase('countdown');
          return;
        }

        repetitionSamplesRef.current.push(samples);
        return;
      }

      if (
        !completedNaturallyRef.current ||
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      if (!hasSufficientRecordedSignal(samples)) {
        showNoAudioModalRef.current = true;
        setShowNoAudioModal(true);
        setCurrentRep(stoppedRepRef.current);
        setSeconds(0);
        setGuideElapsed(0);
        setCountdownReady(false);
        finishingRef.current = false;
        completedNaturallyRef.current = false;
        setPhase('countdown');
        return;
      }

      try {
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

        const measurement = measureControlledCrescendo(
          completeSamples,
          sampleRate,
          {
            windowMs: VOLUME_ANALYSIS_WINDOW_MS,
            targetRange: [targetMin, targetMax],
            expectedDurationSeconds: rampSeconds * repetitions,
            repetitions,
            volumeIncreaseThreshold:
              params.volumeIncreaseThreshold,
          },
        );

        const result = scoreControlledCrescendo(measurement, {
          passingScore: smoothnessTarget,
        });

        const finalScore = Math.round(result.overallScore);

        setSmoothness(finalScore);

        setRepetitionResults(
          measurement.repetitionSmoothness.map(
            value => Math.round(value),
          ),
        );

        setRangeReached(result.targetReached);

        setStartDb(Math.round(measurement.startDb * 10) / 10);
        setEndDb(Math.round(measurement.endDb * 10) / 10);
        setMinDb(Math.round(measurement.minDb * 10) / 10);
        setMaxDb(Math.round(measurement.maxDb * 10) / 10);

        setPhase('processing');

        void saveCompletedExercise(
          'volume',
          'controlledCrescendo',
          resolvedTier,
          finalScore,
        ).catch(saveError => {
          console.error(
            'Unable to save Controlled Crescendo result:',
            saveError,
          );
        });
      } catch (measurementError) {
        console.error(
          'Unable to measure Controlled Crescendo:',
          measurementError,
        );

        setErrorMessage(
          'We could not analyze this recording. Please try the recording again.',
        );

        setPhase('instructions');
      } finally {
        clearLiveState();
        finishingRef.current = false;
        completedNaturallyRef.current = false;
      }
    },
  });

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    if (phase !== 'recording' || showQuitModal) {
      return;
    }

    const startedAt = Date.now() - guideElapsed * 1000;

    const interval = setInterval(() => {
      if (
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      setGuideElapsed(
        Math.min((Date.now() - startedAt) / 1000, rampSeconds),
      );
    }, 50);

    return () => clearInterval(interval);
  }, [phase, currentRep, rampSeconds, showQuitModal]);

  useEffect(() => {
    if (phase !== 'recording' || showQuitModal) {
      return;
    }

    const interval = setInterval(() => {
      if (
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      setSeconds(previousSeconds =>
        Math.min(previousSeconds + 1, rampSeconds),
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, rampSeconds, showQuitModal]);

  useEffect(() => {
    if (
      phase !== 'recording' ||
      showQuitModal ||
      seconds < rampSeconds
    ) {
      return;
    }

    if (currentRep < repetitions) {
      if (finishingRef.current) {
        return;
      }

      finishingRef.current = true;
      stoppedRepRef.current = currentRep;
      interRepStopRef.current = true;
      setPhase('countdown');
      setCurrentRep(previousRep => previousRep + 1);
      setSeconds(0);
      setGuideElapsed(0);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      setCountdownReady(false);
      setLiveAudioFrame(null);
      setLiveHistory([]);

      void stopRecording()
        .then(() => {
          if (
            pausedRef.current ||
            showQuitModalRef.current ||
            showNoAudioModalRef.current ||
            quitInProgressRef.current
          ) {
            finishingRef.current = false;
            return;
          }

          finishingRef.current = false;
          setCountdownReady(true);
        })
        .catch(stopError => {
          console.error(
            'Unable to pause before the next Controlled Crescendo repetition:',
            stopError,
          );

          interRepStopRef.current = false;
          repetitionSamplesRef.current = [];
          finishingRef.current = false;

          setErrorMessage(
            'The recording could not continue. Please try again.',
          );

          setPhase('instructions');
        });

      return;
    }

    if (
      !finishingRef.current &&
      !completedNaturallyRef.current
    ) {
      finishingRef.current = true;
      completedNaturallyRef.current = true;
      stoppedRepRef.current = currentRep;

      void stopRecording().catch(stopError => {
        console.error(
          'Unable to finish Controlled Crescendo recording:',
          stopError,
        );

        finishingRef.current = false;
        completedNaturallyRef.current = false;
        repetitionSamplesRef.current = [];

        setErrorMessage(
          'The recording could not be completed. Please try again.',
        );

        setPhase('instructions');
      });
    }
  }, [
    phase,
    showQuitModal,
    seconds,
    currentRep,
    rampSeconds,
    repetitions,
    stopRecording,
    setPhase,
  ]);

  useEffect(() => {
    if (
      phase !== 'countdown' ||
      !countdownReady ||
      showQuitModal
    ) {
      return;
    }

    const timeout = setTimeout(() => {
      if (
        pausedRef.current ||
        showQuitModalRef.current ||
        quitInProgressRef.current
      ) {
        return;
      }

      if (countdown > 1) {
        setCountdown(value => value - 1);
        return;
      }

      setCountdownReady(false);

      setSeconds(0);
      setGuideElapsed(0);
      setLiveAudioFrame(null);
      setLiveHistory([]);

      completedNaturallyRef.current = false;
      setPhase('recording');

      void startRecording()
        .then(() => {
          if (
            pausedRef.current ||
            showQuitModalRef.current ||
            quitInProgressRef.current
          ) {
            return;
          }

          setPhase('recording');
        })
        .catch(recordingError => {
          console.error(
            'Unable to restart Controlled Crescendo recording:',
            recordingError,
          );

          repetitionSamplesRef.current = [];
          setErrorMessage(
            'Microphone recording could not restart. Please try again.',
          );

          setPhase('instructions');
        });
    }, 1000);

    return () => clearTimeout(timeout);
  }, [
    phase,
    countdown,
    countdownReady,
    showQuitModal,
    startRecording,
    setPhase,
  ]);

  const startExercise = useCallback(() => {
    if (quitInProgressRef.current) {
      return;
    }

    pausedRef.current = false;
    showQuitModalRef.current = false;
    discardInterruptedStopRef.current = false;
    quitInProgressRef.current = false;

    setShowQuitModal(false);
    setIsQuitting(false);
    setErrorMessage(undefined);
    setCurrentRep(1);
    setSeconds(0);
    setGuideElapsed(0);
    setSmoothness(0);
    setRepetitionResults(Array(repetitions).fill(0));
    setRangeReached(false);

    setStartDb(0);
    setEndDb(0);
    setMinDb(0);
    setMaxDb(0);

    setLiveAudioFrame(null);
    setLiveHistory([]);

    finishingRef.current = false;
    completedNaturallyRef.current = false;
    interRepStopRef.current = false;
    repetitionSamplesRef.current = [];
    stoppedRepRef.current = 1;
    showNoAudioModalRef.current = false;
    setShowNoAudioModal(false);

    setCountdown(EXERCISE_COUNTDOWN_SECONDS);
    setCountdownReady(true);
    setPhase('countdown');
  }, [repetitions, setPhase]);

  const pauseForExitPrompt = useCallback(() => {
    if (
      showQuitModalRef.current ||
      quitInProgressRef.current
    ) {
      return;
    }

    const currentPhase = phaseRef.current;

    pausedPhaseRef.current = currentPhase;
    pausedRef.current = true;
    showQuitModalRef.current = true;

    if (currentPhase === 'recording' && isRecording) {
      discardInterruptedStopRef.current = true;
      completedNaturallyRef.current = false;
      interRepStopRef.current = false;
      finishingRef.current = true;

      setLiveAudioFrame(null);
      setLiveHistory([]);

      try {
        void Promise.resolve(stopRecordingRef.current?.())
          .catch(stopError => {
            console.error(
              'Unable to stop Controlled Crescendo while paused:',
              stopError,
            );
          })
          .finally(() => {
            finishingRef.current = false;
          });
      } catch (stopError) {
        finishingRef.current = false;
        discardInterruptedStopRef.current = false;

        console.error(
          'Unable to stop Controlled Crescendo while paused:',
          stopError,
        );
      }

      setSeconds(0);
      setGuideElapsed(0);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      setCountdownReady(false);
    } else if (currentPhase === 'countdown') {
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      setCountdownReady(false);
    }

    setShowQuitModal(true);
  }, [isRecording]);

  const continueExercise = useCallback(() => {
    if (quitInProgressRef.current) {
      return;
    }

    showQuitModalRef.current = false;
    setShowQuitModal(false);
    pausedRef.current = false;

    const pausedPhase = pausedPhaseRef.current;

    if (pausedPhase === 'recording' || pausedPhase === 'countdown') {
      finishingRef.current = false;
      completedNaturallyRef.current = false;
      interRepStopRef.current = false;
      discardInterruptedStopRef.current = false;

      setSeconds(0);
      setGuideElapsed(0);
      setLiveAudioFrame(null);
      setLiveHistory([]);
      setCountdown(EXERCISE_COUNTDOWN_SECONDS);
      setCountdownReady(true);

      setPhase('countdown');
      return;
    }

  }, [setPhase]);

  const quitExercise = useCallback(async () => {
    if (quitInProgressRef.current) {
      return;
    }

    quitInProgressRef.current = true;
    pausedRef.current = true;
    showQuitModalRef.current = false;
    discardInterruptedStopRef.current = true;
    completedNaturallyRef.current = false;
    interRepStopRef.current = false;

    setIsQuitting(true);
    setShowQuitModal(false);

    finishingRef.current = true;
    repetitionSamplesRef.current = [];

    try {
      if (isRecording) {
        await Promise.resolve(stopRecordingRef.current?.());
      }
    } catch (stopError) {
      console.error(
        'Unable to stop Controlled Crescendo before leaving:',
        stopError,
      );
    } finally {
      router.replace('/exercises/volume');
    }
  }, [isRecording]);

  const handleBack = useCallback(() => {
    pauseForExitPrompt();
  }, [pauseForExitPrompt]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showQuitModalRef.current || quitInProgressRef.current) {
          return true;
        }

        handleBack();
        return true;
      },
    );

    return () => subscription.remove();
  }, [handleBack]);

  useEffect(() => {
    return () => {
      pausedRef.current = true;
      showQuitModalRef.current = false;
      discardInterruptedStopRef.current = true;
      completedNaturallyRef.current = false;
      interRepStopRef.current = false;
      repetitionSamplesRef.current = [];

      try {
        void Promise.resolve(stopRecordingRef.current?.()).catch(
          stopError => {
            console.error(
              'Unable to stop Controlled Crescendo during cleanup:',
              stopError,
            );
          },
        );
      } catch (stopError) {
        console.error(
          'Unable to stop Controlled Crescendo during cleanup:',
          stopError,
        );
      }
    };
  }, []);

  const tryAgain = useCallback(() => {
    startExercise();
  }, [startExercise]);

  useEffect(() => {
    if (phase !== 'processing') return;

    const timeout = setTimeout(() => {
      setPhase('results');
    }, 350);

    return () => clearTimeout(timeout);
  }, [phase, setPhase]);

  const quitModal = (
    <>
      <ExerciseQuitModal
        visible={showQuitModal}
        title={"Quit recording?"}
        message={pausedPhaseRef.current === 'instructions' ||
            pausedPhaseRef.current === 'results'
              ? 'Are you sure you want to leave Controlled Crescendo?'
              : pausedPhaseRef.current === 'recording'
                ? 'Your recording is paused. Completed repetitions will be kept, but you will restart the current repetition when you continue.'
                : 'Your recording is paused. Your completed repetitions will be kept. Continue when you are ready to resume.'}
        isQuitting={isQuitting}
        onContinue={continueExercise}
        onQuit={() => {
              void quitExercise();
            }}
        continueLabel={"Continue Exercise"}
        quitLabel={isQuitting ? 'Stopping...' : 'Quit Exercise'}
      />
      <ExerciseNoAudioModal
        visible={showNoAudioModal}
        onRedo={function redoExerciseRepetition() {
          showNoAudioModalRef.current = false;
          setShowNoAudioModal(false);
          pausedRef.current = false;
          showQuitModalRef.current = false;
          discardInterruptedStopRef.current = false;
          interRepStopRef.current = false;
          completedNaturallyRef.current = false;
          finishingRef.current = false;
          setCurrentRep(stoppedRepRef.current);
          setSeconds(0);
          setGuideElapsed(0);
          setLiveAudioFrame(null);
          setLiveHistory([]);
          setCountdown(EXERCISE_COUNTDOWN_SECONDS);
          setCountdownReady(true);
          setPhase('countdown');
        }}
        onQuit={() => {
          void quitExercise();
        }}
        isQuitting={isQuitting}
      />
    </>
  );

  if (isLoadingParams) {
    return (
      <>
        <ExercisePreparingScreen
          title="Preparing Your Exercise"
          message="Adjusting the recording to your current difficulty level and preparing your vocal range."
          icon="options-outline"
          iconSize={44}
        />
        {quitModal}
      </>
    );
  }

  const liveSmoothness = estimateVolumeRampSmoothness(
    liveHistory,
    VOLUME_DBFS_MIN,
    VOLUME_DBFS_MAX,
    'crescendo',
  );

  const instruction =
    seconds < 1
      ? {
          title: 'START SOFT',
          subtitle: 'Begin with a gentle voice',
        }
      : seconds < rampSeconds - 1
        ? {
            title: 'CRESCENDO',
            subtitle: 'Gradually increase your volume',
          }
        : {
            title: 'REACH TARGET',
            subtitle: 'Finish at the target loudness',
          };

  const passed = smoothness >= smoothnessTarget && rangeReached;

  if (phase === 'instructions') {
    return (
      <>
        <ExerciseScreen
          title="Controlled Crescendo"
          category="VOLUME CONTROL"
          icon="volume-high-outline"
          tier={resolvedTier}
          instructions={`1. Begin with a soft voice.
2. Gradually increase your volume.
3. Keep the increase smooth and even.
4. Reach the target volume.
5. Repeat the recording ${repetitions} times.`}
          summary={[
            {
              label: 'Reference note',
              value: referenceNote.name,
            },
            {
              label: 'Target range',
              value: `${targetMin} → ${targetMax} dB`,
            },
            {
              label: 'Duration per repetition',
              value: `${rampSeconds} seconds`,
            },
          ]}
          targetValue={`${targetMin} → ${targetMax} dB`}
          targetHint="Start softly and gradually increase your volume."
          repetitions={repetitions}
          tip="Sing the reference note while increasing your volume. Keep your pitch comfortable and avoid straining your voice."
          onBack={handleBack}
          onStart={startExercise}
          errorMessage={errorMessage}
          startLabel="Start Exercise"
        >
          <View style={exerciseStyles.referenceCard}>
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

            <Text style={exerciseStyles.referenceInstruction}>
              Play the note, then sing it while gradually increasing
              your volume from soft to loud.
            </Text>

            <TouchableOpacity
              style={[
                exerciseStyles.referenceButton,
                referencePlaying && exerciseStyles.disabled,
              ]}
              onPress={() => void playReferenceNote()}
              activeOpacity={0.85}
              disabled={referencePlaying || showQuitModal}
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

            {hasPlayedReference && (
              <View style={exerciseStyles.referenceReadyRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color="#39865B"
                />
                <Text style={exerciseStyles.referenceReadyText}>
                  Reference note played. You’re ready to begin.
                </Text>
              </View>
            )}

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
                    {
                      height: `${getVolumeRampTargetHeight(index, 'crescendo') * 80}%`,
                    },
                  ]}
                />
              ))}
            </View>

            <View style={exerciseStyles.previewLabels}>
              <Text style={exerciseStyles.scaleText}>Soft</Text>
              <Text style={exerciseStyles.scaleText}>Loud</Text>
            </View>
          </View>
        </ExerciseScreen>
        {quitModal}
      </>
    );
  }

  if (phase === 'countdown') {
    return (
      <>
        <ExerciseCountdownScreen
          icon="volume-high-outline"
          title="Get Ready"
          currentRep={currentRep}
          repetitions={repetitions}
          countdown={countdown}
          promptTitle={`Repetition ${currentRep} of ${repetitions}`}
          prompt="Take a breath. Begin softly when the countdown ends."

        />
        {quitModal}
      </>
    );
  }

  if (phase === 'recording') {
    return (
      <>
        <VolumeRampRecordingContent
          direction="crescendo"
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
        title="Controlled Crescendo"
        subtitle={
          passed
            ? 'Great job! Your crescendo was smooth and controlled.'
            : 'Keep practicing to make your volume increase smoother.'
        }
        score={smoothness}
        repetitionScores={repetitionResults.map((value, index) => ({
          repetition: index + 1,
          score: value,
          components: [
            { label: 'Smoothness', value: `${value}%` },
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
              label="Observed range"
              value={`${minDb} → ${maxDb} dB`}
              variant="crescendo"
            />
            <ResultItem
              label="Start → End"
              value={`${startDb} → ${endDb} dB`}
              variant="crescendo"
            />
            <ResultItem
              label="Target smoothness"
              value={`${smoothnessTarget}%`}
              variant="crescendo"
            />
            <ResultItem
              label="Difficulty tier"
              value={resolvedTier}
              variant="crescendo"
            />
          </View>
        }

        onRetry={tryAgain}
        onExit={handleBack}
      >
        <></>
      </ExerciseResultsScreen>
      {quitModal}
    </>
  );
}
