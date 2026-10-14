import type {
  FrequencyZoneStabilityParams,
} from '@/constants/exercises/tone';

import type {
  FrequencyZoneStabilityMeasurement,
} from '@/services/measurement/tone/frequencyZoneStability';

export interface FrequencyZoneStabilityScoreResult {
  score: number;
  passed: boolean;
}

function clampScore(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}

export function scoreFrequencyZoneStability(
  measurement: FrequencyZoneStabilityMeasurement,
  params: FrequencyZoneStabilityParams,
): FrequencyZoneStabilityScoreResult {
  const stabilityScore = clampScore(
    measurement.stabilityPct,
  );

  const coverageScore = clampScore(
    measurement.detectionCoveragePct,
  );

  const durationScore =
    params.durationSec > 0
      ? clampScore(
          (measurement.durationSec /
            params.durationSec) *
            100,
        )
      : 0;

  // Stricter stability scoring:
  // Values below 60 receive no stability points.
  // Values from 60 to 100 scale to 0–100.
  const adjustedStabilityScore = clampScore(
    ((stabilityScore - 60) / 40) * 100,
  );

  const rawScore =
    adjustedStabilityScore * 0.7 +
    coverageScore * 0.2 +
    durationScore * 0.1;

  const score = Math.round(
    clampScore(rawScore),
  );

  const enoughPitchData =
    measurement.validPitchCount >= 8;

  const enoughCoverage =
    coverageScore >= 80;

  const enoughDuration =
    measurement.durationSec >=
    params.durationSec;

  const stableEnough =
    stabilityScore >=
    Math.max(params.stabilityThreshold, 80);

  return {
    score,
    passed:
      enoughPitchData &&
      enoughCoverage &&
      enoughDuration &&
      stableEnough &&
      score >= 80,
  };
}