
import { analyzePitchFrame } from '@/utils/dsp/pitch';

export interface PitchLiveReading {
  detectedFrequency: number;
  stabilityPct: number;
  stabilityReady: boolean;
}

const MIN_CLARITY = 0.70;
const MIN_PITCH_HZ = 60;
const MAX_PITCH_HZ = 1500;
const MIN_STABILITY_FRAMES = 5;
const MAX_STABILITY_FRAMES = 20;
const MAX_DEVIATION_CENTS = 50;

export function measurePitchFreeModeFrame(
  runningBuffer: Float32Array,
  sampleRate: number,
  recentFrequencies: number[],
): PitchLiveReading {
  const reading = analyzePitchFrame(
    runningBuffer,
    sampleRate,
  );

  const frequency = reading.frequency;

  const validPitch =
    Number.isFinite(frequency) &&
    frequency >= MIN_PITCH_HZ &&
    frequency <= MAX_PITCH_HZ &&
    reading.clarity >= MIN_CLARITY;

  if (!validPitch) {
    return {
      detectedFrequency: 0,
      stabilityPct: 0,
      stabilityReady: false,
    };
  }

  const history = [
    ...recentFrequencies.filter(
      (value) =>
        Number.isFinite(value) &&
        value >= MIN_PITCH_HZ &&
        value <= MAX_PITCH_HZ,
    ),
    frequency,
  ].slice(-MAX_STABILITY_FRAMES);

  if (history.length < MIN_STABILITY_FRAMES) {
    return {
      detectedFrequency: frequency,
      stabilityPct: 0,
      stabilityReady: false,
    };
  }

  const meanLogFrequency =
    history.reduce(
      (sum, value) => sum + Math.log2(value),
      0,
    ) / history.length;

  const referenceFrequency = 2 ** meanLogFrequency;

  const deviationsCents = history.map(
    (value) =>
      Math.abs(
        1200 * Math.log2(value / referenceFrequency),
      ),
  );

  const meanDeviationCents =
    deviationsCents.reduce(
      (sum, value) => sum + value,
      0,
    ) / deviationsCents.length;

  const stabilityPct = Math.max(
    0,
    Math.min(
      100,
      100 *
        (1 - meanDeviationCents / MAX_DEVIATION_CENTS),
    ),
  );

  return {
    detectedFrequency: frequency,
    stabilityPct,
    stabilityReady: true,
  };
}