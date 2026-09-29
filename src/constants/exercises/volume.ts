// ============================================================
// VOLUME EXERCISE CONSTANTS
// ============================================================

export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';

// ============================================================
// 1. DYNAMIC RANGE EXERCISE
// ============================================================

export interface DynamicRangeParams {
  durationSec: number;
  repetitions: number;
  targetDbRange: [number, number];
  rangeAccuracyThreshold: number;
  rampConsistencyThreshold: number;
}

export const DYNAMIC_RANGE_PARAMS: Record<
  Tier,
  DynamicRangeParams
> = {
  beginner: {
    durationSec: 8,
    repetitions: 2,
    targetDbRange: [35, 45],
    rangeAccuracyThreshold: 65,
    rampConsistencyThreshold: 55,
  },

  intermediate: {
    durationSec: 10,
    repetitions: 2,
    targetDbRange: [38, 50],
    rangeAccuracyThreshold: 75,
    rampConsistencyThreshold: 70,
  },

  advanced: {
    durationSec: 12,
    repetitions: 3,
    targetDbRange: [40, 55],
    rangeAccuracyThreshold: 85,
    rampConsistencyThreshold: 80,
  },
};

// ============================================================
// 2. CONTROLLED CRESCENDO DRILL
// ============================================================

export interface ControlledCrescendoParams {
  durationSec: number;
  repetitions: number;
  targetDbRange: [number, number];
  smoothnessThreshold: number;
  volumeIncreaseThreshold: number;
}

export const CONTROLLED_CRESCENDO_PARAMS: Record<
  Tier,
  ControlledCrescendoParams
> = {
  beginner: {
    durationSec: 4,
    repetitions: 2,
    targetDbRange: [35, 45],
    smoothnessThreshold: 60,
    volumeIncreaseThreshold: 10,
  },

  intermediate: {
    durationSec: 5,
    repetitions: 2,
    targetDbRange: [40, 50],
    smoothnessThreshold: 75,
    volumeIncreaseThreshold: 12,
  },

  advanced: {
    durationSec: 6,
    repetitions: 3,
    targetDbRange: [40, 55],
    smoothnessThreshold: 88,
    volumeIncreaseThreshold: 15,
  },
};

// ============================================================
// 3. CONTROLLED DECRESCENDO DRILL
// ============================================================

export interface ControlledDecrescendoParams {
  durationSec: number;
  repetitions: number;
  targetDbRange: [number, number];
  smoothnessThreshold: number;
  volumeDecreaseThreshold: number;
}

export const CONTROLLED_DECRESCENDO_PARAMS: Record<
  Tier,
  ControlledDecrescendoParams
> = {
  beginner: {
    durationSec: 4,
    repetitions: 2,
    targetDbRange: [35, 45],
    smoothnessThreshold: 60,
    volumeDecreaseThreshold: 10,
  },

  intermediate: {
    durationSec: 5,
    repetitions: 2,
    targetDbRange: [40, 50],
    smoothnessThreshold: 75,
    volumeDecreaseThreshold: 12,
  },

  advanced: {
    durationSec: 6,
    repetitions: 3,
    targetDbRange: [40, 55],
    smoothnessThreshold: 88,
    volumeDecreaseThreshold: 15,
  },
};

// ============================================================
// 4. VOLUME BAND TARGETING
// ============================================================

export interface VolumeBandTargetingParams {
  durationSec: number;
  repetitions: number;
  targetDbRange: [number, number];
  toleranceDb: number;
  consistencyThreshold: number;
}

export const VOLUME_BAND_TARGETING_PARAMS: Record<
  Tier,
  VolumeBandTargetingParams
> = {
  beginner: {
    durationSec: 3,
    repetitions: 2,
    targetDbRange: [35, 45],
    toleranceDb: 5,
    consistencyThreshold: 65,
  },

  intermediate: {
    durationSec: 4,
    repetitions: 2,
    targetDbRange: [40, 50],
    toleranceDb: 4,
    consistencyThreshold: 75,
  },

  advanced: {
    durationSec: 5,
    repetitions: 3,
    targetDbRange: [40, 55],
    toleranceDb: 3,
    consistencyThreshold: 85,
  },
};

// ============================================================
// 5. VOLUME CONTROL STABILITY
// ============================================================

export interface VolumeControlStabilityParams {
  durationSec: number;
  repetitions: number;
  targetDbRange: [number, number];
  stabilityThreshold: number;
  amplitudeVariancePct: number;
  detectionThreshold: number;
}

export const VOLUME_CONTROL_STABILITY_PARAMS: Record<
  Tier,
  VolumeControlStabilityParams
> = {
  beginner: {
    durationSec: 5,
    repetitions: 2,
    targetDbRange: [35, 45],
    stabilityThreshold: 65,
    amplitudeVariancePct: 12,
    detectionThreshold: 0.02,
  },

  intermediate: {
    durationSec: 6,
    repetitions: 2,
    targetDbRange: [40, 50],
    stabilityThreshold: 75,
    amplitudeVariancePct: 10,
    detectionThreshold: 0.02,
  },

  advanced: {
    durationSec: 8,
    repetitions: 3,
    targetDbRange: [40, 55],
    stabilityThreshold: 88,
    amplitudeVariancePct: 8,
    detectionThreshold: 0.02,
  },
};
