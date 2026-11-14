import { average, clamp } from '@/utils/math';
import { calcRMS, rmsToDb } from './rms';

export type VolumeRampDirection = 'crescendo' | 'decrescendo';

export function normalizeVolumeDbfs(
  value: number,
  minDbfs: number,
  maxDbfs: number,
  acceptLinearAmplitude = false,
): number {
  if (!Number.isFinite(value)) return 0;

  const dbfs =
    acceptLinearAmplitude && value >= 0 && value <= 1
      ? 20 * Math.log10(Math.max(value, 0.001))
      : value;

  return clamp((dbfs - minDbfs) / (maxDbfs - minDbfs), 0, 1);
}

export function estimateVolumeRampSmoothness(
  history: number[],
  minDbfs: number,
  maxDbfs: number,
  direction: VolumeRampDirection,
): number {
  if (history.length < 4) return 0;

  const dbValues = history.map(
    (value) => minDbfs + value * (maxDbfs - minDbfs),
  );
  const score =
    direction === 'crescendo'
      ? calculateCrescendoSmoothness(dbValues)
      : calculateDecrescendoSmoothness(dbValues);

  return direction === 'crescendo' ? Math.round(score) : score;
}

function calculateCrescendoSmoothness(values: number[]): number {
  if (values.length < 4) return 0;

  const netRise = values[values.length - 1] - values[0];
  if (!Number.isFinite(netRise) || netRise < 1.5) return 0;

  const derivatives = values.slice(1).map(
    (value, index) => value - values[index],
  );
  const upwardChange = derivatives.reduce(
    (sum, value) => sum + Math.max(value, 0),
    0,
  );
  const downwardChange = derivatives.reduce(
    (sum, value) => sum + Math.abs(Math.min(value, 0)),
    0,
  );
  const totalChange = upwardChange + downwardChange;
  if (totalChange === 0) return 0;

  const directionConsistency = upwardChange / totalChange;
  const meanDerivative = average(derivatives);
  const derivativeVariance =
    derivatives.reduce(
      (sum, value) => sum + (value - meanDerivative) ** 2,
      0,
    ) / derivatives.length;
  const derivativeStdDev = Math.sqrt(derivativeVariance);
  const rampConsistency =
    1 / (1 + derivativeStdDev / Math.max(meanDerivative, 0.5));

  return clamp(
    directionConsistency * 65 + rampConsistency * 35,
    0,
    100,
  );
}

function calculateDecrescendoSmoothness(values: number[]): number {
  if (values.length < 3) return 0;

  const changes = values.slice(1).map(
    (value, index) => value - values[index],
  );
  const meaningfulChanges = changes.filter(
    (change) => Math.abs(change) >= 0.15,
  );
  if (meaningfulChanges.length === 0) return 0;

  const downwardChanges = meaningfulChanges.filter(
    (change) => change < 0,
  ).length;
  const directionalConsistency =
    (downwardChanges / meaningfulChanges.length) * 100;
  const totalDecrease = values[0] - values[values.length - 1];
  if (!Number.isFinite(totalDecrease) || totalDecrease <= 0) return 0;

  const decreaseStrength = clamp((totalDecrease / 8) * 100, 0, 100);

  return Math.round(
    clamp(
      directionalConsistency * 0.8 + decreaseStrength * 0.2,
      0,
      100,
    ),
  );
}

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
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  const standardDeviation = Math.sqrt(variance);
  const score = 100 * (1 - standardDeviation / 12);
  return Math.round(Math.max(0, Math.min(100, score)));
}

export interface VolumeWindowAnalysis {
  rmsArray: number[];
  dbArray: number[];
  voicedArray: boolean[];
  windowSize: number;
}

export function analyzeVolumeWindows(
  samples: Float32Array,
  sampleRate: number,
  windowMs = 50,
  silenceDbfs = -60,
): VolumeWindowAnalysis {
  if (
    !samples ||
    samples.length === 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(windowMs) ||
    windowMs <= 0
  ) {
    return {
      rmsArray: [],
      dbArray: [],
      voicedArray: [],
      windowSize: 0,
    };
  }

  const windowSize = Math.max(
    1,
    Math.round(sampleRate * (windowMs / 1000)),
  );

  const minVoicedRms = Math.pow(
    10,
    silenceDbfs / 20,
  );

  const rmsArray: number[] = [];
  const dbArray: number[] = [];
  const voicedArray: boolean[] = [];

  for (
    let start = 0;
    start < samples.length;
    start += windowSize
  ) {
    const end = Math.min(
      start + windowSize,
      samples.length,
    );

    const rms = calcRMS(
      samples.subarray(start, end),
    );

    const db =
      rms <= 0
        ? silenceDbfs
        : rmsToDb(rms);

    rmsArray.push(rms);
    dbArray.push(db);
    voicedArray.push(rms >= minVoicedRms);
  }

  return {
    rmsArray,
    dbArray,
    voicedArray,
    windowSize,
  };
}