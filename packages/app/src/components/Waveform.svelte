<script lang="ts">
  import { extractPeaks } from '@audiosandbox/engine';

  interface Props {
    buffer: AudioBuffer;
    /** CSS color for the filled waveform. */
    color?: string;
    /** Height in CSS pixels. */
    height?: number;
  }

  let { buffer, color = '#7c5cff', height = 96 }: Props = $props();

  let canvas: HTMLCanvasElement;
  let width = $state(0);
  let host: HTMLDivElement;

  // Redraw whenever the buffer, measured width, or height changes.
  $effect(() => {
    if (!canvas || width === 0) return;
    draw(canvas, buffer, width, height, color);
  });

  // Track the element's pixel width so the waveform fills its column responsively.
  $effect(() => {
    if (!host) return;
    const ro = new ResizeObserver((entries) => {
      width = Math.floor(entries[0]!.contentRect.width);
    });
    ro.observe(host);
    return () => ro.disconnect();
  });

  function draw(
    cv: HTMLCanvasElement,
    buf: AudioBuffer,
    w: number,
    h: number,
    fill: string,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.floor(w * dpr));
    cv.height = Math.max(1, Math.floor(h * dpr));
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // One min/max bin per horizontal pixel. Collapse channels to a mono overview.
    const peaks = extractPeaks(buf, w);
    const mid = h / 2;
    const amp = h / 2;

    ctx.fillStyle = fill;
    for (let x = 0; x < w; x++) {
      let lo = 0;
      let hi = 0;
      for (const ch of peaks.channels) {
        if ((ch.min[x] ?? 0) < lo) lo = ch.min[x] ?? 0;
        if ((ch.max[x] ?? 0) > hi) hi = ch.max[x] ?? 0;
      }
      const yTop = mid - hi * amp;
      const yBottom = mid - lo * amp;
      ctx.fillRect(x, yTop, 1, Math.max(1, yBottom - yTop));
    }
  }
</script>

<div bind:this={host} class="relative w-full" style="height: {height}px">
  <canvas bind:this={canvas} class="block h-full w-full"></canvas>
</div>
