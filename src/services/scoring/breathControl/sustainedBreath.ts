import type { SustainedBreathParams } from '@/constants/params';
import type { SustainedBreathMeasurement } from '@/services/measurement/breathControl/sustainedBreath';

export interface SustainedBreathScoreResult {
  score: number;
  passed: boolean;
  detected: boolean;
}

type DurationRequirement = 'minimum' | 'minimumAndMaximum';

export function scoreSustainedBreath(
  measurement: SustainedBreathMeasurement,
  params: SustainedBreathParams,
  durationRequirement: DurationRequirement,
): SustainedBreathScoreResult {
  if (!measurement.detected) {
    return {
      score: 0,
      passed: false,
      detected: false,
    };
  }

  const [minDurationSec, maxDurationSec] =
    params.durationRangeSec;

  const actualDurationSec = Number.isFinite(
    measurement.actualDurationSec,
  )
    ? Math.max(0, measurement.actualDurationSec)
    : 0;

  const durationScore =
    maxDurationSec > 0
      ? Math.max(
          0,
          Math.min(100, (actualDurationSec / maxDurationSec) * 100),
        )
      : 0;

  const consistencyScore = Number.isFinite(
    measurement.consistencyPct,
  )
    ? Math.max(0, Math.min(100, measurement.consistencyPct))
    : 0;

  const score = Math.round(
    durationScore * 0.3 + consistencyScore * 0.7,
  );

  const durationPassed =
    actualDurationSec >= minDurationSec &&
    (durationRequirement === 'minimum' ||
      actualDurationSec >= maxDurationSec);
  const passed =
    durationPassed &&
    consistencyScore >= Math.max(params.consistencyThreshold, 85) &&
    score >= 85;

  return {
    score,
    passed,
    detected: true,
  };
}
