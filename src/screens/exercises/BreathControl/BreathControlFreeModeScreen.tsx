import { ExerciseQuitModal } from '@/components/ExerciseModals';
import { COLORS, VOLUME_DBFS_MIN } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import { useAudioRecorder, type LiveAudioFrame } from '@/hooks/useAudioRecorder';
import { usePhaseState } from '@/hooks/usePhaseState';
import { measureFreeModeFrame } from '@/services/measurement/freeMode/freeMode';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, BackHandler, Pressable, SafeAreaView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Phase = 'ready' | 'exercise';

const FLOW_HISTORY_BAR_COUNT = 20;

export default function BreathControlFreeModeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.min(22, width * 0.055);

  const { phase, setPhase } = usePhaseState<Phase>('ready');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [volumeDb, setVolumeDb] = useState(-100);
  const [flowHistory, setFlowHistory] = useState<number[]>(
    () => Array(FLOW_HISTORY_BAR_COUNT).fill(0),
  );

  const mountedRef = useRef(false);
  const startInProgressRef = useRef(false);
  const recordingStopRequestedRef = useRef(false);
  const leaveRequestedRef = useRef(false);
  const showQuitModalRef = useRef(false);

  const startTaskRef = useRef<Promise<void> | null>(null);
  const stopTaskRef = useRef<Promise<void> | null>(null);

  const stopRecordingRef = useRef<
    (() => void | Promise<void>) | null
  >(null);

  const handleAudioFrame = useCallback((frame: LiveAudioFrame) => {
    if (!mountedRef.current || recordingStopRequestedRef.current) {
      return;
    }

    const reading = measureFreeModeFrame(
      frame.samples,
      frame.sampleRate,
    );

    setVolumeDb(reading.volumeDb);

    const normalizedFlow = Math.max(
      0,
      Math.min(1, (reading.volumeDb - VOLUME_DBFS_MIN) / 60),
    );

    setFlowHistory(previous => [
      ...previous.slice(-(FLOW_HISTORY_BAR_COUNT - 1)),
      normalizedFlow,
    ]);
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
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  const resetExercise = useCallback(() => {
    setVolumeDb(-100);
    setFlowHistory(Array(FLOW_HISTORY_BAR_COUNT).fill(0));
  }, []);

  const stopRecorder = useCallback((): Promise<void> => {
    if (stopTaskRef.current) {
      return stopTaskRef.current;
    }

    const stop = stopRecordingRef.current;

    if (!stop) {
      return Promise.resolve();
    }

    const task = Promise.resolve().then(async () => {
      await stop();
    });

    stopTaskRef.current = task;

    void task.then(
      () => {
        if (stopTaskRef.current === task) {
          stopTaskRef.current = null;
        }
      },
      () => {
        if (stopTaskRef.current === task) {
          stopTaskRef.current = null;
        }
      },
    );

    return task;
  }, []);

  const waitForStartAndStop = useCallback(async () => {
    const startTask = startTaskRef.current;

    if (startTask) {
      try {
        await startTask;
      } catch {
        // Still attempt recorder cleanup if startup failed.
      }
    }

    await stopRecorder();
  }, [stopRecorder]);

  const startFreeMode = useCallback(async () => {
    if (
      startInProgressRef.current ||
      isStarting ||
      isStopping ||
      phase !== 'ready' ||
      isRecording ||
      startTaskRef.current ||
      stopTaskRef.current ||
      recordingStopRequestedRef.current ||
      leaveRequestedRef.current ||
      !mountedRef.current
    ) {
      return;
    }

    startInProgressRef.current = true;
    recordingStopRequestedRef.current = false;

    setIsStarting(true);
    resetExercise();

    const task = (async () => {
      try {
        await startRecording();

        if (
          !mountedRef.current ||
          recordingStopRequestedRef.current ||
          leaveRequestedRef.current
        ) {
          await stopRecorder();
          return;
        }

        setPhase('exercise');
      } catch (errorMessage) {
        console.error(
          'Failed to start Breath Control Free Mode:',
          errorMessage,
        );

        if (
          mountedRef.current &&
          !leaveRequestedRef.current
        ) {
          setPhase('ready');
        }
      } finally {
        startInProgressRef.current = false;

        if (mountedRef.current) {
          setIsStarting(false);
        }
      }
    })();

    startTaskRef.current = task;

    try {
      await task;
    } finally {
      if (startTaskRef.current === task) {
        startTaskRef.current = null;
      }
    }
  }, [
    isStarting,
    isStopping,
    phase,
    isRecording,
    resetExercise,
    startRecording,
    stopRecorder,
  ]);

  const stopFreeMode = useCallback(async () => {
    if (
      recordingStopRequestedRef.current ||
      leaveRequestedRef.current
    ) {
      return;
    }

    recordingStopRequestedRef.current = true;
    setIsStopping(true);

    try {
      await waitForStartAndStop();
    } catch (errorMessage) {
      console.error(
        'Failed to stop Breath Control Free Mode:',
        errorMessage,
      );
    } finally {
      if (
        mountedRef.current &&
        !leaveRequestedRef.current
      ) {
        resetExercise();
        setPhase('ready');
        setIsStarting(false);
        setIsStopping(false);
        recordingStopRequestedRef.current = false;
      }
    }
  }, [resetExercise, waitForStartAndStop]);

  const handleBack = useCallback(() => {
    if (
      leaveRequestedRef.current ||
      showQuitModalRef.current
    ) {
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
    recordingStopRequestedRef.current = true;
    showQuitModalRef.current = false;

    setIsQuitting(true);
    setIsStopping(true);
    setShowQuitModal(false);

    try {
      await waitForStartAndStop();
    } catch (errorMessage) {
      console.error(
        'Failed to stop recording before leaving Breath Control Free Mode:',
        errorMessage,
      );
    } finally {
      router.back();
    }
  }, [waitForStartAndStop]);

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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      recordingStopRequestedRef.current = true;

      void waitForStartAndStop().catch(errorMessage => {
        console.error(
          'Failed to stop Breath Control Free Mode on unmount:',
          errorMessage,
        );
      });
    };
  }, [waitForStartAndStop]);

  const renderHeader = (onBack: () => void) => (
    <View
      style={[
        exerciseStyles.header,
        { paddingHorizontal: horizontalPadding },
      ]}
    >
      <Pressable
        style={exerciseStyles.backButtonVariant1}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        disabled={isQuitting}
      >
        <Ionicons name="arrow-back" size={20} color={COLORS.brown} />
      </Pressable>

      <View style={exerciseStyles.headerSpacer} />
    </View>
  );

  const renderBottomAction = (button: ReactNode) => (
    <View
      style={[
        exerciseStyles.bottomAction,
        {
          paddingHorizontal: horizontalPadding,
          paddingBottom: Math.max(8, insets.bottom),
        },
      ]}
    >
      {button}
    </View>
  );

  const quitConfirmationModal = (
    <ExerciseQuitModal
    visible={showQuitModal}
    icon="mic-off-outline"
    message="Are you sure you want to leave Breath Control Free Mode?"
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

  if (phase === 'ready') {
    return (
      <>
        <SafeAreaView
          style={[
            exerciseStyles.screen,
            { paddingBottom: insets.bottom },
          ]}
        >
          {renderHeader(handleBack)}

          <View
            style={[
              exerciseStyles.readyContent,
              { paddingHorizontal: horizontalPadding },
            ]}
          >
            <View style={exerciseStyles.modeIcon}>
              <Ionicons
                name="water-outline"
                size={36}
                color={COLORS.accent}
              />
            </View>

            <Text style={exerciseStyles.pageTitle}>
              Breath Control Free Mode
            </Text>

            <Text style={exerciseStyles.pageDescription}>
              Practice your breathing naturally without a set
              drill or target range.
            </Text>

            <View style={exerciseStyles.infoCard}>
              <Text style={exerciseStyles.infoTitle}>
                LIVE FEEDBACK
              </Text>

              <View style={exerciseStyles.summaryRow}>
                <View style={exerciseStyles.infoIcon}>
                  <Ionicons
                    name="pulse-outline"
                    size={20}
                    color={COLORS.accent}
                  />
                </View>

                <View style={exerciseStyles.infoText}>
                  <Text style={exerciseStyles.infoName}>
                    Breath Flow
                  </Text>

                  <Text style={exerciseStyles.infoDescription}>
                    Track the rhythm and consistency of your
                    breath.
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
                There is no target pattern in Free Mode. Focus
                on comfortable, controlled breathing.
              </Text>
            </View>
          </View>

          {renderBottomAction(
            <Pressable
              style={[
                exerciseStyles.startButtonVariant3,
                (isStarting || isStopping || isQuitting) &&
                  exerciseStyles.disabledButton,
              ]}
              onPress={() => {
                void startFreeMode();
              }}
              disabled={
                isStarting ||
                isStopping ||
                isQuitting
              }
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
            </Pressable>,
          )}
        </SafeAreaView>

        {quitConfirmationModal}
      </>
    );
  }

  const flowPercentage =
    volumeDb <= VOLUME_DBFS_MIN
      ? null
      : Math.round(
          Math.max(
            0,
            Math.min(
              100,
              ((volumeDb - VOLUME_DBFS_MIN) / 60) * 100,
            ),
          ),
        );

  return (
    <>
      <SafeAreaView
        style={[
          exerciseStyles.screen,
          { paddingBottom: insets.bottom },
        ]}
      >
        {renderHeader(handleBack)}

        <View
          style={[
            exerciseStyles.exerciseContent,
            { paddingHorizontal: horizontalPadding },
          ]}
        >
          <View style={exerciseStyles.exerciseTopRowVariant1}>
            <View>
              <Text style={exerciseStyles.modeLabel}>
                FREE PRACTICE
              </Text>

              <Text style={exerciseStyles.exerciseSubtitle}>
                Explore your natural breath
              </Text>
            </View>

          </View>

          <View style={exerciseStyles.liveCardVariant6}>
            <Text style={exerciseStyles.cardLabel}>
              CURRENT BREATH FLOW
            </Text>

            <Text style={exerciseStyles.valueText}>
              {flowPercentage === null
                ? '--'
                : `${flowPercentage}%`}
            </Text>

            <View style={exerciseStyles.barRow}>
              {flowHistory.map((value, index) => (
                <View
                  key={index}
                  style={[
                    exerciseStyles.bar,
                    {
                      height: `${Math.max(12, value * 100)}%`,
                      opacity:
                        value === 0 ? 0.15 : 0.25 + value * 0.75,
                    },
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={exerciseStyles.noteCardVariant1}>
            <Ionicons
              name="flower-outline"
              size={18}
              color={COLORS.accent}
            />

            <Text style={exerciseStyles.noteText}>
              Stay relaxed, keep your breaths smooth and
              steady, and let the pattern guide you naturally.
            </Text>
          </View>
        </View>

        {renderBottomAction(
          <Pressable
            style={[
              exerciseStyles.stopButtonVariant1,
              isStopping && exerciseStyles.disabledButton,
            ]}
            onPress={() => {
              void stopFreeMode();
            }}
            disabled={isStopping || isQuitting}
            accessibilityRole="button"
          >
            {isStopping ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons
                  name="stop"
                  size={18}
                  color={COLORS.white}
                />

                <Text style={exerciseStyles.startButtonText}>
                  Stop Free Mode
                </Text>
              </>
            )}
          </Pressable>,
        )}
      </SafeAreaView>

      {quitConfirmationModal}
    </>
  );
}
