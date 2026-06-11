import { expect, test } from '@playwright/test';
import { loadGeneratedClip, rulerCanvas } from './helpers/app.js';

test.describe('transport stop-at-end', () => {
  test('playback stops and the playhead resets to 0 at the project end', async ({ page }) => {
    await page.goto('/');
    // A short clip keeps the test fast: seek near the end, then let the tail finish.
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });

    // Seek to ~98% via the ruler so only a sliver of audio remains.
    const ruler = await rulerCanvas(page);
    await page.mouse.click(ruler.x + ruler.w * 0.98, ruler.y + ruler.h / 2);

    const time = page.getByTestId('timecode');
    await expect(time).not.toHaveText('00:00.000'); // seek landed near the end

    await page.getByRole('button', { name: 'Play' }).click();

    // Once the tail finishes, the studio's RAF loop calls stop() → playhead resets to 0
    // and the button flips back to Play.
    await expect(time).toHaveText('00:00.000', { timeout: 4000 });
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  });
});
