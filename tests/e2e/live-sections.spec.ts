import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The sections under LIVE (alpha.22; the owner, 24 Nov 2026: "remove more tools, bring out all the features with
 * collapsable, like this. and by default it should be collapsed, we can uncollapse it when we want."): no More tools;
 * under the LIVE block, Audio, the Stage screen, Messages, the phones' Chat (alpha.23, QA23-CHAT-1) and Timers, then each tool in a folding section of its own,
 * looking and working as those four do. Every section is folded at each start, and stays as the operator leaves it
 * while Drashti runs. Placeholder words only.
 */

/** The sections in their order: each heading's words, its fold button's id, and what shows only while it is open. */
const SECTIONS = [
  { title: 'Audio', id: 'audio', shows: (s: Locator) => s.getByTestId('music-panel') },
  { title: 'Stage screen', id: 'stage', shows: (s: Locator) => s.getByTestId('stage-preview') },
  {
    title: 'Messages',
    id: 'messages',
    shows: (s: Locator) => s.getByRole('button', { name: 'New message' }),
  },
  // The phones' group chat (alpha.23, QA23-CHAT-1: the owner's ask, the operator's window gets a Chat section too).
  { title: 'Chat', id: 'chat', shows: (s: Locator) => s.getByTestId('chat-contents') },
  { title: 'Timers', id: 'timers', shows: (s: Locator) => s.getByTestId('open-calendar') },
  { title: 'Lower Thirds', id: 'lower-thirds', shows: (s: Locator) => s.getByTestId('lower-third-new') },
  { title: 'Show a Window', id: 'show-a-window', shows: (s: Locator) => s.getByTestId('show-a-window') },
  {
    title: 'Show a Stream Link',
    id: 'show-a-stream-link',
    shows: (s: Locator) => s.getByTestId('show-a-stream-link'),
  },
  { title: 'Video inputs', id: 'video-inputs', shows: (s: Locator) => s.getByTestId('add-video-input') },
  { title: 'Picture in Picture', id: 'picture-in-picture', shows: (s: Locator) => s.getByTestId('pip-open') },
  { title: 'QR code', id: 'qr-code', shows: (s: Locator) => s.getByTestId('qr-code-open') },
  { title: 'MIDI controller', id: 'midi', shows: (s: Locator) => s.getByTestId('open-midi') },
  { title: 'OSC control', id: 'osc', shows: (s: Locator) => s.getByTestId('open-osc') },
] as const;

const toggleOf = (live: Locator, id: string) => live.getByTestId(`group-${id}-toggle`);

/** Every section's fold button, in the column's order, by its id. */
const togglesInOrder = (live: Locator) =>
  live
    .getByTestId('live-rest')
    .locator('[data-testid^="group-"][data-testid$="-toggle"]')
    .evaluateAll((all) => all.map((el) => el.getAttribute('data-testid')));

/** Every section folded, and nothing of any section's insides shown. */
async function expectAllFolded(live: Locator): Promise<void> {
  for (const s of SECTIONS) {
    await expect(toggleOf(live, s.id), `${s.title} starts folded`).toHaveAttribute('aria-expanded', 'false');
    await expect(s.shows(live), `${s.title}'s insides are folded away`).toHaveCount(0);
  }
}

async function setMode(win: Page, mode: 'pro' | 'simple'): Promise<void> {
  await win.evaluate((m) => (globalThis as PageGlobals).drashti.app.setMode(m), mode);
}

test('under LIVE: no More tools, each tool its own folding section after Timers, every section folded at the start, each opening to show its tool, by mouse and keyboard, at 1024 × 645', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const live = win.getByRole('complementary', { name: 'Live', exact: true });
  // No More tools, by its words or its parts.
  await expect(win.getByTestId('more-tools')).toHaveCount(0);
  await expect(win.getByTestId('group-more-tools-toggle')).toHaveCount(0);
  await expect(live.getByText(/more tools/iu)).toHaveCount(0);
  // The sections in their order, each a heading's button named as the section, all folded.
  expect(await togglesInOrder(live)).toEqual(SECTIONS.map((s) => `group-${s.id}-toggle`));
  for (const s of SECTIONS) {
    const toggle = toggleOf(live, s.id);
    await expect(toggle).toHaveAccessibleName(s.title);
    await expect(live.getByRole('heading', { name: s.title, exact: true })).toHaveCount(1);
  }
  await expectAllFolded(live);
  await expectNoSeriousA11yIssues(win, 'the sections under LIVE, folded', '[data-testid="live-rest"]');
  // Each opens to show its tool, and folds it away again.
  for (const s of SECTIONS) {
    const toggle = toggleOf(live, s.id);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(s.shows(live), `${s.title} shows its tool`).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(s.shows(live)).toHaveCount(0);
  }
  // From the keyboard: each heading a button that Enter opens and folds again (Space stays Next in this window, as
  // the keymap has it), and Tab goes down them in order.
  const first = toggleOf(live, SECTIONS[0].id);
  await first.focus();
  await win.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await win.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  const reached: string[] = [];
  for (let i = 0; i < 60 && reached.length < SECTIONS.length - 1; i++) {
    await win.keyboard.press('Tab');
    const id = await win.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    if (/^group-.+-toggle$/u.test(id)) reached.push(id);
  }
  expect(reached).toEqual(SECTIONS.slice(1).map((s) => `group-${s.id}-toggle`));
  // All open at once: every tool shown, and still nothing for axe.
  for (const s of SECTIONS) await toggleOf(live, s.id).click();
  for (const s of SECTIONS) await expect(s.shows(live)).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the sections under LIVE, all open', '[data-testid="live-rest"]');
  await app.close();
});

test('a section stays as the operator leaves it while Drashti runs (Simple Mode and back too), and every section is folded again at the next start; Simple Mode’s Audio as before', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const live = win.getByRole('complementary', { name: 'Live', exact: true });
  await expectAllFolded(live);
  const opened = ['messages', 'lower-thirds', 'video-inputs'];
  for (const id of opened) await toggleOf(live, id).click();
  // To Simple Mode and back: Simple Mode's Audio is as it was (open to begin with), and Pro Mode's sections kept.
  await setMode(win, 'simple');
  await expect(live.getByTestId('group-stage-toggle')).toHaveCount(0);
  await expect(live.getByTestId('group-audio-toggle')).toHaveAttribute('aria-expanded', 'true');
  await setMode(win, 'pro');
  await expect(toggleOf(live, 'stage')).toBeVisible();
  for (const s of SECTIONS)
    await expect(toggleOf(live, s.id), `${s.title} as it was left`).toHaveAttribute(
      'aria-expanded',
      opened.includes(s.id) ? 'true' : 'false',
    );
  await app.close();
  // The next start: every section folded again.
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await expectAllFolded(win2.getByRole('complementary', { name: 'Live', exact: true }));
  await again.app.close();
});
