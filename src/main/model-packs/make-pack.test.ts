import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeManifest, type PackPlan } from '../../../scripts/make-model-pack.mjs';
import { PACK_MANIFEST } from '../../shared/model-packs';
import { checkManifest } from './manifest';
import { ModelPackStore } from './store';

/*
 * scripts/make-model-pack.mjs (alpha.22, cap-pack): whoever puts a pack together writes its list from a plan and the
 * files themselves, each file's bytes and SHA-256 its own; Drashti then imports what it made. Placeholder files only.
 */

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folderWith(files: Record<string, string>): string {
  const top = mkdtempSync(join(tmpdir(), 'drashti-make-pack-'));
  made.push(top);
  for (const [name, data] of Object.entries(files)) {
    mkdirSync(dirname(join(top, name)), { recursive: true });
    writeFileSync(join(top, name), data);
  }
  return top;
}

const PLAN: PackPlan = {
  id: 'placeholder-pack',
  name: 'Placeholder models',
  release: '2026.11.1',
  licences: { 'licences/MIT.txt': 'MIT' },
  models: [
    {
      id: 'gu-placeholder',
      format: 'whisper-ggml',
      purpose: ['captions-gu'],
      licence: 'MIT',
      licenceFile: 'licences/MIT.txt',
      folder: 'captions/gu',
    },
    {
      id: 'en-indic-placeholder',
      format: 'ctranslate2',
      purpose: ['translation-en-gu', 'translation-en-hi'],
      licence: 'MIT',
      licenceFile: 'licences/MIT.txt',
      folder: 'translation/en-indic',
    },
  ],
};

describe('making a pack’s list (alpha.22, cap-pack)', () => {
  it('lists each file with its own bytes and SHA-256, as Drashti checks and imports it', async () => {
    const top = folderWith({
      'licences/MIT.txt': 'Placeholder licence text.',
      'captions/gu/model.bin': 'placeholder gu model bytes',
      'translation/en-indic/model.bin': 'placeholder en-indic bytes',
      'translation/en-indic/vocab/shared.txt': 'placeholder vocabulary',
      'notes.txt': 'not in the plan, so not in the pack',
    });
    const manifest = await makeManifest(top, PLAN);
    const checked = checkManifest(manifest);
    if (!checked.ok) throw new Error(checked.message);
    expect(checked.pack.models.map((m) => [m.id, m.folder, m.files.map((f) => f.name)])).toEqual([
      ['gu-placeholder', 'captions/gu', ['captions/gu/model.bin']],
      [
        'en-indic-placeholder',
        'translation/en-indic',
        ['translation/en-indic/model.bin', 'translation/en-indic/vocab/shared.txt'],
      ],
    ]);
    expect(checked.pack.manifest.files[1]).toMatchObject({
      name: 'captions/gu/model.bin',
      bytes: 26,
      sha256: createHash('sha256').update('placeholder gu model bytes').digest('hex'),
    });

    writeFileSync(join(top, PACK_MANIFEST), JSON.stringify(manifest));
    const data = mkdtempSync(join(tmpdir(), 'drashti-make-pack-data-'));
    made.push(data);
    const store = new ModelPackStore({
      root: join(data, 'model-packs'),
      log: { info: vi.fn(), warn: vi.fn() },
    });
    store.start();
    const r = await store.importPack(top, 'folder');
    expect(r).toMatchObject({
      ok: true,
      pack: { id: 'placeholder-pack', models: [{ id: 'gu-placeholder' }, {}] },
    });
    expect(store.forPurpose('translation-en-hi').map((m) => m.id)).toEqual(['en-indic-placeholder']);
  });

  it('refuses a link in a model’s folder, and a model folder with nothing in it', async () => {
    const top = folderWith({
      'licences/MIT.txt': 'Placeholder licence text.',
      'translation/en-indic/model.bin': 'x',
    });
    mkdirSync(join(top, 'captions', 'gu'), { recursive: true });
    await expect(makeManifest(top, PLAN)).rejects.toThrow(
      "The model gu-placeholder's folder captions/gu holds no file.",
    );
    // A junction on Windows (no special rights needed), a link elsewhere.
    const elsewhere = folderWith({ 'model.bin': 'placeholder' });
    symlinkSync(elsewhere, join(top, 'captions', 'gu', 'more'), 'junction');
    await expect(makeManifest(top, PLAN)).rejects.toThrow('is a link: put the file itself in the pack.');
  });
});
