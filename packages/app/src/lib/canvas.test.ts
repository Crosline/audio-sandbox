import { describe, expect, it } from 'vitest';
import { canvasSizing, MAX_CANVAS_PX } from './canvas.js';

describe('canvasSizing', () => {
  it('uses dpr-scaled dimensions when below the cap (the usual Retina case)', () => {
    const { pixelWidth, pixelHeight, scaleX } = canvasSizing(800, 96, 2);
    expect(pixelWidth).toBe(1600);
    expect(pixelHeight).toBe(192);
    // scaleX = cssWidth / pixelWidth = 800 / 1600 = 1/dpr.
    expect(scaleX).toBeCloseTo(0.5, 12);
  });

  it('leaves scaleX at 1 when dpr is 1 and uncapped', () => {
    const { pixelWidth, scaleX } = canvasSizing(500, 96, 1);
    expect(pixelWidth).toBe(500);
    expect(scaleX).toBe(1);
  });

  it('caps the backing-store width at MAX_CANVAS_PX', () => {
    // 10s clip at 5000 px/s = 50_000 css px, dpr 1 -> wanted 50_000, capped to MAX.
    const { pixelWidth } = canvasSizing(50_000, 96, 1);
    expect(pixelWidth).toBe(MAX_CANVAS_PX);
  });

  it('caps even when dpr would push a moderate width over the limit', () => {
    // 20_000 css px × dpr 2 = 40_000 wanted, over the 32_000 cap.
    const { pixelWidth } = canvasSizing(20_000, 96, 2);
    expect(pixelWidth).toBe(MAX_CANVAS_PX);
  });

  it('widens scaleX past the cap so drawing still spans the full css width', () => {
    // Past the cap, [0, pixelWidth) must still cover cssWidth, so scaleX > 1.
    const cssWidth = 50_000;
    const { pixelWidth, scaleX } = canvasSizing(cssWidth, 96, 1);
    expect(scaleX).toBeCloseTo(cssWidth / pixelWidth, 12);
    expect(scaleX).toBeGreaterThan(1);
    // The invariant that prevents blanking: pixelWidth * scaleX === cssWidth.
    expect(pixelWidth * scaleX).toBeCloseTo(cssWidth, 6);
  });

  it('the backing store never exceeds the browser ceiling for any zoom', () => {
    for (const cssWidth of [1, 1000, 32_000, 33_000, 100_000, 1_000_000]) {
      const { pixelWidth } = canvasSizing(cssWidth, 96, 2);
      expect(pixelWidth).toBeLessThanOrEqual(MAX_CANVAS_PX);
    }
  });

  it('floors fractional pixels and never returns a zero dimension', () => {
    const { pixelWidth, pixelHeight } = canvasSizing(10.9, 24.9, 1.5);
    // floor(10.9 * 1.5) = floor(16.35) = 16; floor(24.9 * 1.5) = floor(37.35) = 37.
    expect(pixelWidth).toBe(16);
    expect(pixelHeight).toBe(37);
  });

  it('clamps a zero/sub-pixel width up to at least 1 backing pixel', () => {
    const { pixelWidth, pixelHeight } = canvasSizing(0, 0, 2);
    expect(pixelWidth).toBe(1);
    expect(pixelHeight).toBe(1);
  });
});
