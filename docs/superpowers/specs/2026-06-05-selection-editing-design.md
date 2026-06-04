# Step 8 — Selection + Editing UI

Status: approved 2026-06-05 · Branch: `feat/selection-editing`

## Why

The timeline can load, render, zoom/scroll, and play clips, but offers **no editing**. Step 8
delivers the core editor loop: drag a time range on a clip's waveform, see its start/end/length,
audition just that range, and apply the destructive `buffer-ops` — cut, copy, paste, delete,
silence, trim, fade in/out — each reversible through a bounded undo/redo stack.

The pure `buffer-ops` primitives and the seconds wrappers already exist
(`packages/engine/src/buffer-ops/`), along with the transport. Missing pieces: one new pure op
(`insertBuffer`, for paste), a framework-agnostic **history** module (CLAUDE.md mandates a bounded
Command stack), and the app-side selection state, waveform interaction, edit controls, and
play-range auto-stop.

## Scope (single-track, single-clip)

A selection is a half-open `[start, end)` time range (seconds) within **one track's first clip**
(`clip[0]`). Edits apply to that clip's buffer. Explicitly **out of scope** (→ later steps):

- Multi-clip lane: render all clips at their `start` offsets, select a clip as an object, drag a
  clip to change its offset → **Step 8b**.
- Live per-track mixer gain node → **Step 8.5** (already specced).
- Effects, presets, export, persistence, mobile → Steps 9–13.

### Interaction rules

- **Click** on a track lane (press + release, < ~3px movement) → seek the playhead there (like the
  ruler) and clear the selection.
- **Drag** on a lane → create/update a selection on that clip.
- **Play with a selection active** → seek to selection start, play, and auto-stop at selection end
  (one-shot audition).
- Selection **start / end / length** are shown in the footer next to the transport.

## Architecture

Respects the engine/app boundary — `@audiosandbox/engine` stays UI/DOM-free.

1. **Engine pure op** — `insertBuffer` / `insertBufferSeconds` (`buffer-ops/`).
2. **Engine history module** — generic bounded undo/redo stack (`history/`).
3. **App** — selection state + edit methods + history wiring in `Studio`; drag/seek + highlight in
   `TrackRow`; edit buttons in the header; selection readout in the footer; play-range auto-stop in
   the RAF loop; window keyboard shortcuts.

### Data flow

```text
TrackRow lane --pointer--> Studio.selection (trackId,clipId,start,end) --$state--> highlight + button enable
EditButtons "Cut" --> Studio.cut() --> bufferFactory + cutSeconds(clip.buffer,...) 
                                   --> history.push(prev buffer snapshot)
                                   --> updateTrack(new buffer) --$state--> Waveform redraws
Play --> Studio.play() --> if selection: seek(start); RAF tick stops when pos >= selection end (abs)
```

## Engine: `insertBuffer`

Mirror `insertSilence` but copy real samples from a source buffer, reusing the existing private
`blit`/`allocLike`/`clampFrame` helpers. Channel handling = min(src, dst) channels; any extra dst
channels stay zero-filled.

```ts
export function insertBuffer(dst, src, at, factory): AudioBuffer  // length = dst.length + src.length
export function insertBufferSeconds(dst, src, atSec, factory): AudioBuffer  // secondsToFrames(dst, atSec)
```

Re-exported from `buffer-ops/index.ts` and the engine root. **Tests:** exact-sample assertions for
insert at start/mid/end; dst not mutated; mono-into-stereo; clamped `at`.

## Engine: `history/` bounded undo/redo

A generic stack storing **state snapshots** (not inverse ops). For Step 8 the snapshot is the
clip's prior `AudioBuffer` plus locating metadata (`trackId`, `clipId`) and a label.

```ts
interface HistoryLimits { maxEntries: number; maxBytes: number; }
class History<S> {
  constructor(limits: HistoryLimits);
  push(label: string, state: S, bytes: number): void;  // clears redo; evicts oldest over either cap
  undo(current: S, currentBytes: number): { state: S; label: string } | null;
  redo(current: S, currentBytes: number): { state: S; label: string } | null;
  get canUndo(): boolean; get canRedo(): boolean;
  clear(): void;
}
```

- Bounded by **both** `maxEntries` and `maxBytes` (sum of entry bytes); evict **oldest** undo
  entries until within both caps. New `push` clears the redo stack (linear history).
- `bytes` is supplied by the caller — the engine makes no `AudioBuffer`-size assumptions. The app
  computes `length × numberOfChannels × 4`.
- Pure, no `AudioContext`. **Tests:** undo/redo round-trips, redo cleared on push, evict-by-count,
  evict-by-bytes, `canUndo`/`canRedo`, `clear`.

## App: `Studio` additions

```ts
interface Selection { trackId: string; clipId: string; start: number; end: number; }
selection = $state<Selection | null>(null);
canUndo = $state(false); canRedo = $state(false);  // mirrored from history after each op
// private: History instance, #clipboard: AudioBuffer | null, #playRangeEnd: number | null
```

- `setSelection` / `clearSelection` — clamp to clip duration.
- Private `#editClip(trackId, clipId, label, transform)` — snapshot prev buffer into history,
  run `transform(buffer) → newBuffer`, `updateTrack`, refresh flags. **All edits route through it.**
- `cut/copy/paste/deleteSelection/silence/trim/fadeIn/fadeOut` — use the matching `*Seconds` op via
  `bufferFactory`; cut/copy fill `#clipboard`; paste inserts it at selection start (or playhead).
  Length-changing edits collapse the selection to its start.
- `undo()` / `redo()` — restore a snapshot to its clip, update flags.
- Play-range: when `play()` is called with a selection, set `#playRangeEnd = clip.start +
  selection.end`, seek to `clip.start + selection.start`; the existing RAF loop stops when
  `pos >= #playRangeEnd`. Cleared on stop/seek/selection change.

## App: UI

- **`TrackRow.svelte`** — pointer handlers on the lane (`pointerdown/move/up` with capture and a
  ~3px threshold) using `studio.pxToTime`; a positioned overlay div renders the highlight
  (`bg-accent/25`, `border-x`) for the clip that owns the selection. The canvas draw path is
  untouched (32000px cap logic preserved).
- **`EditButtons.svelte`** (new) — mounted in the header next to zoom/+Track/Import. Cut, Copy,
  Paste, Delete, Silence, Trim, Fade In, Fade Out · Undo, Redo. Disabled states from
  `selection`/clipboard/`canUndo`/`canRedo`.
- **`TransportBar.svelte`** — selection readout next to play/stop:
  `Sel 00:01.250 → 00:03.500 · 2.250s`, else muted "No selection".
- **`App.svelte`** — `window` keyboard shortcuts (guarded against inputs): Ctrl/Cmd+Z/Shift+Z,
  X/C/V, Delete.
- **`lib/time.ts`** (new, + test) — `formatTime(seconds)` extracted from `TransportBar`, shared.

## Testing

Tests land in this branch (CLAUDE.md convention):

- **Engine (Vitest):** `insertBuffer` exact-sample + no-mutation + clamp; `History`
  round-trip/evict/flags.
- **App unit (Vitest):** `formatTime`.
- **App E2E (Playwright, in-memory WAV fixture):** drag → highlight + readout; click → seek +
  clear; Cut shrinks the lane, Undo restores, Redo re-applies; Copy→Paste lengthens; edit buttons
  enable only with a selection.
- **Manual:** import a fixture, drag-select, audition the range (plays start→end then stops),
  exercise each edit + undo/redo. Engine + app builds clean.

Done = engine tests (102 existing + new) green, app unit + E2E green, both builds clean.

## Workflow

One branch `feat/selection-editing`, small commits squashed to one, `--no-ff` merge to `main`,
then pause for the user's review before Step 8b/8.5.
