/**
 * @audiosandbox/engine — framework-agnostic browser audio engine.
 *
 * This package owns audio: editing buffers, the pedalboard, transport, and export.
 * It has zero UI / DOM / framework dependencies. Consumers (Svelte, React, Vue, vanilla)
 * subscribe to its events and send it commands.
 *
 * The real modules (core, model, buffer-ops, transport, effects, history, render, io,
 * analysis) land in subsequent steps. For now this entry point only proves the build
 * and exposes the package version.
 */

export const VERSION = '0.0.0';

/** Clamp a value into the inclusive range [min, max]. Pure utility used across the engine. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError('clamp: min must be <= max');
  return Math.min(Math.max(value, min), max);
}
