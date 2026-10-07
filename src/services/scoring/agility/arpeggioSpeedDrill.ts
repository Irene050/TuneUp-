import type {
  ArpeggioSpeedMeasurement,
} from '@/services/measurement/agility/arpeggioSpeedDrill';

export type ArpeggioSpeedScore = {
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
  if (
    !Number.isFinite(value)
  ) {
    return min;
  }

  return Math.max(
    min,
    Math.min(
      max,
      value,
    ),
  );
}

/* ============================================================
 * SPEED SCORE
 * ========================================================== */

/**
 * Converts detected notes per second into a 0–100 score.
 *
 * 1 note/second or below = 0
 * 4 notes/second or above = 100
 *
 * These are the current baseline scoring values.
 * Tier-specific exercise parameters can later be supplied
 * through the adaptive exercise configuration.
 */
function calculateSpeedScore(
  notesPerSecond: number,
): number {
  const minimum =
    1;

  const target =
    4;

  if (
    !Number.isFinite(
      notesPerSecond,
    ) ||
    notesPerSecond <=
      minimum
  ) {
    return 0;
  }

  if (
    notesPerSecond >=
    target
  ) {
    return 100;
  }

  return clamp(
    (
      (
        notesPerSecond -
        minimum
      ) /
      (
        target -
        minimum
      )
    ) * 100,
  );
}

/* ============================================================
 * PUBLIC SCORING FUNCTION
 * ========================================================== */

export function scoreArpeggioSpeed(
  measurement: ArpeggioSpeedMeasurement,
): ArpeggioSpeedScore {
  const pitchScore =
    clamp(
      measurement.pitchAccuracy,
    );

  const sequenceScore =
    clamp(
      measurement.sequenceAccuracy,
    );

  const speedScore =
    clamp(
      calculateSpeedScore(
        measurement.notesPerSecond,
      ),
    );

  /*
   * Arpeggio Speed Drill weighting:
   *
   * Pitch Accuracy  = 40%
   * Sequence        = 35%
   * Speed           = 25%
   *
   * Accuracy is weighted more heavily than speed so that
   * increasing vocal speed does not compensate for poor
   * pitch or sequence accuracy.
   */
  const overall =
    Math.round(
      pitchScore * 0.40 +
        sequenceScore * 0.35 +
        speedScore * 0.25,
    );

  /*
   * Passing requirements:
   *
   * Overall score >= 70
   * Pitch accuracy >= 60
   * Sequence accuracy >= 60
   */
  const passed =
    overall >= 70 &&
    pitchScore >= 60 &&
    sequenceScore >= 60;

  let feedback =
    'Keep practicing the arpeggio pattern while maintaining accurate pitch and smooth note transitions.';

  if (
    overall >= 85
  ) {
    feedback =
      'Excellent arpeggio control! Your pitch accuracy, note sequence, and speed are strong.';
  } else if (
    pitchScore < 60
  ) {
    feedback =
      'Focus on matching each target note accurately before increasing your speed.';
  } else if (
    sequenceScore < 60
  ) {
    feedback =
      'Practice the arpeggio pattern slowly and focus on following the complete note sequence.';
  } else if (
    speedScore < 50
  ) {
    feedback =
      'Your accuracy is developing well. Gradually increase the speed of the arpeggio while maintaining control.';
  } else if (
    overall >= 70
  ) {
    feedback =
      'Good work! Continue practicing smooth transitions and gradually increase your speed.';
  }

  return {
    overall,

    pitchScore:
      Math.round(
        pitchScore,
      ),

    sequenceScore:
      Math.round(
        sequenceScore,
      ),

    speedScore:
      Math.round(
        speedScore,
      ),

    passed,

    feedback,
  };
}