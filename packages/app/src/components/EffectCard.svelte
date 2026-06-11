<script lang="ts">
  import type { EffectState } from '@audiosandbox/engine';
  import type { Studio } from '../lib/studio.svelte.js';
  import { fly } from 'svelte/transition';
  import Icon from './Icon.svelte';

  interface Props {
    studio: Studio;
    trackId: string;
    effect: EffectState;
    index: number;
    count: number;
  }

  let { studio, trackId, effect, index, count }: Props = $props();

  const LABELS: Record<EffectState['kind'], string> = {
    filter: 'Filter',
    distortion: 'Distortion',
    delay: 'Delay',
    eq: 'EQ',
  };

  // A param drag fires updateEffect repeatedly (coalesced into one undo entry); pointerup /
  // change closes the gesture via endEffectEdit so the next drag is separately undoable.
  function patch(p: Parameters<Studio['updateEffect']>[2]): void {
    studio.updateEffect(trackId, effect.id, p);
  }
  function endEdit(): void {
    studio.endEffectEdit();
  }
</script>

<div
  class="flex w-48 shrink-0 flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-gradient-to-b from-[var(--color-surface-3)] to-[var(--color-surface-2)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:border-[var(--color-border-bright)]"
  data-effect-id={effect.id}
  data-effect-kind={effect.kind}
  in:fly={{ y: 8, duration: 150 }}
>
  <!-- Card header: kind name + bypass toggle -->
  <div class="flex items-center justify-between">
    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-muted)]">
      {LABELS[effect.kind]}
    </span>
    <button
      class="grid h-6 w-6 place-items-center rounded-md transition {effect.bypass
        ? 'text-[var(--color-muted)]'
        : 'text-[var(--color-accent)]'}"
      style={effect.bypass ? '' : 'box-shadow: 0 0 8px rgba(255,107,61,0.5)'}
      title={effect.bypass ? 'Enable effect' : 'Bypass effect'}
      aria-label={effect.bypass ? 'Enable' : 'Bypass'}
      aria-pressed={!effect.bypass}
      onclick={() => studio.toggleEffectBypass(trackId, effect.id)}
    >
      <Icon name="power" size={13} strokeWidth={2.5} />
    </button>
  </div>

  <!-- Card body — dimmed when bypassed -->
  <div class="flex flex-col gap-2 transition-all {effect.bypass ? 'opacity-50 saturate-50' : ''}">
    <!-- Kind-specific params -->
    {#if effect.kind === 'filter'}
      <label class="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        Type
        <select
          class="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-xs text-[var(--color-text)]"
          value={effect.filterType}
          aria-label="Filter type"
          onchange={(e) => { patch({ filterType: e.currentTarget.value as typeof effect.filterType }); endEdit(); }}
        >
          <option value="lowpass">Low-pass</option>
          <option value="highpass">High-pass</option>
          <option value="bandpass">Band-pass</option>
        </select>
      </label>
      <label class="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        Cutoff <span class="font-mono tabular-nums text-[11px] normal-case text-[var(--color-text)]">{Math.round(effect.frequency)} Hz</span>
        <input
          type="range" min="20" max="18000" step="1" value={effect.frequency}
          aria-label="Cutoff frequency"
          oninput={(e) => patch({ frequency: +e.currentTarget.value })} onchange={endEdit}
        />
      </label>
      <label class="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        Resonance <span class="font-mono tabular-nums text-[11px] normal-case text-[var(--color-text)]">{effect.q.toFixed(1)}</span>
        <input
          type="range" min="0.1" max="20" step="0.1" value={effect.q}
          aria-label="Resonance"
          oninput={(e) => patch({ q: +e.currentTarget.value })} onchange={endEdit}
        />
      </label>
    {:else if effect.kind === 'distortion'}
      <label class="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        Drive <span class="font-mono tabular-nums text-[11px] normal-case text-[var(--color-text)]">{Math.round(effect.drive * 100)}%</span>
        <input
          type="range" min="0" max="1" step="0.01" value={effect.drive}
          aria-label="Drive"
          oninput={(e) => patch({ drive: +e.currentTarget.value })} onchange={endEdit}
        />
      </label>
    {:else if effect.kind === 'delay'}
      <label class="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        Time <span class="font-mono tabular-nums text-[11px] normal-case text-[var(--color-text)]">{Math.round(effect.time * 1000)} ms</span>
        <input
          type="range" min="0" max="2" step="0.01" value={effect.time}
          aria-label="Delay time"
          oninput={(e) => patch({ time: +e.currentTarget.value })} onchange={endEdit}
        />
      </label>
      <label class="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        Feedback <span class="font-mono tabular-nums text-[11px] normal-case text-[var(--color-text)]">{Math.round(effect.feedback * 100)}%</span>
        <input
          type="range" min="0" max="0.95" step="0.01" value={effect.feedback}
          aria-label="Feedback"
          oninput={(e) => patch({ feedback: +e.currentTarget.value })} onchange={endEdit}
        />
      </label>
    {:else if effect.kind === 'eq'}
      {#each [['low', 'Low'], ['mid', 'Mid'], ['high', 'High']] as const as [key, label] (key)}
        <label class="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
          {label} <span class="font-mono tabular-nums text-[11px] normal-case text-[var(--color-text)]">{effect[key] > 0 ? '+' : ''}{effect[key].toFixed(0)} dB</span>
          <input
            type="range" min="-24" max="24" step="1" value={effect[key]}
            aria-label="{label} gain"
            oninput={(e) => patch({ [key]: +e.currentTarget.value })} onchange={endEdit}
          />
        </label>
      {/each}
    {/if}

    <!-- Dry/wet mix — visually distinguished with a hairline divider above -->
    <div class="border-t border-[var(--color-border)] pt-1.5">
      <label class="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-[var(--color-accent-2)]">
        Mix <span class="font-mono tabular-nums text-[11px] normal-case text-[var(--color-text)]">{Math.round(effect.wet * 100)}% wet</span>
        <input
          type="range" min="0" max="1" step="0.01" value={effect.wet}
          aria-label="Dry/wet mix"
          oninput={(e) => patch({ wet: +e.currentTarget.value })} onchange={endEdit}
        />
      </label>
    </div>
  </div>

  <!-- Reorder + remove -->
  <div class="mt-0.5 flex items-center justify-between">
    <div class="flex gap-1">
      <button
        class="grid h-6 w-6 place-items-center rounded-md bg-[var(--color-surface-2)] text-[var(--color-muted)] transition hover:brightness-125 disabled:opacity-30"
        title="Move left" aria-label="Move effect left"
        disabled={index === 0}
        onclick={() => studio.moveEffect(trackId, effect.id, 'up')}
      >
        <Icon name="chevron-left" size={13} strokeWidth={2.5} />
      </button>
      <button
        class="grid h-6 w-6 place-items-center rounded-md bg-[var(--color-surface-2)] text-[var(--color-muted)] transition hover:brightness-125 disabled:opacity-30"
        title="Move right" aria-label="Move effect right"
        disabled={index === count - 1}
        onclick={() => studio.moveEffect(trackId, effect.id, 'down')}
      >
        <Icon name="chevron-right" size={13} strokeWidth={2.5} />
      </button>
    </div>
    <button
      class="grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition hover:text-[var(--color-accent-2)]"
      title="Remove effect" aria-label="Remove effect"
      onclick={() => studio.removeEffect(trackId, effect.id)}
    >
      <Icon name="x" size={13} strokeWidth={2.5} />
    </button>
  </div>
</div>
