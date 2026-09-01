/*
 * One-pole high-pass filter.
 *
 * Removes low-frequency interference (e.g. ~100Hz mains hum)
 * while passing normal vocal-range frequencies through cleanly.
 *
 * Stateful: must be created fresh per recording session and fed
 * chunks IN ORDER, since it carries filter memory across calls.
 * Filtering sequential chunks with shared state is equivalent to
 * filtering the whole recording at once.
 */
export interface HighPassFilter {
  process: (samples: Float32Array) => Float32Array;
}

export function createHighPassFilter(
  cutoffHz: number,
  sampleRate: number
): HighPassFilter {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);

  let prevInput = 0;
  let prevOutput = 0;

  return {
    process(samples: Float32Array): Float32Array {
      const output = new Float32Array(samples.length);

      for (let i = 0; i < samples.length; i++) {
        const input = samples[i];

        const value =
          alpha * (prevOutput + input - prevInput);

        output[i] = value;

        prevInput = input;
        prevOutput = value;
      }

      return output;
    },
  };
}