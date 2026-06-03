# Audio Sandbox — Design Spec

_Date: 2026-06-04_

## Overview

**Audio Sandbox** is a browser-first audio editor and procedural sound-design toolkit
for **indie game developers**. The reference point is [audiomass.co](https://audiomass.co)
crossed with Audacity — a fast, no-login, sleek waveform editor — extended with
game-audio-specific tooling (pedalboard FX, game presets, and later a procedural
variation generator).

It exists to give a friction-free, web-accessible audio pipeline: no installs, reachable
from anywhere, with exactly the tools an indie dev needs (cut / silence / insert / export,
multi-track, tactile effects) and none of the DAW bloat.

The app is fully client-side and deployable as a static site on GitHub Pages.

## Goals

Optimize for: fast iteration, easy experimentation, happy accidents, game-ready export,
accessibility for non-audio-engineers, smooth UX over DAW complexity.

This is **not** a professional music-production DAW, a Pro Tools competitor, or an
orchestral-composition suite. It is a fast, fun **sound-design sandbox** for indie game devs.

## Locked Decisions

- **Multi-track from day one** (matches the design sketch and the must-have list).
- **Stack:** Svelte 5 (runes) + TypeScript + Vite + Tailwind. Static, GitHub Pages.
- **Audio engine:** raw Web Audio API (no Tone.js), built as a **standalone,
  framework-agnostic, npm-publishable library** (`@audiosandbox/engine`). Usable from
  Svelte / React / Vue / vanilla — it emits data and accepts commands, never touches the DOM.
- **Monorepo:** pnpm workspaces (`packages/engine`, `packages/app`).
- **Editing model:** **destructive per-clip `AudioBuffer` edits** (pure functions) +
  **non-destructive pedalboard FX** — two separate layers.
- **Undo/redo:** bounded history (memory-budget + op-count cap; evict oldest).
- **Git workflow:** small frequent commits; feature branches; `--no-ff` merges; root `.gitignore`.
- **Testing:** tests written **paired with each feature**, not as a separate upfront phase.
  The pure `buffer-ops` are the easiest entry point (known buffer in → assert exact samples
  out; no browser, no mocks). Real audio fixtures (small/large, mono/stereo, WAV/MP3/OGG/FLAC,
  very-short, silent) are user-provided for decode/edit/export tests and manual verification.
- **Deploy target:** GitHub **Project Pages** → `username.github.io/audiosandbox/`
  (Vite `base: '/audiosandbox/'`).

## Scope

### v1 (this build)

- Multi-track timeline: add/remove tracks, drag clips, waveform render, zoom, playhead,
  mute/solo, per-track volume.
- Editing core (must-haves): selection (show/drag), cut, copy/paste, insert silence,
  silence a region, trim, fade in/out, **play from a point**, loop region.
- Non-destructive pedalboard FX (per-track chain, drag-reorder, enable/disable, dry/wet).
  Starter set: Filter, Reverb, Distortion, Bitcrush, Delay, EQ.
- Game Audio Presets (one-click FX chains: Retro PS1, VHS, Underwater, Radio, …) built on
  the same FX system.
- Export: WAV (always), MP3 + OGG Vorbis (WASM, in a Web Worker); export selection or whole project.
- Project persistence (IndexedDB), undo/redo.
- Responsive desktop + mobile layouts.

### Deferred (additive v2+/v3 — foundation already supports them)

- **Procedural Variation Generator** (top differentiator; needs only buffer-ops + effect
  interface + seeded RNG + batch offline render — all present in v1).
- Layered Sound Designer.
- Batch Processing / folder tools.
- Asset Browser, Spectrogram / LUFS metering, Game Context Preview.
- **DJ-Mix / auto-mix module** (Spotify-DJ-style: crossfade/beatmatch between sources,
  shift modes, gap seconds, dedicated UI).
- **Automated npm publish of `@audiosandbox/engine`** — GitHub Actions release workflow
  triggered on changes under `packages/engine/`, gated by a version bump / tag / Changesets
  release (not every commit), running `npm publish` with an `NPM_TOKEN` secret.

## Architecture

### Monorepo layout

```
audiosandbox/
├── packages/
│   ├── engine/   @audiosandbox/engine — framework-agnostic, npm-publishable.
│   │             Pure TS + Web Audio API. No Svelte/React/DOM/canvas.
│   └── app/      Svelte 5 application (the only thing deployed to GitHub Pages).
├── pnpm-workspace.yaml
├── package.json
├── .gitignore
└── docs/superpowers/specs/2026-06-04-audio-sandbox-design.md
```

### Engine (`@audiosandbox/engine`) — layered, each layer unit-testable

| Layer | Responsibility |
|---|---|
| `core/` | AudioContext lifecycle, master bus, typed event emitter (subscribe/publish for any framework). |
| `model/` | Plain data types: `Project → Track[] → Clip`. `Clip` owns an `AudioBuffer` + offset/duration. `Track` owns gain/pan/mute/solo. |
| `buffer-ops/` | **Pure functions** `(AudioBuffer, …) → AudioBuffer`: `cut`, `copy`, `insertSilence`, `silenceRegion`, `trim`, `fadeIn`, `fadeOut`. The editor's heart; testable on raw sample arrays with no AudioContext. |
| `transport/` | play, pause, stop, **seek (play from a point)**, loop region. Schedules `AudioBufferSourceNode`s against `AudioContext.currentTime`. |
| `effects/` | `Effect` interface: `createNodes(ctx)`, `connect`, `bypass`, `setParam`, `serialize`. Built-ins: Filter (Biquad), Reverb (Convolver), Distortion (WaveShaper), Bitcrush (AudioWorklet), Delay, EQ. Bypass + dry/wet ⇒ non-destructive pedalboard. |
| `history/` | Bounded undo/redo `Command` stack with a memory-budget cap (~50 MB) AND op-count cap (~50); oldest evicted first. |
| `render/` | `OfflineAudioContext` export rendering. **Re-instantiates the effect chain in the offline context** (nodes cannot cross contexts — enforced by `Effect.createNodes(ctx)`). |
| `io/` | Decode uploads via `decodeAudioData`; Encode WAV (manual Float32→PCM), MP3 (`@breezystack/lamejs`), OGG Vorbis (`wasm-media-encoders`). Encoders run in a Web Worker. |
| `analysis/` | Waveform peak extraction, `AnalyserNode` FFT taps, RMS/level. Produces numbers only; the app draws them. |

**Framework-agnostic guarantee:** the engine exposes a plain API plus an event emitter.
Svelte mirrors events into `$state`; React would use `useSyncExternalStore`; vanilla
subscribes directly. The engine README ships a short "using from React" example to prove the
boundary. Built with **tsup** (ESM-first, proper `exports`/`types`).

### App (Svelte 5)

- **State:** runes (`$state`/`$derived`) hold a view-model mirror of engine state via a thin
  subscribing store. UI sends commands; never mutates audio nodes directly.
- **Rendering:** waveforms, playhead, selection on `<canvas>` for 60fps; meters/FFT via
  `requestAnimationFrame` over engine analysis data.
- **Layouts (responsive, one component tree):**
  - Desktop — tracks/timeline top, pedalboard + presets docked bottom (the sketch).
  - Mobile — single-track-focused, collapsible panels, bottom transport bar, FX as full-screen sheet.
- **Visual identity:** dark-mode-first, flat, sleek; tactile knobs/sliders with animated feedback.
- **Persistence:** IndexedDB for projects (buffers are large); presets as JSON.

### Deployment

- GitHub Project Pages at `username.github.io/audiosandbox/`.
- Vite static build; `base: '/audiosandbox/'`; copy `index.html → 404.html` for SPA fallback; `.nojekyll`.
- GitHub Actions workflow builds the app and publishes to a `gh-pages` branch.

## Key Libraries / Techniques

- **MP3 encode:** `@breezystack/lamejs` (run in Web Worker; stereo, CBR).
- **OGG Vorbis encode:** `wasm-media-encoders`.
- **WAV encode:** hand-written Float32→PCM (interleave non-interleaved AudioBuffer;
  little-endian; fmt AudioFormat=1 int / 3 float).
- **Library build:** `tsup` for `packages/engine`.
- **Custom DSP:** AudioWorklet (bitcrush); never ScriptProcessor (deprecated).
- **Export render:** `OfflineAudioContext` with effects re-instantiated per `Effect.createNodes(ctx)`.
- **Upload decode:** `decodeAudioData` — reliable for WAV/MP3/AAC; OGG fails on Safari/iOS,
  FLAC unreliable → filter formats by browser and validate `buffer.length > 0` post-decode.

## Verification

- **Engine:** `pnpm --filter @audiosandbox/engine test` — unit tests for buffer-ops
  (sample-exact cut/silence/insert/trim/fade), event emitter, history cap/eviction.
  `pnpm --filter @audiosandbox/engine build` produces ESM + `.d.ts`.
- **App locally:** `pnpm --filter app dev` — load/drop a sound, make a selection,
  cut/insert-silence/silence-region, play-from-point, undo/redo, add+reorder FX,
  apply a preset, export WAV/MP3/OGG, save+reload from IndexedDB. Confirm mobile layout.
- **Deploy:** push → GitHub Actions builds → `gh-pages` serves; open the live URL, confirm
  no asset 404s (base path) and SPA routing works.
- **Framework-agnostic proof:** engine README "using from React" snippet compiles/type-checks
  against the published types.
