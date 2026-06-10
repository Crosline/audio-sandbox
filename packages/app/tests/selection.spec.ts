import { expect, test, type Page } from '@playwright/test';
import { laneWidths, loadGeneratedClip } from './helpers/app.js';

/** The first track's waveform lane (the drag/select surface). */
function lane(page: Page) {
  return page.locator('main [data-track-id] [data-lane]').first();
}

/** Drag across the lane from xFrac→xFrac of its width to create a selection. */
async function dragSelect(page: Page, fromFrac: number, toFrac: number): Promise<void> {
  const box = (await lane(page).boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * fromFrac, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toFrac, y, { steps: 8 });
  await page.mouse.up();
}

/** The studio's current selection via the test hook. */
function selection(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __studio: { selection: { start: number; end: number } | null } })
        .__studio.selection,
  );
}

test.describe('selection + editing', () => {
  test('dragging on a lane creates a highlight and updates the readout', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 4 });

    await dragSelect(page, 0.25, 0.6);

    await expect(page.locator('[data-testid=selection]')).toBeVisible();
    const sel = await selection(page);
    expect(sel).not.toBeNull();
    expect(sel!.end).toBeGreaterThan(sel!.start);
    // ~25%..60% of a 4s clip ≈ 1s..2.4s.
    expect(sel!.start).toBeGreaterThan(0.5);
    expect(sel!.end).toBeLessThan(3);
    await expect(page.getByTestId('selection-readout')).toContainText('Sel');
  });

  test('clicking a clip object-selects it and clears the range selection', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 4 });

    await dragSelect(page, 0.25, 0.6);
    expect(await selection(page)).not.toBeNull();

    // A plain click (no drag) on the clip now object-selects it (the Step 8b interaction model)
    // and clears the time-range selection. Seeking is reserved for the empty lane background.
    const box = (await lane(page).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    expect(await selection(page)).toBeNull();
    await expect(page.getByTestId('selection-readout')).toContainText('No selection');

    const selectedClip = await page.evaluate(
      () => (window as unknown as { __studio: { selectedClip: unknown } }).__studio.selectedClip,
    );
    expect(selectedClip).not.toBeNull();
  });

  test('Cut shortens the clip; Undo restores it; Redo re-applies', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 4 });
    const [original] = await laneWidths(page);

    await dragSelect(page, 0.25, 0.75); // ~half the clip
    await page.keyboard.press('Control+x');

    const afterCut = (await laneWidths(page))[0]!;
    expect(afterCut).toBeLessThan(original! - 50);

    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await laneWidths(page))[0]!).toBeCloseTo(original!, -1);

    await page.getByRole('button', { name: 'Redo' }).click();
    expect((await laneWidths(page))[0]!).toBeCloseTo(afterCut, -1);
  });

  test('Copy then Paste creates a new clip at the playhead', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 4 });

    // Seek to a gap past the clip's end so paste lands on a clear spot.
    await page.evaluate(() => (window as any).__studio.seek(5));
    await dragSelect(page, 0.25, 0.5);
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.getByRole('button', { name: 'Paste', exact: true }).click();

    // Paste creates a new clip — the project now has more clips than before.
    const clipCount = await page.evaluate(
      () => (window as any).__studio.project.tracks.reduce((n: number, t: any) => n + t.clips.length, 0),
    );
    expect(clipCount).toBeGreaterThan(1);
  });

  test('playing with a selection auditions just that range and stops at its end', async ({
    page,
  }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 4 });

    // Select roughly the first quarter→half (≈1s..2s of the 4s clip).
    await dragSelect(page, 0.25, 0.5);
    const sel = (await selection(page))!;
    const rangeLen = sel.end - sel.start;
    expect(rangeLen).toBeGreaterThan(0.4);
    expect(sel.end).toBeLessThan(3); // sanity: a real sub-range of the 4s clip

    const t0 = Date.now();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    // Playback runs in real time; wait for it to auto-stop.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __studio: { transportState: string } }).__studio
                .transportState,
          ),
        { timeout: 5000 },
      )
      .toBe('stopped');
    const elapsed = (Date.now() - t0) / 1000;

    // It stopped after auditioning ~rangeLen seconds, NOT after the full 4s clip — proving the
    // audition honoured the selection end rather than the project end.
    expect(elapsed).toBeLessThan(rangeLen + 1.5);
    expect(elapsed).toBeLessThan(3.5);
  });

  test('range-edit buttons enable only with a selection', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 4 });

    // No selection yet → Copy/Silence disabled.
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Insert Silence' })).toBeDisabled();

    await dragSelect(page, 0.2, 0.7);
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Insert Silence' })).toBeEnabled();
  });
});
