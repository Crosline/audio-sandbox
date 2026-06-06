import { describe, expect, it } from 'vitest';
import { makeMono } from '../test-helpers.js';
import { encodeWav } from './wav.js';

/** Read a 4-char ASCII tag at a byte offset. */
function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

describe('encodeWav — int16 mono header', () => {
  it('writes a canonical 44-byte RIFF/WAVE header', () => {
    // 4 mono samples at 8000 Hz → data = 4 × 2 bytes = 8; total file = 44 + 8 = 52.
    const buf = makeMono([0, 0, 0, 0], 8000);
    const bytes = encodeWav(buf); // default int16
    const view = new DataView(bytes);

    expect(bytes.byteLength).toBe(52);
    expect(tag(view, 0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(44); // file size - 8
    expect(tag(view, 8)).toBe('WAVE');
    expect(tag(view, 12)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // AudioFormat = 1 (int PCM)
    expect(view.getUint16(22, true)).toBe(1); // numChannels
    expect(view.getUint32(24, true)).toBe(8000); // sampleRate
    expect(view.getUint32(28, true)).toBe(16000); // byteRate = rate × channels × 2
    expect(view.getUint16(32, true)).toBe(2); // blockAlign = channels × 2
    expect(view.getUint16(34, true)).toBe(16); // bitsPerSample
    expect(tag(view, 36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8); // data size
  });
});
