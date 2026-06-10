# Step 9 — Effects + Pedalboard — Design Spec

_Date: 2026-06-10_

> Authored autonomously while the user was AFK, following the established Audio Sandbox
> conventions (engine/app boundary, pure-testable logic split from Web-Audio wiring, model
> stays serializable, one step = one branch). Decisions below mirror the user's prior choices;
> flagged **[review]** where a judgment call was made on their behalf.

## Goal

Add the **non-destructive pedalboard FX layer** described in the design spec: a per-track,
ordered chain of effects with bypass and dry/wet, that is heard live during playback and
re-instantiated correctly for offline export. This is the foundation Step 10 (game presets)
builds on — presets are just named FX chains.

## Scope (this step)

**In:**

- An `Effect` model + a small, framework-agnostic effects layer in `@audiosandbox/engine`.
- Per-track effect chain stored in the **model** (plain, serializable data) — `Track.effects`.
- Live audio: the chain is inserted into the transport graph per track, between the track's
  gain and panner, with a dry/wet crossfade and per-effect bypass.
- Offline export: the renderer re-instantiates the same chain in the `OfflineAudioContext`
  (nodes can't cross contexts — enforced via `createNodes(ctx)`).
- Starter effects (all native Web Audio nodes, no AudioWorklet, no binary assets):
  - **Filter** — `BiquadFilterNode` (lowpass/highpass/bandpass; frequency, Q).
  - **Distortion** — `WaveShaperNode` with a generated curve (drive amount).
  - **Delay** — `DelayNode` + feedback gain + wet mix (time, feedback).
  - **EQ** — three cascaded `BiquadFilterNode`s (low-shelf, peaking mid, high-shelf; gains in dB).
- App pedalboard UI: a docked panel showing the selected track's chain — add/remove effects,
  reorder, enable/disable (bypass), dry/wet, and per-effect param controls.
- Undo/redo of chain edits (add/remove/reorder/param) via the existing `History` stack.
- Tests: pure unit tests on the effect param/curve math + chain model ops; app E2E for the
  pedalboard UI and that effects audibly alter output.

**Out / Deferred [review]:**

- **Reverb (Convolver)** — needs an impulse-response asset; deferred to keep this step free of
  binary fixtures and reviewable in isolation. Tracked for a follow-up.
- **Bitcrush (AudioWorklet)** — needs a worklet module + the worklet build/serve wiring; its own
  follow-up. The `Effect` interface is designed so both drop in later without changes.
- Game presets (Step 10) — separate step, built on this.
- Dry/wet automation, sidechain, per-effect metering — YAGNI for v1.

## The Effect interface (engine, framework-agnostic)

Two concerns, kept separate (mirrors the model-vs-graph split elsewhere in the engine):

1. **Effect state** — plain serializable data in the model. One discriminated-union type per
   effect kind, plus shared fields:

   ```ts
   interface EffectStateBase {
     id: Id;
     bypass: boolean;   // true = effect contributes nothing (full dry)
     wet: number;       // 0..1 dry/wet mix
   }
   type EffectState =
     | (EffectStateBase & { kind: 'filter'; filterType: BiquadFilterType; frequency: number; q: number })
     | (EffectStateBase & { kind: 'distortion'; drive: number })           // drive 0..1
     | (EffectStateBase & { kind: 'delay'; time: number; feedback: number }) // seconds, 0..<1
     | (EffectStateBase & { kind: 'eq'; low: number; mid: number; high: number }); // dB each
   ```

   `Track.effects: EffectState[]` — ordered; index 0 is first in the chain.

2. **Effect graph builder** — a pure-ish factory per kind, `createEffectNodes(ctx, state)`,
   returning a small object that exposes a single `input` and `output` `AudioNode` and an
   `update(state)` method. The builder is the **only** place that touches Web Audio, and it
   works against any `BaseAudioContext` (so the *same* code serves live and offline). It does
   **not** import the live context — `ctx` is passed in.

### Dry/wet & bypass, uniformly

Each effect is wrapped in a standard **wet/dry crossfade**: the chain wrapper builds
`input → [dryGain] → output` and `input → effectCore → [wetGain] → output`. `bypass` forces
`wet=0` (dry only) without tearing down nodes. This wrapper is shared by all kinds, so adding
a new effect only means writing its `effectCore`. Wet/dry/bypass are smoothed with the same
`setTargetAtTime` declick used by the transport's track gains.

### Pure, unit-testable pieces

The math that doesn't need an `AudioContext` is extracted and tested sample-exact, the way
`clock.ts`/`plan.ts` are:

- `distortionCurve(drive, samples): Float32Array` — the WaveShaper transfer curve.
- `wetDryGains(wet, bypass): { dry: number; wet: number }` — mix resolution.
- Chain **model ops** (pure, immutable): `addEffect`, `removeEffect`, `moveEffect`,
  `updateEffect`, `defaultEffect(kind)` — all `(Track | EffectState[], …) → EffectState[]`.

## Live wiring (transport)

Current per-track graph: `clip sources → trackGain → trackPanner → master`.

New: `clip sources → trackGain → [effect chain] → trackPanner → master`.

- The transport gains a `#trackEffects: Map<trackId, BuiltChain>` built lazily alongside the
  existing gain/panner maps.
- `applyTrackEffects(track)` (called from the Studio after any chain edit) diffs the model
  chain against the built chain. **[review]** For simplicity and correctness, a chain edit
  **rebuilds that track's chain** (disconnect old, build new, reconnect gain→chain→panner) —
  rebuilds are cheap (a handful of native nodes) and avoid fiddly node-identity diffing.
  Param-only changes (slider drags) call `update(state)` on the existing built nodes instead
  of rebuilding, so dragging a knob doesn't click.
- `releaseTrack` / `dispose` also tear down the chain.

## Offline wiring (renderer)

`resolveRenderPlan` already produces a `TrackPlan`. Add `effects: EffectState[]` to it
(copied from the track). `Renderer.#renderPlan` builds `trackGain → [chain] → destination`
using the **same** `createEffectNodes(ctx, …)` against the `OfflineAudioContext`. The plan
stays pure (it just carries the effect states); only the renderer touches nodes — keeping the
unit-tested/at-runtime split intact.

## App: pedalboard UI

- A docked **Pedalboard** panel (bottom of the layout, per the design sketch). Shows the
  **selected track's** chain (track selection = `lastTrackId`, already tracked). Empty state:
  "Select a track and add an effect."
- An **"+ FX"** menu to add Filter / Distortion / Delay / EQ.
- Each effect renders as a card: name, enable/bypass toggle, dry/wet slider, reorder
  (left/right or drag), remove, and its kind-specific param controls (sliders/select). Reuse
  the existing slider styling from the track header.
- All edits route through new `Studio` methods that mutate `Track.effects` immutably, record
  an undo entry, and call `transport.applyTrackEffects`.

### Studio bridge additions

- `addEffect(trackId, kind)`, `removeEffect(trackId, effectId)`,
  `moveEffect(trackId, effectId, dir)`, `updateEffect(trackId, effectId, patch)`,
  `setEffectBypass`, `setEffectWet`.
- New undo `Edit` variant: `{ kind: 'effects'; trackId; before: EffectState[] }` — snapshot the
  whole (small) chain array; undo/redo swap it back. Param-drag coalescing mirrors `moveClip`
  (one entry per gesture via a `#editingEffectId` guard).

## Undo/redo

Chain arrays are tiny (plain numbers/strings, no buffers), so an `effects` edit costs ~0 bytes
against the history budget. Snapshot-swap the whole array — simplest correct approach, matches
`remove-track`'s whole-object snapshot.

## Testing

**Engine unit (Vitest, no browser):**

- `distortionCurve`: shape/length/monotonic-ish, drive=0 ≈ identity.
- `wetDryGains`: bypass → dry=1/wet=0; wet=1 → dry=0/wet=1; clamping.
- Chain model ops: add appends with defaults; remove by id; move clamps at ends; update patches
  one effect immutably; defaults per kind sane.
- `resolveRenderPlan`: each `TrackPlan` carries the track's `effects` array verbatim.

**App E2E (Playwright):**

- Add an effect → card appears; the model chain length grows (`window.__studio`).
- Reorder / remove update the chain.
- Bypass toggle flips the model flag.
- An audible check: render/compare or assert a wet-mix gain node exists in the live graph for
  a track with one effect (reuse the `liveTrackGain`-style read-only hook → add a
  `liveTrackHasEffects(trackId)` probe).
- Undo/redo of an add restores the prior chain.

## Verification

`pnpm -r test` green (engine unit + app unit), `pnpm --filter app test:e2e` green,
`pnpm --filter @audiosandbox/engine build` + `svelte-check` clean. Manual: add a Filter to a
track, play, sweep the cutoff and hear it; bypass it; export and confirm the rendered file
carries the effect.

## Non-goals reminder

Engine stays UI/DOM-free. The pedalboard panel and all canvas/DOM live in the app. The engine
only gains: the `EffectState` types, the pure math, the chain model ops, the `createEffectNodes`
builder, and the transport/renderer wiring that consumes them.
