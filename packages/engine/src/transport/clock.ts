/**
 * Pure transport timekeeping. No Web Audio here — just the math that answers
 * "where is the playhead?" given the audio clock. Keeping this pure means the tricky
 * parts (looping, clamping, play-from-point) are unit-tested without a browser.
 *
 * Convention: `position` is the playhead time in seconds from the project origin.
 * `clockTime` is a reading of the audio hardware clock (AudioContext.currentTime), which
 * only ever moves forward and is unrelated to the project origin — so we always work with
 * *deltas* of it.
 */

/** An optional loop region, in seconds from the project origin. */
export interface LoopRegion {
  start: number;
  end: number;
}

/** A snapshot of where playback was anchored, used to derive the live position. */
export interface PlayAnchor {
  /** Project position (seconds) the playhead was at when playback started. */
  startPosition: number;
  /** Audio-clock reading (seconds) captured at that same moment. */
  startClock: number;
}

/**
 * Given the anchor and a later clock reading, compute the raw (un-looped) position.
 * Elapsed wall-time since the anchor is added to the start position.
 */
export function rawPosition(anchor: PlayAnchor, clockTime: number): number {
  return anchor.startPosition + Math.max(0, clockTime - anchor.startClock);
}

/**
 * Fold a raw position into a loop region. If the region is invalid (start >= end) the raw
 * position is returned unchanged. Positions before the loop start pass through until they
 * reach it; once inside/after, they wrap within `[start, end)`.
 */
export function applyLoop(position: number, loop: LoopRegion | null): number {
  if (!loop) return position;
  const span = loop.end - loop.start;
  if (span <= 0) return position;
  if (position < loop.end) return position;
  // position has reached/passed the loop end → wrap back into the region.
  const over = (position - loop.start) % span;
  return loop.start + over;
}

/** The live playhead position: raw elapsed time folded through any loop region. */
export function currentPosition(
  anchor: PlayAnchor,
  clockTime: number,
  loop: LoopRegion | null,
): number {
  return applyLoop(rawPosition(anchor, clockTime), loop);
}

/**
 * Clamp a requested seek position into `[0, duration]`. `NaN` and negative requests become
 * 0; anything past the end (including `+Infinity`, meaning "go to the end") becomes
 * `duration`.
 */
export function clampSeek(position: number, duration: number): number {
  if (Number.isNaN(position) || position < 0) return 0;
  return Math.min(position, duration);
}

/** Normalize a loop region: returns null if empty/inverted, else the ordered region. */
export function normalizeLoop(loop: LoopRegion | null): LoopRegion | null {
  if (!loop) return null;
  const start = Math.min(loop.start, loop.end);
  const end = Math.max(loop.start, loop.end);
  return end > start ? { start, end } : null;
}
