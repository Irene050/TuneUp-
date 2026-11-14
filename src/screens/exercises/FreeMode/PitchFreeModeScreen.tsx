import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { ActivityIndicator, BackHandler, Pressable, SafeAreaView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
    ExerciseQuitModal,
} from '@/components/ExerciseModals';
import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import {
    type LiveAudioFrame,
    useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { useMountedRefLifecycle } from '@/hooks/useMountedRefLifecycle';
import type { FreeModePhase } from '@/types/exercises';
import { measurePitchFreeModeFrame } from '@/services/measurement/freeMode/pitch';
import { frequencyToNoteName } from '@/utils/music/notes';

type Phase = FreeModePhase;

const WAVE_COUNT = 18;
const PITCH_HISTORY_LIMIT = 19;

export default function PitchFreeModeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.min(22, width * 0.055);

  const { phase, setPhase } = usePhaseState<Phase>('ready');
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const [detectedFrequency, setDetectedFrequency] = useState(0);
  const [stabilityPct, setStabilityPct] = useState(0);
  const [stabilityReady, setStabilityReady] = useState(false);

  const [pitchHistory, setPitchHistory] = useState<number[]>(
    () => Array(WAVE_COUNT).fill(0),
  );

  const isRecordingRef = useRef(false);
  const mountedRef = useRef(true);
  useMountedRefLifecycle(mountedRef);
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const leaveRequestedRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const startTaskRef = useRef<Promise<void> | null>(null);
  const recentFrequenciesRef = useRef<number[]>([]);

  const resetPitchData = useCallback(() => {
    recentFrequenciesRef.current = [];
    setDetectedFrequency(0);
    setStabilityPct(0);
    setStabilityReady(false);
    setPitchHistory(Array(WAVE_COUNT).fill(0));
  }, []);

  const handleAudioFrame = useCallback(
    (frame: LiveAudioFrame) => {
      if (
        !isRecordingRef.current ||
        !mountedRef.current
      ) {
        return;
      }

      const reading = measurePitchFreeModeFrame(
        frame.samples,
        frame.sampleRate,
        recentFrequenciesRef.current,
      );

      if (reading.detectedFrequency > 0) {
        recentFrequenciesRef.current = [
          ...recentFrequenciesRef.current,
          reading.detectedFrequency,
        ].slice(-PITCH_HISTORY_LIMIT);
      }

      setDetectedFrequency(reading.detectedFrequency);
      setStabilityPct(reading.stabilityPct);
      setStabilityReady(reading.stabilityReady);

      if (reading.detectedFrequency > 0) {
        const minHz = 80;
        const maxHz = 1000;

        const normalized =
          (Math.log(reading.detectedFrequency) -
            Math.log(minHz)) /
          (Math.log(maxHz) - Math.log(minHz));

        const clamped = Math.max(
          0,
          Math.min(1, normalized),
        );

        setPitchHistory(previous => [
          ...previous.slice(-(WAVE_COUNT - 1)),
          clamped,
        ]);
      } else {
        setPitchHistory(previous => [
          ...previous.slice(-(WAVE_COUNT - 1)),
          0,
        ]);
      }
    },
    [],
  );

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    analyzePitch: false,
    onFrame: handleAudioFrame,
  });

  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
    };
  }, []);

  const currentNote = useMemo(
    () => frequencyToNoteName(detectedFrequency),
    [detectedFrequency],
  );

  const handleBack = useCallback(() => {
    if (leaveRequestedRef.current || showQuitModalRef.current) {
      return;
    }

    showQuitModalRef.current = true;
    setShowQuitModal(true);
  }, []);

  const continueExercise = useCallback(() => {
    if (leaveRequestedRef.current) {
      return;
    }

    showQuitModalRef.current = false;
    setShowQuitModal(false);
  }, []);

  const confirmQuitExercise = useCallback(async () => {
    if (leaveRequestedRef.current) {
      return;
    }

    leaveRequestedRef.current = true;
    isRecordingRef.current = false;
    showQuitModalRef.current = false;

    setIsQuitting(true);
    setShowQuitModal(false);

    try {
      const startTask = startTaskRef.current;
      if (startTask) {
        try {
          await startTask;
        } catch {
          // Still attempt recorder cleanup if startup failed.
        }
      }

      await stopRecording();
    } catch (stopError) {
      console.error(
        'Failed to stop recording before leaving Pitch Free Mode:',
        stopError,
      );
    } finally {
      router.back();
    }
  }, [stopRecording]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          if (showQuitModalRef.current) {
            continueExercise();
            return true;
          }

          handleBack();
          return true;
        },
      );

      return () => subscription.remove();
    }, [continueExercise, handleBack]),
  );

  const quitConfirmationModal = (
    <ExerciseQuitModal
    visible={showQuitModal}
    icon="musical-notes-outline"
    message="Are you sure you want to leave Pitch Free Mode?"
    hint="Your current session will stop. Free Mode feedback is not saved as a scored exercise."
    isQuitting={isQuitting}
    onContinue={continueExercise}
    onQuit={() => {
                void confirmQuitExercise();
              }}
    continueLabel="No, Continue"
    quitLabel="Yes, Quit"
    />
  );

  const startFreeMode = useCallback(async () => {
    if (
      startingRef.current ||
      stoppingRef.current ||
      leaveRequestedRef.current ||
      phase === 'exercise' ||
      isRecording
    ) {
      return;
    }

    startingRef.current = true;
    setIsStarting(true);
    setErrorMessage(null);
    isRecordingRef.current = false;

    try {
      resetPitchData();

      isRecordingRef.current = true;
      const startTask = Promise.resolve().then(() => startRecording());
      startTaskRef.current = startTask;

      try {
        await startTask;
      } finally {
        if (startTaskRef.current === startTask) {
          startTaskRef.current = null;
        }
      }

      if (!mountedRef.current || leaveRequestedRef.current) {
        isRecordingRef.current = false;
        return;
      }

      setPhase('exercise');
    } catch (startError) {
      isRecordingRef.current = false;

      console.error(
        'Failed to start Pitch Free Mode:',
        startError,
      );

      if (mountedRef.current) {
        setErrorMessage(
          'Could not start the microphone. Check microphone permission and try again.',
        );
      }
    } finally {
      startingRef.current = false;

      if (mountedRef.current) {
        setIsStarting(false);
      }
    }
  }, [
    isRecording,
    phase,
    resetPitchData,
    startRecording,
  ]);

  const stopFreeMode = useCallback(async () => {
    if (stoppingRef.current) {
      return;
    }

    stoppingRef.current = true;
    isRecordingRef.current = false;

    if (mountedRef.current) {
      setPhase('ready');
    }

    try {
      await stopRecording();
    } catch (stopError) {
      console.error(
        'Failed to stop Pitch Free Mode:',
        stopError,
      );
    } finally {
      recentFrequenciesRef.current = [];

      if (mountedRef.current) {
        resetPitchData();
        setIsStarting(false);
      }

      stoppingRef.current = false;
    }
  }, [resetPitchData, stopRecording]);

  if (phase === 'ready') {
    return (
      <>
      <SafeAreaView
        style={[
          exerciseStyles.screen,
          { paddingBottom: insets.bottom },
        ]}
      >
        <View
          style={[
            exerciseStyles.header,
            { paddingHorizontal: horizontalPadding },
          ]}
        >
          <Pressable
            style={exerciseStyles.backButton}
            onPress={handleBack}
            disabled={isQuitting}
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={COLORS.brown}
            />
          </Pressable>

          <View style={exerciseStyles.headerSpacer} />
        </View>

        <View
          style={[
            exerciseStyles.readyContent,
            { paddingHorizontal: horizontalPadding },
          ]}
        >
          <View style={exerciseStyles.modeIcon}>
            <Ionicons
              name="musical-notes"
              size={36}
              color={COLORS.accent}
            />
          </View>

          <Text style={exerciseStyles.pageTitle}>
            Pitch Free Mode
          </Text>

          <Text style={exerciseStyles.pageDescription}>
            Sing naturally and listen to your pitch
            without any structure or target note.
          </Text>

          <View style={exerciseStyles.infoCard}>
            <Text style={exerciseStyles.infoTitle}>
              LIVE FEEDBACK
            </Text>

            <View style={exerciseStyles.infoRow}>
              <View style={exerciseStyles.infoIcon}>
                <Ionicons
                  name="mic-outline"
                  size={20}
                  color={COLORS.accent}
                />
              </View>

              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.infoName}>
                  Pitch Flow
                </Text>

                <Text style={exerciseStyles.infoDescription}>
                  Follow the natural rise and fall of your voice.
                </Text>
              </View>
            </View>

            <View style={exerciseStyles.infoRow}>
              <View style={exerciseStyles.infoIcon}>
                <Ionicons
                  name="trending-up-outline"
                  size={20}
                  color={COLORS.accent}
                />
              </View>

              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.infoName}>
                  Listening
                </Text>

                <Text style={exerciseStyles.infoDescription}>
                  Focus on tone and stability without a score.
                </Text>
              </View>
            </View>
          </View>

          <View style={exerciseStyles.noTargetCard}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={COLORS.accent}
            />

            <Text style={exerciseStyles.noTargetText}>
              There is no target pitch in this mode.
              Explore your voice at a comfortable range.
            </Text>
          </View>

          {errorMessage ? (
            <Text style={exerciseStyles.errorText}>
              {errorMessage}
            </Text>
          ) : null}
        </View>

        <View
          style={[
            exerciseStyles.bottomAction,
            {
              paddingHorizontal: horizontalPadding,
              paddingBottom: Math.max(8, insets.bottom),
            },
          ]}
        >
          <Pressable
            style={exerciseStyles.startButton}
            onPress={startFreeMode}
            disabled={isStarting}
          >
            {isStarting ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons
                  name="mic"
                  size={19}
                  color={COLORS.white}
                />

                <Text style={exerciseStyles.startButtonText}>
                  Start Free Mode
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
      {quitConfirmationModal}
      </>
    );
  }

  return (
    <>
    <SafeAreaView
      style={[
        exerciseStyles.screen,
        { paddingBottom: insets.bottom },
      ]}
    >
      <View
        style={[
          exerciseStyles.header,
          { paddingHorizontal: horizontalPadding },
        ]}
      >
        <View style={exerciseStyles.headerSpacer} />
      </View>

      <View
        style={[
          exerciseStyles.exerciseContent,
          { paddingHorizontal: horizontalPadding },
        ]}
      >
        <View style={exerciseStyles.exerciseTopRow}>
          <View>
            <Text style={exerciseStyles.modeLabel}>
              FREE PRACTICE
            </Text>

            <Text style={exerciseStyles.exerciseSubtitle}>
              Listen to your pitch naturally
            </Text>
          </View>

        </View>

        <View style={exerciseStyles.liveCardVariant1}>
          <Text style={exerciseStyles.cardLabel}>
            CURRENT PITCH
          </Text>

          <View style={exerciseStyles.pitchDisplay}>
            <View>
              <Text style={exerciseStyles.noteValue}>
                {currentNote}
              </Text>

              <Text style={exerciseStyles.frequencyText}>
                {detectedFrequency > 0
                  ? `${Math.round(detectedFrequency)} Hz`
                  : '-- Hz'}
              </Text>
            </View>

            <View style={exerciseStyles.pitchIcon}>
              <Ionicons
                name="musical-note"
                size={27}
                color={COLORS.accent}
              />
            </View>
          </View>

          <View style={exerciseStyles.waveRow}>
            {pitchHistory.map((value, index) => (
              <View
                key={`wave-${index}`}
                style={[
                  exerciseStyles.wave,
                  {
                    height: `${Math.max(10, value * 100)}%`,
                    opacity:
                      value === 0
                        ? 0.15
                        : 0.3 + value * 0.7,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <View style={exerciseStyles.stabilityCard}>
          <View>
            <Text style={exerciseStyles.cardLabel}>
              PITCH STABILITY
            </Text>

            <Text style={exerciseStyles.stabilityValue}>
              {detectedFrequency > 0 && stabilityReady
                ? `${Math.round(stabilityPct)}%`
                : '--'}
            </Text>
          </View>

          <View style={exerciseStyles.stabilityIcon}>
            <Ionicons
              name="analytics-outline"
              size={25}
              color={COLORS.accent}
            />
          </View>
        </View>

        <View style={exerciseStyles.noteCard}>
          <Ionicons
            name="sparkles-outline"
            size={18}
            color={COLORS.accent}
          />

          <Text style={exerciseStyles.noteText}>
            Experiment with a comfortable pitch range and let
            your voice move naturally without pressure.
          </Text>
        </View>
      </View>

      <View
        style={[
          exerciseStyles.bottomAction,
          {
            paddingHorizontal: horizontalPadding,
            paddingBottom: Math.max(8, insets.bottom),
          },
        ]}
      >
        <Pressable
          style={[exerciseStyles.stopButton, isQuitting && exerciseStyles.quitModalButtonDisabled]}
          onPress={stopFreeMode}
          disabled={isQuitting}
        >
          <Ionicons
            name="stop"
            size={18}
            color={COLORS.white}
          />

          <Text style={exerciseStyles.startButtonText}>
            Stop Free Mode
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
    {quitConfirmationModal}
    </>
  );
}
