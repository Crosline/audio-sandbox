<script lang="ts">
  import type { Studio } from '../lib/studio.svelte.js';

  interface Props {
    studio: Studio;
  }

  let { studio }: Props = $props();

  let hasRange = $derived(!!studio.selection && studio.selection.end > studio.selection.start);
  let hasObjectClip = $derived(!!studio.selectedClip);
</script>

<div class="flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] p-0.5">
  <button
    class="rounded px-2 py-1 text-xs transition hover:brightness-125 disabled:opacity-40"
    title="Copy selection (Ctrl/Cmd+C)"
    aria-label="Copy"
    disabled={!hasRange}
    onclick={() => studio.copy()}
  >
    Copy
  </button>
  <button
    class="rounded px-2 py-1 text-xs transition hover:brightness-125 disabled:opacity-40"
    title="Paste at playhead (Ctrl/Cmd+V)"
    aria-label="Paste"
    disabled={!studio.canPaste}
    onclick={() => studio.paste()}
  >
    Paste
  </button>
  <button
    class="rounded px-2 py-1 text-xs transition hover:brightness-125 disabled:opacity-40"
    title="Split clip at playhead (Ctrl/Cmd+I) — coming soon"
    aria-label="Split"
    disabled={!hasObjectClip}
    onclick={() => console.warn('Split: not yet implemented')}
  >
    Split
  </button>
  <button
    class="rounded px-2 py-1 text-xs transition hover:brightness-125 disabled:opacity-40"
    title="Insert silence over selection"
    aria-label="Insert Silence"
    disabled={!hasRange}
    onclick={() => studio.silence()}
  >
    Silence
  </button>

  <span class="mx-0.5 h-4 w-px bg-[var(--color-border)]"></span>

  <button
    class="rounded px-2 py-1 text-xs transition hover:brightness-125 disabled:opacity-40"
    title="Undo (Ctrl/Cmd+Z)"
    aria-label="Undo"
    disabled={!studio.canUndo}
    onclick={() => studio.undo()}
  >
    ↶ Undo
  </button>
  <button
    class="rounded px-2 py-1 text-xs transition hover:brightness-125 disabled:opacity-40"
    title="Redo (Ctrl/Cmd+Shift+Z)"
    aria-label="Redo"
    disabled={!studio.canRedo}
    onclick={() => studio.redo()}
  >
    ↷ Redo
  </button>
</div>
