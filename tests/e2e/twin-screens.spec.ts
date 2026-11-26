import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { TEST_LINES } from '../../src/main/db/seed';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
  testDisplays,
  type PageGlobals,
} from './helpers';
import { screenState } from './keeps-failing';

/*
 * Two screens of one name (S1-1, the alpha.24 bug hunt). Screens are named after their display, so two TVs of one model
 * share a name, and a screen removed and made again keeps its name. Until now the watchdog, the heartbeat and
 * keeps-failing found a window's screen by its name, the first screen of that name: the second TV failing soon after the
 * first was given up on as the first failing again (black for 2 minutes), the healthy one was marked Stopped while the
 * black one said Showing; a screen made again after Not used was never Stopped (black, "Showing", no Try again). Each
 * window is its own now, and the words tell two of one name apart: the second is "… (2)". A picture that fails as it
 * draws stands in for any fault (a test hook, DRASHTI_TEST_RENDER_ERRORS, which a packaged Drashti ignores). Two pretend
 * displays (DRASHTI_EXTRA_DISPLAYS); placeholder names only.
 */

const ENV = {
  DRASHTI_EXTRA_DISPLAYS: '2',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_TEST_RENDER_ERRORS: '1',
};

interface Globals {
  drashtiDiagnostics: { watchdog: { events: { window: string; kind: string }[] } };
  drashtiTestRenderError?: (screenId?: string) => number;
}

/** Kept, when the screens ask Keep these screens? (Session 50): a test needs its outputs. */
const keepIfAsked = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    if ((await d.screens.pending()) !== null) await d.screens.keep();
  });

/** The open output of `screenId`, ready to draw the show. */
async function outputOf(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        found = undefined;
        for (const page of outputPages(app)) {
          if (page.isClosed()) continue;
          const id = await page
            .evaluate(() =>
              document.querySelector('[data-testid="output-root"]')?.getAttribute('data-screen'),
            )
            .catch(() => null);
          if (id === screenId) found = page;
        }
        return found !== undefined;
      },
      { timeout: 30_000, message: `the output of ${screenId} opens` },
    )
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  await outputReady(found);
  return found;
}

/** The outputs' watchdog events so far, as "<kind> <window>". */
const outputEvents = (app: ElectronApplication) =>
  app.evaluate(() =>
    (globalThis as unknown as Globals).drashtiDiagnostics.watchdog.events
      .filter((e) => e.window.startsWith('output '))
      .map((e) => `${e.kind} ${e.window}`),
  );

/** The screen's picture fails once as it draws (until its page loads again): whether its window was told. */
const failOnce = (app: ElectronApplication, screenId: string) =>
  app.evaluate(
    (_electron, sid) => (globalThis as unknown as Globals).drashtiTestRenderError?.(sid) ?? 0,
    screenId,
  );

/** The test slides live on every screen. */
const goLive = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.library.listPresentations();
    const id = list.find((p) => p.name === 'Language test slides')?.id ?? '';
    await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
  });

const showsTheSlide = (page: Page) => expect(page.locator('[data-lang="en"]')).toHaveText(TEST_LINES.en);

test('two screens of one name: one failing soon after the other is reloaded as itself, never given up on for the other; given up on, it alone is Stopped, said as “… (2)”', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(ENV);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const displays = await testDisplays(win);
    const left = await setUpScreen(win, 'Placeholder hall', 1);
    // Its twin on the second pretend display, named as the first, as two TVs of one model are: made again so its window
    // opens under that name (a rename alone keeps the window it has).
    const { right, name } = await win.evaluate(
      async ({ groupName, displayId, leftId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const groupId = (await d.screens.get()).groups.find((g) => g.name === groupName)?.id ?? '';
        const assigned = await d.screens.assignDisplay(groupId, displayId, { coverOperator: true });
        if (!assigned.ok) throw new Error(assigned.message);
        if ((await d.screens.pending()) !== null) await d.screens.keep();
        const screens = (await d.screens.get()).groups.find((g) => g.id === groupId)?.screens ?? [];
        const first = screens.find((s) => s.id === leftId);
        const second = screens.find((s) => s.id !== leftId);
        if (!first || !second) throw new Error('two screens were not made');
        const off = await d.screens.updateScreen(second.id, { enabled: false });
        if (!off.ok) throw new Error(off.message);
        const on = await d.screens.updateScreen(
          second.id,
          { name: first.name, enabled: true },
          { coverOperator: true },
        );
        if (!on.ok) throw new Error(on.message);
        return { right: second.id, name: first.name };
      },
      { groupName: 'Placeholder hall', displayId: displays[2]?.id ?? -1, leftId: left },
    );
    await keepIfAsked(win);
    const leftPage = await outputOf(app, left);
    const rightPage = await outputOf(app, right);
    await goLive(win);
    await showsTheSlide(leftPage);
    await showsTheSlide(rightPage);
    const leftWords = `output "${name}"`;
    const rightWords = `output "${name} (2)"`;

    // The left one fails: reloaded, and it draws the slide again.
    expect(await failOnce(app, left)).toBe(1);
    await expect
      .poll(() => outputEvents(app))
      .toEqual([`render-error ${leftWords}`, `reloaded ${leftWords}`]);
    await showsTheSlide(leftPage);

    // The right one fails within the left one's minute: its own first fault, reloaded, never given up on.
    expect(await failOnce(app, right)).toBe(1);
    await expect
      .poll(() => outputEvents(app), { message: 'the right one is reloaded as itself' })
      .toEqual([
        `render-error ${leftWords}`,
        `reloaded ${leftWords}`,
        `render-error ${rightWords}`,
        `reloaded ${rightWords}`,
      ]);
    await showsTheSlide(rightPage);
    expect([await screenState(win, left), await screenState(win, right)]).toEqual(['showing', 'showing']);
    await expect(win.getByTestId('screen-stopped-notice')).toHaveCount(0);

    // It fails again after its reload: it alone is given up on, Stopped, and the red notice names it apart.
    expect(await failOnce(app, right)).toBe(1);
    await expect.poll(() => screenState(win, right), { timeout: 15_000 }).toBe('stopped');
    expect(await screenState(win, left)).toBe('showing');
    expect((await outputEvents(app)).at(-1)).toBe(`gave-up ${rightWords}`);
    const notice = win.getByTestId('screen-stopped-notice');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute('data-screen', right);
    await expect(notice).toContainText(`“${name} (2)” has stopped`);
    await showsTheSlide(leftPage);
    // Screens says them apart as the notice does: the second Stopped, the first Showing.
    await win.getByRole('button', { name: 'Screens', exact: true }).click();
    await expect(win.getByTestId('screen-name').filter({ hasText: name })).toHaveText([name, `${name} (2)`]);
    const rowOf = (words: string) =>
      win.getByTestId('screen-row').filter({
        has: win
          .getByTestId('screen-name')
          .filter({ hasText: new RegExp(`^${words.replace(/[()]/gu, '\\$&')}$`, 'u') }),
      });
    await expect(rowOf(`${name} (2)`).getByTestId('screen-state')).toHaveText(/^Stopped/u);
    await expect(rowOf(name).getByTestId('screen-state')).toHaveText(/^Showing/u);
  } finally {
    await app.close();
  }
});

test('a screen removed and made again with its name (Not used, then the audience picture): given up on, the new one is Stopped and said, never “showing” while black', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(ENV);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const displays = await testDisplays(win);
    const displayId = displays[1]?.id ?? -1;
    const removed = await setUpScreen(win, 'Placeholder hall', 1);
    await outputOf(app, removed);
    const made = await win.evaluate(
      async ({ id, removedId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const none = await d.screens.setJob(id, 'none');
        if (!none.ok) throw new Error(none.message);
        if ((await d.screens.pending()) !== null) await d.screens.keep();
        const again = await d.screens.setJob(id, 'audience', { coverOperator: true });
        if (!again.ok) throw new Error(again.message);
        if ((await d.screens.pending()) !== null) await d.screens.keep();
        const screens = (await d.screens.get()).groups.flatMap((g) => g.screens);
        if (screens.some((s) => s.id === removedId)) throw new Error('the screen was not removed');
        return screens.find((s) => s.displayKey?.id === id)?.id ?? '';
      },
      { id: displayId, removedId: removed },
    );
    expect(made).not.toBe('');
    const page = await outputOf(app, made);
    await goLive(win);
    await showsTheSlide(page);

    // It fails, is reloaded, and fails again: given up on, the new screen is Stopped and the red notice names it.
    expect(await failOnce(app, made)).toBe(1);
    await expect.poll(() => outputEvents(app)).toContainEqual(expect.stringMatching(/^reloaded /u));
    await showsTheSlide(page);
    expect(await failOnce(app, made)).toBe(1);
    await expect.poll(() => screenState(win, made), { timeout: 15_000 }).toBe('stopped');
    const notice = win.getByTestId('screen-stopped-notice');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute('data-screen', made);
  } finally {
    await app.close();
  }
});
