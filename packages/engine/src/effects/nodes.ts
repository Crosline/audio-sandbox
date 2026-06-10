/**
 * The ONLY place in the effects layer that touches Web Audio. Builds the live (or offline)
 * node graph for an effect chain from its pure `EffectState`.
 *
 * Works against any `BaseAudioContext`, so the SAME code serves both the live `AudioContext`
 * (transport) and the `OfflineAudioContext` (export) — the design spec's requirement that the
 * chain be re-instantiated per context, not shared across them. Because it needs real audio
 * nodes it is verified in the app's browser E2E, not Node unit tests; the math it relies on
 * (curve, mix) is unit-tested in `chain.ts`.
 *
 * Graph shape — every effect is wrapped in a uniform dry/wet crossfade so bypass and mix are
 * handled identically for all kinds, and adding a new effect only means writing its `core`:
 *
 *     input ─┬─► dryGain ──────────────┐
 *            └─► core ─► wetGain ──────►├─► output
 *
 * A chain strings these wrappers input→output in order. The whole chain exposes one `input`
 * and one `output` node for the caller to splice between a track's gain and panner.
 */
import { distortionCurve, wetDryGains } from './chain.js';
import type { EffectState } from './types.js';

/** Declick ramp time constant (seconds) for live param/mix changes — matches the transport. */
const RAMP = 0.01;

/** A built effect: one input, one output, and an in-place param updater. */
export interface BuiltEffect {
  readonly id: string;
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Apply a new state to the existing nodes (param drags) without rebuilding. */
  update(state: EffectState, immediate?: boolean): void;
  /** Disconnect every node in this effect. */
  dispose(): void;
}

/** A built chain: one input/output spanning all effects, in order. */
export interface BuiltChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  readonly effects: BuiltEffect[];
  dispose(): void;
}

/** Ramp an AudioParam to `value` (declicked when live, instant for offline render). */
function setParam(param: AudioParam, value: number, ctx: BaseAudioContext, immediate: boolean): void {
  if (immediate) param.value = value;
  else param.setTargetAtTime(value, ctx.currentTime, RAMP);
}

/** The kind-specific core: its input/output plus an updater for its own params. */
interface EffectCore {
  input: AudioNode;
  output: AudioNode;
  update(state: EffectState, ctx: BaseAudioContext, immediate: boolean): void;
  nodes: AudioNode[];
}

function buildCore(ctx: BaseAudioContext, state: EffectState): EffectCore {
  switch (state.kind) {
    case 'filter': {
      const node = ctx.createBiquadFilter();
      const apply = (s: EffectState, im: boolean): void => {
        if (s.kind !== 'filter') return;
        node.type = s.filterType;
        setParam(node.frequency, s.frequency, ctx, im);
        setParam(node.Q, s.q, ctx, im);
      };
      apply(state, true);
      return { input: node, output: node, update: (s, _c, im) => apply(s, im), nodes: [node] };
    }
    case 'distortion': {
      const node = ctx.createWaveShaper();
      node.oversample = '2x';
      let lastDrive = NaN;
      const apply = (s: EffectState): void => {
        if (s.kind !== 'distortion') return;
        if (s.drive !== lastDrive) {
          node.curve = distortionCurve(s.drive);
          lastDrive = s.drive;
        }
      };
      apply(state);
      return { input: node, output: node, update: (s) => apply(s), nodes: [node] };
    }
    case 'delay': {
      // input → delay → feedback → (back into delay); the delayed signal is the core output.
      const delay = ctx.createDelay(5); // max 5s
      const feedback = ctx.createGain();
      delay.connect(feedback);
      feedback.connect(delay);
      const apply = (s: EffectState, im: boolean): void => {
        if (s.kind !== 'delay') return;
        setParam(delay.delayTime, s.time, ctx, im);
        setParam(feedback.gain, Math.min(0.95, Math.max(0, s.feedback)), ctx, im);
      };
      apply(state, true);
      return { input: delay, output: delay, update: (s, _c, im) => apply(s, im), nodes: [delay, feedback] };
    }
    case 'eq': {
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 250;
      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 1000;
      mid.Q.value = 1;
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 4000;
      low.connect(mid);
      mid.connect(high);
      const apply = (s: EffectState, im: boolean): void => {
        if (s.kind !== 'eq') return;
        setParam(low.gain, s.low, ctx, im);
        setParam(mid.gain, s.mid, ctx, im);
        setParam(high.gain, s.high, ctx, im);
      };
      apply(state, true);
      return { input: low, output: high, update: (s, _c, im) => apply(s, im), nodes: [low, mid, high] };
    }
  }
}

/** Build one effect wrapped in its dry/wet crossfade. */
export function buildEffect(ctx: BaseAudioContext, state: EffectState): BuiltEffect {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const core = buildCore(ctx, state);

  // input → dry → output  ;  input → core → wet → output
  input.connect(dry);
  dry.connect(output);
  input.connect(core.input);
  core.output.connect(wet);
  wet.connect(output);

  const applyMix = (s: EffectState, immediate: boolean): void => {
    const g = wetDryGains(s.wet, s.bypass);
    setParam(dry.gain, g.dry, ctx, immediate);
    setParam(wet.gain, g.wet, ctx, immediate);
  };
  applyMix(state, true);

  return {
    id: state.id,
    input,
    output,
    update(s, immediate = false): void {
      core.update(s, ctx, immediate);
      applyMix(s, immediate);
    },
    dispose(): void {
      for (const n of [input, output, dry, wet, ...core.nodes]) n.disconnect();
    },
  };
}

/**
 * Build a whole chain. Returns a passthrough `GainNode` for input and output even when the
 * chain is empty, so the caller can always wire `gain → chain.input` and `chain.output → panner`
 * without special-casing the empty case.
 */
export function buildChain(ctx: BaseAudioContext, chain: readonly EffectState[]): BuiltChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const effects: BuiltEffect[] = [];

  let tail: AudioNode = input;
  for (const state of chain) {
    const built = buildEffect(ctx, state);
    tail.connect(built.input);
    tail = built.output;
    effects.push(built);
  }
  tail.connect(output);

  return {
    input,
    output,
    effects,
    dispose(): void {
      input.disconnect();
      output.disconnect();
      for (const e of effects) e.dispose();
    },
  };
}
