import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import type { SimpleFeature } from '../../src/shared/simple-features';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode, TABLET } from './devices';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import {
  chooseInPanel,
  ENGLISH,
  flowState,
  GUJARATI,
  itemOf,
  nextOf,
  nowOf,
  openPanel,
  phoneOnMore,
  seen,
  writeFlows,
} from './sabha-flow';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Sabha flow (alpha.23, QA23-FLOW-1/2) stays the operator's and the paired phones': never on an audience or stage
 * screen, and in Simple Mode only when chosen in Simple Mode Features…. The hall's output and a stage screen's (two
 * windowed outputs, the second on a pretend display) and a tablet paired as a Stage device watch every word they show
 * while a flow is chosen, marked, its page looked at, replaced and removed: none of the flow's. A new library's Simple
 * Mode has none of it, a paired phone shows none while the computer is in Simple Mode, and Now cannot be moved there;
 * once chosen in Simple Mode Features…, both have it (the phone too: QA23-FLOWP-1 A), until it is taken out again.
 * Placeholder PDFs only ("Flowcheck" marks their English words).
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };

/** Words of the flows chosen here (their own, their file names'), none of which may ever reach a screen. */
const NEVER = ['Flowcheck', ...itemOf(GUJARATI, 0).slice(1, 3), 'નમૂનો કાર્યક્રમ'];

const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
const openRoles = async (app: ElectronApplication) =>
  (await Promise.all(outputPages(app).map(roleOf))).sort();

/** From now on, the page notes each of these words it ever shows (in any text it has, shown or not). */
async function watchFor(page: Page): Promise<void> {
  await page.evaluate((words) => {
    const g = globalThis as { flowWordsSeen?: string[] };
    const seenHere: string[] = [];
    g.flowWordsSeen = seenHere;
    const look = () => {
      const text = document.documentElement.textContent;
      for (const w of words) if (text.includes(w) && !seenHere.includes(w)) seenHere.push(w);
    };
    look();
    new MutationObserver(look).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }, NEVER);
}

/** The words the page noted (null: the page was loaded again since, and its watch is gone). */
const wordsSeen = (page: Page) =>
  page.evaluate(() => (globalThis as { flowWordsSeen?: string[] }).flowWordsSeen ?? null);

test('Nothing of the Sabha flow reaches a screen: the hall’s and the stage’s outputs and a paired Stage device show none of its words while it is chosen, marked Now, its page looked at, replaced and removed', async () => {
  test.setTimeout(240_000);
  const files = await writeFlows({ ENGLISH, GUJARATI });
  const { app } = await launchApp({ ...OUTPUTS, ...NETWORK_ENV });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // The hall's screen on the first display, a stage screen on the second.
  await setUpScreen(win, 'Main Hall', 0);
  const stage = await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async (screenId) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.screens.some((x) => x.id === screenId));
    const set = await d.screens.setGroupRole(group?.id ?? '', 'stage');
    if (!set.ok) throw new Error(set.message);
  }, stage);
  await expect.poll(() => openRoles(app)).toEqual(['audience', 'stage']);
  // A slide up on them, so they are showing the show.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.library.newFromWords('Placeholder screens', 'Placeholder screen line one');
    if (!made.ok) throw new Error(made.message);
    const live = await d.engine.dispatch({ type: 'goLive', presentationId: made.id, slideIndex: 0 });
    if (!live.ok) throw new Error(live.message);
  });
  const outputs = outputPages(app);
  expect(outputs).toHaveLength(2);
  for (const o of outputs)
    await expect(o.getByTestId('output-root')).toContainText('Placeholder screen line one');

  // A tablet paired as a Stage device, on its stage display.
  const { base } = await networkOn(win);
  const tablet = await device('webkit', TABLET);
  const t = tablet.page;
  try {
    await pairByQr(t, base, await pairingCode(win, 'stage', 'Placeholder stage tablet'), '/stage');
    await expect(t.getByTestId('stage-view')).toBeVisible();
    await expect(t.getByTestId('stage-current')).toContainText('Placeholder screen line one');
    const screens = [...outputs, t];
    for (const s of screens) await watchFor(s);

    // Chosen, marked Now and moved on, in the panel.
    const panel = await openPanel(win);
    await chooseInPanel(app, panel, files.ENGLISH, ENGLISH.fileName);
    const rows = panel.getByTestId('flow-row');
    await expect(rows).toHaveCount(ENGLISH.items.length);
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute('aria-current', 'step');
    await panel.getByTestId('flow-next-button').click();
    await expect.poll(() => seen(panel.getByTestId('flow-now'))).toBe(nowOf(itemOf(ENGLISH, 1)));
    await expect.poll(() => seen(panel.getByTestId('flow-next'))).toBe(nextOf(itemOf(ENGLISH, 2)));
    // Its page looked at.
    await panel.getByRole('tab', { name: 'PDF page' }).click();
    const page = panel.getByTestId('flow-page');
    await expect
      .poll(() => page.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
        timeout: 30_000,
      })
      .toBe(true);
    // Replaced by a Gujarati one, and its second item marked Now.
    await chooseInPanel(app, panel, files.GUJARATI, GUJARATI.fileName);
    await rows.nth(1).click();
    await expect.poll(() => seen(panel.getByTestId('flow-now'))).toBe(nowOf(itemOf(GUJARATI, 1)));
    // The screens go on showing the show as it is, and none of the flow, while it is marked.
    for (const o of outputs)
      await expect(o.getByTestId('output-root')).toContainText('Placeholder screen line one');
    await expect(t.getByTestId('stage-current')).toContainText('Placeholder screen line one');
    await holdStill(
      async () => {
        for (const s of screens) if ((await wordsSeen(s))?.length !== 0) return false;
        return true;
      },
      2000,
      'no screen shows a word of the Sabha flow marked a moment ago',
    );
    // Removed.
    await panel.getByTestId('flow-remove').click();
    await win.getByTestId('flow-remove-confirm').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(panel.getByTestId('flow-empty')).toBeVisible();

    // Each screen still watching (never loaded again), none of the words ever shown, nor in any attribute now.
    for (const [i, s] of screens.entries()) {
      expect(await wordsSeen(s), `screen ${String(i + 1)}`).toEqual([]);
      const html = await s.content();
      for (const w of NEVER) expect(html.includes(w), `screen ${String(i + 1)}: ${w}`).toBe(false);
    }
  } finally {
    await tablet.close();
    await app.close();
  }
});

test('Simple Mode has the Sabha flow only while it is chosen in Simple Mode Features…: off in a new library, none of it in Simple Mode’s window or on a paired phone and Now not moved there; chosen, both have it and the phone follows a Now marked in Simple Mode; taken out again, neither; Pro Mode keeps the flow and Now throughout', async () => {
  test.setTimeout(240_000);
  const files = await writeFlows({ ENGLISH });
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // A feature by its id as a plain string: SimpleFeature has 'sabha-flow' once a22-flow-panel's entry is in.
  const chooseFeature = (feature: string, on: boolean) =>
    win.evaluate(
      ([f, o]) => (globalThis as PageGlobals).drashti.app.setSimpleFeature(f as SimpleFeature, o),
      [feature, on] as const,
    );
  const setMode = async (mode: 'pro' | 'simple') => {
    await win.evaluate((m) => (globalThis as PageGlobals).drashti.app.setMode(m), mode);
    await expect.poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode())).toBe(mode);
    await expect(win.getByTestId('simple-mode')).toHaveCount(mode === 'simple' ? 1 : 0);
  };

  // A new library: Simple Mode Features… has the Sabha flow, off.
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simpleFeatures())).toEqual([]);
  await chooseMenuItem(app, 'simple-features');
  const dialog = win.getByTestId('simple-features-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'Sabha flow', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(dialog.getByTestId('simple-feature-sabha-flow')).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  // Chosen and marked in Pro Mode, a phone following.
  const panel = await openPanel(win);
  await chooseInPanel(app, panel, files.ENGLISH, ENGLISH.fileName);
  await panel.getByTestId('flow-row').nth(1).click();
  await expect(panel.getByTestId('flow-row').nth(1)).toHaveAttribute('aria-current', 'step');
  const flowId = (await flowState(win))?.flowId ?? 'none';
  expect(await flowState(win)).toEqual({ flowId, now: 1 });
  const { base } = await networkOn(win);
  const phone = await phoneOnMore(win, base, 'chromium', 'Placeholder phone');
  const p = phone.page;
  try {
    await expect.poll(() => seen(p.getByTestId('remote-flow-now'))).toBe(nowOf(itemOf(ENGLISH, 1)));

    // Simple Mode: none of it in the window or on the phone, and Now is not Simple Mode's to move.
    await setMode('simple');
    await expect(win.getByTestId('sabha-flow')).toHaveCount(0);
    await expect(p.getByTestId('remote-flow')).toHaveCount(0);
    expect(
      await win.evaluate((id) => (globalThis as PageGlobals).drashti.flow.setNow(id, 3), flowId),
    ).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(await flowState(win)).toEqual({ flowId, now: 1 });

    // Pro Mode again: the panel, the flow and Now as they were, on the phone too.
    await setMode('pro');
    const again = win.getByTestId('sabha-flow');
    await expect(again.getByTestId('flow-file')).toHaveText(ENGLISH.fileName);
    await expect(again.getByTestId('flow-row').nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(p.getByTestId('remote-flow-file')).toHaveText(ENGLISH.fileName);
    await expect.poll(() => seen(p.getByTestId('remote-flow-now'))).toBe(nowOf(itemOf(ENGLISH, 1)));
    await expect.poll(() => seen(p.getByTestId('remote-flow-next'))).toBe(nextOf(itemOf(ENGLISH, 2)));

    // Chosen in Simple Mode Features… (QA23-FLOWP-1 A, lead 2’s answer): Simple Mode's window has it at the
    // top of its left column, marking Now, and the paired phone shows it too, following a Now marked there.
    expect(await chooseFeature('sabha-flow', true)).toEqual({ ok: true, chosen: ['sabha-flow'] });
    await setMode('simple');
    const simple = win.getByTestId('column-left').getByTestId('sabha-flow');
    await expect(simple.getByTestId('flow-row').nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(p.getByTestId('remote-flow-file')).toHaveText(ENGLISH.fileName);
    await expect.poll(() => seen(p.getByTestId('remote-flow-now'))).toBe(nowOf(itemOf(ENGLISH, 1)));
    await simple.getByTestId('flow-next-button').click();
    await expect.poll(() => flowState(win)).toEqual({ flowId, now: 2 });
    await expect.poll(() => seen(p.getByTestId('remote-flow-now'))).toBe(nowOf(itemOf(ENGLISH, 2)));
    await expect.poll(() => seen(p.getByTestId('remote-flow-next'))).toBe(nextOf(itemOf(ENGLISH, 3)));

    // Taken out of Simple Mode Features… again: Simple Mode has none of it, on the phone either.
    await setMode('pro');
    expect(await chooseFeature('sabha-flow', false)).toEqual({ ok: true, chosen: [] });
    await setMode('simple');
    await expect(win.getByTestId('sabha-flow')).toHaveCount(0);
    await expect(p.getByTestId('remote-flow')).toHaveCount(0);

    // Pro Mode: the Now marked in Simple Mode kept, on the phone too.
    await setMode('pro');
    await expect(again.getByTestId('flow-row').nth(2)).toHaveAttribute('aria-current', 'step');
    await expect.poll(() => seen(p.getByTestId('remote-flow-now'))).toBe(nowOf(itemOf(ENGLISH, 2)));
  } finally {
    await phone.close();
    await app.close();
  }
});
