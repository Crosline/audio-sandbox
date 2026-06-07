import { describe, expect, it } from 'vitest';
import { createClip, createProject, createTrack } from '../model/project.js';
import { makeMono } from '../test-helpers.js';
import { resolveRenderPlan } from './plan.js';

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
});
