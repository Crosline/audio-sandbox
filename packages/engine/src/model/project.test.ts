import { describe, expect, it } from 'vitest';
import { makeMono } from '../test-helpers.js';
import {
  anyTrackSoloed,
  clampClipStart,
  clipDuration,
  clipEnd,
  createClip,
  createProject,
  createTrack,
  DEFAULT_GAIN,
  isTrackAudible,
  projectDuration,
  trackTargetGain,
} from './project.js';

describe('model constructors', () => {
  it('createClip carries buffer, name, and default start', () => {
    const buf = makeMono([0, 1, 0, -1]);
    const clip = createClip(buf, 'kick.wav');
    expect(clip.buffer).toBe(buf);
    expect(clip.name).toBe('kick.wav');
    expect(clip.start).toBe(0);
    expect(clip.id).toBeTypeOf('string');
  });

  it('createTrack uses sane defaults', () => {
    const t = createTrack('Track 1');
    expect(t.gain).toBe(DEFAULT_GAIN);
    expect(t.pan).toBe(0);
    expect(t.muted).toBe(false);
    expect(t.soloed).toBe(false);
    expect(t.clips).toEqual([]);
  });

  it('createProject defaults to 120 bpm 4/4', () => {
    const p = createProject();
    expect(p.name).toBe('Untitled Project');
    expect(p.bpm).toBe(120);
    expect(p.timeSignature).toEqual([4, 4]);
  });

  it('ids are unique', () => {
    expect(createTrack('a').id).not.toBe(createTrack('b').id);
  });
});

describe('isTrackAudible (solo/mute rules)', () => {
  it('plays a normal track when nothing is soloed', () => {
    expect(isTrackAudible({ muted: false, soloed: false }, false)).toBe(true);
  });

  it('never plays a muted track', () => {
    expect(isTrackAudible({ muted: true, soloed: false }, false)).toBe(false);
    expect(isTrackAudible({ muted: true, soloed: true }, true)).toBe(false);
  });

  it('when something is soloed, only soloed tracks play', () => {
    expect(isTrackAudible({ muted: false, soloed: true }, true)).toBe(true);
    expect(isTrackAudible({ muted: false, soloed: false }, true)).toBe(false);
  });
});

describe('anyTrackSoloed', () => {
  it('detects a soloed track', () => {
    expect(anyTrackSoloed([{ soloed: false }, { soloed: true }])).toBe(true);
  });
  it('is false when none are soloed', () => {
    expect(anyTrackSoloed([{ soloed: false }, { soloed: false }])).toBe(false);
  });
  it('is false for an empty project', () => {
    expect(anyTrackSoloed([])).toBe(false);
  });
});

describe('trackTargetGain (live mixer level)', () => {
  it('is the track gain when audible (nothing soloed)', () => {
    expect(trackTargetGain({ muted: false, soloed: false, gain: 0.5 }, false)).toBe(0.5);
  });

  it('is 0 for a muted track', () => {
    expect(trackTargetGain({ muted: true, soloed: false, gain: 0.8 }, false)).toBe(0);
  });

  it('is 0 for an un-soloed track while another is soloed', () => {
    expect(trackTargetGain({ muted: false, soloed: false, gain: 0.8 }, true)).toBe(0);
  });

  it('is the track gain for a soloed track while solo is active', () => {
    expect(trackTargetGain({ muted: false, soloed: true, gain: 0.7 }, true)).toBe(0.7);
  });
});

describe('projectDuration', () => {
  it('is zero for an empty project', () => {
    expect(projectDuration({ tracks: [] })).toBe(0);
  });

  it('is the end of the latest clip across tracks', () => {
    // 44100 samples @ 44100 Hz = 1.0s
    const oneSecond = makeMono(new Array(44100).fill(0));
    const halfSecond = makeMono(new Array(22050).fill(0));
    const t1 = createTrack('t1', [createClip(oneSecond, 'a', 0)]);
    const t2 = createTrack('t2', [createClip(halfSecond, 'b', 2)]); // ends at 2.5s
    expect(projectDuration({ tracks: [t1, t2] })).toBeCloseTo(2.5, 6);
  });
});

describe('clampClipStart', () => {
  // A 1-second mono clip at sampleRate 8000 → buffer.duration === 1.
  const oneSec = () => makeMono(new Array(8000).fill(0), 8000);

  it('clamps a negative desired start to 0', () => {
    const moving = createClip(oneSec(), 'a', 5);
    const track = createTrack('t', [moving]);
    expect(clampClipStart(track, moving.id, -3)).toBe(0);
  });

  it('passes through when there are no other clips (after 0-clamp)', () => {
    const moving = createClip(oneSec(), 'a', 0);
    const track = createTrack('t', [moving]);
    expect(clampClipStart(track, moving.id, 4.2)).toBeCloseTo(4.2);
  });

  it('butts up against a left neighbor instead of overlapping it', () => {
    const left = createClip(oneSec(), 'L', 0); // occupies [0,1)
    const moving = createClip(oneSec(), 'M', 5); // 1s long
    const track = createTrack('t', [left, moving]);
    // Wants to start at 0.5 (would overlap [0,1)); nearest non-overlap is 1.0 (right of L).
    expect(clampClipStart(track, moving.id, 0.5)).toBeCloseTo(1);
  });

  it('butts up against a right neighbor instead of overlapping it', () => {
    const right = createClip(oneSec(), 'R', 3); // occupies [3,4)
    const moving = createClip(oneSec(), 'M', 0); // 1s long
    const track = createTrack('t', [moving, right]);
    // Wants 2.8 (interval [2.8,3.8) overlaps [3,4)); nearest non-overlap to the left is 2.0.
    expect(clampClipStart(track, moving.id, 2.8)).toBeCloseTo(2);
  });

  it('fits exactly into a gap between two neighbors', () => {
    const a = createClip(oneSec(), 'A', 0); // [0,1)
    const c = createClip(oneSec(), 'C', 2); // [2,3)
    const moving = createClip(oneSec(), 'M', 5); // 1s; the gap [1,2) fits it exactly
    const track = createTrack('t', [a, c, moving]);
    expect(clampClipStart(track, moving.id, 1)).toBeCloseTo(1);
  });

  it('is a no-op for a single-clip track (only the 0-clamp applies)', () => {
    const moving = createClip(oneSec(), 'M', 0);
    const track = createTrack('t', [moving]);
    expect(clampClipStart(track, moving.id, 7)).toBeCloseTo(7);
  });
});

describe('clipDuration / clipEnd', () => {
  const buf = () => makeMono(new Array(8000).fill(0), 8000); // 1.0s mono buffer

  it('untrimmed clip has the full buffer duration', () => {
    const clip = createClip(buf(), 'a', 2);
    expect(clipDuration(clip)).toBeCloseTo(1);
    expect(clipEnd(clip)).toBeCloseTo(3);
  });

  it('subtracts head and tail trim', () => {
    const clip = { ...createClip(buf(), 'a', 2), trimStart: 0.25, trimEnd: 0.1 };
    expect(clipDuration(clip)).toBeCloseTo(0.65);
    expect(clipEnd(clip)).toBeCloseTo(2.65);
  });
});
