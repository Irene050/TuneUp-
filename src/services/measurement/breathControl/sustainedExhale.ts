import { detectOnsetOffset } from '@/utils/dsp/onsetOffset';
import { calcRMSVariance } from '@/utils/dsp/rms';

export interface SustainedExhaleMeasurement {
  actualDurationSec: number;
  consistencyPct: number;
  detected: boolean;
}

export function measureSustainedExhale(
  samples: Float32Array,
  threshold: number,
  sampleRate: number
): SustainedExhaleMeasurement {
  const { onsetIndex, offsetIndex, durationSeconds } = detectOnsetOffset(samples, threshold, sampleRate);

  if (durationSeconds === 0) {
    return { actualDurationSec: 0, consistencyPct: 0, detected: false };
  }

  const exhaleSegment = samples.subarray(onsetIndex, offsetIndex);

  return {
    actualDurationSec: durationSeconds,
    consistencyPct: calcRMSVariance(exhaleSegment, 50, sampleRate),
    detected: true,
  };
}