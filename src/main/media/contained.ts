import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

/*
 * Whether a file is inside a folder, by both their real paths (Sessions 31–36, SEC-10): a link inside the
 * media folder that leads out of it is out. The media scheme, the phones' previews and a node's copies all
 * ask here. Real paths also make Windows' short names (RUNNER~1) and macOS's /var (/private/var) agree.
 */

/** True when `file` is inside `dir`, comparing the paths as given (real paths, for a real answer). */
export function isInside(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== '' && !isAbsolute(rel) && rel.split(sep)[0] !== '..';
}

/** Where `file` really is, and whether that is inside `dir` (both real); null when either is not there. */
export interface RealPlace {
  path: string;
  inside: boolean;
}

export function realPlace(dir: string, file: string): RealPlace | null {
  try {
    const real = realpathSync.native(file);
    return { path: real, inside: isInside(realpathSync.native(dir), real) };
  } catch {
    return null;
  }
}

/** The same, without blocking: the media scheme answers every picture the screens draw. */
export async function realPlaceAsync(dir: string, file: string): Promise<RealPlace | null> {
  try {
    const [realDir, real] = await Promise.all([realpath(dir), realpath(file)]);
    return { path: real, inside: isInside(realDir, real) };
  } catch {
    return null;
  }
}
