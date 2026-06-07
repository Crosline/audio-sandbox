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

  // The track's full extent: the right edge of its furthest clip. 0 when empty.
  let laneWidth = $derived(
    track.clips.reduce(
      (w, c) => Math.max(w, studio.timeToPx(c.start + c.buffer.duration)),
      0,
    ),
  );

  // The time-range highlight, only when the current selection belongs to a clip on this track.
  function selFor(clipId: string) {
    const s = studio.selection;
    return s && s.clipId === clipId ? s : null;
  }
  function isObjectSelected(clipId: string): boolean {
    return studio.selectedClip?.trackId === track.id && studio.selectedClip?.clipId === clipId;
  }

  const DRAG_THRESHOLD = 3;
  let lane: HTMLDivElement;

  // Per-gesture state (one pointer at a time).
  let pressX = 0; // x within the lane (px)
  let grabInClip = 0; // x within the pressed clip (px) — the drag handle offset
  let pressClipId: string | null = null;
  let pressWasSelected = false;
  let dragging = false;
  let pointerDown = false;

  function laneX(e: PointerEvent): number {
    return e.clientX - lane.getBoundingClientRect().left;
  }

  function onClipPointerDown(e: PointerEvent, clip: { id: string; start: number }): void {
    if (e.button !== 0) return;
    e.stopPropagation(); // don't let the lane background also handle it (that path seeks)
    pointerDown = true;
    dragging = false;
    pressClipId = clip.id;
    pressWasSelected = isObjectSelected(clip.id);
    pressX = laneX(e);
    grabInClip = pressX - studio.timeToPx(clip.start);
    try {
      lane.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointerDown || !pressClipId) return;
    const x = laneX(e);
    if (!dragging && Math.abs(x - pressX) < DRAG_THRESHOLD) return;
    dragging = true;
    if (pressWasSelected) {
      // Drag-move the already-selected clip: keep the grab point under the cursor.
      studio.moveClip(track.id, pressClipId, studio.pxToTime(x - grabInClip));
    } else {
      // Drag on a not-yet-object-selected clip → time-range select on that clip.
      const clip = track.clips.find((c) => c.id === pressClipId);
      if (!clip) return;
      const pressT = studio.pxToTime(pressX) - clip.start;
      const t = studio.pxToTime(x) - clip.start;
      studio.setSelection({
        trackId: track.id,
        clipId: pressClipId,
        start: Math.min(pressT, t),
        end: Math.max(pressT, t),
      });
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!pointerDown) return;
    pointerDown = false;
    try {
      lane.releasePointerCapture(e.pointerId);
    } catch {
      /* never captured */
    }
    if (!dragging && pressClipId) {
      // Click on a clip → select it AND move the playhead to the exact clicked point.
      const clip = track.clips.find((c) => c.id === pressClipId);
      const atSeconds = clip ? clip.start + studio.pxToTime(grabInClip) : undefined;
      studio.selectClip(track.id, pressClipId, atSeconds);
    }
    studio.endClipMove(); // close any drag-move gesture so its undo is one step
    dragging = false;
    pressClipId = null;
  }

  // Click on the lane *background* (not on a clip box) → clear object-selection and seek.
  function onLaneBackgroundDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    studio.clearSelectedClip();
    studio.clearSelection();
    studio.lastTrackId = track.id;
    studio.seek(studio.pxToTime(laneX(e)));
  }
</script>

<div class="flex border-b border-[var(--color-border)]" data-track-id={track.id}>
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

  <!-- Waveform lane — full track width; clips are positioned boxes. Background click seeks. -->
  <div
    bind:this={lane}
    class="relative h-24 bg-[var(--color-bg)] {track.clips.length ? 'cursor-text' : ''}"
    style="width: {laneWidth}px"
    role="presentation"
    onpointerdown={onLaneBackgroundDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
  >
    {#each track.clips as clip (clip.id)}
      <div
        class="absolute inset-y-0 overflow-hidden rounded-sm {isObjectSelected(clip.id)
          ? 'border-2 border-[var(--color-accent)] cursor-grab'
          : 'border border-[var(--color-border)]'}"
        style="left: {studio.timeToPx(clip.start)}px; width: {studio.timeToPx(
          clip.buffer.duration,
        )}px"
        data-testid="clip"
        data-clip-id={clip.id}
        role="presentation"
        onpointerdown={(e) => onClipPointerDown(e, clip)}
      >
        <Waveform buffer={clip.buffer} width={studio.timeToPx(clip.buffer.duration)} {color} height={96} />
        {#if selFor(clip.id)}
          {@const sel = selFor(clip.id)!}
          <div
            class="pointer-events-none absolute inset-y-0 border-x border-[var(--color-accent)] bg-[var(--color-accent)]/25"
            data-testid="selection"
            style="left: {studio.timeToPx(sel.start)}px; width: {Math.max(
              1,
              studio.timeToPx(sel.end - sel.start),
            )}px"
          ></div>
        {/if}
      </div>
    {/each}
  </div>
</div>
