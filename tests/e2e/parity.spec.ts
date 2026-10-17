import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import { launchApp, operatorPage, operatorReady, outputPage, type PageGlobals, setUpScreen } from './helpers';
import { goLive, makeSlides } from './placeholder-slides';

/*
 * One slide everywhere (Sessions 31–36, SLD-7): a slide whose words shrink to fit is drawn by the same
 * renderer on the hall's output, in the slide editor, on its thumbnail and on a phone's remote, and each
 * makes them the same size (data-fit, to 3 decimals) and breaks them into the same lines, at 1920 × 1080.
 * Placeholder words only.
 */

/** A text box's fit and its number of lines, inside `scope` on a page. */
const measure = (page: Page, scope: string, elementId: string) =>
  page.evaluate(
    ({ scope, elementId }) => {
      const box = document.querySelector<HTMLElement>(`${scope} [data-element="${elementId}"]`);
      const words = box?.firstElementChild;
      if (!box || !(words instanceof HTMLElement)) return null;
      const line = parseFloat(getComputedStyle(words).lineHeight);
      return { fit: box.dataset['fit'] ?? '1', lines: Math.round(words.offsetHeight / line) };
    },
    { scope, elementId },
  );

test('a slide’s shrunk words are the same size and in the same lines on the output, in the editor, on its thumbnail and on a phone', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await operatorReady(win);
  const words = Array.from({ length: 60 }, (_, i) => `Placeholder parity word ${String(i + 1)}`).join(' ');
  const id = await makeSlides(win, 'Placeholder parity', [{ words }], { kind: 'cut', durationMs: 0 });
  // Its box shrinks its words to fit.
  const elementId = await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const opened = await d.library.slidesForEdit(id);
    if (!opened.ok) throw new Error(opened.message);
    const slide = opened.doc.groups[0]?.slides[0];
    const text = slide?.elements.find((e) => e.kind === 'text');
    if (text?.kind !== 'text') throw new Error('no words');
    text.style = { ...text.style, shrinkToFit: true };
    const saved = await d.library.saveSlides(id, opened.doc, opened.stamp);
    if (!saved.ok) throw new Error(saved.message);
    return text.id;
  }, id);
  await setUpScreen(win);
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  await goLive(win, id, 0);

  // The hall's output: shrunk.
  await expect(output.locator(`[data-layer="slide"] [data-element="${elementId}"]`)).toHaveAttribute(
    'data-fit',
    /^0\.\d{3}$/u,
  );
  const onOutput = await measure(output, '[data-layer="slide"]', elementId);
  expect(onOutput?.lines).toBeGreaterThan(1);

  // Its thumbnail in the operator window's slide grid.
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder parity/u })
    .click();
  const thumb = '[data-testid="slide-grid"] [data-testid="slide-thumb"]';
  await expect(win.locator(`${thumb} [data-element="${elementId}"]`)).toHaveAttribute('data-fit', /^0\./u);
  const onThumb = await measure(win, thumb, elementId);

  // A phone's remote (Chromium, as Drashti's own windows are).
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder parity phone');
  const phone = await device('chromium');
  const onPhone = await (async () => {
    try {
      await pairByQr(phone.page, base, code, '/remote');
      await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
      await phone.page.evaluate(() => document.fonts.ready);
      await expect(
        phone.page.locator(`[data-testid="remote-live"] [data-element="${elementId}"]`),
      ).toHaveAttribute('data-fit', /^0\./u);
      return await measure(phone.page, '[data-testid="remote-live"]', elementId);
    } finally {
      await phone.close();
    }
  })();

  // The slide editor.
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await expect(editor.getByTestId('editor-canvas')).toBeVisible();
  await expect(win.locator(`[data-testid="editor-slide"] [data-element="${elementId}"]`)).toHaveAttribute(
    'data-fit',
    /^0\./u,
  );
  const inEditor = await measure(win, '[data-testid="editor-slide"]', elementId);

  expect({ thumbnail: onThumb, editor: inEditor, phone: onPhone }).toEqual({
    thumbnail: onOutput,
    editor: onOutput,
    phone: onOutput,
  });
  await app.close();
});
