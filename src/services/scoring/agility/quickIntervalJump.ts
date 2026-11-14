import type {
  QuickIntervalJumpMeasurement,
} from '@/services/measurement/agility/quickIntervalJump';
import { clamp } from '@/utils/math';

export type QuickIntervalJumpScore = {
  overall: number;
  pitchScore: number;
  intervalScore: number;
  speedScore: number;
  passed: boolean;
};

function calculateSpeedScore(
  averageTransitionTimeMs: number,
): number {
  if (
    !Number.isFinite(averageTransitionTimeMs) ||
    averageTransitionTimeMs <= 0
  ) {
    return 0;
  }

  if (averageTransitionTimeMs <= 500) {
    return 100;
  }

  if (averageTransitionTimeMs >= 2500) {
    return 0;
  }

  return clamp(
    100 - ((averageTransitionTimeMs - 500) / 2000) * 100,
    0,
    100,
  );
}

export function scoreQuickIntervalJump(
  measurement: QuickIntervalJumpMeasurement,
): QuickIntervalJumpScore {
  const pitchScore = clamp(
    measurement.pitchAccuracy,
    0,
    100,
  );

  const intervalScore = clamp(
    measurement.intervalAccuracy,
    0,
    100,
  );

  const speedScore =
    calculateSpeedScore(
      measurement.averageTransitionTimeMs,
    );

  const overall =
    pitchScore * 0.4 +
    intervalScore * 0.4 +
    speedScore * 0.2;

  const passed =
    overall >= 70 &&
    pitchScore >= 60 &&
    intervalScore >= 60;

  return {
    overall,
    pitchScore,
    intervalScore,
    speedScore,
    passed,
  };
}