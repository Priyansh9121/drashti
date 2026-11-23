import { createHash } from 'node:crypto';
import type * as NodeFs from 'node:fs';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PACK_FORMAT,
  PACK_MANIFEST,
  type ModelPacksStatus,
  type ModelPurpose,
  type PackFile,
} from '../../shared/model-packs';
import { makeZip, type ZipWriterEntry } from '../import/testing/zip-writer';
import { insideFolder, ModelPackStore } from './store';

/** One read that fails the way a busy or briefly locked disk does (EIO), for the next file read only. */
const readFault = vi.hoisted(() => ({ next: false }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof NodeFs>();
  return {
    ...fs,
    createReadStream: (...args: Parameters<typeof fs.createReadStream>) => {
      if (readFault.next) {
        readFault.next = false;
        throw Object.assign(new Error('i/o error'), { code: 'EIO' });
      }
      return fs.createReadStream(...args);
    },
  };
});

/*
 * The offline model pack on this computer (alpha.22, cap-pack): imported from a folder or a zip an admin chooses,
 * every file checked against the pack's list (bytes and SHA-256) as it is copied; one file wrong refuses the whole
 * pack and nothing is kept. Kept in the data folder's model-packs/ (outside the library and its backups), readable by
 * this computer's user only; removed whole; never while in use; a model checked again before its first use in each
 * run. Generated placeholder files only: no real model.
 */

const GiB = 1024 ** 3;
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), `drashti-model-packs-${name}-`));
  made.push(d);
  return d;
};

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const LICENCE_TEXT = 'Placeholder MIT licence text, for the tests.';

interface PlaceholderModel {
  id: string;
  purpose: ModelPurpose[];
  format: string;
  files: Record<string, Buffer>;
}

const GU: PlaceholderModel = {
  id: 'gu-placeholder',
  purpose: ['captions-gu'],
  format: 'whisper-ggml',
  files: { 'captions/gu/model.bin': Buffer.alloc(64 * 1024, 'placeholder gu ') },
};
const EN_INDIC: PlaceholderModel = {
  id: 'en-indic-placeholder',
  purpose: ['translation-en-gu', 'translation-en-hi'],
  format: 'ctranslate2',
  files: {
    'translation/en-indic/model.bin': Buffer.alloc(100 * 1024, 'placeholder en-indic '),
    'translation/en-indic/config.json': Buffer.from('{"placeholder": true}\n'),
  },
};

interface Pack {
  id?: string;
  name?: string;
  release?: string;
  models?: PlaceholderModel[];
}

/** The pack's files (its list among them) by name. */
function packFiles(p: Pack = {}): Map<string, Buffer> {
  const files = new Map<string, Buffer>([['licences/MIT.txt', Buffer.from(LICENCE_TEXT)]]);
  const listed: PackFile[] = [
    {
      name: 'licences/MIT.txt',
      bytes: Buffer.byteLength(LICENCE_TEXT),
      sha256: sha(Buffer.from(LICENCE_TEXT)),
      licence: 'MIT',
      purpose: ['licence'],
    },
  ];
  for (const m of p.models ?? [GU, EN_INDIC])
    for (const [name, data] of Object.entries(m.files)) {
      files.set(name, data);
      listed.push({
        name,
        bytes: data.length,
        sha256: sha(data),
        licence: 'MIT',
        purpose: m.purpose,
        model: m.id,
        format: m.format,
        licenceFile: 'licences/MIT.txt',
        attribution: `Placeholder model ${m.id}, made by the tests`,
      });
    }
  const manifest = {
    format: PACK_FORMAT,
    version: 1,
    id: p.id ?? 'placeholder-pack',
    name: p.name ?? 'Placeholder models',
    release: p.release ?? '2026.11.1',
    files: listed,
  };
  files.set(PACK_MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2)));
  return files;
}

/** A pack as a folder. */
function packFolder(p: Pack = {}): string {
  const folder = join(temp('source'), 'Placeholder pack');
  for (const [name, data] of packFiles(p)) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    writeFileSync(join(folder, name), data);
  }
  return folder;
}

/** A pack as a zip, its files under `prefix` (Finder's Compress puts them in one folder). */
function packZip(p: Pack = {}, o: { prefix?: string; change?: (e: ZipWriterEntry) => ZipWriterEntry } = {}) {
  const entries = [...packFiles(p)].map(([name, data], i) => {
    const e: ZipWriterEntry = { name: `${o.prefix ?? ''}${name}`, data, deflate: i % 2 === 0 };
    return o.change ? o.change(e) : e;
  });
  const file = join(temp('zip'), 'Placeholder pack.zip');
  writeFileSync(file, makeZip(entries));
  return file;
}

const log = { info: vi.fn(), warn: vi.fn() };

function storeIn(
  data: string,
  freeBytes: (folder: string) => Promise<number | null> = () => Promise.resolve(100 * GiB),
) {
  const store = new ModelPackStore({
    root: join(data, 'model-packs'),
    log,
    freeBytes,
    now: () => 1_790_000_000_000,
  });
  store.start();
  return store;
}

/** What the data folder's model-packs/ holds besides its list (nothing when there is no such folder yet). */
const ours = (root: string) =>
  existsSync(root) ? readdirSync(root).filter((n) => n !== 'installed.json') : [];
const only = <T>(list: T[]): T => {
  expect(list).toHaveLength(1);
  return list[0] as T;
};

describe('importing a model pack (alpha.22, cap-pack)', () => {
  it('checks every file and keeps it in the data folder: what is installed, its size, purposes and licences', async () => {
    const data = temp('data');
    const source = packFolder();
    const store = storeIn(data);
    const seen: ModelPacksStatus[] = [];
    store.onChanged((s) => seen.push(s));

    const r = await store.importPack(source, 'folder');
    if (!r.ok) throw new Error(r.message);
    const bytes = 64 * 1024 + 100 * 1024 + 22 + Buffer.byteLength(LICENCE_TEXT);
    expect(r.pack).toMatchObject({
      id: 'placeholder-pack',
      name: 'Placeholder models',
      release: '2026.11.1',
      importedAt: 1_790_000_000_000,
      bytes,
      inUse: false,
      problem: null,
      licences: [{ file: 'licences/MIT.txt', licence: 'MIT' }],
    });
    expect(r.pack.models).toEqual([
      {
        id: 'gu-placeholder',
        purposes: ['captions-gu'],
        format: 'whisper-ggml',
        licences: ['MIT'],
        attributions: ['Placeholder model gu-placeholder, made by the tests'],
        bytes: 64 * 1024,
      },
      {
        id: 'en-indic-placeholder',
        purposes: ['translation-en-gu', 'translation-en-hi'],
        format: 'ctranslate2',
        licences: ['MIT'],
        attributions: ['Placeholder model en-indic-placeholder, made by the tests'],
        bytes: 100 * 1024 + 22,
      },
    ]);
    expect(store.status()).toEqual({ packs: [r.pack], importing: { phase: 'idle' }, problem: null });
    // Its progress was told as it went, and the end.
    expect(seen.some((s) => s.importing.phase === 'importing')).toBe(true);
    expect(seen.at(-1)?.importing).toEqual({ phase: 'idle' });

    // Where each model is: a folder of its own in the data folder, its files copied whole.
    const root = join(data, 'model-packs');
    const gu = store.model('gu-placeholder');
    expect(gu?.folder.startsWith(root)).toBe(true);
    expect(gu?.folder.endsWith(join('captions', 'gu'))).toBe(true);
    expect(gu?.attributions).toEqual(['Placeholder model gu-placeholder, made by the tests']);
    expect(gu?.files.map((f) => [f.name, f.path, f.bytes])).toEqual([
      ['captions/gu/model.bin', join(gu?.folder ?? '', 'model.bin'), 64 * 1024],
    ]);
    expect(readFileSync(gu?.files[0]?.path ?? '')).toEqual(GU.files['captions/gu/model.bin']);
    expect(store.forPurpose('translation-en-hi').map((m) => m.id)).toEqual(['en-indic-placeholder']);
    expect(store.forPurpose('captions-hi')).toEqual([]);
    expect(store.model('no-such-model')).toBeNull();
    // The pack's own folder is left as it was.
    expect(readdirSync(source).sort()).toEqual(['captions', PACK_MANIFEST, 'licences', 'translation']);

    // Readable by this computer's user only (Windows keeps the data folder per user).
    if (process.platform !== 'win32') {
      expect(statSync(gu?.files[0]?.path ?? '').mode & 0o777).toBe(0o600);
      expect(statSync(gu?.folder ?? '').mode & 0o777).toBe(0o700);
      expect(statSync(join(root, 'installed.json')).mode & 0o777).toBe(0o600);
    }

    // After a restart, still there.
    const again = storeIn(data);
    expect(again.model('gu-placeholder')?.files[0]?.path).toBe(gu?.files[0]?.path);
    expect(again.status().packs).toEqual([r.pack]);
  });

  it('refuses the whole pack when one file does not match its SHA-256: nothing is kept', async () => {
    const data = temp('data');
    const source = packFolder();
    // Same size, other bytes: only its hash tells.
    writeFileSync(join(source, 'translation/en-indic/config.json'), '{"placeholder": 1234}\n');
    const store = storeIn(data);
    const r = await store.importPack(source, 'folder');
    expect(r).toMatchObject({
      ok: false,
      message:
        'translation/en-indic/config.json does not match its SHA-256 in the pack’s list: the pack is damaged or was changed. Nothing was installed: ask for a fresh copy of the pack.',
    });
    expect(ours(join(data, 'model-packs'))).toEqual([]);
    expect(store.model('gu-placeholder')).toBeNull();
    expect(store.status().packs).toEqual([]);
  });

  it('refuses a pack that is not whole before copying anything: no list, a file missing, or the wrong size', async () => {
    const data = temp('data');
    const store = storeIn(data);
    const empty = temp('empty');
    expect(await store.importPack(empty, 'folder')).toMatchObject({
      ok: false,
      message: `This is not a Drashti model pack: it has no ${PACK_MANIFEST} at its top. Nothing was installed: choose the pack’s own folder or zip.`,
    });
    const missing = packFolder();
    rmSync(join(missing, 'captions/gu/model.bin'));
    expect(await store.importPack(missing, 'folder')).toMatchObject({
      ok: false,
      message:
        'The pack is not whole: captions/gu/model.bin is missing. Nothing was installed: ask for a fresh copy of the pack.',
    });
    const longer = packFolder();
    appendFileSync(join(longer, 'captions/gu/model.bin'), 'x');
    expect(await store.importPack(longer, 'folder')).toMatchObject({
      ok: false,
      message:
        'The pack is not whole: captions/gu/model.bin is not the size its list says. Nothing was installed: ask for a fresh copy of the pack.',
    });
    expect(ours(join(data, 'model-packs'))).toEqual([]);
  });

  it('never follows a link out of the pack’s folder', async () => {
    const data = temp('data');
    const source = packFolder();
    const elsewhere = temp('elsewhere');
    writeFileSync(join(elsewhere, 'model.bin'), GU.files['captions/gu/model.bin'] ?? '');
    rmSync(join(source, 'captions/gu'), { recursive: true });
    // A junction on Windows (no special rights needed), a link elsewhere.
    symlinkSync(elsewhere, join(source, 'captions/gu'), 'junction');
    const store = storeIn(data);
    expect(await store.importPack(source, 'folder')).toMatchObject({
      ok: false,
      message:
        'captions/gu/model.bin is a link to a file elsewhere, which Drashti never follows. Nothing was installed: copy the pack’s own files into its folder, then import it again.',
    });
    expect(ours(join(data, 'model-packs'))).toEqual([]);
  });

  it('imports a zip, its list at the top or in the one folder it holds; refuses a link or a changed file in it', async () => {
    const data = temp('data');
    const store = storeIn(data);
    const r = await store.importPack(packZip(), 'zip');
    if (!r.ok) throw new Error(r.message);
    expect(readFileSync(store.model('en-indic-placeholder')?.files[0]?.path ?? '')).toEqual(
      EN_INDIC.files['translation/en-indic/model.bin'],
    );
    const inFolder = await store.importPack(
      packZip({ release: '2026.11.2' }, { prefix: 'Placeholder pack/' }),
      'zip',
    );
    expect(inFolder).toMatchObject({ ok: true, pack: { release: '2026.11.2' } });

    const link = packZip(
      {},
      { change: (e) => (e.name === 'captions/gu/model.bin' ? { ...e, unixMode: 0o120777 } : e) },
    );
    expect(await store.importPack(link, 'zip')).toMatchObject({
      ok: false,
      message:
        'captions/gu/model.bin is a link to a file elsewhere, which Drashti never follows. Nothing was installed: copy the pack’s own files into its folder, then import it again.',
    });
    const changed = packZip(
      {},
      {
        change: (e) =>
          e.name === 'captions/gu/model.bin' ? { ...e, data: Buffer.alloc(64 * 1024, 'changed bytes! ') } : e,
      },
    );
    expect(await store.importPack(changed, 'zip')).toMatchObject({
      ok: false,
      message:
        'captions/gu/model.bin does not match its SHA-256 in the pack’s list: the pack is damaged or was changed. Nothing was installed: ask for a fresh copy of the pack.',
    });
    const notAZip = join(temp('zip'), 'Placeholder.zip');
    writeFileSync(notAZip, 'placeholder: not a zip');
    expect(await store.importPack(notAZip, 'zip')).toMatchObject({
      ok: false,
      message:
        'This zip does not open: it is damaged or not a zip. Nothing was installed: ask for a fresh copy of the pack.',
    });
    // The refusals left the pack installed before as it was.
    expect(only(store.status().packs).release).toBe('2026.11.2');
    expect(ours(join(data, 'model-packs'))).toHaveLength(1);
  });

  it('refuses a pack with too little room left on this computer, saying how much to free', async () => {
    const data = temp('data');
    const total = 64 * 1024 + 100 * 1024 + 22 + Buffer.byteLength(LICENCE_TEXT);
    const short = storeIn(data, () => Promise.resolve(total + 2 * GiB - 5_000_000));
    expect(await short.importPack(packFolder(), 'folder')).toMatchObject({
      ok: false,
      message: 'Free at least 5 MB more on this computer, then import the pack again. Nothing was installed.',
    });
    const unknown = storeIn(data, () => Promise.resolve(null));
    expect(await unknown.importPack(packFolder(), 'folder')).toMatchObject({
      ok: false,
      message:
        'Drashti could not see how much room this computer has left. Nothing was installed: try again, or free some space first.',
    });
    expect(ours(join(data, 'model-packs'))).toEqual([]);
  });

  it('refuses a model another installed pack already brings', async () => {
    const data = temp('data');
    const store = storeIn(data);
    expect((await store.importPack(packFolder({ models: [GU] }), 'folder')).ok).toBe(true);
    expect(
      await store.importPack(
        packFolder({ id: 'other-pack', name: 'Other placeholder models', models: [GU] }),
        'folder',
      ),
    ).toMatchObject({
      ok: false,
      message:
        'The model gu-placeholder is already installed from Placeholder models. Nothing was installed: remove that pack first, then import this one.',
    });
  });

  it('one import at a time; stopping one leaves nothing', async () => {
    const data = temp('data');
    const store = storeIn(data);
    const first = store.importPack(packFolder(), 'folder');
    expect(await store.importPack(packFolder(), 'folder')).toMatchObject({
      ok: false,
      message: 'A pack is being imported already: wait for it to finish, then import this one.',
    });
    store.cancelImport();
    expect(await first).toMatchObject({
      ok: false,
      cancelled: true,
      message: 'The import was stopped. Nothing was installed.',
    });
    expect(ours(join(data, 'model-packs'))).toEqual([]);
    expect(store.status().importing).toEqual({ phase: 'idle' });
  });
});

describe('the packs on this computer (alpha.22, cap-pack)', () => {
  it('a read that fails for a moment while checking again does not mark the pack damaged: the next use checks again (review)', async () => {
    const data = temp('data');
    expect((await storeIn(data).importPack(packFolder(), 'folder')).ok).toBe(true);
    const store = storeIn(data);
    readFault.next = true;
    expect(await store.acquire('gu-placeholder')).toBeNull();
    expect(only(store.status().packs).problem).toBeNull();
    const hold = await store.acquire('gu-placeholder');
    expect(hold?.model.id).toBe('gu-placeholder');
    hold?.release();
  });

  it('checks a model again before its first use; a file changed since makes the pack unusable until imported again', async () => {
    const data = temp('data');
    const store = storeIn(data);
    expect((await store.importPack(packFolder(), 'folder')).ok).toBe(true);
    const hold = await store.acquire('gu-placeholder');
    expect(hold?.model.id).toBe('gu-placeholder');
    expect(only(store.status().packs).inUse).toBe(true);
    hold?.release();
    expect(only(store.status().packs).inUse).toBe(false);

    // Same size, other bytes, in the copy kept: the next run's first use finds it.
    const config =
      store.model('en-indic-placeholder')?.files.find((f) => f.name.endsWith('config.json'))?.path ?? '';
    writeFileSync(config, '{"placeholder": 1234}\n');
    const next = storeIn(data);
    expect(await next.acquire('en-indic-placeholder')).toBeNull();
    expect(next.model('en-indic-placeholder')).toBeNull();
    expect(next.model('gu-placeholder')).toBeNull();
    expect(only(next.status().packs).problem).toBe(
      'A file of this pack has changed or gone on this computer since it was checked: import the pack again.',
    );

    // A file gone is seen at once.
    const fresh = temp('data2');
    const other = storeIn(fresh);
    expect((await other.importPack(packFolder(), 'folder')).ok).toBe(true);
    rmSync(other.model('gu-placeholder')?.files[0]?.path ?? '');
    expect(other.model('gu-placeholder')).toBeNull();
    expect(only(other.status().packs).problem).toBe(
      'A file of this pack has changed or gone on this computer since it was checked: import the pack again.',
    );
  });

  it('removes a pack whole, never while in use', async () => {
    const data = temp('data');
    const store = storeIn(data);
    const r = await store.importPack(packFolder(), 'folder');
    if (!r.ok) throw new Error(r.message);
    const folder = dirname(dirname(store.model('gu-placeholder')?.folder ?? ''));
    const hold = await store.acquire('gu-placeholder');
    expect(await store.remove('placeholder-pack')).toEqual({
      ok: false,
      message: 'Live captions or translation are using this pack: turn them off, then remove it.',
    });
    hold?.release();
    expect(await store.remove('placeholder-pack')).toEqual({
      ok: true,
      status: { packs: [], importing: { phase: 'idle' }, problem: null },
    });
    expect(existsSync(folder)).toBe(false);
    expect(store.model('gu-placeholder')).toBeNull();
    expect(await store.remove('placeholder-pack')).toEqual({
      ok: false,
      message: 'That pack is no longer on this computer.',
    });
    expect(storeIn(data).status().packs).toEqual([]);
  });

  it('importing a pack again replaces it; the copy in use stays until it is let go', async () => {
    const data = temp('data');
    const store = storeIn(data);
    expect((await store.importPack(packFolder(), 'folder')).ok).toBe(true);
    const hold = await store.acquire('gu-placeholder');
    const old = hold?.model.files[0]?.path ?? '';
    const newer: PlaceholderModel = {
      ...GU,
      files: { 'captions/gu/model.bin': Buffer.alloc(32 * 1024, 'newer gu ') },
    };
    const r = await store.importPack(
      packFolder({ release: '2026.12.1', models: [newer, EN_INDIC] }),
      'folder',
    );
    expect(r).toMatchObject({ ok: true, pack: { release: '2026.12.1', inUse: false } });
    expect(only(store.status().packs).release).toBe('2026.12.1');
    const now = store.model('gu-placeholder')?.files[0]?.path ?? '';
    expect(now).not.toBe(old);
    expect(readFileSync(now)).toEqual(newer.files['captions/gu/model.bin']);
    // The old copy is still whole while it is held, and goes once let go.
    expect(readFileSync(old)).toEqual(GU.files['captions/gu/model.bin']);
    hold?.release();
    await vi.waitFor(() => {
      expect(existsSync(old)).toBe(false);
    });
    expect(ours(join(data, 'model-packs'))).toHaveLength(1);
  });

  it('shows a licence’s own text from the copy kept', async () => {
    const data = temp('data');
    const store = storeIn(data);
    expect((await store.importPack(packFolder(), 'folder')).ok).toBe(true);
    expect(store.licenceText('placeholder-pack', 'licences/MIT.txt')).toEqual({
      ok: true,
      text: LICENCE_TEXT,
    });
    expect(store.licenceText('placeholder-pack', 'captions/gu/model.bin')).toEqual({
      ok: false,
      message: 'That licence text is not in this pack: import the pack again.',
    });
    expect(store.licenceText('no-such-pack', 'licences/MIT.txt')).toEqual({
      ok: false,
      message: 'That pack is no longer on this computer.',
    });
  });

  it('starts tidy: an import cut short and a pack folder no longer listed go; an unreadable list is set aside, nothing removed', async () => {
    const data = temp('data');
    const root = join(data, 'model-packs');
    const store = storeIn(data);
    expect((await store.importPack(packFolder(), 'folder')).ok).toBe(true);
    const kept = only(ours(root));
    mkdirSync(join(root, '.incoming-0123456789abcdef', 'captions'), { recursive: true });
    mkdirSync(join(root, 'old-pack-0123456789abcdef'));
    writeFileSync(join(root, 'notes.txt'), 'not Drashti’s');
    storeIn(data);
    await vi.waitFor(() => {
      expect(readdirSync(root).sort()).toEqual([kept, 'installed.json', 'notes.txt'].sort());
    });

    writeFileSync(join(root, 'installed.json'), '{"v": 1, "packs": [');
    const damaged = storeIn(data);
    expect(damaged.status()).toEqual({
      packs: [],
      importing: { phase: 'idle' },
      problem:
        'The list of caption and translation models on this computer did not read, so it was set aside: import the packs again.',
    });
    expect(damaged.model('gu-placeholder')).toBeNull();
    expect(existsSync(join(root, kept))).toBe(true);
    expect(readdirSync(root).some((n) => n.startsWith('installed.unreadable-'))).toBe(true);

    // The next start finds no list (it was set aside): the operator's pack folders are never removed for that,
    // and the problem is still said (review: pack folders deleted on the second start).
    const again = storeIn(data);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(existsSync(join(root, kept))).toBe(true);
    expect(again.status().problem).toBe(
      'The list of caption and translation models on this computer did not read, so it was set aside: import the packs again.',
    );
  });

  it('never fetches anything: its code names no network', () => {
    const folder = __dirname;
    for (const file of readdirSync(folder).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const text = readFileSync(join(folder, file), 'utf8');
      expect(text, file).not.toMatch(
        /\bfetch\(|node:https?\b|node:net\b|\bnet\.request\b|XMLHttpRequest|WebSocket/u,
      );
    }
  });
});

describe('a pack’s files stay inside its folder (alpha.23, the review)', () => {
  it('takes a pack at the top of a drive or a disk, such as a USB stick’s E:\\', () => {
    expect(insideFolder('E:\\', 'E:\\captions\\gu\\model.onnx', 'win32')).toBe(true);
    expect(insideFolder('e:\\', 'E:\\Captions\\model.onnx', 'win32')).toBe(true);
    expect(insideFolder('/', '/captions/model.onnx', 'darwin')).toBe(true);
    expect(insideFolder('E:\\Packs\\gu', 'E:\\Packs\\gu\\model.onnx', 'win32')).toBe(true);
  });

  it('refuses a file outside it: another drive, a folder named alike, the folder itself', () => {
    expect(insideFolder('E:\\', 'F:\\captions\\model.onnx', 'win32')).toBe(false);
    expect(insideFolder('E:\\Packs', 'E:\\Packs2\\model.onnx', 'win32')).toBe(false);
    expect(insideFolder('/Volumes/Packs', '/Volumes/Packs2/model.onnx', 'darwin')).toBe(false);
    expect(insideFolder('/Volumes/Packs', '/Volumes/Packs', 'darwin')).toBe(false);
    expect(insideFolder('/srv/Packs', '/srv/packs/model.onnx', 'linux')).toBe(false);
  });
});
