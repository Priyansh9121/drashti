import { createWriteStream } from 'node:fs';
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, inflateRawSync } from 'node:zlib';

/*
 * Reading ZIP archives: presentation bundles and playlist exports are ZIP
 * files. Entries are streamed from the archive to disk, so a bundle full of
 * videos never has to fit in memory. Stored and deflated entries, ZIP64,
 * UTF-8 names. Entries that would land outside the target folder are refused.
 */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Where the entry's local header starts. */
  offset: number;
  isDirectory: boolean;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX32 = 0xffffffff;

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

const u64 = (buf: Buffer, at: number) => Number(buf.readBigUInt64LE(at));

/** The entries in a ZIP file, from its central directory. */
export async function listZip(path: string): Promise<ZipEntry[]> {
  const fh = await open(path, 'r');
  try {
    return await listOpen(fh);
  } finally {
    await fh.close();
  }
}

async function listOpen(fh: FileHandle): Promise<ZipEntry[]> {
  const { size: fileSize } = await fh.stat();
  const tailLength = Math.min(fileSize, 65_557);
  const tail = await readAt(fh, fileSize - tailLength, tailLength);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new ZipError('Not a ZIP archive (no end of central directory).');
  let count = tail.readUInt16LE(at + 10);
  let cdSize = tail.readUInt32LE(at + 12);
  let cdOffset = tail.readUInt32LE(at + 16);
  if (count === 0xffff || cdSize === MAX32 || cdOffset === MAX32) {
    const locatorAt = at - 20;
    if (locatorAt < 0 || tail.readUInt32LE(locatorAt) !== EOCD64_LOCATOR)
      throw new ZipError('Broken ZIP64 archive.');
    const eocd64 = await readAt(fh, u64(tail, locatorAt + 8), 56);
    if (eocd64.readUInt32LE(0) !== EOCD64) throw new ZipError('Broken ZIP64 archive.');
    count = u64(eocd64, 32);
    cdSize = u64(eocd64, 40);
    cdOffset = u64(eocd64, 48);
  }
  const cd = await readAt(fh, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let e = 0; e < count; e++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CENTRAL) throw new ZipError('Broken central directory.');
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    let compressedSize = cd.readUInt32LE(p + 20);
    let size = cd.readUInt32LE(p + 24);
    const nameLength = cd.readUInt16LE(p + 28);
    const extraLength = cd.readUInt16LE(p + 30);
    const commentLength = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const rawName = cd.subarray(p + 46, p + 46 + nameLength);
    // Bit 11: the name is UTF-8; otherwise it is in the DOS code page (read as Latin-1).
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    const extra = cd.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
    for (let x = 0; x + 4 <= extra.length;) {
      const id = extra.readUInt16LE(x);
      const len = extra.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let y = x + 4;
        if (size === MAX32) {
          size = u64(extra, y);
          y += 8;
        }
        if (compressedSize === MAX32) {
          compressedSize = u64(extra, y);
          y += 8;
        }
        if (offset === MAX32) offset = u64(extra, y);
      }
      x += 4 + len;
    }
    if (flags & 0x1) throw new ZipError('Encrypted ZIP archives are not supported.');
    entries.push({ name, method, compressedSize, size, offset, isDirectory: name.endsWith('/') });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** A safe path for an entry inside `root`, or null for names that would leave it. */
export function entryPath(root: string, name: string): string | null {
  const parts = name.replace(/\\/gu, '/').split('/');
  if (parts.some((part) => part === '..') || name.startsWith('/') || /^[A-Za-z]:/u.test(name)) return null;
  const full = resolve(root, ...parts.filter((part) => part !== '' && part !== '.'));
  const base = resolve(root);
  return full === base || full.startsWith(base + sep) ? full : null;
}

/** Stops a stream that produces more bytes than it may (a damaged or hostile archive). */
function limit(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > max) done(new ZipError('An entry is bigger than the archive says.'));
      else done(null, chunk);
    },
  });
}

export interface ExtractResult {
  /** Extracted files, full paths. */
  files: string[];
  /** Entries left out, with why. */
  skipped: { name: string; reason: string }[];
  bytes: number;
}

/**
 * Extract every file of a ZIP archive into `dest` (which should be empty).
 * Refuses when the uncompressed total is over `maxBytes`. macOS resource
 * forks (__MACOSX/) and .DS_Store files are left out.
 */
export async function extractZip(
  path: string,
  dest: string,
  options: { maxBytes?: number } = {},
): Promise<ExtractResult> {
  const fh = await open(path, 'r');
  try {
    const entries = await listOpen(fh);
    const total = entries.reduce((sum, e) => sum + (e.isDirectory ? 0 : e.size), 0);
    if (options.maxBytes !== undefined && total > options.maxBytes) {
      throw new ZipError(`The archive holds ${total} bytes, more than the ${options.maxBytes} that fit.`);
    }
    const result: ExtractResult = { files: [], skipped: [], bytes: 0 };
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (entry.name.startsWith('__MACOSX/') || entry.name.split('/').pop() === '.DS_Store') continue;
      const target = entryPath(dest, entry.name);
      if (!target) {
        result.skipped.push({ name: entry.name, reason: 'its path would leave the archive folder' });
        continue;
      }
      if (entry.method !== 0 && entry.method !== 8) {
        result.skipped.push({
          name: entry.name,
          reason: `compression method ${entry.method} is not supported`,
        });
        continue;
      }
      const local = await readAt(fh, entry.offset, 30);
      if (local.length < 30 || local.readUInt32LE(0) !== LOCAL)
        throw new ZipError(`Broken entry ${entry.name}.`);
      const dataStart = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      await mkdir(dirname(target), { recursive: true });
      const raw = Readable.from(chunks(fh, dataStart, entry.compressedSize));
      const out = createWriteStream(target);
      if (entry.method === 8) await pipeline(raw, createInflateRaw(), limit(entry.size), out);
      else await pipeline(raw, limit(entry.size), out);
      result.files.push(target);
      result.bytes += entry.size;
    }
    return result;
  } finally {
    await fh.close();
  }
}

async function* chunks(fh: FileHandle, start: number, length: number): AsyncGenerator<Buffer> {
  const size = 1024 * 1024;
  for (let done = 0; done < length;) {
    const buf = await readAt(fh, start + done, Math.min(size, length - done));
    if (buf.length === 0) throw new ZipError('The archive ends early.');
    done += buf.length;
    yield buf;
  }
}

/**
 * Read the entries `want` picks into memory (a document's small XML files), each at most `maxBytes`
 * once inflated; bigger ones, and ones in a compression Drashti does not read, are left out.
 */
export async function readZipEntries(
  path: string,
  want: (name: string) => boolean,
  maxBytes = 8 * 1024 * 1024,
): Promise<Map<string, Buffer>> {
  const fh = await open(path, 'r');
  try {
    const out = new Map<string, Buffer>();
    for (const entry of await listOpen(fh)) {
      if (entry.isDirectory || !want(entry.name) || entry.size > maxBytes || entry.compressedSize > maxBytes)
        continue;
      if (entry.method !== 0 && entry.method !== 8) continue;
      const local = await readAt(fh, entry.offset, 30);
      if (local.length < 30 || local.readUInt32LE(0) !== LOCAL)
        throw new ZipError(`Broken entry ${entry.name}.`);
      const dataStart = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const raw = await readAt(fh, dataStart, entry.compressedSize);
      out.set(entry.name, entry.method === 8 ? inflateRawSync(raw, { maxOutputLength: maxBytes }) : raw);
    }
    return out;
  } finally {
    await fh.close();
  }
}
