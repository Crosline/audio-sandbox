/**
 * Effect state: plain, serializable descriptions of a track's pedalboard chain.
 *
 * Like the rest of the model these hold NO audio nodes and NO `AudioContext` — they are data.
 * The live (and offline) audio graph is built from them by `createEffectNodes` (the only place
 * that touches Web Audio). Keeping effect state pure is what lets us persist a chain to
 * IndexedDB, ship it as a game preset, and unit-test the chain logic without a browser.
 *
 * Each effect carries a shared `bypass` + `wet` (dry/wet mix), plus kind-specific params. The
 * set is intentionally small for v1 (all native Web Audio nodes); Reverb (Convolver, needs an
 * impulse response) and Bitcrush (AudioWorklet) are deferred and slot in as new `kind`s later.
 */
import type { Id } from '../model/types.js';

/** The kinds of effect available in v1. */
export type EffectKind = 'filter' | 'distortion' | 'delay' | 'eq';

/** Fields shared by every effect. */
export interface EffectStateBase {
  readonly id: Id;
  /** When true the effect contributes nothing (full dry) without being removed. */
  bypass: boolean;
  /** Dry/wet mix, 0 (all dry) .. 1 (all wet). */
  wet: number;
}

/** Biquad filter: lowpass / highpass / bandpass with cutoff + resonance. */
export interface FilterEffect extends EffectStateBase {
  kind: 'filter';
  filterType: 'lowpass' | 'highpass' | 'bandpass';
  /** Cutoff/center frequency in Hz. */
  frequency: number;
  /** Resonance / quality factor. */
  q: number;
}

/** WaveShaper distortion driven by a single `drive` amount (0..1). */
export interface DistortionEffect extends EffectStateBase {
  kind: 'distortion';
  /** Distortion amount, 0 (clean) .. 1 (heavy). */
  drive: number;
}

/** Feedback delay: delay time (s) and feedback amount (0..<1). */
export interface DelayEffect extends EffectStateBase {
  kind: 'delay';
  /** Delay time in seconds. */
  time: number;
  /** Feedback amount, 0 .. <1 (1 would self-oscillate). */
  feedback: number;
}

/** Three-band shelving/peaking EQ; each band is a gain in dB. */
export interface EqEffect extends EffectStateBase {
  kind: 'eq';
  /** Low-shelf gain (dB). */
  low: number;
  /** Peaking mid gain (dB). */
  mid: number;
  /** High-shelf gain (dB). */
  high: number;
}

/** Any effect in a chain. */
export type EffectState = FilterEffect | DistortionEffect | DelayEffect | EqEffect;

/** Narrow `EffectState` to a given kind (handy for typed param patches). */
export type EffectOfKind<K extends EffectKind> = Extract<EffectState, { kind: K }>;

/**
 * A patch over an effect's params — any subset of one effect kind's fields, never id/kind.
 * Distributed over the union so a patch may carry kind-specific keys (e.g. `frequency` for a
 * filter) while still being assignable from a narrowed effect's controls.
 */
export type EffectPatch = EffectState extends infer E
  ? E extends EffectState
    ? Partial<Omit<E, 'id' | 'kind'>>
    : never
  : never;

export type { Id };
