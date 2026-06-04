# CLAUDE.md — Audio Sandbox

Browser-first audio editor + procedural sound-design toolkit for **indie game developers**.
Think AudioMass × Audacity, extended with pedalboard FX, game presets, and (later) a
procedural variation generator. Fully client-side; deploys as a static site to GitHub Pages.

Full design: [docs/superpowers/specs/2026-06-04-audio-sandbox-design.md](docs/superpowers/specs/2026-06-04-audio-sandbox-design.md)

## Stack

- **App:** Svelte 5 (runes) + TypeScript + Vite + Tailwind. Dark-mode-first.
- **Engine:** `@audiosandbox/engine` — raw Web Audio API (no Tone.js). Built with `tsup`.
- **Monorepo:** pnpm workspaces — `packages/engine`, `packages/app`.
- **Tests:** Vitest (in the engine).
- **Deploy:** GitHub Project Pages (repo `Crosline/audio-sandbox`) →
  `https://crosline.github.io/audio-sandbox/` (Vite `base: '/audio-sandbox/'`). Auto-deployed
  by `.github/workflows/deploy.yml` on push to `main`. One-time: repo Settings → Pages →
  Source = "GitHub Actions".

## The one rule that matters most: the engine/app boundary

`@audiosandbox/engine` is **framework-agnostic and npm-publishable**. It must have:

- **Zero** imports of Svelte / React / Vue / any UI library.
- **Zero** DOM or canvas access.

The engine **produces data** (waveform peaks, FFT bins, levels, state-change events) and
**accepts commands** (`cut()`, `addTrack()`, `play()`). The app subscribes to engine events,
mirrors them into Svelte runes, draws to canvas, and sends commands back. If you find yourself
importing anything UI-related into `packages/engine`, stop — it belongs in `packages/app`.

This boundary is what makes the engine reusable from React/Vue/vanilla and publishable to npm.

## Editing model

- **Destructive per-clip `AudioBuffer` edits** live in `engine/buffer-ops/` as **pure functions**
  `(AudioBuffer, …) → AudioBuffer`. No AudioContext needed — easiest things to unit-test.
- **Non-destructive pedalboard FX** are a separate layer (bypass + dry/wet). Editing buffers and
  applying FX are two different concerns; don't conflate them.
- **Undo/redo** is bounded: a `Command` stack capped by memory budget AND op count; evict oldest.

## Git workflow

- **One feature/fix per branch**, landing as **one commit**. Branch names like
  `feat/<thing>`, `fix/<thing>`, `docs/<thing>`.
- **Linear history: rebase + fast-forward.** Because each branch is a single commit, we keep
  history flat (no merge bubbles):

```bash
git checkout -b feat/x          # branch off main
# ...work, commit (squash to one commit)...
git rebase main                 # replay onto latest main
git checkout main
git merge --ff-only feat/x      # fast-forward only — no merge commit
git branch -d feat/x
```

- Default branch: `main`.
- Note: the first three branches (scaffold, engine-core-model, buffer-ops) predate this and
  landed as `--no-ff` merge commits; everything after uses rebase + ff.

## Testing convention

- Write tests **alongside the feature, in the same branch** — not deferred to a later phase.
- Start with the pure `buffer-ops`: build a small known buffer, run the op, assert the exact
  output samples. No browser, no mocks.
- `io/` decode/encode and `history/` cap/eviction also get tests.
- Real audio fixtures (small/large, mono/stereo, WAV/MP3/OGG/FLAC, very-short, silent) are
  **user-provided** — used in tests and dropped into the running app for manual verification.

## Commands

```bash
pnpm install                                  # install all workspace deps
pnpm --filter @audiosandbox/engine test       # run engine unit tests (Vitest)
pnpm --filter @audiosandbox/engine build      # build engine (ESM + .d.ts via tsup)
pnpm --filter app dev                         # run the app locally (Vite)
pnpm --filter app build                       # production build of the app
```

## Web Audio gotchas to remember

- **Export = `OfflineAudioContext`.** Nodes can't cross contexts, so the effect chain must be
  re-instantiated in the offline context via `Effect.createNodes(ctx)`.
- **Custom DSP = AudioWorklet** (e.g. bitcrush). ScriptProcessor is deprecated — don't use it.
- **`decodeAudioData`:** reliable for WAV/MP3/AAC. OGG fails on Safari/iOS; FLAC is unreliable.
  Filter accepted formats by browser and validate `buffer.length > 0` after decoding.

## Encoders

- WAV: hand-written Float32→PCM (interleave; little-endian; fmt AudioFormat=1 int / 3 float).
- MP3: `@breezystack/lamejs` (in a Web Worker).
- OGG Vorbis: `wasm-media-encoders`.

## Deferred (v2+/v3 — additive; v1 builds the foundation they need)

Procedural Variation Generator, Layered Sound Designer, Batch Processing, Asset Browser,
Spectrogram/LUFS metering, Game Context Preview, DJ-Mix/auto-mix module, automated npm publish
of the engine.
