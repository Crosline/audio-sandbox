/**
 * Pure resolution of a render plan: the export window, output dimensions, the included-track
 * set, each track's effective gain, and each clip's scheduling (when/offset/duration) within
 * the window. No AudioContext — so all the logic the Renderer relies on is unit-testable.
 */
import type { EffectState } from '../effects/types.js';
import { anyTrackSoloed, isTrackAudible, projectDuration } from '../model/project.js';
import type { Project, Track } from '../model/types.js';

/** Per-track gain/mute override, applied on top of the model's own state. */
export interface TrackOverride {
  gain?: number;
  muted?: boolean;
}

export interface RenderOptions {
  /** Export window start (seconds). Default 0. */
  start?: number;
  /** Export window end (seconds). Default = projectDuration(project). */
  end?: number;
  /** Force all audible tracks to unity gain (1.0), ignoring per-track gain. Default false. */
  unityGain?: boolean;
  /** Include muted tracks anyway. Default false. */
  includeMuted?: boolean;
  /** Per-track gain/mute overrides, keyed by track id (applied last; wins). */
  overrides?: Map<string, TrackOverride>;
  /** Output sample rate (Hz). Default = inferred from the first clip's buffer, else 44100. */
  sampleRate?: number;
  /** Output channel count. Default 2 (stereo). */
  channels?: number;
}

/** One clip scheduled into the offline render. */
export interface ScheduledClip {
  buffer: AudioBuffer;
  /** When to start, in seconds from the window origin (>= 0). */
  when: number;
  /** Offset into the source buffer (seconds). */
  offset: number;
  /** How long to play (seconds). */
  duration: number;
}

/** A track's contribution to a render. */
export interface TrackPlan {
  trackId: string;
  /** Effective linear gain after solo/mute/unity/override resolution. */
  gain: number;
  /** Stereo pan position -1 (L) .. 0 (C) .. +1 (R), from the track model. */
  pan: number;
  clips: ScheduledClip[];
  /** The track's pedalboard chain, carried verbatim so the renderer can re-instantiate it. */
  effects: EffectState[];
}

/** The fully resolved render plan. */
export interface RenderPlan {
  sampleRate: number;
  channels: number;
  lengthSamples: number;
  start: number;
  end: number;
  tracks: TrackPlan[];
}

/** Infer the output sample rate from the first clip found, falling back to 44100. */
function inferSampleRate(project: Project): number {
  for (const track of project.tracks) {
    const clip = track.clips[0];
    if (clip) return clip.buffer.sampleRate;
  }
  return 44100;
}

/** Schedule a single clip into [start, end), or null if it doesn't intersect the window. */
function scheduleClip(
  clip: { buffer: AudioBuffer; start: number; trimStart?: number; trimEnd?: number },
  start: number,
  end: number,
): ScheduledClip | null {
  const trimStart = clip.trimStart ?? 0;
  const trimEnd = clip.trimEnd ?? 0;
  const visible = clip.buffer.duration - trimStart - trimEnd;
  const clipStart = clip.start;
  const clipEndPos = clipStart + visible;
  const from = Math.max(clipStart, start);
  const to = Math.min(clipEndPos, end);
  if (to <= from) return null; // no overlap with the window
  const into = from - clipStart; // elapsed within the visible window
  return {
    buffer: clip.buffer,
    when: from - start, // window-relative start
    offset: trimStart + into, // head-trim + elapsed, so we read the correct buffer region
    duration: to - from,
  };
}

export function resolveRenderPlan(
  project: Project,
  options: RenderOptions = {},
  onlyTrackId?: string,
): RenderPlan {
  const start = options.start ?? 0;
  const end = options.end ?? projectDuration(project);
  const sampleRate = options.sampleRate ?? inferSampleRate(project);
  const channels = options.channels ?? 2;
  const windowLength = Math.max(0, end - start);
  const lengthSamples = Math.round(windowLength * sampleRate);

  const sourceTracks = onlyTrackId
    ? project.tracks.filter((t) => t.id === onlyTrackId)
    : project.tracks;
  const anySoloed = anyTrackSoloed(project.tracks);

  const tracks: TrackPlan[] = [];
  for (const track of sourceTracks) {
    const gain = effectiveGain(track, anySoloed, options, onlyTrackId === track.id);
    if (gain === null) continue; // not included in this render
    const clips: ScheduledClip[] = [];
    for (const clip of track.clips) {
      const sched = scheduleClip(clip, start, end);
      if (sched) clips.push(sched);
    }
    tracks.push({ trackId: track.id, gain, pan: track.pan ?? 0, clips, effects: track.effects ?? [] });
  }

  return { sampleRate, channels, lengthSamples, start, end, tracks };
}

/**
 * The effective linear gain for a track in this render, or `null` if the track is excluded.
 * Precedence (low→high): solo/mute audibility → includeMuted → unityGain → per-track override.
 * `isOnlyStem` means this track was explicitly requested via onlyTrackId, so it ignores other
 * tracks' solo state (but still respects its own muted/override unless includeMuted).
 */
function effectiveGain(
  track: Track,
  anySoloed: boolean,
  options: RenderOptions,
  isOnlyStem: boolean,
): number | null {
  const override = options.overrides?.get(track.id);
  const muted = override?.muted ?? track.muted;

  // Audibility: an explicit single-stem render ignores other tracks' solo.
  let audible: boolean;
  if (muted && !options.includeMuted) {
    audible = false;
  } else if (isOnlyStem) {
    audible = true;
  } else {
    audible = isTrackAudible({ muted: false, soloed: track.soloed }, anySoloed);
    // (muted already handled above; pass muted:false so only solo logic applies here)
  }
  if (!audible) return null;

  if (override?.gain !== undefined) return override.gain;
  if (options.unityGain) return 1;
  return track.gain;
}
