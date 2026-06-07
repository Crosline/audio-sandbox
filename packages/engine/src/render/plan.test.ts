import { describe, expect, it } from 'vitest';
import { createClip, createProject, createTrack } from '../model/project.js';
import { makeMono } from '../test-helpers.js';
import { resolveRenderPlan } from './plan.js';
import type { Track } from '../model/types.js';

/** A 1-second mono buffer (8000 frames @ 8000 Hz) of constant value. */
function oneSec(value = 1): AudioBuffer {
  return makeMono(new Array(8000).fill(value), 8000);
}

describe('resolveRenderPlan — window + scheduling', () => {
  it('schedules a single clip at its start over the full project window', () => {
    const clip = createClip(oneSec(), 'a', 2); // starts at t=2s, 1s long → ends at 3s
    const project = createProject('p', [createTrack('T1', [clip])]);
    const plan = resolveRenderPlan(project);

    expect(plan.start).toBe(0);
    expect(plan.end).toBe(3); // projectDuration
    expect(plan.sampleRate).toBe(8000);
    expect(plan.channels).toBe(2);
    expect(plan.lengthSamples).toBe(3 * 8000);
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0]!.clips).toHaveLength(1);
    expect(plan.tracks[0]!.clips[0]).toMatchObject({ when: 2, offset: 0, duration: 1 });
  });

  it('crops a clip that straddles the window start (offset into the buffer)', () => {
    const clip = createClip(oneSec(), 'a', 0); // 0..1s
    const project = createProject('p', [createTrack('T1', [clip])]);
    const plan = resolveRenderPlan(project, { start: 0.25, end: 0.75 });

    expect(plan.start).toBe(0.25);
    expect(plan.end).toBe(0.75);
    expect(plan.lengthSamples).toBe(Math.round(0.5 * 8000));
    const sched = plan.tracks[0]!.clips[0]!;
    expect(sched.when).toBeCloseTo(0); // clip already playing at window start
    expect(sched.offset).toBeCloseTo(0.25); // skip first 0.25s of the buffer
    expect(sched.duration).toBeCloseTo(0.5); // only the windowed half plays
  });

  it('drops clips entirely outside the window', () => {
    const inside = createClip(oneSec(), 'in', 0); // 0..1
    const outside = createClip(oneSec(), 'out', 5); // 5..6
    const project = createProject('p', [createTrack('T1', [inside, outside])]);
    const plan = resolveRenderPlan(project, { start: 0, end: 1 });
    expect(plan.tracks[0]!.clips).toHaveLength(1);
    expect(plan.tracks[0]!.clips[0]!.when).toBe(0);
  });

  it('returns an empty plan for a project with no clips', () => {
    const project = createProject('p', [createTrack('T1', [])]);
    const plan = resolveRenderPlan(project);
    expect(plan.lengthSamples).toBe(0);
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0]!.clips).toHaveLength(0);
  });

  it('honors trimStart/trimEnd: visible duration shrinks and buffer offset is shifted', () => {
    // 1s buffer, 0.25s trimmed from each end → 0.5s visible, starting at t=0 on timeline.
    const clip = { ...createClip(oneSec(), 'a', 0), trimStart: 0.25, trimEnd: 0.25 };
    const project = createProject('p', [createTrack('T1', [clip as never])]);
    const plan = resolveRenderPlan(project);

    // Project duration must reflect the trimmed (visible) length, not the full buffer.
    // (projectDuration itself doesn't know about trim until that model lands; what we CAN
    //  assert is the scheduled clip geometry, which is purely plan.ts's responsibility.)
    const sched = plan.tracks[0]!.clips[0]!;
    expect(sched.when).toBe(0); // starts at window origin
    expect(sched.offset).toBeCloseTo(0.25); // buffer read starts at the trimStart position
    expect(sched.duration).toBeCloseTo(0.5); // only the visible 0.5s is played
  });
});

/** A track with one full-window 1s clip and explicit mixer state. */
function trackWith(
  name: string,
  state: Partial<Pick<Track, 'gain' | 'muted' | 'soloed'>> = {},
): Track {
  const t = createTrack(name, [createClip(oneSec(), name, 0)]);
  return { ...t, ...state };
}

/** Find a track's plan entry by name (tracks keep model order). */
function gainOf(plan: ReturnType<typeof resolveRenderPlan>, index: number): number | undefined {
  return plan.tracks[index]?.gain;
}

describe('resolveRenderPlan — mixer resolution', () => {
  it('uses each track gain by default', () => {
    const project = createProject('p', [trackWith('A', { gain: 0.5 }), trackWith('B', { gain: 0.8 })]);
    const plan = resolveRenderPlan(project);
    expect(plan.tracks).toHaveLength(2);
    expect(gainOf(plan, 0)).toBe(0.5);
    expect(gainOf(plan, 1)).toBe(0.8);
  });

  it('excludes muted tracks', () => {
    const project = createProject('p', [trackWith('A', { muted: true }), trackWith('B')]);
    const plan = resolveRenderPlan(project);
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0]!.trackId).toBe(project.tracks[1]!.id);
  });

  it('includes muted tracks when includeMuted is set', () => {
    const project = createProject('p', [trackWith('A', { muted: true, gain: 0.3 })]);
    const plan = resolveRenderPlan(project, { includeMuted: true });
    expect(plan.tracks).toHaveLength(1);
    expect(gainOf(plan, 0)).toBe(0.3);
  });

  it('renders only soloed tracks when any track is soloed', () => {
    const project = createProject('p', [trackWith('A', { soloed: true }), trackWith('B')]);
    const plan = resolveRenderPlan(project);
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0]!.trackId).toBe(project.tracks[0]!.id);
  });

  it('forces unity gain on included tracks when unityGain is set', () => {
    const project = createProject('p', [trackWith('A', { gain: 0.2 }), trackWith('B', { gain: 0.9 })]);
    const plan = resolveRenderPlan(project, { unityGain: true });
    expect(gainOf(plan, 0)).toBe(1);
    expect(gainOf(plan, 1)).toBe(1);
  });

  it('applies per-track overrides last (gain wins over unityGain)', () => {
    const project = createProject('p', [trackWith('A', { gain: 0.2 })]);
    const overrides = new Map([[project.tracks[0]!.id, { gain: 0.42 }]]);
    const plan = resolveRenderPlan(project, { unityGain: true, overrides });
    expect(gainOf(plan, 0)).toBe(0.42);
  });

  it('an override can un-mute a track', () => {
    const project = createProject('p', [trackWith('A', { muted: true, gain: 0.7 })]);
    const overrides = new Map([[project.tracks[0]!.id, { muted: false }]]);
    const plan = resolveRenderPlan(project, { overrides });
    expect(plan.tracks).toHaveLength(1);
    expect(gainOf(plan, 0)).toBe(0.7);
  });

  it('onlyTrackId renders a single track even past another track being soloed', () => {
    const project = createProject('p', [trackWith('A', { soloed: true }), trackWith('B', { gain: 0.6 })]);
    const planB = resolveRenderPlan(project, {}, project.tracks[1]!.id);
    expect(planB.tracks).toHaveLength(1);
    expect(planB.tracks[0]!.trackId).toBe(project.tracks[1]!.id);
    expect(gainOf(planB, 0)).toBe(0.6);
  });

  it('onlyTrackId still excludes the track if it is muted', () => {
    const project = createProject('p', [trackWith('A', { muted: true })]);
    const plan = resolveRenderPlan(project, {}, project.tracks[0]!.id);
    expect(plan.tracks).toHaveLength(0);
  });
});
