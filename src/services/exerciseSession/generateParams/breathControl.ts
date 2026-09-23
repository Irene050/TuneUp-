// ============================================================
// BREATH CONTROL PARAMETER GENERATORS
// ============================================================

import {
    CONTROLLED_BREATH_RELEASE_PARAMS,
    DIAPHRAGMATIC_BREATHING_PARAMS,
    STEADY_AIRFLOW_PARAMS,
    SUSTAINED_EXHALE_PARAMS,
    SUSTAINED_SSSS_PARAMS,
    type Tier,
} from '@/constants/exercises/breathControl';

import type {
    ParameterBoundsMap,
} from '@/services/adaptiveDifficultyScaling/adaptiveDifficultyScaling';


// ============================================================
// RANDOM HELPER
// ============================================================

function randomInRange(
  min: number,
  max: number
): number {
  if (max <= min) {
    return min;
  }

  return (
    min +
    Math.random() *
      (max - min)
  );
}


// ============================================================
// 1. SUSTAINED EXHALE
// ============================================================

export function generateSustainedExhaleParams(
  tier: Tier,
  biasedBounds?: ParameterBoundsMap
) {
  const base =
    SUSTAINED_EXHALE_PARAMS[tier];

  const durationMin =
    biasedBounds?.durationSec?.min ??
    base.durationRangeSec[0];

  const durationMax =
    biasedBounds?.durationSec?.max ??
    base.durationRangeSec[1];

  return {
    targetDurationSec:
      Math.round(
        randomInRange(
          durationMin,
          durationMax
        )
      ),

    pacingGuideMs:
      base.pacingGuideMs,
  };
}


// ============================================================
// 2. SUSTAINED SSSS
// ============================================================

export function generateSustainedSSSSParams(
  tier: Tier,
  biasedBounds?: ParameterBoundsMap
) {
  const base =
    SUSTAINED_SSSS_PARAMS[tier];

  const durationMin =
    biasedBounds?.durationSec?.min ??
    base.durationRangeSec[0];

  const durationMax =
    biasedBounds?.durationSec?.max ??
    base.durationRangeSec[1];

  return {
    targetDurationSec:
      Math.round(
        randomInRange(
          durationMin,
          durationMax
        )
      ),

    pacingGuideMs:
      base.pacingGuideMs,
  };
}


// ============================================================
// 3. DIAPHRAGMATIC BREATHING
// ============================================================

export function generateDiaphragmaticBreathingParams(
  tier: Tier,
  biasedBounds?: ParameterBoundsMap
) {
  const base =
    DIAPHRAGMATIC_BREATHING_PARAMS[tier];

  const dbMin =
    biasedBounds?.targetDb?.min ??
    base.targetDbRange[0];

  const dbMax =
    biasedBounds?.targetDb?.max ??
    base.targetDbRange[1];

  return {
    inhaleSec:
      base.inhaleSec,

    exhaleSec:
      base.exhaleSec,

    targetDb:
      Math.round(
        randomInRange(
          dbMin,
          dbMax
        )
      ),
  };
}


// ============================================================
// 4. STEADY AIRFLOW
// ============================================================

export function generateSteadyAirflowParams(
  tier: Tier,
  biasedBounds?: ParameterBoundsMap
) {
  const base =
    STEADY_AIRFLOW_PARAMS[tier];

  const durationMin =
    biasedBounds?.durationSec?.min ??
    base.durationSec;

  const durationMax =
    biasedBounds?.durationSec?.max ??
    base.durationSec;

  return {
    targetDurationSec:
      Math.round(
        randomInRange(
          durationMin,
          durationMax
        )
      ),
  };
}


// ============================================================
// 5. CONTROLLED BREATH RELEASE
// ============================================================

export function generateControlledBreathReleaseParams(
  tier: Tier,
  biasedBounds?: ParameterBoundsMap
) {
  const base =
    CONTROLLED_BREATH_RELEASE_PARAMS[tier];

  /*
   * Smaller intervals mean faster
   * pulse transitions.
   *
   * Without ADS:
   * ±10% random variation.
   *
   * With ADS:
   * use the adjusted interval bounds.
   */
  const defaultMin =
    base.intervalSec * 0.9;

  const defaultMax =
    base.intervalSec * 1.1;

  const intervalMin =
    biasedBounds?.intervalSec?.min ??
    defaultMin;

  const intervalMax =
    biasedBounds?.intervalSec?.max ??
    defaultMax;

  return {
    pulseCount:
      base.pulseCount,

    targetIntervalSec:
      Number(
        randomInRange(
          intervalMin,
          intervalMax
        ).toFixed(2)
      ),
  };
}