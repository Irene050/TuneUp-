import type {
    VowelConsistencyParams,
} from '@/constants/params';

import type {
    VowelConsistencyMeasurement,
} from '@/services/measurement/tone/vowelConsistencyExercise';
import { clamp } from '@/utils/math';

export interface VowelConsistencyScoreResult {
  score: number;
  passed: boolean;
}

export function scoreVowelConsistencyExercise(
  measurement: VowelConsistencyMeasurement,
  params: VowelConsistencyParams,
): VowelConsistencyScoreResult {
  const averageCentroid =
    Number.isFinite(measurement.averageCentroidHz) &&
    measurement.averageCentroidHz > 0
      ? measurement.averageCentroidHz
      : 0;

  const smoothnessScore =
    Number.isFinite(measurement.smoothnessPct)
      ? clamp(measurement.smoothnessPct, 0, 100)
      : 0;

  const hasValidMeasurement =
    averageCentroid > 0 &&
    measurement.centroidOverTime.length > 0;

  const score = hasValidMeasurement
    ? Math.round(smoothnessScore)
    : 0;

  const passingThreshold = Math.max(
    params.smoothnessThreshold,
    75,
  );

  const passed =
    hasValidMeasurement &&
    score >= passingThreshold;

  console.log('🎤 VOWEL CONSISTENCY SCORE DEBUG:', {
    averageCentroidHz: averageCentroid,
    vowel: params.vowel,
    smoothnessScore,
    passingThreshold,
    finalScore: score,
    passed,
    hasValidMeasurement,
  });

  return {
    score: clamp(score, 0, 100),
    passed,
  };
}