
import type { IntervalRecognitionParams } from '@/constants/exercises/pitch';
import type { IntervalRecognitionMeasurement } from '@/services/measurement/pitch/intervalRecognitionTask';

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

  if (!Number.isFinite(targetRatio) || targetRatio <= 0) {
    return {
      score: 0,
      passed: false,
      targetRatio,
      detectedRatio: 0,
      deviationPct: 100,
      intervalName,
      freq1: measurement.freq1,
      freq2: measurement.freq2,
      firstNoteDetected: measurement.hasFirstNote,
      secondNoteDetected: measurement.hasSecondNote,
      firstNoteClarity: measurement.firstNoteClarity,
      secondNoteClarity: measurement.secondNoteClarity,
      repetitionsCompleted: 0,
      repetitionScores: Array(requestedRepetitions).fill(0),
    };
  }

  const validAttempts = measurement.attempts
    .filter(
      attempt =>
        attempt.hasFirstNote &&
        attempt.hasSecondNote &&
        Number.isFinite(attempt.detectedRatio) &&
        attempt.detectedRatio > 0,
    )
    .slice(0, requestedRepetitions);

  const scoredAttemptResults = validAttempts.map(attempt => {
    const deviationPct =
      (Math.abs(attempt.detectedRatio - targetRatio) /
        targetRatio) *
      100;

    // Stricter curve:
    // 0% deviation = 100
    // 1% deviation = 60
    // 2% deviation = 20
    // 2.5% or more = 0
    const accuracyScore = Math.max(
      0,
      Math.min(100, 100 - deviationPct * 40),
    );

    // An attempt outside the configured tolerance receives zero.
    const score =
      deviationPct <= params.tolerancePct
        ? Math.round(accuracyScore)
        : 0;

    return { attempt, deviationPct, score };
  });

  const repetitionScores = [
    ...scoredAttemptResults.map(result => result.score),
    ...Array(
      Math.max(
        0,
        requestedRepetitions - scoredAttemptResults.length,
      ),
    ).fill(0),
  ];

  // Missing repetitions count as zero.
  const score = Math.round(
    repetitionScores.reduce((sum, value) => sum + value, 0) /
      requestedRepetitions,
  );

  const detectedDeviationPct =
    scoredAttemptResults.length > 0
      ? scoredAttemptResults.reduce(
          (sum, result) => sum + result.deviationPct,
          0,
        ) / scoredAttemptResults.length
      : 100;

  // All requested repetitions must be detected and accurate.
  const passed =
    scoredAttemptResults.length === requestedRepetitions &&
    scoredAttemptResults.every(
      result =>
        result.deviationPct <= params.tolerancePct &&
        result.score >= 85,
    ) &&
    score >= 85;

  const firstAttempt = validAttempts[0];

  console.log('🎵 INTERVAL RECOGNITION SCORE DEBUG:', {
    targetRatio,
    detectedRatios: validAttempts.map(a => a.detectedRatio),
    deviationsPct: scoredAttemptResults.map(r => r.deviationPct),
    repetitionScores,
    requestedRepetitions,
    repetitionsCompleted: validAttempts.length,
    finalScore: score,
    passed,
  });

  return {
    score,
    passed,
    targetRatio,
    detectedRatio: firstAttempt?.detectedRatio ?? measurement.detectedRatio,
    deviationPct: detectedDeviationPct,
    intervalName,
    freq1: firstAttempt?.freq1 ?? measurement.freq1,
    freq2: firstAttempt?.freq2 ?? measurement.freq2,
    firstNoteDetected:
      firstAttempt?.hasFirstNote ?? measurement.hasFirstNote,
    secondNoteDetected:
      firstAttempt?.hasSecondNote ?? measurement.hasSecondNote,
    firstNoteClarity:
      firstAttempt?.firstNoteClarity ?? measurement.firstNoteClarity,
    secondNoteClarity:
      firstAttempt?.secondNoteClarity ?? measurement.secondNoteClarity,
    repetitionsCompleted: validAttempts.length,
    repetitionScores,
  };
}
