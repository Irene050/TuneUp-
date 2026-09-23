import { CONTROLLED_BREATH_RELEASE_PARAMS, Tier } from '@/constants/exercises/breathControl';
import { ControlledBreathReleaseMeasurement } from '@/services/measurement/breathControl/controlledBreathRelease';

export interface ControlledBreathReleaseScoreResult {
  score: number;
  passed: boolean;
}

export function scoreControlledBreathRelease(
  measurement: ControlledBreathReleaseMeasurement,
  tier: Tier
): ControlledBreathReleaseScoreResult {
  const params = CONTROLLED_BREATH_RELEASE_PARAMS[tier];
  const score = Math.round(measurement.pulseConsistencyPct * 0.6 + measurement.intervalAccuracyPct * 0.4);

  return {
    score,
    passed:
      measurement.pulseConsistencyPct >= params.pulseConsistencyThreshold &&
      measurement.peaks.length >= params.pulseCount,
  };
}