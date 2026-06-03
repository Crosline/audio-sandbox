/**
 * The audio root: owns the `AudioContext` and a master gain node feeding the speakers.
 * Everything the engine plays connects to `master`; everything the user hears passes
 * through it.
 *
 * Browsers start an `AudioContext` in the "suspended" state until a user gesture, so
 * `resume()` must be called from a click/keypress handler before playback. We surface the
 * context state via events so the UI can show a "click to enable audio" affordance.
 *
 * This file touches the Web Audio API and is therefore exercised through the app rather
 * than Node unit tests; the pure value-mapping (`volumeToGain`) is unit-tested.
 */
import { clamp } from '../utils.js';
import { Emitter } from './emitter.js';

export interface EngineContextEvents extends Record<string, unknown> {
  /** Fired when the underlying AudioContext state changes (suspended/running/closed). */
  statechange: AudioContextState;
  /** Fired when the master volume changes. Payload is linear gain 0..1. */
  volumechange: number;
}

/**
 * Map a UI volume (0..100) to a linear gain (0..1). Kept pure and separate so it can be
 * unit-tested and reused by the UI without an AudioContext.
 */
export function volumeToGain(volume0to100: number): number {
  return clamp(volume0to100, 0, 100) / 100;
}

export class EngineContext {
  readonly events = new Emitter<EngineContextEvents>();

  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  /** Remembered so master volume can be set before the context is created. */
  #masterGain = 1;

  /** The live AudioContext, created on first access (lazy — avoids autoplay warnings). */
  get context(): AudioContext {
    if (!this.#ctx) this.#init();
    return this.#ctx as AudioContext;
  }

  /** The master gain node. All playback should connect here, not to `destination`. */
  get master(): GainNode {
    if (!this.#master) this.#init();
    return this.#master as GainNode;
  }

  get state(): AudioContextState {
    return this.#ctx?.state ?? 'suspended';
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  /** Current time on the audio clock, in seconds. Used by the transport for scheduling. */
  get currentTime(): number {
    return this.context.currentTime;
  }

  #init(): void {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = this.#masterGain;
    master.connect(ctx.destination);
    ctx.addEventListener('statechange', () => this.events.emit('statechange', ctx.state));
    this.#ctx = ctx;
    this.#master = master;
  }

  /** Resume the context. Call from a user-gesture handler before playback. */
  async resume(): Promise<void> {
    await this.context.resume();
  }

  /** Suspend the context to save CPU when idle. */
  async suspend(): Promise<void> {
    if (this.#ctx) await this.#ctx.suspend();
  }

  /** Set master volume from a linear gain 0..1. */
  setMasterGain(gain: number): void {
    this.#masterGain = clamp(gain, 0, 1);
    if (this.#master) this.#master.gain.value = this.#masterGain;
    this.events.emit('volumechange', this.#masterGain);
  }

  /** Set master volume from a UI value 0..100. */
  setMasterVolume(volume0to100: number): void {
    this.setMasterGain(volumeToGain(volume0to100));
  }

  get masterGain(): number {
    return this.#masterGain;
  }

  /** Tear down the audio graph and release the context. */
  async close(): Promise<void> {
    if (this.#ctx) {
      await this.#ctx.close();
      this.#ctx = null;
      this.#master = null;
    }
    this.events.clear();
  }
}
