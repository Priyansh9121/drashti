import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/*
 * The browser pages' files, served by name only. At start the server lists
 * the built pages and their assets once; a request is answered only if its
 * path is exactly one of those names, so no path (with "..", encoded or not)
 * can reach a file outside them, and nothing else on the disk is served.
 * Library media is never served by path: by id only, through the main
 * process (see server.ts).
 */

/** The pages devices open, by the path a phone types or a QR code opens. */
export const WEB_PAGES: Record<string, string> = {
  '/': 'pair.html',
  '/pair': 'pair.html',
  '/remote': 'remote.html',
  '/stage': 'stage-display.html',
  '/announce': 'announce.html',
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

export interface WebFile {
  file: string;
  type: string;
  bytes: number;
  /** Hashed asset names never change, so they can be cached for good. */
  immutable: boolean;
}

/**
 * A request path as given (before any decoding) is plainly a path: no
 * dot segments, back slashes, NULs, or encoded ones of those.
 */
export function safeRequestPath(raw: string): string | null {
  const path = raw.split('?')[0] ?? '';
  if (path.length === 0 || path.length > 300 || !path.startsWith('/')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (/[\\\0]/u.test(decoded) || decoded.includes('//')) return null;
  if (decoded.split('/').some((part) => part === '..' || part === '.')) return null;
  // Anything that decodes differently is refused too (double encoding, encoded slashes).
  if (decoded !== path && /%2e|%2f|%5c|%00|%25/iu.test(path)) return null;
  return decoded;
}

/**
 * An API request's path as segments, each decoded on its own, so an id may
 * hold an encoded "/" or "#" (a Shastra passage's id does): the API never
 * maps a path to a file, so only plain segments are needed. Null when a
 * segment is not plainly one (dot segments, back slashes, NULs, bad
 * encoding), or the path is too long.
 */
export function apiSegments(raw: string): string[] | null {
  const path = raw.split('?')[0] ?? '';
  if (path.length === 0 || path.length > 1200 || !path.startsWith('/')) return null;
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '') continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    // No dot segments, even inside one segment ("..%2F" is "../").
    if (/[\\\0]/u.test(decoded) || decoded.split('/').some((p) => p === '..' || p === '.')) return null;
    out.push(decoded);
  }
  return out;
}

/** The files the pages need: the pages themselves and everything under assets/. */
export function listWebFiles(webDir: string): Map<string, WebFile> {
  const files = new Map<string, WebFile>();
  const add = (urlPath: string, file: string, immutable: boolean) => {
    const type = TYPES[extname(file).toLowerCase()];
    if (!type) return;
    try {
      const s = statSync(file);
      if (s.isFile()) files.set(urlPath, { file, type, bytes: s.size, immutable });
    } catch {
      // Not built (yet): left out.
    }
  };
  for (const [urlPath, page] of Object.entries(WEB_PAGES)) add(urlPath, join(webDir, page), false);
  let assets: string[] = [];
  try {
    assets = readdirSync(join(webDir, 'assets'));
  } catch {
    // No assets folder: nothing more to serve.
  }
  for (const name of assets) add(`/assets/${name}`, join(webDir, 'assets', name), true);
  return files;
}
