import { PitchDetector } from 'pitchy';

export interface PitchFrame {
  frequency: number;
  clarity: number;
  timestamp: number;
}

export interface LivePitchData {
  frequency: number;
  note: string;
  clarity: number;
}


const PITCH_FRAME_SIZE = 2048;

const detector =
  PitchDetector.forFloat32Array(
    PITCH_FRAME_SIZE
  );

export function frequencyToNote(
  frequency: number
): string {
  if (
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return '--';
  }

  const noteNames = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];

  const midi =
    Math.round(
      69 +
        12 *
          Math.log2(
            frequency / 440
          )
    );

  const noteIndex =
    ((midi % 12) + 12) % 12;

  const octave =
    Math.floor(midi / 12) - 1;

  return `${noteNames[noteIndex]}${octave}`;
}

export function analyzePitchFrame(
  samples: Float32Array,
  sampleRate: number
): LivePitchData {
  if (
    sampleRate <= 0 ||
    samples.length < PITCH_FRAME_SIZE
  ) {
    return {
      frequency: 0,
      note: '--',
      clarity: 0,
    };
  }

  const frame =
    samples.subarray(
      samples.length -
        PITCH_FRAME_SIZE
    );

  try {
    const [
      frequency,
      clarity,
    ] =
      detector.findPitch(frame, sampleRate);

    if (
      !Number.isFinite(frequency) ||
      frequency <= 0
    ) {
      return {
        frequency: 0,
        note: '--',
        clarity: 0,
      };
    }

    return {
      frequency,
      note:
        frequencyToNote(
          frequency
        ),
      clarity,
    };
  } catch {
    return {
      frequency: 0,
      note: '--',
      clarity: 0,
    };
  }
}

export function filterByClarity(
  frames: PitchFrame[],
  clarityThreshold = 0.8
): PitchFrame[] {
  return frames.filter(
    frame =>
      Number.isFinite(frame.frequency) &&
      frame.frequency > 0 &&
      frame.clarity >= clarityThreshold
  );
}

// ============================================================
// PITCH TRACKING
// ============================================================

export function trackPitchOverTime(
  samples: Float32Array,
  frameSizeMs: number,
  sampleRate: number
): PitchFrame[] {
  if (
    sampleRate <= 0 ||
    samples.length < PITCH_FRAME_SIZE
  ) {
    return [];
  }

  const hopSize =
    Math.max(
      1,
      Math.floor(
        (frameSizeMs / 1000) *
          sampleRate
      )
    );

  const frames: PitchFrame[] = [];

  for (
    let i = 0;
    i + PITCH_FRAME_SIZE <=
      samples.length;
    i += hopSize
  ) {
    const chunk =
      samples.subarray(
        i,
        i + PITCH_FRAME_SIZE
      );

    try {
      const [
        frequency,
        clarity,
      ] =
        detector.findPitch(
          chunk,
          sampleRate
        );

      frames.push({
        frequency,
        clarity,
        timestamp:
          i / sampleRate,
      });
    } catch {
      continue;
    }
  }

  return frames;
}

export function calcPitchAccuracy(
  detectedFreq: number,
  targetFreq: number
): number {
  if (
    !Number.isFinite(
      detectedFreq
    ) ||
    !Number.isFinite(
      targetFreq
    ) ||
    detectedFreq <= 0 ||
    targetFreq <= 0
  ) {
    return 0;
  }

  const deviation =
    Math.abs(
      detectedFreq -
        targetFreq
    ) /
    targetFreq;

  return Math.max(
    0,
    100 -
      deviation * 100
  );
}

export function calcLiveStability(
  frequencies: number[]
): number {
  const validPitches =
    frequencies.filter(
      frequency =>
        Number.isFinite(
          frequency
        ) &&
        frequency > 0
    );

  if (
    validPitches.length === 0
  ) {
    return 0;
  }

  const mean =
    validPitches.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    validPitches.length;

  if (
    mean <= 0 ||
    !Number.isFinite(mean)
  ) {
    return 0;
  }

  const averageDeviation =
    validPitches.reduce(
      (sum, value) =>
        sum +
        Math.abs(
          value - mean
        ),
      0
    ) /
    validPitches.length;

  const relativeVariation =
    averageDeviation /
    mean;

  return Math.max(
    0,
    Math.min(
      100,
      100 -
        relativeVariation *
          100
    )
  );
}

export function calcIntervalRatio(
  freq1: number,
  freq2: number
): number {
  if (
    !Number.isFinite(freq1) ||
    !Number.isFinite(freq2) ||
    freq1 <= 0 ||
    freq2 <= 0
  ) {
    return 0;
  }

  return freq2 / freq1;
}

export function segmentAudioByPause(
  samples: Float32Array,
  silenceThreshold = 0.01,
  minSilenceMs = 100,
  sampleRate = 44100
): [
  Float32Array,
  Float32Array
] {
  if (
    samples.length === 0
  ) {
    return [
      samples,
      samples,
    ];
  }

  const minSilenceSamples =
    Math.floor(
      (minSilenceMs / 1000) *
        sampleRate
    );

  let silenceStart = -1;

  let splitIndex =
    Math.floor(
      samples.length / 2
    );

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    if (
      Math.abs(
        samples[i]
      ) <
      silenceThreshold
    ) {
      if (
        silenceStart === -1
      ) {
        silenceStart = i;
      }

      if (
        i - silenceStart >=
        minSilenceSamples
      ) {
        splitIndex =
          silenceStart;

        break;
      }
    } else {
      silenceStart = -1;
    }
  }

  return [
    samples.subarray(
      0,
      splitIndex
    ),
    samples.subarray(
      splitIndex
    ),
  ];
}

export function segmentIntoNotes(
  samples: Float32Array,
  noteCount: number,
  _silenceThreshold = 0.01,
  _sampleRate = 44100
): Float32Array[] {
  if (
    noteCount <= 0 ||
    samples.length === 0
  ) {
    return [];
  }

  const segments:
    Float32Array[] = [];

  const segmentLength =
    Math.floor(
      samples.length /
        noteCount
    );

  for (
    let n = 0;
    n < noteCount;
    n++
  ) {
    const start =
      n *
      segmentLength;

    const end =
      n ===
      noteCount - 1
        ? samples.length
        : (n + 1) *
          segmentLength;

    segments.push(
      samples.subarray(
        start,
        end
      )
    );
  }

  return segments;
}

export function calcTransitionSmoothness(
  detectedFreqs: number[]
): number {
  const validFreqs =
    detectedFreqs.filter(
      frequency =>
        Number.isFinite(
          frequency
        ) &&
        frequency > 0
    );

  if (
    validFreqs.length < 2
  ) {
    return 100;
  }

  const diffs: number[] = [];

  for (
    let i = 1;
    i < validFreqs.length;
    i++
  ) {
    diffs.push(
      Math.abs(
        validFreqs[i] -
          validFreqs[i - 1]
      )
    );
  }

  if (
    diffs.length === 0
  ) {
    return 100;
  }

  const mean =
    diffs.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    diffs.length;

  const averageDeviation =
    diffs.reduce(
      (sum, value) =>
        sum +
        Math.abs(
          value - mean
        ),
      0
    ) /
    diffs.length;

  return Math.max(
    0,
    Math.min(
      100,
      100 -
        averageDeviation *
          0.5
    )
  );
}

export function calcNoteAccuracyBatch(
  detectedFreqs: number[],
  targetFreqs: number[]
): number {
  if (
    detectedFreqs.length === 0 ||
    targetFreqs.length === 0
  ) {
    return 0;
  }

  const count =
    Math.min(
      detectedFreqs.length,
      targetFreqs.length
    );

  if (
    count === 0
  ) {
    return 0;
  }

  let withinTolerance =
    0;

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const accuracy =
      calcPitchAccuracy(
        detectedFreqs[i],
        targetFreqs[i]
      );

    if (
      accuracy >= 93
    ) {
      withinTolerance++;
    }
  }

  return (
    withinTolerance /
    count
  ) *
  100;
}

export function calcRhythmAccuracy(
  noteTimestamps: number[],
  targetTimestamps: number[]
): number {
  if (
    noteTimestamps.length === 0 ||
    targetTimestamps.length === 0
  ) {
    return 0;
  }

  const count =
    Math.min(
      noteTimestamps.length,
      targetTimestamps.length
    );

  if (
    count === 0
  ) {
    return 0;
  }

  let totalDeviation =
    0;

  for (
    let i = 0;
    i < count;
    i++
  ) {
    totalDeviation +=
      Math.abs(
        noteTimestamps[i] -
          targetTimestamps[i]
      );
  }

  const averageDeviation =
    totalDeviation /
    count;

  return Math.max(
    0,
    Math.min(
      100,
      100 -
        averageDeviation *
          100
    )
  );
}