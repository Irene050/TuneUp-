export type RapidNoteTransitionMeasurement = {
  detectedPitches: number[];
  detectedNotes: number[];

  targetNotes: number[];

  pitchAccuracy: number;
  sequenceAccuracy: number;

  transitionCount: number;
  transitionTimesMs: number[];

  averageTransitionTimeMs: number;
  transitionsPerSecond: number;

  durationMs: number;
};

const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 1000;

const MIN_RMS = 0.008;

const PITCH_TOLERANCE_CENTS = 100;

const MIN_TRANSITION_SEMITONES = 1;

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

/* ============================================================
   DSP
============================================================ */

function calculateRms(
  samples: Float32Array,
): number {
  if (!samples.length) {
    return 0;
  }

  let sum = 0;

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    sum +=
      samples[i] *
      samples[i];
  }

  return Math.sqrt(
    sum / samples.length,
  );
}

function detectPitch(
  samples: Float32Array,
  sampleRate: number,
): number {
  if (
    samples.length < FRAME_SIZE
  ) {
    return 0;
  }

  if (
    calculateRms(samples) <
    MIN_RMS
  ) {
    return 0;
  }

  const minLag = Math.floor(
    sampleRate /
      MAX_FREQUENCY,
  );

  const maxLag = Math.floor(
    sampleRate /
      MIN_FREQUENCY,
  );

  let bestLag = -1;

  let bestCorrelation = 0;

  for (
    let lag = minLag;
    lag <= maxLag;
    lag++
  ) {
    let correlation = 0;
    let energyA = 0;
    let energyB = 0;

    const limit =
      samples.length - lag;

    for (
      let i = 0;
      i < limit;
      i++
    ) {
      const a =
        samples[i];

      const b =
        samples[i + lag];

      correlation +=
        a * b;

      energyA +=
        a * a;

      energyB +=
        b * b;
    }

    if (
      energyA === 0 ||
      energyB === 0
    ) {
      continue;
    }

    const normalized =
      correlation /
      Math.sqrt(
        energyA *
          energyB,
      );

    if (
      normalized >
      bestCorrelation
    ) {
      bestCorrelation =
        normalized;

      bestLag = lag;
    }
  }

  if (
    bestLag <= 0 ||
    bestCorrelation < 0.65
  ) {
    return 0;
  }

  const frequency =
    sampleRate /
    bestLag;

  if (
    frequency <
      MIN_FREQUENCY ||
    frequency >
      MAX_FREQUENCY
  ) {
    return 0;
  }

  return frequency;
}

function extractPitchFrames(
  samples: Float32Array,
  sampleRate: number,
): number[] {
  const pitches: number[] = [];

  for (
    let start = 0;
    start + FRAME_SIZE <=
    samples.length;
    start += HOP_SIZE
  ) {
    const frame =
      samples.slice(
        start,
        start + FRAME_SIZE,
      );

    const pitch =
      detectPitch(
        frame,
        sampleRate,
      );

    if (pitch > 0) {
      pitches.push(pitch);
    }
  }

  return pitches;
}

/* ============================================================
   NOTE CONVERSION
============================================================ */

function frequencyToMidi(
  frequency: number,
): number {
  return (
    69 +
    12 *
      Math.log2(
        frequency / 440,
      )
  );
}

function frequencyToCents(
  frequency: number,
  target: number,
): number {
  return (
    1200 *
    Math.log2(
      frequency / target,
    )
  );
}

/* ============================================================
   PITCH ACCURACY
============================================================ */

function calculatePitchAccuracy(
  detected: number[],
  targets: number[],
): number {
  if (
    !detected.length ||
    !targets.length
  ) {
    return 0;
  }

  let accurate = 0;

  for (
    const pitch of detected
  ) {
    let closest =
      targets[0];

    let closestError =
      Math.abs(
        frequencyToCents(
          pitch,
          closest,
        ),
      );

    for (
      let i = 1;
      i < targets.length;
      i++
    ) {
      const error =
        Math.abs(
          frequencyToCents(
            pitch,
            targets[i],
          ),
        );

      if (
        error <
        closestError
      ) {
        closestError =
          error;

        closest =
          targets[i];
      }
    }

    if (
      Math.abs(
        frequencyToCents(
          pitch,
          closest,
        ),
      ) <=
      PITCH_TOLERANCE_CENTS
    ) {
      accurate++;
    }
  }

  return Math.round(
    (accurate /
      detected.length) *
      100,
  );
}

/* ============================================================
   TRANSITIONS
============================================================ */

function calculateTransitions(
  pitches: number[],
  sampleRate: number,
): {
  count: number;
  timesMs: number[];
} {
  if (
    pitches.length < 2
  ) {
    return {
      count: 0,
      timesMs: [],
    };
  }

  const timesMs: number[] = [];

  let previousMidi =
    Math.round(
      frequencyToMidi(
        pitches[0],
      ),
    );

  let lastTransitionFrame =
    0;

  for (
    let i = 1;
    i < pitches.length;
    i++
  ) {
    const currentMidi =
      Math.round(
        frequencyToMidi(
          pitches[i],
        ),
      );

    const difference =
      Math.abs(
        currentMidi -
          previousMidi,
      );

    if (
      difference >=
      MIN_TRANSITION_SEMITONES
    ) {
      const frameDifference =
        i -
        lastTransitionFrame;

      const timeMs =
        (frameDifference *
          HOP_SIZE /
          sampleRate) *
        1000;

      timesMs.push(
        timeMs,
      );

      lastTransitionFrame =
        i;
    }

    previousMidi =
      currentMidi;
  }

  return {
    count:
      timesMs.length,
    timesMs,
  };
}

/* ============================================================
   SEQUENCE ACCURACY
============================================================ */

function calculateSequenceAccuracy(
  detected: number[],
  targets: number[],
): number {
  if (
    !detected.length ||
    !targets.length
  ) {
    return 0;
  }

  const detectedMidi =
    detected.map(
      frequencyToMidi,
    );

  const targetMidi =
    targets.map(
      frequencyToMidi,
    );

  let matches = 0;

  const compareLength =
    Math.min(
      detectedMidi.length,
      targetMidi.length,
    );

  for (
    let i = 0;
    i < compareLength;
    i++
  ) {
    if (
      Math.abs(
        Math.round(
          detectedMidi[i],
        ) -
          Math.round(
            targetMidi[i],
          ),
      ) <= 1
    ) {
      matches++;
    }
  }

  return Math.round(
    (matches /
      Math.max(
        detectedMidi.length,
        targetMidi.length,
      )) *
      100,
  );
}

/* ============================================================
   PUBLIC FUNCTION
============================================================ */

export function measureRapidNoteTransition(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
): RapidNoteTransitionMeasurement {
  const durationMs =
    sampleRate > 0
      ? (samples.length /
          sampleRate) *
        1000
      : 0;

  const detectedPitches =
    extractPitchFrames(
      samples,
      sampleRate,
    );

  const detectedNotes =
    detectedPitches.map(
      frequencyToMidi,
    );

  const pitchAccuracy =
    calculatePitchAccuracy(
      detectedPitches,
      targetFrequencies,
    );

  const sequenceAccuracy =
    calculateSequenceAccuracy(
      detectedPitches,
      targetFrequencies,
    );

  const transitions =
    calculateTransitions(
      detectedPitches,
      sampleRate,
    );

  const averageTransitionTimeMs =
    transitions.timesMs.length
      ? transitions.timesMs.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        transitions
          .timesMs
          .length
      : 0;

  const durationSeconds =
    durationMs / 1000;

  const transitionsPerSecond =
    durationSeconds > 0
      ? transitions.count /
        durationSeconds
      : 0;

  return {
    detectedPitches,
    detectedNotes,

    targetNotes:
      targetFrequencies,

    pitchAccuracy,
    sequenceAccuracy,

    transitionCount:
      transitions.count,

    transitionTimesMs:
      transitions.timesMs,

    averageTransitionTimeMs,

    transitionsPerSecond,

    durationMs,
  };
}