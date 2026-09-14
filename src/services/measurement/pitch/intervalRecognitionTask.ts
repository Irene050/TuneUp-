import {
    calcIntervalRatio,
    filterByClarity,
    trackPitchOverTime,
} from '@/utils/dsp/pitch';

export interface IntervalRecognitionMeasurement {
  freq1: number;
  freq2: number;
  detectedRatio: number;

  hasFirstNote: boolean;
  hasSecondNote: boolean;

  firstNoteClarity: number;
  secondNoteClarity: number;
}

const RMS_WINDOW_MS = 30;
const RMS_HOP_MS = 15;

const SILENCE_RMS = 0.003;
const MIN_SILENCE_MS = 120;
const MIN_NOTE_MS = 250;

const NOTE_EDGE_MS = 150;

function emptyResult(): IntervalRecognitionMeasurement {
  return {
    freq1: 0,
    freq2: 0,
    detectedRatio: 0,
    hasFirstNote: false,
    hasSecondNote: false,
    firstNoteClarity: 0,
    secondNoteClarity: 0,
  };
}

function rms(
  samples: Float32Array,
  start: number,
  end: number
): number {
  let sum = 0;
  let count = 0;

  for (let i = start; i < end; i++) {
    const value = samples[i];

    if (!Number.isFinite(value)) {
      continue;
    }

    sum += value * value;
    count++;
  }

  return count > 0
    ? Math.sqrt(sum / count)
    : 0;
}

function findFirstVoicedSample(
  samples: Float32Array,
  sampleRate: number
): number {
  const window = Math.floor(
    (RMS_WINDOW_MS / 1000) *
      sampleRate
  );

  const hop = Math.floor(
    (RMS_HOP_MS / 1000) *
      sampleRate
  );

  for (
    let start = 0;
    start + window <= samples.length;
    start += hop
  ) {
    if (
      rms(
        samples,
        start,
        start + window
      ) >= SILENCE_RMS
    ) {
      return start;
    }
  }

  return -1;
}

function findPause(
  samples: Float32Array,
  sampleRate: number,
  firstStart: number
): number {
  const window = Math.floor(
    (RMS_WINDOW_MS / 1000) *
      sampleRate
  );

  const hop = Math.floor(
    (RMS_HOP_MS / 1000) *
      sampleRate
  );

  const minimumFirstNote =
    Math.floor(
      (MIN_NOTE_MS / 1000) *
        sampleRate
    );

  const requiredQuietFrames =
    Math.ceil(
      MIN_SILENCE_MS /
        RMS_HOP_MS
    );

  const searchStart =
    firstStart +
    minimumFirstNote;

  let quietFrames = 0;
  let quietStart = -1;

  for (
    let start = searchStart;
    start + window <= samples.length;
    start += hop
  ) {
    const quiet =
      rms(
        samples,
        start,
        start + window
      ) < SILENCE_RMS;

    if (quiet) {
      if (quietStart < 0) {
        quietStart = start;
      }

      quietFrames++;
      continue;
    }

    if (
      quietFrames >=
      requiredQuietFrames
    ) {
      /*
       * Make sure there is actual audio after
       * the pause.
       */
      for (
        let check = start;
        check + window <= samples.length;
        check += hop
      ) {
        if (
          rms(
            samples,
            check,
            check + window
          ) >= SILENCE_RMS
        ) {
          return quietStart;
        }
      }
    }

    quietFrames = 0;
    quietStart = -1;
  }

  return -1;
}

function median(
  values: number[]
): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2 === 0
  ) {
    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

function analyzeNote(
  samples: Float32Array,
  sampleRate: number,
  minClarity: number
): {
  frequency: number;
  clarity: number;
} {
  if (
    samples.length < 2048
  ) {
    return {
      frequency: 0,
      clarity: 0,
    };
  }

  const edge =
    Math.floor(
      (NOTE_EDGE_MS / 1000) *
        sampleRate
    );

  const start =
    samples.length >
    edge + 2048
      ? edge
      : 0;

  const end =
    samples.length >
    edge + 2048
      ? samples.length - edge
      : samples.length;

  const segment =
    samples.subarray(
      start,
      end
    );

  const frames =
    filterByClarity(
      trackPitchOverTime(
        segment,
        30,
        sampleRate
      ),
      minClarity
    );

  const frequencies =
    frames
      .map(
        (frame) =>
          frame.frequency
      )
      .filter(
        (frequency) =>
          Number.isFinite(
            frequency
          ) &&
          frequency >= 80 &&
          frequency <= 1000
      );

  if (!frequencies.length) {
    return {
      frequency: 0,
      clarity: 0,
    };
  }

  return {
    frequency:
      median(frequencies),

    clarity:
      frames.reduce(
        (sum, frame) =>
          sum + frame.clarity,
        0
      ) / frames.length,
  };
}

export function measureIntervalRecognition(
  samples: Float32Array,
  sampleRate: number,
  minClarity = 0.70
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
    const firstStart =
      findFirstVoicedSample(
        samples,
        sampleRate
      );

    if (firstStart < 0) {
      return emptyResult();
    }

    const splitIndex =
      findPause(
        samples,
        sampleRate,
        firstStart
      );

    if (splitIndex < 0) {
      console.warn(
        '⚠️ INTERVAL: No pause found'
      );

      return emptyResult();
    }

    const padding =
      Math.floor(
        (40 / 1000) *
          sampleRate
      );

    const firstEnd =
      splitIndex - padding;

    const secondStart =
      splitIndex + padding;

    const firstSegment =
      samples.subarray(
        firstStart,
        firstEnd
      );

    const secondSegment =
      samples.subarray(
        secondStart
      );

    const first =
      analyzeNote(
        firstSegment,
        sampleRate,
        minClarity
      );

    const second =
      analyzeNote(
        secondSegment,
        sampleRate,
        minClarity
      );

    const hasFirstNote =
      first.frequency > 0;

    const hasSecondNote =
      second.frequency > 0;

    const detectedRatio =
      hasFirstNote &&
      hasSecondNote
        ? calcIntervalRatio(
            first.frequency,
            second.frequency
          )
        : 0;

    console.log(
      '🎵 INTERVAL SEGMENTATION',
      {
        firstStart,
        splitIndex,
        secondStart,
        firstDuration:
          firstSegment.length /
          sampleRate,
        secondDuration:
          secondSegment.length /
          sampleRate,
        splitTime:
          splitIndex /
          sampleRate,
      }
    );

    console.log(
      '🎤 INTERVAL DETECTION',
      {
        freq1: first.frequency,
        freq2: second.frequency,
        detectedRatio,
        firstNoteClarity:
          first.clarity,
        secondNoteClarity:
          second.clarity,
      }
    );

    return {
      freq1: first.frequency,
      freq2: second.frequency,
      detectedRatio,
      hasFirstNote,
      hasSecondNote,
      firstNoteClarity:
        first.clarity,
      secondNoteClarity:
        second.clarity,
    };
  } catch (error) {
    console.error(
      '❌ INTERVAL MEASUREMENT ERROR:',
      error
    );

    return emptyResult();
  }
}