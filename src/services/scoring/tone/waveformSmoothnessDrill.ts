
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

function clampScore(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}

function calculateStrictScore(value: number): number {
  return Math.max(
    0,
    Math.min(100, (value - 50) * 1.25),
  );
}

function calculateAmplitudeScore(value: number): number {
  // More forgiving amplitude scoring:
  // 100% = 100 points
  // 90% = 92.5 points
  // 80% = 85 points
  // 70% = 77.5 points
  // 60% = 70 points
  return Math.max(
    0,
    Math.min(100, 0.75 * value + 25),
  );
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

  const strictCentroidScore = calculateStrictScore(
    centroidSmoothnessScore,
  );

  const amplitudeScore = calculateAmplitudeScore(
    amplitudeStabilityScore,
  );

  const score = Math.round(
    strictCentroidScore * 0.7 +
      amplitudeScore * 0.3,
  );

  const requiredThreshold = Math.max(
    params.smoothnessThreshold,
    75,
  );

  const passed =
    centroidSmoothnessScore >= requiredThreshold &&
    amplitudeStabilityScore >= requiredThreshold &&
    score >= 75;

  console.log('🎵 WAVEFORM SMOOTHNESS SCORE DEBUG:', {
    centroidSmoothnessScore,
    amplitudeStabilityScore,
    strictCentroidScore,
    amplitudeScore,
    requiredThreshold,
    finalScore: score,
    passed,
  });

  return {
    score: clampScore(score),
    passed,
  };
}