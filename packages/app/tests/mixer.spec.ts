import { expect, test } from '@playwright/test';
import { liveTrackGain, loadGeneratedClip, trackIdAt } from './helpers/app.js';

test.describe('live track mixer', () => {
  test('mute, volume, and solo take effect while playing', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'a.wav', { seconds: 3 });
    await loadGeneratedClip(page, 'b.wav', { seconds: 3 });

    const trackA = await trackIdAt(page, 0);
    const trackB = await trackIdAt(page, 1);

    await page.getByRole('button', { name: 'Play' }).click();

    // While playing, both tracks start at unity (default gain 1.0).
    await expect.poll(() => liveTrackGain(page, trackA)).toBeCloseTo(1, 1);
    await expect.poll(() => liveTrackGain(page, trackB)).toBeCloseTo(1, 1);

    // Mute track A mid-playback → its live gain ramps to ~0 without a restart.
    await page.locator('button[title="Mute"]').first().click();
    await expect.poll(() => liveTrackGain(page, trackA) ?? 1).toBeLessThan(0.05);
    // Track B is unaffected.
    await expect.poll(() => liveTrackGain(page, trackB)).toBeCloseTo(1, 1);

    // Unmute → back up to unity.
    await page.locator('button[title="Mute"]').first().click();
    await expect.poll(() => liveTrackGain(page, trackA)).toBeCloseTo(1, 1);

    // Drag track A's volume slider down mid-play → live gain follows.
    await page.locator('input[type=range]').first().fill('0.3');
    await expect.poll(() => liveTrackGain(page, trackA)).toBeCloseTo(0.3, 1);

    // Solo track B → A (un-soloed) drops to ~0, B stays audible.
    await page.locator('button[title="Solo"]').nth(1).click();
    await expect.poll(() => liveTrackGain(page, trackA) ?? 1).toBeLessThan(0.05);
    await expect.poll(() => liveTrackGain(page, trackB)).toBeCloseTo(1, 1);
  });
});
