/**
 * Shared E2E helpers: loading generated audio into the app and locating the timeline
 * ruler. Keeps the specs focused on the behaviour under test.
 */
import { expect, type Page } from '@playwright/test';
import { writeTempWav, type WavOptions } from './wav.js';

/**
 * Generate a WAV and load it into the app via the hidden file input (adds a track).
 * Waits until the new track's waveform lane has rendered — counting lanes rather than
 * waiting for "a canvas", so loading a second clip doesn't resolve against the first.
 */
export async function loadGeneratedClip(page: Page, name: string, opts: WavOptions): Promise<void> {
  const lanes = page.locator('main [data-track-id]');
  const before = await lanes.count();
  const path = await writeTempWav(name, opts);
  await page.locator('input[type=file]').setInputFiles(path);
  await expect(lanes).toHaveCount(before + 1);
}

/** Bounding box + backing-store size + a non-blank-pixel count for the ruler canvas. */
export async function rulerCanvas(page: Page): Promise<{
  x: number;
  y: number;
  w: number;
  h: number;
  backingWidth: number;
  nonBlank: number;
}> {
  const info = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('main canvas')];
    for (const c of canvases) {
      const row = c.closest('div.flex');
      if (row && row.textContent?.includes('Timeline')) {
        const r = c.getBoundingClientRect();
        const g = c.getContext('2d')!;
        let nonBlank = 0;
        try {
          const { data } = g.getImageData(0, 0, Math.min(c.width, 2000), c.height);
          for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) nonBlank++;
        } catch {
          /* tainted/oversized — leave nonBlank at 0 */
        }
        return { x: r.x, y: r.y, w: r.width, h: r.height, backingWidth: c.width, nonBlank };
      }
    }
    return null;
  });
  if (!info) throw new Error('ruler canvas not found');
  return info;
}

/** The id of the track at `index` in the project, via the test hook. */
export function trackIdAt(page: Page, index: number): Promise<string> {
  return page.evaluate((i) => {
    const studio = (window as unknown as { __studio: { project: { tracks: { id: string }[] } } })
      .__studio;
    const id = studio.project.tracks[i]?.id;
    if (!id) throw new Error(`no track at index ${i}`);
    return id;
  }, index);
}

/** A track's live gain-node value, via the test hook (undefined if not yet wired). */
export function liveTrackGain(page: Page, trackId: string): Promise<number | undefined> {
  return page.evaluate((id) => {
    const studio = (window as unknown as { __studio: { liveTrackGain(id: string): number | undefined } })
      .__studio;
    return studio.liveTrackGain(id);
  }, trackId);
}

/** A track's effect chain (kind + bypass per effect) from the model, via the test hook. */
export function trackEffects(
  page: Page,
  trackId: string,
): Promise<{ id: string; kind: string; bypass: boolean }[]> {
  return page.evaluate((id) => {
    const studio = (
      window as unknown as {
        __studio: {
          project: { tracks: { id: string; effects?: { id: string; kind: string; bypass: boolean }[] }[] };
        };
      }
    ).__studio;
    const t = studio.project.tracks.find((x) => x.id === id);
    return (t?.effects ?? []).map((e) => ({ id: e.id, kind: e.kind, bypass: e.bypass }));
  }, trackId);
}

/** Whether a track has a non-empty LIVE effect chain (the built audio nodes), via the hook. */
export function liveTrackHasEffects(page: Page, trackId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const studio = (window as unknown as { __studio: { liveTrackHasEffects(id: string): boolean } })
      .__studio;
    return studio.liveTrackHasEffects(id);
  }, trackId);
}

/** Widths (px) of the track waveform lanes, in DOM order. */
export function laneWidths(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('main [data-track-id]')]
      .map((row) => {
        const lane = row.querySelector<HTMLElement>('[data-lane]');
        return lane ? Math.round(lane.getBoundingClientRect().width) : 0;
      })
      .filter((w) => w > 0),
  );
}
