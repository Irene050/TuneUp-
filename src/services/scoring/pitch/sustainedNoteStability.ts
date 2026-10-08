import type {
  SustainedNoteStabilityParams,
} from '@/constants/exercises/pitch';

import type {
  SustainedNoteStabilityMeasurement,
} from '@/services/measurement/pitch/sustainedNoteStability';

export interface SustainedNoteStabilityScoreResult {
  score: number;
  passed: boolean;
  stabilityCents: number;
  durationSec: number;
  repetitionsCompleted: number;
  repetitionScores: number[];
}

export function scoreSustainedNoteStability(
  measurement: SustainedNoteStabilityMeasurement,
  params: SustainedNoteStabilityParams,
): SustainedNoteStabilityScoreResult {
  const stabilityRatio =
    measurement.stabilityCents /
    params.stabilityThresholdCents;

  const stabilityScore = Math.max(
    0,
    Math.min(
      100,
      100 - stabilityRatio * 100,
    ),
  );

  const durationRatio =
    measurement.durationSec /
    params.durationSec;

  const durationScore = Math.max(
    0,
    Math.min(
      100,
      durationRatio * 100,
    ),
  );

const score = Math.round(
  stabilityScore * 0.7 +
    durationScore * 0.3,
);

  const passed =
    measurement.stabilityCents <=
      params.stabilityThresholdCents &&
    measurement.durationSec >=
      params.durationSec;

  return {
    score,
    passed,
    stabilityCents:
      measurement.stabilityCents,
    durationSec:
      measurement.durationSec,
    repetitionsCompleted: 1,
    repetitionScores: [score],
  };
}

export function scoreSustainedNoteStabilityRepetitions(
  measurements: SustainedNoteStabilityMeasurement[],
  params: SustainedNoteStabilityParams,
): SustainedNoteStabilityScoreResult {
  if (measurements.length === 0) {
    return {
      score: 0,
      passed: false,
      stabilityCents: 1000,
      durationSec: 0,
      repetitionsCompleted: 0,
      repetitionScores: [],
    };
  }

  const repetitionResults =
    measurements.map(
      measurement =>
        scoreSustainedNoteStability(
          measurement,
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

const score = Math.round(
  completedScores.reduce(
    (sum, repetitionScore) =>
      sum + repetitionScore,
    0,
  ) /
    completedScores.length,
);

  const stabilityCents =
    measurements.reduce(
      (sum, measurement) =>
        sum +
        measurement.stabilityCents,
      0,
    ) /
    measurements.length;

  const durationSec =
    measurements.reduce(
      (sum, measurement) =>
        sum + measurement.durationSec,
      0,
    ) /
    measurements.length;

  const passed =
    repetitionResults.every(
      repetition =>
        repetition.passed,
    );

  return {
    score,
    passed,
    stabilityCents,
    durationSec,
    repetitionsCompleted:
      measurements.length,
    repetitionScores,
  };
}