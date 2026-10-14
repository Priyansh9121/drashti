import { crc32, deflateRawSync } from 'node:zlib';

/* For tests only: never imported by the app. */

export interface ZipWriterEntry {
  /** A name ending in "/" is a directory entry (its data is ignored). */
  name: string;
  data: string | Buffer;
  deflate?: boolean;
  utf8?: boolean;
  /** A Unix file mode (e.g. 0o120777, a symbolic link), as zip on a Mac or Linux writes it. */
  unixMode?: number;
  /**
   * Written as a stream would write it (general purpose bit 3, APPNOTE 6.3.10 §4.4.4): the local
   * header's CRC and sizes left as zero, and a data descriptor (§4.3.9) after the data instead.
   */
  descriptor?: boolean;
}

/** A minimal ZIP writer for the tests (stored or deflated entries, directories, data descriptors). */
export function makeZip(entries: ZipWriterEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const directory = e.name.endsWith('/');
    const raw = directory ? Buffer.alloc(0) : Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const deflate = e.deflate === true && !directory;
    const body = deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, e.utf8 === false ? 'latin1' : 'utf8');
    const flags = (e.utf8 === false ? 0 : 0x800) | (e.descriptor ? 0x8 : 0);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    if (!e.descriptor) {
      // With its CRC, so other programs (PowerPoint, Keynote) open it too.
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const parts: Buffer[] = [local, name, body];
    if (e.descriptor) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(body.length, 8);
      descriptor.writeUInt32LE(raw.length, 12);
      parts.push(descriptor);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    // Made by: version 2.0, on Unix (3) when it carries a Unix mode.
    central.writeUInt16LE(e.unixMode === undefined ? 20 : 0x0300 | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    // External attributes: a Unix mode in the high half; MS-DOS's directory bit (0x10) in the low.
    const unix = e.unixMode === undefined ? 0 : (e.unixMode << 16) >>> 0;
    central.writeUInt32LE((unix | (directory ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(...parts);
    centrals.push(central, name);
    offset += parts.reduce((sum, b) => sum + b.length, 0);
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * A zip made the way Dropbox makes a shared folder's (Session 26a; PLAN §6): its file list starts
 * with a spurious directory named "/" (the R package usethis ignores it when it unzips Dropbox's
 * zips, usethis.r-lib.org/reference/use_course_details.html), the folder's own files and subfolders
 * are loose parts with no single top folder, every folder has its own directory entry, and every
 * file is written as a stream (a data descriptor after it, the local header's sizes left out).
 * Files alternate between deflated and stored. `files` are paths inside the folder, "a/b/c.mp4".
 */
export function makeDropboxLikeZip(files: { path: string; data: string | Buffer }[]): Buffer {
  const entries: ZipWriterEntry[] = [{ name: '/', data: '', descriptor: true }];
  const folders = new Set<string>();
  files.forEach((f, i) => {
    const parts = f.path.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      const folder = `${parts.slice(0, depth).join('/')}/`;
      if (folders.has(folder)) continue;
      folders.add(folder);
      entries.push({ name: folder, data: '', descriptor: true });
    }
    entries.push({ name: f.path, data: f.data, descriptor: true, deflate: i % 2 === 0 });
  });
  return makeZip(entries);
}
