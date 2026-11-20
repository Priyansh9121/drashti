import { open, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImportItemReport } from '../../shared/import';
import { itemsMadeBy } from '../../shared/import-items';
import type { M3uNotTaken } from '../../shared/m3u';
import type { NewItem } from '../../shared/playlists';

export class M3uError extends Error {}

export const M3U_MAX_BYTES = 1024 * 1024;
export const M3U_MAX_ENTRIES = 2000;
export interface M3uEntry {
  path: string;
  title: string | null;
  durationMs: number | null;
}
export interface M3uRead {
  entries: M3uEntry[];
  notTaken: M3uNotTaken[];
}
export interface M3uExportRow {
  path?: string;
  label: string;
  durationMs?: number | null;
  comment?: string;
}
const windowsPath = (file: string) => /^[a-z]:[\\/]/iu.test(file) || file.startsWith('\\\\');

/** Resolve another computer’s path with that platform’s rules, never as a web request. */
function localPath(entry: string, file: string): string | null {
  if (windowsPath(entry)) return win32.normalize(entry);
  if (/^file:/iu.test(entry)) {
    try {
      const url = new URL(entry);
      // A file URL with a remote host is not a file on this computer.
      if (url.hostname !== '' && url.hostname !== 'localhost') return null;
      return fileURLToPath(url, { windows: /^\/[a-z]:\//iu.test(url.pathname) });
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(entry) || entry.startsWith('//')) return null;
  if (entry.startsWith('/')) return posix.normalize(entry);
  // A drive-relative Windows path is not absolute; it must never silently name a file in Main’s cwd.
  if (/^[a-z]:/iu.test(entry)) return null;
  const paths = windowsPath(file) ? win32 : posix;
  return paths.resolve(paths.dirname(file), entry);
}

/** Reads local entries only. The parser has no network operation of any kind. */
export function parseM3u(text: string, file: string): M3uRead {
  if (Buffer.byteLength(text, 'utf8') > M3U_MAX_BYTES)
    throw new M3uError('A playlist file can be at most 1 MB.');
  const out: M3uRead = { entries: [], notTaken: [] };
  let title: string | null = null;
  let durationMs: number | null = null;
  let count = 0;
  for (const raw of text.replace(/^\uFEFF/u, '').split(/\r\n|\n|\r/u)) {
    const line = raw.trim();
    if (line === '') continue;
    if (/^#EXTINF:/iu.test(line)) {
      const comma = line.indexOf(',');
      const seconds = Number(line.slice(8, comma < 0 ? undefined : comma));
      title = comma >= 0 ? line.slice(comma + 1).trim() || null : null;
      durationMs = Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
      continue;
    }
    if (line.startsWith('#')) continue;
    count++;
    if (count > M3U_MAX_ENTRIES) throw new M3uError('A playlist file can name at most 2,000 entries.');
    const path = Array.from(line).some((character) => character.charCodeAt(0) < 32)
      ? null
      : localPath(line, file);
    if (path === null)
      out.notTaken.push({
        entry: line,
        reason: 'Not taken: only local files are imported; web addresses are never fetched.',
      });
    else out.entries.push({ path, title, durationMs });
    title = null;
    durationMs = null;
  }
  return out;
}

/** Read at most the allowed bytes, including if a file grows after it was picked. */
export async function readM3u(file: string): Promise<M3uRead> {
  const handle = await open(file, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new M3uError('Choose an M3U playlist file.');
    const bytes = Buffer.alloc(M3U_MAX_BYTES + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, null);
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
    }
    if (count > M3U_MAX_BYTES) throw new M3uError('A playlist file can be at most 1 MB.');
    return parseM3u(bytes.subarray(0, count).toString('utf8'), file);
  } finally {
    await handle.close();
  }
}

/** Existing import only: one queued run, then its results placed in the M3U’s order, including repeated files. */
export async function importM3u(
  file: string,
  audio: boolean,
  deps: {
    importFiles(paths: string[]): Promise<ImportItemReport[]>;
    isAudio(mediaId: string): boolean;
    make(name: string, rows: { item: NewItem; title: string | null }[], audio: boolean): Promise<string>;
  },
): Promise<{ id: string | null; notTaken: M3uNotTaken[] }> {
  const parsed = await readM3u(file);
  const local: M3uEntry[] = [];
  for (const entry of parsed.entries) {
    try {
      if (!(await stat(entry.path)).isFile()) throw new M3uError('not a file');
      local.push(entry);
    } catch {
      parsed.notTaken.push({ entry: entry.path, reason: 'Not taken: this file is not on this computer.' });
    }
  }
  const report = local.length ? await deps.importFiles([...new Set(local.map((e) => e.path))]) : [];
  const rows: { item: NewItem; title: string | null }[] = [];
  for (const entry of local) {
    const items = itemsMadeBy(report, [entry.path]);
    const taken = items.filter((i) => !audio || (i.kind === 'media' && deps.isAudio(i.mediaId)));
    if (!taken.length)
      parsed.notTaken.push({
        entry: entry.path,
        reason: audio
          ? 'Not taken: it did not become a sound in the library.'
          : 'Not taken: the import could not read this file.',
      });
    for (const item of taken) rows.push({ item, title: entry.title });
  }
  const paths = windowsPath(file) ? win32 : posix;
  const name =
    paths
      .basename(file)
      .replace(/\.m3u8?$/iu, '')
      .trim() || 'Imported playlist';
  return { id: rows.length ? await deps.make(name, rows, audio) : null, notTaken: parsed.notTaken };
}

/** UTF-8 extended M3U. Comments cannot inject entries, and every media path is absolute. */
export function writeM3u(rows: readonly M3uExportRow[]): string {
  if (rows.length > M3U_MAX_ENTRIES) throw new M3uError('An M3U playlist can name at most 2,000 entries.');
  const lines = ['#EXTM3U'];
  for (const row of rows) {
    const label = row.label.replace(/[\r\n]/gu, ' ').replaceAll(String.fromCharCode(0), ' ');
    if (!row.path) {
      lines.push(`# ${row.comment ?? 'Presentation'}: ${label}`);
      continue;
    }
    if (
      (!posix.isAbsolute(row.path) && !win32.isAbsolute(row.path)) ||
      /[\r\n]/u.test(row.path) ||
      row.path.includes(String.fromCharCode(0))
    )
      throw new M3uError('A library file’s full path could not be written.');
    const seconds = row.durationMs != null && row.durationMs >= 0 ? row.durationMs / 1000 : -1;
    lines.push(`#EXTINF:${String(seconds)},${label}`, row.path);
  }
  const text = lines.join('\n') + '\n';
  if (Buffer.byteLength(text, 'utf8') > M3U_MAX_BYTES)
    throw new M3uError('An M3U playlist can be at most 1 MB.');
  return text;
}
