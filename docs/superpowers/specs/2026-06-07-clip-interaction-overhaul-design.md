# Clip Interaction Overhaul — Design

**Date:** 2026-06-07
**Status:** Approved (design); plan to follow.
**Context:** Pre-Step-9 app-side polish. The multi-clip lane (Step 8b) landed clip rendering,
object-selection, in-track drag-move, drag-range-select, and drop-at-cursor. This spec
reworks how a user manipulates clips so the editor feels like a real DAW.

---

## Goals

When a user works with clips:

1. **Click a clip** → move the playhead (cursor) to the *exact point clicked* inside the clip,
   AND object-select the clip for dragging.
2. **Drag a selected clip** → move it within its track, **to another track**, or **to a new
   track** created in the empty space below the existing rows.
3. **Drag from cursor left/right inside a clip** (when not yet object-selected) → range-select
   (existing behavior, kept).
4. **Drag a clip's left/right border** → shorten the clip from that edge, **non-destructively**
   (the hidden audio is preserved and can be dragged back out).
5. **Click another spot inside a clip** → move the playhead there (covered by #1).
6. **Paste** → always create a **new clip at the playhead**, on the current track if it fits
   without overlap, else on a new track. (No more inserting into an existing clip's buffer.)
7. **Delete a track** → a hover-revealed `✕` button in the track header.

The **cursor / playhead** is the single point that means: selection start, play-from point,
and paste anchor.

---

## Non-goals (this spec)

- Right-click context menus (deferred — see Deferred section).
- Edit-button iconification / redesign (deferred).
- Waveform regeneration on zoom / LOD (deferred).
- The timeline-ruler width-at-zoom bug (deferred — fix sketched below).
- Snapping to a grid/BPM, fades-on-clip-edges, clip splitting.

---

## The engine/app boundary (unchanged rule)

`@audiosandbox/engine` stays framework- and DOM-agnostic. The engine gains **pure model
helpers and a trim-aware transport**; everything about pointers, hover, DOM hit-testing, and
rendering lives in the app. No Svelte/DOM enters the engine.

---

## Section 1 — Engine: non-destructive trim on the clip model

### Model change (`packages/engine/src/model/types.ts`)

`Clip` gains two optional offsets:

```ts
export interface Clip {
  readonly id: Id;
  buffer: AudioBuffer;
  start: number;        // timeline start (seconds)
  name: string;
  trimStart?: number;   // seconds of the buffer's HEAD to skip (default 0)
  trimEnd?: number;     // seconds of the buffer's TAIL to skip (default 0)
}
```

Optional + defaulting to `0` keeps existing clips and tests valid.

### Pure helpers (`packages/engine/src/model/project.ts`)

- `clipDuration(clip): number` → `buffer.duration - (trimStart ?? 0) - (trimEnd ?? 0)`.
  The clip's **visible/audible** length on the timeline. **Every place that currently uses
  `clip.buffer.duration` for layout or timing switches to this**:
  - `projectDuration` (engine)
  - `clampClipStart` (the `dur` it uses for the moving clip AND each neighbor's `hi`)
  - transport scheduling + `#duration()`
  - app layout (`laneWidth`, clip box width, `contentWidth`)
- `clipEnd(clip): number` → `clip.start + clipDuration(clip)`. Convenience for the above.
- `resizeClip(clip, edge: 'left' | 'right', desiredTrim: number): { start; trimStart; trimEnd }`
  — pure. Returns the clip's new `start`/`trimStart`/`trimEnd` for a resize of one edge to a
  *desired trim amount* (seconds from that end of the buffer). Clamps so:
  - trims never go negative,
  - `trimStart + trimEnd` never leaves visible duration below `MIN_CLIP_DURATION`
    (a small constant, e.g. `0.02`s),
  - resizing the **left** edge moves `start` by the same delta as `trimStart` so the audio
    under the *kept* region stays put on the timeline (the clip's left face moves, the audio
    doesn't slide). Right-edge resize leaves `start` alone.
  - **Note:** `resizeClip` is geometry-only; it does NOT check neighbor overlap. The Studio
    command applies no-overlap clamping after (left-edge growth is bounded by the left
    neighbor; right-edge growth is naturally bounded by the buffer end + clampClipStart on the
    right neighbor). Keeping overlap logic in one place (`clampClipStart`) avoids divergence.

All three helpers are unit-tested in `project.test.ts` against small known buffers (no
AudioContext): default (no-trim) passthrough, head/tail trim arithmetic, the left-edge
`start` coupling, and the `MIN_CLIP_DURATION` clamp.

### Transport change (`packages/engine/src/transport/transport.ts`)

`#startSources` currently does `node.buffer = clip.buffer; node.start(...)` using full buffer
duration. It must honor trim:

- `clipStart = clip.start`, `clipEnd = clipEnd(clip)` (trim-aware).
- The buffer source's read window is `[trimStart, trimStart + clipDuration]`.
- Scheduling cases:
  - **clip in the future** (`fromPosition <= clipStart`): `node.start(when, trimStart, clipDuration)`.
  - **playhead inside the clip**: offset into the buffer is `trimStart + (fromPosition - clipStart)`,
    and remaining duration is `clipEnd - fromPosition`:
    `node.start(startClock, trimStart + (fromPosition - clipStart), clipEnd - fromPosition)`.
- `#duration()` uses `clipEnd(clip)`.

This is the one change that makes a resized clip *sound* shorter, not just look shorter. The
transport has no unit tests (verified in-app), but the arithmetic it relies on is the
unit-tested `clipDuration`/`clipEnd`.

### Exports (`packages/engine/src/index.ts`)

Add `clipDuration`, `clipEnd`, `resizeClip`, and `MIN_CLIP_DURATION` to the model export block.

---

## Section 2 — Studio: state & commands (`packages/app/src/lib/studio.svelte.ts`)

### New state

- `lastTrackId = $state<string | null>(null)` — the most recently interacted track (clip
  clicked, lane seeked, file dropped). Drives paste's "current track."

### Cursor-on-click

`selectClip` currently only sets `selectedClip`. Today `seek()` *clears* `selectedClip`, so we
can't naively call `seek()` from a click that should keep the clip selected. Resolution:

- Split the transport-seek from the object-selection-clear. Introduce a private
  `#seekTransport(seconds)` that moves the playhead WITHOUT touching `selectedClip`.
- Public `seek(seconds)` keeps its existing contract (seek + clear object-selection +
  clear range; used by lane-background clicks and the ruler).
- `selectClip(trackId, clipId, atSeconds?)` → sets `selectedClip`, sets `lastTrackId`,
  and if `atSeconds` is given, calls `#seekTransport(atSeconds)` so the playhead lands at the
  clicked point while the clip stays selected.

### Resize command (undoable, drag-coalesced)

- `#resizingClipId: string | null` mirrors the `#movingClipId` pattern.
- `resizeClip(trackId, clipId, edge, desiredTrim)`:
  1. Look up the clip; compute the geometry via engine `resizeClip`.
  2. Apply no-overlap clamping (left edge can't grow past the left neighbor's end).
  3. If nothing changed, return (don't pollute history).
  4. On the **first** call of a gesture, push a `buffer` snapshot carrying the clip's prior
     `start`/`trimStart`/`trimEnd` (buffer unchanged — trim is non-destructive); set
     `#resizingClipId`.
  5. Update the clip's `start`/`trimStart`/`trimEnd` in the model.
- `endClipResize()` clears `#resizingClipId` (parallel to `endClipMove`).

### Cross-track move command

- `moveClipToTrack(fromTrackId, clipId, toTrackId, desiredStart)`:
  - If `toTrackId === fromTrackId`, delegate to the existing in-track `moveClip` (keeps its
    own coalescing). Otherwise:
  - Push a structural `move-across` edit (Section 4) capturing source track id + the clip's
    pre-move `start` (so undo restores it exactly to where it was).
  - Remove the clip from the source track; add it to the target track; clamp its start there
    with `clampClipStart` (no-overlap on the destination).
  - Cross-track moves are **not** coalesced the way in-track drags are; a cross-track reparent
    is a single discrete event committed on drop (the drag updates a *preview* — see Section 5
    for how the gesture decides same-track vs cross-track and only commits the reparent once).

### Paste rewrite

`paste()` no longer edits a clip's buffer. New behavior:

1. If clipboard is empty, return.
2. Build a new clip from the clipboard buffer (`createClip(clipboard, 'Pasted', playhead)`).
3. Choose the target track:
   - the object-selected clip's track, else
   - `lastTrackId`'s track (if it still exists), else
   - a new track.
4. Compute placement: `clampClipStart` on the target at the playhead time.
   - If the clamped start differs from the playhead by more than a tiny epsilon (i.e. the
     playhead slot was occupied and it got shoved), instead create a **new track** and place
     the clip at the playhead there. (Rule from brainstorming: "current track if it fits, else
     new track." The user can drag it elsewhere afterward.)
5. Commit as an `add-clip` structural edit (Section 4) so undo removes the pasted clip.

`copy`/`cut` are unchanged (they still fill the clipboard from the range-selection). Cut still
destructively removes the range from its source clip — only **paste's destination semantics**
change.

### Track delete

`removeTrack(trackId)` exists. Wrap it as undoable: push a `remove-track` structural edit
(Section 4) carrying the whole track object + its index, then remove. The hover `✕` (Section 3)
calls this.

### `lastTrackId` maintenance

Set it in: `selectClip`, the lane-background seek path, and `addFile` (drop). Clear/repair it
defensively in `removeTrack` (if the deleted track was `lastTrackId`, set to `null`).

---

## Section 3 — Components: TrackRow & interaction

### Track header — hover-revealed delete (`TrackRow.svelte`)

- The header `<div>` becomes a Tailwind `group`.
- Add a `✕` button: `opacity-0 group-hover:opacity-100 transition`, `title="Delete track"`,
  `onclick={() => studio.removeTrack(track.id)}`. Placed so it isn't mistaken for M/S
  (e.g. top-right corner of the header).

### Clip box — three pointer zones

The clip box's single `onpointerdown` splits into three zones by x within the clip
(`grabInClip` already computed):

- **Left edge band** (`EDGE_PX`, ~6px): begin a **resize-left** gesture; cursor `ew-resize`.
- **Right edge band** (last `EDGE_PX`): begin a **resize-right** gesture; cursor `ew-resize`.
- **Middle**: the existing select / drag-move / range-select path, now also **seeking the
  playhead to the clicked point** on a plain click (call `studio.selectClip(track.id, clipId,
  clip.start + pxToTime(grabInClip))`).

Edge band cursors are applied via a class chosen from `grabInClip` on hover (`onpointermove`
without a button), or simply two thin absolutely-positioned `ew-resize` strips inside the clip
box (cleaner: dedicated `<div>` handles with their own `onpointerdown`, so the middle keeps one
handler). **Decision: dedicated edge-handle divs** — two 6px `absolute inset-y-0` strips
(left/right) with `cursor-ew-resize` and their own pointer-down, layered above the waveform.
This avoids x-band math in the move handler and keeps the three intents physically separate.

### Resize gesture

- Edge-handle pointer-down captures the pointer and records which edge + the press x.
- `onpointermove`: `studio.resizeClip(track.id, clipId, edge, desiredTrim)` where `desiredTrim`
  is derived from how far the pointer dragged from the clip's relevant edge.
- `onpointerup`: `studio.endClipResize()`.

### Cross-track drag-move

Handled at the timeline-surface level — see Section 5.

---

## Section 4 — History: undoing structural changes

Today `History<ClipSnapshot>` only swaps a clip's buffer (plus `start`/trim for moves/resizes)
on a clip that always exists. Paste (add), delete-track (remove), and cross-track move are
**structural** and need a richer entry. Widen the history element to a **tagged union**:

```ts
type Edit =
  | { kind: 'buffer'; trackId; clipId; buffer; start?; trimStart?; trimEnd? } // existing edits + move + resize
  | { kind: 'add-clip'; trackId; clip }            // undo = remove the clip;   redo = re-add
  | { kind: 'remove-track'; track; index }         // undo = re-insert at index; redo = remove
  | { kind: 'move-across'; clipId; fromTrackId; fromStart; toTrackId } // undo = move back; redo = move over
```

Routing:

- **`buffer`** entries keep the current memory-aware swap-on-undo: `undo`/`redo` capture the
  clip's *current* live state and push it onto the opposite stack (via the existing
  `#historyTargetClip` mechanism, generalized to also carry trim).
- **Structural** entries (`add-clip`, `remove-track`, `move-across`) carry full before/after
  state in the entry itself, so undo/redo apply a deterministic inverse without needing to
  capture live buffers. They flip themselves between stacks.

Implementation approach: rather than overloading `History`'s buffer-centric `undo(target,
bytes)` signature for both, the Studio's `undo()`/`redo()` first **peek the top entry's kind**:

- structural → pop, apply inverse, push the (unchanged) entry to the opposite stack manually;
- buffer → existing path (`#history.undo(target, bytes)` with a live snapshot).

This may mean the Studio holds the undo/redo stacks more directly (two arrays of `Edit`) rather
than delegating entirely to `History`, OR `History` gains a `peekKind()` + a structural
push/pop path. **Decision: keep `History` as the bounded stack (it owns eviction + the byte
budget), but make its element type the `Edit` union and give it a `peek()` so the Studio can
branch.** The byte cost of a structural entry = sum of `bufferBytes` of any buffers it carries
(pasted clip buffer; deleted track's clip buffers; cross-track move carries no buffer). This
keeps the 256MB / 50-entry cap honest.

`#restoreSnapshot` stays for the `buffer` kind (now also restoring trim). New private appliers:
`#applyAddClip`, `#applyRemoveTrack`, `#applyMoveAcross`, each with an inverse direction flag.

Tests: the engine `History` already has cap/eviction tests; if its element type widens, those
still hold (they use buffer entries). App-level undo/redo of paste/delete/cross-move is covered
by E2E (Section 6).

---

## Section 5 — Cross-track drag: where the logic lives

A clip drag must know which row the pointer is over (to reparent) and detect the empty area
below all rows (to spawn a new track). A single `TrackRow` can't see its siblings.

**Decision: lift the *active move* to the timeline surface (App), reusing the row hit-test
already in `App.svelte`'s `onDrop`.**

- `TrackRow` still owns clip **pointer-down** (it knows the grabbed clip + edge + grab offset).
- When a move crosses the drag threshold, the move is driven by a handler that hit-tests the
  row under `clientY` using the existing `data-track-id` query (same code path as drop):
  - pointer over an existing row → target = that track.
  - pointer below the last row (in the scroller's empty space) → target = a *new track* (create
    lazily on **drop**, not on every move, to avoid spawning rows mid-drag).
- During the drag, the clip follows the cursor as a **preview** (in-track `moveClip` for x, and
  a visual indicator of the target track). The **commit** happens on pointer-up:
  - same track → the in-track `moveClip` result already applied; just `endClipMove()`.
  - different existing track → `moveClipToTrack(from, clip, to, desiredStart)`.
  - empty space → create a new track, then `moveClipToTrack(from, clip, newTrack.id, start)`.

To keep `TrackRow` from owning window-level concerns, the cross-row hit-test + commit lives in
a small helper the App wires up (e.g. the App passes a callback, or a `studio`-level method
`resolveTrackAt(clientY): trackId | 'new' | null` that App implements via the DOM and TrackRow
calls). **Decision: App owns a `pointermove`/`pointerup` listener during an active clip drag**
(set when a clip drag starts), so the geometry/DOM logic stays in App where the drop hit-test
already is; `TrackRow` only signals "a clip drag started for (trackId, clipId, grabOffset)" via
a `studio` drag-intent field. This keeps DOM hit-testing in one component (App) and per-lane
pointer-down in TrackRow.

> Note: this is the most intricate interaction. The plan should implement it incrementally:
> first in-track move with cursor-seek + resize (no cross-track), verify; then layer
> cross-track + new-track-on-empty on top with its own E2E.

---

## Section 6 — Testing

Per project convention, tests land with the feature in the same branch.

- **Engine unit (`project.test.ts`)**: `clipDuration`, `clipEnd`, `resizeClip` (passthrough,
  head/tail trim, left-edge `start` coupling, `MIN_CLIP_DURATION` clamp), and `clampClipStart`
  remaining correct now that it uses `clipDuration`.
- **App E2E (Playwright, `packages/app/tests/`)** — using user-provided fixtures:
  - Click a clip → playhead lands at the clicked point AND the clip is object-selected.
  - Drag a clip's right edge left → clip box narrows; total project duration shrinks; drag back
    out → audio returns (visible width grows again) — proves non-destructive.
  - Drag a clip onto another track → it reparents; undo → returns to source track + start.
  - Drag a clip into empty space below → a new track is created holding it.
  - Copy a range, move playhead, paste → a new clip appears at the playhead; undo removes it.
  - Paste where the playhead slot is occupied → new track gets the clip.
  - Hover a track header, click `✕` → track removed; undo → track returns at its index.

---

## Deferred — v2 / v3 backlog (captured here, not built now)

These were raised during brainstorming and are explicitly out of scope for this spec, recorded
so they aren't lost:

1. **Right-click context menus (v2).** Per-clip menu: Export clip, Delete, Copy, Cut, Paste,
   (later) Split. Per-track menu: Delete track, Rename, Add track. Needs a small reusable
   context-menu component + the clip/track under the cursor. The undoable structural commands
   from Section 4 (`add-clip`, `remove-track`, cross-move) are the foundation these menu items
   will call.
2. **Edit-button redesign / iconification (v2).** The current `EditButtons` row is bulky and
   hard to use. Replace text buttons with a compact icon toolbar (with tooltips + the existing
   keyboard shortcuts), grouping Cut/Copy/Paste, Delete/Silence/Trim, Fades, Undo/Redo.
   Paste's new "create clip at playhead" semantics (this spec) is the first of several behavior
   changes that motivate the redesign. Consider a tooltip/legend surfacing shortcuts.
3. **Waveform regeneration on zoom (v2/v3).** The waveform is rendered at one resolution and
   looks pixelated when zoomed in (and over-dense when zoomed out). Regenerate peaks at a
   level-of-detail matched to the current `pxPerSec` (re-extract from the buffer at the visible
   sample density, ideally off the main thread / cached per LOD bucket).
4. **Timeline-ruler width at zoom (later — fix sketched).** The ruler / lane widths don't track
   correctly across zoom changes (the `w-full`/content-width interplay). Likely fix: make the
   ruler and every lane share the single derived `contentWidth = timeToPx(projectDuration)` as
   an explicit pixel width (no `w-full`), and ensure all width sources use the trim-aware
   `clipEnd`/`projectDuration` from Section 1 so they stay consistent. Worth a focused pass
   with the zoom-anchor logic in `App.svelte`.

---

## Risk & sequencing notes

- **Highest-risk piece:** the history union (Section 4) and cross-track drag (Section 5). The
  plan should build the engine trim + cursor-seek + in-track resize first (small, well-tested),
  then the history refactor, then paste-as-new-clip + track-delete (which need the history
  refactor), then cross-track drag last.
- **Boundary check:** confirm no DOM/Svelte leaks into the engine — only `clipDuration`,
  `clipEnd`, `resizeClip`, `MIN_CLIP_DURATION`, the trim fields, and the trim-aware transport
  scheduling change touch the engine.
- **Backward compatibility:** trim fields are optional and default to 0, so existing E2E
  fixtures and the multi-clip tests keep passing unchanged.
