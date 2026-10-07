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
  measureToneFreeModeFrame,
} from '@/services/measurement/freemode/tone';

import {
  computeSpectralCentroid,
  type FrequencyZone,
} from '@/utils/dsp/spectral';

import {
  samplesToFFTFrames,
} from '@/utils/dsp/fft';

const BROWN = '#4E2F1F';
const DARK = '#5A343D';
const PINK = '#FCD6DD';
const LIGHT = '#FFF8FA';
const BORDER = '#F1DCE2';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';

type Phase = 'ready' | 'exercise';

const FFT_SIZE = 1024;
const FFT_HOP_SIZE = 512;
const WAVE_COUNT = 20;

export default function ToneFreeModeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const horizontalPadding =
    Math.min(22, width * 0.055);

  const [phase, setPhase] =
    useState<Phase>('ready');

  const [elapsedSeconds, setElapsedSeconds] =
    useState(0);

  const [isStarting, setIsStarting] =
    useState(false);

  const [frequencyZone, setFrequencyZone] =
    useState<FrequencyZone>('low');

  const [stabilityPct, setStabilityPct] =
    useState(0);

  const [hasTone, setHasTone] =
    useState(false);

  const [spectralHistory, setSpectralHistory] =
    useState<number[]>(
      () => Array(WAVE_COUNT).fill(0),
    );

  // ==========================================================
  // LIVE TONE ANALYSIS
  // ==========================================================

  const handleAudioFrame = useCallback(
    (frame: LiveAudioFrame) => {
      const fftFrames = samplesToFFTFrames(
        frame.samples,
        FFT_SIZE,
        FFT_HOP_SIZE,
      );

      if (fftFrames.length === 0) {
        return;
      }

      const reading =
        measureToneFreeModeFrame(
          fftFrames,
          frame.sampleRate,
          FFT_SIZE,
        );

      setFrequencyZone(
        reading.frequencyZone,
      );

      setStabilityPct(
        reading.stabilityPct,
      );

      // ========================================================
      // CURRENT FFT FRAME
      // ========================================================

      const latestFFT =
        fftFrames[fftFrames.length - 1];

      let magnitudeSum = 0;

      for (
        let i = 0;
        i < latestFFT.length;
        i++
      ) {
        magnitudeSum += latestFFT[i];
      }

      const voiced =
        magnitudeSum > 0.01;

      setHasTone(voiced);

      // ========================================================
      // SPECTRAL CENTROID
      // ========================================================

      const latestCentroid =
        computeSpectralCentroid(
          latestFFT,
          frame.sampleRate,
          FFT_SIZE,
        );

      if (latestCentroid > 0) {
        /*
         * This range is used only for the visual
         * spectral-history bars. It does not determine
         * the frequency zone or tone stability.
         */
        const minHz = 200;
        const maxHz = 4000;

        const normalized =
          (Math.log(latestCentroid) -
            Math.log(minHz)) /
          (Math.log(maxHz) -
            Math.log(minHz));

        const clamped = Math.max(
          0,
          Math.min(1, normalized),
        );

        setSpectralHistory(
          (previous) => [
            ...previous.slice(
              -(WAVE_COUNT - 1),
            ),
            clamped,
          ],
        );
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
    const minutes =
      Math.floor(elapsedSeconds / 60);

    const seconds =
      elapsedSeconds % 60;

    return `${String(minutes).padStart(
      2,
      '0',
    )}:${String(seconds).padStart(
      2,
      '0',
    )}`;
  }, [elapsedSeconds]);

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
      setFrequencyZone('low');
      setStabilityPct(0);
      setHasTone(false);

      setSpectralHistory(
        Array(WAVE_COUNT).fill(0),
      );

      await startRecording();

      setPhase('exercise');
    } catch (error) {
      console.error(
        '❌ FAILED TO START TONE FREE MODE:',
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
        '❌ FAILED TO STOP TONE FREE MODE:',
        error,
      );
    }

    setElapsedSeconds(0);
    setFrequencyZone('low');
    setStabilityPct(0);
    setHasTone(false);

    setSpectralHistory(
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
          {
            paddingBottom:
              insets.bottom,
          },
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
            Tone Free Mode
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
              name="happy-outline"
              size={36}
              color={ACCENT}
            />
          </View>

          <Text style={styles.pageTitle}>
            Tone Free Mode
          </Text>

          <Text style={styles.pageDescription}>
            Explore your vocal color and frequency
            zones without a set target or exercise
            pattern.
          </Text>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>
              LIVE FEEDBACK
            </Text>

            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons
                  name="bar-chart-outline"
                  size={20}
                  color={ACCENT}
                />
              </View>

              <View style={styles.infoText}>
                <Text style={styles.infoName}>
                  Tone
                </Text>

                <Text style={styles.infoDescription}>
                  Watch your vocal texture and
                  steadiness in real time.
                </Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons
                  name="sparkles-outline"
                  size={20}
                  color={ACCENT}
                />
              </View>

              <View style={styles.infoText}>
                <Text style={styles.infoName}>
                  Frequency Zone
                </Text>

                <Text style={styles.infoDescription}>
                  Observe how your dominant
                  frequency shifts naturally.
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
              No specific pitch or tone target is
              enforced here. Use this space to
              experiment freely.
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

                <Text
                  style={
                    styles.startButtonText
                  }
                >
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
        {
          paddingBottom:
            insets.bottom,
        },
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
          Tone Free Mode
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

            <Text
              style={
                styles.exerciseSubtitle
              }
            >
              Let your natural tone guide you
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

        {/* FREQUENCY ZONE */}

        <View style={styles.liveCard}>
          <Text style={styles.cardLabel}>
            CURRENT FREQUENCY ZONE
          </Text>

          <View style={styles.resonanceDisplay}>
            <View>
              <Text style={styles.resonanceValue}>
                {hasTone
                  ? formatFrequencyZone(
                      frequencyZone,
                    )
                  : '--'}
              </Text>

              <Text
                style={
                  styles.resonanceSubtitle
                }
              >
                {hasTone
                  ? 'Detected dominant-frequency zone'
                  : 'Sing to detect frequency zone'}
              </Text>
            </View>

            <View style={styles.resonanceIcon}>
              <Ionicons
                name="sparkles"
                size={27}
                color={ACCENT}
              />
            </View>
          </View>

          <View style={styles.waveRow}>
            {spectralHistory.map(
              (value, index) => (
                <View
                  key={`tone-${index}`}
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

        {/* TONE STABILITY */}

        <View style={styles.stabilityCard}>
          <View>
            <Text style={styles.cardLabel}>
              TONE STABILITY
            </Text>

            <Text style={styles.stabilityValue}>
              {hasTone
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
            name="musical-note-outline"
            size={18}
            color={ACCENT}
          />

          <Text style={styles.noteText}>
            Keep a relaxed mouth shape and notice how
            your tone becomes fuller, calmer, or
            brighter as you sing.
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

// ============================================================
// HELPERS
// ============================================================

function formatFrequencyZone(
  zone: FrequencyZone,
): string {
  switch (zone) {
    case 'low':
      return 'Low';

    case 'mid':
      return 'Mid';

    case 'high':
      return 'High';
  }
}

// ============================================================
// STYLES
// ============================================================

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

  resonanceDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },

  resonanceValue: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
  },

  resonanceSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: MUTED,
    marginTop: 2,
  },

  resonanceIcon: {
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
