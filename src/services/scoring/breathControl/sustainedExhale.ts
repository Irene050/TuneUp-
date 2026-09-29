import type {
  SustainedExhaleParams,
} from '@/constants/exercises/breathControl';

import type {
  SustainedExhaleMeasurement,
} from '@/services/measurement/breathControl/sustainedExhale';

export interface SustainedExhaleScoreResult {
  score: number;
  passed: boolean;
  detected: boolean;
}

export function scoreSustainedExhale(
  measurement: SustainedExhaleMeasurement,
  params: SustainedExhaleParams,
): SustainedExhaleScoreResult {
  if (!measurement.detected) {
    return {
      score: 0,
      passed: false,
      detected: false,
    };
  }

  const targetDurationSec =
    (params.durationRangeSec[0] +
      params.durationRangeSec[1]) /
    2;

  const durationRatio =
    targetDurationSec > 0
      ? Math.min(
          measurement.actualDurationSec /
            targetDurationSec,
          1,
        )
      : 0;

  const consistencyFactor =
    measurement.consistencyPct / 100;

  const score = Math.round(
    durationRatio *
      100 *
      consistencyFactor,
  );

  return {
    score,
    passed:
      measurement.consistencyPct >=
      params.consistencyThreshold,
    detected: true,
  };
}