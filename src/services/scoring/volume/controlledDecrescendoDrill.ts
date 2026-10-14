import type {
  ControlledDecrescendoMeasurement,
} from '@/services/measurement/volume/controlledDecrescendoDrill';

const DEFAULT_PASSING_SCORE = 75;
const MIN_VALID_WINDOWS = 20;

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
    clamp(value, 0, 100),
  );
}

export function scoreControlledDecrescendo(
  measurement: ControlledDecrescendoMeasurement,
  options: ScoreOptions = {},
): ControlledDecrescendoScore {
  const passingScore =
    options.passingScore ?? DEFAULT_PASSING_SCORE;

  const hasEnoughAudio =
    measurement.validWindowCount >= MIN_VALID_WINDOWS &&
    measurement.measurementQuality > 0;

  // Keep scores from repetitions that produced a measurable result.
  // A failed/missing repetition must not erase scores from earlier valid reps.
  const validRepScores = measurement.repSmoothness.filter(
    (score) => Number.isFinite(score) && score > 0,
  );

  const repetitionAverage =
    validRepScores.length > 0
      ? validRepScores.reduce((total, score) => total + score, 0) /
        validRepScores.length
      : 0;

  // If audio is insufficient, return 0. Otherwise, preserve partial results
  // even when the complete exercise did not meet every passing condition.
  const overallScore = hasEnoughAudio
    ? roundScore(repetitionAverage)
    : 0;

  const passed =
    hasEnoughAudio &&
    validRepScores.length === measurement.repSmoothness.length &&
    measurement.directionCorrect &&
    measurement.targetReached &&
    overallScore >= passingScore;

  return {
    smoothness: overallScore,
    overallScore,
    passed,
    targetReached: measurement.targetReached,
    directionCorrect: measurement.directionCorrect,
    measurementQuality: roundScore(measurement.measurementQuality),
  };
}
