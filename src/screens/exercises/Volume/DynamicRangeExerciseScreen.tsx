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
import { measureDynamicRange } from '@/services/measurement/volume/dynamicRangeExercise';
import { scoreDynamicRange } from '@/services/scoring/volume/dynamicRangeExercise';

const TARGET_MIN = 40;
const TARGET_MAX = 55;
const RAMP_SECONDS = 3;
const REPETITIONS = 2;

const BROWN = '#4E2F1F';
const DARK = '#5A343D';
const PINK = '#FCD6DD';
const LIGHT = '#FFF8FA';
const PALE = '#FFF0F3';
const BORDER = '#F1DCE2';
const ACCENT = '#D86C89';
const MUTED = '#9A817D';
const WHITE = '#FFFFFF';

const BAR_COUNT = 32;

type Phase = 'directions' | 'exercise' | 'results';

const DBFS_MIN = -60;
const DBFS_MAX = -10;

const REFERENCE_NOTE = 'C4';
const REFERENCE_AUDIO = require('../../../../assets/audio/volume/C4_reference.wav');

function normalizeVolume(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      1,
      (value - DBFS_MIN) /
        (DBFS_MAX - DBFS_MIN)
    )
  );
}

/*
 * Soft → Loud → Soft
 */
function referenceHeight(index: number) {
  const middle =
    (BAR_COUNT - 1) / 2;

  const distance =
    Math.abs(index - middle) /
    middle;

  return 0.18 + (1 - distance) * 0.72;
}

/*
 * ========================================================
 * VOLUME VISUALIZER
 * ========================================================
 */

function VolumeVisualizer({
  liveHistory,
}: {
  liveHistory: number[];
}) {
  const referenceBars = useMemo(
    () =>
      Array.from(
        { length: BAR_COUNT },
        (_, index) =>
          referenceHeight(index)
      ),
    []
  );

  /*
   * IMPORTANT:
   * The live history is displayed LEFT → RIGHT.
   *
   * Oldest data = left
   * Newest data = right
   */
  const actualBars = Array.from(
    { length: BAR_COUNT },
    (_, index) => {
      if (
        index < liveHistory.length
      ) {
        return liveHistory[index];
      }

      return 0;
    }
  );

  return (
    <View style={styles.visualizer}>
      {/* Target area */}
      <View
        style={styles.targetBand}
      />

      {/* Reference */}
      <View
        style={styles.referenceBars}
      >
        {referenceBars.map(
          (height, index) => (
            <View
              key={`ref-${index}`}
              style={[
                styles.referenceBar,
                {
                  height:
                    `${height * 82}%`,
                },
              ]}
            />
          )
        )}
      </View>

      {/* Actual voice */}
      <View
        style={styles.actualBars}
      >
        {actualBars.map(
          (height, index) => (
            <View
              key={`actual-${index}`}
              style={[
                styles.actualBar,
                {
                  height:
                    height > 0
                      ? `${Math.max(
                          5,
                          height * 82
                        )}%`
                      : '0%',
                },
              ]}
            />
          )
        )}
      </View>

      {/* Center line */}
      <View
        style={styles.centerLine}
      />

      {/* Target marker */}
      <View
        style={styles.targetMarker}
      >
        <Text
          style={
            styles.targetMarkerText
          }
        >
          TARGET
        </Text>
      </View>
    </View>
  );
}

/*
 * ========================================================
 * MAIN
 * ========================================================
 */

export default function DynamicRangeExercise() {
  const [phase, setPhase] =
    useState<Phase>('directions');

  const [rep, setRep] = useState(1);

  const [seconds, setSeconds] =
    useState(0);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(
      null
    );

  const [liveHistory, setLiveHistory] =
    useState<number[]>([]);

  const [score, setScore] =
    useState(0);

  const [rangeAccuracy, setRangeAccuracy] =
    useState(0);

  const [rampConsistency, setRampConsistency] =
    useState(0);

  const finishingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const referenceBufferRef = useRef<Awaited<ReturnType<AudioContext['decodeAudioData']>> | null>(null);
  const referenceSourceRef = useRef<ReturnType<AudioContext['createBufferSource']> | null>(null);

  const playReferenceNote = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const audioContext = audioContextRef.current;

      if (!referenceBufferRef.current) {
        referenceBufferRef.current =
          await audioContext.decodeAudioData(
            REFERENCE_AUDIO
          );
      }

      if (referenceSourceRef.current) {
        try {
          referenceSourceRef.current.stop();
        } catch { 
        }
        referenceSourceRef.current = null;
      }

      await audioContext.resume();

      const source =
        audioContext.createBufferSource();

      source.buffer = referenceBufferRef.current;
      source.connect(audioContext.destination);
      source.start(audioContext.currentTime);

      referenceSourceRef.current = source;
    } catch (error) {
      console.error(
        'Unable to play reference note:',
        error
      );
    }
  };

  useEffect(() => {
    if (phase !== 'directions') {
      return;
    }

    playReferenceNote();
  }, [phase]);

  useEffect(() => {
    return () => {
      if (referenceSourceRef.current) {
        try {
          referenceSourceRef.current.stop();
        } catch {
          // The source may already have finished.
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
      if (phase !== 'exercise') {
        return;
      }

      setLiveFrame(frame);

      const normalized =
        normalizeVolume(
          frame.volume
        );

      setLiveHistory(
        (previous) => {
          const next = [
            ...previous,
            normalized,
          ];

          
          if (
            next.length >
            BAR_COUNT
          ) {
            return next.slice(
              next.length -
                BAR_COUNT
            );
          }

          return next;
        }
      );
    },

    onStop: (samples, sampleRate) => {
      const measurement = measureDynamicRange(
        samples,
        sampleRate,
        {
          windowMs: 50,
          targetRange: [TARGET_MIN, TARGET_MAX],
          expectedDurationSeconds:
            RAMP_SECONDS * 3,
        }
      );

      const result = scoreDynamicRange(
        measurement
      );

      setRangeAccuracy(
        result.rangeAccuracy
      );

      setRampConsistency(
        result.rampConsistency
      );

      setScore(
        result.overallScore
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
    if (phase !== 'exercise') {
      return;
    }

    const interval =
      setInterval(() => {
        setSeconds(
          (previous) => {
            if (
              previous >=
              RAMP_SECONDS * 3 - 1
            ) {
              if (
                rep <
                REPETITIONS
              ) {
                setRep(
                  (current) =>
                    current + 1
                );

                setLiveHistory(
                  []
                );

                return 0;
              }

              if (!finishingRef.current) {
                finishingRef.current = true;

                stopRecording().catch(
                  (error) => {
                    console.error(
                      'Unable to finish recording:',
                      error
                    );

                    finishingRef.current = false;
                  }
                );
              }

              return previous;
            }

            return previous + 1;
          }
        );
      }, 1000);

    return () =>
      clearInterval(interval);
  }, [
    phase,
    rep,
    stopRecording,
  ]);

  const instruction =
    useMemo(() => {
      if (
        seconds <
        RAMP_SECONDS
      ) {
        return {
          title: 'SOFT → LOUD',
          subtitle:
            'Gradually increase your volume',
        };
      }

      if (
        seconds <
        RAMP_SECONDS * 2
      ) {
        return {
          title: 'LOUD',
          subtitle:
            'Reach your loud target',
        };
      }

      return {
        title: 'LOUD → SOFT',
        subtitle:
          'Gradually decrease your volume',
      };
    }, [seconds]);

  const startExercise =
    async () => {
      setRep(1);
      setSeconds(0);
      setScore(0);
      setRangeAccuracy(0);
      setRampConsistency(0);
      finishingRef.current = false;
      setLiveFrame(null);
      setLiveHistory([]);
      setPhase('exercise');

      try {
        await startRecording();
      } catch (error) {
        console.error(
          'Unable to start recording:',
          error
        );

        setPhase(
          'directions'
        );
      }
    };

  const tryAgain = () => {
    setRep(1);
    setSeconds(0);
    setScore(0);
    setLiveFrame(null);
    setLiveHistory([]);
    setPhase('exercise');

    startRecording().catch(
      (error) => {
        console.error(
          'Unable to restart recording:',
          error
        );

        setPhase(
          'directions'
        );
      }
    );
  };

  /*
   * ========================================================
   * DIRECTIONS
   * ========================================================
   */

  if (phase === 'directions') {
    return (
      <SafeAreaView
        style={styles.screen}
      >
        <View style={styles.topBar}>
          <Pressable
            style={styles.back}
            onPress={() =>
              router.back()
            }
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={BROWN}
            />
          </Pressable>

          <Text
            style={styles.topTitle}
          >
            Dynamic Range
          </Text>

          <View
            style={styles.back}
          />
        </View>

        <View
          style={
            styles.directionsBody
          }
        >
          <View
            style={
              styles.exerciseIcon
            }
          >
            <Ionicons
              name="volume-high-outline"
              size={31}
              color={BROWN}
            />
          </View>

          <Text
            style={
              styles.componentText
            }
          >
            VOLUME CONTROL
          </Text>

          <Text
            style={
              styles.mainTitle
            }
          >
            Dynamic Range
          </Text>

          <Text
            style={
              styles.mainSubtitle
            }
          >
            Practice changing your
            volume smoothly.
          </Text>

          {/* REFERENCE PREVIEW */}
          <View
            style={
              styles.previewCard
            }
          >
            <Text
              style={
                styles.previewTitle
              }
            >
              Follow this pattern
            </Text>

            <View
              style={
                styles.previewVisualizer
              }
            >
              {Array.from(
                {
                  length:
                    BAR_COUNT,
                },
                (_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.previewBar,
                      {
                        height: `${
                          referenceHeight(
                            index
                          ) * 80
                        }%`,
                      },
                    ]}
                  />
                )
              )}
            </View>

            <View
              style={
                styles.previewLabels
              }
            >
              <Text
                style={
                  styles.previewLabel
                }
              >
                Soft
              </Text>

              <Text
                style={
                  styles.previewLabel
                }
              >
                Loud
              </Text>

              <Text
                style={
                  styles.previewLabel
                }
              >
                Soft
              </Text>
            </View>
          </View>

          {/* REFERENCE NOTE */}
          <View
            style={
              styles.referenceNoteCard
            }
          >
            <View
              style={
                styles.referenceNoteHeader
              }
            >
              <View
                style={
                  styles.referenceNoteIcon
                }
              >
                <Ionicons
                  name="musical-note"
                  size={17}
                  color={BROWN}
                />
              </View>

              <View
                style={
                  styles.referenceNoteText
                }
              >
                <Text
                  style={
                    styles.referenceNoteLabel
                  }
                >
                  REFERENCE NOTE
                </Text>

                <Text
                  style={
                    styles.referenceNoteValue
                  }
                >
                  {REFERENCE_NOTE}
                </Text>
              </View>
            </View>

            <Text
              style={
                styles.referenceNoteDescription
              }
            >
              Listen to the note first. During the exercise,
              sing the same note while following the
              Soft → Loud → Soft pattern.
            </Text>

            <TouchableOpacity
              style={
                styles.referenceNoteButton
              }
              onPress={
                playReferenceNote
              }
              activeOpacity={0.85}
            >
              <Ionicons
                name="play"
                size={15}
                color={WHITE}
              />

              <Text
                style={
                  styles.referenceNoteButtonText
                }
              >
                Play Reference Note
              </Text>
            </TouchableOpacity>
          </View>

          {/* DIRECTIONS */}
          <View
            style={
              styles.instructions
            }
          >
            <Text
              style={
                styles.sectionTitle
              }
            >
              How to do it
            </Text>

            <Text
              style={
                styles.instructionLine
              }
            >
              <Text
                style={
                  styles.bold
                }
              >
                1.{' '}
              </Text>
              Start with a soft voice.
            </Text>

            <Text
              style={
                styles.instructionLine
              }
            >
              <Text
                style={
                  styles.bold
                }
              >
                2.{' '}
              </Text>
              Gradually become louder.
            </Text>

            <Text
              style={
                styles.instructionLine
              }
            >
              <Text
                style={
                  styles.bold
                }
              >
                3.{' '}
              </Text>
              Reach the loud target.
            </Text>

            <Text
              style={
                styles.instructionLine
              }
            >
              <Text
                style={
                  styles.bold
                }
              >
                4.{' '}
              </Text>
              Gradually return to soft.
            </Text>
          </View>

          {/* TARGET */}
          <View
            style={
              styles.targetSimple
            }
          >
            <Text
              style={
                styles.targetSimpleLabel
              }
            >
              TARGET
            </Text>

            <Text
              style={
                styles.targetSimpleValue
              }
            >
              {TARGET_MIN}–{TARGET_MAX} dB
            </Text>

            <Text
              style={
                styles.targetSimpleSub
              }
            >
              {RAMP_SECONDS}s ramp •{' '}
              {REPETITIONS} repetitions
            </Text>
          </View>

          <TouchableOpacity
            style={
              styles.startButton
            }
            onPress={
              startExercise
            }
            activeOpacity={0.85}
          >
            <Ionicons
              name="play"
              size={18}
              color={WHITE}
            />

            <Text
              style={
                styles.startButtonText
              }
            >
              Start Exercise
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  /*
   * ========================================================
   * ACTUAL EXERCISE
   * ========================================================
   */

  if (phase === 'exercise') {
    const progress =
      Math.min(
        seconds /
          (RAMP_SECONDS * 3),
        1
      );

    return (
      <SafeAreaView
        style={styles.screen}
      >
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

          <Text
            style={styles.topTitle}
          >
            Dynamic Range
          </Text>

          <View
            style={
              styles.liveStatus
            }
          >
            <View
              style={
                styles.liveCircle
              }
            />

            <Text
              style={styles.liveText}
            >
              LIVE
            </Text>
          </View>
        </View>

        <View
          style={
            styles.actualBody
          }
        >
          {/* REFERENCE NOTE */}
          <View
            style={
              styles.exerciseReference
            }
          >
            <Ionicons
              name="musical-note-outline"
              size={14}
              color={BROWN}
            />

            <Text
              style={
                styles.exerciseReferenceText
              }
            >
              Sing {REFERENCE_NOTE} while following the
              volume pattern
            </Text>

            <TouchableOpacity
              style={
                styles.exerciseReferenceButton
              }
              onPress={
                playReferenceNote
              }
              activeOpacity={0.85}
            >
              <Ionicons
                name="play"
                size={12}
                color={BROWN}
              />

              <Text
                style={
                  styles.exerciseReferenceButtonText
                }
              >
                Replay
              </Text>
            </TouchableOpacity>
          </View>

          {/* CURRENT ACTION */}
          <View
            style={
              styles.actionArea
            }
          >
            <Text
              style={
                styles.actionTitle
              }
            >
              {instruction.title}
            </Text>

            <Text
              style={
                styles.actionSubtitle
              }
            >
              {instruction.subtitle}
            </Text>
          </View>

          {/* MAIN VISUALIZER */}
          <View
            style={
              styles.mainVisualizerCard
            }
          >
            <View
              style={
                styles.visualizerHeader
              }
            >
              <View>
                <Text
                  style={
                    styles.visualizerTitle
                  }
                >
                  Your Performance
                </Text>

                <Text
                  style={
                    styles.visualizerSub
                  }
                >
                  Follow the reference
                </Text>
              </View>

              <View
                style={
                  styles.micCircle
                }
              >
                <Ionicons
                  name="mic"
                  size={18}
                  color={BROWN}
                />
              </View>
            </View>

            {/* LEGEND */}
            <View
              style={
                styles.legend
              }
            >
              <View
                style={
                  styles.legendItem
                }
              >
                <View
                  style={
                    styles.referenceDot
                  }
                />

                <Text
                  style={
                    styles.legendText
                  }
                >
                  Reference
                </Text>
              </View>

              <View
                style={
                  styles.legendItem
                }
              >
                <View
                  style={
                    styles.actualDot
                  }
                />

                <Text
                  style={
                    styles.legendText
                  }
                >
                  Your voice
                </Text>
              </View>
            </View>

            <VolumeVisualizer
              liveHistory={
                liveHistory
              }
            />

            <View
              style={
                styles.visualizerLabels
              }
            >
              <Text
                style={
                  styles.visualizerLabel
                }
              >
                SOFT
              </Text>

              <Text
                style={
                  styles.visualizerLabel
                }
              >
                LOUD
              </Text>

              <Text
                style={
                  styles.visualizerLabel
                }
              >
                SOFT
              </Text>
            </View>
          </View>

          {/* VOICE */}
          <View
            style={
              styles.voiceRow
            }
          >
            <View
              style={
                styles.voiceLeft
              }
            >
              <View
                style={
                  styles.smallMic
                }
              >
                <Ionicons
                  name="mic-outline"
                  size={18}
                  color={BROWN}
                />
              </View>

              <View>
                <Text
                  style={
                    styles.voiceTitle
                  }
                >
                  Your voice
                </Text>

                <Text
                  style={
                    styles.voiceSub
                  }
                >
                  {liveFrame
                    ? 'Voice detected'
                    : 'Listening...'}
                </Text>
              </View>
            </View>

            <Text
              style={
                styles.voiceValue
              }
            >
              {liveFrame
                ? liveFrame.volume.toFixed(
                    1
                  )
                : '--'}

              <Text
                style={
                  styles.voiceUnit
                }
              >
                {' '}
                dBFS
              </Text>
            </Text>
          </View>

          {/* TARGET */}
          <View
            style={
              styles.targetRow
            }
          >
            <View>
              <Text
                style={
                  styles.targetRowLabel
                }
              >
                TARGET
              </Text>

              <Text
                style={
                  styles.targetRowValue
                }
              >
                {TARGET_MIN}–
                {TARGET_MAX} dB
              </Text>
            </View>

            <Text
              style={
                styles.pattern
              }
            >
              Soft → Loud → Soft
            </Text>
          </View>

          {/* SESSION */}
          <View
            style={
              styles.sessionRow
            }
          >
            <View
              style={
                styles.sessionPart
              }
            >
              <Text
                style={
                  styles.sessionLabel
                }
              >
                REPETITION
              </Text>

              <Text
                style={
                  styles.sessionValue
                }
              >
                {rep} / {REPETITIONS}
              </Text>
            </View>

            <View
              style={
                styles.sessionDivider
              }
            />

            <View
              style={
                styles.sessionPart
              }
            >
              <Text
                style={
                  styles.sessionLabel
                }
              >
                TIME
              </Text>

              <Text
                style={
                  styles.sessionValue
                }
              >
                0:
                {String(
                  seconds
                ).padStart(2, '0')}
              </Text>
            </View>
          </View>

          {/* PROGRESS */}
          <View
            style={
              styles.progressTrack
            }
          >
            <View
              style={[
                styles.progressValue,
                {
                  width: `${progress * 100}%`,
                },
              ]}
            />
          </View>

          {/* STOP */}
          <TouchableOpacity
            style={
              styles.stopButton
            }
            onPress={async () => {
              if (isRecording) {
                await stopRecording();
              }

              setPhase(
                'directions'
              );
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

            <Text
              style={
                styles.stopText
              }
            >
              Stop Exercise
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const passed = score >= 75;

  /*
   * ========================================================
   * RESULTS
   * ========================================================
   */

  return (
    <SafeAreaView
      style={styles.screen}
    >
      <View style={styles.topBar}>
        <Pressable
          style={styles.back}
          onPress={() =>
            router.back()
          }
        >
          <Ionicons
            name="arrow-back"
            size={20}
            color={BROWN}
          />
        </Pressable>

        <Text
          style={styles.topTitle}
        >
          Results
        </Text>

        <View
          style={styles.back}
        />
      </View>

      <View
        style={
          styles.resultsBody
        }
      >
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

        <Text
          style={
            styles.resultSmall
          }
        >
          DYNAMIC RANGE
        </Text>

        <Text
          style={
            styles.resultTitle
          }
        >
          {passed
            ? 'Exercise Passed'
            : 'Needs More Practice'}
        </Text>

        <Text
          style={
            styles.resultSub
          }
        >
          {passed
            ? 'Great job! You can move on to the next exercise.'
            : 'Keep practicing to improve your volume control.'}
        </Text>

        <View
          style={
            styles.scoreCard
          }
        >
          <Text
            style={
              styles.scoreLabel
            }
          >
            OVERALL SCORE
          </Text>

          <Text
            style={styles.score}
          >
            {score}%
          </Text>

          <View
            style={
              styles.scoreTrack
            }
          >
            <View
              style={[
                styles.scoreFill,
                {
                  width: `${score}%`,
                },
              ]}
            />
          </View>
        </View>

        <View
          style={
            styles.resultDetails
          }
        >
          <ResultItem
            label="Range Accuracy"
            value={`${rangeAccuracy}%`}
          />

          <ResultItem
            label="Ramp Consistency"
            value={`${rampConsistency}%`}
          />

          <ResultItem
            label="Target Range"
            value={`${TARGET_MIN}–${TARGET_MAX} dB`}
          />
        </View>

        {passed ? (
          <>
            <TouchableOpacity
              style={
                styles.startButton
              }
              onPress={() =>
                router.replace(
                  '/exercises/volume'
                )
              }
              activeOpacity={0.85}
            >
              <Ionicons
                name="arrow-forward"
                size={17}
                color={WHITE}
              />

              <Text
                style={
                  styles.startButtonText
                }
              >
                Next Exercise
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={
                styles.secondaryButton
              }
              onPress={tryAgain}
              activeOpacity={0.85}
            >
              <Ionicons
                name="refresh"
                size={16}
                color={BROWN}
              />

              <Text
                style={
                  styles.secondaryButtonText
                }
              >
                Try Again
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={
                styles.startButton
              }
              onPress={tryAgain}
              activeOpacity={0.85}
            >
              <Ionicons
                name="refresh"
                size={17}
                color={WHITE}
              />

              <Text
                style={
                  styles.startButtonText
                }
              >
                Try Again
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={
                styles.secondaryButton
              }
              onPress={() =>
                router.replace(
                  '/exercises/volume'
                )
              }
              activeOpacity={0.85}
            >
              <Ionicons
                name="arrow-back"
                size={16}
                color={BROWN}
              />

              <Text
                style={
                  styles.secondaryButtonText
                }
              >
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
    <View
      style={
        styles.resultItem
      }
    >
      <Text
        style={
          styles.resultItemLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.resultItemValue
        }
      >
        {value}
      </Text>
    </View>
  );
}

/*
 * ========================================================
 * STYLES
 * ========================================================
 */

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

  /*
   * DIRECTIONS
   */

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
    lineHeight: 20,
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
    marginLeft: 7,
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

  /*
   * ACTUAL EXERCISE
   */

  actualBody: {
    flex: 1,
    paddingHorizontal: 15,
    paddingTop: 2,
    paddingBottom: 13,
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

  /*
   * MAIN VISUALIZER
   */

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

  targetBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '19%',
    height: '27%',
    backgroundColor:
      'rgba(252, 214, 221, 0.32)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#F3D3DA',
  },

  referenceBars: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },

  referenceBar: {
    flex: 1,
    backgroundColor: '#F1B7C5',
    borderRadius: 5,
    opacity: 0.65,
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

  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: '#F1E0E4',
  },

  targetMarker: {
    position: 'absolute',
    right: 7,
    top: '18%',
    backgroundColor: WHITE,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },

  targetMarkerText: {
    fontFamily: 'FredokaSemiBold',
    fontSize: 6,
    color: ACCENT,
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

  /*
   * VOICE
   */

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

  /*
   * TARGET
   */

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

  /*
   * SESSION
   */

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

  /*
   * RESULTS
   */

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
    height: 42,
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