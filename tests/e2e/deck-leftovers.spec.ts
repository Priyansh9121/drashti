import { type ElectronApplication, expect, test } from '@playwright/test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, operatorPage, operatorReady } from './helpers';

/*
 * PowerPoint's own folder at Drashti's start (Session 56). macOS asks the operator whether Drashti may read another
 * app's folder ("Keeping app data separate makes it easier to manage your privacy and security") each time it does,
 * and Drashti read PowerPoint's at every start, for the copies an import cut short might have left there. A start
 * now touches it only when Drashti's own record (office-copies.json, in its data folder) names copies, and then only
 * those, by name. PowerPoint's folder is a test folder here (DRASHTI_TEST_OFFICE_FOLDER, which a packaged Drashti
 * ignores) and what the start does in it is counted (globalThis.drashtiTestOfficeFolder); on a Mac the folder's
 * last-read time shows whether anything listed it.
 */

interface OfficeSeen {
  touched: number;
  done: boolean;
}
const officeSeen = (app: ElectronApplication) =>
  app.evaluate(
    () => (globalThis as { drashtiTestOfficeFolder?: () => OfficeSeen }).drashtiTestOfficeFolder?.() ?? null,
  );

/** PowerPoint's folder for one test, with a copy's folder that is not Drashti's (another computer's, say). */
function officeFolder(): string {
  const office = join(mkdtempSync(join(tmpdir(), 'drashti-e2e-office-')), 'Drashti');
  mkdirSync(join(office, 'convert-NotOurs'), { recursive: true });
  writeFileSync(join(office, 'convert-NotOurs', 'Placeholder (Drashti copy 4321).pptx'), 'placeholder');
  return office;
}

/** Last read two days ago (and changed since): a listing of it shows as a new time on a Mac. */
function lastReadLongAgo(folder: string): number {
  utimesSync(folder, new Date(Date.now() - 2 * 86_400_000), new Date());
  return statSync(folder).atimeMs;
}

test('a start after a quit leaves PowerPoint’s folder alone', async () => {
  const office = officeFolder();
  const before = lastReadLongAgo(office);
  const { app, userData } = await launchApp({ DRASHTI_TEST_OFFICE_FOLDER: office });
  await operatorReady(await operatorPage(app));
  await expect.poll(() => officeSeen(app)).toEqual({ touched: 0, done: true });
  await app.close();
  // Looked at before the test lists it itself.
  if (process.platform === 'darwin') expect(statSync(office).atimeMs).toBe(before);
  expect(readdirSync(office)).toEqual(['convert-NotOurs']);
  expect(existsSync(join(userData, 'office-copies.json'))).toBe(false);
});

test('a start after a PowerPoint import cut short clears the copies its record names, once, and forgets them', async () => {
  const office = officeFolder();
  const left = join(office, 'convert-Left12');
  mkdirSync(left);
  writeFileSync(join(left, 'Placeholder deck (Drashti copy 1234).pptx'), 'placeholder');
  const userData = mkdtempSync(join(tmpdir(), 'drashti-e2e-'));
  const record = join(userData, 'office-copies.json');
  writeFileSync(record, JSON.stringify({ version: 1, copies: [left] }));
  const before = lastReadLongAgo(office);

  const first = await launchApp({ DRASHTI_TEST_OFFICE_FOLDER: office }, userData);
  await operatorReady(await operatorPage(first.app));
  await expect.poll(() => officeSeen(first.app)).toEqual({ touched: 1, done: true });
  expect(existsSync(left)).toBe(false);
  expect(existsSync(record)).toBe(false);
  await first.app.close();
  // Removed by its name: the folder was never listed, and what is not Drashti's is there still.
  if (process.platform === 'darwin') expect(statSync(office).atimeMs).toBe(before);
  expect(readdirSync(office)).toEqual(['convert-NotOurs']);

  // Forgotten: the next start leaves the folder alone.
  const beforeAgain = lastReadLongAgo(office);
  const again = await launchApp({ DRASHTI_TEST_OFFICE_FOLDER: office }, userData);
  await operatorReady(await operatorPage(again.app));
  await expect.poll(() => officeSeen(again.app)).toEqual({ touched: 0, done: true });
  await again.app.close();
  if (process.platform === 'darwin') expect(statSync(office).atimeMs).toBe(beforeAgain);
  expect(readdirSync(office)).toEqual(['convert-NotOurs']);
});
