import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { closeLibrary, openLibrary } from './helpers';
import { openNewPlaylist } from './hall-looks';
import { openGeneratedPdf, usePdfTools } from './pdf-tools-fixtures';

/*
 * Make a slide… (alpha.21, the owner's "add a slide button to create a slide in drashti"): from a PDF page in the slide
 * editor, the page or a part of it dragged out, one button makes a Drashti slide holding it as a picture, drawn from
 * the page itself at the hall's picture size, in the open playlist or the library only; the operator window's Undo
 * takes it away. Generated placeholder PDFs only (pdf-tools-fixtures.ts).
 */

const CROP_BOX_NAME =
  'The part kept: drag it, or its sides and corners; the arrows move it, Shift and the arrows change its size';

/** A presentation's one slide's picture, by its name: its size and the colours at shares of it. */
async function madePicture(win: Page, name: string, at: [number, number][]) {
  return win.evaluate(
    async ({ name, at }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = (await d.library.listPresentations()).find((p) => p.name === name);
      if (!made) return null;
      const edit = await d.library.slidesForEdit(made.id);
      if (!edit.ok) throw new Error(edit.message);
      const slides = edit.doc.groups.flatMap((g) => g.slides);
      const pictures = slides.flatMap((s) => s.elements.filter((el) => el.kind === 'image'));
      const picture = pictures[0];
      if (slides.length !== 1 || pictures.length !== 1 || picture?.kind !== 'image')
        throw new Error(`Expected one slide holding one picture, found ${String(slides.length)} slides.`);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = `drashti-media://media/${picture.mediaId}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const colours = at.map(([x, y]) =>
        Array.from(
          ctx
            .getImageData(Math.floor(x * img.naturalWidth), Math.floor(y * img.naturalHeight), 1, 1)
            .data.slice(0, 3),
        ),
      );
      return {
        id: made.id,
        size: [img.naturalWidth, img.naturalHeight],
        frame: picture.frame,
        fit: picture.fit,
        canvas: [edit.doc.width, edit.doc.height],
        colours,
      };
    },
    { name, at },
  );
}

const near = (colour: number[] | undefined, [r, g, b]: [number, number, number]) =>
  colour !== undefined &&
  Math.abs((colour[0] ?? -99) - r) <= 12 &&
  Math.abs((colour[1] ?? -99) - g) <= 12 &&
  Math.abs((colour[2] ?? -99) - b) <= 12;

test('Make a slide… makes a slide of the part of a PDF page dragged out, sharp at the hall’s size, in the open playlist; Undo takes it away', async () => {
  const { app, win, ed, unchanged } = await openGeneratedPdf();
  try {
    // The library's sheet (open since the PDF was chosen in it) shut, so the playlists show in the left column.
    await closeLibrary(win);
    const list = await openNewPlaylist(win, 'Placeholder made slides');
    await usePdfTools(ed);
    await ed.getByRole('button', { name: 'Make a slide…', exact: true }).click();
    const dialog = ed.getByTestId('make-slide');
    const part = dialog.getByRole('button', { name: CROP_BOX_NAME, exact: true });
    await expect(part).toBeVisible();
    await expectNoSeriousA11yIssues(ed, 'Make a slide');
    // The whole page to begin with; its bottom-right corner dragged to a quarter across and half down: the page's
    // top-left part (its first three stripes and the red block, page A of the fixture, 480 x 320 points).
    const whole = await part.boundingBox();
    const corner = await part.locator('[data-edge="se"]').boundingBox();
    if (!whole || !corner) throw new Error('The page has no box to drag.');
    // Moved from where it is held by three quarters of the page across and half of it up (the handle's middle
    // is on the inside of the frame's 2-pixel line, not on its outside: CI's Windows read 49% when aimed at
    // the outside).
    const from = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
    await ed.mouse.move(from.x, from.y);
    await ed.mouse.down();
    await ed.mouse.move(from.x - whole.width * 0.75, from.y - whole.height * 0.5, { steps: 10 });
    await ed.mouse.up();
    await expect(dialog.getByTestId('crop-readout')).toContainText('right 75%');
    await expect(dialog.getByTestId('crop-readout')).toContainText('bottom 50%');
    // Where it goes: the open playlist, by its name, chosen to begin with.
    const into = dialog.getByRole('radio', { name: /The open playlist, “Placeholder made slides”/u });
    await expect(into).toBeChecked();
    await dialog.getByRole('button', { name: 'Make the slide', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const name = 'Placeholder PDF tools, page 1 (part)';
    await expect(ed.getByTestId('editor-note')).toContainText(`Made “${name}”`);

    // In the open playlist, and in the library as a presentation of one slide holding the part as a picture.
    const rows = win.getByTestId('open-playlist').getByTestId('playlist-item');
    await expect(rows.filter({ hasText: name })).toHaveCount(1);
    const made = await madePicture(win, name, [
      // The red block (x 24-69, y 42-70 of 120 x 160 points), the first stripe and the second.
      [46.5 / 120, 56 / 160],
      [10 / 120, 120 / 160],
      [60 / 120, 120 / 160],
    ]);
    expect(made, 'the made presentation is in the library').not.toBeNull();
    if (!made) throw new Error('no made slide');
    // Drawn from the page itself at the hall's size: 120 x 160 points fitted into 1920 x 1080 is 810 x 1080, not
    // the 405 x 540 a part of the page's 1620 x 1080 picture would be.
    expect(made.size[1]).toBe(1080);
    expect(made.size[0]).toBeGreaterThanOrEqual(800);
    expect(made.size[0]).toBeLessThanOrEqual(820);
    expect(made.canvas).toEqual([1920, 1080]);
    expect(made.fit).toBe('fit');
    expect(made.frame).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(near(made.colours[0], [179, 38, 26]), `red block ${JSON.stringify(made.colours[0])}`).toBe(true);
    expect(near(made.colours[1], [48, 28, 64]), `first stripe ${JSON.stringify(made.colours[1])}`).toBe(true);
    expect(near(made.colours[2], [18, 59, 79]), `second stripe ${JSON.stringify(made.colours[2])}`).toBe(
      true,
    );
    unchanged();

    // One Undo in the operator window takes the row and the presentation away.
    const notice = win.getByTestId('undo-removal');
    await expect(notice).toContainText(`Made the slide “${name}”`);
    await notice.getByRole('button', { name: /Undo/u }).click();
    await expect(rows.filter({ hasText: name })).toHaveCount(0);
    await expect
      .poll(() =>
        win.evaluate(
          async (name) =>
            (await (globalThis as PageGlobals).drashti.library.listPresentations()).some(
              (p) => p.name === name,
            ),
          name,
        ),
      )
      .toBe(false);
    expect(list.id).not.toBe('');
  } finally {
    await app.close();
  }
});

test('Make a slide… of the whole page into the library only leaves the open playlist as it was', async () => {
  const { app, win, ed, unchanged } = await openGeneratedPdf();
  try {
    // The library's sheet (open since the PDF was chosen in it) shut, so the playlists show in the left column.
    await closeLibrary(win);
    await openNewPlaylist(win, 'Placeholder untouched playlist');
    await usePdfTools(ed);
    await ed.getByRole('button', { name: 'Make a slide…', exact: true }).click();
    const dialog = ed.getByTestId('make-slide');
    await dialog.getByRole('radio', { name: 'The library only', exact: true }).check();
    await dialog.getByRole('button', { name: 'Make the slide', exact: true }).click();
    const name = 'Placeholder PDF tools, page 1';
    await expect(ed.getByTestId('editor-note')).toContainText(`Made “${name}”`);
    const made = await madePicture(win, name, [[46.5 / 480, 56 / 320]]);
    expect(made, 'the made presentation is in the library').not.toBeNull();
    // The whole 480 x 320 page fitted into 1920 x 1080: 1620 x 1080.
    expect(made?.size).toEqual([1620, 1080]);
    expect(near(made?.colours[0], [179, 38, 26]), `red block ${JSON.stringify(made?.colours[0])}`).toBe(true);
    await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(0);
    await openLibrary(win);
    await expect(win.getByTestId('presentation-list').getByText(name, { exact: true })).toBeVisible();
    unchanged();
  } finally {
    await app.close();
  }
});
