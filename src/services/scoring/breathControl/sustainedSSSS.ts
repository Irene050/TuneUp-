import type { SustainedExhaleParams } from '@/constants/exercises/breathControl';

import type { SustainedSSSSMeasurement } from '@/services/measurement/breathControl/sustainedSSSS';

export interface SustainedSSSSScoreResult {
  score: number;
  passed: boolean;
  detected: boolean;
}

export function scoreSustainedSSSS(
  measurement: SustainedSSSSMeasurement,
  params: SustainedExhaleParams,
): SustainedSSSSScoreResult {
  if (!measurement.detected) {
    return {
      score: 0,
      passed: false,
      detected: false,
    };
  }

  const minDurationSec =
    params.durationRangeSec[0];

  const durationScore =
    minDurationSec > 0
      ? Math.min(
          measurement.actualDurationSec /
            minDurationSec,
          1,
        ) * 100
      : 0;

  const consistencyScore =
    Number.isFinite(
      measurement.consistencyPct,
    )
      ? Math.max(
          0,
          Math.min(
            100,
            measurement.consistencyPct,
          ),
        )
      : 0;

  const score = Math.round(
    durationScore * 0.6 +
      consistencyScore * 0.4,
  );

  const passed =
    measurement.actualDurationSec >=
      minDurationSec &&
    consistencyScore >=
      params.consistencyThreshold;

  return {
    score,
    passed,
    detected: true,
  };
}