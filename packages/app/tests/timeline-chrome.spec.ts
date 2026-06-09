import { test, expect, type Page } from '@playwright/test';
import { makeWav } from './helpers/wav.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

/**
 * Build a stereo (2-channel interleaved) 16-bit PCM WAV in memory.
 * makeWav() only generates mono, so we construct the RIFF/WAV header ourselves.
 */
function makeStereoWav(seconds = 1, sampleRate = 44100): Uint8Array {
  const numChannels = 2;
  const numSamples = Math.max(1, Math.round(seconds * sampleRate));
  const bytesPerSample = 2; // int16
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = numSamples * blockAlign;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);

  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  const freq = 440;
  const amp = 0.5;
  const twoPiF = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.round(Math.sin(twoPiF * i) * amp * 32767);
    const clamped = Math.max(-32768, Math.min(32767, s));
    view.setInt16(44 + i * blockAlign, clamped, true);      // L
    view.setInt16(44 + i * blockAlign + 2, clamped, true);  // R
  }

  return new Uint8Array(buf);
}

async function writeTempFile(name: string, data: Uint8Array): Promise<string> {
  const path = join(tmpdir(), `audiosandbox-e2e-${Date.now()}-${name}`);
  await writeFile(path, data);
  return path;
}

/**
 * Load a WAV file into the app via the hidden file input (creates a new track).
 * Waits until the new track's waveform lane has rendered.
 */
async function loadClip(page: Page, data: Uint8Array, name: string): Promise<void> {
  const lanes = page.locator('main div.h-24:has(canvas)');
  const before = await lanes.count();
  const path = await writeTempFile(name, data);
  await page.locator('input[type=file]').setInputFiles(path);
  await expect(lanes).toHaveCount(before + 1);
}

test.describe('timeline chrome', () => {
  test('stereo buffer shows two canvases in a waveform', async ({ page }) => {
    await page.goto('/');
    await loadClip(page, makeStereoWav(), 'stereo.wav');
    // Stereo waveform renders two canvas elements inside the clip box.
    const clip = page.locator('[data-testid="clip"]').first();
    const canvases = clip.locator('canvas');
    await expect(canvases).toHaveCount(2);
  });

  test('mono buffer shows one canvas in a waveform', async ({ page }) => {
    await page.goto('/');
    await loadClip(page, makeWav({ seconds: 1, sampleRate: 44100 }), 'mono.wav');
    const clip = page.locator('[data-testid="clip"]').first();
    const canvases = clip.locator('canvas');
    await expect(canvases).toHaveCount(1);
  });

  test('minimap appears after a track is added', async ({ page }) => {
    await page.goto('/');
    await loadClip(page, makeWav({ seconds: 1, sampleRate: 44100 }), 'a.wav');
    // Minimap canvas is the 200×48 one positioned bottom-right.
    const minimap = page.locator('canvas[width="200"][height="48"]');
    await expect(minimap).toBeVisible();
  });

  test('clicking minimap scrolls the timeline', async ({ page }) => {
    await page.goto('/');
    // Import a long file so the project extends beyond the viewport.
    await loadClip(page, makeWav({ seconds: 30, sampleRate: 44100 }), 'long.wav');
    const minimap = page.locator('canvas[width="200"][height="48"]');
    await expect(minimap).toBeVisible();
    const scroller = page.locator('main');
    const beforeScroll = await scroller.evaluate((el: HTMLElement) => el.scrollLeft);
    // Click right side of minimap → should scroll right.
    await minimap.click({ position: { x: 180, y: 24 } });
    const afterScroll = await scroller.evaluate((el: HTMLElement) => el.scrollLeft);
    expect(afterScroll).toBeGreaterThan(beforeScroll);
  });
});
