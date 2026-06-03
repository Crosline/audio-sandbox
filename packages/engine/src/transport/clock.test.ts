import { describe, expect, it } from 'vitest';
import {
  applyLoop,
  clampSeek,
  currentPosition,
  normalizeLoop,
  rawPosition,
} from './clock.js';

describe('rawPosition', () => {
  it('adds elapsed clock time to the start position', () => {
    const anchor = { startPosition: 2, startClock: 100 };
    expect(rawPosition(anchor, 100)).toBe(2); // no time elapsed
    expect(rawPosition(anchor, 103.5)).toBe(5.5); // 3.5s elapsed
  });

  it('never goes backwards if the clock reads earlier than the anchor', () => {
    const anchor = { startPosition: 2, startClock: 100 };
    expect(rawPosition(anchor, 99)).toBe(2);
  });
});

describe('applyLoop', () => {
  const loop = { start: 1, end: 3 }; // span 2

  it('passes positions through before the loop end', () => {
    expect(applyLoop(0.5, loop)).toBe(0.5);
    expect(applyLoop(2.9, loop)).toBe(2.9);
  });

  it('wraps at the loop end back to the start', () => {
    expect(applyLoop(3, loop)).toBe(1); // exactly at end -> start
    expect(applyLoop(3.5, loop)).toBe(1.5);
  });

  it('wraps multiple times for long elapsed times', () => {
    expect(applyLoop(7, loop)).toBe(1); // 7 -> (7-1)%2=0 -> 1
    expect(applyLoop(8.25, loop)).toBeCloseTo(2.25, 6); // (8.25-1)%2=1.25 -> 2.25
  });

  it('returns the position unchanged for a null or empty loop', () => {
    expect(applyLoop(5, null)).toBe(5);
    expect(applyLoop(5, { start: 2, end: 2 })).toBe(5);
  });
});

describe('currentPosition', () => {
  it('combines elapsed time with looping', () => {
    const anchor = { startPosition: 0, startClock: 10 };
    const loop = { start: 0, end: 2 };
    expect(currentPosition(anchor, 10, loop)).toBe(0);
    expect(currentPosition(anchor, 13, loop)).toBe(1); // 3 elapsed -> wrap -> 1
  });
});

describe('clampSeek', () => {
  it('clamps into [0, duration]', () => {
    expect(clampSeek(2, 5)).toBe(2);
    expect(clampSeek(-1, 5)).toBe(0);
    expect(clampSeek(99, 5)).toBe(5);
  });
  it('treats non-finite as 0', () => {
    expect(clampSeek(Number.NaN, 5)).toBe(0);
    expect(clampSeek(Number.POSITIVE_INFINITY, 5)).toBe(5);
  });
});

describe('normalizeLoop', () => {
  it('orders an inverted region', () => {
    expect(normalizeLoop({ start: 4, end: 1 })).toEqual({ start: 1, end: 4 });
  });
  it('returns null for an empty region', () => {
    expect(normalizeLoop({ start: 2, end: 2 })).toBeNull();
  });
  it('passes null through', () => {
    expect(normalizeLoop(null)).toBeNull();
  });
});
