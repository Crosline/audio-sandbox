import { describe, expect, it } from 'vitest';
import { channelToArray, fakeFactory, makeMono, makeStereo } from '../test-helpers.js';
import {
  copy,
  cut,
  fadeIn,
  fadeOut,
  insertBuffer,
  insertSilence,
  silenceRegion,
  trim,
} from './ops.js';

// A readable signal: 1..8, so positions are easy to reason about.
const SIG = [1, 2, 3, 4, 5, 6, 7, 8];

describe('copy', () => {
  it('returns the half-open range [start, end)', () => {
    const out = copy(makeMono(SIG), 2, 5, fakeFactory);
    expect(channelToArray(out)).toEqual([3, 4, 5]);
    expect(out.length).toBe(3);
  });

  it('copies every channel of a stereo buffer', () => {
    const out = copy(makeStereo([1, 2, 3, 4], [5, 6, 7, 8]), 1, 3, fakeFactory);
    expect(channelToArray(out, 0)).toEqual([2, 3]);
    expect(channelToArray(out, 1)).toEqual([6, 7]);
  });

  it('a zero-length range yields an empty buffer', () => {
    const out = copy(makeMono(SIG), 4, 4, fakeFactory);
    expect(out.length).toBe(0);
  });

  it('does not mutate the input', () => {
    const input = makeMono(SIG);
    copy(input, 2, 5, fakeFactory);
    expect(channelToArray(input)).toEqual(SIG);
  });

  it('clamps out-of-range indices', () => {
    const out = copy(makeMono(SIG), -3, 100, fakeFactory);
    expect(channelToArray(out)).toEqual(SIG);
  });
});

describe('cut', () => {
  it('removes [start, end) and returns the joined remainder', () => {
    const { remaining, removed } = cut(makeMono(SIG), 2, 5, fakeFactory);
    expect(channelToArray(remaining)).toEqual([1, 2, 6, 7, 8]); // head [0,2) + tail [5,8)
    expect(channelToArray(removed)).toEqual([3, 4, 5]);
  });

  it('cutting from the start keeps only the tail', () => {
    const { remaining } = cut(makeMono(SIG), 0, 3, fakeFactory);
    expect(channelToArray(remaining)).toEqual([4, 5, 6, 7, 8]);
  });

  it('cutting to the end keeps only the head', () => {
    const { remaining } = cut(makeMono(SIG), 5, 8, fakeFactory);
    expect(channelToArray(remaining)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles a reversed range (start > end) by normalizing', () => {
    const { remaining, removed } = cut(makeMono(SIG), 5, 2, fakeFactory);
    expect(channelToArray(remaining)).toEqual([1, 2, 6, 7, 8]);
    expect(channelToArray(removed)).toEqual([3, 4, 5]);
  });

  it('preserves stereo channels independently', () => {
    const { remaining } = cut(makeStereo([1, 2, 3, 4], [5, 6, 7, 8]), 1, 3, fakeFactory);
    expect(channelToArray(remaining, 0)).toEqual([1, 4]);
    expect(channelToArray(remaining, 1)).toEqual([5, 8]);
  });

  it('does not mutate the input', () => {
    const input = makeMono(SIG);
    cut(input, 2, 5, fakeFactory);
    expect(channelToArray(input)).toEqual(SIG);
  });
});

describe('trim', () => {
  it('keeps only the selected region', () => {
    const out = trim(makeMono(SIG), 2, 6, fakeFactory);
    expect(channelToArray(out)).toEqual([3, 4, 5, 6]);
  });
});

describe('insertSilence', () => {
  it('splices zeros at the insertion point', () => {
    const out = insertSilence(makeMono([1, 2, 3, 4]), 2, 3, fakeFactory);
    expect(channelToArray(out)).toEqual([1, 2, 0, 0, 0, 3, 4]);
    expect(out.length).toBe(7);
  });

  it('inserting at 0 prepends silence', () => {
    const out = insertSilence(makeMono([1, 2]), 0, 2, fakeFactory);
    expect(channelToArray(out)).toEqual([0, 0, 1, 2]);
  });

  it('inserting at the end appends silence', () => {
    const out = insertSilence(makeMono([1, 2]), 2, 2, fakeFactory);
    expect(channelToArray(out)).toEqual([1, 2, 0, 0]);
  });

  it('inserts into all channels', () => {
    const out = insertSilence(makeStereo([1, 2], [3, 4]), 1, 1, fakeFactory);
    expect(channelToArray(out, 0)).toEqual([1, 0, 2]);
    expect(channelToArray(out, 1)).toEqual([3, 0, 4]);
  });

  it('a zero-length insert is a faithful copy', () => {
    const out = insertSilence(makeMono([1, 2, 3]), 1, 0, fakeFactory);
    expect(channelToArray(out)).toEqual([1, 2, 3]);
  });
});

describe('insertBuffer', () => {
  it('splices the source samples in at the insertion point', () => {
    const out = insertBuffer(makeMono([1, 2, 3, 4]), makeMono([7, 8]), 2, fakeFactory);
    expect(channelToArray(out)).toEqual([1, 2, 7, 8, 3, 4]);
    expect(out.length).toBe(6);
  });

  it('inserting at 0 prepends the source', () => {
    const out = insertBuffer(makeMono([1, 2]), makeMono([9]), 0, fakeFactory);
    expect(channelToArray(out)).toEqual([9, 1, 2]);
  });

  it('inserting at the end appends the source', () => {
    const out = insertBuffer(makeMono([1, 2]), makeMono([9]), 2, fakeFactory);
    expect(channelToArray(out)).toEqual([1, 2, 9]);
  });

  it('inserts into all channels', () => {
    const out = insertBuffer(makeStereo([1, 2], [3, 4]), makeStereo([7], [8]), 1, fakeFactory);
    expect(channelToArray(out, 0)).toEqual([1, 7, 2]);
    expect(channelToArray(out, 1)).toEqual([3, 8, 4]);
  });

  it('clamps an out-of-range insertion point to the end', () => {
    const out = insertBuffer(makeMono([1, 2]), makeMono([9]), 99, fakeFactory);
    expect(channelToArray(out)).toEqual([1, 2, 9]);
  });

  it('does not mutate either input', () => {
    const dst = makeMono([1, 2, 3]);
    const src = makeMono([9]);
    insertBuffer(dst, src, 1, fakeFactory);
    expect(channelToArray(dst)).toEqual([1, 2, 3]);
    expect(channelToArray(src)).toEqual([9]);
  });

  it('only writes channels the destination has (mono src into stereo dst)', () => {
    const out = insertBuffer(makeStereo([1, 2], [3, 4]), makeMono([9]), 1, fakeFactory);
    expect(channelToArray(out, 0)).toEqual([1, 9, 2]);
    // src has no channel 1, so the inserted frame on the right channel stays zero-filled.
    expect(channelToArray(out, 1)).toEqual([3, 0, 4]);
  });
});

describe('silenceRegion', () => {
  it('zeros [start, end) and keeps length + surroundings', () => {
    const out = silenceRegion(makeMono(SIG), 2, 5, fakeFactory);
    expect(channelToArray(out)).toEqual([1, 2, 0, 0, 0, 6, 7, 8]);
    expect(out.length).toBe(SIG.length);
  });

  it('silences all channels', () => {
    const out = silenceRegion(makeStereo([1, 2, 3], [4, 5, 6]), 1, 2, fakeFactory);
    expect(channelToArray(out, 0)).toEqual([1, 0, 3]);
    expect(channelToArray(out, 1)).toEqual([4, 0, 6]);
  });

  it('does not mutate the input', () => {
    const input = makeMono(SIG);
    silenceRegion(input, 2, 5, fakeFactory);
    expect(channelToArray(input)).toEqual(SIG);
  });
});

describe('fadeIn', () => {
  it('ramps gain 0 -> 1 linearly across the region', () => {
    // 5 ones, fade across all 5 frames: progress = i/(5-1) => 0,.25,.5,.75,1
    const out = fadeIn(makeMono([1, 1, 1, 1, 1]), 0, 5, fakeFactory);
    expect(channelToArray(out)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('leaves frames after the region untouched (full gain)', () => {
    const out = fadeIn(makeMono([1, 1, 1, 1]), 0, 2, fakeFactory);
    // region [0,2): progress 0,1 -> 0,1 ; frames 2,3 untouched
    expect(channelToArray(out)).toEqual([0, 1, 1, 1]);
  });
});

describe('fadeOut', () => {
  it('ramps gain 1 -> 0 linearly across the region', () => {
    const out = fadeOut(makeMono([1, 1, 1, 1, 1]), 0, 5, fakeFactory);
    expect(channelToArray(out)).toEqual([1, 0.75, 0.5, 0.25, 0]);
  });

  it('silences everything after the fade region', () => {
    const out = fadeOut(makeMono([1, 1, 1, 1]), 0, 2, fakeFactory);
    // region [0,2): 1 -> 0 ; frames 2,3 forced silent
    expect(channelToArray(out)).toEqual([1, 0, 0, 0]);
  });
});
