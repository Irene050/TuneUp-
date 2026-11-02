export function formatNumber(
  value: number,
  decimals = 1,
): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

export function formatFrequency(
  frequency: number | null,
  decimals = 1,
  fallback = '--',
): string {
  if (
    frequency === null ||
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return fallback;
  }

  return `${formatNumber(frequency, decimals)} Hz`;
}