import { describe, expect, it } from 'vitest';
import { clamp, VERSION } from './index.js';

describe('engine entry', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0');
  });
});

describe('clamp', () => {
  it('returns the value when inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps below the minimum', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('clamps above the maximum', () => {
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('throws when min > max', () => {
    expect(() => clamp(1, 10, 0)).toThrow(RangeError);
  });
});
