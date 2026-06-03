<script lang="ts">
  import type { Studio } from '../lib/studio.svelte.js';

  interface Props {
    studio: Studio;
  }

  let { studio }: Props = $props();

  // Format seconds as MM:SS.mmm to match the sketch's time display.
  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return (
      `${String(m).padStart(2, '0')}:` +
      `${String(s).padStart(2, '0')}.` +
      `${String(ms).padStart(3, '0')}`
    );
  }

  let isPlaying = $derived(studio.transportState === 'playing');
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
      onclick={() => (isPlaying ? studio.pause() : studio.play())}
    >
      {isPlaying ? '❚❚' : '▶'}
    </button>
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
