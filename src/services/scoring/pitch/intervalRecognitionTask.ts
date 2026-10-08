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
   * Score each detected interval.
   *
   * An interval must first be within the configured
   * tolerance before it can receive pitch accuracy.
   */
  const repetitionScores =
    scoredAttempts.length > 0
      ? scoredAttempts.map(attempt => {
          const deviationPct =
            (
              Math.abs(
                attempt.detectedRatio -
                  targetRatio,
              ) /
              targetRatio
            ) * 100;

          if (
            deviationPct >
            params.tolerancePct
          ) {
            return 0;
          }

          return Math.round(
            Math.max(
              0,
              Math.min(
                100,
                100 - deviationPct,
              ),
            ),
          );
        })
      : [0];

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
  completedScores.length > 0
    ? Math.round(
        completedScores.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) / completedScores.length,
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
            const deviationPct =
              (
                Math.abs(
                  attempt.detectedRatio -
                    targetRatio,
                ) /
                targetRatio
              ) * 100;

            return (
              sum +
              deviationPct
            );
          },
          0,
        ) / scoredAttempts.length
      : 100;

  /*
   * Every detected repetition must match the
   * target interval within the configured tolerance.
   *
   * Completing fewer repetitions than the tier's
   * configured maximum does not erase the score.
   */
  const passed =
    scoredAttempts.length > 0 &&
    scoredAttempts.every(
      attempt => {
        const deviationPct =
          (
            Math.abs(
              attempt.detectedRatio -
                targetRatio,
            ) /
            targetRatio
          ) * 100;

        return (
          deviationPct <=
          params.tolerancePct
        );
      },
    );

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