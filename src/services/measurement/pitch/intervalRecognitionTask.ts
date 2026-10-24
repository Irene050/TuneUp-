import {
  calcIntervalRatio,
  trackPitchOverTime,
} from '@/utils/dsp/pitch';

export interface IntervalRecognitionAttemptMeasurement {
  freq1: number;
  freq2: number;
  detectedRatio: number;

  hasFirstNote: boolean;
  hasSecondNote: boolean;

  firstNoteClarity: number;
  secondNoteClarity: number;
}

export interface IntervalRecognitionMeasurement {
  freq1: number;
  freq2: number;
  detectedRatio: number;

  hasFirstNote: boolean;
  hasSecondNote: boolean;

  firstNoteClarity: number;
  secondNoteClarity: number;

  attempts: IntervalRecognitionAttemptMeasurement[];
}

const FRAME_MS = 30;

const NOTE_CHANGE_SEMITONES = 1.5;

const MIN_PITCH_HZ = 80;
const MAX_PITCH_HZ = 1000;

// Maximum gap allowed while tracking an individual note.
const MAX_FRAME_GAP_SEC = 0.12;

// Merge neighboring segments when they appear to represent
// the same sustained note.
const MAX_SAME_NOTE_GAP_SEC = 0.45;

// Notes shorter than this are treated as tracking artifacts
// or incomplete detections.
const MIN_NOTE_DURATION_SEC = 0.20;

const MIN_NOTE_FRAMES = 4;

function emptyResult(): IntervalRecognitionMeasurement {
  return {
    freq1: 0,
    freq2: 0,
    detectedRatio: 0,

    hasFirstNote: false,
    hasSecondNote: false,

    firstNoteClarity: 0,
    secondNoteClarity: 0,

    attempts: [],
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b,
  );

  const middle = Math.floor(
    sorted.length / 2,
  );

  return sorted.length % 2 === 0
    ? (
        sorted[middle - 1] +
        sorted[middle]
      ) / 2
    : sorted[middle];
}

function frequencyToMidi(
  frequency: number,
): number {
  if (
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return 0;
  }

  return (
    69 +
    12 *
      Math.log2(
        frequency / 440,
      )
  );
}

interface PitchPoint {
  frequency: number;
  clarity: number;
  timestamp: number;
}

interface DetectedNote {
  frequency: number;
  clarity: number;
  start: number;
  end: number;
}

function getPitchFrames(
  samples: Float32Array,
  sampleRate: number,
  minClarity: number,
): PitchPoint[] {
  const frames = trackPitchOverTime(
    samples,
    FRAME_MS,
    sampleRate,
  );

  // Keep invalid frames as zero-frequency gaps.
  // These gaps help us distinguish tracking dropouts
  // from actual pitch transitions.
  return frames.map(frame => {
    const valid =
      Number.isFinite(frame.frequency) &&
      frame.frequency >= MIN_PITCH_HZ &&
      frame.frequency <= MAX_PITCH_HZ &&
      Number.isFinite(frame.clarity) &&
      frame.clarity >= minClarity;

    return {
      frequency: valid
        ? frame.frequency
        : 0,

      clarity: valid
        ? frame.clarity
        : 0,

      timestamp: frame.timestamp,
    };
  });
}

function createDetectedNote(
  frames: PitchPoint[],
): DetectedNote | null {
  if (frames.length < MIN_NOTE_FRAMES) {
    return null;
  }

  const first = frames[0];
  const last = frames[frames.length - 1];

  if (!first || !last) {
    return null;
  }

  const duration =
    last.timestamp - first.timestamp;

  // Keep short segments for now. A later cleanup step
  // removes short artifacts after attempting to merge
  // fragments of the same note.
  if (duration < 0.09) {
    return null;
  }

  return {
    frequency: median(
      frames.map(frame => frame.frequency),
    ),

    clarity:
      frames.reduce(
        (sum, frame) => sum + frame.clarity,
        0,
      ) / frames.length,

    start: first.timestamp,
    end: last.timestamp,
  };
}

function detectRawNotes(
  frames: PitchPoint[],
): DetectedNote[] {
  const notes: DetectedNote[] = [];

  let currentFrames: PitchPoint[] = [];

  const flushCurrentNote = () => {
    if (currentFrames.length === 0) {
      return;
    }

    const note = createDetectedNote(
      currentFrames,
    );

    if (note) {
      notes.push(note);
    }

    currentFrames = [];
  };

  for (const frame of frames) {
    const valid =
      Number.isFinite(frame.frequency) &&
      frame.frequency >= MIN_PITCH_HZ &&
      frame.frequency <= MAX_PITCH_HZ &&
      Number.isFinite(frame.clarity) &&
      frame.clarity > 0;

    if (!valid) {
      // Don't immediately end the note on a single
      // invalid pitch frame.
      const first = currentFrames[0];

      if (first && currentFrames.length > 0) {
        const last =
          currentFrames[currentFrames.length - 1];

        if (
          last &&
          frame.timestamp - last.timestamp >
            MAX_FRAME_GAP_SEC
        ) {
          flushCurrentNote();
        }
      }

      continue;
    }

    const lastFrame =
      currentFrames[currentFrames.length - 1];

    if (!lastFrame) {
      currentFrames.push(frame);
      continue;
    }

    const gap =
      frame.timestamp - lastFrame.timestamp;

    // A large gap separates two detected note events.
    if (gap > MAX_FRAME_GAP_SEC) {
      flushCurrentNote();
      currentFrames.push(frame);
      continue;
    }

    const currentMedian = median(
      currentFrames.map(
        point => point.frequency,
      ),
    );

    const pitchDifference = Math.abs(
      frequencyToMidi(frame.frequency) -
        frequencyToMidi(currentMedian),
    );

    // A significant pitch change starts a new raw segment.
    if (
      pitchDifference >=
      NOTE_CHANGE_SEMITONES
    ) {
      flushCurrentNote();
      currentFrames.push(frame);
      continue;
    }

    currentFrames.push(frame);
  }

  flushCurrentNote();

  return notes;
}

function mergeSamePitchFragments(
  notes: DetectedNote[],
): DetectedNote[] {
  if (notes.length === 0) {
    return [];
  }

  const merged: DetectedNote[] = [];

  for (const note of notes) {
    const previous =
      merged[merged.length - 1];

    if (!previous) {
      merged.push({ ...note });
      continue;
    }

    const gap =
      note.start - previous.end;

    const pitchDifference = Math.abs(
      frequencyToMidi(note.frequency) -
        frequencyToMidi(previous.frequency),
    );

    const samePitch =
      pitchDifference <
      NOTE_CHANGE_SEMITONES;

    const closeEnough =
      gap >= 0 &&
      gap <= MAX_SAME_NOTE_GAP_SEC;

    if (samePitch && closeEnough) {
      // Combine fragments using their durations as weights.
      const previousDuration = Math.max(
        0,
        previous.end - previous.start,
      );

      const currentDuration = Math.max(
        0,
        note.end - note.start,
      );

      const totalWeight =
        previousDuration + currentDuration;

      const mergedFrequency =
        totalWeight > 0
          ? (
              previous.frequency *
                previousDuration +
              note.frequency *
                currentDuration
            ) / totalWeight
          : median([
              previous.frequency,
              note.frequency,
            ]);

      const mergedClarity =
        totalWeight > 0
          ? (
              previous.clarity *
                previousDuration +
              note.clarity *
                currentDuration
            ) / totalWeight
          : (
              previous.clarity +
              note.clarity
            ) / 2;

      merged[merged.length - 1] = {
        frequency: mergedFrequency,
        clarity: mergedClarity,
        start: previous.start,
        end: note.end,
      };

      continue;
    }

    merged.push({ ...note });
  }

  return merged;
}

function detectNotes(
  frames: PitchPoint[],
): DetectedNote[] {
  const rawNotes = detectRawNotes(frames);

  // Merge same-pitch fragments before filtering short events.
  // This avoids discarding a valid note simply because the
  // pitch tracker briefly lost track of it.
  const mergedNotes =
    mergeSamePitchFragments(rawNotes);

  const stableNotes =
    mergedNotes.filter(note => {
      const duration =
        note.end - note.start;

      return (
        duration >= MIN_NOTE_DURATION_SEC &&
        Number.isFinite(note.frequency) &&
        note.frequency >= MIN_PITCH_HZ &&
        note.frequency <= MAX_PITCH_HZ
      );
    });

  return stableNotes;
}
function buildAttempts(
  notes: DetectedNote[],
  expectedRepetitions: number,
  targetRatio: number,
): IntervalRecognitionAttemptMeasurement[] {
  const requested = Math.max(
    1,
    Math.round(expectedRepetitions),
  );

  const attempts: IntervalRecognitionAttemptMeasurement[] = [];

  if (
    !Number.isFinite(targetRatio) ||
    targetRatio <= 1
  ) {
    console.warn(
      '🎵 INTERVAL: Invalid target ratio:',
      targetRatio,
    );

    return attempts;
  }

  // Allow one intervening false note detection.
  const MAX_NOTES_TO_SKIP = 1;

  // Maximum time between the end of the first note
  // and the beginning of the second note.
  const MAX_INTERVAL_GAP_SEC = 1.25;

  let i = 0;

  while (
    i < notes.length - 1 &&
    attempts.length < requested
  ) {
    const first = notes[i];

    if (!first) {
      i += 1;
      continue;
    }

    let bestMatch:
      | {
          noteIndex: number;
          detectedRatio: number;
          deviationPct: number;
        }
      | undefined;

    // Try the next note, then look one note further
    // in case the tracker inserted a false detection.
    for (
      let skip = 0;
      skip <= MAX_NOTES_TO_SKIP;
      skip += 1
    ) {
      const j = i + 1 + skip;
      const second = notes[j];

      if (!second) {
        continue;
      }

      const gap = second.start - first.end;

      // Reject candidates that overlap substantially or
      // are too far apart to reasonably belong together.
      if (
        gap < -0.05 ||
        gap > MAX_INTERVAL_GAP_SEC
      ) {
        continue;
      }

      // The intended interval is ascending.
      if (second.frequency <= first.frequency) {
        continue;
      }

      const semitoneDifference = Math.abs(
        frequencyToMidi(second.frequency) -
          frequencyToMidi(first.frequency),
      );

      if (
        semitoneDifference < NOTE_CHANGE_SEMITONES
      ) {
        continue;
      }

      const detectedRatio = calcIntervalRatio(
        first.frequency,
        second.frequency,
      );

      if (
        !Number.isFinite(detectedRatio) ||
        detectedRatio < 1.10 ||
        detectedRatio > 2.00
      ) {
        continue;
      }

      const deviationPct =
        Math.abs(detectedRatio - targetRatio) /
        targetRatio *
        100;

      // Retain the existing quality gate for now.
      if (deviationPct > 25) {
        continue;
      }

      // Prefer the closest match to the target interval.
      if (
        !bestMatch ||
        deviationPct < bestMatch.deviationPct
      ) {
        bestMatch = {
          noteIndex: j,
          detectedRatio,
          deviationPct,
        };
      }
    }

    if (!bestMatch) {
      // This event may be a false detection, a note
      // transition, or a note without its matching partner.
      i += 1;
      continue;
    }

    const second = notes[bestMatch.noteIndex];

    if (!second) {
      i += 1;
      continue;
    }

    attempts.push({
      freq1: first.frequency,
      freq2: second.frequency,

      detectedRatio: bestMatch.detectedRatio,

      hasFirstNote: true,
      hasSecondNote: true,

      firstNoteClarity: first.clarity,
      secondNoteClarity: second.clarity,
    });

    // Continue after the matched second note so it
    // cannot be reused as the first note of another pair.
    i = bestMatch.noteIndex + 1;
  }

  console.log(
    '🎵 INTERVAL PAIRING SUMMARY:',
    {
      detectedNotes: notes.length,
      requestedRepetitions: requested,
      acceptedAttempts: attempts.length,
    },
  );

  return attempts;
}

export function measureIntervalRecognition(
  samples: Float32Array,
  sampleRate: number,
  minClarity = 0.70,
  expectedRepetitions = 1,
  targetRatio = 0,
): IntervalRecognitionMeasurement {
  if (
    !samples ||
    samples.length < 4096 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return emptyResult();
  }

  try {
    const pitchFrames = getPitchFrames(
      samples,
      sampleRate,
      minClarity,
    );

    if (pitchFrames.length === 0) {
      return emptyResult();
    }

    const notes = detectNotes(pitchFrames);

    console.log(
      '🎵 INTERVAL PITCH FRAMES:',
      pitchFrames.length,
    );

    console.log(
      '🎵 INTERVAL DETECTED NOTES:',
      notes.map(note => ({
        frequency:
          Math.round(note.frequency * 100) / 100,

        midi:
          Math.round(
            frequencyToMidi(note.frequency) * 100,
          ) / 100,

        clarity:
          Math.round(note.clarity * 100) / 100,

        duration:
          Math.round(
            (note.end - note.start) * 1000,
          ) / 1000,

        start:
          Math.round(note.start * 1000) / 1000,

        end:
          Math.round(note.end * 1000) / 1000,
      })),
    );

    if (notes.length < 2) {
      console.warn(
        '🎵 INTERVAL: Fewer than two stable notes detected.',
      );

      return emptyResult();
    }

    const attempts = buildAttempts(
      notes,
      expectedRepetitions,
      targetRatio,
    );

    console.log(
      '🎵 INTERVAL ATTEMPTS:',
      attempts.map(attempt => ({
        freq1:
          Math.round(attempt.freq1 * 100) / 100,

        freq2:
          Math.round(attempt.freq2 * 100) / 100,

        ratio:
          Math.round(
            attempt.detectedRatio * 1000,
          ) / 1000,

        clarity1:
          Math.round(
            attempt.firstNoteClarity * 100,
          ) / 100,

        clarity2:
          Math.round(
            attempt.secondNoteClarity * 100,
          ) / 100,
      })),
    );

    if (attempts.length === 0) {
      return emptyResult();
    }

    const validAttempts = attempts.filter(
      attempt =>
        attempt.hasFirstNote &&
        attempt.hasSecondNote &&
        Number.isFinite(
          attempt.detectedRatio,
        ) &&
        attempt.detectedRatio > 0,
    );

    if (validAttempts.length === 0) {
      return {
        ...emptyResult(),
        attempts,
      };
    }

    const aggregateFreq1 = median(
      validAttempts.map(
        attempt => attempt.freq1,
      ),
    );

    const aggregateFreq2 = median(
      validAttempts.map(
        attempt => attempt.freq2,
      ),
    );

    const aggregateRatio = median(
      validAttempts.map(
        attempt => attempt.detectedRatio,
      ),
    );

    const aggregateFirstClarity =
      validAttempts.reduce(
        (sum, attempt) =>
          sum + attempt.firstNoteClarity,
        0,
      ) / validAttempts.length;

    const aggregateSecondClarity =
      validAttempts.reduce(
        (sum, attempt) =>
          sum + attempt.secondNoteClarity,
        0,
      ) / validAttempts.length;

    return {
      freq1: aggregateFreq1,
      freq2: aggregateFreq2,
      detectedRatio: aggregateRatio,

      hasFirstNote: true,
      hasSecondNote: true,

      firstNoteClarity:
        aggregateFirstClarity,

      secondNoteClarity:
        aggregateSecondClarity,

      attempts,
    };
  } catch (error) {
    console.error(
      'Interval recognition measurement error:',
      error,
    );

    return emptyResult();
  }
}