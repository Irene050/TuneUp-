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

  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);
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

  if (windows.length < 2) return [];

  const sortedRms = windows
    .map(window => window.rms)
    .sort((a, b) => a - b);

  const noiseFloor =
    sortedRms[Math.floor((sortedRms.length - 1) * 0.2)];

  const maxRms = sortedRms[sortedRms.length - 1];

  console.log('🫁 REP 3 DETECTOR DEBUG:', {
  durationSec: samples.length / sampleRate,
  windowCount: windows.length,
  noiseFloor,
  maxRms,
  detectionRatio: noiseFloor > 0 ? maxRms / noiseFloor : null,
});

  if (
    !Number.isFinite(maxRms) ||
    maxRms <= 0 ||
    maxRms <= noiseFloor * 1.05
  ) {
    return [];
  }

  const signalRange = maxRms - noiseFloor;

  const startThreshold =
    noiseFloor + signalRange * 0.35;

  const endThreshold =
    noiseFloor + signalRange * 0.20;

  const minPulseWindows = 3;
  const minSeparationSamples = Math.floor(0.25 * sampleRate);

    console.log('🫁 PULSE THRESHOLD DEBUG:', {
  startThreshold,
  endThreshold,
  minPulseWindows: 3,
  minSeparationSamples,
});

  const peaks: Peak[] = [];

  let active = false;
  let startIndex = 0;
  let activeWindows = 0;
  let belowThresholdWindows = 0;
  let strongestAmplitude = 0;
  let lastAcceptedIndex = -Infinity;

  const finishPulse = () => {
    // Capture the current event before resetting detector state.
    const pulseStart = startIndex;
    const pulseAmplitude = strongestAmplitude;
    const validPulse =
      active && activeWindows >= minPulseWindows;

    // Always reset, including when the event is too short.
    active = false;
    activeWindows = 0;
    belowThresholdWindows = 0;
    strongestAmplitude = 0;

    if (!validPulse) return;

    if (
      pulseStart - lastAcceptedIndex <
      minSeparationSamples
    ) {
      return;
    }

    peaks.push({
      index: pulseStart,
      amplitude: pulseAmplitude,
      timestamp: pulseStart / sampleRate,
    });

    lastAcceptedIndex = pulseStart;
  };

  for (const window of windows) {
    if (!active) {
      if (window.rms < startThreshold) continue;

      active = true;
      startIndex = window.index;
      activeWindows = 1;
      belowThresholdWindows = 0;
      strongestAmplitude = window.peak;
      continue;
    }

    if (window.rms >= endThreshold) {
      activeWindows++;
      belowThresholdWindows = 0;

      if (window.peak > strongestAmplitude) {
        strongestAmplitude = window.peak;
      }
    } else {
      belowThresholdWindows++;

      if (belowThresholdWindows >= 3) {
        finishPulse();
      }
    }
  }

  if (active) {
    finishPulse();
  }

  console.log("🫁 BREATH PULSE DETECTION:", {
    durationSec: samples.length / sampleRate,
    noiseFloor,
    maxWindowRms: maxRms,
    startThreshold,
    endThreshold,
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
    100 - relativeVar * 115
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