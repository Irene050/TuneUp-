import {
  Tier,
  VOWEL_CONSISTENCY_PARAMS,
} from '@/constants/exercises/tone';

import type {
  VowelConsistencyMeasurement,
} from '@/services/measurement/tone/vowelConsistencyExercise';

import {
  identifyVowelBand,
} from '@/utils/dsp/spectral';

export interface VowelConsistencyScoreResult {
  score: number;
  passed: boolean;
}

export function scoreVowelConsistencyExercise(
  measurement: VowelConsistencyMeasurement,
  tier: Tier,
): VowelConsistencyScoreResult {
  const params =
    VOWEL_CONSISTENCY_PARAMS[tier];

  const validCentroids =
    measurement.centroidOverTime.filter(
      (value) =>
        Number.isFinite(value) &&
        value > 0,
    );

  const avgCentroid =
    validCentroids.length > 0
      ? validCentroids.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        validCentroids.length
      : 0;

  const inBand =
    identifyVowelBand(
      avgCentroid,
      params.vowel,
    );

  const score = Math.round(
    measurement.smoothnessPct,
  );

  return {
    score,
    passed:
      inBand &&
      measurement.smoothnessPct >=
        params.smoothnessThreshold,
  };
}