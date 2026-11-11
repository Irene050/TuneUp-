import {
  LIVE_VOICE_DETECTION_THRESHOLD_DB,
  VOLUME_DBFS_MAX,
  VOLUME_DBFS_MIN,
} from '@/constants/appConstants';

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
  repetitions: Array<Float32Array | null>,
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