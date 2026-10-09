import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getLatestAssessment,
  type SavedAssessmentResult,
} from '@/services/assessment/assessmentRepository';

import { useAuth } from '@/hooks/useAuth';
import { useProgress } from '@/hooks/useProgress';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const LIGHT_GRAY = '#F2F2F2';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';

function frequencyToNoteName(frequency: number): string {
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

export default function DashboardScreen() {
  const { userName } = useAuth();
  const {
    summaries: progressSummaries,
    exerciseRecords,
    totalExercisesCompleted,
    practiceDays,
    loading: progressLoading,
  } = useProgress();

  const [latestAssessment, setLatestAssessment] =
    useState<SavedAssessmentResult | null>(null);

  const [assessmentLoading, setAssessmentLoading] = useState(true);

  const displayName = userName.trim() || 'Singer';

  const avatarInitial = displayName
    .charAt(0)
    .toUpperCase();

  const tierRank = {
    beginner: 0,
    intermediate: 1,
    advanced: 2,
  } as const;

  const overallTier = progressSummaries.reduce(
    (highestTier, summary) =>
      tierRank[summary.currentTier] > tierRank[highestTier]
        ? summary.currentTier
        : highestTier,
    'beginner' as keyof typeof tierRank,
  );

  const formattedTier =
    overallTier.charAt(0).toUpperCase() +
    overallTier.slice(1);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      const loadAssessment = async () => {
        try {
          setAssessmentLoading(true);

          const assessment = await getLatestAssessment();

          if (mounted) {
            setLatestAssessment(assessment);
          }
        } catch (error) {
          console.error(
            'Failed to load latest assessment:',
            error,
          );

          if (mounted) {
            setLatestAssessment(null);
          }
        } finally {
          if (mounted) {
            setAssessmentLoading(false);
          }
        }
      };

      loadAssessment();

      return () => {
        mounted = false;
      };
    }, []),
  );

  return (
    <View style={styles.screen}>
      <AppHeader />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* USER */}
        <View style={styles.userSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {avatarInitial}
            </Text>
          </View>

          <View>
            <Text style={styles.userName}>
              {displayName}
            </Text>

            <Text style={styles.userLevel}>
              {progressLoading
                ? 'Loading tier...'
                : `${formattedTier} tier`}
            </Text>
          </View>
        </View>

        {/* ASSESSMENT */}
        <Pressable
          style={styles.assessmentCard}
          onPress={() =>
            router.push({
              pathname: '/dashboard',
              params: { tab: 'assessment' },
            })
          }
        >
          <View style={styles.assessmentIcon}>
            <Ionicons
              name="mic"
              size={25}
              color={BROWN}
            />
          </View>

          <View style={styles.assessmentContent}>
            <Text style={styles.assessmentTitle}>
              Find your vocal strengths!
            </Text>

            <Text style={styles.assessmentDescription}>
              Take a quick assessment to personalize
              your exercises.
            </Text>

            <View style={styles.assessmentButton}>
              <Text style={styles.assessmentButtonText}>
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

        {/* VOCAL RANGE */}
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
              <Text style={styles.rangeText}>
                Loading...
              </Text>
            ) : latestAssessment ? (
              <Text style={styles.rangeText}>
                {frequencyToNoteName(
                  latestAssessment.vocalRangeLowHz,
                )}
                {' – '}
                {frequencyToNoteName(
                  latestAssessment.vocalRangeHighHz,
                )}
              </Text>
            ) : (
              <Text style={styles.rangeEmptyText}>
                Complete an assessment to discover
                your range.
              </Text>
            )}

            {latestAssessment && (
              <Text style={styles.rangeSubtext}>
                Based on your latest assessment
              </Text>
            )}
          </View>
        </View>

        {/* VOCAL COMPONENTS */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Vocal Components
          </Text>

          <Pressable
            onPress={() =>
              router.setParams({ tab: 'exercises' })
            }
          >
            <Text style={styles.viewMore}>
              view more
            </Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.exerciseScroll}
        >
          {/* BREATH CONTROL */}
          <Pressable
            onPress={() =>
              router.push('/exercises/breath-control')
            }
            style={styles.exerciseCard}
          >
            <View style={styles.exerciseImage} />

            <View style={styles.exerciseBottom}>
              <View style={styles.exerciseText}>
                <Text style={styles.exerciseName}>
                  Breath Control
                </Text>

                <Text style={styles.exerciseDescription}>
                  Breath Control Exercises Available
                  Here!
                </Text>
              </View>

              <View style={styles.playButton}>
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* PITCH */}
          <Pressable
            onPress={() =>
              router.push('/exercises/pitch')
            }
            style={styles.exerciseCard}
          >
            <View style={styles.exerciseImage} />

            <View style={styles.exerciseBottom}>
              <View style={styles.exerciseText}>
                <Text style={styles.exerciseName}>
                  Pitch
                </Text>

                <Text style={styles.exerciseDescription}>
                  Pitch Exercises Available Here!
                </Text>
              </View>

              <View style={styles.playButton}>
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* TONE */}
          <Pressable
            onPress={() =>
              router.push('/exercises/tone')
            }
            style={styles.exerciseCard}
          >
            <View style={styles.exerciseImage} />

            <View style={styles.exerciseBottom}>
              <View style={styles.exerciseText}>
                <Text style={styles.exerciseName}>
                  Tone
                </Text>

                <Text style={styles.exerciseDescription}>
                  Tone Exercises Available Here!
                </Text>
              </View>

              <View style={styles.playButton}>
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* VOLUME */}
          <Pressable
            onPress={() =>
              router.push('/exercises/volume')
            }
            style={styles.exerciseCard}
          >
            <View style={styles.exerciseImage} />

            <View style={styles.exerciseBottom}>
              <View style={styles.exerciseText}>
                <Text style={styles.exerciseName}>
                  Volume
                </Text>

                <Text style={styles.exerciseDescription}>
                  Volume Exercises Available Here!
                </Text>
              </View>

              <View style={styles.playButton}>
                <Ionicons
                  name="play"
                  size={20}
                  color={BROWN}
                />
              </View>
            </View>
          </Pressable>

          {/* AGILITY */}
          <Pressable
            onPress={() =>
              router.push('/exercises/agility')
            }
            style={styles.exerciseCard}
          >
            <View style={styles.exerciseImage} />

            <View style={styles.exerciseBottom}>
              <View style={styles.exerciseText}>
                <Text style={styles.exerciseName}>
                  Agility
                </Text>

                <Text style={styles.exerciseDescription}>
                  Agility Exercises Available Here!
                </Text>
              </View>

              <View style={styles.playButton}>
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
        <View style={styles.progressHeader}>
          <View>
            <Text style={styles.sectionTitle}>My Progress</Text>
            <Text style={styles.progressSectionSubtitle}>
              Every practice session counts!
            </Text>
          </View>

          <Pressable
            style={styles.viewProgressButton}
            onPress={() => router.push('/progress')}
            accessibilityRole="button"
            accessibilityLabel="View all progress"
          >
            <Text style={styles.viewProgressText}>View all</Text>
            <Ionicons name="chevron-forward" size={15} color={BROWN} />
          </Pressable>
        </View>

        <View style={styles.progressCard}>
          {/* SUMMARY */}
          <View style={styles.progressIntro}>
            <View style={styles.progressIconCircle}>
              <Ionicons name="trending-up" size={23} color={BROWN} />
            </View>

            <View style={styles.progressIntroText}>
              <Text style={styles.progressTitle}>
                {progressLoading
                  ? 'Loading your progress...'
                  : totalExercisesCompleted === 0
                    ? 'Your journey starts here'
                    : 'Look how far you’ve come!'}
              </Text>

              <Text style={styles.progressSubtitle}>
                {progressLoading
                  ? 'Getting your latest practice records.'
                  : totalExercisesCompleted === 0
                    ? 'Complete your first exercise to start tracking your improvement.'
                    : 'Keep practicing to strengthen your voice.'}
              </Text>
            </View>
          </View>

          {/* STATISTICS */}
          <View style={styles.progressSummaryRow}>
            <View style={styles.progressSummaryItem}>
              <Text style={styles.progressSummaryValue}>
                {progressLoading ? '—' : totalExercisesCompleted}
              </Text>
              <Text style={styles.progressSummaryLabel}>
                Total exercises
              </Text>
            </View>

            <View style={styles.progressSummaryDivider} />

            <View style={styles.progressSummaryItem}>
              <Text style={styles.progressSummaryValue}>
                {progressLoading ? '—' : practiceDays}
              </Text>
              <Text style={styles.progressSummaryLabel}>
                Practice days
              </Text>
            </View>
          </View>

          {/* COMPONENT PROGRESS */}
          <View style={styles.progressComponents}>
            <Text style={styles.progressComponentsTitle}>
              Your vocal components
            </Text>
            {[
              {
                id: 'breathControl',
                name: 'Breath Control',
                icon: 'leaf-outline',
              },
              {
                id: 'pitch',
                name: 'Pitch',
                icon: 'musical-note-outline',
              },
              {
                id: 'tone',
                name: 'Tone',
                icon: 'radio-outline',
              },
              {
                id: 'volume',
                name: 'Volume',
                icon: 'volume-high-outline',
              },
              {
                id: 'agility',
                name: 'Agility',
                icon: 'flash-outline',
              },
            ].map((component) => {
              const summary = progressSummaries.find(
                (item) => item.componentId === component.id
              );

              const completed = summary?.exercisesCompleted ?? 0;

              const percentage = Math.round(
                Math.max(
                  0,
                  Math.min(100, summary?.averageRecentScorePct ?? 0)
                )
              );

              return (
                <View
                  key={component.id}
                  style={styles.dashboardComponent}
                >
                  <View style={styles.dashboardComponentTop}>
                    <View style={styles.dashboardComponentNameRow}>
                      <Ionicons
                        name={
                          component.icon as ComponentProps<
                            typeof Ionicons
                          >['name']
                        }
                        size={17}
                        color={BROWN}
                      />

                      <Text style={styles.dashboardComponentName}>
                        {component.name}
                      </Text>
                    </View>

                    <Text style={styles.dashboardComponentCount}>
                      {progressLoading
                        ? '—'
                        : `${completed} exercises · ${percentage}%`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* ACTION */}
          <Pressable
            style={styles.progressAction}
            onPress={() => router.push('/progress')}
            accessibilityRole="button"
          >
            <Text style={styles.progressActionText}>
              Explore my progress
            </Text>
            <Ionicons name="arrow-forward" size={17} color={WHITE} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

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
    marginBottom: 14,
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

  progressSectionSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: MUTED,
    marginTop: 3,
  },

  viewProgressButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 8,
    paddingLeft: 8,
  },

  viewProgressText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },

  progressCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#F2DDE5',
    marginBottom: 20,
  },

  progressIntro: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  progressIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PINK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  progressIntroText: {
    flex: 1,
  },

  progressTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 17,
    color: BROWN,
  },

  progressSubtitle: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
    marginTop: 3,
  },

  progressSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 16,
    backgroundColor: WHITE,
    borderRadius: 15,
  },

  progressSummaryItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 5,
  },

  progressSummaryValue: {
    fontFamily: 'FredokaBold',
    fontSize: 24,
    color: BROWN,
  },

  progressSummaryLabel: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    textAlign: 'center',
    marginTop: 3,
  },

  progressSummaryDivider: {
    width: 1,
    height: 34,
    backgroundColor: '#F2DDE5',
  },

  progressComponents: {
    marginTop: 20,
  },

  progressComponentsTitle: {
    fontFamily: 'FredokaBold',
    fontSize: 15,
    color: BROWN,
    marginBottom: 15,
  },

  dashboardComponent: {
    marginBottom: 15,
  },

  dashboardComponentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },

  dashboardComponentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },

  dashboardComponentName: {
    fontFamily: 'FredokaMedium',
    fontSize: 12,
    color: BROWN,
  },

  dashboardComponentCount: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
  },

  progressAction: {
    backgroundColor: BROWN,
    minHeight: 45,
    borderRadius: 23,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },

  progressActionText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: WHITE,
  },

  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
});