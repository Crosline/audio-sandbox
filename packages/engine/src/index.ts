/**
 * @audiosandbox/engine — framework-agnostic browser audio engine.
 *
 * Owns audio: editing buffers, the pedalboard, transport, and export. Zero UI / DOM /
 * framework dependencies. Consumers (Svelte, React, Vue, vanilla) subscribe to its
 * events and send it commands.
 *
 * Modules land incrementally: core + model now; buffer-ops, transport, effects,
 * history, render, io, analysis in later steps.
 */

export const VERSION = '0.0.0';

// utils
export { clamp } from './utils.js';

// core
export { Emitter, type EventMap, type Listener } from './core/emitter.js';
export {
  EngineContext,
  volumeToGain,
  type EngineContextEvents,
} from './core/engine-context.js';

// model
export type { Clip, Id, Project, Track } from './model/types.js';
export {
  anyTrackSoloed,
  createClip,
  createId,
  createProject,
  createTrack,
  DEFAULT_GAIN,
  isTrackAudible,
  projectDuration,
} from './model/project.js';

// buffer-ops (destructive editing primitives, pure)
export {
  allocLike,
  copy,
  copySeconds,
  createContextFactory,
  cut,
  cutSeconds,
  extractChannel,
  fadeIn,
  fadeInSeconds,
  fadeOut,
  fadeOutSeconds,
  framesToSeconds,
  insertSilence,
  insertSilenceSeconds,
  mergeChannels,
  secondsToFrames,
  silenceRegion,
  silenceRegionSeconds,
  splitChannels,
  toMono,
  toStereo,
  trim,
  trimSeconds,
  type BufferFactory,
  type DownmixLaw,
  type ToMonoOptions,
} from './buffer-ops/index.js';
