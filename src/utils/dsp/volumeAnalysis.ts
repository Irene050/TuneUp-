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

export function calcRampConsistency(dbArray: number[]): number {
  if (dbArray.length < 2) return 0;
  const diffs: number[] = [];
  for (let i = 1; i < dbArray.length; i++) diffs.push(dbArray[i] - dbArray[i - 1]);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((sum, d) => sum + Math.abs(d - mean), 0) / diffs.length;
  const relVar = mean === 0 ? 1 : Math.abs(variance / mean);
  return Math.max(0, 100 - relVar * 100);
}

export function calcDerivativeSmoothness(dbArray: number[]): number {
  if (dbArray.length < 2) return 0;
  const derivative: number[] = [];
  for (let i = 1; i < dbArray.length; i++) derivative.push(dbArray[i] - dbArray[i - 1]);
  const mean = derivative.reduce((a, b) => a + b, 0) / derivative.length;
  const variance = derivative.reduce((sum, d) => sum + Math.abs(d - mean), 0) / derivative.length;
  const relVar = mean === 0 ? 1 : Math.abs(variance / mean);
  return Math.max(0, 100 - relVar * 100);
}

export function calcVolumeConsistency(dbArray: number[]): number {
  if (dbArray.length === 0) return 0;
  const mean = dbArray.reduce((a, b) => a + b, 0) / dbArray.length;
  const variance = dbArray.reduce((sum, d) => sum + (d - mean) ** 2, 0) / dbArray.length;
  const stdDev = Math.sqrt(variance);
  const relStdDev = mean === 0 ? 1 : Math.abs(stdDev / mean);
  return Math.max(0, 100 - relStdDev * 100);
}

export function checkBandCompliance(avgDb: number, targetBand: [number, number]): boolean {
  return avgDb >= targetBand[0] && avgDb <= targetBand[1];
}

export function calcVolumeStability(dbArray: number[]): number {
  return calcVolumeConsistency(dbArray);
}