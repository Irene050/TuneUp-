import type {
  FrequencyZoneStabilityParams,
} from '@/constants/params';

import type {
  FrequencyZoneStabilityMeasurement,
} from '@/services/measurement/tone/frequencyZoneStability';
import { clampScore } from '@/utils/math';

export interface FrequencyZoneStabilityScoreResult {
  score: number;
  passed: boolean;
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

  return {
    score,
    passed,
  };
}