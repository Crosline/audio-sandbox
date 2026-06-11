<script lang="ts">
  import type { EffectKind } from '@audiosandbox/engine';
  import type { Studio } from '../lib/studio.svelte.js';
  import { fly } from 'svelte/transition';
  import EffectCard from './EffectCard.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    studio: Studio;
  }

  let { studio }: Props = $props();

  // The pedalboard always edits one track: the last-interacted one (else the first).
  let track = $derived(studio.pedalboardTrack);
  let effects = $derived(track?.effects ?? []);

  let addMenuOpen = $state(false);
  const KINDS: { kind: EffectKind; label: string }[] = [
    { kind: 'filter', label: 'Filter' },
    { kind: 'distortion', label: 'Distortion' },
    { kind: 'delay', label: 'Delay' },
    { kind: 'eq', label: 'EQ' },
  ];

  function add(kind: EffectKind): void {
    if (track) studio.addEffect(track.id, kind);
    addMenuOpen = false;
  }
</script>

<section
  class="flex max-h-80 shrink-0 flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
  aria-label="Pedalboard"
  data-pedalboard
>
  <!-- Panel header: title + which track + add menu -->
  <div class="flex items-center gap-3 px-5 py-2.5">
    <Icon name="sparkles" size={13} class="text-[var(--color-accent)] shrink-0" />
    <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-muted)]">
      Pedalboard
    </span>
    {#if track}
      <span class="text-xs text-[var(--color-text)]" data-pedalboard-track>{track.name}</span>
    {/if}

    <div class="relative ml-auto">
      <button
        class="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)]/20 px-3 py-1 text-xs text-[var(--color-accent)] transition hover:brightness-125 disabled:opacity-40"
        title="Add an effect to this track"
        aria-label="Add effect"
        aria-haspopup="menu"
        aria-expanded={addMenuOpen}
        disabled={!track}
        onclick={() => (addMenuOpen = !addMenuOpen)}
      >
        <Icon name="plus" size={12} />
        FX
      </button>
      {#if addMenuOpen}
        <!-- Click-away backdrop -->
        <button
          class="fixed inset-0 z-30 cursor-default"
          aria-label="Close menu"
          tabindex="-1"
          onclick={() => (addMenuOpen = false)}
        ></button>
        <div
          class="absolute right-0 z-40 mt-1 flex w-36 flex-col rounded-lg border border-[var(--color-border-bright)] bg-[var(--color-surface-3)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          role="menu"
          transition:fly={{ y: -4, duration: 120 }}
        >
          {#each KINDS as { kind, label } (kind)}
            <button
              class="rounded px-2 py-1.5 text-left text-xs transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              role="menuitem"
              onclick={() => add(kind)}
            >
              {label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Chain row -->
  <div class="flex flex-1 items-start gap-2 overflow-x-auto px-5 pb-3">
    {#if !track}
      <p class="py-4 text-xs text-[var(--color-muted)]">Add a track to start building a chain.</p>
    {:else if effects.length === 0}
      <p class="flex items-center gap-1.5 py-4 text-xs text-[var(--color-muted)]">
        <Icon name="sparkles" size={12} />
        No effects yet.
      </p>
    {:else}
      {#each effects as effect, i (effect.id)}
        <EffectCard {studio} trackId={track.id} {effect} index={i} count={effects.length} />
      {/each}
    {/if}
  </div>
</section>
