<script lang="ts">
  import type { Studio } from '../lib/studio.svelte.js';
  import { formatTime } from '../lib/time.js';
  import Icon from './Icon.svelte';

  interface Props {
    studio: Studio;
    fxOpen?: boolean;
    onToggleFx?: () => void;
  }

  let { studio, fxOpen = false, onToggleFx }: Props = $props();

  let isPlaying = $derived(studio.transportState === 'playing');
  let sel = $derived(studio.selection);
</script>

<div
  class="flex items-center gap-4 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
>
  <!-- LEFT: timecode + selection readout -->
  <div class="flex flex-col gap-0.5">
    <!-- Big timecode -->
    <span
      class="font-mono text-2xl tabular-nums"
      data-testid="timecode"
      style={isPlaying ? 'text-shadow: 0 0 12px rgba(255,107,61,.5)' : ''}
    >
      {formatTime(studio.playhead)}
    </span>
    <!-- Selection readout chip -->
    <div
      class="font-mono min-w-44 text-xs tabular-nums text-[var(--color-muted)]"
      data-testid="selection-readout"
    >
      {#if sel && sel.end > sel.start}
        <span class="text-[var(--color-text)]">Sel</span>
        {formatTime(sel.start)} → {formatTime(sel.end)}
        <span class="text-[var(--color-text)]">· {(sel.end - sel.start).toFixed(3)}s</span>
      {:else}
        No selection
      {/if}
    </div>
  </div>

  <!-- CENTER: transport controls -->
  <div class="flex flex-1 items-center justify-center gap-3">
    <!-- Stop button: smaller ghost circle -->
    <button
      class="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)] transition-all duration-150 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px"
      title="Stop"
      aria-label="Stop"
      onclick={() => studio.stop()}
    >
      <Icon name="stop" size={14} />
    </button>

    <!-- Play/Pause: large circular button 40px -->
    <button
      class="flex h-10 w-10 items-center justify-center rounded-full transition-all duration-150 active:translate-y-px
        {isPlaying
          ? 'animate-signal-pulse border-0 bg-gradient-to-br from-[var(--color-accent-2)] to-[var(--color-accent)] text-[#0d0f15]'
          : 'border border-[var(--color-accent)]/60 bg-[var(--color-surface-2)] text-[var(--color-accent)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/10'}"
      title={isPlaying ? 'Pause' : 'Play'}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      onclick={() => (isPlaying ? studio.pause() : studio.play())}
    >
      {#if isPlaying}
        <Icon name="pause" size={18} />
      {:else}
        <Icon name="play" size={18} />
      {/if}
    </button>
  </div>

  <!-- RIGHT: BPM/time-sig chips + master volume + FX toggle -->
  <div class="flex items-center gap-3">
    <!-- BPM chip -->
    <span
      class="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-xs tabular-nums text-[var(--color-muted)]"
    >
      {studio.project.bpm} BPM
    </span>
    <!-- Time signature chip -->
    <span
      class="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-xs tabular-nums text-[var(--color-muted)]"
    >
      {studio.project.timeSignature[0]}/{studio.project.timeSignature[1]}
    </span>

    <!-- Master volume: icon + range + readout -->
    <div class="flex items-center gap-2">
      <Icon name="volume" size={16} class="shrink-0 text-[var(--color-muted)]" />
      <input
        type="range"
        min="0"
        max="100"
        value={studio.masterVolume}
        class="w-24"
        oninput={(e) => studio.setMasterVolume(Number(e.currentTarget.value))}
      />
      <span class="w-8 text-right font-mono text-xs tabular-nums text-[var(--color-muted)]">
        {studio.masterVolume}
      </span>
    </div>

    <!-- FX toggle button -->
    <button
      class="flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-all duration-150 active:translate-y-px
        {fxOpen
          ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]'}"
      title="{fxOpen ? 'Hide' : 'Show'} Pedalboard FX"
      aria-label="{fxOpen ? 'Hide' : 'Show'} Pedalboard FX"
      aria-pressed={fxOpen}
      onclick={onToggleFx}
    >
      <Icon name="sparkles" size={13} />
      FX
    </button>
  </div>
</div>
