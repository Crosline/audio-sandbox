<script lang="ts">
  import type { Studio } from '../lib/studio.svelte.js';
  import Icon from './Icon.svelte';

  interface Props {
    studio: Studio;
  }

  let { studio }: Props = $props();

  let hasRange = $derived(!!studio.selection && studio.selection.end > studio.selection.start);
  let hasObjectClip = $derived(!!studio.selectedClip);
</script>

<!-- Segmented icon-only button group -->
<div class="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
  <button
    class="flex h-7 w-7 items-center justify-center rounded-l-md text-[var(--color-muted)] transition-all duration-150 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px disabled:opacity-40"
    title="Copy selection (Ctrl/Cmd+C)"
    aria-label="Copy"
    disabled={!hasRange}
    onclick={() => studio.copy()}
  >
    <Icon name="copy" size={14} />
  </button>
  <button
    class="flex h-7 w-7 items-center justify-center border-l border-[var(--color-border)] text-[var(--color-muted)] transition-all duration-150 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px disabled:opacity-40"
    title="Paste at playhead (Ctrl/Cmd+V)"
    aria-label="Paste"
    disabled={!studio.canPaste}
    onclick={() => studio.paste()}
  >
    <Icon name="paste" size={14} />
  </button>
  <button
    class="flex h-7 w-7 items-center justify-center border-l border-[var(--color-border)] text-[var(--color-muted)] transition-all duration-150 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px disabled:opacity-40"
    title="Split clip at playhead (Ctrl/Cmd+I) — coming soon"
    aria-label="Split"
    disabled={!hasObjectClip}
    onclick={() => console.warn('Split: not yet implemented')}
  >
    <Icon name="scissors" size={14} />
  </button>
  <button
    class="flex h-7 w-7 items-center justify-center border-l border-[var(--color-border)] text-[var(--color-muted)] transition-all duration-150 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px disabled:opacity-40"
    title="Insert silence over selection"
    aria-label="Insert Silence"
    disabled={!hasRange}
    onclick={() => studio.silence()}
  >
    <Icon name="silence" size={14} />
  </button>

  <!-- Hairline divider -->
  <span class="mx-0.5 h-4 w-px bg-[var(--color-border)]"></span>

  <button
    class="flex h-7 w-7 items-center justify-center border-l border-[var(--color-border)] text-[var(--color-muted)] transition-all duration-150 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px disabled:opacity-40"
    title="Undo (Ctrl/Cmd+Z)"
    aria-label="Undo"
    disabled={!studio.canUndo}
    onclick={() => studio.undo()}
  >
    <Icon name="undo" size={14} />
  </button>
  <button
    class="flex h-7 w-7 items-center justify-center rounded-r-md border-l border-[var(--color-border)] text-[var(--color-muted)] transition-all duration-150 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] active:translate-y-px disabled:opacity-40"
    title="Redo (Ctrl/Cmd+Shift+Z)"
    aria-label="Redo"
    disabled={!studio.canRedo}
    onclick={() => studio.redo()}
  >
    <Icon name="redo" size={14} />
  </button>
</div>
