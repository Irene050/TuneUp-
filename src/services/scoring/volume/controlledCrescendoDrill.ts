import type { ControlledCrescendoMeasurement } from '@/services/measurement/volume/controlledCrescendoDrill';

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

const BEGINNER_SMOOTHNESS_TARGET = 70;

export function scoreControlledCrescendo(
  measurement: ControlledCrescendoMeasurement,
  options: ScoreOptions = {},
): ControlledCrescendoScore {
  const passingScore =
    options.passingScore ?? BEGINNER_SMOOTHNESS_TARGET;

  const smoothness = clamp(
    measurement.smoothness,
    0,
    100,
  );

  const overallScore = round(smoothness);

  return {
    smoothness: overallScore,
    overallScore,
    passed:
      measurement.validWindowCount > 0 &&
      overallScore >= passingScore,
    targetReached: measurement.targetReached,
    measurementQuality: round(
      measurement.overallMeasurementQuality,
    ),
  };
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}