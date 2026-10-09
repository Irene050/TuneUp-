// src/services/progress/progressModule.ts

import type {
  ComponentId,
} from '@/services/assessment/assessmentModule';

export type {
  ComponentId
} from '@/services/assessment/assessmentModule';

import type {
  Tier,
} from '@/services/adaptiveDifficultyScaling/adaptiveDifficultyScaling';

// fetchExerciseAttempts(uid: string, sinceTimestamp: number): Promise<ExerciseAttempt[]>

export interface ExerciseRecord {
  componentId: ComponentId;
  templateId: string;
  tier: Tier;
  scorePct: number;
  timestamp: number;
}

export function countPracticeDays(
  records: ExerciseRecord[]
): number {
  const practiceDates = new Set(
    records
      .filter((record) => Number.isFinite(record.timestamp))
      .map((record) => {
        const date = new Date(record.timestamp);

        return [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0'),
        ].join('-');
      })
  );

  return practiceDates.size;
}

export interface ComponentProgressSummary {
  componentId: ComponentId;
  currentTier: Tier;
  exercisesCompleted: number;
  averageRecentScorePct: number;
}

export function summarizeProgress(
  records: ExerciseRecord[],
  currentTiers: Record<
    ComponentId,
    Tier
  >
): ComponentProgressSummary[] {
  const componentIds: ComponentId[] = [
    'breathControl',
    'pitch',
    'tone',
    'volume',
    'agility',
  ];

  return componentIds.map(
    (componentId) => {
      const componentRecords =
        records.filter(
          (r) =>
            r.componentId ===
            componentId
        );

      const recentFive =
        componentRecords.slice(
          -5
        );

      const averageRecentScorePct =
        recentFive.length
          ? recentFive.reduce(
              (sum, r) =>
                sum +
                r.scorePct,
              0
            ) /
            recentFive.length
          : 0;

      return {
        componentId,
        currentTier:
          currentTiers[
            componentId
          ],
        exercisesCompleted:
          componentRecords.length,
        averageRecentScorePct:
          Math.round(
            averageRecentScorePct
          ),
      };
    }
  );
}

export type ProgressPeriod = 'daily' | 'weekly' | 'monthly';

export interface ExerciseAttempt {
  componentId: ComponentProgressSummary['componentId'];
  scorePct: number;
  timestamp: number; // milliseconds since epoch
}

export interface PeriodStats {
  count: number;
  averagePct: number;
}

export interface PeriodComparison {
  current: PeriodStats;
  previous: PeriodStats;
  scoreDelta: number | null; // null = nothing to compare against
  countDelta: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const PERIOD_LENGTH_MS: Record<ProgressPeriod, number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
  monthly: 30 * DAY_MS,
};

function statsFor(attempts: ExerciseAttempt[]): PeriodStats {
  const valid = attempts.filter(a => Number.isFinite(a.scorePct));

  if (valid.length === 0) {
    return { count: 0, averagePct: 0 };
  }

  const total = valid.reduce((sum, a) => sum + a.scorePct, 0);

  return {
    count: valid.length,
    averagePct: Math.round(total / valid.length),
  };
}

export function comparePeriods(
  attempts: ExerciseAttempt[],
  period: ProgressPeriod,
  now: number = Date.now(),
): PeriodComparison {
  const length = PERIOD_LENGTH_MS[period];
  const currentStart = now - length;
  const previousStart = now - 2 * length;

  const current = statsFor(
    attempts.filter(a => a.timestamp > currentStart && a.timestamp <= now),
  );
  const previous = statsFor(
    attempts.filter(
      a => a.timestamp > previousStart && a.timestamp <= currentStart,
    ),
  );

  return {
    current,
    previous,
    scoreDelta:
      current.count > 0 && previous.count > 0
        ? current.averagePct - previous.averagePct
        : null,
    countDelta:
      current.count > 0 || previous.count > 0
        ? current.count - previous.count
        : null,
  };
}