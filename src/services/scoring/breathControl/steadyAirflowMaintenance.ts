import type { SteadyAirflowParams } from '@/constants/exercises/breathControl';

import type { SteadyAirflowMeasurement } from '@/services/measurement/breathControl/steadyAirflowMaintenance';

export interface SteadyAirflowScoreResult {
  score: number;
  passed: boolean;
  detected: boolean;
}

export function scoreSteadyAirflow(
  measurement: SteadyAirflowMeasurement,
  params: SteadyAirflowParams,
): SteadyAirflowScoreResult {
  if (!measurement.detected) {
    return {
      score: 0,
      passed: false,
      detected: false,
    };
  }

  /*
   * ---------------------------------------------------
   * DURATION SCORE
   * ---------------------------------------------------
   *
   * A longer target duration represents greater
   * sustained-airflow difficulty.
   */

  const durationScore =
    params.durationSec > 0
      ? Math.min(
          measurement.durationSec /
            params.durationSec,
          1,
        ) * 100
      : 0;

  /*
   * ---------------------------------------------------
   * STABILITY SCORE
   * ---------------------------------------------------
   */

  const stabilityScore =
    measurement.stabilityPct;

  /*
   * ---------------------------------------------------
   * FINAL SCORE
   * ---------------------------------------------------
   *
   * Duration and airflow stability are both relevant
   * to this exercise.
   */

  const score = Math.round(
    durationScore * 0.4 +
      stabilityScore * 0.6,
  );

  return {
    score,
    passed:
      measurement.stabilityPct >=
      params.stabilityThreshold,
    detected: true,
  };
}