/**
 * Live analysis taps — thin wrappers around `AnalyserNode` that expose FFT magnitudes and
 * live level readings for meters. The node is inserted as a pass-through: audio flows in
 * and back out unchanged while the UI polls `getSpectrum()` / `getLevels()` each frame.
 *
 * This file drives the Web Audio API and is verified in the app; the level math it returns
 * lives in the unit-tested `levels.ts`.
 */
import { frameLevels, type LevelReading } from './levels.js';

export interface AnalyserTapOptions {
  /** FFT size (power of two, 32..32768). Larger = finer frequency resolution. */
  fftSize?: number;
  /** Smoothing between frames, 0..1. Higher = smoother but laggier meters. */
  smoothing?: number;
}

/**
 * A pass-through analysis tap. Connect upstream audio into `input` and route `output`
 * onward; meanwhile poll the spectrum/levels for visualization.
 */
export class AnalyserTap {
  readonly #analyser: AnalyserNode;
  // Backed by plain ArrayBuffers (never SharedArrayBuffer), which is what the Web Audio
  // analyser methods require under the current DOM typings.
  readonly #freqData: Uint8Array<ArrayBuffer>;
  readonly #timeData: Float32Array<ArrayBuffer>;

  constructor(ctx: BaseAudioContext, options: AnalyserTapOptions = {}) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = options.fftSize ?? 2048;
    analyser.smoothingTimeConstant = options.smoothing ?? 0.8;
    this.#analyser = analyser;
    this.#freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    this.#timeData = new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT));
  }

  /** The node to connect into and out of (it passes audio through unchanged). */
  get node(): AnalyserNode {
    return this.#analyser;
  }

  /** Number of frequency bins (= fftSize / 2). */
  get binCount(): number {
    return this.#analyser.frequencyBinCount;
  }

  /**
   * Current frequency-domain magnitudes as bytes (0..255), one per bin. The same backing
   * array is reused each call to avoid per-frame allocation — copy it if you need to keep it.
   */
  getSpectrum(): Uint8Array<ArrayBuffer> {
    this.#analyser.getByteFrequencyData(this.#freqData);
    return this.#freqData;
  }

  /** Current peak + RMS levels (linear and dBFS) from the time-domain signal. */
  getLevels(): LevelReading {
    this.#analyser.getFloatTimeDomainData(this.#timeData);
    return frameLevels(this.#timeData);
  }

  /** Disconnect the tap from the graph. */
  disconnect(): void {
    this.#analyser.disconnect();
  }
}
