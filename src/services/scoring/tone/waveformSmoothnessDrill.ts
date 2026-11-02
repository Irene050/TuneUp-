import type {
    WaveformSmoothnessParams,
} from '@/constants/params';

import type {
    WaveformSmoothnessMeasurement,
} from '@/services/measurement/tone/waveformSmoothnessDrill';
import { clampScore } from '@/utils/math';

export interface WaveformSmoothnessScoreResult {
  score: number;
  passed: boolean;
}

export function scoreWaveformSmoothnessDrill(
  measurement: WaveformSmoothnessMeasurement,
  params: WaveformSmoothnessParams,
): WaveformSmoothnessScoreResult {
  const centroidSmoothnessScore = clampScore(
    measurement.centroidSmoothnessPct,
  );

  const amplitudeStabilityScore = clampScore(
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

  console.log('🎵 WAVEFORM SMOOTHNESS SCORE DEBUG:', {
    centroidSmoothnessScore,
    amplitudeStabilityScore,
    requiredThreshold,
    centroidWeight: 0.6,
    amplitudeWeight: 0.4,
    finalScore: score,
    passed,
  });

  return {
    score: clampScore(score),
    passed,
  };
}