import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import type { SentMail } from '../access-core';
import type { AccessStandIn } from '../access-standin';
import { expectNoSeriousA11yIssues } from './a11y';
import { PLACEHOLDER_PERSON, answerAgain, standInOf } from './access';
import {
  chooseMenuItem,
  holdStill,
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
} from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';

/*
 * Help › Report a Problem… (x49, the owner's Q60-38 and his "Yes, all A" to Q60-42): any person let in tells the admin
 * where a problem is and what it is. They choose the features (several, each with its own words) from the Manual's own
 * list or its search, may send the diagnostics and a picture of the window (both unticked at first), see exactly what
 * will be sent, and Send. It goes through the access list's script (here the stand-in on 127.0.0.1, never Google): one
 * email to the admin with the files, and the person a short note. It waits while the list cannot be reached or the
 * stream is on air, then goes by itself, once. Placeholder words and generated files only.
 */

const REFERENCE = /R-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/u;

/** The window, open from Help. */
async function openReport(app: ElectronApplication, win: Page): Promise<Locator> {
  await chooseMenuItem(app, 'report-problem');
  const dialog = win.getByRole('dialog', { name: 'Report a Problem' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A feature found by the search and ticked: its box for what went wrong appears. */
async function chooseFeature(dialog: Locator, search: string, name: string): Promise<void> {
  await dialog.getByLabel('Find a feature').fill(search);
  const box = dialog.getByRole('checkbox', { name, exact: true });
  await box.click();
  await expect(box).toBeChecked();
  await expect(dialog.getByLabel(`What went wrong with ${name}?`)).toBeVisible();
}

/** The emails the stand-in list sent since `from`, once there are `n`. */
async function mailsSince(list: AccessStandIn, from: number, n: number): Promise<SentMail[]> {
  await expect.poll(() => list.list.mailbox.length - from, { timeout: 30_000 }).toBe(n);
  return list.list.mailbox.slice(from);
}

/** A PNG's width and height, from its header. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('Help › Report a Problem…: two features with their own words, the diagnostics and a picture of the window, reviewed, then emailed to the admin through the access list', async () => {
  const { app, access } = await launchApp();
  const win = await operatorPage(app);
  // A name in the library that the diagnostics must never carry.
  const source = mkdtempSync(join(tmpdir(), 'drashti-report-'));
  const secretName = 'Placeholder Report Secret Name';
  const song = join(source, `${secretName}.pro6`);
  writeFileSync(
    song,
    pp6Presentation({
      uuid: 'E2E-REPORT',
      groups: [
        {
          name: 'Placeholder',
          slides: [{ text: [{ rtf: cocoaRtf([['Placeholder words', 72, [255, 255, 255]]]) }] }],
        },
      ],
    }),
  );
  await importAndGetIds(win, [song]);
  await operatorReady(win);
  const before = access.list.mailbox.length;

  const dialog = await openReport(app, win);
  // The features are the Manual's, grouped by its chapters; nothing is sent with the report unless ticked.
  await expect(dialog.getByRole('group', { name: 'LIVE, Back and Next' })).toBeVisible();
  for (const name of [/^Diagnostics/u, /^A picture of this window/u])
    await expect(dialog.getByRole('checkbox', { name })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Review…' })).toBeDisabled();
  await chooseFeature(dialog, 'time bar', 'The time bar');
  await chooseFeature(dialog, 'markers', 'Markers');
  // Each feature its own words (Q60-42, 1): what went wrong is needed, what was expected is not.
  await dialog.getByLabel('What went wrong with The time bar?').fill('Placeholder: the time bar stops.');
  await expect(dialog.getByRole('button', { name: 'Review…' })).toBeDisabled();
  await dialog
    .getByLabel('What did you expect from The time bar? (optional)')
    .fill('Placeholder: it runs on.');
  await dialog.getByLabel('What went wrong with Markers?').fill('Placeholder: a marker is lost.');
  await dialog.getByRole('checkbox', { name: /^Diagnostics/u }).click();
  // Its log of a chosen period (alpha.21, logs (c)): Today at first; the last 7 days here.
  const period = dialog.getByLabel('Its log of');
  await expect(period).toHaveValue('today');
  await period.selectOption('last-7-days');
  await dialog.getByRole('checkbox', { name: /^A picture of this window/u }).click();
  await expect(dialog.getByText(`Your Gmail (${PLACEHOLDER_PERSON})`)).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Report a Problem', '[role="dialog"]');

  // The review: exactly what goes, before Send.
  await dialog.getByRole('button', { name: 'Review…' }).click();
  await expect(dialog.getByTestId('report-review-to')).toHaveText('the admin of Drashti’s access list');
  const subject = dialog.getByTestId('report-review-subject');
  await expect(subject).toHaveText(
    new RegExp(`^Drashti problem: The time bar, Markers \\(${REFERENCE.source}\\)$`, 'u'),
  );
  const text = dialog.getByTestId('report-review-text');
  await expect(text).toContainText('1. The time bar (LIVE, Back and Next)');
  await expect(text).toContainText('Placeholder: it runs on.');
  await expect(text).toContainText('2. Markers (LIVE, Back and Next)');
  await expect(dialog.getByTestId('report-review-file')).toHaveCount(2);
  const shownSubject = (await subject.textContent()) ?? '';
  await expectNoSeriousA11yIssues(win, 'Report a Problem’s review', '[role="dialog"]');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog.getByText(/^Sent: the admin has it\./u)).toBeVisible();
  const reference = REFERENCE.exec(shownSubject)?.[0] ?? '';
  await expect(dialog.getByText(reference)).toBeVisible();

  const [admin, note] = await mailsSince(access, before, 2);
  expect(admin?.to).toBe(access.approver);
  expect(admin?.replyTo).toBe(PLACEHOLDER_PERSON);
  expect(admin?.subject).toBe(shownSubject);
  expect(admin?.body).toContain(`From: ${PLACEHOLDER_PERSON} (the Gmail let in on that computer)`);
  expect(admin?.body).toContain(', in Pro Mode');
  expect(admin?.body).toContain('Placeholder: the time bar stops.');
  expect(admin?.body).toContain('Placeholder: a marker is lost.');
  const files = admin?.attachments ?? [];
  expect(files.map((f) => f.type)).toEqual(['text/plain', 'image/png']);
  const diagnostics = Buffer.from(files[0]?.base64 ?? '', 'base64').toString('utf8');
  expect(diagnostics).toContain('== Drashti diagnostics ==');
  expect(diagnostics).toContain('== Graphics ==');
  expect(diagnostics).not.toContain(secretName);
  // Who and what made it, and the period chosen (alpha.21, logs (b) and (c)); never the Gmail let in.
  expect(diagnostics).toMatch(
    /^Install id: [0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/mu,
  );
  expect(diagnostics).toMatch(/^Access-list entry: grant [0-9a-f]{8}… /mu);
  expect(diagnostics).toMatch(/^Role: Pro$/mu);
  expect(diagnostics).toMatch(/^Log: The last 7 days, \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/mu);
  expect(diagnostics).not.toContain(PLACEHOLDER_PERSON);
  const picture = pngSize(Buffer.from(files[1]?.base64 ?? '', 'base64'));
  expect(picture.width).toBeGreaterThan(400);
  expect(Math.max(picture.width, picture.height)).toBeLessThanOrEqual(1920);
  expect(note?.to).toBe(PLACEHOLDER_PERSON);
  expect(note?.subject).toBe(`Your Drashti report ${reference}`);

  // A copy kept here: Your reports lists it, sent.
  await dialog.getByRole('button', { name: 'Your reports' }).click();
  await expect(dialog.getByTestId('report-row').filter({ hasText: reference })).toContainText('Sent');
  await app.close();
});

test('Simple Mode has it too, its own chapter first; Report this… on a notice fills in the notice and its feature', async () => {
  const { app, access } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const before = access.list.mailbox.length;

  // A notice of Drashti's own, as the main process sends it.
  const words = 'Could not save diagnostics: see the log in the data folder.';
  await app.evaluate(({ BrowserWindow }, text) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:notice', { text });
  }, words);
  const notice = win.getByTestId('operator-notice').filter({ hasText: words });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Report this…' }).click();
  const dialog = win.getByRole('dialog', { name: 'Report a Problem' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('group').first()).toHaveAccessibleName('Simple Mode');
  await expect(dialog.getByTestId('report-notice')).toContainText(words);
  await expect(dialog.getByRole('checkbox', { name: 'Save Diagnostics', exact: true })).toBeChecked();
  await dialog.getByLabel('What went wrong with Save Diagnostics?').fill('Placeholder: nothing was saved.');
  await dialog.getByRole('button', { name: 'Review…' }).click();
  await expect(dialog.getByTestId('report-review-text')).toContainText(
    `The notice Drashti showed: “${words}”`,
  );
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog.getByText(/^Sent: the admin has it\./u)).toBeVisible();
  const [admin] = await mailsSince(access, before, 2);
  expect(admin?.subject).toMatch(/^Drashti problem: Save Diagnostics \(R-/u);
  expect(admin?.body).toContain(', in Simple Mode');
  expect(admin?.body).toContain(`The notice Drashti showed: “${words}”`);
  expect(admin?.attachments ?? []).toEqual([]);
  await app.close();
});

test('kept while the access list cannot be reached, and while the stream is on air, then sent by itself, once', async () => {
  const { app, access } = await launchApp({
    DRASHTI_TEST_ON_AIR_HOOK: '1',
    DRASHTI_TEST_REPORT_RETRY_MS: '1000',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const before = access.list.mailbox.length;

  // The list answers nothing but errors: the report is kept, and goes once it answers again.
  access.mode = 'error';
  let dialog = await openReport(app, win);
  await chooseFeature(dialog, 'going live', 'Going live');
  await dialog.getByLabel('What went wrong with Going live?').fill('Placeholder: kept, then sent.');
  await dialog.getByRole('button', { name: 'Review…' }).click();
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(
    dialog.getByText('Kept on this computer: it goes by itself once the access list can be reached.'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await holdStill(
    () => access.list.mailbox.length === before,
    2000,
    'nothing is emailed while the list cannot answer',
  );
  answerAgain(access);
  const [first] = await mailsSince(access, before, 2);
  expect(first?.body).toContain('Placeholder: kept, then sent.');
  await expect(win.getByTestId('operator-notice')).toContainText(
    /Your report R-[0-9A-Z-]+ reached the admin\./u,
  );

  // On air: kept until the stream and the recording have ended, then it goes by itself.
  await app.evaluate(() => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(true);
  });
  const reports = access.calls.filter((c) => c === 'report').length;
  dialog = await openReport(app, win);
  await chooseFeature(dialog, 'recording', 'Recording');
  await dialog.getByLabel('What went wrong with Recording?').fill('Placeholder: kept while on air.');
  await dialog.getByRole('button', { name: 'Review…' }).click();
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(
    dialog.getByText(
      'Kept on this computer: it goes by itself once the stream and the recording have ended.',
    ),
  ).toBeVisible();
  await holdStill(
    () => access.calls.filter((c) => c === 'report').length === reports,
    3000,
    'no report goes to the list while on air',
  );
  await app.evaluate(() => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(false);
  });
  const [second] = await mailsSince(access, before + 2, 2);
  expect(second?.body).toContain('Placeholder: kept while on air.');
  // Each report emailed once, however often it was tried.
  await holdStill(() => access.list.mailbox.length === before + 4, 3000, 'no report is emailed twice');
  await app.close();
});

test('a node’s Report a Problem… goes through the Main it is paired with (Q60-42, 2): handed over, then emailed by Main, naming the node', async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode();
  await pairNode(main, node);
  const access = standInOf(main.userData);
  const before = access.list.mailbox.length;

  await chooseMenuItem(node.app, 'report-problem');
  const dialog = node.page.getByRole('dialog', { name: 'Report a Problem' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/^It goes to the admin through Main/u)).toBeVisible();
  await chooseFeature(dialog, 'second computer', 'A second computer (the node)');
  await dialog
    .getByLabel('What went wrong with A second computer (the node)?')
    .fill('Placeholder: the node’s screen lags.');
  await dialog.getByRole('checkbox', { name: /^Diagnostics/u }).click();
  await dialog.getByRole('button', { name: 'Review…' }).click();
  await expect(dialog.getByTestId('report-review-text')).toContainText(
    'Placeholder: the node’s screen lags.',
  );
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog.getByText(/^Handed to Main/u)).toBeVisible();

  const [admin, note] = await mailsSince(access, before, 2);
  expect(admin?.body).toContain('Computer: the node ');
  expect(admin?.body).toContain(', through Main ');
  expect(admin?.body).toContain('Placeholder: the node’s screen lags.');
  const files = admin?.attachments ?? [];
  expect(files.map((f) => f.type)).toEqual(['text/plain']);
  const nodeFile = Buffer.from(files[0]?.base64 ?? '', 'base64').toString('utf8');
  expect(nodeFile).toContain('== Drashti diagnostics (node) ==');
  // Who and what (alpha.21, logs (b)): the node, its install and the Main it follows.
  expect(nodeFile).toMatch(/^Made in: the node$/mu);
  expect(nodeFile).toMatch(/^Install id: [0-9A-HJKMNP-TV-Z]{4}-/mu);
  expect(nodeFile).toMatch(/^Access-list entry: none: a node, following Main “/mu);
  expect(nodeFile).toMatch(/^Log: Today, /mu);
  expect(note?.to).toBe(PLACEHOLDER_PERSON);
  await node.app.close();
  await main.app.close();
});
