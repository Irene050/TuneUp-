import type {
    SteadyToneHoldingParams,
} from '@/constants/params';

import type {
    SteadyToneHoldingMeasurement,
} from '@/services/measurement/tone/steadyToneHolding';

import {
    calcOverallToneQuality,
} from '@/utils/dsp/spectral';
import { clampScore } from '@/utils/math';

export interface SteadyToneHoldingScoreResult {
  score: number;
  passed: boolean;
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
      durationScore * 0.3 * 0.96,
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