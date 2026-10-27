import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  SavedAssessmentResult,
  SavedSingingAssessmentResult,
} from '@/services/assessment/assessmentRepository';

import {
  getRecentAssessments,
  getRecentSingingAssessments,
} from '@/services/assessment/assessmentRepository';

import { auth } from '@/services/firebase/config';

import type {
  ComponentId,
  ComponentProgressSummary,
  ExerciseAttempt,
  ProgressPeriod,
} from '@/services/progress/progressModule';

import { comparePeriods } from '@/services/progress/progressModule';

import {
  fetchAllProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import { COLORS } from '@/constants/appConstants';

type ComponentInfo = {
  id: ComponentId;
  name: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

const components: ComponentInfo[] = [
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
];

const periods: { value: ProgressPeriod; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

function formatAssessmentDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 'Date unavailable';
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(Math.max(0, Math.min(100, value)));
}

function averageScorePct(
  assessment: SavedAssessmentResult | null,
): number {
  if (!assessment || assessment.scores.length === 0) {
    return 0;
  }

  const total = assessment.scores.reduce(
    (sum, score) => sum + clampPercentage(score.scorePct),
    0,
  );

  return Math.round(total / assessment.scores.length);
}

function getAssessmentComponentScore(
  assessment: SavedAssessmentResult | null,
  componentId: ComponentId,
): number | null {
  if (!assessment) {
    return null;
  }

  const score = assessment.scores.find(
    item => item.componentId === componentId,
  );

  return score ? clampPercentage(score.scorePct) : null;
}

function formatTier(tier: string): string {
  if (!tier) {
    return 'Beginner';
  }

  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function emptyProgress(
  componentId: ComponentId,
): ComponentProgressSummary {
  return {
    componentId,
    currentTier: 'beginner',
    exercisesCompleted: 0,
    averageRecentScorePct: 0,
  };
}

function DeltaBadge({
  delta,
  suffix = '%',
}: {
  delta: number | null;
  suffix?: string;
}) {
  if (delta === null || !Number.isFinite(delta)) {
    return null;
  }

  const rounded = Math.round(delta);
  const color = rounded > 0 ? COLORS.success : rounded < 0 ? COLORS.error : COLORS.muted;

  const icon =
    rounded > 0
      ? 'arrow-up'
      : rounded < 0
        ? 'arrow-down'
        : 'remove';

  return (
    <View style={styles.deltaBadge}>
      <Ionicons name={icon} size={11} color={color} />

      <Text style={[styles.deltaText, { color }]}>
        {rounded > 0 ? '+' : ''}
        {rounded}
        {suffix}
      </Text>
    </View>
  );
}

export default function ProgressScreen() {
  const [period, setPeriod] = useState<ProgressPeriod>('daily');

  const [latestAssessment, setLatestAssessment] =
    useState<SavedAssessmentResult | null>(null);

  const [previousAssessment, setPreviousAssessment] =
    useState<SavedAssessmentResult | null>(null);

  const [assessmentLoading, setAssessmentLoading] = useState(true);
  const [assessmentError, setAssessmentError] = useState(false);

  const [latestSingingAssessment, setLatestSingingAssessment] =
    useState<SavedSingingAssessmentResult | null>(null);

  const [singingAssessmentLoading, setSingingAssessmentLoading] =
    useState(true);

  const [singingAssessmentError, setSingingAssessmentError] =
    useState(false);

  const [exerciseProgress, setExerciseProgress] =
    useState<ComponentProgressSummary[]>([]);

  const [attempts, setAttempts] = useState<ExerciseAttempt[]>([]);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressError, setProgressError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function loadProgressData() {
        setAssessmentLoading(true);
        setProgressLoading(true);
        setAssessmentError(false);
        setProgressError(false);
        setSingingAssessmentLoading(true);
        setSingingAssessmentError(false);

        const user = auth.currentUser;

        if (!user) {
          if (isMounted) {
            setLatestAssessment(null);
            setPreviousAssessment(null);
            setExerciseProgress([]);
            setAttempts([]);
            setLatestSingingAssessment(null);
            setAssessmentLoading(false);
            setProgressLoading(false);
            setSingingAssessmentLoading(false);
            setSingingAssessmentError(false);
          }

          return;
        }

        const [
          assessmentResult,
          singingAssessmentResult,
          progressResult,
          ...historyResults
        ] = await Promise.allSettled([
          getRecentAssessments(2),
          getRecentSingingAssessments(1),
          fetchAllProgress(user.uid),
          ...components.map(component =>
            fetchExerciseRecords(user.uid, component.id),
          ),
        ]);

        if (!isMounted) {
          return;
        }

        if (assessmentResult.status === 'fulfilled') {
          setLatestAssessment(assessmentResult.value[0] ?? null);
          setPreviousAssessment(assessmentResult.value[1] ?? null);
        } else {
          console.error(
            'Unable to load assessments:',
            assessmentResult.reason,
          );

          setLatestAssessment(null);
          setPreviousAssessment(null);
          setAssessmentError(true);
        }

        setAssessmentLoading(false);

        if (singingAssessmentResult.status === 'fulfilled') {
          setLatestSingingAssessment(
            singingAssessmentResult.value[0] ?? null,
          );
        } else {
          console.error(
            'Unable to load singing assessments:',
            singingAssessmentResult.reason,
          );

          setLatestSingingAssessment(null);
          setSingingAssessmentError(true);
        }

        setSingingAssessmentLoading(false);

        if (progressResult.status === 'fulfilled') {
          setExerciseProgress(progressResult.value);
        } else {
          console.error(
            'Unable to load component progress:',
            progressResult.reason,
          );

          setExerciseProgress([]);
          setProgressError(true);
        }

        const combinedAttempts: ExerciseAttempt[] = [];
        let historyFailed = false;

        for (let index = 0; index < historyResults.length; index++) {
          const result = historyResults[index];
          const component = components[index];

          if (!component) {
            continue;
          }

          if (result.status === 'fulfilled') {
            for (const record of result.value) {
              combinedAttempts.push({
                componentId: record.componentId,
                scorePct: clampPercentage(record.scorePct),
                timestamp: record.timestamp,
              });
            }
          } else {
            historyFailed = true;

            console.error(
              `Unable to load ${component.name} history:`,
              result.reason,
            );
          }
        }

        combinedAttempts.sort((a, b) => a.timestamp - b.timestamp);
        setAttempts(combinedAttempts);

        if (historyFailed) {
          setProgressError(true);
        }

        setProgressLoading(false);
      }

      void loadProgressData().catch(error => {
        console.error('Unable to load progress screen:', error);

        if (isMounted) {
          setAssessmentLoading(false);
          setProgressLoading(false);
          setAssessmentError(true);
          setProgressError(true);
          setSingingAssessmentLoading(false);
          setSingingAssessmentError(true);
        }
      });

      return () => {
        isMounted = false;
      };
    }, []),
  );

  const periodLabel =
    period === 'daily'
      ? 'Last 24 Hours'
      : period === 'weekly'
        ? 'Last 7 Days'
        : 'Last 30 Days';

  const assessmentAverage = averageScorePct(latestAssessment);
  const previousAssessmentAverage = averageScorePct(previousAssessment);

  const overallAssessmentDelta =
    latestAssessment && previousAssessment
      ? assessmentAverage - previousAssessmentAverage
      : null;

  const periodComparison = useMemo(
    () => comparePeriods(attempts, period),
    [attempts, period],
  );

  const totalExercises = periodComparison.current.count;
  const overallExerciseAverage = periodComparison.current.averagePct;

  const getComponentProgress = useCallback(
    (componentId: ComponentId): ComponentProgressSummary =>
      exerciseProgress.find(item => item.componentId === componentId) ??
      emptyProgress(componentId),
    [exerciseProgress],
  );

  return (
    <View style={styles.screen}>
      <AppHeader />

      <Pressable
        style={styles.backButton}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={22} color={COLORS.brown} />
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>My Progress</Text>

        <Text style={styles.subtitle}>
          Track your vocal improvement.
        </Text>

        <View style={styles.periodSelector}>
          {periods.map(({ value, label }) => (
            <Pressable
              key={value}
              style={[
                styles.periodButton,
                period === value && styles.periodButtonActive,
              ]}
              onPress={() => setPeriod(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: period === value }}
            >
              <Text
                style={[
                  styles.periodText,
                  period === value && styles.periodTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>{periodLabel}</Text>

          {progressLoading ? (
            <Text style={styles.loadingText}>
              Loading exercise history...
            </Text>
          ) : (
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {totalExercises}
                </Text>

                <Text style={styles.summaryLabel}>
                  Exercises completed
                </Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {overallExerciseAverage}%
                </Text>

                <Text style={styles.summaryLabel}>
                  Average score
                </Text>
              </View>
            </View>
          )}

          {!progressLoading && progressError && (
            <Text style={styles.warningText}>
              Some exercise history could not be loaded.
            </Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Latest Assessment</Text>

          <Text style={styles.sectionSubtitle}>
            Your most recent vocal assessment scores.
          </Text>
        </View>

        {assessmentLoading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Loading your assessment...
            </Text>
          </View>
        ) : assessmentError ? (
          <View style={styles.emptyCard}>
            <Ionicons
              name="alert-circle-outline"
              size={28}
              color={COLORS.brown}
            />

            <Text style={styles.emptyTitle}>
              Assessment Unavailable
            </Text>

            <Text style={styles.emptyText}>
              We couldn't load your assessment records. Please check
              your connection and try again.
            </Text>
          </View>
        ) : latestAssessment ? (
          <>
            <View style={styles.assessmentSummaryCard}>
              <View style={styles.assessmentSummaryLeft}>
                <Text style={styles.assessmentSummaryLabel}>
                  Overall Assessment
                </Text>

                <View style={styles.deltaRow}>
                  <Text style={styles.assessmentAverage}>
                    {assessmentAverage}%
                  </Text>

                  <DeltaBadge delta={overallAssessmentDelta} />
                </View>

                <Text style={styles.assessmentDate}>
                  Assessed on{' '}
                  {formatAssessmentDate(latestAssessment.timestamp)}
                </Text>

                {previousAssessment && (
                  <Text style={styles.comparisonHint}>
                    CompaCOLORS.error with your previous assessment
                  </Text>
                )}
              </View>

              <View style={styles.assessmentIconCircle}>
                <Ionicons name="mic" size={25} color={COLORS.brown} />
              </View>
            </View>

            <View style={styles.assessmentScoresCard}>
              {components.map((component, index) => {
                const score = getAssessmentComponentScore(
                  latestAssessment,
                  component.id,
                );

                const previousScore = getAssessmentComponentScore(
                  previousAssessment,
                  component.id,
                );

                const delta =
                  score !== null && previousScore !== null
                    ? score - previousScore
                    : null;

                return (
                  <View
                    key={component.id}
                    style={[
                      styles.assessmentScoreItem,
                      index === components.length - 1 &&
                        styles.assessmentScoreItemLast,
                    ]}
                  >
                    <View style={styles.componentHeader}>
                      <View style={styles.componentNameRow}>
                        <Ionicons
                          name={component.icon}
                          size={18}
                          color={COLORS.brown}
                        />

                        <Text style={styles.componentName}>
                          {component.name}
                        </Text>
                      </View>

                      <View style={styles.deltaRow}>
                        <Text style={styles.componentScore}>
                          {score === null ? '—' : `${score}%`}
                        </Text>

                        <DeltaBadge delta={delta} />
                      </View>
                    </View>

                    <View style={styles.progressBackground}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${score ?? 0}%` },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>

            <Pressable
              style={styles.outlineButton}
              onPress={() =>
                router.push({
                  pathname: '/dashboard',
                  params: { tab: 'assessment' },
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Retake assessment"
            >
              <Text style={styles.outlineButtonText}>
                Retake Assessment
              </Text>

              <Ionicons
                name="arrow-forward"
                size={17}
                color={COLORS.brown}
              />
            </Pressable>
          </>
        ) : (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <Ionicons
                name="mic-outline"
                size={25}
                color={COLORS.brown}
              />
            </View>

            <Text style={styles.emptyTitle}>No Assessment Yet</Text>

            <Text style={styles.emptyText}>
              Complete a vocal assessment to see your Breath Control,
              Pitch, Tone, Volume, and Agility scores.
            </Text>

            <Pressable
              style={styles.primaryButton}
              onPress={() =>
                router.push({
                  pathname: '/dashboard',
                  params: { tab: 'assessment' },
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Take assessment"
            >
              <Text style={styles.primaryButtonText}>
                Take Assessment
              </Text>

              <Ionicons
                name="arrow-forward"
                size={17}
                color={COLORS.white}
              />
            </Pressable>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Singing Assessment</Text>

          <Text style={styles.sectionSubtitle}>
            Your latest singing performance and pitch measurements.
          </Text>
        </View>

        {singingAssessmentLoading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Loading your singing assessment...
            </Text>
          </View>
        ) : singingAssessmentError ? (
          <View style={styles.emptyCard}>
            <Ionicons
              name="alert-circle-outline"
              size={28}
              color={COLORS.brown}
            />

            <Text style={styles.emptyTitle}>
              Singing Assessment Unavailable
            </Text>

            <Text style={styles.emptyText}>
              We couldn't load your singing results. Please check
              your connection and try again.
            </Text>
          </View>
        ) : latestSingingAssessment ? (
          <>
            <View style={styles.assessmentSummaryCard}>
              <View style={styles.assessmentSummaryLeft}>
                <Text style={styles.assessmentSummaryLabel}>
                  Overall Singing Score
                </Text>

                <Text style={styles.assessmentAverage}>
                  {clampPercentage(
                    latestSingingAssessment.overallScore,
                  )}
                  %
                </Text>

                <Text style={styles.assessmentDate}>
                  Assessed on{' '}
                  {formatAssessmentDate(
                    latestSingingAssessment.timestamp,
                  )}
                </Text>

                <Text style={styles.comparisonHint}>
                  {latestSingingAssessment.detectedNoteCount} notes
                  detected
                  {' · '}
                  {latestSingingAssessment.durationSeconds.toFixed(1)}
                  {' '}seconds
                </Text>
              </View>

              <View style={styles.assessmentIconCircle}>
                <Ionicons
                  name="musical-notes"
                  size={25}
                  color={COLORS.brown}
                />
              </View>
            </View>

            <View style={styles.assessmentScoresCard}>
              {[
                {
                  label: 'Pitch Accuracy',
                  score: latestSingingAssessment.pitchAccuracy,
                },
                {
                  label: 'Pitch Stability',
                  score: latestSingingAssessment.pitchStability,
                },
                {
                  label: 'Vocal Consistency',
                  score: latestSingingAssessment.vocalConsistency,
                },
              ].map((metric, index, metrics) => {
                const score = clampPercentage(metric.score);

                return (
                  <View
                    key={metric.label}
                    style={[
                      styles.assessmentScoreItem,
                      index === metrics.length - 1 &&
                        styles.assessmentScoreItemLast,
                    ]}
                  >
                    <View style={styles.componentHeader}>
                      <Text style={styles.componentName}>
                        {metric.label}
                      </Text>

                      <Text style={styles.componentScore}>
                        {score}%
                      </Text>
                    </View>

                    <View style={styles.progressBackground}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${score}%` },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <Ionicons
                name="musical-notes-outline"
                size={25}
                color={COLORS.brown}
              />
            </View>

            <Text style={styles.emptyTitle}>
              No Singing Assessment Yet
            </Text>

            <Text style={styles.emptyText}>
              Complete the Mary Had a Little Lamb singing assessment
              to see your score, pitch accuracy, pitch stability,
              and vocal consistency here.
            </Text>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Exercise Progress</Text>

          <Text style={styles.sectionSubtitle}>
            Completed exercises during the selected period and your
            overall progress by component.
          </Text>
        </View>

      {!progressLoading &&
        components.map(component => {
          const progress = getComponentProgress(component.id);

          const recentScore = clampPercentage(
            progress.averageRecentScorePct,
          );

          return (
            <View
              key={`progress-${component.id}`}
              style={styles.componentCard}
            >
              <View style={styles.componentHeader}>
                <View style={styles.componentNameRow}>
                  <Ionicons
                    name={component.icon}
                    size={18}
                    color={COLORS.brown}
                  />

                  <Text style={styles.componentName}>
                    {component.name}
                  </Text>
                </View>

                <Text style={styles.componentScore}>
                  {recentScore}%
                </Text>
              </View>

              <View style={styles.progressBackground}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${recentScore}%` },
                  ]}
                />
              </View>

              <View style={styles.componentMeta}>
                <Text style={styles.componentMetaText}>
                  {progress.exercisesCompleted}{' '}
                  {progress.exercisesCompleted === 1
                    ? 'exercise'
                    : 'exercises'}{' '}
                  total
                </Text>

                <Text style={styles.componentMetaText}>
                  {formatTier(progress.currentTier)}
                </Text>
              </View>
            </View>
          );
        })}

        {!progressLoading &&
          !progressError &&
          attempts.length === 0 && (
            <View style={styles.emptyCard}>
              <Ionicons
                name="bar-chart-outline"
                size={28}
                color={COLORS.brown}
              />

              <Text style={styles.emptyTitle}>
                No Exercise History Yet
              </Text>

              <Text style={styles.emptyText}>
                Complete an exercise to start tracking your scores and
                progress here.
              </Text>
            </View>
          )}

        {progressLoading && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Loading your exercise progress...
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 25,
    paddingBottom: 140,
  },
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
  title: {
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 30,
    color: COLORS.brown,
    marginTop: 30,
  },
  subtitle: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 3,
    marginBottom: 20,
  },
  periodSelector: {
    flexDirection: 'row',
    backgroundColor: COLORS.lightGray,
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
    backgroundColor: COLORS.pink,
  },
  periodText: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 11,
    color: COLORS.muted,
  },
  periodTextActive: {
    fontFamily: 'FCOLORS.errorokaBold',
    color: COLORS.brown,
  },
  summaryCard: {
    backgroundColor: COLORS.pink,
    borderRadius: 20,
    padding: 20,
    marginBottom: 30,
    shadowColor: COLORS.black,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  summaryTitle: {
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 18,
    color: COLORS.brown,
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
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 30,
    color: COLORS.brown,
  },
  summaryLabel: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 2,
    textAlign: 'center',
  },
  divider: {
    width: 1,
    height: 42,
    backgroundColor: COLORS.background,
  },
  loadingText: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 12,
    color: COLORS.muted,
  },
  warningText: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 11,
    color: COLORS.error,
    marginTop: 12,
  },
  sectionHeader: {
    marginTop: 10,
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 22,
    color: COLORS.brown,
  },
  sectionSubtitle: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.muted,
    marginTop: 3,
    marginBottom: 14,
  },
  assessmentSummaryCard: {
    backgroundColor: COLORS.pink,
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: COLORS.black,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  assessmentSummaryLeft: {
    flex: 1,
  },
  assessmentSummaryLabel: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 11,
    color: COLORS.muted,
    marginBottom: 2,
  },
  assessmentAverage: {
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 34,
    color: COLORS.brown,
  },
  assessmentDate: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 2,
  },
  assessmentIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  assessmentScoresCard: {
    backgroundColor: COLORS.background,
    borderRadius: 18,
    paddingHorizontal: 17,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  assessmentScoreItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  assessmentScoreItemLast: {
    borderBottomWidth: 0,
  },
  componentCard: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  componentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 10,
  },
  componentName: {
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 15,
    color: COLORS.brown,
    flexShrink: 1,
  },
  componentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  componentScore: {
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 14,
    color: COLORS.brown,
  },
  progressBackground: {
    height: 9,
    width: '100%',
    backgroundColor: COLORS.white,
    borderRadius: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.brown,
    borderRadius: 10,
  },
  componentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  componentMetaText: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 10,
    color: COLORS.muted,
    textTransform: 'capitalize',
  },
  comparisonHint: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 10,
    lineHeight: 15,
    color: COLORS.muted,
    marginTop: 5,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deltaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: COLORS.white,
  },
  deltaText: {
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 11,
  },
  outlineButton: {
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 30,
  },
  outlineButtonText: {
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 13,
    color: COLORS.brown,
  },
  primaryButton: {
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.brown,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  primaryButtonText: {
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 13,
    color: COLORS.white,
  },
  emptyCard: {
    backgroundColor: COLORS.background,
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 30,
  },
  emptyIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily: 'FCOLORS.errorokaBold',
    fontSize: 18,
    color: COLORS.brown,
    marginTop: 10,
    marginBottom: 6,
  },
  emptyText: {
    fontFamily: 'FCOLORS.errorokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 15,
  },
});