import {
  calcIntervalRatio,
  filterByClarity,
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

const RMS_WINDOW_MS = 30;
const RMS_HOP_MS = 15;

const SILENCE_RMS = 0.003;
const MIN_SILENCE_MS = 120;
const MIN_NOTE_MS = 250;

const NOTE_EDGE_MS = 150;

const MIN_PITCH_HZ = 80;
const MAX_PITCH_HZ = 1000;

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

function rms(
  samples: Float32Array,
  start: number,
  end: number,
): number {
  const safeStart = Math.max(0, Math.floor(start));
  const safeEnd = Math.min(samples.length, Math.floor(end));

  let sum = 0;
  let count = 0;

  for (let i = safeStart; i < safeEnd; i++) {
    const value = samples[i];

    if (!Number.isFinite(value)) {
      continue;
    }

    sum += value * value;
    count++;
  }

  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function findVoicedSegments(
  samples: Float32Array,
  sampleRate: number,
): Array<{ start: number; end: number }> {
  const window = Math.max(
    1,
    Math.floor((RMS_WINDOW_MS / 1000) * sampleRate),
  );

  const hop = Math.max(
    1,
    Math.floor((RMS_HOP_MS / 1000) * sampleRate),
  );

  const minimumNoteSamples = Math.floor(
    (MIN_NOTE_MS / 1000) * sampleRate,
  );

  const requiredQuietFrames = Math.ceil(
    MIN_SILENCE_MS / RMS_HOP_MS,
  );

  const segments: Array<{
    start: number;
    end: number;
  }> = [];

  let currentStart = -1;
  let quietFrames = 0;

  for (
    let start = 0;
    start + window <= samples.length;
    start += hop
  ) {
    const voiced =
      rms(samples, start, start + window) >= SILENCE_RMS;

    if (voiced) {
      if (currentStart < 0) {
        currentStart = start;
      }

      quietFrames = 0;
      continue;
    }

    if (currentStart < 0) {
      continue;
    }

    quietFrames++;

    if (quietFrames >= requiredQuietFrames) {
      const end =
        start - (quietFrames - 1) * hop;

      if (end - currentStart >= minimumNoteSamples) {
        segments.push({
          start: currentStart,
          end: Math.min(samples.length, end),
        });
      }

      currentStart = -1;
      quietFrames = 0;
    }
  }

  // Handle a note that continues until the end
  // of the recording.
  if (currentStart >= 0) {
    const end = samples.length;

    if (end - currentStart >= minimumNoteSamples) {
      segments.push({
        start: currentStart,
        end,
      });
    }
  }

  return segments;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function analyzeNote(
  samples: Float32Array,
  sampleRate: number,
  minClarity: number,
): {
  frequency: number;
  clarity: number;
} {
  if (samples.length < 2048) {
    return {
      frequency: 0,
      clarity: 0,
    };
  }

  const edge = Math.floor(
    (NOTE_EDGE_MS / 1000) * sampleRate,
  );

  const hasEnoughEdgeSpace =
    samples.length > edge + 2048;

  const start = hasEnoughEdgeSpace ? edge : 0;
  const end = hasEnoughEdgeSpace
    ? samples.length - edge
    : samples.length;

  if (end <= start) {
    return {
      frequency: 0,
      clarity: 0,
    };
  }

  const segment = samples.subarray(start, end);

  const frames = filterByClarity(
    trackPitchOverTime(
      segment,
      30,
      sampleRate,
    ),
    minClarity,
  );

  const validFrames = frames.filter(
    frame =>
      Number.isFinite(frame.frequency) &&
      frame.frequency >= MIN_PITCH_HZ &&
      frame.frequency <= MAX_PITCH_HZ,
  );

  if (validFrames.length === 0) {
    return {
      frequency: 0,
      clarity: 0,
    };
  }

  return {
    frequency: median(
      validFrames.map(frame => frame.frequency),
    ),

    clarity:
      validFrames.reduce(
        (sum, frame) => sum + frame.clarity,
        0,
      ) / validFrames.length,
  };
}

export function measureIntervalRecognition(
  samples: Float32Array,
  sampleRate: number,
  minClarity = 0.70,
  expectedRepetitions = 1,
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
    const segments = findVoicedSegments(
      samples,
      sampleRate,
    );

    if (segments.length < 2) {
      return emptyResult();
    }

    const requestedRepetitions = Math.max(
      1,
      Math.round(expectedRepetitions),
    );

    const maximumPairs = Math.floor(
      segments.length / 2,
    );

    const pairCount = Math.min(
      maximumPairs,
      requestedRepetitions,
    );

    const attempts: IntervalRecognitionAttemptMeasurement[] = [];

    for (
      let pairIndex = 0;
      pairIndex < pairCount;
      pairIndex++
    ) {
      const firstSegment =
        segments[pairIndex * 2];

      const secondSegment =
        segments[pairIndex * 2 + 1];

      if (!firstSegment || !secondSegment) {
        continue;
      }

      const first = analyzeNote(
        samples.subarray(
          firstSegment.start,
          firstSegment.end,
        ),
        sampleRate,
        minClarity,
      );

      const second = analyzeNote(
        samples.subarray(
          secondSegment.start,
          secondSegment.end,
        ),
        sampleRate,
        minClarity,
      );

      const hasFirstNote = first.frequency > 0;
      const hasSecondNote = second.frequency > 0;

      const detectedRatio =
        hasFirstNote && hasSecondNote
          ? calcIntervalRatio(
              first.frequency,
              second.frequency,
            )
          : 0;

      attempts.push({
        freq1: first.frequency,
        freq2: second.frequency,
        detectedRatio,

        hasFirstNote,
        hasSecondNote,

        firstNoteClarity: first.clarity,
        secondNoteClarity: second.clarity,
      });
    }

    if (attempts.length === 0) {
      return emptyResult();
    }

    const validAttempts = attempts.filter(
      attempt =>
        attempt.hasFirstNote &&
        attempt.hasSecondNote &&
        Number.isFinite(attempt.detectedRatio) &&
        attempt.detectedRatio > 0,
    );

    if (validAttempts.length === 0) {
      return {
        ...emptyResult(),
        attempts,
      };
    }

    const aggregateFreq1 = median(
      validAttempts.map(attempt => attempt.freq1),
    );

    const aggregateFreq2 = median(
      validAttempts.map(attempt => attempt.freq2),
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

      firstNoteClarity: aggregateFirstClarity,
      secondNoteClarity: aggregateSecondClarity,

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