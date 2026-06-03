/**
 * Buffer-ops are pure `AudioBuffer -> AudioBuffer` functions, but creating an output
 * `AudioBuffer` normally requires an `AudioContext` (`ctx.createBuffer(...)`). To keep the
 * ops free of any context — so they run identically in the browser and in Node tests — they
 * receive a `BufferFactory` that allocates an empty output buffer.
 *
 * In the app:   const factory = createContextFactory(audioContext)
 * In tests:     a fake factory that returns plain Float32-backed buffers
 */
export type BufferFactory = (
  numberOfChannels: number,
  length: number,
  sampleRate: number,
) => AudioBuffer;

/** Build a `BufferFactory` backed by a real `AudioContext`. */
export function createContextFactory(ctx: BaseAudioContext): BufferFactory {
  return (numberOfChannels, length, sampleRate) =>
    ctx.createBuffer(numberOfChannels, length, sampleRate);
}

/**
 * Allocate an output buffer matching the channel count and sample rate of `like`, with an
 * explicit `length`. Convenience used throughout the ops.
 */
export function allocLike(factory: BufferFactory, like: AudioBuffer, length: number): AudioBuffer {
  return factory(like.numberOfChannels, Math.max(0, length), like.sampleRate);
}
