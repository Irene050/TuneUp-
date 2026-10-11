
import {
  extractAgilityNotes,
  extractAgilityPitchFrames,
  frequencyToMidi,
} from '@/utils/dsp/agility';

export type RapidScaleTrillMeasurement = {
  detectedPitches: number[];
  detectedNotes: number[];
  targetNotes: number[];
  pitchAccuracy: number;
  sequenceAccuracy: number;
  transitionAccuracy: number;
  noteCount: number;
  correctNoteCount: number;
  transitionCount: number;
  correctTransitionCount: number;
  transitionTimesMs: number[];
  averageTransitionTimeMs: number;
  durationMs: number;
  notesPerSecond: number;
};

const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 1000;
const MIN_RMS = 0.008;

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

// Two consecutive frames help reject brief pitch fluctuations.
// At 44.1 kHz with a 1024-sample hop, this is roughly 23 ms
// between frames, though confirmation also depends on pitch validity.
const NOTE_CONFIRMATION_FRAMES = 2;

const MIN_CORRELATION = 0.3;
const NOTE_TOLERANCE_SEMITONES = 1;

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function createEmptyMeasurement(
  targetNotes: number[],
  durationMs: number,
): RapidScaleTrillMeasurement {
  return {
    detectedPitches: [],
    detectedNotes: [],
    targetNotes,
    pitchAccuracy: 0,
    sequenceAccuracy: 0,
    transitionAccuracy: 0,
    noteCount: 0,
    correctNoteCount: 0,
    transitionCount: 0,
    correctTransitionCount: 0,
    transitionTimesMs: [],
    averageTransitionTimeMs: 0,
    durationMs,
    notesPerSecond: 0,
  };
}

export function measureRapidScaleTrill(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
): RapidScaleTrillMeasurement {
  const durationMs =
    sampleRate > 0
      ? (samples.length / sampleRate) * 1000
      : 0;

  const targetNotes = targetFrequencies
    .filter(
      (frequency) =>
        Number.isFinite(frequency) && frequency > 0,
    )
    .map((frequency) =>
      Math.round(frequencyToMidi(frequency)),
    );

  if (
    samples.length < FRAME_SIZE ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    targetNotes.length === 0
  ) {
    return createEmptyMeasurement(
      targetNotes,
      durationMs,
    );
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
      minCorrelation: MIN_CORRELATION,
    },
  );

  const detectedPitches = pitchFrames.map(
    (frame) => frame.frequency,
  );

  const detectedNotesWithTiming = extractAgilityNotes(
    pitchFrames,
    NOTE_CONFIRMATION_FRAMES,
  );

  const detectedNotes = detectedNotesWithTiming.map(
    (note) => note.midi,
  );

  const detectionTimesMs = detectedNotesWithTiming.map(
    (note) => note.timestampMs,
  );

  if (detectedNotes.length === 0) {
    return {
      ...createEmptyMeasurement(
        targetNotes,
        durationMs,
      ),
      detectedPitches,
    };
  }

  // Compare each detected note against the corresponding target.
  // Missing detected notes reduce sequence accuracy because the
  // denominator is the full target sequence length.
  const comparedCount = Math.min(
    detectedNotes.length,
    targetNotes.length,
  );

  let correctNoteCount = 0;
  let totalSemitoneError = 0;

  for (let i = 0; i < comparedCount; i++) {
    const error = Math.abs(
      detectedNotes[i] - targetNotes[i],
    );

    totalSemitoneError += error;

    if (error <= NOTE_TOLERANCE_SEMITONES) {
      correctNoteCount++;
    }
  }

  const sequenceAccuracy =
    targetNotes.length > 0
      ? (correctNoteCount / targetNotes.length) * 100
      : 0;

  // Keep pitch accuracy separate from sequence completeness.
  // Extra detected notes cannot increase either score.
  const averageSemitoneError =
    comparedCount > 0
      ? totalSemitoneError / comparedCount
      : 12;

  const pitchAccuracy = clamp(
    100 - averageSemitoneError * 50,
    0,
    100,
  );

  // Count actual detected transitions.
  const transitionCount = Math.max(
    0,
    detectedNotes.length - 1,
  );

  const targetTransitionCount = Math.max(
    0,
    targetNotes.length - 1,
  );

  const transitionTimesMs: number[] = [];

  for (let i = 1; i < detectionTimesMs.length; i++) {
    const elapsed =
      detectionTimesMs[i] - detectionTimesMs[i - 1];

    if (Number.isFinite(elapsed) && elapsed > 0) {
      transitionTimesMs.push(elapsed);
    }
  }

  let correctTransitionCount = 0;

  const comparableTransitions = Math.min(
    transitionCount,
    targetTransitionCount,
  );

  for (let i = 0; i < comparableTransitions; i++) {
    const detectedInterval =
      detectedNotes[i + 1] - detectedNotes[i];

    const targetInterval =
      targetNotes[i + 1] - targetNotes[i];

    if (
      Math.abs(detectedInterval - targetInterval) <=
      NOTE_TOLERANCE_SEMITONES
    ) {
      correctTransitionCount++;
    }
  }

  const transitionAccuracy =
    targetTransitionCount > 0
      ? (correctTransitionCount /
          targetTransitionCount) *
        100
      : 0;

  const averageTransitionTimeMs =
    transitionTimesMs.length > 0
      ? transitionTimesMs.reduce(
          (sum, time) => sum + time,
          0,
        ) / transitionTimesMs.length
      : 0;

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
    transitionAccuracy,
    noteCount: detectedNotes.length,
    correctNoteCount,
    transitionCount,
    correctTransitionCount,
    transitionTimesMs,
    averageTransitionTimeMs,
    durationMs,
    notesPerSecond,
  };
}
