import type {
    SustainedNoteStabilityParams,
} from '@/constants/params';

import type {
    SustainedNoteStabilityMeasurement,
} from '@/services/measurement/pitch/sustainedNoteStability';

export interface SustainedNoteStabilityScoreResult {
  score: number;
  passed: boolean;
  stabilityCents: number;
  durationSec: number;
  pitchAccuracyCents: number;
  pitchAccuracyScore: number;
  repetitionsCompleted: number;
  repetitionScores: number[];
}

const MAX_STABILITY_CENTS = 1000;
const FULL_ACCURACY_CENTS = 25;
const ZERO_ACCURACY_CENTS = 125;

function calculatePitchAccuracyScore(
  measuredFrequencyHz: number,
  targetFrequencyHz: number,
): {
  deviationCents: number;
  accuracyScore: number;
} {
  if (
    !Number.isFinite(measuredFrequencyHz) ||
    measuredFrequencyHz <= 0 ||
    !Number.isFinite(targetFrequencyHz) ||
    targetFrequencyHz <= 0
  ) {
    return {
      deviationCents: 1200,
      accuracyScore: 0,
    };
  }

  const deviationCents = Math.abs(
    1200 * Math.log2(measuredFrequencyHz / targetFrequencyHz),
  );

  if (!Number.isFinite(deviationCents)) {
    return {
      deviationCents: 1200,
      accuracyScore: 0,
    };
  }

  const accuracyScore =
    deviationCents <= FULL_ACCURACY_CENTS
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            100 -
              ((deviationCents - FULL_ACCURACY_CENTS) /
                (ZERO_ACCURACY_CENTS - FULL_ACCURACY_CENTS)) *
                100,
          ),
        );

  return {
    deviationCents,
    accuracyScore,
  };
}

export function scoreSustainedNoteStability(
  measurement: SustainedNoteStabilityMeasurement,
  params: SustainedNoteStabilityParams,
  targetFrequencyHz: number,
): SustainedNoteStabilityScoreResult {
  const stabilityCents =
    Number.isFinite(measurement.stabilityCents)
      ? Math.max(0, measurement.stabilityCents)
      : MAX_STABILITY_CENTS;

  const durationSec =
    Number.isFinite(measurement.durationSec)
      ? Math.max(0, measurement.durationSec)
      : 0;

  const threshold = Math.max(
    1,
    params.stabilityThresholdCents,
  );

  const measuredFrequencyHz =
    Number.isFinite(measurement.medianFrequencyHz) &&
    measurement.medianFrequencyHz > 0
      ? measurement.medianFrequencyHz
      : 0;

  const {
    deviationCents: pitchAccuracyCents,
    accuracyScore: pitchAccuracyScore,
  } = calculatePitchAccuracyScore(
    measuredFrequencyHz,
    targetFrequencyHz,
  );

  const stabilityScore = Math.max(
    0,
    Math.min(
      100,
      100 - (stabilityCents / threshold) * 200,
    ),
  );

  const durationScore =
    params.durationSec > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (durationSec / (params.durationSec * 1.25)) * 100,
          ),
        )
      : 0;

  const performanceScore =
    stabilityScore * 0.8 +
    durationScore * 0.2;

  const score = Math.round(
    performanceScore * (pitchAccuracyScore / 100),
  );

  const passed =
    Number.isFinite(targetFrequencyHz) &&
    targetFrequencyHz > 0 &&
    measuredFrequencyHz > 0 &&
    pitchAccuracyScore >= 70 &&
    stabilityCents <= threshold &&
    durationSec >= params.durationSec &&
    score >= 80;

  console.log('🎵 SUSTAINED NOTE STABILITY DEBUG:', {
    targetFrequencyHz,
    measuredFrequencyHz,
    pitchAccuracyCents,
    pitchAccuracyScore,
    stabilityCents,
    threshold,
    stabilityScore,
    durationSec,
    targetDurationSec: params.durationSec,
    durationScore,
    performanceScore,
    finalScore: score,
    passed,
  });

  return {
    score,
    passed,
    stabilityCents,
    durationSec,
    pitchAccuracyCents,
    pitchAccuracyScore,
    repetitionsCompleted: 1,
    repetitionScores: [score],
  };
}

export function scoreSustainedNoteStabilityRepetitions(
  measurements: SustainedNoteStabilityMeasurement[],
  params: SustainedNoteStabilityParams,
  targetFrequencyHz: number,
): SustainedNoteStabilityScoreResult {
  const requestedRepetitions = Math.max(
    1,
    Math.round(params.repetitions),
  );

  if (measurements.length === 0) {
    return {
      score: 0,
      passed: false,
      stabilityCents: MAX_STABILITY_CENTS,
      durationSec: 0,
      pitchAccuracyCents: 1200,
      pitchAccuracyScore: 0,
      repetitionsCompleted: 0,
      repetitionScores: Array(requestedRepetitions).fill(0),
    };
  }

  const repetitionResults = measurements
    .slice(0, requestedRepetitions)
    .map(measurement =>
      scoreSustainedNoteStability(
        measurement,
        params,
        targetFrequencyHz,
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
    repetitionScores.reduce(
      (sum, repetitionScore) => sum + repetitionScore,
      0,
    ) / requestedRepetitions,
  );

  const stabilityCents =
    repetitionResults.reduce(
      (sum, result) => sum + result.stabilityCents,
      0,
    ) / repetitionResults.length;

  const durationSec =
    repetitionResults.reduce(
      (sum, result) => sum + result.durationSec,
      0,
    ) / repetitionResults.length;

  const pitchAccuracyCents =
    repetitionResults.reduce(
      (sum, result) => sum + result.pitchAccuracyCents,
      0,
    ) / repetitionResults.length;

  const pitchAccuracyScore =
    repetitionResults.reduce(
      (sum, result) => sum + result.pitchAccuracyScore,
      0,
    ) / repetitionResults.length;

  const passed =
    Number.isFinite(targetFrequencyHz) &&
    targetFrequencyHz > 0 &&
    repetitionResults.length === requestedRepetitions &&
    repetitionResults.every(result => result.passed) &&
    score >= 80;

  return {
    score,
    passed,
    stabilityCents,
    durationSec,
    pitchAccuracyCents,
    pitchAccuracyScore: Math.round(pitchAccuracyScore),
    repetitionsCompleted: repetitionResults.length,
    repetitionScores,
  };
}