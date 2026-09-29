import type {
  ControlledCrescendoMeasurement,
} from '@/services/measurement/volume/controlledCrescendoDrill';

export interface ControlledCrescendoScore {
  smoothness: number;
  overallScore: number;
  passed: boolean;
  targetReached: boolean;
  measurementQuality: number;
}

interface ScoreOptions {
  passingScore?: number;
}

const DEFAULT_PASSING_SCORE = 75;

export function scoreControlledCrescendo(
  measurement: ControlledCrescendoMeasurement,
  options: ScoreOptions = {},
): ControlledCrescendoScore {
  const passingScore =
    options.passingScore ??
    DEFAULT_PASSING_SCORE;

  const smoothness =
    clamp(
      measurement.smoothness,
      0,
      100,
    );

  const overallScore =
    round(smoothness);

  const measurementValid =
    measurement.validWindowCount > 0;

  const passed =
    measurementValid &&
    measurement.targetReached &&
    overallScore >= passingScore;

  return {
    smoothness:
      overallScore,

    overallScore,

    passed,

    targetReached:
      measurement.targetReached,

    measurementQuality:
      round(
        measurement.overallMeasurementQuality,
      ),
  };
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(
      max,
      value,
    ),
  );
}

function round(
  value: number,
): number {
  return Math.round(
    value * 10,
  ) / 10;
}