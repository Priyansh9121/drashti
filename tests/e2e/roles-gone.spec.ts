import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { NETWORK_ENV, networkOn } from './devices';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, killApp, launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';

/*
 * Roles and PINs gone at the update (Session 54, E5: "remove admin/operator logic completely"). A data folder
 * that 1.0.0-alpha.12 left with roles on (its roles.json made here, holding placeholder hashes, never a real
 * PIN's) opens straight into Drashti with no PIN asked, in the mode it would (Pro Mode after a clean quit,
 * Simple Mode after a stop in it), Simple Mode's way out taking the word alone; roles.json, and what went with
 * it, are gone from the data folder at that first start and never read; a backup holds none, and a restore
 * brings none back. Everything an admin did is anyone's in Pro Mode: no prompt, no refusal; Simple Mode's own
 * refusals as before.
 */

/** A placeholder in the form roles.json kept a PIN's hash in: made-up bytes, never a real PIN's hash. */
const placeholderHash = (word: string) => ({
  kdf: 'scrypt',
  N: 32768,
  r: 8,
  p: 1,
  salt: Buffer.from(`placeholder salt ${word}`).toString('base64'),
  hash: Buffer.from(`placeholder hash ${word} for a test`).toString('base64'),
});

/** roles.json as alpha.12 wrote it with roles on (two PINs set), placeholder hashes only. */
const ALPHA12_ROLES = `${JSON.stringify(
  {
    version: 1,
    admin: placeholderHash('admin'),
    operator: placeholderHash('operator'),
    wrong: 1,
    waitUntil: null,
  },
  null,
  2,
)}\n`;

/** roles' files in a data folder. */
const rolesFilesIn = (dir: string) =>
  readdirSync(dir).filter((f) =>
    /^roles(?:\.json|-held\.json|\.json\.writing|\.unreadable-.+\.json)$/u.test(f),
  );

const modeOf = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode());

/** Nothing asks for a PIN, and nothing says who is at the controls. */
async function noRoles(win: Page): Promise<void> {
  for (const id of ['role-chip', 'admin-pin', 'roles-dialog', 'leave-simple-pin'])
    await expect(win.getByTestId(id), id).toHaveCount(0);
}

/** Drashti's own log, once it says `words`. */
async function logSays(userData: string, words: string): Promise<string> {
  const file = join(userData, 'logs', 'drashti.log');
  await expect.poll(() => (existsSync(file) ? readFileSync(file, 'utf8') : '')).toContain(words);
  return readFileSync(file, 'utf8');
}

/** The run named in one of the restart-recovery files, or null (as simple-mode.spec reads it). */
function sessionIn(userData: string, file: string): string | null {
  try {
    return (JSON.parse(readFileSync(join(userData, file), 'utf8')) as { session?: string }).session ?? null;
  } catch {
    return null;
  }
}

/** Leave Simple Mode by its own Switch to Pro Mode…: an old PIN is a wrong word; the word pro leaves. */
async function leaveWithTheWord(win: Page): Promise<void> {
  const dialog = win.getByTestId('leave-simple');
  await win.getByTestId('simple-leave').click();
  await expect(dialog).toContainText('Type pro to switch');
  await dialog.getByRole('textbox').fill('481526');
  await dialog.getByRole('button', { name: 'Switch to Pro Mode' }).click();
  await expect(dialog).toContainText('Type pro to switch to Pro Mode.');
  expect(await modeOf(win)).toBe('simple');
  await dialog.getByRole('textbox').fill('pro');
  await dialog.getByRole('button', { name: 'Switch to Pro Mode' }).click();
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  expect(await modeOf(win)).toBe('pro');
}

test('an alpha.12 data folder with roles on opens straight into Pro Mode with no PIN asked; its roles.json is gone, never read; Simple Mode’s button with no PIN', async () => {
  test.setTimeout(120_000);
  const first = await launchApp();
  const userData = first.userData;
  await operatorReady(await operatorPage(first.app));
  await first.app.close();
  // As alpha.12 left it with roles on, after a quit on purpose.
  writeFileSync(join(userData, 'roles.json'), ALPHA12_ROLES);

  const run = await relaunchApp(userData);
  const win = await operatorPage(run.app);
  await operatorReady(win);
  expect(await modeOf(win)).toBe('pro');
  await expect(win.getByTestId('leave-simple')).toHaveCount(0);
  await noRoles(win);
  // Removed at this first start, before anything read it; the log names the file, never what it held.
  expect(rolesFilesIn(userData)).toEqual([]);
  const log = await logSays(userData, 'removed roles.json from the data folder');
  for (const kept of [placeholderHash('admin'), placeholderHash('operator')])
    for (const part of [kept.salt, kept.hash]) expect(log).not.toContain(part);
  // What only the admin PIN opened goes through at once.
  const made = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.screens.createGroup('Placeholder Hall'),
  );
  expect(made.ok).toBe(true);
  await chooseMenuItem(run.app, 'set-up-screens');
  await expect(win.getByTestId('setup-wizard')).toBeVisible();
  await noRoles(win);
  await win.getByRole('button', { name: 'Close the setup' }).click();
  await expect(win.getByTestId('setup-wizard')).toHaveCount(0);

  // Simple Mode's button, with no PIN, both ways.
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await noRoles(win);
  await leaveWithTheWord(win);
  await run.app.close();
  // Nothing writes one again, as it runs or as it quits.
  expect(rolesFilesIn(userData)).toEqual([]);
});

test('roles alpha.12 held locked (its PIN file unreadable) hold nothing: Pro Mode, no word of a PIN file, and every file of theirs gone', async () => {
  test.setTimeout(120_000);
  const first = await launchApp();
  const userData = first.userData;
  await operatorReady(await operatorPage(first.app));
  await first.app.close();
  // As alpha.12 left a PIN file it could not read: damaged, a copy set aside, and the hold beside it.
  writeFileSync(join(userData, 'roles.json'), '{ not json');
  writeFileSync(join(userData, 'roles.unreadable-2026-10-10 05-36.json'), '{ not json');
  writeFileSync(
    join(userData, 'roles-held.json'),
    `${JSON.stringify({ reason: 'not readable as JSON (cut short or damaged)', copy: 'roles.unreadable-2026-10-10 05-36.json' })}\n`,
  );

  const run = await relaunchApp(userData);
  const win = await operatorPage(run.app);
  await operatorReady(win);
  // alpha.12 started these in Simple Mode, admin refused; now it is a clean start like any other.
  expect(await modeOf(win)).toBe('pro');
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  await expect(win.getByRole('alert').filter({ hasText: 'PIN file' })).toHaveCount(0);
  await noRoles(win);
  expect(rolesFilesIn(userData)).toEqual([]);
  await logSays(userData, 'roles-held.json');
  await run.app.close();
});

test('stopped dead in Simple Mode with roles on, it comes back in Simple Mode, left by the word alone; roles.json gone', async () => {
  test.setTimeout(120_000);
  const first = await launchApp();
  const userData = first.userData;
  const win1 = await operatorPage(first.app);
  await operatorReady(win1);
  await win1.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
  await expect(win1.getByTestId('simple-mode')).toBeVisible();
  // This run has saved the show under its own name (Session 20): a stop dead now counts as this run's.
  await expect.poll(() => sessionIn(userData, 'live-state.json')).not.toBeNull();
  await expect
    .poll(() => sessionIn(userData, 'live-state.json') !== sessionIn(userData, 'live-state.clean'))
    .toBe(true);
  await killApp(first.app);
  writeFileSync(join(userData, 'roles.json'), ALPHA12_ROLES);

  const run = await relaunchApp(userData);
  const win = await operatorPage(run.app);
  await operatorReady(win);
  // The volunteer carries on where they were, and nothing asks for a PIN to leave.
  expect(await modeOf(win)).toBe('simple');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await noRoles(win);
  expect(rolesFilesIn(userData)).toEqual([]);
  await leaveWithTheWord(win);
  await run.app.close();
});

/** Just quit after Restore Library… or Use as a Node…: the test starts Drashti again itself (as backup.spec). */
const NO_RELAUNCH = { DRASHTI_TEST_NO_RELAUNCH: '1' };

/**
 * Answer the next folder dialog with `folder`, and its question with the first button (Back Up, or Restore and
 * Restart), the media ticked, as backup.spec does.
 */
async function answerDialogs(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [f] });
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: true });
    dialog.showMessageBoxSync = () => 0;
  }, folder);
}

test('a backup holds no roles.json, and a restore brings none back (Session 54, E5)', async () => {
  test.setTimeout(180_000);
  const first = await launchApp(NO_RELAUNCH);
  const userData = first.userData;
  const win = await operatorPage(first.app);
  await operatorReady(win);
  // One beside the library while it runs (never read): a backup still takes the library and its media only.
  writeFileSync(join(userData, 'roles.json'), ALPHA12_ROLES);
  const backups = mkdtempSync(join(tmpdir(), 'drashti-roles-gone-backups-'));
  await answerDialogs(first.app, backups);
  await chooseMenuItem(first.app, 'backup-library');
  await expect(win.getByRole('alert').filter({ hasText: 'Library backed up to' })).toBeVisible({
    timeout: 30_000,
  });
  await noRoles(win);
  const [backup = ''] = readdirSync(backups);
  const held = readdirSync(join(backups, backup));
  expect(held).toEqual(expect.arrayContaining(['backup.json', 'drashti.sqlite']));
  expect(rolesFilesIn(join(backups, backup))).toEqual([]);
  expect(
    held.every((f) => ['Media', 'backup.json', 'drashti.sqlite'].includes(f)),
    held.join(', '),
  ).toBe(true);

  // A backup with one put beside it by hand: the restore takes the library and its media only.
  writeFileSync(join(backups, backup, 'roles.json'), ALPHA12_ROLES);
  await answerDialogs(first.app, join(backups, backup));
  const closed = first.app.waitForEvent('close', { timeout: 30_000 });
  await chooseMenuItem(first.app, 'restore-library');
  await closed;

  // The start removes the old one first, and the restore after it brings none: none is there once it is up.
  const second = await relaunchApp(userData, NO_RELAUNCH);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  await expect(
    win2.getByRole('alert').filter({ hasText: `Library restored from “${backup}”` }),
  ).toBeVisible();
  expect(await modeOf(win2)).toBe('pro');
  await noRoles(win2);
  expect(rolesFilesIn(userData)).toEqual([]);
  for (const kept of readdirSync(join(userData, 'Backups')))
    expect(rolesFilesIn(join(userData, 'Backups', kept)), kept).toEqual([]);
  await second.app.close();
});

test('everything an admin did is anyone’s in Pro Mode: no prompt, no refusal; Simple Mode’s own refusals as before', async () => {
  test.setTimeout(180_000);
  // Never restarted as a node, whatever Use This Computer as a Node… is answered.
  const { app } = await launchApp({ ...NETWORK_ENV, ...NO_RELAUNCH });
  const win = await operatorPage(app);
  await operatorReady(win);

  // The requests only the admin PIN opened with roles on, straight from the bridge: each goes through.
  const answers = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    // A theme as the default one is, under a name of its own (as library.spec makes one).
    const { themes, defaultId } = await d.themes.list();
    const base = themes.find((t) => t.id === defaultId) ?? themes[0];
    if (!base) throw new Error('no theme to start from');
    const { id: _id, ...fields } = base;
    return {
      'a screen group': await d.screens.createGroup('Placeholder Group'),
      'a Look': await d.looks.create('Placeholder Look', null),
      'a theme': await d.themes.save(null, { ...fields, name: 'Placeholder theme' }),
      'the MIDI controller': await d.midi.set({ deviceName: null, mappings: [] }),
      'the logo': await d.props.setLogo(null),
      'the single-letter keys off': await d.app.setSingleKeys(false),
      'the single-letter keys on': await d.app.setSingleKeys(true),
      'Shastra, Templates and Kirtan Details': await d.library.setExtras(true),
      'the highest video quality': await d.links.setMaxHeight(1440),
      'the daily look for updates': await d.updates.setAutoCheck(false),
      'the transliteration style': await d.kirtans.setTranslitStyle('plain'),
      'the setup, finished': await d.setup.finish({ outputs: null, sound: 'skip', themeId: null }),
    };
  });
  for (const [what, answer] of Object.entries(answers)) {
    expect(answer, what).toMatchObject({ ok: true });
    expect(JSON.stringify(answer), what).not.toMatch(/\badmin\b|\bPIN\b/iu);
  }
  // Looking at events out and the drop folder, which an operator was refused before.
  const looks = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return { events: await d.events.view(), drop: await d.drop.view() };
  });
  expect(looks.events.available).toBe(true);
  expect(JSON.stringify(looks), 'events out and the drop folder').not.toMatch(/\badmin\b|\bPIN\b/iu);
  // Phones on: with roles on, an admin's.
  await networkOn(win);
  await noRoles(win);

  // Every menu item that asked for the admin PIN opens its own at once, the only dialog up.
  for (const [item, opens] of [
    ['set-up-screens', 'setup-wizard'],
    ['import-from-link', 'link-dialog'],
    ['events-out', 'events-dialog'],
    ['drop-folder', 'drop-dialog'],
    ['scheduled-backups', 'backups-dialog'],
    ['keyboard-shortcuts', 'keys-sheet'],
  ] as const) {
    await chooseMenuItem(app, item);
    await expect(win.getByTestId(opens), item).toBeVisible();
    await expect(win.getByRole('dialog'), item).toHaveCount(1);
    await noRoles(win);
    await win.keyboard.press('Escape');
    await expect(win.getByTestId(opens), item).toHaveCount(0);
  }
  // View › Show Shastra, Templates and Kirtan Details turns at once, both ways.
  const extras = () => win.evaluate(() => (globalThis as PageGlobals).drashti.library.extras());
  const before = await extras();
  await chooseMenuItem(app, 'show-extras');
  await expect.poll(extras).toBe(!before);
  await chooseMenuItem(app, 'show-extras');
  await expect.poll(extras).toBe(before);
  // File › Use This Computer as a Node… asks its own question straight away (answered Cancel here).
  await app.evaluate(({ dialog }) => {
    (globalThis as { askedNode?: boolean }).askedNode = false;
    dialog.showMessageBoxSync = () => {
      (globalThis as { askedNode?: boolean }).askedNode = true;
      return 0;
    };
  });
  await chooseMenuItem(app, 'use-as-node');
  await expect
    .poll(() => app.evaluate(() => (globalThis as { askedNode?: boolean }).askedNode === true))
    .toBe(true);
  await noRoles(win);

  // Simple Mode refuses them as it always has: its own refusal, never a PIN.
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const refused = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return {
      group: await d.screens.createGroup('Placeholder Refused'),
      keys: await d.app.setSingleKeys(false),
      quality: await d.links.setMaxHeight(2160),
    };
  });
  for (const [what, answer] of Object.entries(refused))
    expect(answer, what).toMatchObject({ ok: false, message: SIMPLE_MODE_REFUSAL });
  await noRoles(win);
  await app.close();
});
