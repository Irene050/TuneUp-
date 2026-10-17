
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  useAudioRecorder,
  type LiveAudioFrame,
} from '@/hooks/useAudioRecorder';
import { measureVolumeFreeModeFrame } from '@/services/measurement/freemode/volume';

/* =========================================================
   COLORS
   ========================================================= */

const COLORS = {
  brown: '#4E2F1F',
  dark: '#5A343D',
  pink: '#FCD6DD',
  light: '#FFF8FA',
  pale: '#FFF0F3',
  border: '#F1DCE2',
  accent: '#D86C89',
  muted: '#9A817D',
  white: '#FFFFFF',
  visualizerBackground: '#FFF8FA',
  visualizerLine: '#F0DDE2',
  progressBackground: '#F0E4E7',
} as const;

/* =========================================================
   VOLUME RANGE AND VISUALIZER
   ========================================================= */

const DBFS_MIN = -60;
const DBFS_MAX = -10;
const BAR_COUNT = 32;

type Phase = 'ready' | 'exercise';

/* =========================================================
   HELPERS
   ========================================================= */

function normalizeVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      1,
      (value - DBFS_MIN) / (DBFS_MAX - DBFS_MIN),
    ),
  );
}

/* =========================================================
   VOLUME VISUALIZER
   ========================================================= */

function VolumeVisualizer({
  liveHistory,
}: {
  liveHistory: number[];
}) {
  const actualBars = Array.from(
    { length: BAR_COUNT },
    (_, index) => liveHistory[index] ?? 0,
  );

  return (
    <View style={styles.visualizer}>
      <View style={styles.centerLine} />

      <View style={styles.actualBars}>
        {actualBars.map((value, index) => (
          <View
            key={`bar-${index}`}
            style={[
              styles.actualBar,
              {
                height:
                  value > 0
                    ? `${Math.max(5, value * 82)}%`
                    : '0%',
              },
            ]}
          />
        ))}
      </View>

      {liveHistory.length === 0 && (
        <Text style={styles.visualizerPlaceholder}>
          Start singing to see your volume
        </Text>
      )}
    </View>
  );
}

/* =========================================================
   MAIN SCREEN
   ========================================================= */

export default function VolumeFreeModeScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const horizontalPadding = Math.min(22, width * 0.055);
  const isSmallScreen = height < 700;

  /* =======================================================
     STATE
     ======================================================= */

  const [phase, setPhase] = useState<Phase>('ready');
  const [liveVolume, setLiveVolume] = useState<number | null>(null);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isStarting, setIsStarting] = useState(false);

  /* =======================================================
     REFS
     ======================================================= */

  const phaseRef = useRef<Phase>('ready');
  const startedAtRef = useRef<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Keep the audio callback aware of the current screen phase.
  phaseRef.current = phase;

  /* =======================================================
     TIMER CLEANUP
     ======================================================= */

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  /* =======================================================
     LIVE AUDIO
     ======================================================= */

  const handleAudioFrame = (frame: LiveAudioFrame) => {
    if (phaseRef.current !== 'exercise') {
      return;
    }

    const reading = measureVolumeFreeModeFrame(
      frame.samples,
      frame.sampleRate,
    );

    if (!Number.isFinite(reading.volumeDb)) {
      return;
    }

    setLiveVolume(reading.volumeDb);

    // The visualizer shows relative input-volume changes.
    // It does not calculate an exercise score.
    const normalized = normalizeVolume(reading.volumeDb);

    setLiveHistory((previous) =>
      [...previous, normalized].slice(-BAR_COUNT),
    );
  };

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: handleAudioFrame,
  });

  /* =======================================================
     TIMER
     ======================================================= */

  useEffect(() => {
    if (phase !== 'exercise') {
      return;
    }

    startedAtRef.current = Date.now();

    timerRef.current = setInterval(() => {
      const startedAt = startedAtRef.current;

      if (startedAt === null) {
        return;
      }

      const elapsed = Math.floor(
        (Date.now() - startedAt) / 1000,
      );

      setElapsedSeconds(elapsed);
    }, 250);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase]);

  /* =======================================================
     START FREE MODE
     ======================================================= */

  const startFreeMode = async () => {
    if (isStarting || phaseRef.current === 'exercise' || isRecording) {
      return;
    }

    try {
      setIsStarting(true);

      setLiveVolume(null);
      setLiveHistory([]);
      setElapsedSeconds(0);

      startedAtRef.current = null;

      await startRecording();

      phaseRef.current = 'exercise';
      setPhase('exercise');
    } catch (error) {
      console.error(
        'Unable to start Volume Free Mode:',
        error,
      );
    } finally {
      setIsStarting(false);
    }
  };

  /* =======================================================
     STOP FREE MODE
     ======================================================= */

  const stopFreeMode = async () => {
    // Change the phase immediately so subsequent frames are ignored.
    phaseRef.current = 'ready';
    setPhase('ready');

    try {
      if (isRecording) {
        await stopRecording();
      }
    } catch (error) {
      console.error(
        'Unable to stop Volume Free Mode:',
        error,
      );
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      startedAtRef.current = null;

      setLiveVolume(null);
      setLiveHistory([]);
      setElapsedSeconds(0);
    }
  };

  /* =======================================================
     FORMATTED TIME
     ======================================================= */

  const formattedTime = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(
      seconds,
    ).padStart(2, '0')}`;
  }, [elapsedSeconds]);

  /* =======================================================
     SHARED LAYOUT VALUES
     ======================================================= */

  const safeAreaStyle = {
    paddingBottom: insets.bottom,
  };

  const bottomActionStyle = {
    paddingHorizontal: horizontalPadding,
    paddingBottom: Math.max(8, insets.bottom),
  };

  /* =======================================================
     READY SCREEN
     ======================================================= */

  if (phase === 'ready') {
    return (
      <SafeAreaView
        style={[styles.screen, safeAreaStyle]}
      >
        {/* HEADER */}
        <View
          style={[
            styles.header,
            { paddingHorizontal: horizontalPadding },
          ]}
        >
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={COLORS.brown}
            />
          </Pressable>

          <Text style={styles.headerTitle}>
            Volume Free Mode
          </Text>

          <View style={styles.headerSpacer} />
        </View>

        {/* CONTENT */}
        <View
          style={[
            styles.readyContent,
            { paddingHorizontal: horizontalPadding },
          ]}
        >
          <View style={styles.modeIcon}>
            <Ionicons
              name="musical-notes"
              size={34}
              color={COLORS.accent}
            />
          </View>

          <Text style={styles.pageTitle}>
            Volume Free Mode
          </Text>

          <Text style={styles.pageDescription}>
            Practice your volume freely without a target
            volume band or structured exercise.
          </Text>

          {/* LIVE FEEDBACK */}
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
          </View>

          {/* NO TARGET NOTICE */}
          <View style={styles.noTargetCard}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={COLORS.accent}
            />

            <Text style={styles.noTargetText}>
              There is no target volume band in Free Mode.
              Sing at any comfortable volume.
            </Text>
          </View>
        </View>

        {/* START BUTTON */}
        <View
          style={[
            styles.bottomAction,
            bottomActionStyle,
          ]}
        >
          <Pressable
            style={[
              styles.startButton,
              isStarting && styles.disabledButton,
            ]}
            onPress={startFreeMode}
            disabled={isStarting || isRecording}
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
    );
  }

  /* =======================================================
     EXERCISE SCREEN
     ======================================================= */

  return (
    <SafeAreaView
      style={[styles.screen, safeAreaStyle]}
    >
      {/* HEADER */}
      <View
        style={[
          styles.header,
          { paddingHorizontal: horizontalPadding },
        ]}
      >
        <Pressable
          style={styles.backButton}
          onPress={stopFreeMode}
          accessibilityRole="button"
          accessibilityLabel="Stop and go back"
        >
          <Ionicons
            name="arrow-back"
            size={20}
            color={COLORS.brown}
          />
        </Pressable>

        <Text style={styles.headerTitle}>
          Volume Free Mode
        </Text>

        <View style={styles.headerSpacer} />
      </View>

      {/* MAIN CONTENT */}
      <View
        style={[
          styles.exerciseContent,
          { paddingHorizontal: horizontalPadding },
        ]}
      >
        {/* TOP INFO */}
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

        {/* MAIN VOLUME CARD */}
        <View
          style={[
            styles.volumeCard,
            isSmallScreen && styles.volumeCardSmall,
          ]}
        >
          <Text style={styles.volumeLabel}>
            CURRENT VOLUME
          </Text>

          <Text
            style={[
              styles.volumeValue,
              isSmallScreen && styles.volumeValueSmall,
            ]}
          >
            {liveVolume !== null
              ? liveVolume.toFixed(1)
              : '--'}
          </Text>

          <Text style={styles.volumeUnit}>
            dBFS
          </Text>

          <View style={styles.micCircle}>
            <Ionicons
              name="mic"
              size={isSmallScreen ? 30 : 36}
              color={COLORS.white}
            />
          </View>

          <Text style={styles.volumeHint}>
            {liveVolume !== null
              ? 'Audio level detected'
              : 'Listening...'}
          </Text>
        </View>

        {/* VISUALIZER */}
        <View style={styles.visualizerCard}>
          <View style={styles.visualizerHeader}>
            <View>
              <Text style={styles.visualizerTitle}>
                Your Volume
              </Text>

              <Text style={styles.visualizerSub}>
                Live volume pattern
              </Text>
            </View>

            <View style={styles.visualizerMic}>
              <Ionicons
                name="pulse-outline"
                size={18}
                color={COLORS.accent}
              />
            </View>
          </View>

          <VolumeVisualizer liveHistory={liveHistory} />

          <View style={styles.visualizerLabels}>
            <Text style={styles.visualizerLabel}>
              QUIET
            </Text>

            <Text style={styles.visualizerLabel}>
              LOUD
            </Text>
          </View>
        </View>

        {/* FREE MODE MESSAGE */}
        <View style={styles.freeModeMessage}>
          <Ionicons
            name="musical-note-outline"
            size={19}
            color={COLORS.accent}
          />

          <Text style={styles.freeModeMessageText}>
            No target volume. Sing naturally and observe
            how your volume changes.
          </Text>
        </View>
      </View>

      {/* STOP BUTTON */}
      <View
        style={[
          styles.bottomAction,
          bottomActionStyle,
        ]}
      >
        <Pressable
          style={styles.stopButton}
          onPress={stopFreeMode}
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
  );
}

/* =========================================================
   STYLES
   ========================================================= */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.light,
  },

  /* HEADER */
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.brown,
  },
  headerSpacer: {
    width: 36,
  },

  /* READY SCREEN */
  readyContent: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 20,
  },
  modeIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    marginTop: 12,
    fontSize: 27,
    fontWeight: '900',
    color: COLORS.brown,
    textAlign: 'center',
  },
  pageDescription: {
    marginTop: 6,
    maxWidth: 330,
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.muted,
    textAlign: 'center',
  },
  infoCard: {
    width: '100%',
    marginTop: 20,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  infoTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: COLORS.muted,
  },
  infoRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    flex: 1,
    marginLeft: 11,
  },
  infoName: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.dark,
  },
  infoDescription: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.muted,
  },
  noTargetCard: {
    width: '100%',
    marginTop: 12,
    padding: 13,
    borderRadius: 15,
    backgroundColor: COLORS.pale,
    flexDirection: 'row',
    alignItems: 'center',
  },
  noTargetText: {
    flex: 1,
    marginLeft: 9,
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.dark,
  },

  /* BOTTOM ACTION */
  bottomAction: {
    backgroundColor: COLORS.light,
    paddingTop: 8,
  },
  startButton: {
    minHeight: 51,
    borderRadius: 16,
    backgroundColor: COLORS.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  stopButton: {
    minHeight: 51,
    borderRadius: 16,
    backgroundColor: COLORS.dark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  startButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.white,
  },
  disabledButton: {
    opacity: 0.6,
  },

  /* EXERCISE SCREEN */
  exerciseContent: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 5,
  },
  exerciseTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modeLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    color: COLORS.muted,
  },
  exerciseSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.dark,
  },
  timeBadge: {
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 18,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.brown,
  },

  /* VOLUME CARD */
  volumeCard: {
    minHeight: 190,
    borderRadius: 22,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  volumeCardSmall: {
    minHeight: 155,
  },
  volumeLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    color: COLORS.muted,
  },
  volumeValue: {
    marginTop: 2,
    fontSize: 42,
    lineHeight: 46,
    fontWeight: '900',
    color: COLORS.brown,
  },
  volumeValueSmall: {
    fontSize: 34,
    lineHeight: 38,
  },
  volumeUnit: {
    marginTop: -1,
    fontSize: 10,
    color: COLORS.muted,
  },
  micCircle: {
    marginTop: 7,
    width: 55,
    height: 55,
    borderRadius: 27.5,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeHint: {
    marginTop: 6,
    fontSize: 10,
    color: COLORS.muted,
  },

  /* VISUALIZER CARD */
  visualizerCard: {
    backgroundColor: COLORS.white,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
  },
  visualizerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visualizerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.dark,
  },
  visualizerSub: {
    marginTop: 1,
    fontSize: 9,
    color: COLORS.muted,
  },
  visualizerMic: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualizer: {
    marginTop: 8,
    height: 75,
    borderRadius: 11,
    backgroundColor: COLORS.visualizerBackground,
    overflow: 'hidden',
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  actualBars: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  actualBar: {
    width: 4,
    minHeight: 4,
    borderRadius: 2,
    backgroundColor: COLORS.accent,
  },
  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: COLORS.visualizerLine,
  },
  visualizerPlaceholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '34%',
    fontSize: 9,
    color: COLORS.muted,
    textAlign: 'center',
  },
  visualizerLabels: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  visualizerLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: COLORS.muted,
  },

  /* FREE MODE MESSAGE */
  freeModeMessage: {
    minHeight: 43,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: COLORS.pale,
    flexDirection: 'row',
    alignItems: 'center',
  },
  freeModeMessageText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 10,
    lineHeight: 15,
    color: COLORS.dark,
  },
});