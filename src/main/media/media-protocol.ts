import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { MEDIA_ID_PATTERN, MEDIA_SCHEME } from '../../shared/media';
import { extOf } from '../import/scan';

/*
 * The main-process side of drashti-media://. A window asks for
 * drashti-media://media/<id> (the file) or drashti-media://still/<id> (its
 * still frame, for thumbnails); the library says which file that is, and it
 * is streamed with byte ranges, so video can seek. Whatever the library
 * says, nothing outside the media folder is served: every refusal is a 404.
 */

/** What the library knows about a media item's file. */
export interface MediaFileRow {
  /** Relative to the media folder ('' while the file is missing). */
  path: string;
  missing: boolean;
  /** The file's sha256, which names its still frame; null while missing. */
  sha256: string | null;
}

/** Where a media item's still frame is kept, relative to the media folder. */
export function stillPath(sha256: string): string {
  return `stills/${sha256}.jpg`;
}

export interface MediaProtocolDeps {
  /** The media folder. */
  mediaDir: string;
  lookup: (mediaId: string) => MediaFileRow | null;
  /** Told about refusals that point at a broken or tampered library. */
  warn?: (message: string) => void;
}

/**
 * How Chromium must treat the scheme: like https for loading, streamable for
 * video, and with CORS, so the operator window can draw a video frame on a
 * canvas and read it back to make a still. Only Drashti's own pages can
 * reach the scheme (windows cannot navigate or load anything else).
 */
export const MEDIA_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  corsEnabled: true,
} as const;

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  mkv: 'video/x-matroska',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  webm: 'video/webm',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wma: 'audio/x-ms-wma',
};

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extOf(path)] ?? 'application/octet-stream';
}

/** True when `file` is inside `dir` (both through the same realpath, so links and short names agree). */
export function isInside(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== '' && !isAbsolute(rel) && rel.split(sep)[0] !== '..';
}

export interface MediaRequest {
  what: 'media' | 'still';
  mediaId: string;
}

/** What a drashti-media:// URL asks for, or null if it is not a URL Drashti makes. */
export function mediaRequestOf(url: string): MediaRequest | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const what = parsed.hostname;
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || (what !== 'media' && what !== 'still')) return null;
  const mediaId = parsed.pathname.slice(1);
  return MEDIA_ID_PATTERN.test(mediaId) ? { what, mediaId } : null;
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * The bytes a Range header asks for (end inclusive). null serves the whole
 * file: no header, or one Drashti does not serve (several ranges, or not
 * valid), which HTTP allows a server to ignore. 'unsatisfiable' is a 416.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (header === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const first = m[1] ?? '';
  const last = m[2] ?? '';
  if (first === '' && last === '') return null;
  if (first === '') {
    // The last n bytes.
    const n = Number(last);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(first);
  if (last !== '' && Number(last) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: last === '' ? size - 1 : Math.min(Number(last), size - 1) };
}

function refused(status: 404 | 405): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (status === 405) headers['Allow'] = 'GET, HEAD';
  return new Response(null, { status, headers });
}

const SHA256 = /^[0-9a-f]{64}$/;

/** The file a request asks for, if it is a regular file inside the media folder. */
async function fileFor(
  { what, mediaId }: MediaRequest,
  deps: MediaProtocolDeps,
): Promise<{ path: string; size: number } | null> {
  const found = deps.lookup(mediaId);
  if (!found || found.missing) return null;
  let row: { path: string };
  if (what === 'media') row = found;
  else if (found.sha256 && SHA256.test(found.sha256)) row = { path: stillPath(found.sha256) };
  else return null;
  if (row.path === '') return null;
  // Library paths are relative to the media folder; anything else was not written by Drashti.
  if (isAbsolute(row.path)) {
    deps.warn?.(`Media ${mediaId} points outside the media folder; not served.`);
    return null;
  }
  let dir: string;
  let real: string;
  try {
    // One realpath for both: Windows short names (RUNNER~1) and macOS /var -> /private/var then agree.
    [dir, real] = await Promise.all([realpath(deps.mediaDir), realpath(join(deps.mediaDir, row.path))]);
  } catch {
    return null;
  }
  if (!isInside(dir, real)) {
    deps.warn?.(`Media ${mediaId} points outside the media folder; not served.`);
    return null;
  }
  const s = await stat(real).catch(() => null);
  return s?.isFile() ? { path: real, size: s.size } : null;
}

/** Answer one drashti-media:// request. */
export async function handleMediaRequest(request: Request, deps: MediaProtocolDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return refused(405);
  const asked = mediaRequestOf(request.url);
  const file = asked === null ? null : await fileFor(asked, deps);
  if (!file) return refused(404);

  const headers = new Headers({
    'Content-Type': contentTypeOf(file.path),
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    // Readable by Drashti's own pages (the only ones that can load the scheme), for making stills.
    'Access-Control-Allow-Origin': '*',
  });
  const range = parseRange(request.headers.get('Range'), file.size);
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }
  const { start, end } = range ?? { start: 0, end: file.size - 1 };
  const length = end - start + 1;
  headers.set('Content-Length', String(length));
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`);
  const status = range ? 206 : 200;
  if (request.method === 'HEAD' || length === 0) return new Response(null, { status, headers });
  const stream = createReadStream(file.path, { start, end, highWaterMark: 256 * 1024 });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
}
