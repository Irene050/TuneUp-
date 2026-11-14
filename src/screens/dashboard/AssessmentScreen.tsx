import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, Text, View } from 'react-native';

import {
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';

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
import {
  type NoteToPlay,
  playNoteSequence,
} from '@/utils/music/notePlayer';
import {
  frequencyToNoteName,
} from '@/utils/music/notes';
import { classifyVoice } from '@/utils/music/voiceClassification';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';

import {
  ExerciseQuitModal,
} from '@/components/ExerciseModals';

const AGILITY_PITCH_TOLERANCE = 0.07;
const AGILITY_CONFIRMATION_FRAMES = 3;
const AGILITY_MIN_CLARITY = 0.75;

type AssessmentStep =
  | 'instructions'
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

export default function AssessmentScreen() {
  const { phase, setPhase } =
    usePhaseState<AssessmentStep>('instructions');
  const [completedStep, setCompletedStep] =
    useState<CompletedStep | null>(null);
  const [isRecordingSection, setIsRecordingSection] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [liveAudioFrame, setLiveAudioFrame] = useState<LiveAudioFrame | null>(null);
  const [sections, setSections] = useState<
    Partial<Record<AssessmentStep, RecordedSection>>
  >({});
  const [vocalRange, setVocalRange] = useState<VocalRange | null>(null);
  const [isPlayingNote, setIsPlayingNote] = useState(false);
  const [hasPlayedNote, setHasPlayedNote] = useState(false);
  const [agilityMatchedCount, setAgilityMatchedCount] = useState(0);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const recordingStepRef = useRef<AssessmentStep | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);
  const quittingRef = useRef(false);
  const startingSectionRef = useRef(false);
  const agilityTargetIndexRef = useRef(0);
  const agilityConfirmationCountRef = useRef(0);
  const agilityCompletionTriggeredRef = useRef(false);
  const playbackGenerationRef = useRef(0);
  const stopRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const cancelRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const processingRef = useRef(false);
  const backgroundNavigationRef = useRef(false);
  const currentResultRef = useRef<AssessmentResult | null>(null);

  useFocusEffect(
    useCallback(() => {
      backgroundNavigationRef.current = false;
    }, []),
  );

  const targetNotes = useMemo(() => {
    if (!vocalRange) {
      return null;
    }

    return computeTargetNotes(vocalRange.lowHz, vocalRange.highHz);
  }, [vocalRange]);

  const needsReferenceNote = NOTE_GUIDED_STEPS.includes(phase);
  const isAssessmentInProgress =
    phase !== 'instructions' && phase !== 'results';

  useEffect(() => {
    setHasPlayedNote(false);
  }, [phase]);

  const clearRecordingTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const playReferenceNote = useCallback(async () => {
    const notes = getStepReferenceNotes(phase, targetNotes);

    if (
      notes.length === 0 ||
      isPlayingNote ||
      isRecordingSection ||
      quittingRef.current
    ) {
      return;
    }

    const playbackGeneration = playbackGenerationRef.current;

    try {
      setErrorMessage(null);
      setIsPlayingNote(true);

      await playNoteSequence(notes);

      if (
        !quittingRef.current &&
        playbackGeneration === playbackGenerationRef.current
      ) {
        setHasPlayedNote(true);
      }
    } catch (err) {
      console.error('Failed to play reference note:', err);

      if (
        !quittingRef.current &&
        playbackGeneration === playbackGenerationRef.current
      ) {
        setErrorMessage(
          'Could not play the reference note. You can still continue.',
        );
      }
    } finally {
      if (playbackGeneration === playbackGenerationRef.current) {
        setIsPlayingNote(false);
      }
    }
  }, [phase, targetNotes, isPlayingNote, isRecordingSection]);

  const moveToNextStep = useCallback((currentStep: AssessmentStep) => {
    if (quittingRef.current) {
      return;
    }

    const index = STEP_ORDER.indexOf(currentStep);

    if (index === -1) {
      return;
    }

    setPhase(STEP_ORDER[index + 1] ?? 'processing');
  }, []);

  const handleAudioFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (quittingRef.current) {
        return;
      }

      setLiveAudioFrame(frame);

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

        if (!quittingRef.current) {
          stoppingRef.current = false;
          agilityCompletionTriggeredRef.current = false;
          setErrorMessage(
            'The sequence was detected, but recording could not stop automatically. Please stop the recording manually.',
          );
        }
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
      setLiveAudioFrame(null);
      setRemainingSeconds(0);
      stoppingRef.current = false;

      if (quittingRef.current || !recordedStep) {
        return;
      }

      const level = checkRecordingLevel(samples);
      if (recordedStep === 'breathControl') {
        level.usable = level.rms >= 0.0005;
      }

      const durationSeconds =
        sampleRate > 0 ? samples.length / sampleRate : 0;

      if (!level.usable) {
        setErrorMessage(
          'We could not hear enough microphone audio. Please make sure your microphone is working and sing closer to it.',
        );
        setPhase(recordedStep);
        return;
      }

      const isHumStep =
        recordedStep === 'lowHum' || recordedStep === 'highHum';

      if (isHumStep && durationSeconds < MIN_NOTE_DURATION_SEC) {
        setErrorMessage(
          'That recording was too short. Hold one steady note until the timer reaches zero.',
        );
        setPhase(recordedStep);
        return;
      }

      setSections(previous => ({
        ...previous,
        [recordedStep]: { samples, sampleRate },
      }));

      if (recordedStep === 'highHum') {
        setPhase('processingHum');
        return;
      }

      if (recordedStep === 'lowHum') {
        moveToNextStep(recordedStep);
        return;
      }

      setCompletedStep(recordedStep as CompletedStep);
      setPhase('stepComplete');
    },
    [clearRecordingTimer, moveToNextStep],
  );

  const {
    startRecording,
    stopRecording,
    cancelRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleAudioFrame,
    onStop: handleAudioStop,
  });

  stopRecordingRef.current = stopRecording;
  cancelRecordingRef.current = cancelRecording;

  const restartRangeRecordings = useCallback((message: string) => {
    if (quittingRef.current) {
      return;
    }

    setErrorMessage(message);
    setCompletedStep(null);

    setSections(previous => {
      const updated = { ...previous };
      delete updated.lowHum;
      delete updated.highHum;
      return updated;
    });

    setVocalRange(null);
    setPhase('lowHum');
  }, []);

  useEffect(() => {
    if (phase !== 'processingHum' || quittingRef.current) {
      return;
    }

    const lowRecording = sections.lowHum;
    const highRecording = sections.highHum;

    if (!lowRecording || !highRecording || vocalRange) {
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

      if (quittingRef.current) {
        return;
      }

      setVocalRange(range);
      setErrorMessage(null);
      setCompletedStep('highHum');
      setPhase('stepComplete');
    } catch (err) {
      console.error('Vocal range detection error:', err);

      restartRangeRecordings(
        err instanceof Error
          ? err.message
          : 'We could not detect your vocal range. Please try humming both notes again.',
      );
    }
  }, [
    phase,
    sections.lowHum,
    sections.highHum,
    vocalRange,
    restartRangeRecordings,
  ]);

  const beginSection = useCallback(async () => {
    if (
      isRecording ||
      isRecordingSection ||
      startingSectionRef.current ||
      isQuitting ||
      quittingRef.current
    ) {
      return;
    }

    const currentStep = phase;
    const duration = getStepDuration(currentStep);

    if (duration <= 0) {
      return;
    }

    if (NOTE_GUIDED_STEPS.includes(currentStep) && !hasPlayedNote) {
      setErrorMessage('Please listen to the reference note before recording.');
      return;
    }

    startingSectionRef.current = true;
    clearRecordingTimer();
    setErrorMessage(null);
    setLiveAudioFrame(null);
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

      if (quittingRef.current) {
        try {
          await cancelRecording();
        } catch (cancelError) {
          console.error(
            'Failed to cancel recorder after a pending start:',
            cancelError,
          );
        }

        return;
      }

      setIsRecordingSection(true);

      let remaining = duration;

      timerRef.current = setInterval(() => {
        if (quittingRef.current) {
          clearRecordingTimer();
          return;
        }

        remaining -= 1;
        setRemainingSeconds(Math.max(remaining, 0));

        if (remaining > 0) {
          return;
        }

        clearRecordingTimer();

        if (stoppingRef.current || quittingRef.current) {
          return;
        }

        stoppingRef.current = true;

        stopRecording().catch(err => {
          console.error('Assessment automatic stop error:', err);

          if (!quittingRef.current) {
            stoppingRef.current = false;
            setIsRecordingSection(false);
            setErrorMessage(
              'Recording could not stop automatically. Please try stopping the section again.',
            );
          }
        });
      }, 1000);
    } catch (err) {
      console.error('Assessment recording error:', err);

      clearRecordingTimer();

      if (!quittingRef.current) {
        recordingStepRef.current = null;
        stoppingRef.current = false;
        setIsRecordingSection(false);
        setLiveAudioFrame(null);
        setRemainingSeconds(0);
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Unable to start the microphone. Please check your microphone permission and try again.',
        );
      }
    } finally {
      startingSectionRef.current = false;
    }
  }, [
    phase,
    hasPlayedNote,
    isRecording,
    isRecordingSection,
    isQuitting,
    clearRecordingTimer,
    startRecording,
    stopRecording,
    cancelRecording,
  ]);

  const handleManualStop = useCallback(async () => {
    if (
      (!isRecording && !isRecordingSection) ||
      stoppingRef.current ||
      quittingRef.current
    ) {
      return;
    }

    stoppingRef.current = true;
    clearRecordingTimer();

    try {
      await stopRecording();
    } catch (err) {
      console.error('Failed to stop assessment recording:', err);

      if (!quittingRef.current) {
        stoppingRef.current = false;
        setIsRecordingSection(false);
        setErrorMessage(
          'Something went wrong while stopping the recording. Please try this section again.',
        );
      }
    }
  }, [
    isRecording,
    isRecordingSection,
    clearRecordingTimer,
    stopRecording,
  ]);

  const handleQuitAssessment = useCallback(() => {
    if (isQuitting || quittingRef.current) {
      return;
    }

    setShowQuitModal(true);
  }, [isQuitting]);

  const confirmQuitAssessment = useCallback(async () => {
    if (isQuitting || quittingRef.current) {
      return;
    }
    quittingRef.current = true;
    playbackGenerationRef.current += 1;

    setIsQuitting(true);
    setShowQuitModal(false);
    clearRecordingTimer();

    stoppingRef.current = true;
    agilityCompletionTriggeredRef.current = true;

    try {
      const recorderMayBeActive =
        isRecording ||
        isRecordingSection ||
        startingSectionRef.current ||
        recordingStepRef.current !== null;

      if (recorderMayBeActive) {
        await cancelRecording();
      }
    } catch (err) {
      console.error(
        'Failed to cancel assessment recording while quitting:',
        err,
      );
    } finally {
      clearRecordingTimer();

      recordingStepRef.current = null;
      startingSectionRef.current = false;
      stoppingRef.current = false;
      agilityTargetIndexRef.current = 0;
      agilityConfirmationCountRef.current = 0;
      agilityCompletionTriggeredRef.current = false;

      setSections({});
      setVocalRange(null);
      setResult(null);
      setErrorMessage(null);
      setLiveAudioFrame(null);
      setRemainingSeconds(0);
      setIsRecordingSection(false);
      setHasPlayedNote(false);
      setIsPlayingNote(false);
      setAgilityMatchedCount(0);
      setCompletedStep(null);
      setShowQuitModal(false);
      setPhase('instructions');
      setIsQuitting(false);
    }
  }, [
    isQuitting,
    isRecording,
    isRecordingSection,
    clearRecordingTimer,
    cancelRecording,
  ]);

  useEffect(() => {
    if (!isAssessmentInProgress) {
      return;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (isQuitting || quittingRef.current) {
          return true;
        }

        if (showQuitModal) {
          setShowQuitModal(false);
          return true;
        }

        setShowQuitModal(true);
        return true;
      },
    );

    return () => subscription.remove();
  }, [isAssessmentInProgress, showQuitModal, isQuitting]);

  useEffect(() => {
    return () => {
      quittingRef.current = true;
      playbackGenerationRef.current += 1;

      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      recordingStepRef.current = null;
      startingSectionRef.current = false;
      stoppingRef.current = true;

      const cancel = cancelRecordingRef.current;

      if (cancel) {
        void cancel().catch(err => {
          console.error(
            'Failed to cancel assessment recorder on unmount:',
            err,
          );
        });
      }
    };
  }, []);

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
    if (quittingRef.current || processingRef.current) {
      return;
    }

    processingRef.current = true;

    try {
      setErrorMessage(null);
      await new Promise<void>(resolve => setTimeout(resolve, 0));

      const sampleRates = REQUIRED_STEPS.map(
        requiredStep => {
          const recording = sections[requiredStep];
          if (!recording || recording.samples.length === 0) {
            throw new Error(
              `The ${getStepTitle(requiredStep)} recording is missing. Please complete the assessment again.`,
            );
          }
          return recording.sampleRate;
        },
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

      const assessmentResult = await runAssessment(
        audio,
        vocalRange ?? undefined,
      );

      if (quittingRef.current) {
        return;
      }

      setResult(assessmentResult);
      currentResultRef.current = assessmentResult;
      setPhase('results');

      void saveAssessment(assessmentResult)
        .then(() => {
          console.log('Assessment successfully saved.');
        })
        .catch(saveError => {
          console.error('Could not save assessment to Firebase:', saveError);

          if (
            !quittingRef.current &&
            currentResultRef.current === assessmentResult
          ) {
            setErrorMessage(
              'Your assessment was completed, but we could not save it to your account. Please check your internet connection and try again later.',
            );
          }
        });
    } catch (err) {
      console.error('Assessment processing error:', err);

      if (quittingRef.current) {
        return;
      }

      processingRef.current = false;
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to process the assessment.',
      );

      setSections({});
      setVocalRange(null);
      setResult(null);
      currentResultRef.current = null;
      setLiveAudioFrame(null);
      setRemainingSeconds(0);
      setCompletedStep(null);
      setPhase('lowHum');

      if (backgroundNavigationRef.current) {
        backgroundNavigationRef.current = false;
        router.back();
      }
    }
  }, [sections, vocalRange, createAssessmentBundle]);

  useEffect(() => {
    if (phase !== 'processing') {
      return;
    }

    const timer = setTimeout(processAssessment, 0);

    return () => clearTimeout(timer);
  }, [phase, processAssessment]);

  const resetAssessment = useCallback(() => {
    clearRecordingTimer();

    recordingStepRef.current = null;
    startingSectionRef.current = false;
    stoppingRef.current = false;
    quittingRef.current = false;
    playbackGenerationRef.current += 1;
    agilityTargetIndexRef.current = 0;
    agilityConfirmationCountRef.current = 0;
    agilityCompletionTriggeredRef.current = false;
    processingRef.current = false;
    backgroundNavigationRef.current = false;

    setSections({});
    setVocalRange(null);
    setResult(null);
    currentResultRef.current = null;
    setErrorMessage(null);
    setLiveAudioFrame(null);
    setRemainingSeconds(0);
    setIsRecordingSection(false);
    setHasPlayedNote(false);
    setIsPlayingNote(false);
    setAgilityMatchedCount(0);
    setCompletedStep(null);
    setShowQuitModal(false);
    setIsQuitting(false);
    setPhase('instructions');
  }, [clearRecordingTimer]);

  const openBackgroundRoute = useCallback(
    (tab: 'index' | 'exercises') => {
      if (backgroundNavigationRef.current) {
        return;
      }

      backgroundNavigationRef.current = true;
      router.push({
        pathname: '/dashboard',
        params: { tab },
      });
    },
    [],
  );

    const continueAssessment = useCallback(() => {
    if (isQuitting || quittingRef.current) {
      return;
    }

    setShowQuitModal(false);
  }, [isQuitting]);

  const quitModal = (
    <ExerciseQuitModal
      visible={showQuitModal}
      message="Your assessment progress may be lost if you leave now. Are you sure you want to quit?"
      isQuitting={isQuitting}
      onContinue={continueAssessment}
      onQuit={() => void confirmQuitAssessment()}
      title="Quit assessment?"
      continueLabel="Continue Assessment"
      quitLabel="Quit Assessment"
    />
  );

  if (phase === 'processingHum') {
    return (
      <View style={exerciseStyles.centerScreen}>
        {quitModal}

        <View style={exerciseStyles.humProcessingIcon}>
          <Ionicons name="musical-notes" size={42} color={COLORS.brown} />
        </View>

        <ActivityIndicator
          size="large"
          color={COLORS.brown}
          style={exerciseStyles.humProcessingSpinner}
        />

        <Text style={exerciseStyles.processingTitle}>Analyzing Your Hums...</Text>

        <Text style={exerciseStyles.processingText}>
          We're listening to your recorded notes to determine your
          comfortable vocal range.
        </Text>

        <View style={exerciseStyles.humProcessingCard}>
          <Ionicons name="checkmark-circle" size={22} color={COLORS.brown} />
          <Text style={exerciseStyles.timeText}>
            Humming recordings captured
          </Text>
        </View>

        <Text style={exerciseStyles.humProcessingHint}>
          This may take a moment. Please wait while we prepare your next
          exercise.
        </Text>
      </View>
    );
  }

  if (phase === 'stepComplete' && completedStep) {
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
      <View style={exerciseStyles.centerScreen}>
        {quitModal}

        <View style={exerciseStyles.completionIcon}>
          <Ionicons name="checkmark-circle" size={54} color={COLORS.success} />
        </View>

        <Text style={exerciseStyles.completionTitle}>{completionTitle}</Text>

        <Text style={exerciseStyles.completionDescription}>
          {completionDescription}
        </Text>

        {isVocalRangeComplete && vocalRange && (
          <View style={exerciseStyles.completionRangeCard}>
            <View style={exerciseStyles.completionRangeTextContainer}>
              <View style={exerciseStyles.rangeNotesContainer}>
                <Text style={exerciseStyles.completionRangeNotes}>
                  {frequencyToNoteName(vocalRange.lowHz)}
                  {' – '}
                  {frequencyToNoteName(vocalRange.highHz)}
                </Text>

                <Text style={exerciseStyles.voiceClassification}>
                  {classifyVoice(vocalRange.lowHz, vocalRange.highHz)}
                </Text>
              </View>

              <Text style={exerciseStyles.completionRangeLabel}>
                Your Comfortable Vocal Range
              </Text>
            </View>
          </View>
        )}

        {isAgilityComplete && (
          <View style={exerciseStyles.completionRangeCard}>
            <View style={exerciseStyles.completionRangeTextContainer}>
              <Text style={exerciseStyles.completionRangeLabel}>
                Assessment Components Completed
              </Text>

              <Text style={exerciseStyles.completionRangeNotes}>5 of 5</Text>

              <Text style={exerciseStyles.completionRangeHz}>
                Breath Control · Pitch · Tone · Volume · Agility
              </Text>
            </View>
          </View>
        )}

        <Pressable
          style={exerciseStyles.primaryButton_Assessment}
          disabled={isQuitting}
          onPress={() => {
            if (quittingRef.current) {
              return;
            }

            const finishedStep = completedStep;
            setCompletedStep(null);

            if (finishedStep === 'agility') {
              processingRef.current = false;
              setPhase('processing');
            } else {
              moveToNextStep(finishedStep);
            }
          }}
        >
          <Text style={exerciseStyles.startButtonText}>
            {isAgilityComplete ? 'View Assessment Results' : 'Continue'}
          </Text>
          <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
        </Pressable>
      </View>
    );
  }

  if (phase === 'processing') {
    return (
      <View style={exerciseStyles.centerScreen}>
        {quitModal}

        <ActivityIndicator size="large" color={COLORS.brown} />

        <Text style={exerciseStyles.processingTitle}>Analyzing your voice...</Text>

        {errorMessage && (
          <View style={exerciseStyles.errorCard_Assessment}>
            <Text style={exerciseStyles.errorText_Assessment}>{errorMessage}</Text>
          </View>
        )}
      </View>
    );
  }

  if (phase === 'results' && result) {
    return (
      <>
        <ScrollView
          style={exerciseStyles.screen_Assessment}
          contentContainerStyle={exerciseStyles.resultsContent_Assessment}
          showsVerticalScrollIndicator={false}
        >
          <Text style={exerciseStyles.title}>Your Vocal Assessment</Text>

        <Text style={exerciseStyles.resultsSubtitle_Assessment}>
          Here's your current vocal foundation.
        </Text>

        {errorMessage && (
          <View style={exerciseStyles.errorCard_Assessment}>
            <Text style={exerciseStyles.errorText_Assessment}>{errorMessage}</Text>
          </View>
        )}

        <View style={exerciseStyles.rangeCard_Assessment}>
          <Text style={exerciseStyles.sectionTitle}>Vocal Range</Text>

          <Text style={[exerciseStyles.referenceNote, { fontSize: 28 }]}>
            {frequencyToNoteName(result.vocalRangeLowHz)}
            {'  –  '}
            {frequencyToNoteName(result.vocalRangeHighHz)}
          </Text>

          <Text style={exerciseStyles.voiceClassification}>
            {classifyVoice(
              result.vocalRangeLowHz,
              result.vocalRangeHighHz,
            )}
          </Text>
        </View>

        {result.scores.map(score => {
          const recommendation = result.recommendations[score.componentId];

          return (
            <View key={score.componentId} style={exerciseStyles.scoreCard_Assessment}>
              <View style={exerciseStyles.scoreHeader}>
                <Text style={exerciseStyles.resultDetailValue}>
                  {COMPONENT_NAMES[score.componentId] ?? score.componentId}
                </Text>

                <Text style={exerciseStyles.resultValueVariant1}>{score.scorePct}%</Text>
              </View>

              <View style={exerciseStyles.progressBackground_Assessment}>
                <View
                  style={[
                    exerciseStyles.progressFill_Assessment,
                    {
                      width: `${Math.max(
                        0,
                        Math.min(100, score.scorePct),
                      )}%`,
                    },
                  ]}
                />
              </View>

              <Text style={exerciseStyles.recommendation}>
                {recommendation === 'needsSignificantImprovement'
                  ? 'Needs significant improvement'
                  : recommendation === 'moderateImprovement'
                    ? 'Moderate improvement'
                    : 'Good foundation'}
              </Text>
            </View>
          );
        })}

        <Pressable style={exerciseStyles.primaryButton_Assessment} onPress={resetAssessment}>
          <Text style={exerciseStyles.startButtonText}>Retake Assessment</Text>
        </Pressable>

          <Pressable
            style={exerciseStyles.backButtonResults}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.brown} />
          </Pressable>
        </ScrollView>

      </>
    );
  }

  if (phase === 'instructions') {
    return (
      <ScrollView
        style={exerciseStyles.screen_Assessment}
        contentContainerStyle={exerciseStyles.content_Assessment}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={exerciseStyles.backButton_Assessment}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.brown} />
        </Pressable>

        <View style={exerciseStyles.iconCircle_Assessment}>
          <Ionicons name="mic" size={55} color={COLORS.brown} />
        </View>

        <Text style={exerciseStyles.title_Assessment}>Vocal Assessment</Text>

        <Text style={exerciseStyles.description}>
          First, we'll find your comfortable vocal range. Then we'll assess
          your vocal fundamentals.
        </Text>

        <View style={exerciseStyles.infoCard_Assessment}>
          <Text style={exerciseStyles.sectionTitle}>What we'll check</Text>

          {[
            'Vocal Range',
            'Breath Control',
            'Pitch',
            'Tone',
            'Volume',
            'Agility',
          ].map(item => (
            <Text key={item} style={exerciseStyles.infoItem}>
              • {item}
            </Text>
          ))}
        </View>

        <Text style={exerciseStyles.warning}>
          Find a quiet place and make sure your microphone is not covered.
        </Text>

        <Pressable
          style={exerciseStyles.primaryButton_Assessment}
          disabled={isQuitting}
          onPress={() => {
            quittingRef.current = false;
            startingSectionRef.current = false;
            stoppingRef.current = false;
            recordingStepRef.current = null;

            clearRecordingTimer();

            agilityTargetIndexRef.current = 0;
            agilityConfirmationCountRef.current = 0;
            agilityCompletionTriggeredRef.current = false;

            setSections({});
            setVocalRange(null);
            setResult(null);
            currentResultRef.current = null;
            setErrorMessage(null);
            setLiveAudioFrame(null);
            setRemainingSeconds(0);
            setIsRecordingSection(false);
            setHasPlayedNote(false);
            setIsPlayingNote(false);
            setAgilityMatchedCount(0);
            setCompletedStep(null);
            setShowQuitModal(false);
            setIsQuitting(false);
            setPhase('lowHum');
          }}
        >
          <Text style={exerciseStyles.startButtonText}>Start Assessment</Text>
          <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
        </Pressable>
      </ScrollView>
    );
  }

  const duration = getStepDuration(phase);
  const isSection = STEP_ORDER.includes(phase);

  if (!isSection) {
    return null;
  }

  const stepIndex = STEP_ORDER.indexOf(phase);
  const progress = (stepIndex + 1) / STEP_ORDER.length;
  const referenceNotes = getStepReferenceNotes(phase, targetNotes);

  const targetNoteLabel =
    referenceNotes.length === 1
      ? frequencyToNoteName(referenceNotes[0].frequencyHz)
      : referenceNotes.length > 1
        ? referenceNotes
            .map(note => frequencyToNoteName(note.frequencyHz))
            .join(' → ')
        : null;

  const canRecord = !needsReferenceNote || hasPlayedNote;
  const isRangeRecording = phase === 'lowHum' || phase === 'highHum';

  return (
    <>
      {quitModal}

      <ScrollView
        style={exerciseStyles.screen_Assessment}
        contentContainerStyle={exerciseStyles.content_Assessment}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={exerciseStyles.backButton_Assessment}
          disabled={isQuitting}
          onPress={handleQuitAssessment}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.brown} />
        </Pressable>

        <View style={exerciseStyles.progressHeader_Assessment}>
          <Text style={exerciseStyles.sessionLabel}>
            Step {stepIndex + 1} of {STEP_ORDER.length}
          </Text>
        </View>

        <View style={exerciseStyles.progressBackground_Assessment}>
          <View
            style={[
              exerciseStyles.progressFill_Assessment,
              { width: `${progress * 100}%` },
            ]}
          />
        </View>

        <View style={exerciseStyles.sectionIcon}>
          <Ionicons
            name={needsReferenceNote ? 'musical-notes-outline' : 'mic-outline'}
            size={30}
            color={COLORS.brown}
          />
        </View>

        <Text style={exerciseStyles.title_Assessment}>{getStepTitle(phase)}</Text>

        <Text style={exerciseStyles.description}>{getStepInstruction(phase)}</Text>

        {needsReferenceNote && (
          <View style={exerciseStyles.noteCard_Assessment}>
            {targetNoteLabel && (
              <Text style={exerciseStyles.noteLabel}>Target: {targetNoteLabel}</Text>
            )}

            <Pressable
              style={[
                exerciseStyles.playButton_Assessment,
                isPlayingNote && exerciseStyles.recordingButton,
              ]}
              disabled={
                isPlayingNote ||
                isRecordingSection ||
                isQuitting
              }
              onPress={() => {
                void playReferenceNote();
              }}
            >
              <Ionicons
                name={isPlayingNote ? 'volume-high' : 'play'}
                size={20}
                color={COLORS.white}
              />

              <Text style={exerciseStyles.logoutText}>
                {isPlayingNote
                  ? 'Playing...'
                  : hasPlayedNote
                    ? 'Play Again'
                    : 'Play Note'}
              </Text>
            </Pressable>

            {!hasPlayedNote && (
              <Text style={exerciseStyles.noteHelperText}>
                Listen to the note before recording.
              </Text>
            )}
          </View>
        )}

        <View style={exerciseStyles.timerCircle}>
          <Text style={exerciseStyles.timerText_Assessment}>
            {isRecordingSection ? remainingSeconds : duration}
          </Text>
          <Text style={exerciseStyles.sessionLabel}>seconds</Text>
        </View>

        {isRecordingSection && (
          <View style={exerciseStyles.liveCard_Assessment}>
            <Text style={exerciseStyles.liveTitle}>{getLiveTitle(phase)}</Text>

            {phase === 'breathControl' && (
              <>
                <Text style={exerciseStyles.metricCaption}>Current sound level</Text>

                <Text style={exerciseStyles.heroMetric}>
                  {liveAudioFrame && Number.isFinite(liveAudioFrame.volume)
                    ? `${liveAudioFrame.volume.toFixed(1)} dBFS`
                    : '--'}
                </Text>

                <Text style={exerciseStyles.metricHint_Assessment}>
                  Keep your “sss” sound as steady as possible. This is a
                  relative audio-level indicator, not a direct airflow
                  measurement.
                </Text>
              </>
            )}

            {phase === 'pitch' && (
              <>
                <Text style={exerciseStyles.metricCaption}>Target note</Text>
                <Text style={exerciseStyles.heroMetric}>
                  {targetNoteLabel ?? '--'}
                </Text>

                <View style={exerciseStyles.metricDivider} />

                <Text style={exerciseStyles.metricCaption}>Detected note</Text>
                <Text style={exerciseStyles.heroMetric}>
                  {liveAudioFrame && liveAudioFrame.pitch > 0
                    ? liveAudioFrame.note ?? '--'
                    : '--'}
                </Text>

                <Text style={exerciseStyles.metricHint_Assessment}>
                  {liveAudioFrame && liveAudioFrame.pitch > 0
                    ? `${liveAudioFrame.pitch.toFixed(1)} Hz`
                    : 'Sing the target note steadily.'}
                </Text>
              </>
            )}

            {phase === 'tone' && (
              <>
                <Text style={exerciseStyles.metricCaption}>Vowel exercise</Text>
                <Text style={exerciseStyles.heroMetric}>“AH”</Text>

                <View style={exerciseStyles.metricDivider} />

                <Text style={exerciseStyles.metricCaption}>Detected frequency</Text>
                <Text style={exerciseStyles.heroMetric}>
                  {liveAudioFrame && liveAudioFrame.pitch > 0
                    ? `${liveAudioFrame.pitch.toFixed(1)} Hz`
                    : '--'}
                </Text>

                <Text style={exerciseStyles.metricHint_Assessment}>
                  Hold the vowel smoothly. The displayed frequency is your
                  detected pitch, not the spectral centroid.
                </Text>
              </>
            )}

            {phase === 'volume' && (
              <>
                <Text style={exerciseStyles.metricCaption}>
                  Current relative sound level
                </Text>

                <Text style={exerciseStyles.heroMetric}>
                  {liveAudioFrame && Number.isFinite(liveAudioFrame.volume)
                    ? `${liveAudioFrame.volume.toFixed(1)} dBFS`
                    : '--'}
                </Text>

                <View style={exerciseStyles.volumeGuide}>
                  <View style={exerciseStyles.volumeGuideItem}>
                    <Ionicons name="volume-low" size={22} color={COLORS.brown} />
                    <Text style={exerciseStyles.volumeGuideText}>Soft</Text>
                  </View>

                  <Ionicons name="arrow-forward" size={18} color={COLORS.muted} />

                  <View style={exerciseStyles.volumeGuideItem}>
                    <Ionicons name="volume-high" size={22} color={COLORS.brown} />
                    <Text style={exerciseStyles.volumeGuideText}>Loud</Text>
                  </View>

                  <Ionicons name="arrow-forward" size={18} color={COLORS.muted} />

                  <View style={exerciseStyles.volumeGuideItem}>
                    <Ionicons name="volume-low" size={22} color={COLORS.brown} />
                    <Text style={exerciseStyles.volumeGuideText}>Soft</Text>
                  </View>
                </View>

                <Text style={exerciseStyles.metricHint_Assessment}>
                  Follow the soft–loud–soft pattern. Your recording level
                  depends on microphone distance and device settings.
                </Text>
              </>
            )}

            {phase === 'agility' && (
              <>
                <Text style={exerciseStyles.metricCaption}>Target note sequence</Text>
                <Text style={exerciseStyles.sequenceText}>
                  {targetNoteLabel ?? '--'}
                </Text>

                <View style={exerciseStyles.metricDivider} />

                <Text style={exerciseStyles.metricCaption}>
                  Currently detected note
                </Text>
                <Text style={exerciseStyles.heroMetric}>
                  {liveAudioFrame && liveAudioFrame.pitch > 0
                    ? liveAudioFrame.note ?? '--'
                    : '--'}
                </Text>

                <Text style={exerciseStyles.metricHint_Assessment}>
                  Notes matched: {agilityMatchedCount}/
                  {targetNotes?.agilityRun.length ?? 7}
                </Text>

                <Text style={exerciseStyles.metricHint_Assessment}>
                  Sing each note in order, clearly and without unnecessary
                  pauses. Recording stops when the complete sequence is
                  detected.
                </Text>
              </>
            )}

            {(phase === 'lowHum' || phase === 'highHum') && (
              <>
                <Text style={exerciseStyles.metricCaption}>Detected note</Text>
                <Text style={exerciseStyles.heroMetric}>
                  {liveAudioFrame && liveAudioFrame.pitch > 0
                    ? liveAudioFrame.note ?? '--'
                    : '--'}
                </Text>

                <Text style={exerciseStyles.metricHint_Assessment}>
                  {liveAudioFrame && liveAudioFrame.pitch > 0
                    ? `${liveAudioFrame.pitch.toFixed(1)} Hz`
                    : 'Hum one comfortable note steadily.'}
                </Text>
              </>
            )}
          </View>
        )}

        <Pressable
          style={[
            exerciseStyles.recordButton,
            (isRecordingSection || !canRecord) && exerciseStyles.recordingButton,
          ]}
          disabled={
            isRecordingSection ||
            isRecording ||
            startingSectionRef.current ||
            !canRecord ||
            isQuitting
          }
          onPress={() => {
            void beginSection();
          }}
        >
          <Ionicons
            name={isRecordingSection ? 'radio' : 'mic'}
            size={30}
            color={COLORS.white}
          />

          <Text style={exerciseStyles.recordButtonText}>
            {isRecordingSection
              ? 'Recording...'
              : startingSectionRef.current
                ? 'Starting...'
                : 'Record'}
          </Text>
        </Pressable>

        {isRecordingSection && (
          <Pressable
            style={exerciseStyles.manualStopButton}
            disabled={isQuitting}
            onPress={() => {
              void handleManualStop();
            }}
          >
            <Text style={exerciseStyles.manualStopText}>Stop Early</Text>
          </Pressable>
        )}

        {errorMessage && (
          <View style={exerciseStyles.errorCard_Assessment}>
            <Text style={exerciseStyles.errorText_Assessment}>{errorMessage}</Text>
          </View>
        )}

        <Text style={exerciseStyles.helperText}>
          {isRangeRecording
            ? 'For the most accurate range, keep the same note steady until the timer reaches zero.'
            : phase === 'agility'
              ? 'Recording stops after the full note sequence is detected, or when the timer reaches zero.'
              : 'Recording will automatically stop when the timer reaches zero.'}
        </Text>
      </ScrollView>
    </>
  );
}
