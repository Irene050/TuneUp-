import type { DynamicRangeMeasurement } from '@/services/measurement/volume/dynamicRangeExercise';

export interface DynamicRangeScore {
  rangeAccuracy: number;
  rampConsistency: number;
  overallScore: number;
  passed: boolean;
}

interface ScoreOptions {
  passingScore?: number;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return min;

  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value);
}

export function scoreDynamicRange(
  measurement: DynamicRangeMeasurement,
  options: ScoreOptions = {},
): DynamicRangeScore {
  const passingScore = clamp(
    options.passingScore ?? 75,
    0,
    100,
  );

  const rangeAccuracy = clamp(
    measurement.rangeAccuracy,
    0,
    100,
  );

  const rampConsistency = clamp(
    measurement.rampConsistency,
    0,
    100,
  );

  const overallScore = clamp(
    rangeAccuracy * 0.4 +
      rampConsistency * 0.6,
    0,
    100,
  );

  return {
    rangeAccuracy: round(rangeAccuracy),
    rampConsistency: round(rampConsistency),
    overallScore: round(overallScore),
    passed: overallScore >= passingScore,
  };
}