import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
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
  measurePitchFreeModeFrame,
} from '@/services/measurement/freemode/pitch';

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

function frequencyToNote(frequency: number): string {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return '--';
  }

  const noteNames = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];

  const midi = Math.round(
    69 + 12 * Math.log2(frequency / 440),
  );

  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;

  return `${noteNames[noteIndex]}${octave}`;
}

export default function PitchFreeModeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.min(22, width * 0.055);

  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isStarting, setIsStarting] = useState(false);

  // ==========================================================
  // LIVE PITCH DATA
  // ==========================================================

  const [detectedFrequency, setDetectedFrequency] =
    useState(0);

  const [stabilityPct, setStabilityPct] = useState(0);

  const [pitchHistory, setPitchHistory] = useState<number[]>(
    () => Array(WAVE_COUNT).fill(0),
  );

  // ==========================================================
  // AUDIO FRAME HANDLER
  // ==========================================================

  const handleAudioFrame = useCallback(
    (frame: LiveAudioFrame) => {
      const reading = measurePitchFreeModeFrame(
        frame.samples,
        frame.sampleRate,
      );

      console.log('🎵 PITCH FREE MODE:', {
        frequency: reading.detectedFrequency,
        stability: reading.stabilityPct,
        samples: frame.samples.length,
        sampleRate: frame.sampleRate,
      });

      setDetectedFrequency(
        reading.detectedFrequency,
      );

      setStabilityPct(
        reading.stabilityPct,
      );

      /*
       * Normalize frequency only for the visual waveform.
       *
       * This is NOT a pitch score.
       * It simply lets lower and higher notes appear
       * at different heights.
       */
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

        setPitchHistory((previous) => [
          ...previous.slice(-(WAVE_COUNT - 1)),
          clamped,
        ]);
      } else {
        /*
         * No voiced pitch detected.
         * Add a small baseline rather than pretending
         * that silence is a pitch.
         */
        setPitchHistory((previous) => [
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

  // ==========================================================
  // TIMER
  // ==========================================================

  useEffect(() => {
    if (phase !== 'exercise') {
      return;
    }

    const timer = setInterval(() => {
      setElapsedSeconds(
        (previous) => previous + 1,
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [phase]);

  const formattedTime = useMemo(() => {
    const minutes = Math.floor(
      elapsedSeconds / 60,
    );

    const seconds = elapsedSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(
      seconds,
    ).padStart(2, '0')}`;
  }, [elapsedSeconds]);

  // ==========================================================
  // CURRENT NOTE
  // ==========================================================

  const currentNote = useMemo(
    () => frequencyToNote(detectedFrequency),
    [detectedFrequency],
  );

  // ==========================================================
  // START
  // ==========================================================

  const startFreeMode = async () => {
    if (
      isStarting ||
      phase === 'exercise' ||
      isRecording
    ) {
      return;
    }

    setIsStarting(true);

    try {
      setElapsedSeconds(0);

      setDetectedFrequency(0);
      setStabilityPct(0);

      setPitchHistory(
        Array(WAVE_COUNT).fill(0),
      );

      await startRecording();

      setPhase('exercise');
    } catch (error) {
      console.error(
        '❌ FAILED TO START PITCH FREE MODE:',
        error,
      );
    } finally {
      setIsStarting(false);
    }
  };

  // ==========================================================
  // STOP
  // ==========================================================

  const stopFreeMode = async () => {
    try {
      await stopRecording();
    } catch (error) {
      console.error(
        '❌ FAILED TO STOP PITCH FREE MODE:',
        error,
      );
    }

    setElapsedSeconds(0);
    setDetectedFrequency(0);
    setStabilityPct(0);

    setPitchHistory(
      Array(WAVE_COUNT).fill(0),
    );

    setPhase('ready');
  };

  // ==========================================================
  // READY SCREEN
  // ==========================================================

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
            {
              paddingHorizontal:
                horizontalPadding,
            },
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
            Pitch Free Mode
          </Text>

          <View style={styles.headerSpacer} />
        </View>

        <View
          style={[
            styles.readyContent,
            {
              paddingHorizontal:
                horizontalPadding,
            },
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
                  Follow the natural rise and fall
                  of your voice.
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
                  Focus on tone and stability without
                  a score.
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
        </View>

        <View
          style={[
            styles.bottomAction,
            {
              paddingHorizontal:
                horizontalPadding,
              paddingBottom: Math.max(
                8,
                insets.bottom,
              ),
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

  // ==========================================================
  // EXERCISE SCREEN
  // ==========================================================

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
          {
            paddingHorizontal:
              horizontalPadding,
          },
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
          Pitch Free Mode
        </Text>

        <View style={styles.headerSpacer} />
      </View>

      <View
        style={[
          styles.exerciseContent,
          {
            paddingHorizontal:
              horizontalPadding,
          },
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

        {/* CURRENT PITCH */}

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
                  ? `${Math.round(
                      detectedFrequency,
                    )} Hz`
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
            {pitchHistory.map(
              (value, index) => (
                <View
                  key={`wave-${index}`}
                  style={[
                    styles.wave,
                    {
                      height: `${Math.max(
                        10,
                        value * 100,
                      )}%`,
                      opacity:
                        value === 0
                          ? 0.15
                          : 0.3 +
                            value * 0.7,
                    },
                  ]}
                />
              ),
            )}
          </View>
        </View>

        {/* STABILITY */}

        <View style={styles.stabilityCard}>
          <View>
            <Text style={styles.cardLabel}>
              PITCH STABILITY
            </Text>

            <Text style={styles.stabilityValue}>
              {detectedFrequency > 0
                ? `${Math.round(
                    stabilityPct,
                  )}%`
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
            Experiment with a comfortable pitch range
            and let your voice move naturally without
            pressure.
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.bottomAction,
          {
            paddingHorizontal:
              horizontalPadding,
            paddingBottom: Math.max(
              8,
              insets.bottom,
            ),
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