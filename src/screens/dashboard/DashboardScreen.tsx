import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { COLORS } from '@/constants/appConstants';
import { exerciseStyles } from '@/constants/exerciseStyles';
import type { Tier } from '@/constants/params';
import { useAuth } from '@/hooks/useAuth';
import { useProgress } from '@/hooks/useProgress';
import {
  getLatestAssessment,
  type SavedAssessmentResult,
} from '@/services/assessment/assessmentRepository';
import { frequencyToNoteName } from '@/utils/music/notes';

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

const TIER_RANK: Record<Tier, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

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

  const overallTier = progressSummaries.reduce<Tier>(
    (highestTier, summary) => {
      const currentTier: Tier = summary.currentTier;

      return TIER_RANK[currentTier] > TIER_RANK[highestTier]
        ? currentTier
        : highestTier;
    },
    'beginner',
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
    <View style={exerciseStyles.screen}>
      <AppHeader />

      <ScrollView
        style={exerciseStyles.infoText}
        contentContainerStyle={exerciseStyles.content_Dashboard}
        showsVerticalScrollIndicator={false}
      >
        <View style={exerciseStyles.userSection}>
          <View style={exerciseStyles.avatar_Dashboard}>
            <Text style={exerciseStyles.liveValueVariant1}>{avatarInitial}</Text>
          </View>

          <View>
            <Text style={exerciseStyles.resultValueVariant1}>{displayName}</Text>

            <Text style={exerciseStyles.userLevel}>
              {progressLoading
                ? 'Loading tier...'
                : `${formattedTier} tier`}
            </Text>
          </View>
        </View>

        <View style={exerciseStyles.assessmentCard}>
          <View style={exerciseStyles.assessmentIcon}>
            <Ionicons name="mic" size={25} color={COLORS.brown} />
          </View>

          <View style={exerciseStyles.infoText}>
            <Text style={exerciseStyles.assessmentTitle}>
              Find your vocal strengths!
            </Text>

            <Text style={exerciseStyles.assessmentDescription}>
              Assess your vocal range and personalize your exercises, or
              sing a melody to evaluate your singing performance.
            </Text>

            <View style={exerciseStyles.assessmentActions}>
              <Pressable
                style={exerciseStyles.assessmentButton}
                onPress={() =>
                  router.push({
                    pathname: '/dashboard',
                    params: { tab: 'assessment' },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Assess me"
              >
                <Text style={exerciseStyles.progressActionText}>
                  Assess me!
                </Text>
              </Pressable>

              <Pressable
                style={exerciseStyles.singingAssessmentButton}
                onPress={() => router.push({
                  pathname: '/dashboard',
                  params: { tab: 'singing' },
                })}
                accessibilityRole="button"
                accessibilityLabel="Singing Assessment"
              >
                <Text style={exerciseStyles.scoreRowValue}>
                  Singing Assessment
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={exerciseStyles.rangeCard_Dashboard}>
          <View style={exerciseStyles.rangeIcon}>
            <Ionicons
              name="musical-notes"
              size={24}
              color={COLORS.brown}
            />
          </View>

          <View style={exerciseStyles.infoText}>
            <Text style={exerciseStyles.rangeLabel}>Your Vocal Range</Text>

            {assessmentLoading ? (
              <Text style={exerciseStyles.rangeText_Dashboard}>Loading...</Text>
            ) : latestAssessment ? (
              <Text style={exerciseStyles.rangeText_Dashboard}>
                {frequencyToNoteName(
                  latestAssessment.vocalRangeLowHz,
                )}
                {' – '}
                {frequencyToNoteName(
                  latestAssessment.vocalRangeHighHz,
                )}
              </Text>
            ) : (
              <Text style={exerciseStyles.rangeEmptyText}>
                Complete an assessment to discover your range.
              </Text>
            )}

            {latestAssessment && (
              <Text style={exerciseStyles.comparisonFrequency}>
                Based on your latest assessment
              </Text>
            )}
          </View>
        </View>

        <View style={exerciseStyles.sectionHeader_Dashboard}>
          <Text style={exerciseStyles.liveValueVariant1}>Vocal Components</Text>

          <Pressable
            onPress={() => router.setParams({ tab: 'exercises' })}
            accessibilityRole="button"
            accessibilityLabel="View more exercises"
          >
            <Text style={exerciseStyles.scoreLabel}>view more</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={exerciseStyles.exerciseScroll_Dashboard}
        >
          {VOCAL_COMPONENTS.map((component) => (
            <Pressable
              key={component.id}
              onPress={() => router.push(component.route)}
              style={exerciseStyles.exerciseCard_Dashboard}
              accessibilityRole="button"
              accessibilityLabel={`Open ${component.name} exercises`}
            >
              <View style={exerciseStyles.exerciseImage}>
                <Ionicons
                  name={component.icon}
                  size={76}
                  color={COLORS.brown}
                />
              </View>

              <View style={exerciseStyles.summaryRow}>
                <View style={exerciseStyles.infoText}>
                  <Text style={exerciseStyles.exerciseName_Dashboard}>
                    {component.name}
                  </Text>

                  <Text style={exerciseStyles.exerciseDescription}>
                    {component.description}
                  </Text>
                </View>

                <View style={exerciseStyles.playButton_Dashboard}>
                  <Ionicons
                    name="play"
                    size={20}
                    color={COLORS.brown}
                  />
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        <View style={exerciseStyles.sectionHeader_Dashboard}>
          <View>
            <Text style={exerciseStyles.liveValueVariant1}>My Progress</Text>

            <Text style={exerciseStyles.progressSectionSubtitle}>
              Every practice session counts!
            </Text>
          </View>

          <Pressable
            style={exerciseStyles.viewProgressButton}
            onPress={() => router.push('/progress')}
            accessibilityRole="button"
            accessibilityLabel="View all progress"
          >
            <Text style={exerciseStyles.scoreRowValue}>View all</Text>

            <Ionicons
              name="chevron-forward"
              size={15}
              color={COLORS.brown}
            />
          </Pressable>
        </View>

        <View style={exerciseStyles.progressCard}>
          <View style={exerciseStyles.summaryRow}>
            <View style={exerciseStyles.progressIconCircle}>
              <Ionicons
                name="trending-up"
                size={30}
                color={COLORS.brown}
              />
            </View>

            <View style={exerciseStyles.infoText}>
              <Text style={exerciseStyles.progressTitle}>
                {progressLoading
                  ? 'Loading your progress...'
                  : totalExercisesCompleted === 0
                    ? 'Your journey starts here'
                    : 'Look how far you’ve come!'}
              </Text>

              <Text style={exerciseStyles.progressSubtitle}>
                {progressLoading
                  ? 'Getting your latest practice records.'
                  : totalExercisesCompleted === 0
                    ? 'Complete your first exercise to start tracking your improvement.'
                    : 'Keep practicing to strengthen your voice.'}
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.progressSummaryRow}>
            <View style={exerciseStyles.progressSummaryItem}>
              <Text style={exerciseStyles.liveValueVariant1}>
                {progressLoading ? '—' : totalExercisesCompleted}
              </Text>

              <Text style={exerciseStyles.metricHint}>
                Total exercises
              </Text>
            </View>

            <View style={exerciseStyles.progressSummaryDivider} />

            <View style={exerciseStyles.progressSummaryItem}>
              <Text style={exerciseStyles.liveValueVariant1}>
                {progressLoading ? '—' : practiceDays}
              </Text>

              <Text style={exerciseStyles.metricHint}>
                Practice days
              </Text>
            </View>
          </View>

          <View style={exerciseStyles.progressComponents}>
            <Text style={exerciseStyles.progressComponentsTitle}>
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
                  style={exerciseStyles.dashboardComponent}
                >
                  <View style={exerciseStyles.dashboardComponentTop}>
                    <View style={exerciseStyles.componentNameRow}>
                      <Ionicons
                        name={component.icon}
                        size={17}
                        color={COLORS.brown}
                      />

                      <Text style={exerciseStyles.dashboardComponentName}>
                        {component.name}
                      </Text>
                    </View>

                    <Text style={exerciseStyles.guideText}>
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
            style={exerciseStyles.progressAction}
            onPress={() => router.push('/progress')}
            accessibilityRole="button"
            accessibilityLabel="Explore my progress"
          >
            <Text style={exerciseStyles.progressActionText}>
              Explore my progress
            </Text>

            <Ionicons
              name="arrow-forward"
              size={17}
              color={COLORS.white}
            />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
