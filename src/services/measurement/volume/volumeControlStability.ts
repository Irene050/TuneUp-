/* =========================================================
   VOLUME CONTROL STABILITY
   MEASUREMENT
   =========================================================
   
   Beginner parameters:
   - Target note: C4
   - Duration: 5 seconds
   - Repetitions: 2
   - Stability target: 70%
   - Amplitude variance: ±10%

   Measurement:
   - RMS amplitude over 50 ms windows
   - RMS converted to dB
   - Volume stability calculated from amplitude variation
   - Voice coverage measured to prevent silent attempts
   ========================================================= */

/* =========================================================
   RESULT
   ========================================================= */

export interface VolumeControlStabilityMeasurement {
  repStability: number[];
  stability: number;

  durationScore: number;

  averageDb: number;
  minDb: number;
  maxDb: number;

  voicedCoveragePercent: number;

  measurementQuality: number;

  durationSeconds: number;
  repetitionCount: number;
}

/* =========================================================
   CONSTANTS
   ========================================================= */

const WINDOW_MS = 50;

/*
 * Digital silence threshold.
 * This is used only for identifying usable signal.
 */
const SILENCE_DBFS = -60;

/*
 * Convert -60 dBFS into a linear RMS threshold.
 */
const MIN_VOICED_RMS =
  Math.pow(10, SILENCE_DBFS / 20);

/* =========================================================
   RMS
   ========================================================= */

function calculateRms(
  samples: Float32Array,
  start: number,
  end: number
): number {
  if (end <= start) {
    return 0;
  }

  let sumSquares = 0;
  let count = 0;

  for (
    let i = start;
    i < end;
    i += 1
  ) {
    const sample = samples[i];

    if (!Number.isFinite(sample)) {
      continue;
    }

    sumSquares += sample * sample;
    count += 1;
  }

  if (count === 0) {
    return 0;
  }

  return Math.sqrt(
    sumSquares / count
  );
}

/* =========================================================
   RMS TO dB
   ========================================================= */

export function rmsToDb(
  rms: number
): number {
  if (
    !Number.isFinite(rms) ||
    rms <= 0
  ) {
    return SILENCE_DBFS;
  }

  return 20 * Math.log10(rms);
}

/* =========================================================
   CALCULATE RMS WINDOWS
   =========================================================
   
   Produces:
   - RMS amplitude for every 50 ms window
   - dB value for every 50 ms window
   - voiced/silence flag
   ========================================================= */

export function calcRMSWindows(
  samples: Float32Array,
  sampleRate: number,
  windowMs = WINDOW_MS
): {
  rmsArray: number[];
  dbArray: number[];
  voicedArray: boolean[];
  windowSize: number;
} {
  const windowSize =
    Math.max(
      1,
      Math.round(
        sampleRate *
          (windowMs / 1000)
      )
    );

  const rmsArray: number[] = [];
  const dbArray: number[] = [];
  const voicedArray: boolean[] = [];

  for (
    let start = 0;
    start < samples.length;
    start += windowSize
  ) {
    const end =
      Math.min(
        start + windowSize,
        samples.length
      );

    const rms =
      calculateRms(
        samples,
        start,
        end
      );

    const db =
      rmsToDb(rms);

    /*
     * A usable vocal/audio signal must be above
     * the configured digital silence threshold.
     */
    const voiced =
      rms >= MIN_VOICED_RMS;

    rmsArray.push(rms);
    dbArray.push(db);
    voicedArray.push(voiced);
  }

  return {
    rmsArray,
    dbArray,
    voicedArray,
    windowSize,
  };
}

/* =========================================================
   AVERAGE
   ========================================================= */

export function calcMean(
  values: number[]
): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / values.length
  );
}

/* =========================================================
   STANDARD DEVIATION
   ========================================================= */

export function calcStandardDeviation(
  values: number[]
): number {
  if (values.length < 2) {
    return 0;
  }

  const mean =
    calcMean(values);

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) / values.length;

  return Math.sqrt(
    variance
  );
}

/* =========================================================
   VOLUME STABILITY
   =========================================================
   stability =
   100 -
   (standard deviation / mean) × 100
   ========================================================= */

export function calcVolumeStability(
  values: number[]
): number {
  const validValues =
    values.filter(
      (value) =>
        Number.isFinite(value)
    );

  if (validValues.length < 2) {
    return 0;
  }

  const mean =
    calcMean(validValues);

  if (
    !Number.isFinite(mean) ||
    mean === 0
  ) {
    return 0;
  }

  const standardDeviation =
    calcStandardDeviation(
      validValues
    );

  const stability =
    100 -
    (standardDeviation /
      Math.abs(mean)) *
      100;

  return Math.max(
    0,
    Math.min(
      100,
      stability
    )
  );
}

/* =========================================================
   POSITIVE dB FOR DISPLAY
   =========================================================
   
 */

function dbMagnitude(
  dbfs: number
): number {
  if (
    !Number.isFinite(dbfs) ||
    dbfs <= SILENCE_DBFS
  ) {
    return 0;
  }

  return Math.abs(dbfs);
}

/* =========================================================
   REPETITION MEASUREMENT
   ========================================================= */

function measureRepetition(
  amplitudes: number[],
  voicedFlags: boolean[],
  startWindow: number,
  endWindow: number
): number {
  const repetitionValues: number[] =
    [];

  for (
    let index = startWindow;
    index < endWindow;
    index += 1
  ) {
    if (
      voicedFlags[index] &&
      Number.isFinite(
        amplitudes[index]
      ) &&
      amplitudes[index] > 0
    ) {
      repetitionValues.push(
        amplitudes[index]
      );
    }
  }

  return calcVolumeStability(
    repetitionValues
  );
}

/* =========================================================
   MAIN MEASUREMENT FUNCTION
   ========================================================= */

export function measureVolumeControlStability(
  samples: Float32Array,
  sampleRate: number,
  repetitionDurationSeconds = 5,
  repetitionCount = 2
): VolumeControlStabilityMeasurement {
  /* -------------------------------------------------------
     EMPTY RESULT
     ------------------------------------------------------- */

  const emptyResult: VolumeControlStabilityMeasurement =
    {
      repStability:
        Array(
          repetitionCount
        ).fill(0),

      stability: 0,

      durationScore: 0,

      averageDb: 0,
      minDb: 0,
      maxDb: 0,

      voicedCoveragePercent: 0,

      measurementQuality: 0,

      durationSeconds: 0,

      repetitionCount,
    };

  /* -------------------------------------------------------
     VALIDATION
     ------------------------------------------------------- */

  if (
    !samples ||
    samples.length === 0 ||
    !Number.isFinite(
      sampleRate
    ) ||
    sampleRate <= 0
  ) {
    return emptyResult;
  }

  /* -------------------------------------------------------
     CALCULATE 50 ms RMS WINDOWS
     ------------------------------------------------------- */

  const {
    rmsArray,
    dbArray,
    voicedArray,
    windowSize,
  } = calcRMSWindows(
    samples,
    sampleRate,
    WINDOW_MS
  );

  if (
    rmsArray.length === 0
  ) {
    return {
      ...emptyResult,

      durationSeconds:
        samples.length /
        sampleRate,
    };
  }

  /* -------------------------------------------------------
     VOICED WINDOWS
     ------------------------------------------------------- */

  const voicedRms =
    rmsArray.filter(
      (_, index) =>
        voicedArray[index]
    );

  const voicedDb =
    dbArray
      .filter(
        (_, index) =>
          voicedArray[index]
      )
      .map(dbMagnitude);

  const totalWindows =
    rmsArray.length;

  const voicedWindows =
    voicedRms.length;

  const voicedCoveragePercent =
    totalWindows > 0
      ? (voicedWindows /
          totalWindows) *
        100
      : 0;

  if (
    voicedRms.length < 2
  ) {
    return {
      ...emptyResult,

      durationScore:
        voicedCoveragePercent,

      voicedCoveragePercent,

      durationSeconds:
        samples.length /
        sampleRate,
    };
  }

  /* -------------------------------------------------------
     OVERALL STABILITY
     
     The actual stability calculation uses amplitude/RMS
     values, as described in the manuscript.
     ------------------------------------------------------- */

  const stability =
    calcVolumeStability(
      voicedRms
    );

  /* -------------------------------------------------------
     REPETITION STABILITY
     ------------------------------------------------------- */

  const repStability: number[] =
    [];

  const samplesPerRepetition =
    sampleRate *
    repetitionDurationSeconds;

  for (
    let repetition = 0;
    repetition < repetitionCount;
    repetition += 1
  ) {
    const repetitionStartSample =
      Math.round(
        repetition *
          samplesPerRepetition
      );

    const repetitionEndSample =
      Math.min(
        samples.length,
        Math.round(
          (repetition + 1) *
            samplesPerRepetition
        )
      );

    const startWindow =
      Math.floor(
        repetitionStartSample /
          windowSize
      );

    const endWindow =
      Math.min(
        rmsArray.length,
        Math.ceil(
          repetitionEndSample /
            windowSize
        )
      );

    const repScore =
      measureRepetition(
        rmsArray,
        voicedArray,
        startWindow,
        endWindow
      );

    repStability.push(
      repScore
    );
  }


  const durationScore =
    Math.max(
      0,
      Math.min(
        100,
        voicedCoveragePercent
      )
    );

  /* -------------------------------------------------------
     VOLUME STATISTICS
     ------------------------------------------------------- */

  const averageDb =
    calcMean(
      voicedDb
    );

  const minDb =
    voicedDb.length > 0
      ? Math.min(
          ...voicedDb
        )
      : 0;

  const maxDb =
    voicedDb.length > 0
      ? Math.max(
          ...voicedDb
        )
      : 0;

  /* -------------------------------------------------------
     MEASUREMENT QUALITY
     ------------------------------------------------------- */

  const amplitudeMean =
    calcMean(
      voicedRms
    );

  const amplitudeStdDev =
    calcStandardDeviation(
      voicedRms
    );

  const amplitudeVariation =
    amplitudeMean > 0
      ? amplitudeStdDev /
        amplitudeMean
      : 1;

  /*
   * Higher consistency = better signal quality.
   */
  const signalQuality =
    Math.max(
      0,
      Math.min(
        100,
        100 -
          amplitudeVariation *
            100
      )
    );

  /*
   * Higher voiced coverage = better measurement quality.
   */
  const coverageQuality =
    Math.max(
      0,
      Math.min(
        100,
        voicedCoveragePercent
      )
    );

  const measurementQuality =
    coverageQuality * 0.5 +
    signalQuality * 0.5;

  /* -------------------------------------------------------
     RETURN MEASUREMENTS
     ------------------------------------------------------- */

  return {
    repStability,

    stability,

    durationScore,

    averageDb,

    minDb,

    maxDb,

    voicedCoveragePercent,

    measurementQuality,

    durationSeconds:
      samples.length /
      sampleRate,

    repetitionCount,
  };
}