// ============================================================
// BREATH CONTROL EXERCISE CONSTANTS
// ============================================================

export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';


// ============================================================
// 1. SUSTAINED EXHALE
// ============================================================

export interface SustainedExhaleParams {
  durationRangeSec: [number, number];
  pacingGuideMs: number;
  repetitions: number;
  consistencyThreshold: number;
  detectionThreshold: number;
}

export const SUSTAINED_EXHALE_PARAMS: Record<
  Tier,
  SustainedExhaleParams
> = {
  beginner: {
    durationRangeSec: [10, 12],
    pacingGuideMs: 1500,
    repetitions: 3,
    consistencyThreshold: 60,
    detectionThreshold: 0.02,
  },

  intermediate: {
    durationRangeSec: [12, 24],
    pacingGuideMs: 1000,
    repetitions: 4,
    consistencyThreshold: 75,
    detectionThreshold: 0.02,
  },

  advanced: {
    durationRangeSec: [24, 32],
    pacingGuideMs: 625,
    repetitions: 6,
    consistencyThreshold: 90,
    detectionThreshold: 0.02,
  },
};


// ============================================================
// 2. SUSTAINED "SSSS" SOUND
// ============================================================

/*
 * Sustained "SSSS" uses the same tier parameters
 * as Sustained Exhale.
 */

export const SUSTAINED_SSSS_PARAMS =
  SUSTAINED_EXHALE_PARAMS;


// ============================================================
// 3. DIAPHRAGMATIC BREATHING
// ============================================================

export interface DiaphragmaticBreathingParams {
  inhaleSec: number;
  exhaleSec: number;
  repetitions: number;
  consistencyThreshold: number;
  targetDbRange: [number, number];
  detectionThreshold: number;
}

export const DIAPHRAGMATIC_BREATHING_PARAMS: Record<
  Tier,
  DiaphragmaticBreathingParams
> = {
  beginner: {
    inhaleSec: 5,
    exhaleSec: 10,
    repetitions: 2,
    consistencyThreshold: 60,
    targetDbRange: [40, 50],
    detectionThreshold: 0.02,
  },

  intermediate: {
    inhaleSec: 3,
    exhaleSec: 15,
    repetitions: 3,
    consistencyThreshold: 75,
    targetDbRange: [45, 55],
    detectionThreshold: 0.02,
  },

  advanced: {
    inhaleSec: 2,
    exhaleSec: 25,
    repetitions: 4,
    consistencyThreshold: 90,
    targetDbRange: [50, 60],
    detectionThreshold: 0.02,
  },
};

// ============================================================
// 4. STEADY AIRFLOW MAINTENANCE
// ============================================================

export interface SteadyAirflowParams {
  durationSec: number;
  repetitions: number;
  stabilityThreshold: number;
  amplitudeTolerancePct: number;
  detectionThreshold: number;
}

export const STEADY_AIRFLOW_PARAMS: Record<
  Tier,
  SteadyAirflowParams
> = {
  beginner: {
    durationSec: 12,
    repetitions: 2,
    stabilityThreshold: 65,
    amplitudeTolerancePct: 15,
    detectionThreshold: 0.02,
  },

  intermediate: {
    durationSec: 18,
    repetitions: 3,
    stabilityThreshold: 80,
    amplitudeTolerancePct: 12,
    detectionThreshold: 0.02,
  },

  advanced: {
    durationSec: 25,
    repetitions: 4,
    stabilityThreshold: 95,
    amplitudeTolerancePct: 10,
    detectionThreshold: 0.02,
  },
};

// ============================================================
// 5. CONTROLLED BREATH RELEASE
// ============================================================

export interface ControlledBreathReleaseParams {
  pulseCount: number;
  intervalSec: number;
  repetitions: number;
  pulseConsistencyThreshold: number;
  amplitudeVariancePct: number;
}

export const CONTROLLED_BREATH_RELEASE_PARAMS: Record<
  Tier,
  ControlledBreathReleaseParams
> = {
  beginner: {
    pulseCount: 6,
    intervalSec: 2,
    repetitions: 2,
    pulseConsistencyThreshold: 60,
    amplitudeVariancePct: 20,
  },

  intermediate: {
    pulseCount: 8,
    intervalSec: 1.5,
    repetitions: 3,
    pulseConsistencyThreshold: 75,
    amplitudeVariancePct: 15,
  },

  advanced: {
    pulseCount: 10,
    intervalSec: 1,
    repetitions: 4,
    pulseConsistencyThreshold: 90,
    amplitudeVariancePct: 10,
  },
};