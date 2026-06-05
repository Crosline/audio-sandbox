import { expect, test, type Page } from '@playwright/test';
import { loadGeneratedClip } from './helpers/app.js';

/**
 * Place a second clip on track 0 at a given start (seconds), via the studio test hook.
 * Builds the Clip object literally (a Clip is a plain `{ id, buffer, name, start }`) so the
 * spec needs no in-page engine import — bare ESM specifiers don't resolve in `page.evaluate`.
 */
async function addSecondClip(page: Page, start: number): Promise<void> {
  await page.evaluate((s) => {
    const studio = (window as any).__studio;
    const trackId = studio.project.tracks[0].id;
    const factory = (studio as any).bufferFactory; // BufferFactory bound to the live context
    // Build a 1s mono buffer (factory signature: numberOfChannels, length, sampleRate).
    const buf = factory(1, 8000, 8000);
    const clip = { id: `second-${Math.random().toString(36).slice(2)}`, buffer: buf, name: 'second.wav', start: s };
    const track = studio.project.tracks.find((t: any) => t.id === trackId);
    studio.updateTrack({ ...track, clips: [...track.clips, clip] });
  }, start);
}

function clips(page: Page) {
  return page.locator('[data-testid=clip]');
}

/** The studio's selectedClip via the hook. */
function selectedClip(page: Page) {
  return page.evaluate(() => (window as any).__studio.selectedClip);
}

/** A clip's current start (seconds) by index on track 0. */
function clipStart(page: Page, index: number) {
  return page.evaluate((i) => (window as any).__studio.project.tracks[0].clips[i].start, index);
}

test.describe('multi-clip lane', () => {
  test('renders every clip at its offset', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    await addSecondClip(page, 3); // 2s clip at 0, 1s clip at 3
    await expect(clips(page)).toHaveCount(2);
    const boxes = await clips(page).all();
    const left0 = (await boxes[0].boundingBox())!.x;
    const left1 = (await boxes[1].boundingBox())!.x;
    expect(left1).toBeGreaterThan(left0); // second clip sits to the right
  });

  test('clicking a clip selects it as an object', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    await clips(page).first().click();
    const sel = await selectedClip(page);
    expect(sel).not.toBeNull();
    // Time-range selection is cleared when a clip is object-selected.
    expect(await page.evaluate(() => (window as any).__studio.selection)).toBeNull();
  });

  test('dragging a selected clip moves its start', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    const box0 = (await clips(page).first().boundingBox())!;
    await clips(page).first().click(); // select first
    const before = await clipStart(page, 0);
    // Drag right by ~100px (≈1s at the default 100px/s).
    const y = box0.y + box0.height / 2;
    await page.mouse.move(box0.x + 20, y);
    await page.mouse.down();
    await page.mouse.move(box0.x + 20 + 100, y, { steps: 10 });
    await page.mouse.up();
    expect(await clipStart(page, 0)).toBeGreaterThan(before);
  });

  test('a move cannot overlap a neighbor', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 }); // [0,2)
    await addSecondClip(page, 3); // [3,4)
    // Select the second clip and try to drag it far left onto the first.
    const second = clips(page).nth(1);
    await second.click();
    const box = (await second.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 10, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 10 - 400, y, { steps: 12 }); // hard left
    await page.mouse.up();
    // First clip occupies [0,2); the 1s second clip can't start before 2.
    expect(await clipStart(page, 1)).toBeGreaterThanOrEqual(2 - 0.05);
  });

  test('undo restores a moved clip position', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 });
    await clips(page).first().click();
    const before = await clipStart(page, 0);
    const box = (await clips(page).first().boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 20, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, y, { steps: 10 });
    await page.mouse.up();
    expect(await clipStart(page, 0)).toBeGreaterThan(before);
    await page.keyboard.press('Control+z');
    expect(await clipStart(page, 0)).toBeCloseTo(before, 1);
  });

  test('dropping a file places a clip near the cursor time', async ({ page }) => {
    await page.goto('/');
    await loadGeneratedClip(page, 'clip.wav', { seconds: 2 }); // [0,2) on track 0
    // DataTransfer file drops are awkward in Playwright, so drive the real placement path:
    // build a 1s WAV File in-page and call studio.addFile with an explicit drop time. This
    // exercises decode + clampClipStart end-to-end and asserts the clip lands at the drop time.
    const placed = await page.evaluate(async () => {
      // Minimal 1s mono 8kHz PCM16 WAV (silent) → a real File the app can decode.
      const sampleRate = 8000;
      const numSamples = sampleRate; // 1 second
      const dataBytes = numSamples * 2;
      const buf = new ArrayBuffer(44 + dataBytes);
      const dv = new DataView(buf);
      const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, 'RIFF');
      dv.setUint32(4, 36 + dataBytes, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      dv.setUint32(16, 16, true); // PCM fmt chunk size
      dv.setUint16(20, 1, true); // AudioFormat = PCM
      dv.setUint16(22, 1, true); // channels
      dv.setUint32(24, sampleRate, true);
      dv.setUint32(28, sampleRate * 2, true); // byte rate
      dv.setUint16(32, 2, true); // block align
      dv.setUint16(34, 16, true); // bits per sample
      writeStr(36, 'data');
      dv.setUint32(40, dataBytes, true);
      // samples left as zeros (silence)
      const file = new File([buf], 'drop.wav', { type: 'audio/wav' });

      const studio = (window as any).__studio;
      const trackId = studio.project.tracks[0].id;
      const clip = await studio.addFile(file, { trackId, start: 5 }); // dropped at t=5s
      return clip.start;
    });
    expect(placed).toBeCloseTo(5, 1); // 1s clip at t=5 doesn't overlap the [0,2) clip
  });
});
