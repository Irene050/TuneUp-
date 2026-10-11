
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

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function calculateSpeedScore(
  notesPerSecond: number,
  targetNotesPerSecond: number,
): number {
  if (
    !Number.isFinite(notesPerSecond) ||
    !Number.isFinite(targetNotesPerSecond) ||
    notesPerSecond <= 0 ||
    targetNotesPerSecond <= 0
  ) {
    return 0;
  }

  return clamp((notesPerSecond / targetNotesPerSecond) * 100);
}

export function scoreArpeggioSpeed(
  measurement: ArpeggioSpeedMeasurement,
): ArpeggioSpeedScore {
  const pitchScore = clamp(measurement.pitchAccuracy);
  const sequenceScore = clamp(measurement.sequenceAccuracy);

  const speedScore = calculateSpeedScore(
    measurement.notesPerSecond,
    measurement.targetNotesPerSecond || 4,
  );

  const overall = Math.round(
    pitchScore * 0.4 +
      sequenceScore * 0.35 +
      speedScore * 0.25,
  );

  const passed =
    overall >= 70 &&
    pitchScore >= 60 &&
    sequenceScore >= 60;

  let feedback =
    'Keep practicing the arpeggio pattern while maintaining accurate pitch and smooth note transitions.';

  if (pitchScore < 60) {
    feedback =
      'Focus on matching each target note accurately before increasing your speed.';
  } else if (sequenceScore < 60) {
    feedback =
      'Practice the arpeggio pattern slowly and focus on following the notes in order.';
  } else if (speedScore < 50) {
    feedback =
      'Work toward the required pace while keeping each note clear and accurate.';
  } else if (overall >= 85) {
    feedback =
      'Excellent arpeggio control! Your pitch accuracy, note sequence, and speed are strong.';
  } else if (overall >= 70) {
    feedback =
      'Good work! Continue practicing smooth transitions and consistent timing.';
  }

  return {
    overall,
    pitchScore: Math.round(pitchScore),
    sequenceScore: Math.round(sequenceScore),
    speedScore: Math.round(speedScore),
    passed,
    feedback,
  };
}
