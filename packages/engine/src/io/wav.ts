/**
 * Encode an AudioBuffer to canonical RIFF/WAVE bytes. Pure — touches only
 * numberOfChannels / length / sampleRate / getChannelData, so it tests against fakes.
 *
 * Layout: 44-byte header (RIFF, fmt, data chunks; little-endian) + interleaved samples.
 * int16: AudioFormat=1, samples clamped to [-1,1] then scaled to signed 16-bit.
 * float32: AudioFormat=3, raw Float32 little-endian.
 */
export interface WavOptions {
  /** 16-bit signed int PCM (default) or 32-bit IEEE float. */
  format?: 'int16' | 'float32';
}

export function encodeWav(buffer: AudioBuffer, options: WavOptions = {}): ArrayBuffer {
  const format = options.format ?? 'int16';
  const isFloat = format === 'float32';
  const bytesPerSample = isFloat ? 4 : 2;
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const sampleRate = buffer.sampleRate;

  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);

  const writeTag = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, isFloat ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeTag(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave per-channel Float32 data, writing samples after the header.
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = channelData[c]![i] ?? 0;
      if (isFloat) {
        view.setFloat32(offset, sample, true);
      } else {
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      }
      offset += bytesPerSample;
    }
  }

  return bytes;
}
