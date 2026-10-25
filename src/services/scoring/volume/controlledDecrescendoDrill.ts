import type { ControlledDecrescendoMeasurement } from '@/services/measurement/volume/controlledDecrescendoDrill';

const DEFAULT_PASSING_SCORE = 75;
const MIN_VALID_WINDOWS = 20;
const MIN_MEASUREMENT_QUALITY = 60;

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
  return Math.max(min, Math.min(max, value));
}

function roundScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

export function scoreControlledDecrescendo(
  measurement: ControlledDecrescendoMeasurement,
  options: ScoreOptions = {},
): ControlledDecrescendoScore {
  const passingScore =
    options.passingScore ?? DEFAULT_PASSING_SCORE;

  const hasValidRepetitionScores =
    measurement.repSmoothness.length > 0 &&
    measurement.repSmoothness.every(
      (score) => Number.isFinite(score) && score > 0,
    );

  const hasEnoughAudio =
    measurement.validWindowCount >= MIN_VALID_WINDOWS &&
    measurement.measurementQuality >= MIN_MEASUREMENT_QUALITY &&
    hasValidRepetitionScores;

  const repetitionAverage = hasValidRepetitionScores
    ? measurement.repSmoothness.reduce(
        (total, score) => total + score,
        0,
      ) / measurement.repSmoothness.length
    : 0;

  const overallScore = hasEnoughAudio
    ? roundScore(repetitionAverage)
    : 0;

  const passed =
    hasEnoughAudio &&
    measurement.directionCorrect &&
    measurement.targetReached &&
    overallScore >= passingScore;

  return {
    smoothness: overallScore,
    overallScore,
    passed,
    targetReached: measurement.targetReached,
    directionCorrect: measurement.directionCorrect,
    measurementQuality: roundScore(
      measurement.measurementQuality,
    ),
  };
}