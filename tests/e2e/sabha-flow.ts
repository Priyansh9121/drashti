import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { SabhaFlowState, SabhaFlowStatus } from '../../src/shared/sabha-flow';
import { device, type Device, type Engine, pairByQr, pairingCode } from './devices';
import type { PageGlobals } from './helpers';

export * from './sabha-flow-fixtures';

/*
 * Sabha flow (alpha.23, QA23-FLOW-1 and QA23-FLOW-2) across the operator window's panel, a paired phone and Now / Next
 * up: the steps the end-to-end scenarios share (choosing in the panel with Main's dialog answered, what a person reads,
 * each word's language where it is shown, a phone paired on its Show tab), with the placeholder running orders of
 * sabha-flow-fixtures.ts.
 */

/** Choose PDF… (or Replace…) answered with this file, or cancelled (null): Main's own file dialog, as the test says. */
export async function answerDialog(app: ElectronApplication, file: string | null): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    const g = globalThis as { flowDialogs?: number };
    g.flowDialogs = 0;
    dialog.showOpenDialog = () => {
      g.flowDialogs = (g.flowDialogs ?? 0) + 1;
      return Promise.resolve(
        path === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [path] },
      );
    };
  }, file);
}

/** How many times the file dialog was opened since answerDialog. */
export const dialogsOpened = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as { flowDialogs?: number }).flowDialogs ?? 0);

/** What a person reads in an element: its words without those only a screen reader hears (.sr-only). */
export const seen = (el: Locator): Promise<string> =>
  el.evaluate((node) => {
    const copy = node.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll('.sr-only')) hidden.remove();
    return copy.textContent.replace(/\s+/gu, ' ').trim();
  });

export async function seenAll(list: Locator): Promise<string[]> {
  const out: string[] = [];
  for (const el of await list.all()) out.push(await seen(el));
  return out;
}

/**
 * The language each of these words is in where they are shown: the lang of the nearest element around the first text
 * that is exactly it ('none' when no lang is set around it, 'missing' when it is not shown there at all).
 */
export const langsOf = (scope: Locator, words: readonly string[]): Promise<string[]> =>
  scope.evaluate((root, all) => {
    const texts: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
    return all.map((w) => {
      const at = texts.find((t) => t.data.trim() === w);
      if (!at) return 'missing';
      return at.parentElement?.closest('[lang]')?.getAttribute('lang') ?? 'none';
    });
  }, words);

/** Where the sabha is, as Main keeps it. */
export const flowState = (win: Page): Promise<SabhaFlowState | null> =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.flow.get()).state);

/** The flow Main keeps: its file name and how reading went, or null. */
export const flowKept = (win: Page): Promise<{ fileName: string; status: SabhaFlowStatus } | null> =>
  win.evaluate(async () => {
    const { flow } = await (globalThis as PageGlobals).drashti.flow.get();
    return flow ? { fileName: flow.fileName, status: flow.status } : null;
  });

/** The operator window's Sabha flow panel, opened from its toggle (it is folded in a new library). */
export async function openPanel(win: Page): Promise<Locator> {
  const panel = win.getByTestId('sabha-flow');
  const toggle = panel.getByTestId('sabha-flow-toggle');
  await expect(toggle).toHaveText('Sabha flow');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByTestId('sabha-flow-body')).toBeVisible();
  // Read: its flow (or none) shown, not "Reading the Sabha flow…".
  await expect(panel.getByTestId('flow-empty').or(panel.getByTestId('flow-file'))).toBeVisible();
  return panel;
}

/** Choose PDF… (no flow yet) or Replace… in the panel, answered with this file; waits until the panel shows it. */
export async function chooseInPanel(app: ElectronApplication, panel: Locator, file: string, name: string) {
  await answerDialog(app, file);
  const choose = panel.getByTestId('flow-choose');
  await ((await choose.count()) > 0 ? choose : panel.getByTestId('flow-replace')).click();
  await expect(panel.getByTestId('flow-file')).toHaveText(name, { timeout: 30_000 });
}

/**
 * A phone (Chrome's engine on an Android phone, or Safari's on an iPhone) paired as a remote, on its Show tab, where a
 * phone has the flow since alpha.23 (QA23-PHONE-1; in More until then, which a phone no longer has).
 */
export async function phoneOnShow(win: Page, base: string, engine: Engine, name: string): Promise<Device> {
  const phone = await device(engine);
  await pairByQr(phone.page, base, await pairingCode(win, 'remote', name), '/remote');
  await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
  await phone.page.getByTestId('remote-tab-show').click();
  await expect(phone.page.getByTestId('remote-flow')).toBeVisible();
  return phone;
}

/** Now and Next up, as the panel and a phone's view (the Show tab's section or the open sheet) both show them. */
export async function expectNowNext(
  panel: Locator,
  phone: Locator,
  now: string,
  next: string,
): Promise<void> {
  await expect.poll(() => seen(panel.getByTestId('flow-now'))).toBe(now);
  await expect.poll(() => seen(panel.getByTestId('flow-next'))).toBe(next);
  await expect.poll(() => seen(phone.getByTestId('remote-flow-now'))).toBe(now);
  await expect.poll(() => seen(phone.getByTestId('remote-flow-next'))).toBe(next);
}
