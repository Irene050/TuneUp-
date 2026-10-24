import type {
  VolumeBandMeasurement,
} from '@/services/measurement/volume/volumeBandTargeting';

const DEFAULT_PASSING_SCORE = 60;
const MIN_MEASUREMENT_QUALITY = 50;

export interface VolumeBandScore {
  consistency: number;
  overallScore: number;
  passed: boolean;
  targetReached: boolean;
  measurementQuality: number;
}

interface ScoreOptions {
  passingScore?: number;
  minimumMeasurementQuality?: number;
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
      Number.isFinite(value) ? value : 0,
      0,
      100,
    ),
  );
}

export function scoreVolumeBandTargeting(
  measurement: VolumeBandMeasurement,
  options: ScoreOptions = {},
): VolumeBandScore {
  const passingScore = clamp(
    options.passingScore ?? DEFAULT_PASSING_SCORE,
    0,
    100,
  );

  const minimumMeasurementQuality = clamp(
    options.minimumMeasurementQuality ??
      MIN_MEASUREMENT_QUALITY,
    0,
    100,
  );

  const consistency = roundScore(
    measurement.consistency,
  );

  const overallScore = consistency;

  const measurementQuality = roundScore(
    measurement.measurementQuality,
  );

  const hasSufficientMeasurement =
    measurement.validWindowCount > 0 &&
    measurement.expectedWindowCount > 0 &&
    measurementQuality >= minimumMeasurementQuality;

  const targetReached =
    measurement.targetReached &&
    hasSufficientMeasurement;

  const passed =
    targetReached &&
    overallScore >= passingScore;

  return {
    consistency,
    overallScore,
    passed,
    targetReached,
    measurementQuality,
  };
}