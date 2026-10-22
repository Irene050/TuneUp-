
import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/hooks/useAuth';
import { useProgress } from '@/hooks/useProgress';
import {
  getLatestAssessment,
  type SavedAssessmentResult,
} from '@/services/assessment/assessmentRepository';
import { frequencyToNoteName } from '@/utils/music/notes';

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const CARD_PINK = '#FFF2F5';
const BORDER = '#F2DDE5';

const VOCAL_COMPONENTS = [
  {
    id: 'breathControl',
    name: 'Breath Control',
    icon: 'leaf-outline',
    description: 'Breath Control Exercises Available Here!',
    route: '/exercises/breath-control',
  },
  {
    id: 'pitch',
    name: 'Pitch',
    icon: 'musical-note-outline',
    description: 'Pitch Exercises Available Here!',
    route: '/exercises/pitch',
  },
  {
    id: 'tone',
    name: 'Tone',
    icon: 'radio-outline',
    description: 'Tone Exercises Available Here!',
    route: '/exercises/tone',
  },
  {
    id: 'volume',
    name: 'Volume',
    icon: 'volume-high-outline',
    description: 'Volume Exercises Available Here!',
    route: '/exercises/volume',
  },
  {
    id: 'agility',
    name: 'Agility',
    icon: 'flash-outline',
    description: 'Agility Exercises Available Here!',
    route: '/exercises/agility',
  },
] as const;

const TIER_RANK = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
} as const;

export default function DashboardScreen() {
  const { userName } = useAuth();

  const {
    summaries: progressSummaries,
    totalExercisesCompleted,
    practiceDays,
    loading: progressLoading,
  } = useProgress();

  const [latestAssessment, setLatestAssessment] =
    useState<SavedAssessmentResult | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(true);

  const displayName = userName.trim() || 'Singer';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  const overallTier = progressSummaries.reduce(
    (highestTier, summary) =>
      TIER_RANK[summary.currentTier] > TIER_RANK[highestTier]
        ? summary.currentTier
        : highestTier,
    'beginner' as keyof typeof TIER_RANK,
  );

  const formattedTier =
    overallTier.charAt(0).toUpperCase() + overallTier.slice(1);

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
          console.error('Failed to load latest assessment:', error);

          if (mounted) {
            setLatestAssessment(null);
          }
        } finally {
          if (mounted) {
            setAssessmentLoading(false);
          }
        }
      };

      void loadAssessment();

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
        {/* User profile */}
        <View style={styles.userSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{avatarInitial}</Text>
          </View>

          <View>
            <Text style={styles.userName}>{displayName}</Text>

            <Text style={styles.userLevel}>
              {progressLoading
                ? 'Loading tier...'
                : `${formattedTier} tier`}
            </Text>
          </View>
        </View>

        {/* Assessment card with two independent actions */}
        <View style={styles.assessmentCard}>
          <View style={styles.assessmentIcon}>
            <Ionicons name="mic" size={25} color={BROWN} />
          </View>

          <View style={styles.assessmentContent}>
            <Text style={styles.assessmentTitle}>
              Find your vocal strengths!
            </Text>

            <Text style={styles.assessmentDescription}>
              Assess your vocal range and personalize your exercises, or
              sing a melody to evaluate your singing performance.
            </Text>

            <View style={styles.assessmentActions}>
              <Pressable
                style={styles.assessmentButton}
                onPress={() =>
                  router.push({
                    pathname: '/dashboard',
                    params: { tab: 'assessment' },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Assess me"
              >
                <Text style={styles.assessmentButtonText}>
                  Assess me!
                </Text>
              </Pressable>

              <Pressable
                style={styles.singingAssessmentButton}
                onPress={() => router.push({
                  pathname: '/dashboard',
                  params: { tab: 'singing' },
                })}
                accessibilityRole="button"
                accessibilityLabel="Singing Assessment"
              >
                <Text style={styles.singingAssessmentButtonText}>
                  Singing Assessment
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Vocal range */}
        <View style={styles.rangeCard}>
          <View style={styles.rangeIcon}>
            <Ionicons
              name="musical-notes"
              size={24}
              color={BROWN}
            />
          </View>

          <View style={styles.rangeContent}>
            <Text style={styles.rangeLabel}>Your Vocal Range</Text>

            {assessmentLoading ? (
              <Text style={styles.rangeText}>Loading...</Text>
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
                Complete an assessment to discover your range.
              </Text>
            )}

            {latestAssessment && (
              <Text style={styles.rangeSubtext}>
                Based on your latest assessment
              </Text>
            )}
          </View>
        </View>

        {/* Vocal components */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Vocal Components</Text>

          <Pressable
            onPress={() => router.setParams({ tab: 'exercises' })}
            accessibilityRole="button"
            accessibilityLabel="View more exercises"
          >
            <Text style={styles.viewMore}>view more</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.exerciseScroll}
        >
          {VOCAL_COMPONENTS.map((component) => (
            <Pressable
              key={component.id}
              onPress={() => router.push(component.route)}
              style={styles.exerciseCard}
              accessibilityRole="button"
              accessibilityLabel={`Open ${component.name} exercises`}
            >
              <View style={styles.exerciseImage}>
                <Ionicons
                  name={component.icon}
                  size={76}
                  color={BROWN}
                />
              </View>

              <View style={styles.exerciseBottom}>
                <View style={styles.exerciseText}>
                  <Text style={styles.exerciseName}>
                    {component.name}
                  </Text>

                  <Text style={styles.exerciseDescription}>
                    {component.description}
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
          ))}
        </ScrollView>

        {/* Progress heading */}
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

            <Ionicons
              name="chevron-forward"
              size={15}
              color={BROWN}
            />
          </Pressable>
        </View>

        {/* Progress summary */}
        <View style={styles.progressCard}>
          <View style={styles.progressIntro}>
            <View style={styles.progressIconCircle}>
              <Ionicons
                name="trending-up"
                size={30}
                color={BROWN}
              />
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

          <View style={styles.progressComponents}>
            <Text style={styles.progressComponentsTitle}>
              Your vocal components
            </Text>

            {VOCAL_COMPONENTS.map((component) => {
              const summary = progressSummaries.find(
                (item) => item.componentId === component.id,
              );

              const completed = summary?.exercisesCompleted ?? 0;

              const percentage = Math.round(
                Math.max(
                  0,
                  Math.min(
                    100,
                    summary?.averageRecentScorePct ?? 0,
                  ),
                ),
              );

              return (
                <View
                  key={component.id}
                  style={styles.dashboardComponent}
                >
                  <View style={styles.dashboardComponentTop}>
                    <View style={styles.dashboardComponentNameRow}>
                      <Ionicons
                        name={component.icon}
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

          <Pressable
            style={styles.progressAction}
            onPress={() => router.push('/progress')}
            accessibilityRole="button"
            accessibilityLabel="Explore my progress"
          >
            <Text style={styles.progressActionText}>
              Explore my progress
            </Text>

            <Ionicons
              name="arrow-forward"
              size={17}
              color={WHITE}
            />
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
    paddingBottom: 150,
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
  assessmentCard: {
    width: '100%',
    backgroundColor: PINK,
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18,
    elevation: 4,
  },
  assessmentIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: WHITE,
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
    marginBottom: 14,
  },
  assessmentActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  assessmentButton: {
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: BROWN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assessmentButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: WHITE,
  },
  singingAssessmentButton: {
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  singingAssessmentButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 12,
    color: BROWN,
  },
  rangeCard: {
    width: '100%',
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_PINK,
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: LIGHT_PINK,
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
    alignItems: 'center',
    justifyContent: 'center',
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
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
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
    backgroundColor: CARD_PINK,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: CARD_PINK,
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
    backgroundColor: BORDER,
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
});