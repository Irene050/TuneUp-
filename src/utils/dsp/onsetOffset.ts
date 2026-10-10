import { calcRMS } from "@/utils/dsp/rms";

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
  if (
    samples.length === 0 ||
    sampleRate <= 0 ||
    !Number.isFinite(threshold) ||
    threshold <= 0
  ) {
    return {
      onsetIndex: 0,
      offsetIndex: 0,
      durationSeconds: 0,
    };
  }

  const windowMs = 50;
  const windowSize = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
  const requiredActiveWindows = 3;
  const allowedInactiveWindows = 3;
  const rmsValues: number[] = [];
  const windowStartIndices: number[] = [];

  for (
    let start = 0;
    start < samples.length;
    start += windowSize
  ) {
    const end = Math.min(start + windowSize, samples.length);
    const length = end - start;
    
    if (length <= 0) {
      continue;
    }

    const rms = calcRMS(samples.subarray(start, end));

    rmsValues.push(rms);
    windowStartIndices.push(start);
  }

  if (rmsValues.length === 0) {
    return {
      onsetIndex: 0,
      offsetIndex: 0,
      durationSeconds: 0,
    };
  }

  const active =
    rmsValues.map(
      rms => rms >= threshold
    );

  let onsetWindow = -1;
  let activeCount = 0;

  for (
    let i = 0;
    i < active.length;
    i++
  ) {
    if (active[i]) {
      activeCount++;

      if (
        activeCount >=
        requiredActiveWindows
      ) {
        onsetWindow =
          i -
          requiredActiveWindows +
          1;

        break;
      }
    } else {
      activeCount = 0;
    }
  }

  if (onsetWindow === -1) {
    return {
      onsetIndex: 0,
      offsetIndex: 0,
      durationSeconds: 0,
    };
  }

  let lastActiveWindow =
    onsetWindow;

  let inactiveCount = 0;

  for (
    let i = onsetWindow + 1;
    i < active.length;
    i++
  ) {
    if (active[i]) {
      lastActiveWindow = i;
      inactiveCount = 0;
    } else {
      inactiveCount++;

      if (
        inactiveCount >=
        allowedInactiveWindows
      ) {
        break;
      }
    }
  }

  const onsetIndex = windowStartIndices[onsetWindow];

  const offsetWindowEnd = Math.min((
        windowStartIndices[
          lastActiveWindow
        ] + windowSize), samples.length);

  const offsetIndex = Math.max(onsetIndex, offsetWindowEnd - 1);
  const durationSeconds = (offsetIndex - onsetIndex) / sampleRate;

  return {
    onsetIndex,
    offsetIndex,
    durationSeconds: Math.max(
      0,
      durationSeconds
    ),
  };
}