import type { VocalRunAccuracyMeasurement } from '@/services/measurement/agility/vocalRunAccuracyTask';
import { clamp } from '@/utils/math';

export type VocalRunAccuracyScore = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  transitionScore: number;
  passed: boolean;
};

export function scoreVocalRunAccuracy(
  measurement: VocalRunAccuracyMeasurement,
  requiredSequenceAccuracy = 60,
): VocalRunAccuracyScore {
  const pitchScore = clamp(
    measurement.pitchAccuracy,
    0,
    100,
  );

  const sequenceScore = clamp(
    measurement.sequenceAccuracy,
    0,
    100,
  );

  const transitionScore =
    measurement.transitionCount > 0
      ? clamp(
          (measurement.correctTransitionCount /
            measurement.transitionCount) *
            100,
          0,
          100,
        )
      : sequenceScore;

  const overall =
    pitchScore * 0.4 +
    sequenceScore * 0.35 +
    transitionScore * 0.25;

  const passed =
    overall >= 70 &&
    pitchScore >= 60 &&
    sequenceScore >=
      clamp(requiredSequenceAccuracy, 0, 100);

  return {
    overall,
    pitchScore,
    sequenceScore,
    transitionScore,
    passed,
  };
}
