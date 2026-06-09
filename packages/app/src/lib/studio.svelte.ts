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
  clipDuration,
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
  resizeClip,
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

/** A buffer/move/resize edit: restore a clip's buffer (+ start/trim) on undo. */
interface BufferEdit {
  kind: 'buffer';
  trackId: string;
  clipId: string;
  buffer: AudioBuffer;
  start?: number;
  trimStart?: number;
  trimEnd?: number;
}
/** A clip was added (e.g. paste): undo removes it, redo re-adds it. */
interface AddClipEdit {
  kind: 'add-clip';
  trackId: string;
  clip: Clip;
  /** Set when paste() created a new track for this clip. Undo also removes that track. */
  createdTrackId?: string;
}
/** A track was removed: undo re-inserts it at `index`, redo removes it again. */
interface RemoveTrackEdit {
  kind: 'remove-track';
  track: Track;
  index: number;
}
/** A clip moved across tracks: undo returns it to `fromTrackId`@`fromStart`. */
interface MoveAcrossEdit {
  kind: 'move-across';
  clipId: string;
  fromTrackId: string;
  fromStart: number;
  toTrackId: string;
  /** Set when a new track was created for this move. Undo also removes that track. */
  createdTrackId?: string;
}
type Edit = BufferEdit | AddClipEdit | RemoveTrackEdit | MoveAcrossEdit;

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
  /** The most recently interacted track (clicked clip, seeked lane, dropped file). */
  lastTrackId = $state<string | null>(null);
  /** Mirrors of the history flags so buttons react. Refreshed after every edit/undo/redo. */
  canUndo = $state(false);
  canRedo = $state(false);
  /** Reactive mirror of "is there something to paste?" (the clipboard itself isn't reactive). */
  canPaste = $state(false);

  /** Active clip drag (set by the lane on drag-move start; consumed by the timeline surface). */
  clipDrag = $state<{ fromTrackId: string; clipId: string; grabInClipPx: number } | null>(null);

  /** Bounded undo/redo of clip-buffer edits (see {@link HISTORY_LIMITS}). */
  readonly #history = new History<Edit>(HISTORY_LIMITS);
  /** Cut/copy place the selected slice here; paste reads it. Not reactive. */
  #clipboard: AudioBuffer | null = null;
  /** The clip currently being drag-moved, so its moves coalesce into one history entry. */
  #movingClipId: string | null = null;
  /** The clip currently being drag-resized, so its resizes coalesce into one history entry. */
  #resizingClipId: string | null = null;
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

  removeTrack(trackId: string, opts?: { record?: boolean }): void {
    const index = this.project.tracks.findIndex((t) => t.id === trackId);
    if (index < 0) return;
    const track = this.project.tracks[index]!;
    if (opts?.record !== false) {
      this.#history.push(
        'Delete track',
        { kind: 'remove-track', track, index },
        this.#editBytes({ kind: 'remove-track', track, index }),
      );
    }
    this.project = {
      ...this.project,
      tracks: this.project.tracks.filter((t) => t.id !== trackId),
    };
    this.#transport.releaseTrack(trackId);
    if (this.lastTrackId === trackId) this.lastTrackId = null;
    this.#refreshHistoryFlags();
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

  renameProject(name: string): void {
    this.project = { ...this.project, name: name.trim() || 'Untitled Project' };
  }

  renameTrack(trackId: string, name: string): void {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (t) this.updateTrack({ ...t, name });
  }

  setPan(trackId: string, pan: number): void {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (t) {
      this.updateTrack({ ...t, pan });
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

  /** Apply a restored BufferEdit: swap the buffer, and the start/trim too if the edit carried them. */
  #applyBufferEdit(s: BufferEdit): void {
    const track = this.project.tracks.find((t) => t.id === s.trackId);
    if (!track) return;
    this.updateTrack({
      ...track,
      clips: track.clips.map((c) =>
        c.id === s.clipId
          ? {
              ...c,
              buffer: s.buffer,
              ...(s.start !== undefined ? { start: s.start } : {}),
              ...(s.trimStart !== undefined ? { trimStart: s.trimStart } : {}),
              ...(s.trimEnd !== undefined ? { trimEnd: s.trimEnd } : {}),
            }
          : c,
      ),
    });
  }

  /** Insert a clip onto a track (used by add-clip redo / move-across redo). */
  #insertClip(trackId: string, clip: Clip): void {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    this.updateTrack({ ...track, clips: [...track.clips, clip] });
  }

  /** Remove a clip by id from a track (used by add-clip undo / move-across). */
  #removeClipFrom(trackId: string, clipId: string): Clip | undefined {
    const track = this.project.tracks.find((t) => t.id === trackId);
    const clip = track?.clips.find((c) => c.id === clipId);
    if (!track || !clip) return undefined;
    this.updateTrack({ ...track, clips: track.clips.filter((c) => c.id !== clipId) });
    return clip;
  }

  /** Re-insert a whole track at a specific index (remove-track undo). */
  #insertTrackAt(track: Track, index: number): void {
    const tracks = [...this.project.tracks];
    tracks.splice(Math.min(index, tracks.length), 0, track);
    this.project = { ...this.project, tracks };
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

  /**
   * Select a clip as an object (for moving). Optionally seek the playhead to `atSeconds`
   * (the clicked point) while KEEPING the clip selected. Mutually exclusive with the
   * time-range selection.
   */
  selectClip(trackId: string, clipId: string, atSeconds?: number): void {
    this.clearSelection();
    this.selectedClip = { trackId, clipId };
    this.lastTrackId = trackId;
    if (atSeconds !== undefined) this.#seekTransport(atSeconds);
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
        { kind: 'buffer', trackId, clipId, buffer: clip.buffer, start: clip.start },
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
   * Move a clip to another track at `desiredStart` (clamped no-overlap on the destination).
   * If `toTrackId === fromTrackId`, delegates to the in-track {@link moveClip}. Undoable as a
   * single `move-across` edit committed on drop (not coalesced).
   */
  moveClipToTrack(
    fromTrackId: string,
    clipId: string,
    toTrackId: string,
    desiredStart: number,
    opts?: { createdTrackId?: string },
  ): void {
    if (toTrackId === fromTrackId) {
      this.moveClip(fromTrackId, clipId, desiredStart);
      this.endClipMove(); // already clears #movingClipId
      return;
    }
    const from = this.#findClip(fromTrackId, clipId);
    if (!from) return;
    const fromStart = from.clip.start;
    const moved = this.#removeClipFrom(fromTrackId, clipId);
    if (!moved) return;
    const dest = this.project.tracks.find((t) => t.id === toTrackId);
    const start = dest
      ? clampClipStart({ ...dest, clips: [...dest.clips, moved] }, moved.id, desiredStart)
      : desiredStart;
    this.#insertClip(toTrackId, { ...moved, start });
    this.#history.push(
      'Move clip to track',
      { kind: 'move-across', clipId, fromTrackId, fromStart, toTrackId, createdTrackId: opts?.createdTrackId },
      0,
    );
    this.#movingClipId = null;
    this.lastTrackId = toTrackId;
    this.selectClip(toTrackId, clipId);
    this.#refreshHistoryFlags();
  }

  /**
   * Resize one edge of a clip non-destructively (sets trim; left edge also shifts start).
   * Undoable, coalesced into ONE history entry per drag gesture (like {@link moveClip}).
   * `desiredTrim` is the target trim amount (seconds) from that edge of the buffer.
   */
  resizeClip(
    trackId: string,
    clipId: string,
    edge: 'left' | 'right',
    desiredTrim: number,
  ): void {
    const found = this.#findClip(trackId, clipId);
    if (!found) return;
    const { track, clip } = found;
    const geom = resizeClip(clip, edge, desiredTrim);
    // No-overlap clamp: growing the LEFT edge can't run into the left neighbor. Re-clamp the
    // resulting start against the track (the moving clip's new visible duration is implied by
    // the trim we're about to apply, so clamp a hypothetical clip with the new trim).
    const probe = { ...track, clips: track.clips.map((c) => (c.id === clipId ? { ...c, ...geom } : c)) };
    const clampedStart = clampClipStart(probe, clipId, geom.start);
    const next = { ...geom, start: clampedStart };
    if (
      next.start === clip.start &&
      next.trimStart === (clip.trimStart ?? 0) &&
      next.trimEnd === (clip.trimEnd ?? 0)
    ) {
      return; // no change — don't pollute history
    }
    const continuing = this.#resizingClipId === clipId;
    if (!continuing) {
      this.#history.push(
        'Resize clip',
        {
          kind: 'buffer',
          trackId,
          clipId,
          buffer: clip.buffer,
          start: clip.start,
          trimStart: clip.trimStart ?? 0,
          trimEnd: clip.trimEnd ?? 0,
        },
        bufferBytes(clip.buffer),
      );
      this.#resizingClipId = clipId;
    }
    this.updateTrack({
      ...track,
      clips: track.clips.map((c) => (c.id === clipId ? { ...c, ...next } : c)),
    });
    this.#refreshHistoryFlags();
  }

  /** End a drag-resize gesture so the next {@link resizeClip} opens a fresh undo entry. */
  endClipResize(): void {
    this.#resizingClipId = null;
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
      { kind: 'buffer', trackId: sel.trackId, clipId: sel.clipId, buffer: before },
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

  /**
   * Paste the clipboard as a NEW clip at the playhead. Target track = the object-selected
   * clip's track, else the last-interacted track, else a new track. If the playhead slot on
   * the chosen track is occupied (clamping would shove the clip), create a new track instead.
   */
  paste(): void {
    if (!this.#clipboard) return;
    const at = this.playhead;
    const newClip = createClip(this.#clipboard, 'Pasted', at);

    // Choose the target track.
    let target: Track | undefined =
      (this.selectedClip && this.project.tracks.find((t) => t.id === this.selectedClip!.trackId)) ||
      (this.lastTrackId ? this.project.tracks.find((t) => t.id === this.lastTrackId) : undefined) ||
      undefined;

    let placed: { trackId: string; clip: Clip; createdTrackId?: string };
    if (target) {
      const probe = { ...target, clips: [...target.clips, newClip] };
      const start = clampClipStart(probe, newClip.id, at);
      if (Math.abs(start - at) < 1e-6) {
        placed = { trackId: target.id, clip: { ...newClip, start } };
      } else {
        // Slot occupied → new track instead.
        const fresh = this.addTrack();
        placed = { trackId: fresh.id, clip: { ...newClip, start: at }, createdTrackId: fresh.id };
      }
    } else {
      const fresh = this.addTrack();
      placed = { trackId: fresh.id, clip: { ...newClip, start: at }, createdTrackId: fresh.id };
    }

    // Record BEFORE mutating (consistent with moveClip, resizeClip, #editSelectedClip)
    this.#history.push(
      'Paste clip',
      { kind: 'add-clip', trackId: placed.trackId, clip: placed.clip, createdTrackId: placed.createdTrackId },
      bufferBytes(placed.clip.buffer),
    );
    this.#insertClip(placed.trackId, placed.clip);
    this.lastTrackId = placed.trackId;
    this.selectClip(placed.trackId, placed.clip.id);
    this.#refreshHistoryFlags();
  }

  undo(): void {
    const top = this.#history.peek();
    if (!top) return;
    const edit = top.state;
    if (edit.kind === 'buffer') {
      const target = this.#bufferTarget(edit);
      const restored = this.#history.undo(target, bufferBytes(target.buffer));
      if (restored) this.#applyBufferEdit(restored.state as BufferEdit);
    } else {
      // Structural: apply the inverse, then move the same entry to the redo stack.
      this.#applyInverse(edit);
      this.#history.undo(edit, this.#editBytes(edit));
    }
    this.#refreshHistoryFlags();
  }

  redo(): void {
    const top = this.#history.peekRedo();
    if (!top) return;
    const edit = top.state as Edit;
    if (edit.kind === 'buffer') {
      const probe = this.#liveBufferProbe();
      if (!probe) return; // no clips to swap — shouldn't happen for buffer redo
      const restored = this.#history.redo(probe, bufferBytes(probe.buffer));
      if (restored) this.#applyBufferEdit(restored.state as BufferEdit);
    } else {
      // Structural: apply forward, then move the same entry to the undo stack.
      this.#applyForward(edit);
      this.#history.redo(edit, this.#editBytes(edit));
    }
    this.#refreshHistoryFlags();
  }

  /** Apply the UNDO direction of a structural edit. */
  #applyInverse(edit: Exclude<Edit, BufferEdit>): void {
    switch (edit.kind) {
      case 'add-clip':
        this.#removeClipFrom(edit.trackId, edit.clip.id);
        if (edit.createdTrackId) {
          // The paste created this track; undo must also remove it.
          this.removeTrack(edit.createdTrackId, { record: false });
        }
        break;
      case 'remove-track':
        this.#insertTrackAt(edit.track, edit.index);
        break;
      case 'move-across': {
        const moved = this.#removeClipFrom(edit.toTrackId, edit.clipId);
        if (moved) this.#insertClip(edit.fromTrackId, { ...moved, start: edit.fromStart });
        if (edit.createdTrackId) {
          this.removeTrack(edit.createdTrackId, { record: false });
        }
        break;
      }
    }
  }

  /** Apply the REDO direction of a structural edit. */
  #applyForward(edit: Exclude<Edit, BufferEdit>): void {
    switch (edit.kind) {
      case 'add-clip':
        if (edit.createdTrackId) {
          // Redo must recreate the track if it was created by paste.
          // Only insert if not already present (idempotent guard).
          if (!this.project.tracks.find((t) => t.id === edit.createdTrackId)) {
            this.#insertTrackAt(
              { id: edit.createdTrackId, name: 'Track', clips: [], gain: 1, pan: 0, muted: false, soloed: false },
              this.project.tracks.length,
            );
          }
        }
        this.#insertClip(edit.trackId, edit.clip);
        break;
      case 'remove-track':
        this.removeTrack(edit.track.id, { record: false });
        break;
      case 'move-across': {
        if (edit.createdTrackId) {
          // Redo must recreate the track if it was created by the drop.
          // Only insert if not already present (idempotent guard).
          if (!this.project.tracks.find((t) => t.id === edit.createdTrackId)) {
            this.#insertTrackAt(
              { id: edit.createdTrackId, name: 'Track', clips: [], gain: 1, pan: 0, muted: false, soloed: false },
              this.project.tracks.length,
            );
          }
        }
        const moved = this.#removeClipFrom(edit.fromTrackId, edit.clipId);
        if (moved) {
          const dest = this.project.tracks.find((t) => t.id === edit.toTrackId);
          const start = dest
            ? clampClipStart({ ...dest, clips: [...dest.clips, moved] }, moved.id, edit.fromStart)
            : edit.fromStart;
          this.#insertClip(edit.toTrackId, { ...moved, start });
        }
        break;
      }
    }
  }

  /** Rough byte size of a structural edit, for the history budget. */
  #editBytes(edit: Edit): number {
    if (edit.kind === 'buffer') return bufferBytes(edit.buffer);
    if (edit.kind === 'add-clip') return bufferBytes(edit.clip.buffer);
    if (edit.kind === 'remove-track')
      return edit.track.clips.reduce((s, c) => s + bufferBytes(c.buffer), 0);
    return 0; // move-across carries no buffer
  }

  /** The live BufferEdit snapshot to stash when undoing a buffer edit. */
  #bufferTarget(edit: BufferEdit): BufferEdit {
    const found = this.#findClip(edit.trackId, edit.clipId);
    const clip = found?.clip;
    return {
      kind: 'buffer',
      trackId: edit.trackId,
      clipId: edit.clipId,
      buffer: clip?.buffer ?? edit.buffer,
      start: clip?.start,
      trimStart: clip?.trimStart ?? 0,
      trimEnd: clip?.trimEnd ?? 0,
    };
  }

  /** A live buffer snapshot to satisfy History.redo's "current" arg for buffer edits, or null if no clips exist. */
  #liveBufferProbe(): BufferEdit | null {
    const sel = this.selectedClip;
    if (sel) {
      const f = this.#findClip(sel.trackId, sel.clipId);
      if (f)
        return {
          kind: 'buffer',
          trackId: sel.trackId,
          clipId: sel.clipId,
          buffer: f.clip.buffer,
          start: f.clip.start,
          trimStart: f.clip.trimStart ?? 0,
          trimEnd: f.clip.trimEnd ?? 0,
        };
    }
    for (const t of this.project.tracks) {
      const c = t.clips[0];
      if (c)
        return {
          kind: 'buffer',
          trackId: t.id,
          clipId: c.id,
          buffer: c.buffer,
          start: c.start,
          trimStart: c.trimStart ?? 0,
          trimEnd: c.trimEnd ?? 0,
        };
    }
    return null; // No clips — buffer-kind redo not applicable; caller handles null
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

    // Auto-rename an empty track to match the first file loaded onto it.
    if (target.clips.length === 0) {
      const baseName = file.name.replace(/\.[^.]+$/, '');
      this.renameTrack(target.id, baseName);
      // Re-fetch after mutation (updateTrack reassigns project).
      target = this.project.tracks.find((t) => t.id === target!.id)!;
    }

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
      this.#seekTransport(target.clip.start + target.sel.start); // seek transport only, keep selection
      this.#playRangeEnd = target.clip.start + target.sel.end; // set after seek clears it
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

  /** Move the playhead WITHOUT touching the object-selection. Internal. */
  #seekTransport(seconds: number): void {
    this.#transport.seek(seconds);
    this.playhead = seconds;
    this.#playRangeEnd = null;
  }

  seek(seconds: number): void {
    this.#seekTransport(seconds);
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
