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
const SILENCE_FLOOR_DBFS = -60;
const MIN_VALID_WINDOWS_PER_REPETITION = 3;

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

interface RepetitionResult {
  values: number[];
  smoothness: number;
  startDb: number;
  endDb: number;
  decrease: number;
  startReached: boolean;
  endReached: boolean;
  directionCorrect: boolean;
  valid: boolean;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

function isValidVolume(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Calculates decrescendo smoothness using positive dBFS magnitudes.
 *
 * Example:
 * - -20 dBFS becomes magnitude 20.
 * - -35 dBFS becomes magnitude 35.
 *
 * As the voice gets quieter, its dBFS value becomes more negative,
 * so its positive magnitude increases.
 *
 * Only adjacent valid windows are compared. Invalid windows break
 * the sequence so changes across gaps are not treated as continuous.
 */
export function calculateDecrescendoSmoothness(
  dbValues: number[],
): number {
  if (dbValues.length < 3) {
    return 0;
  }

  let meaningfulChanges = 0;
  let correctlyDirectedChanges = 0;

  for (let index = 1; index < dbValues.length; index += 1) {
    const previous = dbValues[index - 1];
    const current = dbValues[index];

    // Do not compare readings across silence or invalid windows.
    if (
      !isValidVolume(previous) ||
      !isValidVolume(current)
    ) {
      continue;
    }

    const change = current - previous;

    // Ignore tiny changes likely caused by measurement noise.
    if (Math.abs(change) <= 0.05) {
      continue;
    }

    meaningfulChanges += 1;

    // A decrescendo increases positive magnitude.
    if (change > 0) {
      correctlyDirectedChanges += 1;
    }
  }

  if (meaningfulChanges === 0) {
    return 0;
  }

  return clamp(
    (correctlyDirectedChanges / meaningfulChanges) * 100,
    0,
    100,
  );
}

function targetTolerance(target: number): number {
  return target * (TARGET_TOLERANCE_PERCENT / 100);
}

function withinTolerance(
  value: number,
  target: number,
): boolean {
  return (
    Number.isFinite(value) &&
    Math.abs(value - target) <= targetTolerance(target)
  );
}

function emptyMeasurement(
  windowMs: number,
  expectedDurationSeconds: number,
  repetitions: number,
): ControlledDecrescendoMeasurement {
  const safeWindowMs =
    Number.isFinite(windowMs) && windowMs > 0
      ? windowMs
      : WINDOW_MS;

  const safeDuration =
    Number.isFinite(expectedDurationSeconds) &&
    expectedDurationSeconds > 0
      ? expectedDurationSeconds
      : DEFAULT_DURATION_SECONDS;

  const expectedWindowCount =
    Math.max(
      1,
      Math.round((safeDuration * 1000) / safeWindowMs),
    ) * repetitions;

  return {
    dbValues: [],
    repSmoothness: Array.from(
      { length: repetitions },
      () => 0,
    ),
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

function analyzeRepetition(
  windows: number[],
  targetStart: number,
  targetEnd: number,
  volumeDecreaseThreshold: number,
): RepetitionResult {
  const validValues = windows.filter(isValidVolume);

  if (validValues.length < MIN_VALID_WINDOWS_PER_REPETITION) {
    return {
      values: validValues,
      smoothness: 0,
      startDb: 0,
      endDb: 0,
      decrease: 0,
      startReached: false,
      endReached: false,
      directionCorrect: false,
      valid: false,
    };
  }

  // Locate the first and last valid readings without changing the
  // original window sequence.
  const firstValidIndex = windows.findIndex(isValidVolume);

  let lastValidIndex = -1;

  for (let index = windows.length - 1; index >= 0; index -= 1) {
    if (isValidVolume(windows[index])) {
      lastValidIndex = index;
      break;
    }
  }

  const startDb = windows[firstValidIndex];
  const endDb = windows[lastValidIndex];

  // Positive magnitude increases as the voice gets quieter.
  const decrease = endDb - startDb;

  const directionCorrect =
    lastValidIndex > firstValidIndex &&
    decrease > 0;

  // Keep invalid windows in the original sequence so smoothness
  // does not compare non-adjacent readings.
  const smoothness =
    calculateDecrescendoSmoothness(windows);

  const startReached = withinTolerance(startDb, targetStart);
  const endReached = withinTolerance(endDb, targetEnd);

  const valid =
    validValues.length >= MIN_VALID_WINDOWS_PER_REPETITION &&
    directionCorrect &&
    decrease >= volumeDecreaseThreshold;

  return {
    values: validValues,
    smoothness,
    startDb,
    endDb,
    decrease,
    startReached,
    endReached,
    directionCorrect,
    valid,
  };
}

export function measureControlledDecrescendo(
  samples: Float32Array,
  sampleRate = 44100,
  options: MeasureOptions = {},
): ControlledDecrescendoMeasurement {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const targetRange =
    options.targetRange ?? DEFAULT_TARGET_RANGE;

  const expectedDurationSeconds =
    options.expectedDurationSeconds ?? DEFAULT_DURATION_SECONDS;

  const repetitions = Math.max(
    1,
    Math.round(options.repetitions ?? DEFAULT_REPETITIONS),
  );

  const volumeDecreaseThreshold =
    options.volumeDecreaseThreshold ??
    DEFAULT_VOLUME_DECREASE_THRESHOLD;

  const validConfiguration =
    Number.isFinite(sampleRate) &&
    sampleRate > 0 &&
    Number.isFinite(windowMs) &&
    windowMs > 0 &&
    Number.isFinite(expectedDurationSeconds) &&
    expectedDurationSeconds > 0 &&
    Number.isFinite(targetRange[0]) &&
    Number.isFinite(targetRange[1]) &&
    targetRange[0] >= 0 &&
    targetRange[1] > targetRange[0] &&
    Number.isFinite(volumeDecreaseThreshold) &&
    volumeDecreaseThreshold >= 0;

  if (samples.length === 0 || !validConfiguration) {
    return emptyMeasurement(
      windowMs,
      expectedDurationSeconds,
      repetitions,
    );
  }

  const rmsValues = calcRMSWindows(
    samples,
    windowMs,
    sampleRate,
  );

  // Preserve every window's position. Invalid and silent windows
  // become NaN instead of being removed.
  const dbValues = toDbArray(rmsValues).map((db) => {
    if (
      !Number.isFinite(db) ||
      db <= SILENCE_FLOOR_DBFS
    ) {
      return Number.NaN;
    }

    // Convert negative dBFS to positive magnitude.
    return -db;
  });

  const windowsPerRep = Math.max(
    1,
    Math.round((expectedDurationSeconds * 1000) / windowMs),
  );

  const expectedWindowCount =
    windowsPerRep * repetitions;

  const effectiveValues = dbValues.slice(
    0,
    expectedWindowCount,
  );

  const repetitionResults = Array.from(
    { length: repetitions },
    (_, repIndex) => {
      const start = repIndex * windowsPerRep;
      const end = Math.min(
        start + windowsPerRep,
        effectiveValues.length,
      );

      const repetitionWindows = effectiveValues.slice(
        start,
        end,
      );

      return analyzeRepetition(
        repetitionWindows,
        targetRange[0],
        targetRange[1],
        volumeDecreaseThreshold,
      );
    },
  );

  const repSmoothness = repetitionResults.map(
    (result) => result.smoothness,
  );

  const smoothness = average(repSmoothness);

  const validRepetitions = repetitionResults.filter(
    (result) => result.values.length > 0,
  );

  const allValidValues = validRepetitions.flatMap(
    (result) => result.values,
  );

  const firstValidRepetition = repetitionResults.find(
    (result) => result.values.length > 0,
  );

  const lastValidRepetition = [...repetitionResults]
    .reverse()
    .find((result) => result.values.length > 0);

  const startDb = firstValidRepetition?.startDb ?? 0;
  const endDb = lastValidRepetition?.endDb ?? 0;

  const minDb =
    allValidValues.length > 0
      ? Math.min(...allValidValues)
      : 0;

  const maxDb =
    allValidValues.length > 0
      ? Math.max(...allValidValues)
      : 0;

  const allRepetitionsValid =
    repetitionResults.length === repetitions &&
    repetitionResults.every((result) => result.valid);

  const targetStartReached =
    allRepetitionsValid &&
    repetitionResults.every(
      (result) => result.startReached,
    );

  const targetEndReached =
    allRepetitionsValid &&
    repetitionResults.every(
      (result) => result.endReached,
    );

  const directionCorrect = allRepetitionsValid;

  const achievedVolumeDecrease = average(
    repetitionResults.map((result) => result.decrease),
  );

  const targetReached =
    allRepetitionsValid &&
    targetStartReached &&
    targetEndReached;

  const validWindowCount = effectiveValues.filter(
    isValidVolume,
  ).length;

  const measurementQuality = clamp(
    (validWindowCount / expectedWindowCount) * 100,
    0,
    100,
  );

  console.log(
    '[ControlledDecrescendo] Per-repetition results',
    repetitionResults.map((result, index) => ({
      repetition: index + 1,
      startDb: result.startDb,
      endDb: result.endDb,
      achievedVolumeDecrease: result.decrease,
      smoothness: result.smoothness,
      startReached: result.startReached,
      endReached: result.endReached,
      directionCorrect: result.directionCorrect,
      valid: result.valid,
      validWindowCount: result.values.length,
    })),
  );

  console.log(
    '[ControlledDecrescendo] Measurement summary',
    {
      sampleRate,
      sampleCount: samples.length,
      actualDurationSeconds:
        samples.length / sampleRate,
      windowMs,
      windowsPerRep,
      repetitions,
      expectedWindowCount,
      availableWindowCount: dbValues.length,
      validWindowCount,
      measurementQuality,
      repSmoothness,
      smoothness,
      startDb,
      endDb,
      minDb,
      maxDb,
      achievedVolumeDecrease,
      targetStartReached,
      targetEndReached,
      targetReached,
      directionCorrect,
    },
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
    validWindowCount,
    expectedWindowCount,
    measurementQuality,
  };
}