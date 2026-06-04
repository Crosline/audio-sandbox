export {
  allocLike,
  createContextFactory,
  type BufferFactory,
} from './factory.js';

export {
  copy,
  cut,
  fadeIn,
  fadeOut,
  insertBuffer,
  insertSilence,
  silenceRegion,
  trim,
} from './ops.js';

export {
  extractChannel,
  mergeChannels,
  splitChannels,
  toMono,
  toStereo,
  type DownmixLaw,
  type ToMonoOptions,
} from './channels.js';

export {
  copySeconds,
  cutSeconds,
  fadeInSeconds,
  fadeOutSeconds,
  framesToSeconds,
  insertBufferSeconds,
  insertSilenceSeconds,
  secondsToFrames,
  silenceRegionSeconds,
  trimSeconds,
} from './seconds.js';
