export function calcRMS(frame: Float32Array): number {
  const sumSquares = frame.reduce((sum, v) => sum + v * v, 0);
  return Math.sqrt(sumSquares / frame.length);
}

export function calcRMSVariance(
  samples: Float32Array,
  frameSizeMs = 50,
  sampleRate = 44100
): number {
  const frameSize = Math.floor((frameSizeMs / 1000) * sampleRate);
  const rmsValues: number[] = [];

  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    rmsValues.push(calcRMS(samples.subarray(i, i + frameSize)));
  }
  if (rmsValues.length === 0) return 0;

  const mean = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
  const variance =
    rmsValues.reduce((sum, v) => sum + Math.abs(v - mean), 0) / rmsValues.length;
  const relativeVariance = mean === 0 ? 1 : variance / mean;

  return Math.max(0, 100 - relativeVariance * 100);
}

export function rmsToDb(rmsValue: number, refLevel = 1): number {
  if (rmsValue <= 0) return -Infinity;
  return 20 * Math.log10(rmsValue / refLevel);
}