
import type { SteadyAirflowParams } from '@/constants/breathControl';
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

  const durationScore =
    params.durationSec > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (measurement.durationSec /
              (params.durationSec * 1.25)) *
              100,
          ),
        )
      : 0;

  const stabilityScore = Number.isFinite(
    measurement.stabilityPct,
  )
    ? Math.max(
        0,
        Math.min(100, measurement.stabilityPct),
      )
    : 0;

  const score = Math.round(
    durationScore * 0.4 +
      stabilityScore * 0.6,
  );

  const passed =
    measurement.durationSec >= params.durationSec &&
    stabilityScore >= params.stabilityThreshold &&
    score >= 75;

  console.log('🌬️ STEADY AIRFLOW SCORE DEBUG:', {
    actualDurationSec: measurement.durationSec,
    targetDurationSec: params.durationSec,
    durationScore,
    stabilityScore,
    finalScore: score,
    passed,
  });

  return {
    score,
    passed,
    detected: true,
  };
}
