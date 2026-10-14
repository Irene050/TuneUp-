import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  SCALE_ACCURACY_PARAMS,
  type ScaleAccuracyParams,
  type Tier,
} from '@/constants/exercises/pitch';

import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';

import {
  measureScaleAccuracyDrill,
} from '@/services/measurement/pitch/scaleAccuracyDrill';

import {
  scoreScaleAccuracyDrill,
  type ScaleAccuracyScoreResult,
} from '@/services/scoring/pitch/scaleAccuracyDrill';

import {
  disposeNotePlayer,
  playNoteSequence,
} from '@/utils/music/notePlayer';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  getRandomScale,
  type VocalRange,
} from '@/utils/music/notes';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  generateScaleAccuracyParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  calcLiveStability,
  calcPitchAccuracy,
  frequencyToNote,
  segmentIntoNotes,
} from '@/utils/dsp/pitch';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import { auth } from '@/services/firebase/config';

import ExerciseScreen, {
  ExerciseCountdownScreen,
  ExerciseListeningScreen,
  ExerciseProcessingScreen,
  ExerciseResultsScreen,
} from '../ExerciseScreen';

// ============================================================
// COLORS
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

// ============================================================
// TYPES
// ============================================================

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'results';

interface SavedRecording {
  samples: Float32Array;
  sampleRate: number;
}

// ============================================================
// SCALE GENERATION
// ============================================================

function generateScale(
  params: ScaleAccuracyParams,
  currentTier: Tier,
  vocalRange: VocalRange | null,
) {
  const noteCount = Math.min(
    Math.max(1, Math.round(params.noteCount)),
    8,
  );

  return getRandomScale(
    currentTier,
    noteCount,
    vocalRange,
  );
}

// ============================================================
// RESULT AGGREGATION
// ============================================================

function average(values: number[]): number {
  const validValues = values.filter(Number.isFinite);

  if (validValues.length === 0) {
    return 0;
  }

  return (
    validValues.reduce((sum, value) => sum + value, 0) /
    validValues.length
  );
}

function aggregateScaleResults(
  results: ScaleAccuracyScoreResult[],
  targetFreqs: number[],
): ScaleAccuracyScoreResult {
  if (results.length === 0) {
    return {
      score: 0,
      passed: false,
      noteAccuracy: 0,
      transitionSmoothness: 0,
      correctNotes: 0,
      totalNotes: targetFreqs.length,
      detectedFreqs: targetFreqs.map(() => 0),
      targetFreqs,
      noteScores: targetFreqs.map(() => 0),
      noteDeviations: targetFreqs.map(() => 100),
      averageClarity: 0,
      voicedNotes: 0,
    };
  }

  return {
    score: Math.round(
      average(results.map(item => item.score)),
    ),

    passed: results.every(item => item.passed),

    noteAccuracy: average(
      results.map(item => item.noteAccuracy),
    ),

    transitionSmoothness: average(
      results.map(item => item.transitionSmoothness),
    ),

    correctNotes: results.reduce(
      (sum, item) => sum + item.correctNotes,
      0,
    ),

    totalNotes: results.reduce(
      (sum, item) => sum + item.totalNotes,
      0,
    ),

    detectedFreqs: targetFreqs.map((_, index) =>
      average(
        results
          .map(item => item.detectedFreqs[index])
          .filter(
            (value): value is number =>
              Number.isFinite(value) && value > 0,
          ),
      ),
    ),

    targetFreqs,

    noteScores: targetFreqs.map((_, index) =>
      average(
        results.map(item => item.noteScores[index] ?? 0),
      ),
    ),

    noteDeviations: targetFreqs.map((_, index) => {
      const values = results
        .map(item => item.noteDeviations[index])
        .filter(
          (value): value is number =>
            Number.isFinite(value),
        );

      return values.length > 0 ? average(values) : 100;
    }),

    averageClarity: average(
      results.map(item => item.averageClarity),
    ),

    voicedNotes: results.reduce(
      (sum, item) => sum + item.voicedNotes,
      0,
    ),
  };
}

// ============================================================
// SCREEN
// ============================================================

export default function ScaleAccuracyDrillScreen({
  tier,
}: Props) {
  // ==========================================================
  // ADAPTIVE PARAMETERS
  // ==========================================================

  const [currentTier, setCurrentTier] = useState<Tier>(
    tier ?? 'beginner',
  );

  const [params, setParams] = useState<ScaleAccuracyParams>(
    SCALE_ACCURACY_PARAMS[tier ?? 'beginner'],
  );

  const [isLoadingAdaptiveParams, setIsLoadingAdaptiveParams] =
    useState(true);

  // ==========================================================
  // STATE
  // ==========================================================

  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdown, setCountdown] = useState(3);
  const [currentNoteIndex, setCurrentNoteIndex] = useState(-1);
  const [currentRep, setCurrentRep] = useState(1);

  // Declare vocalRange before generating targetNotes.
  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  const [targetNotes, setTargetNotes] = useState(() =>
    generateScale(
      SCALE_ACCURACY_PARAMS[tier ?? 'beginner'],
      tier ?? 'beginner',
      null,
    ),
  );

  const targetNotesRef = useRef(targetNotes);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(null);

  const [liveFrequencies, setLiveFrequencies] =
    useState<number[]>([]);

  const [result, setResult] =
    useState<ScaleAccuracyScoreResult | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  // ==========================================================
  // REFS
  // ==========================================================

  const mountedRef = useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  // Allows the next repetition to start after the previous
  // native recording has had time to finish stopping.
  const transitionTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const recordingsRef = useRef<SavedRecording[]>([]);

  const currentRepRef = useRef(1);
  const recordingRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const pitchHistoryRef = useRef<number[]>([]);
  const recordingElapsedRef = useRef(0);

  const stopRecordingRef =
    useRef<(() => Promise<void>) | null>(null);

  const beginRepCountdownRef = useRef<() => void>(() => {});

  // ==========================================================
  // LOAD ADAPTIVE PARAMETERS
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    async function loadAdaptiveParams() {
      setIsLoadingAdaptiveParams(true);

      try {
        const user = auth.currentUser;

        let resolvedTier: Tier = tier ?? 'beginner';

        if (!tier && user) {
          const progress = await fetchComponentProgress(
            user.uid,
            'pitch',
          );

          resolvedTier = progress?.currentTier ?? 'beginner';
        }

        if (cancelled) {
          return;
        }

        setCurrentTier(resolvedTier);

        let recentScores: number[] = [];

        if (user) {
          const records = await fetchExerciseRecords(
            user.uid,
            'pitch',
          );

          if (cancelled) {
            return;
          }

          recentScores = records
            .filter(
              record =>
                record.tier === resolvedTier &&
                record.templateId === 'scaleAccuracyDrill',
            )
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-5)
            .map(record => record.scorePct);
        }

        // Use assessment as a fallback when no exercise history
        // exists for this exercise and tier.
        if (user && recentScores.length === 0) {
          const assessment = await getLatestAssessment();

          if (cancelled) {
            return;
          }

          setVocalRange(assessment?.vocalRange ?? null);

          const pitchScore = assessment?.scores.find(
            score => score.componentId === 'pitch',
          );

          if (pitchScore) {
            recentScores = [pitchScore.scorePct];
          }
        }

        const generatedParams = generateScaleAccuracyParams({
          tier: resolvedTier,
          recentScores,
        });

        if (cancelled) {
          return;
        }

        setParams(generatedParams);

        // Generate the scale using the resolved parameters.
        const newScale = generateScale(
          generatedParams,
          resolvedTier,
          vocalRange,
        );

        targetNotesRef.current = newScale;
        setTargetNotes(newScale);
      } catch (error) {
        console.error(
          '❌ FAILED TO LOAD SCALE ACCURACY PARAMETERS:',
          error,
        );

        if (!cancelled) {
          const fallbackTier = tier ?? 'beginner';
          const fallbackParams = SCALE_ACCURACY_PARAMS[fallbackTier];

          setCurrentTier(fallbackTier);
          setParams(fallbackParams);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAdaptiveParams(false);
        }
      }
    }

    loadAdaptiveParams();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  // ==========================================================
  // TIMER CLEANUP
  // ==========================================================

  const clearTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }, []);

  // ==========================================================
  // GO BACK
  // ==========================================================

  const goBack = useCallback(() => {
    clearTimers();

    stopRequestedRef.current = true;

    if (recordingRef.current) {
      void stopRecordingRef.current?.();
    }

    void disposeNotePlayer().catch(() => {});

    router.replace('/dashboard?tab=exercises');
  }, [clearTimers]);

  // ==========================================================
  // CLEANUP
  // ==========================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      clearTimers();

      if (recordingRef.current) {
        void stopRecordingRef.current?.();
      }

      void disposeNotePlayer().catch(() => {});
    };
  }, [clearTimers]);

  // ==========================================================
  // LIVE AUDIO FRAME
  // ==========================================================

  const handleLiveFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (!mountedRef.current) {
        return;
      }

      setLiveFrame(frame);

      if (Number.isFinite(frame.pitch) && frame.pitch > 0) {
        pitchHistoryRef.current = [
          ...pitchHistoryRef.current,
          frame.pitch,
        ].slice(-30);

        setLiveFrequencies(pitchHistoryRef.current);
      }
    },
    [],
  );

  // ==========================================================
  // AUDIO STOP / PROCESS ALL REPETITIONS
  // ==========================================================


  // ============================================================
  // AUDIO STOP / PROCESS ALL REPETITIONS
  // ============================================================

  const handleRecordingStop = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      if (!mountedRef.current) {
        return;
      }

      recordingRef.current = false;

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      console.log(
        `Scale rep ${currentRepRef.current} stopped. Samples: ${samples.length}`,
      );

      // Keep a copy because the recorder may reuse its buffer.
      recordingsRef.current.push({
        samples: new Float32Array(samples),
        sampleRate,
      });

      const isLastRep =
        currentRepRef.current >= params.repetitions;

      // --------------------------------------------------------
      // PREPARE THE NEXT REPETITION
      // --------------------------------------------------------

      if (!isLastRep) {
        const nextRep = currentRepRef.current + 1;

        currentRepRef.current = nextRep;
        setCurrentRep(nextRep);

        pitchHistoryRef.current = [];
        recordingElapsedRef.current = 0;

        setCurrentNoteIndex(-1);
        setLiveFrame(null);
        setLiveFrequencies([]);

        stopRequestedRef.current = false;

        console.log(`Preparing scale rep ${nextRep}`);

        if (transitionTimerRef.current) {
          clearTimeout(transitionTimerRef.current);
        }

        transitionTimerRef.current = setTimeout(() => {
          transitionTimerRef.current = null;

          if (mountedRef.current) {
            setTimeout(() => {
              if (mountedRef.current) {
                beginRepCountdownRef.current();
              }
            }, 400);
          }
        }, 500);

        return;
      }

      // --------------------------------------------------------
      // PROCESS ALL COMPLETED REPETITIONS
      // --------------------------------------------------------

      console.log('🔍 SCALE ANALYSIS STARTING', {
        savedRecordings: recordingsRef.current.length,
        expectedRepetitions: params.repetitions,
      });

      // Request the processing screen first.
      setPhase('processing');

      // Yield to the React Native event loop so the screen can
      // render before the synchronous DSP functions execute.
      await new Promise<void>(resolve => {
        setTimeout(resolve, 150);
      });

      if (!mountedRef.current) {
        return;
      }

      try {
        const targetFreqs = targetNotesRef.current.map(
          note => note.frequency,
        );

        const scores: ScaleAccuracyScoreResult[] = [];

        for (
          let index = 0;
          index < recordingsRef.current.length;
          index++
        ) {
          if (!mountedRef.current) {
            return;
          }

          const recording = recordingsRef.current[index];

          console.log(
            `🎼 Processing repetition ${index + 1} of ${recordingsRef.current.length}`,
          );

          const segments = segmentIntoNotes(
            recording.samples,
            targetFreqs.length,
            0.01,
            recording.sampleRate,
          );

          const measurement = measureScaleAccuracyDrill(
            segments,
            targetFreqs,
            recording.sampleRate,
            params.minClarity,
          );

          const score = scoreScaleAccuracyDrill(
            measurement,
            params,
          );

          scores.push(score);
        }

        if (!mountedRef.current) {
          return;
        }

        const finalResult = aggregateScaleResults(
          scores,
          targetFreqs,
        );

        console.log('✅ SCALE ANALYSIS COMPLETE', {
          repetitionsProcessed: scores.length,
          finalScore: finalResult.score,
        });

        await saveCompletedExercise(
          'pitch',
          'scaleAccuracyDrill',
          currentTier,
          finalResult.score,
        );

        if (!mountedRef.current) {
          return;
        }

        setResult(finalResult);
        setPhase('results');
      } catch (error) {
        console.error(
          '❌ SCALE PROCESSING ERROR:',
          error,
        );

        if (mountedRef.current) {
          setErrorMessage(
            'We could not analyze your recordings. Please try again.',
          );

          setPhase('instructions');
        }
      } finally {
        stopRequestedRef.current = false;
      }
    },
    [currentTier, params],
  );

  // ==========================================================
  // AUDIO RECORDER
  // ==========================================================

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleLiveFrame,
    onStop: handleRecordingStop,
  });

  // ==========================================================
  // STOP FUNCTION REF
  // ==========================================================

  useEffect(() => {
    stopRecordingRef.current = stopRecording;

    return () => {
      stopRecordingRef.current = null;
    };
  }, [stopRecording]);

  // ==========================================================
  // START ONE RECORDING
  // ==========================================================

  const beginRecording = useCallback(async () => {
    if (
      !mountedRef.current ||
      recordingRef.current ||
      startingRecordingRef.current
    ) {
      return;
    }

    startingRecordingRef.current = true;

    try {
      pitchHistoryRef.current = [];
      recordingElapsedRef.current = 0;

      setLiveFrequencies([]);
      setLiveFrame(null);
      setCurrentNoteIndex(0);
      setPhase('recording');

      stopRequestedRef.current = false;

      await startRecording();

      if (!mountedRef.current) {
        return;
      }

      recordingRef.current = true;

      console.log(
        `Scale rep ${currentRepRef.current} recording started`,
      );

      const noteCount = Math.max(
        1,
        targetNotesRef.current.length,
      );

      const recordingDuration = Math.max(
        5000,
        noteCount * 1250,
      );

      const noteDuration = recordingDuration / noteCount;

      recordingTimerRef.current = setInterval(() => {
        if (
          !mountedRef.current ||
          !recordingRef.current ||
          stopRequestedRef.current
        ) {
          return;
        }

        recordingElapsedRef.current += 100;

        const elapsedMs = recordingElapsedRef.current;

        const nextNoteIndex = Math.min(
          Math.floor(elapsedMs / noteDuration),
          noteCount - 1,
        );

        setCurrentNoteIndex(nextNoteIndex);

        if (elapsedMs < recordingDuration) {
          return;
        }

        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        if (stopRequestedRef.current) {
          return;
        }

        stopRequestedRef.current = true;

        void stopRecording().catch(error => {
          console.error(
            '❌ FAILED TO STOP SCALE RECORDING:',
            error,
          );

          recordingRef.current = false;
          stopRequestedRef.current = false;

          if (mountedRef.current) {
            setErrorMessage(
              'We could not finish the recording. Please try again.',
            );

            setPhase('instructions');
          }
        });
      }, 100);
    } catch (error) {
      console.error(
        '❌ FAILED TO START SCALE RECORDING:',
        error,
      );

      recordingRef.current = false;
      stopRequestedRef.current = false;

      if (mountedRef.current) {
        setPhase('instructions');

        Alert.alert(
          'Microphone Error',
          'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    } finally {
      startingRecordingRef.current = false;
    }
  }, [startRecording, stopRecording]);

  // ==========================================================
  // PLAY TARGET SCALE THEN RECORD
  // ==========================================================

  const playScaleAndRecord = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    try {
      setPhase('listening');
      setCurrentNoteIndex(0);

      const sequence = targetNotesRef.current.map(note => ({
        frequencyHz: note.frequency,
        durationSec: 0.8,
      }));

      console.log(
        `Playing target scale for rep ${currentRepRef.current}`,
      );

      await playNoteSequence(sequence);

      if (!mountedRef.current) {
        return;
      }

      await beginRecording();
    } catch (error) {
      console.error(
        '❌ FAILED TO PLAY SCALE OR START RECORDING:',
        error,
      );

      if (mountedRef.current) {
        setErrorMessage(
          'Unable to play the target scale or start recording. Please try again.',
        );

        setPhase('instructions');

        Alert.alert(
          'Audio Error',
          'Unable to play the target scale. Please try again.',
        );
      }
    }
  }, [beginRecording]);

  // ==========================================================
  // COUNTDOWN BEFORE EACH REP
  // ==========================================================

  const beginRepCountdown = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    setCountdown(3);
    setCurrentNoteIndex(-1);
    setLiveFrame(null);
    setLiveFrequencies([]);
    setPhase('countdown');

    let value = 3;

    countdownTimerRef.current = setInterval(() => {
      value--;

      if (value <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }

        if (mountedRef.current) {
          void playScaleAndRecord();
        }

        return;
      }

      setCountdown(value);
    }, 1000);
  }, [playScaleAndRecord]);

  // Keep the latest callback available to handleRecordingStop.
  beginRepCountdownRef.current = beginRepCountdown;

  // ==========================================================
  // START EXERCISE
  // ==========================================================

  const startCountdown = useCallback(() => {
    if (isLoadingAdaptiveParams) {
      return;
    }

    clearTimers();

    const newScale = generateScale(
      params,
      currentTier,
      vocalRange,
    );

    targetNotesRef.current = newScale;
    setTargetNotes(newScale);

    recordingsRef.current = [];

    currentRepRef.current = 1;
    setCurrentRep(1);

    recordingRef.current = false;
    startingRecordingRef.current = false;
    stopRequestedRef.current = false;

    pitchHistoryRef.current = [];
    recordingElapsedRef.current = 0;

    setResult(null);
    setErrorMessage(null);
    setLiveFrame(null);
    setLiveFrequencies([]);
    setCurrentNoteIndex(-1);

    beginRepCountdown();
  }, [
    beginRepCountdown,
    clearTimers,
    currentTier,
    isLoadingAdaptiveParams,
    params,
    vocalRange,
  ]);

  // ==========================================================
  // RETRY
  // ==========================================================

  const retry = useCallback(() => {
    clearTimers();

    recordingsRef.current = [];

    currentRepRef.current = 1;
    setCurrentRep(1);

    recordingRef.current = false;
    startingRecordingRef.current = false;
    stopRequestedRef.current = false;

    pitchHistoryRef.current = [];
    recordingElapsedRef.current = 0;

    setResult(null);
    setLiveFrame(null);
    setLiveFrequencies([]);
    setCurrentNoteIndex(-1);
    setErrorMessage(null);
    setPhase('instructions');
  }, [clearTimers]);

  // ==========================================================
  // CURRENT TARGET
  // ==========================================================

  const currentTarget =
    currentNoteIndex >= 0 &&
    currentNoteIndex < targetNotes.length
      ? targetNotes[currentNoteIndex]
      : null;

  const liveAccuracy =
    liveFrame && currentTarget && liveFrame.pitch > 0
      ? calcPitchAccuracy(
          liveFrame.pitch,
          currentTarget.frequency,
        )
      : 0;

  const liveStability = calcLiveStability(liveFrequencies);

  
  // ============================================================
  // PREPARING EXERCISE
  // ============================================================

  if (phase === 'instructions' && isLoadingAdaptiveParams) {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.largeIconCircle}>
          <Ionicons
            name="options-outline"
            size={44}
            color={BROWN}
          />
        </View>

        <Text style={styles.processingTitle}>
          Preparing Your Exercise
        </Text>

        <Text style={styles.processingSubtitle}>
          Adjusting the exercise to your current difficulty level
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.spinner}
        />
      </View>
    );
  }

  // ==========================================================
  // INSTRUCTIONS
  // ==========================================================

  if (phase === 'instructions') {
    return (
      <ExerciseScreen
        title="Scale Accuracy Drill"
        category="Pitch"
        icon="stats-chart-outline"
        tier={currentTier}
        instructions="Listen to the target scale first. After the scale finishes, sing the notes back one at a time in the same order. Try to land accurately on every note and make each transition smooth."
        preparationSteps={[
          {
            icon: 'volume-mute-outline',
            text: 'Find a quiet room or area with minimal background noise.',
          },
          {
            icon: 'body-outline',
            text: 'Sit upright or stand with your back straight and your shoulders relaxed.',
          },
          {
            icon: 'mic-outline',
            text: 'If available, an external microphone or audio recording equipment is recommended.',
          },
        ]}
        targetValue={`${params.noteCount} notes`}
        tip="Sing each note clearly before moving to the next one."
        onBack={goBack}
        onStart={startCountdown}
        error={errorMessage}
        startDisabled={isLoadingAdaptiveParams}
        startLabel={
          isLoadingAdaptiveParams
            ? 'Preparing Exercise...'
            : 'Start Exercise'
        }
      />
    );
  }

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  if (phase === 'countdown') {
    return (
      <ExerciseCountdownScreen
        icon="musical-notes-outline"
        title="Get Ready"
        currentRep={currentRep}
        repetitions={params.repetitions}
        countdown={countdown}
        promptTitle="Listen carefully"
        prompt="Listen carefully to the target scale."
        onBack={goBack}
      />
    );
  }

  // ==========================================================
  // LISTENING
  // ==========================================================

  if (phase === 'listening') {
    return (
      <ExerciseListeningScreen
        icon="volume-high-outline"
        title="Listen to the Scale"
        currentRep={currentRep}
        repetitions={params.repetitions}
        promptTitle="Listen to the target scale"
        prompt="Listen to the target scale first. After it finishes, sing the notes back in the same order."
        liveContent={
          <View style={styles.sharedScalePreview}>
            {targetNotes.map((note, index) => (
              <View
                key={`${note.name}-${index}`}
                style={styles.sharedScaleNote}
              >
                <Text style={styles.sharedScaleNoteText}>
                  {note.name}
                </Text>
              </View>
            ))}
          </View>
        }
        progress={100}
        onBack={goBack}
      />
    );
  }

  // ==========================================================
  // RECORDING
  // ==========================================================

  if (phase === 'recording') {
    return (
      <View style={styles.recordingScreen}>
        <View style={styles.recordingIcon}>
          <Ionicons name="mic" size={34} color={BROWN} />
        </View>

        <Text style={styles.recordingTitle}>
          Sing the Scale
        </Text>

        <Text style={styles.recordingSubtitle}>
          Repetition {currentRep} of {params.repetitions}
        </Text>

        <View style={styles.liveCard}>
          <Text style={styles.liveLabel}>Current Target</Text>

          <Text style={styles.liveTarget}>
            {currentTarget?.name ?? '--'}
          </Text>

          <View style={styles.liveDivider} />

          <Text style={styles.liveLabel}>Your Note</Text>

          <Text style={styles.liveNote}>
            {liveFrame?.note ?? '--'}
          </Text>

          <Text style={styles.liveFrequency}>
            {liveFrame && liveFrame.pitch > 0
              ? `${Math.round(liveFrame.pitch)} Hz`
              : '--'}
          </Text>

          <View style={styles.liveStats}>
            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>
                Accuracy
              </Text>

              <Text style={styles.liveStatValue}>
                {Math.round(liveAccuracy)}%
              </Text>
            </View>

            <View style={styles.liveStat}>
              <Text style={styles.liveStatLabel}>
                Stability
              </Text>

              <Text style={styles.liveStatValue}>
                {Math.round(liveStability)}%
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.scalePreview}>
          {targetNotes.map((note, index) => {
            const active = index === currentNoteIndex;

            return (
              <View
                key={`${note.name}-${index}`}
                style={[
                  styles.previewNote,
                  active && styles.previewNoteActive,
                ]}
              >
                <Text
                  style={[
                    styles.previewNoteText,
                    active && styles.previewNoteTextActive,
                  ]}
                >
                  {note.name}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.recordingIndicator}>
          <View style={styles.recordingDot} />

          <Text style={styles.recordingText}>
            {isRecording
              ? 'Recording...'
              : 'Preparing microphone...'}
          </Text>
        </View>
      </View>
    );
  }

  // ==========================================================
  // PROCESSING
  // ==========================================================

  if (phase === 'processing') {
    return (
      <ExerciseProcessingScreen
        icon="analytics-outline"
        title="Analyzing Your Singing"
        message={`Analyzing all ${params.repetitions} repetitions and calculating your final score...`}
      />
    );
  }

  // ==========================================================
  // RESULTS
  // ==========================================================

  if (phase === 'results' && result) {
    return (
      <ExerciseResultsScreen
        title={result.passed ? 'Great Job!' : 'Keep Practicing!'}
        subtitle={`Scale Accuracy Result • ${params.repetitions} repetitions`}
        score={result.score}
        resultIcon={result.passed ? 'checkmark' : 'refresh'}
        scoreSuffix="%"
        scoreMessage={`${result.correctNotes} of ${result.totalNotes} notes matched across all repetitions`}
        onBack={goBack}
        onRetry={retry}
        onExit={goBack}
      >
        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Note Accuracy
          </Text>

          <View style={styles.resultRow}>
            <Text style={styles.resultRowLabel}>
              Accurate notes
            </Text>

            <Text style={styles.resultRowValue}>
              {Math.round(result.noteAccuracy)}%
            </Text>
          </View>

          <View style={styles.resultRow}>
            <Text style={styles.resultRowLabel}>
              Transition smoothness
            </Text>

            <Text style={styles.resultRowValue}>
              {Math.round(result.transitionSmoothness)}%
            </Text>
          </View>

          <View style={styles.resultRow}>
            <Text style={styles.resultRowLabel}>
              Average clarity
            </Text>

            <Text style={styles.resultRowValue}>
              {Math.round(result.averageClarity * 100)}%
            </Text>
          </View>
        </View>

        <View style={styles.resultCard}>
          <Text style={styles.resultCardTitle}>
            Your Notes
          </Text>

          {targetNotes.map((target, index) => {
            const detected = result.detectedFreqs[index];
            const noteScore = result.noteScores[index] ?? 0;
            const deviation = result.noteDeviations[index] ?? Infinity;

            const noteName =
              detected && detected > 0
                ? frequencyToNote(detected)
                : '--';

            const correct =
              deviation <= params.tolerancePct;

            return (
              <View
                key={`${target.name}-${index}`}
                style={styles.noteResultRow}
              >
                <View style={styles.noteNumber}>
                  <Text style={styles.noteNumberText}>
                    {index + 1}
                  </Text>
                </View>

                <View style={styles.noteResultInfo}>
                  <Text style={styles.targetNoteText}>
                    Target: {target.name}
                  </Text>

                  <Text style={styles.detectedNoteText}>
                    Detected: {noteName}
                  </Text>
                </View>

                <View
                  style={[
                    styles.noteStatus,
                    correct && styles.noteStatusCorrect,
                  ]}
                >
                  <Ionicons
                    name={correct ? 'checkmark' : 'close'}
                    size={15}
                    color={BROWN}
                  />

                  <Text style={styles.noteStatusText}>
                    {noteScore}%
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.resultTip}>
          <Ionicons
            name="bulb-outline"
            size={21}
            color={BROWN}
          />

          <Text style={styles.tipText}>
            {result.passed
              ? 'Your notes were consistently accurate across the repetitions. Continue practicing smooth transitions for even greater consistency.'
              : 'Focus on landing directly on each target note and maintaining accuracy across every repetition.'}
          </Text>
        </View>
      </ExerciseResultsScreen>
    );
  }

  return null;
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  
  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },

  largeIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },

  processingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },

  processingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
  },

  spinner: {
    marginTop: 28,
  },

  recordingScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },

  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
  },

  liveCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    marginTop: 25,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  liveTarget: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    marginTop: 3,
  },

  liveDivider: {
    width: '70%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },

  liveNote: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 3,
  },

  liveFrequency: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },

  liveStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 18,
  },

  liveStat: {
    alignItems: 'center',
  },

  liveStatLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  liveStatValue: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginTop: 2,
  },

  scalePreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    maxWidth: 350,
  },

  previewNote: {
    minWidth: 48,
    height: 44,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
  },

  previewNoteActive: {
    backgroundColor: PINK,
  },

  previewNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: MUTED,
  },

  previewNoteTextActive: {
    color: BROWN,
  },

  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
  },

  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: BROWN,
    marginRight: 7,
  },

  recordingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  sharedScalePreview: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },

  sharedScaleNote: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sharedScaleNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  resultCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginBottom: 10,
  },

  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },

  resultRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  noteResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  noteNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  noteNumberText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },

  noteResultInfo: {
    flex: 1,
    marginLeft: 10,
  },

  targetNoteText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },

  detectedNoteText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 2,
  },

  noteStatus: {
    minWidth: 55,
    height: 30,
    borderRadius: 15,
    backgroundColor: LIGHT_GRAY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 7,
  },

  noteStatusCorrect: {
    backgroundColor: PINK,
  },

  noteStatusText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
  },

  resultTip: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 10,
  },
});