import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SabhaFlowSnapshot } from '../../src/shared/sabha-flow';
import { flowScanPage, flowTablePage, makeFlowPdf } from '../../src/main/documents/testing/sabha-flow-pdfs';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';

/*
 * Sabha flow (alpha.23, QA23-FLOW-1/2), Main's side end to end: a placeholder PDF (made here: pdf-lib, the bundled
 * Noto Gujarati) chosen through the system's dialog (answered by the test), read by the real pictures window's pdf.js
 * (its text layer and borders), its page drawn as a PNG at its own shape; Now marked; all remembered across a restart;
 * Replace and Remove. The panel and the phone have their own specs. Placeholder words only.
 */

const answerDialog = (app: ElectronApplication, file: string) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [f] });
  }, file);

const flowOf = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.flow.get());

/** A page's PNG: its signature, width and height (from its IHDR), or null. */
const pngOf = (win: Page, id: string, page: number) =>
  win.evaluate(
    async ([flowId, at]) => {
      const png = await (globalThis as PageGlobals).drashti.flow.page(flowId, at);
      if (!png) return null;
      const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
      return {
        signature: Array.from(png.slice(0, 8)),
        width: view.getUint32(16),
        height: view.getUint32(20),
      };
    },
    [id, page] as const,
  );

test('Sabha flow: a PDF chosen is read by the pictures window, drawn at its shape, remembered with Now; Replace; Remove', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-sabha-flow-'));
  const table = join(dir, 'Placeholder order.pdf');
  writeFileSync(
    table,
    await makeFlowPdf([
      flowTablePage({
        title: 'નમૂનો કાર્યક્રમ',
        headers: ['ક્રમ', 'કાર્યક્રમ', 'વિગત', 'સમય', 'વક્તા'],
        widths: [44, 140, 190, 70, 106],
        rows: [
          ['૧', 'પહેલો કાર્યક્રમ', 'નમૂનો વિગત', '૫ મિનિટ', 'વક્તા એક'],
          ['૨', 'બીજો કાર્યક્રમ', 'નમૂનો', { text: '૧૦ મિનિટ', rows: 2 }, 'વક્તા બે'],
          ['૩', 'ત્રીજો કાર્યક્રમ', 'નમૂનો', null, 'વક્તા ત્રણ'],
        ],
        total: 'કુલ સમય: ૨૦ મિનિટ',
        borders: 'boxes',
      }),
    ]),
  );
  const scan = join(dir, 'Placeholder scan.pdf');
  writeFileSync(scan, await makeFlowPdf([flowScanPage()]));

  const first = await launchApp();
  const win = await operatorPage(first.app);
  await operatorReady(win);
  expect(await flowOf(win)).toEqual({ flow: null, state: null });
  // Every change is said to the operator window.
  await win.evaluate(() => {
    const g = globalThis as PageGlobals & { flowChanges?: SabhaFlowSnapshot[] };
    g.flowChanges = [];
    g.drashti.flow.onChanged((snapshot) => g.flowChanges?.push(snapshot));
  });

  await answerDialog(first.app, table);
  const chosen = await win.evaluate(() => (globalThis as PageGlobals).drashti.flow.choose());
  if (!chosen?.ok) throw new Error(`Not chosen: ${JSON.stringify(chosen)}`);
  const id = chosen.flow.id;
  expect(chosen.flow).toEqual({
    id,
    fileName: 'Placeholder order.pdf',
    pageCount: 1,
    drawnPages: 1,
    status: 'read',
    lang: 'gu',
    title: 'નમૂનો કાર્યક્રમ',
    headers: ['ક્રમ', 'કાર્યક્રમ', 'વિગત', 'સમય', 'વક્તા'],
    items: [
      { no: '૧', cells: ['પહેલો કાર્યક્રમ', 'નમૂનો વિગત', '૫ મિનિટ', 'વક્તા એક'] },
      { no: '૨', cells: ['બીજો કાર્યક્રમ', 'નમૂનો', '૧૦ મિનિટ', 'વક્તા બે'] },
      { no: '૩', cells: ['ત્રીજો કાર્યક્રમ', 'નમૂનો', '૧૦ મિનિટ', 'વક્તા ત્રણ'] },
    ],
    total: 'કુલ સમય: ૨૦ મિનિટ',
  });
  // Its page: a PNG at the page's own shape (A4, 595 × 842 points), as large as fits in 2000 × 2000.
  expect(await pngOf(win, id, 0)).toEqual({
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    width: 1413,
    height: 2000,
  });
  expect(await pngOf(win, id, 1)).toBeNull();
  expect(await pngOf(win, 'not-this-flow', 0)).toBeNull();

  // Now: marked, said, and a stale flow's refused.
  expect(await win.evaluate((f) => (globalThis as PageGlobals).drashti.flow.setNow(f, 1), id)).toEqual({
    ok: true,
    state: { flowId: id, now: 1 },
  });
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.flow.setNow('not-this-flow', 0)),
  ).toMatchObject({ ok: false });
  await expect
    .poll(() =>
      win.evaluate(() =>
        ((globalThis as PageGlobals & { flowChanges?: SabhaFlowSnapshot[] }).flowChanges ?? []).map(
          (s) => s.state?.now ?? 'none',
        ),
      ),
    )
    .toEqual(['none', 1]);
  await first.app.close();

  // A restart: the same flow, Now where it was, its page still there.
  const second = await relaunchApp(first.userData);
  const again = await operatorPage(second.app);
  await operatorReady(again);
  expect(await flowOf(again)).toEqual({ flow: chosen.flow, state: { flowId: id, now: 1 } });
  expect(await pngOf(again, id, 0)).toMatchObject({ width: 1413, height: 2000 });

  // Replace with a scan: a new flow, Now back to none; its page shown, its words not readable.
  await answerDialog(second.app, scan);
  const replaced = await again.evaluate(() => (globalThis as PageGlobals).drashti.flow.choose());
  if (!replaced?.ok) throw new Error(`Not replaced: ${JSON.stringify(replaced)}`);
  expect(replaced.flow).toMatchObject({
    status: 'no-text',
    items: [],
    pageCount: 1,
    fileName: 'Placeholder scan.pdf',
  });
  expect(replaced.flow.id).not.toBe(id);
  expect((await flowOf(again)).state).toEqual({ flowId: replaced.flow.id, now: null });
  expect(await pngOf(again, replaced.flow.id, 0)).toMatchObject({ width: 1413, height: 2000 });
  expect(await pngOf(again, id, 0)).toBeNull();

  // Remove: none, and none after a restart.
  expect(await again.evaluate(() => (globalThis as PageGlobals).drashti.flow.remove())).toBeNull();
  expect(await flowOf(again)).toEqual({ flow: null, state: null });
  await second.app.close();
  const third = await relaunchApp(first.userData);
  const last = await operatorPage(third.app);
  await operatorReady(last);
  expect(await flowOf(last)).toEqual({ flow: null, state: null });
  await third.app.close();
});
