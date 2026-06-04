# Timeline: real track widths, zoom, scroll, and stop-at-end

**Date:** 2026-06-04
**Status:** Approved design — pre-implementation
**Scope:** Pre–Step 8 fixes and additions to the app's timeline. Engine changes are minimal.

## Context

Today every track's waveform is **stretched to fill the viewport width** via Tailwind
`flex-1` + `w-full`, regardless of the audio's actual duration. A 1-second clip and a
30-second clip render at the same on-screen width, so length is not readable and tracks
of different durations look identical. Playback also runs forever — it never stops when
the audio ends. And the empty-state hint ("Drop audio here") is repeated per empty track
rather than shown once for a fresh project.

The fix is to introduce a single missing abstraction the app has never had: a
**pixels-per-second** scale. Once horizontal position means *time*, real widths, zoom,
horizontal scroll, a tick ruler, and consistent playhead/seek math all follow from it.

This is a pure **app/view** concern. Per the engine/app boundary, `pxPerSec`/`zoom` live
in the app (`Studio`), never in `@audiosandbox/engine` — the engine has no notion of
pixels. The only engine touch is emitting the already-defined `ended` event.

## Decisions (from brainstorming)

- **At end of playback:** stop and reset the playhead to 0 (same as the Stop button).
- **Zoom control:** toolbar `+` / `−` / `Fit` buttons **and** Ctrl/Cmd + mouse-wheel.
- **Default zoom:** a **fixed 100 px/s** (not fit-to-window). Short clips look short; long
  clips overflow and scroll. Consistent scale across projects.
- **Ruler ticks:** yes — labeled second-markers, density adapting to zoom.
- **Zoom anchor:** anchor at the cursor — the second under the pointer stays fixed.
- **Track-body click-to-seek:** **deferred to Step 8.** Step 8 makes the track body a
  drag-to-select surface; seek-on-click will be designed there alongside selection. For
  now, seeking stays on the timeline ruler only.

## The core abstraction: a time→pixel scale

Add reactive view state to `Studio` (`packages/app/src/lib/studio.svelte.ts`):

- `basePxPerSec = 100` (constant).
- `zoom = $state(1)` — multiplier.
- `pxPerSec` (derived) `= basePxPerSec * zoom`.
- Helpers: `timeToPx(sec) = sec * pxPerSec` and `pxToTime(px) = px / pxPerSec`.
- Zoom bounds: clamp `zoom` to roughly `[0.05, 50]` (≈5–5000 px/s) so projects stay
  navigable at both extremes. A `setZoom(next, anchorSec?)` method clamps and (when an
  anchor is supplied) is paired with a scroll adjustment in the view.

`pxPerSec` is the only new shared number. Track widths, the ruler, the playhead overlay,
and seek math all read from it.

## Layout model

Introduce one **shared inner content width** so every row, the ruler, and the playhead
live in the same coordinate space:

```
contentWidth = projectDuration(project) * pxPerSec   // px, may exceed viewport
```

`projectDuration` already exists in `packages/engine/src/model/project.ts` and is already
imported in `App.svelte`. Reuse it; do not recompute.

Structure inside the existing `<main class="… overflow-auto">` (which already provides
scrolling):

- A left **track-header column** (the current `w-44` headers) made **sticky-left**
  (`sticky left-0 z-…`) so names/mute/solo/gain stay visible while the lane scrolls
  horizontally.
- A right **lane area** whose inner content is `contentWidth` px wide. When
  `contentWidth` exceeds the viewport, the existing `overflow-auto` yields horizontal
  scrolling for free.

### Per-track width (`TrackRow.svelte` / `Waveform.svelte`)

- The waveform lane width becomes explicit: `clip.buffer.duration * pxPerSec` px, **not**
  `flex-1` / `w-full`.
- `Waveform.svelte` currently derives its bin count from a `ResizeObserver` on a
  `w-full` host. Change it to take an explicit **`width` prop** (in CSS px) computed from
  duration × pxPerSec, set the host to that width, and pass that width as the bin count to
  the existing `extractPeaks(buffer, width)` (no engine change — `extractPeaks` already
  takes a bin count). Keep the DPR/Retina handling as-is. The `ResizeObserver` is no
  longer needed for width (width is now driven by props) but may remain only if a
  fallback is wanted; prefer removing it to avoid two sources of truth.
- Empty tracks (no clip) render a lane of width 0 (or a small placeholder) — see
  Empty-state below — not a stretched "Drop audio here" strip.

## Playhead and seek math (percentage → pixels)

Today the playhead overlay and ruler seek use **fraction-of-width** math
(`studio.playhead / duration`, `(clientX - left) / rect.width`). With a fixed scale and
scrolling, switch both to **pixel** math:

- **Playhead overlay** (`App.svelte`): position `left = HEADER_W + timeToPx(playhead)` px
  within the scrolling content (so it scrolls with the lanes). It no longer needs
  `duration` for positioning.
- **Ruler seek** (`App.svelte` `onRulerSeek`): compute seconds from the click's offset
  within the ruler content: `seconds = pxToTime(offsetX)` (using the ruler element's
  scroll-aware offset), then `studio.seek(clamped)`. The existing clamp via
  `clampSeek` in the engine still applies inside `Transport.seek`.

## Stop at end of playback

The `ended` event is already declared in `TransportEvents`
(`packages/engine/src/transport/transport.ts`) but never emitted. Wire it up:

- **Detection (app side, minimal):** the `Studio` RAF playhead loop already reads
  `this.#transport.position` every frame (`#startPlayheadLoop`). When `position >=
  projectDuration(project)` while playing, call `this.stop()` (which stops sources and
  resets playhead to 0, per the decision). This requires **no engine change** and reuses
  the existing loop and `projectDuration`.
- Guard against duration 0 (nothing loaded) and against firing repeatedly: stop once, then
  the loop ends because state leaves `playing`.
- The engine's `ended` event can be left for a later, fully engine-side scheduler; this
  round we satisfy the requirement app-side to keep the change small. (If preferred during
  implementation, emit `ended` from the transport when the derived position passes
  duration and have the studio listen — but the RAF approach is the lighter touch and is
  the recommended path.)

## Empty state

- **Global empty state** (`App.svelte`) already shows "Drop an audio file here…" only when
  `project.tracks.length === 0`. Keep it; this is the correct "newly opened app" message.
- **Remove the per-track stretched hint:** in `TrackRow.svelte`, the `{:else}` branch
  rendering "Drop audio here" across the lane should go away (or become a minimal,
  zero-/small-width placeholder). An empty track added via "+ Track" should not display a
  full-width drop prompt; the global message owns the empty-project state.

## Zoom interaction

- **Toolbar buttons** (header in `App.svelte`, near "+ Track"/"Import audio"): `−`, a
  zoom readout (optional, e.g. `100%` or `100 px/s`), `+`, and **Fit**. `+`/`−` multiply
  `zoom` by a step (e.g. ×1.25 / ÷1.25), clamped. **Fit** sets `zoom` so
  `contentWidth ≈ viewport lane width` (compute from the lane's clientWidth and
  `projectDuration`); this is the one place fit-to-window is used, on demand.
- **Ctrl/Cmd + wheel** over the lane/ruler: `preventDefault`, then zoom anchored at the
  cursor. Anchoring math: capture the time under the cursor before zoom
  (`tUnder = pxToTime(scrollLeft + cursorOffsetX)`), apply the new zoom, then set
  `scrollLeft = timeToPx(tUnder) - cursorOffsetX` so that second stays under the pointer.
- A plain wheel (no modifier) keeps default scroll behavior.

## Ruler with time ticks

Replace the plain clickable ruler strip (`App.svelte`) with a tick ruler that spans
`contentWidth` and scrolls with the lanes:

- Choose a "nice" tick interval in seconds based on `pxPerSec` so labels are ~60–100 px
  apart (e.g. step through 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60 and pick the smallest whose
  pixel spacing ≥ a minimum). Draw minor ticks + labeled major ticks (`mm:ss` or seconds).
- The whole ruler remains click-to-seek using the pixel math above.
- Implementation can be a small canvas or absolutely-positioned divs; a canvas keeps the
  DOM light at high zoom and mirrors the waveform drawing approach already used in
  `Waveform.svelte`.

## Files to modify

- `packages/app/src/lib/studio.svelte.ts` — add `zoom`, `pxPerSec` (derived),
  `timeToPx`/`pxToTime`, `setZoom` with clamp; add stop-at-end check in the RAF loop.
- `packages/app/src/App.svelte` — sticky header column + scrollable content of
  `contentWidth`; pixel-based playhead overlay; pixel-based ruler seek; zoom toolbar
  buttons; Ctrl/Cmd-wheel handler; render the new ruler.
- `packages/app/src/components/TrackRow.svelte` — explicit lane width from duration ×
  pxPerSec; remove the per-track "Drop audio here" stretch.
- `packages/app/src/components/Waveform.svelte` — accept explicit `width` prop, drop the
  ResizeObserver-driven width, pass width as bin count to `extractPeaks`.
- **New:** `packages/app/src/components/TimelineRuler.svelte` — the tick ruler
  (scroll-aware, click-to-seek, adaptive tick density).
- **Engine:** no required changes. (`projectDuration`, `extractPeaks`, `clampSeek`,
  `Transport.seek`, and the `ended` event type all already exist and are reused.)

## What is explicitly NOT in this round

- **Track-body click-to-seek and drag-to-select** — deferred to Step 8.
- Vertical zoom / waveform height changes.
- Multi-clip-per-track layout (a track still shows `clips[0]`).
- Engine-side end-of-playback scheduler (handled app-side via the RAF loop this round).

## Verification

Browser verification follows the project's Playwright + Chromium + fixtures recipe
(see the `audiosandbox-verification` memory). Concretely:

1. `pnpm --filter @audiosandbox/engine test` — engine unit tests still pass (no engine
   logic changed; this guards against accidental breakage).
2. `pnpm --filter app dev`, then in-browser with a known fixture:
   - Load a **short** clip (e.g. ~1 s) and a **long** clip (e.g. ~30 s) on separate
     tracks: confirm the long track is visibly much wider than the short one (≈ duration ×
     100 px/s), not equal width.
   - When total content exceeds the window, confirm a **horizontal scrollbar** appears and
     scrolling moves lanes + ruler + playhead together while the **headers stay pinned**.
   - **Zoom:** `+`/`−`/`Fit` buttons change width as expected; **Ctrl/Cmd-wheel** zooms
     with the second under the cursor staying put.
   - **Ruler:** tick labels appear and re-space sensibly when zooming; clicking the ruler
     seeks to the clicked second (playhead jumps there; playing from there sounds correct).
   - **Stop at end:** press Play near the end; when the playhead reaches project end,
     playback stops and the playhead resets to 0 (Play button returns to ▶).
   - **Empty state:** with 0 tracks, the global "Drop an audio file here…" shows. After
     "+ Track" on an empty track, there is **no** stretched "Drop audio here" strip.
