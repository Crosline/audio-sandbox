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
  clampClipStart,
  clipDuration,
  clipEnd,
  createClip,
  createId,
  createProject,
  createTrack,
  DEFAULT_GAIN,
  isTrackAudible,
  MIN_CLIP_DURATION,
  projectDuration,
  resizeClip,
  trackTargetGain,
} from './model/project.js';

// analysis (waveform peaks, level meters, FFT taps)
export {
  amplitudeToDb,
  AnalyserTap,
  extractChannelPeaks,
  extractMonoPeaks,
  extractPeaks,
  frameLevels,
  peakAmplitude,
  rmsAmplitude,
  type AnalyserTapOptions,
  type ChannelPeaks,
  type LevelReading,
  type WaveformPeaks,
} from './analysis/index.js';

// transport (play/pause/stop/seek/loop)
export {
  applyLoop,
  clampSeek,
  currentPosition,
  normalizeLoop,
  rawPosition,
  Transport,
  type LoopRegion,
  type PlayAnchor,
  type TransportEvents,
  type TransportState,
} from './transport/index.js';

// history (bounded undo/redo stack, pure)
export { History, type HistoryLimits } from './history/index.js';

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
  insertBuffer,
  insertBufferSeconds,
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

// io (encode rendered audio to file bytes)
export { encodeWav, type WavOptions } from './io/index.js';

// render (offline OfflineAudioContext mix-down + stems)
export {
  Renderer,
  resolveRenderPlan,
  type RenderOptions,
  type RenderPlan,
  type ScheduledClip,
  type TrackOverride,
  type TrackPlan,
} from './render/index.js';
