
import type {
  MelodicPatternMatchingParams,
} from '@/constants/exercises/pitch';

import type {
  MelodicPatternMeasurement,
} from '@/services/measurement/pitch/melodicPatternMatching';

export interface MelodicPatternScoreResult {
  score: number;
  passed: boolean;
  noteAccuracies: number[];
  notesHit: boolean[];
  patternAccuracy: number;
  rhythmAccuracy: number;
  repetitionsCompleted: number;
  repetitionScores: number[];
}

export function scoreMelodicPatternMatching(
  measurement: MelodicPatternMeasurement,
  targetFreqs: number[],
  targetTimestamps: number[],
  params: MelodicPatternMatchingParams,
): MelodicPatternScoreResult {
  const noteCount = targetFreqs.length;

  if (noteCount === 0) {
    return {
      score: 0,
      passed: false,
      noteAccuracies: [],
      notesHit: [],
      patternAccuracy: 0,
      rhythmAccuracy: 0,
      repetitionsCompleted: 1,
      repetitionScores: [0],
    };
  }

  const noteAccuracies: number[] = [];
  const notesHit: boolean[] = [];

  // Cap tolerance to avoid overly generous settings.
  const strictTolerance = Math.min(
    params.tolerancePct,
    1,
  );

  for (let i = 0; i < noteCount; i++) {
    const target = targetFreqs[i];
    const frequencies = measurement.segmentFrequencies?.[i] ?? [];

    if (
      !Number.isFinite(target) ||
      target <= 0 ||
      frequencies.length === 0
    ) {
      noteAccuracies.push(0);
      notesHit.push(false);
      continue;
    }

    const frameAccuracies = frequencies.map(detected => {
      if (!Number.isFinite(detected) || detected <= 0) {
        return 0;
      }

      const deviationPct =
        (Math.abs(detected - target) / target) * 100;

      // Strict curve: 0% = 100, 0.5% = 50, 1% = 0.
      return Math.max(
        0,
        Math.min(100, 100 - deviationPct * 100),
      );
    });

    const averageAccuracy =
      frameAccuracies.reduce((sum, value) => sum + value, 0) /
      frameAccuracies.length;

    const allFramesMatch = frequencies.every(detected => {
      if (!Number.isFinite(detected) || detected <= 0) {
        return false;
      }

      const deviationPct =
        (Math.abs(detected - target) / target) * 100;

      return deviationPct <= strictTolerance;
    });

    noteAccuracies.push(averageAccuracy);
    notesHit.push(allFramesMatch);
  }

  const patternAccuracy =
    noteAccuracies.reduce((sum, value) => sum + value, 0) /
    noteCount;

  const timingScores = Array.from(
    { length: noteCount },
    (_, index) => {
      const targetTime = targetTimestamps[index];
      const detectedTime = measurement.noteTimestamps[index];

      if (
        !Number.isFinite(targetTime) ||
        !Number.isFinite(detectedTime)
      ) {
        return 0;
      }

      const differenceMs =
        Math.abs(detectedTime - targetTime) * 1000;

      // Full timing score only within 50 ms.
      // Zero points at 150 ms or more.
      return Math.max(
        0,
        Math.min(100, 100 - (differenceMs / 150) * 100),
      );
    },
  );

  const rhythmAccuracy =
    timingScores.reduce((sum, value) => sum + value, 0) /
    noteCount;

  const hitCount = notesHit.filter(Boolean).length;

  // Pitch accuracy dominates the score.
  const score = Math.round(
    patternAccuracy * 0.85 +
      rhythmAccuracy * 0.15,
  );

  const passed =
    hitCount / noteCount >= 0.9 &&
    patternAccuracy >= 85 &&
    rhythmAccuracy >= 70 &&
    score >= 85;

  console.log('🎵 MELODIC PATTERN SCORE DEBUG:', {
    targetFreqs,
    detectedSegments: measurement.segmentFrequencies,
    noteAccuracies,
    notesHit,
    hitCount,
    noteCount,
    patternAccuracy,
    rhythmAccuracy,
    finalScore: score,
    passed,
  });

  return {
    score,
    passed,
    noteAccuracies,
    notesHit,
    patternAccuracy,
    rhythmAccuracy,
    repetitionsCompleted: 1,
    repetitionScores: [score],
  };
}

export function scoreMelodicPatternMatchingRepetitions(
  measurements: MelodicPatternMeasurement[],
  targetFreqs: number[],
  targetTimestamps: number[],
  params: MelodicPatternMatchingParams,
): MelodicPatternScoreResult {
  const requestedRepetitions = Math.max(
    1,
    Math.round(params.repetitions),
  );

  if (measurements.length === 0) {
    return {
      score: 0,
      passed: false,
      noteAccuracies: [],
      notesHit: [],
      patternAccuracy: 0,
      rhythmAccuracy: 0,
      repetitionsCompleted: 0,
      repetitionScores: Array(requestedRepetitions).fill(0),
    };
  }

  const repetitionResults = measurements
    .slice(0, requestedRepetitions)
    .map(measurement =>
      scoreMelodicPatternMatching(
        measurement,
        targetFreqs,
        targetTimestamps,
        params,
      ),
    );

  const repetitionScores = [
    ...repetitionResults.map(result => result.score),
    ...Array(
      Math.max(
        0,
        requestedRepetitions - repetitionResults.length,
      ),
    ).fill(0),
  ];

  const score = Math.round(
    repetitionScores.reduce((sum, value) => sum + value, 0) /
      requestedRepetitions,
  );

  const patternAccuracy =
    repetitionResults.reduce(
      (sum, result) => sum + result.patternAccuracy,
      0,
    ) / repetitionResults.length;

  const rhythmAccuracy =
    repetitionResults.reduce(
      (sum, result) => sum + result.rhythmAccuracy,
      0,
    ) / repetitionResults.length;

  const firstResult = repetitionResults[0];

  const passed =
    repetitionResults.length === requestedRepetitions &&
    repetitionResults.every(result => result.passed) &&
    score >= 85;

  return {
    score,
    passed,
    noteAccuracies: firstResult.noteAccuracies,
    notesHit: firstResult.notesHit,
    patternAccuracy,
    rhythmAccuracy,
    repetitionsCompleted: repetitionResults.length,
    repetitionScores,
  };
}