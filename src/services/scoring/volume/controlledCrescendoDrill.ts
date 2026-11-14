import type {
  ControlledCrescendoMeasurement,
} from '@/services/measurement/volume/controlledCrescendoDrill';
import { clamp } from '@/utils/math';
import type { VolumeScoreOptions } from './types';

export interface ControlledCrescendoScore {
  smoothness: number;
  overallScore: number;
  passed: boolean;
  targetReached: boolean;
  measurementQuality: number;
}

type ScoreOptions = VolumeScoreOptions;

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

function round(
  value: number,
): number {
  return Math.round(
    value * 10,
  ) / 10;
}