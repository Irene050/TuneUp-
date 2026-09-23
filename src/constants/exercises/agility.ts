export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';

/**
 * Arpeggio Speed Drill
 *
 * Controls the target arpeggio notes and
 * playback timing for each difficulty tier.
 */
export const ARPEGGIO_SPEED_DRILL_PARAMS: Record<
  Tier,
  {
    name: string;
    notes: string[];
    frequencies: number[];
    speedLabel: string;
    noteDurationSec: number;
    gapSec: number;
  }
> = {
  beginner: {
    name: 'C Major',
    notes: ['C4', 'E4', 'G4', 'C5'],
    frequencies: [
      261.63,
      329.63,
      392.0,
      523.25,
    ],
    speedLabel: 'Slow',
    noteDurationSec: 0.65,
    gapSec: 0.08,
  },

  intermediate: {
    name: 'A Minor',
    notes: ['A3', 'C4', 'E4', 'A4'],
    frequencies: [
      220.0,
      261.63,
      329.63,
      440.0,
    ],
    speedLabel: 'Moderate',
    noteDurationSec: 0.45,
    gapSec: 0.06,
  },

  advanced: {
    name: 'G Major',
    notes: ['G3', 'B3', 'D4', 'G4'],
    frequencies: [
      196.0,
      246.94,
      293.66,
      392.0,
    ],
    speedLabel: 'Fast',
    noteDurationSec: 0.3,
    gapSec: 0.04,
  },
};

/**
 * Quick Interval Jump
 *
 * Defines the target frequency sequence and
 * accuracy requirement for each tier.
 */
export const QUICK_INTERVAL_JUMP_PARAMS: Record<
  Tier,
  {
    label: string;
    frequencies: number[];
    speedLabel: string;
    accuracyThreshold: number;
  }
> = {
  beginner: {
    label: 'Beginner',
    frequencies: [
      261.63,
      392.0,
      329.63,
      523.25,
    ],
    speedLabel: 'Slow',
    accuracyThreshold: 60,
  },

  intermediate: {
    label: 'Intermediate',
    frequencies: [
      293.66,
      440.0,
      349.23,
      523.25,
      392.0,
    ],
    speedLabel: 'Moderate',
    accuracyThreshold: 70,
  },

  advanced: {
    label: 'Advanced',
    frequencies: [
      392.0,
      587.33,
      493.88,
      698.46,
      554.37,
      783.99,
    ],
    speedLabel: 'Fast',
    accuracyThreshold: 80,
  },
};

/**
 * Rapid Note Transition
 *
 * Controls the generated note range, number of notes,
 * target transition speed, repetitions, and accuracy
 * requirements for each difficulty tier.
 */
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

/**
 * Rapid Scale Trill
 *
 * Defines the repeating scale/trill pattern,
 * playback speed, and accuracy requirement.
 */
export const RAPID_SCALE_TRILL_PARAMS: Record<
  Tier,
  {
    label: string;
    frequencies: number[];
    speedLabel: string;
    accuracyThreshold: number;
    noteDurationSec: number;
  }
> = {
  beginner: {
    label: 'Beginner',
    frequencies: [
      261.63,
      293.66,
      329.63,
      293.66,
      261.63,
      293.66,
      329.63,
      293.66,
    ],
    speedLabel: 'Slow',
    accuracyThreshold: 60,
    noteDurationSec: 0.32,
  },

  intermediate: {
    label: 'Intermediate',
    frequencies: [
      293.66,
      329.63,
      369.99,
      329.63,
      293.66,
      329.63,
      369.99,
      415.3,
      369.99,
      329.63,
    ],
    speedLabel: 'Moderate',
    accuracyThreshold: 70,
    noteDurationSec: 0.24,
  },

  advanced: {
    label: 'Advanced',
    frequencies: [
      392.0,
      440.0,
      493.88,
      554.37,
      622.25,
      554.37,
      493.88,
      440.0,
      392.0,
      440.0,
      493.88,
      554.37,
      622.25,
      554.37,
      493.88,
      440.0,
    ],
    speedLabel: 'Fast',
    accuracyThreshold: 80,
    noteDurationSec: 0.18,
  },
};

/**
 * Vocal Run Accuracy
 *
 * Defines the target vocal run sequence,
 * playback speed, and accuracy requirement.
 */
export const RAPID_VOCAL_RUN_PARAMS: Record<
  Tier,
  {
    label: string;
    frequencies: number[];
    speedLabel: string;
    accuracyThreshold: number;
    noteDurationSec: number;
  }
> = {
  beginner: {
    label: 'Beginner',
    frequencies: [
      261.63,
      293.66,
      329.63,
      349.23,
      392.0,
    ],
    speedLabel: 'Slow',
    accuracyThreshold: 60,
    noteDurationSec: 0.35,
  },

  intermediate: {
    label: 'Intermediate',
    frequencies: [
      293.66,
      329.63,
      369.99,
      415.3,
      466.16,
      523.25,
    ],
    speedLabel: 'Moderate',
    accuracyThreshold: 70,
    noteDurationSec: 0.35,
  },

  advanced: {
    label: 'Advanced',
    frequencies: [
      392.0,
      440.0,
      493.88,
      554.37,
      622.25,
      698.46,
      783.99,
    ],
    speedLabel: 'Fast',
    accuracyThreshold: 80,
    noteDurationSec: 0.35,
  },
};