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
  MIN_CLIP_DURATION,
  projectDuration,
  resizeClip,
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

  it('respects trim when computing the latest end', () => {
    const buf = makeMono(new Array(8000).fill(0), 8000); // 1.0s
    const trimmed = { ...createClip(buf, 'a', 2), trimEnd: 0.4 }; // visible end = 2.6
    const track = createTrack('t1', [trimmed]);
    expect(projectDuration({ tracks: [track] })).toBeCloseTo(2.6);
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

describe('clampClipStart respects trim (visible duration)', () => {
  const buf = () => makeMono(new Array(8000).fill(0), 8000); // 1.0s

  it('a half-trimmed (0.5s) moving clip fits in a 0.5s gap', () => {
    const left = createClip(buf(), 'L', 0); // occupies [0,1)
    const right = createClip(buf(), 'R', 1.5); // occupies [1.5,2.5)
    // moving clip is 1s buffer but trimmed to 0.5s visible
    const moving = { ...createClip(buf(), 'M', 5), trimEnd: 0.5 };
    const track = createTrack('t', [left, moving, right]);
    // The [1.0,1.5) gap is exactly 0.5s — the trimmed clip fits flush at 1.0.
    expect(clampClipStart(track, moving.id, 1.0)).toBeCloseTo(1.0);
  });

  it('a trimmed neighbor occupies only its visible length, leaving more room', () => {
    const buf = () => makeMono(new Array(8000).fill(0), 8000); // 1.0s
    // neighbor has 1s buffer but trimEnd=0.5 → visible end at 0.5
    const left = { ...createClip(buf(), 'L', 0), trimEnd: 0.5 }; // visible [0, 0.5)
    // moving is 0.6s visible
    const moving = { ...createClip(buf(), 'M', 5), trimEnd: 0.4 };
    const track = createTrack('t', [left, moving]);
    // gap starts at 0.5 (trimmed neighbor end); moving 0.6s clip fits at 0.5
    expect(clampClipStart(track, moving.id, 0.5)).toBeCloseTo(0.5);
    // if the neighbor were treated as 1.0s, the moving clip would need to start at 1.0
    // — the test would fail there, proving the neighbor trim is honored
  });
});

describe('resizeClip', () => {
  const buf = () => makeMono(new Array(8000).fill(0), 8000); // 1.0s

  it('right edge: sets trimEnd, leaves start and trimStart', () => {
    const clip = createClip(buf(), 'a', 2);
    const r = resizeClip(clip, 'right', 0.3); // hide 0.3s of the tail
    expect(r.start).toBeCloseTo(2);
    expect(r.trimStart).toBeCloseTo(0);
    expect(r.trimEnd).toBeCloseTo(0.3);
  });

  it('left edge: trimStart and start move together by the same delta', () => {
    const clip = createClip(buf(), 'a', 2);
    const r = resizeClip(clip, 'left', 0.4); // hide 0.4s of the head
    expect(r.trimStart).toBeCloseTo(0.4);
    expect(r.start).toBeCloseTo(2.4); // left face moves right; audio under kept region stays put
    expect(r.trimEnd).toBeCloseTo(0);
  });

  it('clamps so visible duration never drops below MIN_CLIP_DURATION', () => {
    const clip = createClip(buf(), 'a', 2);
    const r = resizeClip(clip, 'right', 5); // absurd over-trim on a 1s clip
    expect(clipDuration({ ...clip, ...r })).toBeCloseTo(MIN_CLIP_DURATION);
  });

  it('clamps negative trim (growing past the buffer edge) to 0', () => {
    const clip = { ...createClip(buf(), 'a', 2), trimEnd: 0.3 };
    const r = resizeClip(clip, 'right', -1); // pull the right edge back out fully
    expect(r.trimEnd).toBeCloseTo(0);
  });

  it('left edge clamp also keeps start consistent', () => {
    const clip = createClip(buf(), 'a', 2);
    const r = resizeClip(clip, 'left', 5); // over-trim from the left
    expect(clipDuration({ ...clip, ...r })).toBeCloseTo(MIN_CLIP_DURATION);
    // start moved right by exactly the applied trimStart
    expect(r.start - 2).toBeCloseTo(r.trimStart);
  });

  it('left edge grow: start can go negative for a clip near origin; caller clamps', () => {
    const clip = { ...createClip(buf(), 'a', 0.1), trimStart: 0.2 };
    const r = resizeClip(clip, 'left', 0); // grow back to buffer origin
    expect(r.trimStart).toBeCloseTo(0);
    expect(r.start).toBeCloseTo(-0.1); // negative — caller responsibility to clamp
  });
});
