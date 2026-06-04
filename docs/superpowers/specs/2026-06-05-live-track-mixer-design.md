# Live track mixer: per-track gain node (live mute / solo / volume)

**Date:** 2026-06-05
**Status:** Implemented (branch `feat/live-track-mixer`)
**Scope:** Make mute, solo, and per-track volume take effect **while playback is running**,
instead of only on the next `play()`. A small, self-contained audio-graph change.

## Context

Today the transport schedules one `AudioBufferSourceNode` per audible clip and connects
each **directly to `master`** ([transport.ts](../../packages/engine/src/transport/transport.ts)
`#startSources`). Track audibility is evaluated **once**, at the moment sources are
scheduled (`if (!isTrackAudible(track, soloed)) continue;`). Consequences:

- Toggling **mute/solo** mid-playback changes the model but nothing re-reads it — the
  change only lands on the next `play()`. (The engine comment even notes audibility is
  "consulted each time playback starts.")
- The per-track **volume slider** ([TrackRow.svelte](../../packages/app/src/components/TrackRow.svelte))
  writes `track.gain` into the model but it is **never applied to audio** — there is no
  node in the live graph carrying it. This is a latent bug, not just a missing feature.

Both stem from the same gap: there is no per-track node to turn down. Adding one fixes
mute, solo, and volume together, and is the exact insertion point the later pedalboard FX
step (Step 9) needs.

## Design: a GainNode per track

Insert a per-track gain node between a track's clip sources and master:

```
clip sources ──→ trackGain ──→ master ──→ destination
```

- The transport keeps a `Map<trackId, GainNode>`. `#startSources` connects each clip's
  source to its track's gain node (creating/caching the node) rather than to `master`.
- A new `applyTrackLevels()` method recomputes every track's target gain from the current
  model and writes it to the corresponding node. It reuses the existing pure helpers
  [`isTrackAudible`](../../packages/engine/src/model/project.ts) and
  [`anyTrackSoloed`](../../packages/engine/src/model/project.ts) — no audibility logic is
  duplicated.
- Target gain per track: `0` when not audible (muted, or un-soloed while something is
  soloed), else the track's linear `gain` (the 0..1 volume). A pure helper
  `trackTargetGain(track, anySoloed)` makes this unit-testable without a context.

### Declick

Never set `.gain.value` instantly — that clicks. Use a short ramp:
`gainNode.gain.setTargetAtTime(target, ctx.currentTime, 0.01)` (~10 ms). This gives a
smooth mute/unmute and a smooth volume drag.

### Node lifecycle

- Create a track's gain node lazily on first use; cache it in the map.
- On **track removal**, disconnect and drop its node from the map (prevents a leak and a
  stale node lingering in the graph).
- On `dispose()`, disconnect all track gain nodes.
- Master volume stays where it is (master gain node); per-track gain is a new, separate
  layer beneath it.

## App wiring

`Studio.toggleMute`, `toggleSolo`, and `setTrackGain` currently only mutate the reactive
model. After mutating, each should call the transport's `applyTrackLevels()` so the change
is heard immediately — whether or not playback is running (when stopped, it simply sets the
targets the next play will start from). `removeTrack` should tell the transport to release
that track's node.

## Files to touch

- `packages/engine/src/transport/transport.ts` — per-track gain map; connect clips → track
  gain → master in `#startSources`; `applyTrackLevels()`; `releaseTrack(id)` / cleanup in
  `dispose()`.
- `packages/engine/src/model/project.ts` (or a small `mixer.ts`) — pure
  `trackTargetGain(track, anySoloed)` helper.
- `packages/app/src/lib/studio.svelte.ts` — call `applyTrackLevels()` after mute/solo/gain
  changes; release on track removal.
- No UI change required — [TrackRow.svelte](../../packages/app/src/components/TrackRow.svelte)
  mute/solo buttons and the volume slider already exist and emit the right calls.

## Testing

- **Vitest (pure):** `trackTargetGain` — muted → 0; soloed track at its gain while another
  is un-soloed → 0; no solo anywhere → each track at its own gain.
- **Playwright (live):** load a clip, start playback, toggle mute, and assert the output
  level drops (read via an analyser / the master, or assert the track gain node's value
  through an exposed test hook); toggle solo across two tracks; drag the volume slider mid-
  play and assert the level follows. Reuse the in-memory WAV fixture helper.

## Out of scope

- Pan (the model has `pan` but no node yet — a later, similar addition).
- Pedalboard FX (Step 9): the per-track gain node is the insertion point, but the FX chain
  itself is separate.
- Metering / level visualisation.
