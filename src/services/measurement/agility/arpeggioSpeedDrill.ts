export type ArpeggioSpeedMeasurement = {
  detectedPitches: number[];
  detectedNotes: number[];
  targetNotes: number[];

  pitchAccuracy: number;
  sequenceAccuracy: number;

  noteCount: number;
  correctNoteCount: number;

  durationMs: number;
  notesPerSecond: number;
  averageNoteDurationMs: number;
};

const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 1000;

const MIN_RMS = 0.008;

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

/*
 * Default pitch tolerance.
 *
 * The value is expressed as percentage deviation from
 * the target frequency. Exercise generators or ADS can
 * provide a tier-specific value through the optional
 * function parameter.
 */
const DEFAULT_PITCH_TOLERANCE_PERCENT = 7;

/*
 * A newly detected note must remain stable for multiple
 * analysis frames before it is added to the detected sequence.
 * This prevents small pitch fluctuations from creating false notes.
 */
const NOTE_CONFIRMATION_FRAMES = 2;

/* ============================================================
 * BASIC UTILITIES
 * ========================================================== */

function clamp(
  value: number,
  min = 0,
  max = 100,
): number {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

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
 * PITCH DETECTION
 * ========================================================== */

function detectPitch(
  frame: Float32Array,
  sampleRate: number,
): number | null {
  if (
    frame.length < FRAME_SIZE ||
    sampleRate <= 0
  ) {
    return null;
  }

  let sumSquares = 0;

  for (
    let i = 0;
    i < frame.length;
    i++
  ) {
    const sample = frame[i];

    sumSquares +=
      sample * sample;
  }

  const rms =
    Math.sqrt(
      sumSquares /
        frame.length,
    );

  if (
    rms < MIN_RMS
  ) {
    return null;
  }

  const minLag =
    Math.floor(
      sampleRate /
        MAX_FREQUENCY,
    );

  const maxLag =
    Math.floor(
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
      frame.length - lag;

    for (
      let i = 0;
      i < limit;
      i++
    ) {
      const a = frame[i];
      const b =
        frame[i + lag];

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
        energyA * energyB,
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
    bestCorrelation <= 0
  ) {
    return null;
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
    return null;
  }

  return frequency;
}

/* ============================================================
 * STABLE NOTE EXTRACTION
 * ========================================================== */

/**
 * Converts detected pitch frames into a stable sequence
 * of MIDI notes.
 *
 * Consecutive frames containing the same note are collapsed
 * into one note. A newly detected note must persist for the
 * configured number of frames before being confirmed.
 */
function extractStableNotes(
  pitches: number[],
): number[] {
  if (!pitches.length) {
    return [];
  }

  const detectedNotes: number[] = [];

  let currentNote =
    Math.round(
      frequencyToMidi(
        pitches[0],
      ),
    );

  let candidateNote =
    currentNote;

  let candidateFrames = 0;

  detectedNotes.push(
    currentNote,
  );

  for (
    let i = 1;
    i < pitches.length;
    i++
  ) {
    const detectedNote =
      Math.round(
        frequencyToMidi(
          pitches[i],
        ),
      );

    if (
      detectedNote ===
      currentNote
    ) {
      candidateNote =
        currentNote;

      candidateFrames = 0;

      continue;
    }

    if (
      detectedNote ===
      candidateNote
    ) {
      candidateFrames++;
    } else {
      candidateNote =
        detectedNote;

      candidateFrames = 1;
    }

    if (
      candidateFrames >=
      NOTE_CONFIRMATION_FRAMES
    ) {
      currentNote =
        candidateNote;

      detectedNotes.push(
        currentNote,
      );

      candidateNote =
        currentNote;

      candidateFrames = 0;
    }
  }

  return detectedNotes;
}

/* ============================================================
 * PITCH ACCURACY
 * ========================================================== */

/**
 * Calculates pitch accuracy by comparing each detected
 * stable note with the corresponding target note.
 *
 * The error is measured as percentage frequency deviation.
 */
function calculatePitchAccuracy(
  detectedNotes: number[],
  targetFrequencies: number[],
  tolerancePercent: number,
): {
  accuracy: number;
  correctCount: number;
} {
  if (
    !detectedNotes.length ||
    !targetFrequencies.length
  ) {
    return {
      accuracy: 0,
      correctCount: 0,
    };
  }

  const compareLength =
    Math.min(
      detectedNotes.length,
      targetFrequencies.length,
    );

  if (
    compareLength === 0
  ) {
    return {
      accuracy: 0,
      correctCount: 0,
    };
  }

  let correctCount = 0;
  let totalErrorPercent = 0;

  for (
    let i = 0;
    i < compareLength;
    i++
  ) {
    const detectedFrequency =
      440 *
      Math.pow(
        2,
        (detectedNotes[i] - 69) /
          12,
      );

    const targetFrequency =
      targetFrequencies[i];

    if (
      !Number.isFinite(
        detectedFrequency,
      ) ||
      !Number.isFinite(
        targetFrequency,
      ) ||
      targetFrequency <= 0
    ) {
      continue;
    }

    const errorPercent =
      Math.abs(
        (
          (
            detectedFrequency -
            targetFrequency
          ) /
          targetFrequency
        ) * 100,
      );

    totalErrorPercent +=
      errorPercent;

    if (
      errorPercent <=
      tolerancePercent
    ) {
      correctCount++;
    }
  }

  /*
   * Accuracy is based on the average percentage
   * deviation from the target notes.
   *
   * Zero deviation = 100%.
   * Deviation equal to the configured tolerance = 0%.
   */
  const averageErrorPercent =
    totalErrorPercent /
    compareLength;

  const accuracy =
    clamp(
      100 -
        (
          averageErrorPercent /
          Math.max(
            tolerancePercent,
            0.001,
          )
        ) *
          100,
    );

  return {
    accuracy: Math.round(
      accuracy,
    ),
    correctCount,
  };
}

/* ============================================================
 * SEQUENCE ACCURACY
 * ========================================================== */

/**
 * Compares the complete detected sequence against the
 * complete target sequence.
 *
 * Missing and extra notes reduce the score. This prevents
 * a partial arpeggio from receiving full sequence accuracy.
 */
function calculateSequenceAccuracy(
  detectedNotes: number[],
  targetFrequencies: number[],
): {
  accuracy: number;
  correctCount: number;
} {
  if (
    !detectedNotes.length ||
    !targetFrequencies.length
  ) {
    return {
      accuracy: 0,
      correctCount: 0,
    };
  }

  const targetNotes =
    targetFrequencies.map(
      frequencyToMidi,
    );

  const targetMidi =
    targetNotes.map(
      Math.round,
    );

  const compareLength =
    Math.min(
      detectedNotes.length,
      targetMidi.length,
    );

  let correctCount = 0;

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
      correctCount++;
    }
  }

  /*
   * Divide by the larger sequence length so that:
   *
   * - missing notes reduce the score
   * - extra notes reduce the score
   * - incorrect notes reduce the score
   */
  const sequenceLength =
    Math.max(
      detectedNotes.length,
      targetMidi.length,
    );

  const accuracy =
    sequenceLength > 0
      ? (
          correctCount /
          sequenceLength
        ) * 100
      : 0;

  return {
    accuracy: Math.round(
      clamp(accuracy),
    ),
    correctCount,
  };
}

/* ============================================================
 * PUBLIC MEASUREMENT FUNCTION
 * ========================================================== */

export function measureArpeggioSpeed(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
  pitchTolerancePercent =
    DEFAULT_PITCH_TOLERANCE_PERCENT,
): ArpeggioSpeedMeasurement {
  const durationMs =
    sampleRate > 0
      ? (
          samples.length /
          sampleRate
        ) * 1000
      : 0;

  if (
    samples.length === 0 ||
    sampleRate <= 0 ||
    targetFrequencies.length === 0
  ) {
    return {
      detectedPitches: [],
      detectedNotes: [],
      targetNotes:
        targetFrequencies.map(
          frequencyToMidi,
        ),
      pitchAccuracy: 0,
      sequenceAccuracy: 0,
      noteCount: 0,
      correctNoteCount: 0,
      durationMs,
      notesPerSecond: 0,
      averageNoteDurationMs: 0,
    };
  }

  const targetNotes =
    targetFrequencies.map(
      frequencyToMidi,
    );

  const detectedPitches: number[] = [];

  /*
   * Extract pitch frames.
   */
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

    const frequency =
      detectPitch(
        frame,
        sampleRate,
      );

    if (
      frequency !== null
    ) {
      detectedPitches.push(
        frequency,
      );
    }
  }

  /*
   * Convert continuous pitch frames into a stable
   * sequence of detected notes.
   */
  const detectedNotes =
    extractStableNotes(
      detectedPitches,
    );

  if (
    detectedNotes.length === 0
  ) {
    return {
      detectedPitches,
      detectedNotes,
      targetNotes,
      pitchAccuracy: 0,
      sequenceAccuracy: 0,
      noteCount: 0,
      correctNoteCount: 0,
      durationMs,
      notesPerSecond: 0,
      averageNoteDurationMs: 0,
    };
  }

  const pitchResult =
    calculatePitchAccuracy(
      detectedNotes,
      targetFrequencies,
      Math.max(
        pitchTolerancePercent,
        0.1,
      ),
    );

  const sequenceResult =
    calculateSequenceAccuracy(
      detectedNotes,
      targetFrequencies,
    );

  const notesPerSecond =
    durationMs > 0
      ? detectedNotes.length /
        (durationMs / 1000)
      : 0;

  const averageNoteDurationMs =
    detectedNotes.length > 0
      ? durationMs /
        detectedNotes.length
      : 0;

  return {
    detectedPitches,
    detectedNotes,
    targetNotes,

    pitchAccuracy:
      pitchResult.accuracy,

    sequenceAccuracy:
      sequenceResult.accuracy,

    noteCount:
      detectedNotes.length,

    correctNoteCount:
      sequenceResult.correctCount,

    durationMs,

    notesPerSecond,

    averageNoteDurationMs,
  };
}