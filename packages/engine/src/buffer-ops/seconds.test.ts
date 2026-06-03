import { describe, expect, it } from 'vitest';
import { channelToArray, fakeFactory, makeMono } from '../test-helpers.js';
import {
  cutSeconds,
  framesToSeconds,
  insertSilenceSeconds,
  secondsToFrames,
  silenceRegionSeconds,
} from './seconds.js';

describe('time/frame conversion', () => {
  it('secondsToFrames uses the buffer sample rate', () => {
    const buf = makeMono([0, 0, 0, 0], 8000); // 8kHz
    expect(secondsToFrames(buf, 0)).toBe(0);
    expect(secondsToFrames(buf, 0.001)).toBe(8); // 0.001s * 8000 = 8 frames
  });

  it('framesToSeconds is the inverse', () => {
    const buf = makeMono([0, 0], 8000);
    expect(framesToSeconds(buf, 8)).toBeCloseTo(0.001, 9);
  });
});

describe('seconds wrappers delegate to frame ops', () => {
  // 10 frames @ 10 Hz => 1 frame per 0.1s, easy mapping.
  const buf = () => makeMono([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 10);

  it('cutSeconds removes the right second-range', () => {
    const { remaining } = cutSeconds(buf(), 0.2, 0.5, fakeFactory); // frames [2,5)
    expect(channelToArray(remaining)).toEqual([0, 1, 5, 6, 7, 8, 9]);
  });

  it('insertSilenceSeconds inserts the right number of frames', () => {
    const out = insertSilenceSeconds(buf(), 0.1, 0.2, fakeFactory); // at frame 1, 2 frames
    expect(channelToArray(out)).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('silenceRegionSeconds zeros the right second-range', () => {
    const out = silenceRegionSeconds(buf(), 0.3, 0.6, fakeFactory); // frames [3,6)
    expect(channelToArray(out)).toEqual([0, 1, 2, 0, 0, 0, 6, 7, 8, 9]);
  });
});
