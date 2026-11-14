import type {
    ToneConsistencyParams,
} from '@/constants/params';

import type {
    ToneConsistencyMeasurement,
} from '@/services/measurement/tone/toneConsistencyExercise';

import {
    calcCrossRepConsistency,
} from '@/utils/dsp/spectral';
import { clampScore } from '@/utils/math';

export interface ToneConsistencyScoreResult {
  score: number;
  passed: boolean;
  repetitionScores: number[];
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
      repetitionScores: measurement.centroids.map(() => 0),
    };
  }

  const meanCentroid =
    validCentroids.reduce((sum, value) => sum + value, 0) /
    validCentroids.length;
  const meanAmplitude =
    validAmplitudes.reduce((sum, value) => sum + value, 0) /
    validAmplitudes.length;
  const repetitionScores = measurement.centroids.map(
    (centroid, index) => {
      const amplitude = measurement.amplitudes[index];
      if (
        !Number.isFinite(centroid) ||
        centroid <= 0 ||
        !Number.isFinite(amplitude) ||
        amplitude <= 0
      ) {
        return 0;
      }

      const relativeCentroidDeviation =
        Math.abs(centroid - meanCentroid) / meanCentroid;
      const relativeAmplitudeDeviation =
        Math.abs(amplitude - meanAmplitude) / meanAmplitude;
      const consistency =
        100 -
        ((relativeCentroidDeviation +
          relativeAmplitudeDeviation) /
          2) *
          100;

      return Math.round(clampScore(consistency * 0.96));
    },
  );

  const consistency =
    calcCrossRepConsistency(
      validCentroids,
      validAmplitudes,
    );

  const score = Math.round(
    clampScore(consistency * 0.96),
  );

  return {
    score,
    passed:
      score >=
      params.consistencyThreshold,
    repetitionScores,
  };
}