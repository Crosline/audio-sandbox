# Step 8b — Multi-clip lane: design

**Date:** 2026-06-05
**Status:** Approved (brainstorm)
**Predecessors:** Step 8 (selection + editing), Step 8.5 (live mixer)

## Goal

Today each track lane renders only its first clip (`track.clips[0]`) and selection/editing
operates on that one clip. Step 8b makes the lane **multi-clip**:

1. Render **all** clips on a track at their `start` offsets.
2. Select a clip **as an object** (distinct from the existing time-range selection), shown
   with a prominent border.
3. **Drag** a selected clip to change its `start` offset — clamped at timeline 0 and stopped
   at neighboring clips (no overlap on a track). Moves are **undoable**.
4. **Drop-to-position:** dropping an imported file onto a track lands the clip at the track +
   time under the cursor; dropping off any track creates a new track at start 0 (today's
   behavior).

This is almost entirely an **app-layer** feature: the transport already schedules every clip
at its `start` offset ([transport.ts:138](../../../packages/engine/src/transport/transport.ts))
and `projectDuration` already spans all clips. The only engine addition is one pure helper.

## Engine changes

### `clampClipStart` — pure, unit-tested

Add to [packages/engine/src/model/project.ts](../../../packages/engine/src/model/project.ts)
and export it from the model index:

```ts
/**
 * The nearest legal start (seconds) for a clip being moved on its track: never below 0,
 * and never overlapping another clip on the same track — a dragged clip stops flush against
 * the neighbor it would otherwise collide with. The clip being moved is identified by id and
 * excluded from the neighbor set.
 */
export function clampClipStart(track: Track, clipId: Id, desiredStart: number): number;
```

Algorithm (all in seconds):

- Let `dur` = the moving clip's `buffer.duration`.
- `others` = the track's other clips (by id), each an interval `[c.start, c.start + dur_c)`.
- Start from `s = max(0, desiredStart)`; proposed interval is `[s, s + dur)`.
- If `[s, s+dur)` overlaps any `other`, resolve by snapping to the nearest non-overlapping
  edge: pick the closest of "left edge of the blocking neighbor minus `dur`" (butt up on the
  left) and "right edge of the blocking neighbor" (butt up on the right), then re-clamp to 0
  and re-check against the remaining neighbors. With ≤ a couple of clips per track in v1 this
  is a small fixed loop; correctness over cleverness.
- Return the resolved `s`.

This keeps collision logic framework-agnostic and browser-free, matching the buffer-ops
testing convention. **Tests** (`project.test.ts`): clamp below 0 → 0; no neighbors →
passthrough (after the 0-clamp); pushed against a left neighbor; pushed against a right
neighbor; exact-fit gap between two neighbors; single-clip track is a no-op.

No other engine changes. `Clip.start` is already mutable in the model.

## Studio (app) changes

### New reactive object-selection state

```ts
/** A clip selected *as an object* (for move), distinct from the time-range `selection`. */
selectedClip = $state<{ trackId: string; clipId: string } | null>(null);
```

`selectedClip` and the existing time-range `selection` are **mutually exclusive**:

- `selectClip(trackId, clipId)` — sets `selectedClip`, calls `clearSelection()` (drops any
  time-range highlight and `#playRangeEnd`).
- `clearSelectedClip()` — sets `selectedClip = null`.
- `setSelection(...)` (range) and `seek(...)` from a lane click also clear `selectedClip`.

### `moveClip` — undoable

```ts
/** Move a clip to a new start offset (clamped, no overlap). Undoable. */
moveClip(trackId: string, clipId: string, desiredStart: number): void;
```

- Resolve the clip + track; compute `next = clampClipStart(track, clipId, desiredStart)`.
- If `next === clip.start`, do nothing (no-op; don't pollute history).
- Push a history snapshot of the **old** position (see history change), then set the new
  `start` immutably (`updateTrack` with the clip's `start` replaced) and refresh history flags.

### History snapshot carries `start`

The `ClipSnapshot` interface gains an optional `start`:

```ts
interface ClipSnapshot {
  trackId: string;
  clipId: string;
  buffer: AudioBuffer;
  /** Clip start at snapshot time. Present for move edits; restored on undo/redo. */
  start?: number;
}
```

- **Buffer edits** (`#editSelectedClip`) snapshot `buffer` as today and omit `start` (so undo
  leaves position untouched).
- **Moves** (`moveClip`) snapshot the **unchanged** current `buffer` plus the **old** `start`.
  Byte cost for the budget = `bufferBytes(buffer)` as usual; the buffer reference is shared
  (no copy), so the real memory cost of a move is ~0, but counting it keeps the budget logic
  uniform and simple.
- Undo/redo restore both: a new private `#restoreSnapshot(state)` replaces the buffer and, if
  `state.start !== undefined`, also sets the clip's `start`. Both `undo()` and `redo()` route
  through it. `#historyTargetClip()` must also report the live `start` so the opposite stack
  gets the correct current position.

This means undo of a move restores the old offset, and undo of a buffer edit doesn't move the
clip — the two edit kinds compose on one stack.

### `addFile` drop-to-position

`addFile` gains optional placement:

```ts
async addFile(file: File, opts?: { trackId?: string; start?: number }): Promise<Clip>;
```

- With `opts.trackId`, append to that track; the new clip's `start` = `clampClipStart(track,
  newClipId, opts.start ?? 0)`. (Clamp so a dropped clip never overlaps existing ones.)
- Without a trackId (or no tracks), behave as today: create a track, clip at start 0.

The previous signature `addFile(file)` still works (defaults to a new/empty placement). The
existing `loadFiles` (used by the Import button and multi-file drop) keeps calling
`addFile(file)` with no placement, so Import/multi-import behavior is unchanged.

## TrackRow (app) changes

### Render all clips

The lane stops rendering only `clips[0]`. New derived values:

- `laneWidth = max over clips of timeToPx(clip.start + clip.buffer.duration)` (the track's
  full extent; 0 when empty).
- Each clip is an **absolutely-positioned** box inside the lane:
  `left: timeToPx(clip.start)px`, `width: timeToPx(clip.buffer.duration)px`, the `<Waveform>`
  filling it.

### Borders

- Every clip box: a **subtle** border (e.g. `border border-[var(--color-border)]`).
- The object-selected clip (`studio.selectedClip` matches): a **prominent** border
  (`border-2 border-[var(--color-accent)]` / ring).

### Pointer model (per clip)

Pointer handlers move from the lane onto each clip box, and resolve times relative to that
clip's own origin (`pxToTime(localX) ` where `localX` is measured from the clip box's left).
The existing 3px `DRAG_THRESHOLD` is reused.

Behavior, matching the approved interaction model (**click to select; drag to move** — two
gestures; a drag on an *unselected* clip selects it on release but does **not** move it):

- **Pointer-down on a clip box:** capture pointer, record `pressX`/`pressTime` and whether this
  clip was *already* the object-selected clip (`wasSelected`).
- **Pointer-move past threshold:**
  - If `wasSelected` → **drag-move**: `studio.moveClip(trackId, clipId, clip.start +
    (pointerTimeFromLaneOrigin − grab))`. Compute against the **lane** origin so the clip
    tracks the cursor; `grab` is the press offset within the clip. Live-update on each move.
  - If **not** `wasSelected` → this is a range-select drag on a not-yet-object-selected clip.
    Per the model, dragging an unselected clip should not move it; it performs the existing
    **time-range selection** on that clip (sets `studio.selection`, which also implies the clip
    is not object-selected). This preserves the Step 8 range-select gesture.
- **Pointer-up without crossing threshold (a click):**
  - Select this clip as an object: `studio.selectClip(trackId, clipId)`. (Clears any range
    selection.) No seek — clicking a clip selects it; seeking is for the empty lane.
- **Click on empty lane area** (a track with clips but the press landed outside every clip
  box, or an empty track): clear object selection and **seek** to that absolute time
  (`clearSelectedClip()` + `seek(time)`), preserving the Step 8 empty-lane behavior. Because
  clips are now positioned boxes, "empty lane" is the lane background not covered by a clip;
  pointer events on the background vs. a clip box naturally separate via the DOM (clip boxes
  sit above the lane background and stop propagation on press).

> Note: range-selection on a clip remains available via dragging an **unselected** clip (it
> selects-as-range), and the existing EditButtons / keyboard edits act on `studio.selection`
> as before. Selecting a clip *as an object* is the new, separate state used only for moving.

### Time-range highlight position

The selection highlight div moves **inside** the target clip's box (its `left`/`width` are
already clip-relative via `timeToPx(sel.start)` / `timeToPx(sel.end - sel.start)`), so no math
change — only its DOM parent changes from the lane to the matching clip box.

## App.svelte changes

### Drop-to-position

`onDrop` computes the drop target:

- Determine the **track** under the drop: hit-test the drop `clientY` against the rendered
  track-row elements (each TrackRow root carries `data-track-id`; `onDrop` finds the row whose
  bounding box contains `clientY`). If none, fall back to today's behavior.
- Determine the **time**: `pxToTime(clientX − rowLeft − HEADER_W + scrollLeft)` clamped ≥ 0,
  using the same lane coordinate math already used by the wheel-zoom handler.
- For each dropped file: if a track was hit, `addFile(file, { trackId, start })`; else
  `addFile(file)` (new track, start 0). Multi-file drop lands the first at the computed start;
  subsequent files append after (each clamped, so they butt up rather than overlap).

The Import button path (`loadFiles`) is unchanged (no placement).

### Object-selection clearing

A background click on the timeline `<main>` (not on a clip) already routes through lane
empty-area handling in TrackRow; no extra global handler needed. Keyboard edits are unchanged.

## Testing

### Engine (Vitest)

- `clampClipStart` in `project.test.ts`: below-0 clamp; no-neighbor passthrough; left-neighbor
  butt; right-neighbor butt; exact-fit gap; single-clip no-op.

### App unit (Vitest)

- History restoring `start`: a `History<ClipSnapshot>` round-trip where the snapshot carries a
  `start`, asserting undo/redo return it. (Pure; no browser.)

### App E2E (Playwright) — `multiclip.spec.ts`

Using the in-memory WAV fixture helper and the `window.__studio` hook:

- Two clips on one track render at distinct `left` offsets (drive via `__studio` to place a
  second clip at a known start).
- Click a clip → it gains the prominent border (`selectedClip` set), time-range selection
  cleared.
- Drag a selected clip right → its `start` increases; assert via `__studio`.
- Drag toward a neighbor → `start` stops at the no-overlap edge (asserts clamp).
- Undo after a move → `start` restored.
- Drop a file at a cursor position over a track → new clip's `start` ≈ the drop time
  (tolerance for px↔s rounding).

All existing suites (engine 121, app 12 unit + 16 E2E) must stay green. The Step 8
`selection.spec.ts` gestures continue to work because range-select is preserved (drag on an
unselected clip).

## Out of scope (deferred)

- Snap-to-grid / beat snapping (bpm grid isn't wired).
- Moving clips **between** tracks (vertical drag). This step is horizontal-only within a track.
- Resizing/trimming clip edges by dragging handles (Step 8 trim already covers buffer trim).
- Per-clip naming UI, clip color, clip context menu.

## Git

Branch `feat/multi-clip-lane`, single commit, rebase + ff onto `main` (per CLAUDE.md).
Pause for the user's review after merge.
