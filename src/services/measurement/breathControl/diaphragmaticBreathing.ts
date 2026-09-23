import { detectOnsetOffset } from '@/utils/dsp/onsetOffset';
import { calcRMS, calcRMSVariance, rmsToDb } from '@/utils/dsp/rms';

export interface DiaphragmaticBreathingMeasurement {
  inhaleDurationSec: number;
  exhaleDurationSec: number;
  consistencyPct: number;
  volumeDb: number;
  detected: boolean;
}

export function measureDiaphragmaticBreathing(
  inhaleSamples: Float32Array,
  exhaleSamples: Float32Array,
  threshold: number,
  sampleRate: number
): DiaphragmaticBreathingMeasurement {
  const inhaleResult = detectOnsetOffset(inhaleSamples, threshold, sampleRate);
  const exhaleResult = detectOnsetOffset(exhaleSamples, threshold, sampleRate);

  if (inhaleResult.durationSeconds === 0 || exhaleResult.durationSeconds === 0) {
    return {
      inhaleDurationSec: inhaleResult.durationSeconds,
      exhaleDurationSec: exhaleResult.durationSeconds,
      consistencyPct: 0,
      volumeDb: -Infinity,
      detected: false,
    };
  }

  const exhaleSegment = exhaleSamples.subarray(exhaleResult.onsetIndex, exhaleResult.offsetIndex);
  const consistencyPct = calcRMSVariance(exhaleSegment, 50, sampleRate);
  const volumeDb = rmsToDb(calcRMS(exhaleSegment), 1);

  return {
    inhaleDurationSec: inhaleResult.durationSeconds,
    exhaleDurationSec: exhaleResult.durationSeconds,
    consistencyPct,
    volumeDb,
    detected: true,
  };
}