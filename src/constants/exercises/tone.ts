import {
    ResonanceBand,
    VowelBand,
} from '@/utils/dsp/spectral';

export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';

export interface VowelConsistencyParams {
  vowel: VowelBand;
  durationRangeSec: [number, number];
  repetitions: number;
  smoothnessThreshold: number;
  resonanceTypeCount: number;
}

export const VOWEL_CONSISTENCY_PARAMS: Record<
  Tier,
  VowelConsistencyParams
> = {
  beginner: {
    vowel: 'ah',
    durationRangeSec: [4, 6],
    repetitions: 2,
    smoothnessThreshold: 65,
    resonanceTypeCount: 1,
  },

  intermediate: {
    vowel: 'ee',
    durationRangeSec: [3, 5],
    repetitions: 4,
    smoothnessThreshold: 80,
    resonanceTypeCount: 2,
  },

  advanced: {
    vowel: 'oh',
    durationRangeSec: [2, 4],
    repetitions: 6,
    smoothnessThreshold: 95,
    resonanceTypeCount: 3,
  },
};

// ============================================================
// WAVEFORM SMOOTHNESS
// ============================================================

export interface WaveformSmoothnessParams {
  durationSec: number;
  repetitions: number;
  smoothnessThreshold: number;
  amplitudeVariancePct: number;
}

export const WAVEFORM_SMOOTHNESS_PARAMS: Record<
  Tier,
  WaveformSmoothnessParams
> = {
  beginner: {
    durationSec: 8,
    repetitions: 2,
    smoothnessThreshold: 65,
    amplitudeVariancePct: 10,
  },

  intermediate: {
    durationSec: 6,
    repetitions: 4,
    smoothnessThreshold: 80,
    amplitudeVariancePct: 8,
  },

  advanced: {
    durationSec: 4,
    repetitions: 6,
    smoothnessThreshold: 95,
    amplitudeVariancePct: 5,
  },
};

// ============================================================
// RESONANCE STABILIZATION
// ============================================================

export interface ResonanceStabilizationParams {
  resonanceTypes: ResonanceBand[];
  durationSec: number;
  repetitions: number;
  stabilityThreshold: number;
}

export const RESONANCE_STABILIZATION_PARAMS: Record<
  Tier,
  ResonanceStabilizationParams
> = {
  beginner: {
    resonanceTypes: ['chest'],
    durationSec: 5,
    repetitions: 2,
    stabilityThreshold: 70,
  },

  intermediate: {
    resonanceTypes: ['chest', 'head'],
    durationSec: 4,
    repetitions: 2,
    stabilityThreshold: 85,
  },

  advanced: {
    resonanceTypes: ['chest', 'head', 'mixed'],
    durationSec: 3,
    repetitions: 2,
    stabilityThreshold: 95,
  },
};

// ============================================================
// TONE CONSISTENCY
// ============================================================

export interface ToneConsistencyParams {
  intervalSec: number;
  repetitions: number;
  consistencyThreshold: number;
  variancePct: number;
}

export const TONE_CONSISTENCY_PARAMS: Record<
  Tier,
  ToneConsistencyParams
> = {
  beginner: {
    intervalSec: 4,
    repetitions: 3,
    consistencyThreshold: 65,
    variancePct: 10,
  },

  intermediate: {
    intervalSec: 3,
    repetitions: 4,
    consistencyThreshold: 80,
    variancePct: 8,
  },

  advanced: {
    intervalSec: 2,
    repetitions: 6,
    consistencyThreshold: 95,
    variancePct: 5,
  },
};

// ============================================================
// STEADY TONE HOLDING
// ============================================================

export interface SteadyToneHoldingParams {
  durationSec: number;
  repetitions: number;
  qualityThreshold: number;
  variancePct: number;
}

export const STEADY_TONE_HOLDING_PARAMS: Record<
  Tier,
  SteadyToneHoldingParams
> = {
  beginner: {
    durationSec: 6,
    repetitions: 2,
    qualityThreshold: 70,
    variancePct: 10,
  },

  intermediate: {
    durationSec: 5,
    repetitions: 4,
    qualityThreshold: 85,
    variancePct: 7,
  },

  advanced: {
    durationSec: 4,
    repetitions: 6,
    qualityThreshold: 95,
    variancePct: 5,
  },
};