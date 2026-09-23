import { detectOnsetOffset } from '@/utils/dsp/onsetOffset';
import { calcRMSVariance } from '@/utils/dsp/rms';

export interface SustainedSSSSMeasurement {
  actualDurationSec: number;
  consistencyPct: number;
  detected: boolean;
}

export function measureSustainedSSSS(
  samples: Float32Array,
  threshold: number,
  sampleRate: number
): SustainedSSSSMeasurement {
  const { onsetIndex, offsetIndex, durationSeconds } = detectOnsetOffset(samples, threshold, sampleRate);

  if (durationSeconds === 0) {
    return { actualDurationSec: 0, consistencyPct: 0, detected: false };
  }

  const ssssSegment = samples.subarray(onsetIndex, offsetIndex);

  return {
    actualDurationSec: durationSeconds,
    consistencyPct: calcRMSVariance(ssssSegment, 50, sampleRate),
    detected: true,
  };
}