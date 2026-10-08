import type {
  ToneConsistencyParams,
} from '@/constants/exercises/tone';

import type {
  ToneConsistencyMeasurement,
} from '@/services/measurement/tone/toneConsistencyExercise';

import {
  calcCrossRepConsistency,
} from '@/utils/dsp/spectral';

export interface ToneConsistencyScoreResult {
  score: number;
  passed: boolean;
}

function clampScore(
  value: number,
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(100, value),
  );
}

export function scoreToneConsistencyExercise(
  measurement: ToneConsistencyMeasurement,
  params: ToneConsistencyParams,
): ToneConsistencyScoreResult {
  const validCentroids =
    measurement.centroids.filter(
      (centroid) =>
        Number.isFinite(centroid) &&
        centroid > 0,
    );

  const validAmplitudes =
    measurement.amplitudes.filter(
      (amplitude) =>
        Number.isFinite(amplitude) &&
        amplitude > 0,
    );

  if (
    validCentroids.length === 0 ||
    validAmplitudes.length === 0 ||
    validCentroids.length !==
      validAmplitudes.length
  ) {
    return {
      score: 0,
      passed: false,
    };
  }

  const consistency =
    calcCrossRepConsistency(
      validCentroids,
      validAmplitudes,
    );

  const score = Math.round(
    clampScore(consistency),
  );

  return {
    score,
    passed:
      score >=
      params.consistencyThreshold,
  };
}