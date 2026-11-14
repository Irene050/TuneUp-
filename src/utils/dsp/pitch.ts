import { average } from '@/utils/math';
import {
  frequencyToNoteName,
  getPitchDifferenceCents,
} from '@/utils/music/notes';
import { PitchDetector } from 'pitchy';

const MIN_TRACKING_CLARITY = 0.70;

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

export function analyzePitchFrame(
  samples: Float32Array,
  sampleRate: number,
): LivePitchData {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    samples.length < PITCH_FRAME_SIZE
  ) {
    return {
      frequency: 0,
      note: '--',
      clarity: 0,
    };
  }

  const frame = samples.subarray(
    samples.length - PITCH_FRAME_SIZE,
  );

  try {
    const [detectedFrequency, clarity] =
      detector.findPitch(frame, sampleRate);

    if (
      !Number.isFinite(detectedFrequency) ||
      detectedFrequency < 60 ||
      detectedFrequency > 1500 ||
      !Number.isFinite(clarity) ||
      clarity < MIN_TRACKING_CLARITY
    ) {
      return {
        frequency: 0,
        note: '--',
        clarity: Number.isFinite(clarity) ? clarity : 0,
      };
    }

    const note = frequencyToNoteName(detectedFrequency);

    return {
      frequency: detectedFrequency,
      note,
      clarity,
    };
  } catch (error) {
    console.error('[Pitch Detection] Failed:', error);

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

  export function trackPitchOverTime(
    samples: Float32Array,
    frameSizeMs: number,
    sampleRate: number,
  ): PitchFrame[] {
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0 ||
      !Number.isFinite(frameSizeMs) ||
      frameSizeMs <= 0 ||
      samples.length < PITCH_FRAME_SIZE
    ) {
      return [];
    }

    const hopSize = Math.max(
      1,
      Math.floor((frameSizeMs / 1000) * sampleRate),
    );

    const frames: PitchFrame[] = [];

    for (
      let i = 0;
      i + PITCH_FRAME_SIZE <= samples.length;
      i += hopSize
    ) {
      const chunk = samples.subarray(
        i,
        i + PITCH_FRAME_SIZE,
      );

      const timestamp =
        (i + PITCH_FRAME_SIZE / 2) / sampleRate;

      try {
        const [frequency, clarity] =
          detector.findPitch(chunk, sampleRate);

        const validClarity =
          Number.isFinite(clarity) &&
          clarity >= MIN_TRACKING_CLARITY;

        const validFrequency =
          Number.isFinite(frequency) &&
          frequency >= 60 &&
          frequency <= 1500;

        frames.push({
          frequency:
            validFrequency && validClarity
              ? frequency
              : 0,
          clarity: Number.isFinite(clarity)
            ? Math.max(0, Math.min(1, clarity))
            : 0,
          timestamp,
        });
      } catch (error) {
        console.warn(
          '[Pitch Tracking] Frame analysis failed:',
          error,
        );

        frames.push({
          frequency: 0,
          clarity: 0,
          timestamp,
        });
      }
    }

    return frames;
  }

export function calcPitchAccuracy(
  detectedFreq: number,
  targetFreq: number,
): number {
  if (
    !Number.isFinite(detectedFreq) ||
    !Number.isFinite(targetFreq) ||
    detectedFreq <= 0 ||
    targetFreq <= 0
  ) {
    return 0;
  }

  const deviationCents = Math.abs(
    getPitchDifferenceCents(detectedFreq, targetFreq),
  );

  return Math.max(
    0,
    Math.min(100, 100 * (1 - deviationCents / 100)),
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

  const mean = average(validPitches);

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

  const mean = average(diffs);

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