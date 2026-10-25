import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import {
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
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import { measurePitchFreeModeFrame } from '@/services/measurement/freemode/pitch';
import { frequencyToNoteName } from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const DARK = '#5A343D';
const PINK = '#FCD6DD';
const LIGHT = '#FFF8FA';
const BORDER = '#F1DCE2';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';

type Phase = 'ready' | 'exercise';

const WAVE_COUNT = 18;
const PITCH_HISTORY_LIMIT = 19;

export default function PitchFreeModeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.min(22, width * 0.055);

  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const leaveRequestedRef = useRef(false);
  const quitModalOpenRef = useRef(false);
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
    onFrame: handleAudioFrame,
  });

  useEffect(() => {
    if (phase !== 'exercise') {
      return;
    }

    const timer = setInterval(() => {
      setElapsedSeconds(previous => previous + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      isRecordingRef.current = false;
    };
  }, []);

  const formattedTime = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(
      seconds,
    ).padStart(2, '0')}`;
  }, [elapsedSeconds]);

  const currentNote = useMemo(
    () => frequencyToNoteName(detectedFrequency),
    [detectedFrequency],
  );

  const handleBack = useCallback(() => {
    if (leaveRequestedRef.current || quitModalOpenRef.current) {
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

  const confirmQuitExercise = useCallback(async () => {
    if (leaveRequestedRef.current) {
      return;
    }

    leaveRequestedRef.current = true;
    isRecordingRef.current = false;
    quitModalOpenRef.current = false;

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
            <Ionicons name="musical-notes-outline" size={34} color={BROWN} />
          </View>

          <Text style={styles.modalTitle}>Quit Exercise?</Text>

          <Text style={styles.modalMessage}>
            Are you sure you want to leave Pitch Free Mode?
          </Text>

          <Text style={styles.modalHint}>
            Your current session will stop. Free Mode feedback is not saved
            as a scored exercise.
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
              <Text style={styles.continueButtonText}>No, Continue</Text>
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
                <ActivityIndicator size="small" color={WHITE} />
              ) : (
                <Text style={styles.quitButtonText}>Yes, Quit</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
    setError(null);
    isRecordingRef.current = false;

    try {
      setElapsedSeconds(0);
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
        setError(
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
        setElapsedSeconds(0);
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
          styles.screen,
          { paddingBottom: insets.bottom },
        ]}
      >
        <View
          style={[
            styles.header,
            { paddingHorizontal: horizontalPadding },
          ]}
        >
          <Pressable
            style={styles.backButton}
            onPress={handleBack}
            disabled={isQuitting}
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={BROWN}
            />
          </Pressable>

          <View style={styles.headerSpacer} />
        </View>

        <View
          style={[
            styles.readyContent,
            { paddingHorizontal: horizontalPadding },
          ]}
        >
          <View style={styles.modeIcon}>
            <Ionicons
              name="musical-notes"
              size={36}
              color={ACCENT}
            />
          </View>

          <Text style={styles.pageTitle}>
            Pitch Free Mode
          </Text>

          <Text style={styles.pageDescription}>
            Sing naturally and listen to your pitch
            without any structure or target note.
          </Text>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>
              LIVE FEEDBACK
            </Text>

            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons
                  name="mic-outline"
                  size={20}
                  color={ACCENT}
                />
              </View>

              <View style={styles.infoText}>
                <Text style={styles.infoName}>
                  Pitch Flow
                </Text>

                <Text style={styles.infoDescription}>
                  Follow the natural rise and fall of your voice.
                </Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons
                  name="trending-up-outline"
                  size={20}
                  color={ACCENT}
                />
              </View>

              <View style={styles.infoText}>
                <Text style={styles.infoName}>
                  Listening
                </Text>

                <Text style={styles.infoDescription}>
                  Focus on tone and stability without a score.
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
              There is no target pitch in this mode.
              Explore your voice at a comfortable range.
            </Text>
          </View>

          {error ? (
            <Text style={styles.errorText}>
              {error}
            </Text>
          ) : null}
        </View>

        <View
          style={[
            styles.bottomAction,
            {
              paddingHorizontal: horizontalPadding,
              paddingBottom: Math.max(8, insets.bottom),
            },
          ]}
        >
          <Pressable
            style={styles.startButton}
            onPress={startFreeMode}
            disabled={isStarting}
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
        styles.screen,
        { paddingBottom: insets.bottom },
      ]}
    >
      <View
        style={[
          styles.header,
          { paddingHorizontal: horizontalPadding },
        ]}
      >
        <Pressable
          style={styles.backButton}
          onPress={handleBack}
          disabled={isQuitting}
        >
          <Ionicons
            name="arrow-back"
            size={20}
            color={BROWN}
          />
        </Pressable>

        <View style={styles.headerSpacer} />
      </View>

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
              Listen to your pitch naturally
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
            CURRENT PITCH
          </Text>

          <View style={styles.pitchDisplay}>
            <View>
              <Text style={styles.noteValue}>
                {currentNote}
              </Text>

              <Text style={styles.frequencyText}>
                {detectedFrequency > 0
                  ? `${Math.round(detectedFrequency)} Hz`
                  : '-- Hz'}
              </Text>
            </View>

            <View style={styles.pitchIcon}>
              <Ionicons
                name="musical-note"
                size={27}
                color={ACCENT}
              />
            </View>
          </View>

          <View style={styles.waveRow}>
            {pitchHistory.map((value, index) => (
              <View
                key={`wave-${index}`}
                style={[
                  styles.wave,
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

        <View style={styles.stabilityCard}>
          <View>
            <Text style={styles.cardLabel}>
              PITCH STABILITY
            </Text>

            <Text style={styles.stabilityValue}>
              {detectedFrequency > 0 && stabilityReady
                ? `${Math.round(stabilityPct)}%`
                : '--'}
            </Text>
          </View>

          <View style={styles.stabilityIcon}>
            <Ionicons
              name="analytics-outline"
              size={25}
              color={ACCENT}
            />
          </View>
        </View>

        <View style={styles.noteCard}>
          <Ionicons
            name="sparkles-outline"
            size={18}
            color={ACCENT}
          />

          <Text style={styles.noteText}>
            Experiment with a comfortable pitch range and let
            your voice move naturally without pressure.
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.bottomAction,
          {
            paddingHorizontal: horizontalPadding,
            paddingBottom: Math.max(8, insets.bottom),
          },
        ]}
      >
        <Pressable
          style={[styles.stopButton, isQuitting && styles.buttonDisabled]}
          onPress={stopFreeMode}
          disabled={isQuitting}
        >
          <Ionicons
            name="stop"
            size={18}
            color={WHITE}
          />

          <Text style={styles.startButtonText}>
            Stop Free Mode
          </Text>
        </Pressable>
      </View>
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
    marginTop: 100,
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
    marginBottom: 14,
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
  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: '#B42336',
    textAlign: 'center',
    marginTop: 12,
  },
  bottomAction: {
    paddingTop: 12,
  },
  startButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
    marginTop: 75,
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
    marginBottom: -70,
  },
  cardLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
    letterSpacing: 1.3,
  },
  pitchDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  noteValue: {
    fontFamily: 'FredokaBold',
    fontSize: 36,
    color: BROWN,
  },
  frequencyText: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: MUTED,
    marginTop: 2,
  },
  pitchIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveRow: {
    height: 120,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  wave: {
    width: 11,
    borderRadius: 999,
    backgroundColor: ACCENT,
    minHeight: 10,
  },
  stabilityCard: {
    marginTop: 18,
    padding: 18,
    borderRadius: 20,
    backgroundColor: LIGHT,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stabilityValue: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    marginTop: 5,
  },
  stabilityIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 25,
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
    marginTop: -30,
    marginBottom: 52,
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(35, 22, 17, 0.48)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  confirmationCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: WHITE,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: 'center',
    shadowColor: BROWN,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 10,
  },
  modalIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
    textAlign: 'center',
  },
  modalMessage: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    lineHeight: 22,
    color: DARK,
    textAlign: 'center',
    marginTop: 10,
  },
  modalHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
  },
  modalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
    marginTop: 24,
  },
  continueButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: WHITE,
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
    borderRadius: 999,
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
    opacity: 0.78,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});