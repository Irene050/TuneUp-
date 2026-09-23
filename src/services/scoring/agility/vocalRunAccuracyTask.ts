import type { VocalRunAccuracyMeasurement } from '@/services/measurement/agility/vocalRunAccuracyTask';

export type VocalRunAccuracyScore = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  transitionScore: number;
  passed: boolean;
  feedback: string;
};

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

export function scoreVocalRunAccuracy(
  measurement: VocalRunAccuracyMeasurement,
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
    sequenceScore >= 60;

  let feedback = '';

  if (overall >= 90) {
    feedback =
      'Excellent vocal run! Your pitch and note transitions were very accurate.';
  } else if (overall >= 80) {
    feedback =
      'Great job! Your vocal run was accurate with good note transitions.';
  } else if (overall >= 70) {
    feedback =
      'Good work! Keep practicing your pitch accuracy and transitions.';
  } else if (pitchScore < 60) {
    feedback =
      'Focus on matching each target note more accurately.';
  } else if (transitionScore < 60) {
    feedback =
      'Practice moving smoothly and accurately between consecutive notes.';
  } else {
    feedback =
      'Keep practicing the vocal run slowly before increasing your speed.';
  }

  return {
    overall,
    pitchScore,
    sequenceScore,
    transitionScore,
    passed,
    feedback,
  };
}