export function normalizeTokenCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  return Math.round(value);
}

export function splitTokenCount(total: number | null | undefined): {
  first: number;
  second: number;
} {
  const normalized = normalizeTokenCount(total);
  const first = Math.floor(normalized / 2);
  const second = normalized - first;
  return { first, second };
}
