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

function clampScore(
  value: number,
): number {
  return Number.isFinite(value)
    ? Math.max(
        0,
        Math.min(100, value),
      )
    : 0;
}

export function scoreWaveformSmoothnessDrill(
  measurement: WaveformSmoothnessMeasurement,
  params: WaveformSmoothnessParams,
): WaveformSmoothnessScoreResult {
  const centroidSmoothnessScore =
    clampScore(
      measurement.centroidSmoothnessPct,
    );

  const amplitudeStabilityScore =
    clampScore(
      measurement.amplitudeStabilityPct,
    );

  const score = Math.round(
    centroidSmoothnessScore * 0.7 +
      amplitudeStabilityScore * 0.3,
  );

  const passed =
    centroidSmoothnessScore >=
      params.smoothnessThreshold &&
    amplitudeStabilityScore >=
      params.smoothnessThreshold;

  return {
    score,
    passed,
  };
}