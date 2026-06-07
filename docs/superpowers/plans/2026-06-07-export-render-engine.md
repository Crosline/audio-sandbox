# Step 11-a — Engine Export (Render + WAV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an engine-only export pipeline — a pure `encodeWav` function, a pure `resolveRenderPlan` function, and a `Renderer` class that mixes a `Project` down through `OfflineAudioContext` to mix / single-stem / all-stems buffers.

**Architecture:** Two new engine layers, `io/` (WAV encode) and `render/` (offline mix-down). All decision logic is pure and unit-tested against fake AudioBuffers; the only Web-Audio-touching code is the thin `Renderer` wiring shell, whose logic is fully delegated to the pure plan. Honors mixer state (mute/solo/gain) with `unityGain` / `includeMuted` / per-track `overrides` escape hatches.

**Tech Stack:** TypeScript, Vitest (node env, no browser), Web Audio `OfflineAudioContext`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-07-export-render-engine-design.md`

**Conventions to follow (from the existing engine):**
- Pure functions test against `makeMono` / `makeStereo` / `makeFakeBuffer` / `channelToArray` from `src/test-helpers.ts` (NOT exported from the package).
- Each sub-module has an `index.ts` re-export; the package `src/index.ts` re-exports from there with a `// section` comment.
- Imports of sibling files use the `.js` extension (ESM), e.g. `import { x } from './plan.js'`.
- Run engine tests from the worktree root: `pnpm --filter @audiosandbox/engine test`.

---

## File Structure

```
packages/engine/src/
├── io/
│   ├── wav.ts          # encodeWav(buffer, opts?) → ArrayBuffer  (pure)
│   ├── wav.test.ts
│   └── index.ts        # re-export encodeWav + WavOptions
├── render/
│   ├── plan.ts         # resolveRenderPlan(...) + all RenderOptions/RenderPlan types  (pure)
│   ├── plan.test.ts
│   ├── renderer.ts     # Renderer class — OfflineAudioContext wiring over the plan
│   └── index.ts        # re-export Renderer + plan symbols
└── index.ts            # add `// io` and `// render` sections re-exporting both
```

`renderer.ts` has no unit test (needs a real OfflineAudioContext — verified in 11-b's browser E2E). Everything else is TDD.

---

## Task 1: WAV encoder — header + int16 mono

**Files:**
- Create: `packages/engine/src/io/wav.ts`
- Test: `packages/engine/src/io/wav.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/io/wav.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMono } from '../test-helpers.js';
import { encodeWav } from './wav.js';

/** Read a 4-char ASCII tag at a byte offset. */
function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

describe('encodeWav — int16 mono header', () => {
  it('writes a canonical 44-byte RIFF/WAVE header', () => {
    // 4 mono samples at 8000 Hz → data = 4 × 2 bytes = 8; total file = 44 + 8 = 52.
    const buf = makeMono([0, 0, 0, 0], 8000);
    const bytes = encodeWav(buf); // default int16
    const view = new DataView(bytes);

    expect(bytes.byteLength).toBe(52);
    expect(tag(view, 0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(44); // file size - 8
    expect(tag(view, 8)).toBe('WAVE');
    expect(tag(view, 12)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // AudioFormat = 1 (int PCM)
    expect(view.getUint16(22, true)).toBe(1); // numChannels
    expect(view.getUint32(24, true)).toBe(8000); // sampleRate
    expect(view.getUint32(28, true)).toBe(16000); // byteRate = rate × channels × 2
    expect(view.getUint16(32, true)).toBe(2); // blockAlign = channels × 2
    expect(view.getUint16(34, true)).toBe(16); // bitsPerSample
    expect(tag(view, 36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8); // data size
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @audiosandbox/engine test wav`
Expected: FAIL — cannot resolve `./wav.js` / `encodeWav is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/engine/src/io/wav.ts`:

```ts
/**
 * Encode an AudioBuffer to canonical RIFF/WAVE bytes. Pure — touches only
 * numberOfChannels / length / sampleRate / getChannelData, so it tests against fakes.
 *
 * Layout: 44-byte header (RIFF, fmt, data chunks; little-endian) + interleaved samples.
 * int16: AudioFormat=1, samples clamped to [-1,1] then scaled to signed 16-bit.
 * float32: AudioFormat=3, raw Float32 little-endian.
 */
export interface WavOptions {
  /** 16-bit signed int PCM (default) or 32-bit IEEE float. */
  format?: 'int16' | 'float32';
}

export function encodeWav(buffer: AudioBuffer, options: WavOptions = {}): ArrayBuffer {
  const format = options.format ?? 'int16';
  const isFloat = format === 'float32';
  const bytesPerSample = isFloat ? 4 : 2;
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const sampleRate = buffer.sampleRate;

  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);

  const writeTag = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, isFloat ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeTag(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave per-channel Float32 data, writing samples after the header.
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = channelData[c]![i] ?? 0;
      if (isFloat) {
        view.setFloat32(offset, sample, true);
      } else {
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      }
      offset += bytesPerSample;
    }
  }

  return bytes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @audiosandbox/engine test wav`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/io/wav.ts packages/engine/src/io/wav.test.ts
git commit -m "feat(engine): encodeWav — RIFF/WAVE header + int16 mono"
```

---

## Task 2: WAV encoder — sample values, stereo interleave, float32, empty

**Files:**
- Modify: `packages/engine/src/io/wav.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/src/io/wav.test.ts`:

```ts
import { makeStereo } from '../test-helpers.js';

describe('encodeWav — sample values', () => {
  it('encodes int16 full-scale, negative, zero, and clamps out-of-range', () => {
    const buf = makeMono([1, -1, 0, 2, -2], 8000);
    const view = new DataView(encodeWav(buf));
    // Samples start at byte 44; int16 little-endian.
    expect(view.getInt16(44, true)).toBe(0x7fff); // +1.0
    expect(view.getInt16(46, true)).toBe(-0x8000); // -1.0 → 0x8000
    expect(view.getInt16(48, true)).toBe(0); // 0
    expect(view.getInt16(50, true)).toBe(0x7fff); // +2.0 clamps to +1.0
    expect(view.getInt16(52, true)).toBe(-0x8000); // -2.0 clamps to -1.0
  });

  it('interleaves stereo as L,R,L,R', () => {
    const buf = makeStereo([1, 0], [-1, 0], 8000);
    const view = new DataView(encodeWav(buf));
    expect(view.getInt16(44, true)).toBe(0x7fff); // L[0] = +1
    expect(view.getInt16(46, true)).toBe(-0x8000); // R[0] = -1
    expect(view.getInt16(48, true)).toBe(0); // L[1] = 0
    expect(view.getInt16(50, true)).toBe(0); // R[1] = 0
  });

  it('round-trips float32 bit-exact', () => {
    const buf = makeMono([0.25, -0.5, 1, -1], 8000);
    const view = new DataView(encodeWav(buf, { format: 'float32' }));
    expect(view.getUint16(20, true)).toBe(3); // AudioFormat = 3 (float)
    expect(view.getUint16(34, true)).toBe(32); // bitsPerSample
    expect(view.getFloat32(44, true)).toBe(0.25);
    expect(view.getFloat32(48, true)).toBe(-0.5);
    expect(view.getFloat32(52, true)).toBe(1);
    expect(view.getFloat32(56, true)).toBe(-1);
  });

  it('encodes an empty buffer as a header with zero data', () => {
    const buf = makeMono([], 8000);
    const bytes = encodeWav(buf);
    const view = new DataView(bytes);
    expect(bytes.byteLength).toBe(44);
    expect(view.getUint32(40, true)).toBe(0); // data size
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm --filter @audiosandbox/engine test wav`
Expected: PASS (all cases) — Task 1's implementation already covers these. If any fail, fix `wav.ts` (do not weaken the test).

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/io/wav.test.ts
git commit -m "test(engine): encodeWav sample values, stereo, float32, empty"
```

---

## Task 3: `io/index.ts` + wire into package entry

**Files:**
- Create: `packages/engine/src/io/index.ts`
- Modify: `packages/engine/src/index.ts`

- [ ] **Step 1: Create the io barrel**

Create `packages/engine/src/io/index.ts`:

```ts
export { encodeWav, type WavOptions } from './wav.js';
```

- [ ] **Step 2: Add an `io` section to the package entry**

In `packages/engine/src/index.ts`, after the `// buffer-ops (...)` export block, add:

```ts
// io (encode rendered audio to file bytes)
export { encodeWav, type WavOptions } from './io/index.js';
```

- [ ] **Step 3: Verify it builds and type-checks**

Run: `pnpm --filter @audiosandbox/engine typecheck && pnpm --filter @audiosandbox/engine test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/io/index.ts packages/engine/src/index.ts
git commit -m "feat(engine): export io/encodeWav from the package entry"
```

---

## Task 4: Render plan — types + window cropping for one clip

**Files:**
- Create: `packages/engine/src/render/plan.ts`
- Test: `packages/engine/src/render/plan.test.ts`

This task defines all the plan types and the per-clip scheduling math (the trickiest pure logic). Gain resolution comes in Task 5.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/render/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createClip, createProject, createTrack } from '../model/project.js';
import { makeMono } from '../test-helpers.js';
import { resolveRenderPlan } from './plan.js';

/** A 1-second mono buffer (8000 frames @ 8000 Hz) of constant value. */
function oneSec(value = 1): AudioBuffer {
  return makeMono(new Array(8000).fill(value), 8000);
}

describe('resolveRenderPlan — window + scheduling', () => {
  it('schedules a single clip at its start over the full project window', () => {
    const clip = createClip(oneSec(), 'a', 2); // starts at t=2s, 1s long → ends at 3s
    const project = createProject('p', [createTrack('T1', [clip])]);
    const plan = resolveRenderPlan(project);

    expect(plan.start).toBe(0);
    expect(plan.end).toBe(3); // projectDuration
    expect(plan.sampleRate).toBe(8000);
    expect(plan.channels).toBe(2);
    expect(plan.lengthSamples).toBe(3 * 8000);
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0]!.clips).toHaveLength(1);
    expect(plan.tracks[0]!.clips[0]).toMatchObject({ when: 2, offset: 0, duration: 1 });
  });

  it('crops a clip that straddles the window start (offset into the buffer)', () => {
    const clip = createClip(oneSec(), 'a', 0); // 0..1s
    const project = createProject('p', [createTrack('T1', [clip])]);
    const plan = resolveRenderPlan(project, { start: 0.25, end: 0.75 });

    expect(plan.start).toBe(0.25);
    expect(plan.end).toBe(0.75);
    expect(plan.lengthSamples).toBe(Math.round(0.5 * 8000));
    const sched = plan.tracks[0]!.clips[0]!;
    expect(sched.when).toBeCloseTo(0); // clip already playing at window start
    expect(sched.offset).toBeCloseTo(0.25); // skip first 0.25s of the buffer
    expect(sched.duration).toBeCloseTo(0.5); // only the windowed half plays
  });

  it('drops clips entirely outside the window', () => {
    const inside = createClip(oneSec(), 'in', 0); // 0..1
    const outside = createClip(oneSec(), 'out', 5); // 5..6
    const project = createProject('p', [createTrack('T1', [inside, outside])]);
    const plan = resolveRenderPlan(project, { start: 0, end: 1 });
    expect(plan.tracks[0]!.clips).toHaveLength(1);
    expect(plan.tracks[0]!.clips[0]!.when).toBe(0);
  });

  it('returns an empty plan for a project with no clips', () => {
    const project = createProject('p', [createTrack('T1', [])]);
    const plan = resolveRenderPlan(project);
    expect(plan.lengthSamples).toBe(0);
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0]!.clips).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @audiosandbox/engine test plan`
Expected: FAIL — cannot resolve `./plan.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/engine/src/render/plan.ts`:

```ts
/**
 * Pure resolution of a render plan: the export window, output dimensions, the included-track
 * set, each track's effective gain, and each clip's scheduling (when/offset/duration) within
 * the window. No AudioContext — so all the logic the Renderer relies on is unit-testable.
 */
import { anyTrackSoloed, isTrackAudible, projectDuration } from '../model/project.js';
import type { Project, Track } from '../model/types.js';

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
  /** Output sample rate (Hz). Default = inferred from the first clip's buffer, else 44100. */
  sampleRate?: number;
  /** Output channel count. Default 2 (stereo). */
  channels?: number;
}

/** One clip scheduled into the offline render. */
export interface ScheduledClip {
  buffer: AudioBuffer;
  /** When to start, in seconds from the window origin (>= 0). */
  when: number;
  /** Offset into the source buffer (seconds). */
  offset: number;
  /** How long to play (seconds). */
  duration: number;
}

/** A track's contribution to a render. */
export interface TrackPlan {
  trackId: string;
  /** Effective linear gain after solo/mute/unity/override resolution. */
  gain: number;
  clips: ScheduledClip[];
}

/** The fully resolved render plan. */
export interface RenderPlan {
  sampleRate: number;
  channels: number;
  lengthSamples: number;
  start: number;
  end: number;
  tracks: TrackPlan[];
}

/** Infer the output sample rate from the first clip found, falling back to 44100. */
function inferSampleRate(project: Project): number {
  for (const track of project.tracks) {
    const clip = track.clips[0];
    if (clip) return clip.buffer.sampleRate;
  }
  return 44100;
}

/** Schedule a single clip into [start, end), or null if it doesn't intersect the window. */
function scheduleClip(
  clipStart: number,
  buffer: AudioBuffer,
  start: number,
  end: number,
): ScheduledClip | null {
  const clipEnd = clipStart + buffer.duration;
  const from = Math.max(clipStart, start);
  const to = Math.min(clipEnd, end);
  if (to <= from) return null; // no overlap with the window
  return {
    buffer,
    when: from - start, // window-relative start
    offset: from - clipStart, // skip into the buffer if the window starts mid-clip
    duration: to - from,
  };
}

export function resolveRenderPlan(
  project: Project,
  options: RenderOptions = {},
  onlyTrackId?: string,
): RenderPlan {
  const start = options.start ?? 0;
  const end = options.end ?? projectDuration(project);
  const sampleRate = options.sampleRate ?? inferSampleRate(project);
  const channels = options.channels ?? 2;
  const windowLength = Math.max(0, end - start);
  const lengthSamples = Math.round(windowLength * sampleRate);

  const sourceTracks = onlyTrackId
    ? project.tracks.filter((t) => t.id === onlyTrackId)
    : project.tracks;
  const anySoloed = anyTrackSoloed(project.tracks);

  const tracks: TrackPlan[] = [];
  for (const track of sourceTracks) {
    const gain = effectiveGain(track, anySoloed, options, onlyTrackId === track.id);
    if (gain === null) continue; // not included in this render
    const clips: ScheduledClip[] = [];
    for (const clip of track.clips) {
      const sched = scheduleClip(clip.start, clip.buffer, start, end);
      if (sched) clips.push(sched);
    }
    tracks.push({ trackId: track.id, gain, clips });
  }

  return { sampleRate, channels, lengthSamples, start, end, tracks };
}

/**
 * The effective linear gain for a track in this render, or `null` if the track is excluded.
 * Precedence (low→high): solo/mute audibility → includeMuted → unityGain → per-track override.
 * `isOnlyStem` means this track was explicitly requested via onlyTrackId, so it ignores other
 * tracks' solo state (but still respects its own muted/override unless includeMuted).
 */
function effectiveGain(
  track: Track,
  anySoloed: boolean,
  options: RenderOptions,
  isOnlyStem: boolean,
): number | null {
  const override = options.overrides?.get(track.id);
  const muted = override?.muted ?? track.muted;

  // Audibility: an explicit single-stem render ignores other tracks' solo.
  let audible: boolean;
  if (muted && !options.includeMuted) {
    audible = false;
  } else if (isOnlyStem) {
    audible = true;
  } else {
    audible = isTrackAudible({ muted: false, soloed: track.soloed }, anySoloed);
    // (muted already handled above; pass muted:false so only solo logic applies here)
  }
  if (!audible) return null;

  if (override?.gain !== undefined) return override.gain;
  if (options.unityGain) return 1;
  return track.gain;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @audiosandbox/engine test plan`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/render/plan.ts packages/engine/src/render/plan.test.ts
git commit -m "feat(engine): resolveRenderPlan — window cropping + clip scheduling"
```

---

## Task 5: Render plan — mute / solo / unity / includeMuted / overrides

**Files:**
- Modify: `packages/engine/src/render/plan.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/src/render/plan.test.ts`:

```ts
import type { Track } from '../model/types.js';

/** A track with one full-window 1s clip and explicit mixer state. */
function trackWith(
  name: string,
  state: Partial<Pick<Track, 'gain' | 'muted' | 'soloed'>> = {},
): Track {
  const t = createTrack(name, [createClip(oneSec(), name, 0)]);
  return { ...t, ...state };
}

/** Find a track's plan entry by name (tracks keep model order). */
function gainOf(plan: ReturnType<typeof resolveRenderPlan>, index: number): number | undefined {
  return plan.tracks[index]?.gain;
}

describe('resolveRenderPlan — mixer resolution', () => {
  it('uses each track gain by default', () => {
    const project = createProject('p', [trackWith('A', { gain: 0.5 }), trackWith('B', { gain: 0.8 })]);
    const plan = resolveRenderPlan(project);
    expect(plan.tracks).toHaveLength(2);
    expect(gainOf(plan, 0)).toBe(0.5);
    expect(gainOf(plan, 1)).toBe(0.8);
  });

  it('excludes muted tracks', () => {
    const project = createProject('p', [trackWith('A', { muted: true }), trackWith('B')]);
    const plan = resolveRenderPlan(project);
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0]!.trackId).toBe(project.tracks[1]!.id);
  });

  it('includes muted tracks when includeMuted is set', () => {
    const project = createProject('p', [trackWith('A', { muted: true, gain: 0.3 })]);
    const plan = resolveRenderPlan(project, { includeMuted: true });
    expect(plan.tracks).toHaveLength(1);
    expect(gainOf(plan, 0)).toBe(0.3);
  });

  it('renders only soloed tracks when any track is soloed', () => {
    const project = createProject('p', [trackWith('A', { soloed: true }), trackWith('B')]);
    const plan = resolveRenderPlan(project);
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0]!.trackId).toBe(project.tracks[0]!.id);
  });

  it('forces unity gain on included tracks when unityGain is set', () => {
    const project = createProject('p', [trackWith('A', { gain: 0.2 }), trackWith('B', { gain: 0.9 })]);
    const plan = resolveRenderPlan(project, { unityGain: true });
    expect(gainOf(plan, 0)).toBe(1);
    expect(gainOf(plan, 1)).toBe(1);
  });

  it('applies per-track overrides last (gain wins over unityGain)', () => {
    const project = createProject('p', [trackWith('A', { gain: 0.2 })]);
    const overrides = new Map([[project.tracks[0]!.id, { gain: 0.42 }]]);
    const plan = resolveRenderPlan(project, { unityGain: true, overrides });
    expect(gainOf(plan, 0)).toBe(0.42);
  });

  it('an override can un-mute a track', () => {
    const project = createProject('p', [trackWith('A', { muted: true, gain: 0.7 })]);
    const overrides = new Map([[project.tracks[0]!.id, { muted: false }]]);
    const plan = resolveRenderPlan(project, { overrides });
    expect(plan.tracks).toHaveLength(1);
    expect(gainOf(plan, 0)).toBe(0.7);
  });

  it('onlyTrackId renders a single track even past another track being soloed', () => {
    const project = createProject('p', [trackWith('A', { soloed: true }), trackWith('B', { gain: 0.6 })]);
    const planB = resolveRenderPlan(project, {}, project.tracks[1]!.id);
    expect(planB.tracks).toHaveLength(1);
    expect(planB.tracks[0]!.trackId).toBe(project.tracks[1]!.id);
    expect(gainOf(planB, 0)).toBe(0.6);
  });

  it('onlyTrackId still excludes the track if it is muted', () => {
    const project = createProject('p', [trackWith('A', { muted: true })]);
    const plan = resolveRenderPlan(project, {}, project.tracks[0]!.id);
    expect(plan.tracks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm --filter @audiosandbox/engine test plan`
Expected: PASS — Task 4's `effectiveGain` already implements this. If any fail, fix `plan.ts` (not the tests).

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/render/plan.test.ts
git commit -m "test(engine): render plan mute/solo/unity/includeMuted/override resolution"
```

---

## Task 6: `Renderer` class (OfflineAudioContext wiring)

**Files:**
- Create: `packages/engine/src/render/renderer.ts`

No unit test — `OfflineAudioContext` is unavailable in the node test env; this shell is verified in 11-b's browser E2E. All decision logic is already tested via `resolveRenderPlan`.

- [ ] **Step 1: Write the implementation**

Create `packages/engine/src/render/renderer.ts`:

```ts
/**
 * Renderer: mixes a Project down through OfflineAudioContext to one or more AudioBuffers.
 *
 * This is the only export code that touches Web Audio. All decisions (window, gains, included
 * tracks, clip scheduling) are made by the pure `resolveRenderPlan`; this class only wires the
 * resolved plan into an offline graph and renders it. It is verified in the app's browser E2E
 * (the node test env has no OfflineAudioContext), while the plan carries full unit coverage.
 *
 * Graph per render: for each track plan, clip sources → trackGain(plan.gain) → destination.
 */
import type { Project } from '../model/types.js';
import { resolveRenderPlan, type RenderOptions, type RenderPlan } from './plan.js';

export class Renderer {
  readonly #project: Project;
  readonly #options: RenderOptions;

  constructor(project: Project, options: RenderOptions = {}) {
    this.#project = project;
    this.#options = options;
  }

  /** Render the full mix (all included tracks summed) to one AudioBuffer. */
  renderMix(): Promise<AudioBuffer> {
    return this.#renderPlan(resolveRenderPlan(this.#project, this.#options));
  }

  /** Render a single track in isolation to one AudioBuffer. */
  renderStem(trackId: string): Promise<AudioBuffer> {
    return this.#renderPlan(resolveRenderPlan(this.#project, this.#options, trackId));
  }

  /** Render every included track to its own buffer, keyed by track id. */
  async renderStems(): Promise<Map<string, AudioBuffer>> {
    // Resolve the mix plan to learn which tracks are included, then render each alone.
    const mixPlan = resolveRenderPlan(this.#project, this.#options);
    const entries = await Promise.all(
      mixPlan.tracks.map(async (t): Promise<[string, AudioBuffer]> => {
        const plan = resolveRenderPlan(this.#project, this.#options, t.trackId);
        return [t.trackId, await this.#renderPlan(plan)];
      }),
    );
    return new Map(entries);
  }

  /** Build an OfflineAudioContext from a resolved plan, schedule it, and render. */
  async #renderPlan(plan: RenderPlan): Promise<AudioBuffer> {
    // OfflineAudioContext requires length >= 1; a zero-length window renders a 1-frame
    // (effectively silent) buffer that the caller can ignore or the encoder emits as ~empty.
    const length = Math.max(1, plan.lengthSamples);
    const ctx = new OfflineAudioContext(plan.channels, length, plan.sampleRate);

    for (const track of plan.tracks) {
      const trackGain = ctx.createGain();
      trackGain.gain.value = track.gain;
      trackGain.connect(ctx.destination);

      for (const clip of track.clips) {
        const source = ctx.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(trackGain);
        source.start(clip.when, clip.offset, clip.duration);
      }
    }

    return ctx.startRendering();
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm --filter @audiosandbox/engine typecheck`
Expected: clean (no errors). `OfflineAudioContext` / `AudioBuffer` come from the DOM lib types already used across the engine.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/render/renderer.ts
git commit -m "feat(engine): Renderer — OfflineAudioContext mix/stem rendering"
```

---

## Task 7: `render/index.ts` + wire into package entry

**Files:**
- Create: `packages/engine/src/render/index.ts`
- Modify: `packages/engine/src/index.ts`

- [ ] **Step 1: Create the render barrel**

Create `packages/engine/src/render/index.ts`:

```ts
export { Renderer } from './renderer.js';
export {
  resolveRenderPlan,
  type RenderOptions,
  type RenderPlan,
  type ScheduledClip,
  type TrackOverride,
  type TrackPlan,
} from './plan.js';
```

- [ ] **Step 2: Add a `render` section to the package entry**

In `packages/engine/src/index.ts`, after the `// io (...)` block from Task 3, add:

```ts
// render (offline OfflineAudioContext mix-down + stems)
export {
  Renderer,
  resolveRenderPlan,
  type RenderOptions,
  type RenderPlan,
  type ScheduledClip,
  type TrackOverride,
  type TrackPlan,
} from './render/index.js';
```

- [ ] **Step 3: Verify build, typecheck, and full test run**

Run: `pnpm --filter @audiosandbox/engine typecheck && pnpm --filter @audiosandbox/engine build && pnpm --filter @audiosandbox/engine test`
Expected: typecheck clean; build emits ESM + `.d.ts`; all tests pass (engine count rises by the new wav + plan tests).

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/render/index.ts packages/engine/src/index.ts
git commit -m "feat(engine): export render (Renderer + resolveRenderPlan) from the package entry"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run the whole repo test + build**

Run: `pnpm -r test && pnpm --filter @audiosandbox/engine build`
Expected: all engine + app tests green; engine builds clean.

- [ ] **Step 2: Confirm the engine/app boundary held**

Run: `grep -rn "svelte\|document\|window\.\|canvas" packages/engine/src/io packages/engine/src/render`
Expected: no matches (no UI/DOM leaked into the engine).

- [ ] **Step 3 (optional): squash to one commit per the project's git workflow**

The CLAUDE.md workflow lands each feature as one commit. If desired, interactive-free squash via reset:

```bash
git reset --soft $(git merge-base HEAD main)
git commit -m "feat(engine): Step 11-a export — OfflineAudioContext render + WAV encode"
```

(Keep the design-doc commit separate if you prefer; otherwise it folds in too.)

---

## Self-Review notes (author)

- **Spec coverage:** `encodeWav` int16/float32/empty/stereo (Tasks 1–2); `resolveRenderPlan` window/scheduling (Task 4) + full mixer matrix incl. `onlyTrackId` (Task 5); `Renderer` mix/stem/stems (Task 6); package exports (Tasks 3, 7); boundary + build verification (Task 8). Pan/effects/MP3/OGG/UI are explicitly out of scope per the spec.
- **No real Web Audio in tests:** all pure logic in `plan.ts` + `wav.ts`; `renderer.ts` deferred to 11-b browser E2E — matches the spec's testing section.
- **Type consistency:** `RenderOptions`, `RenderPlan`, `TrackPlan`, `ScheduledClip`, `TrackOverride`, `resolveRenderPlan`, `Renderer` names are identical across plan.ts, renderer.ts, both index.ts, and the package entry.
