import type {
  ArpeggioSpeedMeasurement,
} from '@/services/measurement/agility/arpeggioSpeedDrill';

import { clampFinite } from '@/utils/math';

export type ArpeggioSpeedScore = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  speedScore: number;
  passed: boolean;
};

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

  const speedRatio = notesPerSecond / targetNotesPerSecond;
  const accuracy = Math.min(speedRatio, 1 / speedRatio);

  return Math.round(clampFinite(accuracy * 100, 0, 100));
}

export function scoreArpeggioSpeed(
  measurement: ArpeggioSpeedMeasurement,
): ArpeggioSpeedScore {
  const pitchScore = clampFinite(
    measurement.pitchAccuracy,
    0,
    100,
  );

  const sequenceScore = clampFinite(
    measurement.sequenceAccuracy,
    0,
    100,
  );

  const speedScore = calculateSpeedScore(
    measurement.notesPerSecond,
    measurement.targetNotesPerSecond,
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

  return {
    overall,
    pitchScore: Math.round(pitchScore),
    sequenceScore: Math.round(sequenceScore),
    speedScore: Math.round(speedScore),
    passed,
  };
}