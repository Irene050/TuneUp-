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
    Math.min(
      measurement.durationSec /
        params.durationSec,
      1,
    ) * 100;

  const score = Math.round(
    measurement.stabilityPct * 0.6 +
      durationScore * 0.4,
  );

  return {
    score,
    passed:
      measurement.stabilityPct >=
        params.stabilityThreshold &&
      measurement.durationSec >=
        params.durationSec,
  };
}
