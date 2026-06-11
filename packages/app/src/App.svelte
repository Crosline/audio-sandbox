<script lang="ts">
  import { fly } from 'svelte/transition';
  import { tick } from 'svelte';
  import { projectDuration, VERSION } from '@audiosandbox/engine';
  import EditButtons from './components/EditButtons.svelte';
  import Icon from './components/Icon.svelte';
  import Logo from './components/Logo.svelte';
  import Minimap from './components/Minimap.svelte';
  import Pedalboard from './components/Pedalboard.svelte';
  import TimelineRuler from './components/TimelineRuler.svelte';
  import TrackRow from './components/TrackRow.svelte';
  import TransportBar from './components/TransportBar.svelte';
  import { Studio } from './lib/studio.svelte.js';

  const studio = new Studio();

  // Read-only test hook: lets E2E specs inspect live audio-graph state (e.g. per-track
  // gain) that has no visible DOM representation. Harmless in prod; it only exposes the
  // same Studio the UI already drives.
  (globalThis as unknown as { __studio?: Studio }).__studio = studio;

  // Track accent colors cycle through the SIGNAL spectrum palette.
  // Warm/cool alternation so adjacent tracks are instantly distinguishable.
  const TRACK_COLORS = ['#ff6b3d', '#38bdf8', '#ffc145', '#3ddc97', '#a78bfa', '#f472b6'];
  function colorFor(index: number): string {
    return TRACK_COLORS[index % TRACK_COLORS.length]!;
  }

  let duration = $derived(projectDuration(studio.project));
  let dragging = $state(false);
  let fxOpen = $state(false);
  let loadError = $state<string | null>(null);
  let fileInput: HTMLInputElement;
  let scroller: HTMLElement;

  /** Current horizontal scroll offset of the timeline scroller (CSS px). */
  let scrollerLeft = $state(0);

  /** Track height map — populated by TrackRow onheightchange callbacks. */
  let trackHeights = $state(new Map<string, number>());

  function onTrackHeightChange(trackId: string, height: number): void {
    trackHeights = new Map(trackHeights).set(trackId, height);
  }

  // The waveform lane starts after the 208px (w-52) track header.
  const HEADER_W = 208;

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
      studio.moveClipToTrack(drag.fromTrackId, drag.clipId, fresh.id, targetStart, { createdTrackId: fresh.id });
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
    if (e.key === ' ') {
      e.preventDefault();
      if (studio.transportState === 'playing') studio.pause();
      else void studio.play();
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
  <!-- Header: slim top bar ~h-12 -->
  <header
    class="flex h-12 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
  >
    <!-- Left cluster: Logo + wordmark + project name -->
    <div class="flex items-center gap-2.5">
      <Logo playing={studio.transportState === 'playing'} size={30} />
      <h1 class="flex items-center gap-1 text-[13px] font-semibold uppercase tracking-[0.18em]">
        <span class="text-[var(--color-text)]">AUDIO</span><span class="text-[var(--color-accent)]">SANDBOX</span>
      </h1>
      <!-- Editable project name — ghost input style. No type attr: E2E locates the
           track-name input via `input[type="text"]` .first(), which must not match this. -->
      <input
        class="ml-1 w-36 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-[var(--color-muted)] transition-all duration-150 placeholder:text-[var(--color-muted)] hover:border-[var(--color-border)] hover:text-[var(--color-text)] focus:border-[var(--color-border-bright)] focus:bg-[var(--color-surface-2)] focus:text-[var(--color-text)] focus:outline-none"
        aria-label="Project name"
        spellcheck="false"
        value={studio.project.name}
        onblur={(e) => studio.renameProject(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { e.currentTarget.value = studio.project.name; e.currentTarget.blur(); }
        }}
      />
    </div>

    <!-- Middle: Edit buttons -->
    <div class="mx-4"><EditButtons {studio} /></div>

    <!-- Right cluster: zoom + + Track + Import audio -->
    <div class="ml-auto flex items-center gap-2">
      <!-- Zoom controls: segmented control group -->
      <div class="flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <button
          class="flex h-7 w-7 items-center justify-center rounded-l-md text-[var(--color-muted)] transition-all duration-150 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px"
          title="Zoom out"
          aria-label="Zoom out"
          onclick={() => zoomBy(0.8)}
        >
          <Icon name="zoom-out" size={14} />
        </button>
        <span
          class="w-14 border-x border-[var(--color-border)] text-center font-mono text-[11px] tabular-nums text-[var(--color-muted)]"
          title="Pixels per second"
        >
          {Math.round(studio.pxPerSec)} px/s
        </span>
        <button
          class="flex h-7 w-7 items-center justify-center text-[var(--color-muted)] transition-all duration-150 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px"
          title="Zoom in"
          aria-label="Zoom in"
          onclick={() => zoomBy(1.25)}
        >
          <Icon name="zoom-in" size={14} />
        </button>
        <button
          class="flex h-7 items-center justify-center rounded-r-md border-l border-[var(--color-border)] px-2 text-[var(--color-muted)] transition-all duration-150 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px disabled:opacity-40"
          title="Fit project to window"
          aria-label="Fit project to window"
          disabled={duration === 0}
          onclick={fitToWindow}
        >
          <Icon name="fit" size={14} />
        </button>
      </div>

      <!-- + Track button -->
      <button
        class="flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 text-xs text-[var(--color-muted)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-150 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px"
        onclick={() => studio.addTrack()}
      >
        + Track
      </button>

      <!-- Import audio: primary accent button -->
      <button
        class="flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 px-2.5 text-xs text-[var(--color-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-150 hover:border-[var(--color-accent)]/70 hover:bg-[var(--color-accent)]/25 hover:text-[var(--color-accent-2)] active:translate-y-px"
        onclick={() => fileInput.click()}
      >
        <Icon name="upload" size={13} />
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
    onscroll={() => { scrollerLeft = scroller?.scrollLeft ?? 0; }}
  >
    {#if studio.project.tracks.length === 0}
      <!-- Empty state: hero drop zone -->
      <div class="grid h-full place-items-center p-8 text-center">
        <div class="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-[var(--color-border-bright)] px-16 py-12">
          <Icon name="waveform" size={40} class="text-[var(--color-accent)]/50" />
          <p class="text-base font-medium text-[var(--color-text)]">Drop an audio file here</p>
          <p class="text-xs text-[var(--color-muted)]">WAV · MP3 · AAC</p>
        </div>
      </div>
    {:else}
      <!-- Timeline ruler row: pinned label + scrolling tick ruler. -->
      <div class="flex border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div
          class="sticky left-0 z-20 flex w-52 shrink-0 items-center border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[10px] uppercase tracking-wider text-[var(--color-muted)]"
        >
          Timeline
        </div>
        <TimelineRuler pxPerSec={studio.pxPerSec} width={contentWidth} onseek={onRulerSeek} />
      </div>

      {#each studio.project.tracks as track, i (track.id)}
        <div transition:fly={{ y: 8, duration: 150 }}>
          <TrackRow {studio} {track} color={colorFor(i)} onheightchange={onTrackHeightChange} />
        </div>
      {/each}

      <!-- Playhead overlay: 1px accent line with glow + triangle cap -->
      {#if duration > 0}
        <div
          class="pointer-events-none absolute top-0 bottom-0 z-10"
          style="left: {HEADER_W + studio.timeToPx(studio.playhead)}px; width: 1px; background: var(--color-accent); box-shadow: 0 0 8px rgba(255,107,61,0.8);"
        >
          <!-- Downward-pointing triangle cap at the top -->
          <div
            style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 7px solid var(--color-accent);"
          ></div>
        </div>
      {/if}

      <Minimap
        project={studio.project}
        pxPerSec={studio.pxPerSec}
        totalDuration={duration}
        scrollLeft={scrollerLeft}
        viewportWidth={laneViewportWidth()}
        {trackHeights}
        trackColors={studio.project.tracks.map((_, i) => colorFor(i))}
        onscroll={(sl) => { if (scroller) scroller.scrollLeft = Math.max(0, sl); }}
      />
    {/if}
  </main>

  {#if loadError}
    <div
      class="flex items-center gap-2 border-t border-red-500/40 bg-red-500/12 px-5 py-2 text-sm text-red-200"
      transition:fly={{ y: 8, duration: 150 }}
    >
      <Icon name="x" size={14} class="shrink-0 text-red-400" />
      {loadError}
    </div>
  {/if}

  {#if fxOpen}
    <Pedalboard {studio} />
  {/if}

  <TransportBar {studio} {fxOpen} onToggleFx={() => (fxOpen = !fxOpen)} />

  <div class="px-5 pb-1 text-right font-mono text-[10px] text-[var(--color-muted)]">
    engine v{VERSION}
  </div>
</div>
