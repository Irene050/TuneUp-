import type {
  RapidNoteTransitionMeasurement,
} from '@/services/measurement/agility/rapidNoteTransitionExercise';

export type RapidNoteTransitionScore = {
  overall: number;

  pitchScore: number;
  sequenceScore: number;
  speedScore: number;

  passed: boolean;

  feedback: string;
};

function clamp(
  value: number,
  min = 0,
  max = 100,
): number {
  return Math.max(
    min,
    Math.min(
      max,
      value,
    ),
  );
}

/**
 * Converts transition rate into a 0–100 speed score.
 *
 * 1 transition/second or below = 0
 * 3 transitions/second or above = 100
 *
 * These values represent the current baseline agility
 * scoring range and can later be replaced by adaptive
 * difficulty parameters.
 */
function calculateSpeedScore(
  transitionsPerSecond: number,
): number {
  const minimum =
    1.0;

  const target =
    3.0;

  if (
    !Number.isFinite(
      transitionsPerSecond,
    ) ||
    transitionsPerSecond <=
      minimum
  ) {
    return 0;
  }

  if (
    transitionsPerSecond >=
    target
  ) {
    return 100;
  }

  return clamp(
    (
      (transitionsPerSecond -
        minimum) /
      (target -
        minimum)
    ) *
      100,
  );
}

export function scoreRapidNoteTransition(
  measurement: RapidNoteTransitionMeasurement,
): RapidNoteTransitionScore {
  const pitchScore =
    clamp(
      measurement.pitchAccuracy,
    );

  const sequenceScore =
    clamp(
      measurement.sequenceAccuracy,
    );

  const speedScore =
    calculateSpeedScore(
      measurement.transitionsPerSecond,
    );

  /*
   * Rapid Note Transition weighting:
   *
   * Pitch Accuracy      40%
   * Sequence Accuracy   30%
   * Transition Speed    30%
   *
   * Pitch receives the highest weight so that speed
   * does not compensate excessively for inaccurate singing.
   */
  const overall =
    Math.round(
      pitchScore * 0.40 +
        sequenceScore * 0.30 +
        speedScore * 0.30,
    );

  /*
   * A minimum pitch score prevents a user from passing
   * primarily through high transition speed or sequence
   * matching.
   */
  const passed =
    overall >= 70 &&
    pitchScore >= 60;

  let feedback =
    'Keep practicing smooth transitions while maintaining accurate pitch.';

  if (
    overall >= 85
  ) {
    feedback =
      'Excellent! Your transitions were fast and controlled while maintaining good pitch accuracy.';
  } else if (
    pitchScore < 70
  ) {
    feedback =
      'Focus on matching each target note accurately before increasing your transition speed.';
  } else if (
    sequenceScore < 70
  ) {
    feedback =
      'Focus on following the complete note sequence without skipping or adding notes.';
  } else if (
    speedScore < 50
  ) {
    feedback =
      'Your pitch accuracy is developing well. Gradually increase the speed between notes.';
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