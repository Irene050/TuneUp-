import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioRecorder, type LiveAudioFrame } from '@/hooks/useAudioRecorder';
import { measureFreeModeFrame } from '@/services/measurement/freeMode/freeMode';
import { VolumeVisualizer } from '@/screens/exercises/Volume/SharedVolumeComponents';
import { COLORS, VOLUME_DBFS_MAX, VOLUME_DBFS_MIN, VOLUME_HISTORY_BAR_COUNT } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { ExerciseQuitModal } from '@/components/exercises/ExerciseModals';
import { usePhaseState } from '@/hooks/usePhaseState';

type Phase = 'ready' | 'exercise';


function normalizeVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      1,
      (value - VOLUME_DBFS_MIN) / (VOLUME_DBFS_MAX - VOLUME_DBFS_MIN),
    ),
  );
}

export default function VolumeFreeModeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.min(22, width * 0.055);

  const { phase, setPhase, phaseRef } = usePhaseState<Phase>('ready');
  const [liveVolume, setLiveVolume] = useState<number | null>(null);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const leaveRequestedRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const startTaskRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      phaseRef.current = 'ready';

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleAudioFrame = useCallback((frame: LiveAudioFrame) => {
    if (!mountedRef.current || phaseRef.current !== 'exercise') {
      return;
    }

    const reading = measureFreeModeFrame(
      frame.samples,
      frame.sampleRate,
    );

    if (!Number.isFinite(reading.volumeDb)) {
      return;
    }

    setLiveVolume(reading.volumeDb);

    const normalized = normalizeVolume(reading.volumeDb);

    setLiveHistory(previous =>
      [...previous, normalized].slice(-VOLUME_HISTORY_BAR_COUNT),
    );
  }, []);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    analyzePitch: false,
    onFrame: handleAudioFrame,
  });

  useEffect(() => {
    if (phase !== 'exercise') {
      return;
    }

    startedAtRef.current = Date.now();

    timerRef.current = setInterval(() => {
      const startedAt = startedAtRef.current;

      if (startedAt === null || !mountedRef.current) {
        return;
      }

      setElapsedSeconds(
        Math.floor((Date.now() - startedAt) / 1000),
      );
    }, 250);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase]);

  const handleBack = useCallback(() => {
    if (
      leaveRequestedRef.current ||
      showQuitModalRef.current ||
      isQuitting
    ) {
      return;
    }

    showQuitModalRef.current = true;
    setShowQuitModal(true);
  }, [isQuitting]);

  const continueExercise = useCallback(() => {
    if (leaveRequestedRef.current || isQuitting) {
      return;
    }

    showQuitModalRef.current = false;
    setShowQuitModal(false);
  }, [isQuitting]);

  const confirmQuitExercise = useCallback(async () => {
    if (leaveRequestedRef.current) {
      return;
    }

    leaveRequestedRef.current = true;
    showQuitModalRef.current = false;
    phaseRef.current = 'ready';

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
        'Failed to stop recording before leaving Volume Free Mode:',
        stopError,
      );
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      startedAtRef.current = null;
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
    (<ExerciseQuitModal
    visible={showQuitModal}
    icon="volume-high-outline"
    message="Are you sure you want to leave Volume Free Mode?"
    hint="Your current session will stop. Free Mode feedback is not saved as a scored exercise."
    isQuitting={isQuitting}
    onContinue={continueExercise}
    onQuit={() => {
                void confirmQuitExercise();
              }}
    continueLabel="No, Continue"
    quitLabel="Yes, Quit"
  />)
  );

  const startFreeMode = useCallback(async () => {
    if (
      startingRef.current ||
      stoppingRef.current ||
      leaveRequestedRef.current ||
      phaseRef.current === 'exercise' ||
      isRecording
    ) {
      return;
    }

    startingRef.current = true;
    setIsStarting(true);
    setErrorMessage(null);

    try {
      setLiveVolume(null);
      setLiveHistory([]);
      setElapsedSeconds(0);
      startedAtRef.current = null;

      phaseRef.current = 'ready';

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
        phaseRef.current = 'ready';
        return;
      }

      phaseRef.current = 'exercise';
      setPhase('exercise');
    } catch (startError) {
      phaseRef.current = 'ready';

      console.error('Unable to start Volume Free Mode:', startError);

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
  }, [isRecording, startRecording]);

  const stopFreeMode = useCallback(async () => {
    if (stoppingRef.current || leaveRequestedRef.current) {
      return;
    }

    stoppingRef.current = true;
    phaseRef.current = 'ready';

    if (mountedRef.current) {
      setPhase('ready');
    }

    try {
      const startTask = startTaskRef.current;

      if (isRecording || startTask) {
        if (startTask) {
          try {
            await startTask;
          } catch {
            // Still try to stop the recorder.
          }
        }

        await stopRecording();
      }
    } catch (stopError) {
      console.error('Unable to stop Volume Free Mode:', stopError);
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      startedAtRef.current = null;

      if (mountedRef.current) {
        setLiveVolume(null);
        setLiveHistory([]);
        setElapsedSeconds(0);
        setIsStarting(false);
      }

      stoppingRef.current = false;
    }
  }, [isRecording, stopRecording]);

  const formattedTime = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(
      seconds,
    ).padStart(2, '0')}`;
  }, [elapsedSeconds]);

  const safeAreaStyle = {
    paddingBottom: insets.bottom,
  };

  if (phase === 'ready') {
    return (
      <>
        <SafeAreaView style={[exerciseStyles.screen, safeAreaStyle]}>
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
              accessibilityRole="button"
              accessibilityLabel="Go back"
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
                name="volume-high"
                size={36}
                color={COLORS.accent}
              />
            </View>

            <Text style={exerciseStyles.pageTitle}>
              Volume Free Mode
            </Text>

            <Text style={exerciseStyles.pageDescription}>
              Practice your volume freely and listen to changes in
              your voice without a target volume or structured exercise.
            </Text>

            <View style={exerciseStyles.infoCard}>
              <Text style={exerciseStyles.infoTitle}>
                LIVE FEEDBACK
              </Text>

              <View style={exerciseStyles.infoRow}>
                <View style={exerciseStyles.infoIcon}>
                  <Ionicons
                    name="volume-medium-outline"
                    size={20}
                    color={COLORS.accent}
                  />
                </View>

                <View style={exerciseStyles.infoText}>
                  <Text style={exerciseStyles.infoName}>
                    Volume Level
                  </Text>

                  <Text style={exerciseStyles.infoDescription}>
                    See your current vocal volume in real time.
                  </Text>
                </View>
              </View>

              <View style={exerciseStyles.infoRow}>
                <View style={exerciseStyles.infoIcon}>
                  <Ionicons
                    name="pulse-outline"
                    size={20}
                    color={COLORS.accent}
                  />
                </View>

                <View style={exerciseStyles.infoText}>
                  <Text style={exerciseStyles.infoName}>
                    Volume Flow
                  </Text>

                  <Text style={exerciseStyles.infoDescription}>
                    Observe how your voice gets quieter or louder as you sing.
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
                There is no target volume band in this mode.
                Explore your voice at any comfortable volume.
              </Text>
            </View>

            {errorMessage ? (
              <Text style={exerciseStyles.errorText}>{errorMessage}</Text>
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
              style={[
                exerciseStyles.startButton,
                (isStarting || isQuitting) && exerciseStyles.quitModalButtonDisabled,
              ]}
              onPress={() => {
                void startFreeMode();
              }}
              disabled={isStarting || isRecording || isQuitting}
              accessibilityRole="button"
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
      <SafeAreaView style={[exerciseStyles.screen, safeAreaStyle]}>
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
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
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
                Explore your natural volume
              </Text>
            </View>

            <View style={exerciseStyles.timeBadge}>
              <Ionicons
                name="time-outline"
                size={16}
                color={COLORS.accent}
              />

              <Text style={exerciseStyles.timeText}>
                {formattedTime}
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.liveCardVariant1}>
            <Text style={exerciseStyles.cardLabel}>
              CURRENT VOLUME
            </Text>

            <View style={exerciseStyles.volumeDisplay}>
              <View>
                <Text style={exerciseStyles.noteValue}>
                  {liveVolume !== null
                    ? liveVolume.toFixed(1)
                    : '--'}
                </Text>

                <Text style={exerciseStyles.frequencyText}>dBFS</Text>
              </View>

              <View style={exerciseStyles.pitchIcon}>
                <Ionicons
                  name="volume-high"
                  size={27}
                  color={COLORS.accent}
                />
              </View>
            </View>

            <View style={exerciseStyles.resultDetailRow}>
              <View>
                <Text style={exerciseStyles.componentScore}>
                  Your Volume
                </Text>

                <Text style={exerciseStyles.visualizerSub}>
                  {liveVolume !== null
                    ? 'Audio level detected'
                    : 'Start singing to see your volume'}
                </Text>
              </View>

              <View style={exerciseStyles.visualizerMic}>
                <Ionicons
                  name="pulse-outline"
                  size={20}
                  color={COLORS.accent}
                />
              </View>
            </View>

            <VolumeVisualizer
              liveHistory={liveHistory}
              barCount={VOLUME_HISTORY_BAR_COUNT}
              variant="freeMode"
            />

            <View style={exerciseStyles.rangeRow}>
              <Text style={exerciseStyles.visualizerLabelVariant2}>QUIET</Text>
              <Text style={exerciseStyles.visualizerLabelVariant2}>LOUD</Text>
            </View>
          </View>

          <View style={exerciseStyles.stabilityCard}>
            <View>
              <Text style={exerciseStyles.cardLabel}>
                LIVE INPUT LEVEL
              </Text>

              <Text style={exerciseStyles.stabilityValueVariant2}>
                {liveVolume !== null
                  ? `${liveVolume.toFixed(1)} dBFS`
                  : '--'}
              </Text>
            </View>

            <View style={exerciseStyles.stabilityIcon}>
              <Ionicons
                name="mic-outline"
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
              There is no target volume. Sing naturally and observe
              how your volume changes without pressure.
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
            style={[
              exerciseStyles.stopButton,
              isQuitting && exerciseStyles.quitModalButtonDisabled,
            ]}
            onPress={() => {
              void stopFreeMode();
            }}
            disabled={isQuitting}
            accessibilityRole="button"
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
