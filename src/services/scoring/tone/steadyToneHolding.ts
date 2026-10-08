import type {
  SteadyToneHoldingParams,
} from '@/constants/exercises/tone';

import type {
  SteadyToneHoldingMeasurement,
} from '@/services/measurement/tone/steadyToneHolding';

import {
  calcOverallToneQuality,
} from '@/utils/dsp/spectral';

export interface SteadyToneHoldingScoreResult {
  score: number;
  passed: boolean;
}

function clampScore(
  value: number,
): number {
  return Number.isFinite(value)
    ? Math.max(
        0,
        Math.min(100, value),
      )
    : 0;
}

export function scoreSteadyToneHolding(
  measurement: SteadyToneHoldingMeasurement,
  params: SteadyToneHoldingParams,
): SteadyToneHoldingScoreResult {
  const quality =
    clampScore(
      calcOverallToneQuality(
        measurement.smoothnessPct,
        measurement.amplitudeStabilityPct,
        measurement.pitchStabilityPct,
      ),
    );

  const durationScore =
    params.durationSec > 0
      ? clampScore(
          (measurement.durationSec /
            params.durationSec) *
            100,
        )
      : 0;

  const score = Math.round(
    quality * 0.7 +
      durationScore * 0.3,
  );

  return {
    score,
    passed:
      quality >=
        params.qualityThreshold &&
      measurement.durationSec >=
        params.durationSec,
  };
}