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

export function scoreDynamicRange(
  measurement: DynamicRangeMeasurement,
  options: ScoreOptions = {}
): DynamicRangeScore {
  const passingScore =
    options.passingScore ?? 75;

  const rangeAccuracy = clamp(
    measurement.rangeAccuracy,
    0,
    100
  );

  const rampConsistency = clamp(
    measurement.rampConsistency,
    0,
    100
  );

  // Dynamic Range scoring follows the manuscript weighting:
  // 40% range accuracy and 60% ramp consistency.
  const overallScore = clamp(
    rangeAccuracy * 0.4 +
      rampConsistency * 0.6,
    0,
    100
  );

  return {
    rangeAccuracy: round(rangeAccuracy),
    rampConsistency: round(rampConsistency),
    overallScore: round(overallScore),
    passed: overallScore >= passingScore,
  };
}

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function round(value: number): number {
  return Math.round(value);
}