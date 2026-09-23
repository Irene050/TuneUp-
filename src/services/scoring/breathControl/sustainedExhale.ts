import {
    SUSTAINED_EXHALE_PARAMS,
    type Tier,
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
  tier: Tier,
  targetDurationSec?: number
): SustainedExhaleScoreResult {
  // ----------------------------------------------------------
  // NO SOUND DETECTED
  // ----------------------------------------------------------

  if (!measurement.detected) {
    return {
      score: 0,
      passed: false,
      detected: false,
    };
  }

  const params =
    SUSTAINED_EXHALE_PARAMS[tier];

  // ----------------------------------------------------------
  // TARGET DURATION
  // ----------------------------------------------------------

  const target =
    targetDurationSec ??
    (
      params.durationRangeSec[0] +
      params.durationRangeSec[1]
    ) / 2;

  // ----------------------------------------------------------
  // DURATION SCORE
  // ----------------------------------------------------------

  const durationRatio =
    target > 0
      ? Math.min(
          Math.max(
            measurement.actualDurationSec /
              target,
            0
          ),
          1
        )
      : 0;

  // ----------------------------------------------------------
  // CONSISTENCY SCORE
  // ----------------------------------------------------------

  const safeConsistency = Math.min(
    Math.max(
      measurement.consistencyPct,
      0
    ),
    100
  );

  const consistencyFactor =
    safeConsistency / 100;

  // ----------------------------------------------------------
  // FINAL SCORE
  // ----------------------------------------------------------

  const rawScore =
    durationRatio *
    100 *
    consistencyFactor;

  const score = Math.round(
    Math.min(
      Math.max(
        rawScore,
        0
      ),
      100
    )
  );

  return {
    score,

    passed:
      safeConsistency >=
      params.consistencyThreshold,

    detected: true,
  };
}