import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDES, type GuideId, guidePictureName } from '../shared/guides';
import { imagesOf, parseMarkdown } from '../shared/markdown';

/*
 * The guides' files (Phase B of Sessions 31–36): beside an installed Drashti in resources/guides (electron-
 * builder.yml's extraResources: the four guides and only the pictures they show), and docs/ in the
 * repository. Read by the main process only, for the operator window through the bridge: nothing serves
 * them to phones, and nothing is ever fetched.
 */

export function guidesDir(p: { packaged: boolean; resourcesPath: string; appPath: string }): string {
  return p.packaged ? join(p.resourcesPath, 'guides') : join(p.appPath, 'docs');
}

export class GuideFiles {
  private pictures: Set<string> | null = null;

  constructor(readonly dir: string) {}

  /** A guide's Markdown, or null when its file is missing or cannot be read. */
  read(id: GuideId): string | null {
    const guide = GUIDES.find((g) => g.id === id);
    if (!guide) return null;
    try {
      return readFileSync(join(this.dir, guide.file), 'utf8');
    } catch {
      return null;
    }
  }

  /** The pictures the four guides show (their names). */
  pictureNames(): Set<string> {
    this.pictures ??= new Set(
      GUIDES.flatMap((g) => {
        const text = this.read(g.id);
        return text === null ? [] : imagesOf(parseMarkdown(text));
      })
        .map(guidePictureName)
        .filter((n): n is string => n !== null),
    );
    return this.pictures;
  }

  /** A picture a guide shows: its file, or null for any other name (or one not there). */
  picture(name: string): string | null {
    if (!this.pictureNames().has(name)) return null;
    const file = join(this.dir, 'screenshots', name);
    return existsSync(file) ? file : null;
  }

  /** The size of each picture a guide's text shows (width, height), from its PNG header. */
  sizesFor(text: string): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const src of imagesOf(parseMarkdown(text))) {
      const name = guidePictureName(src);
      const file = name ? this.picture(name) : null;
      const size = file ? pngSize(file) : null;
      if (name && size) out[name] = size;
    }
    return out;
  }
}

/** A PNG's width and height, from its first 24 bytes (the IHDR chunk), or null. */
export function pngSize(file: string): [number, number] | null {
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    const head = Buffer.alloc(24);
    if (readSync(fd, head, 0, 24, 0) < 24 || head.readUInt32BE(12) !== 0x49484452) return null;
    return [head.readUInt32BE(16), head.readUInt32BE(20)];
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
