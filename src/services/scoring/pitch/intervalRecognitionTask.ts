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
  const requestedRepetitions = Math.max(
    1,
    Math.round(params.repetitions),
  );

  /*
   * Invalid target ratio cannot be scored.
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

      freq1: measurement.freq1,
      freq2: measurement.freq2,

      firstNoteDetected:
        measurement.hasFirstNote,

      secondNoteDetected:
        measurement.hasSecondNote,

      firstNoteClarity:
        measurement.firstNoteClarity,

      secondNoteClarity:
        measurement.secondNoteClarity,

      repetitionsCompleted: 0,

      repetitionScores: Array(
        requestedRepetitions,
      ).fill(0),
    };
  }

  /*
   * Keep only complete, valid interval attempts.
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
   * Score at most the number requested by the tier.
   */
  const scoredAttempts =
    validAttempts.slice(
      0,
      requestedRepetitions,
    );

  /*
   * Calculate the score for every detected repetition.
   */
  const detectedScores =
    scoredAttempts.map(attempt => {
      const deviation =
        Math.abs(
          attempt.detectedRatio -
            targetRatio,
        ) / targetRatio;

      const deviationPct =
        deviation * 100;

      return Math.round(
        Math.max(
          0,
          Math.min(
            100,
            100 - deviationPct,
          ),
        ),
      );
    });

  /*
   * IMPORTANT:
   *
   * Do not automatically turn undetected repetitions
   * into zero-score repetitions.
   *
   * The measurement layer is detecting actual repetitions
   * from the user's recording. If the user performs fewer
   * repetitions than the configured maximum, score the
   * repetitions that were actually completed.
   */
  const repetitionScores =
    detectedScores.length > 0
      ? detectedScores
      : [0];

  /*
   * Score is based on the repetitions that were
   * successfully detected.
   */
  const score =
    detectedScores.length > 0
      ? Math.round(
          detectedScores.reduce(
            (sum, value) =>
              sum + value,
            0,
          ) / detectedScores.length,
        )
      : 0;

  /*
   * Calculate average deviation only from
   * successfully detected repetitions.
   */
  const detectedDeviationPct =
    scoredAttempts.length > 0
      ? scoredAttempts.reduce(
          (sum, attempt) => {
            const deviation =
              Math.abs(
                attempt.detectedRatio -
                  targetRatio,
              ) / targetRatio;

            return (
              sum +
              deviation * 100
            );
          },
          0,
        ) / scoredAttempts.length
      : 100;

  /*
   * Passing requires at least one valid repetition
   * and acceptable interval accuracy.
   *
   * Completing fewer repetitions than the tier's
   * configured maximum does not erase the score.
   */
  const passed =
    scoredAttempts.length > 0 &&
    detectedDeviationPct <=
      params.tolerancePct;

  /*
   * Use the first detected attempt for the
   * single-interval result fields.
   */
  const firstAttempt =
    scoredAttempts[0];

  return {
    score,
    passed,

    targetRatio,

    detectedRatio:
      measurement.detectedRatio,

    deviationPct:
      detectedDeviationPct,

    intervalName,

    freq1:
      firstAttempt?.freq1 ??
      measurement.freq1,

    freq2:
      firstAttempt?.freq2 ??
      measurement.freq2,

    firstNoteDetected:
      firstAttempt?.hasFirstNote ??
      measurement.hasFirstNote,

    secondNoteDetected:
      firstAttempt?.hasSecondNote ??
      measurement.hasSecondNote,

    firstNoteClarity:
      firstAttempt?.firstNoteClarity ??
      measurement.firstNoteClarity,

    secondNoteClarity:
      firstAttempt?.secondNoteClarity ??
      measurement.secondNoteClarity,

    repetitionsCompleted:
      scoredAttempts.length,

    repetitionScores,
  };
}