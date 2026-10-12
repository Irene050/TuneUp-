import { router } from 'expo-router';

import { Ionicons } from '@expo/vector-icons';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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
  VOLUME_CONTROL_STABILITY_PARAMS,
  type Tier,
} from '@/constants/exercises/volume';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';

import { measureVolumeControlStability } from '@/services/measurement/volume/volumeControlStability';
import { scoreVolumeControlStability } from '@/services/scoring/volume/volumeControlStability';

import {
  generateVolumeControlStabilityParams,
} from '@/services/adaptiveDifficultyScaling/parameterGenerator';

import {
  fetchComponentProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import {
  saveCompletedExercise,
} from '@/services/progress/exerciseProgressService';

import { auth } from '@/services/firebase/config';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import {
  createMusicalNote,
} from '@/utils/music/notes';

import {
  playSingleNote,
} from '@/utils/music/notePlayer';

/* =========================================================
   DEFAULT CONFIGURATION
========================================================= */

const CURRENT_TIER: Tier = 'beginner';

const DEFAULT_VOLUME_CONTROL_STABILITY =
  VOLUME_CONTROL_STABILITY_PARAMS[CURRENT_TIER];

const NOTE = 'C4';

const REFERENCE_NOTE =
  createMusicalNote(60);
const REFERENCE_NOTE_DURATION_SEC = 1.5;
const COUNTDOWN_SECONDS = 3;

/* =========================================================
   TYPES
========================================================= */

type Phase =
  | 'directions'
  | 'countdown'
  | 'exercise'
  | 'results';

interface HistoryPoint {
  value: number;
  time: number;
}

type MeasurementResult =
  ReturnType<
    typeof measureVolumeControlStability
  >;

type ScoreResult =
  ReturnType<
    typeof scoreVolumeControlStability
  >;

/* =========================================================
   COMPONENT
========================================================= */

export default function VolumeControlStabilityScreen({
  tier,
}: {
  tier?: Tier;
}) {
  const insets = useSafeAreaInsets();

  const { width, height } =
    useWindowDimensions();

  const horizontalPadding =
    Math.min(
      24,
      width * 0.06,
    );

  const [phase, setPhase] =
    useState<Phase>(
      'directions',
    );

  const [countdown, setCountdown] =
    useState(
      COUNTDOWN_SECONDS,
    );

  const [
    remainingSeconds,
    setRemainingSeconds,
  ] = useState(
    DEFAULT_VOLUME_CONTROL_STABILITY.durationSec *
      DEFAULT_VOLUME_CONTROL_STABILITY.repetitions,
  );

  const [liveVolume, setLiveVolume] =
    useState(-60);

  const [livePitch, setLivePitch] =
    useState<number | null>(null);

  const [liveNote, setLiveNote] =
    useState('--');

  const [
    liveStability,
    setLiveStability,
  ] = useState(0);

  const [
    liveHistory,
    setLiveHistory,
  ] = useState<HistoryPoint[]>(
    [],
  );

  const [
    measurement,
    setMeasurement,
  ] = useState<MeasurementResult | null>(
    null,
  );

  const [score, setScore] =
    useState<ScoreResult | null>(
      null,
    );

  const [
    hasPlayedReference,
    setHasPlayedReference,
  ] = useState(false);

  const [
    referencePlaying,
    setReferencePlaying,
  ] = useState(false);

  const [
    referenceError,
    setReferenceError,
  ] = useState<string | null>(
    null,
  );

  const [
    isStarting,
    setIsStarting,
  ] = useState(false);

  const [
    resolvedTier,
    setResolvedTier,
  ] = useState<Tier>(
    tier ?? CURRENT_TIER,
  );

  const [
    exerciseParams,
    setExerciseParams,
  ] = useState(
    DEFAULT_VOLUME_CONTROL_STABILITY,
  );

  const [
    paramsReady,
    setParamsReady,
  ] = useState(false);

  const durationSeconds =
    exerciseParams.durationSec;

  const repetitions =
    exerciseParams.repetitions;

  const targetStability =
    exerciseParams.stabilityThreshold;

  const amplitudeVariancePercent =
    exerciseParams.amplitudeVariancePct;

  const totalExerciseSeconds =
    durationSeconds * repetitions;

  const mountedRef =
    useRef(true);

  const exerciseStartedAtRef =
    useRef<number | null>(
      null,
    );

  const recordingFinishedRef =
    useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadParameters = async () => {
      try {
        const user =
          auth.currentUser;

        let selectedTier: Tier =
          tier ?? CURRENT_TIER;

        let recentScores: number[] =
          [];

        if (user) {
          if (!tier) {
            const progress =
              await fetchComponentProgress(
                user.uid,
                'volume',
              );

            selectedTier =
              progress?.currentTier ??
              CURRENT_TIER;
          }

          const records =
            await fetchExerciseRecords(
              user.uid,
              'volume',
            );

          const matchingRecords =
            records
              .filter(
                (record) =>
                  record.templateId ===
                    'volumeControlStability' &&
                  record.tier ===
                    selectedTier,
              )
              .sort(
                (a, b) =>
                  a.timestamp -
                  b.timestamp,
              );

          recentScores =
            matchingRecords
              .slice(-5)
              .map(
                (record) =>
                  record.scorePct,
              );

          if (
            recentScores.length === 0
          ) {
            const latestAssessment =
              await getLatestAssessment();

            const assessmentScore =
              latestAssessment?.scores.find(
                (score) =>
                  score.componentId ===
                  'volume',
              )?.scorePct;

            if (
              Number.isFinite(
                assessmentScore,
              )
            ) {
              recentScores = [
                assessmentScore!,
              ];
            }
          }
        }

        const generatedParams =
          generateVolumeControlStabilityParams({
            tier: selectedTier,
            recentScores,
          });

        if (cancelled) {
          return;
        }

        setResolvedTier(
          selectedTier,
        );

        setExerciseParams(
          generatedParams,
        );

        setParamsReady(true);
      } catch (error) {
        console.error(
          'Failed to load Volume Control Stability parameters:',
          error,
        );

        if (!cancelled) {
          setResolvedTier(
            tier ?? CURRENT_TIER,
          );

          setExerciseParams(
            DEFAULT_VOLUME_CONTROL_STABILITY,
          );

          setParamsReady(true);
        }
      }
    };
    void loadParameters();

    return () => {
      cancelled = true;
    };

  }, [tier]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const playReferenceNote =
    useCallback(async () => {
      if (referencePlaying) {
        return;
      }
      setReferenceError(null);
      setReferencePlaying(true);

      try {
        await playSingleNote(
          REFERENCE_NOTE.frequency,
          REFERENCE_NOTE_DURATION_SEC,
        );

        if (
          mountedRef.current
        ) {
          setHasPlayedReference(true);
        }
      } catch (error) {
        console.error(
          'C4 reference playback error:',
          error,
        );

        if (
          mountedRef.current
        ) {
          setHasPlayedReference(false);

          setReferenceError(
            'Unable to play the C4 reference note.',
          );
        }
      } finally {

        if (
          mountedRef.current
        ) {
          setReferencePlaying(false);
        }
      }
    }, [referencePlaying]);

  const {
    startRecording,
    stopRecording,
  } = useAudioRecorder({

    onFrame: (frame) => {
      if (
        !mountedRef.current ||
        phase !== 'exercise'
      ) {
        return;
      }


      const db =
        Number.isFinite(
          frame.volume,
        ) &&
        frame.volume > -100
          ? frame.volume
          : -60;
      
      setLiveVolume(db);

      const isVoiced =
        Number.isFinite(
          frame.pitch,
        ) &&
        frame.pitch > 0 &&
        Number.isFinite(
          frame.clarity,
        ) &&
        frame.clarity >= 0.45 &&
        typeof frame.note ===
          'string' &&
        frame.note !== '--';

      setLivePitch(isVoiced ? frame.pitch : null);
      setLiveNote(
        isVoiced && typeof frame.note === 'string'
          ? frame.note
          : '--',
      );

      if (!isVoiced) {
        setLiveStability(0);
        return;
      }

      const now =
        Date.now();

      setLiveHistory(
        (previous) => {
          const next = [
            ...previous,
            {
              value: db,
              time: now,
            },
          ].slice(-40);

          const amplitudes =
            next.map(
              (item) =>
                Math.pow(
                  10,
                  item.value / 20,
                ),
            );

          if (
            amplitudes.length < 2
          ) {
            setLiveStability(0);

            return next;
          }

          const mean =
            amplitudes.reduce(
              (
                sum,
                value,
              ) =>
                sum + value,
              0,
            ) /
            amplitudes.length;

          if (
            mean <= 0 ||
            !Number.isFinite(
              mean,
            )
          ) {
            setLiveStability(0);
            return next;
          }

          const variance =
            amplitudes.reduce(
              (
                sum,
                value,
              ) =>
                sum +
                Math.pow(
                  value - mean,
                  2,
                ),
              0,
            ) /

            amplitudes.length;

          const standardDeviation =
            Math.sqrt(
              variance,
            );

          const stability =
            100 -
            (standardDeviation /
              mean) *
              100;

          setLiveStability(
            Math.max(
              0,
              Math.min(
                100,
                stability,
              ),
            ),
          );

          return next;
        },
      );
    },

    onStop: (
      samples,
      sampleRate,
    ) => {
      if (
        !mountedRef.current ||
        recordingFinishedRef.current
      ) {
        return;
      }

      recordingFinishedRef.current =
        true;

      const measured =
        measureVolumeControlStability(
          samples,
          sampleRate,
          durationSeconds,
          repetitions,
        );

      const scored =
        scoreVolumeControlStability(
          measured,
          {
            passingScore:
              targetStability,
          },
        );

      setMeasurement(
        measured,
      );

      setScore(
        scored,
      );

      setPhase('results');

      void saveCompletedExercise(
        'volume',
        'volumeControlStability',
        resolvedTier,
        scored.overallScore,
      );
    },
  });


  const beginRecording =
    useCallback(async () => {
      try {
        recordingFinishedRef.current =
          false;

        await startRecording();

        if (
          !mountedRef.current
        ) {
          return;
        }

        exerciseStartedAtRef.current =
          Date.now();

        setLiveVolume(-60);
        setLiveStability(0);
        setLiveHistory([]);
        setLivePitch(null);
        setLiveNote('--');

        setRemainingSeconds(
          totalExerciseSeconds,
        );

        setPhase(
          'exercise',
        );
      } catch (error) {
        console.error(
          'Unable to start recording:',
          error,
        );

        if (
          mountedRef.current
        ) {
          setPhase(
            'directions',
          );

          setReferenceError(
            'Microphone could not be started. Please check microphone permission.',
          );
        }
      }
    }, [
      startRecording,
      totalExerciseSeconds,
    ]);

  useEffect(() => {
    if (
      phase !== 'countdown'
    ) {
      return;
    }

    setCountdown(
      COUNTDOWN_SECONDS,
    );

    const interval =
      setInterval(() => {
        setCountdown(
          (value) => {
            if (value <= 1) {
              clearInterval(
                interval,
              );

              void beginRecording();

              return 0;
            }
            return value - 1;
          },
        );
      }, 1000);

    return () => {
      clearInterval(
        interval,
      );
    };
  }, [
    phase,
    beginRecording,
  ]);

  useEffect(() => {
    if (
      phase !== 'exercise'
    ) {
      return;
    }

    const interval =
      setInterval(() => {
        const startedAt =
          exerciseStartedAtRef.current;

        if (!startedAt) {
          return;
        }

        const elapsed =
          (Date.now() -
            startedAt) /
          1000;

        const remaining =
          Math.max(
            0,
            Math.ceil(
              totalExerciseSeconds -
                elapsed,
            ),
          );

        setRemainingSeconds(
          remaining,
        );

        if (
          elapsed >=
          totalExerciseSeconds
        ) {
          clearInterval(
            interval,
          );

          void stopRecording();
        }
      }, 100);

    return () => {
      clearInterval(
        interval,
      );
    };
  }, [
    phase,
    stopRecording,
    totalExerciseSeconds,
  ]);

  const startExercise =

    useCallback(() => {

      if (

        !paramsReady ||

        !hasPlayedReference ||

        isStarting

      ) {

        return;

      }



      setIsStarting(true);



      setMeasurement(null);



      setScore(null);



      setLiveHistory([]);


      setLiveVolume(-60);



      setLiveStability(0);



      setRemainingSeconds(

        totalExerciseSeconds,

      );



      setCountdown(

        COUNTDOWN_SECONDS,

      );



      setReferenceError(null);



      setPhase(

        'countdown',

      );



      setTimeout(() => {

        if (

          mountedRef.current

        ) {

          setIsStarting(false);

        }

      }, 400);

    }, [

      paramsReady,

      hasPlayedReference,

      isStarting,

      totalExerciseSeconds,

    ]);



  /* =======================================================

     RESET

     ======================================================= */



  const resetExercise =

    useCallback(() => {

      setMeasurement(null);



      setScore(null);



      setLiveVolume(-60);



      setLiveStability(0);



      setLiveHistory([]);


      setRemainingSeconds(

        totalExerciseSeconds,

      );



      setCountdown(

        COUNTDOWN_SECONDS,

      );



      setReferenceError(null);



      setHasPlayedReference(

        false,

      );



      setReferencePlaying(

        false,

      );



      recordingFinishedRef.current =

        false;



      exerciseStartedAtRef.current =

        null;



      setPhase(

        'directions',

      );

    }, [

      totalExerciseSeconds,

    ]);



  const voiceDetected =
    livePitch !== null &&
    Number.isFinite(livePitch) &&
    livePitch > 0 &&
    liveNote !== '--';

  const centsFromTarget =
    voiceDetected && livePitch !== null
      ? Math.round(
          1200 *
            Math.log2(
              livePitch / REFERENCE_NOTE.frequency,
            ),
        )
      : null;

  const pitchOnTarget =
    centsFromTarget !== null &&
    Math.abs(centsFromTarget) <= 50;

  const pitchMarkerPercent =
    centsFromTarget === null
      ? 50
      : Math.max(
          4,
          Math.min(
            96,
            50 + centsFromTarget / 2,
          ),
        );

  const pitchGuideText =
    !voiceDetected
      ? `Sing ${NOTE} on “Ah” to start tracking your pitch.`
      : pitchOnTarget
        ? `Great — you're close to ${NOTE}. Keep the note and volume steady.`
        : `You're singing ${liveNote}. Gently adjust toward ${NOTE} and follow the marker.`;

  /* =======================================================

     LIVE GRAPH

     ======================================================= */



  const graphBars =

    useMemo(() => {

      if (

        liveHistory.length === 0

      ) {

        return [];

      }



      const minValue = -60;

      const maxValue = 0;



      return liveHistory.map(

        (

          item,

          index,

        ) => {

          const normalized =

            (item.value -

              minValue) /

            (maxValue -

              minValue);



          const barHeight =

            Math.max(

              4,

              Math.min(

                100,

                normalized *

                  100,

              ),

            );



          return {

            id: `${item.time}-${index}`,

            height:

              barHeight,

          };

        },

      );

    }, [liveHistory]);



  /* =======================================================

     HEADER

     ======================================================= */



  const renderHeader = () => (

    <View

      style={[

        styles.header,

        {

          paddingHorizontal:

            horizontalPadding,

        },

      ]}

    >

      <View

        style={styles.headerSide}

      >

        <Ionicons

          name="arrow-back"

          size={21}

          color="#222"

        />

      </View>



      <View

        style={

          styles.headerCenter

        }

      >

        <Text

          style={

            styles.headerTitle

          }

        >

          Volume Control

        </Text>



        <Text

          style={

            styles.headerSubtitle

          }

        >

          Exercise 5

        </Text>

      </View>



      <View

        style={styles.headerSide}

      />

    </View>

  );



  /* =======================================================

     DIRECTIONS

     ======================================================= */



  if (

    phase === 'directions'

  ) {

    return (

      <SafeAreaView

        style={styles.safeArea}

      >

        {renderHeader()}



        <ScrollView

          showsVerticalScrollIndicator={

            false

          }

          contentContainerStyle={[

            styles.scrollContent,

            {

              paddingHorizontal:

                horizontalPadding,

              paddingBottom:

                insets.bottom +

                18,

            },

          ]}

        >

          <View

            style={styles.heroIcon}

          >

            <Ionicons

              name="options-outline"

              size={31}

              color="#EC5A93"

            />

          </View>



          <Text

            style={

              styles.screenTitle

            }

          >

            Volume Control Stability

          </Text>



          <Text

            style={

              styles.screenDescription

            }

          >

            Sustain a comfortable C4

            note while keeping your

            vocal volume as steady as

            possible.

          </Text>



          {/* DIRECTIONS */}



          <View

            style={

              styles.directionsCard

            }

          >

            <Text

              style={

                styles.sectionLabel

              }

            >

              DIRECTIONS

            </Text>



            <DirectionRow

              number="1"

              text="Play the C4 reference and listen carefully."

            />



            <DirectionRow

              number="2"

              text="Take a comfortable breath before starting."

            />



            <DirectionRow

              number="3"

              text={`Sing C4 steadily for ${durationSeconds} seconds.`}

            />



            <DirectionRow

              number="4"

              text="Keep your vocal volume as consistent as possible."

            />



            <DirectionRow

              number="5"

              text={`Repeat the exercise ${repetitions} times.`}

            />

          </View>



          {/* PARAMETERS */}



          <View

            style={

              styles.parameterCard

            }

          >

            <Text

              style={

                styles.sectionLabel

              }

            >

              EXERCISE TARGET

            </Text>



            <View

              style={

                styles.parameterGrid

              }

            >

              <ParameterItem

                icon="musical-note-outline"

                value={NOTE}

                label="Note"

              />



              <ParameterItem

                icon="timer-outline"

                value={`${durationSeconds} sec`}

                label="Per repetition"

              />



              <ParameterItem

                icon="repeat-outline"

                value={`${repetitions}`}

                label="Repetitions"

              />



              <ParameterItem

                icon="analytics-outline"

                value={`${Math.round(

                  targetStability,

                )}%`}

                label="Stability target"

              />

            </View>

          </View>



          {/* REFERENCE */}



          <View

            style={

              styles.referenceCard

            }

          >

            <View

              style={

                styles.referenceTopRow

              }

            >

              <View>

                <Text

                  style={

                    styles.referenceLabel

                  }

                >

                  REFERENCE NOTE

                </Text>



                <Text

                  style={

                    styles.referenceNote

                  }

                >

                  {NOTE}

                </Text>

              </View>



              <View

                style={

                  styles.noteIconCircle

                }

              >

                <Ionicons

                  name="musical-note"

                  size={24}

                  color="#EC5A93"

                />

              </View>

            </View>



            <Text

              style={

                styles.referenceInstruction

              }

            >

              Listen to the C4 reference

              first, then sing the same

              note steadily during the

              exercise.

            </Text>



            <Pressable

              style={[

                styles.referenceButton,

                referencePlaying &&

                  styles.referenceButtonDisabled,

              ]}

              onPress={() =>

                void playReferenceNote()

              }

              disabled={

                referencePlaying

              }

            >

              {referencePlaying ? (

                <ActivityIndicator

                  color="#FFFFFF"

                />

              ) : (

                <>

                  <Ionicons

                    name="play"

                    size={18}

                    color="#FFFFFF"

                  />



                  <Text

                    style={

                      styles.referenceButtonText

                    }

                  >

                    Play C4 Reference

                  </Text>

                </>

              )}

            </Pressable>



            {hasPlayedReference && (

              <View

                style={

                  styles.referenceReadyRow

                }

              >

                <Ionicons

                  name="checkmark-circle"

                  size={17}

                  color="#2E9B62"

                />



                <Text

                  style={

                    styles.referenceReadyText

                  }

                >

                  C4 reference ready.

                </Text>

              </View>

            )}



            {referenceError && (

              <Text

                style={

                  styles.errorText

                }

              >

                {referenceError}

              </Text>

            )}

          </View>



          {/* TIP */}



          <View

            style={styles.tipCard}

          >

            <Ionicons

              name="bulb-outline"

              size={20}

              color="#EC5A93"

            />



            <Text

              style={styles.tipText}

            >

              Avoid intentionally getting

              louder or softer. Focus on

              one steady vocal output.

            </Text>

          </View>



          <Text

            style={styles.varianceText}

          >

            Target amplitude variation:

            ±

            {amplitudeVariancePercent}%

          </Text>



          {/* START */}



          <Pressable

            style={[

              styles.primaryButton,

              (!hasPlayedReference ||

                !paramsReady) &&

                styles.primaryButtonDisabled,

            ]}

            onPress={

              startExercise

            }

            disabled={

              !hasPlayedReference ||

              !paramsReady ||

              isStarting

            }

          >

            {isStarting ? (

              <ActivityIndicator

                color="#FFFFFF"

              />

            ) : (

              <>

                <Text

                  style={

                    styles.primaryButtonText

                  }

                >

                  Start Exercise

                </Text>



                <Ionicons

                  name="arrow-forward"

                  size={19}

                  color="#FFFFFF"

                />

              </>

            )}

          </Pressable>



          {!paramsReady ? (

            <Text

              style={

                styles.helperText

              }

            >

              Preparing your exercise...

            </Text>

          ) : !hasPlayedReference ? (

            <Text

              style={

                styles.helperText

              }

            >

              Play the C4 reference

              before starting.

            </Text>

          ) : null}

        </ScrollView>

      </SafeAreaView>

    );

  }



  /* =======================================================

     COUNTDOWN

     ======================================================= */



  if (

    phase === 'countdown'

  ) {

    return (

      <SafeAreaView

        style={styles.safeArea}

      >

        <View

          style={[

            styles.countdownScreen,

            {

              paddingHorizontal:

                horizontalPadding,

              paddingBottom:

                Math.max(

                  16,

                  insets.bottom,

                ),

            },

          ]}

        >

          <View

            style={

              styles.countdownTop

            }

          >

            <Text

              style={

                styles.countdownTitle

              }

            >

              Get Ready

            </Text>



            <Text

              style={

                styles.countdownInstruction

              }

            >

              Prepare to sing a steady

              C4.

            </Text>

          </View>



          <View

            style={

              styles.countdownCircle

            }

          >

            <Text

              style={

                styles.countdownNumber

              }

            >

              {countdown}

            </Text>

          </View>



          <View

            style={

              styles.countdownBottom

            }

          >

            <View

              style={

                styles.readyNoteBadge

              }

            >

              <Ionicons

                name="musical-note"

                size={17}

                color="#EC5A93"

              />



              <Text

                style={

                  styles.readyNoteText

                }

              >

                Reference: C4

              </Text>

            </View>



            <Text

              style={

                styles.countdownHint

              }

            >

              Breathe comfortably and

              get ready.

            </Text>

          </View>

        </View>

      </SafeAreaView>

    );

  }



  /* =======================================================

     ACTUAL EXERCISE

     ======================================================= */



  if (phase === 'exercise') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.exerciseContainer,
            {
              paddingHorizontal: horizontalPadding,
              paddingBottom: Math.max(14, insets.bottom),
            },
          ]}
        >
          {/* Exercise heading and timer */}
          <View style={styles.exerciseTop}>
            <View style={styles.exerciseHeadingCopy}>
              <Text style={styles.exerciseLabel}>VOICE TRAINING · VOLUME CONTROL</Text>
              <Text style={styles.exerciseNote}>{NOTE}</Text>
              <Text style={styles.exerciseGoal}>Hold one comfortable, steady note</Text>
            </View>

            <View style={styles.timerBadge}>
              <Ionicons name="time-outline" size={16} color="#D9578E" />
              <View>
                <Text style={styles.timerCaption}>TIME LEFT</Text>
                <Text style={styles.timerText}>{remainingSeconds}s</Text>
              </View>
            </View>
          </View>

          {/* Main tuner: the single focal point of the exercise */}
          <View style={styles.pitchCoachCard}>
            <View style={styles.pitchCoachHeader}>
              <View style={styles.pitchCoachIcon}>
                <Ionicons name="musical-notes" size={20} color="#D9578E" />
              </View>
              <View style={styles.pitchCoachHeaderCopy}>
                <Text style={styles.pitchCoachTitle}>Match the note</Text>
                <Text style={styles.pitchCoachSubtitle}>Sing “Ah” and follow the live marker</Text>
              </View>
              <View style={styles.pitchTargetBadge}>
                <Text style={styles.pitchTargetText}>TARGET {NOTE}</Text>
                <Text style={styles.pitchTargetFrequency}>{REFERENCE_NOTE.frequency.toFixed(1)} Hz</Text>
              </View>
            </View>

            <View style={styles.pitchReadoutPanel}>
              <Text style={styles.pitchReadoutLabel}>YOUR LIVE NOTE</Text>
              <Text
                style={[
                  styles.pitchDetectedNote,
                  voiceDetected && pitchOnTarget && styles.pitchDetectedNoteMatched,
                  !voiceDetected && styles.pitchDetectedNoteWaiting,
                ]}
              >
                {voiceDetected ? liveNote : 'Sing now'}
              </Text>
              <Text style={styles.pitchFrequency}>
                {voiceDetected && livePitch !== null
                  ? `${livePitch.toFixed(1)} Hz  ·  ${Math.round(liveVolume)} dBFS`
                  : 'Your detected note will appear here'}
              </Text>
              <View
                style={[
                  styles.pitchStatusBadge,
                  !voiceDetected && styles.pitchStatusIdle,
                  voiceDetected && pitchOnTarget && styles.pitchStatusMatched,
                  voiceDetected && !pitchOnTarget && styles.pitchStatusOffTarget,
                ]}
              >
                <Ionicons
                  name={
                    !voiceDetected
                      ? 'mic-outline'
                      : pitchOnTarget
                        ? 'checkmark-circle'
                        : 'arrow-up-circle-outline'
                  }
                  size={14}
                  color={voiceDetected && pitchOnTarget ? '#278451' : '#D9578E'}
                />
                <Text
                  style={[
                    styles.pitchStatusText,
                    voiceDetected && pitchOnTarget && styles.pitchStatusTextMatched,
                  ]}
                >
                  {!voiceDetected
                    ? 'LISTENING FOR YOUR VOICE'
                    : pitchOnTarget
                      ? 'ON TARGET'
                      : centsFromTarget !== null && centsFromTarget < 0
                        ? 'A LITTLE FLAT'
                        : 'A LITTLE SHARP'}
                </Text>
              </View>
            </View>

            {/* Fine pitch guide: the center line is the C4 target */}
            <View style={styles.pitchGaugeHeading}>
              <Text style={styles.pitchSectionLabel}>PITCH MATCH</Text>
              <Text style={styles.pitchSectionHint}>
                {centsFromTarget === null
                  ? 'Center the marker on C4'
                  : `${Math.abs(centsFromTarget)} cents from target`}
              </Text>
            </View>
            <View style={styles.pitchGauge}>
              <View style={styles.pitchTargetZone} />
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((tick) => (
                <View
                  key={`pitch-tick-${tick}`}
                  style={[styles.pitchGaugeTick, { left: `${tick * 10}%` }]}
                />
              ))}
              <View style={styles.pitchGaugeCenter} />
              {voiceDetected && centsFromTarget !== null && (
                <View
                  style={[
                    styles.pitchGaugeMarker,
                    pitchOnTarget && styles.pitchGaugeMarkerMatched,
                    { left: `${pitchMarkerPercent}%` },
                  ]}
                />
              )}
            </View>
            <View style={styles.pitchGaugeLabels}>
              <Text style={styles.pitchGaugeLabel}>FLAT</Text>
              <Text style={styles.pitchGaugeLabelTarget}>{NOTE} · IN TUNE</Text>
              <Text style={styles.pitchGaugeLabel}>SHARP</Text>
            </View>

            <View
              style={[
                styles.pitchFeedbackCard,
                voiceDetected && pitchOnTarget && styles.pitchFeedbackCardMatched,
              ]}
            >
              <Ionicons
                name={!voiceDetected ? 'mic-outline' : pitchOnTarget ? 'checkmark-circle' : 'ear-outline'}
                size={17}
                color={voiceDetected && pitchOnTarget ? '#278451' : '#D9578E'}
              />
              <Text
                style={[
                  styles.pitchFeedbackText,
                  voiceDetected && pitchOnTarget && styles.pitchFeedbackTextMatched,
                ]}
              >
                {pitchGuideText}
              </Text>
            </View>
          </View>

          {/* Keep the exercise's existing volume-stability measure */}
          <View style={styles.stabilityCard}>
            <View style={styles.stabilityHeader}>
              <View style={styles.stabilityTitleCopy}>
                <Text style={styles.stabilityTitle}>Volume stability</Text>
                <Text style={styles.stabilitySubtitle}>
                  Target {Math.round(targetStability)}% · keep your “Ah” even
                </Text>
              </View>
              <Text style={styles.stabilityValue}>{Math.round(liveStability)}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(100, liveStability)}%` },
                ]}
              />
              <View style={styles.stabilityTargetMarker} />
            </View>
            <View style={styles.progressLabels}>
              <Text style={styles.progressLabel}>Keep breathing</Text>
              <Text style={styles.progressLabel}>Steady voice</Text>
            </View>
          </View>

        </ScrollView>
      </SafeAreaView>
    );
  }


  /* =======================================================

     RESULTS

     ======================================================= */



  const finalScore =

    score?.overallScore ?? 0;



  const stabilityScore =

    measurement?.stability ?? 0;



  const durationScore =

    measurement?.durationScore ??

    0;



  const voicedCoverage =

    measurement?.voicedCoveragePercent ??

    0;



  const resultPassed =

    score?.passed ?? false;



  return (

    <SafeAreaView

      style={styles.safeArea}

    >

      <View

        style={

          styles.resultsScreen

        }

      >

        {/* RESULTS HEADER */}



        <View

          style={[

            styles.resultsHeader,

            {

              paddingHorizontal:

                horizontalPadding,

            },

          ]}

        >

          <View

            style={

              styles.headerSide

            }

          >

            <Ionicons

              name="arrow-back"

              size={21}

              color="#222"

            />

          </View>



          <View

            style={

              styles.resultsHeaderCenter

            }

          >

            <Text

              style={

                styles.headerTitle

              }

            >

              Volume Control

            </Text>



            <Text

              style={

                styles.headerSubtitle

              }

            >

              Exercise 5

            </Text>

          </View>



          <View

            style={

              styles.headerSide

            }

          />

        </View>



        {/* SCROLLABLE RESULTS */}



        <ScrollView

          style={

            styles.resultsScroll

          }

          contentContainerStyle={[

            styles.resultsScrollContent,

            {

              paddingHorizontal:

                horizontalPadding,

            },

          ]}

          showsVerticalScrollIndicator={

            false

          }

        >

          {/* STATUS */}



          <View

            style={[

              styles.resultStatusBadge,

              resultPassed

                ? styles.resultStatusPassed

                : styles.resultStatusPractice,

            ]}

          >

            <Ionicons

              name={

                resultPassed

                  ? 'checkmark-circle'

                  : 'refresh-circle'

              }

              size={13}

              color="#FFFFFF"

            />



            <Text

              style={

                styles.resultStatusText

              }

            >

              {resultPassed

                ? 'TARGET REACHED'

                : 'KEEP PRACTICING'}

            </Text>

          </View>



          <Text

            style={

              styles.resultTitle

            }

          >

            Volume Stability Results

          </Text>



          <Text

            style={

              styles.resultDescription

            }

          >

            {score?.feedback ??

              'Your result has been calculated based on your volume stability and vocal coverage.'}

          </Text>



          {/* SCORE */}



          <View

            style={

              styles.resultScoreSection

            }

          >

            <View

              style={

                styles.resultScoreCircle

              }

            >

              <Text

                style={

                  styles.resultScoreNumber

                }

              >

                {Math.round(

                  finalScore,

                )}

              </Text>



              <Text

                style={

                  styles.resultScoreOutOf

                }

              >

                /100

              </Text>

            </View>



            <Text

              style={

                styles.resultScoreLabel

              }

            >

              Overall Stability Score

            </Text>

          </View>



          {/* BREAKDOWN */}



          <View

            style={

              styles.compactResultsCard

            }

          >

            <CompactResultRow

              label="Repetition 1"

              value={`${Math.round(

                measurement

                  ?.repStability?.[0] ??

                  0,

              )}%`}

            />



            <CompactResultRow

              label="Repetition 2"

              value={`${Math.round(

                measurement

                  ?.repStability?.[1] ??

                  0,

              )}%`}

            />



            <CompactResultRow

              label="Volume Stability"

              value={`${Math.round(

                stabilityScore,

              )}%`}

            />



            <CompactResultRow

              label="Duration Score"

              value={`${Math.round(

                durationScore,

              )}%`}

            />



            <CompactResultRow

              label="Average Volume"

              value={

                measurement?.averageDb !==

                undefined

                  ? `${Math.round(

                      measurement.averageDb,

                    )} dB`

                  : '--'

              }

            />



            <CompactResultRow

              label="Voiced Coverage"

              value={`${Math.round(

                voicedCoverage,

              )}%`}

            />



            <CompactResultRow

              label="Measurement Quality"

              value={`${Math.round(

                measurement

                  ?.measurementQuality ??

                  0,

              )}%`}

              isLast

            />

          </View>



          {/* FORMULA */}



          <View

            style={

              styles.formulaCard

            }

          >

            <Text

              style={

                styles.formulaTitle

              }

            >

              Score Formula

            </Text>



            <Text

              style={

                styles.formulaMain

              }

            >

              Stability × 70% + Duration × 30%

            </Text>



            <Text

              style={

                styles.formulaDescription

              }

            >

              The final score combines

              volume stability and

              sustained vocal coverage.

            </Text>

          </View>



          {/* TARGET */}



          <View

            style={

              styles.targetCompactCard

            }

          >

            <View

              style={

                styles.targetCompactItem

              }

            >

              <Text

                style={

                  styles.targetCompactLabel

                }

              >

                Reference

              </Text>



              <Text

                style={

                  styles.targetCompactValue

                }

              >

                {NOTE}

              </Text>

            </View>



            <View

              style={

                styles.targetCompactDivider

              }

            />



            <View

              style={

                styles.targetCompactItem

              }

            >

              <Text

                style={

                  styles.targetCompactLabel

                }

              >

                Duration

              </Text>



              <Text

                style={

                  styles.targetCompactValue

                }

              >

                {durationSeconds} sec ×{' '}

                {repetitions}

              </Text>

            </View>



            <View

              style={

                styles.targetCompactDivider

              }

            />



            <View

              style={

                styles.targetCompactItem

              }

            >

              <Text

                style={

                  styles.targetCompactLabel

                }

              >

                Target

              </Text>



              <Text

                style={

                  styles.targetCompactValue

                }

              >

                {Math.round(

                  targetStability,

                )}

                %

              </Text>

            </View>

          </View>

        </ScrollView>



        {/* FIXED BOTTOM BUTTON */}



        <View

          style={[

            styles.resultsFooter,

            {

              paddingHorizontal:

                horizontalPadding,

              paddingBottom:

                Math.max(

                  10,

                  insets.bottom,

                ),

            },

          ]}

        >

          <Pressable

            style={

              styles.primaryButton

            }

            onPress={

              resetExercise

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

              size={19}

              color="#FFFFFF"

            />

          </Pressable>

          <Pressable
            style={styles.backToListButton}
            onPress={() => router.replace('/exercises/volume' as any)}
            accessibilityRole="button"
            accessibilityLabel="Back to exercise list"
          >
            <Ionicons name="arrow-back" size={17} color="#D9578E" />
            <Text style={styles.backToListButtonText}>Back to Exercise List</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );

}

function ParameterItem({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <View
      style={
        styles.parameterItem
      }
    >
      <Ionicons
        name={icon}
        size={19}
        color="#EC5A93"
      />

      <Text
        style={
          styles.parameterValue
        }
      >
        {value}
      </Text>

      <Text
        style={
          styles.parameterLabel
        }
      >
        {label}
      </Text>
    </View>
  );
}

function DirectionRow({
  number,
  text,
}: {
  number: string;
  text: string;
}) {
  return (
    <View
      style={
        styles.directionRow
      }
    >
      <View
        style={
          styles.directionNumber
        }
      >
        <Text
          style={
            styles.directionNumberText
          }
        >
          {number}
        </Text>
      </View>
      <Text
        style={
          styles.directionText
        }
      >
        {text}
      </Text>
    </View>
  );
}

function CompactResultRow({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View
      style={[
        styles.compactResultRow,
        !isLast &&
          styles.compactResultRowBorder,
      ]}
    >
      <Text
        style={
          styles.compactResultLabel
        }
      >
        {label}
      </Text>
      <Text
        style={
          styles.compactResultValue
        }
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  
  safeArea: {
    flex: 1,
    backgroundColor: '#FFF8FB',
  },

  /* HEADER */

  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  headerSide: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },

  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#242124',
  },

  headerSubtitle: {
    marginTop: 1,
    fontSize: 10,
    color: '#8C8589',
  },

  /* SCROLL */

  scrollContent: {
    paddingTop: 8,
    gap: 12,
  },

  /* HERO */

  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFE5EF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },

  screenTitle: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
    color: '#2E272B',
    textAlign: 'center',
  },

  screenDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: '#777176',
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  /* REFERENCE */

  referenceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    elevation: 2,
  },

  referenceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  referenceLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#999197',
  },

  referenceNote: {
    marginTop: 1,
    fontSize: 31,
    fontWeight: '900',
    color: '#EC5A93',
  },

  noteIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFF0F6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  referenceInstruction: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: '#6F686D',
  },

  referenceButton: {
    marginTop: 12,
    minHeight: 47,
    borderRadius: 14,
    backgroundColor: '#EC5A93',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  referenceButtonDisabled: {
    opacity: 0.7,
  },

  referenceButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },

  referenceReadyRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  referenceReadyText: {
    flex: 1,
    fontSize: 11,
    color: '#2E9B62',
    fontWeight: '600',
  },

  errorText: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 16,
    color: '#C54545',
  },

  /* PARAMETERS */

  parameterCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    elevation: 2,
  },

  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '800',
    color: '#999197',
  },

  parameterGrid: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },

  parameterItem: {
    width: '48%',
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: '#FFF5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  parameterValue: {
    marginTop: 3,
    fontSize: 16,
    fontWeight: '800',
    color: '#302A2E',
  },

  parameterLabel: {
    marginTop: 1,
    fontSize: 10,
    color: '#8D858A',
    textAlign: 'center',
  },

  /* DIRECTIONS */

  directionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    elevation: 2,
  },

  directionRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },

  directionNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFE5EF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  directionNumberText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#EC5A93',
  },

  directionText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#4D474B',
  },

  tipCard: {
    minHeight: 48,
    borderRadius: 15,
    paddingHorizontal: 13,
    backgroundColor: '#FFF0F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  tipText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: '#655D62',
  },

  varianceText: {
    fontSize: 10,
    color: '#8E878B',
    textAlign: 'center',
  },

  helperText: {
    marginTop: -4,
    textAlign: 'center',
    fontSize: 10,
    color: '#A0989D',
  },

  /* BUTTON */

  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: '#EC5A93',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },

  primaryButtonDisabled: {
    backgroundColor: '#D9B4C2',
  },

  primaryButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  /* COUNTDOWN */

  countdownScreen: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 35,
  },

  countdownTop: {
    alignItems: 'center',
  },

  countdownTitle: {
    fontSize: 27,
    fontWeight: '900',
    color: '#2E272B',
  },

  countdownInstruction: {
    marginTop: 6,
    fontSize: 13,
    color: '#7C7479',
    textAlign: 'center',
  },

  countdownCircle: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#FFE5EF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  countdownNumber: {
    fontSize: 72,
    fontWeight: '900',
    color: '#EC5A93',
  },

  countdownBottom: {
    alignItems: 'center',
  },

  readyNoteBadge: {
    minHeight: 37,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: '#FFF0F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  readyNoteText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5F575C',
  },

  countdownHint: {
    marginTop: 8,
    fontSize: 11,
    color: '#8A8287',
  },

  /* EXERCISE */

  exerciseContainer: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    gap: 13,
    paddingTop: 13,
    paddingBottom: 18,
    backgroundColor: '#FFF8FB',
  },

  exerciseTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  exerciseLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.15,
    color: '#B67A91',
  },



  exerciseNote: {
    marginTop: 2,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '900',
    color: '#5A343D',
  },



  timerBadge: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0DDE5',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    elevation: 2,
  },



  timerText: {
    fontSize: 16,
    lineHeight: 19,
    fontWeight: '900',
    color: '#3D363B',
  },



  mainVolumeCard: {

    minHeight: 195,

    borderRadius: 22,

    backgroundColor: '#FFFFFF',

    alignItems: 'center',

    justifyContent: 'center',

    elevation: 2,

  },



  mainVolumeCardSmall: {

    minHeight: 155,

  },



  liveLabel: {

    fontSize: 9,

    letterSpacing: 1,

    fontWeight: '800',

    color: '#999197',

  },



  liveVolumeText: {

    marginTop: 2,

    fontSize: 40,

    lineHeight: 45,

    fontWeight: '900',

    color: '#282226',

  },



  liveVolumeTextSmall: {

    fontSize: 32,

    lineHeight: 37,

  },



  volumePulseCircle: {

    marginTop: 7,

    width: 58,

    height: 58,

    borderRadius: 29,

    backgroundColor: '#EC5A93',

    alignItems: 'center',

    justifyContent: 'center',

  },



  volumeStatus: {
    marginTop: 7,
    paddingHorizontal: 12,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    color: '#7D757A',
  },



  /* LIVE PITCH TRACKER */

  pitchTrackerCard: {
    padding: 15,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0DDE5',
    elevation: 3,
    gap: 12,
  },

  pitchTrackerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },

  pitchTrackerHeadingCopy: {
    flex: 1,
  },

  pitchTrackerTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#332D31',
  },

  pitchTrackerSubtitle: {
    marginTop: 3,
    fontSize: 10,
    color: '#8F878C',
  },

  pitchTargetBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 13,
    backgroundColor: '#FFF0F6',
    alignItems: 'center',
  },

  pitchTargetText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.45,
    color: '#D9578E',
  },

  pitchReadoutRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },

  pitchReadoutCopy: {
    flex: 1,
  },

  pitchReadoutLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#999197',
  },

  pitchDetectedRow: {
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
  },


  pitchFrequency: {
    fontSize: 9,
    color: '#8F878C',
  },

  pitchStatusBadge: {
    minHeight: 26,
    paddingHorizontal: 8,
    borderRadius: 13,
    backgroundColor: '#FFF0F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  pitchStatusIdle: {
    backgroundColor: '#F5F1F3',
  },

  pitchStatusMatched: {
    backgroundColor: '#EAF7EF',
  },

  pitchStatusOffTarget: {
    backgroundColor: '#FFF0F6',
  },

  pitchStatusText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#D9578E',
  },

  pitchStatusTextMatched: {
    color: '#278451',
  },

  pitchGauge: {
    position: 'relative',
    marginTop: 3,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F5EBEF',
    overflow: 'visible',
  },

  pitchGaugeCenter: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: '#927482',
  },

  pitchGaugeMarker: {
    position: 'absolute',
    top: 2,
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: '#EC5A93',
    elevation: 3,
  },

  pitchGaugeLabels: {
    marginTop: -7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  pitchGaugeLabel: {
    fontSize: 8,
    color: '#A0989D',
  },

  pitchGaugeLabelTarget: {
    fontSize: 8,
    fontWeight: '900',
    color: '#927482',
  },

  pitchFeedbackCard: {
    marginTop: 0,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: '#FFF4F8',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  pitchFeedbackCardMatched: {
    backgroundColor: '#EFF8F2',
  },

  pitchFeedbackText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: '#71696E',
  },

  pitchFeedbackTextMatched: {
    color: '#278451',
  },

  /* STABILITY */



  stabilityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 15,
    borderWidth: 1,
    borderColor: '#F0DDE5',
    elevation: 2,
  },



  stabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  stabilityTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#332D31',
  },

  stabilitySubtitle: {
    marginTop: 3,
    fontSize: 10,
    color: '#8F878C',
  },

  stabilityValue: {
    fontSize: 25,
    fontWeight: '900',
    color: '#EC5A93',
  },

  progressTrack: {
    marginTop: 12,
    height: 10,
    borderRadius: 6,
    backgroundColor: '#F0E7EB',
    overflow: 'hidden',
    position: 'relative',
  },

  progressFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#EC5A93',
  },

  progressLabels: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  progressLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#A0989D',
  },

  exerciseHeadingCopy: {
    flex: 1,
    gap: 1,
  },

  exerciseGoal: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 14,
    color: '#8F878C',
  },

  timerCaption: {
    fontSize: 7,
    lineHeight: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: '#A0989D',
  },

  pitchCoachCard: {
    padding: 15,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0DDE5',
    elevation: 3,
    gap: 12,
  },

  pitchCoachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  pitchCoachIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: '#FFF0F6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  pitchCoachHeaderCopy: {
    flex: 1,
  },

  pitchCoachTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#4B303A',
  },

  pitchCoachSubtitle: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 14,
    color: '#8F878C',
  },

  pitchTargetFrequency: {
    marginTop: 2,
    fontSize: 8,
    fontWeight: '700',
    color: '#C26D8D',
  },

  pitchReadoutPanel: {
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 18,
    alignItems: 'center',
    backgroundColor: '#FFF7FA',
    borderWidth: 1,
    borderColor: '#F7E5EC',
  },

  pitchDetectedNote: {
    marginTop: 1,
    fontSize: 42,
    lineHeight: 47,
    fontWeight: '900',
    color: '#D9578E',
    textAlign: 'center',
  },

  pitchDetectedNoteMatched: {
    color: '#278451',
  },

  pitchDetectedNoteWaiting: {
    fontSize: 30,
    color: '#C5B7BE',
  },

  pitchGaugeHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: -5,
  },

  pitchSectionLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#5A343D',
  },

  pitchSectionHint: {
    fontSize: 9,
    color: '#8F878C',
  },

  pitchTargetZone: {
    position: 'absolute',
    left: '25%',
    width: '50%',
    top: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: '#EAF7EF',
    borderWidth: 1,
    borderColor: '#D3EDDC',
  },

  pitchGaugeTick: {
    position: 'absolute',
    top: 7,
    bottom: 7,
    width: 1,
    backgroundColor: '#E1D0D8',
  },

  pitchGaugeMarkerMatched: {
    backgroundColor: '#278451',
  },

  pitchTrailCard: {
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#FFFAFC',
    borderWidth: 1,
    borderColor: '#F4E5EB',
  },

  pitchTrailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },

  pitchTrailTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#4B303A',
  },

  pitchTrailSubtitle: {
    marginTop: 2,
    fontSize: 8,
    color: '#95868D',
  },

  liveDotLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: '#FFF0F6',
  },

  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#EC5A93',
  },

  liveDotText: {
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.6,
    color: '#D9578E',
  },

  pitchTrailGraph: {
    height: 58,
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F8EEF2',
  },

  pitchTrailTargetLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: '#927482',
    zIndex: 1,
  },

  pitchTrailColumns: {
    position: 'absolute',
    left: 5,
    right: 5,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },

  pitchTrailColumn: {
    flex: 1,
    height: '100%',
    position: 'relative',
  },

  pitchTrailDot: {
    position: 'absolute',
    left: '50%',
    marginLeft: -3,
    marginTop: -3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D9578E',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    zIndex: 2,
  },

  pitchTrailDotMatched: {
    backgroundColor: '#278451',
  },

  pitchTrailPlaceholder: {
    position: 'absolute',
    left: 6,
    right: 6,
    top: '38%',
    fontSize: 8,
    textAlign: 'center',
    color: '#A0989D',
  },

  pitchTrailLabels: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  pitchTrailScaleText: {
    fontSize: 7,
    fontWeight: '700',
    color: '#A0989D',
  },

  pitchTrailScaleTarget: {
    fontSize: 7,
    fontWeight: '900',
    color: '#927482',
  },

  coachingCueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 17,
    backgroundColor: '#FFF0F6',
    borderWidth: 1,
    borderColor: '#F8DFE9',
  },

  coachingCueIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },

  coachingCueCopy: {
    flex: 1,
  },

  coachingCueTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#5A343D',
  },

  coachingCueText: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 15,
    color: '#76616A',
  },

  stabilityTitleCopy: {
    flex: 1,
  },

  stabilityTargetMarker: {
    position: 'absolute',
    left: '60%',
    top: -2,
    bottom: -2,
    width: 2,
    borderRadius: 1,
    backgroundColor: '#5A343D',
  },

  graphCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 12,
    elevation: 2,
  },

  graphHeader: {
    marginBottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  graphTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#332D31',
  },

  graphUnit: {
    fontSize: 9,
    color: '#A0989D',
  },

  graph: {
    height: 72,
    borderRadius: 11,
    backgroundColor: '#FFF7FA',
    overflow: 'hidden',
    paddingHorizontal: 4,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },

  graphSmall: {
    height: 57,
  },

  graphCenterLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: '#F2DDE5',
  },

  graphBar: {
    width: 4,
    minHeight: 4,
    borderRadius: 2,
    backgroundColor: '#EC5A93',
  },

  graphPlaceholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '35%',
    textAlign: 'center',
    fontSize: 9,
    color: '#AAA1A7',
  },

  exerciseHintCard: {
    minHeight: 43,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: '#FFF0F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  exerciseHintText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    color: '#71696E',
  },

  resultsScreen: {
    flex: 1,
    backgroundColor: '#FFF8FB',
  },

  resultsHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  resultsHeaderCenter: {
    flex: 1,
    alignItems: 'center'
  },

  resultsScroll: {
    flex: 1,
  },

  resultsScrollContent: {
    paddingTop: 7,
    paddingBottom: 10,
  },

  resultStatusBadge: {
    alignSelf: 'center',
    minHeight: 25,
    paddingHorizontal: 10,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  resultStatusPassed: {
    backgroundColor: '#2E9B62',
  },

  resultStatusPractice: {
    backgroundColor: '#EC5A93',
  },

  resultStatusText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.7,
  },

  resultTitle: {
    marginTop: 8,
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
    color: '#3A3035',
    textAlign: 'center',
  },

  resultDescription: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 15,
    color: '#81777D',
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  resultScoreSection: {
    marginTop: 9,
    alignItems: 'center',
  },

  resultScoreCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#F9D5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },

  resultScoreNumber: {
    fontSize: 31,
    lineHeight: 35,
    fontWeight: '900',
    color: '#2F252A',
  },

  resultScoreOutOf: {
    fontSize: 8,
    color: '#81777D',
  },

  resultScoreLabel: {
    marginTop: 3,
    fontSize: 8.5,
    fontWeight: '700',
    color: '#EC5A93',
  },

  compactResultsCard: {
    marginTop: 9,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F0D9E2',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },

  compactResultRow: {
    minHeight: 27,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  compactResultRowBorder: {
    borderBottomWidth:
      StyleSheet.hairlineWidth,
    borderBottomColor: '#EDE3E7',
  },

  compactResultLabel: {
    fontSize: 9,
    color: '#81777D',
  },

  compactResultValue: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#3A3035',
  },

  formulaCard: {
    marginTop: 7,
    borderRadius: 14,
    backgroundColor: '#FFF0F6',
    paddingHorizontal: 11,
    paddingVertical: 8,
  },

  formulaTitle: {
    fontSize: 8,
    fontWeight: '800',
    color: '#534950',
  },

  formulaMain: {
    marginTop: 2,
    fontSize: 9.5,
    fontWeight: '800',
    color: '#EC5A93',
  },

  formulaDescription: {
    marginTop: 1,
    fontSize: 7.5,
    lineHeight: 11,
    color: '#81777D',
  },

  targetCompactCard: {
    marginTop: 7,
    minHeight: 47,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    elevation: 1,
  },

  targetCompactItem: {
    flex: 1,
    alignItems: 'center',
  },

  targetCompactLabel: {
    fontSize: 7.5,
    color: '#968D92',
  },

  targetCompactValue: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '800',
    color: '#3A3035',
  },

  targetCompactDivider: {
    width: StyleSheet.hairlineWidth,
    height: 25,
    backgroundColor: '#E8DEE2',
  },

  resultsFooter: {
    paddingTop: 7,
    backgroundColor: '#FFF8FB',
  },

  backToListButton: {
    minHeight: 44,
    marginTop: 8,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#F0C8D7',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },

  backToListButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#D9578E',
  },

});
