import {
  calcCentroidStdSmoothness,
  computeSpectralCentroid,
} from '@/utils/dsp/spectral';

export interface VowelConsistencyMeasurement {
  centroidOverTime: number[];
  averageCentroidHz: number;
  smoothnessPct: number;
}

export function measureVowelConsistency(
  fftFrames: Float32Array[],
  sampleRate: number,
  fftSize = 1024,
): VowelConsistencyMeasurement {
  const centroidOverTime: number[] = [];

  let rejectedInvalidFrames = 0;
  let rejectedLowEnergyFrames = 0;

  for (const frame of fftFrames) {
    if (
      frame.length === 0 ||
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0 ||
      !Number.isInteger(fftSize) ||
      fftSize <= 0
    ) {
      rejectedInvalidFrames++;
      continue;
    }

    let magnitudeSum = 0;
    let isValidFrame = true;

    for (let i = 0; i < frame.length; i++) {
      const magnitude = frame[i];

      if (
        !Number.isFinite(magnitude) ||
        magnitude < 0
      ) {
        isValidFrame = false;
        break;
      }

      magnitudeSum += magnitude;
    }

    if (!isValidFrame || !Number.isFinite(magnitudeSum)) {
      rejectedInvalidFrames++;
      continue;
    }

    if (magnitudeSum <= 0) {
      rejectedLowEnergyFrames++;
      continue;
    }

    const centroid = computeSpectralCentroid(
      frame,
      sampleRate,
      fftSize,
    );

    if (
      !Number.isFinite(centroid) ||
      centroid <= 0 ||
      centroid > sampleRate / 2
    ) {
      rejectedInvalidFrames++;
      continue;
    }

    centroidOverTime.push(centroid);
  }

  const averageCentroidHz =
    centroidOverTime.length > 0
      ? centroidOverTime.reduce(
          (sum, centroid) => sum + centroid,
          0,
        ) / centroidOverTime.length
      : 0;

  const smoothnessPct =
    centroidOverTime.length >= 2
      ? calcCentroidStdSmoothness(centroidOverTime)
      : 0;

  console.log('🎤 VOWEL MEASUREMENT DEBUG:', {
    inputFrameCount: fftFrames.length,
    validFrameCount: centroidOverTime.length,
    rejectedInvalidFrames,
    rejectedLowEnergyFrames,
    averageCentroidHz,
    smoothnessPct,
  });

  return {
    centroidOverTime,
    averageCentroidHz,
    smoothnessPct,
  };
}