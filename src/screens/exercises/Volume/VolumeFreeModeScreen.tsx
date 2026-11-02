import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  type LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import { measureFreeModeFrame } from '@/services/measurement/freeMode/freeMode';
import { VolumeVisualizer } from '@/screens/exercises/Volume/SharedVolumeComponents';

import {
  COLORS,
  VOLUME_DBFS_MAX,
  VOLUME_DBFS_MIN,
} from '@/constants/appConstants';
import { ExerciseQuitModal } from '@/screens/exercises/ExerciseScreen';

type Phase = 'ready' | 'exercise';

const BAR_COUNT = 32;

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

  const [phase, setPhase] = useState<Phase>('ready');
  const [liveVolume, setLiveVolume] = useState<number | null>(null);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  const phaseRef = useRef<Phase>('ready');
  const startedAtRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const leaveRequestedRef = useRef(false);
  const showQuitModalRef = useRef(false);
  const startTaskRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  phaseRef.current = phase;

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
      [...previous, normalized].slice(-BAR_COUNT),
    );
  }, []);

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
    setError(null);

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
        <SafeAreaView style={[styles.screen, safeAreaStyle]}>
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
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons
                name="arrow-back"
                size={20}
                color={COLORS.brown}
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
                name="volume-high"
                size={36}
                color={COLORS.accent}
              />
            </View>

            <Text style={styles.pageTitle}>
              Volume Free Mode
            </Text>

            <Text style={styles.pageDescription}>
              Practice your volume freely and listen to changes in
              your voice without a target volume or structured exercise.
            </Text>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>
                LIVE FEEDBACK
              </Text>

              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons
                    name="volume-medium-outline"
                    size={20}
                    color={COLORS.accent}
                  />
                </View>

                <View style={styles.infoText}>
                  <Text style={styles.infoName}>
                    Volume Level
                  </Text>

                  <Text style={styles.infoDescription}>
                    See your current vocal volume in real time.
                  </Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons
                    name="pulse-outline"
                    size={20}
                    color={COLORS.accent}
                  />
                </View>

                <View style={styles.infoText}>
                  <Text style={styles.infoName}>
                    Volume Flow
                  </Text>

                  <Text style={styles.infoDescription}>
                    Observe how your voice gets quieter or louder as you sing.
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.noTargetCard}>
              <Ionicons
                name="information-circle-outline"
                size={20}
                color={COLORS.accent}
              />

              <Text style={styles.noTargetText}>
                There is no target volume band in this mode.
                Explore your voice at any comfortable volume.
              </Text>
            </View>

            {error ? (
              <Text style={styles.errorText}>{error}</Text>
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
              style={[
                styles.startButton,
                (isStarting || isQuitting) && styles.buttonDisabled,
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
      <SafeAreaView style={[styles.screen, safeAreaStyle]}>
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
            accessibilityRole="button"
            accessibilityLabel="Quit exercise"
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={COLORS.brown}
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
                Explore your natural volume
              </Text>
            </View>

            <View style={styles.timeBadge}>
              <Ionicons
                name="time-outline"
                size={16}
                color={COLORS.accent}
              />

              <Text style={styles.timeText}>
                {formattedTime}
              </Text>
            </View>
          </View>

          <View style={styles.liveCard}>
            <Text style={styles.cardLabel}>
              CURRENT VOLUME
            </Text>

            <View style={styles.volumeDisplay}>
              <View>
                <Text style={styles.volumeValue}>
                  {liveVolume !== null
                    ? liveVolume.toFixed(1)
                    : '--'}
                </Text>

                <Text style={styles.frequencyText}>dBFS</Text>
              </View>

              <View style={styles.volumeIcon}>
                <Ionicons
                  name="volume-high"
                  size={27}
                  color={COLORS.accent}
                />
              </View>
            </View>

            <View style={styles.visualizerHeader}>
              <View>
                <Text style={styles.visualizerTitle}>
                  Your Volume
                </Text>

                <Text style={styles.visualizerSub}>
                  {liveVolume !== null
                    ? 'Audio level detected'
                    : 'Start singing to see your volume'}
                </Text>
              </View>

              <View style={styles.visualizerMic}>
                <Ionicons
                  name="pulse-outline"
                  size={20}
                  color={COLORS.accent}
                />
              </View>
            </View>

            <VolumeVisualizer
              liveHistory={liveHistory}
              barCount={BAR_COUNT}
              variant="freeMode"
            />

            <View style={styles.visualizerLabels}>
              <Text style={styles.visualizerLabel}>QUIET</Text>
              <Text style={styles.visualizerLabel}>LOUD</Text>
            </View>
          </View>

          <View style={styles.stabilityCard}>
            <View>
              <Text style={styles.cardLabel}>
                LIVE INPUT LEVEL
              </Text>

              <Text style={styles.stabilityValue}>
                {liveVolume !== null
                  ? `${liveVolume.toFixed(1)} dBFS`
                  : '--'}
              </Text>
            </View>

            <View style={styles.stabilityIcon}>
              <Ionicons
                name="mic-outline"
                size={25}
                color={COLORS.accent}
              />
            </View>
          </View>

          <View style={styles.noteCard}>
            <Ionicons
              name="sparkles-outline"
              size={18}
              color={COLORS.accent}
            />

            <Text style={styles.noteText}>
              There is no target volume. Sing naturally and observe
              how your volume changes without pressure.
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
            style={[
              styles.stopButton,
              isQuitting && styles.buttonDisabled,
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
    backgroundColor: COLORS.white,
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
    backgroundColor: COLORS.white,
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
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
  },
  pageTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 30,
    color: COLORS.brown,
    textAlign: 'center',
  },
  pageDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  infoCard: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    marginTop: 24,
  },
  infoTitle: {
    fontFamily: 'FredokaBold',
    color: COLORS.brown,
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
    backgroundColor: COLORS.pink,
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
    color: COLORS.brown,
  },
  infoDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 2,
    lineHeight: 18,
  },
  noTargetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginTop: 18,
  },
  noTargetText: {
    flex: 1,
    marginLeft: 10,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.muted,
  },
  errorText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.error,
    textAlign: 'center',
    marginTop: 12,
  },
  bottomAction: {
    paddingTop: 12,
  },
  startButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: COLORS.brown,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  startButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: COLORS.white,
  },
  stopButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: COLORS.dark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -30,
    marginBottom: 52,
    gap: 8,
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
    color: COLORS.accent,
    letterSpacing: 1.4,
  },
  exerciseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 5,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  timeText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: COLORS.brown,
  },
  liveCard: {
    backgroundColor: COLORS.background,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    marginBottom: -70,
  },
  cardLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: COLORS.brown,
    letterSpacing: 1.3,
  },
  volumeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 16,
  },
  volumeValue: {
    fontFamily: 'FredokaBold',
    fontSize: 36,
    color: COLORS.brown,
  },
  frequencyText: {
    fontFamily: 'FredokaRegular',
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 2,
  },
  volumeIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualizerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visualizerTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  visualizerSub: {
    fontFamily: 'FredokaRegular',
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.muted,
  },
  visualizerMic: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualizerLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  visualizerLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    color: COLORS.muted,
    letterSpacing: 1,
  },
  stabilityCard: {
    marginTop: 18,
    padding: 18,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stabilityValue: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: COLORS.brown,
    marginTop: 5,
  },
  stabilityIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.pink,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 25,
  },
  noteText: {
    flex: 1,
    marginLeft: 10,
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.dark,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});