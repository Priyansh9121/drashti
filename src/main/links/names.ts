import { mkdir, open } from 'node:fs/promises';
import { extname, join } from 'node:path';

/*
 * Names for what Import from a Link saves (Session 25b): safe on a Mac and
 * on Windows whatever Dropbox called the file, and never one already in the
 * folder ("clip (2).mp4" instead).
 */

/** The characters Windows refuses in a name (a Mac refuses only "/" and ":" shows as "/"). */
const FORBIDDEN = /[<>:"/\\|?*]/gu;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is replaced
const CONTROL = /[\u0000-\u001f\u007f]/gu;
/** Windows' device names, which no file may be called (with any extension). */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/iu;
/** Bytes a name may take (both systems allow 255; room is left for " (2)" and a part-file's suffix). */
const MAX_BYTES = 200;

/** Cut a string to at most `bytes` bytes of UTF-8, never inside a character. */
function cutToBytes(text: string, bytes: number): string {
  let out = '';
  for (const ch of text) {
    if (Buffer.byteLength(out + ch) > bytes) break;
    out += ch;
  }
  return out;
}

/** A name safe on both systems: only its last part, no forbidden characters, short enough. */
export function safeName(raw: string, fallback: string): string {
  const last = raw.normalize('NFC').split(/[\\/]/u).pop() ?? '';
  let name = last.replace(CONTROL, '_').replace(FORBIDDEN, '_');
  // Windows drops trailing dots and spaces; a leading dot hides a file on a Mac.
  name = name.replace(/[. ]+$/u, '').replace(/^[. ]+/u, '');
  if (name === '') return fallback;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  if (RESERVED.test(stem === '' ? name : stem)) name = `_${name}`;
  if (Buffer.byteLength(name) > MAX_BYTES) {
    const keepExt = Buffer.byteLength(ext) <= 16 ? ext : '';
    name = cutToBytes(
      name.slice(0, name.length - ext.length),
      MAX_BYTES - Buffer.byteLength(keepExt),
    ).trimEnd();
    name = `${name}${keepExt}`;
  }
  return name;
}

/** "clip.mp4", then "clip (2).mp4", "clip (3).mp4"… */
function nth(name: string, n: number, isFolder: boolean): string {
  if (n === 1) return name;
  const ext = isFolder ? '' : extname(name);
  return `${name.slice(0, name.length - ext.length)} (${String(n)})${ext}`;
}

const exists = (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST';

/**
 * Take a name for a new file in `dir`: the name itself, or the first free
 * "name (n)". The file is created empty there, so no one else can take it;
 * the caller renames its finished download over it.
 */
export async function claimFile(dir: string, name: string): Promise<string> {
  for (let n = 1; n < 10_000; n++) {
    const path = join(dir, nth(name, n, false));
    try {
      const handle = await open(path, 'wx');
      await handle.close();
      return path;
    } catch (error) {
      if (!exists(error)) throw error;
    }
  }
  throw new Error('No free name');
}

/** Take a name for a new folder in `dir`, as claimFile does for a file. */
export async function claimFolder(dir: string, name: string): Promise<string> {
  for (let n = 1; n < 10_000; n++) {
    const path = join(dir, nth(name, n, true));
    try {
      await mkdir(path);
      return path;
    } catch (error) {
      if (!exists(error)) throw error;
    }
  }
  throw new Error('No free name');
}

/** The file name in a Content-Disposition header (filename* first, as RFC 6266 says), or null. */
export function nameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/iu.exec(header);
  if (star?.[2]) {
    try {
      return decodeURIComponent(star[2].trim());
    } catch {
      // Not valid percent-encoding: fall back to the plain filename.
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/iu.exec(header);
  if (quoted?.[1] !== undefined) return quoted[1].replace(/\\(.)/gu, '$1');
  const plain = /filename\s*=\s*([^;\s]+)/iu.exec(header);
  return plain?.[1] ?? null;
}
