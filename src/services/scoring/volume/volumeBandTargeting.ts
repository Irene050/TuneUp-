import type {
  VolumeBandMeasurement,
} from '@/services/measurement/volume/volumeBandTargeting';

const DEFAULT_PASSING_SCORE = 70;

export interface VolumeBandScore {
  consistency: number;
  overallScore: number;

  passed: boolean;
  targetReached: boolean;

  measurementQuality: number;
}

interface ScoreOptions {
  passingScore?: number;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

function roundScore(
  value: number,
): number {
  return Math.round(
    clamp(
      value,
      0,
      100,
    ),
  );
}

export function scoreVolumeBandTargeting(
  measurement: VolumeBandMeasurement,
  options: ScoreOptions = {},
): VolumeBandScore {
  const passingScore =
    options.passingScore ??
    DEFAULT_PASSING_SCORE;

  const score =
    measurement.targetReached
      ? measurement.consistency
      : 0;

  const overallScore =
    roundScore(score);

  return {
    consistency:
      roundScore(
        measurement.consistency,
      ),

    overallScore,

    passed:
      measurement.targetReached &&
      overallScore >= passingScore,

    targetReached:
      measurement.targetReached,

    measurementQuality:
      roundScore(
        measurement.measurementQuality,
      ),
  };
}