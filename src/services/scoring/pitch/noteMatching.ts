import {
    NOTE_MATCHING_PARAMS,
    Tier,
} from '@/constants/exercises/pitch';

import {
    NoteMatchingMeasurement,
} from '@/services/measurement/pitch/noteMatching';

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


/**
 * Compare the detected singing pitch against
 * the target note.
 */
export function scoreNoteMatching(
  measurement: NoteMatchingMeasurement,
  targetFrequency: number,
  tier: Tier
): NoteMatchingScoreResult {

  const params =
    NOTE_MATCHING_PARAMS[tier];


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
      measurement.detectedFrequency
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
  // Calculate pitch accuracy
  // ----------------------------------------------------------

  const accuracy =
    calcPitchAccuracy(
      measurement.detectedFrequency,
      targetFrequency
    );


  const deviationPct =
    (
      Math.abs(
        measurement.detectedFrequency -
          targetFrequency
      ) /
      targetFrequency
    ) * 100;


  const safeAccuracy =
    Number.isFinite(accuracy)
      ? Math.max(
          0,
          Math.min(
            100,
            accuracy
          )
        )
      : 0;


  const passed =
    measurement.averageClarity >=
      params.minClarity &&
    deviationPct <=
      params.tolerancePct;


  return {
    score:
      Math.round(
        safeAccuracy
      ),

    passed,

    deviationPct,

    detectedFrequency:
      measurement.detectedFrequency,

    averageClarity:
      measurement.averageClarity,
  };
}