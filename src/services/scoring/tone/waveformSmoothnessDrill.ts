import { Tier, WAVEFORM_SMOOTHNESS_PARAMS } from '@/constants/exercises/tone';
import { WaveformSmoothnessMeasurement } from '@/services/measurement/tone/waveformSmoothnessDrill';

export interface WaveformSmoothnessScoreResult {
  score: number;
  passed: boolean;
}

export function scoreWaveformSmoothnessDrill(
  measurement: WaveformSmoothnessMeasurement,
  tier: Tier
): WaveformSmoothnessScoreResult {
  const params = WAVEFORM_SMOOTHNESS_PARAMS[tier];
  const score = Math.round(measurement.centroidSmoothnessPct * 0.7 + measurement.amplitudeStabilityPct * 0.3);

  return { score, passed: measurement.centroidSmoothnessPct >= params.smoothnessThreshold };
}