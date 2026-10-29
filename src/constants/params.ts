import { VowelBand } from '@/utils/dsp/spectral';

export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';

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
    repetitions: 5,
    consistencyThreshold: 90,
    detectionThreshold: 0.02,
  },
};

export const SUSTAINED_SSSS_PARAMS =
  SUSTAINED_EXHALE_PARAMS;

export interface DiaphragmaticBreathingParams {
  inhaleSec: number;
  exhaleSec: number;
  repetitions: number;
  consistencyThreshold: number;
  detectionThreshold: number;
}

export const DIAPHRAGMATIC_BREATHING_PARAMS: Record<
  Tier,
  DiaphragmaticBreathingParams
> = {
  beginner: {
    inhaleSec: 5,
    exhaleSec: 10,
    repetitions: 3,
    consistencyThreshold: 60,
    detectionThreshold: 0.02,
  },

  intermediate: {
    inhaleSec: 3,
    exhaleSec: 15,
    repetitions: 4,
    consistencyThreshold: 75,
    detectionThreshold: 0.02,
  },

  advanced: {
    inhaleSec: 2,
    exhaleSec: 20,
    repetitions: 5,
    consistencyThreshold: 90,
    detectionThreshold: 0.02,
  },
};

export interface SteadyAirflowParams {
  durationSec: number;
  repetitions: number;
  stabilityThreshold: number;
  detectionThreshold: number;
}

export const STEADY_AIRFLOW_PARAMS: Record<
  Tier,
  SteadyAirflowParams
> = {
  beginner: {
    durationSec: 12,
    repetitions: 3,
    stabilityThreshold: 65,
    detectionThreshold: 0.02,
  },

  intermediate: {
    durationSec: 18,
    repetitions: 4,
    stabilityThreshold: 80,
    detectionThreshold: 0.02,
  },

  advanced: {
    durationSec: 25,
    repetitions: 5,
    stabilityThreshold: 95,
    detectionThreshold: 0.02,
  },
};

export interface ControlledBreathReleaseParams {
  pulseCount: number;
  intervalSec: number;
  repetitions: number;
  pulseConsistencyThreshold: number;
}

export const CONTROLLED_BREATH_RELEASE_PARAMS: Record<
  Tier,
  ControlledBreathReleaseParams
> = {
  beginner: {
    pulseCount: 6,
    intervalSec: 2,
    repetitions: 3,
    pulseConsistencyThreshold: 60,
  },

  intermediate: {
    pulseCount: 8,
    intervalSec: 1.5,
    repetitions: 4,
    pulseConsistencyThreshold: 75,
  },

  advanced: {
    pulseCount: 10,
    intervalSec: 1,
    repetitions: 5,
    pulseConsistencyThreshold: 90,
  },
};

export interface NoteMatchingParams {
  tolerancePct: number;
  minClarity: number;
  minVoicedFrames: number;
  repetitions: number;
}

export const NOTE_MATCHING_PARAMS: Record<
  Tier,
  NoteMatchingParams
> = {
  beginner: {
    tolerancePct: 5,
    minClarity: 0.70,
    minVoicedFrames: 3,
    repetitions: 3,
  },

  intermediate: {
    tolerancePct: 3,
    minClarity: 0.75,
    minVoicedFrames: 4,
    repetitions: 4,
  },

  advanced: {
    tolerancePct: 2,
    minClarity: 0.80,
    minVoicedFrames: 5,
    repetitions: 5,
  },
};

export interface ScaleAccuracyParams {
  tolerancePct: number;
  minClarity: number;
  noteCount: number;
  scaleAccuracyThreshold: number;
  repetitions: number;
}

export const SCALE_ACCURACY_PARAMS: Record<
  Tier,
  ScaleAccuracyParams
> = {
  beginner: {
    tolerancePct: 5,
    minClarity: 0.70,
    noteCount: 5,
    scaleAccuracyThreshold: 60,
    repetitions: 3,
  },

  intermediate: {
    tolerancePct: 3,
    minClarity: 0.75,
    noteCount: 7,
    scaleAccuracyThreshold: 70,
    repetitions: 4,
  },

  advanced: {
    tolerancePct: 2,
    minClarity: 0.80,
    noteCount: 8,
    scaleAccuracyThreshold: 80,
    repetitions: 5,
  },
};

export interface IntervalRecognitionParams {
  tolerancePct: number;
  minClarity: number;
  repetitions: number;
  totalDurationSec: number;
}

export const INTERVAL_RECOGNITION_PARAMS: Record<
  Tier,
  IntervalRecognitionParams
> = {
  beginner: {
    tolerancePct: 7,
    minClarity: 0.70,
    repetitions: 3,
    totalDurationSec: 8,
  },

  intermediate: {
    tolerancePct: 5,
    minClarity: 0.75,
    repetitions: 3,
    totalDurationSec: 7,
  },

  advanced: {
    tolerancePct: 3,
    minClarity: 0.80,
    repetitions: 3,
    totalDurationSec: 6,
  },
};

export interface SustainedNoteStabilityParams {
  durationSec: number;
  stabilityThresholdCents: number;
  minClarity: number;
  repetitions: number;
}

export const SUSTAINED_NOTE_STABILITY_PARAMS: Record<
  Tier,
  SustainedNoteStabilityParams
> = {
  beginner: {
    durationSec: 3,
    stabilityThresholdCents: 50,
    minClarity: 0.70,
    repetitions: 3,
  },

  intermediate: {
    durationSec: 4,
    stabilityThresholdCents: 35,
    minClarity: 0.75,
    repetitions: 4,
  },

  advanced: {
    durationSec: 5,
    stabilityThresholdCents: 25,
    minClarity: 0.80,
    repetitions: 5,
  },
};

export interface MelodicPatternMatchingParams {
  noteCount: number;
  tolerancePct: number;
  minClarity: number;
  repetitions: number;
}

export const MELODIC_PATTERN_MATCHING_PARAMS: Record<
  Tier,
  MelodicPatternMatchingParams
> = {
  beginner: {
    noteCount: 4,
    tolerancePct: 5,
    minClarity: 0.70,
    repetitions: 3,
  },

  intermediate: {
    noteCount: 6,
    tolerancePct: 3,
    minClarity: 0.75,
    repetitions: 4,
  },

  advanced: {
    noteCount: 8,
    tolerancePct: 2,
    minClarity: 0.80,
    repetitions: 5,
  },
};

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
    targetDbRange: [3, 10],
    rangeAccuracyThreshold: 65,
    rampConsistencyThreshold: 55,
  },

  intermediate: {
    durationSec: 10,
    repetitions: 2,
    targetDbRange: [5, 12],
    rangeAccuracyThreshold: 75,
    rampConsistencyThreshold: 70,
  },

  advanced: {
    durationSec: 12,
    repetitions: 3,
    targetDbRange: [8, 15],
    rangeAccuracyThreshold: 85,
    rampConsistencyThreshold: 80,
  },
};

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
    targetDbRange: [30, 45],
    smoothnessThreshold: 75,
    volumeIncreaseThreshold: 12,
  },

  advanced: {
    durationSec: 6,
    repetitions: 3,
    targetDbRange: [25, 40],
    smoothnessThreshold: 88,
    volumeIncreaseThreshold: 15,
  },
};

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
    targetDbRange: [45, 55],
    toleranceDb: 5,
    consistencyThreshold: 65,
  },

  intermediate: {
    durationSec: 4,
    repetitions: 2,
    targetDbRange: [50, 60],
    toleranceDb: 4,
    consistencyThreshold: 75,
  },

  advanced: {
    durationSec: 5,
    repetitions: 3,
    targetDbRange: [55, 65],
    toleranceDb: 3,
    consistencyThreshold: 85,
  },
};

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

export const RAPID_NOTE_TRANSITION_PARAMS: Record<
  Tier,
    {
      minNotes: number;
      maxNotes: number;
      minSpeed: number;
      maxSpeed: number;
      repetitions: number;
      accuracyThreshold: number;
      minMidi: number;
      maxMidi: number;
      noteDurationSec: number;
    }
> = {
  beginner: {
    minNotes: 4,
    maxNotes: 6,
    minSpeed: 2,
    maxSpeed: 3,
    repetitions: 2,
    accuracyThreshold: 60,
    minMidi: 60,
    maxMidi: 72,
    noteDurationSec: 0.35,
  },

  intermediate: {
    minNotes: 5,
    maxNotes: 7,
    minSpeed: 3,
    maxSpeed: 4,
    repetitions: 3,
    accuracyThreshold: 70,
    minMidi: 57,
    maxMidi: 76,
    noteDurationSec: 0.35,
  },

  advanced: {
    minNotes: 6,
    maxNotes: 8,
    minSpeed: 4,
    maxSpeed: 6,
    repetitions: 4,
    accuracyThreshold: 80,
    minMidi: 55,
    maxMidi: 79,
    noteDurationSec: 0.35,
  },
};

export const ARPEGGIO_SPEED_DRILL_PARAMS: Record<
  Tier,
  {
    speedLabel: string;
    noteDurationSec: number;
    gapSec: number;
    pitchTolerancePercent: number;
  }
> = {
  beginner: {
    speedLabel: 'Slow',
    noteDurationSec: 0.65,
    gapSec: 0.08,
    pitchTolerancePercent: 7,
  },

  intermediate: {
    speedLabel: 'Moderate',
    noteDurationSec: 0.45,
    gapSec: 0.06,
    pitchTolerancePercent: 5,
  },

  advanced: {
    speedLabel: 'Fast',
    noteDurationSec: 0.3,
    gapSec: 0.04,
    pitchTolerancePercent: 3,
  },
};

export const QUICK_INTERVAL_JUMP_PARAMS: Record<
  Tier,
  {
    label: string;
    speedLabel: string;
    accuracyThreshold: number;
  }
> = {
  beginner: {
    label: 'Beginner',
    speedLabel: 'Slow',
    accuracyThreshold: 60,
  },

  intermediate: {
    label: 'Intermediate',
    speedLabel: 'Moderate',
    accuracyThreshold: 70,
  },

  advanced: {
    label: 'Advanced',
    speedLabel: 'Fast',
    accuracyThreshold: 80,
  },
};

export const RAPID_SCALE_TRILL_PARAMS: Record<
  Tier,
  {
    label: string;
    speedLabel: string;
    accuracyThreshold: number;
    noteDurationSec: number;
    repetitions: number;
  }
> = {
  beginner: {
    label: 'Beginner',
    speedLabel: 'Slow',
    accuracyThreshold: 60,
    noteDurationSec: 0.32,
    repetitions: 3,
  },

  intermediate: {
    label: 'Intermediate',
    speedLabel: 'Moderate',
    accuracyThreshold: 70,
    noteDurationSec: 0.24,
    repetitions: 4,
  },

  advanced: {
    label: 'Advanced',
    speedLabel: 'Fast',
    accuracyThreshold: 80,
    noteDurationSec: 0.18,
    repetitions: 5,
  },
};

export const VOCAL_RUN_ACCURACY_PARAMS: Record<
  Tier,
  {
    label: string;
    speedLabel: string;
    accuracyThreshold: number;
    noteDurationSec: number;
    repetitions: number;
    gapSec: number;
  }
> = {
  beginner: {
    label: 'Beginner',
    speedLabel: 'Slow',
    accuracyThreshold: 60,
    noteDurationSec: 0.4,
    repetitions: 2,
    gapSec: 0.1,
  },
  intermediate: {
    label: 'Intermediate',
    speedLabel: 'Moderate',
    accuracyThreshold: 70,
    noteDurationSec: 0.3,
    repetitions: 3,
    gapSec: 0.075,
  },
  advanced: {
    label: 'Advanced',
    speedLabel: 'Fast',
    accuracyThreshold: 80,
    noteDurationSec: 0.2,
    repetitions: 4,
    gapSec: 0.05,
  },
};