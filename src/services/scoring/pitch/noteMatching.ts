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
  // Match consistency
  // ----------------------------------------------------------
  //
  // Wrong sung notes remain part of the denominator.
  // This prevents a median or a few correct frames from
  // hiding incorrect sung notes.
  // ----------------------------------------------------------

  const matchRate =
    matchingFrames /
    validVoicedFrames;

  const averageMatchingAccuracy =
    totalAccuracy /
    matchingFrames;

  const sustainedAccuracy =
    averageMatchingAccuracy *
    matchRate;

  const safeAccuracy =
    Number.isFinite(
      sustainedAccuracy,
    )
      ? Math.max(
          0,
          Math.min(
            100,
            sustainedAccuracy,
          ),
        )
      : 0;

  // ----------------------------------------------------------
  // Overall representative deviation
  // ----------------------------------------------------------

  const deviationPct =
    (
      Math.abs(
        measurement.detectedFrequency -
          targetFrequency,
      ) /
      targetFrequency
    ) * 100;

  // ----------------------------------------------------------
  // Pass requirement
  // ----------------------------------------------------------
  //
  // Require the majority of sung frames to match the
  // target. Silence does not count as a wrong note.
  // ----------------------------------------------------------

  const passed =
    matchRate >= 0.75 &&
    safeAccuracy >= 75;

  return {
    score: Math.round(
      safeAccuracy,
    ),
    passed,
    deviationPct,
    detectedFrequency:
      measurement.detectedFrequency,
    averageClarity:
      measurement.averageClarity,
  };
}