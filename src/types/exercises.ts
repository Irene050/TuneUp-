import type { Tier } from '@/constants/params';

export type StandardExercisePhase =
  | 'instructions'
  | 'countdown'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'results';

export type RecordingExercisePhase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'results';

export type RepetitionExercisePhase =
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'rest'
  | 'processing'
  | 'results';

export type FreeModePhase = 'ready' | 'exercise';

export interface ExerciseTierProps {
  tier?: Tier;
}