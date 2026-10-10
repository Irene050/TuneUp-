export function calcRMS(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sumSquares = 0;
  let count = 0;
  for (let i = 0; i < frame.length; i++) {
    const value = frame[i];
    if (!Number.isFinite(value)) continue;
    sumSquares += value * value;
    count++;
  }
  if (count === 0) return 0;
  return Math.sqrt(sumSquares / count);
}

export function calcRMSConsistency(
  samples: Float32Array,
  frameSizeMs = 50,
  sampleRate = 44100
): number {
  const frameSize = Math.floor(
    (frameSizeMs / 1000) * sampleRate
  );
  if (frameSize <= 0) return 0;
  const rmsValues: number[] = [];
  for (
    let i = 0;
    i + frameSize <= samples.length;
    i += frameSize
  ) {
    rmsValues.push(
      calcRMS(samples.subarray(i, i + frameSize))
    );
  }

  if (rmsValues.length === 0) return 0;

  const mean =
    rmsValues.reduce((a, b) => a + b, 0) /
    rmsValues.length;

  if (mean === 0) return 0;

  const variance =
    rmsValues.reduce(
      (sum, v) => sum + Math.abs(v - mean),
      0
    ) / rmsValues.length;

  const relativeVariance = variance / mean;
  return Math.max(0, 100 - relativeVariance * 100);
}

export function rmsToDb(
  rmsValue: number,
  refLevel = 1
): number {
  if (!Number.isFinite(rmsValue) || rmsValue <= 0) {
    return -100;
  }
  return 20 * Math.log10(rmsValue / refLevel);
}