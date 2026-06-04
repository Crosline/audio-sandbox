<script lang="ts">
  import type { Studio } from '../lib/studio.svelte.js';

  interface Props {
    studio: Studio;
  }

  let { studio }: Props = $props();

  // Range edits need an actual span; a collapsed selection (or none) disables them.
  let hasRange = $derived(!!studio.selection && studio.selection.end > studio.selection.start);

  // [label, title, action, enabled] for the destructive ops, rendered as one group.
  let ops = $derived<Array<[string, string, () => void, boolean]>>([
    ['Cut', 'Cut selection (Ctrl/Cmd+X)', () => studio.cut(), hasRange],
    ['Copy', 'Copy selection (Ctrl/Cmd+C)', () => studio.copy(), hasRange],
    ['Paste', 'Paste at selection (Ctrl/Cmd+V)', () => studio.paste(), studio.canPaste && !!studio.selection],
    ['Delete', 'Delete selection (Del)', () => studio.deleteSelection(), hasRange],
    ['Silence', 'Silence selection', () => studio.silence(), hasRange],
    ['Trim', 'Trim to selection', () => studio.trim(), hasRange],
    ['Fade In', 'Fade in over selection', () => studio.fadeIn(), hasRange],
    ['Fade Out', 'Fade out over selection', () => studio.fadeOut(), hasRange],
  ]);
</script>

<div class="flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] p-0.5">
  {#each ops as [label, title, action, enabled] (label)}
    <button
      class="rounded px-2 py-1 text-xs transition hover:brightness-125 disabled:opacity-40"
      {title}
      aria-label={label}
      disabled={!enabled}
      onclick={action}
    >
      {label}
    </button>
  {/each}

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
