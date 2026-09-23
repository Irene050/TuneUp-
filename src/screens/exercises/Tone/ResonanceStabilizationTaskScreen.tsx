// src/screens/exercises/Tone/ResonanceStabilizationTaskScreen.tsx

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  ResonanceBand,
  classifyResonanceBand,
} from '@/utils/dsp/spectral';

import {
  Tier,
  RESONANCE_STABILIZATION_PARAMS,
} from '@/constants/exercises/tone';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';

import {
  measureResonanceStabilization,
  ResonanceStabilizationMeasurement,
} from '@/services/measurement/tone/resonanceStabilizationTask';

import {
  scoreResonanceStabilizationTask,
  ResonanceStabilizationScoreResult,
} from '@/services/scoring/tone/resonanceStabilizationTask';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import {
  computeFFTMagnitudes,
} from '@/utils/dsp/fft';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';

const COUNTDOWN_SECONDS = 3;
const REST_SECONDS = 2;

interface Props {
  tier?: Tier;
}

type Phase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'rest'
  | 'processing'
  | 'results';

interface RepetitionResult {
  measurement: ResonanceStabilizationMeasurement;
  score: ResonanceStabilizationScoreResult;
  targetBand: ResonanceBand;
  detectedBand: ResonanceBand | null;
}

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function formatNumber(
  value: number,
  decimals = 1
): string {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return value.toFixed(decimals);
}

function bandLabel(
  band: ResonanceBand
): string {
  switch (band) {
    case 'chest':
      return 'Chest';
    case 'head':
      return 'Head';
    case 'mixed':
      return 'Mixed';
  }
}

function bandIcon(
  band: ResonanceBand
): keyof typeof Ionicons.glyphMap {
  switch (band) {
    case 'chest':
      return 'body-outline';
    case 'head':
      return 'cloud-outline';
    case 'mixed':
      return 'swap-vertical-outline';
  }
}

function bandDescription(
  band: ResonanceBand
): string {
  switch (band) {
    case 'chest':
      return (
        'Aim for a grounded, fuller vocal sensation. ' +
        'Stay relaxed and avoid pressing the sound.'
      );

    case 'head':
      return (
        'Aim for a lighter, higher vocal sensation. ' +
        'Keep the sound easy instead of forcing it upward.'
      );

    case 'mixed':
      return (
        'Aim for a balanced blend between heavier and lighter resonance. ' +
        'Keep the transition smooth rather than pushing either side.'
      );
  }
}

function getTargetForRepetition(
  allowed: ResonanceBand[],
  repetitionIndex: number
): ResonanceBand {
  if (allowed.length === 0) {
    return 'chest';
  }

  return allowed[
    repetitionIndex % allowed.length
  ];
}

export default function ResonanceStabilizationTaskScreen({
  tier = 'beginner',
}: Props) {
  const params =
    RESONANCE_STABILIZATION_PARAMS[
      tier
    ];

  const allowedBands =
    params.resonanceTypes;

  const [phase, setPhase] =
    useState<Phase>(
      'instructions'
    );

  const [countdown, setCountdown] =
    useState(
      COUNTDOWN_SECONDS
    );

  const [restCountdown, setRestCountdown] =
    useState(REST_SECONDS);

  const [repetition, setRepetition] =
    useState(0);

  const [elapsedMs, setElapsedMs] =
    useState(0);

  const [liveFrame, setLiveFrame] =
    useState<LiveAudioFrame | null>(
      null
    );

  const [liveBand, setLiveBand] =
    useState<ResonanceBand | null>(
      null
    );

  const [selectedBand, setSelectedBand] =
    useState<ResonanceBand>(
      allowedBands[0] ?? 'chest'
    );

  const [repetitionResults, setRepetitionResults] =
    useState<RepetitionResult[]>(
      []
    );

  const [result, setResult] =
    useState<{
      score: number;
      passed: boolean;
    } | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const mountedRef =
    useRef(true);

  const countdownTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const restTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const recordingTimerRef =
    useRef<ReturnType<
      typeof setInterval
    > | null>(null);

  const recordingRef =
    useRef(false);

  const processingRef =
    useRef(false);

  const stopRequestedRef =
    useRef(false);

  const elapsedRef =
    useRef(0);

  const repetitionRef =
    useRef(0);

  const selectedBandRef =
    useRef<ResonanceBand>(
      allowedBands[0] ?? 'chest'
    );

  const resultsRef =
    useRef<RepetitionResult[]>(
      []
    );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current
        );
        countdownTimerRef.current = null;
      }

      if (
        restTimerRef.current
      ) {
        clearInterval(
          restTimerRef.current
        );
        restTimerRef.current = null;
      }

      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current
        );
        recordingTimerRef.current = null;
      }

      recordingRef.current = false;
      processingRef.current = false;
      stopRequestedRef.current = false;
    };
  }, []);

  useEffect(() => {
    selectedBandRef.current =
      selectedBand;
  }, [selectedBand]);

  const clearTimers =
    useCallback(() => {
      if (
        countdownTimerRef.current
      ) {
        clearInterval(
          countdownTimerRef.current
        );
        countdownTimerRef.current = null;
      }

      if (
        restTimerRef.current
      ) {
        clearInterval(
          restTimerRef.current
        );
        restTimerRef.current = null;
      }

      if (
        recordingTimerRef.current
      ) {
        clearInterval(
          recordingTimerRef.current
        );
        recordingTimerRef.current = null;
      }
    }, []);

  const handleLiveFrame =
    useCallback(
      (frame: LiveAudioFrame) => {
        if (!mountedRef.current) {
          return;
        }

        const pitch =
          Number.isFinite(frame.pitch) &&
          frame.pitch > 0
            ? frame.pitch
            : 0;

        setLiveBand(
          pitch > 0
            ? classifyResonanceBand(pitch)
            : null
        );
      },
      []
    );

  const finishExercise =
    useCallback(
      async (
        completedResults: RepetitionResult[]
      ) => {
        if (
          completedResults.length === 0 ||
          !mountedRef.current
        ) {
          return;
        }

        const totalScore =
          completedResults.reduce(
            (
              sum,
              item
            ) =>
              sum + item.score.score,
            0
          ) /
          completedResults.length;

        const allPassed =
          completedResults.every(
            (item) =>
              item.score.passed
          );

        const roundedScore =
          Math.round(
            clamp(
              totalScore,
              0,
              100
            )
          );

        setResult({
          score:
            roundedScore,
          passed:
            allPassed,
        });

        await saveCompletedExercise(
          'tone',
          'resonanceStabilizationTask',
          tier,
          roundedScore
        );

        if (
          !mountedRef.current
        ) {
          return;
        }

        setPhase(
          'results'
        );
      },
      [tier]
    );

  const handleRecordingStop =
    useCallback(
      async (
        samples: Float32Array,
        sampleRate: number
      ) => {
        if (
          !mountedRef.current ||
          processingRef.current
        ) {
          return;
        }

        processingRef.current = true;
        recordingRef.current = false;

        if (
          recordingTimerRef.current
        ) {
          clearInterval(
            recordingTimerRef.current
          );
          recordingTimerRef.current = null;
        }

        setPhase(
          'processing'
        );

        try {
          if (
            samples.length === 0
          ) {
            throw new Error(
              'No audio samples were recorded.'
            );
          }

          const measurement =
            measureResonanceStabilization(
              samples,
              sampleRate,
              computeFFTMagnitudes
            );

          if (
            measurement.bandSequence.length ===
            0
          ) {
            throw new Error(
              'No usable resonance frames were detected.'
            );
          }

          const scored =
            scoreResonanceStabilizationTask(
              measurement,
              tier
            );

          const detectedBands =
            measurement.bandSequence;

          const detectedBand =
            detectedBands.length > 0
              ? detectedBands[
                  Math.floor(
                    detectedBands.length /
                    2
                  )
                ]
              : null;

          const currentTarget =
            selectedBandRef.current;

          const nextResults =
            [
              ...resultsRef.current,
              {
                measurement,
                score: scored,
                targetBand:
                  currentTarget,
                detectedBand,
              },
            ];

          resultsRef.current =
            nextResults;

          setRepetitionResults(
            nextResults
          );

          processingRef.current = false;

          if (
            !mountedRef.current
          ) {
            return;
          }

          const isLast =
            repetitionRef.current >=
            params.repetitions;

          if (isLast) {
            await finishExercise(
              nextResults
            );
            return;
          }

          setPhase(
            'rest'
          );

          let restValue =
            REST_SECONDS;

          setRestCountdown(
            restValue
          );

          restTimerRef.current =
            setInterval(
              () => {
                restValue -= 1;

                if (
                  restValue <= 0
                ) {
                  if (
                    restTimerRef.current
                  ) {
                    clearInterval(
                      restTimerRef.current
                    );
                    restTimerRef.current =
                      null;
                  }

                  const nextIndex =
                    repetitionRef.current;

                  const upcomingTarget =
                    getTargetForRepetition(
                      allowedBands,
                      nextIndex
                    );

                  selectedBandRef.current =
                    upcomingTarget;

                  if (
                    mountedRef.current
                  ) {
                    setSelectedBand(
                      upcomingTarget
                    );
                  }

                  setRepetition(
                    nextIndex + 1
                  );

                  repetitionRef.current =
                    nextIndex + 1;

                  setCountdown(
                    COUNTDOWN_SECONDS
                  );

                  setPhase(
                    'countdown'
                  );

                  return;
                }

                if (
                  mountedRef.current
                ) {
                  setRestCountdown(
                    restValue
                  );
                }
              },
              1000
            );
        } catch (error) {
          console.error(
            '❌ RESONANCE PROCESSING ERROR:',
            error
          );

          processingRef.current =
            false;

          if (
            mountedRef.current
          ) {
            setErrorMessage(
              'We could not analyze your resonance recording. Please try again.'
            );
            setPhase(
              'instructions'
            );
          }
        }
      },
      [
        allowedBands,
        finishExercise,
        params.repetitions,
        tier,
      ]
    );

  const {
    startRecording,
    stopRecording,
    isRecording,
  } =
    useAudioRecorder({
      onFrame:
        handleLiveFrame,
      onStop:
        handleRecordingStop,
    });

  const beginRecording =
    useCallback(
      async () => {
        if (
          !mountedRef.current ||
          recordingRef.current ||
          processingRef.current
        ) {
          return;
        }

        try {
          setLiveFrame(
            null
          );

          setLiveBand(
            null
          );

          elapsedRef.current =
            0;

          setElapsedMs(
            0
          );

          stopRequestedRef.current =
            false;

          processingRef.current =
            false;

          setPhase(
            'recording'
          );

          await startRecording();

          if (
            !mountedRef.current
          ) {
            return;
          }

          recordingRef.current =
            true;

          const durationMs =
            params.durationSec * 1000;

          recordingTimerRef.current =
            setInterval(
              () => {
                if (
                  !mountedRef.current ||
                  !recordingRef.current ||
                  stopRequestedRef.current
                ) {
                  return;
                }

                elapsedRef.current +=
                  100;

                setElapsedMs(
                  elapsedRef.current
                );

                if (
                  elapsedRef.current >=
                  durationMs
                ) {
                  if (
                    recordingTimerRef.current
                  ) {
                    clearInterval(
                      recordingTimerRef.current
                    );
                    recordingTimerRef.current =
                      null;
                  }

                  if (
                    stopRequestedRef.current
                  ) {
                    return;
                  }

                  stopRequestedRef.current =
                    true;

                  stopRecording().catch(
                    (
                      error
                    ) => {
                      console.error(
                        '❌ FAILED TO STOP RESONANCE RECORDING:',
                        error
                      );

                      recordingRef.current =
                        false;

                      stopRequestedRef.current =
                        false;

                      processingRef.current =
                        false;

                      if (
                        mountedRef.current
                      ) {
                        setErrorMessage(
                          'We could not finish the recording. Please try again.'
                        );
                        setPhase(
                          'instructions'
                        );
                      }
                    }
                  );
                }
              },
              100
            );
        } catch (error) {
          console.error(
            '❌ FAILED TO START RESONANCE RECORDING:',
            error
          );

          recordingRef.current =
            false;

          processingRef.current =
            false;

          stopRequestedRef.current =
            false;

          if (
            mountedRef.current
          ) {
            setPhase(
              'instructions'
            );

            Alert.alert(
              'Microphone Error',
              'Unable to start the microphone. Please check your microphone permission and try again.'
            );
          }
        }
      },
      [
        params.durationSec,
        startRecording,
        stopRecording,
      ]
    );

  const startCountdown =
    useCallback(
      () => {
        if (
          !mountedRef.current ||
          recordingRef.current ||
          processingRef.current
        ) {
          return;
        }

        clearTimers();

        resultsRef.current = [];
        setRepetitionResults(
          []
        );

        setResult(
          null
        );

        setErrorMessage(
          null
        );

        setLiveFrame(
          null
        );

        setLiveBand(
          null
        );

        elapsedRef.current =
          0;

        setElapsedMs(
          0
        );

        recordingRef.current =
          false;

        processingRef.current =
          false;

        stopRequestedRef.current =
          false;

        const firstTarget =
          getTargetForRepetition(
            allowedBands,
            0
          );

        selectedBandRef.current =
          firstTarget;

        setSelectedBand(
          firstTarget
        );

        repetitionRef.current =
          1;

        setRepetition(
          1
        );

        let value =
          COUNTDOWN_SECONDS;

        setCountdown(
          value
        );

        setPhase(
          'countdown'
        );

        countdownTimerRef.current =
          setInterval(
            () => {
              value -= 1;

              if (
                value <= 0
              ) {
                if (
                  countdownTimerRef.current
                ) {
                  clearInterval(
                    countdownTimerRef.current
                  );

                  countdownTimerRef.current =
                    null;
                }

                beginRecording();

                return;
              }

              if (
                mountedRef.current
              ) {
                setCountdown(
                  value
                );
              }
            },
            1000
          );
      },
      [
        allowedBands,
        beginRecording,
        clearTimers,
      ]
    );

  const retry =
    useCallback(
      () => {
        clearTimers();

        resultsRef.current = [];

        setRepetitionResults(
          []
        );

        setResult(
          null
        );

        setLiveFrame(
          null
        );

        setLiveBand(
          null
        );

        setElapsedMs(
          0
        );

        setRepetition(
          0
        );

        repetitionRef.current =
          0;

        recordingRef.current =
          false;

        processingRef.current =
          false;

        stopRequestedRef.current =
          false;

        setErrorMessage(
          null
        );

        const firstTarget =
          getTargetForRepetition(
            allowedBands,
            0
          );

        selectedBandRef.current =
          firstTarget;

        setSelectedBand(
          firstTarget
        );

        setPhase(
          'instructions'
        );
      },
      [allowedBands, clearTimers]
    );

  const goBack =
    useCallback(
      () => {
        clearTimers();

        recordingRef.current =
          false;

        processingRef.current =
          false;

        stopRequestedRef.current =
          true;

        router.replace(
          '/dashboard/exercises'
        );
      },
      [clearTimers]
    );

  const recordingProgress =
    params.durationSec > 0
      ? clamp(
          elapsedMs /
            1000 /
            params.durationSec,
          0,
          1
        )
      : 0;

  const livePitch =
    liveFrame &&
    liveFrame.pitch > 0
      ? formatNumber(
          liveFrame.pitch,
          0
        )
      : '--';

  const averageScore =
    repetitionResults.length > 0
      ? Math.round(
          repetitionResults.reduce(
            (
              sum,
              item
            ) =>
              sum + item.score.score,
            0
          ) /
          repetitionResults.length
        )
      : 0;

  if (
    phase ===
    'instructions'
  ) {
    return (
      <View
        style={styles.screen}
      >
        <Pressable
          style={styles.backButton}
          onPress={goBack}
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={BROWN}
          />
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.content
          }
        >
          <View
            style={styles.iconCircle}
          >
            <Ionicons
              name="swap-horizontal-outline"
              size={34}
              color={BROWN}
            />
          </View>

          <Text
            style={styles.title}
          >
            Resonance Stabilization
          </Text>

          <Text
            style={styles.subtitle}
          >
            Tone
          </Text>

          <View
            style={
              styles.instructionCard
            }
          >
            <View
              style={
                styles.prepareCard
              }
            >
              <View
                style={
                  styles.prepareHeader
                }
              >
                <Ionicons
                  name="mic-outline"
                  size={21}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareTitle
                  }
                >
                  Before You Begin
                </Text>
              </View>

              <View
                style={
                  styles.prepareItem
                }
              >
                <Ionicons
                  name="volume-mute-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareText
                  }
                >
                  Find a quiet room or area
                  with minimal background
                  noise.
                </Text>
              </View>

              <View
                style={
                  styles.prepareItem
                }
              >
                <Ionicons
                  name="body-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareText
                  }
                >
                  Stand or sit upright with
                  your shoulders and neck
                  relaxed.
                </Text>
              </View>

              <View
                style={
                  styles.prepareItem
                }
              >
                <Ionicons
                  name="mic-outline"
                  size={17}
                  color={BROWN}
                />

                <Text
                  style={
                    styles.prepareText
                  }
                >
                  Keep a consistent distance
                  from the microphone.
                </Text>
              </View>
            </View>

            <Text
              style={styles.cardTitle}
            >
              What You Are Practicing
            </Text>

            <Text
              style={
                styles.instruction
              }
            >
              Resonance refers to where your
              voice feels like it is vibrating
              or being amplified. For this
              exercise, choose one comfortable
              resonance placement and keep the
              sound stable while holding it.
            </Text>

            <Text
              style={
                styles.instruction
              }
            >
              Do not force the voice into a
              placement that feels strained.
              The goal is controlled, repeatable
              resonance rather than a louder or
              higher sound.
            </Text>

            <Text
              style={
                styles.instruction
              }
            >
              TuneUp! cannot directly sense the
              physical location of your vocal
              resonance. It uses dominant-frequency
              analysis as a microphone-based
              resonance indicator.
            </Text>

            <View
              style={styles.targetBox}
            >
              <Ionicons
                name={bandIcon(
                  selectedBand
                )}
                size={28}
                color={BROWN}
              />

              <View
                style={
                  styles.targetInfo
                }
              >
                <Text
                  style={
                    styles.targetLabel
                  }
                >
                  Choose Your Target
                </Text>

                <Text
                  style={
                    styles.targetValue
                  }
                >
                  {bandLabel(
                    selectedBand
                  )}
                </Text>

                <Text
                  style={
                    styles.targetHint
                  }
                >
                  {
                    bandDescription(
                      selectedBand
                    )
                  }
                </Text>
              </View>
            </View>

            <View
              style={
                styles.bandSelector
              }
            >
              {allowedBands.map(
                (band) => {
                  const active =
                    selectedBand ===
                    band;

                  return (
                    <Pressable
                      key={band}
                      style={[
                        styles.bandOption,
                        active &&
                          styles.bandOptionActive,
                      ]}
                      onPress={() => {
                        setSelectedBand(
                          band
                        );
                        selectedBandRef.current =
                          band;
                      }}
                    >
                      <Ionicons
                        name={bandIcon(
                          band
                        )}
                        size={18}
                        color={BROWN}
                      />

                      <Text
                        style={[
                          styles.bandOptionText,
                          active &&
                            styles.bandOptionTextActive,
                        ]}
                      >
                        {bandLabel(
                          band
                        )}
                      </Text>
                    </Pressable>
                  );
                }
              )}
            </View>

            <Text
              style={
                styles.helperText
              }
            >
              Available targets at this
              difficulty:{" "}
              {allowedBands
                .map(
                  bandLabel
                )
                .join(', ')}
              .
            </Text>
          </View>

          <View
            style={styles.tipCard}
          >
            <Ionicons
              name="bulb-outline"
              size={21}
              color={BROWN}
            />

            <Text
              style={styles.tipText}
            >
              Keep your jaw, tongue, and neck
              relaxed. Think about maintaining
              the same vocal setup instead of
              pushing the voice toward the target.
            </Text>
          </View>

          <View
            style={
              styles.difficultyRow
            }
          >
            <Text
              style={
                styles.difficultyLabel
              }
            >
              Difficulty
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {tier}
            </Text>
          </View>

          <View
            style={
              styles.difficultyRow
            }
          >
            <Text
              style={
                styles.difficultyLabel
              }
            >
              Hold Duration
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {params.durationSec}s
            </Text>
          </View>

          <View
            style={
              styles.difficultyRow
            }
          >
            <Text
              style={
                styles.difficultyLabel
              }
            >
              Repetitions
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {params.repetitions}
            </Text>
          </View>

          <View
            style={
              styles.difficultyRow
            }
          >
            <Text
              style={
                styles.difficultyLabel
              }
            >
              Required Stability
            </Text>

            <Text
              style={
                styles.difficultyValue
              }
            >
              {params.stabilityThreshold}%
            </Text>
          </View>

          {errorMessage && (
            <View
              style={
                styles.errorCard
              }
            >
              <Ionicons
                name="alert-circle-outline"
                size={21}
                color={BROWN}
              />

              <Text
                style={
                  styles.errorText
                }
              >
                {errorMessage}
              </Text>
            </View>
          )}

          <Pressable
            style={
              styles.startButton
            }
            onPress={
              startCountdown
            }
          >
            <Text
              style={
                styles.startButtonText
              }
            >
              Start Exercise
            </Text>

            <Ionicons
              name="arrow-forward"
              size={18}
              color={WHITE}
            />
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (
    phase ===
    'countdown'
  ) {
    return (
      <View
        style={
          styles.centerScreen
        }
      >
        <View
          style={
            styles.iconCircle
          }
        >
          <Ionicons
            name={bandIcon(
              selectedBand
            )}
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={
            styles.phaseTitle
          }
        >
          Get Ready
        </Text>

        <Text
          style={
            styles.countdownText
          }
        >
          {countdown}
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Prepare your{" "}
          {bandLabel(
            selectedBand
          ).toLowerCase()}{" "}
          resonance
        </Text>

        <Text
          style={
            styles.largeBand
          }
        >
          {bandLabel(
            selectedBand
          )}
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Repetition{" "}
          {repetition} /{" "}
          {params.repetitions}
        </Text>
      </View>
    );
  }

  if (
    phase ===
    'rest'
  ) {
    return (
      <View
        style={
          styles.centerScreen
        }
      >
        <View
          style={
            styles.iconCircle
          }
        >
          <Ionicons
            name="pause-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={
            styles.phaseTitle
          }
        >
          Relax
        </Text>

        <Text
          style={
            styles.countdownText
          }
        >
          {restCountdown}
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Prepare for the next resonance target
        </Text>

        <Text
          style={
            styles.largeBand
          }
        >
          Next:
          {" "}
          {bandLabel(
            selectedBand
          )}
        </Text>
      </View>
    );
  }

  if (
    phase ===
    'recording'
  ) {
    const liveMatchesTarget =
      liveBand ===
      selectedBand;

    return (
      <View
        style={styles.screen}
      >
        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.recordingContent
          }
        >
          <View
            style={
              styles.recordingIcon
            }
          >
            <Ionicons
              name="mic"
              size={34}
              color={BROWN}
            />
          </View>

          <Text
            style={
              styles.recordingTitle
            }
          >
            Stabilize Your Resonance
          </Text>

          <Text
            style={
              styles.recordingSubtitle
            }
          >
            Keep the same resonance placement
            throughout the hold.
          </Text>

          <View
            style={styles.targetBandCard}
          >
            <Text
              style={
                styles.targetBandLabel
              }
            >
              TARGET RESONANCE
            </Text>

            <View
              style={
                styles.targetBandRow
              }
            >
              <View
                style={
                  styles.targetBandIconCircle
                }
              >
                <Ionicons
                  name={bandIcon(
                    selectedBand
                  )}
                  size={27}
                  color={BROWN}
                />
              </View>

              <View>
                <Text
                  style={
                    styles.targetBandValue
                  }
                >
                  {bandLabel(
                    selectedBand
                  )}
                </Text>

                <Text
                  style={
                    styles.targetBandHint
                  }
                >
                  {bandDescription(
                    selectedBand
                  )}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={
              styles.microphoneArea
            }
          >
            <View
              style={
                styles.outerMicCircle
              }
            >
              <View
                style={
                  styles.innerMicCircle
                }
              >
                <Ionicons
                  name="mic"
                  size={52}
                  color={BROWN}
                />
              </View>
            </View>

            <View
              style={
                styles.recordingBadge
              }
            >
              <View
                style={
                  styles.recordingDot
                }
              />

              <Text
                style={
                  styles.recordingBadgeText
                }
              >
                RECORDING
              </Text>
            </View>
          </View>

          <View
            style={
              styles.liveResonanceCard
            }
          >
            <Text
              style={
                styles.liveLabel
              }
            >
              LIVE RESONANCE INDICATOR
            </Text>

            <Text
              style={
                styles.liveBandValue
              }
            >
              {liveBand
                ? bandLabel(
                    liveBand
                  )
                : '--'}
            </Text>

            <View
              style={[
                styles.liveMatchPill,
                liveMatchesTarget &&
                  styles.liveMatchPillActive,
              ]}
            >
              <Ionicons
                name={
                  liveMatchesTarget
                    ? 'checkmark-circle-outline'
                    : 'information-circle-outline'
                }
                size={17}
                color={BROWN}
              />

              <Text
                style={
                  styles.liveMatchText
                }
              >
                {liveMatchesTarget
                  ? 'Current indicator matches your target'
                  : liveBand
                    ? `Current indicator: ${bandLabel(
                        liveBand
                      )}`
                    : 'Waiting for a clear vocal signal'}
              </Text>
            </View>

            <Text
              style={
                styles.liveDisclaimer
              }
            >
              This is a frequency-based training
              indicator, not a direct measurement
              of physical resonance placement.
            </Text>

            <View
              style={
                styles.livePitchRow
              }
            >
              <Text
                style={
                  styles.livePitchLabel
                }
              >
                Detected pitch
              </Text>

              <Text
                style={
                  styles.livePitchValue
                }
              >
                {livePitch} Hz
              </Text>
            </View>
          </View>

          <View
            style={
              styles.timerCard
            }
          >
            <Text
              style={
                styles.timerText
              }
            >
              {(elapsedMs / 1000).toFixed(1)}
              {' / '}
              {params.durationSec}s
            </Text>

            <View
              style={
                styles.timerTrack
              }
            >
              <View
                style={[
                  styles.timerFill,
                  {
                    width: `${recordingProgress * 100}%`,
                  },
                ]}
              />
            </View>

            <Text
              style={
                styles.repetitionText
              }
            >
              Repetition{" "}
              {repetition} /{" "}
              {params.repetitions}
            </Text>
          </View>

          <View
            style={
              styles.reminderCard
            }
          >
            <Ionicons
              name="body-outline"
              size={20}
              color={BROWN}
            />

            <Text
              style={
                styles.reminderText
              }
            >
              Keep the jaw, tongue, and neck
              relaxed. Do not push the sound just
              to make the indicator change.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (
    phase ===
    'processing'
  ) {
    return (
      <View
        style={
          styles.centerScreen
        }
      >
        <View
          style={
            styles.iconCircle
          }
        >
          <Ionicons
            name="analytics-outline"
            size={34}
            color={BROWN}
          />
        </View>

        <Text
          style={
            styles.phaseTitle
          }
        >
          Analyzing Your Resonance
        </Text>

        <Text
          style={
            styles.phaseSubtitle
          }
        >
          Tracking dominant frequency changes
          and resonance-band stability.
        </Text>

        <ActivityIndicator
          size="large"
          color={BROWN}
          style={
            styles.processingIndicator
          }
        />
      </View>
    );
  }

  if (
    phase === 'results' &&
    result
  ) {
    return (
      <View
        style={
          styles.screen
        }
      >
        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.resultsContent
          }
        >
          <View
            style={[
              styles.resultIcon,
              result.passed
                ? styles.resultIconPassed
                : styles.resultIconFailed,
            ]}
          >
            <Ionicons
              name={
                result.passed
                  ? 'checkmark'
                  : 'refresh'
              }
              size={40}
              color={BROWN}
            />
          </View>

          <Text
            style={
              styles.resultTitle
            }
          >
            {result.passed
              ? 'Great Job!'
              : 'Keep Practicing!'}
          </Text>

          <Text
            style={
              styles.resultSubtitle
            }
          >
            Resonance Stabilization Result
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
              Overall Score
            </Text>

            <Text
              style={
                styles.scoreValue
              }
            >
              {result.score}%
            </Text>

            <Text
              style={
                styles.scoreDescription
              }
            >
              {result.passed
                ? 'Your resonance indicator stayed stable enough and the hold duration met the required target.'
                : 'Focus on maintaining one comfortable resonance setup for the full hold.'}
            </Text>
          </View>

          <View
            style={
              styles.resultCard
            }
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Repetition Results
            </Text>

            {repetitionResults.map(
              (
                item,
                index
              ) => (
                <View
                  key={`${index}-${item.targetBand}`}
                  style={
                    styles.repResultRow
                  }
                >
                  <View
                    style={
                      styles.repResultNumber
                    }
                  >
                    <Text
                      style={
                        styles.repResultNumberText
                      }
                    >
                      {index + 1}
                    </Text>
                  </View>

                  <View
                    style={
                      styles.repResultMain
                    }
                  >
                    <Text
                      style={
                        styles.repResultTarget
                      }
                    >
                      Target:{" "}
                      {bandLabel(
                        item.targetBand
                      )}
                    </Text>

                    <Text
                      style={
                        styles.repResultDetected
                      }
                    >
                      Detected indicator:{" "}
                      {item.detectedBand
                        ? bandLabel(
                            item.detectedBand
                          )
                        : '--'}
                    </Text>
                  </View>

                  <Text
                    style={
                      styles.repResultScore
                    }
                  >
                    {item.score.score}%
                  </Text>
                </View>
              )
            )}
          </View>

          <View
            style={
              styles.resultCard
            }
          >
            <Text
              style={
                styles.resultCardTitle
              }
            >
              Performance Summary
            </Text>

            <View
              style={
                styles.resultRow
              }
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Resonance stability
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {repetitionResults.length
                  ? `${Math.round(
                      repetitionResults.reduce(
                        (
                          sum,
                          item
                        ) =>
                          sum +
                          item.measurement
                            .stabilityPct,
                        0
                      ) /
                      repetitionResults.length
                    )}%`
                  : '--'}
              </Text>
            </View>

            <View
              style={
                styles.resultRow
              }
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Average hold duration
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {repetitionResults.length
                  ? `${formatNumber(
                      repetitionResults.reduce(
                        (
                          sum,
                          item
                        ) =>
                          sum +
                          item.measurement
                            .durationSec,
                        0
                      ) /
                      repetitionResults.length
                    )}s`
                  : '--'}
              </Text>
            </View>

            <View
              style={
                styles.resultRow
              }
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Required stability
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {params.stabilityThreshold}%
              </Text>
            </View>

            <View
              style={
                styles.resultRow
              }
            >
              <Text
                style={
                  styles.resultRowLabel
                }
              >
                Average score
              </Text>

              <Text
                style={
                  styles.resultRowValue
                }
              >
                {averageScore}%
              </Text>
            </View>
          </View>

          <View
            style={
              styles.explanationCard
            }
          >
            <Ionicons
              name="information-circle-outline"
              size={21}
              color={BROWN}
            />

            <Text
              style={
                styles.explanationText
              }
            >
              Your target resonance is shown for
              guidance. The current scoring function
              evaluates resonance-band stability and
              hold duration; target-band agreement is
              displayed as feedback but is not used
              as a separate scoring term.
            </Text>
          </View>

          <Pressable
            style={
              styles.primaryButton
            }
            onPress={
              retry
            }
          >
            <Text
              style={
                styles.primaryButtonText
              }
            >
              Try Again
            </Text>

            <Ionicons
              name="refresh"
              size={18}
              color={WHITE}
            />
          </Pressable>

          <Pressable
            style={
              styles.secondaryButton
            }
            onPress={
              goBack
            }
          >
            <Text
              style={
                styles.secondaryButtonText
              }
            >
              Back to Exercises
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  backButton: {
    position: 'absolute',
    top: 55,
    left: 24,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 100,
    paddingBottom: 60,
    alignItems: 'center',
  },

  recordingContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 50,
    alignItems: 'center',
  },

  resultsContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 50,
    alignItems: 'center',
  },

  centerScreen: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  title: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
  },

  subtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    marginTop: 3,
    marginBottom: 24,
  },

  instructionCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  prepareCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  prepareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  prepareTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 16,
    color: BROWN,
    marginLeft: 9,
  },

  prepareItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },

  prepareText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: BROWN,
    marginLeft: 9,
  },

  cardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 19,
    color: BROWN,
    marginBottom: 14,
  },

  instruction: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: BROWN,
    marginBottom: 10,
  },

  targetBox: {
    backgroundColor: PINK,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },

  targetInfo: {
    flex: 1,
    marginLeft: 12,
  },

  targetLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  targetValue: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
    marginTop: 2,
  },

  targetHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: MUTED,
    marginTop: 2,
  },

  bandSelector: {
    width: '100%',
    marginTop: 10,
    gap: 8,
  },

  bandOption: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: WHITE,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  bandOptionActive: {
    backgroundColor: PINK,
  },

  bandOptionText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
    marginLeft: 9,
  },

  bandOptionTextActive: {
    fontFamily: 'FredokaBold',
  },

  helperText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 10,
  },

  tipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  tipText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 10,
  },

  difficultyRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 20,
  },

  difficultyLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  difficultyValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    textTransform: 'capitalize',
  },

  errorCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  errorText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 10,
  },

  startButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
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

  phaseTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
    textAlign: 'center',
  },

  phaseSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },

  countdownText: {
    fontFamily: 'FredokaBold',
    fontSize: 72,
    color: BROWN,
    marginTop: 20,
  },

  largeBand: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 12,
  },

  recordingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  recordingTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 28,
    color: BROWN,
    textAlign: 'center',
  },

  recordingSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 18,
  },

  targetBandCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    padding: 18,
    marginTop: 25,
  },

  targetBandLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  targetBandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },

  targetBandIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  targetBandValue: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
  },

  targetBandHint: {
    maxWidth: 240,
    marginTop: 2,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 14,
    color: MUTED,
  },

  microphoneArea: {
    alignItems: 'center',
    marginVertical: 20,
  },

  outerMicCircle: {
    width: 146,
    height: 146,
    borderRadius: 73,
    backgroundColor: LIGHT_PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  innerMicCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recordingBadge: {
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: BROWN,
  },

  recordingBadgeText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
    letterSpacing: 0.8,
  },

  liveResonanceCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    padding: 20,
    marginTop: 14,
    alignItems: 'center',
  },

  liveLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  liveBandValue: {
    fontFamily: 'FredokaBold',
    fontSize: 34,
    color: BROWN,
    marginTop: 4,
  },

  liveMatchPill: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WHITE,
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 9,
  },

  liveMatchPillActive: {
    backgroundColor: PINK,
  },

  liveMatchText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 14,
    color: BROWN,
    marginLeft: 7,
  },

  liveDisclaimer: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    lineHeight: 13,
    color: MUTED,
    textAlign: 'center',
    marginTop: 9,
  },

  livePitchRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F2DDE5',
  },

  livePitchLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  livePitchValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  timerCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    padding: 18,
    marginTop: 14,
  },

  timerText: {
    fontFamily: 'FredokaBold',
    fontSize: 22,
    color: BROWN,
    textAlign: 'center',
  },

  timerTrack: {
    width: '100%',
    height: 9,
    borderRadius: 5,
    backgroundColor: LIGHT_GRAY,
    overflow: 'hidden',
    marginTop: 10,
  },

  timerFill: {
    height: '100%',
    backgroundColor: PINK,
    borderRadius: 5,
  },

  repetitionText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginTop: 9,
  },

  reminderCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  reminderText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: BROWN,
    marginLeft: 10,
  },

  processingIndicator: {
    marginTop: 28,
  },

  resultIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  resultIconPassed: {
    backgroundColor: PINK,
  },

  resultIconFailed: {
    backgroundColor: LIGHT_GRAY,
  },

  resultTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 27,
    color: BROWN,
    textAlign: 'center',
  },

  resultSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
    marginBottom: 22,
  },

  scoreCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
  },

  scoreLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
  },

  scoreValue: {
    fontFamily: 'FredokaBold',
    fontSize: 52,
    color: BROWN,
    marginVertical: 3,
  },

  scoreDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
  },

  resultCard: {
    width: '100%',
    backgroundColor: LIGHT_PINK,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  resultCardTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
    marginBottom: 10,
  },

  repResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F2DDE5',
  },

  repResultNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
  },

  repResultNumberText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },

  repResultMain: {
    flex: 1,
    marginLeft: 9,
  },

  repResultTarget: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
    color: BROWN,
  },

  repResultDetected: {
    fontFamily: 'FredokaRegular',
    fontSize: 9,
    lineHeight: 13,
    color: MUTED,
    marginTop: 2,
  },

  repResultScore: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
    marginLeft: 10,
  },

  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2DDE5',
  },

  resultRowLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    flex: 1,
  },

  resultRowValue: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
    marginLeft: 12,
  },

  explanationCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: PINK,
    borderRadius: 15,
    padding: 14,
    marginTop: 14,
  },

  explanationText: {
    flex: 1,
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: BROWN,
    marginLeft: 9,
  },

  primaryButton: {
    width: '100%',
    height: 54,
    borderRadius: 27,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },

  primaryButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: WHITE,
  },

  secondaryButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },

  secondaryButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 14,
    color: BROWN,
  },
});
