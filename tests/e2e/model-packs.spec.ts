import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { PACK_FORMAT, PACK_MANIFEST } from '../../src/shared/model-packs';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

/*
 * Help › Caption and Translation Models… (alpha.22, cap-pack): an offline model pack an admin imports from a folder
 * or a zip (the open dialog stands in, choosing a pack the test made), every file checked against the pack's list
 * before it is kept in the data folder's model-packs/, outside the library. What is installed, its size and its
 * licence's own text; a pack with one changed file is refused whole and nothing changes; Remove takes it off. Pro Mode
 * only. Generated placeholder files: no real model, nothing fetched.
 */

const LICENCE = 'Placeholder MIT licence text, for the tests.';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A placeholder pack in a folder of its own: a Gujarati captions model and its licence text. */
function placeholderPack(change = false): string {
  const folder = join(mkdtempSync(join(tmpdir(), 'drashti-e2e-pack-')), 'Placeholder pack');
  const model = Buffer.alloc(256 * 1024, 'placeholder gu ');
  const files = new Map<string, Buffer>([
    ['licences/MIT.txt', Buffer.from(LICENCE)],
    ['captions/gu/model.bin', model],
  ]);
  const manifest = {
    format: PACK_FORMAT,
    version: 1,
    id: 'placeholder-pack',
    name: 'Placeholder models',
    release: '2026.11.1',
    files: [
      {
        name: 'licences/MIT.txt',
        bytes: Buffer.byteLength(LICENCE),
        sha256: sha(Buffer.from(LICENCE)),
        licence: 'MIT',
        purpose: ['licence'],
      },
      {
        name: 'captions/gu/model.bin',
        bytes: model.length,
        sha256: sha(model),
        licence: 'MIT',
        purpose: ['captions-gu'],
        model: 'gu-placeholder',
        format: 'whisper-ggml',
        licenceFile: 'licences/MIT.txt',
        attribution: 'Placeholder Gujarati model, made by the tests',
      },
    ],
  };
  if (change) files.set('captions/gu/model.bin', Buffer.alloc(256 * 1024, 'changed bytes! '));
  files.set(PACK_MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2)));
  for (const [name, data] of files) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    writeFileSync(join(folder, name), data);
  }
  return folder;
}

/** The open dialog chooses `folder`, as the admin would. */
const choose = (app: ElectronApplication, folder: string) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [f] });
  }, folder);

test('imports a pack, every file checked, kept outside the library; shows what is installed and its licence; a changed pack is refused whole; Remove takes it off; Pro Mode only', async () => {
  test.setTimeout(120_000);
  const good = placeholderPack();
  const changed = placeholderPack(true);
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await chooseMenuItem(app, 'model-packs');
    const dialog = win.getByTestId('model-packs-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('model-packs-none')).toHaveText(
      'No pack is installed on this computer. Live captions keep the model chosen in File › Live Captions….',
    );
    // Nothing until a pack is imported: no folder made.
    expect(existsSync(join(userData, 'model-packs'))).toBe(false);

    // Import: checked, kept, shown.
    await choose(app, good);
    await dialog.getByTestId('model-packs-import-folder').click();
    await expect(dialog.getByTestId('model-packs-notice')).toHaveText(
      'Placeholder models is installed on this computer, every file checked.',
    );
    const pack = dialog.getByTestId('model-pack');
    await expect(pack).toHaveCount(1);
    await expect(pack.getByTestId('model-pack-line')).toContainText('Release 2026.11.1, 1 model, 256.0 KB');
    await expect(pack.getByTestId('model-pack-model')).toContainText(
      'Captions in Gujarati (gu-placeholder: 256.0 KB, whisper-ggml, MIT licence)',
    );
    // Who made it and where it is from, as its licence asks.
    await expect(pack.getByTestId('model-pack-credit')).toHaveText(
      'By Placeholder Gujarati model, made by the tests',
    );
    const kept = readdirSync(join(userData, 'model-packs')).filter((n) => n.startsWith('placeholder-pack-'));
    expect(kept).toHaveLength(1);
    expect(existsSync(join(userData, 'model-packs', kept[0] ?? '', 'captions', 'gu', 'model.bin'))).toBe(
      true,
    );

    // The licence's own text, from the copy kept.
    await pack.getByTestId('model-pack-licence').click();
    await expect(pack.getByTestId('model-pack-licence-text')).toHaveText(LICENCE);

    // Readable in CI's operator window and at 1280 × 720, and nothing serious for a screen reader.
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await win.setViewportSize(size);
      await expectFits(dialog, `the models dialog at ${String(size.width)} × ${String(size.height)}`);
    }
    await expectNoSeriousA11yIssues(win, 'Caption and translation models');

    // A pack with one file changed: refused whole, the installed one as it was.
    await choose(app, changed);
    await dialog.getByTestId('model-packs-import-folder').click();
    await expect(dialog.getByTestId('model-packs-notice')).toHaveText(
      'captions/gu/model.bin does not match its SHA-256 in the pack’s list: the pack is damaged or was changed. Nothing was installed: ask for a fresh copy of the pack.',
    );
    await expect(pack).toHaveCount(1);
    expect(readdirSync(join(userData, 'model-packs')).filter((n) => n !== 'installed.json')).toEqual(kept);

    // Remove, asked first.
    await pack.getByTestId('model-pack-remove').click();
    const confirm = win.getByTestId('model-packs-remove-confirm');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(dialog.getByTestId('model-packs-none')).toBeVisible();
    expect(existsSync(join(userData, 'model-packs', kept[0] ?? ''))).toBe(false);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // Simple Mode: no menu item, and the main process refuses.
    await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
    await expect
      .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode()))
      .toBe('simple');
    expect(
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('model-packs') ?? null),
    ).toBeNull();
    const refused = await win.evaluate(() => (globalThis as PageGlobals).drashti.modelPacks.view());
    expect(refused).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  } finally {
    await app.close();
    for (const f of [good, changed]) rmSync(dirname(f), { recursive: true, force: true });
  }
});
