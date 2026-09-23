import { DIAPHRAGMATIC_BREATHING_PARAMS, Tier } from '@/constants/exercises/breathControl';
import { DiaphragmaticBreathingMeasurement } from '@/services/measurement/breathControl/diaphragmaticBreathing';

export interface DiaphragmaticBreathingScoreResult {
  score: number;
  passed: boolean;
  detected: boolean;
}

export function scoreDiaphragmaticBreathing(
  measurement: DiaphragmaticBreathingMeasurement,
  tier: Tier
): DiaphragmaticBreathingScoreResult {
  if (!measurement.detected) {
    return { score: 0, passed: false, detected: false };
  }

  const params = DIAPHRAGMATIC_BREATHING_PARAMS[tier];

  const durationScore = params.exhaleSec > 0
    ? Math.min(measurement.exhaleDurationSec / params.exhaleSec, 1) * 100
    : 0;
  const consistencyScore = measurement.consistencyPct;

  const [dbMin, dbMax] = params.targetDbRange;
  const dbMidpoint = (dbMin + dbMax) / 2;
  const dbDeviation = Math.abs(measurement.volumeDb - dbMidpoint) / (dbMax - dbMin || 1);
  const volumeAccuracy = Math.max(0, 100 - dbDeviation * 100);

  const score = Math.round(durationScore * 0.4 + consistencyScore * 0.4 + volumeAccuracy * 0.2);

  return { score, passed: measurement.consistencyPct >= params.consistencyThreshold, detected: true };
}