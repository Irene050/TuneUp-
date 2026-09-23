import {
    SUSTAINED_NOTE_STABILITY_PARAMS,
    Tier,
} from '@/constants/exercises/pitch';

import {
    SustainedNoteStabilityMeasurement,
} from '@/services/measurement/pitch/sustainedNoteStability';

export interface SustainedNoteStabilityScoreResult {
  score: number;
  passed: boolean;
  stabilityCents: number;
  durationSec: number;
}

export function scoreSustainedNoteStability(
  measurement: SustainedNoteStabilityMeasurement,
  tier: Tier
): SustainedNoteStabilityScoreResult {
  const params =
    SUSTAINED_NOTE_STABILITY_PARAMS[tier];

  const stabilityRatio =
    measurement.stabilityCents /
    params.stabilityThresholdCents;

  const stabilityScore = Math.max(
    0,
    Math.min(
      100,
      100 - stabilityRatio * 100
    )
  );

  const durationRatio =
    measurement.durationSec /
    params.durationSec;

  const durationScore = Math.max(
    0,
    Math.min(100, durationRatio * 100)
  );

  const score = Math.round(
    stabilityScore * 0.6 +
      durationScore * 0.4
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
  };
}