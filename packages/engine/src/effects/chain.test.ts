import { describe, expect, it } from 'vitest';
import {
  addEffect,
  defaultEffect,
  distortionCurve,
  moveEffect,
  removeEffect,
  updateEffect,
  wetDryGains,
} from './chain.js';
import type { EffectState } from './types.js';

describe('defaultEffect', () => {
  it('builds a sane, audibly-on effect per kind with a unique id', () => {
    const f = defaultEffect('filter');
    expect(f).toMatchObject({ kind: 'filter', bypass: false, filterType: 'lowpass' });
    expect(f.id).toBeTruthy();
    expect(defaultEffect('distortion')).toMatchObject({ kind: 'distortion', drive: 0.4 });
    expect(defaultEffect('delay')).toMatchObject({ kind: 'delay', wet: 0.5 });
    expect(defaultEffect('eq')).toMatchObject({ kind: 'eq', low: 0, mid: 0, high: 0 });
  });

  it('gives each instance a distinct id', () => {
    expect(defaultEffect('filter').id).not.toBe(defaultEffect('filter').id);
  });
});

describe('chain ops are immutable', () => {
  const base: EffectState[] = [defaultEffect('filter'), defaultEffect('delay')];

  it('addEffect appends and does not mutate the input', () => {
    const next = addEffect(base, 'eq');
    expect(next).toHaveLength(3);
    expect(next[2]!.kind).toBe('eq');
    expect(base).toHaveLength(2);
  });

  it('removeEffect drops by id, no-op when absent', () => {
    const id = base[0]!.id;
    expect(removeEffect(base, id)).toHaveLength(1);
    expect(removeEffect(base, 'nope')).toHaveLength(2);
    expect(base).toHaveLength(2); // unchanged
  });

  it('moveEffect swaps neighbors and clamps at the ends', () => {
    const [a, b] = base;
    expect(moveEffect(base, b!.id, 'up').map((e) => e.id)).toEqual([b!.id, a!.id]);
    expect(moveEffect(base, a!.id, 'up').map((e) => e.id)).toEqual([a!.id, b!.id]); // clamped
    expect(moveEffect(base, b!.id, 'down').map((e) => e.id)).toEqual([a!.id, b!.id]); // clamped
    expect(moveEffect(base, 'nope', 'up')).toHaveLength(2);
  });

  it('updateEffect patches one effect immutably', () => {
    const id = base[0]!.id;
    const next = updateEffect(base, id, { wet: 0.2, bypass: true });
    expect(next[0]).toMatchObject({ wet: 0.2, bypass: true });
    expect(base[0]!.wet).toBe(1); // original untouched
    expect(next[1]).toBe(base[1]); // other entries preserved by reference
  });
});

describe('wetDryGains', () => {
  it('bypass forces full dry', () => {
    expect(wetDryGains(0.7, true)).toEqual({ dry: 1, wet: 0 });
  });
  it('linear complementary split', () => {
    expect(wetDryGains(0, false)).toEqual({ dry: 1, wet: 0 });
    expect(wetDryGains(1, false)).toEqual({ dry: 0, wet: 1 });
    expect(wetDryGains(0.25, false)).toEqual({ dry: 0.75, wet: 0.25 });
  });
  it('clamps wet to [0,1]', () => {
    expect(wetDryGains(2, false)).toEqual({ dry: 0, wet: 1 });
    expect(wetDryGains(-1, false)).toEqual({ dry: 1, wet: 0 });
  });
});

describe('distortionCurve', () => {
  it('drive=0 is the identity line', () => {
    const c = distortionCurve(0, 5);
    expect(Array.from(c)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
  it('has the requested length and stays in [-1,1], monotonic increasing', () => {
    const c = distortionCurve(0.5, 256);
    expect(c).toHaveLength(256);
    for (let i = 0; i < c.length; i++) {
      expect(c[i]!).toBeGreaterThanOrEqual(-1.0001);
      expect(c[i]!).toBeLessThanOrEqual(1.0001);
      if (i > 0) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
    }
  });
  it('drive>0 expands small signals (more gain near 0 than identity)', () => {
    const c = distortionCurve(0.8, 2048);
    // The sample just right of center should exceed its input magnitude (soft-clip boost).
    const mid = Math.floor(2048 / 2);
    const x = (mid / (2048 - 1)) * 2 - 1;
    expect(c[mid]!).toBeGreaterThan(x);
  });
});
