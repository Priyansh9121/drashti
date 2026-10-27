import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { ACCESS_REMOVED_TEXT } from '../../src/shared/access';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import type { AccessComputer } from '../../src/shared/access-protocol';
import { callBody, placeholderComputer } from '../access-core';
import type { AccessStandIn } from '../access-standin';
import { expectNoSeriousA11yIssues } from './a11y';
import { PLACEHOLDER_PERSON } from './access';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  operatorPage,
  operatorReady,
  type PageGlobals,
  windowShowing,
} from './helpers';
import { CI_WINDOW } from './window-size';

/*
 * View › Access List… (Session 54, E4), against the stand-in list on 127.0.0.1 (the list's own rules, its Sheet in
 * memory): only the owner's computer has it; every Gmail with its status, dates, computers, counts and note; Add a
 * Gmail, Approve, Reject, Revoke (asked first, never offered on the owner's row), Give access again and a note, each
 * reaching the list at once and, a revoke, the person's own Drashti within one check; a request and a status typed
 * into the Sheet shown within seconds; sorting, the status shown, the search and the CSV; the window at CI's
 * 1024 × 645 and wider, by keyboard, and axe. Placeholder Gmails only.
 */

const isList = (p: Page) => p.url().includes('access-list.html');

/** The owner's Drashti (let in as the owner through a stand-in list of its own), its operator window ready. */
async function owner(env: Record<string, string> = {}) {
  const run = await launchApp(env, undefined, { as: 'owner' });
  const win = await operatorPage(run.app);
  await operatorReady(win);
  return { ...run, win };
}

/** The Access List's window, opened from View › Access List… as the owner would. */
async function openList(app: ElectronApplication): Promise<Page> {
  await chooseMenuItem(app, 'access-list');
  const list = await windowShowing(app, isList, 'the Access List');
  await expect(list).toHaveTitle('Drashti Access List');
  await expect(list.getByTestId('access-table')).toBeVisible({ timeout: 30_000 });
  return list;
}

/** Whether the application menu offers View › Access List… now. */
const offered = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => Boolean(Menu.getApplicationMenu()?.getMenuItemById('access-list')));

const row = (list: Page, gmail: string) => list.locator(`[data-testid="access-row"][data-gmail="${gmail}"]`);

/** The rows shown, in their order. */
const shown = (list: Page) =>
  list
    .locator('[data-testid="access-row"]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-gmail')));

/** Choose a Gmail's row (found by the search), as the owner would: its edits are then in the bar under the table. */
async function choose(list: Page, gmail: string): Promise<void> {
  await list.getByTestId('access-search').fill(gmail);
  await row(list, gmail).locator('th button').click();
  await expect(list.getByTestId('access-chosen-gmail')).toHaveText(gmail);
}

/** A placeholder computer of someone's, as each call to the list names it. */
const computerOf = (hardware: string, name: string): AccessComputer => placeholderComputer(hardware, name);

/** Someone's Drashti asking for access, straight to the list. */
function ask(s: AccessStandIn, gmail: string, computer: AccessComputer): void {
  const { body } = callBody('request', computer, { gmail, name: 'Placeholder Asker' });
  s.list.handle(JSON.stringify(body));
}

test('the owner’s Access List: every Gmail as the list has it, each edit reaching the list at once, Revoke asked first and never offered on the owner’s row, a request and a status typed into the Sheet shown within seconds', async () => {
  test.setTimeout(180_000);
  const { app, win, access: s } = await owner();
  try {
    // Someone let in on a computer of theirs, whose Drashti has run 2 h 5 min: counts only, never content.
    const hall = computerOf('access-list-person', 'Placeholder Hall Mac');
    const person = s.grant(PLACEHOLDER_PERSON, hall);
    const activity = { minutes: 125, shows: 3, streams: 2, recordings: 1, imports: 4 };
    s.list.handle(JSON.stringify(callBody('check', hall, { at: s.list.t, activity }, person).body));
    // The operator window's page has no way to the Access List's channels at all.
    expect(await win.evaluate(() => 'accessList' in (globalThis as PageGlobals).drashti)).toBe(false);
    expect(await offered(app)).toBe(true);

    const list = await openList(app);
    await expect(list.getByTestId('access-updated')).toHaveText('Updated just now');
    await expect(list.getByTestId('access-summary')).toHaveText('2 Gmails');
    await expect(row(list, s.approver)).toContainText('Owner');
    const theirs = row(list, PLACEHOLDER_PERSON);
    await expect(theirs).toHaveAttribute('data-status', 'approved');
    await expect(theirs).toContainText('Placeholder Hall Mac · 1.0.0-alpha.13 · Mac');
    await expect(theirs).toContainText('2 h 5 min');
    const counts = await theirs.locator('td').evaluateAll((cells) => cells.map((c) => c.textContent));
    expect(counts.slice(-5, -1)).toEqual(['3', '2', '1', '4']);

    // The owner's own row: Give access again (another computer of theirs) and a note; never Revoke, never Reject.
    await choose(list, s.approver);
    await expect(list.getByTestId('access-regrant')).toBeVisible();
    await expect(list.getByTestId('access-revoke')).toHaveCount(0);
    await expect(list.getByTestId('access-reject')).toHaveCount(0);

    // Revoke asks first, in the owner's words, Cancel focused: cancelled, nothing changes.
    await choose(list, PLACEHOLDER_PERSON);
    await list.getByTestId('access-revoke').click();
    const question = list.getByTestId('access-revoke-question');
    await expect(question).toContainText('Their Drashti stops at once, screens and stream included.');
    await expect(question.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expectNoSeriousA11yIssues(list, 'the Access List’s Revoke question');
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toHaveCount(0);
    expect(s.list.sheet.find('Access List', 'Gmail', PLACEHOLDER_PERSON)?.['Status']).toBe('approved');
    // Revoked: in the list at once, and in the Sheet.
    await list.getByTestId('access-revoke').click();
    await question.getByRole('button', { name: 'Revoke' }).click();
    await expect(list.getByTestId('access-said')).toContainText(`Revoked ${PLACEHOLDER_PERSON}`);
    await expect(theirs).toHaveAttribute('data-status', 'revoked');
    expect(s.list.sheet.find('Access List', 'Gmail', PLACEHOLDER_PERSON)?.['Status']).toBe('revoked');

    // Give access again: approved, with a new token by email.
    const mails = s.list.mailTo(PLACEHOLDER_PERSON).length;
    await list.getByTestId('access-regrant').click();
    await expect(theirs).toHaveAttribute('data-status', 'approved');
    expect(s.list.mailTo(PLACEHOLDER_PERSON)).toHaveLength(mails + 1);
    expect(s.list.tokenFor(PLACEHOLDER_PERSON)).not.toBeNull();

    // A note, kept in the Sheet, shown in the row.
    await list.getByTestId('access-note').click();
    await list.getByTestId('access-note-text').fill('Placeholder note for the side room');
    await list.getByTestId('access-note-save').click();
    await expect(theirs).toContainText('Placeholder note for the side room');
    expect(s.list.sheet.find('Access List', 'Gmail', PLACEHOLDER_PERSON)?.['Note']).toBe(
      'Placeholder note for the side room',
    );

    // A request from someone's Drashti shows within seconds, waiting; Reject tells them by email.
    await list.getByTestId('access-search').fill('');
    ask(s, 'asker.placeholder@example.com', computerOf('access-list-asker', 'Placeholder Side Mac'));
    const asker = row(list, 'asker.placeholder@example.com');
    await expect(asker).toHaveAttribute('data-status', 'requested', { timeout: 20_000 });
    await expect(asker).toContainText('Asked from Placeholder Side Mac');
    await expect(list.getByTestId('access-summary')).toHaveText('3 Gmails · 1 request waiting');
    await choose(list, 'asker.placeholder@example.com');
    await list.getByTestId('access-reject').click();
    await expect(asker).toHaveAttribute('data-status', 'rejected');
    expect(s.list.mailTo('asker.placeholder@example.com').at(-1)?.subject).toBe('Your Drashti request');

    // Add a Gmail, approved at once: its row approved, its token on its way by email.
    await list.getByTestId('access-search').fill('');
    await list.getByTestId('access-add-open').click();
    const add = list.getByTestId('access-add-dialog');
    await expect(add).toBeVisible();
    await expectNoSeriousA11yIssues(list, 'the Access List’s Add a Gmail');
    await list.getByTestId('access-add-gmail').fill('not an address');
    await list.getByTestId('access-add-save').click();
    await expect(add).toContainText('That does not look like an email address');
    await list.getByTestId('access-add-gmail').fill('new.placeholder@example.com');
    await list.getByTestId('access-add-name').fill('Placeholder New');
    await list.getByTestId('access-add-save').click();
    await expect(add).toHaveCount(0);
    const added = row(list, 'new.placeholder@example.com');
    await expect(added).toHaveAttribute('data-status', 'approved');
    await expect(added).toContainText('Placeholder New');
    await expect(list.getByTestId('access-chosen-gmail')).toHaveText('new.placeholder@example.com');
    expect(s.list.tokenFor('new.placeholder@example.com')).not.toBeNull();

    // A status typed into the Sheet itself counts the same: shown within seconds.
    s.list.sheet.type('Access List', 'Gmail', 'new.placeholder@example.com', 'Status', 'revoked');
    await expect(added).toHaveAttribute('data-status', 'revoked', { timeout: 20_000 });
  } finally {
    await app.close();
  }
});

test('a revoke in the Access List stops that Gmail’s own Drashti at its next check', async () => {
  test.setTimeout(180_000);
  const { app, access: s } = await owner();
  // The person's Drashti on the same list, checking every 6 s (a test switch).
  const theirs = await launchApp(
    { DRASHTI_TEST_ACCESS_CHECK_MS: '6000', DRASHTI_TEST_ACCESS_TIMEOUT_MS: '2000' },
    undefined,
    { as: { gmail: PLACEHOLDER_PERSON }, standIn: s },
  );
  try {
    const theirWin = await operatorPage(theirs.app);
    await operatorReady(theirWin);
    // Not the owner's computer: no Access List there.
    expect(await offered(theirs.app)).toBe(false);

    const list = await openList(app);
    await choose(list, PLACEHOLDER_PERSON);
    // Their computer, as its checks name it: this Drashti's own version.
    const version = await theirs.app.evaluate(({ app: electronApp }) => electronApp.getVersion());
    await expect(row(list, PLACEHOLDER_PERSON)).toContainText(version);
    await list.getByTestId('access-revoke').click();
    await list.getByTestId('access-revoke-question').getByRole('button', { name: 'Revoke' }).click();
    await expect(row(list, PLACEHOLDER_PERSON)).toHaveAttribute('data-status', 'revoked');
    // Their Drashti stops within one check: the plain message, and Quit.
    const stopped = theirWin.getByTestId('access-stopped');
    await expect(stopped).toHaveAttribute('data-reason', 'revoked', { timeout: 20_000 });
    await expect(stopped.getByRole('heading', { level: 1 })).toHaveText(ACCESS_REMOVED_TEXT);
  } finally {
    await theirs.app.close();
    await app.close();
  }
});

test('the Access List sorts, shows one status, searches, and saves the rows shown as a CSV of counts, never content', async () => {
  test.setTimeout(150_000);
  const { app, access: s } = await owner();
  try {
    for (const [i, gmail] of [
      'b.placeholder@example.com',
      'a.placeholder@example.com',
      'c.placeholder@example.com',
    ].entries())
      s.grant(gmail, computerOf(`access-list-sort-${String(i)}`, 'Placeholder Mac'));
    ask(s, 'd.placeholder@example.com', computerOf('access-list-sort-d', 'Placeholder Side Mac'));
    const list = await openList(app);
    // As it opens: by status, the request waiting first, then each status by Gmail.
    await expect
      .poll(() => shown(list))
      .toEqual([
        'd.placeholder@example.com',
        'a.placeholder@example.com',
        'b.placeholder@example.com',
        'c.placeholder@example.com',
        s.approver,
      ]);
    await expect(list.getByRole('columnheader', { name: 'Status' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    // By Gmail, then the other way.
    const gmailHeader = list.getByRole('columnheader', { name: 'Gmail and name' });
    await gmailHeader.getByRole('button').click();
    await expect(gmailHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => (await shown(list))[0]).toBe('a.placeholder@example.com');
    await gmailHeader.getByRole('button').click();
    await expect(gmailHeader).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => (await shown(list))[0]).toBe(s.approver);
    // One status, then all again; the search.
    await list.getByTestId('access-show-requested').click();
    await expect.poll(() => shown(list)).toEqual(['d.placeholder@example.com']);
    await list.getByTestId('access-show-all').click();
    await list.getByTestId('access-search').fill('b.placeholder');
    await expect.poll(() => shown(list)).toEqual(['b.placeholder@example.com']);
    await list.getByTestId('access-search').fill('nobody.placeholder');
    await expect(list.getByTestId('access-none-shown')).toBeVisible();
    await list.getByRole('button', { name: 'Show every Gmail' }).click();
    await expect.poll(async () => (await shown(list)).length).toBe(5);

    // The approved rows, saved where the owner chooses (the save dialog answered here).
    const into = join(mkdtempSync(join(tmpdir(), 'drashti-e2e-csv-')), 'access.csv');
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, into);
    await gmailHeader.getByRole('button').click();
    await list.getByTestId('access-show-approved').click();
    await list.getByTestId('access-export').click();
    await expect(list.getByTestId('access-said')).toContainText('Saved 4 Gmails to access.csv');
    const text = readFileSync(into, 'utf8');
    const lines = text
      .replace(/^\uFEFF/u, '')
      .trimEnd()
      .split('\r\n');
    expect(lines[0]).toBe(
      'Gmail,Name,Status,Requested,Approved,Rejected,Revoked,Computers,Last seen,Minutes used,Shows,Streams,Recordings,Imports,Note',
    );
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual([
      'a.placeholder@example.com',
      'b.placeholder@example.com',
      'c.placeholder@example.com',
      s.approver,
    ]);
    // Counts and the list's own fields only: nothing of the library (its placeholder presentations) or a file.
    expect(text).not.toContain('Language test slides');
    expect(text).not.toContain('Sample kirtan');
  } finally {
    await app.close();
  }
});

/** The Access List's window at a size: its content that size where the display has room, its page laid out so. */
async function sizeList(app: ElectronApplication, list: Page, size: { width: number; height: number }) {
  await app.evaluate(({ BrowserWindow }, want) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('access-list.html'))
      ?.setContentSize(want.width, want.height);
  }, size);
  await list.setViewportSize(size);
  await expect.poll(() => list.evaluate(() => [innerWidth, innerHeight])).toEqual([size.width, size.height]);
}

test('the Access List at CI’s 1024 × 645 and wider: everything in reach, by keyboard too, axe passes; Simple Mode leaves it out', async () => {
  test.setTimeout(150_000);
  const { app, win, access: s } = await owner();
  try {
    for (let i = 0; i < 40; i++)
      s.grant(
        `p${String(i).padStart(2, '0')}.placeholder@example.com`,
        computerOf(`access-list-many-${String(i)}`, 'Placeholder Mac'),
      );
    const list = await openList(app);
    await expect.poll(async () => list.getByTestId('access-table').getAttribute('data-count')).toBe('41');
    for (const size of [CI_WINDOW, { width: 1440, height: 900 }]) {
      const what = `the Access List at ${String(size.width)} × ${String(size.height)}`;
      await sizeList(app, list, size);
      // The page never scrolls sideways; the table does, inside it, its header and Gmail column kept in view.
      expect(await list.evaluate(() => document.documentElement.scrollWidth <= innerWidth), what).toBe(true);
      await expectFits(list.getByTestId('access-header'), `${what}: its header`);
      await expectFits(list.getByTestId('access-toolbar'), `${what}: its toolbar`);
      await expectFits(list.getByTestId('access-chosen'), `${what}: the bar under the table`);
      await expect(list.getByTestId('access-export')).toBeInViewport();
      await expectNoSeriousA11yIssues(list, what);
    }
    await sizeList(app, list, CI_WINDOW);
    const table = list.getByTestId('access-table');
    expect(await table.evaluate((t) => t.scrollWidth > t.clientWidth)).toBe(true);

    // By keyboard: the rows are one Tab stop; the arrows, Home and End choose, and the chosen row stays in view.
    const first = (await shown(list))[0] ?? '';
    await row(list, first).locator('th button').focus();
    await list.keyboard.press('ArrowDown');
    const second = (await shown(list))[1] ?? '';
    await expect(list.getByTestId('access-chosen-gmail')).toHaveText(second);
    // All approved, so by Gmail: the owner's first, p39's last.
    await list.keyboard.press('End');
    const last = 'p39.placeholder@example.com';
    await expect(list.getByTestId('access-chosen-gmail')).toHaveText(last);
    await expect(row(list, last)).toBeInViewport();
    await expect(row(list, last).locator('th button')).toBeFocused();
    await list.keyboard.press('Home');
    await expect(list.getByTestId('access-chosen-gmail')).toHaveText(s.approver);
    await expect(list.locator('[data-row-button][tabindex="0"]')).toHaveCount(1);

    // Simple Mode: View › Access List… leaves the menu, and an edit in the open window is refused, saying why.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect.poll(() => offered(app)).toBe(false);
    await choose(list, 'p01.placeholder@example.com');
    await list.getByTestId('access-regrant').click();
    await expect(list.getByTestId('access-said')).toContainText(SIMPLE_MODE_REFUSAL);
    await expect(row(list, 'p01.placeholder@example.com')).toHaveAttribute('data-status', 'approved');
  } finally {
    await app.close();
  }
});

test('only the owner’s computer has View › Access List…, and nothing else reaches its channels', async () => {
  test.setTimeout(90_000);
  // Let in as the placeholder person: not the owner.
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    expect(await offered(app)).toBe(false);
    expect(await win.evaluate(() => 'accessList' in (globalThis as PageGlobals).drashti)).toBe(false);
    await chooseMenuItem(app, 'access-list');
    await holdStill(() => !app.windows().some(isList), 2000, 'no Access List opens');
  } finally {
    await app.close();
  }
});
