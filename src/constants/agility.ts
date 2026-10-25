export type Tier =
  | 'beginner'
  | 'intermediate'
  | 'advanced';

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