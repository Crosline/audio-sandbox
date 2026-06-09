<script lang="ts">
  import { clipDuration, type Track } from '@audiosandbox/engine';
  import type { Studio } from '../lib/studio.svelte.js';
  import Waveform from './Waveform.svelte';

  interface Props {
    studio: Studio;
    track: Track;
    /** Accent color for this track's waveform. */
    color: string;
    onheightchange?: (trackId: string, height: number) => void;
  }

  let { studio, track, color, onheightchange }: Props = $props();

  // Track height: 96 (default) or 160 (expanded). Toggled by border-drag.
  let trackHeight = $state<96 | 160>(96);

  // Local copy of the track name for the editable input.
  let editName = $state(track.name);

  // Keep editName in sync if the track is renamed externally (e.g. auto-rename on import).
  $effect(() => { editName = track.name; });

  function commitName(): void {
    const trimmed = editName.trim() || 'Track';
    editName = trimmed;
    studio.renameTrack(track.id, trimmed);
  }

  // dB display helper.
  function gainToDb(gain: number): string {
    if (gain <= 0) return '−∞';
    return (20 * Math.log10(gain)).toFixed(1) + ' dB';
  }

  // Pan display helper.
  function panLabel(pan: number): string {
    if (Math.abs(pan) < 0.005) return 'C';
    return pan < 0
      ? Math.round(Math.abs(pan) * 100) + 'L'
      : Math.round(pan * 100) + 'R';
  }

  // Local pan value for center-snap.
  let panValue = $state(track.pan);
  $effect(() => { panValue = track.pan; });

  function onPanInput(raw: number): void {
    const snapped = Math.abs(raw) < 0.05 ? 0 : raw;
    panValue = snapped;
    studio.setPan(track.id, snapped);
  }

  // Height resize gesture.
  let resizeHandleDown = false;
  let resizePressY = 0;
  let resizePressHeight: 96 | 160 = 96;

  function onResizeHandlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    resizeHandleDown = true;
    resizePressY = e.clientY;
    resizePressHeight = trackHeight;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizeHandlePointerMove(e: PointerEvent): void {
    if (!resizeHandleDown) return;
    const dy = e.clientY - resizePressY;
    if (dy > 32) trackHeight = 160;
    else if (dy < -32) trackHeight = 96;
  }

  function onResizeHandlePointerUp(e: PointerEvent): void {
    if (!resizeHandleDown) return;
    resizeHandleDown = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (trackHeight !== resizePressHeight) {
      onheightchange?.(track.id, trackHeight);
    }
  }

  // The track's full extent: the right edge of its furthest clip (trim-aware). 0 when empty.
  let laneWidth = $derived(
    track.clips.reduce((w, c) => Math.max(w, studio.timeToPx(c.start + clipDuration(c))), 0),
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

  // Resize gesture state.
  let resizing: 'left' | 'right' | null = null;
  let resizeClipId: string | null = null;
  let resizePressX = 0;
  let resizeOrigTrim = 0; // the edge's trim at press time

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
    if (resizing) { onResizeMove(e); return; }
    if (!pointerDown || !pressClipId) return;
    const x = laneX(e);
    if (!dragging && Math.abs(x - pressX) < DRAG_THRESHOLD) return;
    dragging = true;
    if (pressWasSelected) {
      if (!studio.clipDrag) {
        studio.clipDrag = { fromTrackId: track.id, clipId: pressClipId, grabInClipPx: grabInClip };
      }
      // App's window listener positions the clip (it knows the row under the pointer).
      return;
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
    if (studio.clipDrag) { pointerDown = false; dragging = false; pressClipId = null; return; }
    if (resizing) { onResizeUp(e); return; }
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

  function onResizeDown(
    e: PointerEvent,
    clip: { id: string; start: number; buffer: AudioBuffer; trimStart?: number; trimEnd?: number },
    edge: 'left' | 'right',
  ): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    resizing = edge;
    resizeClipId = clip.id;
    resizePressX = laneX(e);
    resizeOrigTrim = (edge === 'left' ? clip.trimStart : clip.trimEnd) ?? 0;
    try {
      lane.setPointerCapture(e.pointerId);
    } catch {
      /* nicety */
    }
  }

  function onResizeMove(e: PointerEvent): void {
    if (!resizing || !resizeClipId) return;
    const dxSec = studio.pxToTime(laneX(e) - resizePressX);
    // Dragging the LEFT edge right (positive dx) ADDS head trim; the RIGHT edge left
    // (negative dx) ADDS tail trim. So left uses +dx, right uses -dx.
    const desiredTrim = resizeOrigTrim + (resizing === 'left' ? dxSec : -dxSec);
    studio.resizeClip(track.id, resizeClipId, resizing, desiredTrim);
  }

  function onResizeUp(e: PointerEvent): void {
    if (!resizing) return;
    resizing = null;
    resizeClipId = null;
    studio.endClipResize();
    try {
      lane.releasePointerCapture(e.pointerId);
    } catch {
      /* never captured */
    }
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

<div class="flex flex-col" data-track-id={track.id}>
  <!-- main track row: header + lane side by side -->
  <div class="flex">
    <!-- Track header — pinned to the left while the lane scrolls horizontally. -->
    <div
      class="sticky left-0 z-20 flex w-52 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] group overflow-hidden"
    >
      <!-- Row 1: editable name + delete -->
      <div class="flex items-center gap-1 px-2 pt-2">
        <input
          type="text"
          class="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-medium
                 outline-none ring-0 hover:bg-[var(--color-surface-2)]
                 focus:bg-[var(--color-surface-2)] focus:ring-1 focus:ring-[var(--color-accent)]
                 transition truncate"
          bind:value={editName}
          onblur={commitName}
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
        />
        <button
          class="grid h-6 w-6 shrink-0 place-items-center rounded text-xs font-semibold
                 opacity-0 transition group-hover:opacity-100
                 bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-accent-2)]"
          title="Delete track"
          aria-label="Delete track"
          data-testid="delete-track"
          onclick={() => studio.removeTrack(track.id)}
        >
          ✕
        </button>
      </div>

      <!-- Row 2: Volume -->
      <div class="flex items-center gap-1 px-2 pt-1">
        <span class="w-6 shrink-0 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">VOL</span>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.01"
          value={track.gain}
          class="h-1 flex-1 accent-[var(--color-accent)]"
          oninput={(e) => studio.setTrackGain(track.id, Number(e.currentTarget.value))}
        />
        <span class="w-16 shrink-0 text-left text-[10px] tabular-nums text-[var(--color-muted)]">
          {gainToDb(track.gain)}
        </span>
      </div>

      <!-- Row 3: Pan L/R -->
      <div class="flex items-center gap-1 px-2 pt-1 pb-2">
        <span class="w-6 shrink-0 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">L/R</span>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={panValue}
          class="h-1 flex-1 accent-[var(--color-accent)]"
          oninput={(e) => onPanInput(Number(e.currentTarget.value))}
        />
        <span class="w-10 shrink-0 text-left text-[10px] tabular-nums text-[var(--color-muted)]">
          {panLabel(panValue)}
        </span>
      </div>

      <!-- Row 4: M / S buttons -->
      <div class="flex items-center gap-1 px-2 pb-2">
        <button
          class="grid h-6 w-6 place-items-center rounded text-xs font-semibold transition
            {track.muted
              ? 'bg-[var(--color-accent-2)] text-white'
              : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'}"
          title="Mute"
          onclick={() => studio.toggleMute(track.id)}
        >M</button>
        <button
          class="grid h-6 w-6 place-items-center rounded text-xs font-semibold transition
            {track.soloed
              ? 'bg-[var(--color-accent-3)] text-black'
              : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'}"
          title="Solo"
          onclick={() => studio.toggleSolo(track.id)}
        >S</button>
      </div>
    </div>

    <!-- Waveform lane — full track width; clips are positioned boxes. Background click seeks. -->
    <div
      bind:this={lane}
      class="relative bg-[var(--color-bg)] {track.clips.length ? 'cursor-text' : ''}"
      style="height: {trackHeight}px; width: {laneWidth}px"
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
          style="left: {studio.timeToPx(clip.start)}px; width: {studio.timeToPx(clipDuration(clip))}px"
          data-testid="clip"
          data-clip-id={clip.id}
          role="presentation"
          onpointerdown={(e) => onClipPointerDown(e, clip)}
        >
          <div class="absolute inset-y-0" style="left: {-studio.timeToPx(clip.trimStart ?? 0)}px">
            <Waveform buffer={clip.buffer} width={studio.timeToPx(clip.buffer.duration)} {color} height={trackHeight} stereo={clip.buffer.numberOfChannels >= 2} />
          </div>
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
          <!-- edge resize handles -->
          <div
            class="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
            data-testid="resize-left"
            role="presentation"
            onpointerdown={(e) => onResizeDown(e, clip, 'left')}
          ></div>
          <div
            class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
            data-testid="resize-right"
            role="presentation"
            onpointerdown={(e) => onResizeDown(e, clip, 'right')}
          ></div>
        </div>
      {/each}
    </div>
  </div>
  <!-- Resize handle: drag down >32px → 160px, drag up >32px → 96px -->
  <div
    class="h-1 cursor-ns-resize border-b border-[var(--color-border)]
           hover:bg-[var(--color-accent)]/30 transition-colors"
    role="separator"
    aria-label="Resize track"
    onpointerdown={onResizeHandlePointerDown}
    onpointermove={onResizeHandlePointerMove}
    onpointerup={onResizeHandlePointerUp}
  ></div>
</div>
