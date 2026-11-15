import {
  LIVE_VOICE_DETECTION_THRESHOLD_DB,
  VOLUME_DBFS_MAX,
  VOLUME_DBFS_MIN,
} from '@/constants/appConstants';

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface LiveVoiceDetection {
  detected: boolean;
  level: number;
}

export function getLiveVoiceDetection(
  volumeDb: number,
): LiveVoiceDetection {
  if (!Number.isFinite(volumeDb)) {
    return { detected: false, level: 0 };
  }

  return {
    detected: volumeDb >= LIVE_VOICE_DETECTION_THRESHOLD_DB,
    level: Math.max(
      0,
      Math.min(
        1,
        (volumeDb - VOLUME_DBFS_MIN) /
          (VOLUME_DBFS_MAX - VOLUME_DBFS_MIN),
      ),
    ),
  };
}

export function hasSufficientRecordedSignal(
  samples: Float32Array | null | undefined,
): boolean {
  if (!samples || samples.length === 0) {
    return false;
  }

  let sumSquares = 0;
  let peak = 0;
  let activeSamples = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];

    if (!Number.isFinite(value)) {
      continue;
    }

    const absolute = Math.abs(value);
    sumSquares += value * value;
    peak = Math.max(peak, absolute);

    if (absolute >= 0.005) {
      activeSamples += 1;
    }
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  const activeRatio = activeSamples / samples.length;

  return rms >= 0.002 && peak >= 0.01 && activeRatio >= 0.01;
}

export function fixedDurationSamples(
  samples: Float32Array,
  sampleRate: number,
  durationSeconds: number,
): Float32Array {
  const expectedLength = Math.round(sampleRate * durationSeconds);
  const result = new Float32Array(expectedLength);
  result.set(samples.subarray(0, expectedLength));
  return result;
}

export function concatenateRepetitions(
  repetitions: (Float32Array | null)[],
): Float32Array {
  const segments = repetitions.filter(
    (segment): segment is Float32Array => segment !== null,
  );
  const totalLength = segments.reduce(
    (total, segment) => total + segment.length,
    0,
  );
  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const segment of segments) {
    result.set(segment, offset);
    offset += segment.length;
  }

  return result;
}

export function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

export function clampFinite(
  value: number,
  min = 0,
  max = 100,
): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return clamp(value, min, max);
}

export function clampPercentage(value: number): number {
  return Math.round(clampFinite(value));
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function averageFinite(values: number[]): number {
  const finiteValues = values.filter(Number.isFinite);
  return average(finiteValues);
}

export function median(values: number[]): number {
  const sorted = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function formatNumber(
  value: number,
  decimals = 1,
): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

export function formatFrequency(
  frequency: number | null,
  decimals = 1,
  fallback = '--',
): string {
  if (
    frequency === null ||
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return fallback;
  }

  return `${formatNumber(frequency, decimals)} Hz`;
}
