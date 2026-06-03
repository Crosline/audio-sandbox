# @audiosandbox/engine

Framework-agnostic browser audio engine built on the Web Audio API. It powers
[Audio Sandbox](https://github.com/Crosline/audiosandbox), but has **zero UI, DOM, or
framework dependencies** — so you can drive it from Svelte, React, Vue, or vanilla JS.

The engine **produces data** (waveform peaks, FFT bins, levels, state-change events) and
**accepts commands** (edit buffers, build effect chains, play, export). Your UI subscribes and
renders; the engine never touches the DOM.

> Status: early. The public API is still taking shape (v0.x).

## Install

```bash
pnpm add @audiosandbox/engine
```

## Using it from any framework

The engine exposes a plain API plus an event emitter. Each framework just mirrors engine
events into its own reactivity.

### Vanilla

```ts
import { clamp } from '@audiosandbox/engine';

clamp(42, 0, 10); // 10
```

### React

React mirrors engine state with `useSyncExternalStore` — no framework code lives in the engine.

```tsx
import { useSyncExternalStore } from 'react';
// import { createEngine } from '@audiosandbox/engine'; // (coming in a later release)

// const engine = createEngine();
//
// function usePlayhead() {
//   return useSyncExternalStore(
//     (cb) => engine.on('playhead', cb),   // subscribe → returns an unsubscribe fn
//     () => engine.getPlayhead(),          // read current snapshot
//   );
// }
```

### Svelte 5

```svelte
<script lang="ts">
  // import { createEngine } from '@audiosandbox/engine';
  // const engine = createEngine();
  // let playhead = $state(engine.getPlayhead());
  // $effect(() => engine.on('playhead', (t) => (playhead = t)));
</script>
```

## License

MIT
