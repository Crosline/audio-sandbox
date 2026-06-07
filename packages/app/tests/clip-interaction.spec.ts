import { expect, test, type Page } from '@playwright/test';
import { loadGeneratedClip } from './helpers/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All clip elements in the DOM. */
function clips(page: Page) {
  return page.locator('[data-testid=clip]');
}

/** studio.playhead via the test hook. */
function playhead(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__studio.playhead);
}

/** studio.selectedClip via the test hook. */
function selectedClip(page: Page): Promise<{ trackId: string; clipId: string } | null> {
  return page.evaluate(() => (window as any).__studio.selectedClip);
}

/** All tracks in the project, via the test hook. */
function tracks(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__studio.project.tracks);
}

/** A clip's start (seconds) by track index and clip index. */
function clipStart(page: Page, trackIdx: number, clipIdx = 0): Promise<number> {
  return page.evaluate(
    ([ti, ci]) => (window as any).__studio.project.tracks[ti].clips[ci].start,
    [trackIdx, clipIdx] as [number, number],
  );
}

/** A clip's trimEnd (seconds) by track index and clip index. */
function clipTrimEnd(page: Page, trackIdx: number, clipIdx = 0): Promise<number> {
  return page.evaluate(
    ([ti, ci]) => (window as any).__studio.project.tracks[ti].clips[ci].trimEnd ?? 0,
    [trackIdx, clipIdx] as [number, number],
  );
}

/** Buffer duration of a clip (unchanged by trim) by track index and clip index. */
function clipBufferDuration(page: Page, trackIdx: number, clipIdx = 0): Promise<number> {
  return page.evaluate(
    ([ti, ci]) => (window as any).__studio.project.tracks[ti].clips[ci].buffer.duration,
    [trackIdx, clipIdx] as [number, number],
  );
}

/** The visible pixel width of the first clip on the page. */
function firstClipWidthPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid=clip]');
    return el ? el.getBoundingClientRect().width : 0;
  });
}

/** Project duration (seconds) via the test hook. */
function projectDuration(page: Page): Promise<number> {
  return page.evaluate(() => {
    const studio = (window as any).__studio;
    // Derive it the same way the app does (max clip end across all tracks).
    const tracks = studio.project.tracks as any[];
    let d = 0;
    for (const t of tracks) {
      for (const c of t.clips) {
        const trimStart = c.trimStart ?? 0;
        const trimEnd = c.trimEnd ?? 0;
        const dur = c.buffer.duration - trimStart - trimEnd;
        d = Math.max(d, c.start + dur);
      }
    }
    return d;
  });
}

/**
 * Add a second clip programmatically onto the first track at `start` seconds, using the
 * same BufferFactory pattern as multiclip.spec.ts.
 */
async function addClipOnTrack(page: Page, trackIdx: number, start: number): Promise<void> {
  await page.evaluate(
    ([ti, s]) => {
      const studio = (window as any).__studio;
      const track = studio.project.tracks[ti];
      const buf = studio.bufferFactory(1, 8000, 8000); // 1s mono buffer
      const clip = {
        id: `extra-${Math.random().toString(36).slice(2)}`,
        buffer: buf,
        name: 'extra.wav',
        start: s,
      };
      studio.updateTrack({ ...track, clips: [...track.clips, clip] });
    },
    [trackIdx, start] as [number, number],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('clip interaction', () => {
  test('clicking a clip seeks the playhead into it and selects it', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 4 });

    const clip = clips(page).first();
    const box = (await clip.boundingBox())!;

    // Click the middle of the clip box (not the resize handle at the edges).
    const clickX = box.x + box.width / 2;
    const clickY = box.y + box.height / 2;
    await page.mouse.click(clickX, clickY);

    // selectedClip should be set.
    const sel = await selectedClip(page);
    expect(sel).not.toBeNull();
    expect(sel!.clipId).toBeTruthy();

    // Playhead should have moved into the clip (> 0 since clip starts at 0 and click was at ~2s).
    const ph = await playhead(page);
    expect(ph).toBeGreaterThan(0);
  });

  test('right-edge drag shortens the clip non-destructively; drag back restores it', async ({
    page,
  }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 4 });

    // First click-select the clip so we can measure it.
    await clips(page).first().click();

    const bufDurBefore = await clipBufferDuration(page, 0);
    const widthBefore = await firstClipWidthPx(page);
    const durBefore = await projectDuration(page);

    // Locate the right resize handle.
    const handle = page.locator('[data-testid=resize-right]').first();
    const handleBox = (await handle.boundingBox())!;

    // Drag left by 80px (shrinks visible length).
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 80, startY, { steps: 10 });
    await page.mouse.up();

    // End the resize gesture.
    await page.evaluate(() => (window as any).__studio.endClipResize());

    // Clip box should be narrower.
    const widthAfter = await firstClipWidthPx(page);
    expect(widthAfter).toBeLessThan(widthBefore - 5);

    // Project duration should have shrunk.
    const durAfter = await projectDuration(page);
    expect(durAfter).toBeLessThan(durBefore - 0.1);

    // Buffer is intact — trimEnd grew, buffer.duration unchanged (non-destructive).
    const trimEnd = await clipTrimEnd(page, 0);
    expect(trimEnd).toBeGreaterThan(0);
    const bufDurAfter = await clipBufferDuration(page, 0);
    expect(bufDurAfter).toBeCloseTo(bufDurBefore, 3);

    // Drag the right edge back out to restore.
    const handleBox2 = (await handle.boundingBox())!;
    const sx2 = handleBox2.x + handleBox2.width / 2;
    const sy2 = handleBox2.y + handleBox2.height / 2;
    await page.mouse.move(sx2, sy2);
    await page.mouse.down();
    await page.mouse.move(sx2 + 80, sy2, { steps: 10 });
    await page.mouse.up();

    await page.evaluate(() => (window as any).__studio.endClipResize());

    const widthRestored = await firstClipWidthPx(page);
    expect(widthRestored).toBeCloseTo(widthBefore, -1); // within ~1px
  });

  test('drag a clip onto another track reparents it; undo returns it', async ({ page }) => {
    await page.goto('/');
    // Track 0 with a 2s clip.
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    // Track 1 (empty).
    await page.evaluate(() => (window as any).__studio.addTrack('Track 2'));

    const tracksBefore = await tracks(page);
    expect(tracksBefore).toHaveLength(2);

    // Click the clip on track 0 to object-select it.
    const clip0 = clips(page).first();
    await clip0.click();

    const selBefore = await selectedClip(page);
    expect(selBefore).not.toBeNull();

    // Now drag it: start inside the clip, end over the second track row.
    const clipBox = (await clip0.boundingBox())!;
    const track1Row = page.locator('[data-track-id]').nth(1);
    const track1Box = (await track1Row.boundingBox())!;

    const dragStartX = clipBox.x + clipBox.width / 2;
    const dragStartY = clipBox.y + clipBox.height / 2;
    const dragEndX = dragStartX; // same x
    const dragEndY = track1Box.y + track1Box.height / 2;

    await page.mouse.move(dragStartX, dragStartY);
    await page.mouse.down();
    // Move a bit first (to exceed the DRAG_THRESHOLD = 3 px).
    await page.mouse.move(dragStartX + 5, dragStartY + 5, { steps: 3 });
    await page.mouse.move(dragEndX, dragEndY, { steps: 15 });
    await page.mouse.up();

    // Wait for the DOM to reflect the move.
    await expect(async () => {
      const state = await tracks(page);
      const track1Clips = state[1].clips;
      expect(track1Clips.length).toBeGreaterThan(0);
    }).toPass({ timeout: 3000 });

    // The clip should now be on track 1, track 0 should be empty.
    const stateAfter = await tracks(page);
    expect(stateAfter[0].clips).toHaveLength(0);
    expect(stateAfter[1].clips).toHaveLength(1);

    // Undo — clip should return to track 0.
    await page.keyboard.press('Control+z');

    await expect(async () => {
      const state = await tracks(page);
      expect(state[0].clips).toHaveLength(1);
    }).toPass({ timeout: 3000 });

    const stateUndo = await tracks(page);
    expect(stateUndo[0].clips).toHaveLength(1);
    expect(stateUndo[1].clips).toHaveLength(0);
  });

  test('drag a clip into empty space creates a new track holding it', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });

    const trackCountBefore = (await tracks(page)).length;
    expect(trackCountBefore).toBe(1);

    // Select the clip.
    await clips(page).first().click();

    // Drag well below the last row (into empty space = 'new' track zone).
    const clipBox = (await clips(page).first().boundingBox())!;
    const lastRow = page.locator('[data-track-id]').last();
    const lastRowBox = (await lastRow.boundingBox())!;

    const dragStartX = clipBox.x + clipBox.width / 2;
    const dragStartY = clipBox.y + clipBox.height / 2;
    const dragEndX = dragStartX;
    // Drop 120px below the bottom of the last track row.
    const dragEndY = lastRowBox.y + lastRowBox.height + 120;

    await page.mouse.move(dragStartX, dragStartY);
    await page.mouse.down();
    await page.mouse.move(dragStartX + 5, dragStartY + 5, { steps: 3 });
    await page.mouse.move(dragEndX, dragEndY, { steps: 15 });
    await page.mouse.up();

    // A new track should have been created.
    await expect(async () => {
      const state = await tracks(page);
      expect(state.length).toBeGreaterThan(trackCountBefore);
    }).toPass({ timeout: 3000 });

    const stateAfter = await tracks(page);
    expect(stateAfter.length).toBe(2);
    // The clip should now live on the new track, not the original.
    expect(stateAfter[0].clips).toHaveLength(0);
    expect(stateAfter[1].clips).toHaveLength(1);
  });

  test('copy a range then paste creates a new clip at the playhead; undo removes it', async ({
    page,
  }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 4 });

    // Drag-select a range on the clip (not a click — that creates object selection, not range).
    const clip = clips(page).first();
    const box = (await clip.boundingBox())!;
    // Start drag at 25% into the clip, end at 75%.
    const selStartX = box.x + box.width * 0.25;
    const selEndX = box.x + box.width * 0.75;
    const midY = box.y + box.height / 2;

    await page.mouse.move(selStartX, midY);
    await page.mouse.down();
    await page.mouse.move(selEndX, midY, { steps: 10 });
    await page.mouse.up();

    // Verify a range selection exists.
    const selState = await page.evaluate(() => (window as any).__studio.selection);
    expect(selState).not.toBeNull();

    // Copy.
    await page.keyboard.press('Control+c');
    const canPaste = await page.evaluate(() => (window as any).__studio.canPaste);
    expect(canPaste).toBe(true);

    // Seek the playhead away (to 6s) by calling studio.seek directly to avoid UI conflicts.
    await page.evaluate(() => (window as any).__studio.seek(6));
    const phBefore = await playhead(page);
    expect(phBefore).toBeCloseTo(6, 1);

    const clipCountBefore = (await tracks(page)).reduce((s: number, t: any) => s + t.clips.length, 0);

    // Paste — should create a new clip at the playhead.
    await page.keyboard.press('Control+v');

    await expect(async () => {
      const state = await tracks(page);
      const clipCount = state.reduce((s: number, t: any) => s + t.clips.length, 0);
      expect(clipCount).toBeGreaterThan(clipCountBefore);
    }).toPass({ timeout: 3000 });

    const stateAfterPaste = await tracks(page);
    const totalClips = stateAfterPaste.reduce((s: number, t: any) => s + t.clips.length, 0);
    expect(totalClips).toBe(clipCountBefore + 1);

    // Undo — clip should be gone.
    await page.keyboard.press('Control+z');

    await expect(async () => {
      const state = await tracks(page);
      const clipCount = state.reduce((s: number, t: any) => s + t.clips.length, 0);
      expect(clipCount).toBe(clipCountBefore);
    }).toPass({ timeout: 3000 });
  });

  test('paste where the slot is occupied lands on a new track', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 4 });

    // Add a second clip on track 0 at the end, so the paste target is at 0s (occupied).
    await addClipOnTrack(page, 0, 5); // [5, 6)

    // Range-select a portion of the first clip.
    const clip = clips(page).first();
    const box = (await clip.boundingBox())!;
    const selStartX = box.x + box.width * 0.1;
    const selEndX = box.x + box.width * 0.5;
    const midY = box.y + box.height / 2;

    await page.mouse.move(selStartX, midY);
    await page.mouse.down();
    await page.mouse.move(selEndX, midY, { steps: 10 });
    await page.mouse.up();

    await page.keyboard.press('Control+c');

    // Seek playhead to 0s (occupied by the first clip on track 0).
    await page.evaluate(() => (window as any).__studio.seek(0));
    // Clear selected clip so paste targets last interacted track (track 0).
    await page.evaluate(() => {
      const s = (window as any).__studio;
      s.lastTrackId = s.project.tracks[0].id;
      s.selectedClip = null;
    });

    const trackCountBefore = (await tracks(page)).length;

    // Paste — playhead at 0 where clip[0] sits, so paste must create a new track.
    await page.keyboard.press('Control+v');

    await expect(async () => {
      const state = await tracks(page);
      expect(state.length).toBeGreaterThan(trackCountBefore);
    }).toPass({ timeout: 3000 });

    const stateAfter = await tracks(page);
    expect(stateAfter.length).toBe(trackCountBefore + 1);
  });

  test('hover a track header and click ✕ removes the track; undo restores it at its index', async ({
    page,
  }) => {
    await page.goto('/');
    // Create two tracks so there's something to restore.
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    await page.evaluate(() => (window as any).__studio.addTrack('Track 2'));

    const stateBefore = await tracks(page);
    expect(stateBefore).toHaveLength(2);
    const deletedTrackId = stateBefore[0].id;

    // Hover the first track's header to reveal the delete button.
    const header = page.locator('[data-track-id]').first().locator('.group').first();
    await header.hover();

    const deleteBtn = page.locator('[data-testid=delete-track]').first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Track count should drop by 1.
    await expect(async () => {
      const state = await tracks(page);
      expect(state.length).toBe(1);
    }).toPass({ timeout: 3000 });

    const stateAfterDelete = await tracks(page);
    expect(stateAfterDelete.length).toBe(1);
    expect(stateAfterDelete.find((t: any) => t.id === deletedTrackId)).toBeUndefined();

    // Undo — the deleted track should return at index 0.
    await page.keyboard.press('Control+z');

    await expect(async () => {
      const state = await tracks(page);
      expect(state.length).toBe(2);
    }).toPass({ timeout: 3000 });

    const stateAfterUndo = await tracks(page);
    expect(stateAfterUndo.length).toBe(2);
    expect(stateAfterUndo[0].id).toBe(deletedTrackId);
  });
});
