/**
 * The effects layer: the non-destructive pedalboard.
 *
 * Pure model + math (`chain.ts`, `types.ts`) and the Web-Audio node builder (`nodes.ts`).
 * The model layer references `EffectState` on `Track`; the transport and renderer build the
 * graph via `buildChain`.
 */
export type {
  DelayEffect,
  DistortionEffect,
  EffectKind,
  EffectOfKind,
  EffectPatch,
  EffectState,
  EffectStateBase,
  EqEffect,
  FilterEffect,
} from './types.js';
export {
  addEffect,
  defaultEffect,
  distortionCurve,
  moveEffect,
  removeEffect,
  updateEffect,
  wetDryGains,
} from './chain.js';
export { buildChain, buildEffect, type BuiltChain, type BuiltEffect } from './nodes.js';
