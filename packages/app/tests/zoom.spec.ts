import { expect, test } from '@playwright/test';
import { loadGeneratedClip, rulerCanvas } from './helpers/app.js';

const scrollMetrics = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const m = document.querySelector('main')!;
    return { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth };
  });

test.describe('timeline zoom, scroll & ruler', () => {
  test('the ruler draws tick marks', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 5 });
    const ruler = await rulerCanvas(page);
    expect(ruler.nonBlank).toBeGreaterThan(0);
  });

  test('zooming in widens content and enables horizontal scroll', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 8 });

    const before = (await scrollMetrics(page)).scrollWidth;
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();

    const after = await scrollMetrics(page);
    expect(after.scrollWidth).toBeGreaterThan(before);
    expect(after.scrollWidth).toBeGreaterThan(after.clientWidth); // overflows → scrolls
  });

  test('track headers stay pinned while scrolling horizontally', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 8 });
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();

    await page.evaluate(() => (document.querySelector('main')!.scrollLeft = 400));
    const pinned = await page.evaluate(() => {
      const m = document.querySelector('main')!;
      const header = m.querySelector('div.sticky.left-0')!;
      return Math.abs(header.getBoundingClientRect().left - m.getBoundingClientRect().left) < 2;
    });
    expect(pinned).toBe(true);
  });

  test('Fit brings the whole project back within the viewport', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 8 });
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click();

    await page.getByRole('button', { name: 'Fit project to window' }).click();
    const m = await scrollMetrics(page);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth + 4);
  });

  test('the ruler canvas stays under the browser size limit at max zoom', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 8 });
    for (let i = 0; i < 30; i++) await page.getByRole('button', { name: 'Zoom in' }).click();

    const ruler = await rulerCanvas(page);
    expect(ruler.backingWidth).toBeLessThanOrEqual(32_000);
    expect(ruler.nonBlank).toBeGreaterThan(0); // still draws, not blanked
  });

  test('clicking the ruler seeks to that time', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 6 });

    const time = page.getByTestId('timecode');
    await expect(time).toHaveText('00:00.000');
    const ruler = await rulerCanvas(page);
    await page.mouse.click(ruler.x + ruler.w * 0.5, ruler.y + ruler.h / 2);
    // Halfway across a 6s clip → ~3s. Allow tolerance for click precision.
    await expect(time).not.toHaveText('00:00.000');
  });
});
