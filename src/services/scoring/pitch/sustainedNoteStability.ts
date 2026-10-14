
import type {
  SustainedNoteStabilityParams,
} from '@/constants/exercises/pitch';

import type {
  SustainedNoteStabilityMeasurement,
} from '@/services/measurement/pitch/sustainedNoteStability';

export interface SustainedNoteStabilityScoreResult {
  score: number;
  passed: boolean;
  stabilityCents: number;
  durationSec: number;
  repetitionsCompleted: number;
  repetitionScores: number[];
}

export function scoreSustainedNoteStability(
  measurement: SustainedNoteStabilityMeasurement,
  params: SustainedNoteStabilityParams,
): SustainedNoteStabilityScoreResult {
  const stabilityCents = Number.isFinite(
    measurement.stabilityCents,
  )
    ? Math.max(0, measurement.stabilityCents)
    : 1000;

  const durationSec = Number.isFinite(
    measurement.durationSec,
  )
    ? Math.max(0, measurement.durationSec)
    : 0;

  const threshold = Math.max(
    1,
    params.stabilityThresholdCents,
  );

  // Stricter stability curve:
  // 0 cents = 100
  // 25% of threshold = 50
  // 50% of threshold = 0
  const stabilityScore = Math.max(
    0,
    Math.min(
      100,
      100 - (stabilityCents / threshold) * 200,
    ),
  );

  // Full duration credit requires 125% of the target.
  const durationScore =
    params.durationSec > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (durationSec / (params.durationSec * 1.25)) * 100,
          ),
        )
      : 0;

  const score = Math.round(
    stabilityScore * 0.8 +
      durationScore * 0.2,
  );

  const passed =
    stabilityCents <= threshold &&
    durationSec >= params.durationSec &&
    score >= 80;

  console.log('🎵 SUSTAINED NOTE STABILITY DEBUG:', {
    stabilityCents,
    threshold,
    stabilityScore,
    durationSec,
    targetDurationSec: params.durationSec,
    durationScore,
    finalScore: score,
    passed,
  });

  return {
    score,
    passed,
    stabilityCents,
    durationSec,
    repetitionsCompleted: 1,
    repetitionScores: [score],
  };
}

export function scoreSustainedNoteStabilityRepetitions(
  measurements: SustainedNoteStabilityMeasurement[],
  params: SustainedNoteStabilityParams,
): SustainedNoteStabilityScoreResult {
  const requestedRepetitions = Math.max(
    1,
    Math.round(params.repetitions),
  );

  if (measurements.length === 0) {
    return {
      score: 0,
      passed: false,
      stabilityCents: 1000,
      durationSec: 0,
      repetitionsCompleted: 0,
      repetitionScores: Array(requestedRepetitions).fill(0),
    };
  }

  const repetitionResults = measurements
    .slice(0, requestedRepetitions)
    .map(measurement =>
      scoreSustainedNoteStability(measurement, params),
    );

  const repetitionScores = [
    ...repetitionResults.map(result => result.score),
    ...Array(
      Math.max(
        0,
        requestedRepetitions - repetitionResults.length,
      ),
    ).fill(0),
  ];

  const score = Math.round(
    repetitionScores.reduce(
      (sum, repetitionScore) => sum + repetitionScore,
      0,
    ) / requestedRepetitions,
  );

  const stabilityCents =
    measurements.reduce(
      (sum, measurement) =>
        sum + Math.max(0, measurement.stabilityCents),
      0,
    ) / measurements.length;

  const durationSec =
    measurements.reduce(
      (sum, measurement) => sum + measurement.durationSec,
      0,
    ) / measurements.length;

  const passed =
    repetitionResults.length === requestedRepetitions &&
    repetitionResults.every(result => result.passed) &&
    score >= 80;

  return {
    score,
    passed,
    stabilityCents,
    durationSec,
    repetitionsCompleted: repetitionResults.length,
    repetitionScores,
  };
}
