import {
  extractAgilityNotes,
  extractAgilityPitchFrames,
} from '@/utils/dsp/agility';

import { frequencyToMidi, midiToFrequency } from '@/utils/music/notes';

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
  targetNotesPerSecond: number;
};

const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 1000;
const MIN_RMS = 0.008;
const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const DEFAULT_PITCH_TOLERANCE_PERCENT = 7;
const DEFAULT_EXPECTED_NOTE_INTERVAL_SEC = 0.73;
const NOTE_CONFIRMATION_FRAMES = 2;

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

type PitchAlignment = {
  accuracy: number;
  correctCount: number;
};

function calculatePitchAccuracy(
  detectedNotes: number[],
  targetFrequencies: number[],
  tolerancePercent: number,
): PitchAlignment {
  if (!detectedNotes.length || !targetFrequencies.length) {
    return { accuracy: 0, correctCount: 0 };
  }

  const detectedFrequencies = detectedNotes.map(midiToFrequency);
  const detectedCount = detectedFrequencies.length;
  const targetCount = targetFrequencies.length;
  const tolerance = Math.max(tolerancePercent, 0.1);

  const dp: number[][] = Array.from(
    { length: detectedCount + 1 },
    () => Array(targetCount + 1).fill(0),
  );

  const action: ('match' | 'extra' | 'missing')[][] = Array.from(
    { length: detectedCount + 1 },
    () => Array(targetCount + 1).fill('match'),
  );

  for (let i = 1; i <= detectedCount; i++) {
    dp[i][0] = i;
    action[i][0] = 'extra';
  }

  for (let j = 1; j <= targetCount; j++) {
    dp[0][j] = j;
    action[0][j] = 'missing';
  }

  for (let i = 1; i <= detectedCount; i++) {
    for (let j = 1; j <= targetCount; j++) {
      const detectedFrequency = detectedFrequencies[i - 1];
      const targetFrequency = targetFrequencies[j - 1];

      const errorPercent =
        Number.isFinite(detectedFrequency) &&
        Number.isFinite(targetFrequency) &&
        targetFrequency > 0
          ? (Math.abs(detectedFrequency - targetFrequency) /
              targetFrequency) *
            100
          : 100;

      const matchCost = clamp(errorPercent / tolerance, 0, 1);

      const match = dp[i - 1][j - 1] + matchCost;
      const extra = dp[i - 1][j] + 1;
      const missing = dp[i][j - 1] + 1;

      if (match <= extra && match <= missing) {
        dp[i][j] = match;
        action[i][j] = 'match';
      } else if (extra <= missing) {
        dp[i][j] = extra;
        action[i][j] = 'extra';
      } else {
        dp[i][j] = missing;
        action[i][j] = 'missing';
      }
    }
  }

  let i = detectedCount;
  let j = targetCount;
  let totalScore = 0;
  let correctCount = 0;

  while (i > 0 || j > 0) {
    const currentAction = action[i][j];

    if (i > 0 && j > 0 && currentAction === 'match') {
      const detectedFrequency = detectedFrequencies[i - 1];
      const targetFrequency = targetFrequencies[j - 1];

      if (
        Number.isFinite(detectedFrequency) &&
        Number.isFinite(targetFrequency) &&
        targetFrequency > 0
      ) {
        const errorPercent =
          (Math.abs(detectedFrequency - targetFrequency) /
            targetFrequency) *
          100;

        totalScore += clamp(
          100 - (errorPercent / tolerance) * 100,
        );

        if (errorPercent <= tolerance) {
          correctCount++;
        }
      }

      i--;
      j--;
    } else if (i > 0 && (j === 0 || currentAction === 'extra')) {
      i--;
    } else if (j > 0) {
      j--;
    } else {
      break;
    }
  }

  const denominator = Math.max(detectedCount, targetCount);

  return {
    accuracy: Math.round(clamp(totalScore / denominator)),
    correctCount,
  };
}

function calculateSequenceAccuracy(
  detectedNotes: number[],
  targetFrequencies: number[],
): { accuracy: number; correctCount: number } {
  const targetMidi = targetFrequencies.map((frequency) =>
    Math.round(frequencyToMidi(frequency)),
  );

  if (!detectedNotes.length || !targetMidi.length) {
    return { accuracy: 0, correctCount: 0 };
  }

  const rows = detectedNotes.length + 1;
  const columns = targetMidi.length + 1;

  const dp: number[][] = Array.from(
    { length: rows },
    () => Array(columns).fill(0),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      if (
        Math.abs(detectedNotes[i - 1] - targetMidi[j - 1]) <= 1
      ) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const correctCount = dp[rows - 1][columns - 1];
  const denominator = Math.max(detectedNotes.length, targetMidi.length);

  return {
    accuracy: Math.round(
      clamp((correctCount / denominator) * 100),
    ),
    correctCount,
  };
}

export function measureArpeggioSpeed(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
  pitchTolerancePercent = DEFAULT_PITCH_TOLERANCE_PERCENT,
  expectedNoteIntervalSec = DEFAULT_EXPECTED_NOTE_INTERVAL_SEC,
): ArpeggioSpeedMeasurement {
  const durationMs =
    sampleRate > 0 ? (samples.length / sampleRate) * 1000 : 0;

  const targetNotes = targetFrequencies.map(frequencyToMidi);

  const targetNotesPerSecond =
    Number.isFinite(expectedNoteIntervalSec) &&
    expectedNoteIntervalSec > 0
      ? 1 / expectedNoteIntervalSec
      : 1 / DEFAULT_EXPECTED_NOTE_INTERVAL_SEC;

  const emptyResult: ArpeggioSpeedMeasurement = {
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
    targetNotesPerSecond,
  };

  if (
    samples.length < FRAME_SIZE ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    targetFrequencies.length === 0
  ) {
    return emptyResult;
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
      minCorrelation: 0.3,
    },
  );

  const detectedPitches = pitchFrames.map(
    (frame) => frame.frequency,
  );

  const extractedNotes = extractAgilityNotes(
    pitchFrames,
    NOTE_CONFIRMATION_FRAMES,
  );

  const detectedNotes = extractedNotes.map((note) => note.midi);

  if (!detectedNotes.length) {
    return { ...emptyResult, detectedPitches };
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

  const firstTimestamp = extractedNotes[0].timestampMs;
  const lastTimestamp =
    extractedNotes[extractedNotes.length - 1].timestampMs;

  const activeSpanMs = lastTimestamp - firstTimestamp;

  const notesPerSecond =
    detectedNotes.length > 1 && activeSpanMs > 0
      ? (detectedNotes.length - 1) / (activeSpanMs / 1000)
      : 0;

  const averageNoteDurationMs =
    detectedNotes.length > 1
      ? activeSpanMs / (detectedNotes.length - 1)
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
    targetNotesPerSecond,
  };
}
