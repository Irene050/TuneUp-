// src/services/scoring/tone/steadyToneHolding.ts

import {
  STEADY_TONE_HOLDING_PARAMS,
  Tier,
} from '@/constants/exercises/tone';

import {
  SteadyToneHoldingMeasurement,
} from '@/services/measurement/tone/steadyToneHolding';

import {
  calcOverallToneQuality,
} from '@/utils/dsp/spectral';

export interface SteadyToneHoldingScoreResult {
  score: number;
  passed: boolean;
}

export function scoreSteadyToneHolding(
  measurement: SteadyToneHoldingMeasurement,
  tier: Tier,
): SteadyToneHoldingScoreResult {
  const params =
    STEADY_TONE_HOLDING_PARAMS[tier];

  const quality =
    calcOverallToneQuality(
      measurement.smoothnessPct,
      measurement.amplitudeStabilityPct,
      measurement.pitchStabilityPct,
    );

  const durationScore =
    Math.min(
      measurement.durationSec /
        params.durationSec,
      1,
    ) * 100;

  const score = Math.round(
    quality * 0.7 +
      durationScore * 0.3,
  );

  return {
    score,
    passed:
      quality >= params.qualityThreshold,
  };
}
