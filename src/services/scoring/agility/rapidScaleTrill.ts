import type {
    RapidScaleTrillMeasurement,
} from '@/services/measurement/agility/rapidScaleTrill';

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
  return Math.max(
    min,
    Math.min(max, value),
  );
}

function calculateSpeedScore(
  notesPerSecond: number,
): number {
  if (notesPerSecond <= 1) {
    return 0;
  }

  if (notesPerSecond >= 5) {
    return 100;
  }

  return clamp(
    ((notesPerSecond - 1) / 4) *
      100,
    0,
    100,
  );
}

export function scoreRapidScaleTrill(
  measurement: RapidScaleTrillMeasurement,
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

  const speedScore =
    calculateSpeedScore(
      measurement.notesPerSecond,
    );

  const overall =
    pitchScore * 0.35 +
    sequenceScore * 0.30 +
    transitionScore * 0.20 +
    speedScore * 0.15;

  const passed =
    overall >= 70 &&
    pitchScore >= 60 &&
    sequenceScore >= 60;

  let feedback = '';

  if (overall >= 90) {
    feedback =
      'Excellent! Your scale trill was fast, accurate, and well controlled.';
  } else if (overall >= 80) {
    feedback =
      'Great job! Your note sequence and transitions were performed with good control.';
  } else if (overall >= 70) {
    feedback =
      'Good work! Continue practicing the rapid note changes for greater consistency.';
  } else if (pitchScore < 60) {
    feedback =
      'Focus on matching each note accurately before increasing your speed.';
  } else if (sequenceScore < 60) {
    feedback =
      'Practice the scale pattern slowly so each note stays in the correct order.';
  } else if (transitionScore < 60) {
    feedback =
      'Work on making each transition between notes cleaner and more controlled.';
  } else if (speedScore < 60) {
    feedback =
      'Gradually increase your speed while keeping your pitch accurate.';
  } else {
    feedback =
      'Keep practicing the scale pattern with consistent pitch and smooth transitions.';
  }

  return {
    overall,
    pitchScore,
    sequenceScore,
    transitionScore,
    speedScore,
    passed,
    feedback,
  };
}