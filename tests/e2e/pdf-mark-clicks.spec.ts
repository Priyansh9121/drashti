import { expect, test } from '@playwright/test';
import { type PageGlobals, outputPage, outputReady, setUpScreen, slideEditorClosed } from './helpers';
import { openGeneratedPdf, usePdfTools } from './pdf-tools-fixtures';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode, type Device } from './devices';

test('PDF marks have an undoable click order that survives saving and drives Next', async () => {
  const s = await openGeneratedPdf(undefined, undefined, NETWORK_ENV);
  let phone: Device | undefined;
  try {
    for (const [tool, top] of [
      ['Highlight', 0.2],
      ['Draw', 0.6],
    ] as const) {
      await usePdfTools(s.ed);
      await s.ed.getByRole('button', { name: tool, exact: true }).click();
      const box = await s.editor.getByTestId('editor-slide').boundingBox();
      if (!box) throw new Error('Generated PDF page is missing.');
      await s.ed.mouse.move(box.x + box.width * 0.2, box.y + box.height * top);
      await s.ed.mouse.down();
      await s.ed.mouse.move(box.x + box.width * 0.7, box.y + box.height * (top + 0.1), { steps: 8 });
      await s.ed.mouse.up();
      await s.ed.getByRole('tab', { name: 'Motion', exact: true }).click();
      const timedMotion = s.ed.getByTestId('motion-element-in');
      await expect(timedMotion).toBeEnabled();
      const onClick = s.ed.getByRole('checkbox', { name: 'Comes in on click', exact: true });
      await expect(onClick).not.toBeChecked();
      await onClick.check();
      await expect(onClick).toBeChecked();
      await expect(timedMotion).toBeDisabled();
    }
    const order = s.ed.getByRole('list', { name: 'PDF mark order', exact: true });
    await expect(order.getByRole('listitem')).toHaveText(['Click 1 · Highlight', 'Click 2 · Draw']);
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(order.getByRole('listitem')).toHaveText(['Click 1 · Highlight']);
    await s.ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(order.getByRole('listitem')).toHaveText(['Click 1 · Highlight', 'Click 2 · Draw']);
    await s.editor.getByTestId('save-slides').click();
    await slideEditorClosed(s.app);
    s.unchanged();
    await setUpScreen(s.win, 'Placeholder hall', 0);
    const out = await outputPage(s.app);
    await outputReady(out);
    const { base } = await networkOn(s.win);
    phone = await device('chromium');
    const remote = phone.page;
    await pairByQr(remote, base, await pairingCode(s.win, 'remote', 'Placeholder marks phone'), '/remote');
    await expect(remote.getByTestId('connection')).toHaveText('Connected');
    await s.win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId: id,
          slideIndex: 0,
        }),
      s.id,
    );
    const step = () =>
      s.win.evaluate(async () => {
        const live = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide;
        return { index: live?.slideIndex, step: live?.step };
      });
    await expect.poll(step).toEqual({ index: 0, step: 0 });
    const targets = out.locator('[data-deck-motion-target^="pdf-mark:"]');
    await expect(targets).toHaveCount(2);
    await expect(targets.nth(0)).toHaveCSS('opacity', '0');
    await expect(targets.nth(1)).toHaveCSS('opacity', '0');
    const slideId = await out.locator('[data-slide]').last().getAttribute('data-slide');
    if (!slideId) throw new Error('The hall has no live PDF page.');
    await expect(remote.getByTestId('remote-live').locator(`[data-slide="${slideId}"]`)).toBeVisible();
    const markIds = await targets.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-deck-motion-target')?.replace(/^pdf-mark:/u, '')),
    );
    expect(markIds).toHaveLength(2);
    const phoneMarks = markIds.map((id) => {
      if (!id) throw new Error('Saved PDF mark target has no element ID.');
      return remote.getByTestId('remote-live').locator(`[data-element="${id}"]`);
    });
    for (const mark of phoneMarks) await expect(mark).toHaveCount(0);
    for (const n of [1, 2]) {
      await remote.getByTestId('remote-next-button').click();
      await expect.poll(step).toEqual({ index: 0, step: n });
      await expect(targets.nth(n - 1)).toHaveCSS('opacity', '1');
      for (const [index, mark] of phoneMarks.entries()) await expect(mark).toHaveCount(index < n ? 1 : 0);
      if (n === 1) await expect(targets.nth(1)).toHaveCSS('opacity', '0');
    }
    await remote.getByTestId('remote-back').click();
    await expect.poll(step).toEqual({ index: 0, step: 1 });
    await expect(targets.nth(1)).toHaveCSS('opacity', '0');
    for (const [index, mark] of phoneMarks.entries()) await expect(mark).toHaveCount(index === 0 ? 1 : 0);
    s.unchanged();
  } finally {
    await phone?.close();
    await s.app.close();
  }
});
