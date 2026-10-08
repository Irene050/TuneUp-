import type {
  VowelConsistencyParams,
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

function clamp(
  value: number,
  min: number,
  max: number,
) {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

export function scoreVowelConsistencyExercise(
  measurement: VowelConsistencyMeasurement,
  params: VowelConsistencyParams,
): VowelConsistencyScoreResult {
  const averageCentroid =
    Number.isFinite(
      measurement.averageCentroidHz,
    ) &&
    measurement.averageCentroidHz > 0
      ? measurement.averageCentroidHz
      : 0;

  const inBand =
    averageCentroid > 0 &&
    identifyVowelBand(
      averageCentroid,
      params.vowel,
    );

  const smoothnessScore =
    Number.isFinite(
      measurement.smoothnessPct,
    )
      ? clamp(
          measurement.smoothnessPct,
          0,
          100,
        )
      : 0;

  const score = Math.round(
    inBand
      ? smoothnessScore
      : smoothnessScore * 0.5,
  );

  return {
    score: clamp(
      score,
      0,
      100,
    ),
    passed:
      inBand &&
      smoothnessScore >=
        params.smoothnessThreshold,
  };
}
