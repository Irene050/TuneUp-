import type {
    FrequencyZoneStabilityParams,
} from '@/constants/params';

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

  const rawScore =
    stabilityScore * 0.7 +
    coverageScore * 0.2 +
    durationScore * 0.1;

  const score = Math.round(
    clampScore(rawScore),
  );

  const enoughPitchData =
    measurement.validPitchCount >= 8;

  const enoughCoverage =
    coverageScore >= 70;

  const enoughDuration =
    measurement.durationSec >=
    params.durationSec;

  const requiredStability = Math.max(
    params.stabilityThreshold,
    65,
  );

  const stableEnough =
    stabilityScore >= requiredStability;

  const passed =
    enoughPitchData &&
    enoughCoverage &&
    enoughDuration &&
    stableEnough &&
    score >= 60;

  console.log(
    '🎯 FREQUENCY ZONE STABILITY SCORE DEBUG:',
    {
      stabilityScore,
      coverageScore,
      durationScore,
      stabilityWeight: 0.7,
      coverageWeight: 0.2,
      durationWeight: 0.1,
      requiredStability,
      enoughPitchData,
      enoughCoverage,
      enoughDuration,
      finalScore: score,
      passed,
    },
  );

  return {
    score,
    passed,
  };
}