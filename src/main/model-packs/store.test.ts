import { createHash } from 'node:crypto';
import type * as NodeCrypto from 'node:crypto';
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
import { basename, dirname, join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PACK_FORMAT,
  PACK_MANIFEST,
  type ModelPacksStatus,
  type ModelPurpose,
  type PackFile,
  type PackImportResult,
} from '../../shared/model-packs';
import { makeZip, type ZipWriterEntry } from '../import/testing/zip-writer';
import { hashOffMain } from '../library/hash-off-main';
import type * as WorkerThreads from 'node:worker_threads';
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

// The checks off Main's thread (library/hash-off-main.ts), watched: each one's file and when it ran and how it ended,
// a hook before each starts and on each part it tells (cap-packimport); a read fault for the next file read reaches
// them as it reaches a read on this thread.
const hashWatch = vi.hoisted(() => ({
  runs: [] as { file: string; from: number; to?: number; outcome?: 'done' | 'failed' }[],
  before: null as ((file: string) => void) | null,
  told: null as ((file: string, bytes: number) => void) | null,
}));
type Told = (bytes: number) => void;
vi.mock('../library/hash-off-main', async (original) => {
  const real = await original<{
    hashOffMain: (file: string, signal?: AbortSignal, told?: Told) => ReturnType<typeof hashOffMain>;
  }>();
  return {
    hashOffMain: vi.fn((file: string, signal?: AbortSignal, told?: Told) => {
      hashWatch.before?.(file);
      if (readFault.next) {
        readFault.next = false;
        return Promise.reject(Object.assign(new Error('i/o error'), { code: 'EIO' }));
      }
      const run: (typeof hashWatch.runs)[number] = { file, from: performance.now() };
      hashWatch.runs.push(run);
      return real
        .hashOffMain(
          file,
          signal,
          told &&
            ((bytes) => {
              hashWatch.told?.(file, bytes);
              told(bytes);
            }),
        )
        .then(
          (found) => {
            Object.assign(run, { to: performance.now(), outcome: 'done' });
            return found;
          },
          (error: unknown) => {
            Object.assign(run, { to: performance.now(), outcome: 'failed' });
            throw error;
          },
        );
    }),
  };
});

// What Main's thread hashes (cap-packimport): node:crypto's createHash, watched.
vi.mock('node:crypto', async (original) => {
  const crypto = await original<typeof NodeCrypto>();
  return { ...crypto, createHash: vi.fn(crypto.createHash) };
});

// Each worker thread started, and whether it has ended (cap-packimport).
const threads = vi.hoisted(() => ({ started: 0, ended: 0 }));
vi.mock('node:worker_threads', async (original) => {
  const real = await original<typeof WorkerThreads>();
  class Watched extends real.Worker {
    constructor(...args: ConstructorParameters<typeof real.Worker>) {
      super(...args);
      threads.started += 1;
      this.once('exit', () => {
        threads.ended += 1;
      });
    }
  }
  return { ...real, Worker: Watched };
});
/** Every worker thread started has ended. */
const allEnded = () =>
  vi.waitFor(() => {
    expect(threads.ended).toBe(threads.started);
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
  hashWatch.before = null;
  hashWatch.told = null;
  hashWatch.runs.length = 0;
  readFault.next = false;
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

const MiB = 1024 ** 2;
/** A model large enough that its SHA-256 takes a worker a while (and is told in parts). */
const LARGE: PlaceholderModel = {
  id: 'gu-large-placeholder',
  purpose: ['captions-gu'],
  format: 'whisper-ggml',
  files: { 'captions/gu/model.bin': Buffer.alloc(32 * MiB, 'placeholder large gu ') },
};
const LARGE_FILE = join('captions', 'gu', 'model.bin');
const largeRun = () => hashWatch.runs.find((h) => h.file.endsWith(LARGE_FILE));
const TRY_AGAIN =
  'Try again; if it happens again, choose Help › Report a Problem… (or Save Diagnostics when it can’t be sent).';

describe('an import works out each SHA-256 off Main’s thread (alpha.23, cap-packimport)', () => {
  it('hashes each file from the copy kept, in a worker thread with the import’s signal, and Main’s thread hashes nothing: caption and translation models, from a folder or a zip', async () => {
    for (const kind of ['folder', 'zip'] as const) {
      const data = temp('data');
      const root = join(data, 'model-packs');
      const store = storeIn(data);
      const source = kind === 'folder' ? packFolder() : packZip();
      vi.mocked(hashOffMain).mockClear();
      vi.mocked(createHash).mockClear();
      const r = await store.importPack(source, kind);
      expect(r, kind).toMatchObject({ ok: true });
      // Main's thread worked out no SHA-256 at all.
      expect(
        vi.mocked(createHash).mock.calls.filter(([algorithm]) => algorithm === 'sha256'),
        kind,
      ).toEqual([]);
      const calls = vi.mocked(hashOffMain).mock.calls;
      // Every file the list names (the captions model's and the translation model's alike), as copied into the
      // import's own work folder, before it takes its real name.
      expect(
        calls.map(([file]) => relative(root, file).split(sep).slice(1).join('/')),
        kind,
      ).toEqual([
        'licences/MIT.txt',
        'captions/gu/model.bin',
        'translation/en-indic/model.bin',
        'translation/en-indic/config.json',
      ]);
      for (const [file] of calls)
        expect(relative(root, file).split(sep)[0]).toMatch(/^\.incoming-[0-9a-f]{16}$/u);
      const signals = new Set(calls.map(([, signal]) => signal));
      expect(signals.size).toBe(1);
      expect([...signals][0]).toBeInstanceOf(AbortSignal);
      await allEnded();
    }
  });

  it('Main’s timers keep running while a large file’s SHA-256 is worked out, and the import waits for it', async () => {
    const data = temp('data');
    const store = storeIn(data);
    const source = packFolder({ models: [LARGE] });
    const ticks: number[] = [];
    const timer = setInterval(() => ticks.push(performance.now()), 1);
    let r: PackImportResult;
    try {
      r = await store.importPack(source, 'folder');
    } finally {
      clearInterval(timer);
    }
    expect(r).toMatchObject({ ok: true });
    const run = largeRun();
    expect(run?.outcome).toBe('done');
    expect(
      ticks.filter((t) => t > (run?.from ?? Infinity) && t < (run?.to ?? -Infinity)).length,
    ).toBeGreaterThan(0);
    expect(readFileSync(store.model(LARGE.id)?.files[0]?.path ?? '')).toEqual(
      LARGE.files['captions/gu/model.bin'],
    );
    await allEnded();
  });

  it('Stop while a file’s SHA-256 is worked out ends the worker there: nothing is kept', async () => {
    const data = temp('data');
    const store = storeIn(data);
    hashWatch.told = (file) => {
      if (file.endsWith(LARGE_FILE)) store.cancelImport();
    };
    expect(await store.importPack(packFolder({ models: [LARGE] }), 'folder')).toMatchObject({
      ok: false,
      cancelled: true,
      message: 'The import was stopped. Nothing was installed.',
    });
    // Stopped part way through the file, not left to finish.
    expect(largeRun()?.outcome).toBe('failed');
    await allEnded();
    expect(ours(join(data, 'model-packs'))).toEqual([]);
    expect(store.model(LARGE.id)).toBeNull();
    expect(store.status().importing).toEqual({ phase: 'idle' });
  });

  it('quitting while a file’s SHA-256 is worked out ends the worker too: nothing is kept', async () => {
    const data = temp('data');
    const store = storeIn(data);
    hashWatch.told = (file) => {
      if (file.endsWith(LARGE_FILE)) store.close();
    };
    expect(await store.importPack(packFolder({ models: [LARGE] }), 'folder')).toMatchObject({
      ok: false,
      cancelled: true,
    });
    expect(largeRun()?.outcome).toBe('failed');
    await allEnded();
    expect(ours(join(data, 'model-packs'))).toEqual([]);
  });

  it('a copy gone before its check, or a read that fails for a moment, refuses in plain words with nothing kept; the next import works', async () => {
    const data = temp('data');
    const root = join(data, 'model-packs');
    const store = storeIn(data);
    // The worker's own read error, its code carried back: this computer's copy went away.
    hashWatch.before = (file) => {
      if (file.endsWith(join('captions', 'gu', 'model.bin'))) rmSync(file);
    };
    expect(await store.importPack(packFolder(), 'folder')).toMatchObject({
      ok: false,
      message:
        'A file went away while Drashti was copying it (was a drive taken out?): check it, then try again. Nothing was installed.',
    });
    await allEnded();
    expect(ours(root)).toEqual([]);
    // A read that fails for a moment (EIO): try again.
    hashWatch.before = (file) => {
      if (file.endsWith('config.json')) readFault.next = true;
    };
    expect(await store.importPack(packFolder(), 'folder')).toMatchObject({
      ok: false,
      message: `${TRY_AGAIN} Nothing was installed.`,
    });
    expect(ours(root)).toEqual([]);
    hashWatch.before = null;
    expect(await store.importPack(packFolder(), 'folder')).toMatchObject({
      ok: true,
      pack: { problem: null },
    });
    await allEnded();
  });

  it('refuses a zip entry that inflates past the size its list and the zip say, as it is copied (the pinned sizes)', async () => {
    const listed = GU.files['captions/gu/model.bin'] ?? Buffer.alloc(0);
    const longer = Buffer.concat([listed, Buffer.alloc(4096, 'more placeholder ')]);
    const file = packZip(
      {},
      { change: (e) => (e.name === 'captions/gu/model.bin' ? { ...e, data: longer, deflate: true } : e) },
    );
    // The zip's own directory says the listed size; its data inflates to more.
    const zip = readFileSync(file);
    const central = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    for (let at = zip.indexOf(central); at >= 0; at = zip.indexOf(central, at + 4))
      if (zip.toString('utf8', at + 46, at + 46 + zip.readUInt16LE(at + 28)) === 'captions/gu/model.bin')
        zip.writeUInt32LE(listed.length, at + 24);
    writeFileSync(file, zip);
    const data = temp('data');
    expect(await storeIn(data).importPack(file, 'zip')).toMatchObject({
      ok: false,
      message:
        'The pack is not whole: captions/gu/model.bin is not the size its list says. Nothing was installed: ask for a fresh copy of the pack.',
    });
    expect(ours(join(data, 'model-packs'))).toEqual([]);
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

  it('checks a model again off Main’s thread, with the caller’s signal, and stops at once when it aborts (a22-review-mt2 S2)', async () => {
    const data = temp('data');
    expect((await storeIn(data).importPack(packFolder(), 'folder')).ok).toBe(true);
    // A new run (its own store): the first use checks every file again.
    const store = storeIn(data);
    vi.mocked(hashOffMain).mockClear();
    const control = new AbortController();
    const hold = await store.acquire('en-indic-placeholder', control.signal);
    expect(hold?.model.id).toBe('en-indic-placeholder');
    hold?.release();
    // Each of the model's two files, read and hashed in a worker thread, never on Main's.
    expect(vi.mocked(hashOffMain).mock.calls.map(([file, signal]) => [basename(file), signal])).toEqual([
      ['model.bin', control.signal],
      ['config.json', control.signal],
    ]);
    // Stopped: the check ends at once and the model is not held.
    const stopped = new AbortController();
    const later = storeIn(data);
    stopped.abort();
    await expect(later.acquire('en-indic-placeholder', stopped.signal)).rejects.toThrow();
    expect(only(later.status().packs).inUse).toBe(false);
    expect(only(later.status().packs).problem).toBeNull();
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
