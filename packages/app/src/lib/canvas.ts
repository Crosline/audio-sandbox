/**
 * Canvas sizing helpers shared by the waveform and ruler.
 *
 * A canvas's backing store has a hard per-dimension limit in browsers (~32,767 px in
 * Chromium/Firefox/WebKit). At high zoom a lane can be tens of thousands of CSS px wide,
 * which would blow past that limit and silently blank the overflow. We therefore cap the
 * backing-store width and let the (smaller-resolution) canvas stretch via CSS to the true
 * display width — detail saturates past the cap, but nothing ever blanks.
 */

/** Safe max backing-store width in device pixels. Below the ~32,767 px browser ceiling. */
export const MAX_CANVAS_PX = 32_000;

export interface CanvasSizing {
  /** Backing-store width in device pixels (capped). Use this as the peak/tick bin count. */
  pixelWidth: number;
  /** Backing-store height in device pixels. */
  pixelHeight: number;
  /** Horizontal scale to map a unit of backing width back to CSS px (cssWidth / pixelWidth). */
  scaleX: number;
}

/**
 * Compute backing-store dimensions for a canvas displayed at `cssWidth × cssHeight`,
 * honouring device pixel ratio but never exceeding {@link MAX_CANVAS_PX} horizontally.
 *
 * When uncapped, `pixelWidth = cssWidth * dpr` and `scaleX = 1/dpr` (the usual Retina
 * setup). When capped, `pixelWidth = MAX_CANVAS_PX` and `scaleX` widens so drawing spans
 * the full CSS width at lower resolution.
 */
export function canvasSizing(cssWidth: number, cssHeight: number, dpr: number): CanvasSizing {
  const wanted = Math.max(1, Math.floor(cssWidth * dpr));
  const pixelWidth = Math.min(wanted, MAX_CANVAS_PX);
  const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr));
  // CSS px per backing px, so a draw loop over [0, pixelWidth) covers the full cssWidth.
  const scaleX = cssWidth / pixelWidth;
  return { pixelWidth, pixelHeight, scaleX };
}
