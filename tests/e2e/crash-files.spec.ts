import { expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';

/*
 * Crash files and the crash journal (Sessions 31–36, ROB-6). A crash leaves a dump on the computer, never
 * sent anywhere. Save Diagnostics names it with its size, and adds the file itself only when Include crash
 * files is ticked (a dump can hold words from slides). The journal says at the next start what went wrong.
 */

/** The dumps under a folder, wherever Crashpad put them (pending/ on a Mac, reports/ on Windows). */
function dumpsIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.toLowerCase().endsWith('.dmp'));
}

/** How a crashed window's process ended, as the watchdog's line says it: Windows' code in hex, a Mac's as a number or its signal. */
const EXIT =
  process.platform === 'win32'
    ? /Watchdog: audio player crashed \(\w+, exit code 0x[0-9A-F]{8}\)/u
    : /Watchdog: audio player crashed \(\w+, (?:exit code \d+|signal \d+: SIG[A-Z]+)\)/u;

/** Answer Save Diagnostics' question: Save, with Include crash files ticked or not. */
async function answerCrashFiles(app: Awaited<ReturnType<typeof launchApp>>['app'], ticked: boolean) {
  await app.evaluate(({ dialog }, checkboxChecked) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked });
  }, ticked);
}

test('a crash leaves a dump here; Diagnostics adds it only when ticked; the next start says what went wrong', async () => {
  test.setTimeout(120_000);
  const dumps = mkdtempSync(join(tmpdir(), 'drashti-dumps-'));
  const { app, userData } = await launchApp({ DRASHTI_TEST_CRASH_DUMPS: dumps });
  const win = await operatorPage(app);
  await operatorReady(win);
  const desktop = mkdtempSync(join(tmpdir(), 'drashti-desktop-'));
  await app.evaluate(({ app: electronApp }, dir) => {
    electronApp.setPath('desktop', dir);
  }, desktop);
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);

  // The audio player crashes: the watchdog brings it back, and the crash leaves a dump.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('audio.html'))
      ?.webContents.forcefullyCrashRenderer();
  });
  await expect.poll(() => dumpsIn(dumps).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const dump = basename(dumpsIn(dumps)[0] ?? '');
  // And in the journal: the dump can be on disk a moment before Main hears of the crash (CI's Windows: 16 ms).
  const journaled = () => {
    try {
      return readFileSync(join(userData, 'crash-journal.json'), 'utf8').includes('the audio player crashed');
    } catch {
      return false;
    }
  };
  await expect.poll(journaled, { timeout: 30_000 }).toBe(true);
  // The log says how its process ended (Session 39): in hex on Windows, a number or a signal on a Mac.
  const crashLine = () =>
    readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8')
      .split('\n')
      .find((line) => line.includes('Watchdog: audio player crashed')) ?? '';
  await expect.poll(crashLine).toMatch(EXIT);
  expect(readFileSync(join(userData, 'crash-journal.json'), 'utf8')).toMatch(
    /the audio player crashed \(\w+, (?:exit code \w+|signal \d+: SIG[A-Z]+)\); the watchdog brought it back/u,
  );

  // As the box opens, unticked: the file alone, naming the dump and its size, the dump not with it.
  await answerCrashFiles(app, false);
  await chooseMenuItem(app, 'save-diagnostics');
  await expect(win.getByRole('alert').filter({ hasText: 'Diagnostics saved on the Desktop:' })).toBeVisible();
  const [file] = readdirSync(desktop);
  expect(file).toMatch(/^Drashti diagnostics \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.txt$/u);
  const text = readFileSync(join(desktop, file ?? ''), 'utf8');
  expect(text).toContain('== Crash journal (the last 20, kept over restarts) ==');
  expect(text).toMatch(
    /the audio player crashed \(\w+, (?:exit code \w+|signal \d+: SIG[A-Z]+)\); the watchdog brought it back/u,
  );
  expect(text).toContain(`${dump}: `);
  expect(text).toContain('Not included: they can hold words from slides.');
  expect(dumpsIn(desktop)).toEqual([]);

  // Ticked: a folder holding the file and the dump.
  await answerCrashFiles(app, true);
  await chooseMenuItem(app, 'save-diagnostics');
  await expect(
    win.getByRole('alert').filter({ hasText: /Diagnostics saved on the Desktop, with \d+ crash files?:/u }),
  ).toBeVisible();
  const folder = readdirSync(desktop).find((f) => statSync(join(desktop, f)).isDirectory());
  expect(folder).toMatch(/^Drashti diagnostics \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/u);
  expect(dumpsIn(join(desktop, folder ?? ''))).toContain(dump);
  expect(readFileSync(join(desktop, folder ?? '', `${folder ?? ''}.txt`), 'utf8')).toContain(
    'Included: in the folder with this file.',
  );
  await app.close();

  // The next start says what went wrong while Drashti last ran.
  const again = await relaunchApp(userData, { DRASHTI_TEST_CRASH_DUMPS: dumps });
  const next = await operatorPage(again.app);
  await expect(next.getByRole('alert').filter({ hasText: 'While Drashti last ran' })).toContainText(
    /the audio player crashed \(\w+, (?:exit code \w+|signal \d+: SIG[A-Z]+)\); the watchdog brought it back\. Help, then Save Diagnostics…, keeps the details for the admin\./u,
  );
  await again.app.close();
});
