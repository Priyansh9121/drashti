import { randomBytes } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { z } from 'zod';
import {
  MAX_MANIFEST_BYTES,
  PACK_MANIFEST,
  packManifestSchema,
  type InstalledPackView,
  type ModelPacksStatus,
  type ModelPurpose,
  type PackFile,
  type PackImportProgress,
  type PackImportResult,
  type PackLicenceResult,
  type PackRemoveResult,
} from '../../shared/model-packs';
import { listZip, readZipEntries, ZipError, type ZipEntry } from '../import/zip';
import { hashOffMain } from '../library/hash-off-main';
import { fileProblem } from '../plain-errors';
import { readStateTwice, setAside } from '../state-file';
import { freeBytesOf } from '../stream/recording-drive';
import { checkManifest, readManifestText, type CheckedPack } from './manifest';

/*
 * The caption and translation models on this computer (alpha.22, cap-pack; x79's §4: "a separately supplied,
 * hash-checked offline model pack ... imported locally before the show"). Never fetched: an admin chooses the pack's
 * folder or zip (Help › Caption and Translation Models…, Pro Mode) and Drashti copies it into its data folder's
 * model-packs/, outside the library and so outside every backup, as this computer's own (each Main imports its own).
 *
 *   model-packs/
 *     installed.json                  the list: each pack's folder, its list as imported, when (written whole or not)
 *     <pack id>-<16 hex>/             one pack, as its list names its files (and that list, drashti-model-pack.json)
 *     .incoming-<16 hex>/             an import under way (a start clears one cut short)
 *
 * An import reads the pack's list first and refuses before copying anything when the list is wrong, a file is
 * missing, the wrong size or a link out of the pack, or the drive has too little room (2 GB stays free, as for
 * recordings, imports and backups). Each file is counted as it is copied (never more than its list says), then its
 * SHA-256 is worked out from the copy in a worker thread, never on Main's thread, where the show's commands wait
 * (alpha.23, cap-packimport): one that does not match its list refuses the whole pack, and the work folder goes.
 * Only when every file is whole does the work folder take its real name and the list name it; a pack imported again
 * replaces the old copy, which stays whole while live captions or translation still hold it (it goes when they let
 * go, or at the next start). Files are readable by this computer's user only (0600, folders 0700), as the access
 * storage's are.
 *
 * Caption and translation engines ask here (main process only): `model(id)` and `forPurpose(purpose)` say whether a
 * model is installed and whole (each file there, its size as checked) and where (its own folder, each file's path);
 * `acquire(id)` checks every file's SHA-256 again before the model's first use in each run, and holds the copy while
 * it is in use (`release()` lets it go): a pack is never removed or replaced under an engine.
 */

/** Room left on the drive after a pack, as recordings, imports and backups leave. */
const KEEP_FREE_BYTES = 2 * 1024 ** 3;
const LIST = 'installed.json';
const INCOMING = /^\.incoming-[0-9a-f]{16}$/u;
const PACK_FOLDER = /^[a-z0-9][a-z0-9-]{0,63}-[0-9a-f]{16}$/u;
/** How often an import's progress is told at most (each file's end is told too). */
const PROGRESS_MS = 200;
/** The most of a licence's text shown. */
const MAX_LICENCE_BYTES = 1024 * 1024;

const FRESH = 'Nothing was installed: ask for a fresh copy of the pack.';
const NO_LIST = `This is not a Drashti model pack: it has no ${PACK_MANIFEST} at its top. Nothing was installed: choose the pack’s own folder or zip.`;
const STOPPED = 'The import was stopped. Nothing was installed.';
const BUSY = 'A pack is being imported already: wait for it to finish, then import this one.';
const GONE = 'That pack is no longer on this computer.';
const IN_USE = 'Live captions or translation are using this pack: turn them off, then remove it.';
const CHANGED =
  'A file of this pack has changed or gone on this computer since it was checked: import the pack again.';
const UNREADABLE_LIST =
  'The list of caption and translation models on this computer did not read, so it was set aside: import the packs again.';
const NOT_A_ZIP = `This zip does not open: it is damaged or not a zip. ${FRESH}`;
const LINK = (name: string) =>
  `${name} is a link to a file elsewhere, which Drashti never follows. Nothing was installed: copy the pack’s own files into its folder, then import it again.`;
const MISSING = (name: string) => `The pack is not whole: ${name} is missing. ${FRESH}`;
const WRONG_SIZE = (name: string) => `The pack is not whole: ${name} is not the size its list says. ${FRESH}`;
const MISMATCH = (name: string) =>
  `${name} does not match its SHA-256 in the pack’s list: the pack is damaged or was changed. ${FRESH}`;

/** A model on this computer: what it is for, and where its files are. */
export interface PackedModel {
  id: string;
  packId: string;
  packName: string;
  packRelease: string;
  purposes: readonly ModelPurpose[];
  /** The engine's format, as the pack names it ("whisper-ggml", "ctranslate2"…). */
  format: string;
  /** The model's own folder (holding all its files). */
  folder: string;
  files: readonly { name: string; path: string; bytes: number; sha256: string; licence: string }[];
  licences: readonly string[];
  /** Who made it and where it is from, as the pack credits it. */
  attributions: readonly string[];
}

/** A model held while an engine uses it: never removed or replaced under it. Let go once, when done. */
export interface ModelHold {
  model: PackedModel;
  release(): void;
}

export interface ModelPackDeps {
  /** The data folder's model-packs/. */
  root: string;
  log: { info(line: string): void; warn(line: string): void };
  freeBytes?: (folder: string) => Promise<number | null>;
  now?: () => number;
}

const installedSchema = z.object({
  v: z.literal(1),
  packs: z.array(
    z.object({
      dir: z.string().regex(PACK_FOLDER),
      importedAt: z.number().min(0),
      manifest: z.unknown(),
    }),
  ),
});

interface Installed {
  dir: string;
  importedAt: number;
  /** As imported (kept whole), and as checked again at the start (null: this Drashti cannot use it). */
  manifest: unknown;
  checked: CheckedPack | null;
}

/** A refusal raised inside an import: its words are the notice. */
class Refusal extends Error {}

/** Which file an import is reading or writing when a drive fails. */
type Side = 'read' | 'own';

const hex16 = () => randomBytes(8).toString('hex');

/**
 * Whether `real`, a file's real path, is inside the pack's folder `top`, in the platform's own way (Mac and Windows
 * folders do not tell a name's case apart). The top of a drive or a disk ("E:\\", "/") already ends in its separator
 * (alpha.23, the review: a pack on a USB stick's top was refused as a link).
 */
export function insideFolder(
  top: string,
  real: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const separator = platform === 'win32' ? '\\' : '/';
  const fold = (p: string) => (platform === 'linux' ? p : p.toLowerCase());
  const folder = top.endsWith(separator) ? top : top + separator;
  return fold(real).startsWith(fold(folder));
}

/** Counts what passes, refusing more than `bytes` (a deflated zip entry, as it inflates). */
function counting(name: string, bytes: number, step: (n: number) => void) {
  let seen = 0;
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > bytes) {
        done(new Refusal(WRONG_SIZE(name)));
        return;
      }
      step(chunk.length);
      done(null, chunk);
    },
  });
  return { transform, seen: () => seen };
}

/**
 * A file's SHA-256, read and hashed in a worker thread (a22-review-mt2 S2): checking a model again before its use
 * (hundreds of megabytes) never takes Main's thread, where the show's commands wait; it ends at once when `signal`
 * aborts.
 */
async function sha256Of(file: string, signal?: AbortSignal): Promise<string> {
  return (await hashOffMain(file, signal)).sha256;
}

/** Rename, again a few times when Windows holds a just-written folder for a moment (its indexer, an antivirus). */
async function renameSoon(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 9 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const LOCAL = 0x04034b50;

export class ModelPackStore {
  private readonly root: string;
  private readonly freeBytes: (folder: string) => Promise<number | null>;
  private readonly now: () => number;
  private packs: Installed[] = [];
  private listProblem: string | null = null;
  private progress: PackImportProgress = { phase: 'idle' };
  private importing: AbortController | null = null;
  private lastTold = 0;
  /** The packs as last told. */
  private shown: InstalledPackView[] | null = null;
  private readonly listeners = new Set<(s: ModelPacksStatus) => void>();
  /** Holds on each pack folder. */
  private readonly holds = new Map<string, number>();
  /** Pack folders replaced while held: removed once let go. */
  private readonly retired = new Set<string>();
  /** Pack folders found changed since they were checked. */
  private readonly damaged = new Set<string>();
  /** Files whose SHA-256 was checked this run: the size and time they had then. */
  private readonly verified = new Map<string, { size: number; mtimeMs: number }>();

  constructor(private readonly deps: ModelPackDeps) {
    this.root = deps.root;
    this.freeBytes = deps.freeBytes ?? freeBytesOf;
    this.now = deps.now ?? Date.now;
  }

  /** Read the list, and clear what an import cut short (or a pack replaced while held) left. */
  start(): void {
    const read = readStateTwice(join(this.root, LIST), (raw) => {
      const parsed = installedSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    });
    if (read.status === 'ok') {
      this.packs = read.value.packs.map((p) => {
        const checked = checkManifest(p.manifest);
        if (!checked.ok) this.deps.log.warn(`Model packs: ${p.dir} cannot be used by this Drashti`);
        return { ...p, checked: checked.ok ? checked.pack : null };
      });
    } else if (read.status !== 'missing') {
      // Never written over and nothing removed: set aside, and said.
      const aside = setAside(join(this.root, LIST));
      this.deps.log.warn(
        `Model packs: the list ${read.status} (${read.reason}); set aside: ${aside ? 'yes' : 'no'}`,
      );
      this.listProblem = UNREADABLE_LIST;
      return;
    } else if (this.setAsideBefore()) {
      // A list set aside at an earlier start: still said, until the packs are imported again.
      this.listProblem = UNREADABLE_LIST;
    }
    // Pack folders the list no longer names go only when the list was read: never for a missing one (review).
    this.sweep(read.status === 'ok');
  }

  /** Whether an earlier start set an unreadable list aside. */
  private setAsideBefore(): boolean {
    try {
      return readdirSync(this.root).some((name) => name.startsWith('installed.unreadable-'));
    } catch {
      return false;
    }
  }

  close(): void {
    this.importing?.abort();
    this.listeners.clear();
  }

  onChanged(listener: (s: ModelPacksStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): ModelPacksStatus {
    this.shown = [...this.packs].reverse().map((p) => this.view(p));
    return { packs: this.shown, importing: this.progress, problem: this.listProblem };
  }

  /** A model installed and whole (each file there, the size it was checked at), and where; null if not. */
  model(id: string): PackedModel | null {
    for (const p of this.packs) {
      const m = this.packed(p, id);
      if (m) return this.whole(p) ? m : null;
    }
    return null;
  }

  /** Every model installed and whole for a purpose (the newest import first). */
  forPurpose(purpose: ModelPurpose): PackedModel[] {
    return [...this.packs]
      .reverse()
      .filter((p) => this.whole(p))
      .flatMap((p) =>
        (p.checked?.models ?? [])
          .filter((m) => m.purposes.includes(purpose))
          .map((m) => this.packed(p, m.id)),
      )
      .filter((m): m is PackedModel => m !== null);
  }

  /**
   * The model, each file's SHA-256 checked again (once a run, and again if a file changed since), held until
   * `release()`; null if it is not installed or not whole (the pack is then marked as changed).
   */
  async acquire(id: string, signal?: AbortSignal): Promise<ModelHold | null> {
    const pack = this.packs.find((p) => this.packed(p, id) !== null);
    const model = pack ? this.packed(pack, id) : null;
    if (!pack || !model || !this.whole(pack)) return null;
    this.hold(pack.dir);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.letGo(pack.dir);
    };
    try {
      for (const f of model.files) {
        const s = statSync(f.path);
        const known = this.verified.get(f.path);
        if (known?.size === s.size && known.mtimeMs === s.mtimeMs) continue;
        if (s.size !== f.bytes || (await sha256Of(f.path, signal)) !== f.sha256) {
          this.damaged.add(pack.dir);
          this.deps.log.warn(`Model packs: ${pack.dir} changed since it was checked (model ${id})`);
          release();
          this.tell(true);
          return null;
        }
        this.verified.set(f.path, { size: s.size, mtimeMs: s.mtimeMs });
      }
    } catch (error) {
      release();
      if (signal?.aborted) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        // A file gone: the pack is damaged until it is imported again.
        this.damaged.add(pack.dir);
        this.deps.log.warn(`Model packs: ${pack.dir} could not be checked (model ${id})`);
        this.tell(true);
      } else {
        // Any other read error may pass (a busy disk, a moment's lock): not damage; checked again at the next use.
        this.deps.log.warn(
          `Model packs: ${pack.dir} could not be checked now (${code ?? 'error'}, model ${id})`,
        );
      }
      return null;
    }
    if (!this.packs.some((p) => p.dir === pack.dir) && !this.retired.has(pack.dir)) {
      // Removed while it was being checked.
      release();
      return null;
    }
    return { model, release };
  }

  /** Stop the import under way (it leaves nothing). */
  cancelImport(): void {
    this.importing?.abort();
  }

  /** Import a pack from the folder or zip an admin chose. */
  async importPack(source: string, kind: 'folder' | 'zip'): Promise<PackImportResult> {
    if (this.importing) return { ok: false, message: BUSY, status: this.status() };
    const control = new AbortController();
    this.importing = control;
    this.progress = { phase: 'importing', name: null, done: 0, total: 0 };
    this.tell(true);
    const work = join(this.root, `.incoming-${hex16()}`);
    let reader: PackReader | null = null;
    // Whose drive failed, when one does: the pack's (read) or this computer's (own).
    let side: Side = 'read';
    try {
      const signal = control.signal;
      reader = kind === 'zip' ? await this.zipReader(source) : await this.folderReader(source);
      signal.throwIfAborted();
      const checked = readManifestText(reader.manifest);
      if (!checked.ok) throw new Refusal(checked.message);
      const pack = checked.pack;
      for (const m of pack.models) {
        const other = this.packs.find((p) => this.packId(p) !== pack.manifest.id && this.packed(p, m.id));
        if (other)
          throw new Refusal(
            `The model ${m.id} is already installed from ${other.checked?.manifest.name ?? 'another pack'}. Nothing was installed: remove that pack first, then import this one.`,
          );
      }
      for (const f of pack.manifest.files) await reader.check(f);
      signal.throwIfAborted();
      side = 'own';
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const free = await this.freeBytes(this.root);
      if (free === null)
        throw new Refusal(
          'Drashti could not see how much room this computer has left. Nothing was installed: try again, or free some space first.',
        );
      const short = KEEP_FREE_BYTES + pack.bytes - free;
      if (short > 0)
        throw new Refusal(
          `Free at least ${String(Math.ceil(short / 1_000_000))} MB more on this computer, then import the pack again. Nothing was installed.`,
        );

      this.progress = { phase: 'importing', name: pack.manifest.name, done: 0, total: pack.bytes };
      this.tell(true);
      await mkdir(work, { mode: 0o700 });
      // Copying and checking each count for half of the progress told.
      let copied = 0;
      let hashed = 0;
      const progress = (now = false) => {
        const done = Math.floor((copied + hashed) / 2);
        this.progress = { phase: 'importing', name: pack.manifest.name, done, total: pack.bytes };
        this.tell(now);
      };
      for (const f of pack.manifest.files) {
        const target = join(work, ...f.name.split('/'));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        const counter = counting(f.name, f.bytes, (n) => {
          copied += n;
          progress();
        });
        side = 'read';
        const from = await reader.open(f);
        const out = createWriteStream(target, { flags: 'wx', mode: 0o600 });
        out.once('error', () => {
          side = 'own';
        });
        await pipeline([...from, counter.transform, out], { signal });
        if (counter.seen() !== f.bytes) throw new Refusal(WRONG_SIZE(f.name));
        // Its SHA-256 from the copy just written, in a worker thread (cap-packimport): hundreds of megabytes never
        // hash on Main's thread, and what is kept is what was checked. Stop and quitting end the worker at once.
        side = 'own';
        const before = hashed;
        const found = await hashOffMain(target, signal, (n) => {
          hashed = before + n;
          progress();
        });
        signal.throwIfAborted();
        if (found.bytes !== f.bytes) throw new Refusal(WRONG_SIZE(f.name));
        if (found.sha256 !== f.sha256) throw new Refusal(MISMATCH(f.name));
        hashed = before + f.bytes;
        progress(true);
      }
      side = 'own';
      await writeFile(join(work, PACK_MANIFEST), reader.manifest, { flag: 'wx', mode: 0o600 });
      signal.throwIfAborted();

      // Whole: the work folder takes its real name, and the list names it. The old copy goes unless it is held.
      const dir = `${pack.manifest.id}-${hex16()}`;
      await renameSoon(work, join(this.root, dir));
      for (const f of pack.manifest.files) {
        const path = join(this.root, dir, ...f.name.split('/'));
        const s = statSync(path);
        this.verified.set(path, { size: s.size, mtimeMs: s.mtimeMs });
      }
      const old = this.packs.filter((p) => this.packId(p) === pack.manifest.id);
      const installed: Installed = {
        dir,
        importedAt: this.now(),
        manifest: JSON.parse(reader.manifest) as unknown,
        checked: pack,
      };
      const next = [...this.packs.filter((p) => !old.includes(p)), installed];
      try {
        this.saveList(next);
      } catch (error) {
        // Not listed, so not installed: its folder goes too.
        await rm(join(this.root, dir), { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      this.packs = next;
      for (const p of old) await this.retire(p.dir);
      this.deps.log.info(
        `Model packs: imported ${pack.manifest.id} ${pack.manifest.release} (${String(pack.manifest.files.length)} files, ${String(pack.bytes)} bytes)`,
      );
      return { ok: true, pack: this.view(installed), status: this.done() };
    } catch (error) {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
      const cancelled = control.signal.aborted;
      let message: string;
      if (cancelled) message = STOPPED;
      else if (error instanceof Refusal) message = error.message;
      else if (error instanceof ZipError) message = NOT_A_ZIP;
      else {
        const code = (error as NodeJS.ErrnoException).code;
        message = `${fileProblem(error, code === 'ENOSPC' ? 'own' : side)} Nothing was installed.`;
      }
      this.deps.log.info(
        `Model packs: an import ${cancelled ? 'stopped' : error instanceof Refusal ? 'refused' : `failed (${(error as NodeJS.ErrnoException).code ?? 'no code'})`}`,
      );
      return { ok: false, message, ...(cancelled ? { cancelled: true } : {}), status: this.done() };
    } finally {
      await reader?.close().catch(() => undefined);
    }
  }

  /** The import is over: how the packs stand, told. */
  private done(): ModelPacksStatus {
    this.progress = { phase: 'idle' };
    this.importing = null;
    this.tell(true);
    return this.status();
  }

  /** Remove a pack whole: never while live captions or translation hold it. */
  async remove(packId: string): Promise<PackRemoveResult> {
    const pack = this.packs.find((p) => this.packId(p) === packId);
    if (!pack) return { ok: false, message: GONE };
    if ((this.holds.get(pack.dir) ?? 0) > 0) return { ok: false, message: IN_USE };
    const next = this.packs.filter((p) => p !== pack);
    try {
      this.saveList(next);
    } catch (error) {
      this.deps.log.warn(
        `Model packs: the list could not be written (${(error as NodeJS.ErrnoException).code ?? 'no code'})`,
      );
      return { ok: false, message: fileProblem(error, 'own') };
    }
    this.packs = next;
    await this.retire(pack.dir);
    this.deps.log.info(`Model packs: removed ${packId}`);
    this.tell(true);
    return { ok: true, status: this.status() };
  }

  /** A licence's own text, from the copy kept. */
  licenceText(packId: string, file: string): PackLicenceResult {
    const pack = this.packs.find((p) => this.packId(p) === packId);
    if (!pack) return { ok: false, message: GONE };
    const text = pack.checked?.licenceTexts.find((f) => f.name === file);
    if (!text) return { ok: false, message: 'That licence text is not in this pack: import the pack again.' };
    try {
      const path = join(this.root, pack.dir, ...text.name.split('/'));
      if (statSync(path).size > MAX_LICENCE_BYTES) throw new Error('too long');
      return { ok: true, text: readFileSync(path, 'utf8') };
    } catch {
      return { ok: false, message: CHANGED };
    }
  }

  // ---- inside --------------------------------------------------------------------------------------------------

  private packId(p: Installed): string | null {
    if (p.checked) return p.checked.manifest.id;
    const parsed = packManifestSchema.shape.id.safeParse((p.manifest as { id?: unknown } | null)?.id);
    return parsed.success ? parsed.data : null;
  }

  private packed(p: Installed, id: string): PackedModel | null {
    const m = p.checked?.models.find((x) => x.id === id);
    if (!m || !p.checked) return null;
    const base = join(this.root, p.dir);
    return {
      id: m.id,
      packId: p.checked.manifest.id,
      packName: p.checked.manifest.name,
      packRelease: p.checked.manifest.release,
      purposes: [...m.purposes],
      format: m.format,
      folder: join(base, ...m.folder.split('/')),
      files: m.files.map((f: PackFile) => ({
        name: f.name,
        path: join(base, ...f.name.split('/')),
        bytes: f.bytes,
        sha256: f.sha256,
        licence: f.licence,
      })),
      licences: [...m.licences],
      attributions: [...m.attributions],
    };
  }

  /** Whether every file of a pack is there at the size it was checked at (and none was found changed). */
  private whole(p: Installed): boolean {
    if (!p.checked || this.damaged.has(p.dir)) return false;
    return p.checked.manifest.files.every((f) => {
      try {
        return statSync(join(this.root, p.dir, ...f.name.split('/'))).size === f.bytes;
      } catch {
        return false;
      }
    });
  }

  private view(p: Installed): InstalledPackView {
    const c = p.checked;
    const id = this.packId(p) ?? p.dir;
    return {
      id,
      name: c?.manifest.name ?? id,
      release: c?.manifest.release ?? '',
      importedAt: p.importedAt,
      bytes: c?.bytes ?? 0,
      models: (c?.models ?? []).map((m) => ({
        id: m.id,
        purposes: [...m.purposes],
        format: m.format,
        licences: [...m.licences],
        attributions: [...m.attributions],
        bytes: m.bytes,
      })),
      licences: (c?.licenceTexts ?? []).map((f) => ({ file: f.name, licence: f.licence })),
      inUse: (this.holds.get(p.dir) ?? 0) > 0,
      problem: c
        ? this.whole(p)
          ? null
          : CHANGED
        : 'This Drashti cannot use this pack: remove it, then import a pack made for this Drashti.',
    };
  }

  private hold(dir: string): void {
    this.holds.set(dir, (this.holds.get(dir) ?? 0) + 1);
    this.tell(true);
  }

  private letGo(dir: string): void {
    const n = (this.holds.get(dir) ?? 1) - 1;
    if (n > 0) this.holds.set(dir, n);
    else this.holds.delete(dir);
    if (n <= 0 && this.retired.has(dir)) void this.retire(dir);
    this.tell(true);
  }

  /** A pack folder no longer listed: removed now, or once let go. */
  private async retire(dir: string): Promise<void> {
    if ((this.holds.get(dir) ?? 0) > 0) {
      this.retired.add(dir);
      return;
    }
    this.retired.delete(dir);
    this.damaged.delete(dir);
    for (const key of [...this.verified.keys()])
      if (key.startsWith(join(this.root, dir) + sep)) this.verified.delete(key);
    await rm(join(this.root, dir), { recursive: true, force: true }).catch(() => {
      this.deps.log.warn(`Model packs: ${dir} could not be removed yet (it goes at the next start)`);
    });
  }

  /** Clear an import cut short, and (with a list read) pack folders it no longer names (only names Drashti makes). */
  private sweep(unlisted: boolean): void {
    let names: string[];
    try {
      names = readdirSync(this.root);
    } catch {
      return;
    }
    const listed = new Set(this.packs.map((p) => p.dir));
    for (const name of names)
      if (INCOMING.test(name) || (unlisted && PACK_FOLDER.test(name) && !listed.has(name)))
        void rm(join(this.root, name), { recursive: true, force: true }).catch(() => {
          this.deps.log.warn(`Model packs: ${name} could not be cleared yet`);
        });
  }

  /** The list, written whole or not at all. */
  private saveList(packs: readonly Installed[]): void {
    const list = {
      v: 1,
      packs: packs.map((p) => ({ dir: p.dir, importedAt: p.importedAt, manifest: p.manifest })),
    };
    const file = join(this.root, LIST);
    writeFileSync(`${file}.writing`, JSON.stringify(list), { mode: 0o600 });
    renameSync(`${file}.writing`, file);
    this.listProblem = null;
  }

  /**
   * Tell the listeners how the packs stand: `now`, as each thing happens; else an import's progress, at most every
   * PROGRESS_MS and with the packs as last looked at (each file of each pack is looked at only when told `now`).
   */
  private tell(now = false): void {
    const t = Date.now();
    if (!now && t - this.lastTold < PROGRESS_MS) return;
    this.lastTold = t;
    const s: ModelPacksStatus =
      now || this.shown === null
        ? this.status()
        : { packs: this.shown, importing: this.progress, problem: this.listProblem };
    for (const l of this.listeners) l(s);
  }

  // ---- reading a pack --------------------------------------------------------------------------------------------

  /** A pack in a folder: its list at the top; each file inside it, never through a link out of it. */
  private async folderReader(source: string): Promise<PackReader> {
    const top = await realpath(source).catch(() => null);
    if (top === null || !(await stat(top)).isDirectory()) throw new Refusal(NO_LIST);
    const list = join(top, PACK_MANIFEST);
    const ls = await lstat(list).catch(() => null);
    if (!ls?.isFile() || ls.size > MAX_MANIFEST_BYTES) throw new Refusal(NO_LIST);
    const manifest = await readFile(list, 'utf8');
    const path = (f: PackFile) => join(top, ...f.name.split('/'));
    return {
      manifest,
      check: async (f) => {
        const real = await realpath(path(f)).catch(() => null);
        if (real === null) throw new Refusal(MISSING(f.name));
        if (!insideFolder(top, real)) throw new Refusal(LINK(f.name));
        const s = await lstat(real);
        if (!s.isFile()) throw new Refusal(MISSING(f.name));
        if (s.size !== f.bytes) throw new Refusal(WRONG_SIZE(f.name));
      },
      open: (f) => Promise.resolve([createReadStream(path(f), { highWaterMark: 1024 * 1024 })]),
      close: () => Promise.resolve(),
    };
  }

  /** A pack in a zip: its list at the top, or in the one folder the zip holds; no entry a link. */
  private async zipReader(source: string): Promise<PackReader> {
    const entries = await listZip(source);
    const files = entries.filter((e) => !e.isDirectory && !e.name.startsWith('__MACOSX/'));
    const named = (e: ZipEntry) => e.name.replace(/\\/gu, '/');
    let prefix = '';
    if (!files.some((e) => named(e) === PACK_MANIFEST)) {
      const inFolder = files.filter(
        (e) => /^[^/]+\/[^/]+$/u.test(named(e)) && named(e).endsWith(`/${PACK_MANIFEST}`),
      );
      if (inFolder.length !== 1 || !inFolder[0]) throw new Refusal(NO_LIST);
      prefix = `${named(inFolder[0]).split('/')[0] ?? ''}/`;
    }
    // A name the zip holds twice is no file at all (which one would be meant?).
    const byName = new Map<string, ZipEntry | null>();
    for (const e of files) byName.set(named(e), byName.has(named(e)) ? null : e);
    const entryOf = (name: string): ZipEntry => {
      const e = byName.get(prefix + name);
      if (e === undefined) throw new Refusal(name === PACK_MANIFEST ? NO_LIST : MISSING(name));
      if (e === null) throw new Refusal(`The zip holds ${name} twice. ${FRESH}`);
      if (e.unixMode !== null && (e.unixMode & S_IFMT) === S_IFLNK) throw new Refusal(LINK(name));
      if (e.method !== 0 && e.method !== 8)
        throw new Refusal(`${name} is packed in a way Drashti does not read. ${FRESH}`);
      return e;
    };
    const list = entryOf(PACK_MANIFEST);
    if (list.size > MAX_MANIFEST_BYTES) throw new Refusal(NO_LIST);
    const read = await readZipEntries(source, (n) => n === list.name, MAX_MANIFEST_BYTES);
    const manifest = read.get(list.name)?.toString('utf8');
    if (manifest === undefined) throw new Refusal(NO_LIST);
    const fh = await open(source, 'r');
    return {
      manifest,
      check: (f) => {
        if (entryOf(f.name).size !== f.bytes) throw new Refusal(WRONG_SIZE(f.name));
        return Promise.resolve();
      },
      open: async (f) => {
        const entry = entryOf(f.name);
        const header = Buffer.alloc(30);
        const { bytesRead } = await fh.read(header, 0, 30, entry.offset);
        if (bytesRead !== 30 || header.readUInt32LE(0) !== LOCAL) throw new ZipError('broken entry');
        const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
        const raw =
          entry.compressedSize === 0
            ? Readable.from([])
            : createReadStream(source, {
                start,
                end: start + entry.compressedSize - 1,
                highWaterMark: 1024 * 1024,
              });
        // Never more than it says: the copy counts what comes out.
        return entry.method === 8 ? [raw, createInflateRaw()] : [raw];
      },
      close: () => fh.close(),
    };
  }
}

interface PackReader {
  /** The list's text. */
  manifest: string;
  /** Refuses a file that is missing, a link, or not the size the list says (before anything is copied). */
  check(f: PackFile): Promise<void>;
  /** The file's bytes: a stream, and what inflates it when it is deflated in a zip. */
  open(f: PackFile): Promise<(Readable | Transform)[]>;
  close(): Promise<void>;
}
