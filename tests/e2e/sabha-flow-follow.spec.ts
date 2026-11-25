import { expect, test } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Device, NETWORK_ENV, networkOn } from './devices';
import { launchApp, operatorPage, operatorReady, type PageGlobals, relaunchApp } from './helpers';
import {
  answerDialog,
  chooseInPanel,
  dialogsOpened,
  ENGLISH,
  expectNowNext,
  flowKept,
  flowState,
  GUJARATI,
  itemOf,
  LAST_ITEM,
  nextOf,
  NOW_NOT_STARTED,
  nowOf,
  openPanel,
  phoneOnMore,
  seen,
  writeFlows,
} from './sabha-flow';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Sabha flow's Now and Next up (alpha.23, QA23-FLOW-2; the owner: "if we are on 1, it should say next up this program,
 * video which is also seen on phone paired"), marked in the operator window's panel and followed by paired phones at
 * once: a click on a row, Next and Back, "Last item" at the end, the video's row shown as the video, the same words on
 * both. A phone paired later reads where the sabha is; the computer started again (the PDF chosen gone from where it
 * was: Drashti keeps its own copy) keeps the flow, Now and its page, and the phone left open follows its new run; a
 * file that is not a PDF chosen by mistake leaves the flow as it was; another PDF starts both again; Remove empties
 * both. Every step with the panel's own buttons, Main's file dialog answered by the test. Placeholder PDFs only.
 */

test('Marked in the panel, followed by paired phones at once: Now, Next up and Last item by a click, Next and Back, the same on both; a Safari phone paired later reads where it is; a restart with the PDF gone from its folder keeps the flow, Now and its page; a file that is not a PDF keeps it; Replace starts both again; Remove empties both', async () => {
  test.setTimeout(300_000);
  const files = await writeFlows({ ENGLISH, GUJARATI });
  const broken = join(dirname(files.ENGLISH), 'Flowcheck broken order.pdf');
  writeFileSync(broken, 'Placeholder words only, not a PDF');
  const [i1, i2, i3, i4, i5] = [0, 1, 2, 3, 4].map((n) => itemOf(ENGLISH, n));
  if (!i1 || !i2 || !i3 || !i4 || !i5) throw new Error('The English order has five items');

  const first = await launchApp(NETWORK_ENV);
  const win = await operatorPage(first.app);
  await operatorReady(win);
  await sizeOperatorWindow(first.app, win, CI_WINDOW);
  const { base, port } = await networkOn(win);
  const phone = await phoneOnMore(win, base, 'chromium', 'Placeholder phone');
  const p = phone.page;
  let safari: Device | null = null;
  let second: Awaited<ReturnType<typeof relaunchApp>> | null = null;
  try {
    await p.setViewportSize({ width: 390, height: 844 });
    const section = p.getByTestId('remote-flow');
    await expect(section.getByTestId('remote-flow-none')).toBeVisible();
    const panel = await openPanel(win);

    // Choose PDF… cancelled: nothing chosen, on either.
    await answerDialog(first.app, null);
    await panel.getByTestId('flow-choose').click();
    await expect.poll(() => dialogsOpened(first.app)).toBe(1);
    await expect(panel.getByTestId('flow-choose')).toBeEnabled();
    await expect(panel.getByTestId('flow-empty')).toBeVisible();
    expect(await flowKept(win)).toBeNull();
    await expect(section.getByTestId('remote-flow-none')).toBeVisible();

    // Chosen: the phone follows at once; nothing is Now, Next up is the first item, Back is off.
    await chooseInPanel(first.app, panel, files.ENGLISH, ENGLISH.fileName);
    await expect(section.getByTestId('remote-flow-file')).toHaveText(ENGLISH.fileName);
    await expectNowNext(panel, section, NOW_NOT_STARTED, nextOf(i1));
    await expect(panel.getByTestId('flow-back-button')).toBeDisabled();

    // A click on the first row: Now on both; Next up is the video's row, shown as the video on both.
    const rows = panel.getByTestId('flow-row');
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute('aria-current', 'step');
    await expectNowNext(panel, section, nowOf(i1), nextOf(i2));
    await expect(panel.getByTestId('flow-next')).toHaveAttribute('data-video', 'true');
    await expect(section.getByTestId('remote-flow-next')).toHaveAttribute('data-video', 'true');
    const flowId = (await flowState(win))?.flowId ?? 'none';
    expect(await flowState(win)).toEqual({ flowId, now: 0 });

    // Next, one item at a time, to the last: "Last item" on both, and Next is off.
    const next = panel.getByTestId('flow-next-button');
    await next.click();
    await expectNowNext(panel, section, nowOf(i2), nextOf(i3));
    await expect(panel.getByTestId('flow-next')).not.toHaveAttribute('data-video', 'true');
    await expect(section.getByTestId('remote-flow-next')).not.toHaveAttribute('data-video', 'true');
    await next.click();
    await expectNowNext(panel, section, nowOf(i3), nextOf(i4));
    await next.click();
    await expectNowNext(panel, section, nowOf(i4), nextOf(i5));
    await next.click();
    await expectNowNext(panel, section, nowOf(i5), LAST_ITEM);
    await expect(rows.nth(4)).toHaveAttribute('aria-current', 'step');
    await expect(next).toBeDisabled();
    expect(await flowState(win)).toEqual({ flowId, now: 4 });

    // Back one: the fourth is Now, the last Next up, on both; the phone's read list marks them, read only.
    await panel.getByTestId('flow-back-button').click();
    await expectNowNext(panel, section, nowOf(i4), nextOf(i5));
    await expect(next).toBeEnabled();
    await section.getByTestId('remote-open-flow').click();
    const sheet = p.getByTestId('remote-flow-sheet');
    await expect(sheet).toBeVisible();
    const phoneRows = sheet.getByTestId('remote-flow-row');
    await expect(phoneRows).toHaveCount(ENGLISH.items.length);
    await expect(phoneRows.nth(3)).toHaveAttribute('aria-current', 'step');
    await expect(phoneRows.nth(4)).toHaveAttribute('data-next', 'true');
    await expect(sheet.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(phoneRows.locator('button, a, input')).toHaveCount(0);
    await expect.poll(() => seen(sheet.getByTestId('remote-flow-now'))).toBe(nowOf(i4));
    await expect.poll(() => seen(sheet.getByTestId('remote-flow-next'))).toBe(nextOf(i5));
    await sheet.getByTestId('remote-flow-sheet-close').click();
    await expect(sheet).toHaveCount(0);

    // A phone paired now, in Safari's engine: it reads where the sabha is at once.
    safari = await phoneOnMore(win, base, 'webkit', 'Placeholder iPhone');
    const late = safari.page.getByTestId('remote-flow');
    await expect(late.getByTestId('remote-flow-file')).toHaveText(ENGLISH.fileName);
    await expect.poll(() => seen(late.getByTestId('remote-flow-now'))).toBe(nowOf(i4));
    await expect.poll(() => seen(late.getByTestId('remote-flow-next'))).toBe(nextOf(i5));
    await safari.close();
    safari = null;

    // The PDF chosen is gone from its folder, and Drashti is started again: its own copy keeps the flow, Now (the
    // panel open as it was left) and its page. The phone left open goes offline, connects again by itself and follows.
    rmSync(files.ENGLISH);
    await first.app.close();
    await expect(p.getByTestId('connection')).toHaveAttribute('data-state', 'offline', { timeout: 20_000 });
    second = await relaunchApp(first.userData, NETWORK_ENV);
    const win2 = await operatorPage(second.app);
    await operatorReady(win2);
    await sizeOperatorWindow(second.app, win2, CI_WINDOW);
    const listening = () => win2.evaluate(() => (globalThis as PageGlobals).drashti.network.status());
    await expect.poll(async () => (await listening()).state).toBe('listening');
    expect((await listening()).port).toBe(port);
    await expect(p.getByTestId('connection')).toHaveText('Connected', { timeout: 30_000 });
    const panel2 = win2.getByTestId('sabha-flow');
    await expect(panel2.getByTestId('sabha-flow-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(panel2.getByTestId('flow-file')).toHaveText(ENGLISH.fileName, { timeout: 30_000 });
    expect(await flowState(win2)).toEqual({ flowId, now: 3 });
    await expect(panel2.getByTestId('flow-row').nth(3)).toHaveAttribute('aria-current', 'step');
    await expectNowNext(panel2, section, nowOf(i4), nextOf(i5));
    // Its page, from Drashti's own copy, in the panel and on the phone.
    await panel2.getByRole('tab', { name: 'PDF page' }).click();
    const page = panel2.getByTestId('flow-page');
    await expect
      .poll(() => page.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
        timeout: 30_000,
      })
      .toBe(true);
    await panel2.getByRole('tab', { name: 'Read list' }).click();
    await section.getByTestId('remote-open-flow').click();
    await expect(sheet).toBeVisible();
    await sheet.getByTestId('remote-flow-view-page').click();
    const picture = sheet.getByTestId('remote-flow-picture');
    await expect
      .poll(() =>
        picture.evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    await sheet.getByTestId('remote-flow-view-list').click();
    // The new run's own mark: Back from the panel, the open sheet following.
    await panel2.getByTestId('flow-back-button').click();
    await expect(sheet.getByTestId('remote-flow-row').nth(2)).toHaveAttribute('aria-current', 'step');
    await expect.poll(() => seen(sheet.getByTestId('remote-flow-next'))).toBe(nextOf(i4));
    await sheet.getByTestId('remote-flow-sheet-close').click();
    await expectNowNext(panel2, section, nowOf(i3), nextOf(i4));

    // A file that is not a PDF, chosen with Replace… by mistake: said in plain words, and the flow and Now stay.
    await answerDialog(second.app, broken);
    await panel2.getByTestId('flow-replace').click();
    await expect(panel2.getByTestId('flow-problem')).toContainText('not a PDF');
    await expect(panel2.getByTestId('flow-file')).toHaveText(ENGLISH.fileName);
    expect(await flowState(win2)).toEqual({ flowId, now: 2 });
    await expectNowNext(panel2, section, nowOf(i3), nextOf(i4));
    await expect(section.getByTestId('remote-flow-file')).toHaveText(ENGLISH.fileName);

    // Replace… with another PDF: a new flow, Now not started on both, Next up its first item, in Gujarati.
    await chooseInPanel(second.app, panel2, files.GUJARATI, GUJARATI.fileName);
    const g1 = itemOf(GUJARATI, 0);
    await expect(section.getByTestId('remote-flow-file')).toHaveText(GUJARATI.fileName);
    await expectNowNext(panel2, section, NOW_NOT_STARTED, nextOf(g1));
    const replaced = await flowState(win2);
    expect(replaced?.now).toBeNull();
    expect(replaced?.flowId).not.toBe(flowId);
    await expect(panel2.locator('[aria-current="step"]')).toHaveCount(0);

    // Remove, asked first: none on the panel and on the phone.
    await panel2.getByTestId('flow-remove').click();
    const confirm = win2.getByTestId('flow-remove-confirm');
    await expect(confirm).toContainText(GUJARATI.fileName);
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(panel2.getByTestId('flow-empty')).toBeVisible();
    expect(await flowKept(win2)).toBeNull();
    await expect(section.getByTestId('remote-flow-none')).toBeVisible();
    await expect(section.getByTestId('remote-flow-now-next')).toHaveCount(0);
  } finally {
    await safari?.close();
    await phone.close();
    await (second ?? first).app.close();
  }
});
