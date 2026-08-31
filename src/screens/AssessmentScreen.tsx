import {
  useCallback,
  useMemo,
  useState,
} from 'react';

import {
  router,
} from 'expo-router';

import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import {
  ASSESSMENT_DURATION,
  AssessmentAudioBundle,
  AssessmentResult,
  runAssessment,
} from '@/services/assessment/assessmentModule';

import {
  LiveAudioFrame,
  useAudioRecorder,
} from '@/hooks/useAudioRecorder';


// ============================================================
// COLORS
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const LIGHT_GRAY = '#F2F2F2';


// ============================================================
// TYPES
// ============================================================

type AssessmentStep =
  | 'intro'
  | 'breathControl'
  | 'pitch'
  | 'tone'
  | 'volume'
  | 'agility'
  | 'lowest'
  | 'highest'
  | 'processing'
  | 'results';


// ============================================================
// STEP ORDER
// ============================================================

const STEP_ORDER: AssessmentStep[] = [
  'breathControl',
  'pitch',
  'tone',
  'volume',
  'agility',
  'lowest',
  'highest',
];


// ============================================================
// HELPERS
// ============================================================

function getStepTitle(
  step: AssessmentStep
): string {
  switch (step) {
    case 'breathControl':
      return 'Breath Control';

    case 'pitch':
      return 'Pitch';

    case 'tone':
      return 'Tone';

    case 'volume':
      return 'Volume';

    case 'agility':
      return 'Agility';

    case 'lowest':
      return 'Lowest Comfortable Note';

    case 'highest':
      return 'Highest Comfortable Note';

    default:
      return '';
  }
}


function getStepInstruction(
  step: AssessmentStep
): string {
  switch (step) {
    case 'breathControl':
      return 'Take a deep breath, then slowly exhale on "sss" for as long and steadily as you can.';

    case 'pitch':
      return 'Sing a comfortable sustained note. Try to keep the pitch steady.';

    case 'tone':
      return 'Sing "ah" comfortably and maintain a consistent tone throughout the recording.';

    case 'volume':
      return 'Start softly and gradually increase your volume, then gradually decrease it.';

    case 'agility':
      return 'Sing a comfortable sequence of quick notes. Focus on making your transitions clear and controlled.';

    case 'lowest':
      return 'Sing the lowest note that feels comfortable. Do not strain your voice. Hold it steadily.';

    case 'highest':
      return 'Sing the highest note that feels comfortable. Do not strain your voice. Hold it steadily.';

    default:
      return '';
  }
}


function getStepDuration(
  step: AssessmentStep
): number {
  switch (step) {
    case 'breathControl':
      return ASSESSMENT_DURATION.breathControl;

    case 'pitch':
      return ASSESSMENT_DURATION.pitch;

    case 'tone':
      return ASSESSMENT_DURATION.tone;

    case 'volume':
      return ASSESSMENT_DURATION.volume;

    case 'agility':
      return ASSESSMENT_DURATION.agility;

    case 'lowest':
    case 'highest':
      return ASSESSMENT_DURATION.comfortableNote;

    default:
      return 0;
  }
}


// ============================================================
// SCREEN
// ============================================================

export default function AssessmentScreen() {
  const [
    step,
    setStep,
  ] =
    useState<AssessmentStep>(
      'intro'
    );


  const [
    isRecordingSection,
    setIsRecordingSection,
  ] =
    useState(false);


  const [
    remainingSeconds,
    setRemainingSeconds,
  ] =
    useState(0);


  const [
    result,
    setResult,
  ] =
    useState<AssessmentResult | null>(
      null
    );


  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );


  // ==========================================================
  // LIVE AUDIO DATA
  // ==========================================================

  const [
    liveAudio,
    setLiveAudio,
  ] =
    useState<LiveAudioFrame | null>(
      null
    );


  // ==========================================================
  // COMPLETE ASSESSMENT AUDIO
  // ==========================================================

  const [
    sections,
    setSections,
  ] =
    useState<
      Partial<
        Record<
          AssessmentStep,
          Float32Array
        >
      >
    >({});


  // ==========================================================
  // NEXT STEP
  // ==========================================================

  const moveToNextStep =
    useCallback(
      (
        currentStep: AssessmentStep
      ) => {
        const index =
          STEP_ORDER.indexOf(
            currentStep
          );


        if (
          index === -1
        ) {
          return;
        }


        const nextStep =
          STEP_ORDER[
            index + 1
          ];


        if (
          nextStep
        ) {
          setStep(
            nextStep
          );
        } else {
          setStep(
            'processing'
          );
        }
      },
      []
    );


  // ==========================================================
  // RECORDER OPTIONS
  // ==========================================================

  const recorderOptions =
    useMemo(
      () => ({
        // ------------------------------------------------------
        // LIVE DATA
        // ------------------------------------------------------

        onFrame: (
          frame: LiveAudioFrame
        ) => {
          setLiveAudio(
            frame
          );
        },


        // ------------------------------------------------------
        // COMPLETE RECORDING
        // ------------------------------------------------------

        onStop: (
          samples: Float32Array,
          _sampleRate: number
        ) => {
          /*
           * Save the complete recording for
           * the current assessment section.
           */

          const currentStep =
            step;


          setSections(
            previous => ({
              ...previous,

              [currentStep]:
                samples,
            })
          );


          setIsRecordingSection(
            false
          );


          /*
           * Reset live display after recording.
           */
          setLiveAudio(
            null
          );


          /*
           * Continue automatically.
           */
          setTimeout(
            () => {
              moveToNextStep(
                currentStep
              );
            },
            150
          );
        },
      }),
      [
        step,
        moveToNextStep,
      ]
    );


  const {
    startRecording,
    stopRecording,
    isRecording,
  } =
    useAudioRecorder(
      recorderOptions
    );


  // ==========================================================
  // START SECTION
  // ==========================================================

  const beginSection =
    async () => {
      setError(
        null
      );

      setLiveAudio(
        null
      );


      const duration =
        getStepDuration(
          step
        );


      if (
        duration <= 0
      ) {
        return;
      }


      try {
        setRemainingSeconds(
          duration
        );

        setIsRecordingSection(
          true
        );


        await startRecording();


        let remaining =
          duration;


        const interval =
          setInterval(
            () => {
              remaining -=
                1;


              setRemainingSeconds(
                remaining
              );


              if (
                remaining <=
                0
              ) {
                clearInterval(
                  interval
                );


                stopRecording();
              }
            },
            1000
          );
      } catch (
        err
      ) {
        console.error(
          'Assessment recording error:',
          err
        );


        setIsRecordingSection(
          false
        );


        setLiveAudio(
          null
        );


        setError(
          'Unable to start the microphone. Please check your microphone permission and try again.'
        );
      }
    };


  // ==========================================================
  // BUILD AUDIO BUNDLE
  // ==========================================================

  const createAssessmentBundle =
    (): AssessmentAudioBundle => {
      const empty =
        new Float32Array(
          0
        );


      return {
        breathControlSamples:
          sections.breathControl ??
          empty,

        pitchSamples:
          sections.pitch ??
          empty,

        toneSamples:
          sections.tone ??
          empty,

        volumeSamples:
          sections.volume ??
          empty,

        agilitySamples:
          sections.agility ??
          empty,

        lowestComfortableNoteSamples:
          sections.lowest ??
          empty,

        highestComfortableNoteSamples:
          sections.highest ??
          empty,

        sampleRate:
          44100,
      };
    };


  // ==========================================================
  // RUN FINAL ASSESSMENT
  // ==========================================================

  const processAssessment =
    () => {
      try {
        setError(
          null
        );


        const audio =
          createAssessmentBundle();


        const assessmentResult =
          runAssessment(
            audio
          );


        setResult(
          assessmentResult
        );


        setStep(
          'results'
        );
      } catch (
        err
      ) {
        console.error(
          'Assessment processing error:',
          err
        );


        setError(
          err instanceof Error
            ? err.message
            : 'Unable to process the assessment.'
        );


        setStep(
          'highest'
        );
      }
    };


  // ==========================================================
  // PROCESSING
  // ==========================================================

  if (
    step === 'processing'
  ) {
    return (
      <View
        style={
          styles.centerScreen
        }
      >
        <ActivityIndicator
          size="large"
          color={BROWN}
        />


        <Text
          style={
            styles.processingTitle
          }
        >
          Analyzing your voice...
        </Text>


        <Text
          style={
            styles.processingText
          }
        >
          We're checking your five vocal fundamentals
          and vocal range.
        </Text>


        {error && (
          <View
            style={
              styles.errorCard
            }
          >
            <Text
              style={
                styles.errorText
              }
            >
              {error}
            </Text>
          </View>
        )}


        <Pressable
          style={
            styles.primaryButton
          }
          onPress={
            processAssessment
          }
        >
          <Text
            style={
              styles.primaryButtonText
            }
          >
            Analyze My Voice
          </Text>
        </Pressable>
      </View>
    );
  }


  // ==========================================================
  // RESULTS
  // ==========================================================

  if (
    step === 'results' &&
    result
  ) {
    return (
      <ScrollView
        style={
          styles.screen
        }
        contentContainerStyle={
          styles.resultsContent
        }
      >
        <Text
          style={
            styles.resultsTitle
          }
        >
          Your Vocal Assessment
        </Text>


        <Text
          style={
            styles.resultsSubtitle
          }
        >
          Here's your current vocal foundation.
        </Text>


        {/* VOCAL RANGE */}

        <View
          style={
            styles.rangeCard
          }
        >
          <Text
            style={
              styles.cardTitle
            }
          >
            Vocal Range
          </Text>


          <Text
            style={
              styles.rangeText
            }
          >
            {result.vocalRangeLowHz.toFixed(
              1
            )}
            {' Hz'}
            {'  –  '}
            {result.vocalRangeHighHz.toFixed(
              1
            )}
            {' Hz'}
          </Text>
        </View>


        {/* COMPONENT SCORES */}

        {result.scores.map(
          score => {
            const recommendation =
              result.recommendations[
                score.componentId
              ];


            return (
              <View
                key={
                  score.componentId
                }
                style={
                  styles.scoreCard
                }
              >
                <View
                  style={
                    styles.scoreHeader
                  }
                >
                  <Text
                    style={
                      styles.scoreName
                    }
                  >
                    {
                      score.componentId ===
                      'breathControl'
                        ? 'Breath Control'
                        : score.componentId
                    }
                  </Text>


                  <Text
                    style={
                      styles.scoreValue
                    }
                  >
                    {
                      score.scorePct
                    }%
                  </Text>
                </View>


                <View
                  style={
                    styles.progressBackground
                  }
                >
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width:
                          `${score.scorePct}%`,
                      },
                    ]}
                  />
                </View>


                <Text
                  style={
                    styles.recommendation
                  }
                >
                  {
                    recommendation ===
                    'needsSignificantImprovement'
                      ? 'Needs significant improvement'
                      : recommendation ===
                        'moderateImprovement'
                      ? 'Moderate improvement'
                      : 'Good foundation'
                  }
                </Text>
              </View>
            );
          }
        )}


        {/* RETAKE */}

        <Pressable
          style={
            styles.primaryButton
          }
          onPress={() => {
            setSections(
              {}
            );

            setResult(
              null
            );

            setError(
              null
            );

            setLiveAudio(
              null
            );

            setStep(
              'intro'
            );
          }}
        >
          <Text
            style={
              styles.primaryButtonText
            }
          >
            Retake Assessment
          </Text>
        </Pressable>
      </ScrollView>
    );
  }


  // ==========================================================
  // INTRO
  // ==========================================================

  if (
    step === 'intro'
  ) {
    return (
      <ScrollView
        style={
          styles.screen
        }
        contentContainerStyle={
          styles.content
        }
      >
        {/* BACK BUTTON */}

        <Pressable
          style={
            styles.backButton
          }
          onPress={() =>
            router.back()
          }
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={BROWN}
          />
        </Pressable>


        <View
          style={
            styles.iconCircle
          }
        >
          <Ionicons
            name="mic"
            size={32}
            color={BROWN}
          />
        </View>


        <Text
          style={
            styles.title
          }
        >
          Vocal Assessment
        </Text>


        <Text
          style={
            styles.description
          }
        >
          Let's find your vocal strengths and
          identify which areas you can improve.
        </Text>


        <View
          style={
            styles.infoCard
          }
        >
          <Text
            style={
              styles.cardTitle
            }
          >
            What we'll check
          </Text>


          <Text
            style={
              styles.infoItem
            }
          >
            • Breath Control
          </Text>


          <Text
            style={
              styles.infoItem
            }
          >
            • Pitch
          </Text>


          <Text
            style={
              styles.infoItem
            }
          >
            • Tone
          </Text>


          <Text
            style={
              styles.infoItem
            }
          >
            • Volume
          </Text>


          <Text
            style={
              styles.infoItem
            }
          >
            • Agility
          </Text>


          <Text
            style={
              styles.infoItem
            }
          >
            • Vocal Range
          </Text>
        </View>


        <Text
          style={
            styles.warning
          }
        >
          Find a quiet place and make sure your
          microphone is not covered.
        </Text>


        <Pressable
          style={
            styles.primaryButton
          }
          onPress={() =>
            setStep(
              'breathControl'
            )
          }
        >
          <Text
            style={
              styles.primaryButtonText
            }
          >
            Start Assessment
          </Text>


          <Ionicons
            name="arrow-forward"
            size={18}
            color={WHITE}
          />
        </Pressable>
      </ScrollView>
    );
  }


  // ==========================================================
  // ASSESSMENT SECTION
  // ==========================================================

  const duration =
    getStepDuration(
      step
    );


  const isSection =
    STEP_ORDER.includes(
      step
    );


  if (
    isSection
  ) {
    const stepIndex =
      STEP_ORDER.indexOf(
        step
      );


    const progress =
      (
        stepIndex + 1
      ) /
      STEP_ORDER.length;


    return (
      <ScrollView
        style={
          styles.screen
        }
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={
          false
        }
      >
        {/* PROGRESS */}

        <View
          style={
            styles.progressHeader
          }
        >
          <Text
            style={
              styles.progressText
            }
          >
            Step {stepIndex + 1} of {STEP_ORDER.length}
          </Text>


          <Text
            style={
              styles.progressText
            }
          >
            {Math.round(
              progress * 100
            )}%
          </Text>
        </View>


        <View
          style={
            styles.progressBackground
          }
        >
          <View
            style={[
              styles.progressFill,
              {
                width:
                  `${progress * 100}%`,
              },
            ]}
          />
        </View>


        {/* TITLE */}

        <View
          style={
            styles.sectionIcon
          }
        >
          <Ionicons
            name={
              step ===
              'breathControl'
                ? 'cloud-outline'
                : 'mic-outline'
            }
            size={30}
            color={BROWN}
          />
        </View>


        <Text
          style={
            styles.title
          }
        >
          {getStepTitle(
            step
          )}
        </Text>


        <Text
          style={
            styles.description
          }
        >
          {getStepInstruction(
            step
          )}
        </Text>


        {/* TIMER */}

        <View
          style={
            styles.timerCircle
          }
        >
          <Text
            style={
              styles.timerText
            }
          >
            {
              isRecordingSection
                ? remainingSeconds
                : duration
            }
          </Text>


          <Text
            style={
              styles.timerLabel
            }
          >
            seconds
          </Text>
        </View>


        {/* ================================================== */}
        {/* LIVE AUDIO DATA */}
        {/* ================================================== */}

        {isRecordingSection && (
          <View
            style={
              styles.liveCard
            }
          >
            <Text
              style={
                styles.liveTitle
              }
            >
              Live Audio
            </Text>


            <View
              style={
                styles.liveGrid
              }
            >
              {/* PITCH */}

              <View
                style={
                  styles.liveItem
                }
              >
                <Text
                  style={
                    styles.liveLabel
                  }
                >
                  Pitch
                </Text>


                <Text
                  style={
                    styles.liveValue
                  }
                >
                  {
                    liveAudio &&
                    liveAudio.pitch > 0
                      ? `${liveAudio.pitch.toFixed(1)} Hz`
                      : '--'
                  }
                </Text>
              </View>


              {/* NOTE */}

              <View
                style={
                  styles.liveItem
                }
              >
                <Text
                  style={
                    styles.liveLabel
                  }
                >
                  Note
                </Text>


                <Text
                  style={
                    styles.liveValue
                  }
                >
                  {
                    liveAudio?.note ??
                    '--'
                  }
                </Text>
              </View>


              {/* CLARITY */}

              <View
                style={
                  styles.liveItem
                }
              >
                <Text
                  style={
                    styles.liveLabel
                  }
                >
                  Clarity
                </Text>


                <Text
                  style={
                    styles.liveValue
                  }
                >
                  {
                    liveAudio
                      ? `${(
                          liveAudio.clarity *
                          100
                        ).toFixed(0)}%`
                      : '--'
                  }
                </Text>
              </View>


              {/* VOLUME */}

              <View
                style={
                  styles.liveItem
                }
              >
                <Text
                  style={
                    styles.liveLabel
                  }
                >
                  Volume
                </Text>


                <Text
                  style={
                    styles.liveValue
                  }
                >
                  {
                    liveAudio
                      ? `${liveAudio.volume.toFixed(1)} dB`
                      : '--'
                  }
                </Text>
              </View>


              {/* STABILITY */}

              <View
                style={
                  styles.liveItem
                }
              >
                <Text
                  style={
                    styles.liveLabel
                  }
                >
                  Stability
                </Text>


                <Text
                  style={
                    styles.liveValue
                  }
                >
                  {
                    liveAudio
                      ? `${liveAudio.stability.toFixed(0)}%`
                      : '--'
                  }
                </Text>
              </View>
            </View>
          </View>
        )}


        {/* RECORD BUTTON */}

        <Pressable
          style={[
            styles.recordButton,
            isRecordingSection &&
              styles.recordingButton,
          ]}
          disabled={
            isRecordingSection ||
            isRecording
          }
          onPress={
            beginSection
          }
        >
          <Ionicons
            name={
              isRecordingSection
                ? 'radio'
                : 'mic'
            }
            size={30}
            color={WHITE}
          />


          <Text
            style={
              styles.recordButtonText
            }
          >
            {
              isRecordingSection
                ? 'Recording...'
                : 'Record'
            }
          </Text>
        </Pressable>


        {/* ERROR */}

        {error && (
          <View
            style={
              styles.errorCard
            }
          >
            <Text
              style={
                styles.errorText
              }
            >
              {error}
            </Text>
          </View>
        )}


        <Text
          style={
            styles.helperText
          }
        >
          Recording will automatically stop when
          the timer reaches zero.
        </Text>
      </ScrollView>
    );
  }


  return null;
}


// ============================================================
// STYLES
// ============================================================

const styles =
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: WHITE,
    },


    centerScreen: {
      flex: 1,
      backgroundColor: WHITE,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 30,
    },


    backButton: {
      position: 'absolute',
      top: 55,
      left: 24,
      zIndex: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 4,
    },


    content: {
      paddingHorizontal: 24,
      paddingTop: 40,
      paddingBottom: 80,
    },


    resultsContent: {
      paddingHorizontal: 24,
      paddingTop: 40,
      paddingBottom: 80,
    },


    iconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: PINK,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: 24,
    },


    sectionIcon: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: PINK,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginTop: 35,
      marginBottom: 20,
    },


    title: {
      fontFamily: 'FredokaBold',
      fontSize: 30,
      color: BROWN,
      textAlign: 'center',
      marginBottom: 12,
    },


    description: {
      fontFamily: 'FredokaRegular',
      fontSize: 14,
      lineHeight: 21,
      color: MUTED,
      textAlign: 'center',
      marginBottom: 25,
    },


    infoCard: {
      backgroundColor: LIGHT_PINK,
      borderRadius: 20,
      padding: 22,
      marginBottom: 20,
    },


    cardTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 19,
      color: BROWN,
      marginBottom: 12,
    },


    infoItem: {
      fontFamily: 'FredokaRegular',
      fontSize: 14,
      color: BROWN,
      marginBottom: 7,
    },


    warning: {
      fontFamily: 'FredokaRegular',
      fontSize: 12,
      color: MUTED,
      textAlign: 'center',
      lineHeight: 18,
      marginBottom: 25,
    },


    primaryButton: {
      height: 52,
      borderRadius: 26,
      backgroundColor: BROWN,
      paddingHorizontal: 22,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      gap: 8,
      marginTop: 10,
    },


    primaryButtonText: {
      fontFamily: 'FredokaBold',
      fontSize: 15,
      color: WHITE,
    },


    progressHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },


    progressText: {
      fontFamily: 'FredokaRegular',
      fontSize: 12,
      color: MUTED,
    },


    progressBackground: {
      width: '100%',
      height: 9,
      backgroundColor: LIGHT_GRAY,
      borderRadius: 10,
      overflow: 'hidden',
    },


    progressFill: {
      height: '100%',
      backgroundColor: BROWN,
      borderRadius: 10,
    },


    timerCircle: {
      width: 170,
      height: 170,
      borderRadius: 85,
      backgroundColor: LIGHT_PINK,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 30,
    },


    timerText: {
      fontFamily: 'FredokaBold',
      fontSize: 54,
      color: BROWN,
    },


    timerLabel: {
      fontFamily: 'FredokaRegular',
      fontSize: 12,
      color: MUTED,
    },


    // ========================================================
    // LIVE AUDIO
    // ========================================================

    liveCard: {
      backgroundColor: LIGHT_PINK,
      borderRadius: 18,
      padding: 18,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: '#F2DDE5',
    },


    liveTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 17,
      color: BROWN,
      textAlign: 'center',
      marginBottom: 14,
    },


    liveGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },


    liveItem: {
      width: '31%',
      alignItems: 'center',
      marginBottom: 14,
    },


    liveLabel: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,
      color: MUTED,
      marginBottom: 3,
    },


    liveValue: {
      fontFamily: 'FredokaBold',
      fontSize: 15,
      color: BROWN,
    },


    // ========================================================
    // RECORD BUTTON
    // ========================================================

    recordButton: {
      height: 60,
      borderRadius: 30,
      backgroundColor: BROWN,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },


    recordingButton: {
      opacity: 0.65,
    },


    recordButtonText: {
      fontFamily: 'FredokaBold',
      fontSize: 17,
      color: WHITE,
    },


    helperText: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,
      color: MUTED,
      textAlign: 'center',
      marginTop: 18,
      lineHeight: 17,
    },


    errorCard: {
      backgroundColor: '#FFF0F0',
      borderRadius: 14,
      padding: 15,
      marginTop: 20,
    },


    errorText: {
      fontFamily: 'FredokaRegular',
      fontSize: 12,
      lineHeight: 17,
      color: '#9A3B3B',
      textAlign: 'center',
    },


    processingTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 24,
      color: BROWN,
      marginTop: 25,
      textAlign: 'center',
    },


    processingText: {
      fontFamily: 'FredokaRegular',
      fontSize: 13,
      color: MUTED,
      textAlign: 'center',
      lineHeight: 20,
      marginTop: 10,
      marginBottom: 20,
    },


    resultsTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 28,
      color: BROWN,
      textAlign: 'center',
    },


    resultsSubtitle: {
      fontFamily: 'FredokaRegular',
      fontSize: 13,
      color: MUTED,
      textAlign: 'center',
      marginTop: 5,
      marginBottom: 25,
    },


    rangeCard: {
      backgroundColor: PINK,
      borderRadius: 20,
      padding: 22,
      alignItems: 'center',
      marginBottom: 18,
    },


    rangeText: {
      fontFamily: 'FredokaBold',
      fontSize: 24,
      color: BROWN,
    },


    scoreCard: {
      backgroundColor: LIGHT_PINK,
      borderRadius: 18,
      padding: 18,
      marginBottom: 12,
    },


    scoreHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },


    scoreName: {
      fontFamily: 'FredokaBold',
      fontSize: 16,
      color: BROWN,
    },


    scoreValue: {
      fontFamily: 'FredokaBold',
      fontSize: 20,
      color: BROWN,
    },


    recommendation: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,
      color: MUTED,
      marginTop: 8,
    },
  });