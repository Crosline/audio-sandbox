import { describe, expect, it } from 'vitest';
import { channelToArray, fakeFactory, makeMono, makeStereo } from '../test-helpers.js';
import {
  extractChannel,
  mergeChannels,
  splitChannels,
  toMono,
  toStereo,
} from './channels.js';

describe('toMono', () => {
  it('averages stereo channels by default (-6 dB law)', () => {
    const out = toMono(makeStereo([1, 0, 1, 0], [0, 1, 0, 1]), fakeFactory);
    expect(out.numberOfChannels).toBe(1);
    expect(channelToArray(out)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('averages correlated channels without changing amplitude', () => {
    const out = toMono(makeStereo([1, -1], [1, -1]), fakeFactory);
    expect(channelToArray(out)).toEqual([1, -1]);
  });

  it('rms law scales by ~0.707', () => {
    const out = toMono(makeStereo([1, 0], [1, 0]), fakeFactory, { law: 'rms' });
    // (1*0.7071) + (1*0.7071) = 1.41421...
    expect(channelToArray(out)[0]).toBeCloseTo(Math.SQRT2, 6);
  });

  it('sum law adds channels directly', () => {
    const out = toMono(makeStereo([1, 0.25], [1, 0.25]), fakeFactory, { law: 'sum' });
    expect(channelToArray(out)).toEqual([2, 0.5]);
  });

  it('returns a faithful copy for mono input', () => {
    const out = toMono(makeMono([1, 2, 3]), fakeFactory);
    expect(channelToArray(out)).toEqual([1, 2, 3]);
  });

  it('does not mutate the input', () => {
    const input = makeStereo([1, 2], [3, 4]);
    toMono(input, fakeFactory);
    expect(channelToArray(input, 0)).toEqual([1, 2]);
    expect(channelToArray(input, 1)).toEqual([3, 4]);
  });
});

describe('toStereo', () => {
  it('duplicates a mono channel to L and R', () => {
    const out = toStereo(makeMono([1, 2, 3]), fakeFactory);
    expect(out.numberOfChannels).toBe(2);
    expect(channelToArray(out, 0)).toEqual([1, 2, 3]);
    expect(channelToArray(out, 1)).toEqual([1, 2, 3]);
  });

  it('copies a stereo buffer faithfully', () => {
    const out = toStereo(makeStereo([1, 2], [3, 4]), fakeFactory);
    expect(channelToArray(out, 0)).toEqual([1, 2]);
    expect(channelToArray(out, 1)).toEqual([3, 4]);
  });
});

describe('splitChannels', () => {
  it('splits stereo into two mono buffers', () => {
    const parts = splitChannels(makeStereo([1, 2], [3, 4]), fakeFactory);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.numberOfChannels).toBe(1);
    expect(channelToArray(parts[0]!)).toEqual([1, 2]);
    expect(channelToArray(parts[1]!)).toEqual([3, 4]);
  });

  it('returns a single buffer for mono input', () => {
    const parts = splitChannels(makeMono([5, 6]), fakeFactory);
    expect(parts).toHaveLength(1);
    expect(channelToArray(parts[0]!)).toEqual([5, 6]);
  });
});

describe('extractChannel', () => {
  it('pulls out the requested channel', () => {
    const out = extractChannel(makeStereo([1, 2], [3, 4]), 1, fakeFactory);
    expect(channelToArray(out)).toEqual([3, 4]);
  });

  it('throws on an out-of-range channel', () => {
    expect(() => extractChannel(makeMono([1]), 1, fakeFactory)).toThrow(RangeError);
  });
});

describe('mergeChannels', () => {
  it('merges two mono buffers into stereo', () => {
    const out = mergeChannels([makeMono([1, 2]), makeMono([3, 4])], fakeFactory);
    expect(out.numberOfChannels).toBe(2);
    expect(channelToArray(out, 0)).toEqual([1, 2]);
    expect(channelToArray(out, 1)).toEqual([3, 4]);
  });

  it('zero-pads shorter channels to the longest length', () => {
    const out = mergeChannels([makeMono([1, 2, 3]), makeMono([9])], fakeFactory);
    expect(out.length).toBe(3);
    expect(channelToArray(out, 1)).toEqual([9, 0, 0]);
  });

  it('throws on mismatched sample rates', () => {
    const a = makeMono([1], 44100);
    const b = makeMono([1], 48000);
    expect(() => mergeChannels([a, b], fakeFactory)).toThrow();
  });

  it('throws on an empty input list', () => {
    expect(() => mergeChannels([], fakeFactory)).toThrow();
  });

  it('round-trips split -> merge', () => {
    const original = makeStereo([1, 2, 3], [4, 5, 6]);
    const merged = mergeChannels(splitChannels(original, fakeFactory), fakeFactory);
    expect(channelToArray(merged, 0)).toEqual([1, 2, 3]);
    expect(channelToArray(merged, 1)).toEqual([4, 5, 6]);
  });
});
