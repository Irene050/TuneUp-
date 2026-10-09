import { calcRMS, rmsToDb } from './rms';

export function calcRMSWindows(samples: Float32Array, windowMs = 50, sampleRate = 44100): number[] {
  const windowSize = Math.floor((windowMs / 1000) * sampleRate);
  const windows: number[] = [];
  for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
    windows.push(calcRMS(samples.subarray(i, i + windowSize)));
  }
  return windows;
}

export function toDbArray(rmsValues: number[], refLevel = 1): number[] {
  return rmsValues.map((v) => rmsToDb(v, refLevel));
}

export function calcRangeAccuracy(dbArray: number[], targetRange: [number, number]): boolean {
  const min = Math.min(...dbArray);
  const max = Math.max(...dbArray);
  return min >= targetRange[0] && max <= targetRange[1];
}


export function calcDerivativeSmoothness(dbArray: number[]): number {
  const values = dbArray.filter(Number.isFinite);
  if (values.length < 2) return 0;
  let totalChange = 0;
  for (let i = 1; i < values.length; i++) {
    totalChange += Math.abs(values[i] - values[i - 1]);
  }
  const meanAbsoluteChange = totalChange / (values.length - 1);
  const score = 100 * (1 - meanAbsoluteChange / 5);
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function calcVolumeConsistency(dbArray: number[]): number {
  const values = dbArray.filter(Number.isFinite);
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  const standardDeviation = Math.sqrt(variance);
  const score = 100 * (1 - standardDeviation / 12);
  return Math.round(Math.max(0, Math.min(100, score)));
}


export function checkBandCompliance(avgDb: number, targetBand: [number, number]): boolean {
  return avgDb >= targetBand[0] && avgDb <= targetBand[1];
}
