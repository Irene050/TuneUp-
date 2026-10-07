import { calcRMS } from '@/utils/dsp/rms';
import { computeSpectralCentroid } from '@/utils/dsp/spectral';

export interface ToneConsistencyMeasurement {
  centroids: number[];
  amplitudes: number[];
}

export function measureToneConsistency(
  repetitionSamples: Float32Array[],
  repetitionFFTFrames: Float32Array[][],
  sampleRate: number,
  fftSize = 1024,
): ToneConsistencyMeasurement {
  const centroids = repetitionFFTFrames.map((frames) => {
    if (frames.length === 0) {
      return 0;
    }

    const perFrame = frames.map((frame) =>
      computeSpectralCentroid(
        frame,
        sampleRate,
        fftSize,
      ),
    );

    return (
      perFrame.reduce(
        (sum, centroid) => sum + centroid,
        0,
      ) / perFrame.length
    );
  });

  const amplitudes = repetitionSamples.map((samples) =>
    calcRMS(samples),
  );

  return {
    centroids,
    amplitudes,
  };
}