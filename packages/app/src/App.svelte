<script lang="ts">
  import { projectDuration, VERSION } from '@audiosandbox/engine';
  import TrackRow from './components/TrackRow.svelte';
  import TransportBar from './components/TransportBar.svelte';
  import { Studio } from './lib/studio.svelte.js';

  const studio = new Studio();

  // Track accent colors cycle through the sketch's purple / pink / teal.
  const TRACK_COLORS = ['#7c5cff', '#ec4899', '#22d3ee'];
  function colorFor(index: number): string {
    return TRACK_COLORS[index % TRACK_COLORS.length]!;
  }

  let duration = $derived(projectDuration(studio.project));
  let dragging = $state(false);
  let loadError = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  // The waveform lane starts after the 176px (w-44) track header.
  const HEADER_W = 176;

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
    if (e.dataTransfer?.files?.length) void loadFiles(e.dataTransfer.files);
  }

  // Seek by clicking in the timeline ruler (play-from-point). The ruler is the lane area
  // to the right of the track headers, so x maps directly to time.
  function onRulerSeek(e: MouseEvent): void {
    if (duration === 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    studio.seek(Math.max(0, Math.min(1, frac)) * duration);
  }
</script>

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
    <div class="ml-auto flex items-center gap-2">
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
    class="relative flex-1 overflow-auto {dragging ? 'ring-2 ring-inset ring-[var(--color-accent)]' : ''}"
    role="region"
    aria-label="Timeline"
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
  >
    <!-- Timeline ruler: click to seek (play-from-point) -->
    {#if studio.project.tracks.length > 0}
      <div class="flex border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div class="w-44 shrink-0 border-r border-[var(--color-border)] px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          Timeline
        </div>
        <button
          type="button"
          class="h-6 flex-1 cursor-text bg-[var(--color-bg)]"
          aria-label="Seek"
          title="Click to seek"
          onclick={onRulerSeek}
        ></button>
      </div>
    {/if}

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
      {#each studio.project.tracks as track, i (track.id)}
        <TrackRow {studio} {track} color={colorFor(i)} />
      {/each}

      <!-- Playhead overlay -->
      {#if duration > 0}
        <div
          class="pointer-events-none absolute top-0 bottom-0 w-px bg-white/80"
          style="left: calc({HEADER_W}px + (100% - {HEADER_W}px) * {studio.playhead /
            duration})"
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
