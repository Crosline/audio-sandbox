<script lang="ts">
  import type { Studio } from '../lib/studio.svelte.js';
  import { formatTime } from '../lib/time.js';

  interface Props {
    studio: Studio;
  }

  let { studio }: Props = $props();

  let isPlaying = $derived(studio.transportState === 'playing');
  let sel = $derived(studio.selection);
</script>

<div
  class="flex items-center gap-4 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3"
>
  <div class="flex items-center gap-2">
    <button
      class="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-muted)] transition hover:text-white"
      title="Stop"
      onclick={() => studio.stop()}
    >
      ■
    </button>
    <button
      class="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] text-lg text-white shadow-lg transition hover:brightness-110"
      title={isPlaying ? 'Pause' : 'Play'}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      onclick={() => (isPlaying ? studio.pause() : studio.play())}
    >
      {isPlaying ? '❚❚' : '▶'}
    </button>
  </div>

  <!-- Selection readout, next to the transport. -->
  <div class="min-w-44 text-xs tabular-nums text-[var(--color-muted)]" data-testid="selection-readout">
    {#if sel && sel.end > sel.start}
      <span class="text-[var(--color-text)]">Sel</span>
      {formatTime(sel.start)} → {formatTime(sel.end)}
      <span class="text-[var(--color-text)]">· {(sel.end - sel.start).toFixed(3)}s</span>
    {:else}
      No selection
    {/if}
  </div>

  <div class="flex-1 text-center">
    <span class="font-mono text-2xl tracking-wider tabular-nums">
      {formatTime(studio.playhead)}
    </span>
    <span class="ml-3 text-xs text-[var(--color-muted)]">
      {studio.project.bpm} BPM · {studio.project.timeSignature[0]}/{studio.project
        .timeSignature[1]}
    </span>
  </div>

  <div class="flex items-center gap-2">
    <span class="text-[var(--color-muted)]">🔊</span>
    <input
      type="range"
      min="0"
      max="100"
      value={studio.masterVolume}
      class="h-1 w-32 accent-[var(--color-accent)]"
      oninput={(e) => studio.setMasterVolume(Number(e.currentTarget.value))}
    />
    <span class="w-7 text-right text-xs text-[var(--color-muted)]">
      {studio.masterVolume}
    </span>
  </div>
</div>
