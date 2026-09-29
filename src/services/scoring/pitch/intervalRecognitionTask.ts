import type {
  IntervalRecognitionParams,
} from '@/constants/exercises/pitch';

import type {
  IntervalRecognitionMeasurement,
} from '@/services/measurement/pitch/intervalRecognitionTask';

export interface IntervalRecognitionScoreResult {
  score: number;
  passed: boolean;

  targetRatio: number;
  detectedRatio: number;

  deviationPct: number;

  intervalName: string;

  freq1: number;
  freq2: number;

  firstNoteDetected: boolean;
  secondNoteDetected: boolean;

  firstNoteClarity: number;
  secondNoteClarity: number;

  repetitionsCompleted: number;
  repetitionScores: number[];
}

export function scoreIntervalRecognitionTask(
  measurement: IntervalRecognitionMeasurement,
  targetRatio: number,
  intervalName: string,
  params: IntervalRecognitionParams,
): IntervalRecognitionScoreResult {
  /*
   * The number of repetitions is fixed by the
   * current difficulty tier.
   */
  const requestedRepetitions = Math.max(
    1,
    Math.round(params.repetitions),
  );

  /*
   * Invalid target ratio means the exercise cannot
   * be scored meaningfully.
   *
   * Return one zero score for every requested
   * repetition so the result shape remains consistent.
   */
  if (
    !Number.isFinite(targetRatio) ||
    targetRatio <= 0
  ) {
    return {
      score: 0,
      passed: false,

      targetRatio,
      detectedRatio: 0,
      deviationPct: 100,

      intervalName,

      freq1:
        measurement.freq1,

      freq2:
        measurement.freq2,

      firstNoteDetected:
        measurement.hasFirstNote,

      secondNoteDetected:
        measurement.hasSecondNote,

      firstNoteClarity:
        measurement.firstNoteClarity,

      secondNoteClarity:
        measurement.secondNoteClarity,

      repetitionsCompleted: 0,

      repetitionScores:
        Array(
          requestedRepetitions,
        ).fill(0),
    };
  }

  /*
   * Only attempts where both notes were successfully
   * detected and a valid interval ratio was produced
   * can receive a non-zero score.
   */
  const validAttempts =
    measurement.attempts.filter(
      attempt =>
        attempt.hasFirstNote &&
        attempt.hasSecondNote &&
        Number.isFinite(
          attempt.detectedRatio,
        ) &&
        attempt.detectedRatio > 0,
    );

  /*
   * Score only the number of repetitions requested
   * by the current tier.
   *
   * The measurement layer normally already limits
   * attempts to the requested number, but this also
   * protects the scorer from unexpected extra attempts.
   */
  const scoredAttempts =
    validAttempts.slice(
      0,
      requestedRepetitions,
    );

  /*
   * Calculate the score of each successfully
   * detected repetition.
   *
   * Score decreases linearly according to the
   * percentage deviation from the target interval.
   */
  const detectedScores =
    scoredAttempts.map(
      attempt => {
        const deviation =
          Math.abs(
            attempt.detectedRatio -
              targetRatio,
          ) /
          targetRatio;

        const deviationPct =
          deviation * 100;

        return Math.round(
          Math.max(
            0,
            Math.min(
              100,
              100 -
                deviationPct,
            ),
          ),
        );
      },
    );

  /*
   * Any requested repetition that was not detected
   * receives a score of 0.
   *
   * Example:
   *
   * Requested = 2
   * Detected  = 1
   * Scores    = [95, 0]
   */
  const missingRepetitions =
    Math.max(
      0,
      requestedRepetitions -
        detectedScores.length,
    );

  const repetitionScores = [
    ...detectedScores,
    ...Array(
      missingRepetitions,
    ).fill(0),
  ];

  /*
   * Final exercise score is the average across
   * ALL requested repetitions, including missing
   * repetitions.
   */
  const score = Math.round(
    repetitionScores.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
      requestedRepetitions,
  );

  /*
   * Calculate the deviation of successfully
   * detected repetitions.
   */
  const detectedDeviationPct =
    scoredAttempts.reduce(
      (sum, attempt) => {
        const deviation =
          Math.abs(
            attempt.detectedRatio -
              targetRatio,
          ) /
          targetRatio;

        return (
          sum +
          deviation * 100
        );
      },
      0,
    );

  /*
   * Missing repetitions count as 100% deviation.
   *
   * This makes the deviation calculation consistent
   * with the zero score assigned to missing attempts.
   */
  const averageDeviationPct =
    (
      detectedDeviationPct +
      missingRepetitions * 100
    ) /
    requestedRepetitions;

  /*
   * Passing requires BOTH:
   *
   * 1. Every requested repetition was detected.
   * 2. The average interval deviation is within
   *    the current tier's tolerance.
   */
  const allRepetitionsDetected =
    scoredAttempts.length ===
    requestedRepetitions;

  const passed =
    allRepetitionsDetected &&
    averageDeviationPct <=
      params.tolerancePct;

  return {
    score,
    passed,

    targetRatio,

    detectedRatio:
      measurement.detectedRatio,

    deviationPct:
      averageDeviationPct,

    intervalName,

    freq1:
      measurement.freq1,

    freq2:
      measurement.freq2,

    firstNoteDetected:
      measurement.hasFirstNote,

    secondNoteDetected:
      measurement.hasSecondNote,

    firstNoteClarity:
      measurement.firstNoteClarity,

    secondNoteClarity:
      measurement.secondNoteClarity,

    repetitionsCompleted:
      scoredAttempts.length,

    repetitionScores,
  };
}