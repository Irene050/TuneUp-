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
  const {
    onsetIndex,
    offsetIndex,
    durationSeconds,
  } = detectOnsetOffset(
    samples,
    threshold,
    sampleRate
  );

  // No sustained sound detected.
  if (
    durationSeconds <= 0 ||
    offsetIndex <= onsetIndex
  ) {
    return {
      actualDurationSec: 0,
      consistencyPct: 0,
      detected: false,
    };
  }

  const exhaleSegment =
    samples.subarray(
      onsetIndex,
      offsetIndex + 1
    );

  // Prevent invalid/negative consistency values
  // from reaching the scoring system.
  const rawConsistency =
    calcRMSVariance(
      exhaleSegment,
      50,
      sampleRate
    );

  const consistencyPct = Math.min(
    100,
    Math.max(
      0,
      Number.isFinite(rawConsistency)
        ? rawConsistency
        : 0
    )
  );

  return {
    actualDurationSec: Math.max(
      0,
      durationSeconds
    ),
    consistencyPct,
    detected: true,
  };
}