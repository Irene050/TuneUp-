import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AudioContext } from 'react-native-audio-api';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';
import { measureControlledCrescendo } from '@/services/measurement/volume/controlledCrescendoDrill';
import { scoreControlledCrescendo } from '@/services/scoring/volume/controlledCrescendoDrill';

const BROWN = '#4E2F1F';
const DARK = '#5A343D';
const PINK = '#FCD6DD';
const LIGHT = '#FFF8FA';
const BORDER = '#F1DCE2';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';

const TIER = 'Beginner';
const TARGET_MIN = 40;
const TARGET_MAX = 50;
const RAMP_SECONDS = 4;
const REPETITIONS = 2;
const SMOOTHNESS_TARGET = 70;
const VOLUME_VARIANCE_PERCENT = 15;
const WINDOW_MS = 50;
const BAR_COUNT = 32;
const DBFS_MIN = -60;
const DBFS_MAX = -10;
const REFERENCE_NOTE = 'C4';
const REFERENCE_AUDIO = require('../../../../assets/audio/volume/C4_reference.wav');

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeVolume(value: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp(
    (value - DBFS_MIN) / (DBFS_MAX - DBFS_MIN),
    0,
    1,
  );
}

function targetHeight(index: number) {
  const progress = index / (BAR_COUNT - 1);
  return 0.18 + progress * 0.65;
}

function calculateLiveSmoothness(values: number[]) {
  if (values.length < 3) return 0;

  const derivatives: number[] = [];

  for (let index = 1; index < values.length; index += 1) {
    derivatives.push(values[index] - values[index - 1]);
  }

  if (derivatives.length === 0) return 0;

  const meanDerivative =
    derivatives.reduce((sum, value) => sum + value, 0) /
    derivatives.length;

  if (!Number.isFinite(meanDerivative) || meanDerivative <= 0) {
    return 0;
  }

  const derivativeVariance =
    derivatives.reduce(
      (sum, value) =>
        sum + (value - meanDerivative) ** 2,
      0,
    ) / derivatives.length;

  return Math.max(
    0,
    Math.min(
      100,
      100 -
        (derivativeVariance / meanDerivative) *
          100,
    ),
  );
}

function estimateLiveSmoothness(history: number[]) {
  if (history.length < 4) return 0;

  const values = history.map(
    (value) => DBFS_MIN + value * (DBFS_MAX - DBFS_MIN),
  );

  return Math.round(calculateLiveSmoothness(values));
}

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
      <View style={styles.targetCurve}>
        {Array.from(
          { length: BAR_COUNT },
          (_, index) => (
            <View
              key={`target-${index}`}
              style={[
                styles.targetBar,
                {
                  height: `${targetHeight(index) * 82}%`,
                },
              ]}
            />
          ),
        )}
      </View>

      <View style={styles.actualBars}>
        {actualBars.map((height, index) => (
          <View
            key={`actual-${index}`}
            style={[
              styles.actualBar,
              {
                height:
                  height > 0
                    ? `${Math.max(5, height * 82)}%`
                    : '0%',
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export default function ControlledCrescendoExercise() {
  const [phase, setPhase] = useState<
    'directions' | 'exercise' | 'results'
  >('directions');
  const [rep, setRep] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [liveFrame, setLiveFrame] = useState<LiveAudioFrame | null>(null);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);
  const [smoothness, setSmoothness] = useState(0);
  const [repResults, setRepResults] = useState<number[]>([0, 0]);
  const [rangeReached, setRangeReached] = useState(false);
  const [startDb, setStartDb] = useState(0);
  const [endDb, setEndDb] = useState(0);
  const [minDb, setMinDb] = useState(0);
  const [maxDb, setMaxDb] = useState(0);

  const finishingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const referenceBufferRef = useRef<Awaited<
    ReturnType<AudioContext['decodeAudioData']>
  > | null>(null);
  const referenceSourceRef = useRef<
    ReturnType<AudioContext['createBufferSource']> | null
  >(null);

  const playReferenceNote = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const audioContext = audioContextRef.current;

      if (!referenceBufferRef.current) {
        referenceBufferRef.current =
          await audioContext.decodeAudioData(
            REFERENCE_AUDIO,
          );
      }

      if (referenceSourceRef.current) {
        try {
          referenceSourceRef.current.stop();
        } catch {
          // Source may already be finished.
        }
        referenceSourceRef.current = null;
      }

      await audioContext.resume();

      const source =
        audioContext.createBufferSource();
      source.buffer = referenceBufferRef.current;
      source.connect(audioContext.destination);
      referenceSourceRef.current = source;
      source.start(audioContext.currentTime);
    } catch (error) {
      console.error(
        'REFERENCE AUDIO PLAYBACK ERROR:',
        error,
      );
    }
  };

  useEffect(() => {
    if (phase !== 'directions') return;
    playReferenceNote();
  }, [phase]);

  useEffect(() => {
    return () => {
      if (referenceSourceRef.current) {
        try {
          referenceSourceRef.current.stop();
        } catch {
          // Source may already be finished.
        }
        referenceSourceRef.current = null;
      }

      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }

      referenceBufferRef.current = null;
    };
  }, []);

  const {
    startRecording,
    stopRecording,
    isRecording,
  } = useAudioRecorder({
    onFrame: (frame) => {
      if (phase !== 'exercise') return;

      setLiveFrame(frame);

      const normalized = normalizeVolume(frame.volume);

      setLiveHistory((previous) => {
        const next = [...previous, normalized];
        if (next.length > BAR_COUNT) {
          return next.slice(next.length - BAR_COUNT);
        }
        return next;
      });
    },
    onStop: (samples, sampleRate) => {
      const measurement = measureControlledCrescendo(
        samples,
        sampleRate,
        {
          windowMs: WINDOW_MS,
          targetRange: [TARGET_MIN, TARGET_MAX],
          expectedDurationSeconds: RAMP_SECONDS,
          repetitions: REPETITIONS,
        },
      );

      const result = scoreControlledCrescendo(
        measurement,
        {
          passingScore: SMOOTHNESS_TARGET,
        },
      );

      setSmoothness(result.overallScore);
      setRepResults(
        measurement.repetitionSmoothness.map((value) =>
          Math.round(value),
        ),
      );
      setRangeReached(result.targetReached);
      setStartDb(
        Math.round(measurement.startDb * 10) / 10,
      );
      setEndDb(
        Math.round(measurement.endDb * 10) / 10,
      );
      setMinDb(
        Math.round(measurement.minDb * 10) / 10,
      );
      setMaxDb(
        Math.round(measurement.maxDb * 10) / 10,
      );

      setPhase('results');
      setSeconds(0);
      setRep(1);
      setLiveFrame(null);
      setLiveHistory([]);
      finishingRef.current = false;
    },
  });

  useEffect(() => {
    if (phase !== 'exercise') return;

    const interval = setInterval(() => {
      setSeconds((previous) => {
        if (previous >= RAMP_SECONDS - 1) {
          if (rep < REPETITIONS) {
            setRep((current) => current + 1);
            setLiveHistory([]);
            return 0;
          }

          if (!finishingRef.current) {
            finishingRef.current = true;
            stopRecording().catch((error) => {
              console.error(
                'Unable to finish recording:',
                error,
              );
              finishingRef.current = false;
            });
          }

          return previous;
        }

        return previous + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, rep, stopRecording]);

  const liveSmoothness = estimateLiveSmoothness(liveHistory);

  const instruction = useMemo(() => {
    if (seconds < 1) {
      return {
        title: 'START SOFT',
        subtitle: 'Begin with a gentle voice',
      };
    }

    if (seconds < RAMP_SECONDS - 1) {
      return {
        title: 'CRESCENDO',
        subtitle: 'Gradually increase your volume',
      };
    }

    return {
      title: 'REACH TARGET',
      subtitle: 'Finish at the target loudness',
    };
  }, [seconds]);

  const startExercise = async () => {
    setRep(1);
    setSeconds(0);
    setSmoothness(0);
    setRepResults([0, 0]);
    setRangeReached(false);
    setStartDb(0);
    setEndDb(0);
    setMinDb(0);
    setMaxDb(0);
    setLiveFrame(null);
    setLiveHistory([]);
    finishingRef.current = false;
    setPhase('exercise');

    try {
      await startRecording();
    } catch (error) {
      console.error(
        'Unable to start recording:',
        error,
      );
      setPhase('directions');
    }
  };

  const tryAgain = () => {
    startExercise().catch((error) => {
      console.error(
        'Unable to restart recording:',
        error,
      );
    });
  };

  if (phase === 'directions') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.topBar}>
          <Pressable
            style={styles.back}
            onPress={() => router.back()}
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={BROWN}
            />
          </Pressable>

          <Text style={styles.topTitle}>
            Controlled Crescendo
          </Text>

          <View style={styles.back} />
        </View>

        <View style={styles.directionsBody}>
          <View style={styles.exerciseIcon}>
            <Ionicons
              name="volume-high-outline"
              size={31}
              color={BROWN}
            />
          </View>

          <Text style={styles.componentText}>
            VOLUME CONTROL
          </Text>

          <Text style={styles.mainTitle}>
            Controlled Crescendo
          </Text>

          <Text style={styles.mainSubtitle}>
            Gradually increase your volume smoothly.
          </Text>

          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>
              Follow this crescendo
            </Text>

            <View style={styles.previewVisualizer}>
              {Array.from(
                { length: BAR_COUNT },
                (_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.previewBar,
                      {
                        height: `${
                          targetHeight(index) * 80
                        }%`,
                      },
                    ]}
                  />
                ),
              )}
            </View>

            <View style={styles.previewLabels}>
              <Text style={styles.previewLabel}>Soft</Text>
              <Text style={styles.previewLabel}>Loud</Text>
            </View>
          </View>

          <View style={styles.referenceNoteCard}>
            <View style={styles.referenceNoteHeader}>
              <View style={styles.referenceNoteIcon}>
                <Ionicons
                  name="musical-note"
                  size={17}
                  color={BROWN}
                />
              </View>

              <View style={styles.referenceNoteText}>
                <Text style={styles.referenceNoteLabel}>
                  REFERENCE NOTE
                </Text>
                <Text style={styles.referenceNoteValue}>
                  {REFERENCE_NOTE}
                </Text>
              </View>
            </View>

            <Text style={styles.referenceNoteDescription}>
              Listen to the note first. During the
              exercise, sing the same note while
              gradually increasing your volume.
            </Text>

            <TouchableOpacity
              style={styles.referenceNoteButton}
              onPress={playReferenceNote}
              activeOpacity={0.85}
            >
              <Ionicons
                name="play"
                size={15}
                color={WHITE}
              />
              <Text style={styles.referenceNoteButtonText}>
                Play Reference Note
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.instructions}>
            <Text style={styles.sectionTitle}>
              How to do it
            </Text>

            <Text style={styles.instructionLine}>
              <Text style={styles.bold}>1. </Text>
              Begin with a soft voice.
            </Text>
            <Text style={styles.instructionLine}>
              <Text style={styles.bold}>2. </Text>
              Gradually increase your volume.
            </Text>
            <Text style={styles.instructionLine}>
              <Text style={styles.bold}>3. </Text>
              Keep the increase smooth and even.
            </Text>
            <Text style={styles.instructionLine}>
              <Text style={styles.bold}>4. </Text>
              Reach the target volume.
            </Text>
            <Text style={styles.instructionLine}>
              <Text style={styles.bold}>5. </Text>
              Repeat the exercise twice.
            </Text>
          </View>

          <View style={styles.targetSimple}>
            <View>
              <Text style={styles.targetSimpleLabel}>
                TARGET
              </Text>
              <Text style={styles.targetSimpleValue}>
                {TARGET_MIN}–{TARGET_MAX} dB
              </Text>
            </View>

            <Text style={styles.targetSimpleSub}>
              {RAMP_SECONDS}s crescendo • {REPETITIONS}{' '}
              repetitions
            </Text>
          </View>

          <TouchableOpacity
            style={styles.startButton}
            onPress={startExercise}
            activeOpacity={0.85}
          >
            <Ionicons
              name="play"
              size={18}
              color={WHITE}
            />
            <Text style={styles.startButtonText}>
              Start Exercise
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'exercise') {
    const progress = Math.min(
      seconds / RAMP_SECONDS,
      1,
    );

    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.topBar}>
          <Pressable
            style={styles.back}
            onPress={async () => {
              if (isRecording) {
                await stopRecording();
              }
              router.back();
            }}
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={BROWN}
            />
          </Pressable>

          <Text style={styles.topTitle}>
            Controlled Crescendo
          </Text>

          <View style={styles.liveStatus}>
            <View style={styles.liveCircle} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </View>

        <View style={styles.actualBody}>
          <View style={styles.exerciseReference}>
            <Ionicons
              name="musical-note-outline"
              size={14}
              color={BROWN}
            />
            <Text style={styles.exerciseReferenceText}>
              Sing {REFERENCE_NOTE} while following the
              crescendo
            </Text>
            <TouchableOpacity
              style={styles.exerciseReferenceButton}
              onPress={playReferenceNote}
              activeOpacity={0.85}
            >
              <Ionicons
                name="play"
                size={12}
                color={BROWN}
              />
              <Text
                style={styles.exerciseReferenceButtonText}
              >
                Replay
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionArea}>
            <Text style={styles.actionTitle}>
              {instruction.title}
            </Text>
            <Text style={styles.actionSubtitle}>
              {instruction.subtitle}
            </Text>
          </View>

          <View style={styles.mainVisualizerCard}>
            <View style={styles.visualizerHeader}>
              <View>
                <Text style={styles.visualizerTitle}>
                  Your Performance
                </Text>
                <Text style={styles.visualizerSub}>
                  Match the target crescendo
                </Text>
              </View>

              <View style={styles.micCircle}>
                <Ionicons
                  name="mic"
                  size={18}
                  color={BROWN}
                />
              </View>
            </View>

            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={styles.referenceDot} />
                <Text style={styles.legendText}>
                  Target
                </Text>
              </View>
              <View style={styles.legendItem}>
                <View style={styles.actualDot} />
                <Text style={styles.legendText}>
                  Your voice
                </Text>
              </View>
            </View>

            <VolumeVisualizer
              liveHistory={liveHistory}
            />

            <View style={styles.visualizerLabels}>
              <Text style={styles.visualizerLabel}>
                SOFT
              </Text>
              <Text style={styles.visualizerLabel}>
                LOUD
              </Text>
            </View>
          </View>

          <View style={styles.voiceRow}>
            <View style={styles.voiceLeft}>
              <View style={styles.smallMic}>
                <Ionicons
                  name="mic-outline"
                  size={18}
                  color={BROWN}
                />
              </View>

              <View>
                <Text style={styles.voiceTitle}>
                  Your voice
                </Text>
                <Text style={styles.voiceSub}>
                  {liveFrame
                    ? 'Voice detected'
                    : 'Listening...'}
                </Text>
              </View>
            </View>

            <Text style={styles.voiceValue}>
              {liveFrame
                ? liveFrame.volume.toFixed(1)
                : '--'}
              <Text style={styles.voiceUnit}>
                {' '}
                dBFS
              </Text>
            </Text>
          </View>

          <View style={styles.targetRow}>
            <View>
              <Text style={styles.targetRowLabel}>
                TARGET
              </Text>
              <Text style={styles.targetRowValue}>
                {TARGET_MIN}–{TARGET_MAX} dB
              </Text>
            </View>

            <Text style={styles.pattern}>
              Soft → Loud
            </Text>
          </View>

          <View style={styles.sessionRow}>
            <View style={styles.sessionPart}>
              <Text style={styles.sessionLabel}>
                REPETITION
              </Text>
              <Text style={styles.sessionValue}>
                {rep} / {REPETITIONS}
              </Text>
            </View>

            <View style={styles.sessionDivider} />

            <View style={styles.sessionPart}>
              <Text style={styles.sessionLabel}>
                TIME
              </Text>
              <Text style={styles.sessionValue}>
                0:{String(seconds).padStart(2, '0')}
              </Text>
            </View>

            <View style={styles.sessionDivider} />

            <View style={styles.sessionPart}>
              <Text style={styles.sessionLabel}>
                SMOOTHNESS
              </Text>
              <Text style={styles.sessionValue}>
                {liveSmoothness}%
              </Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressValue,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>

          <TouchableOpacity
            style={styles.stopButton}
            onPress={async () => {
              if (isRecording) {
                await stopRecording();
              }
              setPhase('directions');
              setSeconds(0);
              setRep(1);
              setLiveFrame(null);
              setLiveHistory([]);
            }}
            activeOpacity={0.85}
          >
            <Ionicons
              name="stop"
              size={15}
              color={BROWN}
            />
            <Text style={styles.stopText}>
              Stop Exercise
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const passed = smoothness >= SMOOTHNESS_TARGET;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable
          style={styles.back}
          onPress={() => router.back()}
        >
          <Ionicons
            name="arrow-back"
            size={20}
            color={BROWN}
          />
        </Pressable>

        <Text style={styles.topTitle}>Results</Text>
        <View style={styles.back} />
      </View>

      <View style={styles.resultsBody}>
        <View
          style={[
            styles.resultIcon,
            passed
              ? styles.resultIconPassed
              : styles.resultIconNeedsPractice,
          ]}
        >
          <Ionicons
            name={
              passed
                ? 'checkmark-outline'
                : 'refresh-outline'
            }
            size={30}
            color={BROWN}
          />
        </View>

        <Text style={styles.resultSmall}>
          CONTROLLED CRESCENDO
        </Text>

        <Text style={styles.resultTitle}>
          {passed
            ? 'Exercise Passed'
            : 'Needs More Practice'}
        </Text>

        <Text style={styles.resultSub}>
          {passed
            ? 'Great job! Your crescendo was smooth and controlled.'
            : 'Keep practicing to make your volume increase smoother.'}
        </Text>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>
            SMOOTHNESS SCORE
          </Text>
          <Text style={styles.score}>
            {smoothness}%
          </Text>
          <View style={styles.scoreTrack}>
            <View
              style={[
                styles.scoreFill,
                { width: `${smoothness}%` },
              ]}
            />
          </View>
        </View>

        <View style={styles.resultDetails}>
          <ResultItem
            label="Repetition 1"
            value={`${repResults[0]}%`}
          />
          <ResultItem
            label="Repetition 2"
            value={`${repResults[1]}%`}
          />
          <ResultItem
            label="Target Reached"
            value={rangeReached ? 'Yes' : 'No'}
          />
          <ResultItem
            label="Observed Range"
            value={`${minDb}–${maxDb} dB`}
          />
          <ResultItem
            label="Start → End"
            value={`${startDb} → ${endDb} dB`}
          />
          <ResultItem
            label="Target Smoothness"
            value={`${SMOOTHNESS_TARGET}%`}
          />
        </View>

        {passed ? (
          <>
            <TouchableOpacity
              style={styles.startButton}
              onPress={() =>
                router.replace('/exercises/volume')
              }
              activeOpacity={0.85}
            >
              <Ionicons
                name="arrow-forward"
                size={17}
                color={WHITE}
              />
              <Text style={styles.startButtonText}>
                Next Exercise
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={tryAgain}
              activeOpacity={0.85}
            >
              <Ionicons
                name="refresh"
                size={16}
                color={BROWN}
              />
              <Text style={styles.secondaryButtonText}>
                Try Again
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.startButton}
              onPress={tryAgain}
              activeOpacity={0.85}
            >
              <Ionicons
                name="refresh"
                size={17}
                color={WHITE}
              />
              <Text style={styles.startButtonText}>
                Try Again
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() =>
                router.replace('/exercises/volume')
              }
              activeOpacity={0.85}
            >
              <Ionicons
                name="arrow-back"
                size={16}
                color={BROWN}
              />
              <Text style={styles.secondaryButtonText}>
                Back to Exercises
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function ResultItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.resultItem}>
      <Text style={styles.resultItemLabel}>{label}</Text>
      <Text style={styles.resultItemValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },
  topBar: {
    height: 56,
    paddingHorizontal: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 15,
    color: BROWN,
  },
  liveStatus: {
    height: 30,
    paddingHorizontal: 9,
    borderRadius: 16,
    backgroundColor: LIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveCircle: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  liveText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    color: BROWN,
  },
  directionsBody: {
    flex: 1,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  exerciseIcon: {
    width: 65,
    height: 65,
    borderRadius: 33,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 7,
  },
  componentText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    letterSpacing: 1.2,
    color: ACCENT,
    marginTop: 10,
  },
  mainTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    marginTop: 2,
  },
  mainSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  previewCard: {
    width: '100%',
    backgroundColor: LIGHT,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  previewTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 12,
    color: BROWN,
  },
  previewVisualizer: {
    height: 65,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 7,
    overflow: 'hidden',
  },
  previewBar: {
    flex: 1,
    maxWidth: 7,
    backgroundColor: '#EAA5B6',
    borderRadius: 4,
  },
  previewLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  previewLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,
  },
  referenceNoteCard: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    marginTop: 10,
  },
  referenceNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  referenceNoteIcon: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  referenceNoteText: {
    flex: 1,
  },
  referenceNoteLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 7,
    letterSpacing: 1,
    color: ACCENT,
  },
  referenceNoteValue: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginTop: 1,
  },
  referenceNoteDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    lineHeight: 15,
    color: MUTED,
    marginTop: 8,
  },
  referenceNoteButton: {
    height: 38,
    borderRadius: 20,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 9,
  },
  referenceNoteButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    color: WHITE,
  },
  instructions: {
    width: '100%',
    marginTop: 12,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginBottom: 7,
  },
  instructionLine: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: BROWN,
    lineHeight: 19,
  },
  bold: {
    fontFamily: 'FredokaBold',
  },
  targetSimple: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 11,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  targetSimpleLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    letterSpacing: 1,
    color: ACCENT,
  },
  targetSimpleValue: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginTop: 1,
  },
  targetSimpleSub: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,
    marginLeft: 'auto',
  },
  startButton: {
    width: '100%',
    height: 52,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 12,
  },
  startButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 14,
    color: WHITE,
  },
  exerciseReference: {
    minHeight: 38,
    borderRadius: 13,
    backgroundColor: LIGHT,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  exerciseReferenceText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: BROWN,
    marginLeft: 6,
  },
  exerciseReferenceButton: {
    height: 27,
    paddingHorizontal: 9,
    borderRadius: 14,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  exerciseReferenceButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    color: BROWN,
  },
  actionArea: {
    alignItems: 'center',
    paddingVertical: 5,
  },
  actionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 23,
    color: BROWN,
  },
  actionSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 1,
  },
  actualBody: {
    flex: 1,
    paddingHorizontal: 15,
    paddingTop: 2,
    paddingBottom: 13,
  },
  mainVisualizerCard: {
    width: '100%',
    flex: 1,
    minHeight: 275,
    maxHeight: 315,
    backgroundColor: WHITE,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 8,
  },
  visualizerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  visualizerTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },
  visualizerSub: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    color: MUTED,
    marginTop: 2,
  },
  micCircle: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legend: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 7,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  referenceDot: {
    width: 16,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#EAA5B6',
  },
  actualDot: {
    width: 16,
    height: 3,
    borderRadius: 2,
    backgroundColor: BROWN,
  },
  legendText: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,
  },
  visualizer: {
    flex: 1,
    marginTop: 8,
    borderRadius: 15,
    backgroundColor: '#FFFAFB',
    borderWidth: 1,
    borderColor: '#F4E5E9',
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
  },
  targetCurve: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  targetBar: {
    flex: 1,
    backgroundColor: '#F1B7C5',
    borderRadius: 5,
    opacity: 0.6,
  },
  actualBars: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  actualBar: {
    flex: 1,
    maxWidth: 8,
    backgroundColor: BROWN,
    borderRadius: 5,
  },
  visualizerLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  visualizerLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    color: MUTED,
  },
  voiceRow: {
    height: 52,
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: LIGHT,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  voiceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  smallMic: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  voiceTitle: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: BROWN,
  },
  voiceSub: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,
    marginTop: 1,
  },
  voiceValue: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
  },
  voiceUnit: {
    fontFamily: 'FredokaRegular',
    fontSize: 7,
    color: MUTED,
  },
  targetRow: {
    height: 47,
    marginTop: 7,
    paddingHorizontal: 13,
    borderRadius: 15,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  targetRowLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 7,
    letterSpacing: 1,
    color: ACCENT,
  },
  targetRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    marginTop: 1,
  },
  pattern: {
    fontFamily: 'FredokaRegular',
    fontSize: 8,
    color: MUTED,
  },
  sessionRow: {
    height: 51,
    marginTop: 7,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionPart: {
    flex: 1,
    alignItems: 'center',
  },
  sessionLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 7,
    color: MUTED,
  },
  sessionValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    marginTop: 2,
  },
  sessionDivider: {
    width: 1,
    height: 30,
    backgroundColor: BORDER,
  },
  progressTrack: {
    height: 5,
    marginTop: 7,
    backgroundColor: '#F3E4E8',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressValue: {
    height: '100%',
    backgroundColor: ACCENT,
    borderRadius: 3,
  },
  stopButton: {
    height: 45,
    marginTop: 8,
    borderRadius: 23,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  stopText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: BROWN,
  },
  resultsBody: {
    flex: 1,
    paddingHorizontal: 21,
    alignItems: 'center',
  },
  resultIcon: {
    width: 65,
    height: 65,
    borderRadius: 33,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15,
  },
  resultIconPassed: {
    backgroundColor: '#FCD6DD',
  },
  resultIconNeedsPractice: {
    backgroundColor: '#FFF0F3',
  },
  resultSmall: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 9,
    letterSpacing: 1.2,
    color: ACCENT,
    marginTop: 10,
  },
  resultTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    marginTop: 2,
  },
  resultSub: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    marginTop: 3,
    textAlign: 'center',
  },
  scoreCard: {
    width: '100%',
    backgroundColor: LIGHT,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    alignItems: 'center',
    marginTop: 18,
  },
  scoreLabel: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 8,
    letterSpacing: 1,
    color: MUTED,
  },
  score: {
    fontFamily: 'FredokaBold',
    fontSize: 43,
    color: BROWN,
    marginTop: 1,
  },
  scoreTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F1D6DC',
    overflow: 'hidden',
    marginTop: 7,
  },
  scoreFill: {
    height: '100%',
    backgroundColor: BROWN,
    borderRadius: 3,
  },
  resultDetails: {
    width: '100%',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 15,
    marginTop: 10,
  },
  resultItem: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F5E9EC',
  },
  resultItemLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },
  resultItemValue: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 10,
    color: BROWN,
  },
  secondaryButton: {
    width: '100%',
    height: 45,
    borderRadius: 23,
    backgroundColor: PINK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
  },
  secondaryButtonText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 11,
    color: BROWN,
  },
});
