export type QuickIntervalJumpMeasurement = {
  detectedPitches: number[];
  detectedNotes: number[];
  targetNotes: number[];

  pitchAccuracy: number;
  intervalAccuracy: number;

  noteCount: number;
  correctNoteCount: number;

  transitionCount: number;
  correctTransitionCount: number;

  transitionTimesMs: number[];
  averageTransitionTimeMs: number;

  durationMs: number;
};

const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 1000;
const MIN_RMS = 0.008;

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

const NOTE_TOLERANCE_SEMITONES = 1;

function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

function detectPitch(
  frame: Float32Array,
  sampleRate: number,
): number | null {
  let energy = 0;

  for (let i = 0; i < frame.length; i++) {
    const value = frame[i] ?? 0;
    energy += value * value;
  }

  const frameRms = Math.sqrt(
    energy / frame.length,
  );

  if (frameRms < MIN_RMS) {
    return null;
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
    lag <= maxLag && lag < frame.length;
    lag++
  ) {
    let correlation = 0;
    let energyA = 0;
    let energyB = 0;

    for (
      let i = 0;
      i < frame.length - lag;
      i++
    ) {
      const a = frame[i];
      const b = frame[i + lag];

      correlation += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const denominator = Math.sqrt(
      energyA * energyB,
    );

    if (denominator === 0) {
      continue;
    }

    const normalizedCorrelation =
      correlation / denominator;

    if (
      normalizedCorrelation >
      bestCorrelation
    ) {
      bestCorrelation =
        normalizedCorrelation;
      bestLag = lag;
    }
  }

  if (
    bestLag <= 0 ||
    bestCorrelation < 0.3
  ) {
    return null;
  }

  return sampleRate / bestLag;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

export function measureQuickIntervalJump(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
): QuickIntervalJumpMeasurement {
  const detectedPitches: number[] = [];
  const detectedNotes: number[] = [];
  const detectionTimesMs: number[] = [];

  if (
    samples.length === 0 ||
    targetFrequencies.length === 0
  ) {
    return {
      detectedPitches: [],
      detectedNotes: [],
      targetNotes: [],
      pitchAccuracy: 0,
      intervalAccuracy: 0,
      noteCount: 0,
      correctNoteCount: 0,
      transitionCount: 0,
      correctTransitionCount: 0,
      transitionTimesMs: [],
      averageTransitionTimeMs: 0,
      durationMs: 0,
    };
  }

  for (
    let start = 0;
    start + FRAME_SIZE <= samples.length;
    start += HOP_SIZE
  ) {
    const frame = samples.slice(
      start,
      start + FRAME_SIZE,
    );

    const frequency = detectPitch(
      frame,
      sampleRate,
    );

    if (frequency === null) {
      continue;
    }

    const midi = frequencyToMidi(
      frequency,
    );

    const roundedMidi = Math.round(midi);

    detectedPitches.push(frequency);

    const timeMs =
      (start / sampleRate) * 1000;

    const previousNote =
      detectedNotes[
        detectedNotes.length - 1
      ];

    if (
      previousNote === undefined ||
      previousNote !== roundedMidi
    ) {
      detectedNotes.push(
        roundedMidi,
      );

      detectionTimesMs.push(
        timeMs,
      );
    }
  }

  const targetNotes =
    targetFrequencies.map(
      (frequency) =>
        Math.round(
          frequencyToMidi(frequency),
        ),
    );

  const comparedCount = Math.min(
    detectedNotes.length,
    targetNotes.length,
  );

  let correctNoteCount = 0;
  let totalSemitoneError = 0;

  for (
    let i = 0;
    i < comparedCount;
    i++
  ) {
    const detected =
      detectedNotes[i];

    const target =
      targetNotes[i];

    const error = Math.abs(
      detected - target,
    );

    totalSemitoneError += error;

    if (
      error <=
      NOTE_TOLERANCE_SEMITONES
    ) {
      correctNoteCount++;
    }
  }

  const pitchAccuracy =
    comparedCount > 0
      ? clamp(
          100 -
            (totalSemitoneError /
              comparedCount) *
              50,
          0,
          100,
        )
      : 0;

  const transitionTimesMs: number[] = [];

  for (
    let i = 1;
    i < detectionTimesMs.length;
    i++
  ) {
    const transitionTime =
      detectionTimesMs[i] -
      detectionTimesMs[i - 1];

    if (transitionTime > 0) {
      transitionTimesMs.push(
        transitionTime,
      );
    }
  }

  const transitionCount =
    Math.max(
      0,
      detectedNotes.length - 1,
    );

  let correctTransitionCount = 0;

  const comparableTransitions =
    Math.min(
      detectedNotes.length - 1,
      targetNotes.length - 1,
    );

  for (
    let i = 1;
    i <= comparableTransitions;
    i++
  ) {
    const detectedInterval =
      detectedNotes[i] -
      detectedNotes[i - 1];

    const targetInterval =
      targetNotes[i] -
      targetNotes[i - 1];

    if (
      Math.abs(
        detectedInterval -
          targetInterval,
      ) <=
      NOTE_TOLERANCE_SEMITONES
    ) {
      correctTransitionCount++;
    }
  }

  const intervalAccuracy =
    comparableTransitions > 0
      ? (correctTransitionCount /
          comparableTransitions) *
        100
      : 0;

  const averageTransitionTimeMs =
    transitionTimesMs.length > 0
      ? transitionTimesMs.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        transitionTimesMs.length
      : 0;

  const durationMs =
    (samples.length /
      sampleRate) *
    1000;

  return {
    detectedPitches,
    detectedNotes,
    targetNotes,

    pitchAccuracy,
    intervalAccuracy,

    noteCount:
      detectedNotes.length,

    correctNoteCount,

    transitionCount,
    correctTransitionCount,

    transitionTimesMs,
    averageTransitionTimeMs,

    durationMs,
  };
}