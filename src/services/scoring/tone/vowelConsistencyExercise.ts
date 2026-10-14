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
  return Math.max(min, Math.min(max, value));
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

  const inBand =
    averageCentroid > 0 &&
    identifyVowelBand(
      averageCentroid,
      params.vowel,
    );

  const smoothnessScore =
    Number.isFinite(measurement.smoothnessPct)
      ? clamp(measurement.smoothnessPct, 0, 100)
      : 0;

  // Gradual scoring:
  // 100% smoothness = 100 points
  // 90% smoothness = 90 points
  // 80% smoothness = 80 points
  // 70% smoothness = 70 points
  // 60% smoothness = 60 points
  const smoothnessPoints = smoothnessScore;

  // Reward the expected frequency band, but do not
  // make a slightly out-of-band result nearly worthless.
  const score = Math.round(
    inBand
      ? smoothnessPoints
      : smoothnessPoints * 0.75,
  );

  const passed =
    smoothnessScore >=
      Math.max(params.smoothnessThreshold, 70) &&
    score >= 75;

  console.log('🎤 VOWEL CONSISTENCY SCORE DEBUG:', {
    averageCentroidHz: averageCentroid,
    vowel: params.vowel,
    inBand,
    smoothnessScore,
    smoothnessPoints,
    finalScore: score,
    passed,
  });

  return {
    score: clamp(score, 0, 100),
    passed,
  };
}
