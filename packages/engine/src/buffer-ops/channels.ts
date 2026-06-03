/**
 * Channel-layout conversions — pure `AudioBuffer` transforms in the same style as the
 * editing ops (input never mutated; output allocated via an injected `BufferFactory`).
 *
 * These matter especially for game audio: SFX are frequently authored in mono so the game
 * engine can spatialize them in 3D, so "import stereo, downmix to mono" and "split stereo
 * into independent mono clips" are everyday operations.
 */
import type { BufferFactory } from './factory.js';

/**
 * Downmix mixing law for combining multiple channels into one.
 * - `average`: out = sum / n  (≈ -6 dB for stereo; never clips; the safe default)
 * - `rms`:     out = sum * 0.707  (≈ -3 dB; preserves loudness for uncorrelated signals,
 *              but can clip if channels are correlated)
 * - `sum`:     out = sum  (loudest; clips easily)
 */
export type DownmixLaw = 'average' | 'rms' | 'sum';

const RMS_SCALE = Math.SQRT1_2; // 0.7071... ≈ -3 dB

/** Per-sample scale factor for a given law and channel count. */
function downmixScale(law: DownmixLaw, channelCount: number): number {
  switch (law) {
    case 'average':
      return 1 / channelCount;
    case 'rms':
      return RMS_SCALE;
    case 'sum':
      return 1;
  }
}

export interface ToMonoOptions {
  /** Mixing law for the downmix. Defaults to `average` (-6 dB, clip-safe). */
  law?: DownmixLaw;
}

/**
 * Downmix any number of channels to a single mono channel. A mono input is returned as a
 * faithful copy.
 */
export function toMono(
  buffer: AudioBuffer,
  factory: BufferFactory,
  options: ToMonoOptions = {},
): AudioBuffer {
  const law = options.law ?? 'average';
  const { numberOfChannels: n, length } = buffer;
  const out = factory(1, length, buffer.sampleRate);
  const dst = out.getChannelData(0);
  const scale = downmixScale(law, n);

  for (let c = 0; c < n; c++) {
    const src = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      dst[i] = (dst[i] as number) + (src[i] as number) * scale;
    }
  }
  return out;
}

/**
 * Produce a 2-channel stereo buffer.
 * - mono in  → duplicate the channel to L and R
 * - stereo in → faithful copy
 * - >2 channels in → downmix to mono first, then duplicate
 */
export function toStereo(buffer: AudioBuffer, factory: BufferFactory): AudioBuffer {
  const { length } = buffer;
  const out = factory(2, length, buffer.sampleRate);

  if (buffer.numberOfChannels === 2) {
    out.getChannelData(0).set(buffer.getChannelData(0));
    out.getChannelData(1).set(buffer.getChannelData(1));
    return out;
  }

  const source = buffer.numberOfChannels === 1 ? buffer : toMono(buffer, factory);
  const mono = source.getChannelData(0);
  out.getChannelData(0).set(mono);
  out.getChannelData(1).set(mono);
  return out;
}

/** Split an N-channel buffer into N independent mono buffers (channel order preserved). */
export function splitChannels(buffer: AudioBuffer, factory: BufferFactory): AudioBuffer[] {
  const result: AudioBuffer[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    result.push(extractChannel(buffer, c, factory));
  }
  return result;
}

/** Extract a single channel as a mono buffer. Throws if the index is out of range. */
export function extractChannel(
  buffer: AudioBuffer,
  channel: number,
  factory: BufferFactory,
): AudioBuffer {
  if (channel < 0 || channel >= buffer.numberOfChannels) {
    throw new RangeError(
      `extractChannel: channel ${channel} out of range (0..${buffer.numberOfChannels - 1})`,
    );
  }
  const out = factory(1, buffer.length, buffer.sampleRate);
  out.getChannelData(0).set(buffer.getChannelData(channel));
  return out;
}

/**
 * Merge several mono buffers into one multichannel buffer (e.g. two mono clips → stereo).
 * All inputs must share the same sample rate; the output length is the longest input,
 * with shorter channels zero-padded at the end.
 */
export function mergeChannels(buffers: AudioBuffer[], factory: BufferFactory): AudioBuffer {
  if (buffers.length === 0) throw new Error('mergeChannels: need at least one buffer');
  const sampleRate = buffers[0]!.sampleRate;
  let length = 0;
  for (const b of buffers) {
    if (b.sampleRate !== sampleRate) {
      throw new Error('mergeChannels: all buffers must share the same sample rate');
    }
    length = Math.max(length, b.length);
  }

  const out = factory(buffers.length, length, sampleRate);
  for (let c = 0; c < buffers.length; c++) {
    // Take channel 0 of each input (these are expected to be mono).
    out.getChannelData(c).set(buffers[c]!.getChannelData(0));
  }
  return out;
}
