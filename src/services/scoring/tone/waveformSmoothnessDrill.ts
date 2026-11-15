import type {
  WaveformSmoothnessParams,
} from '@/constants/params';

import type {
  WaveformSmoothnessMeasurement,
} from '@/services/measurement/tone/waveformSmoothnessDrill';
import { clampFinite } from '@/utils/utils';

export interface WaveformSmoothnessScoreResult {
  score: number;
  passed: boolean;
}

export function scoreWaveformSmoothnessDrill(
  measurement: WaveformSmoothnessMeasurement,
  params: WaveformSmoothnessParams,
): WaveformSmoothnessScoreResult {
  const centroidSmoothnessScore = clampFinite(
    measurement.centroidSmoothnessPct,
  );

  const amplitudeStabilityScore = clampFinite(
    measurement.amplitudeStabilityPct,
  );

  const score = Math.round(
    centroidSmoothnessScore * 0.6 +
      amplitudeStabilityScore * 0.4,
  );

  const requiredThreshold = Math.max(
    params.smoothnessThreshold,
    60,
  );

  const passed =
    centroidSmoothnessScore >= requiredThreshold &&
    amplitudeStabilityScore >= requiredThreshold &&
    score >= 60;

  return {
    score: clampFinite(score),
    passed,
  };
}