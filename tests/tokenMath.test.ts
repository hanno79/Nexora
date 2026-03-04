/// <reference types="vitest" />
import { normalizeTokenCount, splitTokenCount } from '../server/tokenMath';

describe('tokenMath', () => {
  it('normalizes invalid or negative values to zero', () => {
    expect(normalizeTokenCount(undefined)).toBe(0);
    expect(normalizeTokenCount(null)).toBe(0);
    expect(normalizeTokenCount(Number.NaN)).toBe(0);
    expect(normalizeTokenCount(-3)).toBe(0);
    expect(normalizeTokenCount(Infinity)).toBe(0);
    expect(normalizeTokenCount(-Infinity)).toBe(0);
  });

  it('rounds decimal token values to integers', () => {
    expect(normalizeTokenCount(8862.5)).toBe(8863);
    expect(normalizeTokenCount(8862.4)).toBe(8862);
  });

  it('splits odd totals into two integer buckets without loss', () => {
    const split = splitTokenCount(9);
    expect(split.first).toBe(4);
    expect(split.second).toBe(5);
    expect(split.first + split.second).toBe(9);
  });

  it('splits even totals into two equal buckets', () => {
    const split = splitTokenCount(8);
    expect(split.first).toBe(4);
    expect(split.second).toBe(4);
    expect(split.first + split.second).toBe(8);
  });

  it('splits zero into two zero buckets', () => {
    const split = splitTokenCount(0);
    expect(split.first).toBe(0);
    expect(split.second).toBe(0);
  });
});
