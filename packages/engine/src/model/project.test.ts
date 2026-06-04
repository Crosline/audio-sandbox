import { describe, expect, it } from 'vitest';
import { makeMono } from '../test-helpers.js';
import {
  anyTrackSoloed,
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
