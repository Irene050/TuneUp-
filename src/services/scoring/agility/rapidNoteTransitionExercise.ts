import type { RapidNoteTransitionMeasurement } from '@/services/measurement/agility/rapidNoteTransitionExercise';
import { clampFinite } from '@/utils/utils';

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

  return clampFinite(
    (transitionsPerSecond / safeTargetSpeed) * 100,
  );
}

export function scoreRapidNoteTransition(
  measurement: RapidNoteTransitionMeasurement,
  targetSpeed?: number,
  accuracyThreshold = 70,
): RapidNoteTransitionScore {
  const threshold = clampFinite(accuracyThreshold);

  const pitchScore = clampFinite(measurement.pitchAccuracy);
  const sequenceScore = clampFinite(measurement.sequenceAccuracy);

  const speedScore = calculateSpeedScore(
    measurement.transitionsPerSecond,
    targetSpeed,
  );

  const overall = Math.round(
    clampFinite(
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