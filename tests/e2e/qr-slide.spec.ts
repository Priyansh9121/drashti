import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { closeLibrary, launchApp, openLibrary, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The QR-code slide (Session 55, Part 8, the owner's idea G): New › QR code… in the library: a link or words pasted,
 * and a slide with a large code and the words under it, made offline (the code a picture in the library). It is
 * chosen in the library, and one click on its row puts it up. Pro Mode's: Simple Mode refuses making one. At CI's
 * 1024 × 645 and at 1280 × 720. Placeholder links only.
 */

const LINK = 'https://example.org/placeholder-sabha';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The dialog whole in the window, nothing scrolling sideways, every button's words inside it. */
async function expectFits(win: Page, what: string): Promise<void> {
  const problems = await win.evaluate(() => {
    const out: string[] = [];
    const panel = document.querySelector('[data-testid="qr-dialog"]');
    if (!panel) return ['no dialog'];
    const r = panel.getBoundingClientRect();
    if (
      r.left < -0.5 ||
      r.top < -0.5 ||
      r.right > window.innerWidth + 0.5 ||
      r.bottom > window.innerHeight + 0.5
    )
      out.push(`the dialog (${String(Math.round(r.width))} × ${String(Math.round(r.height))}) is cut off`);
    if (document.documentElement.scrollWidth > window.innerWidth) out.push('the page scrolls sideways');
    for (const b of panel.querySelectorAll('button'))
      if (b.scrollWidth > b.clientWidth + 1) out.push(`${b.textContent.trim()}: its words do not fit`);
    const code = panel.querySelector('[data-testid="qr-code"]')?.getBoundingClientRect();
    if (!code || code.width < 120) out.push('the code is not shown large enough');
    return out;
  });
  expect(problems, what).toEqual([]);
}

test('New › QR code…: a link pasted becomes one slide with a large code and the words under it, chosen in the library and up with one click, at 1024 × 645 and 1280 × 720', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);

  await openLibrary(win);
  await win.getByTestId('library-tools').getByRole('button', { name: 'QR code…' }).click();
  const dialog = win.getByTestId('qr-dialog');
  await expect(dialog).toBeVisible();
  // Nothing to make yet.
  await expect(dialog.getByRole('button', { name: 'Make the slide' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Link or words' }).fill(LINK);
  // The code and the words under it, as the slide will have them.
  await expect(dialog.getByTestId('qr-code')).toBeVisible();
  await expect(dialog.getByTestId('qr-words')).toHaveText(LINK);
  await expectFits(win, 'the QR code dialog at 1024 × 645');
  await expectNoSeriousA11yIssues(win, 'the QR code dialog', '[data-testid="qr-dialog"]');
  await dialog.getByRole('button', { name: 'Make the slide' }).click();
  await expect(dialog).toHaveCount(0);

  // In the library: one slide, the code (a PNG picture in the library) large in the middle, the words under it.
  const made = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const found = (await d.library.listPresentations()).find((p) => p.name.startsWith('QR code: '));
    if (!found) return null;
    const doc = await d.library.getPresentation(found.id);
    const slides = doc?.groups.flatMap((g) => g.slides) ?? [];
    const elements = slides[0]?.slide.elements ?? [];
    const picture = elements.find((e) => e.kind === 'image');
    const words = elements.find((e) => e.kind === 'text');
    const media = await d.library.listMedia();
    return {
      id: found.id,
      name: found.name,
      slides: slides.length,
      pictureName:
        picture?.kind === 'image' ? (media.find((m) => m.id === picture.mediaId)?.kind ?? null) : null,
      pictureSquare: picture ? picture.frame.width === picture.frame.height : false,
      wordsBelow: picture && words ? words.frame.y >= picture.frame.y + picture.frame.height : false,
      words: words?.kind === 'text' ? words.text : null,
    };
  });
  expect(made).toMatchObject({
    name: `QR code: ${LINK}`,
    slides: 1,
    pictureName: 'image',
    pictureSquare: true,
    wordsBelow: true,
    words: LINK,
  });
  await closeLibrary(win);

  // Chosen in the library (no playlist open): its slide's row in the middle; one click puts it up.
  const middle = win.getByTestId('column-middle');
  await expect(middle.getByTestId('slide-thumb')).toHaveCount(1);
  await middle.getByTestId('slide-thumb').first().click();
  await expect.poll(async () => (await state(win)).live.presentationId).toBe(made?.id);

  // At 1280 × 720 the dialog fits too.
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  await openLibrary(win);
  await win.getByTestId('library-tools').getByRole('button', { name: 'QR code…' }).click();
  await dialog.getByRole('textbox', { name: 'Link or words' }).fill('Placeholder words for a code');
  await expectFits(win, 'the QR code dialog at 1280 × 720');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await app.close();
});

test('Simple Mode refuses making a QR-code slide; words too long are turned down with why', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const tooLong = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.library.newQrSlide('x'.repeat(2000)),
  );
  expect(tooLong.ok).toBe(false);
  if (!tooLong.ok) expect(tooLong.message).toContain('too long');
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const refused = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.library.newQrSlide('https://example.org/placeholder'),
  );
  expect(refused.ok).toBe(false);
  const names = await win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listPresentations()).map((p) => p.name),
  );
  expect(names.filter((n) => n.startsWith('QR code: '))).toEqual([]);
  await app.close();
});
