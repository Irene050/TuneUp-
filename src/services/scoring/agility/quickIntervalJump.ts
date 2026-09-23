import type {
    QuickIntervalJumpMeasurement,
} from '@/services/measurement/agility/quickIntervalJump';

export type QuickIntervalJumpScore = {
  overall: number;
  pitchScore: number;
  intervalScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
};

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

function calculateSpeedScore(
  averageTransitionTimeMs: number,
): number {
  if (
    averageTransitionTimeMs <= 500
  ) {
    return 100;
  }

  if (
    averageTransitionTimeMs >= 2500
  ) {
    return 0;
  }

  return clamp(
    100 -
      ((averageTransitionTimeMs -
        500) /
        2000) *
        100,
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

  let feedback = '';

  if (overall >= 90) {
    feedback =
      'Excellent interval jumps! Your pitch changes were accurate and controlled.';
  } else if (overall >= 80) {
    feedback =
      'Great job! Your interval jumps were accurate with smooth transitions.';
  } else if (overall >= 70) {
    feedback =
      'Good work! Continue practicing the interval changes for greater consistency.';
  } else if (pitchScore < 60) {
    feedback =
      'Focus on matching each target note before making the jumps faster.';
  } else if (intervalScore < 60) {
    feedback =
      'Practice the distance between each pair of notes carefully.';
  } else if (speedScore < 60) {
    feedback =
      'Your note changes need more speed. Gradually increase the pace as your accuracy improves.';
  } else {
    feedback =
      'Keep practicing the interval pattern slowly and accurately.';
  }

  return {
    overall,
    pitchScore,
    intervalScore,
    speedScore,
    passed,
    feedback,
  };
}