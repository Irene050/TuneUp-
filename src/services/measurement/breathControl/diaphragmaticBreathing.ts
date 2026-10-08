import { detectOnsetOffset } from '@/utils/dsp/onsetOffset';
import {
  calcRMS,
  calcRMSConsistency,
  rmsToDb,
} from '@/utils/dsp/rms';

export interface DiaphragmaticBreathingMeasurement {
  exhaleDurationSec: number;
  consistencyPct: number;
  volumeDb: number;
  detected: boolean;
}

export function measureDiaphragmaticBreathing(
  exhaleSamples: Float32Array,
  threshold: number,
  sampleRate: number,
): DiaphragmaticBreathingMeasurement {
  const exhaleResult =
    detectOnsetOffset(
      exhaleSamples,
      threshold,
      sampleRate,
    );

  if (
    exhaleResult.durationSeconds === 0
  ) {
    return {
      exhaleDurationSec: 0,
      consistencyPct: 0,
      volumeDb: -Infinity,
      detected: false,
    };
  }

  const exhaleSegment =
    exhaleSamples.subarray(
      exhaleResult.onsetIndex,
      exhaleResult.offsetIndex,
    );

  const consistencyPct =
    calcRMSConsistency(
      exhaleSegment,
      50,
      sampleRate,
    );

  const volumeDb =
    rmsToDb(
      calcRMS(exhaleSegment),
      1,
    );

  return {
    exhaleDurationSec:
      exhaleResult.durationSeconds,
    consistencyPct,
    volumeDb,
    detected: true,
  };
}