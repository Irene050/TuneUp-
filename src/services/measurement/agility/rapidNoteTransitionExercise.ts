import {
  extractAgilityNotes,
  extractAgilityPitchFrames,
} from '@/utils/dsp/agility';

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

type NoteEvent = {
  midi: number;
  timestampMs: number;
};

type AlignedNote = {
  detectedIndex: number;
  targetIndex: number;
};

const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 1000;
const MIN_RMS = 0.008;
const MIN_CORRELATION = 0.65;
const PITCH_TOLERANCE_PERCENT = 7;
const MAX_SEQUENCE_SEMITONE_ERROR = 1;

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const NOTE_CONFIRMATION_FRAMES = 2;

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function frequencyDeviationPercent(
  detectedMidi: number,
  targetFrequency: number,
): number {
  if (
    !Number.isFinite(detectedMidi) ||
    !Number.isFinite(targetFrequency) ||
    targetFrequency <= 0
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const detectedFrequency = midiToFrequency(detectedMidi);

  return (
    (Math.abs(detectedFrequency - targetFrequency) /
      targetFrequency) *
    100
  );
}

/**
 * Aligns detected notes to target notes using the longest
 * common subsequence algorithm. A detected note matches a
 * target note when it is within the allowed semitone error.
 *
 * The alignment preserves order and does not count a detected
 * note more than once.
 */
function alignNotes(
  detectedNotes: number[],
  targetFrequencies: number[],
): AlignedNote[] {
  const targetMidi = targetFrequencies.map((frequency) =>
    Math.round(69 + 12 * Math.log2(frequency / 440)),
  );

  const rows = detectedNotes.length + 1;
  const columns = targetMidi.length + 1;

  const dp: number[][] = Array.from(
    { length: rows },
    () => Array<number>(columns).fill(0),
  );

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const matches =
        Math.abs(detectedNotes[i - 1] - targetMidi[j - 1]) <=
        MAX_SEQUENCE_SEMITONE_ERROR;

      if (matches) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const aligned: AlignedNote[] = [];

  let i = detectedNotes.length;
  let j = targetMidi.length;

  while (i > 0 && j > 0) {
    const matches =
      Math.abs(detectedNotes[i - 1] - targetMidi[j - 1]) <=
      MAX_SEQUENCE_SEMITONE_ERROR;

    if (matches && dp[i][j] === dp[i - 1][j - 1] + 1) {
      aligned.push({
        detectedIndex: i - 1,
        targetIndex: j - 1,
      });

      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  return aligned.reverse();
}

function calculatePitchAccuracy(
  detectedNotes: number[],
  targetFrequencies: number[],
  alignedNotes: AlignedNote[],
): number {
  const denominator = Math.max(
    detectedNotes.length,
    targetFrequencies.length,
  );

  if (denominator === 0) {
    return 0;
  }

  let totalPoints = 0;

  for (const match of alignedNotes) {
    const detectedMidi = detectedNotes[match.detectedIndex];
    const targetFrequency = targetFrequencies[match.targetIndex];

    const deviationPercent = frequencyDeviationPercent(
      detectedMidi,
      targetFrequency,
    );

    if (deviationPercent <= PITCH_TOLERANCE_PERCENT) {
      const noteScore =
        1 - deviationPercent / PITCH_TOLERANCE_PERCENT;

      totalPoints += clamp(noteScore, 0, 1);
    }
  }

  return clamp((totalPoints / denominator) * 100);
}

function calculateSequenceAccuracy(
  detectedNotes: number[],
  targetFrequencies: number[],
  alignedNotes: AlignedNote[],
): number {
  const denominator = Math.max(
    detectedNotes.length,
    targetFrequencies.length,
  );

  if (denominator === 0) {
    return 0;
  }

  return clamp((alignedNotes.length / denominator) * 100);
}

function calculateTransitions(noteEvents: NoteEvent[]): {
  transitionCount: number;
  transitionTimesMs: number[];
  averageTransitionTimeMs: number;
  transitionsPerSecond: number;
} {
  const validEvents = noteEvents.filter(
    (event) =>
      Number.isFinite(event.midi) &&
      Number.isFinite(event.timestampMs) &&
      event.timestampMs >= 0,
  );

  let transitionCount = 0;
  let previousTransitionTime: number | null = null;

  const transitionTimesMs: number[] = [];

  for (let i = 1; i < validEvents.length; i += 1) {
    const previous = validEvents[i - 1];
    const current = validEvents[i];

    if (Math.abs(current.midi - previous.midi) < 1) {
      continue;
    }

    transitionCount += 1;

    if (previousTransitionTime !== null) {
      const interval =
        current.timestampMs - previousTransitionTime;

      if (Number.isFinite(interval) && interval > 0) {
        transitionTimesMs.push(interval);
      }
    }

    previousTransitionTime = current.timestampMs;
  }

  const totalIntervalMs = transitionTimesMs.reduce(
    (sum, interval) => sum + interval,
    0,
  );

  const averageTransitionTimeMs =
    transitionTimesMs.length > 0
      ? totalIntervalMs / transitionTimesMs.length
      : 0;

  const transitionsPerSecond =
    totalIntervalMs > 0
      ? (transitionTimesMs.length / totalIntervalMs) * 1000
      : 0;

  return {
    transitionCount,
    transitionTimesMs,
    averageTransitionTimeMs,
    transitionsPerSecond,
  };
}

export function measureRapidNoteTransition(
  samples: Float32Array,
  sampleRate: number,
  targetFrequencies: number[],
): RapidNoteTransitionMeasurement {
  const durationMs =
    sampleRate > 0
      ? (samples.length / sampleRate) * 1000
      : 0;

  const emptyResult: RapidNoteTransitionMeasurement = {
    detectedPitches: [],
    detectedNotes: [],
    targetNotes: targetFrequencies,
    pitchAccuracy: 0,
    sequenceAccuracy: 0,
    transitionCount: 0,
    transitionTimesMs: [],
    averageTransitionTimeMs: 0,
    transitionsPerSecond: 0,
    durationMs,
  };

  if (
    !(samples instanceof Float32Array) ||
    samples.length === 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    targetFrequencies.length === 0 ||
    targetFrequencies.some(
      (frequency) =>
        !Number.isFinite(frequency) || frequency <= 0,
    )
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
      minCorrelation: MIN_CORRELATION,
    },
  );

  const detectedPitches = pitchFrames
    .map((frame) => frame.frequency)
    .filter(
      (frequency) =>
        Number.isFinite(frequency) && frequency > 0,
    );

  const noteEvents = extractAgilityNotes(
    pitchFrames,
    NOTE_CONFIRMATION_FRAMES,
  );

  const detectedNotes = noteEvents.map((event) => event.midi);

  const alignedNotes = alignNotes(
    detectedNotes,
    targetFrequencies,
  );

  const pitchAccuracy = calculatePitchAccuracy(
    detectedNotes,
    targetFrequencies,
    alignedNotes,
  );

  const sequenceAccuracy = calculateSequenceAccuracy(
    detectedNotes,
    targetFrequencies,
    alignedNotes,
  );

  const transitionMetrics = calculateTransitions(noteEvents);

  return {
    detectedPitches,
    detectedNotes,
    targetNotes: targetFrequencies,
    pitchAccuracy,
    sequenceAccuracy,
    ...transitionMetrics,
    durationMs,
  };
}