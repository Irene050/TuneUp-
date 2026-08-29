export interface OnsetOffsetResult {
  onsetIndex: number;
  offsetIndex: number;
  durationSeconds: number;
}

export function detectOnsetOffset(
  samples: Float32Array,
  threshold: number,
  sampleRate: number
): OnsetOffsetResult {
  let onsetIndex = -1;
  let offsetIndex = -1;

  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) {
      onsetIndex = i;
      break;
    }
  }

  if (onsetIndex === -1) {
    return { onsetIndex: 0, offsetIndex: 0, durationSeconds: 0 };
  }

  for (let i = samples.length - 1; i > onsetIndex; i--) {
    if (Math.abs(samples[i]) > threshold) {
      offsetIndex = i;
      break;
    }
  }
  if (offsetIndex === -1) offsetIndex = samples.length - 1;

  return {
    onsetIndex,
    offsetIndex,
    durationSeconds: (offsetIndex - onsetIndex) / sampleRate,
  };
}