/**
 * Generate a tiny, valid 16-bit PCM mono WAV entirely in memory, so E2E tests don't
 * depend on the gitignored, user-provided `fixtures/` directory. The output decodes
 * reliably via the browser's `decodeAudioData` (WAV is the one format safe across all
 * browsers — see CLAUDE.md). A sine fill means playback actually produces a non-silent
 * signal, which matters for transport/stop-at-end checks.
 */

export interface WavOptions {
  /** Duration in seconds. */
  seconds: number;
  /** Sample rate in Hz. Default 44100. */
  sampleRate?: number;
  /** Sine frequency in Hz. Default 440 (A4). */
  frequency?: number;
  /** Peak amplitude 0..1. Default 0.5. */
  amplitude?: number;
}

/** Build a WAV file as a Uint8Array (RIFF / fmt PCM int16 / data). */
export function makeWav({
  seconds,
  sampleRate = 44100,
  frequency = 440,
  amplitude = 0.5,
}: WavOptions): Uint8Array {
  const numSamples = Math.max(1, Math.round(seconds * sampleRate));
  const bytesPerSample = 2; // int16
  const dataBytes = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  // RIFF header.
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true); // file size - 8
  writeStr(8, 'WAVE');

  // fmt chunk (PCM).
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM integer)
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data chunk.
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  const twoPiF = (2 * Math.PI * frequency) / sampleRate;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(twoPiF * i) * amplitude;
    // Float -> int16, clamped.
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * bytesPerSample, Math.round(clamped * 32767), true);
  }

  return new Uint8Array(buffer);
}

/**
 * Write a generated WAV to a temp file and return its path. Playwright's `setInputFiles`
 * needs a real path on disk; the caller is responsible for cleanup (or let the OS temp
 * dir handle it).
 */
export async function writeTempWav(name: string, opts: WavOptions): Promise<string> {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { writeFile } = await import('node:fs/promises');
  const path = join(tmpdir(), `audiosandbox-e2e-${Date.now()}-${name}`);
  await writeFile(path, makeWav(opts));
  return path;
}
