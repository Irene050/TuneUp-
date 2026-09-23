export type VocalRunAccuracyMeasurement = {
  detectedPitches: number[];
  detectedNotes: number[];
  targetNotes: number[];

  pitchAccuracy: number;
  sequenceAccuracy: number;

  noteCount: number;
  correctNoteCount: number;

  transitionCount: number;
  correctTransitionCount: number;

  durationMs: number;
  notesPerSecond: number;
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

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function rms(
  samples: Float32Array,
  start: number,
  end: number,
): number {
  let sum = 0;
  let count = 0;

  for (let i = start; i < end; i++) {
    const value = samples[i] ?? 0;
    sum += value * value;
    count++;
  }

  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function detectPitch(
  frame: Float32Array,
  sampleRate: number,
): number | null {
  let energy = 0;

  for (let i = 0; i < frame.length; i++) {
    energy += frame[i] * frame[i];
  }

  const frameRms = Math.sqrt(energy / frame.length);

  if (frameRms < MIN_RMS) {
    return null;
  }

  const minLag = Math.floor(sampleRate / MAX_FREQUENCY);
  const maxLag = Math.floor(sampleRate / MIN_FREQUENCY);

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

    for (let i = 0; i < frame.length - lag; i++) {
      const a = frame[i];
      const b = frame[i + lag];

      correlation += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const denominator = Math.sqrt(energyA * energyB);

    if (denominator === 0) {
      continue;
    }

    const normalizedCorrelation = correlation / denominator;

    if (normalizedCorrelation > bestCorrelation) {
      bestCorrelation = normalizedCorrelation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorrelation < 0.3) {
    return null;
  }

  return sampleRate / bestLag;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

export function measureVocalRunAccuracy(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
): VocalRunAccuracyMeasurement {
  const detectedPitches: number[] = [];
  const detectedNotes: number[] = [];

  if (targetFrequencies.length === 0 || samples.length === 0) {
    return {
      detectedPitches: [],
      detectedNotes: [],
      targetNotes: [],
      pitchAccuracy: 0,
      sequenceAccuracy: 0,
      noteCount: 0,
      correctNoteCount: 0,
      transitionCount: 0,
      correctTransitionCount: 0,
      durationMs: 0,
      notesPerSecond: 0,
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

    const frequency = detectPitch(frame, sampleRate);

    if (frequency === null) {
      continue;
    }

    const midi = frequencyToMidi(frequency);
    const roundedMidi = Math.round(midi);

    detectedPitches.push(frequency);

    const previousNote =
      detectedNotes[detectedNotes.length - 1];

    if (
      previousNote === undefined ||
      previousNote !== roundedMidi
    ) {
      detectedNotes.push(roundedMidi);
    }
  }

  const targetNotes = targetFrequencies.map((frequency) =>
    Math.round(midiToFrequency === undefined
      ? 69
      : frequencyToMidi(frequency)),
  );

  const comparedCount = Math.min(
    detectedNotes.length,
    targetNotes.length,
  );

  let correctNoteCount = 0;
  let totalSemitoneError = 0;

  for (let i = 0; i < comparedCount; i++) {
    const detected = detectedNotes[i];
    const target = targetNotes[i];

    const error = Math.abs(detected - target);

    totalSemitoneError += error;

    if (error <= NOTE_TOLERANCE_SEMITONES) {
      correctNoteCount++;
    }
  }

  const sequenceAccuracy =
    comparedCount > 0
      ? (correctNoteCount / comparedCount) * 100
      : 0;

  const averageSemitoneError =
    comparedCount > 0
      ? totalSemitoneError / comparedCount
      : 12;

  const pitchAccuracy = clamp(
    100 - averageSemitoneError * 50,
    0,
    100,
  );

  let transitionCount = 0;
  let correctTransitionCount = 0;

  for (let i = 1; i < detectedNotes.length; i++) {
    if (detectedNotes[i] !== detectedNotes[i - 1]) {
      transitionCount++;

      if (i < targetNotes.length) {
        const detectedInterval =
          detectedNotes[i] - detectedNotes[i - 1];

        const targetInterval =
          targetNotes[i] - targetNotes[i - 1];

        if (
          Math.abs(
            detectedInterval - targetInterval,
          ) <= NOTE_TOLERANCE_SEMITONES
        ) {
          correctTransitionCount++;
        }
      }
    }
  }

  const durationMs =
    (samples.length / sampleRate) * 1000;

  const durationSeconds = durationMs / 1000;

  const notesPerSecond =
    durationSeconds > 0
      ? detectedNotes.length / durationSeconds
      : 0;

  return {
    detectedPitches,
    detectedNotes,
    targetNotes,

    pitchAccuracy,
    sequenceAccuracy,

    noteCount: detectedNotes.length,
    correctNoteCount,

    transitionCount,
    correctTransitionCount,

    durationMs,
    notesPerSecond,
  };
}