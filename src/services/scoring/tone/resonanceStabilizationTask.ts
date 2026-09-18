import { RESONANCE_STABILIZATION_PARAMS, Tier } from '@/constants/exercises/tone';
import { ResonanceStabilizationMeasurement } from '@/services/measurement/tone/resonanceStabilizationTask';

export interface ResonanceStabilizationScoreResult {
  score: number;
  passed: boolean;
}

export function scoreResonanceStabilizationTask(
  measurement: ResonanceStabilizationMeasurement,
  tier: Tier
): ResonanceStabilizationScoreResult {
  const params = RESONANCE_STABILIZATION_PARAMS[tier];
  const durationScore = Math.min(measurement.durationSec / params.durationSec, 1) * 100;
  const score = Math.round(measurement.stabilityPct * 0.6 + durationScore * 0.4);

  return { score, passed: measurement.stabilityPct >= params.stabilityThreshold };
}