<script lang="ts">
  // SIGNAL icon set — 24×24 stroke glyphs (lucide-derived geometry), drawn at
  // small sizes with currentColor so buttons tint them via text color.
  export type IconName =
    | 'play'
    | 'pause'
    | 'stop'
    | 'plus'
    | 'upload'
    | 'undo'
    | 'redo'
    | 'copy'
    | 'paste'
    | 'scissors'
    | 'silence'
    | 'x'
    | 'zoom-in'
    | 'zoom-out'
    | 'fit'
    | 'sparkles'
    | 'power'
    | 'chevron-up'
    | 'chevron-down'
    | 'chevron-left'
    | 'chevron-right'
    | 'waveform'
    | 'volume';

  type Shape = { d: string; fill?: boolean };

  const PATHS: Record<IconName, Shape[]> = {
    play: [{ d: 'M7 4.5v15a1 1 0 0 0 1.52.86l12.2-7.5a1 1 0 0 0 0-1.72L8.52 3.64A1 1 0 0 0 7 4.5z', fill: true }],
    pause: [
      { d: 'M7 4h2.5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', fill: true },
      { d: 'M14.5 4H17a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', fill: true },
    ],
    stop: [{ d: 'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', fill: true }],
    plus: [{ d: 'M12 5v14M5 12h14' }],
    upload: [{ d: 'M12 16V4m-5 5 5-5 5 5M4 20h16' }],
    undo: [{ d: 'M9 14 4 9l5-5' }, { d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11' }],
    redo: [{ d: 'm15 14 5-5-5-5' }, { d: 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13' }],
    copy: [
      { d: 'M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z' },
      { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' },
    ],
    paste: [
      { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' },
      { d: 'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z' },
    ],
    scissors: [
      { d: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
      { d: 'M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12' },
    ],
    silence: [
      { d: 'M11 5 6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z', fill: true },
      { d: 'm16 9 6 6m0-6-6 6' },
    ],
    x: [{ d: 'M18 6 6 18M6 6l12 12' }],
    'zoom-in': [{ d: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z' }, { d: 'm21 21-4.3-4.3M11 8v6M8 11h6' }],
    'zoom-out': [{ d: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z' }, { d: 'm21 21-4.3-4.3M8 11h6' }],
    fit: [
      { d: 'M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3' },
    ],
    sparkles: [
      {
        d: 'M9.9 3.1c.1-.4.7-.4.8 0l1.2 3.6a2 2 0 0 0 1.3 1.3l3.6 1.2c.4.1.4.7 0 .8l-3.6 1.2a2 2 0 0 0-1.3 1.3l-1.2 3.6c-.1.4-.7.4-.8 0l-1.2-3.6a2 2 0 0 0-1.3-1.3L3.8 10c-.4-.1-.4-.7 0-.8l3.6-1.2a2 2 0 0 0 1.3-1.3l1.2-3.6z',
      },
      { d: 'M19 14v4m2-2h-4' },
    ],
    power: [{ d: 'M12 2v9' }, { d: 'M18.36 6.64a9 9 0 1 1-12.72 0' }],
    'chevron-up': [{ d: 'm6 15 6-6 6 6' }],
    'chevron-down': [{ d: 'm6 9 6 6 6-6' }],
    'chevron-left': [{ d: 'm15 6-6 6 6 6' }],
    'chevron-right': [{ d: 'm9 6 6 6-6 6' }],
    waveform: [
      {
        d: 'M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2',
      },
    ],
    volume: [
      { d: 'M11 5 6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z', fill: true },
      { d: 'M15.5 8.5a5 5 0 0 1 0 7M18.4 5.6a9 9 0 0 1 0 12.8' },
    ],
  };

  let {
    name,
    size = 16,
    strokeWidth = 2,
    class: cls = '',
  }: { name: IconName; size?: number; strokeWidth?: number; class?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={cls}
  aria-hidden="true"
>
  {#each PATHS[name] as shape}
    <path d={shape.d} fill={shape.fill ? 'currentColor' : 'none'} stroke={shape.fill ? 'none' : undefined} />
  {/each}
</svg>
