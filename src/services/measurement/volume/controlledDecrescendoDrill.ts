import {
  calcRMSWindows,
  toDbArray,
} from '@/utils/dsp/volumeAnalysis';

const WINDOW_MS = 50;
const DEFAULT_TARGET_RANGE: [number, number] = [35, 45];
const DEFAULT_DURATION_SECONDS = 4;
const DEFAULT_REPETITIONS = 2;
const DEFAULT_VOLUME_DECREASE_THRESHOLD = 10;
const TARGET_TOLERANCE_PERCENT = 15;

export interface ControlledDecrescendoMeasurement {
  dbValues: number[];
  repSmoothness: number[];
  smoothness: number;
  startDb: number;
  endDb: number;
  minDb: number;
  maxDb: number;
  targetStartReached: boolean;
  targetEndReached: boolean;
  targetReached: boolean;
  directionCorrect: boolean;
  achievedVolumeDecrease: number;
  validWindowCount: number;
  expectedWindowCount: number;
  measurementQuality: number;
}

interface MeasureOptions {
  windowMs?: number;
  targetRange?: [number, number];
  expectedDurationSeconds?: number;
  repetitions?: number;
  volumeDecreaseThreshold?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateDecrescendoSmoothness(dbValues: number[]): number {
  if (dbValues.length < 3) return 0;

  const derivatives: number[] = [];
  for (let index = 1; index < dbValues.length; index += 1) {
    derivatives.push(dbValues[index] - dbValues[index - 1]);
  }

  const meaningfulChanges = derivatives.filter(
    (change) => Math.abs(change) > 0.05,
  );
  if (meaningfulChanges.length === 0) return 0;

  const correctlyDirected = meaningfulChanges.filter(
    (change) => change > 0,
  ).length;

  return clamp(
    (correctlyDirected / meaningfulChanges.length) * 100,
    0,
    100,
  );
}

function targetTolerance(target: number): number {
  return target * (TARGET_TOLERANCE_PERCENT / 100);
}

function withinTolerance(value: number, target: number): boolean {
  return Math.abs(value - target) <= targetTolerance(target);
}

function emptyMeasurement(
  windowMs: number,
  expectedDurationSeconds: number,
  repetitions: number,
): ControlledDecrescendoMeasurement {
  const expectedWindowCount =
    Math.max(1, Math.round((expectedDurationSeconds * 1000) / windowMs)) *
    repetitions;

  return {
    dbValues: [],
    repSmoothness: Array.from({ length: repetitions }, () => 0),
    smoothness: 0,
    startDb: 0,
    endDb: 0,
    minDb: 0,
    maxDb: 0,
    targetStartReached: false,
    targetEndReached: false,
    targetReached: false,
    directionCorrect: false,
    achievedVolumeDecrease: 0,
    validWindowCount: 0,
    expectedWindowCount,
    measurementQuality: 0,
  };
}

export function measureControlledDecrescendo(
  samples: Float32Array,
  sampleRate = 44100,
  options: MeasureOptions = {},
): ControlledDecrescendoMeasurement {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const targetRange = options.targetRange ?? DEFAULT_TARGET_RANGE;
  const expectedDurationSeconds =
    options.expectedDurationSeconds ?? DEFAULT_DURATION_SECONDS;
  const repetitions = Math.max(
    1,
    Math.round(options.repetitions ?? DEFAULT_REPETITIONS),
  );
  const volumeDecreaseThreshold =
    options.volumeDecreaseThreshold ?? DEFAULT_VOLUME_DECREASE_THRESHOLD;

  if (samples.length === 0 || sampleRate <= 0 || windowMs <= 0) {
    return emptyMeasurement(windowMs, expectedDurationSeconds, repetitions);
  }

  const rmsValues = calcRMSWindows(samples, windowMs, sampleRate);
  const dbValues = toDbArray(rmsValues)
    .filter(Number.isFinite)
    .map((db) => Math.abs(db));

  if (dbValues.length === 0) {
    return emptyMeasurement(windowMs, expectedDurationSeconds, repetitions);
  }

  const windowsPerRep = Math.max(
    1,
    Math.round((expectedDurationSeconds * 1000) / windowMs),
  );
  const expectedWindowCount = windowsPerRep * repetitions;
  const effectiveValues = dbValues.slice(0, expectedWindowCount);

  const repSmoothness = Array.from({ length: repetitions }, (_, repIndex) => {
    const start = repIndex * windowsPerRep;
    const end = Math.min(start + windowsPerRep, effectiveValues.length);
    return calculateDecrescendoSmoothness(
      effectiveValues.slice(start, end),
    );
  });

  const smoothness = average(repSmoothness);
  const startDb = effectiveValues[0] ?? 0;
  const endDb = effectiveValues[effectiveValues.length - 1] ?? 0;
  const minDb =
    effectiveValues.length > 0 ? Math.min(...effectiveValues) : 0;
  const maxDb =
    effectiveValues.length > 0 ? Math.max(...effectiveValues) : 0;
  const targetStart = targetRange[0];
  const targetEnd = targetRange[1];
  const targetStartReached = withinTolerance(startDb, targetStart);
  const targetEndReached = withinTolerance(endDb, targetEnd);
  const achievedVolumeDecrease = endDb - startDb;
  const targetReached =
    targetStartReached &&
    targetEndReached &&
    achievedVolumeDecrease >= volumeDecreaseThreshold;
  const directionCorrect =
    effectiveValues.length >= 2 && endDb > startDb;

  const measurementQuality = clamp(
    (effectiveValues.length / expectedWindowCount) * 100,
    0,
    100,
  );

  return {
    dbValues: effectiveValues,
    repSmoothness,
    smoothness,
    startDb,
    endDb,
    minDb,
    maxDb,
    targetStartReached,
    targetEndReached,
    targetReached,
    directionCorrect,
    achievedVolumeDecrease,
    validWindowCount: effectiveValues.length,
    expectedWindowCount,
    measurementQuality,
  };
}
