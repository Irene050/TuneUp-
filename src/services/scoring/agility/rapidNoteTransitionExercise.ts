import type { RapidNoteTransitionMeasurement } from '@/services/measurement/agility/rapidNoteTransitionExercise';
import { clampScore } from '@/utils/math';

export type RapidNoteTransitionScore = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  speedScore: number;
  passed: boolean;
};

function calculateSpeedScore(
  transitionsPerSecond: number,
  targetSpeed?: number,
): number {
  if (
    !Number.isFinite(transitionsPerSecond) ||
    transitionsPerSecond <= 0
  ) {
    return 0;
  }

  const safeTargetSpeed =
    Number.isFinite(targetSpeed) && targetSpeed! > 0
      ? targetSpeed!
      : 3;

  return clampScore(
    (transitionsPerSecond / safeTargetSpeed) * 100,
  );
}

export function scoreRapidNoteTransition(
  measurement: RapidNoteTransitionMeasurement,
  targetSpeed?: number,
  accuracyThreshold = 70,
): RapidNoteTransitionScore {
  const threshold = clampScore(accuracyThreshold);

  const pitchScore = clampScore(measurement.pitchAccuracy);
  const sequenceScore = clampScore(measurement.sequenceAccuracy);

  const speedScore = calculateSpeedScore(
    measurement.transitionsPerSecond,
    targetSpeed,
  );

  const overall = Math.round(
    clampScore(
      pitchScore * 0.4 +
        sequenceScore * 0.3 +
        speedScore * 0.3,
    ),
  );

  const passed =
    overall >= threshold &&
    pitchScore >= 60 &&
    sequenceScore >= 60;

  return {
    overall,
    pitchScore,
    sequenceScore,
    speedScore,
    passed,
  };
}