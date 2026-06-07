# Step 11-a — Engine export: offline render + WAV encode

**Date:** 2026-06-07
**Scope:** `@audiosandbox/engine` only. The export **UI** (dialog, format picker, progress,
file download) is **Step 11-b**, a separate app branch, and is out of scope here.

## Goal

Give the engine everything needed to turn a `Project` into downloadable audio data:

1. An offline **render** layer that mixes the arrangement down through `OfflineAudioContext`.
2. A pure **WAV encoder** that turns a rendered `AudioBuffer` into RIFF/WAVE bytes.

The app (11-b) will call these, wrap the bytes in a `Blob`, and trigger a download.

## Locked decisions (from brainstorming)

- **Engine only.** App UI is 11-b.
- **WAV only** for now. MP3 (`@breezystack/lamejs`) and OGG (`wasm-media-encoders`) are
  deferred to a later step / v2+ — no WASM, no Web Worker in 11-a.
- **Honor mixer state** (mute / solo / per-track gain) by default, with explicit escape
  hatches so 11-b can offer "include muted", "force unity gain", and per-track overrides —
  the foundation for stem export and future per-track-to-file export.
- **Full stem support now:** render the whole mix, a single track, or every track to its own
  buffer. (`renderMix` / `renderStem` / `renderStems`.)
- **API shape:** a `Renderer` **class** (Option C) that resolves a shared render plan once in
  its constructor and exposes the three render methods.

## Module layout

Two new engine layers (both named in the master design spec), re-exported from
`packages/engine/src/index.ts`:

```
packages/engine/src/
├── render/
│   ├── plan.ts            # PURE: resolve the render plan (window, length, audible set, gains, schedule)
│   ├── plan.test.ts
│   ├── renderer.ts        # Renderer class — thin OfflineAudioContext wiring over the plan
│   └── index.ts
├── io/
│   ├── wav.ts             # PURE: encodeWav(AudioBuffer, opts?) → ArrayBuffer
│   ├── wav.test.ts
│   └── index.ts
```

**Boundary:** no Svelte / React / Vue, no DOM, no canvas. `render/renderer.ts` may touch
`OfflineAudioContext` (a Web Audio standard, same allowance as `transport/` using
`AudioContext`). `render/plan.ts` and `io/wav.ts` are **pure** — data in, data out, no audio
context — so they unit-test against the existing fake-buffer helpers (`test-helpers.ts`).

## API

### `render/plan.ts` (pure)

```ts
/** Per-track gain/mute override, applied on top of the model's own state. */
export interface TrackOverride {
  gain?: number;
  muted?: boolean;
}

export interface RenderOptions {
  /** Export window start (seconds). Default 0. */
  start?: number;
  /** Export window end (seconds). Default = projectDuration(project). */
  end?: number;
  /** Force all audible tracks to unity gain (1.0), ignoring per-track gain. Default false. */
  unityGain?: boolean;
  /** Include muted tracks anyway. Default false. */
  includeMuted?: boolean;
  /** Per-track gain/mute overrides, keyed by track id (applied last; wins). */
  overrides?: Map<string, TrackOverride>;
  /** Output sample rate (Hz). Default = inferred from the first clip's buffer. */
  sampleRate?: number;
  /** Output channel count. Default 2 (stereo). */
  channels?: number;
}

/** One clip scheduled into the offline render: which buffer, when, with what buffer offset. */
export interface ScheduledClip {
  buffer: AudioBuffer;
  /** When to start, in seconds from the window origin (>= 0). */
  when: number;
  /** Offset into the source buffer (seconds) — nonzero for clips that begin before `start`. */
  offset: number;
  /** How long to play (seconds) — clipped to the window end. */
  duration: number;
}

/** A track's contribution to a render: its effective gain plus its scheduled clips. */
export interface TrackPlan {
  trackId: string;
  /** Effective linear gain after solo/mute/unity/override resolution. */
  gain: number;
  clips: ScheduledClip[];
}

/** The fully resolved render plan — everything the OfflineAudioContext wiring needs. */
export interface RenderPlan {
  sampleRate: number;
  channels: number;
  /** Total output length in samples (window length × sampleRate, rounded). */
  lengthSamples: number;
  /** Window start/end actually used (seconds). */
  start: number;
  end: number;
  /** One entry per *included* track (audible, or forced in by includeMuted/override). */
  tracks: TrackPlan[];
}

/**
 * Resolve the render plan for a whole-mix or multi-stem render. Pure: no AudioContext.
 *
 * `onlyTrackId`, when given, restricts the plan to that single track and renders it even if
 * another track is soloed (an explicit "render this stem" request) — but still respects its
 * own muted/override state unless includeMuted overrides it.
 */
export function resolveRenderPlan(
  project: Project,
  options?: RenderOptions,
  onlyTrackId?: string,
): RenderPlan;
```

The effective-gain / audible-set logic reuses the existing model helpers
(`isTrackAudible`, `anyTrackSoloed`) and layers `includeMuted`, `unityGain`, and `overrides`
on top, in that precedence order (overrides win).

### `render/renderer.ts`

```ts
export class Renderer {
  constructor(project: Project, options?: RenderOptions);

  /** Render the full mix (all included tracks summed) to one AudioBuffer. */
  renderMix(): Promise<AudioBuffer>;

  /** Render a single track in isolation to one AudioBuffer. */
  renderStem(trackId: string): Promise<AudioBuffer>;

  /** Render every included track to its own buffer, keyed by track id. */
  renderStems(): Promise<Map<string, AudioBuffer>>;
}
```

- The constructor stores `project` + `options` and resolves the **mix** plan once (via
  `resolveRenderPlan`). `renderMix` uses it directly; `renderStem` / `renderStems` resolve a
  per-track plan (cheap) and render each track into its own offline context.
- Each render: `new OfflineAudioContext(plan.channels, plan.lengthSamples, plan.sampleRate)`,
  then for each `TrackPlan` a `GainNode(plan.gain)` → `destination`, and for each
  `ScheduledClip` an `AudioBufferSourceNode` with
  `source.start(when, offset, duration)` → the track gain. `await ctx.startRendering()`.
- `renderStems` runs the per-track renders concurrently (`Promise.all`) and collects them
  into a `Map<trackId, AudioBuffer>`.
- A zero-length window or a plan with no clips yields a length-0 buffer (callers/encoder
  tolerate it).

### `io/wav.ts` (pure)

```ts
export interface WavOptions {
  /** 16-bit signed int PCM (default) or 32-bit IEEE float. */
  format?: 'int16' | 'float32';
}

/** Encode an AudioBuffer as a canonical RIFF/WAVE byte buffer. */
export function encodeWav(buffer: AudioBuffer, options?: WavOptions): ArrayBuffer;
```

- Interleaves the buffer's per-channel `Float32Array`s.
- Canonical 44-byte header: little-endian; `RIFF`/`WAVE`; `fmt ` chunk with
  `AudioFormat = 1` (int16) or `3` (float32), correct
  `numChannels` / `sampleRate` / `byteRate` / `blockAlign` / `bitsPerSample`; `data` chunk.
- int16 path: clamp each sample to `[-1, 1]`, then `s < 0 ? s * 0x8000 : s * 0x7FFF`.
- Only touches `numberOfChannels`, `length`, `sampleRate`, `getChannelData` — so it tests
  against the fake-buffer helpers with no real context.

## Mixer semantics

| State | Behavior |
|---|---|
| Solo active | Only soloed tracks render (via `anyTrackSoloed` + `isTrackAudible`). |
| Muted track | Excluded — unless `includeMuted: true` or an override un-mutes it. |
| `unityGain: true` | Every included track renders at gain 1.0 (ignores model gain). |
| `overrides[id]` | Per-track `gain` / `muted`, applied last; wins over model + flags. |
| `renderStem(id)` | Renders that one track even if another is soloed; still respects its own muted/override unless includeMuted. |

Pan exists in the model but is **not** wired in the live transport yet, so it is out of scope
here. Output is stereo by default; mono sources up-mix automatically. (Pan is a noted future
hook — when the transport gains a panner, the render plan adds one too.)

## Testing

All Vitest in the existing **`node`** environment (no browser, no new deps):

- **`io/wav.test.ts`** (pure, exact bytes):
  - Header fields at correct byte offsets: `RIFF`, total size, `WAVE`, `fmt `, fmt size (16),
    `AudioFormat`, `numChannels`, `sampleRate`, `byteRate`, `blockAlign`, `bitsPerSample`,
    `data`, data size.
  - int16 sample values for a known buffer: `+1.0 → 0x7FFF`, `-1.0 → 0x8000`, `0 → 0`,
    out-of-range clamps.
  - float32 round-trips bit-exact.
  - Mono and stereo interleave order (L,R,L,R…).
  - Empty buffer → header-only (data size 0).
- **`render/plan.test.ts`** (pure): window cropping (clip before/after/straddling the
  window → correct `when`/`offset`/`duration`); audible-set + effective-gain across
  mute / solo / unityGain / includeMuted / overrides combinations and their precedence;
  `onlyTrackId` isolating a track past solo; sample-rate/channel inference + overrides;
  length-in-samples math; empty project → empty plan.
- **`Renderer`** (OfflineAudioContext): the engine test env has no Web Audio, and we will
  **not** add a heavy mock to the framework-agnostic engine. All real decision logic lives in
  the pure `resolveRenderPlan`, which is fully tested. The thin `Renderer` wiring shell
  (build context, attach gain + sources, `startRendering`) is verified in the **browser**
  during 11-b's E2E (load audio, export, assert a non-silent WAV downloads). This keeps engine
  deps unchanged while keeping coverage on the logic that can actually be wrong.

## Out of scope (later steps)

- Export **UI** / download / progress (11-b).
- MP3 + OGG encoders and the Web Worker that runs them (later step / v2+).
- Pan in the render graph (arrives when the transport gains a panner).
- Effects in the offline chain (Step 9 must land first; render will re-instantiate the FX
  chain via `Effect.createNodes(ctx)` once effects exist).
