import type { DiaphragmaticBreathingParams } from '@/constants/exercises/breathControl';

import type { DiaphragmaticBreathingMeasurement } from '@/services/measurement/breathControl/diaphragmaticBreathing';

export interface DiaphragmaticBreathingScoreResult {
  score: number;
  passed: boolean;
  detected: boolean;
}

export function scoreDiaphragmaticBreathing(
  measurement: DiaphragmaticBreathingMeasurement,
  params: DiaphragmaticBreathingParams,
): DiaphragmaticBreathingScoreResult {
  if (!measurement.detected) {
    return {
      score: 0,
      passed: false,
      detected: false,
    };
  }

  /*
   * ---------------------------------------------------
   * EXHALATION DURATION
   * ---------------------------------------------------
   *
   * Longer exhalation targets are harder.
   */

  const durationScore =
    params.exhaleSec > 0
      ? Math.min(
          measurement.exhaleDurationSec /
            params.exhaleSec,
          1,
        ) * 100
      : 0;

  /*
   * ---------------------------------------------------
   * CONSISTENCY
   * ---------------------------------------------------
   */

  const consistencyScore =
    measurement.consistencyPct;

  /*
   * ---------------------------------------------------
   * VOLUME ACCURACY
   * ---------------------------------------------------
   */

  const [dbMin, dbMax] =
    params.targetDbRange;

  const dbMidpoint =
    (dbMin + dbMax) / 2;

  const dbDeviation =
    Math.abs(
      measurement.volumeDb - dbMidpoint,
    ) /
    (dbMax - dbMin || 1);

  const volumeAccuracy =
    Math.max(
      0,
      100 - dbDeviation * 100,
    );

  /*
   * ---------------------------------------------------
   * FINAL SCORE
   * ---------------------------------------------------
   */

  const score = Math.round(
    durationScore * 0.4 +
      consistencyScore * 0.4 +
      volumeAccuracy * 0.2,
  );

  return {
    score,
    passed:
      measurement.consistencyPct >=
      params.consistencyThreshold,
    detected: true,
  };
}