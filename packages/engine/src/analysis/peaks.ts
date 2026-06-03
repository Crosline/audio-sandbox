/**
 * Waveform peak extraction — pure number-crunching that turns an `AudioBuffer` into the
 * min/max bins a canvas waveform draws. The engine produces these numbers; the UI draws
 * them (the engine never touches a canvas).
 *
 * A "peak" bin is the minimum and maximum sample within a slice of the buffer. Drawing a
 * vertical line from `min` to `max` per pixel column reproduces the familiar filled
 * waveform shape far more cheaply than plotting every sample.
 */

/** Min/max peaks for one channel, as parallel arrays of length `binCount`. */
export interface ChannelPeaks {
  min: Float32Array;
  max: Float32Array;
}

/** Peaks for a whole buffer: one `ChannelPeaks` per channel, plus the bin count. */
export interface WaveformPeaks {
  channels: ChannelPeaks[];
  binCount: number;
  sampleRate: number;
}

/**
 * Reduce a single channel to `binCount` min/max pairs. Each bin spans
 * `ceil(length / binCount)` samples; the final bin may be short. An empty channel yields
 * all-zero bins.
 */
export function extractChannelPeaks(samples: Float32Array, binCount: number): ChannelPeaks {
  const bins = Math.max(1, Math.floor(binCount));
  const min = new Float32Array(bins);
  const max = new Float32Array(bins);
  const length = samples.length;
  if (length === 0) return { min, max };

  const samplesPerBin = length / bins;
  for (let b = 0; b < bins; b++) {
    const start = Math.floor(b * samplesPerBin);
    const end = b === bins - 1 ? length : Math.floor((b + 1) * samplesPerBin);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < end; i++) {
      const v = samples[i] as number;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // A bin with no samples (can happen if binCount > length) stays flat at 0.
    if (lo === Infinity) {
      lo = 0;
      hi = 0;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

/**
 * Extract min/max peaks for every channel of a buffer at the requested resolution.
 * `binCount` is typically the pixel width of the waveform view.
 */
export function extractPeaks(buffer: AudioBuffer, binCount: number): WaveformPeaks {
  const channels: ChannelPeaks[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(extractChannelPeaks(buffer.getChannelData(c), binCount));
  }
  return {
    channels,
    binCount: Math.max(1, Math.floor(binCount)),
    sampleRate: buffer.sampleRate,
  };
}

/**
 * Collapse a multichannel buffer to a single set of min/max peaks (a "mono overview"),
 * taking the extreme of all channels per bin. Useful for a compact single-lane waveform.
 */
export function extractMonoPeaks(buffer: AudioBuffer, binCount: number): ChannelPeaks {
  const all = extractPeaks(buffer, binCount);
  const bins = all.binCount;
  const min = new Float32Array(bins);
  const max = new Float32Array(bins);
  min.fill(0);
  max.fill(0);
  for (const ch of all.channels) {
    for (let b = 0; b < bins; b++) {
      if ((ch.min[b] as number) < (min[b] as number)) min[b] = ch.min[b] as number;
      if ((ch.max[b] as number) > (max[b] as number)) max[b] = ch.max[b] as number;
    }
  }
  return { min, max };
}
