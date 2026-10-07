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

/**
 * Maximum allowed frequency deviation when evaluating
 * pitch accuracy.
 *
 * A detected pitch is considered accurate when its
 * frequency differs from the target frequency by no
 * more than 7%.
 */
const PITCH_TOLERANCE_PERCENT = 7;

const MIN_TRANSITION_SEMITONES = 1;

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

/**
 * A note must be detected for this many consecutive
 * pitch frames before it is treated as a stable note.
 *
 * At 44.1 kHz with a 1024-sample hop size, two frames
 * represent approximately 46 ms.
 */
const NOTE_CONFIRMATION_FRAMES = 2;

/* ============================================================
 * DSP
 * ========================================================== */

function calculateRms(
  samples: Float32Array,
): number {
  if (!samples.length) {
    return 0;
  }

  let sum = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    sum += sample * sample;
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
    samples.length < FRAME_SIZE ||
    sampleRate <= 0
  ) {
    return 0;
  }

  if (
    calculateRms(samples) < MIN_RMS
  ) {
    return 0;
  }

  const minLag = Math.floor(
    sampleRate / MAX_FREQUENCY,
  );

  const maxLag = Math.floor(
    sampleRate / MIN_FREQUENCY,
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
      const a = samples[i];
      const b = samples[i + lag];

      correlation += a * b;
      energyA += a * a;
      energyB += b * b;
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
        energyA * energyB,
      );

    if (
      normalized >
      bestCorrelation
    ) {
      bestCorrelation = normalized;
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
    sampleRate / bestLag;

  if (
    frequency < MIN_FREQUENCY ||
    frequency > MAX_FREQUENCY
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
    start + FRAME_SIZE <= samples.length;
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
 * NOTE CONVERSION
 * ========================================================== */

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

/* ============================================================
 * STABLE NOTE SEQUENCE
 * ========================================================== */

/**
 * Converts continuous pitch frames into a stable sequence
 * of MIDI notes.
 *
 * Repeated frames of the same note are collapsed into one
 * note. A new note must persist for the configured number
 * of frames before it is confirmed.
 */
function extractStableNoteSequence(
  pitches: number[],
): number[] {
  if (!pitches.length) {
    return [];
  }

  const sequence: number[] = [];

  let currentMidi = Math.round(
    frequencyToMidi(pitches[0]),
  );

  let candidateMidi = currentMidi;
  let candidateFrames = 0;

  sequence.push(currentMidi);

  for (
    let i = 1;
    i < pitches.length;
    i++
  ) {
    const detectedMidi =
      Math.round(
        frequencyToMidi(
          pitches[i],
        ),
      );

    if (
      detectedMidi ===
      currentMidi
    ) {
      candidateMidi =
        currentMidi;

      candidateFrames = 0;

      continue;
    }

    if (
      detectedMidi ===
      candidateMidi
    ) {
      candidateFrames++;
    } else {
      candidateMidi =
        detectedMidi;

      candidateFrames = 1;
    }

    if (
      candidateFrames >=
      NOTE_CONFIRMATION_FRAMES
    ) {
      currentMidi =
        candidateMidi;

      sequence.push(
        currentMidi,
      );

      candidateMidi =
        currentMidi;

      candidateFrames = 0;
    }
  }

  return sequence;
}

/* ============================================================
 * PITCH ACCURACY
 * ========================================================== */

/**
 * Calculates the absolute frequency deviation as a percentage.
 */
function frequencyDeviationPercent(
  frequency: number,
  target: number,
): number {
  if (
    !Number.isFinite(frequency) ||
    !Number.isFinite(target) ||
    target <= 0
  ) {
    return Infinity;
  }

  return (
    Math.abs(
      (frequency - target) /
        target,
    ) * 100
  );
}

/**
 * Calculates pitch accuracy by determining whether each
 * detected pitch is within the defined percentage deviation
 * of any target frequency in the exercise.
 *
 * This retains the current measurement architecture,
 * where pitch frames do not contain their original
 * timestamps or target-note alignment.
 */
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
    let closestDeviation =
      Infinity;

    for (
      const target of targets
    ) {
      const deviation =
        frequencyDeviationPercent(
          pitch,
          target,
        );

      if (
        deviation <
        closestDeviation
      ) {
        closestDeviation =
          deviation;
      }
    }

    if (
      closestDeviation <=
      PITCH_TOLERANCE_PERCENT
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
 * SEQUENCE ACCURACY
 * ========================================================== */

/**
 * Compares the stable detected note sequence against
 * the target note sequence.
 *
 * A note is considered a match when it is within one
 * semitone of the corresponding target note.
 *
 * Missing or extra notes reduce the score because the
 * comparison uses the full target/detected sequence lengths.
 */
function calculateSequenceAccuracy(
  detectedNotes: number[],
  targetFrequencies: number[],
): number {
  if (
    !detectedNotes.length ||
    !targetFrequencies.length
  ) {
    return 0;
  }

  const targetMidi =
    targetFrequencies.map(
      (frequency) =>
        Math.round(
          frequencyToMidi(
            frequency,
          ),
        ),
    );

  const compareLength =
    Math.min(
      detectedNotes.length,
      targetMidi.length,
    );

  if (compareLength === 0) {
    return 0;
  }

  let matches = 0;

  for (
    let i = 0;
    i < compareLength;
    i++
  ) {
    if (
      Math.abs(
        detectedNotes[i] -
          targetMidi[i],
      ) <= 1
    ) {
      matches++;
    }
  }

  /*
   * Score is based on the target/detected sequence length.
   * Extra or missing detected notes therefore reduce the
   * sequence score instead of being ignored.
   */
  return Math.round(
    (matches /
      Math.max(
        detectedNotes.length,
        targetMidi.length,
      )) *
      100,
  );
}

/* ============================================================
 * TRANSITIONS
 * ========================================================== */

/**
 * Detects transitions between stable notes.
 *
 * A transition is counted only after the new note has
 * remained stable for the required number of frames.
 *
 * This prevents short pitch-detection fluctuations from
 * being counted as genuine note transitions.
 */
function calculateTransitions(
  pitches: number[],
  sampleRate: number,
): {
  count: number;
  timesMs: number[];
} {
  if (
    pitches.length < 2 ||
    sampleRate <= 0
  ) {
    return {
      count: 0,
      timesMs: [],
    };
  }

  const timesMs: number[] = [];

  let currentMidi =
    Math.round(
      frequencyToMidi(
        pitches[0],
      ),
    );

  let candidateMidi =
    currentMidi;

  let candidateFrames = 0;

  let lastTransitionFrame = 0;

  for (
    let i = 1;
    i < pitches.length;
    i++
  ) {
    const detectedMidi =
      Math.round(
        frequencyToMidi(
          pitches[i],
        ),
      );

    const difference =
      Math.abs(
        detectedMidi -
          currentMidi,
      );

    /*
     * Ignore changes smaller than the minimum
     * transition interval.
     */
    if (
      difference <
      MIN_TRANSITION_SEMITONES
    ) {
      candidateMidi =
        currentMidi;

      candidateFrames = 0;

      continue;
    }

    /*
     * Track a possible new note.
     */
    if (
      detectedMidi ===
      candidateMidi
    ) {
      candidateFrames++;
    } else {
      candidateMidi =
        detectedMidi;

      candidateFrames = 1;
    }

    /*
     * Confirm the transition only after the new
     * note has persisted for enough frames.
     */
    if (
      candidateFrames >=
      NOTE_CONFIRMATION_FRAMES
    ) {
      const frameDifference =
        i -
        lastTransitionFrame;

      const timeMs =
        (frameDifference *
          HOP_SIZE /
          sampleRate) *
        1000;

      timesMs.push(timeMs);

      lastTransitionFrame = i;

      currentMidi =
        candidateMidi;

      candidateMidi =
        currentMidi;

      candidateFrames = 0;
    }
  }

  return {
    count: timesMs.length,
    timesMs,
  };
}

/* ============================================================
 * PUBLIC FUNCTION
 * ========================================================== */

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
    extractStableNoteSequence(
      detectedPitches,
    );

  const pitchAccuracy =
    calculatePitchAccuracy(
      detectedPitches,
      targetFrequencies,
    );

  const sequenceAccuracy =
    calculateSequenceAccuracy(
      detectedNotes,
      targetFrequencies,
    );

  const transitions =
    calculateTransitions(
      detectedPitches,
      sampleRate,
    );

  const averageTransitionTimeMs =
    transitions.timesMs.length > 0
      ? transitions.timesMs.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        transitions.timesMs.length
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