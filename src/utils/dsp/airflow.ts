import { calcRMS } from './rms';

export function calcAirflowStability(
  samples: Float32Array,
  windowMs = 50,
  sampleRate = 44100
): number {
  const windowSize = Math.floor((windowMs / 1000) * sampleRate);
  const rmsValues: number[] = [];

  for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
    rmsValues.push(calcRMS(samples.subarray(i, i + windowSize)));
  }
  if (rmsValues.length === 0) return 0;

  const meanAmp = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
  const varAmp =
    rmsValues.reduce((sum, v) => sum + Math.abs(v - meanAmp), 0) / rmsValues.length;
  const relativeVar = meanAmp === 0 ? 1 : varAmp / meanAmp;

  return Math.max(0, 100 - relativeVar * 100);
}