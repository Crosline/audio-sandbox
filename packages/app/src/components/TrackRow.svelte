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

  // The selection highlight, but only when the current selection belongs to *this* clip.
  let sel = $derived(
    clip && studio.selection?.clipId === clip.id ? studio.selection : null,
  );

  // ---- drag-to-select / click-to-seek ----
  // A press that never moves past DRAG_THRESHOLD px is a click (seek); past it, a drag
  // (select). Times are measured relative to the clip's own origin via pxToTime.
  const DRAG_THRESHOLD = 3;
  let lane: HTMLDivElement;
  let pressX = 0;
  let pressTime = 0;
  let dragging = false;
  let pointerDown = false;

  function localX(e: PointerEvent): number {
    return e.clientX - lane.getBoundingClientRect().left;
  }

  function onPointerDown(e: PointerEvent): void {
    if (!clip || e.button !== 0) return;
    pointerDown = true;
    dragging = false;
    pressX = localX(e);
    pressTime = studio.pxToTime(pressX);
    try {
      lane.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety; selection still works without it */
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointerDown || !clip) return;
    const x = localX(e);
    if (!dragging && Math.abs(x - pressX) < DRAG_THRESHOLD) return;
    dragging = true;
    const t = studio.pxToTime(x);
    studio.setSelection({
      trackId: track.id,
      clipId: clip.id,
      start: Math.min(pressTime, t),
      end: Math.max(pressTime, t),
    });
  }

  function onPointerUp(e: PointerEvent): void {
    if (!pointerDown || !clip) return;
    pointerDown = false;
    try {
      lane.releasePointerCapture(e.pointerId);
    } catch {
      /* never captured — ignore */
    }
    if (!dragging) {
      // Click: seek to this point (absolute timeline second) and clear any selection.
      studio.clearSelection();
      studio.seek(clip.start + pressTime);
    }
    dragging = false;
  }
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

  <!-- Waveform lane — real width from clip duration; drag to select, click to seek.
       Empty tracks render no prompt (the global empty state owns that message). -->
  <div
    bind:this={lane}
    class="relative h-24 bg-[var(--color-bg)] {clip ? 'cursor-text' : ''}"
    style="width: {laneWidth}px"
    role="presentation"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
  >
    {#if clip}
      <Waveform buffer={clip.buffer} width={laneWidth} {color} height={96} />
      {#if sel}
        <!-- Selection highlight: an overlay div (not on the canvas), so the cached waveform
             draw path and its 32000px backing-store cap are untouched. -->
        <div
          class="pointer-events-none absolute inset-y-0 border-x border-[var(--color-accent)] bg-[var(--color-accent)]/25"
          data-testid="selection"
          style="left: {studio.timeToPx(sel.start)}px; width: {Math.max(
            1,
            studio.timeToPx(sel.end - sel.start),
          )}px"
        ></div>
      {/if}
    {/if}
  </div>
</div>
