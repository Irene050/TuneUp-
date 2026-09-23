import { SUSTAINED_SSSS_PARAMS, Tier } from '@/constants/exercises/breathControl';
import { SustainedSSSSMeasurement } from '@/services/measurement/breathControl/sustainedSSSS';

export interface SustainedSSSSScoreResult {
  score: number;
  passed: boolean;
  detected: boolean;
}

export function scoreSustainedSSSS(
  measurement: SustainedSSSSMeasurement,
  tier: Tier
): SustainedSSSSScoreResult {
  if (!measurement.detected) {
    return { score: 0, passed: false, detected: false };
  }

  const params = SUSTAINED_SSSS_PARAMS[tier];
  const targetDurationSec = (params.durationRangeSec[0] + params.durationRangeSec[1]) / 2;

  const durationRatio = targetDurationSec > 0
    ? Math.min(measurement.actualDurationSec / targetDurationSec, 1)
    : 0;
  const consistencyFactor = measurement.consistencyPct / 100;
  const score = Math.round(durationRatio * 100 * consistencyFactor);

  return { score, passed: measurement.consistencyPct >= params.consistencyThreshold, detected: true };
}