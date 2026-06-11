<script lang="ts">
  import { extractPeaks } from '@audiosandbox/engine';
  import { canvasSizing } from '../lib/canvas.js';

  interface Props {
    buffer: AudioBuffer;
    /** Width in CSS pixels. Driven by duration × pxPerSec. */
    width: number;
    /** CSS color for the filled waveform. */
    color?: string;
    /** Height in CSS pixels. */
    height?: number;
    /**
     * When true and buffer has ≥2 channels, renders L and R as two stacked half-height
     * canvases separated by a 1px divider. Mono buffers always use the single-canvas path.
     */
    stereo?: boolean;
  }

  let { buffer, width, color = '#7c5cff', height = 96, stereo = false }: Props = $props();

  let canvasMono: HTMLCanvasElement;
  let canvasL: HTMLCanvasElement;
  let canvasR: HTMLCanvasElement;

  const isStereo = $derived(stereo && buffer.numberOfChannels >= 2);
  const halfH = $derived(Math.floor((height - 1) / 2)); // each channel canvas height

  $effect(() => {
    if (!isStereo && canvasMono && width > 0) drawMono(canvasMono, buffer, width, height, color);
  });

  $effect(() => {
    if (isStereo && canvasL && canvasR && width > 0) {
      drawChannel(canvasL, buffer, 0, width, halfH, color);
      drawChannel(canvasR, buffer, 1, width, halfH, color);
    }
  });

  /**
   * Mix a hex color ~45% toward white.
   * Input: '#rrggbb' or '#rgb'. Output: '#rrggbb'.
   */
  function brighten(hex: string): string {
    // Normalise to 6-digit form.
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const t = 0.45; // mix toward white
    const mix = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
    return '#' + mix(r) + mix(g) + mix(b);
  }

  /** Build a vertical linear gradient for a canvas context spanning pixelHeight. */
  function makeGradient(ctx: CanvasRenderingContext2D, fill: string, pixelHeight: number): CanvasGradient {
    const grad = ctx.createLinearGradient(0, 0, 0, pixelHeight);
    grad.addColorStop(0, fill);
    grad.addColorStop(0.5, brighten(fill));
    grad.addColorStop(1, fill);
    return grad;
  }

  function drawMono(
    cv: HTMLCanvasElement,
    buf: AudioBuffer,
    w: number,
    h: number,
    fill: string,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const { pixelWidth, pixelHeight } = canvasSizing(w, h, dpr);
    cv.width = pixelWidth;
    cv.height = pixelHeight;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    const peaks = extractPeaks(buf, pixelWidth);
    const mid = pixelHeight / 2;
    const amp = pixelHeight / 2;
    ctx.fillStyle = makeGradient(ctx, fill, pixelHeight);
    for (let x = 0; x < pixelWidth; x++) {
      let lo = 0, hi = 0;
      for (const ch of peaks.channels) {
        if ((ch.min[x] ?? 0) < lo) lo = ch.min[x] ?? 0;
        if ((ch.max[x] ?? 0) > hi) hi = ch.max[x] ?? 0;
      }
      const yTop = mid - hi * amp;
      const yBottom = mid - lo * amp;
      ctx.fillRect(x, yTop, 1, Math.max(1, yBottom - yTop));
    }
    // 1px horizontal midline across the full width.
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(0, Math.round(mid), pixelWidth, 1);
  }

  function drawChannel(
    cv: HTMLCanvasElement,
    buf: AudioBuffer,
    channelIndex: number,
    w: number,
    h: number,
    fill: string,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const { pixelWidth, pixelHeight } = canvasSizing(w, h, dpr);
    cv.width = pixelWidth;
    cv.height = pixelHeight;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    const peaks = extractPeaks(buf, pixelWidth);
    const ch = peaks.channels[channelIndex];
    if (!ch) return;
    const mid = pixelHeight / 2;
    const amp = pixelHeight / 2;
    ctx.fillStyle = makeGradient(ctx, fill, pixelHeight);
    for (let x = 0; x < pixelWidth; x++) {
      const lo = ch.min[x] ?? 0;
      const hi = ch.max[x] ?? 0;
      const yTop = mid - hi * amp;
      const yBottom = mid - lo * amp;
      ctx.fillRect(x, yTop, 1, Math.max(1, yBottom - yTop));
    }
    // 1px horizontal midline across the full width.
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(0, Math.round(mid), pixelWidth, 1);
  }
</script>

<div class="relative" style="width: {width}px; height: {height}px">
  {#if isStereo}
    <!-- L channel -->
    <canvas
      bind:this={canvasL}
      class="block w-full"
      style="height: {halfH}px"
    ></canvas>
    <!-- 1px separator -->
    <div class="w-full bg-[var(--color-border)]" style="height: 1px"></div>
    <!-- R channel -->
    <canvas
      bind:this={canvasR}
      class="block w-full"
      style="height: {halfH}px"
    ></canvas>
  {:else}
    <canvas bind:this={canvasMono} class="block h-full w-full"></canvas>
  {/if}
</div>
