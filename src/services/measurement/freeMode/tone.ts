import { calcCentroidStdSmoothness, classifyResonanceBand, computeSpectralCentroid, ResonanceBand } from '@/utils/dsp/spectral';

export interface ToneLiveReading {
  resonanceZone: ResonanceBand;
  stabilityPct: number;
}

export function measureToneFreeModeFrame(
  fftFrames: Float32Array[],
  sampleRate: number,
  fftSize = 1024
): ToneLiveReading {
  if (fftFrames.length === 0) return { resonanceZone: 'chest', stabilityPct: 0 };

  const centroidArray = fftFrames.map((f) => computeSpectralCentroid(f, sampleRate, fftSize));
  const latestCentroid = centroidArray[centroidArray.length - 1];

  return {
    resonanceZone: classifyResonanceBand(latestCentroid),
    stabilityPct: calcCentroidStdSmoothness(centroidArray),
  };
}