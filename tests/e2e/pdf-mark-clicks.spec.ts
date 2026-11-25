import { expect, test } from '@playwright/test';
import {
  holdStill,
  type PageGlobals,
  outputPage,
  outputReady,
  setUpScreen,
  slideEditorClosed,
} from './helpers';
import { openGeneratedPdf, usePdfTools } from './pdf-tools-fixtures';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode, type Device } from './devices';
import { expectPhoneRefuses } from './phone-refuses';
import { phoneAsks, phoneShowsLive, playlistOf } from './pro-phone';

/*
 * A PDF's marks with a click order (alpha.21), and a Pro Mode phone (alpha.23, QA23-PHONE-1, the owner's "Only PPT and
 * PDF"): the PDF put up from its playlist row on the phone, its marks stepped with the phone's Next and Back, Next
 * stopping at its last page (never the words after it in the playlist), the slide cleared from the phone; the words'
 * row and Clear all refused.
 */

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
    // The PDF in a playlist, with words after it (alpha.23: a phone puts up a PowerPoint or a PDF only).
    const words = await s.win.evaluate(async () => {
      const made = await (globalThis as PageGlobals).drashti.library.newFromWords(
        'Placeholder words after the marks',
        'Placeholder words one\n\nPlaceholder words two',
      );
      if (!made.ok) throw new Error(made.message);
      return made.id;
    });
    const list = await playlistOf(s.win, 'Placeholder marks list', [
      { kind: 'presentation', presentationId: s.id },
      { kind: 'presentation', presentationId: words },
    ]);
    const [pdfRow = '', wordsRow = ''] = list.rows;
    // The words' row from the phone: refused, nothing up.
    await expectPhoneRefuses(
      { win: s.win, page: remote },
      'POST',
      '/api/v1/trigger/item',
      { playlistId: list.playlistId, itemId: wordsRow },
      'notDeck',
    );
    // The PDF's row, put up from the phone (before alpha.23 the operator put it up).
    expect(
      (
        await phoneAsks(remote, 'POST', '/api/v1/trigger/item', {
          playlistId: list.playlistId,
          itemId: pdfRow,
        })
      ).status,
    ).toBe(200);
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
    // The phone draws the hall's own slide (Scene): each saved mark, by its exact element ID, is there inside its click
    // target, unseen (opacity 0) until its click and seen after it, as on the hall. (The first run, a21-take-pdf
    // 220811-90705, showed the phone's live picture without the marks at click 0, the elements present at opacity 0.)
    const phoneMarks = markIds.map((id) => {
      if (!id) throw new Error('Saved PDF mark target has no element ID.');
      return remote.getByTestId('remote-live').locator(`[data-deck-motion-target="pdf-mark:${id}"]`);
    });
    for (const [index, mark] of phoneMarks.entries()) {
      await expect(mark.locator(`[data-element="${markIds[index] ?? ''}"]`)).toHaveCount(1);
      await expect(mark).toHaveCSS('opacity', '0');
    }
    for (const n of [1, 2]) {
      await remote.getByTestId('remote-next-button').click();
      await expect.poll(step).toEqual({ index: 0, step: n });
      await expect(targets.nth(n - 1)).toHaveCSS('opacity', '1');
      for (const [index, mark] of phoneMarks.entries())
        await expect(mark).toHaveCSS('opacity', index < n ? '1' : '0');
      if (n === 1) await expect(targets.nth(1)).toHaveCSS('opacity', '0');
    }
    await remote.getByTestId('remote-back').click();
    await expect.poll(step).toEqual({ index: 0, step: 1 });
    await expect(targets.nth(1)).toHaveCSS('opacity', '0');
    for (const [index, mark] of phoneMarks.entries())
      await expect(mark).toHaveCSS('opacity', index === 0 ? '1' : '0');

    // On to its last page with the phone's Next: there it stops, never the words after it in the playlist.
    await remote.getByTestId('remote-next-button').click();
    await expect.poll(step).toEqual({ index: 0, step: 2 });
    for (const page of [1, 2]) {
      await remote.getByTestId('remote-next-button').click();
      await expect.poll(step).toMatchObject({ index: page });
    }
    await phoneShowsLive(remote, s.win);
    const atEnd = await step();
    await remote.getByTestId('remote-next-button').click();
    await holdStill(
      async () => {
        const now = await step();
        const live = await s.win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live.presentationId,
        );
        return now.index === atEnd.index && now.step === atEnd.step && live === s.id;
      },
      1500,
      'Next on the phone at the PDF’s last page changes nothing',
    );
    // Clear all from the phone: refused; Clear slide (the owner's Q7): the slide goes, nothing else.
    await expectPhoneRefuses({ win: s.win, page: remote }, 'POST', '/api/v1/clear/all', {}, 'computer');
    expect((await phoneAsks(remote, 'POST', '/api/v1/clear/slide', {})).status).toBe(200);
    await expect
      .poll(() =>
        s.win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide,
        ),
      )
      .toBeNull();
    await expect(out.locator('[data-layer="slide"]')).toHaveCount(0);
    s.unchanged();
  } finally {
    await phone?.close();
    await s.app.close();
  }
});
