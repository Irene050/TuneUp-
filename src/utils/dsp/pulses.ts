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
  const threshold = meanAmp * 1.5;
  const peaks: Peak[] = [];
  let inPeak = false;

  for (let i = 0; i < samples.length; i++) {
    const amp = Math.abs(samples[i]);
    if (amp > threshold && !inPeak) {
      inPeak = true;
      peaks.push({ index: i, amplitude: amp, timestamp: i / sampleRate });
    } else if (amp <= threshold) {
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
  if (peaks.length < 2) return 0;
  const deviations: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const actualInterval = peaks[i].timestamp - peaks[i - 1].timestamp;
    deviations.push(Math.abs(actualInterval - targetIntervalSeconds) / targetIntervalSeconds);
  }
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  return Math.max(0, 100 - avgDeviation * 100);
}