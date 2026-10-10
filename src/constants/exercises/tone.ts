import { VowelBand } from '@/utils/dsp/spectral';

export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';

// vowel consistency params

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

// waveform smoothness params

export interface WaveformSmoothnessParams {
  durationSec: number;
  repetitions: number;
  smoothnessThreshold: number;
}

export const WAVEFORM_SMOOTHNESS_PARAMS: Record<
  Tier,
  WaveformSmoothnessParams
> = {
  beginner: {
    durationSec: 8,
    repetitions: 3,
    smoothnessThreshold: 65,
  },

  intermediate: {
    durationSec: 6,
    repetitions: 4,
    smoothnessThreshold: 80,
  },

  advanced: {
    durationSec: 4,
    repetitions: 5,
    smoothnessThreshold: 95,
  },
};

// frequency zone stability params

export interface FrequencyZoneStabilityParams {
  durationSec: number;
  repetitions: number;
  stabilityThreshold: number;
}

export const FREQUENCY_ZONE_STABILITY_PARAMS: Record<
  Tier,
  FrequencyZoneStabilityParams
> = {
  beginner: {
    durationSec: 5,
    repetitions: 2,
    stabilityThreshold: 70,
  },

  intermediate: {
    durationSec: 4,
    repetitions: 2,
    stabilityThreshold: 85,
  },

  advanced: {
    durationSec: 3,
    repetitions: 2,
    stabilityThreshold: 95,
  },
};

// tone consistency params
// must have what note to sing

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

// steady tone holding params
// must have what note to sing

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