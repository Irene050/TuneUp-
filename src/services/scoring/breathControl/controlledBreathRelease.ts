import type { ControlledBreathReleaseParams } from '@/constants/exercises/breathControl';

import type {
  ControlledBreathReleaseMeasurement,
} from '@/services/measurement/breathControl/controlledBreathRelease';

export interface ControlledBreathReleaseScoreResult {
  score: number;
  passed: boolean;
}

export function scoreControlledBreathRelease(
  measurement: ControlledBreathReleaseMeasurement,
  params: ControlledBreathReleaseParams,
): ControlledBreathReleaseScoreResult {
  const pulseConsistencyScore = Math.max(
    0,
    Math.min(
      100,
      measurement.pulseConsistencyPct,
    ),
  );

  const intervalAccuracyScore = Math.max(
    0,
    Math.min(
      100,
      measurement.intervalAccuracyPct,
    ),
  );

  const score = Math.round(
    pulseConsistencyScore * 0.6 +
      intervalAccuracyScore * 0.4,
  );

  const detectedEnoughPulses =
    measurement.peaks.length >=
    params.pulseCount;

  return {
    score: Math.max(0, Math.min(100, score)),
    passed:
      pulseConsistencyScore >=
        params.pulseConsistencyThreshold &&
      detectedEnoughPulses,
  };
}