import AppHeader from '@/components/appheader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

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
import { exerciseStyles } from '@/constants/exerciseStyles';
import { clampPercentage } from '@/utils/math';

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
    <View style={exerciseStyles.deltaBadge}>
      <Ionicons name={icon} size={11} color={color} />

      <Text style={[exerciseStyles.deltaText, { color }]}>
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
    <View style={exerciseStyles.screen}>
      <AppHeader />

      <Pressable
        style={exerciseStyles.backButton_Progress}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={22} color={COLORS.brown} />
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={exerciseStyles.content_Progress}
      >
        <Text style={exerciseStyles.title_Progress}>My Progress</Text>

        <Text style={exerciseStyles.subtitle_Progress}>
          Track your vocal improvement.
        </Text>

        <View style={exerciseStyles.periodSelector}>
          {periods.map(({ value, label }) => (
            <Pressable
              key={value}
              style={[
                exerciseStyles.periodButton,
                period === value && exerciseStyles.resultIconPassed,
              ]}
              onPress={() => setPeriod(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: period === value }}
            >
              <Text
                style={[
                  exerciseStyles.scoreRowLabel,
                  period === value && exerciseStyles.periodTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={exerciseStyles.summaryCard_Progress}>
          <Text style={exerciseStyles.summaryTitle}>{periodLabel}</Text>

          {progressLoading ? (
            <Text style={exerciseStyles.sessionLabel}>
              Loading exercise history...
            </Text>
          ) : (
            <View style={exerciseStyles.summaryRow}>
              <View style={exerciseStyles.sessionPart}>
                <Text style={exerciseStyles.summaryValue}>
                  {totalExercises}
                </Text>

                <Text style={exerciseStyles.summaryLabel}>
                  Exercises completed
                </Text>
              </View>

              <View style={exerciseStyles.divider} />

              <View style={exerciseStyles.sessionPart}>
                <Text style={exerciseStyles.summaryValue}>
                  {overallExerciseAverage}%
                </Text>

                <Text style={exerciseStyles.summaryLabel}>
                  Average score
                </Text>
              </View>
            </View>
          )}

          {!progressLoading && progressError && (
            <Text style={exerciseStyles.warningText}>
              Some exercise history could not be loaded.
            </Text>
          )}
        </View>

        <View style={exerciseStyles.sectionHeader_Progress}>
          <Text style={exerciseStyles.sectionTitle_Progress}>Latest Assessment</Text>

          <Text style={exerciseStyles.sectionSubtitle}>
            Your most recent vocal assessment scores.
          </Text>
        </View>

        {assessmentLoading ? (
          <View style={exerciseStyles.emptyCard}>
            <Text style={exerciseStyles.emptyText}>
              Loading your assessment...
            </Text>
          </View>
        ) : assessmentError ? (
          <View style={exerciseStyles.emptyCard}>
            <Ionicons
              name="alert-circle-outline"
              size={28}
              color={COLORS.brown}
            />

            <Text style={exerciseStyles.emptyTitle}>
              Assessment Unavailable
            </Text>

            <Text style={exerciseStyles.emptyText}>
              We couldn't load your assessment records. Please check
              your connection and try again.
            </Text>
          </View>
        ) : latestAssessment ? (
          <>
            <View style={exerciseStyles.assessmentSummaryCard}>
              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.assessmentSummaryLabel}>
                  Overall Assessment
                </Text>

                <View style={exerciseStyles.deltaRow}>
                  <Text style={exerciseStyles.assessmentAverage}>
                    {assessmentAverage}%
                  </Text>

                  <DeltaBadge delta={overallAssessmentDelta} />
                </View>

                <Text style={exerciseStyles.assessmentDate}>
                  Assessed on{' '}
                  {formatAssessmentDate(latestAssessment.timestamp)}
                </Text>

                {previousAssessment && (
                  <Text style={exerciseStyles.comparisonHint}>
                    CompaCOLORS.error with your previous assessment
                  </Text>
                )}
              </View>

              <View style={exerciseStyles.assessmentIconCircle}>
                <Ionicons name="mic" size={25} color={COLORS.brown} />
              </View>
            </View>

            <View style={exerciseStyles.assessmentScoresCard}>
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
                      exerciseStyles.assessmentScoreItem,
                      index === components.length - 1 &&
                        exerciseStyles.metricRowLast,
                    ]}
                  >
                    <View style={exerciseStyles.componentHeader}>
                      <View style={exerciseStyles.componentNameRow}>
                        <Ionicons
                          name={component.icon}
                          size={18}
                          color={COLORS.brown}
                        />

                        <Text style={exerciseStyles.componentName}>
                          {component.name}
                        </Text>
                      </View>

                      <View style={exerciseStyles.deltaRow}>
                        <Text style={exerciseStyles.componentScore}>
                          {score === null ? '—' : `${score}%`}
                        </Text>

                        <DeltaBadge delta={delta} />
                      </View>
                    </View>

                    <View style={exerciseStyles.progressBackground_Progress}>
                      <View
                        style={[
                          exerciseStyles.progressFill_Assessment,
                          { width: `${score ?? 0}%` },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>

            <Pressable
              style={exerciseStyles.outlineButton}
              onPress={() =>
                router.push({
                  pathname: '/dashboard',
                  params: { tab: 'assessment' },
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Retake assessment"
            >
              <Text style={exerciseStyles.timeText}>
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
          <View style={exerciseStyles.emptyCard}>
            <View style={exerciseStyles.emptyIconCircle}>
              <Ionicons
                name="mic-outline"
                size={25}
                color={COLORS.brown}
              />
            </View>

            <Text style={exerciseStyles.emptyTitle}>No Assessment Yet</Text>

            <Text style={exerciseStyles.emptyText}>
              Complete a vocal assessment to see your Breath Control,
              Pitch, Tone, Volume, and Agility scores.
            </Text>

            <Pressable
              style={exerciseStyles.primaryButton_Progress}
              onPress={() =>
                router.push({
                  pathname: '/dashboard',
                  params: { tab: 'assessment' },
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Take assessment"
            >
              <Text style={exerciseStyles.lyricChipTextActive}>
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

        <View style={exerciseStyles.sectionHeader_Progress}>
          <Text style={exerciseStyles.sectionTitle_Progress}>Singing Assessment</Text>

          <Text style={exerciseStyles.sectionSubtitle}>
            Your latest singing performance and pitch measurements.
          </Text>
        </View>

        {singingAssessmentLoading ? (
          <View style={exerciseStyles.emptyCard}>
            <Text style={exerciseStyles.emptyText}>
              Loading your singing assessment...
            </Text>
          </View>
        ) : singingAssessmentError ? (
          <View style={exerciseStyles.emptyCard}>
            <Ionicons
              name="alert-circle-outline"
              size={28}
              color={COLORS.brown}
            />

            <Text style={exerciseStyles.emptyTitle}>
              Singing Assessment Unavailable
            </Text>

            <Text style={exerciseStyles.emptyText}>
              We couldn't load your singing results. Please check
              your connection and try again.
            </Text>
          </View>
        ) : latestSingingAssessment ? (
          <>
            <View style={exerciseStyles.assessmentSummaryCard}>
              <View style={exerciseStyles.infoText}>
                <Text style={exerciseStyles.assessmentSummaryLabel}>
                  Overall Singing Score
                </Text>

                <Text style={exerciseStyles.assessmentAverage}>
                  {clampPercentage(
                    latestSingingAssessment.overallScore,
                  )}
                  %
                </Text>

                <Text style={exerciseStyles.assessmentDate}>
                  Assessed on{' '}
                  {formatAssessmentDate(
                    latestSingingAssessment.timestamp,
                  )}
                </Text>

                <Text style={exerciseStyles.comparisonHint}>
                  {latestSingingAssessment.detectedNoteCount} notes
                  detected
                  {' · '}
                  {latestSingingAssessment.durationSeconds.toFixed(1)}
                  {' '}seconds
                </Text>
              </View>

              <View style={exerciseStyles.assessmentIconCircle}>
                <Ionicons
                  name="musical-notes"
                  size={25}
                  color={COLORS.brown}
                />
              </View>
            </View>

            <View style={exerciseStyles.assessmentScoresCard}>
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
                      exerciseStyles.assessmentScoreItem,
                      index === metrics.length - 1 &&
                        exerciseStyles.metricRowLast,
                    ]}
                  >
                    <View style={exerciseStyles.componentHeader}>
                      <Text style={exerciseStyles.componentName}>
                        {metric.label}
                      </Text>

                      <Text style={exerciseStyles.componentScore}>
                        {score}%
                      </Text>
                    </View>

                    <View style={exerciseStyles.progressBackground_Progress}>
                      <View
                        style={[
                          exerciseStyles.progressFill_Assessment,
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
          <View style={exerciseStyles.emptyCard}>
            <View style={exerciseStyles.emptyIconCircle}>
              <Ionicons
                name="musical-notes-outline"
                size={25}
                color={COLORS.brown}
              />
            </View>

            <Text style={exerciseStyles.emptyTitle}>
              No Singing Assessment Yet
            </Text>

            <Text style={exerciseStyles.emptyText}>
              Complete the Mary Had a Little Lamb singing assessment
              to see your score, pitch accuracy, pitch stability,
              and vocal consistency here.
            </Text>
          </View>
        )}

        <View style={exerciseStyles.sectionHeader_Progress}>
          <Text style={exerciseStyles.sectionTitle_Progress}>Exercise Progress</Text>

          <Text style={exerciseStyles.sectionSubtitle}>
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
              style={exerciseStyles.componentCard}
            >
              <View style={exerciseStyles.componentHeader}>
                <View style={exerciseStyles.componentNameRow}>
                  <Ionicons
                    name={component.icon}
                    size={18}
                    color={COLORS.brown}
                  />

                  <Text style={exerciseStyles.componentName}>
                    {component.name}
                  </Text>
                </View>

                <Text style={exerciseStyles.componentScore}>
                  {recentScore}%
                </Text>
              </View>

              <View style={exerciseStyles.progressBackground_Progress}>
                <View
                  style={[
                    exerciseStyles.progressFill_Assessment,
                    { width: `${recentScore}%` },
                  ]}
                />
              </View>

              <View style={exerciseStyles.pitchDisplay}>
                <Text style={exerciseStyles.componentMetaText}>
                  {progress.exercisesCompleted}{' '}
                  {progress.exercisesCompleted === 1
                    ? 'exercise'
                    : 'exercises'}{' '}
                  total
                </Text>

                <Text style={exerciseStyles.componentMetaText}>
                  {formatTier(progress.currentTier)}
                </Text>
              </View>
            </View>
          );
        })}

        {!progressLoading &&
          !progressError &&
          attempts.length === 0 && (
            <View style={exerciseStyles.emptyCard}>
              <Ionicons
                name="bar-chart-outline"
                size={28}
                color={COLORS.brown}
              />

              <Text style={exerciseStyles.emptyTitle}>
                No Exercise History Yet
              </Text>

              <Text style={exerciseStyles.emptyText}>
                Complete an exercise to start tracking your scores and
                progress here.
              </Text>
            </View>
          )}

        {progressLoading && (
          <View style={exerciseStyles.emptyCard}>
            <Text style={exerciseStyles.emptyText}>
              Loading your exercise progress...
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
