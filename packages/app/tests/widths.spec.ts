import { expect, test } from '@playwright/test';
import { laneWidths, loadGeneratedClip } from './helpers/app.js';

test.describe('timeline track widths & empty state', () => {
  test('empty project shows the global drop message, not a per-track prompt', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Drop an audio file here')).toBeVisible();

    // Adding an empty track must NOT render a stretched "Drop audio here" strip.
    await page.getByRole('button', { name: '+ Track' }).click();
    await expect(page.getByText('Drop audio here')).toHaveCount(0);
  });

  test('tracks render at widths proportional to their duration', async ({ page }) => {
    await page.goto('/');
    // ~2s and ~6s clips → the long lane should be ~3× the short one (both at 100 px/s).
    await loadGeneratedClip(page, 'short.wav', { seconds: 2 });
    await loadGeneratedClip(page, 'long.wav', { seconds: 6 });

    const widths = (await laneWidths(page)).filter((w) => w > 10).sort((a, b) => a - b);
    expect(widths.length).toBe(2);
    const ratio = widths[1]! / widths[0]!;
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
    // 100 px/s default: a 6s clip is ~600px, far wider than the old equal-stretch.
    expect(widths[1]!).toBeGreaterThan(500);
  });
});
