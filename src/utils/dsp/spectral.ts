export function computeSpectralCentroid(
  fftMagnitudes: Float32Array,
  sampleRate: number,
  fftSize = 1024
): number {
  let weightedSum = 0;
  let magnitudeSum = 0;
  for (let bin = 0; bin < fftMagnitudes.length; bin++) {
    const freq = (bin * sampleRate) / fftSize;
    weightedSum += freq * fftMagnitudes[bin];
    magnitudeSum += fftMagnitudes[bin];
  }
  return magnitudeSum === 0 ? 0 : weightedSum / magnitudeSum;
}

export type VowelBand = 'ah' | 'ee' | 'oh';

const VOWEL_FREQUENCY_RANGES: Record<VowelBand, [number, number]> = {
  ah: [700, 1200],
  ee: [2200, 3200],
  oh: [500, 900],
};

export function identifyVowelBand(centroid: number, assignedVowel: VowelBand): boolean {
  const [min, max] = VOWEL_FREQUENCY_RANGES[assignedVowel];
  return centroid >= min && centroid <= max;
}

export function calcSmoothness(centroidOverTime: number[]): number {
  if (centroidOverTime.length === 0) return 0;
  const mean = centroidOverTime.reduce((a, b) => a + b, 0) / centroidOverTime.length;
  const variance = centroidOverTime.reduce((sum, c) => sum + Math.abs(c - mean), 0) / centroidOverTime.length;
  const relativeVar = mean === 0 ? 1 : variance / mean;
  return Math.max(0, 100 - relativeVar * 100);
}

export function calcCentroidStdSmoothness(centroidArray: number[]): number {
  if (centroidArray.length === 0) return 0;
  const mean = centroidArray.reduce((a, b) => a + b, 0) / centroidArray.length;
  const variance = centroidArray.reduce((sum, c) => sum + (c - mean) ** 2, 0) / centroidArray.length;
  const stdDev = Math.sqrt(variance);
  const relativeStdDev = mean === 0 ? 1 : stdDev / mean;
  return Math.max(0, 100 - relativeStdDev * 100);
}

export function trackDominantFrequency(
  samples: Float32Array,
  frameSizeMs: number,
  sampleRate: number,
  fftFn: (frame: Float32Array) => Float32Array
): number[] {
  const frameSize = Math.floor((frameSizeMs / 1000) * sampleRate);
  const frequencies: number[] = [];
  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    const frame = samples.subarray(i, i + frameSize);
    const magnitudes = fftFn(frame);
    let peakBin = 0;
    let peakMag = 0;
    for (let bin = 0; bin < magnitudes.length; bin++) {
      if (magnitudes[bin] > peakMag) {
        peakMag = magnitudes[bin];
        peakBin = bin;
      }
    }
    frequencies.push((peakBin * sampleRate) / frameSize);
  }
  return frequencies;
}

export type ResonanceBand = 'chest' | 'head' | 'mixed';

export function classifyResonanceBand(freq: number): ResonanceBand {
  if (freq >= 80 && freq < 250) return 'chest';
  if (freq >= 250 && freq < 500) return 'head';
  return 'mixed';
}

export function calcBandStability(bandSequence: ResonanceBand[]): number {
  if (bandSequence.length === 0) return 0;
  let switches = 0;
  for (let i = 1; i < bandSequence.length; i++) {
    if (bandSequence[i] !== bandSequence[i - 1]) switches++;
  }
  return Math.max(0, 100 - (switches / bandSequence.length) * 100);
}

export function calcCrossRepConsistency(centroids: number[], amplitudes: number[]): number {
  const meanC = centroids.reduce((a, b) => a + b, 0) / centroids.length;
  const varC = centroids.reduce((sum, c) => sum + Math.abs(c - meanC), 0) / centroids.length;
  const relVarC = meanC === 0 ? 1 : varC / meanC;

  const meanA = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
  const varA = amplitudes.reduce((sum, a) => sum + Math.abs(a - meanA), 0) / amplitudes.length;
  const relVarA = meanA === 0 ? 1 : varA / meanA;

  return Math.max(0, 100 - ((relVarC + relVarA) / 2) * 100);
}

export function calcOverallToneQuality(
  smoothness: number,
  ampStability: number,
  pitchStability: number
): number {
  return smoothness * 0.4 + ampStability * 0.3 + pitchStability * 0.3;
}