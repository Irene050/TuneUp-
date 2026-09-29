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

export function scoreToneConsistencyExercise(
  measurement: ToneConsistencyMeasurement,
  params: ToneConsistencyParams,
): ToneConsistencyScoreResult {
  const consistency =
    calcCrossRepConsistency(
      measurement.centroids,
      measurement.amplitudes,
    );

  return {
    score: Math.round(consistency),
    passed:
      consistency >=
      params.consistencyThreshold,
  };
}