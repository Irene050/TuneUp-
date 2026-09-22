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
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function calculateSpeedScore(
  notesPerSecond: number,
): number {
  /*
   * Target speed:
   * 1 note/sec = 0
   * 4 notes/sec = 100
   */
  const minimum = 1;
  const target = 4;

  if (notesPerSecond <= minimum) {
    return 0;
  }

  if (notesPerSecond >= target) {
    return 100;
  }

  return (
    ((notesPerSecond - minimum) /
      (target - minimum)) *
    100
  );
}

export function scoreArpeggioSpeed(
  measurement: ArpeggioSpeedMeasurement,
): ArpeggioSpeedScore {
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

  const speedScore = clamp(
    calculateSpeedScore(
      measurement.notesPerSecond,
    ),
    0,
    100,
  );

  /*
   * Arpeggio scoring:
   * Pitch Accuracy  = 40%
   * Sequence        = 35%
   * Speed           = 25%
   */
  const overall =
    pitchScore * 0.4 +
    sequenceScore * 0.35 +
    speedScore * 0.25;

  const roundedOverall = Math.round(overall);

  const passed =
    roundedOverall >= 70 &&
    pitchScore >= 60 &&
    sequenceScore >= 60;

  let feedback: string;

  if (roundedOverall >= 85) {
    feedback =
      'Excellent arpeggio control! Your pitch accuracy, note sequence, and speed are strong.';
  } else if (roundedOverall >= 70) {
    feedback =
      'Good work! Keep practicing smooth note transitions and gradually increase your speed.';
  } else if (pitchScore < 60) {
    feedback =
      'Focus on matching each note accurately before increasing your speed.';
  } else if (sequenceScore < 60) {
    feedback =
      'Practice the arpeggio pattern slowly and focus on keeping the correct note sequence.';
  } else {
    feedback =
      'Keep practicing the pattern and gradually increase your speed while maintaining accuracy.';
  }

  return {
    overall: roundedOverall,
    pitchScore: Math.round(pitchScore),
    sequenceScore: Math.round(sequenceScore),
    speedScore: Math.round(speedScore),
    passed,
    feedback,
  };
}