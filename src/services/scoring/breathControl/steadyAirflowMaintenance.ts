import { STEADY_AIRFLOW_PARAMS, Tier } from '@/constants/exercises/breathControl';
import { SteadyAirflowMeasurement } from '@/services/measurement/breathControl/steadyAirflowMaintenance';

export interface SteadyAirflowScoreResult {
  score: number;
  passed: boolean;
  detected: boolean;
}

export function scoreSteadyAirflow(
  measurement: SteadyAirflowMeasurement,
  tier: Tier
): SteadyAirflowScoreResult {
  if (!measurement.detected) {
    return { score: 0, passed: false, detected: false };
  }

  const params = STEADY_AIRFLOW_PARAMS[tier];
  const durationScore = params.durationSec > 0
    ? Math.min(measurement.durationSec / params.durationSec, 1) * 100
    : 0;
  const score = Math.round(measurement.stabilityPct * 0.7 + durationScore * 0.3);

  return { score, passed: measurement.stabilityPct >= params.stabilityThreshold, detected: true };
}