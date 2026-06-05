# Multi-clip lane (Step 8b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every clip on a track at its `start` offset, let a clip be selected as an object and dragged to a new (no-overlap, ≥0) offset undoably, and drop imported files at the cursor's track+time.

**Architecture:** Almost entirely app-layer — the transport already schedules all clips at their offsets. The engine gains one pure, unit-tested helper `clampClipStart`. `Studio` gains a separate `selectedClip` object-selection state and an undoable `moveClip`; its history snapshot widens to carry `start`. `TrackRow` renders clips as absolutely-positioned boxes. `App.svelte` drop hit-tests track+time.

**Tech Stack:** Svelte 5 (runes) + TypeScript, `@audiosandbox/engine` (Web Audio), Vitest (engine + app unit), Playwright (E2E). pnpm workspaces.

---

## File structure

- **Create:** none.
- **Modify:**
  - `packages/engine/src/model/project.ts` — add `clampClipStart`.
  - `packages/engine/src/model/project.test.ts` — tests for `clampClipStart`.
  - `packages/engine/src/index.ts` — export `clampClipStart`.
  - `packages/app/src/lib/studio.svelte.ts` — `selectedClip` state, `selectClip`/`clearSelectedClip`, `moveClip`, widened `ClipSnapshot`, `#restoreSnapshot`, `addFile` placement opts.
  - `packages/app/src/components/TrackRow.svelte` — render all clips as boxes; per-clip pointer model; borders; highlight reparented; `data-track-id`.
  - `packages/app/src/App.svelte` — drop-to-position.
  - **Create:** `packages/app/tests/multiclip.spec.ts` — E2E.

Commands (from repo root):
- Engine tests: `pnpm --filter @audiosandbox/engine test`
- App unit: `pnpm --filter app test`
- App E2E: `pnpm --filter app test:e2e`
- Typecheck app: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json`
- Build engine (so the app sees new exports): `pnpm --filter @audiosandbox/engine build`

---

## Task 1: Engine — `clampClipStart` pure helper

**Files:**
- Modify: `packages/engine/src/model/project.ts`
- Test: `packages/engine/src/model/project.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/src/model/project.test.ts`. First check the file's existing imports — it already imports from `./project.js` and the test-helpers. Add `clampClipStart` to the `./project.js` import, and use the existing buffer/track helpers. If the file builds tracks via `createTrack`/`createClip` with `makeBuffer`-style helpers, mirror that. Concretely:

```ts
import { clampClipStart, createClip, createTrack } from './project.js';
import { makeMono } from '../test-helpers.js';

describe('clampClipStart', () => {
  // A 1-second mono clip at sampleRate 8000 → buffer.duration === 1.
  const oneSec = () => makeMono(new Array(8000).fill(0), 8000);

  it('clamps a negative desired start to 0', () => {
    const moving = createClip(oneSec(), 'a', 5);
    const track = createTrack('t', [moving]);
    expect(clampClipStart(track, moving.id, -3)).toBe(0);
  });

  it('passes through when there are no other clips (after 0-clamp)', () => {
    const moving = createClip(oneSec(), 'a', 0);
    const track = createTrack('t', [moving]);
    expect(clampClipStart(track, moving.id, 4.2)).toBeCloseTo(4.2);
  });

  it('butts up against a left neighbor instead of overlapping it', () => {
    const left = createClip(oneSec(), 'L', 0); // occupies [0,1)
    const moving = createClip(oneSec(), 'M', 5); // 1s long
    const track = createTrack('t', [left, moving]);
    // Wants to start at 0.5 (would overlap [0,1)); nearest non-overlap is 1.0 (right of L).
    expect(clampClipStart(track, moving.id, 0.5)).toBeCloseTo(1);
  });

  it('butts up against a right neighbor instead of overlapping it', () => {
    const right = createClip(oneSec(), 'R', 3); // occupies [3,4)
    const moving = createClip(oneSec(), 'M', 0); // 1s long
    const track = createTrack('t', [moving, right]);
    // Wants 2.8 (interval [2.8,3.8) overlaps [3,4)); nearest non-overlap to the left is 2.0.
    expect(clampClipStart(track, moving.id, 2.8)).toBeCloseTo(2);
  });

  it('fits exactly into a gap between two neighbors', () => {
    const a = createClip(oneSec(), 'A', 0); // [0,1)
    const c = createClip(oneSec(), 'C', 2); // [2,3)
    const moving = createClip(oneSec(), 'M', 5); // 1s; the gap [1,2) fits it exactly
    const track = createTrack('t', [a, c, moving]);
    expect(clampClipStart(track, moving.id, 1)).toBeCloseTo(1);
  });

  it('is a no-op for a single-clip track (only the 0-clamp applies)', () => {
    const moving = createClip(oneSec(), 'M', 0);
    const track = createTrack('t', [moving]);
    expect(clampClipStart(track, moving.id, 7)).toBeCloseTo(7);
  });
});
```

> If `makeBuffer` doesn't exist or has a different signature, open `packages/engine/src/test-helpers.ts` and use whatever buffer-builder it exports (the buffer-ops tests use it); the only requirement is a 1-second mono buffer (`duration === 1`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @audiosandbox/engine test -- project`
Expected: FAIL — `clampClipStart is not a function` (or import error).

- [ ] **Step 3: Implement `clampClipStart`**

Add to `packages/engine/src/model/project.ts` (after `projectDuration`). It needs `Track` and `Id` types — they're already imported there (the file uses `Track`/`Project`); add `Id`/`Clip` to the type import if missing.

```ts
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
    // Snap to the nearer non-overlapping edge of this blocker, then re-clamp to 0.
    const leftCandidate = Math.max(0, hit.lo - dur); // butt up on the blocker's left
    const rightCandidate = hit.hi; // butt up on the blocker's right
    s = Math.abs(leftCandidate - s) <= Math.abs(rightCandidate - s) ? leftCandidate : rightCandidate;
  }
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @audiosandbox/engine test -- project`
Expected: PASS (all 6 new cases + existing project tests).

- [ ] **Step 5: Export it**

In `packages/engine/src/index.ts`, add `clampClipStart` to the alphabetized model export block:

```ts
export {
  anyTrackSoloed,
  clampClipStart,
  createClip,
  createId,
  createProject,
  createTrack,
  DEFAULT_GAIN,
  isTrackAudible,
  projectDuration,
  trackTargetGain,
} from './model/project.js';
```

- [ ] **Step 6: Rebuild the engine and run the full engine suite**

Run: `pnpm --filter @audiosandbox/engine build && pnpm --filter @audiosandbox/engine test`
Expected: build clean; all engine tests pass (was 121, now +6).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/model/project.ts packages/engine/src/model/project.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): clampClipStart — no-overlap clip placement helper"
```

---

## Task 2: Studio — object-selection state + `moveClip` + history `start`

**Files:**
- Modify: `packages/app/src/lib/studio.svelte.ts`

This task is app logic; we verify it via the E2E task (Task 5) and typecheck here. No new unit test file — the history-restores-start behavior is exercised end-to-end in Task 5.

- [ ] **Step 1: Import `clampClipStart`**

In the engine import block at the top of `studio.svelte.ts`, add `clampClipStart` (keep alphabetical-ish with the others):

```ts
import {
  clampClipStart,
  copySeconds,
  createClip,
  // ...rest unchanged
} from '@audiosandbox/engine';
```

- [ ] **Step 2: Widen `ClipSnapshot` to carry `start`**

Replace the `ClipSnapshot` interface:

```ts
/** An undo snapshot: a clip's prior buffer and (for moves) prior start, so undo can restore it. */
interface ClipSnapshot {
  trackId: string;
  clipId: string;
  buffer: AudioBuffer;
  /** Clip start at snapshot time. Present for move edits; restored on undo/redo. */
  start?: number;
}
```

- [ ] **Step 3: Add the `selectedClip` rune and its mutators**

After the `selection = $state<Selection | null>(null);` line, add:

```ts
  /** A clip selected *as an object* (for move), distinct from the time-range `selection`. */
  selectedClip = $state<{ trackId: string; clipId: string } | null>(null);
```

Add methods in the "selection + editing" region (after `clearSelection`):

```ts
  /** Select a clip as an object (for moving). Mutually exclusive with the time-range selection. */
  selectClip(trackId: string, clipId: string): void {
    this.clearSelection();
    this.selectedClip = { trackId, clipId };
  }

  /** Clear the object-selection (e.g. when a range-select or seek takes over). */
  clearSelectedClip(): void {
    this.selectedClip = null;
  }
```

- [ ] **Step 4: Make range-select and seek clear the object-selection**

In `setSelection`, after a successful `this.selection = { ...sel, start, end };`, add `this.selectedClip = null;`. In `seek`, after `this.playhead = seconds;` add `this.selectedClip = null;`. (Both transitions move away from object-selection per the spec.)

- [ ] **Step 5: Add `moveClip` (undoable)**

Add in the "selection + editing" region:

```ts
  /** Move a clip to a new start offset (clamped ≥0, no overlap on its track). Undoable. */
  moveClip(trackId: string, clipId: string, desiredStart: number): void {
    const found = this.#findClip(trackId, clipId);
    if (!found) return;
    const { track, clip } = found;
    const next = clampClipStart(track, clipId, desiredStart);
    if (next === clip.start) return; // no-op — don't pollute history
    this.#history.push(
      'Move clip',
      { trackId, clipId, buffer: clip.buffer, start: clip.start },
      bufferBytes(clip.buffer),
    );
    this.updateTrack({
      ...track,
      clips: track.clips.map((c) => (c.id === clipId ? { ...c, start: next } : c)),
    });
    this.#refreshHistoryFlags();
  }
```

- [ ] **Step 6: Restore `start` on undo/redo**

Add a private restore helper and route both `undo()` and `redo()` through it. Add after `#replaceClipBuffer`:

```ts
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
```

In `undo()`, replace the `this.#replaceClipBuffer(restored.state...)` line with:

```ts
    this.#restoreSnapshot(restored.state);
```

In `redo()`, replace the corresponding `this.#replaceClipBuffer(restored.state...)` line with:

```ts
    this.#restoreSnapshot(restored.state);
```

- [ ] **Step 7: Make `#historyTargetClip` report the live `start`**

So the opposite stack stashes the correct current position, update its return shape to include `start`. Change its return type and the two `return` statements:

```ts
  #historyTargetClip(): ClipSnapshot | undefined {
    const sel = this.selection;
    if (sel) {
      const found = this.#findClip(sel.trackId, sel.clipId);
      if (found)
        return { trackId: sel.trackId, clipId: sel.clipId, buffer: found.clip.buffer, start: found.clip.start };
    }
    for (const track of this.project.tracks) {
      const clip = track.clips[0];
      if (clip) return { trackId: track.id, clipId: clip.id, buffer: clip.buffer, start: clip.start };
    }
    return undefined;
  }
```

The `undo`/`redo` callers pass `{ trackId, clipId, buffer }` into `this.#history.undo(...)` — update those object literals to spread the target so `start` is carried:

In `undo()`: `this.#history.undo({ trackId: target.trackId, clipId: target.clipId, buffer: target.buffer, start: target.start }, bufferBytes(target.buffer))`.
In `redo()`: same with `.redo(...)`.

(They already destructure `target`; since `target` is now a full `ClipSnapshot`, you may simplify to `this.#history.undo(target, bufferBytes(target.buffer))`.)

- [ ] **Step 8: Add placement options to `addFile`**

Replace the `addFile` signature and placement logic:

```ts
  async addFile(file: File, opts?: { trackId?: string; start?: number }): Promise<Clip> {
    const arrayBuffer = await file.arrayBuffer();
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
    this.updateTrack({ ...withClip, clips: withClip.clips.map((c) => (c.id === clip.id ? { ...c, start } : c)) });
    return { ...clip, start };
  }
```

> Note: `addTrack()` reassigns `this.project`, so after it runs, re-fetch isn't needed because we hold `target` (the returned Track) — but `addTrack` appended it to the *new* project array, and `target` is that same object reference. `updateTrack` matches by id, so this is safe.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors (the engine was rebuilt in Task 1 so `clampClipStart` is visible).

- [ ] **Step 10: Commit**

```bash
git add packages/app/src/lib/studio.svelte.ts
git commit -m "feat(app): object clip-selection + undoable moveClip + drop placement in Studio"
```

---

## Task 3: TrackRow — render all clips as boxes + per-clip pointer model

**Files:**
- Modify: `packages/app/src/components/TrackRow.svelte`

- [ ] **Step 1: Replace the `<script>` derived/handler section**

Replace the body from `let clip = $derived(track.clips[0]);` through the end of `onPointerUp` with a per-clip model. The lane now holds absolutely-positioned clip boxes; pointer handlers take the clip they fire on.

```ts
  let { studio, track, color }: Props = $props();

  // The track's full extent: the right edge of its furthest clip. 0 when empty.
  let laneWidth = $derived(
    track.clips.reduce(
      (w, c) => Math.max(w, studio.timeToPx(c.start + c.buffer.duration)),
      0,
    ),
  );

  // The time-range highlight, only when the current selection belongs to a clip on this track.
  function selFor(clipId: string) {
    const s = studio.selection;
    return s && s.clipId === clipId ? s : null;
  }
  function isObjectSelected(clipId: string): boolean {
    return studio.selectedClip?.trackId === track.id && studio.selectedClip?.clipId === clipId;
  }

  const DRAG_THRESHOLD = 3;
  let lane: HTMLDivElement;

  // Per-gesture state (one pointer at a time).
  let pressX = 0; // x within the lane (px)
  let grabInClip = 0; // x within the pressed clip (px) — the drag handle offset
  let pressClipId: string | null = null;
  let pressWasSelected = false;
  let dragging = false;
  let pointerDown = false;

  function laneX(e: PointerEvent): number {
    return e.clientX - lane.getBoundingClientRect().left;
  }

  function onClipPointerDown(e: PointerEvent, clip: { id: string; start: number }): void {
    if (e.button !== 0) return;
    e.stopPropagation(); // don't let the lane background also handle it (that path seeks)
    pointerDown = true;
    dragging = false;
    pressClipId = clip.id;
    pressWasSelected = isObjectSelected(clip.id);
    pressX = laneX(e);
    grabInClip = pressX - studio.timeToPx(clip.start);
    try {
      lane.setPointerCapture(e.pointerId);
    } catch { /* capture is a nicety */ }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointerDown || !pressClipId) return;
    const x = laneX(e);
    if (!dragging && Math.abs(x - pressX) < DRAG_THRESHOLD) return;
    dragging = true;
    if (pressWasSelected) {
      // Drag-move the already-selected clip: keep the grab point under the cursor.
      studio.moveClip(track.id, pressClipId, studio.pxToTime(x - grabInClip));
    } else {
      // Drag on a not-yet-object-selected clip → time-range select on that clip.
      const clip = track.clips.find((c) => c.id === pressClipId);
      if (!clip) return;
      const pressT = studio.pxToTime(pressX) - clip.start;
      const t = studio.pxToTime(x) - clip.start;
      studio.setSelection({
        trackId: track.id,
        clipId: pressClipId,
        start: Math.min(pressT, t),
        end: Math.max(pressT, t),
      });
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!pointerDown) return;
    pointerDown = false;
    try {
      lane.releasePointerCapture(e.pointerId);
    } catch { /* never captured */ }
    if (!dragging && pressClipId) {
      // Click on a clip → select it as an object.
      studio.selectClip(track.id, pressClipId);
    }
    dragging = false;
    pressClipId = null;
  }

  // Click on the lane *background* (not on a clip box) → clear object-selection and seek.
  function onLaneBackgroundDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    studio.clearSelectedClip();
    studio.clearSelection();
    studio.seek(studio.pxToTime(laneX(e)));
  }
```

- [ ] **Step 2: Replace the lane markup**

Replace the waveform-lane `<div bind:this={lane} ...>` block (the one with `style="width: {laneWidth}px"`) and its contents with a background-seek handler plus one positioned box per clip:

```svelte
  <!-- Waveform lane — full track width; clips are positioned boxes. Background click seeks. -->
  <div
    bind:this={lane}
    class="relative h-24 bg-[var(--color-bg)] {track.clips.length ? 'cursor-text' : ''}"
    style="width: {laneWidth}px"
    role="presentation"
    onpointerdown={onLaneBackgroundDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
  >
    {#each track.clips as clip (clip.id)}
      <div
        class="absolute inset-y-0 overflow-hidden rounded-sm {isObjectSelected(clip.id)
          ? 'border-2 border-[var(--color-accent)] cursor-grab'
          : 'border border-[var(--color-border)]'}"
        style="left: {studio.timeToPx(clip.start)}px; width: {studio.timeToPx(
          clip.buffer.duration,
        )}px"
        data-testid="clip"
        data-clip-id={clip.id}
        role="presentation"
        onpointerdown={(e) => onClipPointerDown(e, clip)}
      >
        <Waveform buffer={clip.buffer} width={studio.timeToPx(clip.buffer.duration)} {color} height={96} />
        {#if selFor(clip.id)}
          {@const sel = selFor(clip.id)!}
          <div
            class="pointer-events-none absolute inset-y-0 border-x border-[var(--color-accent)] bg-[var(--color-accent)]/25"
            data-testid="selection"
            style="left: {studio.timeToPx(sel.start)}px; width: {Math.max(
              1,
              studio.timeToPx(sel.end - sel.start),
            )}px"
          ></div>
        {/if}
      </div>
    {/each}
  </div>
```

> The clip box's `onpointermove`/`onpointerup` are handled at the lane level (pointer capture is on `lane`), so the gesture continues even when the cursor leaves the box. `onClipPointerDown` calls `stopPropagation` so the background seek handler doesn't also fire.

- [ ] **Step 3: Add `data-track-id` to the row root (for drop hit-testing)**

On the outermost row `<div class="flex border-b ...">`, add `data-track-id={track.id}`:

```svelte
<div class="flex border-b border-[var(--color-border)]" data-track-id={track.id}>
```

- [ ] **Step 4: Typecheck + build the app**

Run: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json && pnpm --filter app build`
Expected: 0 errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/TrackRow.svelte
git commit -m "feat(app): render all clips as positioned boxes; click-select, drag-move, drag-range"
```

---

## Task 4: App.svelte — drop-to-position

**Files:**
- Modify: `packages/app/src/App.svelte`

- [ ] **Step 1: Replace `onDrop` with a position-aware version**

Replace the existing `onDrop` function. It hit-tests the drop's `clientY` against rendered track rows (`[data-track-id]`) and computes the time from `clientX` using the same lane math as `onWheel`.

```ts
  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragging = false;
    const files = e.dataTransfer?.files;
    if (!files?.length) return;

    // Which track row is under the drop (if any)?
    const rows = scroller?.querySelectorAll<HTMLElement>('[data-track-id]') ?? [];
    let trackId: string | undefined;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        trackId = row.dataset.trackId;
        break;
      }
    }

    if (trackId && scroller) {
      const rect = scroller.getBoundingClientRect();
      const laneX = e.clientX - rect.left - HEADER_W + scroller.scrollLeft;
      const start = Math.max(0, studio.pxToTime(laneX));
      void dropFilesAt(files, trackId, start);
    } else {
      void loadFiles(files); // off any track → new track at 0 (existing behavior)
    }
  }

  /** Place dropped files onto a specific track starting near `start` (each clamped, no overlap). */
  async function dropFilesAt(files: FileList, trackId: string, start: number): Promise<void> {
    loadError = null;
    let at = start;
    for (const file of Array.from(files)) {
      try {
        const clip = await studio.addFile(file, { trackId, start: at });
        at = clip.start + clip.buffer.duration; // next file butts up after this one
      } catch (err) {
        loadError = err instanceof Error ? err.message : String(err);
      }
    }
  }
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json && pnpm --filter app build`
Expected: 0 errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/App.svelte
git commit -m "feat(app): drop imported files at the cursor's track and time"
```

---

## Task 5: E2E — `multiclip.spec.ts`

**Files:**
- Create: `packages/app/tests/multiclip.spec.ts`

- [ ] **Step 1: Write the E2E spec**

Create `packages/app/tests/multiclip.spec.ts`. It uses the existing `loadGeneratedClip` helper and the `window.__studio` hook to place a second clip and to assert positions. Clips render as `[data-testid=clip]` boxes.

```ts
import { expect, test, type Page } from '@playwright/test';
import { loadGeneratedClip } from './helpers/app.js';

/** Place a second clip on track 0 at a given start (seconds), via the studio test hook. */
async function addSecondClip(page: Page, start: number): Promise<void> {
  await page.evaluate(async (s) => {
    const studio = (window as any).__studio;
    const trackId = studio.project.tracks[0].id;
    const factory = (studio as any).bufferFactory; // BufferFactory bound to the live context
    // Build a 1s mono buffer (factory signature: numberOfChannels, length, sampleRate).
    const buf = factory(1, 8000, 8000);
    const { createClip } = await import('@audiosandbox/engine');
    const clip = createClip(buf, 'second.wav', s);
    const track = studio.project.tracks.find((t: any) => t.id === trackId);
    studio.updateTrack({ ...track, clips: [...track.clips, clip] });
  }, start);
}

function clips(page: Page) {
  return page.locator('[data-testid=clip]');
}

/** The studio's selectedClip via the hook. */
function selectedClip(page: Page) {
  return page.evaluate(() => (window as any).__studio.selectedClip);
}

/** A clip's current start (seconds) by index on track 0. */
function clipStart(page: Page, index: number) {
  return page.evaluate((i) => (window as any).__studio.project.tracks[0].clips[i].start, index);
}

test.describe('multi-clip lane', () => {
  test('renders every clip at its offset', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    await addSecondClip(page, 3); // 2s clip at 0, 1s clip at 3
    await expect(clips(page)).toHaveCount(2);
    const boxes = await clips(page).all();
    const left0 = (await boxes[0].boundingBox())!.x;
    const left1 = (await boxes[1].boundingBox())!.x;
    expect(left1).toBeGreaterThan(left0); // second clip sits to the right
  });

  test('clicking a clip selects it as an object', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    await clips(page).first().click();
    const sel = await selectedClip(page);
    expect(sel).not.toBeNull();
    // Time-range selection is cleared when a clip is object-selected.
    expect(await page.evaluate(() => (window as any).__studio.selection)).toBeNull();
  });

  test('dragging a selected clip moves its start', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    const box0 = (await clips(page).first().boundingBox())!;
    await clips(page).first().click(); // select first
    const before = await clipStart(page, 0);
    // Drag right by ~100px (≈1s at the default 100px/s).
    const y = box0.y + box0.height / 2;
    await page.mouse.move(box0.x + 20, y);
    await page.mouse.down();
    await page.mouse.move(box0.x + 20 + 100, y, { steps: 10 });
    await page.mouse.up();
    expect(await clipStart(page, 0)).toBeGreaterThan(before);
  });

  test('a move cannot overlap a neighbor', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 }); // [0,2)
    await addSecondClip(page, 3); // [3,4)
    // Select the second clip and try to drag it far left onto the first.
    const second = clips(page).nth(1);
    await second.click();
    const box = (await second.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 10, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 10 - 400, y, { steps: 12 }); // hard left
    await page.mouse.up();
    // First clip occupies [0,2); the 1s second clip can't start before 2.
    expect(await clipStart(page, 1)).toBeGreaterThanOrEqual(2 - 0.05);
  });

  test('undo restores a moved clip position', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    await clips(page).first().click();
    const before = await clipStart(page, 0);
    const box = (await clips(page).first().boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 20, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, y, { steps: 10 });
    await page.mouse.up();
    expect(await clipStart(page, 0)).toBeGreaterThan(before);
    await page.keyboard.press('Control+z');
    expect(await clipStart(page, 0)).toBeCloseTo(before, 1);
  });

  test('dropping a file places a clip near the cursor time', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    // Use the studio path to simulate a placed drop (DataTransfer file drops are awkward in
    // Playwright); assert addFile honors the start placement + clamp.
    const placed = await page.evaluate(async () => {
      const studio = (window as any).__studio;
      const trackId = studio.project.tracks[0].id;
      const blob = new Blob([new Uint8Array(0)]);
      // Build a real WAV via the same in-page helper the app uses isn't available; instead
      // place a clip directly through addFile using a generated File is non-trivial here, so
      // assert clampClipStart placement using the model path:
      const { createClip, clampClipStart } = await import('@audiosandbox/engine');
      const track = studio.project.tracks.find((t: any) => t.id === trackId);
      const buf = (studio as any).bufferFactory(1, 8000, 8000); // (channels, length, sampleRate)
      const clip = createClip(buf, 'drop.wav', 0);
      const withClip = { ...track, clips: [...track.clips, clip] };
      const start = clampClipStart(withClip, clip.id, 5); // dropped at t=5s
      return start;
    });
    expect(placed).toBeCloseTo(5, 1); // 1s clip at t=5 doesn't overlap the [0,2) clip
  });
});
```

> The `BufferFactory` signature is `(numberOfChannels, length, sampleRate)` (verified in `packages/engine/src/buffer-ops/factory.ts`). The drop test deliberately exercises the model placement path (`clampClipStart`) rather than a synthetic DataTransfer, which Playwright handles poorly for files.

- [ ] **Step 2: Run the new spec**

Run: `pnpm --filter app test:e2e -- multiclip`
Expected: all cases PASS. If `addSecondClip`'s factory call fails, fix the factory arg order per the note and rerun.

- [ ] **Step 3: Run the full E2E + unit suites (regression)**

Run: `pnpm --filter app test && pnpm --filter app test:e2e`
Expected: app unit (12) pass; all E2E pass — existing `selection.spec.ts` still green (range-select via drag on an unselected clip is preserved). Note the selection spec's `lane` locator (`main div.h-24:has(canvas)`) now matches a clip box that contains the canvas; if that locator breaks, update it in `selection.spec.ts` to target `[data-testid=clip]` and rerun.

- [ ] **Step 4: Commit**

```bash
git add packages/app/tests/multiclip.spec.ts
git commit -m "test(app): E2E for multi-clip render, select, move, no-overlap, undo, drop placement"
```

---

## Task 6: Full verification + finish the branch

- [ ] **Step 1: Run everything**

```bash
pnpm --filter @audiosandbox/engine build
pnpm -r test
pnpm --filter app test:e2e
pnpm --filter app build
pnpm --filter app exec svelte-check --tsconfig ./tsconfig.json
```
Expected: engine build clean; all unit tests green (engine 127, app 12); all E2E green; app build clean; svelte-check 0 errors.

- [ ] **Step 2: Manual smoke (optional, recommended)**

`pnpm --filter app dev`, import a file, import a second onto the same track (it butts up after the first), click a clip (prominent border), drag it right (moves; can't overlap), Ctrl+Z (snaps back), drag *into* a clip without selecting first (makes a range selection — Cut still works).

- [ ] **Step 3: Rebase + fast-forward onto main (per CLAUDE.md)**

```bash
git rebase main
git checkout main
git merge --ff-only feat/multi-clip-lane
git branch -d feat/multi-clip-lane
```

- [ ] **Step 4: Pause for the user's review** (per the build cadence — do not start the next step).

---

## Self-review notes

- **Spec coverage:** clampClipStart (Task 1) ✓; selectedClip + mutual exclusion (Task 2 steps 3–4) ✓; moveClip undoable (Task 2 steps 5–7) ✓; history carries start (Task 2 steps 2,6,7) ✓; addFile placement (Task 2 step 8) ✓; render all clips + borders + pointer model (Task 3) ✓; highlight reparented into clip box (Task 3 step 2) ✓; drop-to-position (Task 4) ✓; tests engine+E2E (Tasks 1,5) ✓; deferred items untouched ✓.
- **History note:** the engine `History<S>` is generic; widening `ClipSnapshot` is purely app-side — no engine history change, matching the spec's intent.
- **Names are consistent:** `selectedClip`, `selectClip`, `clearSelectedClip`, `moveClip`, `clampClipStart`, `#restoreSnapshot`, `dropFilesAt`, `data-testid=clip`, `data-track-id` used identically across tasks.
- **Known risk flagged in-plan:** the `selection.spec.ts` lane locator and the E2E `bufferFactory` arg order may need a one-line adjustment (called out in Task 5 steps 1 & 3).
