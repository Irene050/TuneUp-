
import type { RapidScaleTrillMeasurement } from '@/services/measurement/agility/rapidScaleTrill';

export type RapidScaleTrillScore = {
  overall: number;
  pitchScore: number;
  sequenceScore: number;
  transitionScore: number;
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
  if (
    !Number.isFinite(notesPerSecond) ||
    notesPerSecond <= 1
  ) {
    return 0;
  }

  if (notesPerSecond >= 5) {
    return 100;
  }

  return clamp(
    ((notesPerSecond - 1) / 4) * 100,
    0,
    100,
  );
}

/**
 * Scores a Rapid Scale Trill attempt.
 *
 * Weights:
 * - Pitch accuracy: 35%
 * - Sequence accuracy: 30%
 * - Transition accuracy: 20%
 * - Speed: 15%
 *
 * The optional threshold defaults to 70 to preserve
 * compatibility with existing callers.
 */
export function scoreRapidScaleTrill(
  measurement: RapidScaleTrillMeasurement,
  accuracyThreshold = 70,
): RapidScaleTrillScore {
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

  const transitionScore = clamp(
    measurement.transitionAccuracy,
    0,
    100,
  );

  const speedScore = calculateSpeedScore(
    measurement.notesPerSecond,
  );

  const overall =
    pitchScore * 0.35 +
    sequenceScore * 0.3 +
    transitionScore * 0.2 +
    speedScore * 0.15;

  const roundedOverall =
    Math.round(overall * 100) / 100;

  const threshold = clamp(
    Number.isFinite(accuracyThreshold)
      ? accuracyThreshold
      : 70,
    0,
    100,
  );

  const passed =
    roundedOverall >= threshold &&
    pitchScore >= 60 &&
    sequenceScore >= 60;

  let feedback: string;

  if (measurement.noteCount === 0) {
    feedback =
      'No clear notes were detected. Try singing closer to the microphone in a quiet area.';
  } else if (pitchScore < 60) {
    feedback =
      'Focus on matching each target pitch before increasing your speed.';
  } else if (sequenceScore < 60) {
    feedback =
      'Practice the notes in the correct order. Listen to the reference sequence again before trying.';
  } else if (transitionScore < 60) {
    feedback =
      'Work on moving cleanly between neighboring notes without skipping or adding notes.';
  } else if (speedScore < 50) {
    feedback =
      'Gradually increase the pace while keeping each note clear and accurate.';
  } else if (passed) {
    feedback =
      'Great work! Your pitch, note order, and transitions are coming together. Keep practicing for consistency.';
  } else {
    feedback =
      'You are making progress. Keep the notes accurate and in order, then gradually increase your speed.';
  }

  return {
    overall: roundedOverall,
    pitchScore,
    sequenceScore,
    transitionScore,
    speedScore,
    passed,
    feedback,
  };
}
