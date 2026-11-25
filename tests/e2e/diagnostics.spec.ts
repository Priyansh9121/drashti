import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Playlist, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { dayOf } from '../../src/shared/log-period';
import { PLACEHOLDER_PERSON } from './access';
import {
  chooseMenuItem,
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { logLines, logText } from './log-lines';

/*
 * Help > Save diagnostics writes one file an operator can send: versions,
 * the setup, counts and the log, and no library content at all. Since alpha.21 (logs for 100+ installs, the owner's
 * "Yes, that plan"): it names who and what made it (its computer, its access-list entry and role, this install, the
 * version and the system), and holds the log of a chosen period (Help › Save Diagnostics: Today…, Yesterday…, The
 * Last 7 Days…, One Day); the log keeps one file a day and a line for every show command, request and notice.
 */

/** How many times Main's log says Diagnostics were saved (each said once the file is written whole). */
const savedLines = (userData: string) =>
  logLines(userData).filter((l) => l.includes('[info] Diagnostics saved to the Desktop')).length;

/** Save Diagnostics of the period whose menu item this is: the file it wrote on the Desktop, read, then removed. */
async function saveOf(
  app: ElectronApplication,
  win: Page,
  { desktop, userData }: { desktop: string; userData: string },
  item: string,
): Promise<string> {
  const before = savedLines(userData);
  await chooseMenuItem(app, item);
  await expect.poll(() => savedLines(userData)).toBe(before + 1);
  await expect(win.getByRole('alert').filter({ hasText: 'Diagnostics saved on the Desktop' })).toBeVisible();
  const [file] = readdirSync(desktop);
  const text = readFileSync(join(desktop, file ?? ''), 'utf8');
  rmSync(join(desktop, file ?? ''));
  return text;
}

/** The ids of the menu's items under Help › Save Diagnostics (One Day's too). */
async function periodItems(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ Menu }) => {
    const out: string[] = [];
    const walk = (items: Electron.MenuItem[]) => {
      for (const i of items) {
        // An item made by its role (the app menu, Edit, Window) has no id.
        const id = i.id as string | undefined;
        if (id?.startsWith('save-diagnostics')) out.push(id);
        if (i.submenu) walk(i.submenu.items);
      }
    };
    walk(Menu.getApplicationMenu()?.items ?? []);
    return out;
  });
}

test('the diagnostics file holds the setup and the log, and no library text', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const desktop = mkdtempSync(join(tmpdir(), 'drashti-desktop-'));
  await app.evaluate(({ app: electronApp }, dir) => {
    electronApp.setPath('desktop', dir);
  }, desktop);

  // Library content that must not appear: names, slide words, where the files came from.
  const source = mkdtempSync(join(tmpdir(), 'drashti-diagnostics-source-'));
  const secretName = 'Placeholder Confidential Hymn';
  const secretWords = 'Placeholder unique slide words 7731';
  const song = join(source, `${secretName}.pro6`);
  writeFileSync(
    song,
    pp6Presentation({
      uuid: 'E2E-DIAG',
      groups: [
        {
          name: 'Placeholder Private Group',
          slides: [{ text: [{ rtf: cocoaRtf([[secretWords, 72, [255, 255, 255]]]) }] }],
        },
      ],
    }),
  );
  const list = join(source, 'Default.pro6pl');
  writeFileSync(
    list,
    pp6Playlist([{ name: 'Placeholder Private Playlist', entries: [{ document: song, name: secretName }] }]),
  );
  const broken = join(source, 'Placeholder Broken File.pro6');
  writeFileSync(broken, 'not a presentation');
  await importAndGetIds(win, [song, list, broken]);

  await operatorReady(win);
  await chooseMenuItem(app, 'save-diagnostics');
  await expect(win.getByRole('alert').filter({ hasText: 'Diagnostics saved on the Desktop' })).toBeVisible();
  const [file] = readdirSync(desktop);
  expect(file).toMatch(/^Drashti diagnostics \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.txt$/u);
  const text = readFileSync(join(desktop, file ?? ''), 'utf8');

  // What it holds.
  expect(text).toContain('== Drashti diagnostics ==');
  expect(text).toContain('Electron');
  // Who and what made it (alpha.21, logs (b)): the computer, its entry on the access list and its role, this install,
  // where it was made and the log's period; never the Gmail let in.
  expect(text).toMatch(/^Computer: \S/mu);
  expect(text).toMatch(/^Computer id: [0-9a-f]{12}… /mu);
  expect(text).toMatch(/^Install id: [0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/mu);
  expect(text).toMatch(/^Access-list entry: grant [0-9a-f]{8}… /mu);
  expect(text).toMatch(/^Role: Pro$/mu);
  expect(text).toMatch(/^Made in: Pro Mode$/mu);
  expect(text).toMatch(/^Log: Today, \d{4}-\d{2}-\d{2}$/mu);
  expect(text).not.toContain(PLACEHOLDER_PERSON);
  expect(text).toContain('== Displays ==');
  // The graphics as Chromium reports them here (Session 60, the owner's Q60-37): how each feature draws, then each GPU
  // with its driver, or why its details could not be read.
  expect(text).toContain('== Graphics ==');
  expect(text).toMatch(/^gpu_compositing: \S+$/mu);
  expect(text).toMatch(/^(GPU 1( \(in use\))?: vendor |GPU details: could not be read \()/mu);
  expect(text).toContain('== Sound ==');
  expect(text).toMatch(/Presentations: \d+/u);
  expect(text).toContain('== Recent imports (counts and issue codes only) ==');
  expect(text).toContain('== Log ==');
  // What it never holds.
  for (const secret of [
    secretName,
    secretWords,
    'Placeholder Private Group',
    'Placeholder Private Playlist',
    'Placeholder Broken File',
    source,
    homedir(),
  ])
    expect(text, secret).not.toContain(secret);
  await app.close();
});

test('Save Diagnostics of a chosen period: Today, The Last 7 Days and One Day each hold their days’ log (alpha.21, logs (c))', async () => {
  // Two earlier days' files, as the log keeps them, made before Drashti starts (3 and 5 days ago: never today or
  // yesterday, even should midnight pass while the test runs).
  const userData = mkdtempSync(join(tmpdir(), 'drashti-e2e-'));
  mkdirSync(join(userData, 'logs'));
  const daysAgo = (n: number) => {
    const d = new Date();
    return dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12).getTime());
  };
  const [three, five] = [daysAgo(3), daysAgo(5)];
  for (const [day, words] of [
    [three, 'placeholder line of three days ago'],
    [five, 'placeholder line of five days ago'],
  ] as const)
    writeFileSync(
      join(userData, 'logs', `drashti-${day}.log`),
      `${new Date().toISOString()} [info] Drashti’s log of ${day} (this computer’s day; each line’s time is UTC): placeholder\n${new Date().toISOString()} [warn] ${words}\n`,
    );
  const { app } = await launchApp({}, userData);
  const win = await operatorPage(app);
  await operatorReady(win);
  const desktop = mkdtempSync(join(tmpdir(), 'drashti-desktop-'));
  await app.evaluate(({ app: electronApp }, dir) => {
    electronApp.setPath('desktop', dir);
  }, desktop);
  // The menu offers each period, the earlier days kept among them.
  const items = await periodItems(app);
  for (const id of [
    'save-diagnostics',
    'save-diagnostics-yesterday',
    'save-diagnostics-last-7-days',
    'save-diagnostics-day',
    `save-diagnostics-${three}`,
    `save-diagnostics-${five}`,
  ])
    expect(items, id).toContain(id);

  const where = { desktop, userData };
  const oneDay = await saveOf(app, win, where, `save-diagnostics-${three}`);
  expect(oneDay).toContain(`Log: One day, ${three}`);
  expect(oneDay).toContain('placeholder line of three days ago');
  expect(oneDay).not.toContain('placeholder line of five days ago');
  const week = await saveOf(app, win, where, 'save-diagnostics-last-7-days');
  expect(week).toMatch(/^Log: The last 7 days, \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/mu);
  expect(week).toContain('placeholder line of three days ago');
  expect(week).toContain('placeholder line of five days ago');
  // Today's: this run's own log, and none of the earlier days'.
  const today = await saveOf(app, win, where, 'save-diagnostics');
  expect(today).toMatch(/^Log: Today, /mu);
  expect(today).toContain('Drashti’s log of ');
  expect(today).not.toContain('placeholder line of three days ago');
  await app.close();
});

test('the log has a line for every show command, operator request and notice, with ids and never words, under a header naming who writes it (alpha.21, logs (a))', async () => {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const source = mkdtempSync(join(tmpdir(), 'drashti-log-lines-'));
  // A library name also present, unquoted, in the real diagnostics-saved notice.
  const secretName = 'Drashti diagnostics';
  const secretWords = 'Placeholder log secret words 5521';
  const song = join(source, `${secretName}.pro6`);
  writeFileSync(
    song,
    pp6Presentation({
      uuid: 'E2E-LOG-LINES',
      groups: [
        {
          name: 'Placeholder',
          slides: [{ text: [{ rtf: cocoaRtf([[secretWords, 72, [255, 255, 255]]]) }] }],
        },
      ],
    }),
  );
  const [id] = await importAndGetIds(win, [song]);
  await win.evaluate(async (presentationId) => {
    const d = (globalThis as PageGlobals).drashti;
    await d.engine.dispatch({ type: 'goLive', presentationId, slideIndex: 0 });
    await d.engine.dispatch({ type: 'toggleBlackout' });
    await d.engine.dispatch({ type: 'toggleBlackout' });
  }, id ?? '');
  const log = () => logText(userData);
  await expect
    .poll(log)
    .toMatch(
      new RegExp(
        `^\\S+ \\[info\\] Show: goLive presentationId=${(id ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} slideIndex=0: done \\(revision \\d+\\)$`,
        'mu',
      ),
    );
  await expect.poll(log).toMatch(/^\S+ \[info\] Show: toggleBlackout: done \(revision \d+\)$/mu);
  await expect.poll(log).toMatch(/^\S+ \[info\] Request: library:import-paths: done$/mu);
  // The real notice includes the library name without quotes: the raw local log must blank it too.
  const desktop = mkdtempSync(join(tmpdir(), 'drashti-desktop-'));
  await app.evaluate(({ app: electronApp }, dir) => {
    electronApp.setPath('desktop', dir);
  }, desktop);
  await chooseMenuItem(app, 'save-diagnostics');
  await expect
    .poll(log)
    .toMatch(/^\S+ \[info\] Notice: Diagnostics saved on the Desktop: \[library name\] .+\.txt$/mu);
  const text = log();
  // The log's first line (its oldest file's): its day, and who writes it.
  expect(text.split('\n')[0]).toMatch(
    /^\S+ \[info\] Drashti’s log of \d{4}-\d{2}-\d{2} \(this computer’s day; each line’s time is UTC\): Drashti \S+ on \S+ .*, install [0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/u,
  );
  // Reads are never logged; nor any word from the library, nor the Gmail let in.
  expect(text).not.toMatch(/Request: library:list-presentations/u);
  for (const secret of [secretName, secretWords, PLACEHOLDER_PERSON])
    expect(text, secret).not.toContain(secret);
  await app.close();
});
