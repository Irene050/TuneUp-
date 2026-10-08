export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';


// note matching params

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

// scale accuracy params

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

// interval recognition params

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

// susatined note stability params
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

// melodic pattern matching params

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