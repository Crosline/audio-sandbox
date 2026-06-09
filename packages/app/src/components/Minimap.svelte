<script lang="ts">
  import { clipDuration } from '@audiosandbox/engine';
  import type { Project } from '@audiosandbox/engine';

  interface Props {
    project: Project;
    pxPerSec: number;
    totalDuration: number;
    scrollLeft: number;
    /** Lane viewport width in CSS px (scroller width minus header column). */
    viewportWidth: number;
    /** Height per track in px, keyed by track id. Missing entries default to 96. */
    trackHeights: Map<string, number>;
    /** Accent color per track (parallel to project.tracks). */
    trackColors: string[];
    onscroll: (scrollLeft: number) => void;
  }

  let {
    project,
    pxPerSec,
    totalDuration,
    scrollLeft,
    viewportWidth,
    trackHeights,
    trackColors,
    onscroll,
  }: Props = $props();

  const W = 200;
  const H = 48;

  let canvas: HTMLCanvasElement;
  let pointerPressed = false;

  // Total pixel width of the full project at current zoom.
  const totalPx = $derived(Math.max(1, totalDuration * pxPerSec));
  // Total stacked height of all tracks in px.
  const totalTrackH = $derived(
    project.tracks.reduce((sum, t) => sum + (trackHeights.get(t.id) ?? 96), 0) || 1,
  );
  // Scale factors: map project-space px → minimap px.
  const scaleX = $derived(W / totalPx);
  const scaleY = $derived(H / totalTrackH);

  $effect(() => {
    if (!canvas) return;
    draw();
  });

  function draw(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    let yOffset = 0;
    for (let i = 0; i < project.tracks.length; i++) {
      const track = project.tracks[i]!;
      const th = trackHeights.get(track.id) ?? 96;
      const color = trackColors[i] ?? '#7c5cff';
      const ty = yOffset * scaleY;
      const th2 = th * scaleY;

      // Track background band.
      ctx.fillStyle = color + '40'; // ~25% opacity
      ctx.fillRect(0, ty, W, th2);

      // Clips.
      ctx.fillStyle = color + 'b3'; // ~70% opacity
      for (const clip of track.clips) {
        const cx = clip.start * pxPerSec * scaleX;
        const cw = Math.max(1, clipDuration(clip) * pxPerSec * scaleX);
        ctx.fillRect(cx, ty, cw, th2);
      }

      yOffset += th;
    }

    // Viewport rectangle. CSS variables don't work in canvas strokeStyle — read the
    // resolved value from the element's computed style instead.
    const vx = Math.max(0, scrollLeft * scaleX);
    const vw = Math.min(W - vx, viewportWidth * scaleX);
    const accentColor =
      getComputedStyle(canvas).getPropertyValue('--color-accent').trim() || '#a855f7';
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(vx + 0.5, 0.5, Math.max(2, vw - 1), H - 1);
  }

  function pointerToScrollLeft(offsetX: number): number {
    const fraction = Math.max(0, Math.min(1, offsetX / W));
    const centerPx = fraction * totalPx;
    return Math.max(0, centerPx - viewportWidth / 2);
  }

  function onPointerDown(e: PointerEvent): void {
    pointerPressed = true;
    canvas.setPointerCapture(e.pointerId);
    onscroll(pointerToScrollLeft(e.offsetX));
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointerPressed) return;
    onscroll(pointerToScrollLeft(e.offsetX));
  }

  function onPointerUp(): void {
    pointerPressed = false;
  }
</script>

{#if project.tracks.length > 0}
  <div
    class="fixed bottom-25 right-3 z-30 overflow-hidden rounded-lg border border-[var(--color-border)]
           bg-[var(--color-surface)]/85 backdrop-blur-sm"
    style="width: {W}px; height: {H}px"
  >
    <canvas
      bind:this={canvas}
      width={W}
      height={H}
      class="block cursor-pointer"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointerleave={onPointerUp}
    ></canvas>
  </div>
{/if}
