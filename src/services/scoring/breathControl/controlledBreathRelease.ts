import type { ControlledBreathReleaseParams } from '@/constants/exercises/breathControl';

import type { ControlledBreathReleaseMeasurement } from '@/services/measurement/breathControl/controlledBreathRelease';

export interface ControlledBreathReleaseScoreResult {
  score: number;
  passed: boolean;
}

export function scoreControlledBreathRelease(
  measurement: ControlledBreathReleaseMeasurement,
  params: ControlledBreathReleaseParams,
): ControlledBreathReleaseScoreResult {
  const score = Math.round(
    measurement.pulseConsistencyPct * 0.6 +
      measurement.intervalAccuracyPct * 0.4,
  );

  return {
    score,
    passed:
      measurement.pulseConsistencyPct >=
        params.pulseConsistencyThreshold &&
      measurement.peaks.length >=
        params.pulseCount,
  };
}