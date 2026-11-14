import {
  calcIntervalAccuracy,
  calcPulseConsistency,
  detectPulses,
  type Peak,
} from '@/utils/dsp/pulses';

import { calcRMS } from '@/utils/dsp/rms';

export interface ControlledBreathReleaseMeasurement {
  peaks: Peak[];
  intervalsSec: number[];
  pulseConsistencyPct: number;
  intervalAccuracyPct: number;
  maxPulseCount?: number;
}

export function measureControlledBreathRelease(
  samples: Float32Array,
  targetIntervalSec: number,
  sampleRate: number,
  maxPulseCount?: number,
): ControlledBreathReleaseMeasurement {
  const rmsLevel = calcRMS(samples);
  const detectedPeaks = detectPulses(
    samples,
    rmsLevel,
    sampleRate,
  );

  const limitedPeaks =
    typeof maxPulseCount === 'number'
      ? detectedPeaks.slice(
          0,
          Math.max(0, maxPulseCount),
        )
      : detectedPeaks;

  const intervalsSec: number[] = [];

  for (let i = 1; i < limitedPeaks.length; i += 1) {
    const previous = limitedPeaks[i - 1];
    const current = limitedPeaks[i];

    const interval = current.timestamp - previous.timestamp;

    if (Number.isFinite(interval) && interval > 0) {
      intervalsSec.push(interval);
    }
  }

  return {
    peaks: limitedPeaks,
    intervalsSec,
    pulseConsistencyPct: calcPulseConsistency(limitedPeaks),
    intervalAccuracyPct: calcIntervalAccuracy(
      limitedPeaks,
      targetIntervalSec,
    ),
    maxPulseCount,
  };
}