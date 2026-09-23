export interface Peak {
  index: number;
  amplitude: number;
  timestamp: number;
}

export function detectPulses(
  samples: Float32Array,
  meanAmp: number,
  sampleRate = 44100
): Peak[] {
  if (samples.length === 0 || meanAmp <= 0) return [];

  const threshold = meanAmp * 1.5;

  // Analyze in short envelope windows instead of raw per-sample
  // amplitude, so a single pulse's internal oscillation doesn't
  // get counted as multiple peaks.
  const windowMs = 20;
  const windowSize = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));

  // Minimum time that must pass after a detected peak before
  // another one can register (refractory period).
  const refractoryMs = 100;
  const refractorySamples = Math.floor((refractoryMs / 1000) * sampleRate);

  const peaks: Peak[] = [];
  let inPeak = false;
  let lastPeakEnd = -Infinity;

  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);
    let sumSquares = 0;
    let peakAmpInWindow = 0;

    for (let i = start; i < end; i++) {
      const v = samples[i];
      sumSquares += v * v;
      const a = Math.abs(v);
      if (a > peakAmpInWindow) peakAmpInWindow = a;
    }

    const windowRms = Math.sqrt(sumSquares / (end - start));
    const active = windowRms > threshold;

    if (active && !inPeak && start >= lastPeakEnd + refractorySamples) {
      inPeak = true;
      peaks.push({
        index: start,
        amplitude: peakAmpInWindow,
        timestamp: start / sampleRate,
      });
    } else if (!active) {
      if (inPeak) lastPeakEnd = start;
      inPeak = false;
    }
  }

  return peaks;
}

export function calcPulseConsistency(peaks: Peak[]): number {
  if (peaks.length === 0) return 0;
  const amplitudes = peaks.map((p) => p.amplitude);
  const mean = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
  const variance =
    amplitudes.reduce((sum, a) => sum + Math.abs(a - mean), 0) / amplitudes.length;
  const relativeVar = mean === 0 ? 1 : variance / mean;
  return Math.max(0, 100 - relativeVar * 100);
}

export function calcIntervalAccuracy(peaks: Peak[], targetIntervalSeconds: number): number {
  if (peaks.length < 2 || targetIntervalSeconds <= 0) return 0;
  const deviations: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const actualInterval = peaks[i].timestamp - peaks[i - 1].timestamp;
    deviations.push(Math.abs(actualInterval - targetIntervalSeconds) / targetIntervalSeconds);
  }
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  return Math.max(0, 100 - avgDeviation * 100);
}