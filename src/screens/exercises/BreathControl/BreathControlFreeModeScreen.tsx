import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import { measureBreathControlFreeModeFrame } from '@/services/measurement/freemode/breathControl';

const BROWN = '#4E2F1F';
const DARK = '#5A343D';
const PINK = '#FCD6DD';
const LIGHT = '#FFF8FA';
const BORDER = '#F1DCE2';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';

type Phase = 'ready' | 'exercise';

const BAR_COUNT = 20;
const MIN_VOLUME_DB = -60;

export default function BreathControlFreeModeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.min(22, width * 0.055);

  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [volumeDb, setVolumeDb] = useState(-100);
  const [flowHistory, setFlowHistory] = useState<number[]>(
    () => Array(BAR_COUNT).fill(0),
  );

  const mountedRef = useRef(false);
  const startInProgressRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const leaveRequestedRef = useRef(false);
  const quitModalOpenRef = useRef(false);

  const startTaskRef = useRef<Promise<void> | null>(null);
  const stopTaskRef = useRef<Promise<void> | null>(null);

  const stopRecordingRef = useRef<
    (() => void | Promise<void>) | null
  >(null);

  const handleAudioFrame = useCallback((frame: LiveAudioFrame) => {
    if (!mountedRef.current || stopRequestedRef.current) {
      return;
    }

    const reading = measureBreathControlFreeModeFrame(
      frame.samples,
      frame.sampleRate,
    );

    setVolumeDb(reading.volumeDb);

    const normalizedFlow = Math.max(
      0,
      Math.min(1, (reading.volumeDb - MIN_VOLUME_DB) / 60),
    );

    setFlowHistory(previous => [
      ...previous.slice(-(BAR_COUNT - 1)),
      normalizedFlow,
    ]);
  }, []);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleAudioFrame,
  });

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  const resetExercise = useCallback(() => {
    setElapsedSeconds(0);
    setVolumeDb(-100);
    setFlowHistory(Array(BAR_COUNT).fill(0));
  }, []);

  /**
   * Share one native stop task across simultaneous stop requests.
   * This avoids issuing duplicate stop calls to the recorder.
   */
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

  /**
   * Wait for recorder startup to settle before stopping.
   * This handles quitting during microphone permission requests
   * or native recorder initialization.
   */
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
      stopRequestedRef.current ||
      leaveRequestedRef.current ||
      !mountedRef.current
    ) {
      return;
    }

    startInProgressRef.current = true;
    stopRequestedRef.current = false;

    setIsStarting(true);
    resetExercise();

    const task = (async () => {
      try {
        await startRecording();

        // If quitting was confirmed while startup was pending,
        // do not enter the exercise. Stop the recorder instead.
        if (
          !mountedRef.current ||
          stopRequestedRef.current ||
          leaveRequestedRef.current
        ) {
          await stopRecorder();
          return;
        }

        setPhase('exercise');
      } catch (error) {
        console.error(
          'Failed to start Breath Control Free Mode:',
          error,
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

  /**
   * Stop Free Mode but remain on the screen.
   */
  const stopFreeMode = useCallback(async () => {
    if (
      stopRequestedRef.current ||
      leaveRequestedRef.current
    ) {
      return;
    }

    // Ignore incoming audio frames immediately.
    stopRequestedRef.current = true;
    setIsStopping(true);

    try {
      await waitForStartAndStop();
    } catch (error) {
      console.error(
        'Failed to stop Breath Control Free Mode:',
        error,
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
        stopRequestedRef.current = false;
      }
    }
  }, [resetExercise, waitForStartAndStop]);

  /**
   * Open the quit confirmation instead of navigating immediately.
   * This handler is shared by the screen back arrow and Android Back.
   */
  const handleBack = useCallback(() => {
    if (
      leaveRequestedRef.current ||
      quitModalOpenRef.current
    ) {
      return;
    }

    quitModalOpenRef.current = true;
    setShowQuitModal(true);
  }, []);

  const dismissQuitModal = useCallback(() => {
    if (leaveRequestedRef.current) {
      return;
    }

    quitModalOpenRef.current = false;
    setShowQuitModal(false);
  }, []);

  /**
   * Stop recording before navigating away.
   * Navigation happens in finally so a native stop error does not
   * trap the user on this screen.
   */
  const confirmQuitExercise = useCallback(async () => {
    if (leaveRequestedRef.current) {
      return;
    }

    // Lock quitting synchronously to prevent duplicate confirmations.
    leaveRequestedRef.current = true;
    stopRequestedRef.current = true;
    quitModalOpenRef.current = false;

    setIsQuitting(true);
    setIsStopping(true);
    setShowQuitModal(false);

    try {
      await waitForStartAndStop();
    } catch (error) {
      console.error(
        'Failed to stop recording before leaving Breath Control Free Mode:',
        error,
      );
    } finally {
      router.back();
    }
  }, [waitForStartAndStop]);

  /**
   * Intercept Android's physical/system Back button while focused.
   * Returning true prevents immediate default navigation.
   */
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          // React Native Modal handles Android Back through
          // onRequestClose while the confirmation is visible.
          if (quitModalOpenRef.current) {
            dismissQuitModal();
            return true;
          }

          handleBack();
          return true;
        },
      );

      return () => subscription.remove();
    }, [dismissQuitModal, handleBack]),
  );

  /**
   * Final cleanup if the screen is removed by another navigation path.
   */
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      stopRequestedRef.current = true;

      void waitForStartAndStop().catch(error => {
        console.error(
          'Failed to stop Breath Control Free Mode on unmount:',
          error,
        );
      });
    };
  }, [waitForStartAndStop]);

  useEffect(() => {
    if (phase !== 'exercise' || stopRequestedRef.current) {
      return;
    }

    const timer = setInterval(() => {
      setElapsedSeconds(previous => previous + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [phase]);

  const formattedTime = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [elapsedSeconds]);

  const renderHeader = (onBack: () => void) => (
    <View
      style={[
        styles.header,
        { paddingHorizontal: horizontalPadding },
      ]}
    >
      <Pressable
        style={styles.backButton}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        disabled={isQuitting}
      >
        <Ionicons name="arrow-back" size={20} color={BROWN} />
      </Pressable>

      <View style={styles.headerSpacer} />
    </View>
  );

  const renderBottomAction = (button: ReactNode) => (
    <View
      style={[
        styles.bottomAction,
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
    <Modal
      visible={showQuitModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissQuitModal}
    >
      <View style={styles.modalOverlay}>
        <View
          accessibilityRole="alert"
          accessibilityLabel="Quit exercise confirmation"
          style={styles.confirmationCard}
        >
          <View style={styles.modalIconCircle}>
            <Ionicons
              name="mic-off-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text style={styles.modalTitle}>
            Quit Exercise?
          </Text>

          <Text style={styles.modalMessage}>
            Are you sure you want to leave Breath Control Free Mode?
          </Text>

          <Text style={styles.modalHint}>
            Your current session will stop. Free Mode feedback is
            not saved as a scored exercise.
          </Text>

          <View style={styles.modalButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="No, continue exercise"
              disabled={isQuitting}
              onPress={dismissQuitModal}
              style={({ pressed }) => [
                styles.continueButton,
                pressed && styles.buttonPressed,
                isQuitting && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.continueButtonText}>
                No, Continue
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yes, quit exercise"
              disabled={isQuitting}
              onPress={() => {
                void confirmQuitExercise();
              }}
              style={({ pressed }) => [
                styles.quitButton,
                pressed && styles.buttonPressed,
                isQuitting && styles.buttonDisabled,
              ]}
            >
              {isQuitting ? (
                <ActivityIndicator
                  size="small"
                  color={WHITE}
                />
              ) : (
                <Text style={styles.quitButtonText}>
                  Yes, Quit
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (phase === 'ready') {
    return (
      <>
        <SafeAreaView
          style={[
            styles.screen,
            { paddingBottom: insets.bottom },
          ]}
        >
          {renderHeader(handleBack)}

          <View
            style={[
              styles.readyContent,
              { paddingHorizontal: horizontalPadding },
            ]}
          >
            <View style={styles.modeIcon}>
              <Ionicons
                name="water-outline"
                size={36}
                color={ACCENT}
              />
            </View>

            <Text style={styles.pageTitle}>
              Breath Control Free Mode
            </Text>

            <Text style={styles.pageDescription}>
              Practice your breathing naturally without a set
              drill or target range.
            </Text>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>
                LIVE FEEDBACK
              </Text>

              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons
                    name="pulse-outline"
                    size={20}
                    color={ACCENT}
                  />
                </View>

                <View style={styles.infoText}>
                  <Text style={styles.infoName}>
                    Breath Flow
                  </Text>

                  <Text style={styles.infoDescription}>
                    Track the rhythm and consistency of your
                    breath.
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.noTargetCard}>
              <Ionicons
                name="information-circle-outline"
                size={20}
                color={ACCENT}
              />

              <Text style={styles.noTargetText}>
                There is no target pattern in Free Mode. Focus
                on comfortable, controlled breathing.
              </Text>
            </View>
          </View>

          {renderBottomAction(
            <Pressable
              style={[
                styles.startButton,
                (isStarting || isStopping || isQuitting) &&
                  styles.disabledButton,
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
                <ActivityIndicator color={WHITE} />
              ) : (
                <>
                  <Ionicons
                    name="mic"
                    size={19}
                    color={WHITE}
                  />

                  <Text style={styles.startButtonText}>
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
    volumeDb <= MIN_VOLUME_DB
      ? null
      : Math.round(
          Math.max(
            0,
            Math.min(
              100,
              ((volumeDb - MIN_VOLUME_DB) / 60) * 100,
            ),
          ),
        );

  return (
    <>
      <SafeAreaView
        style={[
          styles.screen,
          { paddingBottom: insets.bottom },
        ]}
      >
        {renderHeader(handleBack)}

        <View
          style={[
            styles.exerciseContent,
            { paddingHorizontal: horizontalPadding },
          ]}
        >
          <View style={styles.exerciseTopRow}>
            <View>
              <Text style={styles.modeLabel}>
                FREE PRACTICE
              </Text>

              <Text style={styles.exerciseSubtitle}>
                Explore your natural breath
              </Text>
            </View>

            <View style={styles.timeBadge}>
              <Ionicons
                name="time-outline"
                size={16}
                color={ACCENT}
              />

              <Text style={styles.timeText}>
                {formattedTime}
              </Text>
            </View>
          </View>

          <View style={styles.liveCard}>
            <Text style={styles.cardLabel}>
              CURRENT BREATH FLOW
            </Text>

            <Text style={styles.valueText}>
              {flowPercentage === null
                ? '--'
                : `${flowPercentage}%`}
            </Text>

            <View style={styles.barRow}>
              {flowHistory.map((value, index) => (
                <View
                  key={index}
                  style={[
                    styles.bar,
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

          <View style={styles.noteCard}>
            <Ionicons
              name="flower-outline"
              size={18}
              color={ACCENT}
            />

            <Text style={styles.noteText}>
              Stay relaxed, keep your breaths smooth and
              steady, and let the pattern guide you naturally.
            </Text>
          </View>
        </View>

        {renderBottomAction(
          <Pressable
            style={[
              styles.stopButton,
              isStopping && styles.disabledButton,
            ]}
            onPress={() => {
              void stopFreeMode();
            }}
            disabled={isStopping || isQuitting}
            accessibilityRole="button"
          >
            {isStopping ? (
              <ActivityIndicator color={WHITE} />
            ) : (
              <>
                <Ionicons
                  name="stop"
                  size={18}
                  color={WHITE}
                />

                <Text style={styles.startButtonText}>
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginTop: 120,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 34,
  },
  readyContent: {
    flex: 1,
    justifyContent: 'center',
  },
  modeIcon: {
    width: 92,
    height: 92,
    borderRadius: 28,
    backgroundColor: LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
  },
  pageTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    color: BROWN,
    textAlign: 'center',
  },
  pageDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  infoCard: {
    backgroundColor: LIGHT,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    marginTop: 24,
  },
  infoTitle: {
    fontFamily: 'FredokaBold',
    color: BROWN,
    fontSize: 11,
    letterSpacing: 1.4,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoText: {
    flex: 1,
  },
  infoName: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
  },
  infoDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 2,
    lineHeight: 18,
  },
  noTargetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 18,
  },
  noTargetText: {
    flex: 1,
    marginLeft: 10,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
  },
  bottomAction: {
    paddingTop: 12,
  },
  startButton: {
    marginBottom: 50,
    height: 52,
    borderRadius: 16,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  disabledButton: {
    opacity: 0.7,
  },
  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },
  exerciseContent: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 12,
  },
  exerciseTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  modeLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: ACCENT,
    letterSpacing: 1.4,
  },
  exerciseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    marginTop: 5,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: LIGHT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  timeText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },
  liveCard: {
    backgroundColor: LIGHT,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
  },
  cardLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
    letterSpacing: 1.3,
  },
  valueText: {
    fontFamily: 'FredokaBold',
    fontSize: 32,
    color: BROWN,
    marginTop: 8,
  },
  barRow: {
    height: 150,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  bar: {
    width: 10,
    borderRadius: 8,
    backgroundColor: ACCENT,
    minHeight: 12,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  noteText: {
    flex: 1,
    marginLeft: 10,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: DARK,
  },
  stopButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: DARK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  // Quit confirmation modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(35, 22, 17, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  confirmationCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: WHITE,
    borderRadius: 26,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    elevation: 10,
    shadowColor: BROWN,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },
  modalIconCircle: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: PINK,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    lineHeight: 31,
    color: BROWN,
    textAlign: 'center',
    marginBottom: 10,
  },
  modalMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: BROWN,
    textAlign: 'center',
  },
  modalHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  modalButtons: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  continueButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: WHITE,
    borderWidth: 1.5,
    borderColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  continueButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    textAlign: 'center',
  },
  quitButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  quitButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: WHITE,
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.65,
  },
});