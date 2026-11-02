export function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

export function clampFinite(
  value: number,
  min = 0,
  max = 100,
): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return clamp(value, min, max);
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return clamp(value, 0, 100);
}

export function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(clamp(value, 0, 100));
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function averageFinite(values: number[]): number {
  const finiteValues = values.filter(Number.isFinite);
  return average(finiteValues);
}
