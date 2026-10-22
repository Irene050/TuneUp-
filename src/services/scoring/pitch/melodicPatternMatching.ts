
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

  // Use the configured tolerance, but avoid an excessively
  // narrow tolerance if the configured value is very small.
  const tolerance = Math.max(1.5, params.tolerancePct);

  for (let i = 0; i < noteCount; i++) {
    const target = targetFreqs[i];
    const frequencies =
      measurement.segmentFrequencies?.[i] ?? [];

    if (
      !Number.isFinite(target) ||
      target <= 0 ||
      frequencies.length === 0
    ) {
      noteAccuracies.push(0);
      notesHit.push(false);
      continue;
    }

    const validFrequencies = frequencies.filter(
      frequency =>
        Number.isFinite(frequency) &&
        frequency > 0,
    );

    if (validFrequencies.length === 0) {
      noteAccuracies.push(0);
      notesHit.push(false);
      continue;
    }

    const deviations = validFrequencies.map(
      frequency =>
        (Math.abs(frequency - target) / target) * 100,
    );

    const frameAccuracies = deviations.map(
      deviation =>
        Math.max(
          0,
          Math.min(100, 100 - deviation * 10),
        ),
    );

    const averageAccuracy =
      frameAccuracies.reduce(
        (sum, accuracy) => sum + accuracy,
        0,
      ) / frameAccuracies.length;

    const averageDeviation =
      deviations.reduce(
        (sum, deviation) => sum + deviation,
        0,
      ) / deviations.length;

    // Allow occasional imperfect frames, but do not let
    // a mostly incorrect note count as a hit.
    const matchingFrames = deviations.filter(
      deviation => deviation <= tolerance,
    ).length;

    const matchRate =
      matchingFrames / deviations.length;

    const noteHit =
      averageDeviation <= tolerance &&
      matchRate >= 0.7 &&
      averageAccuracy >= 70;

    noteAccuracies.push(averageAccuracy);
    notesHit.push(noteHit);
  }

  const patternAccuracy =
    noteAccuracies.reduce(
      (sum, accuracy) => sum + accuracy,
      0,
    ) / noteCount;

  const timingScores = Array.from(
    { length: noteCount },
    (_, index) => {
      const targetTime = targetTimestamps[index];
      const detectedTime =
        measurement.noteTimestamps?.[index];

      if (
        !Number.isFinite(targetTime) ||
        !Number.isFinite(detectedTime)
      ) {
        return 0;
      }

      const differenceMs =
        Math.abs(detectedTime - targetTime) * 1000;

      // Full timing credit for close timing; gradual penalty
      // up to 300 ms of timing difference.
      return Math.max(
        0,
        Math.min(100, 100 - (differenceMs / 300) * 100),
      );
    },
  );

  const rhythmAccuracy =
    timingScores.reduce(
      (sum, accuracy) => sum + accuracy,
      0,
    ) / noteCount;

  const hitCount =
    notesHit.filter(Boolean).length;

  const score = Math.round(
    patternAccuracy * 0.8 +
      rhythmAccuracy * 0.2,
  );

  const passed =
    hitCount / noteCount >= 0.8 &&
    patternAccuracy >= 75 &&
    rhythmAccuracy >= 60 &&
    score >= 75;

  console.log('🎵 MELODIC PATTERN SCORE DEBUG:', {
    targetFreqs,
    detectedSegments: measurement.segmentFrequencies,
    noteAccuracies,
    notesHit,
    hitCount,
    noteCount,
    tolerance,
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
  if (measurements.length === 0) {
    return {
      score: 0,
      passed: false,
      noteAccuracies: [],
      notesHit: [],
      patternAccuracy: 0,
      rhythmAccuracy: 0,
      repetitionsCompleted: 0,
      repetitionScores: [],
    };
  }

  const repetitionResults =
    measurements.map(
      measurement =>
        scoreMelodicPatternMatching(
          measurement,
          targetFreqs,
          targetTimestamps,
          params,
        ),
    );

  const repetitionScores =
    repetitionResults.map(
      repetition =>
        repetition.score,
    );

  const requestedRepetitions =
  Math.max(
    1,
    Math.round(params.repetitions),
  );

const completedScores = [
  ...repetitionScores,
  ...Array(
    Math.max(
      0,
      requestedRepetitions -
        repetitionScores.length,
    ),
  ).fill(0),
];

const score =
  Math.round(
    completedScores.reduce(
      (sum, repetitionScore) =>
        sum + repetitionScore,
      0,
    ) /
      completedScores.length,
  );

  const patternAccuracy =
    repetitionResults.reduce(
      (sum, repetition) =>
        sum +
        repetition.patternAccuracy,
      0,
    ) /
    repetitionResults.length;

  const rhythmAccuracy =
    repetitionResults.reduce(
      (sum, repetition) =>
        sum +
        repetition.rhythmAccuracy,
      0,
    ) /
    repetitionResults.length;

  const noteAccuracies =
    repetitionResults[0]
      .noteAccuracies;

  const notesHit =
    repetitionResults[0]
      .notesHit;

  const passed =
    repetitionResults.every(
      repetition =>
        repetition.passed,
    );

  return {
    score,
    passed,
    noteAccuracies,
    notesHit,
    patternAccuracy,
    rhythmAccuracy,
    repetitionsCompleted:
      measurements.length,
    repetitionScores,
  };
}