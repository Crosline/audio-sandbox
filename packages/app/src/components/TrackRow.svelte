<script lang="ts">
  import type { Track } from '@audiosandbox/engine';
  import type { Studio } from '../lib/studio.svelte.js';
  import Waveform from './Waveform.svelte';

  interface Props {
    studio: Studio;
    track: Track;
    /** Accent color for this track's waveform. */
    color: string;
  }

  let { studio, track, color }: Props = $props();

  // For now a track shows its first clip's waveform (multi-clip layout comes later).
  let clip = $derived(track.clips[0]);

  // Real width = clip duration × the timeline scale, so longer clips are wider and can
  // overflow the viewport (the parent scrolls). 96px tall to match the waveform height.
  let laneWidth = $derived(clip ? studio.timeToPx(clip.buffer.duration) : 0);
</script>

<div class="flex border-b border-[var(--color-border)]">
  <!-- Track header — pinned to the left while the lane scrolls horizontally. -->
  <div
    class="sticky left-0 z-20 flex w-44 shrink-0 flex-col gap-2 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3"
  >
    <div class="flex items-center justify-between">
      <span class="text-sm font-medium">{track.name}</span>
      <div class="flex gap-1">
        <button
          class="grid h-6 w-6 place-items-center rounded text-xs font-semibold transition
            {track.muted
            ? 'bg-[var(--color-accent-2)] text-white'
            : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'}"
          title="Mute"
          onclick={() => studio.toggleMute(track.id)}
        >
          M
        </button>
        <button
          class="grid h-6 w-6 place-items-center rounded text-xs font-semibold transition
            {track.soloed
            ? 'bg-[var(--color-accent-3)] text-black'
            : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'}"
          title="Solo"
          onclick={() => studio.toggleSolo(track.id)}
        >
          S
        </button>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={track.gain}
        class="h-1 w-full accent-[var(--color-accent)]"
        oninput={(e) => studio.setTrackGain(track.id, Number(e.currentTarget.value))}
      />
      <span class="w-6 text-right text-xs text-[var(--color-muted)]">
        {Math.round(track.gain * 100)}
      </span>
    </div>
  </div>

  <!-- Waveform lane — real width from clip duration; empty tracks render no prompt
       (the global empty state owns that message). -->
  <div class="relative h-24 bg-[var(--color-bg)]" style="width: {laneWidth}px">
    {#if clip}
      <Waveform buffer={clip.buffer} width={laneWidth} {color} height={96} />
    {/if}
  </div>
</div>
