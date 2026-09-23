import { TONE_CONSISTENCY_PARAMS, Tier } from '@/constants/exercises/tone';
import { ToneConsistencyMeasurement } from '@/services/measurement/tone/toneConsistencyExercise';
import { calcCrossRepConsistency } from '@/utils/dsp/spectral';

export interface ToneConsistencyScoreResult {
  score: number;
  passed: boolean;
}

export function scoreToneConsistencyExercise(
  measurement: ToneConsistencyMeasurement,
  tier: Tier
): ToneConsistencyScoreResult {
  const params = TONE_CONSISTENCY_PARAMS[tier];
  const consistency = calcCrossRepConsistency(measurement.centroids, measurement.amplitudes);

  return { score: Math.round(consistency), passed: consistency >= params.consistencyThreshold };
}