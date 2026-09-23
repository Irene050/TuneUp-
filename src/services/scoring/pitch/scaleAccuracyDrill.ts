// src/services/scoring/pitch/scaleAccuracyDrill.ts

import {
    SCALE_ACCURACY_PARAMS,
    Tier,
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
  tier: Tier
): ScaleAccuracyScoreResult {

  const params =
    SCALE_ACCURACY_PARAMS[tier];

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
          detected - target
        ) / target
      ) * 100;

    const accuracy =
      calcPitchAccuracy(
        detected,
        target
      );

    const safeAccuracy =
      Number.isFinite(accuracy)
        ? Math.max(
            0,
            Math.min(100, accuracy)
          )
        : 0;

    noteScores.push(
      Math.round(safeAccuracy)
    );

    noteDeviations.push(
      deviationPct
    );

    if (
      deviationPct <=
      params.tolerancePct
    ) {
      correctNotes++;
    }
  }

  const noteAccuracy =
    (correctNotes / totalNotes) * 100;

  const transitionSmoothness =
    Number.isFinite(
      measurement.transitionSmoothness
    )
      ? Math.max(
          0,
          Math.min(
            100,
            measurement.transitionSmoothness
          )
        )
      : 0;

  /*
   * 70% = note accuracy
   * 30% = transition smoothness
   */
  const rawScore =
    noteAccuracy * 0.70 +
    transitionSmoothness * 0.30;

  const score = Math.round(
    Math.max(
      0,
      Math.min(100, rawScore)
    )
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