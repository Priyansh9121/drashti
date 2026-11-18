import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { crc32 } from 'node:zlib';
import { cutText } from '../../shared/text';
import type { Db } from '../db/database';
import type { ContentRows } from '../db/content';
import { MediaRepo } from '../db/media';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { diskFreeBytes } from './media-store';
import { withZip, writeEntry, type ZipEntry } from './zip';
import {
  BUNDLE_LIMITS,
  bundleKirtanSchema,
  bundleManifestSchema,
  type BundleKirtan,
  type BundleManifest,
} from './kirtan-bundle-schema';

export { BUNDLE_LIMITS } from './kirtan-bundle-schema';
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const identityKey = (id: string) => `kirtanBundle.identity.${id}`;
export const bundleStateKey = (id: string) => `kirtanBundle.received.${id}`;

/** A per-kirtan identity, kept in the library's existing namespaced metadata. */
export function bundleIdentity(db: Db, presentationId: string): string {
  const settings = new SettingsRepo(db);
  const found = settings.get(identityKey(presentationId));
  if (typeof found === 'string' && /^[0-9a-f-]{36}$/u.test(found)) return found;
  const made = randomUUID();
  settings.set(identityKey(presentationId), made);
  return made;
}

export function keepBundleIdentity(db: Db, presentationId: string, id: string): void {
  new SettingsRepo(db).set(identityKey(presentationId), id);
}

/** Media ids in every supported slide field, including decks and the editor's master/design. */
export function bundleMediaIds(rows: ContentRows): string[] {
  const found = new Set<string>();
  const keys = new Set(['mediaId', 'sourceStillId', 'soundId', 'posterId', 'after']);
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (keys.has(key) && typeof item === 'string') found.add(item);
        else walk(item);
      }
    }
  };
  for (const e of rows.elements) walk(JSON.parse(e.props));
  for (const s of rows.slides) {
    if (s.deck) walk(JSON.parse(s.deck));
    if (s.editor_design) walk(JSON.parse(s.editor_design));
  }
  if (rows.editorMaster) walk(JSON.parse(rows.editorMaster));
  for (const c of rows.cues) if (c.media_id) found.add(c.media_id);
  if (rows.kirtan?.row.audio_media_id) found.add(rows.kirtan.row.audio_media_id);
  return [...found].sort();
}

type PackedFile = { name: string; expectedHash?: string } & ({ bytes: Buffer } | { path: string });

/** Stored entries, streamed to disk; neither media nor the whole archive ever has to fit in memory. */
async function writeBundleZip(output: string, files: PackedFile[], signal?: AbortSignal): Promise<void> {
  const out = await open(output, 'wx', 0o600);
  let at = 0;
  const write = async (bytes: Buffer, position = at) => {
    let done = 0;
    while (done < bytes.length) {
      const result = await out.write(bytes, done, bytes.length - done, position + done);
      if (result.bytesWritten === 0) throw new Error('The bundle could not be written.');
      done += result.bytesWritten;
    }
    if (position === at) at += bytes.length;
  };
  const central: Buffer[] = [];
  try {
    for (const file of files) {
      signal?.throwIfAborted();
      const offset = at;
      const name = Buffer.from(file.name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x800, 6);
      local.writeUInt16LE(name.length, 26);
      await write(local);
      await write(name);
      let size = 0;
      let crc = 0;
      const digest = createHash('sha256');
      const chunks = 'bytes' in file ? [file.bytes] : createReadStream(file.path, { signal });
      for await (const chunk of chunks) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        size += bytes.length;
        if (size > BUNDLE_LIMITS.entry || at + bytes.length > BUNDLE_LIMITS.archive)
          throw new Error('The bundle is too big. Share fewer kirtans or leave out media.');
        crc = crc32(bytes, crc);
        digest.update(bytes);
        await write(bytes);
      }
      if (file.expectedHash && digest.digest('hex') !== file.expectedHash)
        throw new Error('A media file changed while exporting. Try again.');
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(size, 18);
      local.writeUInt32LE(size, 22);
      await write(local, offset);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(0x800, 8);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(size, 20);
      cd.writeUInt32LE(size, 24);
      cd.writeUInt16LE(name.length, 28);
      cd.writeUInt32LE(offset, 42);
      central.push(cd, name);
    }
    const start = at;
    const cd = Buffer.concat(central);
    await write(cd);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(start, 16);
    await write(end);
    await out.sync();
  } finally {
    await out.close();
  }
}

export interface ExportKirtanBundle {
  db: Db;
  mediaDir: string;
  presentationIds: readonly string[];
  output: string;
  includeMedia: boolean;
  freeBytes?: (folder: string) => number;
  signal?: AbortSignal;
}

export async function exportKirtanBundle(o: ExportKirtanBundle): Promise<BundleManifest> {
  if (o.presentationIds.length === 0 || o.presentationIds.length > BUNDLE_LIMITS.kirtans)
    throw new Error('Choose between 1 and 1,000 kirtans to share.');
  const repo = new PresentationRepo(o.db);
  const mediaRepo = new MediaRepo(o.db);
  const manifest: BundleManifest = { format: 'drashti-kirtans', version: 1, kirtans: [], media: [] };
  const files: PackedFile[] = [];
  const mediaIds = new Set<string>();
  let documents = 0;
  // One short read/write transaction snapshots the chosen words and reserves their identities. No media I/O under it.
  o.db.transaction(() => {
    for (const id of new Set(o.presentationIds)) {
      const content = repo.content(id);
      const p = repo.get(id);
      if (!content?.kirtan || !p) throw new Error('A chosen kirtan is no longer in the library.');
      const stableId = bundleIdentity(o.db, id);
      const notes = o.db.prepare('SELECT notes FROM presentations WHERE id = ?').pluck().get(id) as string;
      content.presentationId = stableId;
      // A theme's styles are already on each element; a source path is never needed at the other library.
      content.themeId = null;
      content.arrangements = content.arrangements.map((a) => ({ ...a, source_ref: null }));
      const parsed = bundleKirtanSchema.safeParse({ name: p.name, notes, content });
      if (!parsed.success)
        throw new Error(
          `This kirtan has slide settings that cannot be shared safely (${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}).`,
        );
      for (const mediaId of bundleMediaIds(content)) mediaIds.add(mediaId);
      const bytes = Buffer.from(JSON.stringify(parsed.data));
      documents += bytes.length;
      if (bytes.length > BUNDLE_LIMITS.document || documents > BUNDLE_LIMITS.documents)
        throw new Error('The kirtans have too many words or slides for one bundle. Share fewer at once.');
      const entry = `kirtans/${stableId}.json`;
      manifest.kirtans.push({ id: stableId, entry, sha256: sha(bytes), bytes: bytes.length });
      files.push({ name: entry, bytes });
    }
  })();
  let total = documents;
  const mediaEntries = new Set<string>();
  for (const id of [...mediaIds].sort()) {
    o.signal?.throwIfAborted();
    const row = o.db
      .prepare('SELECT name, kind, path, sha256, bytes, missing, deleted_at FROM media WHERE id = ?')
      .get(id) as
      | {
          name: string;
          kind: 'image' | 'video' | 'audio';
          path: string;
          sha256: string | null;
          bytes: number | null;
          missing: number;
          deleted_at: string | null;
        }
      | undefined;
    if (!row) throw new Error('A kirtan names media that is no longer in the library.');
    const name =
      cutText(basename(row.name.replace(/\\/gu, '/')).replace(/\p{Cc}/gu, ''), 255) || 'Unnamed media';
    let entry: string | null = null;
    if (o.includeMedia) {
      const root = resolve(o.mediaDir);
      const path = resolve(root, row.path);
      if (row.missing || row.deleted_at || !row.sha256 || !path.startsWith(root + sep))
        throw new Error('Requested media is missing. Find it before sharing, or export without media.');
      const info = await stat(path).catch(() => null);
      if (!info?.isFile() || info.size !== row.bytes || info.size > BUNDLE_LIMITS.entry)
        throw new Error('Requested media is missing, changed or too big to share.');
      const ext = extname(row.path).slice(1).toLowerCase();
      if (!/^[a-z0-9]{1,10}$/u.test(ext)) throw new Error('A media file has an unsupported extension.');
      entry = `media/${row.sha256}.${ext}`;
      if (!mediaEntries.has(entry)) {
        mediaEntries.add(entry);
        total += info.size;
        files.push({ name: entry, path, expectedHash: row.sha256 });
      }
    }
    manifest.media.push({
      id,
      name,
      kind: row.kind,
      entry,
      sha256: row.sha256,
      bytes: row.bytes ?? 0,
      markers: mediaRepo.markersOf(id),
    });
  }
  const manifestBytes = Buffer.from(JSON.stringify(bundleManifestSchema.parse(manifest)));
  if (
    manifestBytes.length > BUNDLE_LIMITS.manifest ||
    files.length + 1 > BUNDLE_LIMITS.entries ||
    total > BUNDLE_LIMITS.total
  )
    throw new Error('The bundle is too big. Share fewer kirtans or leave out media.');
  if (
    (o.freeBytes ?? diskFreeBytes)(dirname(o.output)) - total - manifestBytes.length - 1024 ** 2 <
    BUNDLE_LIMITS.reserve
  )
    throw new Error('There is not enough free space to export and keep 2 GB free for the show.');
  files.push({ name: 'manifest.json', bytes: manifestBytes });
  const work = await mkdtemp(join(dirname(o.output), '.drashti-kirtan-export-'));
  try {
    const pending = join(work, 'bundle');
    await writeBundleZip(pending, files, o.signal);
    o.signal?.throwIfAborted();
    await rename(pending, o.output);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return manifest;
}

export interface OpenBundleOptions {
  tempDir?: string;
  freeBytes?: (folder: string) => number;
  signal?: AbortSignal;
}
export interface OpenKirtanBundle {
  manifest: BundleManifest;
  kirtans: BundleKirtan[];
  media: (BundleManifest['media'][number] & { path: string | null })[];
}

/** Bounds the directory before the general ZIP reader allocates it. V1 deliberately uses ordinary, single-disk ZIP. */
async function preflight(fh: FileHandle): Promise<number> {
  const info = await fh.stat();
  if (!info.isFile() || info.size < 22 || info.size > BUNDLE_LIMITS.archive)
    throw new Error('The bundle is damaged or too big.');
  const n = Math.min(info.size, 65_557);
  const tail = Buffer.alloc(n);
  await fh.read(tail, 0, n, info.size - n);
  for (let at = n - 22; at >= 0; at--) {
    if (tail.readUInt32LE(at) !== 0x06054b50) continue;
    const count = tail.readUInt16LE(at + 10);
    const size = tail.readUInt32LE(at + 12);
    const offset = tail.readUInt32LE(at + 16);
    if (
      tail.readUInt16LE(at + 4) !== 0 ||
      tail.readUInt16LE(at + 6) !== 0 ||
      tail.readUInt16LE(at + 8) !== count ||
      count === 0 ||
      count > BUNDLE_LIMITS.entries ||
      size > 2 * 1024 ** 2 ||
      size < count * 46 ||
      offset + size !== info.size - n + at ||
      at + 22 + tail.readUInt16LE(at + 20) !== n
    )
      throw new Error('The bundle has a damaged or oversized ZIP directory.');
    return offset;
  }
  throw new Error('The bundle is not a ZIP file.');
}

async function checkedEntry(fh: FileHandle, e: ZipEntry, path: string, cdOffset: number): Promise<void> {
  const head = Buffer.alloc(30);
  const { bytesRead } = await fh.read(head, 0, 30, e.offset);
  if (
    bytesRead !== 30 ||
    head.readUInt32LE(0) !== 0x04034b50 ||
    head.readUInt16LE(8) !== e.method ||
    (head.readUInt16LE(6) & 1) !== 0
  )
    throw new Error('The bundle has a damaged ZIP entry.');
  const length = head.readUInt16LE(26);
  const name = Buffer.alloc(length);
  await fh.read(name, 0, length, e.offset + 30);
  const start = e.offset + 30 + length + head.readUInt16LE(28);
  if (name.toString('utf8') !== e.name || start + e.compressedSize > cdOffset || start < 30)
    throw new Error('The bundle has a damaged ZIP entry path or size.');
  await mkdir(dirname(path), { recursive: true });
  await writeEntry(fh, e, path, { exclusive: true });
  let size = 0;
  let crc = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    size += chunk.length;
    crc = crc32(chunk, crc);
  }
  if (size !== e.size || crc !== e.crc) throw new Error('The bundle checksum or size does not match.');
}

/** Every entry, checksum and reference is checked before the callback can write any library rows. */
export async function withKirtanBundle<T>(
  file: string,
  options: OpenBundleOptions,
  use: (bundle: OpenKirtanBundle) => T | Promise<T>,
): Promise<T> {
  const parent = options.tempDir ?? tmpdir();
  const fh = await open(file, 'r');
  let cdOffset: number;
  try {
    cdOffset = await preflight(fh);
  } finally {
    await fh.close();
  }
  const work = await mkdtemp(join(parent, 'drashti-kirtan-import-'));
  try {
    return await withZip(file, async (entries, zip) => {
      const names = new Set<string>();
      let total = 0;
      for (const e of entries) {
        if (
          !/^(?:manifest\.json|kirtans\/[0-9a-f-]{36}\.json|media\/[0-9a-f]{64}\.[a-z0-9]{1,10})$/u.test(
            e.name,
          ) ||
          names.has(e.name.toLowerCase()) ||
          e.isDirectory ||
          (e.unixMode !== null && (e.unixMode & 0o170000) !== 0 && (e.unixMode & 0o170000) !== 0o100000)
        )
          throw new Error('The bundle has an unsafe, repeated or unknown path or link.');
        names.add(e.name.toLowerCase());
        const cap =
          e.name === 'manifest.json'
            ? BUNDLE_LIMITS.manifest
            : e.name.startsWith('kirtans/')
              ? BUNDLE_LIMITS.document
              : BUNDLE_LIMITS.entry;
        if (
          !Number.isSafeInteger(e.size) ||
          e.size < 0 ||
          e.size > cap ||
          e.compressedSize > BUNDLE_LIMITS.entry ||
          e.size > Math.max(1, e.compressedSize) * BUNDLE_LIMITS.ratio ||
          (e.method !== 0 && e.method !== 8)
        )
          throw new Error('The bundle has an oversized entry or unsafe compression.');
        total += e.size;
      }
      if (
        total > BUNDLE_LIMITS.total ||
        (options.freeBytes ?? diskFreeBytes)(parent) - total < BUNDLE_LIMITS.reserve
      )
        throw new Error(
          'The bundle is too big or there is not enough free space; keep 2 GB free for the show.',
        );
      const manifestEntry = entries.find((e) => e.name === 'manifest.json');
      if (!manifestEntry) throw new Error('The bundle has no manifest.');
      const manifestPath = join(work, 'manifest.json');
      await checkedEntry(zip, manifestEntry, manifestPath, cdOffset);
      const parsed = bundleManifestSchema.safeParse(JSON.parse(await readFile(manifestPath, 'utf8')));
      if (!parsed.success)
        throw new Error('The bundle manifest has an unknown version, invalid value or unsafe path.');
      const manifest = parsed.data;
      const expected = new Map<string, { sha256: string | null; bytes: number }>();
      expected.set('manifest.json', { sha256: null, bytes: manifestEntry.size });
      let documents = 0;
      for (const k of manifest.kirtans) {
        expected.set(k.entry, k);
        documents += k.bytes;
      }
      for (const m of manifest.media)
        if (m.entry) {
          const old = expected.get(m.entry);
          if (old && (old.sha256 !== m.sha256 || old.bytes !== m.bytes))
            throw new Error('The media descriptions disagree.');
          expected.set(m.entry, m);
        }
      if (
        documents > BUNDLE_LIMITS.documents ||
        expected.size !== entries.length ||
        entries.some((e) => !expected.has(e.name))
      )
        throw new Error('The bundle has missing, extra or oversized files.');
      for (const e of entries) {
        options.signal?.throwIfAborted();
        if (e.name === 'manifest.json') continue;
        const want = expected.get(e.name);
        if (!want) throw new Error('The bundle has an extra file.');
        if (want.bytes !== e.size) throw new Error('The bundle sizes do not match the manifest.');
        const path = join(work, ...e.name.split('/'));
        await checkedEntry(zip, e, path, cdOffset);
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) digest.update(chunk);
        if (digest.digest('hex') !== want.sha256) throw new Error('The bundle checksum does not match.');
      }
      const kirtans: BundleKirtan[] = [];
      const mediaIds = new Set(manifest.media.map((m) => m.id));
      for (const k of manifest.kirtans) {
        const result = bundleKirtanSchema.safeParse(
          JSON.parse(await readFile(join(work, ...k.entry.split('/')), 'utf8')),
        );
        if (!result.success || result.data.content.presentationId !== k.id)
          throw new Error('The bundle has invalid kirtan data or references.');
        if (bundleMediaIds(result.data.content).some((id) => !mediaIds.has(id)))
          throw new Error('The bundle has an undescribed media reference.');
        kirtans.push(result.data);
      }
      return await use({
        manifest,
        kirtans,
        media: manifest.media.map((m) => ({
          ...m,
          path: m.entry ? join(work, ...m.entry.split('/')) : null,
        })),
      });
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
