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

const NOTE_TOLERANCE_SEMITONES = 1;

function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function detectPitch(
  frame: Float32Array,
  sampleRate: number,
): number | null {
  let sumSquares = 0;

  for (let i = 0; i < frame.length; i++) {
    sumSquares += frame[i] * frame[i];
  }

  const rms = Math.sqrt(sumSquares / frame.length);

  if (rms < MIN_RMS) {
    return null;
  }

  let bestLag = -1;
  let bestCorrelation = 0;

  const minLag = Math.floor(sampleRate / MAX_FREQUENCY);
  const maxLag = Math.floor(sampleRate / MIN_FREQUENCY);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;

    for (let i = 0; i < frame.length - lag; i++) {
      correlation += frame[i] * frame[i + lag];
    }

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorrelation <= 0) {
    return null;
  }

  const frequency = sampleRate / bestLag;

  if (
    frequency < MIN_FREQUENCY ||
    frequency > MAX_FREQUENCY
  ) {
    return null;
  }

  return frequency;
}

function getClosestTargetNote(
  detectedMidi: number,
  targetNotes: number[],
): number | null {
  if (targetNotes.length === 0) {
    return null;
  }

  let closest = targetNotes[0];
  let smallestDistance = Math.abs(detectedMidi - closest);

  for (let i = 1; i < targetNotes.length; i++) {
    const distance = Math.abs(
      detectedMidi - targetNotes[i],
    );

    if (distance < smallestDistance) {
      smallestDistance = distance;
      closest = targetNotes[i];
    }
  }

  return closest;
}

export function measureArpeggioSpeed(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
): ArpeggioSpeedMeasurement {
  if (
    samples.length === 0 ||
    sampleRate <= 0 ||
    targetFrequencies.length === 0
  ) {
    return {
      detectedPitches: [],
      detectedNotes: [],
      targetNotes: targetFrequencies.map(frequencyToMidi),
      pitchAccuracy: 0,
      sequenceAccuracy: 0,
      noteCount: 0,
      correctNoteCount: 0,
      durationMs: 0,
      notesPerSecond: 0,
      averageNoteDurationMs: 0,
    };
  }

  const targetNotes = targetFrequencies.map(frequencyToMidi);

  const detectedPitches: number[] = [];
  const detectedNotes: number[] = [];

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

    const midi = frequencyToMidi(frequency);

    detectedPitches.push(frequency);

    const roundedMidi = Math.round(midi);

    if (
      detectedNotes.length === 0 ||
      detectedNotes[detectedNotes.length - 1] !== roundedMidi
    ) {
      detectedNotes.push(roundedMidi);
    }
  }

  const noteCount = Math.min(
    detectedNotes.length,
    targetNotes.length,
  );

  if (noteCount === 0) {
    return {
      detectedPitches,
      detectedNotes,
      targetNotes,
      pitchAccuracy: 0,
      sequenceAccuracy: 0,
      noteCount: 0,
      correctNoteCount: 0,
      durationMs: (samples.length / sampleRate) * 1000,
      notesPerSecond: 0,
      averageNoteDurationMs: 0,
    };
  }

  let correctNoteCount = 0;
  let totalPitchError = 0;

  for (let i = 0; i < noteCount; i++) {
    const detected = detectedNotes[i];
    const target = targetNotes[i];

    const error = Math.abs(detected - target);

    totalPitchError += error;

    if (error <= NOTE_TOLERANCE_SEMITONES) {
      correctNoteCount++;
    }
  }

  const pitchAccuracy =
    noteCount > 0
      ? Math.max(
          0,
          Math.min(
            100,
            100 -
              (totalPitchError / noteCount) * 50,
          ),
        )
      : 0;

  const sequenceAccuracy =
    noteCount > 0
      ? (correctNoteCount / noteCount) * 100
      : 0;

  const durationMs =
    (samples.length / sampleRate) * 1000;

  const notesPerSecond =
    durationMs > 0
      ? detectedNotes.length / (durationMs / 1000)
      : 0;

  const averageNoteDurationMs =
    detectedNotes.length > 0
      ? durationMs / detectedNotes.length
      : 0;

  return {
    detectedPitches,
    detectedNotes,
    targetNotes,
    pitchAccuracy,
    sequenceAccuracy,
    noteCount,
    correctNoteCount,
    durationMs,
    notesPerSecond,
    averageNoteDurationMs,
  };
}