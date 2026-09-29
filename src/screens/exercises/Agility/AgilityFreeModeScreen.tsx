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
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  measureAgilityFreeModeFrame,
} from '@/services/measurement/freemode/agility';

const BROWN = '#4E2F1F';
const DARK = '#5A343D';
const PINK = '#FCD6DD';
const LIGHT = '#FFF8FA';
const BORDER = '#F1DCE2';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';

type Phase = 'ready' | 'exercise';

const BAR_COUNT = 16;

export default function AgilityFreeModeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.min(22, width * 0.055);

  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isStarting, setIsStarting] = useState(false);

  const [speedNotesPerSec, setSpeedNotesPerSec] = useState(0);
  const [accuracyPct, setAccuracyPct] = useState(0);

  const [liveHistory, setLiveHistory] = useState<number[]>(
    Array(BAR_COUNT).fill(0),
  );

  /*
   * Keep the current phase in a ref so the audio callback
   * always sees the latest value.
   */
  const phaseRef = useRef<Phase>('ready');

  /*
   * Process the raw PCM frame from the recorder.
   */
  const handleAudioFrame = (frame: LiveAudioFrame) => {
    if (phaseRef.current !== 'exercise') {
      return;
    }

    const reading = measureAgilityFreeModeFrame(
      frame.samples,
      frame.sampleRate,
    );

    if (!Number.isFinite(reading.speedNotesPerSec)) {
      return;
    }

    setSpeedNotesPerSec(reading.speedNotesPerSec);
    setAccuracyPct(reading.accuracyPct);

    /*
     * Visualization only.
     * This is NOT a score.
     */
    const speedLevel = Math.min(
      1,
      reading.speedNotesPerSec / 8,
    );

    const clarityLevel =
      Math.max(0, Math.min(1, reading.accuracyPct / 100));

    const activityValue =
      speedLevel * 0.7 + clarityLevel * 0.3;

    setLiveHistory((previous) => [
      ...previous.slice(-(BAR_COUNT - 1)),
      Math.max(
        0.08,
        Math.min(1, activityValue),
      ),
    ]);
  };

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
      setElapsedSeconds((previous) => previous + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [phase]);

  const formattedTime = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(
      seconds,
    ).padStart(2, '0')}`;
  }, [elapsedSeconds]);

  const startFreeMode = async () => {
    if (isStarting || phaseRef.current === 'exercise') {
      return;
    }

    setIsStarting(true);

    setElapsedSeconds(0);
    setSpeedNotesPerSec(0);
    setAccuracyPct(0);
    setLiveHistory(Array(BAR_COUNT).fill(0));

    phaseRef.current = 'exercise';
    setPhase('exercise');

    try {
      await startRecording();
    } catch (error) {
      console.error(
        '[Agility Free Mode] Failed to start recording:',
        error,
      );

      phaseRef.current = 'ready';
      setPhase('ready');
    } finally {
      setIsStarting(false);
    }
  };

  const stopFreeMode = async () => {
    phaseRef.current = 'ready';
    setPhase('ready');

    try {
      if (isRecording) {
        await stopRecording();
      }
    } catch (error) {
      console.error(
        '[Agility Free Mode] Failed to stop recording:',
        error,
      );
    }

    setElapsedSeconds(0);
    setSpeedNotesPerSec(0);
    setAccuracyPct(0);
    setLiveHistory(Array(BAR_COUNT).fill(0));
  };

  if (phase === 'ready') {
    return (
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
            onPress={() => router.back()}
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={BROWN}
            />
          </Pressable>

          <Text style={styles.headerTitle}>
            Agility Free Mode
          </Text>

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
              name="flash-outline"
              size={36}
              color={ACCENT}
            />
          </View>

          <Text style={styles.pageTitle}>
            Agility Free Mode
          </Text>

          <Text style={styles.pageDescription}>
            Move through your voice freely with no fixed pattern
            or target sequence.
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
                  Movement
                </Text>

                <Text style={styles.infoDescription}>
                  Observe how quickly your voice shifts between
                  notes.
                </Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons
                  name="walk-outline"
                  size={20}
                  color={ACCENT}
                />
              </View>

              <View style={styles.infoText}>
                <Text style={styles.infoName}>
                  Fluidity
                </Text>

                <Text style={styles.infoDescription}>
                  Explore smooth transitions without a required
                  drill.
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
              No specific interval or sequence is required here.
              Just sing comfortably and naturally.
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
    );
  }

  return (
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
          onPress={stopFreeMode}
        >
          <Ionicons
            name="arrow-back"
            size={20}
            color={BROWN}
          />
        </Pressable>

        <Text style={styles.headerTitle}>
          Agility Free Mode
        </Text>

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
              Explore your range with ease
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
            NOTE MOVEMENT
          </Text>

          <Text style={styles.valueText}>
            {speedNotesPerSec.toFixed(1)}
            <Text style={styles.unitText}>
              {' '}
              notes/s
            </Text>
          </Text>

          <View style={styles.barRow}>
            {liveHistory.map((value, index) => (
              <View
                key={`motion-${index}`}
                style={[
                  styles.bar,
                  {
                    height: `${Math.max(
                      10,
                      value * 100,
                    )}%`,
                    opacity:
                      0.3 + value * 0.7,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <View style={styles.feedbackRow}>
          <View style={styles.feedbackCard}>
            <Text style={styles.feedbackLabel}>
              TRANSITION SPEED
            </Text>

            <Text style={styles.feedbackValue}>
              {speedNotesPerSec.toFixed(1)}
            </Text>

            <Text style={styles.feedbackUnit}>
              notes/sec
            </Text>
          </View>

          <View style={styles.feedbackCard}>
            <Text style={styles.feedbackLabel}>
              PITCH CLARITY
            </Text>

            <Text style={styles.feedbackValue}>
              {accuracyPct}%
            </Text>

            <Text style={styles.feedbackUnit}>
              detected
            </Text>
          </View>
        </View>

        <View style={styles.noteCard}>
          <Ionicons
            name="rocket-outline"
            size={18}
            color={ACCENT}
          />

          <Text style={styles.noteText}>
            Move through your range with comfort. Let your
            transitions feel light, relaxed, and fluid.
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
          style={styles.stopButton}
          onPress={stopFreeMode}
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
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
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

  unitText: {
    fontFamily: 'FredokaRegular',
    fontSize: 15,
    color: MUTED,
  },

  barRow: {
    height: 148,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 20,
  },

  bar: {
    width: 11,
    borderRadius: 999,
    backgroundColor: ACCENT,
    minHeight: 12,
  },

  feedbackRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },

  feedbackCard: {
    flex: 1,
    backgroundColor: LIGHT,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },

  feedbackLabel: {
    fontFamily: 'FredokaBold',
    fontSize: 9,
    color: MUTED,
    letterSpacing: 1,
  },

  feedbackValue: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
    marginTop: 5,
  },

  feedbackUnit: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 1,
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
});