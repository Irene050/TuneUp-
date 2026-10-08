
import type {
  MelodicPatternMatchingParams,
} from '@/constants/exercises/pitch';

import type {
  MelodicPatternMeasurement,
} from '@/services/measurement/pitch/melodicPatternMatching';

import {
  calcPitchAccuracy,
} from '@/utils/dsp/pitch';

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
  const noteCount =
    targetFreqs.length;

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

  for (let i = 0; i < noteCount; i++) {
    const target =
      targetFreqs[i];

    const frequencies =
      measurement.segmentFrequencies?.[i] ??
      [];

    /*
     * Invalid target or no detected pitch
     * for this expected note.
     */
    if (
      !Number.isFinite(target) ||
      target <= 0 ||
      frequencies.length === 0
    ) {
      noteAccuracies.push(0);
      notesHit.push(false);
      continue;
    }

    /*
     * Score every reliable pitch frame
     * inside this note segment.
     *
     * A wrong sung pitch contributes 0.
     */
    const frameAccuracies =
      frequencies.map(
        detected => {
          if (
            !Number.isFinite(detected) ||
            detected <= 0
          ) {
            return 0;
          }

          const deviationPct =
            (
              Math.abs(
                detected - target,
              ) / target
            ) * 100;

          if (
            deviationPct >
            params.tolerancePct
          ) {
            return 0;
          }

          const accuracy =
            calcPitchAccuracy(
              detected,
              target,
            );

          return Number.isFinite(
            accuracy,
          )
            ? Math.max(
                0,
                Math.min(
                  100,
                  accuracy,
                ),
              )
            : 0;
        },
      );

    const averageAccuracy =
      frameAccuracies.reduce(
        (sum, accuracy) =>
          sum + accuracy,
        0,
      ) /
      frameAccuracies.length;

    /*
     * A note is considered hit only when
     * every reliable voiced frame in the
     * segment matches the target.
     *
     * This prevents a short correct portion
     * from hiding an incorrect sung portion.
     */
    const allFramesMatch =
      frameAccuracies.every(
        accuracy => accuracy > 0,
      );

    noteAccuracies.push(
      averageAccuracy,
    );

    notesHit.push(
      allFramesMatch,
    );
  }

  const patternAccuracy =
    noteAccuracies.length > 0
      ? noteAccuracies.reduce(
          (sum, accuracy) =>
            sum + accuracy,
          0,
        ) /
        noteAccuracies.length
      : 0;

  const hitCount =
    notesHit.filter(Boolean).length;

  /*
   * Timing is still evaluated once per
   * expected note segment.
   *
   * Missing notes receive zero timing
   * accuracy.
   */
  const timingScores =
    targetTimestamps
      .slice(0, noteCount)
      .map(
        (
          targetTime,
          index,
        ) => {
          const detectedTime =
            measurement
              .noteTimestamps[index];

          if (
            !Number.isFinite(
              detectedTime,
            )
          ) {
            return 0;
          }

          const differenceMs =
            Math.abs(
              detectedTime -
                targetTime,
            ) * 1000;

          return Math.max(
            0,
            100 -
              (differenceMs /
                250) *
                100,
          );
        },
      );

  /*
   * If the target contains more notes than
   * the available timestamps, the missing
   * notes must still contribute zero.
   */
  while (
    timingScores.length <
    noteCount
  ) {
    timingScores.push(0);
  }

  const rhythmAccuracy =
    timingScores.length > 0
      ? timingScores.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        timingScores.length
      : 0;

const score =
  Math.round(
    patternAccuracy * 0.7 +
      rhythmAccuracy * 0.3,
  );

  /*
   * At least 70% of the expected notes
   * must be completely correct.
   */
  const passed =
    hitCount / noteCount >=
    0.85;

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