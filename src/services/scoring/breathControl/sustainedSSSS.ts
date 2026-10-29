import type { SustainedExhaleParams } from '@/constants/params';
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

  const minDurationSec = params.durationRangeSec[0];
  const maxDurationSec = params.durationRangeSec[1];

  const actualDurationSec = Number.isFinite(
    measurement.actualDurationSec,
  )
    ? Math.max(0, measurement.actualDurationSec)
    : 0;

  const durationScore =
    maxDurationSec > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (actualDurationSec / maxDurationSec) * 100,
          ),
        )
      : 0;

  const consistencyScore = Number.isFinite(
    measurement.consistencyPct,
  )
    ? Math.max(
        0,
        Math.min(100, measurement.consistencyPct),
      )
    : 0;

  const strictConsistencyScore = Math.max(
    0,
    Math.min(100, (consistencyScore - 50) * 2),
  );

  const score = Math.round(
    durationScore * 0.3 +
      strictConsistencyScore * 0.7,
  );

  const passed =
    actualDurationSec >= minDurationSec &&
    consistencyScore >= Math.max(
      params.consistencyThreshold,
      85,
    ) &&
    score >= 85;

  console.log('🌬️ STRICT SUSTAINED SSSS SCORE DEBUG:', {
    actualDurationSec,
    minDurationSec,
    maxDurationSec,
    durationScore,
    consistencyScore,
    strictConsistencyScore,
    finalScore: score,
    passed,
  });

  return {
    score,
    passed,
    detected: true,
  };
}