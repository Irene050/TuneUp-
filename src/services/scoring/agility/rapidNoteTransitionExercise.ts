import type { RapidNoteTransitionMeasurement } from '@/services/measurement/agility/rapidNoteTransitionExercise';
import { clampScore } from '@/utils/math';

export type RapidNoteTransitionScore = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  speedScore: number;
  passed: boolean;
  feedback: string;
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

  let feedback: string;

  if (passed) {
    feedback =
      'Great work! You completed the note transitions with sufficient accuracy and speed.';
  } else if (pitchScore < 60) {
    feedback =
      'Focus on matching each target pitch more accurately before increasing your speed.';
  } else if (sequenceScore < 60) {
    feedback =
      'Practice following the target note order. Accuracy depends on playing the notes in sequence.';
  } else if (speedScore < 50) {
    feedback =
      'Keep practicing smooth transitions between notes while maintaining accurate pitch.';
  } else {
    feedback =
      `Your score is below the ${threshold}% target. Repeat the exercise and focus on accurate, controlled transitions.`;
  }

  return {
    overall,
    pitchScore,
    sequenceScore,
    speedScore,
    passed,
    feedback,
  };
}