export interface OnsetOffsetResult {
  onsetIndex: number;
  offsetIndex: number;
  durationSeconds: number;
}

/**
 * Detects the active audio region of a recording using
 * short RMS windows instead of individual samples.
 *
 * This is more resistant to microphone noise and isolated
 * amplitude spikes.
 *
 * `threshold` is still an amplitude threshold, so existing
 * callers such as detectOnsetOffset(samples, 0.02, sampleRate)
 * remain compatible.
 */
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

  // ----------------------------------------------------------
  // ANALYSIS SETTINGS
  // ----------------------------------------------------------

  // 50 ms RMS analysis windows.
  const windowMs = 50;

  const windowSize = Math.max(
    1,
    Math.floor(
      (windowMs / 1000) * sampleRate
    )
  );

  /*
   * Require several consecutive active windows before
   * declaring that the exhale has started.
   *
   * 3 x 50 ms = approximately 150 ms.
   */
  const requiredActiveWindows = 3;

  /*
   * Allow a short interruption without immediately
   * ending the detected exhale.
   *
   * 3 x 50 ms = approximately 150 ms.
   */
  const allowedInactiveWindows = 3;

  // ----------------------------------------------------------
  // CALCULATE RMS PER WINDOW
  // ----------------------------------------------------------

  const rmsValues: number[] = [];

  const windowStartIndices: number[] = [];

  for (
    let start = 0;
    start < samples.length;
    start += windowSize
  ) {
    const end = Math.min(
      start + windowSize,
      samples.length
    );

    const length = end - start;

    if (length <= 0) {
      continue;
    }

    let sumSquares = 0;

    for (
      let i = start;
      i < end;
      i++
    ) {
      const value = samples[i];

      sumSquares +=
        value * value;
    }

    const rms = Math.sqrt(
      sumSquares / length
    );

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

  // ----------------------------------------------------------
  // ACTIVE / INACTIVE WINDOWS
  // ----------------------------------------------------------

  const active =
    rmsValues.map(
      rms => rms >= threshold
    );

  // ----------------------------------------------------------
  // FIND ONSET
  // ----------------------------------------------------------

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
        /*
         * Start at the beginning of the first
         * window in the confirmed active sequence.
         */
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

  // No sustained activity detected.
  if (onsetWindow === -1) {
    return {
      onsetIndex: 0,
      offsetIndex: 0,
      durationSeconds: 0,
    };
  }

  // ----------------------------------------------------------
  // FIND OFFSET
  // ----------------------------------------------------------

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
        /*
         * Stop at the end of the last confirmed
         * active window rather than at the first
         * quiet window.
         */
        break;
      }
    }
  }

  // ----------------------------------------------------------
  // CONVERT WINDOWS TO SAMPLE INDICES
  // ----------------------------------------------------------

  const onsetIndex =
    windowStartIndices[
      onsetWindow
    ];

  const offsetWindowEnd =
    Math.min(
      (
        windowStartIndices[
          lastActiveWindow
        ] +
        windowSize
      ),
      samples.length
    );

  const offsetIndex =
    Math.max(
      onsetIndex,
      offsetWindowEnd - 1
    );

  // ----------------------------------------------------------
  // DURATION
  // ----------------------------------------------------------

  const durationSeconds =
    (
      offsetIndex -
      onsetIndex
    ) / sampleRate;

  return {
    onsetIndex,
    offsetIndex,
    durationSeconds: Math.max(
      0,
      durationSeconds
    ),
  };
}