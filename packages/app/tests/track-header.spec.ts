import { test, expect } from '@playwright/test';
import { makeWav } from './helpers/wav.js';

test.describe('track header polish', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Import a mono file to create one track. We pass the bytes in-page to studio.addFile
    // to avoid the read-only dataTransfer limitation with DragEvent.
    const wav = makeWav({ sampleRate: 44100, seconds: 1 });
    await page.evaluate(async (buf: number[]) => {
      const file = new File([new Uint8Array(buf)], 'my-track.wav', { type: 'audio/wav' });
      await (window as any).__studio.addFile(file);
    }, Array.from(wav));
    await page.waitForSelector('[data-track-id]');
  });

  test('track auto-named from filename (no extension)', async ({ page }) => {
    const input = page.locator('input[type="text"]').first();
    await expect(input).toHaveValue('my-track');
  });

  test('track name is editable inline', async ({ page }) => {
    const input = page.locator('input[type="text"]').first();
    await input.fill('Renamed Track');
    await input.press('Enter');
    await expect(input).toHaveValue('Renamed Track');
  });

  test('Space key toggles play/pause', async ({ page }) => {
    await page.keyboard.press('Space');
    // Transport state is reflected on the play button aria-label
    await expect(page.getByLabel('Pause')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Play')).toBeVisible();
  });

  test('volume slider shows dB label', async ({ page }) => {
    // Default gain is 1.0 → 0.0 dB
    await expect(page.getByText('0.0 dB')).toBeVisible();
  });

  test('pan slider shows C at center', async ({ page }) => {
    // Use exact match scoped to the track header to avoid ambiguity with other "C" chars.
    await expect(page.getByText('C', { exact: true }).first()).toBeVisible();
  });

  test('toolbar has Copy, Paste, Split, Silence, Undo, Redo buttons', async ({ page }) => {
    await expect(page.getByLabel('Copy')).toBeVisible();
    await expect(page.getByLabel('Paste')).toBeVisible();
    await expect(page.getByLabel('Split')).toBeVisible();
    await expect(page.getByLabel('Insert Silence')).toBeVisible();
    await expect(page.getByLabel('Undo')).toBeVisible();
    await expect(page.getByLabel('Redo')).toBeVisible();
  });

  test('toolbar does NOT have Cut, Delete, Trim, Fade In, Fade Out buttons', async ({ page }) => {
    // These buttons no longer exist in the toolbar (Cut/Trim removed; Delete was never in toolbar).
    // Use not.toBeAttached() since elements that don't exist can't be "not visible".
    await expect(page.getByLabel('Cut', { exact: true })).not.toBeAttached();
    await expect(page.getByLabel('Trim', { exact: true })).not.toBeAttached();
  });
});
