// src/constants/exercises/pitch.ts

export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';


// ============================================================
// 1. NOTE MATCHING EXERCISE
// ============================================================

export interface NoteMatchingParams {
  // Example fields to be filled according to your
  // actual pitch exercise design.
}

export const NOTE_MATCHING_PARAMS: Record<
  Tier,
  NoteMatchingParams
> = {
  beginner: {},
  intermediate: {},
  advanced: {},
};


// ============================================================
// 2. SCALE ACCURACY DRILL
// ============================================================

export interface ScaleAccuracyParams {
  // Example:
  // scaleSize: number;
  // toleranceCents: number;
}

export const SCALE_ACCURACY_PARAMS: Record<
  Tier,
  ScaleAccuracyParams
> = {
  beginner: {},
  intermediate: {},
  advanced: {},
};


// ============================================================
// 3. INTERVAL RECOGNITION TASK
// ============================================================

export interface IntervalRecognitionParams {
  // Example:
  // intervalCount: number;
  // toleranceCents: number;
}

export const INTERVAL_RECOGNITION_PARAMS: Record<
  Tier,
  IntervalRecognitionParams
> = {
  beginner: {},
  intermediate: {},
  advanced: {},
};


// ============================================================
// 4. SUSTAINED NOTE STABILITY
// ============================================================

export interface SustainedNoteStabilityParams {
  // Example:
  // durationSec: number;
  // stabilityThreshold: number;
}

export const SUSTAINED_NOTE_STABILITY_PARAMS: Record<
  Tier,
  SustainedNoteStabilityParams
> = {
  beginner: {},
  intermediate: {},
  advanced: {},
};


// ============================================================
// 5. MELODIC PATTERN MATCHING
// ============================================================

export interface MelodicPatternMatchingParams {
  // Example:
  // noteCount: number;
  // toleranceCents: number;
}

export const MELODIC_PATTERN_MATCHING_PARAMS: Record<
  Tier,
  MelodicPatternMatchingParams
> = {
  beginner: {},
  intermediate: {},
  advanced: {},
};