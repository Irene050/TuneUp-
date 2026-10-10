
import {
  extractAgilityNotes,
  extractAgilityPitchFrames,
  frequencyToMidi,
} from '@/utils/dsp/agility';

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
const MIN_CORRELATION = 0.70;

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const CONFIRMATION_FRAMES = 3;
const NOTE_TOLERANCE_SEMITONES = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type AlignmentResult = {
  correctNoteCount: number;
  totalError: number;
  matchedTargetIndices: number[];
  matchedDetectedIndices: number[];
  editDistance: number;
};

function alignNotes(
  detectedNotes: number[],
  targetNotes: number[],
): AlignmentResult {
  const detectedLength = detectedNotes.length;
  const targetLength = targetNotes.length;

  const dp: number[][] = Array.from(
    { length: detectedLength + 1 },
    () => Array(targetLength + 1).fill(0),
  );

  const direction: number[][] = Array.from(
    { length: detectedLength + 1 },
    () => Array(targetLength + 1).fill(0),
  );

  // 1 = match/substitution, 2 = extra detected note, 3 = missed target.
  for (let i = 1; i <= detectedLength; i++) {
    dp[i][0] = i;
    direction[i][0] = 2;
  }

  for (let j = 1; j <= targetLength; j++) {
    dp[0][j] = j;
    direction[0][j] = 3;
  }

  for (let i = 1; i <= detectedLength; i++) {
    for (let j = 1; j <= targetLength; j++) {
      const error = Math.abs(
        detectedNotes[i - 1] - targetNotes[j - 1],
      );

      const substitutionCost =
        error <= NOTE_TOLERANCE_SEMITONES ? 0 : 1;

      const substitution =
        dp[i - 1][j - 1] + substitutionCost;
      const insertion = dp[i - 1][j] + 1;
      const deletion = dp[i][j - 1] + 1;

      const best = Math.min(substitution, insertion, deletion);
      dp[i][j] = best;

      if (best === substitution) {
        direction[i][j] = 1;
      } else if (best === insertion) {
        direction[i][j] = 2;
      } else {
        direction[i][j] = 3;
      }
    }
  }

  const matchedTargetIndices: number[] = [];
  const matchedDetectedIndices: number[] = [];

  let correctNoteCount = 0;
  let totalError = 0;

  let i = detectedLength;
  let j = targetLength;

  while (i > 0 || j > 0) {
    const step = direction[i][j];

    if (i > 0 && j > 0 && step === 1) {
      const detectedIndex = i - 1;
      const targetIndex = j - 1;

      const error = Math.abs(
        detectedNotes[detectedIndex] - targetNotes[targetIndex],
      );

      matchedDetectedIndices.push(detectedIndex);
      matchedTargetIndices.push(targetIndex);
      totalError += error;

      if (error <= NOTE_TOLERANCE_SEMITONES) {
        correctNoteCount++;
      }

      i--;
      j--;
    } else if (i > 0 && (j === 0 || step === 2)) {
      i--;
    } else if (j > 0) {
      j--;
    } else {
      break;
    }
  }

  matchedTargetIndices.reverse();
  matchedDetectedIndices.reverse();

  return {
    correctNoteCount,
    totalError,
    matchedTargetIndices,
    matchedDetectedIndices,
    editDistance: dp[detectedLength][targetLength],
  };
}

export function measureVocalRunAccuracy(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
): VocalRunAccuracyMeasurement {
  const durationMs =
    Number.isFinite(sampleRate) && sampleRate > 0
      ? (samples.length / sampleRate) * 1000
      : 0;

  const targetNotes = targetFrequencies.map((frequency) =>
    Math.round(frequencyToMidi(frequency)),
  );

  const emptyResult = (): VocalRunAccuracyMeasurement => ({
    detectedPitches: [],
    detectedNotes: [],
    targetNotes,
    pitchAccuracy: 0,
    sequenceAccuracy: 0,
    noteCount: 0,
    correctNoteCount: 0,
    transitionCount: 0,
    correctTransitionCount: 0,
    durationMs,
    notesPerSecond: 0,
  });

  if (
    targetNotes.length === 0 ||
    targetNotes.some((note) => !Number.isFinite(note)) ||
    samples.length < FRAME_SIZE ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return emptyResult();
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

  const noteEvents = extractAgilityNotes(
    pitchFrames,
    CONFIRMATION_FRAMES,
  );

  const detectedNotes = noteEvents.map((note) => note.midi);

  if (detectedNotes.length === 0) {
    return {
      ...emptyResult(),
      detectedPitches,
    };
  }

  const alignment = alignNotes(detectedNotes, targetNotes);

  const sequenceAccuracy = clamp(
    100 *
      (1 -
        alignment.editDistance /
          Math.max(detectedNotes.length, targetNotes.length)),
    0,
    100,
  );

  const averageSemitoneError =
    alignment.matchedDetectedIndices.length > 0
      ? alignment.totalError /
        alignment.matchedDetectedIndices.length
      : 12;

  const pitchAccuracy = clamp(
    100 - averageSemitoneError * 50,
    0,
    100,
  );

  let transitionCount = 0;
  let correctTransitionCount = 0;

  for (
    let index = 1;
    index < alignment.matchedDetectedIndices.length;
    index++
  ) {
    const previousDetectedIndex =
      alignment.matchedDetectedIndices[index - 1];
    const currentDetectedIndex =
      alignment.matchedDetectedIndices[index];

    const previousTargetIndex =
      alignment.matchedTargetIndices[index - 1];
    const currentTargetIndex =
      alignment.matchedTargetIndices[index];

    // Only score consecutive target notes.
    // Extra detected notes no longer cause the transition
    // to be silently excluded.
    if (currentTargetIndex !== previousTargetIndex + 1) {
      continue;
    }

    transitionCount++;

    const detectedInterval =
      detectedNotes[currentDetectedIndex] -
      detectedNotes[previousDetectedIndex];

    const targetInterval =
      targetNotes[currentTargetIndex] -
      targetNotes[previousTargetIndex];

    if (
      Math.abs(detectedInterval - targetInterval) <=
      NOTE_TOLERANCE_SEMITONES
    ) {
      correctTransitionCount++;
    }
  }

  const durationSeconds = durationMs / 1000;

  return {
    detectedPitches,
    detectedNotes,
    targetNotes,
    pitchAccuracy,
    sequenceAccuracy,
    noteCount: detectedNotes.length,
    correctNoteCount: alignment.correctNoteCount,
    transitionCount,
    correctTransitionCount,
    durationMs,
    notesPerSecond:
      durationSeconds > 0
        ? detectedNotes.length / durationSeconds
        : 0,
  };
}
