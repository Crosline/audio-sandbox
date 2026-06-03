/**
 * Destructive editing primitives — the heart of the editor.
 *
 * Every function here is pure: it reads an input `AudioBuffer` and returns a brand-new
 * output `AudioBuffer` (the input is never mutated). "Destructive" refers to the editing
 * model — the app replaces a clip's buffer with the returned one — not to in-place mutation.
 *
 * Positions are given in **sample frames** (integers). Convenience wrappers in
 * `seconds.ts` accept seconds and convert. Ranges are half-open `[start, end)`, matching
 * `Array.slice` semantics, so lengths are simply `end - start`.
 *
 * Output buffers are allocated via an injected `BufferFactory` so these functions never
 * touch an `AudioContext` and run identically in the browser and in Node tests.
 */
import { clamp } from '../utils.js';
import { allocLike, type BufferFactory } from './factory.js';

/** Clamp a frame index into `[0, length]` and round to an integer. */
function clampFrame(frame: number, length: number): number {
  return clamp(Math.round(frame), 0, length);
}

/** Normalize a half-open range to integer frames within the buffer; ensures start <= end. */
function normalizeRange(buffer: AudioBuffer, start: number, end: number): [number, number] {
  const s = clampFrame(start, buffer.length);
  const e = clampFrame(end, buffer.length);
  return s <= e ? [s, e] : [e, s];
}

/** Copy a per-channel slice from `src` into `dst` at the given destination offset. */
function blit(
  src: AudioBuffer,
  dst: AudioBuffer,
  srcStart: number,
  srcEnd: number,
  dstOffset: number,
): void {
  const channels = Math.min(src.numberOfChannels, dst.numberOfChannels);
  for (let c = 0; c < channels; c++) {
    const from = src.getChannelData(c).subarray(srcStart, srcEnd);
    dst.getChannelData(c).set(from, dstOffset);
  }
}

/**
 * Return a new buffer containing only frames `[start, end)`. Non-destructive read —
 * used for clipboard copy and as a building block. An empty range yields a 1-frame-min
 * buffer is avoided: a zero-length range yields a zero-length buffer.
 */
export function copy(
  buffer: AudioBuffer,
  start: number,
  end: number,
  factory: BufferFactory,
): AudioBuffer {
  const [s, e] = normalizeRange(buffer, start, end);
  const out = allocLike(factory, buffer, e - s);
  blit(buffer, out, s, e, 0);
  return out;
}

/**
 * Remove frames `[start, end)`. Returns both the shortened buffer (`remaining`) and the
 * removed slice (`removed`) so the caller can place `removed` on the clipboard and/or
 * push an undo entry.
 */
export function cut(
  buffer: AudioBuffer,
  start: number,
  end: number,
  factory: BufferFactory,
): { remaining: AudioBuffer; removed: AudioBuffer } {
  const [s, e] = normalizeRange(buffer, start, end);
  const removed = copy(buffer, s, e, factory);

  const remaining = allocLike(factory, buffer, buffer.length - (e - s));
  blit(buffer, remaining, 0, s, 0); // head: [0, s)
  blit(buffer, remaining, e, buffer.length, s); // tail: [e, end) -> after the head
  return { remaining, removed };
}

/**
 * Keep only frames `[start, end)`, discarding everything outside. The "crop" operation.
 * (Same samples as `copy`, but named as an edit for clarity at call sites.)
 */
export function trim(
  buffer: AudioBuffer,
  start: number,
  end: number,
  factory: BufferFactory,
): AudioBuffer {
  return copy(buffer, start, end, factory);
}

/**
 * Insert `lengthFrames` of silence at frame `at`, producing a longer buffer.
 * Frames before `at` are preserved, then silence, then the remaining frames.
 */
export function insertSilence(
  buffer: AudioBuffer,
  at: number,
  lengthFrames: number,
  factory: BufferFactory,
): AudioBuffer {
  const pos = clampFrame(at, buffer.length);
  const silence = Math.max(0, Math.round(lengthFrames));
  const out = allocLike(factory, buffer, buffer.length + silence);
  blit(buffer, out, 0, pos, 0); // head: [0, pos)
  // gap [pos, pos + silence) is left zero-filled by the factory
  blit(buffer, out, pos, buffer.length, pos + silence); // tail shifted right
  return out;
}

/**
 * Zero out frames `[start, end)` in place-of a copy — returns a same-length buffer with
 * that region silenced and everything else preserved. "Silence a selection."
 */
export function silenceRegion(
  buffer: AudioBuffer,
  start: number,
  end: number,
  factory: BufferFactory,
): AudioBuffer {
  const [s, e] = normalizeRange(buffer, start, end);
  const out = allocLike(factory, buffer, buffer.length);
  blit(buffer, out, 0, s, 0); // head
  // [s, e) stays zero
  blit(buffer, out, e, buffer.length, e); // tail
  return out;
}

/**
 * Apply a linear fade-in ramp (gain 0 -> 1) across frames `[start, end)`. Frames before
 * `start` are untouched; frames at/after `end` are untouched (already full gain).
 */
export function fadeIn(
  buffer: AudioBuffer,
  start: number,
  end: number,
  factory: BufferFactory,
): AudioBuffer {
  return applyRamp(buffer, start, end, factory, (t) => t);
}

/**
 * Apply a linear fade-out ramp (gain 1 -> 0) across frames `[start, end)`. Frames before
 * `start` are untouched; frames at/after `end` become silent.
 */
export function fadeOut(
  buffer: AudioBuffer,
  start: number,
  end: number,
  factory: BufferFactory,
): AudioBuffer {
  const [, e] = normalizeRange(buffer, start, end);
  const out = applyRamp(buffer, start, end, factory, (t) => 1 - t);
  // Everything after the fade region is silent.
  for (let c = 0; c < out.numberOfChannels; c++) {
    out.getChannelData(c).fill(0, e);
  }
  return out;
}

/**
 * Copy `buffer` and multiply frames `[start, end)` by `gainAt(progress)` where `progress`
 * goes 0..1 across the region. Frames outside the region are copied verbatim.
 */
function applyRamp(
  buffer: AudioBuffer,
  start: number,
  end: number,
  factory: BufferFactory,
  gainAt: (progress: number) => number,
): AudioBuffer {
  const [s, e] = normalizeRange(buffer, start, end);
  const out = allocLike(factory, buffer, buffer.length);
  const span = e - s;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src); // copy everything first
    for (let i = s; i < e; i++) {
      const progress = span <= 1 ? 1 : (i - s) / (span - 1);
      dst[i] = (src[i] as number) * gainAt(progress);
    }
  }
  return out;
}
