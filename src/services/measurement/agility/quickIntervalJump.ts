
import {
  extractAgilityPitchFrames,
  frequencyToMidi,
} from '@/utils/dsp/agility';

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
const MIN_CORRELATION = 0.70;

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const CONFIRMATION_FRAMES = 3;
const NOTE_TOLERANCE_SEMITONES = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type NoteEvent = {
  midi: number;
  timestamp: number;
};

type Alignment = {
  editDistance: number;
  correctNoteCount: number;
  matchedPairs: Array<{
    detectedIndex: number;
    targetIndex: number;
  }>;
};

function alignNotes(
  detected: number[],
  target: number[],
): Alignment {
  const n = detected.length;
  const m = target.length;

  const dp: number[][] = Array.from(
    { length: n + 1 },
    () => Array(m + 1).fill(0),
  );

  const direction: number[][] = Array.from(
    { length: n + 1 },
    () => Array(m + 1).fill(0),
  );

  for (let i = 1; i <= n; i++) {
    dp[i][0] = i;
    direction[i][0] = 2;
  }

  for (let j = 1; j <= m; j++) {
    dp[0][j] = j;
    direction[0][j] = 3;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const error = Math.abs(detected[i - 1] - target[j - 1]);
      const substitutionCost =
        error <= NOTE_TOLERANCE_SEMITONES ? 0 : 1;

      const substitution = dp[i - 1][j - 1] + substitutionCost;
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

  const matchedPairs: Alignment['matchedPairs'] = [];
  let correctNoteCount = 0;
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    const step = direction[i][j];

    if (i > 0 && j > 0 && step === 1) {
      const error = Math.abs(detected[i - 1] - target[j - 1]);

      matchedPairs.push({
        detectedIndex: i - 1,
        targetIndex: j - 1,
      });

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

  matchedPairs.reverse();

  return {
    editDistance: dp[n][m],
    correctNoteCount,
    matchedPairs,
  };
}

function extractStableNoteEvents(
  frames: Array<{ frequency: number; timestamp: number }>,
): NoteEvent[] {
  const events: NoteEvent[] = [];

  let candidateMidi: number | null = null;
  let candidateStartTime = 0;
  let candidateCount = 0;
  let confirmedMidi: number | null = null;

  for (const frame of frames) {
    if (
      !Number.isFinite(frame.frequency) ||
      frame.frequency < MIN_FREQUENCY ||
      frame.frequency > MAX_FREQUENCY
    ) {
      candidateMidi = null;
      candidateCount = 0;
      confirmedMidi = null;
      continue;
    }

    const midi = Math.round(frequencyToMidi(frame.frequency));

    if (!Number.isFinite(midi)) {
      continue;
    }

    if (midi === candidateMidi) {
      candidateCount++;
    } else {
      candidateMidi = midi;
      candidateStartTime = frame.timestamp;
      candidateCount = 1;
    }

    if (candidateCount < CONFIRMATION_FRAMES) {
      continue;
    }

    if (confirmedMidi !== candidateMidi) {
      events.push({
        midi: candidateMidi,
        timestamp: candidateStartTime,
      });
      confirmedMidi = candidateMidi;
    }
  }

  return events;
}

export function measureQuickIntervalJump(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
): QuickIntervalJumpMeasurement {
  const durationMs =
    Number.isFinite(sampleRate) && sampleRate > 0
      ? (samples.length / sampleRate) * 1000
      : 0;

  const targetNotes = targetFrequencies.map((frequency) =>
    Math.round(frequencyToMidi(frequency)),
  );

  const emptyResult = (): QuickIntervalJumpMeasurement => ({
    detectedPitches: [],
    detectedNotes: [],
    targetNotes,
    pitchAccuracy: 0,
    intervalAccuracy: 0,
    noteCount: 0,
    correctNoteCount: 0,
    transitionCount: Math.max(0, targetNotes.length - 1),
    correctTransitionCount: 0,
    transitionTimesMs: [],
    averageTransitionTimeMs: 0,
    durationMs,
  });

  if (
    samples.length < FRAME_SIZE ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    targetNotes.length === 0 ||
    targetNotes.some((note) => !Number.isFinite(note))
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

  const noteEvents = extractStableNoteEvents(pitchFrames);
  const detectedNotes = noteEvents.map((event) => event.midi);

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

  // Pitch accuracy is evaluated using aligned note pairs.
  let totalSemitoneError = 0;

  for (const pair of alignment.matchedPairs) {
    totalSemitoneError += Math.abs(
      detectedNotes[pair.detectedIndex] -
        targetNotes[pair.targetIndex],
    );
  }

  const pitchAccuracy =
    alignment.matchedPairs.length > 0
      ? clamp(
          100 -
            (totalSemitoneError /
              alignment.matchedPairs.length) *
              50,
          0,
          100,
        )
      : 0;

  // Count expected target transitions. A transition is correct
  // only when both adjacent target notes have aligned detections.
  const transitionCount = Math.max(0, targetNotes.length - 1);
  let correctTransitionCount = 0;
  const transitionTimesMs: number[] = [];

  const detectedIndexByTarget = new Map<number, number>();

  for (const pair of alignment.matchedPairs) {
    detectedIndexByTarget.set(pair.targetIndex, pair.detectedIndex);
  }

  for (let targetIndex = 1; targetIndex < targetNotes.length; targetIndex++) {
    const previousDetectedIndex =
      detectedIndexByTarget.get(targetIndex - 1);
    const currentDetectedIndex =
      detectedIndexByTarget.get(targetIndex);

    if (
      previousDetectedIndex === undefined ||
      currentDetectedIndex === undefined
    ) {
      continue;
    }

    const previousNote = detectedNotes[previousDetectedIndex];
    const currentNote = detectedNotes[currentDetectedIndex];

    const detectedInterval = currentNote - previousNote;
    const targetInterval =
      targetNotes[targetIndex] - targetNotes[targetIndex - 1];

    if (
      Math.abs(detectedInterval - targetInterval) <=
      NOTE_TOLERANCE_SEMITONES
    ) {
      correctTransitionCount++;

      const elapsed =
        noteEvents[currentDetectedIndex].timestamp -
        noteEvents[previousDetectedIndex].timestamp;

      if (Number.isFinite(elapsed) && elapsed > 0) {
        transitionTimesMs.push(elapsed);
      }
    }
  }

  const intervalAccuracy =
    transitionCount > 0
      ? (correctTransitionCount / transitionCount) * 100
      : 0;

  const averageTransitionTimeMs =
    transitionTimesMs.length > 0
      ? transitionTimesMs.reduce((sum, value) => sum + value, 0) /
        transitionTimesMs.length
      : 0;

  return {
    detectedPitches,
    detectedNotes,
    targetNotes,
    pitchAccuracy,
    intervalAccuracy,
    noteCount: detectedNotes.length,
    correctNoteCount: alignment.correctNoteCount,
    transitionCount,
    correctTransitionCount,
    transitionTimesMs,
    averageTransitionTimeMs,
    durationMs,
  };
}