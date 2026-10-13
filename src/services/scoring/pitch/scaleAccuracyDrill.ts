
import type {
  ScaleAccuracyParams,
} from '@/constants/exercises/pitch';

import {
  ScaleAccuracyMeasurement,
} from '@/services/measurement/pitch/scaleAccuracyDrill';

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
  const targetFreqs = measurement.targetFreqs;
  const detectedFreqs = measurement.detectedFreqs;
  const totalNotes = targetFreqs.length;

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
    const detected = detectedFreqs[i] ?? 0;
    const target = targetFreqs[i];

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
      (Math.abs(detected - target) / target) * 100;

    noteDeviations.push(deviationPct);

    // Score every valid note based on deviation.
    // 0% deviation = 100, 5% = 50, 10% or more = 0.
    const noteScore = Math.max(
      0,
      Math.min(100, 100 - deviationPct * 30),
    );

    noteScores.push(Math.round(noteScore));

    // Only notes within the configured tolerance count as correct.
    if (deviationPct <= params.tolerancePct) {
      correctNotes++;
    }
  }

  // Missing and inaccurate notes remain in the average.
  const noteAccuracy =
    noteScores.reduce((sum, value) => sum + value, 0) /
    totalNotes;

  const transitionSmoothness =
    Number.isFinite(measurement.transitionSmoothness)
      ? Math.max(
          0,
          Math.min(100, measurement.transitionSmoothness),
        )
      : 0;

  // Note accuracy dominates the score.
  const rawScore =
    noteAccuracy * 0.95 +
    transitionSmoothness * 0.05;

  const score = Math.round(
    Math.max(0, Math.min(100, rawScore)),
  );

  const correctNoteRate = correctNotes / totalNotes;

  const voicedNoteRate =
    Number.isFinite(measurement.voicedNotes)
      ? Math.max(0, measurement.voicedNotes) / totalNotes
      : 0;

  const passed =
    noteAccuracy >= Math.max(params.scaleAccuracyThreshold, 85) &&
    correctNoteRate >= 0.80 &&
    voicedNoteRate >= 0.80 &&
    score >= 85;

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
    averageClarity: measurement.averageClarity,
    voicedNotes: measurement.voicedNotes,
  };
}