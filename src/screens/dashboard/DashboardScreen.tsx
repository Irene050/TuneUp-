import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
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
  getLatestAssessment,
} from '@/services/assessment/assessmentRepository';

import type {
  SavedAssessmentResult,
} from '@/services/assessment/assessmentRepository';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const LIGHT_GRAY = '#F2F2F2';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';

/* =========================================================
   FREQUENCY → NOTE NAME
========================================================= */

/**
 * Converts a frequency in Hz into the nearest
 * musical note name.
 *
 * Examples:
 *
 * 130.81 Hz → C3
 * 261.63 Hz → C4
 * 392.00 Hz → G4
 */
function frequencyToNoteName(
  frequency: number,
): string {
  if (
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
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

  /*
   * A4 = 440 Hz = MIDI note 69.
   */
  const midi = Math.round(
    69 +
      12 *
        Math.log2(
          frequency / 440,
        ),
  );

  const noteIndex =
    ((midi % 12) + 12) % 12;

  const octave =
    Math.floor(midi / 12) - 1;

  return `${noteNames[noteIndex]}${octave}`;
}

/* =========================================================
   DASHBOARD
========================================================= */

export default function DashboardScreen() {
  const [
    latestAssessment,
    setLatestAssessment,
  ] = useState<SavedAssessmentResult | null>(
    null,
  );

  const [
    assessmentLoading,
    setAssessmentLoading,
  ] = useState(true);

  /* =======================================================
     LOAD LATEST ASSESSMENT
  ======================================================= */

  /*
   * useFocusEffect is intentional here.
   *
   * When the user:
   *
   * Dashboard
   *    ↓
   * Assessment
   *    ↓
   * completes assessment
   *    ↓
   * Dashboard
   *
   * the dashboard gets focused again and reloads
   * the newest assessment from Firebase.
   */
  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      const loadAssessment =
        async () => {
          try {
            setAssessmentLoading(
              true,
            );

            const assessment =
              await getLatestAssessment();

            if (mounted) {
              setLatestAssessment(
                assessment,
              );
            }
          } catch (error) {
            console.error(
              '❌ Failed to load latest assessment:',
              error,
            );

            if (mounted) {
              setLatestAssessment(
                null,
              );
            }
          } finally {
            if (mounted) {
              setAssessmentLoading(
                false,
              );
            }
          }
        };

      loadAssessment();

      return () => {
        mounted = false;
      };
    }, []),
  );

  /* =======================================================
     DASHBOARD UI
  ======================================================= */

  return (
    <View style={styles.screen}>
      <AppHeader />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={
          false
        }
      >
        {/* USER INTRO */}
        <View style={styles.userSection}>
          <View style={styles.avatar}>
            <Text
              style={styles.avatarText}
            >
              U
            </Text>
          </View>

          <View>
            <Text
              style={styles.userName}
            >
              User
            </Text>

            <Text
              style={styles.userLevel}
            >
              lvl. 0
            </Text>
          </View>
        </View>

        {/* ASSESSMENT */}
        <Pressable
          style={styles.assessmentCard}
          onPress={() =>
            router.push('/assessment')
          }
        >
          <View
            style={styles.assessmentIcon}
          >
            <Ionicons
              name="mic"
              size={25}
              color={BROWN}
            />
          </View>

          <View
            style={styles.assessmentContent}
          >
            <Text
              style={styles.assessmentTitle}
            >
              Find your vocal strengths!
            </Text>

            <Text
              style={
                styles.assessmentDescription
              }
            >
              Take a quick assessment to
              personalize your exercises.
            </Text>

            <View
              style={styles.assessmentButton}
            >
              <Text
                style={
                  styles.assessmentButtonText
                }
              >
                Assess Me!
              </Text>

              <Ionicons
                name="arrow-forward"
                size={16}
                color={WHITE}
              />
            </View>
          </View>
        </Pressable>

        {/* =================================================
            VOCAL RANGE
        ================================================= */}

        <View style={styles.rangeCard}>
          <View style={styles.rangeIcon}>
            <Ionicons
              name="musical-notes"
              size={24}
              color={BROWN}
            />
          </View>

          <View style={styles.rangeContent}>
            <Text style={styles.rangeLabel}>
              Your Vocal Range
            </Text>

            {assessmentLoading ? (
              <Text
                style={styles.rangeText}
              >
                Loading...
              </Text>
            ) : latestAssessment ? (
              <Text
                style={styles.rangeText}
              >
                {frequencyToNoteName(
                  latestAssessment.vocalRangeLowHz,
                )}
                {' – '}
                {frequencyToNoteName(
                  latestAssessment.vocalRangeHighHz,
                )}
              </Text>
            ) : (
              <Text
                style={styles.rangeEmptyText}
              >
                Complete an assessment to
                discover your range.
              </Text>
            )}

            {latestAssessment && (
              <Text
                style={styles.rangeSubtext}
              >
                Based on your latest assessment
              </Text>
            )}
          </View>
        </View>

        {/* AUDIO TEST */}
        <Pressable
          onPress={() =>
            router.push('/audio-test')
          }
          style={styles.audioTestButton}
        >
          <Text
            style={styles.audioTestText}
          >
            Test Audio
          </Text>
        </Pressable>

        {/* VOCAL EXERCISES HEADER */}
        <View
          style={styles.sectionHeader}
        >
          <Text
            style={styles.sectionTitle}
          >
            Vocal Components
          </Text>

          <Pressable
            onPress={() =>
              router.push(
                '/dashboard/exercises',
              )
            }
          >
            <Text
              style={styles.viewMore}
            >
              view more
            </Text>
          </Pressable>
        </View>

        {/* RECOMMENDED EXERCISES */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.exerciseScroll
          }
        >
          {/* CARD 1 */}
          <Pressable
            style={styles.exerciseCard}
          >
            <View
              style={styles.exerciseImage}
            />

            <View
              style={styles.exerciseBottom}
            >
              <View
                style={styles.exerciseText}
              >
                <Text
                  style={styles.exerciseName}
                >
                  Breath Control
                </Text>

                <Text
                  style={
                    styles.exerciseDescription
                  }
                >
                  Breath Control Exercises
                  Available Here!
                </Text>
              </View>

              <View
                style={styles.playButton}
              >
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* CARD 2 */}
          <Pressable
            style={styles.exerciseCard}
          >
            <View
              style={styles.exerciseImage}
            />

            <View
              style={styles.exerciseBottom}
            >
              <View
                style={styles.exerciseText}
              >
                <Text
                  style={styles.exerciseName}
                >
                  Pitch
                </Text>

                <Text
                  style={
                    styles.exerciseDescription
                  }
                >
                  Pitch Exercises Available
                  Here!
                </Text>
              </View>

              <View
                style={styles.playButton}
              >
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* CARD 3 */}
          <Pressable
            style={styles.exerciseCard}
          >
            <View
              style={styles.exerciseImage}
            />

            <View
              style={styles.exerciseBottom}
            >
              <View
                style={styles.exerciseText}
              >
                <Text
                  style={styles.exerciseName}
                >
                  Tone
                </Text>

                <Text
                  style={
                    styles.exerciseDescription
                  }
                >
                  Tone Exercises Available
                  Here!
                </Text>
              </View>

              <View
                style={styles.playButton}
              >
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* CARD 4 */}
          <Pressable
            style={styles.exerciseCard}
          >
            <View
              style={styles.exerciseImage}
            />

            <View
              style={styles.exerciseBottom}
            >
              <View
                style={styles.exerciseText}
              >
                <Text
                  style={styles.exerciseName}
                >
                  Volume
                </Text>

                <Text
                  style={
                    styles.exerciseDescription
                  }
                >
                  Volume Exercises Available
                  Here!
                </Text>
              </View>

              <View
                style={styles.playButton}
              >
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* CARD 5 */}
          <Pressable
            style={styles.exerciseCard}
          >
            <View
              style={styles.exerciseImage}
            />

            <View
              style={styles.exerciseBottom}
            >
              <View
                style={styles.exerciseText}
              >
                <Text
                  style={styles.exerciseName}
                >
                  Agility
                </Text>

                <Text
                  style={
                    styles.exerciseDescription
                  }
                >
                  Agility Exercises Available
                  Here!
                </Text>
              </View>

              <View
                style={styles.playButton}
              >
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>
        </ScrollView>

        {/* MY PROGRESS */}
        <View
          style={styles.progressHeader}
        >
          <Text
            style={styles.sectionTitle}
          >
            My Progress
          </Text>
        </View>

        <View
          style={styles.progressCard}
        >
          <View style={styles.progressTop}>
            <View>
              <Text
                style={styles.progressTitle}
              >
                Keep practicing!
              </Text>

              <Text
                style={
                  styles.progressSubtitle
                }
              >
                Complete exercises to improve
                your skills.
              </Text>
            </View>
          </View>

          <Text
            style={styles.progressPercent}
          >
            0%
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* =========================================================
   STYLES
========================================================= */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
  },

  scrollView: {
    flex: 1,
  },

  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 140,
  },

  /* USER */

  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },

  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },

  avatarText: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
  },

  userName: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
  },

  userLevel: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    color: BROWN,
    marginTop: -2,
  },

  /* SECTION */

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },

  sectionTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
  },

  viewMore: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: BROWN,
  },

  /* ASSESSMENT */

  assessmentCard: {
    width: '100%',
    minHeight: 140,
    backgroundColor: PINK,
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    marginBottom: 18,

    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 7,
    shadowOffset: {
      width: 0,
      height: 4,
    },

    elevation: 4,
  },

  assessmentIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: LIGHT_GRAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },

  assessmentContent: {
    flex: 1,
  },

  assessmentTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
    marginBottom: 5,
  },

  assessmentDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 15,
    color: BROWN,
    marginBottom: 13,
  },

  assessmentButton: {
    alignSelf: 'flex-start',
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: BROWN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },

  assessmentButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: WHITE,
  },

  /* VOCAL RANGE */

  rangeCard: {
    width: '100%',
    minHeight: 86,

    flexDirection: 'row',
    alignItems: 'center',

    backgroundColor: LIGHT_PINK,

    borderRadius: 18,

    padding: 16,

    marginBottom: 18,

    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  rangeIcon: {
    width: 48,
    height: 48,

    borderRadius: 24,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',

    marginRight: 14,
  },

  rangeContent: {
    flex: 1,
  },

  rangeLabel: {
    fontFamily: 'FredokaMedium',
    fontSize: 13,
    color: MUTED,
    marginBottom: 1,
  },

  rangeText: {
    fontFamily: 'FredokaBold',
    fontSize: 25,
    color: BROWN,
  },

  rangeSubtext: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 1,
  },

  rangeEmptyText: {
    fontFamily: 'FredokaRegular',
    fontSize: 13,
    lineHeight: 17,
    color: BROWN,
  },

  /* AUDIO TEST */

  audioTestButton: {
    backgroundColor: BROWN,
    paddingVertical: 14,
    paddingHorizontal: 25,
    borderRadius: 25,
    marginTop: 0,
    marginBottom: 18,
  },

  audioTestText: {
    color: WHITE,
    fontFamily: 'FredokaBold',
    textAlign: 'center',
  },

  /* EXERCISES */

  exerciseScroll: {
    paddingBottom: 35,
  },

  exerciseCard: {
    width: 320,
    height: 300,

    backgroundColor: PINK,

    borderRadius: 20,

    padding: 14,

    marginRight: 18,

    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: {
      width: 0,
      height: 4,
    },

    elevation: 5,
  },

  exerciseImage: {
    height: 195,

    backgroundColor: WHITE,

    borderRadius: 18,

    position: 'relative',

    marginBottom: 14,
  },

  difficultyBadge: {
    position: 'absolute',

    right: 10,
    bottom: 10,

    backgroundColor: WHITE,

    borderRadius: 12,

    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  difficultyText: {
    fontFamily: 'FredokaBold',
    fontSize: 10,
    color: BROWN,
  },

  exerciseBottom: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  exerciseText: {
    flex: 1,
  },

  exerciseName: {
    fontFamily: 'FredokaBold',
    fontSize: 20,
    color: BROWN,
    marginBottom: 4,
  },

  exerciseDescription: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: BROWN,
  },

  playButton: {
    width: 48,
    height: 48,

    borderRadius: 24,

    backgroundColor: WHITE,

    alignItems: 'center',
    justifyContent: 'center',

    marginLeft: 8,

    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
    },

    elevation: 3,
  },

  /* PROGRESS */

  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },

  progressCard: {
    flexDirection: 'row',
    backgroundColor: LIGHT_PINK,

    borderRadius: 18,

    padding: 18,

    borderWidth: 1,
    borderColor: '#F2DDE5',
  },

  progressTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  progressTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 18,
    color: BROWN,
  },

  progressSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 3,
  },

  progressIcon: {
    width: 48,
    height: 48,

    borderRadius: 24,

    backgroundColor: PINK,

    alignItems: 'center',
    justifyContent: 'center',
  },

  progressBarBackground: {
    height: 10,

    backgroundColor: LIGHT_GRAY,

    borderRadius: 10,

    marginTop: 20,

    overflow: 'hidden',
  },

  progressBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',

    marginTop: 8,
  },

  progressText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
  },

  progressPercent: {
    fontFamily: 'FredokaBold',
    fontSize: 50,
    color: BROWN,
    marginLeft: 30,
  },
});