import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';

import {
  useCallback,
  useMemo,
  useState,
} from 'react';

import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { auth } from '@/services/firebase/config';

import {
  getRecentAssessments,
} from '@/services/assessment/assessmentRepository';

import type {
  SavedAssessmentResult,
} from '@/services/assessment/assessmentRepository';

import {
  fetchAllProgress,
  fetchExerciseRecords,
} from '@/services/progress/progressRepo';

import type {
  ComponentId,
  ComponentProgressSummary,
  ExerciseAttempt,
  PeriodComparison,
  ProgressPeriod,
} from '@/services/progress/progressModule';

import {
  comparePeriods
} from '@/services/progress/progressModule';

// ============================================================
// COLORS
// ============================================================

const BROWN = '#4E2F1F';
const PINK = '#FCD6DD';
const LIGHT_PINK = '#FFF8FA';
const LIGHT_GRAY = '#F2F2F2';
const WHITE = '#FFFFFF';
const MUTED = '#8E7770';
const GREEN = '#3E8E5A';
const RED = '#B24A4A';
const BORDER = '#F2DDE5';

// ============================================================
// COMPONENT INFORMATION
// ============================================================

const components: {
  id: ComponentId;
  name: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
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

// ============================================================
// HELPERS
// ============================================================

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

// ============================================================
// DELTA BADGE
// ============================================================

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

  const color =
    rounded > 0 ? GREEN : rounded < 0 ? RED : MUTED;

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

// ============================================================
// EMPTY PROGRESS SUMMARY
// ============================================================

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

// ============================================================
// SCREEN
// ============================================================

export default function ProgressScreen() {
  // ----------------------------------------------------------
  // SELECTED PERIOD
  // ----------------------------------------------------------

  const [period, setPeriod] = useState<ProgressPeriod>('daily');

  // ----------------------------------------------------------
  // ASSESSMENT STATE
  // ----------------------------------------------------------

  const [latestAssessment, setLatestAssessment] =
    useState<SavedAssessmentResult | null>(null);

  const [previousAssessment, setPreviousAssessment] =
    useState<SavedAssessmentResult | null>(null);

  const [assessmentLoading, setAssessmentLoading] =
    useState(true);

  const [assessmentError, setAssessmentError] =
    useState(false);

  // ----------------------------------------------------------
  // EXERCISE PROGRESS STATE
  // ----------------------------------------------------------

  const [exerciseProgress, setExerciseProgress] =
    useState<ComponentProgressSummary[]>([]);

  const [attempts, setAttempts] =
    useState<ExerciseAttempt[]>([]);

  const [progressLoading, setProgressLoading] =
    useState(true);

  const [progressError, setProgressError] =
    useState(false);

  // ==========================================================
  // LOAD DATA WHEN SCREEN GETS FOCUS
  // ==========================================================

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function loadProgressData() {
        setAssessmentLoading(true);
        setProgressLoading(true);
        setAssessmentError(false);
        setProgressError(false);

        const user = auth.currentUser;

        if (!user) {
          if (isMounted) {
            setLatestAssessment(null);
            setPreviousAssessment(null);
            setExerciseProgress([]);
            setAttempts([]);
            setAssessmentLoading(false);
            setProgressLoading(false);
          }

          return;
        }

        // Retrieve assessments and exercise data independently.
        const [
          assessmentResult,
          progressResult,
          ...historyResults
        ] = await Promise.allSettled([
          getRecentAssessments(2),
          fetchAllProgress(user.uid),

          ...components.map(component =>
            fetchExerciseRecords(user.uid, component.id),
          ),
        ]);

        if (!isMounted) {
          return;
        }

        // ------------------------------------------------------
        // ASSESSMENTS
        // ------------------------------------------------------

        if (assessmentResult.status === 'fulfilled') {
          setLatestAssessment(
            assessmentResult.value[0] ?? null,
          );

          setPreviousAssessment(
            assessmentResult.value[1] ?? null,
          );
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

        // ------------------------------------------------------
        // COMPONENT PROGRESS SUMMARIES
        // ------------------------------------------------------

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

        // ------------------------------------------------------
        // COMBINE EXERCISE HISTORY
        // ------------------------------------------------------

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

        combinedAttempts.sort(
          (a, b) => a.timestamp - b.timestamp,
        );

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
        }
      });

      return () => {
        isMounted = false;
      };
    }, []),
  );

  // ==========================================================
  // PERIOD LABEL
  // ==========================================================

  const periodLabel =
    period === 'daily'
      ? 'Last 24 Hours'
      : period === 'weekly'
        ? 'Last 7 Days'
        : 'Last 30 Days';

  const compareLabel =
    period === 'daily'
      ? 'previous 24 hours'
      : period === 'weekly'
        ? 'previous 7 days'
        : 'previous 30 days';

  // ==========================================================
  // ASSESSMENT SUMMARY
  // ==========================================================

  const assessmentAverage = averageScorePct(latestAssessment);

  const previousAssessmentAverage =
    averageScorePct(previousAssessment);

  const overallAssessmentDelta =
    latestAssessment && previousAssessment
      ? assessmentAverage - previousAssessmentAverage
      : null;

  // ==========================================================
  // EXERCISE PERIOD SUMMARY
  // ==========================================================

  const periodComparison = useMemo(
    () => comparePeriods(attempts, period),
    [attempts, period],
  );

  const totalExercises = periodComparison.current.count;

  const overallExerciseAverage =
    periodComparison.current.averagePct;

  const getComponentProgress = useCallback(
    (componentId: ComponentId): ComponentProgressSummary => {
      return (
        exerciseProgress.find(
          item => item.componentId === componentId,
        ) ?? emptyProgress(componentId)
      );
    },
    [exerciseProgress],
  );

  const componentComparisons = useMemo(() => {
    const result = {} as Record<ComponentId, PeriodComparison>;

    for (const component of components) {
      result[component.id] = comparePeriods(
        attempts.filter(
          attempt => attempt.componentId === component.id,
        ),
        period,
      );
    }

    return result;
  }, [attempts, period]);

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <View style={styles.screen}>
      <AppHeader />

      <Pressable
        style={styles.backButton}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={22} color={BROWN} />
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* TITLE */}

        <Text style={styles.title}>My Progress</Text>

        <Text style={styles.subtitle}>
          Track your vocal improvement.
        </Text>

        {/* PERIOD SELECTOR */}

        <View style={styles.periodSelector}>
          {(
            [
              ['daily', 'Daily'],
              ['weekly', 'Weekly'],
              ['monthly', 'Monthly'],
            ] as const
          ).map(([value, label]) => (
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

        {/* PERIOD SUMMARY */}

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

        {/* LATEST ASSESSMENT */}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Latest Assessment
          </Text>

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
              color={BROWN}
            />

            <Text style={styles.emptyTitle}>
              Assessment Unavailable
            </Text>

            <Text style={styles.emptyText}>
              We couldn't load your assessment records. Please
              check your connection and try again.
            </Text>
          </View>
        ) : latestAssessment ? (
          <>
            {/* OVERALL ASSESSMENT SCORE */}

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
                    Compared with your previous assessment
                  </Text>
                )}
              </View>

              <View style={styles.assessmentIconCircle}>
                <Ionicons name="mic" size={25} color={BROWN} />
              </View>
            </View>

            {/* ACTUAL ASSESSMENT COMPONENT SCORES */}

            <View style={styles.assessmentScoresCard}>
              {components.map((component, index) => {
                const score = getAssessmentComponentScore(
                  latestAssessment,
                  component.id,
                );

                const previousScore =
                  getAssessmentComponentScore(
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
                      color={BROWN}
                    />

                    <Text style={styles.componentName}>
                      {component.name}
                    </Text>
                  </View>

                      <View style={styles.deltaRow}>
                        <DeltaBadge delta={delta} />

                        <Text style={styles.componentScore}>
                          {score === null ? '—' : `${score}%`}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.progressBackground}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${score ?? 0}%`,
                          },
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
            >
              <Text style={styles.outlineButtonText}>
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
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <Ionicons
                name="mic-outline"
                size={25}
                color={BROWN}
              />
            </View>

            <Text style={styles.emptyTitle}>
              No Assessment Yet
            </Text>

            <Text style={styles.emptyText}>
              Complete a vocal assessment to see your Breath
              Control, Pitch, Tone, Volume, and Agility scores.
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
            >
              <Text style={styles.primaryButtonText}>
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

        {/* EXERCISE PROGRESS */}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Exercise Progress
          </Text>

          <Text style={styles.sectionSubtitle}>
            Completed exercises during the selected period and
            your overall progress by component.
          </Text>
        </View>

        {!progressLoading &&
          components.map(component => {
            const progress = getComponentProgress(component.id);
            const comparison = componentComparisons[component.id];

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
                      color={BROWN}
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
                  <View style={styles.metaGroup}>
                    <Text style={styles.componentMetaText}>
                      {progress.exercisesCompleted}{' '}
                      {progress.exercisesCompleted === 1
                        ? 'exercise'
                        : 'exercises'}{' '}
                      total
                    </Text>
                  </View>

                  <Text style={styles.componentMetaText}>
                    {formatTier(progress.currentTier)}
                  </Text>
                </View>

                <View style={styles.comparisonRow}>
                  <Text style={styles.comparisonText}>
                    {comparison.current.count}{' '}
                    {comparison.current.count === 1
                      ? 'exercise'
                      : 'exercises'}{' '}
                    in {periodLabel.toLowerCase()}
                  </Text>

                  <DeltaBadge delta={comparison.scoreDelta} />
                </View>

                <Text style={styles.comparisonHint}>
                  Score change vs {compareLabel}
                  {comparison.scoreDelta === null
                    ? ': not enough data'
                    : ''}
                </Text>
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
                color={BROWN}
              />

              <Text style={styles.emptyTitle}>
                No Exercise History Yet
              </Text>

              <Text style={styles.emptyText}>
                Complete an exercise to start tracking your scores
                and progress here.
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

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WHITE,
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
    textAlign: 'center',
  },

  divider: {
    width: 1,
    height: 42,
    backgroundColor: '#E8C7D0',
  },

  loadingText: {
    fontFamily: 'FredokaRegular',
    fontSize: 12,
    color: MUTED,
  },

  warningText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    color: RED,
    marginTop: 12,
  },

  sectionHeader: {
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

  assessmentScoresCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    paddingHorizontal: 17,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },

  assessmentScoreItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  assessmentScoreItemLast: {
    borderBottomWidth: 0,
  },

  componentCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
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
    flexShrink: 1,
  },
  
  componentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
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

  componentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },

  metaGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  componentMetaText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    textTransform: 'capitalize',
  },

  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },

  comparisonText: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
    flexShrink: 1,
  },

  comparisonHint: {
    fontFamily: 'FredokaRegular',
    fontSize: 10,
    color: MUTED,
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
    backgroundColor: WHITE,
  },

  deltaText: {
    fontFamily: 'FredokaBold',
    fontSize: 11,
  },

  outlineButton: {
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

  outlineButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: BROWN,
  },

  primaryButton: {
    height: 44,
    borderRadius: 22,
    backgroundColor: BROWN,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  primaryButtonText: {
    fontFamily: 'FredokaBold',
    fontSize: 13,
    color: WHITE,
  },

  emptyCard: {
    backgroundColor: LIGHT_PINK,
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
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
    marginTop: 10,
    marginBottom: 6,
  },

  emptyText: {
    fontFamily: 'FredokaRegular',
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 15,
  },
});