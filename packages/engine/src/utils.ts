/** Small pure utilities shared across the engine. No Web Audio, no DOM. */

/** Clamp a value into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError('clamp: min must be <= max');
  return Math.min(Math.max(value, min), max);
}
