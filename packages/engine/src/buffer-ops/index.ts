export {
  allocLike,
  createContextFactory,
  type BufferFactory,
} from './factory.js';

export { copy, cut, fadeIn, fadeOut, insertSilence, silenceRegion, trim } from './ops.js';

export {
  copySeconds,
  cutSeconds,
  fadeInSeconds,
  fadeOutSeconds,
  framesToSeconds,
  insertSilenceSeconds,
  secondsToFrames,
  silenceRegionSeconds,
  trimSeconds,
} from './seconds.js';
