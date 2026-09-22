import Ionicons from '@expo/vector-icons/Ionicons';
import {
  router,
  useLocalSearchParams,
} from 'expo-router';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  ASSESSMENT_DURATION,
  AssessmentAudioBundle,
  AssessmentResult,
  AssessmentType,
  computeTargetNotes,
  detectVocalRangeFromHums,
  runAssessment,
  TargetNotes,
  VocalRange,
} from '@/services/assessment/assessmentModule';

import { saveAssessment } from '@/services/assessment/assessmentRepository';

import {
  NoteToPlay,
  playNoteSequence,
} from '@/services/assessment/notePlayer';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

// ============================================================
// COLORS
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';

// ============================================================
// AUDIO VALIDATION
// ============================================================

/*
 * Your working AudioTestScreen proved that the recorder can
 * capture microphone data.
 *
 * Assessment should therefore reject recordings that contain
 * essentially no audio rather than allowing the DSP to interpret
 * silence/noise as a musical note.
 *
 * Current broken recordings were around:
 *
 * RMS  ≈ 0.00013
 * dB   ≈ -77
 *
 * A recording below this threshold is considered unusable.
 */
const MIN_RECORDING_RMS = 0.001;

// ============================================================
// TYPES
// ============================================================

type AssessmentStep =
  | 'intro'
  | 'lowHum'
  | 'highHum'
  | 'pitch'
  | 'tone'
  | 'volume'
  | 'agility'
  | 'processing'
  | 'results';

// ============================================================
// STEP ORDER
// ============================================================

const STEP_ORDER: AssessmentStep[] = [
  'lowHum',
  'highHum',
  'pitch',
  'tone',
  'volume',
  'agility',
];

/**
 * Steps where the system plays a reference note.
 */
const NOTE_GUIDED_STEPS: AssessmentStep[] = [
  'pitch',
  'tone',
  'volume',
  'agility',
];

// ============================================================
// HELPERS
// ============================================================

function getStepTitle(step: AssessmentStep): string {
  switch (step) {
    case 'lowHum':
      return 'Lowest Comfortable Note';

    case 'highHum':
      return 'Highest Comfortable Note';

    case 'pitch':
      return 'Pitch';

    case 'tone':
      return 'Tone';

    case 'volume':
      return 'Volume';

    case 'agility':
      return 'Agility';

    default:
      return '';
  }
}

function getStepInstruction(step: AssessmentStep): string {
  switch (step) {
    case 'lowHum':
      return 'Sing the lowest note that feels comfortable. Do not strain your voice. Hold it steadily.';

    case 'highHum':
      return 'Sing the highest note that feels comfortable. Do not strain your voice. Hold it steadily.';

    case 'pitch':
      return 'Listen to the note, then sing it back and try to hold the pitch steady.';

    case 'tone':
      return 'Listen to the note, then sing "ah" on that pitch and hold it as smoothly and steadily as you can.';

    case 'volume':
      return 'Listen to the note, then sing it starting softly, growing louder, then softer again.';

    case 'agility':
      return 'Listen to the short run of notes, then sing it back as clearly and quickly as you can.';

    default:
      return '';
  }
}

function getStepDuration(step: AssessmentStep): number {
  switch (step) {
    case 'pitch':
      return ASSESSMENT_DURATION.pitch;

    case 'tone':
      return ASSESSMENT_DURATION.tone;

    case 'volume':
      return ASSESSMENT_DURATION.volume;

    case 'agility':
      return ASSESSMENT_DURATION.agility;

    case 'lowHum':
    case 'highHum':
      return ASSESSMENT_DURATION.comfortableNote;

    default:
      return 0;
  }
}

/**
 * Returns the reference note(s) for the current assessment step.
 */
function getStepReferenceNotes(
  step: AssessmentStep,
  targetNotes: TargetNotes | null
): NoteToPlay[] {
  if (!targetNotes) {
    return [];
  }

  switch (step) {
    case 'pitch':
    case 'tone':
    case 'volume':
      return [
        {
          frequencyHz: targetNotes.rootHz,
          durationSec: 1.4,
        },
      ];

    case 'agility':
      return targetNotes.agilityRun.map(frequencyHz => ({
        frequencyHz,
        durationSec: 0.4,
      }));

    default:
      return [];
  }
}

// ============================================================
// FREQUENCY → NOTE
// ============================================================

function frequencyToNoteName(frequency: number): string {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return '--';
  }

  const noteNames = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];

  const midi = Math.round(
    69 + 12 * Math.log2(frequency / 440)
  );

  const noteIndex =
    ((midi % 12) + 12) % 12;

  const octave =
    Math.floor(midi / 12) - 1;

  return `${noteNames[noteIndex]}${octave}`;
}

// ============================================================
// AUDIO VALIDATION
// ============================================================

function calculateRMS(
  samples: Float32Array
): number {
  if (samples.length === 0) {
    return 0;
  }

  let sum = 0;
  let count = 0;

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];

    if (!Number.isFinite(value)) {
      continue;
    }

    sum += value * value;
    count++;
  }

  if (count === 0) {
    return 0;
  }

  return Math.sqrt(sum / count);
}

function calculatePeak(
  samples: Float32Array
): number {
  let peak = 0;

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];

    if (!Number.isFinite(value)) {
      continue;
    }

    peak = Math.max(
      peak,
      Math.abs(value)
    );
  }

  return peak;
}

function hasUsableAudio(
  samples: Float32Array
): boolean {
  if (samples.length === 0) {
    return false;
  }

  const rms = calculateRMS(samples);
  const peak = calculatePeak(samples);

  return (
    Number.isFinite(rms) &&
    Number.isFinite(peak) &&
    rms >= MIN_RECORDING_RMS &&
    peak >= MIN_RECORDING_RMS * 2
  );
}

// ============================================================
// SCREEN
// ============================================================

export default function AssessmentScreen() {

  const {
  type,
} = useLocalSearchParams<{
  type?: string | string[];
}>();

const rawAssessmentType =
  Array.isArray(type)
    ? type[0]
    : type;

const assessmentType: AssessmentType =
  rawAssessmentType === 'followUp'
    ? 'followUp'
    : 'initial';

  const [step, setStep] =
    useState<AssessmentStep>('intro');

  const [isRecordingSection, setIsRecordingSection] =
    useState(false);

  const [remainingSeconds, setRemainingSeconds] =
    useState(0);

  const [result, setResult] =
    useState<AssessmentResult | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  // ==========================================================
  // LIVE AUDIO
  // ==========================================================

  const [liveAudio, setLiveAudio] =
    useState<LiveAudioFrame | null>(null);

  // ==========================================================
  // RECORDED SECTIONS
  // ==========================================================

  const [sections, setSections] =
    useState<
      Partial<
        Record<
          AssessmentStep,
          Float32Array
        >
      >
    >({});

  /*
   * IMPORTANT:
   *
   * Do not rely on the `step` value captured inside
   * onStop().
   *
   * This ref stores the step that actually started
   * the recording.
   */
  const recordingStepRef =
    useRef<AssessmentStep | null>(null);

  /*
   * Timer reference.
   */
  const timerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  /*
   * Prevent multiple stop calls if the timer and another
   * lifecycle event happen at nearly the same time.
   */
  const stoppingRef =
    useRef(false);

  // ==========================================================
  // VOCAL RANGE
  // ==========================================================

  const [vocalRange, setVocalRange] =
    useState<VocalRange | null>(null);

  // ==========================================================
  // TARGET NOTES
  // ==========================================================

  const targetNotes =
    useMemo(() => {
      if (!vocalRange) {
        return null;
      }

      return computeTargetNotes(
        vocalRange.lowHz,
        vocalRange.highHz
      );
    }, [vocalRange]);

  // ==========================================================
  // REFERENCE NOTE PLAYBACK
  // ==========================================================

  const [isPlayingNote, setIsPlayingNote] =
    useState(false);

  const [hasPlayedNote, setHasPlayedNote] =
    useState(false);

  const needsReferenceNote =
    NOTE_GUIDED_STEPS.includes(step);

  useEffect(() => {
    setHasPlayedNote(false);
  }, [step]);

  const playReferenceNote =
    useCallback(async () => {
      const notes =
        getStepReferenceNotes(
          step,
          targetNotes
        );

      if (notes.length === 0) {
        return;
      }

      try {
        setError(null);
        setIsPlayingNote(true);

        await playNoteSequence(notes);

        setHasPlayedNote(true);
      } catch (err) {
        console.error(
          'Failed to play reference note:',
          err
        );

        /*
         * Playback failure should not prevent the assessment.
         */
        setError(
          'Could not play the reference note. You can still continue.'
        );
      } finally {
        setIsPlayingNote(false);
      }
    }, [step, targetNotes]);

  // ==========================================================
  // CLEANUP TIMER
  // ==========================================================

  const clearRecordingTimer =
    useCallback(() => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, []);

  // ==========================================================
  // MOVE TO NEXT STEP
  // ==========================================================

  const moveToNextStep =
    useCallback(
      (currentStep: AssessmentStep) => {
        const index =
          STEP_ORDER.indexOf(currentStep);

        if (index === -1) {
          return;
        }

        const nextStep =
          STEP_ORDER[index + 1];

        if (nextStep) {
          setStep(nextStep);
        } else {
          setStep('processing');
        }
      },
      []
    );

  // ==========================================================
  // RECORDER CALLBACKS
  // ==========================================================

  const handleAudioFrame =
    useCallback(
      (frame: LiveAudioFrame) => {
        setLiveAudio(frame);
      },
      []
    );

  const handleAudioStop =
    useCallback(
      (
        samples: Float32Array,
        sampleRate: number
      ) => {
        /*
         * Capture the step that actually started recording.
         */
        const recordedStep =
          recordingStepRef.current;

        recordingStepRef.current = null;

        clearRecordingTimer();

        setIsRecordingSection(false);
        setLiveAudio(null);
        setRemainingSeconds(0);
        stoppingRef.current = false;

        if (!recordedStep) {
          console.warn(
            '⚠️ Recording stopped but no assessment step was active.'
          );

          return;
        }

        console.log(
          '🎤 ASSESSMENT SECTION COMPLETE:',
          {
            step: recordedStep,
            samples: samples.length,
            sampleRate,
            durationSeconds:
              samples.length / sampleRate,
            rms: calculateRMS(samples),
            peak: calculatePeak(samples),
          }
        );

        /*
         * ----------------------------------------------------
         * AUDIO VALIDATION
         * ----------------------------------------------------
         *
         * This is extremely important.
         *
         * If the microphone returns an all-zero buffer,
         * do NOT store it as a valid assessment section.
         */
        if (!hasUsableAudio(samples)) {
          console.warn(
            '⚠️ ASSESSMENT AUDIO REJECTED: signal too quiet.'
          );

          setError(
            'We could not hear enough microphone audio. Please make sure your microphone is working and sing closer to it.'
          );

          /*
           * Keep the user on the same step so they can retry.
           */
          setStep(recordedStep);

          return;
        }

        /*
         * Store the successfully captured section.
         */
        setSections(previous => ({
          ...previous,
          [recordedStep]: samples,
        }));

        /*
         * ----------------------------------------------------
         * LOW / HIGH RANGE STEPS
         * ----------------------------------------------------
         *
         * HighHum is handled separately because both recordings
         * must be available before vocal range can be calculated.
         */
        if (recordedStep === 'highHum') {
          return;
        }

        /*
         * Small delay gives React time to commit the section
         * before the next screen is rendered.
         */
        setTimeout(() => {
          moveToNextStep(recordedStep);
        }, 100);
      },
      [
        clearRecordingTimer,
        moveToNextStep,
      ]
    );

  // ==========================================================
  // AUDIO RECORDER
  // ==========================================================

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleAudioFrame,
    onStop: handleAudioStop,
  });

  // ==========================================================
  // DETECT VOCAL RANGE
  // ==========================================================

  useEffect(() => {
    if (step !== 'highHum') {
      return;
    }

    const lowSamples =
      sections.lowHum;

    const highSamples =
      sections.highHum;

    if (!lowSamples || !highSamples) {
      return;
    }

    if (vocalRange) {
      return;
    }

    /*
     * Validate again before sending data to the range detector.
     */
    if (
      !hasUsableAudio(lowSamples) ||
      !hasUsableAudio(highSamples)
    ) {
      setError(
        'We could not hear enough audio to determine your vocal range. Please try both notes again.'
      );

      setSections(previous => {
        const updated = {
          ...previous,
        };

        delete updated.lowHum;
        delete updated.highHum;

        return updated;
      });

      setStep('lowHum');

      return;
    }

    try {
      /*
       * The current recorder returns 44100 Hz.
       *
       * AssessmentScreen's section callbacks receive the actual
       * sample rate, but the existing sections structure only
       * stores Float32Array values.
       *
       * Your current recorder is configured for 44100 Hz, so this
       * remains consistent with the rest of the assessment.
       */
      const range =
        detectVocalRangeFromHums(
          lowSamples,
          highSamples,
          44100
        );

      setVocalRange(range);
      setError(null);

      setStep('pitch');
    } catch (err) {
      console.error(
        'Vocal range detection error:',
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : 'We could not detect your vocal range. Please try humming both notes again.'
      );

      setSections(previous => {
        const updated = {
          ...previous,
        };

        delete updated.lowHum;
        delete updated.highHum;

        return updated;
      });

      setVocalRange(null);
      setStep('lowHum');
    }
  }, [
    step,
    sections.lowHum,
    sections.highHum,
    vocalRange,
  ]);

  // ==========================================================
  // START RECORDING SECTION
  // ==========================================================

  const beginSection =
    useCallback(async () => {
      if (isRecording || isRecordingSection) {
        return;
      }

      const currentStep =
        step;

      const duration =
        getStepDuration(currentStep);

      if (duration <= 0) {
        return;
      }

      /*
       * Reference-note steps require the user to listen first.
       */
      if (
        NOTE_GUIDED_STEPS.includes(
          currentStep
        ) &&
        !hasPlayedNote
      ) {
        setError(
          'Please listen to the reference note before recording.'
        );

        return;
      }

      clearRecordingTimer();

      setError(null);
      setLiveAudio(null);
      setRemainingSeconds(duration);

      recordingStepRef.current =
        currentStep;

      stoppingRef.current = false;

      try {
        /*
         * IMPORTANT:
         *
         * Start the recorder FIRST.
         *
         * Only mark the UI as recording after the recorder
         * successfully starts.
         */
        await startRecording();

        setIsRecordingSection(true);

        let remaining =
          duration;

        timerRef.current =
          setInterval(() => {
            remaining -= 1;

            setRemainingSeconds(
              Math.max(remaining, 0)
            );

            if (remaining <= 0) {
              clearRecordingTimer();

              /*
               * Prevent duplicate stop calls.
               */
              if (stoppingRef.current) {
                return;
              }

              stoppingRef.current =
                true;

              stopRecording().catch(err => {
                console.error(
                  'Assessment automatic stop error:',
                  err
                );

                stoppingRef.current =
                  false;

                setIsRecordingSection(false);
              });
            }
          }, 1000);
      } catch (err) {
        console.error(
          'Assessment recording error:',
          err
        );

        clearRecordingTimer();

        recordingStepRef.current =
          null;

        stoppingRef.current =
          false;

        setIsRecordingSection(false);
        setLiveAudio(null);
        setRemainingSeconds(0);

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to start the microphone. Please check your microphone permission and try again.'
        );
      }
    }, [
      step,
      hasPlayedNote,
      isRecording,
      isRecordingSection,
      clearRecordingTimer,
      startRecording,
      stopRecording,
    ]);

  // ==========================================================
  // MANUAL STOP
  // ==========================================================

  const handleManualStop =
    useCallback(async () => {
      if (
        !isRecording &&
        !isRecordingSection
      ) {
        return;
      }

      if (stoppingRef.current) {
        return;
      }

      stoppingRef.current = true;

      clearRecordingTimer();

      try {
        await stopRecording();
      } catch (err) {
        console.error(
          'Failed to stop assessment recording:',
          err
        );

        stoppingRef.current =
          false;

        setIsRecordingSection(false);

        setError(
          'Something went wrong while stopping the recording. Please try this section again.'
        );
      }
    }, [
      isRecording,
      isRecordingSection,
      clearRecordingTimer,
      stopRecording,
    ]);

  // ==========================================================
  // CLEANUP ON UNMOUNT
  // ==========================================================

  useEffect(() => {
    return () => {
      clearRecordingTimer();
    };
  }, [clearRecordingTimer]);

  // ==========================================================
  // BUILD ASSESSMENT AUDIO
  // ==========================================================

  const createAssessmentBundle =
    useCallback((): AssessmentAudioBundle => {
      const empty =
        new Float32Array(0);

      return {
        pitchSamples:
          sections.pitch ?? empty,

        toneSamples:
          sections.tone ?? empty,

        volumeSamples:
          sections.volume ?? empty,

        agilitySamples:
          sections.agility ?? empty,

        lowestComfortableNoteSamples:
          sections.lowHum ?? empty,

        highestComfortableNoteSamples:
          sections.highHum ?? empty,

        sampleRate: 44100,
      };
    }, [sections]);

  // ==========================================================
  // PROCESS ASSESSMENT
  // ==========================================================

  const processAssessment =
    useCallback(async () => {
      try {
        setError(null);

        /*
         * Make sure all required sections exist.
         */
        const requiredSteps: AssessmentStep[] = [
          'lowHum',
          'highHum',
          'pitch',
          'tone',
          'volume',
          'agility',
        ];

        for (const requiredStep of requiredSteps) {
          const samples =
            sections[requiredStep];

          if (
            !samples ||
            samples.length === 0
          ) {
            throw new Error(
              `The ${getStepTitle(
                requiredStep
              )} recording is missing. Please complete the assessment again.`
            );
          }

          if (!hasUsableAudio(samples)) {
            throw new Error(
              `The ${getStepTitle(
                requiredStep
              )} recording did not contain enough microphone audio.`
            );
          }
        }

        const audio =
          createAssessmentBundle();

        console.log(
          '🎯 PROCESSING ASSESSMENT AUDIO:',
          {
            pitch:
              audio.pitchSamples.length,

            tone:
              audio.toneSamples.length,

            volume:
              audio.volumeSamples.length,

            agility:
              audio.agilitySamples.length,

            low:
              audio.lowestComfortableNoteSamples.length,

            high:
              audio.highestComfortableNoteSamples.length,

            sampleRate:
              audio.sampleRate,
          }
        );

        /*
         * Run all five fundamentals + vocal range.
         */
        const assessmentResult =
          runAssessment(audio);

        setResult(
          assessmentResult
        );

        /*
         * Firebase saving should never prevent the local
         * assessment result from being shown.
         */
        try {
          await saveAssessment(
  assessmentResult,
  assessmentType
);

          console.log(
            '✅ Assessment successfully saved.'
          );
        } catch (saveError) {
          console.error(
            'Could not save assessment to Firebase:',
            saveError
          );

          setError(
            'Your assessment was completed, but we could not save it to your account. Please check your internet connection and try again later.'
          );
        }

        setStep('results');
      } catch (err) {
        console.error(
          'Assessment processing error:',
          err
        );

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to process the assessment.'
        );

        /*
         * Return to the first recording step.
         */
        setSections({});
        setVocalRange(null);
        setResult(null);
        setLiveAudio(null);
        setRemainingSeconds(0);

        setStep('lowHum');
      }
    }, [
      sections,
      createAssessmentBundle,
      assessmentType,
    ]);

  // ==========================================================
  // RESET ASSESSMENT
  // ==========================================================

  const resetAssessment =
    useCallback(() => {
      clearRecordingTimer();

      recordingStepRef.current =
        null;

      stoppingRef.current =
        false;

      setSections({});
      setVocalRange(null);
      setResult(null);
      setError(null);
      setLiveAudio(null);
      setRemainingSeconds(0);
      setIsRecordingSection(false);
      setHasPlayedNote(false);

      setStep('intro');
    }, [clearRecordingTimer]);

  // ==========================================================
  // PROCESSING SCREEN
  // ==========================================================

  if (step === 'processing') {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator
          size="large"
          color={BROWN}
        />

        <Text style={styles.processingTitle}>
          Analyzing your voice...
        </Text>

        <Text style={styles.processingText}>
          We're checking your five vocal fundamentals and vocal range.
        </Text>

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {error}
            </Text>
          </View>
        )}

        <Pressable
          style={styles.primaryButton}
          onPress={processAssessment}
        >
          <Text style={styles.primaryButtonText}>
            Analyze My Voice
          </Text>
        </Pressable>
      </View>
    );
  }

  // ==========================================================
  // RESULTS
  // ==========================================================

  if (
    step === 'results' &&
    result
  ) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={
          styles.resultsContent
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.resultsTitle}>
  {assessmentType === 'initial'
    ? 'Initial Vocal Assessment'
    : 'Follow-up Vocal Assessment'}
</Text>

<Text style={styles.resultsSubtitle}>
  {assessmentType === 'initial'
    ? 'Here’s your starting vocal foundation.'
    : 'Here’s your current vocal foundation after the study period.'}
</Text>

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {error}
            </Text>
          </View>
        )}

        {/* VOCAL RANGE */}

        <View style={styles.rangeCard}>
          <Text style={styles.cardTitle}>
            Vocal Range
          </Text>

          <Text style={styles.rangeText}>
            {frequencyToNoteName(
              result.vocalRangeLowHz
            )}
            {'  –  '}
            {frequencyToNoteName(
              result.vocalRangeHighHz
            )}
          </Text>

          <Text style={styles.rangeHzText}>
            {result.vocalRangeLowHz.toFixed(1)}
            {' Hz  –  '}
            {result.vocalRangeHighHz.toFixed(1)}
            {' Hz'}
          </Text>
        </View>

        {/* COMPONENT SCORES */}

        {result.scores.map(score => {
          const recommendation =
            result.recommendations[
              score.componentId
            ];

          const componentName =
            score.componentId ===
            'breathControl'
              ? 'Breath Control'
              : score.componentId === 'pitch'
              ? 'Pitch'
              : score.componentId === 'tone'
              ? 'Tone'
              : score.componentId === 'volume'
              ? 'Volume'
              : 'Agility';

          return (
            <View
              key={score.componentId}
              style={styles.scoreCard}
            >
              <View style={styles.scoreHeader}>
                <Text style={styles.scoreName}>
                  {componentName}
                </Text>

                <Text style={styles.scoreValue}>
                  {score.scorePct}%
                </Text>
              </View>

              <View
                style={
                  styles.progressBackground
                }
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          score.scorePct
                        )
                      )}%`,
                    },
                  ]}
                />
              </View>

              <Text
                style={styles.recommendation}
              >
                {recommendation ===
                'needsSignificantImprovement'
                  ? 'Needs significant improvement'
                  : recommendation ===
                    'moderateImprovement'
                  ? 'Moderate improvement'
                  : 'Good foundation'}
              </Text>
            </View>
          );
        })}

        <Pressable
          style={styles.primaryButton}
          onPress={resetAssessment}
        >
          <Text style={styles.primaryButtonText}>
            Retake Assessment
          </Text>
        </Pressable>

        <Pressable
          style={styles.backButtonResults}
          onPress={() => router.back()}
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={BROWN}
          />
        </Pressable>
      </ScrollView>
    );
  }

  // ==========================================================
  // INTRO
  // ==========================================================

  if (step === 'intro') {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={BROWN}
          />
        </Pressable>

        <View style={styles.iconCircle}>
          <Ionicons
            name="mic"
            size={32}
            color={BROWN}
          />
        </View>

        <Text style={styles.title}>
          Vocal Assessment
        </Text>

        <Text style={styles.description}>
          First, we'll find your comfortable vocal range. Then we'll play a few notes for you to sing back so we can check your vocal fundamentals.
        </Text>

        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>
            What we'll check
          </Text>

          <Text style={styles.infoItem}>
            • Vocal Range
          </Text>

          <Text style={styles.infoItem}>
            • Pitch
          </Text>

          <Text style={styles.infoItem}>
            • Tone
          </Text>

          <Text style={styles.infoItem}>
            • Volume
          </Text>

          <Text style={styles.infoItem}>
            • Agility
          </Text>

          <Text style={styles.infoItem}>
            • Breath Control
          </Text>
        </View>

        <Text style={styles.warning}>
          Find a quiet place and make sure your microphone is not covered.
        </Text>

        <Pressable
          style={styles.primaryButton}
          onPress={() => {
            setError(null);
            setStep('lowHum');
          }}
        >
          <Text style={styles.primaryButtonText}>
            Start Assessment
          </Text>

          <Ionicons
            name="arrow-forward"
            size={18}
            color={WHITE}
          />
        </Pressable>
      </ScrollView>
    );
  }

  // ==========================================================
  // ASSESSMENT SECTION
  // ==========================================================

  const duration =
    getStepDuration(step);

  const isSection =
    STEP_ORDER.includes(step);

  if (isSection) {
    const stepIndex =
      STEP_ORDER.indexOf(step);

    const progress =
      (stepIndex + 1) /
      STEP_ORDER.length;

    const referenceNotes =
      getStepReferenceNotes(
        step,
        targetNotes
      );

    const targetNoteLabel =
      referenceNotes.length === 1
        ? frequencyToNoteName(
            referenceNotes[0]
              .frequencyHz
          )
        : referenceNotes.length > 1
        ? referenceNotes
            .map(note =>
              frequencyToNoteName(
                note.frequencyHz
              )
            )
            .join(' → ')
        : null;

    const canRecord =
      !needsReferenceNote ||
      hasPlayedNote;

    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={false}
      >
        {/* BACK */}

        <Pressable
          style={styles.backButton}
          onPress={() => {
            if (
              isRecordingSection ||
              isRecording
            ) {
              return;
            }

            router.back();
          }}
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={BROWN}
          />
        </Pressable>

        {/* PROGRESS */}

        <View
          style={styles.progressHeader}
        >
          <Text
            style={styles.progressText}
          >
            Step {stepIndex + 1} of{' '}
            {STEP_ORDER.length}
          </Text>

          <Text
            style={styles.progressText}
          >
            {Math.round(
              progress * 100
            )}
            %
          </Text>
        </View>

        <View
          style={
            styles.progressBackground
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

        {/* ICON */}

        <View
          style={styles.sectionIcon}
        >
          <Ionicons
            name={
              needsReferenceNote
                ? 'musical-notes-outline'
                : 'mic-outline'
            }
            size={30}
            color={BROWN}
          />
        </View>

        {/* TITLE */}

        <Text style={styles.title}>
          {getStepTitle(step)}
        </Text>

        <Text
          style={styles.description}
        >
          {getStepInstruction(step)}
        </Text>

        {/* REFERENCE NOTE */}

        {needsReferenceNote && (
          <View style={styles.noteCard}>
            {targetNoteLabel && (
              <Text
                style={styles.noteLabel}
              >
                Target: {targetNoteLabel}
              </Text>
            )}

            <Pressable
              style={[
                styles.playButton,
                isPlayingNote &&
                  styles.playButtonDisabled,
              ]}
              disabled={
                isPlayingNote ||
                isRecordingSection
              }
              onPress={
                playReferenceNote
              }
            >
              <Ionicons
                name={
                  isPlayingNote
                    ? 'volume-high'
                    : 'play'
                }
                size={20}
                color={WHITE}
              />

              <Text
                style={
                  styles.playButtonText
                }
              >
                {isPlayingNote
                  ? 'Playing...'
                  : hasPlayedNote
                  ? 'Play Again'
                  : 'Play Note'}
              </Text>
            </Pressable>

            {!hasPlayedNote && (
              <Text
                style={
                  styles.noteHelperText
                }
              >
                Listen to the note before recording.
              </Text>
            )}
          </View>
        )}

        {/* TIMER */}

        <View
          style={styles.timerCircle}
        >
          <Text
            style={styles.timerText}
          >
            {isRecordingSection
              ? remainingSeconds
              : duration}
          </Text>

          <Text
            style={styles.timerLabel}
          >
            seconds
          </Text>
        </View>

        {/* LIVE AUDIO */}

        {isRecordingSection && (
          <View style={styles.liveCard}>
            <Text
              style={styles.liveTitle}
            >
              Live Audio
            </Text>

            <View
              style={styles.liveGrid}
            >
              <View
                style={styles.liveItem}
              >
                <Text
                  style={styles.liveLabel}
                >
                  Pitch
                </Text>

                <Text
                  style={styles.liveValue}
                >
                  {liveAudio &&
                  liveAudio.pitch > 0
                    ? `${liveAudio.pitch.toFixed(
                        1
                      )} Hz`
                    : '--'}
                </Text>
              </View>

              <View
                style={styles.liveItem}
              >
                <Text
                  style={styles.liveLabel}
                >
                  Note
                </Text>

                <Text
                  style={styles.liveValue}
                >
                  {liveAudio?.note ??
                    '--'}
                </Text>
              </View>

              <View
                style={styles.liveItem}
              >
                <Text
                  style={styles.liveLabel}
                >
                  Clarity
                </Text>

                <Text
                  style={styles.liveValue}
                >
                  {liveAudio
                    ? `${(
                        liveAudio.clarity *
                        100
                      ).toFixed(0)}%`
                    : '--'}
                </Text>
              </View>

              <View
                style={styles.liveItem}
              >
                <Text
                  style={styles.liveLabel}
                >
                  Volume
                </Text>

                <Text
                  style={styles.liveValue}
                >
                  {liveAudio
                    ? `${liveAudio.volume.toFixed(
                        1
                      )} dB`
                    : '--'}
                </Text>
              </View>

              <View
                style={styles.liveItem}
              >
                <Text
                  style={styles.liveLabel}
                >
                  Stability
                </Text>

                <Text
                  style={styles.liveValue}
                >
                  {liveAudio
                    ? `${liveAudio.stability.toFixed(
                        0
                      )}%`
                    : '--'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* RECORD BUTTON */}

        <Pressable
          style={[
            styles.recordButton,
            (isRecordingSection ||
              !canRecord) &&
              styles.recordingButton,
          ]}
          disabled={
            isRecordingSection ||
            isRecording ||
            !canRecord
          }
          onPress={beginSection}
        >
          <Ionicons
            name={
              isRecordingSection
                ? 'radio'
                : 'mic'
            }
            size={30}
            color={WHITE}
          />

          <Text
            style={
              styles.recordButtonText
            }
          >
            {isRecordingSection
              ? 'Recording...'
              : 'Record'}
          </Text>
        </Pressable>

        {isRecordingSection && (
          <Pressable
            style={styles.manualStopButton}
            onPress={
              handleManualStop
            }
          >
            <Text
              style={
                styles.manualStopText
              }
            >
              Stop Early
            </Text>
          </Pressable>
        )}

        {error && (
          <View style={styles.errorCard}>
            <Text
              style={styles.errorText}
            >
              {error}
            </Text>
          </View>
        )}

        <Text
          style={styles.helperText}
        >
          Recording will automatically stop when the timer reaches zero.
        </Text>
      </ScrollView>
    );
  }

  return null;
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  backButtonResults: {
    alignSelf: 'center',
    paddingVertical: 15,
    paddingHorizontal: 10,
    marginTop: 5,
  },

  content: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 80,
  },

  resultsContent: {
    paddingHorizontal: 24,
    paddingTop: 50,
    paddingBottom: 80,
  },

  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 24,
  },

  sectionIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 35,
    marginBottom: 20,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    color: BROWN,
    textAlign: 'center',
    marginBottom: 12,
  },

  description: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 21,
    color: MUTED,
    textAlign: 'center',
    marginBottom: 25,
  },

  infoCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 22,
    marginBottom: 20,
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 12,
  },

  infoItem: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: BROWN,
    marginBottom: 7,
  },

  warning: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 25,
  },

  primaryButton: {
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: BROWN,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 8,
    marginTop: 10,
  },

  primaryButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  progressText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  progressBackground: {
    width: '100%',
    height: 9,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 10,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    backgroundColor: BROWN,
    borderRadius: 10,
  },

  noteCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  noteLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
    marginBottom: 12,
  },

  playButton: {
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: BROWN,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  playButtonDisabled: {
    opacity: 0.65,
  },

  playButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: WHITE,
  },

  noteHelperText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 10,
  },

  timerCircle: {
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: LIGHT_PINK,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 30,
  },

  timerText: {
    fontFamily: 'FredokaBold',
    fontSize: 54,
    color: BROWN,
  },

  timerLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  liveCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  liveTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    textAlign: 'center',
    marginBottom: 14,
  },

  liveGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },

  liveItem: {
    width: '31%',
    alignItems: 'center',
    marginBottom: 14,
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginBottom: 3,
  },

  liveValue: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },

  recordButton: {
    height: 60,
    borderRadius: 30,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },

  recordingButton: {
    opacity: 0.65,
  },

  recordButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: WHITE,
  },

  manualStopButton: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 10,
  },

  manualStopText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: MUTED,
  },

  helperText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 17,
  },

  errorCard: {
    backgroundColor: '#FFF0F0',
    borderRadius: 14,
    padding: 15,
    marginTop: 20,
    marginBottom: 10,
  },

  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 17,
    color: '#9A3B3B',
    textAlign: 'center',
  },

  processingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
    marginTop: 25,
    textAlign: 'center',
  },

  processingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 10,
    marginBottom: 20,
  },

  resultsTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
  },

  resultsSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 25,
  },

  rangeCard: {
    backgroundColor: PINK,
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
    marginBottom: 18,
  },

  rangeText: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    marginTop: 2,
  },

  rangeHzText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 6,
  },

  scoreCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
  },

  scoreHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  scoreName: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },

  scoreValue: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
  },

  recommendation: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 8,
  },
});