import type { NoteMatchingParams } from '@/constants/pitch';

import type { NoteMatchingMeasurement } from '@/services/measurement/pitch/noteMatching';

import {
  calcPitchAccuracy,
} from '@/utils/dsp/pitch';

export interface NoteMatchingScoreResult {
  score: number;
  passed: boolean;
  deviationPct: number;
  detectedFrequency: number;
  averageClarity: number;
}

export function scoreNoteMatching(
  measurement: NoteMatchingMeasurement,
  targetFrequency: number,
  params: NoteMatchingParams,
): NoteMatchingScoreResult {

  if (
    !Number.isFinite(targetFrequency) ||
    targetFrequency <= 0
  ) {
    return {
      score: 0,
      passed: false,
      deviationPct: 100,
      detectedFrequency:
        measurement.detectedFrequency,
      averageClarity:
        measurement.averageClarity,
    };
  }

  if (
    !Number.isFinite(
      measurement.detectedFrequency,
    ) ||
    measurement.detectedFrequency <= 0 ||
    measurement.voicedFrames <
      params.minVoicedFrames
  ) {
    return {
      score: 0,
      passed: false,
      deviationPct: 100,
      detectedFrequency: 0,
      averageClarity:
        measurement.averageClarity,
    };
  }

  const hasSufficientClarity =
    Number.isFinite(
      measurement.averageClarity,
    ) &&
    measurement.averageClarity >=
      params.minClarity;

  if (!hasSufficientClarity) {
    const deviationPct =
      (
        Math.abs(
          measurement.detectedFrequency -
            targetFrequency,
        ) /
        targetFrequency
      ) * 100;

    return {
      score: 0,
      passed: false,
      deviationPct,
      detectedFrequency:
        measurement.detectedFrequency,
      averageClarity:
        measurement.averageClarity,
    };
  }

  let totalAccuracy = 0;
  let matchingFrames = 0;
  let validVoicedFrames = 0;

  let closestDeviationPct =
    Number.POSITIVE_INFINITY;

  for (
    const frequency
    of measurement.frequencies
  ) {
    if (
      !Number.isFinite(frequency) ||
      frequency <= 0
    ) {
      continue;
    }

    validVoicedFrames++;

    const deviationPct =
      (
        Math.abs(
          frequency -
            targetFrequency,
        ) /
        targetFrequency
      ) * 100;

    if (
      deviationPct <
      closestDeviationPct
    ) {
      closestDeviationPct =
        deviationPct;
    }

    if (
      deviationPct >
      params.tolerancePct
    ) {
      continue;
    }

    const accuracy =
      calcPitchAccuracy(
        frequency,
        targetFrequency,
      );

    if (
      !Number.isFinite(accuracy)
    ) {
      continue;
    }

    totalAccuracy +=
      Math.max(
        0,
        Math.min(
          100,
          accuracy,
        ),
      );

    matchingFrames++;
  }

  if (
    validVoicedFrames === 0 ||
    matchingFrames === 0
  ) {
    const deviationPct =
      Number.isFinite(
        closestDeviationPct,
      )
        ? closestDeviationPct
        : 100;

    return {
      score: 0,
      passed: false,
      deviationPct,
      detectedFrequency:
        measurement.detectedFrequency,
      averageClarity:
        measurement.averageClarity,
    };
  }

  const matchRate =
    matchingFrames / validVoicedFrames;

  const averageMatchingAccuracy =
    totalAccuracy / matchingFrames;

  const sustainedAccuracy =
    averageMatchingAccuracy * matchRate;

  const safeAccuracy =
    Number.isFinite(sustainedAccuracy)
      ? Math.max(0, Math.min(100, sustainedAccuracy))
      : 0;

  const deviationPct =
    (Math.abs(
      measurement.detectedFrequency - targetFrequency,
    ) / targetFrequency) * 100;

  const passed =
    matchRate >= 0.90 &&
    safeAccuracy >= 85;

  return {
    score: Math.round(safeAccuracy),
    passed,
    deviationPct,
    detectedFrequency: measurement.detectedFrequency,
    averageClarity: measurement.averageClarity,
  };

}