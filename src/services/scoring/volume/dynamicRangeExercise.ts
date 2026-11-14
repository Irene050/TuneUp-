import type { DynamicRangeMeasurement } from '@/services/measurement/volume/dynamicRangeExercise';
import { clampFinite } from '@/utils/math';
import type { VolumeScoreOptions } from './types';

export interface DynamicRangeScore {
  rangeAccuracy: number;
  rampConsistency: number;
  overallScore: number;
  passed: boolean;
  repetitionScores: number[];
}

type ScoreOptions = VolumeScoreOptions;

function round(value: number): number {
  return Math.round(value);
}

export function scoreDynamicRange(
  measurement: DynamicRangeMeasurement,
  options: ScoreOptions = {},
): DynamicRangeScore {
  const passingScore = clampFinite(
    options.passingScore ?? 75,
    0,
    100,
  );

  const rangeAccuracy = clampFinite(
    measurement.rangeAccuracy,
    0,
    100,
  );

  const rampConsistency = clampFinite(
    measurement.rampConsistency,
    0,
    100,
  );

  const overallScore = clampFinite(
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
    repetitionScores: measurement.repetitionRangeScores.map(
      (repetitionRangeAccuracy, index) =>
        round(
          clampFinite(
            repetitionRangeAccuracy * 0.4 +
              measurement.repetitionRampScores[index] * 0.6,
            0,
            100,
          ),
        ),
    ),
  };
}