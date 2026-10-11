
import {
  extractAgilityNotes,
  extractAgilityPitchFrames,
  frequencyToMidi,
} from '@/utils/dsp/agility';

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
const DEFAULT_PITCH_TOLERANCE_PERCENT = 7;
const NOTE_CONFIRMATION_FRAMES = 2;

function clamp(
  value: number,
  min = 0,
  max = 100,
): number {
  return Math.max(min, Math.min(max, value));
}

function calculatePitchAccuracy(
  detectedNotes: number[],
  targetFrequencies: number[],
  tolerancePercent: number,
): {
  accuracy: number;
  correctCount: number;
} {
  if (!detectedNotes.length || !targetFrequencies.length) {
    return {
      accuracy: 0,
      correctCount: 0,
    };
  }

  const compareLength = Math.min(
    detectedNotes.length,
    targetFrequencies.length,
  );

  if (compareLength === 0) {
    return {
      accuracy: 0,
      correctCount: 0,
    };
  }

  let correctCount = 0;
  let totalErrorPercent = 0;

  for (let i = 0; i < compareLength; i++) {
    const detectedFrequency =
      440 * Math.pow(2, (detectedNotes[i] - 69) / 12);

    const targetFrequency = targetFrequencies[i];

    if (
      !Number.isFinite(detectedFrequency) ||
      !Number.isFinite(targetFrequency) ||
      targetFrequency <= 0
    ) {
      continue;
    }

    const errorPercent =
      (Math.abs(detectedFrequency - targetFrequency) /
        targetFrequency) *
      100;

    totalErrorPercent += errorPercent;

    if (errorPercent <= tolerancePercent) {
      correctCount++;
    }
  }

  // Preserve the original denominator behavior.
  const averageErrorPercent = totalErrorPercent / compareLength;

  const accuracy = clamp(
    100 -
      (averageErrorPercent / Math.max(tolerancePercent, 0.001)) *
        100,
  );

  return {
    accuracy: Math.round(accuracy),
    correctCount,
  };
}

function calculateSequenceAccuracy(
  detectedNotes: number[],
  targetFrequencies: number[],
): {
  accuracy: number;
  correctCount: number;
} {
  if (!detectedNotes.length || !targetFrequencies.length) {
    return {
      accuracy: 0,
      correctCount: 0,
    };
  }

  const targetMidi = targetFrequencies.map((frequency) =>
    Math.round(frequencyToMidi(frequency)),
  );

  const compareLength = Math.min(
    detectedNotes.length,
    targetMidi.length,
  );

  let correctCount = 0;

  for (let i = 0; i < compareLength; i++) {
    if (Math.abs(detectedNotes[i] - targetMidi[i]) <= 1) {
      correctCount++;
    }
  }

  const sequenceLength = Math.max(
    detectedNotes.length,
    targetMidi.length,
  );

  const accuracy =
    sequenceLength > 0
      ? (correctCount / sequenceLength) * 100
      : 0;

  return {
    accuracy: Math.round(clamp(accuracy)),
    correctCount,
  };
}

export function measureArpeggioSpeed(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
  pitchTolerancePercent = DEFAULT_PITCH_TOLERANCE_PERCENT,
): ArpeggioSpeedMeasurement {
  const durationMs =
    sampleRate > 0
      ? (samples.length / sampleRate) * 1000
      : 0;

  const targetNotes = targetFrequencies.map(frequencyToMidi);

  if (
    samples.length === 0 ||
    sampleRate <= 0 ||
    targetFrequencies.length === 0
  ) {
    return {
      detectedPitches: [],
      detectedNotes: [],
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

  const pitchFrames = extractAgilityPitchFrames(
    samples,
    sampleRate,
    FRAME_SIZE,
    HOP_SIZE,
    {
      minFrequency: MIN_FREQUENCY,
      maxFrequency: MAX_FREQUENCY,
      minRms: MIN_RMS,
      minCorrelation: 0,
    },
  );

  const detectedPitches = pitchFrames.map(
    (frame) => frame.frequency,
  );

  const detectedNotes = extractAgilityNotes(
    pitchFrames,
    NOTE_CONFIRMATION_FRAMES,
  ).map((note) => note.midi);

  if (detectedNotes.length === 0) {
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

  const pitchResult = calculatePitchAccuracy(
    detectedNotes,
    targetFrequencies,
    Math.max(pitchTolerancePercent, 0.1),
  );

  const sequenceResult = calculateSequenceAccuracy(
    detectedNotes,
    targetFrequencies,
  );

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
    pitchAccuracy: pitchResult.accuracy,
    sequenceAccuracy: sequenceResult.accuracy,
    noteCount: detectedNotes.length,
    correctNoteCount: sequenceResult.correctCount,
    durationMs,
    notesPerSecond,
    averageNoteDurationMs,
  };
}
