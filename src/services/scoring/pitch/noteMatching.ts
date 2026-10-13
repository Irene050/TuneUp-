import type { NoteMatchingParams } from '@/constants/exercises/pitch';

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
  // ----------------------------------------------------------
  // Invalid target
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // No reliable pitch detected
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // Clarity requirement
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // Evaluate every voiced frame
  // ----------------------------------------------------------
  //
  // Correct voiced frames receive their pitch accuracy.
  // Wrong voiced frames receive zero.
  //
  // Silence is not included because filterByClarity()
  // already removes unvoiced frames.
  // ----------------------------------------------------------

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

    // Wrong note contributes zero.
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

  // ----------------------------------------------------------
  // No valid voiced frames
  // ----------------------------------------------------------

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
  
  // ----------------------------------------------------------
  // Strict pitch accuracy
  // ----------------------------------------------------------

  const matchRate =
    matchingFrames / validVoicedFrames;

  let totalDeviationPct = 0;

  for (const frequency of measurement.frequencies) {
    if (
      !Number.isFinite(frequency) ||
      frequency <= 0
    ) {
      continue;
    }

    totalDeviationPct +=
      (Math.abs(frequency - targetFrequency) /
        targetFrequency) * 100;
  }

  const averageDeviationPct =
    totalDeviationPct / validVoicedFrames;

  // Stricter curve:
  // 0% deviation = 100
  // 1% deviation = 60
  // 2% deviation = 20
  // 2.5% or more = 0
  const deviationScore = Math.max(
    0,
    Math.min(100, 100 - averageDeviationPct * 40),
  );

  // Penalize frames that do not match the target.
  const safeAccuracy =
    deviationScore * matchRate;

  const deviationPct =
    (Math.abs(
      measurement.detectedFrequency - targetFrequency,
    ) / targetFrequency) * 100;

  const score = Math.round(
    Math.max(0, Math.min(100, safeAccuracy)),
  );

  const passed =
    matchRate >= 0.90 &&
    averageDeviationPct <= 0.5 &&
    score >= 85;

  console.log('🎵 NOTE MATCHING SCORE DEBUG:', {
    targetFrequency,
    detectedFrequency: measurement.detectedFrequency,
    averageDeviationPct,
    matchRate,
    deviationScore,
    finalScore: score,
    passed,
  });

  return {
    score,
    passed,
    deviationPct,
    detectedFrequency: measurement.detectedFrequency,
    averageClarity: measurement.averageClarity,
  };
}