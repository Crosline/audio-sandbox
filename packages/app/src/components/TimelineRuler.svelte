<script lang="ts">
  /**
   * The timeline ruler: labeled second-markers drawn to a canvas spanning the full content
   * width, plus click-to-seek. Tick density adapts to zoom so labels stay readable. Lives
   * in the app (it's a view concern); it only takes pixels-per-second and a width in.
   */
  import { canvasSizing } from '../lib/canvas.js';

  interface Props {
    /** CSS pixels per second — the timeline scale. Drives tick spacing. */
    pxPerSec: number;
    /** Full ruler width in CSS px (project duration × pxPerSec). */
    width: number;
    /** Height in CSS px. */
    height?: number;
    /** Called with a time (seconds) when the ruler is clicked. */
    onseek: (seconds: number) => void;
  }

  let { pxPerSec, width, height = 24, onseek }: Props = $props();

  let canvas: HTMLCanvasElement;

  // Candidate tick intervals (seconds), smallest to largest. We pick the smallest whose
  // on-screen spacing clears MIN_LABEL_PX so labels never crowd.
  const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const MIN_LABEL_PX = 64;

  /** Pick a "nice" tick interval (seconds) for the current scale. */
  function chooseInterval(pps: number): number {
    for (const step of TICK_STEPS) {
      if (step * pps >= MIN_LABEL_PX) return step;
    }
    return TICK_STEPS[TICK_STEPS.length - 1]!;
  }

  /** Format a tick label: whole seconds as m:ss, sub-second as a decimal seconds value. */
  function labelFor(seconds: number, interval: number): string {
    if (interval < 1) return `${seconds.toFixed(1)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  }

  $effect(() => {
    if (!canvas || width <= 0) return;
    draw(canvas, width, height, pxPerSec);
  });

  function draw(cv: HTMLCanvasElement, w: number, h: number, pps: number): void {
    // Cap the backing store below the browser's max canvas dimension; the canvas stretches
    // via CSS to the true width `w`. Drawing stays in CSS-px coordinates by scaling the
    // context by (pixelWidth/w, pixelHeight/h), so all the tick math below is unchanged.
    const dpr = window.devicePixelRatio || 1;
    const { pixelWidth, pixelHeight } = canvasSizing(w, h, dpr);
    cv.width = pixelWidth;
    cv.height = pixelHeight;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(pixelWidth / w, 0, 0, pixelHeight / h, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const interval = chooseInterval(pps);
    // Minor ticks at half the major interval for a finer grid.
    const minor = interval / 2;
    const muted = 'rgba(148, 163, 184, 0.6)'; // slate-ish, matches --color-muted vibe
    const faint = 'rgba(148, 163, 184, 0.25)';

    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'top';

    // Minor ticks.
    ctx.strokeStyle = faint;
    ctx.beginPath();
    for (let t = 0, x = 0; x <= w; t += minor, x = t * pps) {
      // Skip positions that coincide with a major tick (drawn below).
      if (Math.abs((t / interval) - Math.round(t / interval)) < 1e-6) continue;
      ctx.moveTo(Math.round(x) + 0.5, h - 5);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    ctx.stroke();

    // Major ticks + labels.
    ctx.strokeStyle = muted;
    ctx.fillStyle = muted;
    ctx.beginPath();
    for (let t = 0, x = 0; x <= w; t += interval, x = t * pps) {
      const px = Math.round(x) + 0.5;
      ctx.moveTo(px, h - 9);
      ctx.lineTo(px, h);
      ctx.fillText(labelFor(t, interval), Math.round(x) + 3, 2);
    }
    ctx.stroke();
  }

  function onClick(e: MouseEvent): void {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    onseek(Math.max(0, x) / pxPerSec);
  }
</script>

<!-- The button spans the full content width; offsetX maps directly to time (x=0 → t=0). -->
<button
  type="button"
  class="block shrink-0 cursor-text border-b border-[var(--color-border)] bg-[var(--color-bg)] p-0"
  style="width: {width}px; height: {height}px"
  aria-label="Seek"
  title="Click to seek"
  onclick={onClick}
>
  <canvas bind:this={canvas} class="block h-full w-full"></canvas>
</button>
