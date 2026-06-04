<script lang="ts">
  import { extractPeaks } from '@audiosandbox/engine';
  import { canvasSizing } from '../lib/canvas.js';

  interface Props {
    buffer: AudioBuffer;
    /** Width in CSS pixels. Driven by duration × pxPerSec, so it carries the timeline scale. */
    width: number;
    /** CSS color for the filled waveform. */
    color?: string;
    /** Height in CSS pixels. */
    height?: number;
  }

  let { buffer, width, color = '#7c5cff', height = 96 }: Props = $props();

  let canvas: HTMLCanvasElement;

  // Redraw whenever the buffer, width (zoom), height, or color changes.
  $effect(() => {
    if (!canvas || width <= 0) return;
    draw(canvas, buffer, width, height, color);
  });

  function draw(
    cv: HTMLCanvasElement,
    buf: AudioBuffer,
    w: number,
    h: number,
    fill: string,
  ): void {
    // Work in backing-store pixels, capped below the browser's max canvas dimension. The
    // canvas stretches via CSS (`w-full`) to the true display width `w`, so beyond the cap
    // the waveform loses resolution but never blanks.
    const dpr = window.devicePixelRatio || 1;
    const { pixelWidth, pixelHeight } = canvasSizing(w, h, dpr);
    cv.width = pixelWidth;
    cv.height = pixelHeight;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);

    // One min/max bin per backing-store column. Collapse channels to a mono overview.
    const peaks = extractPeaks(buf, pixelWidth);
    const mid = pixelHeight / 2;
    const amp = pixelHeight / 2;

    ctx.fillStyle = fill;
    for (let x = 0; x < pixelWidth; x++) {
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

<div class="relative" style="width: {width}px; height: {height}px">
  <canvas bind:this={canvas} class="block h-full w-full"></canvas>
</div>
