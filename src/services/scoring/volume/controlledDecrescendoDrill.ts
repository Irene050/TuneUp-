import type {
    ControlledDecrescendoMeasurement,
} from '@/services/measurement/volume/controlledDecrescendoDrill';

const BEGINNER_PASSING_SCORE = 70;

export interface ControlledDecrescendoScore {
  smoothness: number;
  overallScore: number;

  passed: boolean;

  targetReached: boolean;
  directionCorrect: boolean;

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

export function scoreControlledDecrescendo(
  measurement: ControlledDecrescendoMeasurement,
  options: ScoreOptions = {},
): ControlledDecrescendoScore {
  const passingScore =
    options.passingScore ??
    BEGINNER_PASSING_SCORE;

  const overallScore =
    roundScore(
      measurement.smoothness,
    );

  const passed =
    measurement.validWindowCount > 0 &&
    measurement.directionCorrect &&
    overallScore >=
      passingScore;

  return {
    smoothness:
      overallScore,

    overallScore,

    passed,

    targetReached:
      measurement.targetReached,

    directionCorrect:
      measurement.directionCorrect,

    measurementQuality:
      roundScore(
        measurement.measurementQuality,
      ),
  };
}