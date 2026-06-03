import { describe, expect, it } from 'vitest';
import { makeMono, makeStereo } from '../test-helpers.js';
import { extractChannelPeaks, extractMonoPeaks, extractPeaks } from './peaks.js';

describe('extractChannelPeaks', () => {
  it('captures min and max within each bin', () => {
    // 8 samples, 2 bins => bin0 = [1,-1,0.5,-0.5], bin1 = [0.2,-0.2,1,-1]
    const { min, max } = extractChannelPeaks(
      Float32Array.from([1, -1, 0.5, -0.5, 0.2, -0.2, 1, -1]),
      2,
    );
    expect(Array.from(min)).toEqual([-1, -1]);
    expect(Array.from(max)).toEqual([1, 1]);
  });

  it('a single bin spans the whole channel', () => {
    const { min, max } = extractChannelPeaks(Float32Array.from([0.3, -0.7, 0.9]), 1);
    expect(min[0]).toBeCloseTo(-0.7, 6);
    expect(max[0]).toBeCloseTo(0.9, 6);
  });

  it('an empty channel yields flat zero bins', () => {
    const { min, max } = extractChannelPeaks(new Float32Array(0), 4);
    expect(Array.from(min)).toEqual([0, 0, 0, 0]);
    expect(Array.from(max)).toEqual([0, 0, 0, 0]);
  });

  it('the last bin absorbs the remainder when length is not divisible', () => {
    // 5 samples, 2 bins: bin0 = [0,1], bin1 = [-1,0.5,0.9].
    // 0.9 stored in Float32 isn't exactly 0.9, so compare with tolerance.
    const { min, max } = extractChannelPeaks(Float32Array.from([0, 1, -1, 0.5, 0.9]), 2);
    expect(min[0]).toBe(0);
    expect(max[0]).toBe(1);
    expect(min[1]).toBe(-1);
    expect(max[1]).toBeCloseTo(0.9, 6);
  });

  it('every sample lands in exactly one bin when binCount > length', () => {
    // 1 sample, 4 bins: samplesPerBin = 0.25. Bins 0..2 are empty ranges; the last bin
    // spans [0, length) and captures the sample. So only the final bin is non-zero.
    const { min, max } = extractChannelPeaks(Float32Array.from([0.5]), 4);
    expect(Array.from(max)).toEqual([0, 0, 0, 0.5]);
    expect(Array.from(min)).toEqual([0, 0, 0, 0.5]);
  });
});

describe('extractPeaks', () => {
  it('extracts peaks per channel', () => {
    const peaks = extractPeaks(makeStereo([1, -1], [0.5, -0.5]), 1);
    expect(peaks.channels).toHaveLength(2);
    expect(peaks.channels[0]!.max[0]).toBe(1);
    expect(peaks.channels[1]!.max[0]).toBe(0.5);
    expect(peaks.sampleRate).toBe(44100);
  });
});

describe('extractMonoPeaks', () => {
  it('takes the extreme across channels per bin', () => {
    // L max 0.5, R max 1 -> mono max 1 ; L min -1, R min -0.2 -> mono min -1
    const { min, max } = extractMonoPeaks(makeStereo([0.5, -1], [1, -0.2]), 1);
    expect(max[0]).toBe(1);
    expect(min[0]).toBe(-1);
  });

  it('matches the single channel for mono input', () => {
    const { min, max } = extractMonoPeaks(makeMono([0.3, -0.7]), 1);
    expect(max[0]).toBeCloseTo(0.3, 6);
    expect(min[0]).toBeCloseTo(-0.7, 6);
  });
});
