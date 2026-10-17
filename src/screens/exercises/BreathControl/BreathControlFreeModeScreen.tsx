import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [volumeDb, setVolumeDb] = useState(-100);
  const [flowHistory, setFlowHistory] = useState<number[]>(
    () => Array(BAR_COUNT).fill(0),
  );

  const handleAudioFrame = useCallback((frame: LiveAudioFrame) => {
    const reading = measureBreathControlFreeModeFrame(
      frame.samples,
      frame.sampleRate,
    );

    setVolumeDb(reading.volumeDb);

    const normalizedFlow = Math.max(
      0,
      Math.min(1, (reading.volumeDb - MIN_VOLUME_DB) / 60),
    );

    setFlowHistory((previous) => [
      ...previous.slice(-(BAR_COUNT - 1)),
      normalizedFlow,
    ]);
  }, []);

  const { startRecording, stopRecording, isRecording } = useAudioRecorder({
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

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [elapsedSeconds]);

  const resetExercise = useCallback(() => {
    setElapsedSeconds(0);
    setVolumeDb(-100);
    setFlowHistory(Array(BAR_COUNT).fill(0));
  }, []);

  const startFreeMode = async () => {
    if (isStarting || phase === 'exercise' || isRecording) {
      return;
    }

    setIsStarting(true);

    try {
      resetExercise();
      await startRecording();
      setPhase('exercise');
    } catch (error) {
      console.error('Failed to start Breath Control Free Mode:', error);
    } finally {
      setIsStarting(false);
    }
  };

  const stopFreeMode = async () => {
    try {
      await stopRecording();
    } catch (error) {
      console.error('Failed to stop Breath Control Free Mode:', error);
    } finally {
      resetExercise();
      setPhase('ready');
    }
  };

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
      >
        <Ionicons name="arrow-back" size={20} color={BROWN} />
      </Pressable>

      <Text style={styles.headerTitle}>
        Breath Control Free Mode
      </Text>

      <View style={styles.headerSpacer} />
    </View>
  );

  const renderBottomAction = (
    button: React.ReactNode,
  ) => (
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

  if (phase === 'ready') {
    return (
      <SafeAreaView
        style={[
          styles.screen,
          { paddingBottom: insets.bottom },
        ]}
      >
        {renderHeader(() => router.back())}

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
              isStarting && styles.disabledButton,
            ]}
            onPress={startFreeMode}
            disabled={isStarting}
            accessibilityRole="button"
          >
            {isStarting ? (
              <ActivityIndicator color={WHITE} />
            ) : (
              <>
                <Ionicons name="mic" size={19} color={WHITE} />

                <Text style={styles.startButtonText}>
                  Start Free Mode
                </Text>
              </>
            )}
          </Pressable>,
        )}
      </SafeAreaView>
    );
  }

  const flowPercentage =
    volumeDb <= MIN_VOLUME_DB
      ? null
      : Math.round(((volumeDb - MIN_VOLUME_DB) / 60) * 100);

  return (
    <SafeAreaView
      style={[
        styles.screen,
        { paddingBottom: insets.bottom },
      ]}
    >
      {renderHeader(stopFreeMode)}

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
            {flowPercentage === null ? '--' : `${flowPercentage}%`}
          </Text>

          <View style={styles.barRow}>
            {flowHistory.map((value, index) => (
              <View
                key={index}
                style={[
                  styles.bar,
                  {
                    height: `${Math.max(12, value * 100)}%`,
                    opacity: value === 0 ? 0.15 : 0.25 + value * 0.75,
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
          style={styles.stopButton}
          onPress={stopFreeMode}
          accessibilityRole="button"
        >
          <Ionicons name="stop" size={18} color={WHITE} />

          <Text style={styles.startButtonText}>
            Stop Free Mode
          </Text>
        </Pressable>,
      )}
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
});