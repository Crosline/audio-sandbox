/**
 * Test-only helpers. NOT exported from the package entry point.
 *
 * Node's test runner has no Web Audio API, so we fabricate minimal `AudioBuffer`-shaped
 * objects from known sample data. Pure buffer-ops only touch the handful of members below
 * (`numberOfChannels`, `length`, `sampleRate`, `duration`, `getChannelData`), so a fake is
 * enough to test them with exact, predictable samples.
 */

export interface FakeAudioBufferOptions {
  sampleRate?: number;
}

/**
 * Build a fake AudioBuffer from per-channel Float32 data. All channels must be the same
 * length. Returns something assignable to `AudioBuffer` for the engine's pure functions.
 */
export function makeFakeBuffer(
  channels: Float32Array[],
  options: FakeAudioBufferOptions = {},
): AudioBuffer {
  const sampleRate = options.sampleRate ?? 44100;
  const numberOfChannels = channels.length;
  const length = channels[0]?.length ?? 0;
  for (const ch of channels) {
    if (ch.length !== length) {
      throw new Error('makeFakeBuffer: all channels must have the same length');
    }
  }

  const fake = {
    numberOfChannels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData(channel: number): Float32Array {
      const data = channels[channel];
      if (!data) throw new Error(`channel ${channel} out of range`);
      return data;
    },
    copyFromChannel(): void {
      throw new Error('copyFromChannel not implemented in fake');
    },
    copyToChannel(): void {
      throw new Error('copyToChannel not implemented in fake');
    },
  };

  return fake as unknown as AudioBuffer;
}

/** Convenience: a fake mono buffer from a plain number array. */
export function makeMono(samples: number[], sampleRate = 44100): AudioBuffer {
  return makeFakeBuffer([Float32Array.from(samples)], { sampleRate });
}

/** Convenience: a fake stereo buffer from two plain number arrays. */
export function makeStereo(left: number[], right: number[], sampleRate = 44100): AudioBuffer {
  return makeFakeBuffer([Float32Array.from(left), Float32Array.from(right)], { sampleRate });
}

/**
 * A fake `BufferFactory` (see buffer-ops/factory.ts) that allocates zero-filled fake
 * buffers — the test stand-in for `ctx.createBuffer`.
 */
export function fakeFactory(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const channels: Float32Array[] = [];
  for (let c = 0; c < numberOfChannels; c++) channels.push(new Float32Array(length));
  return makeFakeBuffer(channels, { sampleRate });
}

/** Extract a channel as a plain number[] for easy `toEqual` assertions in tests. */
export function channelToArray(buffer: AudioBuffer, channel = 0): number[] {
  return Array.from(buffer.getChannelData(channel));
}
