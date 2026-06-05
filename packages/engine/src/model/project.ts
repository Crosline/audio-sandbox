/**
 * Pure constructors and queries over the project model. No audio nodes, no context —
 * just data in, data out, so every function here is trivially unit-testable.
 */
import type { Clip, Id, Project, Track } from './types.js';

/** Generate a unique id. Uses the platform `crypto.randomUUID` (Node 20+ and browsers). */
export function createId(): Id {
  return crypto.randomUUID();
}

/** Default linear gain for a new track (unity — UI shows this as 100). */
export const DEFAULT_GAIN = 1.0;

export function createClip(buffer: AudioBuffer, name: string, start = 0): Clip {
  return { id: createId(), buffer, name, start };
}

export function createTrack(name: string, clips: Clip[] = []): Track {
  return {
    id: createId(),
    name,
    clips,
    gain: DEFAULT_GAIN,
    pan: 0,
    muted: false,
    soloed: false,
  };
}

export function createProject(name = 'Untitled Project', tracks: Track[] = []): Project {
  return {
    id: createId(),
    name,
    tracks,
    bpm: 120,
    timeSignature: [4, 4],
  };
}

/**
 * Whether a track should be heard, accounting for solo. The rule (matching DAWs):
 * if ANY track is soloed, only soloed tracks play; a muted track is never heard.
 *
 * @param track  the track to test
 * @param anySoloed  whether any track in the project is currently soloed
 */
export function isTrackAudible(track: Pick<Track, 'muted' | 'soloed'>, anySoloed: boolean): boolean {
  if (track.muted) return false;
  if (anySoloed) return track.soloed;
  return true;
}

/** True if any track in the list is soloed. */
export function anyTrackSoloed(tracks: readonly Pick<Track, 'soloed'>[]): boolean {
  return tracks.some((t) => t.soloed);
}

/**
 * The linear gain a track's live gain node should carry, given the project's solo state:
 * `0` when the track is not audible (muted, or un-soloed while something else is soloed),
 * otherwise the track's own linear `gain`. Pure so the transport's level logic is
 * unit-testable without an AudioContext.
 */
export function trackTargetGain(
  track: Pick<Track, 'muted' | 'soloed' | 'gain'>,
  anySoloed: boolean,
): number {
  return isTrackAudible(track, anySoloed) ? track.gain : 0;
}

/** Total project duration in seconds: the end of the latest clip across all tracks. */
export function projectDuration(project: Pick<Project, 'tracks'>): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.buffer.duration);
    }
  }
  return end;
}

/**
 * The nearest legal start (seconds) for a clip being moved on its track: never below 0, and
 * never overlapping another clip on the same track. A dragged clip stops flush against the
 * neighbor it would otherwise collide with. The moving clip is excluded from the neighbor set.
 *
 * Pure (no AudioContext / DOM) so it unit-tests without a browser.
 */
export function clampClipStart(track: Track, clipId: Id, desiredStart: number): number {
  const moving = track.clips.find((c) => c.id === clipId);
  if (!moving) return Math.max(0, desiredStart);
  const dur = moving.buffer.duration;
  const others = track.clips
    .filter((c) => c.id !== clipId)
    .map((c) => ({ lo: c.start, hi: c.start + c.buffer.duration }))
    .sort((a, b) => a.lo - b.lo);

  // Does [s, s+dur) overlap any neighbor? Half-open intervals: touching edges is allowed.
  const overlaps = (s: number): { lo: number; hi: number } | null => {
    for (const o of others) {
      if (s < o.hi && s + dur > o.lo) return o;
      if (o.lo > s + dur) break; // sorted; no later neighbor can overlap
    }
    return null;
  };

  let s = Math.max(0, desiredStart);
  // Resolve up to (others + 1) times: each resolution snaps past one blocker.
  for (let i = 0; i <= others.length; i++) {
    const hit = overlaps(s);
    if (!hit) return s;
    // Snap to the nearer edge of this blocker that the clip actually clears.
    const leftCandidate = hit.lo - dur; // butt up on the blocker's left
    const rightCandidate = hit.hi; // butt up on the blocker's right
    // The left side only fits if it doesn't run past timeline 0. On a distance tie, prefer the
    // right edge (always valid). A clamped-to-0 left candidate could still overlap, so reject it.
    const leftFits = leftCandidate >= 0;
    s =
      leftFits && Math.abs(leftCandidate - s) < Math.abs(rightCandidate - s)
        ? leftCandidate
        : rightCandidate;
  }
  return s;
}
