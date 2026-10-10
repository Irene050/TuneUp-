
import type { PitchFrame } from './pitch';

export interface PitchTransition {
  fromFreq: number;
  toFreq: number;
  timestamp: number;
}

export interface AgilityPitchOptions {
  minFrequency?: number;
  maxFrequency?: number;
  minRms?: number;
  minCorrelation?: number;
}

export interface AgilityPitchFrame {
  frequency: number;
  timestamp: number;
}

export interface AgilityNote {
  midi: number;
  timestampMs: number;
}

const DEFAULT_MIN_FREQUENCY = 70;
const DEFAULT_MAX_FREQUENCY = 1000;
const DEFAULT_MIN_RMS = 0.008;
const DEFAULT_MIN_CORRELATION = 0.3;

/**
 * In-place radix-2 Cooley-Tukey FFT.
 *
 * For inverse transforms, the output is divided by the
 * transform length.
 */
function fft(
  real: Float64Array,
  imag: Float64Array,
  inverse = false,
): void {
  const n = real.length;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;

    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }

    j ^= bit;

    if (i < j) {
      const realTemp = real[i];
      real[i] = real[j];
      real[j] = realTemp;

      const imagTemp = imag[i];
      imag[i] = imag[j];
      imag[j] = imagTemp;
    }
  }

  // Butterfly stages.
  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const angle =
      (inverse ? 2 : -2) * Math.PI / size;

    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);

    for (let start = 0; start < n; start += size) {
      let twiddleReal = 1;
      let twiddleImag = 0;

      for (let j = 0; j < halfSize; j++) {
        const evenIndex = start + j;
        const oddIndex = evenIndex + halfSize;

        const oddReal =
          real[oddIndex] * twiddleReal -
          imag[oddIndex] * twiddleImag;

        const oddImag =
          real[oddIndex] * twiddleImag +
          imag[oddIndex] * twiddleReal;

        const evenReal = real[evenIndex];
        const evenImag = imag[evenIndex];

        real[evenIndex] = evenReal + oddReal;
        imag[evenIndex] = evenImag + oddImag;

        real[oddIndex] = evenReal - oddReal;
        imag[oddIndex] = evenImag - oddImag;

        const nextTwiddleReal =
          twiddleReal * stepReal -
          twiddleImag * stepImag;

        twiddleImag =
          twiddleReal * stepImag +
          twiddleImag * stepReal;

        twiddleReal = nextTwiddleReal;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

export function frequencyToMidi(
  frequency: number,
): number {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return NaN;
  }

  return 69 + 12 * Math.log2(frequency / 440);
}

export function midiToFrequency(
  midi: number,
): number {
  if (!Number.isFinite(midi)) {
    return NaN;
  }

  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function calculateRms(
  samples: Float32Array,
  start = 0,
  end = samples.length,
): number {
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(samples.length, Math.floor(end));

  if (to <= from) {
    return 0;
  }

  let sum = 0;

  for (let i = from; i < to; i++) {
    const value = samples[i] ?? 0;
    sum += value * value;
  }

  return Math.sqrt(sum / (to - from));
}

/**
 * Estimates pitch using FFT-based autocorrelation.
 *
 * The FFT computes autocorrelation in O(N log N), avoiding
 * the much more expensive direct calculation for every lag.
 *
 * The existing frequency, RMS, and correlation thresholds
 * remain configurable through AgilityPitchOptions.
 */
export function detectPitchAutocorrelation(
  frame: Float32Array,
  sampleRate: number,
  options: AgilityPitchOptions = {},
): number | null {
  const minFrequency =
    options.minFrequency ?? DEFAULT_MIN_FREQUENCY;

  const maxFrequency =
    options.maxFrequency ?? DEFAULT_MAX_FREQUENCY;

  const minRms =
    options.minRms ?? DEFAULT_MIN_RMS;

  const minCorrelation =
    options.minCorrelation ?? DEFAULT_MIN_CORRELATION;

  if (
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    frame.length < 2 ||
    !Number.isFinite(minFrequency) ||
    !Number.isFinite(maxFrequency) ||
    minFrequency <= 0 ||
    maxFrequency <= minFrequency
  ) {
    return null;
  }

  const length = frame.length;

  // Calculate RMS and cumulative energy in one pass.
  const prefixEnergy = new Float64Array(length + 1);
  let totalEnergy = 0;

  for (let i = 0; i < length; i++) {
    const value = frame[i] ?? 0;
    totalEnergy += value * value;
    prefixEnergy[i + 1] = totalEnergy;
  }

  const rms = Math.sqrt(totalEnergy / length);

  if (rms < minRms) {
    return null;
  }

  const minLag = Math.max(
    1,
    Math.floor(sampleRate / maxFrequency),
  );

  const maxLag = Math.min(
    length - 1,
    Math.floor(sampleRate / minFrequency),
  );

  if (minLag > maxLag) {
    return null;
  }

  // Pad to a power of two that can hold the linear
  // autocorrelation without circular wraparound.
  let fftSize = 1;

  while (fftSize < length * 2 - 1) {
    fftSize <<= 1;
  }

  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  for (let i = 0; i < length; i++) {
    real[i] = frame[i] ?? 0;
  }

  // Forward FFT.
  fft(real, imag);

  // Power spectrum: X * conjugate(X).
  for (let i = 0; i < fftSize; i++) {
    const re = real[i];
    const im = imag[i];

    real[i] = re * re + im * im;
    imag[i] = 0;
  }

  // Inverse FFT produces the autocorrelation.
  fft(real, imag, true);

  let bestLag = -1;
  let bestCorrelation = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    const overlapLength = length - lag;

    const energyA = prefixEnergy[overlapLength];
    const energyB =
      totalEnergy - prefixEnergy[lag];

    const denominator = Math.sqrt(energyA * energyB);

    if (denominator <= 0) {
      continue;
    }

    const correlation = real[lag];
    const normalizedCorrelation =
      correlation / denominator;

    if (normalizedCorrelation > bestCorrelation) {
      bestCorrelation = normalizedCorrelation;
      bestLag = lag;
    }
  }

  if (
    bestLag <= 0 ||
    bestCorrelation < minCorrelation
  ) {
    return null;
  }

  const frequency = sampleRate / bestLag;

  return Number.isFinite(frequency) &&
    frequency >= minFrequency &&
    frequency <= maxFrequency
    ? frequency
    : null;
}

export function extractAgilityPitchFrames(
  samples: Float32Array,
  sampleRate: number,
  frameSize = 2048,
  hopSize = 1024,
  options: AgilityPitchOptions = {},
): AgilityPitchFrame[] {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isInteger(frameSize) ||
    frameSize < 2 ||
    !Number.isInteger(hopSize) ||
    hopSize < 1 ||
    samples.length < frameSize
  ) {
    return [];
  }

  const frames: AgilityPitchFrame[] = [];

  for (
    let start = 0;
    start + frameSize <= samples.length;
    start += hopSize
  ) {
    const frame = samples.subarray(
      start,
      start + frameSize,
    );

    const frequency = detectPitchAutocorrelation(
      frame,
      sampleRate,
      options,
    );

    if (frequency === null) {
      continue;
    }

    frames.push({
      frequency,
      timestamp: (start / sampleRate) * 1000,
    });
  }

  return frames;
}

export function extractAgilityNotes(
  frames: AgilityPitchFrame[],
  confirmationFrames = 1,
): AgilityNote[] {
  const requiredFrames = Math.max(
    1,
    Math.floor(confirmationFrames),
  );

  const notes: AgilityNote[] = [];

  let candidateMidi: number | null = null;
  let candidateCount = 0;
  let candidateTimestampMs = 0;
  let currentMidi: number | null = null;

  for (const frame of frames) {
    const midiFloat = frequencyToMidi(frame.frequency);

    if (!Number.isFinite(midiFloat)) {
      candidateMidi = null;
      candidateCount = 0;
      continue;
    }

    const midi = Math.round(midiFloat);

    if (midi === currentMidi) {
      candidateMidi = null;
      candidateCount = 0;
      continue;
    }

    if (midi !== candidateMidi) {
      candidateMidi = midi;
      candidateCount = 1;
      candidateTimestampMs = frame.timestamp;
    } else {
      candidateCount++;
    }

    if (candidateCount >= requiredFrames) {
      notes.push({
        midi,
        timestampMs: candidateTimestampMs,
      });

      currentMidi = midi;
      candidateMidi = null;
      candidateCount = 0;
    }
  }

  return notes;
}

// Existing helpers — preserved for existing callers.

export function detectPitchChanges(
  pitchFrames: PitchFrame[],
  changeThresholdHz = 15,
): PitchTransition[] {
  const transitions: PitchTransition[] = [];

  for (let i = 1; i < pitchFrames.length; i++) {
    const previous = pitchFrames[i - 1];
    const current = pitchFrames[i];

    const diff = Math.abs(
      current.frequency - previous.frequency,
    );

    if (diff > changeThresholdHz) {
      transitions.push({
        fromFreq: previous.frequency,
        toFreq: current.frequency,
        timestamp: current.timestamp,
      });
    }
  }

  return transitions;
}

export function calcTransitionSpeed(
  transitionCount: number,
  durationSec: number,
): number {
  return durationSec > 0 &&
    Number.isFinite(durationSec) &&
    Number.isFinite(transitionCount)
    ? transitionCount / durationSec
    : 0;
}

export function calcJumpTime(
  note1EndTimestamp: number,
  note2StartTimestamp: number,
): number {
  return note2StartTimestamp - note1EndTimestamp;
}

export function calcTrillAccuracy(
  alternations: PitchTransition[],
  targetNotes: [number, number],
): number {
  if (
    alternations.length === 0 ||
    targetNotes.some(
      (frequency) =>
        !Number.isFinite(frequency) || frequency <= 0,
    )
  ) {
    return 0;
  }

  let correct = 0;

  for (const transition of alternations) {
    const matchesFrom =
      Math.abs(transition.fromFreq - targetNotes[0]) /
        targetNotes[0] < 0.05 ||
      Math.abs(transition.fromFreq - targetNotes[1]) /
        targetNotes[1] < 0.05;

    const matchesTo =
      Math.abs(transition.toFreq - targetNotes[0]) /
        targetNotes[0] < 0.05 ||
      Math.abs(transition.toFreq - targetNotes[1]) /
        targetNotes[1] < 0.05;

    if (matchesFrom && matchesTo) {
      correct++;
    }
  }

  return (correct / alternations.length) * 100;
}
