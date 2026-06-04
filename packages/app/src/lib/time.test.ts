import { describe, expect, it } from 'vitest';
import { formatTime } from './time.js';

describe('formatTime', () => {
  it('formats zero', () => {
    expect(formatTime(0)).toBe('00:00.000');
  });

  it('formats sub-second times with milliseconds', () => {
    expect(formatTime(1.25)).toBe('00:01.250');
  });

  it('rolls over into minutes', () => {
    expect(formatTime(83.5)).toBe('01:23.500');
  });

  it('clamps negative and non-finite values to zero', () => {
    expect(formatTime(-5)).toBe('00:00.000');
    expect(formatTime(NaN)).toBe('00:00.000');
  });
});
