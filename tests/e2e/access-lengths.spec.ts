import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { ENDED_STOP_TITLE, LOCK_REASON_TEXT, STOPPED_REFUSAL } from '../../src/shared/access';
import { callBody, placeholderComputer, readAnswer } from '../access-core';
import type { AccessStandIn } from '../access-standin';
import { expectNoSeriousA11yIssues } from './a11y';
import { closedWatch, moveListClock, ownerCall, PLACEHOLDER_PERSON } from './access';
import { clearOfShowControls, expectFits } from './fit';
import {
  launchApp,
  lockPage,
  operatorPage,
  operatorReady,
  type PageGlobals,
  relaunchApp,
  windowShowing,
} from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * A length of access (Session 54, the owner's decision of 28 Oct 2026), against the stand-in list on 127.0.0.1 (the
 * list's own rules, its clock moved by the test): the bar in the window's flow from 7 days before the end, at once for
 * a day, in Pro and Simple Mode alike, gone with Unlimited; the stop at the end as a revoke stops it, by the list's
 * clock a year ahead of this computer's own; started again, the lock screen says access ended and how to come back,
 * and opens by itself once the owner gives a new length; and the list's own Approve page (access-list/Link.html)
 * choosing the length. Checks every 6 s here (a test switch a packaged Drashti never reads). Placeholder addresses
 * only.
 */

const FAST = { DRASHTI_TEST_ACCESS_CHECK_MS: '6000', DRASHTI_TEST_ACCESS_TIMEOUT_MS: '2000' };
const DAY = 24 * 60 * 60_000;

/** The owner gives the placeholder person a length, from the list's now, as the Access List does. */
function giveLength(s: AccessStandIn, length: number | 'unlimited'): void {
  const a = ownerCall(s, 'length', { target: PLACEHOLDER_PERSON, length });
  if (!a.ok) throw new Error(`The stand-in refused the length: ${String(a.error)}`);
}

/** A page's request now: what it answered, or the words it was refused with. */
const tryLibrary = (win: Page) =>
  win.evaluate(async () => {
    try {
      return JSON.stringify((await (globalThis as PageGlobals).drashti.library.listPresentations()).length);
    } catch (error) {
      return String(error);
    }
  });

/** A page of the stand-in's opened in a window of its own, as the approver's browser opens a link from the email. */
async function openPage(app: ElectronApplication, url: string): Promise<Page> {
  await app.evaluate(({ BrowserWindow }, address) => {
    const w = new BrowserWindow({ show: false, width: 760, height: 900 });
    void w.loadURL(address);
  }, url);
  const page = await windowShowing(app, (p) => p.url() === url, 'the Approve page');
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Someone's Drashti asks for access, straight to the list: its Approve link, from the approver's email. */
function askedFor(s: AccessStandIn, gmail: string): string {
  const { body } = callBody('request', placeholderComputer(`lengths-${gmail}`, 'Placeholder Side Mac'), {
    gmail,
  });
  const a = readAnswer(s.list.handle(JSON.stringify(body)), s.publicKey);
  if (!a.ok) throw new Error(`The stand-in refused the request: ${String(a.error)}`);
  const links = s.list.linksFor(gmail);
  if (!links) throw new Error('No Approve link was emailed');
  return links.approve;
}

test('a length of a day: the bar at once, in the window’s flow over Pro and Simple Mode alike at 1024 × 645; 30 days none yet; Unlimited none at all', async () => {
  test.setTimeout(150_000);
  const { app, access: s } = await launchApp(FAST);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const bar = win.getByTestId('access-ends-notice');
    // Unlimited until the owner gives a length.
    await expect(bar).toHaveCount(0);
    giveLength(s, 1);
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await expect(bar).toContainText(/Your access to Drashti ends on \d{1,2} \w{3} \d{4} at /u);
    await expect(bar).toContainText(
      'In 23 hours. Ask the person who approves access for more time: when it is up, everything stops',
    );
    await expect(bar).toHaveAttribute('role', 'status');
    await expectFits(win.getByTestId('access-ends-notices'), 'the bar at 1024 × 645');
    await clearOfShowControls(win, bar);
    await expectNoSeriousA11yIssues(win, 'the bar at 1024 × 645');
    // Simple Mode: the same bar, never over its big buttons.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expect(bar).toBeVisible();
    await expectFits(win.getByTestId('access-ends-notices'), 'the bar over Simple Mode at 1024 × 645');
    await clearOfShowControls(win, bar);
    await expectNoSeriousA11yIssues(win, 'the bar over Simple Mode at 1024 × 645');
    // 30 days: no bar until 7 days before its end. Then 7 days: at once. Then Unlimited: none.
    giveLength(s, 30);
    await expect(bar).toHaveCount(0, { timeout: 20_000 });
    giveLength(s, 7);
    await expect(bar).toContainText('In 6 days.', { timeout: 20_000 });
    giveLength(s, 'unlimited');
    await expect(bar).toHaveCount(0, { timeout: 20_000 });
  } finally {
    await app.close();
  }
});

test('the end by the list’s clock, a year ahead of this computer’s: everything stops as a revoke stops it, saying when and how to come back; started again, the lock screen says so and opens by itself with a new length', async () => {
  test.setTimeout(180_000);
  const first = await launchApp(FAST);
  const s = first.access;
  const watch = closedWatch(first.app);
  try {
    const win = await operatorPage(first.app);
    await operatorReady(win);
    // The list's clock a year ahead of this computer's (as a computer whose own clock was set a year back): the bar
    // counts from the list's time, and the end comes by it.
    moveListClock(s, 365 * DAY);
    giveLength(s, 1);
    const bar = win.getByTestId('access-ends-notice');
    await expect(bar).toContainText('In 23 hours.', { timeout: 20_000 });
    moveListClock(s, DAY);
    const stopped = win.getByTestId('access-stopped');
    await expect(stopped).toHaveAttribute('data-reason', 'expired', { timeout: 20_000 });
    await expect(stopped.getByRole('heading', { level: 1 })).toHaveText(ENDED_STOP_TITLE);
    await expect(stopped).toContainText('The time the person who approves access gave you ended on ');
    await expect(stopped).toContainText(
      'To use Drashti again, ask the person who approves access for more time, then start Drashti again.',
    );
    await expect(win.getByRole('button')).toHaveCount(1);
    await expect(win.getByTestId('access-quit')).toBeFocused();
    expect(await tryLibrary(win)).toContain(STOPPED_REFUSAL);
    await expectNoSeriousA11yIssues(win, 'the stop once access has ended');
    await win.getByTestId('access-quit').click();
    await watch.whenClosed;
  } finally {
    if (!watch.closed()) await first.app.close();
  }
  const { app } = await relaunchApp(first.userData, FAST);
  try {
    const lock = await lockPage(app);
    const reason = lock.getByTestId('access-reason');
    await expect(reason).toHaveAttribute('data-reason', 'expired', { timeout: 20_000 });
    await expect(reason).toContainText(LOCK_REASON_TEXT.expired);
    await expect(reason).toContainText(' It ended on ');
    await expect(lock.getByTestId('access-retry')).toBeVisible();
    await expect(lock.getByText('It also tries again by itself every 15 seconds.')).toBeVisible();
    expect(app.windows().filter((w) => !w.url().includes('lock.html'))).toEqual([]);
    await expectFits(lock.getByTestId('access-lock'), 'the lock screen once access has ended');
    await expectNoSeriousA11yIssues(lock, 'the lock screen once access has ended');
    // The owner gives a new length: Drashti opens by itself, at its next check.
    giveLength(s, 30);
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect(win.getByTestId('access-ends-notice')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the list’s own Approve page: the lengths offered with Unlimited chosen (or the one chosen adding the Gmail), days typed checked, and the approval for the length chosen', async () => {
  test.setTimeout(120_000);
  const { app, access: s } = await launchApp(FAST);
  try {
    const gmail = 'asker.placeholder@example.com';
    const page = await openPage(app, s.pageUrl(askedFor(s, gmail)));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Approve ${gmail}?`);
    await expect(page.getByRole('group', { name: 'How long may they use Drashti?' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Unlimited, until you revoke it' })).toBeChecked();
    await expect(page.getByRole('radio')).toHaveCount(10);
    await expectNoSeriousA11yIssues(page, 'the Approve page');
    // Days typed that are not 1 to 730: said on the page, nothing sent.
    await page.getByRole('spinbutton', { name: 'Number of days' }).fill('0');
    await expect(page.getByRole('radio', { name: 'A number of days' })).toBeChecked();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.locator('#wait')).toHaveText(
      'Type a whole number of days from 1 to 730, or choose another length.',
    );
    expect(s.list.sheet.find('Access List', 'Gmail', gmail)?.['Status']).toBe('requested');
    // 30 days: approved, saying until when; the Sheet's Access ends 30 days from the approval, by the list's clock.
    await page.getByRole('radio', { name: '30 days' }).check();
    const from = s.list.t;
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Approved');
    await expect(page.locator('#lines')).toContainText('Their access lasts until');
    await expect(page.getByRole('radio')).toHaveCount(0);
    const ends = s.list.sheet.find('Access List', 'Gmail', gmail)?.['Access ends'];
    expect(ends).toBeInstanceOf(Date);
    const end = (ends as Date).getTime();
    expect(end - from).toBeGreaterThanOrEqual(30 * DAY);
    expect(end - from).toBeLessThan(30 * DAY + 60_000);
    // A Gmail the owner added for 90 days: its Approve page offers 90 days first.
    const added = 'added.placeholder@example.com';
    expect(ownerCall(s, 'add', { target: added, length: 90 })).toMatchObject({ ok: true });
    const theirs = await openPage(app, s.pageUrl(s.list.linksFor(added)?.approve ?? ''));
    await expect(theirs.getByRole('radio', { name: '90 days' })).toBeChecked();
  } finally {
    await app.close();
  }
});
