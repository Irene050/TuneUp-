import { calcRMS } from "@/utils/dsp/rms";

export interface Peak {
  index: number;
  amplitude: number;
  timestamp: number;
}


export function detectPulses(
  samples: Float32Array,
  _meanAmp: number,
  sampleRate = 44100
): Peak[] {
  if (
    samples.length === 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return [];
  }

  const windowMs = 20;
  const windowSize = Math.max(
    1,
    Math.floor((windowMs / 1000) * sampleRate)
  );

  const windows: {
    index: number;
    rms: number;
    peak: number;
  }[] = [];

  // Divide the recording into short windows.
  for (
    let start = 0;
    start < samples.length;
    start += windowSize
  ) {
    const end = Math.min(
      start + windowSize,
      samples.length
    );

    const window = samples.subarray(start, end);
    let peak = 0;

    for (let i = 0; i < window.length; i++) {
      const value = window[i];

      if (Number.isFinite(value)) {
        peak = Math.max(peak, Math.abs(value));
      }
    }

    windows.push({
      index: start,
      rms: calcRMS(window),
      peak,
    });
  }

  if (windows.length < 2) {
    return [];
  }

  // Estimate background from the quieter 20% of windows.
  const sortedRms = windows
    .map(window => window.rms)
    .sort((a, b) => a - b);

  const quietIndex = Math.floor(
    (sortedRms.length - 1) * 0.2
  );

  const noiseFloor = sortedRms[quietIndex];
  const maxRms = sortedRms[sortedRms.length - 1];

  if (
    !Number.isFinite(maxRms) ||
    maxRms <= 0
  ) {
    return [];
  }

  // Reject nearly uniform audio; it has no clear pulse contrast.
  if (
    noiseFloor > 0 &&
    maxRms <= noiseFloor * 1.25
  ) {
    return [];
  }

  // Detect windows above the estimated background level.
  const threshold =
    noiseFloor + (maxRms - noiseFloor) * 0.35;

  const refractorySamples = Math.floor(
    (100 / 1000) * sampleRate
  );

  const peaks: Peak[] = [];
  let inPeak = false;
  let lastPeakEnd = -Infinity;

  for (const window of windows) {
    const active = window.rms >= threshold;

    if (!active) {
      if (inPeak) {
        lastPeakEnd = window.index;
      }

      inPeak = false;
      continue;
    }

    if (
      !inPeak &&
      window.index >= lastPeakEnd + refractorySamples
    ) {
      inPeak = true;

      peaks.push({
        index: window.index,
        amplitude: window.peak,
        timestamp: window.index / sampleRate,
      });
    }
  }

  console.log("🫁 BREATH PULSE DETECTION:", {
    sampleCount: samples.length,
    durationSec: samples.length / sampleRate,
    windowCount: windows.length,
    noiseFloor,
    maxWindowRms: maxRms,
    threshold,
    detectedPulseCount: peaks.length,
  });

  return peaks;
}

export function calcPulseConsistency(
  peaks: Peak[]
): number {
  if (peaks.length === 0) return 0;

  const amplitudes = peaks.map(
    (p) => p.amplitude
  );

  const mean = amplitudes.reduce(
    (a, b) => 
      a + b, 0) / amplitudes.length;
  
    const variance = amplitudes.reduce(
      (sum, a) => 
        sum + Math.abs(a - mean), 0) / amplitudes.length;

  const relativeVar =
    mean === 0
      ? 1
      : variance / mean;

  return Math.max(
    0,
    100 - relativeVar * 100
  );
}

export function calcIntervalAccuracy(
  peaks: Peak[],
  targetIntervalSeconds: number
): number {
  if (
    peaks.length < 2 ||
    targetIntervalSeconds <= 0
  ) {
    return 0;
  }

  const deviations: number[] = [];

  for (let i = 1; i < peaks.length; i++) {
    const actualInterval =
      peaks[i].timestamp -
      peaks[i - 1].timestamp;

    deviations.push(
      Math.abs(
        actualInterval -
          targetIntervalSeconds
      ) / targetIntervalSeconds
    );
  }

  const avgDeviation =
    deviations.reduce(
      (a, b) => a + b,
      0
    ) / deviations.length;

  return Math.max(
    0,
    100 - avgDeviation * 100
  );
}