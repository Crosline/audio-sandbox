<script lang="ts">
  import { tick } from 'svelte';
  import { projectDuration, VERSION } from '@audiosandbox/engine';
  import EditButtons from './components/EditButtons.svelte';
  import TimelineRuler from './components/TimelineRuler.svelte';
  import TrackRow from './components/TrackRow.svelte';
  import TransportBar from './components/TransportBar.svelte';
  import { Studio } from './lib/studio.svelte.js';

  const studio = new Studio();

  // Read-only test hook: lets E2E specs inspect live audio-graph state (e.g. per-track
  // gain) that has no visible DOM representation. Harmless in prod; it only exposes the
  // same Studio the UI already drives.
  (globalThis as unknown as { __studio?: Studio }).__studio = studio;

  // Track accent colors cycle through the sketch's purple / pink / teal.
  const TRACK_COLORS = ['#7c5cff', '#ec4899', '#22d3ee'];
  function colorFor(index: number): string {
    return TRACK_COLORS[index % TRACK_COLORS.length]!;
  }

  let duration = $derived(projectDuration(studio.project));
  let dragging = $state(false);
  let loadError = $state<string | null>(null);
  let fileInput: HTMLInputElement;
  let scroller: HTMLElement;

  // The waveform lane starts after the 176px (w-44) track header.
  const HEADER_W = 176;

  // Total timeline width in px: project duration at the current scale. Lanes, ruler, and
  // playhead all live in this coordinate space, which may exceed the viewport (→ scroll).
  let contentWidth = $derived(studio.timeToPx(duration));

  // The lane viewport width (scroller minus the pinned header column), used by "Fit".
  function laneViewportWidth(): number {
    return scroller ? Math.max(1, scroller.clientWidth - HEADER_W) : 1;
  }

  function zoomBy(factor: number): void {
    studio.setZoom(studio.zoom * factor);
  }

  /** Fit the whole project into the visible lane width. */
  function fitToWindow(): void {
    if (duration <= 0) return;
    const targetPxPerSec = laneViewportWidth() / duration;
    studio.setZoom(targetPxPerSec / studio.pxPerSec * studio.zoom);
  }

  // Ctrl/Cmd + wheel zooms, anchored at the cursor: the second under the pointer stays put.
  function onWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return; // plain wheel scrolls normally
    e.preventDefault();
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    // Cursor position within the lane viewport (past the pinned header) and in content space.
    const cursorViewportX = e.clientX - rect.left - HEADER_W;
    const tUnder = studio.pxToTime(Math.max(0, cursorViewportX + scroller.scrollLeft));
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    studio.setZoom(studio.zoom * factor);
    // Keep tUnder under the cursor. Wait for the DOM to grow/shrink to the new content
    // width first, otherwise the browser clamps scrollLeft to the stale (smaller) range.
    void tick().then(() => {
      scroller.scrollLeft = studio.timeToPx(tUnder) - cursorViewportX;
    });
  }

  function onRulerSeek(seconds: number): void {
    studio.seek(Math.max(0, seconds));
  }

  async function loadFiles(files: FileList | File[]): Promise<void> {
    loadError = null;
    for (const file of Array.from(files)) {
      try {
        await studio.addFile(file);
      } catch (err) {
        loadError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragging = false;
    const files = e.dataTransfer?.files;
    if (!files?.length) return;

    // Which track row is under the drop (if any)?
    const rows = scroller?.querySelectorAll<HTMLElement>('[data-track-id]') ?? [];
    let trackId: string | undefined;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        trackId = row.dataset.trackId;
        break;
      }
    }

    if (trackId && scroller) {
      const rect = scroller.getBoundingClientRect();
      const laneX = e.clientX - rect.left - HEADER_W + scroller.scrollLeft;
      const start = Math.max(0, studio.pxToTime(laneX));
      void dropFilesAt(files, trackId, start);
    } else {
      void loadFiles(files); // off any track → new track at 0 (existing behavior)
    }
  }

  /** Place dropped files onto a specific track starting near `start` (each clamped, no overlap). */
  async function dropFilesAt(files: FileList, trackId: string, start: number): Promise<void> {
    loadError = null;
    let at = start;
    for (const file of Array.from(files)) {
      try {
        const clip = await studio.addFile(file, { trackId, start: at });
        at = clip.start + clip.buffer.duration; // next file butts up after this one
      } catch (err) {
        loadError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // Resolve the track under a clientY: an existing row id, 'new' for empty space below the
  // last row, or null if above the first row / outside.
  function trackAtY(clientY: number): string | 'new' | null {
    const rows = scroller?.querySelectorAll<HTMLElement>('[data-track-id]') ?? [];
    let lastBottom = -Infinity;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return row.dataset.trackId ?? null;
      lastBottom = Math.max(lastBottom, r.bottom);
    }
    if (clientY > lastBottom && rows.length) return 'new';
    return null;
  }

  function laneTimeAt(clientX: number): number {
    if (!scroller) return 0;
    const rect = scroller.getBoundingClientRect();
    const laneX = clientX - rect.left - HEADER_W + scroller.scrollLeft;
    return Math.max(0, studio.pxToTime(laneX));
  }

  function onClipDragMove(e: PointerEvent): void {
    const drag = studio.clipDrag;
    if (!drag) return;
    const targetStart = laneTimeAt(e.clientX) - studio.pxToTime(drag.grabInClipPx);
    // Live preview: move within the source track so the clip follows cursor x
    studio.moveClip(drag.fromTrackId, drag.clipId, Math.max(0, targetStart));
  }

  function onClipDragUp(e: PointerEvent): void {
    const drag = studio.clipDrag;
    if (!drag) return;
    const targetStart = Math.max(0, laneTimeAt(e.clientX) - studio.pxToTime(drag.grabInClipPx));
    const over = trackAtY(e.clientY);
    if (over === 'new') {
      const fresh = studio.addTrack();
      studio.moveClipToTrack(drag.fromTrackId, drag.clipId, fresh.id, targetStart);
    } else if (over && over !== drag.fromTrackId) {
      studio.moveClipToTrack(drag.fromTrackId, drag.clipId, over, targetStart);
    } else {
      studio.endClipMove(); // same-track drag already applied via preview
    }
    studio.clipDrag = null;
  }

  $effect(() => {
    if (!studio.clipDrag) return;
    window.addEventListener('pointermove', onClipDragMove);
    window.addEventListener('pointerup', onClipDragUp);
    return () => {
      window.removeEventListener('pointermove', onClipDragMove);
      window.removeEventListener('pointerup', onClipDragUp);
    };
  });

  // Editing keyboard shortcuts, scoped to the window. Skip when typing in a field so they
  // don't hijack text input.
  function onKeydown(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) studio.redo();
      else studio.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      studio.redo();
    } else if (mod && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      studio.cut();
    } else if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      studio.copy();
    } else if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      studio.paste();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (studio.selection) {
        e.preventDefault();
        studio.deleteSelection();
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex h-full flex-col">
  <!-- Header -->
  <header
    class="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3"
  >
    <div
      class="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] text-lg"
    >
      🎵
    </div>
    <h1 class="text-lg font-semibold tracking-tight">Audio Sandbox</h1>
    <span class="text-sm text-[var(--color-muted)]">Untitled Project</span>

    <!-- Edit controls: Cut/Copy/Paste/Delete/Silence/Trim/Fades · Undo/Redo. -->
    <div class="ml-4"><EditButtons {studio} /></div>

    <div class="ml-auto flex items-center gap-2">
      <!-- Zoom controls: − / readout / + / Fit -->
      <div class="flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] p-0.5">
        <button
          class="grid h-7 w-7 place-items-center rounded text-sm transition hover:brightness-125"
          title="Zoom out"
          aria-label="Zoom out"
          onclick={() => zoomBy(0.8)}
        >
          −
        </button>
        <span
          class="w-14 text-center text-xs tabular-nums text-[var(--color-muted)]"
          title="Pixels per second"
        >
          {Math.round(studio.pxPerSec)} px/s
        </span>
        <button
          class="grid h-7 w-7 place-items-center rounded text-sm transition hover:brightness-125"
          title="Zoom in"
          aria-label="Zoom in"
          onclick={() => zoomBy(1.25)}
        >
          +
        </button>
        <button
          class="rounded px-2 py-1 text-xs transition hover:brightness-125 disabled:opacity-40"
          title="Fit project to window"
          aria-label="Fit project to window"
          disabled={duration === 0}
          onclick={fitToWindow}
        >
          Fit
        </button>
      </div>
      <button
        class="rounded-lg bg-[var(--color-surface-2)] px-3 py-1.5 text-sm transition hover:brightness-125"
        onclick={() => studio.addTrack()}
      >
        + Track
      </button>
      <button
        class="rounded-lg bg-[var(--color-surface-2)] px-3 py-1.5 text-sm transition hover:brightness-125"
        onclick={() => fileInput.click()}
      >
        Import audio
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept="audio/*"
        multiple
        class="hidden"
        onchange={(e) => e.currentTarget.files && loadFiles(e.currentTarget.files)}
      />
    </div>
  </header>

  <!-- Tracks area -->
  <main
    bind:this={scroller}
    class="relative flex-1 overflow-auto {dragging ? 'ring-2 ring-inset ring-[var(--color-accent)]' : ''}"
    role="region"
    aria-label="Timeline"
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
    onwheel={onWheel}
  >
    {#if studio.project.tracks.length === 0}
      <div
        class="grid h-full place-items-center text-center text-[var(--color-muted)]"
      >
        <div>
          <p class="text-sm">Drop an audio file here, or use "Import audio".</p>
          <p class="mt-1 text-xs">WAV · MP3 · OGG</p>
        </div>
      </div>
    {:else}
      <!-- Timeline ruler row: pinned label + scrolling tick ruler. -->
      <div class="flex border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div
          class="sticky left-0 z-20 flex w-44 shrink-0 items-center border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[10px] uppercase tracking-wider text-[var(--color-muted)]"
        >
          Timeline
        </div>
        <TimelineRuler pxPerSec={studio.pxPerSec} width={contentWidth} onseek={onRulerSeek} />
      </div>

      {#each studio.project.tracks as track, i (track.id)}
        <TrackRow {studio} {track} color={colorFor(i)} />
      {/each}

      <!-- Playhead overlay: positioned in the scrolling content, so it moves with the lanes. -->
      {#if duration > 0}
        <div
          class="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-white/80"
          style="left: {HEADER_W + studio.timeToPx(studio.playhead)}px"
        ></div>
      {/if}
    {/if}
  </main>

  {#if loadError}
    <div class="bg-[var(--color-accent-2)]/20 px-5 py-2 text-sm text-[var(--color-accent-2)]">
      {loadError}
    </div>
  {/if}

  <TransportBar {studio} />

  <div class="px-5 pb-1 text-right text-[10px] text-[var(--color-muted)]">
    engine v{VERSION}
  </div>
</div>
