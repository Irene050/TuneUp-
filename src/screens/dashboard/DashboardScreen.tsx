import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
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
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import {
  ASSESSMENT_DURATION,
  type AssessmentAudioBundle,
  type AssessmentResult,
  checkRecordingLevel,
  computeTargetNotes,
  detectVocalRangeFromHums,
  MIN_NOTE_DURATION_SEC,
  runAssessment,
  type TargetNotes,
  type VocalRange,
} from '@/services/assessment/assessmentModule';
import { saveAssessment } from '@/services/assessment/assessmentRepository';
import { calcRMS } from '@/utils/dsp/rms';
import {
  type NoteToPlay,
  playNoteSequence,
} from '@/utils/music/notePlayer';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';
const BORDER = '#F2DDE5';

const AGILITY_PITCH_TOLERANCE = 0.07;
const AGILITY_CONFIRMATION_FRAMES = 3;
const AGILITY_MIN_CLARITY = 0.75;

type AssessmentStep =
  | 'intro'
  | 'lowHum'
  | 'highHum'
  | 'breathControl'
  | 'processingHum'
  | 'stepComplete'
  | 'pitch'
  | 'tone'
  | 'volume'
  | 'agility'
  | 'processing'
  | 'results';

type CompletedStep =
  | 'highHum'
  | 'breathControl'
  | 'pitch'
  | 'tone'
  | 'volume'
  | 'agility';

type RecordedSection = {
  samples: Float32Array;
  sampleRate: number;
};

const STEP_ORDER: AssessmentStep[] = [
  'lowHum',
  'highHum',
  'breathControl',
  'pitch',
  'tone',
  'volume',
  'agility',
];

const NOTE_GUIDED_STEPS: AssessmentStep[] = [
  'pitch',
  'tone',
  'volume',
  'agility',
];

const REQUIRED_STEPS: AssessmentStep[] = [
  'lowHum',
  'highHum',
  'breathControl',
  'pitch',
  'tone',
  'volume',
  'agility',
];

const COMPONENT_NAMES: Record<string, string> = {
  breathControl: 'Breath Control',
  pitch: 'Pitch',
  tone: 'Tone',
  volume: 'Volume',
  agility: 'Agility',
};

function getLiveTitle(step: AssessmentStep): string {
  switch (step) {
    case 'breathControl':
      return 'Breath Control Monitor';
    case 'pitch':
      return 'Pitch Accuracy Monitor';
    case 'tone':
      return 'Tone Monitor';
    case 'volume':
      return 'Volume Control Monitor';
    case 'agility':
      return 'Note Transition Monitor';
    case 'lowHum':
    case 'highHum':
      return 'Vocal Range Monitor';
    default:
      return 'Live Monitor';
  }
}

function getStepTitle(step: AssessmentStep): string {
  switch (step) {
    case 'lowHum':
      return 'Lowest Comfortable Note';
    case 'highHum':
      return 'Highest Comfortable Note';
    case 'breathControl':
      return 'Breath Control';
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
      return 'Sing the lowest note that feels comfortable. Do not strain your voice. Hold the same note steadily for the recording.';
    case 'highHum':
      return 'Sing the highest note that feels comfortable. Do not strain your voice. Hold the same note steadily for the recording.';
    case 'breathControl':
      return 'Take a comfortable breath, then release the air steadily through an “sss” sound. Keep the airflow as even as possible throughout the recording. Do not force your breath.';
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
    case 'lowHum':
    case 'highHum':
      return ASSESSMENT_DURATION.comfortableNote;
    case 'breathControl':
      return ASSESSMENT_DURATION.breathControl;
    case 'pitch':
      return ASSESSMENT_DURATION.pitch;
    case 'tone':
      return ASSESSMENT_DURATION.tone;
    case 'volume':
      return ASSESSMENT_DURATION.volume;
    case 'agility':
      return ASSESSMENT_DURATION.agility;
    default:
      return 0;
  }
}

function getStepReferenceNotes(
  step: AssessmentStep,
  targetNotes: TargetNotes | null,
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

function isRecordingUsable(
  step: AssessmentStep,
  samples: Float32Array,
): boolean {
  if (step === 'breathControl') {
    if (samples.length === 0) {
      return false;
    }

    const rms = calcRMS(samples);
    return Number.isFinite(rms) && rms >= 0.0005;
  }

  return checkRecordingLevel(samples).usable;
}

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

  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;

  return `${noteNames[noteIndex]}${octave}`;
}

export default function AssessmentScreen() {
  const [step, setStep] = useState<AssessmentStep>('intro');
  const [completedStep, setCompletedStep] =
    useState<CompletedStep | null>(null);
  const [isRecordingSection, setIsRecordingSection] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveAudio, setLiveAudio] = useState<LiveAudioFrame | null>(null);
  const [sections, setSections] = useState<
    Partial<Record<AssessmentStep, RecordedSection>>
  >({});
  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);
  const [isPlayingNote, setIsPlayingNote] = useState(false);
  const [hasPlayedNote, setHasPlayedNote] = useState(false);
  const [agilityMatchedCount, setAgilityMatchedCount] = useState(0);

  const recordingStepRef = useRef<AssessmentStep | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);
  const agilityTargetIndexRef = useRef(0);
  const agilityConfirmationCountRef = useRef(0);
  const agilityCompletionTriggeredRef = useRef(false);
  const stopRecordingRef = useRef<(() => Promise<void>) | null>(null);

  const targetNotes = useMemo(() => {
    if (!vocalRange) {
      return null;
    }

    return computeTargetNotes(vocalRange.lowHz, vocalRange.highHz);
  }, [vocalRange]);

  const needsReferenceNote = NOTE_GUIDED_STEPS.includes(step);

  useEffect(() => {
    setHasPlayedNote(false);
  }, [step]);

  const clearRecordingTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const playReferenceNote = useCallback(async () => {
    const notes = getStepReferenceNotes(step, targetNotes);

    if (notes.length === 0 || isPlayingNote || isRecordingSection) {
      return;
    }

    try {
      setError(null);
      setIsPlayingNote(true);
      await playNoteSequence(notes);
      setHasPlayedNote(true);
    } catch (err) {
      console.error('Failed to play reference note:', err);
      setError('Could not play the reference note. You can still continue.');
    } finally {
      setIsPlayingNote(false);
    }
  }, [step, targetNotes, isPlayingNote, isRecordingSection]);

  const moveToNextStep = useCallback((currentStep: AssessmentStep) => {
    const index = STEP_ORDER.indexOf(currentStep);

    if (index === -1) {
      return;
    }

    setStep(STEP_ORDER[index + 1] ?? 'processing');
  }, []);

  const handleAudioFrame = useCallback(
    (frame: LiveAudioFrame) => {
      setLiveAudio(frame);

      if (
        recordingStepRef.current !== 'agility' ||
        stoppingRef.current ||
        agilityCompletionTriggeredRef.current
      ) {
        return;
      }

      const sequence = targetNotes?.agilityRun;

      if (!sequence?.length) {
        return;
      }

      const targetIndex = agilityTargetIndexRef.current;

      if (targetIndex >= sequence.length) {
        return;
      }

      if (
        !Number.isFinite(frame.pitch) ||
        frame.pitch <= 0 ||
        !Number.isFinite(frame.clarity) ||
        frame.clarity < AGILITY_MIN_CLARITY
      ) {
        agilityConfirmationCountRef.current = 0;
        return;
      }

      const expectedFrequency = sequence[targetIndex];
      const deviation =
        Math.abs(frame.pitch - expectedFrequency) / expectedFrequency;

      if (deviation > AGILITY_PITCH_TOLERANCE) {
        agilityConfirmationCountRef.current = 0;
        return;
      }

      agilityConfirmationCountRef.current += 1;

      if (
        agilityConfirmationCountRef.current <
        AGILITY_CONFIRMATION_FRAMES
      ) {
        return;
      }

      agilityConfirmationCountRef.current = 0;
      agilityTargetIndexRef.current += 1;

      const matchedCount = agilityTargetIndexRef.current;
      setAgilityMatchedCount(matchedCount);

      console.log('AGILITY ASSESSMENT NOTE MATCHED:', {
        matchedNote: matchedCount,
        totalNotes: sequence.length,
        expectedFrequencyHz: expectedFrequency,
        detectedFrequencyHz: frame.pitch,
        deviationPct: Number((deviation * 100).toFixed(2)),
      });

      if (matchedCount < sequence.length) {
        return;
      }

      agilityCompletionTriggeredRef.current = true;
      stoppingRef.current = true;
      clearRecordingTimer();
      setRemainingSeconds(0);

      const stopPromise = stopRecordingRef.current?.();

      stopPromise?.catch(err => {
        console.error('Agility automatic stop error:', err);
        stoppingRef.current = false;
        agilityCompletionTriggeredRef.current = false;
        setError(
          'The sequence was detected, but recording could not stop automatically. Please stop the recording manually.',
        );
      });
    },
    [targetNotes, clearRecordingTimer],
  );

  const handleAudioStop = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      const recordedStep = recordingStepRef.current;

      recordingStepRef.current = null;
      clearRecordingTimer();
      setIsRecordingSection(false);
      setLiveAudio(null);
      setRemainingSeconds(0);
      stoppingRef.current = false;

      if (!recordedStep) {
        return;
      }

      const level = {
        ...checkRecordingLevel(samples),
        usable: isRecordingUsable(recordedStep, samples),
      };

      const durationSeconds =
        sampleRate > 0 ? samples.length / sampleRate : 0;

      console.log('ASSESSMENT SECTION COMPLETE:', {
        step: recordedStep,
        samples: samples.length,
        sampleRate,
        durationSeconds,
        rms: level.rms,
        peak: level.peak,
      });

      if (!level.usable) {
        setError(
          'We could not hear enough microphone audio. Please make sure your microphone is working and sing closer to it.',
        );
        setStep(recordedStep);
        return;
      }

      const isHumStep =
        recordedStep === 'lowHum' || recordedStep === 'highHum';

      if (isHumStep && durationSeconds < MIN_NOTE_DURATION_SEC) {
        setError(
          'That recording was too short. Hold one steady note until the timer reaches zero.',
        );
        setStep(recordedStep);
        return;
      }

      setSections(previous => ({
        ...previous,
        [recordedStep]: { samples, sampleRate },
      }));

      if (recordedStep === 'highHum') {
        setStep('processingHum');
        return;
      }

      if (recordedStep === 'lowHum') {
        setTimeout(() => moveToNextStep(recordedStep), 100);
        return;
      }

      setCompletedStep(recordedStep as CompletedStep);
      setStep('stepComplete');
    },
    [clearRecordingTimer, moveToNextStep],
  );

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleAudioFrame,
    onStop: handleAudioStop,
  });

  stopRecordingRef.current = stopRecording;

  const restartRangeRecordings = useCallback((message: string) => {
    setError(message);
    setCompletedStep(null);

    setSections(previous => {
      const updated = { ...previous };
      delete updated.lowHum;
      delete updated.highHum;
      return updated;
    });

    setVocalRange(null);
    setStep('lowHum');
  }, []);

  useEffect(() => {
    if (step !== 'processingHum') {
      return;
    }

    const lowRecording = sections.lowHum;
    const highRecording = sections.highHum;

    if (!lowRecording || !highRecording || vocalRange) {
      return;
    }

    if (
      !checkRecordingLevel(lowRecording.samples).usable ||
      !checkRecordingLevel(highRecording.samples).usable
    ) {
      restartRangeRecordings(
        'We could not hear enough audio to determine your vocal range. Please try both notes again.',
      );
      return;
    }

    if (lowRecording.sampleRate !== highRecording.sampleRate) {
      console.error('Assessment sample-rate mismatch:', {
        low: lowRecording.sampleRate,
        high: highRecording.sampleRate,
      });

      restartRangeRecordings(
        'The microphone sample rate changed during the range recording. Please try the range assessment again.',
      );
      return;
    }

    try {
      const range = detectVocalRangeFromHums(
        lowRecording.samples,
        highRecording.samples,
        lowRecording.sampleRate,
      );

      console.log('DETECTED VOCAL RANGE:', {
        lowHz: range.lowHz,
        highHz: range.highHz,
        lowNote: frequencyToNoteName(range.lowHz),
        highNote: frequencyToNoteName(range.highHz),
      });

      setVocalRange(range);
      setError(null);
      setCompletedStep('highHum');
      setStep('stepComplete');
    } catch (err) {
      console.error('Vocal range detection error:', err);

      restartRangeRecordings(
        err instanceof Error
          ? err.message
          : 'We could not detect your vocal range. Please try humming both notes again.',
      );
    }
  }, [
    step,
    sections.lowHum,
    sections.highHum,
    vocalRange,
    restartRangeRecordings,
  ]);

  const beginSection = useCallback(async () => {
    if (isRecording || isRecordingSection) {
      return;
    }

    const currentStep = step;
    const duration = getStepDuration(currentStep);

    if (duration <= 0) {
      return;
    }

    if (NOTE_GUIDED_STEPS.includes(currentStep) && !hasPlayedNote) {
      setError('Please listen to the reference note before recording.');
      return;
    }

    clearRecordingTimer();
    setError(null);
    setLiveAudio(null);
    setRemainingSeconds(duration);
    recordingStepRef.current = currentStep;
    stoppingRef.current = false;

    if (currentStep === 'agility') {
      agilityTargetIndexRef.current = 0;
      agilityConfirmationCountRef.current = 0;
      agilityCompletionTriggeredRef.current = false;
      setAgilityMatchedCount(0);
    }

    try {
      await startRecording();
      setIsRecordingSection(true);

      let remaining = duration;

      timerRef.current = setInterval(() => {
        remaining -= 1;
        setRemainingSeconds(Math.max(remaining, 0));

        if (remaining > 0) {
          return;
        }

        clearRecordingTimer();

        if (stoppingRef.current) {
          return;
        }

        stoppingRef.current = true;

        stopRecording().catch(err => {
          console.error('Assessment automatic stop error:', err);
          stoppingRef.current = false;
          setIsRecordingSection(false);
          setError(
            'Recording could not stop automatically. Please try stopping the section again.',
          );
        });
      }, 1000);
    } catch (err) {
      console.error('Assessment recording error:', err);

      clearRecordingTimer();
      recordingStepRef.current = null;
      stoppingRef.current = false;
      setIsRecordingSection(false);
      setLiveAudio(null);
      setRemainingSeconds(0);

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to start the microphone. Please check your microphone permission and try again.',
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

  const handleManualStop = useCallback(async () => {
    if ((!isRecording && !isRecordingSection) || stoppingRef.current) {
      return;
    }

    stoppingRef.current = true;
    clearRecordingTimer();

    try {
      await stopRecording();
    } catch (err) {
      console.error('Failed to stop assessment recording:', err);
      stoppingRef.current = false;
      setIsRecordingSection(false);
      setError(
        'Something went wrong while stopping the recording. Please try this section again.',
      );
    }
  }, [
    isRecording,
    isRecordingSection,
    clearRecordingTimer,
    stopRecording,
  ]);

  useEffect(() => {
    return () => {
      clearRecordingTimer();
    };
  }, [clearRecordingTimer]);

  const createAssessmentBundle = useCallback((): AssessmentAudioBundle => {
    const empty = new Float32Array(0);
    const sampleRate =
      sections.pitch?.sampleRate ??
      sections.lowHum?.sampleRate ??
      44100;

    return {
      breathSamples: sections.breathControl?.samples ?? empty,
      pitchSamples: sections.pitch?.samples ?? empty,
      toneSamples: sections.tone?.samples ?? empty,
      volumeSamples: sections.volume?.samples ?? empty,
      agilitySamples: sections.agility?.samples ?? empty,
      lowestComfortableNoteSamples: sections.lowHum?.samples ?? empty,
      highestComfortableNoteSamples: sections.highHum?.samples ?? empty,
      sampleRate,
    };
  }, [sections]);

  const processAssessment = useCallback(async () => {
    try {
      setError(null);

      for (const requiredStep of REQUIRED_STEPS) {
        const recording = sections[requiredStep];

        if (!recording || recording.samples.length === 0) {
          throw new Error(
            `The ${getStepTitle(requiredStep)} recording is missing. Please complete the assessment again.`,
          );
        }

        if (!isRecordingUsable(requiredStep, recording.samples)) {
          throw new Error(
            `The ${getStepTitle(requiredStep)} recording did not contain enough microphone audio.`,
          );
        }
      }

      const sampleRates = REQUIRED_STEPS.map(
        requiredStep => sections[requiredStep]!.sampleRate,
      );

      const firstSampleRate = sampleRates[0];
      const hasSampleRateMismatch = sampleRates.some(
        rate => rate !== firstSampleRate,
      );

      if (hasSampleRateMismatch) {
        throw new Error(
          'The microphone sample rate changed during the assessment. Please complete the assessment again.',
        );
      }

      const audio = createAssessmentBundle();

      console.log('PROCESSING ASSESSMENT AUDIO:', {
        breathControl: audio.breathSamples.length,
        pitch: audio.pitchSamples.length,
        tone: audio.toneSamples.length,
        volume: audio.volumeSamples.length,
        agility: audio.agilitySamples.length,
        low: audio.lowestComfortableNoteSamples.length,
        high: audio.highestComfortableNoteSamples.length,
        sampleRate: audio.sampleRate,
        lowDuration:
          audio.lowestComfortableNoteSamples.length / audio.sampleRate,
        highDuration:
          audio.highestComfortableNoteSamples.length / audio.sampleRate,
      });

      const assessmentResult = runAssessment(audio, vocalRange ?? undefined);
      setResult(assessmentResult);

      try {
        await saveAssessment(assessmentResult);
        console.log('Assessment successfully saved.');
      } catch (saveError) {
        console.error('Could not save assessment to Firebase:', saveError);
        setError(
          'Your assessment was completed, but we could not save it to your account. Please check your internet connection and try again later.',
        );
      }

      setStep('results');
    } catch (err) {
      console.error('Assessment processing error:', err);

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to process the assessment.',
      );

      setSections({});
      setVocalRange(null);
      setResult(null);
      setLiveAudio(null);
      setRemainingSeconds(0);
      setCompletedStep(null);
      setStep('lowHum');
    }
  }, [sections, vocalRange, createAssessmentBundle]);

  const resetAssessment = useCallback(() => {
    clearRecordingTimer();

    recordingStepRef.current = null;
    stoppingRef.current = false;
    agilityTargetIndexRef.current = 0;
    agilityConfirmationCountRef.current = 0;
    agilityCompletionTriggeredRef.current = false;

    setSections({});
    setVocalRange(null);
    setResult(null);
    setError(null);
    setLiveAudio(null);
    setRemainingSeconds(0);
    setIsRecordingSection(false);
    setHasPlayedNote(false);
    setAgilityMatchedCount(0);
    setCompletedStep(null);
    setStep('intro');
  }, [clearRecordingTimer]);

  if (step === 'processingHum') {
    return (
      <View style={styles.centerScreen}>
        <View style={styles.humProcessingIcon}>
          <Ionicons name="musical-notes" size={42} color={BROWN} />
        </View>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={styles.humProcessingSpinner}
        />

        <Text style={styles.processingTitle}>Analyzing Your Hums...</Text>

        <Text style={styles.processingText}>
          We're listening to your recorded notes to determine your
          comfortable vocal range.
        </Text>

        <View style={styles.humProcessingCard}>
          <Ionicons name="checkmark-circle" size={22} color={BROWN} />
          <Text style={styles.humProcessingCardText}>
            Humming recordings captured
          </Text>
        </View>

        <Text style={styles.humProcessingHint}>
          This may take a moment. Please wait while we prepare your next
          exercise.
        </Text>
      </View>
    );
  }

  if (step === 'stepComplete' && completedStep) {
    const isVocalRangeComplete = completedStep === 'highHum';
    const isAgilityComplete = completedStep === 'agility';

    const completionTitle = isVocalRangeComplete
      ? 'Vocal Range Detected!'
      : `${getStepTitle(completedStep)} Assessment Finished!`;

    const completionDescription = isVocalRangeComplete
      ? "Next, we'll assess your breath control."
      : isAgilityComplete
        ? 'Your agility recording is complete. You have finished all five vocal fundamentals!'
        : `Your ${getStepTitle(completedStep).toLowerCase()} recording has been captured. Get ready for the next assessment step.`;

    return (
      <View style={styles.centerScreen}>
        <View style={styles.completionIcon}>
          <Ionicons
            name="checkmark-circle"
            size={54}
            color="#0FE608"
          />
        </View>

        <Text style={styles.completionTitle}>{completionTitle}</Text>

        <Text style={styles.completionDescription}>
          {completionDescription}
        </Text>

        {isVocalRangeComplete && vocalRange && (
          <View style={styles.completionRangeCard}>
            <View style={styles.completionRangeTextContainer}>
              <View style={styles.rangeNotesContainer}>
                <Text style={styles.completionRangeNotes}>
                  {frequencyToNoteName(vocalRange.lowHz)}
                  {' – '}
                  {frequencyToNoteName(vocalRange.highHz)}
                </Text>
              </View>

              <Text style={styles.completionRangeLabel}>
                Your Comfortable Vocal Range
              </Text>
            </View>
          </View>
        )}

        {isAgilityComplete && (
          <View style={styles.completionRangeCard}>
            <Ionicons name="musical-notes" size={24} color={BROWN} />

            <View style={styles.completionRangeTextContainer}>
              <Text style={styles.completionRangeLabel}>
                Assessment Components Completed
              </Text>

              <Text style={styles.completionRangeNotes}>5 of 5</Text>

              <Text style={styles.completionRangeHz}>
                Breath Control · Pitch · Tone · Volume · Agility
              </Text>
            </View>
          </View>
        )}

        <Pressable
          style={styles.primaryButton}
          onPress={() => {
            const finishedStep = completedStep;
            setCompletedStep(null);

            if (finishedStep === 'agility') {
              setStep('processing');
            } else {
              moveToNextStep(finishedStep);
            }
          }}
        >
          <Text style={styles.primaryButtonText}>
            {isAgilityComplete ? 'View Assessment Results' : 'Continue'}
          </Text>
          <Ionicons name="arrow-forward" size={18} color={WHITE} />
        </Pressable>
      </View>
    );
  }

  if (step === 'processing') {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator size="large" color={BROWN} />

        <Text style={styles.processingTitle}>Analyzing your voice...</Text>

        <Text style={styles.processingText}>
          We're checking your five vocal fundamentals and vocal range.
        </Text>

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={styles.primaryButton}
          onPress={processAssessment}
        >
          <Text style={styles.primaryButtonText}>Analyze My Voice</Text>
        </Pressable>
      </View>
    );
  }

  if (step === 'results' && result) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.resultsContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.resultsTitle}>Your Vocal Assessment</Text>

        <Text style={styles.resultsSubtitle}>
          Here's your current vocal foundation.
        </Text>

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.rangeCard}>
          <Text style={styles.cardTitle}>Vocal Range</Text>

          <Text style={styles.rangeText}>
            {frequencyToNoteName(result.vocalRangeLowHz)}
            {'  –  '}
            {frequencyToNoteName(result.vocalRangeHighHz)}
          </Text>

          <Text style={styles.rangeHzText}>
            {result.vocalRangeLowHz.toFixed(1)}
            {' Hz  –  '}
            {result.vocalRangeHighHz.toFixed(1)}
            {' Hz'}
          </Text>
        </View>

        {result.scores.map(score => {
          const recommendation = result.recommendations[score.componentId];

          return (
            <View key={score.componentId} style={styles.scoreCard}>
              <View style={styles.scoreHeader}>
                <Text style={styles.scoreName}>
                  {COMPONENT_NAMES[score.componentId] ?? score.componentId}
                </Text>

                <Text style={styles.scoreValue}>{score.scorePct}%</Text>
              </View>

              <View style={styles.progressBackground}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.max(
                        0,
                        Math.min(100, score.scorePct),
                      )}%`,
                    },
                  ]}
                />
              </View>

              <Text style={styles.recommendation}>
                {recommendation === 'needsSignificantImprovement'
                  ? 'Needs significant improvement'
                  : recommendation === 'moderateImprovement'
                    ? 'Moderate improvement'
                    : 'Good foundation'}
              </Text>
            </View>
          );
        })}

        <Pressable style={styles.primaryButton} onPress={resetAssessment}>
          <Text style={styles.primaryButtonText}>Retake Assessment</Text>
        </Pressable>

        <Pressable
          style={styles.backButtonResults}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={22} color={BROWN} />
        </Pressable>
      </ScrollView>
    );
  }

  if (step === 'intro') {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={22} color={BROWN} />
        </Pressable>

        <View style={styles.iconCircle}>
          <Ionicons name="mic" size={55} color={BROWN} />
        </View>

        <Text style={styles.title}>Vocal Assessment</Text>

        <Text style={styles.description}>
          First, we'll find your comfortable vocal range. Then we'll assess
          your vocal fundamentals.
        </Text>

        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>What we'll check</Text>

          {[
            'Vocal Range',
            'Breath Control',
            'Pitch',
            'Tone',
            'Volume',
            'Agility',
          ].map(item => (
            <Text key={item} style={styles.infoItem}>
              • {item}
            </Text>
          ))}
        </View>

        <Text style={styles.warning}>
          Find a quiet place and make sure your microphone is not covered.
        </Text>

        <Pressable
          style={styles.primaryButton}
          onPress={() => {
            setError(null);
            setCompletedStep(null);
            setStep('lowHum');
          }}
        >
          <Text style={styles.primaryButtonText}>Start Assessment</Text>
          <Ionicons name="arrow-forward" size={18} color={WHITE} />
        </Pressable>
      </ScrollView>
    );
  }

  const duration = getStepDuration(step);
  const isSection = STEP_ORDER.includes(step);

  if (!isSection) {
    return null;
  }

  const stepIndex = STEP_ORDER.indexOf(step);
  const progress = (stepIndex + 1) / STEP_ORDER.length;
  const referenceNotes = getStepReferenceNotes(step, targetNotes);

  const targetNoteLabel =
    referenceNotes.length === 1
      ? frequencyToNoteName(referenceNotes[0].frequencyHz)
      : referenceNotes.length > 1
        ? referenceNotes
            .map(note => frequencyToNoteName(note.frequencyHz))
            .join(' → ')
        : null;

  const canRecord = !needsReferenceNote || hasPlayedNote;
  const isRangeRecording = step === 'lowHum' || step === 'highHum';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        style={styles.backButton}
        onPress={() => {
          if (isRecordingSection || isRecording) {
            return;
          }

          router.back();
        }}
      >
        <Ionicons name="arrow-back" size={22} color={BROWN} />
      </Pressable>

      <View style={styles.progressHeader}>
        <Text style={styles.progressText}>
          Step {stepIndex + 1} of {STEP_ORDER.length}
        </Text>
      </View>

      <View style={styles.progressBackground}>
        <View
          style={[
            styles.progressFill,
            { width: `${progress * 100}%` },
          ]}
        />
      </View>

      <View style={styles.sectionIcon}>
        <Ionicons
          name={needsReferenceNote ? 'musical-notes-outline' : 'mic-outline'}
          size={30}
          color={BROWN}
        />
      </View>

      <Text style={styles.title}>{getStepTitle(step)}</Text>

      <Text style={styles.description}>{getStepInstruction(step)}</Text>

      {needsReferenceNote && (
        <View style={styles.noteCard}>
          {targetNoteLabel && (
            <Text style={styles.noteLabel}>Target: {targetNoteLabel}</Text>
          )}

          <Pressable
            style={[
              styles.playButton,
              isPlayingNote && styles.playButtonDisabled,
            ]}
            disabled={isPlayingNote || isRecordingSection}
            onPress={playReferenceNote}
          >
            <Ionicons
              name={isPlayingNote ? 'volume-high' : 'play'}
              size={20}
              color={WHITE}
            />

            <Text style={styles.playButtonText}>
              {isPlayingNote
                ? 'Playing...'
                : hasPlayedNote
                  ? 'Play Again'
                  : 'Play Note'}
            </Text>
          </Pressable>

          {!hasPlayedNote && (
            <Text style={styles.noteHelperText}>
              Listen to the note before recording.
            </Text>
          )}
        </View>
      )}

      <View style={styles.timerCircle}>
        <Text style={styles.timerText}>
          {isRecordingSection ? remainingSeconds : duration}
        </Text>
        <Text style={styles.timerLabel}>seconds</Text>
      </View>

      {isRecordingSection && (
        <View style={styles.liveCard}>
          <Text style={styles.liveTitle}>{getLiveTitle(step)}</Text>

          {step === 'breathControl' && (
            <>
              <Text style={styles.metricCaption}>Current sound level</Text>

              <Text style={styles.heroMetric}>
                {liveAudio && Number.isFinite(liveAudio.volume)
                  ? `${liveAudio.volume.toFixed(1)} dBFS`
                  : '--'}
              </Text>

              <Text style={styles.metricHint}>
                Keep your “sss” sound as steady as possible. This is a
                relative audio-level indicator, not a direct airflow
                measurement.
              </Text>
            </>
          )}

          {step === 'pitch' && (
            <>
              <Text style={styles.metricCaption}>Target note</Text>
              <Text style={styles.heroMetric}>{targetNoteLabel ?? '--'}</Text>

              <View style={styles.metricDivider} />

              <Text style={styles.metricCaption}>Detected note</Text>
              <Text style={styles.heroMetric}>
                {liveAudio && liveAudio.pitch > 0
                  ? liveAudio.note ?? '--'
                  : '--'}
              </Text>

              <Text style={styles.metricHint}>
                {liveAudio && liveAudio.pitch > 0
                  ? `${liveAudio.pitch.toFixed(1)} Hz`
                  : 'Sing the target note steadily.'}
              </Text>
            </>
          )}

          {step === 'tone' && (
            <>
              <Text style={styles.metricCaption}>Vowel exercise</Text>
              <Text style={styles.heroMetric}>“AH”</Text>

              <View style={styles.metricDivider} />

              <Text style={styles.metricCaption}>Detected frequency</Text>
              <Text style={styles.heroMetric}>
                {liveAudio && liveAudio.pitch > 0
                  ? `${liveAudio.pitch.toFixed(1)} Hz`
                  : '--'}
              </Text>

              <Text style={styles.metricHint}>
                Hold the vowel smoothly. The displayed frequency is your
                detected pitch, not the spectral centroid.
              </Text>
            </>
          )}

          {step === 'volume' && (
            <>
              <Text style={styles.metricCaption}>
                Current relative sound level
              </Text>

              <Text style={styles.heroMetric}>
                {liveAudio && Number.isFinite(liveAudio.volume)
                  ? `${liveAudio.volume.toFixed(1)} dBFS`
                  : '--'}
              </Text>

              <View style={styles.volumeGuide}>
                <View style={styles.volumeGuideItem}>
                  <Ionicons name="volume-low" size={22} color={BROWN} />
                  <Text style={styles.volumeGuideText}>Soft</Text>
                </View>

                <Ionicons name="arrow-forward" size={18} color={MUTED} />

                <View style={styles.volumeGuideItem}>
                  <Ionicons name="volume-high" size={22} color={BROWN} />
                  <Text style={styles.volumeGuideText}>Loud</Text>
                </View>

                <Ionicons name="arrow-forward" size={18} color={MUTED} />

                <View style={styles.volumeGuideItem}>
                  <Ionicons name="volume-low" size={22} color={BROWN} />
                  <Text style={styles.volumeGuideText}>Soft</Text>
                </View>
              </View>

              <Text style={styles.metricHint}>
                Follow the soft–loud–soft pattern. Your recording level
                depends on microphone distance and device settings.
              </Text>
            </>
          )}

          {step === 'agility' && (
            <>
              <Text style={styles.metricCaption}>Target note sequence</Text>
              <Text style={styles.sequenceText}>{targetNoteLabel ?? '--'}</Text>

              <View style={styles.metricDivider} />

              <Text style={styles.metricCaption}>
                Currently detected note
              </Text>
              <Text style={styles.heroMetric}>
                {liveAudio && liveAudio.pitch > 0
                  ? liveAudio.note ?? '--'
                  : '--'}
              </Text>

              <Text style={styles.metricHint}>
                Notes matched: {agilityMatchedCount}/
                {targetNotes?.agilityRun.length ?? 7}
              </Text>

              <Text style={styles.metricHint}>
                Sing each note in order, clearly and without unnecessary
                pauses. Recording stops when the complete sequence is
                detected.
              </Text>
            </>
          )}

          {(step === 'lowHum' || step === 'highHum') && (
            <>
              <Text style={styles.metricCaption}>Detected note</Text>
              <Text style={styles.heroMetric}>
                {liveAudio && liveAudio.pitch > 0
                  ? liveAudio.note ?? '--'
                  : '--'}
              </Text>

              <Text style={styles.metricHint}>
                {liveAudio && liveAudio.pitch > 0
                  ? `${liveAudio.pitch.toFixed(1)} Hz`
                  : 'Hum one comfortable note steadily.'}
              </Text>
            </>
          )}
        </View>
      )}

      <Pressable
        style={[
          styles.recordButton,
          (isRecordingSection || !canRecord) && styles.recordingButton,
        ]}
        disabled={isRecordingSection || isRecording || !canRecord}
        onPress={beginSection}
      >
        <Ionicons
          name={isRecordingSection ? 'radio' : 'mic'}
          size={30}
          color={WHITE}
        />

        <Text style={styles.recordButtonText}>
          {isRecordingSection ? 'Recording...' : 'Record'}
        </Text>
      </Pressable>

      {isRecordingSection && (
        <Pressable
          style={styles.manualStopButton}
          onPress={handleManualStop}
        >
          <Text style={styles.manualStopText}>Stop Early</Text>
        </Pressable>
      )}

      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Text style={styles.helperText}>
        {isRangeRecording
          ? 'For the most accurate range, keep the same note steady until the timer reaches zero.'
          : step === 'agility'
            ? 'Recording stops after the full note sequence is detected, or when the timer reaches zero.'
            : 'Recording will automatically stop when the timer reaches zero.'}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    marginTop: 50,
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
    width: 82,
    height: 82,
    borderRadius: 100,
    backgroundColor: '#FFD BE1'.replace(' ', ''),
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
  humProcessingIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  humProcessingSpinner: {
    marginTop: 8,
    marginBottom: 4,
  },
  humProcessingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: LIGHT_PINK,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    width: '100%',
    marginTop: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  humProcessingCardText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },
  humProcessingHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 19,
    color: MUTED,
    textAlign: 'center',
    marginTop: 22,
  },
  completionIcon: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  completionTitle: {
    marginTop: -30,
    fontFamily: 'FredokaBold',
    fontSize: 27,
    lineHeight: 35,
    color: BROWN,
    textAlign: 'center',
    marginBottom: 12,
  },
  completionDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    lineHeight: 22,
    color: MUTED,
    textAlign: 'center',
    marginBottom: 20,
  },
  completionRangeCard: {
    marginTop: -30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    width: '90%',
    backgroundColor: '#FFD8E2',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FFD8E2',
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 18,
  },
  completionRangeTextContainer: {
    borderRadius: 18,
    flex: 1,
    alignItems: 'center',
  },
  rangeNotesContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHITE,
    borderRadius: 16,
    paddingVertical: 12,
    minHeight: 105,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  completionRangeLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
    textAlign: 'center',
  },
  completionRangeNotes: {
    fontFamily: 'FredokaBold',
    fontSize: 36,
    color: BROWN,
    textAlign: 'center',
  },
  completionRangeHz: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 4,
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
    marginTop: 60,
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
    borderColor: BORDER,
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
    borderColor: BORDER,
  },
  liveTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    textAlign: 'center',
    marginBottom: 14,
  },
  metricCaption: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    marginBottom: 4,
  },
  heroMetric: {
    fontFamily: 'FredokaBold',
    fontSize: 32,
    color: BROWN,
    textAlign: 'center',
    marginBottom: 8,
  },
  metricHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
  },
  metricDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 14,
  },
  sequenceText: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    textAlign: 'center',
    lineHeight: 30,
  },
  volumeGuide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
    backgroundColor: WHITE,
    borderRadius: 14,
  },
  volumeGuideItem: {
    alignItems: 'center',
    gap: 4,
  },
  volumeGuideText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
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