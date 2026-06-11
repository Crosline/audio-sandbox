import { expect, test } from '@playwright/test';
import { liveTrackHasEffects, loadGeneratedClip, trackEffects, trackIdAt } from './helpers/app.js';

test.describe('pedalboard', () => {
  test('add / reorder / remove effects updates the chain and live graph', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'a.wav', { seconds: 2 });
    const trackId = await trackIdAt(page, 0);

    // The pedalboard is closed by default — open it via the transport FX toggle.
    await page.getByRole('button', { name: 'Show Pedalboard FX' }).click();
    const pedalboard = page.locator('[data-pedalboard]');
    await expect(pedalboard.getByText('No effects yet.')).toBeVisible();

    // Add a Filter via the + FX menu.
    await page.getByRole('button', { name: 'Add effect' }).click();
    await page.getByRole('menuitem', { name: 'Filter' }).click();

    await expect(pedalboard.locator('[data-effect-kind]')).toHaveCount(1);
    expect(await trackEffects(page, trackId)).toMatchObject([{ kind: 'filter' }]);
    // The live chain was (re)built for this track.
    expect(await liveTrackHasEffects(page, trackId)).toBe(true);

    // Add a Delay → chain is [filter, delay].
    await page.getByRole('button', { name: 'Add effect' }).click();
    await page.getByRole('menuitem', { name: 'Delay' }).click();
    expect((await trackEffects(page, trackId)).map((e) => e.kind)).toEqual(['filter', 'delay']);

    // Move the delay left → [delay, filter].
    await page.locator('[data-effect-kind="delay"]').getByRole('button', { name: 'Move effect left' }).click();
    expect((await trackEffects(page, trackId)).map((e) => e.kind)).toEqual(['delay', 'filter']);

    // Remove the filter → [delay].
    await page.locator('[data-effect-kind="filter"]').getByRole('button', { name: 'Remove effect' }).click();
    expect((await trackEffects(page, trackId)).map((e) => e.kind)).toEqual(['delay']);
  });

  test('bypass toggles the model flag and undo restores the prior chain', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'a.wav', { seconds: 2 });
    const trackId = await trackIdAt(page, 0);

    // The pedalboard is closed by default — open it via the transport FX toggle.
    await page.getByRole('button', { name: 'Show Pedalboard FX' }).click();
    await page.getByRole('button', { name: 'Add effect' }).click();
    await page.getByRole('menuitem', { name: 'Distortion' }).click();
    expect(await trackEffects(page, trackId)).toMatchObject([{ kind: 'distortion', bypass: false }]);

    // Bypass it.
    await page.locator('[data-effect-kind="distortion"]').getByRole('button', { name: 'Bypass' }).click();
    expect(await trackEffects(page, trackId)).toMatchObject([{ bypass: true }]);

    // Undo the bypass → back to enabled.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await trackEffects(page, trackId)).toMatchObject([{ bypass: false }]);

    // Undo the add → empty chain, live graph has no effects.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await trackEffects(page, trackId)).toHaveLength(0);
    expect(await liveTrackHasEffects(page, trackId)).toBe(false);

    // Redo the add → effect returns.
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await trackEffects(page, trackId)).toHaveLength(1);
  });
});
