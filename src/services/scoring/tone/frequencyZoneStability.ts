
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

export function scoreFrequencyZoneStability(
  measurement: FrequencyZoneStabilityMeasurement,
  params: FrequencyZoneStabilityParams,
): FrequencyZoneStabilityScoreResult {
  const durationScore =
    params.durationSec > 0
      ? Math.min(
          measurement.durationSec /
            params.durationSec,
          1,
        ) * 100
      : 0;

  const coverageScore =
    Math.min(
      Math.max(
        measurement.detectionCoveragePct,
        0,
      ),
      100,
    );

  // Pitch and zone stability are combined
  // in measurement.stabilityPct.
  const rawScore =
    measurement.stabilityPct * 0.7 +
    coverageScore * 0.2 +
    durationScore * 0.1;

  const score = Math.round(
    Math.max(0, Math.min(100, rawScore)),
  );

  const enoughPitchData =
    measurement.validPitchCount >= 5;

  const enoughCoverage =
    coverageScore >= 70;

  const enoughDuration =
    measurement.durationSec >=
    params.durationSec;

  const stableEnough =
    measurement.stabilityPct >=
    params.stabilityThreshold;

  return {
    score,
    passed:
      enoughPitchData &&
      enoughCoverage &&
      enoughDuration &&
      stableEnough,
  };
}
