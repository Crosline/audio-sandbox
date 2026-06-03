/**
 * Level metering math — pure functions for RMS and peak amplitude, plus a dBFS helper.
 * The live meter (levels-tap) feeds time-domain frames through these; offline analysis can
 * use them directly on a buffer.
 */

/** Peak absolute amplitude (0..1+) over a frame. */
export function peakAmplitude(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i] as number);
    if (a > peak) peak = a;
  }
  return peak;
}

/** Root-mean-square amplitude (0..1) over a frame. Returns 0 for an empty frame. */
export function rmsAmplitude(samples: Float32Array): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] as number;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/**
 * Convert a linear amplitude (0..1) to decibels relative to full scale (dBFS).
 * Amplitude 1 -> 0 dB; 0.5 -> ~-6 dB; 0 -> -Infinity (clamped to `floorDb`).
 */
export function amplitudeToDb(amplitude: number, floorDb = -100): number {
  if (amplitude <= 0) return floorDb;
  const db = 20 * Math.log10(amplitude);
  return db < floorDb ? floorDb : db;
}

/** Combined level reading for a frame, both linear and in dBFS. */
export interface LevelReading {
  peak: number;
  rms: number;
  peakDb: number;
  rmsDb: number;
}

/** Compute peak + RMS (linear and dBFS) for a time-domain frame. */
export function frameLevels(samples: Float32Array): LevelReading {
  const peak = peakAmplitude(samples);
  const rms = rmsAmplitude(samples);
  return {
    peak,
    rms,
    peakDb: amplitudeToDb(peak),
    rmsDb: amplitudeToDb(rms),
  };
}
