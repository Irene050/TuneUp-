import {
  calcCentroidStdSmoothness,
  classifyFrequencyZone,
  computeSpectralCentroid,
  type FrequencyZone,
} from '@/utils/dsp/spectral';

export interface ToneLiveReading {
  frequencyZone: FrequencyZone;
  stabilityPct: number;
}

export function measureToneFreeModeFrame(
  fftFrames: Float32Array[],
  sampleRate: number,
  fftSize = 1024,
): ToneLiveReading {
  if (fftFrames.length === 0) {
    return {
      frequencyZone: 'low',
      stabilityPct: 0,
    };
  }

  const centroidArray = fftFrames.map((frame) =>
    computeSpectralCentroid(
      frame,
      sampleRate,
      fftSize,
    ),
  );

  const latestCentroid =
    centroidArray[centroidArray.length - 1];

  return {
    frequencyZone:
      classifyFrequencyZone(latestCentroid),
    stabilityPct:
      calcCentroidStdSmoothness(centroidArray),
  };
}