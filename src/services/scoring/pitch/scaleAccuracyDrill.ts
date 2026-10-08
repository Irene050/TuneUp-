import type {
  ScaleAccuracyParams,
} from '@/constants/exercises/pitch';

import {
  ScaleAccuracyMeasurement,
} from '@/services/measurement/pitch/scaleAccuracyDrill';

import {
  calcPitchAccuracy,
} from '@/utils/dsp/pitch';

export interface ScaleAccuracyScoreResult {
  score: number;
  passed: boolean;

  noteAccuracy: number;
  transitionSmoothness: number;

  correctNotes: number;
  totalNotes: number;

  detectedFreqs: number[];
  targetFreqs: number[];

  noteScores: number[];
  noteDeviations: number[];

  averageClarity: number;
  voicedNotes: number;
}

export function scoreScaleAccuracyDrill(
  measurement: ScaleAccuracyMeasurement,
  params: ScaleAccuracyParams,
): ScaleAccuracyScoreResult {
  const targetFreqs =
    measurement.targetFreqs;

  const detectedFreqs =
    measurement.detectedFreqs;

  const totalNotes =
    targetFreqs.length;

  if (totalNotes === 0) {
    return {
      score: 0,
      passed: false,
      noteAccuracy: 0,
      transitionSmoothness: 0,
      correctNotes: 0,
      totalNotes: 0,
      detectedFreqs: [],
      targetFreqs: [],
      noteScores: [],
      noteDeviations: [],
      averageClarity: 0,
      voicedNotes: 0,
    };
  }

  const noteScores: number[] = [];
  const noteDeviations: number[] = [];

  let correctNotes = 0;

  for (let i = 0; i < totalNotes; i++) {
    const detected =
      detectedFreqs[i] ?? 0;

    const target =
      targetFreqs[i];

    if (
      !Number.isFinite(detected) ||
      detected <= 0 ||
      !Number.isFinite(target) ||
      target <= 0
    ) {
      noteScores.push(0);
      noteDeviations.push(100);
      continue;
    }

    const deviationPct =
      (
        Math.abs(
          detected - target,
        ) / target
      ) * 100;

    noteDeviations.push(
      deviationPct,
    );

    const isMatch =
      deviationPct <=
      params.tolerancePct;

    if (!isMatch) {
      noteScores.push(0);
      continue;
    }

    const accuracy =
      calcPitchAccuracy(
        detected,
        target,
      );

    const safeAccuracy =
      Number.isFinite(accuracy)
        ? Math.max(
            0,
            Math.min(
              100,
              accuracy,
            ),
          )
        : 0;

    noteScores.push(
      Math.round(
        safeAccuracy,
      ),
    );

    correctNotes++;
  }

const noteAccuracy =
  totalNotes > 0
    ? noteScores.reduce(
        (sum, value) =>
          sum + value,
        0,
      ) / totalNotes
    : 0;

  const transitionSmoothness =
    Number.isFinite(
      measurement.transitionSmoothness,
    )
      ? Math.max(
          0,
          Math.min(
            100,
            measurement.transitionSmoothness,
          ),
        )
      : 0;

  const rawScore =
    noteAccuracy * 0.70 +
    transitionSmoothness * 0.30;

  const score = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        rawScore,
      ),
    ),
  );

  const passed =
    noteAccuracy >=
      params.scaleAccuracyThreshold &&
    measurement.voicedNotes > 0;

  return {
    score,
    passed,
    noteAccuracy,
    transitionSmoothness,
    correctNotes,
    totalNotes,
    detectedFreqs,
    targetFreqs,
    noteScores,
    noteDeviations,
    averageClarity:
      measurement.averageClarity,
    voicedNotes:
      measurement.voicedNotes,
  };
}