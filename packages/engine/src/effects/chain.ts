/**
 * Pure, immutable operations over an effect chain (`EffectState[]`) plus the bits of DSP math
 * that don't need an `AudioContext` (the WaveShaper curve, the dry/wet mix resolution).
 *
 * Everything here is `(data) → data` — no Web Audio, no DOM — so it carries full unit coverage
 * the way `clock.ts` and `plan.ts` do. The node-building counterpart lives in `nodes.ts`.
 */
import { createId } from '../model/project.js';
import { clamp } from '../utils.js';
import type { EffectKind, EffectPatch, EffectState } from './types.js';

/** Sensible default effect for each kind (musical, audibly-on values). */
export function defaultEffect(kind: EffectKind): EffectState {
  const base = { id: createId(), bypass: false, wet: 1 };
  switch (kind) {
    case 'filter':
      return { ...base, kind, filterType: 'lowpass', frequency: 1200, q: 1 };
    case 'distortion':
      return { ...base, kind, drive: 0.4 };
    case 'delay':
      return { ...base, kind, time: 0.25, feedback: 0.35, wet: 0.5 };
    case 'eq':
      return { ...base, kind, low: 0, mid: 0, high: 0 };
  }
}

/** Append a fresh effect of `kind` to the chain. Immutable. */
export function addEffect(chain: readonly EffectState[], kind: EffectKind): EffectState[] {
  return [...chain, defaultEffect(kind)];
}

/** Remove the effect with `id` from the chain. Immutable; no-op if absent. */
export function removeEffect(chain: readonly EffectState[], id: string): EffectState[] {
  return chain.filter((e) => e.id !== id);
}

/**
 * Move the effect with `id` one slot toward the head (`'up'`) or tail (`'down'`). Clamped at
 * the ends (a no-op there). Immutable.
 */
export function moveEffect(
  chain: readonly EffectState[],
  id: string,
  dir: 'up' | 'down',
): EffectState[] {
  const i = chain.findIndex((e) => e.id === id);
  if (i < 0) return chain.slice();
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= chain.length) return chain.slice();
  const next = chain.slice();
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/**
 * Patch one effect's params immutably. The patch may only carry fields valid for that effect's
 * kind; foreign keys are ignored by the spread (and would be a type error at call sites).
 */
export function updateEffect(
  chain: readonly EffectState[],
  id: string,
  patch: EffectPatch,
): EffectState[] {
  return chain.map((e) => (e.id === id ? ({ ...e, ...patch } as EffectState) : e));
}

/**
 * Resolve the dry/wet gain pair for a wet/dry crossfade. `bypass` forces full dry regardless
 * of `wet`. `wet` is clamped to [0, 1]. Equal-power would color the sum; we use a simple linear
 * complementary split (dry = 1 - wet), which is predictable and what users expect from a mix knob.
 */
export function wetDryGains(wet: number, bypass: boolean): { dry: number; wet: number } {
  if (bypass) return { dry: 1, wet: 0 };
  const w = clamp(wet, 0, 1);
  return { dry: 1 - w, wet: w };
}

/**
 * Build a WaveShaper transfer curve for the given `drive` (0..1). `drive` 0 yields an identity
 * curve (clean passthrough); higher drive bends the curve toward a soft-clip `tanh`-like shape.
 * Classic Web Audio distortion formula scaled by drive. `samples` controls curve resolution.
 */
export function distortionCurve(drive: number, samples = 2048): Float32Array<ArrayBuffer> {
  const d = clamp(drive, 0, 1);
  const curve = new Float32Array(samples);
  // k grows with drive; at d=0, k=0 → curve is the identity line x↦x.
  const k = d * 100;
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1; // -1 .. 1
    curve[i] = k === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}
