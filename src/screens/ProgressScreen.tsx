import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  router,
  useFocusEffect,
} from 'expo-router';

import {
  useCallback,
  useState,
} from 'react';

import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  auth,
} from '@/services/firebase/config';

import {
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import type {
  SavedAssessmentResult,
} from '@/services/assessment/assessmentRepository';


// ============================================================
// COLORS
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const LIGHT_GRAY = '#F2F2F2';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';


// ============================================================
// TYPES
// ============================================================

type Period =
  | 'daily'
  | 'weekly'
  | 'monthly';


// ============================================================
// COMPONENT INFORMATION
// ============================================================

const components = [
  {
    id: 'breathControl',
    name: 'Breath Control',
  },
  {
    id: 'pitch',
    name: 'Pitch',
  },
  {
    id: 'tone',
    name: 'Tone',
  },
  {
    id: 'volume',
    name: 'Volume',
  },
  {
    id: 'agility',
    name: 'Agility',
  },
] as const;


// ============================================================
// HELPERS
// ============================================================

function formatAssessmentDate(
  timestamp: number
): string {

  if (
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return 'Date unavailable';
  }


  const date =
    new Date(timestamp);


  return date.toLocaleDateString(
    undefined,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }
  );
}


// ============================================================
// SCREEN
// ============================================================

export default function ProgressScreen() {

  const [
    period,
    setPeriod,
  ] =
    useState<Period>(
      'daily'
    );


  const [
    latestAssessment,
    setLatestAssessment,
  ] =
    useState<SavedAssessmentResult | null>(
      null
    );


  const [
    assessmentLoading,
    setAssessmentLoading,
  ] =
    useState(true);


  // ==========================================================
  // LOAD LATEST ASSESSMENT
  // ==========================================================

  useFocusEffect(
    useCallback(
      () => {

        let isMounted =
          true;


        const loadAssessment =
          async () => {

            try {

              setAssessmentLoading(
                true
              );


              const user =
                auth.currentUser;


              if (!user) {

                if (isMounted) {
                  setLatestAssessment(
                    null
                  );
                }

                return;
              }


              const assessment =
                await getLatestAssessment();


              if (isMounted) {

                setLatestAssessment(
                  assessment
                );
              }

            } catch (
              error
            ) {

              console.error(
                'Unable to load latest assessment:',
                error
              );


              if (isMounted) {

                setLatestAssessment(
                  null
                );
              }

            } finally {

              if (isMounted) {

                setAssessmentLoading(
                  false
                );
              }
            }
          };


        loadAssessment();


        return () => {
          isMounted =
            false;
        };

      },
      []
    )
  );


  // ==========================================================
  // PERIOD LABEL
  // ==========================================================

  const periodLabel =
    period === 'daily'
      ? 'Today'
      : period === 'weekly'
      ? 'This Week'
      : 'This Month';


  // ==========================================================
  // ASSESSMENT SCORE HELPER
  // ==========================================================

  const getAssessmentScore =
    (
      componentId: string
    ): number => {

      if (
        !latestAssessment
      ) {
        return 0;
      }


      const score =
        latestAssessment.scores.find(
          item =>
            item.componentId ===
            componentId
        );


      return score?.scorePct ?? 0;
    };


  // ==========================================================
  // ASSESSMENT OVERALL SCORE
  // ==========================================================

  const assessmentAverage =
    latestAssessment &&
    latestAssessment.scores.length > 0
      ? Math.round(
          latestAssessment.scores.reduce(
            (
              sum,
              score
            ) =>
              sum +
              score.scorePct,
            0
          ) /
            latestAssessment.scores.length
        )
      : 0;


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <View
      style={
        styles.screen
      }
    >

      <AppHeader />


      {/* ================================================== */}
      {/* BACK BUTTON */}
      {/* ================================================== */}

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


      <ScrollView
        showsVerticalScrollIndicator={
          false
        }
        contentContainerStyle={
          styles.content
        }
      >

        {/* ================================================= */}
        {/* TITLE */}
        {/* ================================================= */}

        <Text
          style={
            styles.title
          }
        >
          My Progress
        </Text>


        <Text
          style={
            styles.subtitle
          }
        >
          Track your vocal improvement.
        </Text>


        {/* ================================================= */}
        {/* DAILY / WEEKLY / MONTHLY */}
        {/* ================================================= */}

        <View
          style={
            styles.periodSelector
          }
        >

          <Pressable
            style={[
              styles.periodButton,
              period === 'daily' &&
                styles.periodButtonActive,
            ]}
            onPress={() =>
              setPeriod(
                'daily'
              )
            }
          >

            <Text
              style={[
                styles.periodText,
                period === 'daily' &&
                  styles.periodTextActive,
              ]}
            >
              Daily
            </Text>

          </Pressable>


          <Pressable
            style={[
              styles.periodButton,
              period === 'weekly' &&
                styles.periodButtonActive,
            ]}
            onPress={() =>
              setPeriod(
                'weekly'
              )
            }
          >

            <Text
              style={[
                styles.periodText,
                period === 'weekly' &&
                  styles.periodTextActive,
              ]}
            >
              Weekly
            </Text>

          </Pressable>


          <Pressable
            style={[
              styles.periodButton,
              period === 'monthly' &&
                styles.periodButtonActive,
            ]}
            onPress={() =>
              setPeriod(
                'monthly'
              )
            }
          >

            <Text
              style={[
                styles.periodText,
                period === 'monthly' &&
                  styles.periodTextActive,
              ]}
            >
              Monthly
            </Text>

          </Pressable>

        </View>


        {/* ================================================= */}
        {/* PERIOD SUMMARY */}
        {/* ================================================= */}

        <View
          style={
            styles.summaryCard
          }
        >

          <Text
            style={
              styles.summaryTitle
            }
          >
            {periodLabel}
          </Text>


          <View
            style={
              styles.summaryRow
            }
          >

            <View
              style={
                styles.summaryItem
              }
            >

              <Text
                style={
                  styles.summaryValue
                }
              >
                0
              </Text>


              <Text
                style={
                  styles.summaryLabel
                }
              >
                Exercises
              </Text>

            </View>


            <View
              style={
                styles.divider
              }
            />


            <View
              style={
                styles.summaryItem
              }
            >

              <Text
                style={
                  styles.summaryValue
                }
              >
                0%
              </Text>


              <Text
                style={
                  styles.summaryLabel
                }
              >
                Average Score
              </Text>

            </View>

          </View>

        </View>


        {/* ================================================= */}
        {/* LATEST ASSESSMENT */}
        {/* ================================================= */}

        <View
          style={
            styles.assessmentSectionHeader
          }
        >

          <View>
            <Text
              style={
                styles.sectionTitle
              }
            >
              Latest Assessment
            </Text>

            <Text
              style={
                styles.sectionSubtitle
              }
            >
              Your most recent vocal assessment scores.
            </Text>
          </View>

        </View>


        {assessmentLoading ? (

          <View
            style={
              styles.assessmentEmptyCard
            }
          >

            <Text
              style={
                styles.emptyText
              }
            >
              Loading your assessment...
            </Text>

          </View>

        ) : latestAssessment ? (

          <>
            {/* =========================================== */}
            {/* ASSESSMENT SUMMARY */}
            {/* =========================================== */}

            <View
              style={
                styles.assessmentSummaryCard
              }
            >

              <View
                style={
                  styles.assessmentSummaryLeft
                }
              >

                <Text
                  style={
                    styles.assessmentSummaryLabel
                  }
                >
                  Overall Assessment
                </Text>


                <Text
                  style={
                    styles.assessmentAverage
                  }
                >
                  {assessmentAverage}%
                </Text>


                <Text
                  style={
                    styles.assessmentDate
                  }
                >
                  Assessed on{' '}
                  {
                    formatAssessmentDate(
                      latestAssessment.timestamp
                    )
                  }
                </Text>

              </View>


              <View
                style={
                  styles.assessmentIconCircle
                }
              >

                <Ionicons
                  name="mic"
                  size={25}
                  color={BROWN}
                />

              </View>

            </View>


            {/* =========================================== */}
            {/* ASSESSMENT COMPONENT SCORES */}
            {/* =========================================== */}

            <View
              style={
                styles.assessmentScoresCard
              }
            >

              {components.map(
                (
                  component,
                  index
                ) => {

                  const score =
                    getAssessmentScore(
                      component.id
                    );


                  return (
                    <View
                      key={
                        component.id
                      }
                      style={[
                        styles.assessmentScoreItem,
                        index ===
                          components.length - 1 &&
                          styles.assessmentScoreItemLast,
                      ]}
                    >

                      <View
                        style={
                          styles.assessmentScoreHeader
                        }
                      >

                        <Text
                          style={
                            styles.assessmentComponentName
                          }
                        >
                          {
                            component.name
                          }
                        </Text>


                        <Text
                          style={
                            styles.assessmentComponentScore
                          }
                        >
                          {score}%
                        </Text>

                      </View>


                      <View
                        style={
                          styles.assessmentProgressBackground
                        }
                      >

                        <View
                          style={[
                            styles.assessmentProgressFill,
                            {
                              width:
                                `${Math.max(
                                  0,
                                  Math.min(
                                    100,
                                    score
                                  )
                                )}%`,
                            },
                          ]}
                        />

                      </View>

                    </View>
                  );
                }
              )}

            </View>


            {/* =========================================== */}
            {/* VIEW ASSESSMENT */}
            {/* =========================================== */}

            <Pressable
              style={
                styles.viewAssessmentButton
              }
              onPress={() =>
                router.push(
                  '/assessment'
                )
              }
            >

              <Text
                style={
                  styles.viewAssessmentText
                }
              >
                Retake Assessment
              </Text>


              <Ionicons
                name="arrow-forward"
                size={17}
                color={BROWN}
              />

            </Pressable>

          </>

        ) : (

          /* ============================================= */
          /* NO ASSESSMENT YET */
          /* ============================================= */

          <View
            style={
              styles.assessmentEmptyCard
            }
          >

            <View
              style={
                styles.emptyIconCircle
              }
            >

              <Ionicons
                name="mic-outline"
                size={25}
                color={BROWN}
              />

            </View>


            <Text
              style={
                styles.emptyTitle
              }
            >
              No Assessment Yet
            </Text>


            <Text
              style={
                styles.emptyText
              }
            >
              Complete a vocal assessment to see
              your Breath Control, Pitch, Tone,
              Volume, and Agility scores here.
            </Text>


            <Pressable
              style={
                styles.startAssessmentButton
              }
              onPress={() =>
                router.push(
                  '/assessment'
                )
              }
            >

              <Text
                style={
                  styles.startAssessmentText
                }
              >
                Take Assessment
              </Text>


              <Ionicons
                name="arrow-forward"
                size={17}
                color={WHITE}
              />

            </Pressable>

          </View>

        )}


        {/* ================================================= */}
        {/* EXERCISE PROGRESS */}
        {/* ================================================= */}

        <Text
          style={
            styles.exerciseSectionTitle
          }
        >
          Exercise Progress
        </Text>


        <Text
          style={
            styles.sectionSubtitle
          }
        >
          Your progress from completed vocal exercises.
        </Text>


        {components.map(
          (
            component
          ) => (

            <View
              key={
                `exercise-${component.id}`
              }
              style={
                styles.componentCard
              }
            >

              <View
                style={
                  styles.componentHeader
                }
              >

                <Text
                  style={
                    styles.componentName
                  }
                >
                  {
                    component.name
                  }
                </Text>


                <Text
                  style={
                    styles.componentScore
                  }
                >
                  0%
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
                        '0%',
                    },
                  ]}
                />

              </View>

            </View>

          )
        )}

      </ScrollView>

    </View>
  );
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


    content: {
      paddingHorizontal: 24,
      paddingTop: 25,
      paddingBottom: 140,
    },


    // ========================================================
    // BACK BUTTON
    // ========================================================

    backButton: {
      position: 'absolute',

      top: 55,
      left: 24,

      zIndex: 10,

      width: 40,
      height: 40,

      alignItems: 'center',
      justifyContent: 'center',
    },


    // ========================================================
    // TITLE
    // ========================================================

    title: {
      fontFamily: 'FredokaBold',
      fontSize: 30,

      color: BROWN,

      marginTop: 30,
    },


    subtitle: {
      fontFamily: 'FredokaRegular',
      fontSize: 12,

      color: MUTED,

      marginTop: 3,
      marginBottom: 20,
    },


    // ========================================================
    // PERIOD SELECTOR
    // ========================================================

    periodSelector: {
      flexDirection: 'row',

      backgroundColor: LIGHT_GRAY,

      borderRadius: 14,

      padding: 4,

      marginBottom: 20,
    },


    periodButton: {
      flex: 1,

      height: 36,

      borderRadius: 11,

      alignItems: 'center',
      justifyContent: 'center',
    },


    periodButtonActive: {
      backgroundColor: PINK,
    },


    periodText: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,

      color: MUTED,
    },


    periodTextActive: {
      fontFamily: 'FredokaBold',

      color: BROWN,
    },


    // ========================================================
    // SUMMARY
    // ========================================================

    summaryCard: {
      backgroundColor: PINK,

      borderRadius: 20,

      padding: 20,

      marginBottom: 30,
    },


    summaryTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 18,

      color: BROWN,

      marginBottom: 15,
    },


    summaryRow: {
      flexDirection: 'row',

      alignItems: 'center',
    },


    summaryItem: {
      flex: 1,

      alignItems: 'center',
    },


    summaryValue: {
      fontFamily: 'FredokaBold',
      fontSize: 30,

      color: BROWN,
    },


    summaryLabel: {
      fontFamily: 'FredokaRegular',
      fontSize: 10,

      color: MUTED,

      marginTop: 2,
    },


    divider: {
      width: 1,
      height: 42,

      backgroundColor: '#E8C7D0',
    },


    // ========================================================
    // ASSESSMENT SECTION
    // ========================================================

    assessmentSectionHeader: {
      marginBottom: 14,
    },


    sectionTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 22,

      color: BROWN,
    },


    sectionSubtitle: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,

      color: MUTED,

      marginTop: 3,
      marginBottom: 14,
    },


    assessmentSummaryCard: {
      backgroundColor: PINK,

      borderRadius: 20,

      padding: 20,

      marginBottom: 12,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent: 'space-between',
    },


    assessmentSummaryLeft: {
      flex: 1,
    },


    assessmentSummaryLabel: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,

      color: MUTED,

      marginBottom: 2,
    },


    assessmentAverage: {
      fontFamily: 'FredokaBold',
      fontSize: 34,

      color: BROWN,
    },


    assessmentDate: {
      fontFamily: 'FredokaRegular',
      fontSize: 10,

      color: MUTED,

      marginTop: 2,
    },


    assessmentIconCircle: {
      width: 56,
      height: 56,

      borderRadius: 28,

      backgroundColor: WHITE,

      alignItems: 'center',
      justifyContent: 'center',
    },


    // ========================================================
    // ASSESSMENT SCORES
    // ========================================================

    assessmentScoresCard: {
      backgroundColor: LIGHT_PINK,

      borderRadius: 18,

      paddingHorizontal: 17,
      paddingVertical: 6,

      borderWidth: 1,
      borderColor: '#F2DDE5',

      marginBottom: 12,
    },


    assessmentScoreItem: {
      paddingVertical: 14,

      borderBottomWidth: 1,
      borderBottomColor: '#F2DDE5',
    },


    assessmentScoreItemLast: {
      borderBottomWidth: 0,
    },


    assessmentScoreHeader: {
      flexDirection: 'row',

      alignItems: 'center',

      justifyContent: 'space-between',

      marginBottom: 7,
    },


    assessmentComponentName: {
      fontFamily: 'FredokaBold',
      fontSize: 14,

      color: BROWN,
    },


    assessmentComponentScore: {
      fontFamily: 'FredokaBold',
      fontSize: 15,

      color: BROWN,
    },


    assessmentProgressBackground: {
      height: 8,

      width: '100%',

      backgroundColor: WHITE,

      borderRadius: 10,

      overflow: 'hidden',
    },


    assessmentProgressFill: {
      height: '100%',

      backgroundColor: BROWN,

      borderRadius: 10,
    },


    // ========================================================
    // ASSESSMENT BUTTON
    // ========================================================

    viewAssessmentButton: {
      height: 44,

      borderRadius: 22,

      backgroundColor: LIGHT_PINK,

      borderWidth: 1,
      borderColor: '#E8D4DB',

      flexDirection: 'row',

      alignItems: 'center',
      justifyContent: 'center',

      gap: 7,

      marginBottom: 30,
    },


    viewAssessmentText: {
      fontFamily: 'FredokaBold',
      fontSize: 13,

      color: BROWN,
    },


    // ========================================================
    // EMPTY ASSESSMENT
    // ========================================================

    assessmentEmptyCard: {
      backgroundColor: LIGHT_PINK,

      borderRadius: 18,

      padding: 22,

      alignItems: 'center',

      borderWidth: 1,
      borderColor: '#F2DDE5',

      marginBottom: 30,
    },


    emptyIconCircle: {
      width: 54,
      height: 54,

      borderRadius: 27,

      backgroundColor: PINK,

      alignItems: 'center',
      justifyContent: 'center',

      marginBottom: 12,
    },


    emptyTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 18,

      color: BROWN,

      marginBottom: 6,
    },


    emptyText: {
      fontFamily: 'FredokaRegular',
      fontSize: 11,

      lineHeight: 17,

      color: MUTED,

      textAlign: 'center',

      marginBottom: 15,
    },


    startAssessmentButton: {
      height: 44,

      borderRadius: 22,

      backgroundColor: BROWN,

      paddingHorizontal: 20,

      flexDirection: 'row',

      alignItems: 'center',
      justifyContent: 'center',

      gap: 7,
    },


    startAssessmentText: {
      fontFamily: 'FredokaBold',
      fontSize: 13,

      color: WHITE,
    },


    // ========================================================
    // EXERCISE PROGRESS
    // ========================================================

    exerciseSectionTitle: {
      fontFamily: 'FredokaBold',
      fontSize: 22,

      color: BROWN,

      marginBottom: 0,
    },


    componentCard: {
      backgroundColor: LIGHT_PINK,

      borderRadius: 16,

      padding: 16,

      marginBottom: 12,

      borderWidth: 1,
      borderColor: '#F2DDE5',
    },


    componentHeader: {
      flexDirection: 'row',

      justifyContent: 'space-between',

      alignItems: 'center',

      marginBottom: 8,
    },


    componentName: {
      fontFamily: 'FredokaBold',
      fontSize: 15,

      color: BROWN,
    },


    componentScore: {
      fontFamily: 'FredokaBold',
      fontSize: 14,

      color: BROWN,
    },


    progressBackground: {
      height: 9,

      width: '100%',

      backgroundColor: WHITE,

      borderRadius: 10,

      overflow: 'hidden',
    },


    progressFill: {
      height: '100%',

      backgroundColor: BROWN,

      borderRadius: 10,
    },

  });