/**
 * The Studio: the app's single bridge to `@audiosandbox/engine`.
 *
 * It owns the engine objects (audio context, transport) and the project model, and mirrors
 * the bits the UI needs into Svelte 5 runes so components stay reactive. Components call
 * methods here; they never touch engine internals or audio nodes directly. This is the
 * Svelte-side embodiment of the engine/app boundary.
 */
import {
  clampClipStart,
  copySeconds,
  createClip,
  createContextFactory,
  createProject,
  createTrack,
  cutSeconds,
  EngineContext,
  fadeInSeconds,
  fadeOutSeconds,
  History,
  insertBufferSeconds,
  projectDuration,
  silenceRegionSeconds,
  Transport,
  trimSeconds,
  type BufferFactory,
  type Clip,
  type Project,
  type Track,
} from '@audiosandbox/engine';

/** A time-range selection (seconds, relative to the clip) on one clip of one track. */
export interface Selection {
  trackId: string;
  clipId: string;
  /** Selection start in seconds from the clip's own origin. */
  start: number;
  /** Selection end in seconds from the clip's own origin (>= start). */
  end: number;
}

/** An undo snapshot: a clip's prior buffer and (for moves) prior start, so undo can restore it. */
interface ClipSnapshot {
  trackId: string;
  clipId: string;
  buffer: AudioBuffer;
  /** Clip start at snapshot time. Present for move edits; restored on undo/redo. */
  start?: number;
}

/** Rough byte size of an AudioBuffer (Float32 samples), for the history budget. */
function bufferBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * 4;
}

/** Default horizontal scale: 100 CSS px per second of audio (before zoom). */
const BASE_PX_PER_SEC = 100;
/** Zoom is a multiplier on the base scale; clamp to a navigable range (~5–5000 px/s). */
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 50;
/** Undo/redo budget: up to 50 edits or ~256 MB of snapshots, whichever binds first. */
const HISTORY_LIMITS = { maxEntries: 50, maxBytes: 256 * 1024 * 1024 };

export class Studio {
  readonly #engine = new EngineContext();
  readonly #transport: Transport;

  /** Reactive mirror of the project model. Reassigned wholesale to trigger reactivity. */
  project = $state<Project>(createProject());
  /** Reactive transport state + playhead, polled while playing. */
  transportState = $state<'stopped' | 'playing' | 'paused'>('stopped');
  playhead = $state(0);
  masterVolume = $state(80);

  /**
   * Horizontal zoom (a multiplier on {@link BASE_PX_PER_SEC}). This is a pure view
   * concern — the engine has no notion of pixels — so it lives here, not in the model.
   */
  zoom = $state(1);

  /** The current time-range selection, or null. Drives the highlight and edit enablement. */
  selection = $state<Selection | null>(null);
  /** A clip selected *as an object* (for move), distinct from the time-range `selection`. */
  selectedClip = $state<{ trackId: string; clipId: string } | null>(null);
  /** Mirrors of the history flags so buttons react. Refreshed after every edit/undo/redo. */
  canUndo = $state(false);
  canRedo = $state(false);
  /** Reactive mirror of "is there something to paste?" (the clipboard itself isn't reactive). */
  canPaste = $state(false);

  /** Bounded undo/redo of clip-buffer edits (see {@link HISTORY_LIMITS}). */
  readonly #history = new History<ClipSnapshot>(HISTORY_LIMITS);
  /** Cut/copy place the selected slice here; paste reads it. Not reactive. */
  #clipboard: AudioBuffer | null = null;
  /** The clip currently being drag-moved, so its moves coalesce into one history entry. */
  #movingClipId: string | null = null;
  /**
   * Absolute timeline second at which a selection-audition should stop, or null when
   * playing the whole project. Read by the RAF loop; set by {@link play}.
   */
  #playRangeEnd: number | null = null;

  #raf = 0;

  /** CSS pixels per second of audio at the current zoom. The timeline's scale. */
  get pxPerSec(): number {
    return BASE_PX_PER_SEC * this.zoom;
  }

  /** Convert a time (seconds) to a horizontal offset (px) in the timeline. */
  timeToPx(seconds: number): number {
    return seconds * this.pxPerSec;
  }

  /** Convert a horizontal offset (px) in the timeline back to a time (seconds). */
  pxToTime(px: number): number {
    return px / this.pxPerSec;
  }

  /** Set the zoom multiplier, clamped to the navigable range. */
  setZoom(next: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  }

  constructor() {
    this.#transport = new Transport(this.#engine, () => this.project);
    this.#transport.events.on('statechange', (s) => {
      this.transportState = s;
      if (s === 'playing') this.#startPlayheadLoop();
      else this.#stopPlayheadLoop();
    });
    this.#transport.events.on('seek', (pos) => {
      this.playhead = pos;
    });
    this.#engine.setMasterVolume(this.masterVolume);
  }

  /** A BufferFactory bound to the live audio context, for buffer-ops. */
  get bufferFactory(): BufferFactory {
    return createContextFactory(this.#engine.context);
  }

  get sampleRate(): number {
    return this.#engine.sampleRate;
  }

  // ---- project mutation (reassign to trigger Svelte reactivity) ----

  addTrack(name?: string): Track {
    const track = createTrack(name ?? `Track ${this.project.tracks.length + 1}`);
    this.project = { ...this.project, tracks: [...this.project.tracks, track] };
    return track;
  }

  removeTrack(trackId: string): void {
    this.project = {
      ...this.project,
      tracks: this.project.tracks.filter((t) => t.id !== trackId),
    };
    this.#transport.releaseTrack(trackId);
  }

  /** Replace a track (e.g. after mute/solo/volume change or editing a clip). */
  updateTrack(updated: Track): void {
    this.project = {
      ...this.project,
      tracks: this.project.tracks.map((t) => (t.id === updated.id ? updated : t)),
    };
  }

  toggleMute(trackId: string): void {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (t) {
      this.updateTrack({ ...t, muted: !t.muted });
      this.#transport.applyTrackLevels();
    }
  }

  toggleSolo(trackId: string): void {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (t) {
      this.updateTrack({ ...t, soloed: !t.soloed });
      this.#transport.applyTrackLevels();
    }
  }

  setTrackGain(trackId: string, gain: number): void {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (t) {
      this.updateTrack({ ...t, gain });
      this.#transport.applyTrackLevels();
    }
  }

  // ---- selection + editing ----

  /** Look up a clip by track + clip id, or undefined if it's gone. */
  #findClip(trackId: string, clipId: string): { track: Track; clip: Clip } | undefined {
    const track = this.project.tracks.find((t) => t.id === trackId);
    const clip = track?.clips.find((c) => c.id === clipId);
    return track && clip ? { track, clip } : undefined;
  }

  /** The clip the current selection points at (if any). */
  #selectedClip(): { track: Track; clip: Clip; sel: Selection } | undefined {
    const sel = this.selection;
    if (!sel) return undefined;
    const found = this.#findClip(sel.trackId, sel.clipId);
    return found ? { ...found, sel } : undefined;
  }

  /** Replace a clip's buffer in the model (immutably). */
  #replaceClipBuffer(trackId: string, clipId: string, buffer: AudioBuffer): void {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    this.updateTrack({
      ...track,
      clips: track.clips.map((c) => (c.id === clipId ? { ...c, buffer } : c)),
    });
  }

  /** Apply a restored snapshot: swap the buffer, and the start too if the snapshot carried one. */
  #restoreSnapshot(s: ClipSnapshot): void {
    const track = this.project.tracks.find((t) => t.id === s.trackId);
    if (!track) return;
    this.updateTrack({
      ...track,
      clips: track.clips.map((c) =>
        c.id === s.clipId
          ? { ...c, buffer: s.buffer, ...(s.start !== undefined ? { start: s.start } : {}) }
          : c,
      ),
    });
  }

  /** Set (or clear) the selection, clamping its range to the target clip's duration. */
  setSelection(sel: Selection | null): void {
    if (!sel) {
      this.clearSelection();
      return;
    }
    const found = this.#findClip(sel.trackId, sel.clipId);
    if (!found) return;
    const dur = found.clip.buffer.duration;
    const start = Math.max(0, Math.min(sel.start, sel.end));
    const end = Math.min(dur, Math.max(sel.start, sel.end));
    this.selection = { ...sel, start, end };
    this.selectedClip = null;
  }

  clearSelection(): void {
    this.selection = null;
    this.#playRangeEnd = null;
  }

  /** Select a clip as an object (for moving). Mutually exclusive with the time-range selection. */
  selectClip(trackId: string, clipId: string): void {
    this.clearSelection();
    this.selectedClip = { trackId, clipId };
  }

  /** Clear the object-selection (e.g. when a range-select or seek takes over). */
  clearSelectedClip(): void {
    this.selectedClip = null;
  }

  /**
   * Move a clip to a new start offset (clamped ≥0, no overlap on its track). Undoable.
   *
   * A drag fires this many times per gesture; we coalesce them into ONE history entry so a
   * single undo restores the pre-drag position. The first call of a gesture pushes the old
   * start; subsequent calls for the same clip just reposition. {@link endClipMove} closes the
   * gesture so the next move starts a fresh entry.
   */
  moveClip(trackId: string, clipId: string, desiredStart: number): void {
    const found = this.#findClip(trackId, clipId);
    if (!found) return;
    const { track, clip } = found;
    const next = clampClipStart(track, clipId, desiredStart);
    if (next === clip.start) return; // no-op — don't pollute history
    const continuingDrag = this.#movingClipId === clipId;
    if (!continuingDrag) {
      this.#history.push(
        'Move clip',
        { trackId, clipId, buffer: clip.buffer, start: clip.start },
        bufferBytes(clip.buffer),
      );
      this.#movingClipId = clipId;
    }
    this.updateTrack({
      ...track,
      clips: track.clips.map((c) => (c.id === clipId ? { ...c, start: next } : c)),
    });
    this.#refreshHistoryFlags();
  }

  /** End a drag-move gesture so the next {@link moveClip} opens a fresh, separately-undoable entry. */
  endClipMove(): void {
    this.#movingClipId = null;
  }

  /**
   * Run a destructive buffer-op against the selected clip: snapshot the old buffer for undo,
   * transform it, swap in the result. Length-changing edits collapse the selection to its
   * start (the old [start,end) no longer maps onto the new buffer). The shared path for
   * cut/delete/silence/trim/paste/fades, so undo is uniform.
   */
  #editSelectedClip(
    label: string,
    transform: (buffer: AudioBuffer, sel: Selection, factory: BufferFactory) => AudioBuffer,
    collapseSelection = true,
  ): void {
    const target = this.#selectedClip();
    if (!target) return;
    const { clip, sel } = target;
    const before = clip.buffer;
    const after = transform(before, sel, this.bufferFactory);
    this.#history.push(
      label,
      { trackId: sel.trackId, clipId: sel.clipId, buffer: before },
      bufferBytes(before),
    );
    this.#replaceClipBuffer(sel.trackId, sel.clipId, after);
    if (collapseSelection) this.selection = { ...sel, end: sel.start };
    this.#refreshHistoryFlags();
  }

  copy(): void {
    const target = this.#selectedClip();
    if (!target) return;
    const { clip, sel } = target;
    this.#setClipboard(copySeconds(clip.buffer, sel.start, sel.end, this.bufferFactory));
  }

  cut(): void {
    const target = this.#selectedClip();
    if (!target) return;
    const { clip, sel } = target;
    this.#setClipboard(copySeconds(clip.buffer, sel.start, sel.end, this.bufferFactory));
    this.#editSelectedClip('Cut', (buf, s, f) => cutSeconds(buf, s.start, s.end, f).remaining);
  }

  deleteSelection(): void {
    this.#editSelectedClip('Delete', (buf, s, f) => cutSeconds(buf, s.start, s.end, f).remaining);
  }

  silence(): void {
    this.#editSelectedClip(
      'Silence',
      (buf, s, f) => silenceRegionSeconds(buf, s.start, s.end, f),
      false,
    );
  }

  trim(): void {
    this.#editSelectedClip('Trim', (buf, s, f) => trimSeconds(buf, s.start, s.end, f));
  }

  fadeIn(): void {
    this.#editSelectedClip('Fade in', (buf, s, f) => fadeInSeconds(buf, s.start, s.end, f), false);
  }

  fadeOut(): void {
    this.#editSelectedClip('Fade out', (buf, s, f) => fadeOutSeconds(buf, s.start, s.end, f), false);
  }

  /** Paste the clipboard into the selected clip at the selection start. */
  paste(): void {
    if (!this.#clipboard) return;
    const clipboard = this.#clipboard;
    this.#editSelectedClip('Paste', (buf, s, f) => insertBufferSeconds(buf, clipboard, s.start, f));
  }

  undo(): void {
    const target = this.#historyTargetClip();
    if (!target) return;
    const restored = this.#history.undo(target, bufferBytes(target.buffer));
    if (!restored) return;
    this.#restoreSnapshot(restored.state);
    this.#refreshHistoryFlags();
  }

  redo(): void {
    const target = this.#historyTargetClip();
    if (!target) return;
    const restored = this.#history.redo(target, bufferBytes(target.buffer));
    if (!restored) return;
    this.#restoreSnapshot(restored.state);
    this.#refreshHistoryFlags();
  }

  /**
   * The clip whose current buffer undo/redo should stash. The history entry carries its own
   * target ids; here we just need *a* clip whose live buffer to push onto the opposite stack.
   * Prefer the selected clip, else the first clip of the first track (single-clip-per-track
   * in v1).
   */
  #historyTargetClip(): ClipSnapshot | undefined {
    const sel = this.selection;
    if (sel) {
      const found = this.#findClip(sel.trackId, sel.clipId);
      if (found)
        return {
          trackId: sel.trackId,
          clipId: sel.clipId,
          buffer: found.clip.buffer,
          start: found.clip.start,
        };
    }
    for (const track of this.project.tracks) {
      const clip = track.clips[0];
      if (clip) return { trackId: track.id, clipId: clip.id, buffer: clip.buffer, start: clip.start };
    }
    return undefined;
  }

  #refreshHistoryFlags(): void {
    this.canUndo = this.#history.canUndo;
    this.canRedo = this.#history.canRedo;
  }

  #setClipboard(buffer: AudioBuffer): void {
    this.#clipboard = buffer;
    this.canPaste = true;
  }

  /**
   * Decode an audio file and append it as a new clip on a track (creating a track if none
   * is given). Returns the new clip.
   */
  async addFile(file: File, opts?: { trackId?: string; start?: number }): Promise<Clip> {
    const arrayBuffer = await file.arrayBuffer();
    // decodeAudioData detaches the ArrayBuffer; slice() hands it a private copy.
    const audio = await this.#engine.context.decodeAudioData(arrayBuffer.slice(0));
    if (audio.length === 0) throw new Error(`"${file.name}" decoded to an empty buffer`);

    let target = opts?.trackId
      ? this.project.tracks.find((t) => t.id === opts.trackId)
      : undefined;
    if (!target) target = this.addTrack();

    // Build the clip, then clamp its start so it never overlaps existing clips on the track.
    const clip = createClip(audio, file.name, opts?.start ?? 0);
    const withClip = { ...target, clips: [...target.clips, clip] };
    const start = clampClipStart(withClip, clip.id, opts?.start ?? 0);
    this.updateTrack({
      ...withClip,
      clips: withClip.clips.map((c) => (c.id === clip.id ? { ...c, start } : c)),
    });
    return { ...clip, start };
  }

  // ---- transport ----

  async play(): Promise<void> {
    // Auditioning a selection: seek to its start and arrange to stop at its end. Times are
    // absolute on the timeline (clip origin + selection offset), matching the RAF position.
    const target = this.#selectedClip();
    if (target && target.sel.end > target.sel.start) {
      this.seek(target.clip.start + target.sel.start); // seek() clears #playRangeEnd...
      this.#playRangeEnd = target.clip.start + target.sel.end; // ...so set it after.
    } else {
      this.#playRangeEnd = null;
    }
    await this.#transport.play();
  }

  pause(): void {
    this.#transport.pause();
  }

  stop(): void {
    this.#transport.stop();
    this.playhead = 0;
    this.#playRangeEnd = null;
  }

  seek(seconds: number): void {
    this.#transport.seek(seconds);
    this.playhead = seconds;
    this.#playRangeEnd = null;
    this.selectedClip = null;
  }

  /** Read a track's live gain-node value (for verification / E2E). Undefined if unwired. */
  liveTrackGain(trackId: string): number | undefined {
    return this.#transport.liveTrackGain(trackId);
  }

  setMasterVolume(volume0to100: number): void {
    this.masterVolume = volume0to100;
    this.#engine.setMasterVolume(volume0to100);
  }

  // ---- playhead animation ----

  #startPlayheadLoop(): void {
    const tick = (): void => {
      const pos = this.#transport.position;
      // Stop at the end of the selection-audition range if one is active, otherwise at the
      // end of the project (reset playhead to 0). The engine's `ended` event is reserved for
      // a future engine-side scheduler; here we detect it from the derived position, which is
      // what the loop already reads.
      const end = this.#playRangeEnd ?? projectDuration(this.project);
      if (end > 0 && pos >= end) {
        this.stop();
        return; // stop() leaves the `playing` state, so the loop ends here.
      }
      this.playhead = pos;
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  #stopPlayheadLoop(): void {
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.playhead = this.#transport.position;
  }
}
