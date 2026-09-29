import type {
  WaveformSmoothnessParams,
} from '@/constants/exercises/tone';

import type {
  WaveformSmoothnessMeasurement,
} from '@/services/measurement/tone/waveformSmoothnessDrill';

export interface WaveformSmoothnessScoreResult {
  score: number;
  passed: boolean;
}

export function scoreWaveformSmoothnessDrill(
  measurement: WaveformSmoothnessMeasurement,
  params: WaveformSmoothnessParams,
): WaveformSmoothnessScoreResult {
  const score = Math.round(
    measurement.centroidSmoothnessPct * 0.7 +
      measurement.amplitudeStabilityPct * 0.3,
  );

  return {
    score,
    passed:
      measurement.centroidSmoothnessPct >=
      params.smoothnessThreshold,
  };
}