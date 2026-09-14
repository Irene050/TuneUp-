// src/constants/exercises/pitch.ts

export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';


// ============================================================
// 1. NOTE MATCHING EXERCISE
// ============================================================

export interface NoteMatchingParams {
  tolerancePct: number;
  minClarity: number;
  minVoicedFrames: number;
}

export const NOTE_MATCHING_PARAMS: Record<
  Tier,
  NoteMatchingParams
> = {
  beginner: {
    tolerancePct: 5,
    minClarity: 0.70,
    minVoicedFrames: 3,
  },

  intermediate: {
    tolerancePct: 3,
    minClarity: 0.75,
    minVoicedFrames: 4,
  },

  advanced: {
    tolerancePct: 2,
    minClarity: 0.80,
    minVoicedFrames: 5,
  },
};


// ============================================================
// 2. SCALE ACCURACY DRILL
// ============================================================

export interface ScaleAccuracyParams {
  tolerancePct: number;
  minClarity: number;
  noteCount: number;

  /**
   * Minimum percentage of notes that must be
   * accurately matched for the exercise to pass.
   */
  scaleAccuracyThreshold: number;
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
  },

  intermediate: {
    tolerancePct: 3,
    minClarity: 0.75,
    noteCount: 7,
    scaleAccuracyThreshold: 70,
  },

  advanced: {
    tolerancePct: 2,
    minClarity: 0.80,
    noteCount: 8,
    scaleAccuracyThreshold: 80,
  },
};


// ============================================================
// 3. INTERVAL RECOGNITION TASK
// ============================================================

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
    repetitions: 2,
    totalDurationSec: 5,
  },

  intermediate: {
    tolerancePct: 5,
    minClarity: 0.75,
    repetitions: 2,
    totalDurationSec: 4,
  },

  advanced: {
    tolerancePct: 3,
    minClarity: 0.80,
    repetitions: 2,
    totalDurationSec: 3,
  },
};


// ============================================================
// 4. SUSTAINED NOTE STABILITY
// ============================================================

export interface SustainedNoteStabilityParams {
  durationSec: number;
  stabilityThresholdCents: number;
  minClarity: number;
}

export const SUSTAINED_NOTE_STABILITY_PARAMS: Record<
  Tier,
  SustainedNoteStabilityParams
> = {
  beginner: {
    durationSec: 3,
    stabilityThresholdCents: 50,
    minClarity: 0.70,
  },

  intermediate: {
    durationSec: 4,
    stabilityThresholdCents: 35,
    minClarity: 0.75,
  },

  advanced: {
    durationSec: 5,
    stabilityThresholdCents: 25,
    minClarity: 0.80,
  },
};


// ============================================================
// 5. MELODIC PATTERN MATCHING
// ============================================================

export interface MelodicPatternMatchingParams {
  noteCount: number;
  tolerancePct: number;
  minClarity: number;
}

export const MELODIC_PATTERN_MATCHING_PARAMS: Record<
  Tier,
  MelodicPatternMatchingParams
> = {
  beginner: {
    noteCount: 3,
    tolerancePct: 5,
    minClarity: 0.70,
  },

  intermediate: {
    noteCount: 5,
    tolerancePct: 3,
    minClarity: 0.75,
  },

  advanced: {
    noteCount: 7,
    tolerancePct: 2,
    minClarity: 0.80,
  },
};