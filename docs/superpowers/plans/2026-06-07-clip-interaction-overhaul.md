# Clip Interaction Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clip manipulation feel like a DAW — click seeks the playhead into the clip and selects it, dragging a clip's border resizes it non-destructively, a clip can be dragged to another (or new) track, paste creates a new clip at the playhead, and tracks can be deleted via a hover button — all undoable.

**Architecture:** The engine gains a non-destructive trim model on `Clip` (`trimStart`/`trimEnd`) with pure helpers (`clipDuration`, `clipEnd`, `resizeClip`) and a trim-aware transport. The app's `Studio` grows a structural undo history (tagged-union edits: buffer / add-clip / remove-track / move-across), cursor-on-click seeking, an undoable resize command, cross-track move, and paste-as-new-clip. `TrackRow` gets edge-resize handles and a hover delete button; `App.svelte` owns the cross-track drag hit-test (reusing its existing drop logic).

**Tech Stack:** Svelte 5 (runes) + TypeScript, `@audiosandbox/engine` (Web Audio), Vitest (engine + app unit), Playwright (E2E). pnpm workspaces.

---

## File structure

- **Modify:**
  - `packages/engine/src/model/types.ts` — `trimStart?`/`trimEnd?` on `Clip`.
  - `packages/engine/src/model/project.ts` — `MIN_CLIP_DURATION`, `clipDuration`, `clipEnd`, `resizeClip`; make `clampClipStart` and `projectDuration` trim-aware.
  - `packages/engine/src/model/project.test.ts` — tests for the new helpers + trim-aware `clampClipStart`.
  - `packages/engine/src/index.ts` — export the new helpers + constant.
  - `packages/engine/src/transport/transport.ts` — trim-aware scheduling + `#duration`.
  - `packages/engine/src/history/history.ts` — add `peek()`.
  - `packages/engine/src/history/history.test.ts` — test for `peek()`.
  - `packages/app/src/lib/studio.svelte.ts` — `Edit` union, `lastTrackId`, cursor-seek split, `resizeClip`/`endClipResize`, `moveClipToTrack`, paste rewrite, undoable `removeTrack`, structural undo/redo.
  - `packages/app/src/components/TrackRow.svelte` — edge-resize handles, hover delete button, cursor-seek on clip click, trim-aware widths, clip-drag-intent signal.
  - `packages/app/src/App.svelte` — cross-track drag listener (hit-test row under pointer; new track on empty space).
- **Create:**
  - `packages/app/tests/clip-interaction.spec.ts` — E2E.

Commands (from repo root):
- Engine tests: `pnpm --filter @audiosandbox/engine test`
- Engine build (so the app sees new exports): `pnpm --filter @audiosandbox/engine build`
- App unit: `pnpm --filter app test`
- App E2E: `pnpm --filter app test:e2e`
- Typecheck app: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json`

> **Sequencing rationale:** engine trim first (small, pure, well-tested) → `History.peek()` → Studio cursor-seek + resize → history union → paste + track-delete → cross-track drag last. Each task ends green and committed.

---

## Task 1: Engine — `Clip` trim fields + `clipDuration`/`clipEnd`

**Files:**
- Modify: `packages/engine/src/model/types.ts`
- Modify: `packages/engine/src/model/project.ts`
- Test: `packages/engine/src/model/project.test.ts`

- [ ] **Step 1: Add the trim fields to the `Clip` interface**

In `packages/engine/src/model/types.ts`, inside `interface Clip`, after the `name` line add:

```ts
  /** Seconds of the buffer's HEAD to skip (non-destructive left trim). Default 0. */
  trimStart?: number;
  /** Seconds of the buffer's TAIL to skip (non-destructive right trim). Default 0. */
  trimEnd?: number;
```

- [ ] **Step 2: Write the failing tests for `clipDuration` / `clipEnd`**

Append to `packages/engine/src/model/project.test.ts`. Check the file's existing imports first; it already imports from `./project.js` and `../test-helpers.js`. Add `clipDuration`, `clipEnd` to the `./project.js` import and `makeMono` to the helpers import if not present.

```ts
describe('clipDuration / clipEnd', () => {
  const buf = () => makeMono(new Array(8000).fill(0), 8000); // 1.0s mono buffer

  it('untrimmed clip has the full buffer duration', () => {
    const clip = createClip(buf(), 'a', 2);
    expect(clipDuration(clip)).toBeCloseTo(1);
    expect(clipEnd(clip)).toBeCloseTo(3);
  });

  it('subtracts head and tail trim', () => {
    const clip = { ...createClip(buf(), 'a', 2), trimStart: 0.25, trimEnd: 0.1 };
    expect(clipDuration(clip)).toBeCloseTo(0.65);
    expect(clipEnd(clip)).toBeCloseTo(2.65);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @audiosandbox/engine test -- project`
Expected: FAIL — `clipDuration is not a function` (and `clipEnd`).

- [ ] **Step 4: Implement `clipDuration` and `clipEnd`**

In `packages/engine/src/model/project.ts`, add after `createClip` (so they sit near the model it queries). Import `Clip` is already in the file's `import type { Clip, Id, Project, Track }` line — if `Clip` is missing there, add it.

```ts
/** Smallest visible/audible clip length (seconds) a resize may leave. */
export const MIN_CLIP_DURATION = 0.02;

/** A clip's visible/audible length on the timeline, honoring non-destructive trim. */
export function clipDuration(clip: Pick<Clip, 'buffer' | 'trimStart' | 'trimEnd'>): number {
  return clip.buffer.duration - (clip.trimStart ?? 0) - (clip.trimEnd ?? 0);
}

/** A clip's end position on the timeline: start + visible duration. */
export function clipEnd(clip: Pick<Clip, 'buffer' | 'start' | 'trimStart' | 'trimEnd'>): number {
  return clip.start + clipDuration(clip);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @audiosandbox/engine test -- project`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/model/types.ts packages/engine/src/model/project.ts packages/engine/src/model/project.test.ts
git commit -m "feat(engine): non-destructive clip trim fields + clipDuration/clipEnd"
```

---

## Task 2: Engine — make `clampClipStart` and `projectDuration` trim-aware

**Files:**
- Modify: `packages/engine/src/model/project.ts`
- Test: `packages/engine/src/model/project.test.ts`

- [ ] **Step 1: Write a failing test proving clamp uses visible duration, not buffer length**

Append to `project.test.ts`:

```ts
describe('clampClipStart respects trim (visible duration)', () => {
  const buf = () => makeMono(new Array(8000).fill(0), 8000); // 1.0s

  it('a half-trimmed (0.5s) moving clip fits in a 0.5s gap', () => {
    const left = createClip(buf(), 'L', 0); // occupies [0,1)
    const right = createClip(buf(), 'R', 1.5); // occupies [1.5,2.5)
    // moving clip is 1s buffer but trimmed to 0.5s visible
    const moving = { ...createClip(buf(), 'M', 5), trimEnd: 0.5 };
    const track = createTrack('t', [left, moving, right]);
    // The [1.0,1.5) gap is exactly 0.5s — the trimmed clip fits flush at 1.0.
    expect(clampClipStart(track, moving.id, 1.0)).toBeCloseTo(1.0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @audiosandbox/engine test -- project`
Expected: FAIL — clamp still uses `buffer.duration` (1s), so it won't fit the 0.5s gap and returns a different start.

- [ ] **Step 3: Make `clampClipStart` and `projectDuration` use `clipDuration`/`clipEnd`**

In `clampClipStart`, replace the moving clip's duration and each neighbor's `hi`:

```ts
  const dur = clipDuration(moving);
  const others = track.clips
    .filter((c) => c.id !== clipId)
    .map((c) => ({ lo: c.start, hi: clipEnd(c) }))
    .sort((a, b) => a.lo - b.lo);
```

In `projectDuration`, replace the inner accumulation:

```ts
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clipEnd(clip));
    }
  }
```

- [ ] **Step 4: Run to verify the new test passes and the existing clamp tests still pass**

Run: `pnpm --filter @audiosandbox/engine test -- project`
Expected: PASS (new test + all prior `clampClipStart` / `projectDuration` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/model/project.ts packages/engine/src/model/project.test.ts
git commit -m "feat(engine): clampClipStart and projectDuration honor visible (trimmed) duration"
```

---

## Task 3: Engine — `resizeClip` pure helper

**Files:**
- Modify: `packages/engine/src/model/project.ts`
- Test: `packages/engine/src/model/project.test.ts`

`resizeClip` is geometry-only (no neighbor overlap; the Studio applies `clampClipStart` after). It maps a desired trim amount on one edge to the clip's new `{ start, trimStart, trimEnd }`.

- [ ] **Step 1: Write the failing tests**

Append to `project.test.ts` (add `resizeClip`, `MIN_CLIP_DURATION` to the `./project.js` import):

```ts
describe('resizeClip', () => {
  const buf = () => makeMono(new Array(8000).fill(0), 8000); // 1.0s

  it('right edge: sets trimEnd, leaves start and trimStart', () => {
    const clip = createClip(buf(), 'a', 2);
    const r = resizeClip(clip, 'right', 0.3); // hide 0.3s of the tail
    expect(r.start).toBeCloseTo(2);
    expect(r.trimStart).toBeCloseTo(0);
    expect(r.trimEnd).toBeCloseTo(0.3);
  });

  it('left edge: trimStart and start move together by the same delta', () => {
    const clip = createClip(buf(), 'a', 2);
    const r = resizeClip(clip, 'left', 0.4); // hide 0.4s of the head
    expect(r.trimStart).toBeCloseTo(0.4);
    expect(r.start).toBeCloseTo(2.4); // left face moves right; audio under kept region stays put
    expect(r.trimEnd).toBeCloseTo(0);
  });

  it('clamps so visible duration never drops below MIN_CLIP_DURATION', () => {
    const clip = createClip(buf(), 'a', 2);
    const r = resizeClip(clip, 'right', 5); // absurd over-trim on a 1s clip
    expect(clipDuration({ ...clip, ...r })).toBeCloseTo(MIN_CLIP_DURATION);
  });

  it('clamps negative trim (growing past the buffer edge) to 0', () => {
    const clip = { ...createClip(buf(), 'a', 2), trimEnd: 0.3 };
    const r = resizeClip(clip, 'right', -1); // pull the right edge back out fully
    expect(r.trimEnd).toBeCloseTo(0);
  });

  it('left edge clamp also keeps start consistent', () => {
    const clip = createClip(buf(), 'a', 2);
    const r = resizeClip(clip, 'left', 5); // over-trim from the left
    expect(clipDuration({ ...clip, ...r })).toBeCloseTo(MIN_CLIP_DURATION);
    // start moved right by exactly the applied trimStart
    expect(r.start - 2).toBeCloseTo(r.trimStart);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @audiosandbox/engine test -- project`
Expected: FAIL — `resizeClip is not a function`.

- [ ] **Step 3: Implement `resizeClip`**

In `packages/engine/src/model/project.ts`, add after `clipEnd`:

```ts
/**
 * Geometry for a non-destructive edge resize. `desiredTrim` is the target trim amount
 * (seconds) measured from the named edge of the buffer; negative means grow the clip back
 * out toward the buffer's natural edge. Returns the clip's new `start`/`trimStart`/`trimEnd`.
 *
 * - Right edge: only `trimEnd` changes; `start` and `trimStart` are untouched.
 * - Left edge: `trimStart` changes AND `start` moves by the same delta, so the audio under
 *   the kept region stays fixed on the timeline (the clip's left face slides, the audio does
 *   not).
 *
 * Trims are clamped to `[0, buffer.duration - opposite - MIN_CLIP_DURATION]` so the clip
 * never inverts and visible duration stays >= MIN_CLIP_DURATION. Overlap with neighbors is
 * NOT considered here — the caller applies that separately.
 */
export function resizeClip(
  clip: Pick<Clip, 'buffer' | 'start' | 'trimStart' | 'trimEnd'>,
  edge: 'left' | 'right',
  desiredTrim: number,
): { start: number; trimStart: number; trimEnd: number } {
  const total = clip.buffer.duration;
  const curStart = clip.trimStart ?? 0;
  const curEnd = clip.trimEnd ?? 0;

  if (edge === 'right') {
    const maxEnd = Math.max(0, total - curStart - MIN_CLIP_DURATION);
    const trimEnd = Math.min(Math.max(0, desiredTrim), maxEnd);
    return { start: clip.start, trimStart: curStart, trimEnd };
  }
  // left edge
  const maxStart = Math.max(0, total - curEnd - MIN_CLIP_DURATION);
  const trimStart = Math.min(Math.max(0, desiredTrim), maxStart);
  const delta = trimStart - curStart; // how much the left face moved
  return { start: clip.start + delta, trimStart, trimEnd: curEnd };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @audiosandbox/engine test -- project`
Expected: PASS.

- [ ] **Step 5: Export the new symbols**

In `packages/engine/src/index.ts`, in the `./model/project.js` export block, add `clipDuration`, `clipEnd`, `resizeClip`, `MIN_CLIP_DURATION` (keep the list alphabetized as the file does).

- [ ] **Step 6: Build the engine so the app picks up the new exports**

Run: `pnpm --filter @audiosandbox/engine build`
Expected: build succeeds (ESM + .d.ts emitted).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/model/project.ts packages/engine/src/model/project.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): resizeClip pure helper + export trim model helpers"
```

---

## Task 4: Engine — trim-aware transport scheduling

**Files:**
- Modify: `packages/engine/src/transport/transport.ts`

No unit test (the transport is verified in-app per CLAUDE.md); the arithmetic it depends on is the already-tested `clipDuration`/`clipEnd`. This task is verified by Task 11's E2E (resize shortens audible playback) and a manual check.

- [ ] **Step 1: Import the trim helpers**

In `packages/engine/src/transport/transport.ts`, update the model import line to include the new helpers:

```ts
import { anyTrackSoloed, clipDuration, clipEnd, trackTargetGain } from '../model/project.js';
```

- [ ] **Step 2: Make `#duration()` trim-aware**

Replace the body's inner loop:

```ts
  #duration(): number {
    let end = 0;
    for (const track of this.#getProject().tracks) {
      for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
    }
    return end;
  }
```

- [ ] **Step 3: Make `#startSources` honor trim when scheduling**

In `#startSources`, replace the per-clip block so the buffer read window is `[trimStart, trimStart + clipDuration]`:

```ts
      for (const clip of track.clips) {
        const trimStart = clip.trimStart ?? 0;
        const visible = clipDuration(clip);
        const clipStart = clip.start;
        const clipEndPos = clipStart + visible;
        if (clipEndPos <= fromPosition) continue; // already past this clip

        const node = ctx.createBufferSource();
        node.buffer = clip.buffer;
        node.connect(trackGain);

        if (fromPosition <= clipStart) {
          // Clip begins in the future: start after the lead-in, read the trimmed window.
          node.start(startClock + (clipStart - fromPosition), trimStart, visible);
        } else {
          // Playhead is inside the clip: start now, offset past the head trim + elapsed.
          const into = fromPosition - clipStart;
          node.start(startClock, trimStart + into, visible - into);
        }
        this.#sources.push({ node });
      }
```

- [ ] **Step 4: Typecheck + build the engine**

Run: `pnpm --filter @audiosandbox/engine build`
Expected: build succeeds.

- [ ] **Step 5: Run the full engine test suite (nothing regressed)**

Run: `pnpm --filter @audiosandbox/engine test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/transport/transport.ts
git commit -m "feat(engine): transport schedules clips using the trimmed buffer window"
```

---

## Task 5: Engine — `History.peek()`

The Studio's undo/redo needs to branch on the top entry's kind before applying. Add a non-destructive `peek()`.

**Files:**
- Modify: `packages/engine/src/history/history.ts`
- Test: `packages/engine/src/history/history.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/src/history/history.test.ts`:

```ts
describe('History.peek', () => {
  it('returns null when empty', () => {
    const h = new History<string>(LIMITS);
    expect(h.peek()).toBeNull();
  });

  it('returns the top undo entry state+label without popping', () => {
    const h = new History<string>(LIMITS);
    h.push('e1', 'a', 1);
    expect(h.peek()).toEqual({ state: 'a', label: 'e1' });
    expect(h.canUndo).toBe(true); // not consumed
    expect(h.undo('b', 1)).toEqual({ state: 'a', label: 'e1' });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @audiosandbox/engine test -- history`
Expected: FAIL — `h.peek is not a function`.

- [ ] **Step 3: Implement `peek()`**

In `packages/engine/src/history/history.ts`, add a method after `redo`:

```ts
  /** Look at the top undo entry (state + label) without removing it, or null if empty. */
  peek(): { state: S; label: string } | null {
    const entry = this.#undo[this.#undo.length - 1];
    return entry ? { state: entry.state, label: entry.label } : null;
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @audiosandbox/engine test -- history`
Expected: PASS.

- [ ] **Step 5: Build the engine**

Run: `pnpm --filter @audiosandbox/engine build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/history/history.ts packages/engine/src/history/history.test.ts
git commit -m "feat(engine): History.peek() for branching on the top entry"
```

---

## Task 6: Studio — cursor-on-click seek (split transport-seek from selection-clear)

**Files:**
- Modify: `packages/app/src/lib/studio.svelte.ts`
- Modify: `packages/app/src/components/TrackRow.svelte`

- [ ] **Step 1: Add `lastTrackId` state**

In `studio.svelte.ts`, near the other `$state` declarations (after `selectedClip`), add:

```ts
  /** The most recently interacted track (clicked clip, seeked lane, dropped file). */
  lastTrackId = $state<string | null>(null);
```

- [ ] **Step 2: Add a private transport-only seek and route `seek()` through it**

Add a private method, and refactor the public `seek` to reuse it (the public one keeps clearing object-selection):

```ts
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
```

(Delete the old `seek` body so there's exactly one `seek`.)

- [ ] **Step 3: Make `selectClip` accept an optional seek point + set `lastTrackId`**

Replace `selectClip`:

```ts
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
```

- [ ] **Step 4: Update the lane-background seek to set `lastTrackId`**

In `TrackRow.svelte`, `onLaneBackgroundDown` currently calls `studio.seek(...)`. Add a `lastTrackId` set so paste targets this track too:

```ts
  function onLaneBackgroundDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    studio.clearSelectedClip();
    studio.clearSelection();
    studio.lastTrackId = track.id;
    studio.seek(studio.pxToTime(laneX(e)));
  }
```

- [ ] **Step 5: Make a clip click seek to the clicked point**

In `TrackRow.svelte`, `onPointerUp`, the click branch currently calls `studio.selectClip(track.id, pressClipId)`. Pass the clicked absolute time. Look up the clip to add its `start`:

```ts
    if (!dragging && pressClipId) {
      // Click on a clip → select it AND move the playhead to the exact clicked point.
      const clip = track.clips.find((c) => c.id === pressClipId);
      const atSeconds = clip ? clip.start + studio.pxToTime(grabInClip) : undefined;
      studio.selectClip(track.id, pressClipId, atSeconds);
    }
```

(`grabInClip` is already the px offset from the clip's left within the lane press; it was computed in `onClipPointerDown`.)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/lib/studio.svelte.ts packages/app/src/components/TrackRow.svelte
git commit -m "feat(app): clicking a clip seeks the playhead to the clicked point and selects it"
```

---

## Task 7: Studio + TrackRow — non-destructive clip resize

**Files:**
- Modify: `packages/app/src/lib/studio.svelte.ts`
- Modify: `packages/app/src/components/TrackRow.svelte`

- [ ] **Step 1: Widen `ClipSnapshot` to carry trim, and `#restoreSnapshot` to apply it**

In `studio.svelte.ts`, extend the `ClipSnapshot` interface:

```ts
interface ClipSnapshot {
  trackId: string;
  clipId: string;
  buffer: AudioBuffer;
  start?: number;
  /** Trim at snapshot time. Present for resize edits; restored on undo/redo. */
  trimStart?: number;
  trimEnd?: number;
}
```

In `#restoreSnapshot`, also restore trim when present:

```ts
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
```

- [ ] **Step 2: Import `resizeClip` and add the resize command + `#resizingClipId`**

Add `resizeClip` (and `clipDuration` if needed elsewhere) to the engine import block. Add the field near `#movingClipId`:

```ts
  #resizingClipId: string | null = null;
```

Add the command (place near `moveClip`):

```ts
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
```

> NOTE: at this point the Studio still uses the buffer-only `History<ClipSnapshot>`. Task 8 migrates it to the `Edit` union; the `ClipSnapshot` shape above becomes the `buffer` variant. Resize uses only the `buffer` kind, so it works before and after Task 8 — but when doing Task 8, the `#history.push('Resize clip', {...})` call must wrap its payload as `{ kind: 'buffer', ... }` (see Task 8).

- [ ] **Step 3: Add edge-resize handles to the clip box in `TrackRow.svelte`**

Add gesture state near the existing per-gesture vars:

```ts
  let resizing: 'left' | 'right' | null = null;
  let resizeClipId: string | null = null;
  let resizePressX = 0;
  let resizeOrigTrim = 0; // the edge's trim at press time
```

Add handlers:

```ts
  function onResizeDown(e: PointerEvent, clip: { id: string; start: number; buffer: AudioBuffer; trimStart?: number; trimEnd?: number }, edge: 'left' | 'right'): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    resizing = edge;
    resizeClipId = clip.id;
    resizePressX = laneX(e);
    resizeOrigTrim = (edge === 'left' ? clip.trimStart : clip.trimEnd) ?? 0;
    try { lane.setPointerCapture(e.pointerId); } catch { /* nicety */ }
  }

  function onResizeMove(e: PointerEvent): void {
    if (!resizing || !resizeClipId) return;
    const dxSec = studio.pxToTime(laneX(e) - resizePressX);
    // Dragging the LEFT edge right (positive dx) ADDS head trim; the RIGHT edge left
    // (negative dx) ADDS tail trim. So left uses +dx, right uses -dx.
    const desiredTrim = resizeOrigTrim + (resizing === 'left' ? dxSec : -dxSec);
    studio.resizeClip(track.id, resizeClipId, resizing, desiredTrim);
  }

  function onResizeUp(e: PointerEvent): void {
    if (!resizing) return;
    resizing = null;
    resizeClipId = null;
    studio.endClipResize();
    try { lane.releasePointerCapture(e.pointerId); } catch { /* never captured */ }
  }
```

Wire resize move/up into the lane's existing pointer handlers so a captured pointer keeps firing. In `onPointerMove`, return early into resize when active:

```ts
  function onPointerMove(e: PointerEvent): void {
    if (resizing) { onResizeMove(e); return; }
    // ...existing body unchanged...
  }
```

In `onPointerUp`, handle resize first:

```ts
  function onPointerUp(e: PointerEvent): void {
    if (resizing) { onResizeUp(e); return; }
    // ...existing body unchanged...
  }
```

Add the two handle divs inside the clip box `{#each}`, after the `<Waveform .../>` (so they sit above it), using trim-aware width for the box itself:

```svelte
        <!-- edge resize handles -->
        <div
          class="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
          data-testid="resize-left"
          role="presentation"
          onpointerdown={(e) => onResizeDown(e, clip, 'left')}
        ></div>
        <div
          class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
          data-testid="resize-right"
          role="presentation"
          onpointerdown={(e) => onResizeDown(e, clip, 'right')}
        ></div>
```

- [ ] **Step 4: Make the clip box width and lane width trim-aware**

Import `clipDuration` in `TrackRow.svelte`'s script:

```ts
  import { clipDuration } from '@audiosandbox/engine';
```

Change `laneWidth` to use it:

```ts
  let laneWidth = $derived(
    track.clips.reduce((w, c) => Math.max(w, studio.timeToPx(c.start + clipDuration(c))), 0),
  );
```

Change the clip box `style` width from `studio.timeToPx(clip.buffer.duration)` to `studio.timeToPx(clipDuration(clip))`.

> The `<Waveform>` keeps rendering the FULL buffer at `clip.buffer.duration` width, but the box has `overflow-hidden`, so the trimmed-out audio is visually clipped. For the LEFT trim, offset the waveform left by `studio.timeToPx(clip.trimStart ?? 0)` so the visible window shows the kept region. Wrap the Waveform in a positioned inner div:

```svelte
        <div class="absolute inset-y-0" style="left: {-studio.timeToPx(clip.trimStart ?? 0)}px">
          <Waveform buffer={clip.buffer} width={studio.timeToPx(clip.buffer.duration)} {color} height={96} />
        </div>
```

(Keep the selection-highlight block; its offsets are relative to the clip origin which still aligns because the box left = clip.start.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/lib/studio.svelte.ts packages/app/src/components/TrackRow.svelte
git commit -m "feat(app): non-destructive clip resize via edge-drag handles (undoable)"
```

---

## Task 8: Studio — structural undo history (`Edit` tagged union)

This migrates the buffer-only history to a union that also undoes add-clip / remove-track / cross-track-move. Pure refactor + foundation; no UI behavior changes yet (paste/delete/cross-move wire to it in Tasks 9–11).

**Files:**
- Modify: `packages/app/src/lib/studio.svelte.ts`

- [ ] **Step 1: Define the `Edit` union and switch the history generic**

Replace the `ClipSnapshot` interface with the union (keep the same buffer fields under the `buffer` kind):

```ts
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
}
type Edit = BufferEdit | AddClipEdit | RemoveTrackEdit | MoveAcrossEdit;
```

Change the history field type:

```ts
  readonly #history = new History<Edit>(HISTORY_LIMITS);
```

- [ ] **Step 2: Tag all existing pushes as `kind: 'buffer'`**

Every existing `this.#history.push(label, { trackId, clipId, buffer, ... }, bytes)` call (in `moveClip`, `resizeClip`, `#editSelectedClip`) must now pass `{ kind: 'buffer', trackId, clipId, buffer, ... }`. Update each push payload accordingly.

- [ ] **Step 3: Rename `#restoreSnapshot` to `#applyBufferEdit` and type it to `BufferEdit`**

Change its parameter type from `ClipSnapshot` to `BufferEdit` (body unchanged). Update its one call site reference in the new undo/redo (Step 5).

- [ ] **Step 4: Add structural appliers**

Add private methods:

```ts
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
```

- [ ] **Step 5: Rewrite `undo()`/`redo()` to branch on the top entry's kind**

Replace the existing `undo`/`redo`/`#historyTargetClip` with kind-aware versions. Structural edits flip themselves between stacks via `peek()` + a direct re-push helper. Because `History` always stashes the supplied "current" state on the opposite stack, for structural edits we hand it back the SAME entry (the inverse is computed at apply time from the entry's before/after data).

```ts
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
    // Mirror of undo against the redo stack. History.redo returns the entry to re-apply.
    const restored = this.#history.redo(
      // current state is unused for structural redo; pass a harmless buffer probe if present
      this.#anyBufferTarget() ?? ({ kind: 'buffer', trackId: '', clipId: '', buffer: undefined as unknown as AudioBuffer } as BufferEdit),
      0,
    );
    if (!restored) return;
    const edit = restored.state as Edit;
    if (edit.kind === 'buffer') this.#applyBufferEdit(edit);
    else this.#applyForward(edit);
    this.#refreshHistoryFlags();
  }
```

> The redo path above is awkward because `History.redo` requires a "current" state. To keep it clean, instead of fighting the generic, store the redo "current" as the entry itself for structural kinds (they are self-inverting given direction). Implement the direction split with two appliers:

```ts
  /** Apply the UNDO direction of a structural edit. */
  #applyInverse(edit: Exclude<Edit, BufferEdit>): void {
    switch (edit.kind) {
      case 'add-clip':
        this.#removeClipFrom(edit.trackId, edit.clip.id);
        break;
      case 'remove-track':
        this.#insertTrackAt(edit.track, edit.index);
        break;
      case 'move-across': {
        const moved = this.#removeClipFrom(edit.toTrackId, edit.clipId);
        if (moved) this.#insertClip(edit.fromTrackId, { ...moved, start: edit.fromStart });
        break;
      }
    }
  }

  /** Apply the REDO direction of a structural edit. */
  #applyForward(edit: Exclude<Edit, BufferEdit>): void {
    switch (edit.kind) {
      case 'add-clip':
        this.#insertClip(edit.trackId, edit.clip);
        break;
      case 'remove-track':
        this.removeTrack(edit.track.id, { record: false });
        break;
      case 'move-across': {
        const moved = this.#removeClipFrom(edit.fromTrackId, edit.clipId);
        if (moved) {
          const dest = this.project.tracks.find((t) => t.id === edit.toTrackId);
          const start = dest ? clampClipStart({ ...dest, clips: [...dest.clips, moved] }, moved.id, edit.fromStart) : edit.fromStart;
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

  /** The live BufferEdit snapshot to stash when undoing a buffer edit (was #historyTargetClip). */
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
```

> **Simplify the redo() path:** because the structural-redo "current" stash is irrelevant (we recompute on apply), use `#history.redo(edit-or-probe, bytes)` only to MOVE the entry and return it; we then dispatch by kind. Keep the implementation but drop the fragile probe by giving structural redo the entry itself as the "current" (it round-trips harmlessly):

Replace `redo()` body with:

```ts
  redo(): void {
    // Peek the redo top via a temporary pop+repush is unavailable; History.redo needs a
    // "current". For buffer kinds we pass the live snapshot; we don't know the kind until we
    // pop, so pop with a buffer probe and correct course by kind.
    const probe = this.#liveBufferProbe();
    const restored = this.#history.redo(probe, probe ? bufferBytes(probe.buffer) : 0);
    if (!restored) return;
    const edit = restored.state as Edit;
    if (edit.kind === 'buffer') this.#applyBufferEdit(edit);
    else this.#applyForward(edit);
    this.#refreshHistoryFlags();
  }

  /** A live buffer snapshot to satisfy History.redo's "current" arg; the selected clip, else first. */
  #liveBufferProbe(): BufferEdit {
    const sel = this.selection;
    if (sel) {
      const f = this.#findClip(sel.trackId, sel.clipId);
      if (f) return { kind: 'buffer', trackId: sel.trackId, clipId: sel.clipId, buffer: f.clip.buffer, start: f.clip.start, trimStart: f.clip.trimStart ?? 0, trimEnd: f.clip.trimEnd ?? 0 };
    }
    for (const t of this.project.tracks) {
      const c = t.clips[0];
      if (c) return { kind: 'buffer', trackId: t.id, clipId: c.id, buffer: c.buffer, start: c.start, trimStart: c.trimStart ?? 0, trimEnd: c.trimEnd ?? 0 };
    }
    // No clips at all — a buffer-kind redo is impossible in this state; return a stub.
    return { kind: 'buffer', trackId: '', clipId: '', buffer: undefined as unknown as AudioBuffer };
  }
```

Remove the now-unused `#anyBufferTarget` reference from the first redo draft and the first `undo` draft's stale lines; keep only the final `undo`/`redo` shown. Delete the old `#historyTargetClip` method (replaced by `#bufferTarget` + `#liveBufferProbe`).

- [ ] **Step 6: Add the `record` option to `removeTrack` (used by structural redo and Task 10)**

Change `removeTrack` signature so the redo path can remove without re-recording:

```ts
  removeTrack(trackId: string, opts?: { record?: boolean }): void {
    const index = this.project.tracks.findIndex((t) => t.id === trackId);
    if (index < 0) return;
    const track = this.project.tracks[index]!;
    if (opts?.record !== false) {
      this.#history.push('Delete track', { kind: 'remove-track', track, index }, this.#editBytes({ kind: 'remove-track', track, index }));
    }
    this.project = { ...this.project, tracks: this.project.tracks.filter((t) => t.id !== trackId) };
    this.#transport.releaseTrack(trackId);
    if (this.lastTrackId === trackId) this.lastTrackId = null;
    this.#refreshHistoryFlags();
  }
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json`
Expected: no errors. Fix any leftover references to `ClipSnapshot` or `#restoreSnapshot`.

- [ ] **Step 8: Run existing app unit tests (history-backed behavior intact)**

Run: `pnpm --filter app test`
Expected: PASS (no behavior change for cut/copy/move/resize undo).

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/lib/studio.svelte.ts
git commit -m "refactor(app): structural undo history (buffer/add-clip/remove-track/move-across union)"
```

---

## Task 9: Studio — paste creates a new clip at the playhead

**Files:**
- Modify: `packages/app/src/lib/studio.svelte.ts`

- [ ] **Step 1: Rewrite `paste()`**

Replace the existing `paste()`:

```ts
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

    let placed: { trackId: string; clip: Clip };
    if (target) {
      const probe = { ...target, clips: [...target.clips, newClip] };
      const start = clampClipStart(probe, newClip.id, at);
      if (Math.abs(start - at) < 1e-6) {
        placed = { trackId: target.id, clip: { ...newClip, start } };
      } else {
        // Slot occupied → new track instead.
        const fresh = this.addTrack();
        placed = { trackId: fresh.id, clip: { ...newClip, start: at } };
      }
    } else {
      const fresh = this.addTrack();
      placed = { trackId: fresh.id, clip: { ...newClip, start: at } };
    }

    this.#insertClip(placed.trackId, placed.clip);
    this.#history.push(
      'Paste clip',
      { kind: 'add-clip', trackId: placed.trackId, clip: placed.clip },
      bufferBytes(placed.clip.buffer),
    );
    this.lastTrackId = placed.trackId;
    this.selectClip(placed.trackId, placed.clip.id);
    this.#refreshHistoryFlags();
  }
```

> NOTE: `addTrack()` already mutates `this.project`. Calling it before `#insertClip` is fine because `#insertClip` re-reads `this.project`. The `add-clip` history entry records the final placed clip (with its clamped/typed start) so undo removes exactly that clip.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/lib/studio.svelte.ts
git commit -m "feat(app): paste creates a new clip at the playhead (current track or new track)"
```

---

## Task 10: TrackRow — hover-revealed track delete button

**Files:**
- Modify: `packages/app/src/components/TrackRow.svelte`

- [ ] **Step 1: Make the header a hover group and add the delete button**

In `TrackRow.svelte`, the track header `<div>` (the `sticky left-0 ...` one) gets `group` added to its class list. Inside the header's top `flex items-center justify-between` row, after the M/S button group, add the delete button (it reveals on header hover):

```svelte
        <button
          class="grid h-6 w-6 place-items-center rounded text-xs font-semibold opacity-0 transition group-hover:opacity-100 bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-accent-2)]"
          title="Delete track"
          aria-label="Delete track"
          data-testid="delete-track"
          onclick={() => studio.removeTrack(track.id)}
        >
          ✕
        </button>
```

Add `group` to the header div's class string (e.g. `... bg-[var(--color-surface)] p-3 group`).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/TrackRow.svelte
git commit -m "feat(app): delete a track via a hover-revealed button in its header (undoable)"
```

---

## Task 11: Cross-track drag-move (App-owned hit-test + new-track-on-empty)

**Files:**
- Modify: `packages/app/src/lib/studio.svelte.ts`
- Modify: `packages/app/src/components/TrackRow.svelte`
- Modify: `packages/app/src/App.svelte`

- [ ] **Step 1: Add `moveClipToTrack` to the Studio**

```ts
  /**
   * Move a clip to another track at `desiredStart` (clamped no-overlap on the destination).
   * If `toTrackId === fromTrackId`, delegates to the in-track {@link moveClip}. Undoable as a
   * single `move-across` edit committed on drop (not coalesced).
   */
  moveClipToTrack(fromTrackId: string, clipId: string, toTrackId: string, desiredStart: number): void {
    if (toTrackId === fromTrackId) {
      this.moveClip(fromTrackId, clipId, desiredStart);
      this.endClipMove();
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
      { kind: 'move-across', clipId, fromTrackId, fromStart, toTrackId },
      0,
    );
    this.lastTrackId = toTrackId;
    this.selectClip(toTrackId, clipId);
    this.#refreshHistoryFlags();
  }
```

- [ ] **Step 2: Add a clip-drag-intent signal on the Studio**

So `App.svelte` knows a clip drag is in progress (set by TrackRow on drag start, read/cleared by App). Add state:

```ts
  /** Active clip drag (set by the lane on drag-move start; consumed by the timeline surface). */
  clipDrag = $state<{ fromTrackId: string; clipId: string; grabInClipPx: number } | null>(null);
```

- [ ] **Step 3: Have TrackRow publish the drag intent instead of moving directly cross-lane**

In `TrackRow.svelte` `onPointerMove`, where it currently calls `studio.moveClip(...)` for an already-selected clip drag, set the drag intent the first time and let App drive position. Replace the `pressWasSelected` move branch:

```ts
    if (pressWasSelected) {
      if (!studio.clipDrag) {
        studio.clipDrag = { fromTrackId: track.id, clipId: pressClipId, grabInClipPx: grabInClip };
      }
      // App's window listener positions the clip (it knows the row under the pointer).
      return;
    }
```

Remove the `lane.setPointerCapture` reliance for cross-lane drags is unnecessary — App listens on `window`. Keep capture for resize (Task 7) which stays within the lane.

> Because App now drives the move, the lane's own `onPointerUp` must NOT also commit. Guard it: if `studio.clipDrag` is set, skip the in-lane click/move-commit (App handles up). Add at the top of `onPointerUp`:

```ts
    if (studio.clipDrag) { pointerDown = false; dragging = false; pressClipId = null; return; }
```

- [ ] **Step 4: App.svelte — drive the cross-track drag on window pointer events**

Add a row hit-test reusing the existing drop pattern and window listeners that activate while `studio.clipDrag` is set. Add to the `<script>`:

```ts
  // Resolve the track under a clientY: an existing row id, 'new' for empty space below the
  // last row, or null if above the first row / outside. Reuses the drop hit-test pattern.
  function trackAtY(clientY: number): string | 'new' | null {
    const rows = scroller?.querySelectorAll<HTMLElement>('[data-track-id]') ?? [];
    let lastBottom = -Infinity;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return row.dataset.trackId ?? null;
      lastBottom = Math.max(lastBottom, r.bottom);
    }
    if (clientY > lastBottom && rows.length) return 'new';
    return null;
  }

  function laneTimeAt(clientX: number): number {
    if (!scroller) return 0;
    const rect = scroller.getBoundingClientRect();
    const laneX = clientX - rect.left - HEADER_W + scroller.scrollLeft;
    return Math.max(0, studio.pxToTime(laneX));
  }

  function onClipDragMove(e: PointerEvent): void {
    const drag = studio.clipDrag;
    if (!drag) return;
    const targetStart = laneTimeAt(e.clientX) - studio.pxToTime(drag.grabInClipPx);
    const over = trackAtY(e.clientY);
    // Live preview: keep the clip on its current track following the cursor x. Reparent only
    // commits on pointer-up (Step 5), so during the drag we just move within the source track.
    if (over && over !== 'new') {
      // moving over an existing track: still preview x on the SOURCE track to avoid churn.
    }
    studio.moveClip(drag.fromTrackId, drag.clipId, Math.max(0, targetStart));
  }

  function onClipDragUp(e: PointerEvent): void {
    const drag = studio.clipDrag;
    if (!drag) return;
    const targetStart = Math.max(0, laneTimeAt(e.clientX) - studio.pxToTime(drag.grabInClipPx));
    const over = trackAtY(e.clientY);
    if (over === 'new') {
      const fresh = studio.addTrack();
      studio.moveClipToTrack(drag.fromTrackId, drag.clipId, fresh.id, targetStart);
    } else if (over && over !== drag.fromTrackId) {
      studio.moveClipToTrack(drag.fromTrackId, drag.clipId, over, targetStart);
    } else {
      studio.endClipMove(); // same-track drag already applied via preview
    }
    studio.clipDrag = null;
  }
```

Wire the listeners with an effect so they're only attached during a drag:

```ts
  $effect(() => {
    if (!studio.clipDrag) return;
    window.addEventListener('pointermove', onClipDragMove);
    window.addEventListener('pointerup', onClipDragUp);
    return () => {
      window.removeEventListener('pointermove', onClipDragMove);
      window.removeEventListener('pointerup', onClipDragUp);
    };
  });
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/lib/studio.svelte.ts packages/app/src/components/TrackRow.svelte packages/app/src/App.svelte
git commit -m "feat(app): drag a clip to another track or into empty space to spawn a new track (undoable)"
```

---

## Task 12: E2E coverage

**Files:**
- Create: `packages/app/tests/clip-interaction.spec.ts`

Mirror the existing `multiclip.spec.ts` for setup (fixtures, helpers, how it loads files and reads `__studio`). Read it first to reuse its harness exactly.

- [ ] **Step 1: Read the existing E2E to copy its setup**

Run: `sed -n '1,60p' packages/app/tests/multiclip.spec.ts`
Expected: see the import/fixture/load helpers to reuse.

- [ ] **Step 2: Write the E2E spec**

Create `packages/app/tests/clip-interaction.spec.ts` reusing that harness. Cover:

```ts
// Pseudocode skeleton — adapt selectors/helpers to multiclip.spec.ts's actual harness.
import { test, expect } from '@playwright/test';
// ...reuse: loadFixture(page, file), addClip helper, readStudio() via window.__studio...

test('clicking a clip seeks the playhead into it and selects it', async ({ page }) => {
  // load a clip at start=0; click ~middle of its box; assert __studio.playhead ≈ clicked time
  // and __studio.selectedClip is set.
});

test('right-edge drag shortens the clip non-destructively; drag back restores it', async ({ page }) => {
  // grab [data-testid=resize-right], drag left; assert clip box narrower AND
  // __studio.project duration shrank; drag back out; assert width/duration restored and
  // buffer.duration unchanged (non-destructive).
});

test('drag a clip onto another track reparents it; undo returns it', async ({ page }) => {
  // two tracks; select clip on track 1; drag its box down onto track 2's row; assert the clip
  // now lives on track 2; Ctrl+Z; assert it is back on track 1 at its original start.
});

test('drag a clip into empty space creates a new track holding it', async ({ page }) => {
  // drag below the last row; assert tracks.length increased and the clip moved there.
});

test('copy a range then paste creates a new clip at the playhead; undo removes it', async ({ page }) => {
  // range-select on a clip; Ctrl+C; seek elsewhere; Ctrl+V; assert a new clip appears at the
  // playhead; Ctrl+Z; assert it is gone.
});

test('paste where the slot is occupied lands on a new track', async ({ page }) => {
  // fill the playhead slot on the target track; paste; assert tracks.length increased.
});

test('hover a track header and click ✕ removes the track; undo restores it at its index', async ({ page }) => {
  // hover header; click [data-testid=delete-track]; assert tracks.length decreased; Ctrl+Z;
  // assert the track returns at the same index.
});
```

- [ ] **Step 3: Run the E2E**

Run: `pnpm --filter app test:e2e -- clip-interaction`
Expected: PASS. (If fixtures aren't present, the suite should `test.skip` exactly as `multiclip.spec.ts` does when fixtures are missing — mirror that guard.)

- [ ] **Step 4: Run the whole app + engine suite once**

Run: `pnpm --filter @audiosandbox/engine test && pnpm --filter app test && pnpm --filter app test:e2e`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/tests/clip-interaction.spec.ts
git commit -m "test(app): E2E for cursor-seek, resize, cross-track move, paste-as-clip, track delete"
```

---

## Task 13: Final verification & branch wrap-up

- [ ] **Step 1: Full typecheck + build + tests**

Run:
```bash
pnpm --filter @audiosandbox/engine build && \
pnpm --filter @audiosandbox/engine test && \
pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json && \
pnpm --filter app test && \
pnpm --filter app test:e2e
```
Expected: all green.

- [ ] **Step 2: Manual smoke (per CLAUDE.md the transport is verified in-app)**

Run: `pnpm --filter app dev`, then with a fixture: click a clip (playhead jumps in, clip selected), drag each border (clip shortens, plays shorter), drag a clip to another track and into empty space (new track), copy/paste at the playhead, delete a track via the hover ✕, and Ctrl+Z each action. Confirm undo reverses every operation.

- [ ] **Step 3: Squash to one commit and land per CLAUDE.md (rebase + ff)**

```bash
git rebase -i main   # squash the task commits into one feat commit (NOTE: interactive rebase may be unavailable in some harnesses; if so, soft-reset to main and recommit as one)
git checkout main && git merge --ff-only <branch> && git branch -d <branch>
```

> Per CLAUDE.md the design doc was committed on its own branch (`docs/clip-interaction-overhaul`); fold or land it alongside per the user's preference. Do not push unless the user asks.

---

## Self-review notes (author)

- **Spec coverage:** cursor-on-click (Task 6) ✓; non-destructive resize (Tasks 1–4, 7) ✓; cross-track + new-track (Task 11) ✓; range-select preserved (untouched in TrackRow) ✓; paste-as-new-clip (Task 9) ✓; track delete hover (Task 10) ✓; structural undo (Task 8) ✓; trim-aware layout/transport (Tasks 1–4, 7) ✓; tests (Task 12) ✓. Deferred items (context menu, edit-button redesign, waveform LOD, ruler-at-zoom) are documented in the spec, intentionally not in this plan.
- **Type consistency:** `Edit` union names (`buffer`/`add-clip`/`remove-track`/`move-across`) used consistently in Tasks 8–11; `resizeClip` signature matches between engine (Task 3) and Studio caller (Task 7); `removeTrack(trackId, opts?)` matches its caller in Task 8/10/11; `clipDrag` field shape matches between TrackRow (Task 11 Step 3) and App (Step 4).
- **Known sharp edge:** Task 8's `redo()` must satisfy `History.redo`'s "current" arg even for structural kinds; the `#liveBufferProbe()` stub handles the no-clips case. The executor should keep the `redo()` body that uses `#liveBufferProbe()` and delete the earlier draft fragments shown for context.
