
import type { DiaphragmaticBreathingParams } from '@/constants/exercises/breathControl';
import type { DiaphragmaticBreathingMeasurement } from '@/services/measurement/breathControl/diaphragmaticBreathing';

export interface DiaphragmaticBreathingScoreResult {
  score: number;
  passed: boolean;
  detected: boolean;
}

export function scoreDiaphragmaticBreathing(
  measurement: DiaphragmaticBreathingMeasurement,
  params: DiaphragmaticBreathingParams,
): DiaphragmaticBreathingScoreResult {
  if (!measurement.detected) {
    return {
      score: 0,
      passed: false,
      detected: false,
    };
  }

  const durationScore =
    params.exhaleSec > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (measurement.exhaleDurationSec /
              (params.exhaleSec * 1.25)) *
              100,
          ),
        )
      : 0;

  const consistencyScore = Number.isFinite(
    measurement.consistencyPct,
  )
    ? Math.max(
        0,
        Math.min(100, measurement.consistencyPct),
      )
    : 0;

  const score = Math.round(
    durationScore * 0.4 +
      consistencyScore * 0.6,
  );

  const passed =
    measurement.exhaleDurationSec >= params.exhaleSec &&
    consistencyScore >= params.consistencyThreshold &&
    score >= 75;

  console.log('🌬️ DIAPHRAGMATIC BREATHING SCORE DEBUG:', {
    exhaleDurationSec: measurement.exhaleDurationSec,
    targetExhaleSec: params.exhaleSec,
    durationScore,
    consistencyScore,
    finalScore: score,
    passed,
  });

  return {
    score,
    passed,
    detected: true,
  };
}