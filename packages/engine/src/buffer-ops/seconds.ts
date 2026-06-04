/**
 * Seconds-based wrappers around the frame-based ops. The UI selects regions in seconds;
 * these convert to sample frames using the buffer's own sample rate, then delegate.
 */
import type { BufferFactory } from './factory.js';
import * as ops from './ops.js';

/** Convert a time in seconds to a sample-frame index for the given buffer. */
export function secondsToFrames(buffer: AudioBuffer, seconds: number): number {
  return Math.round(seconds * buffer.sampleRate);
}

/** Convert a sample-frame index to a time in seconds for the given buffer. */
export function framesToSeconds(buffer: AudioBuffer, frames: number): number {
  return frames / buffer.sampleRate;
}

export function copySeconds(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  factory: BufferFactory,
): AudioBuffer {
  return ops.copy(buffer, secondsToFrames(buffer, startSec), secondsToFrames(buffer, endSec), factory);
}

export function cutSeconds(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  factory: BufferFactory,
): { remaining: AudioBuffer; removed: AudioBuffer } {
  return ops.cut(buffer, secondsToFrames(buffer, startSec), secondsToFrames(buffer, endSec), factory);
}

export function trimSeconds(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  factory: BufferFactory,
): AudioBuffer {
  return ops.trim(buffer, secondsToFrames(buffer, startSec), secondsToFrames(buffer, endSec), factory);
}

export function insertSilenceSeconds(
  buffer: AudioBuffer,
  atSec: number,
  durationSec: number,
  factory: BufferFactory,
): AudioBuffer {
  return ops.insertSilence(
    buffer,
    secondsToFrames(buffer, atSec),
    secondsToFrames(buffer, durationSec),
    factory,
  );
}

export function insertBufferSeconds(
  dst: AudioBuffer,
  src: AudioBuffer,
  atSec: number,
  factory: BufferFactory,
): AudioBuffer {
  return ops.insertBuffer(dst, src, secondsToFrames(dst, atSec), factory);
}

export function silenceRegionSeconds(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  factory: BufferFactory,
): AudioBuffer {
  return ops.silenceRegion(
    buffer,
    secondsToFrames(buffer, startSec),
    secondsToFrames(buffer, endSec),
    factory,
  );
}

export function fadeInSeconds(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  factory: BufferFactory,
): AudioBuffer {
  return ops.fadeIn(buffer, secondsToFrames(buffer, startSec), secondsToFrames(buffer, endSec), factory);
}

export function fadeOutSeconds(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  factory: BufferFactory,
): AudioBuffer {
  return ops.fadeOut(buffer, secondsToFrames(buffer, startSec), secondsToFrames(buffer, endSec), factory);
}
