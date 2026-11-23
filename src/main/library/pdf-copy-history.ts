import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BigIntStats } from 'node:fs';
interface Copy {
  path: string;
  hidden: string;
  identity: BigIntStats;
  hash: string;
  visible: boolean;
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const same = (a: BigIntStats, b: BigIntStats) =>
  a.isFile() &&
  !a.isSymbolicLink() &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs;

/** Only Main-created, new output files enter this history. Never unlinks an unknown replacement. */
export class PdfCopyHistory {
  private copies = new Map<string, Copy>();
  private busy = false;
  async keep(path: string): Promise<string> {
    const canonical = await realpath(path);
    const identity = await lstat(canonical, { bigint: true });
    if (!identity.isFile() || identity.isSymbolicLink() || identity.size > 64n * 1024n * 1024n)
      throw new Error('The generated PDF changed.');
    const hash = digest(await readFile(canonical));
    if (!same(identity, await lstat(canonical, { bigint: true })))
      throw new Error('The generated PDF changed.');
    const id = randomUUID();
    this.copies.set(id, {
      path: canonical,
      hidden: join(dirname(canonical), `.drashti-pdf-undo-${id}.tmp`),
      identity,
      hash,
      visible: true,
    });
    return id;
  }
  private async matches(copy: Copy, path: string): Promise<boolean> {
    try {
      return (
        same(copy.identity, await lstat(path, { bigint: true })) &&
        digest(await readFile(path)) === copy.hash &&
        same(copy.identity, await lstat(path, { bigint: true }))
      );
    } catch {
      return false;
    }
  }
  async show(id: string, visible: boolean): Promise<boolean> {
    const copy = this.copies.get(id);
    if (!copy || copy.visible === visible || this.busy) return false;
    this.busy = true;
    try {
      if (visible) {
        if (!(await this.matches(copy, copy.hidden))) return false;
        // link is exclusive: a file placed at the output name is never overwritten by Redo.
        await link(copy.hidden, copy.path);
        copy.visible = true;
        await unlink(copy.hidden);
        return true;
      }
      if (!(await this.matches(copy, copy.path))) return false;
      // Move first, then verify again before considering the file removed. Keep changed files intact.
      await rename(copy.path, copy.hidden);
      if (!(await this.matches(copy, copy.hidden))) {
        try {
          await link(copy.hidden, copy.path);
          await unlink(copy.hidden);
        } catch {
          /* Keep unknown bytes at the private name if another output appeared. */
        }
        return false;
      }
      copy.visible = false;
      return true;
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
  }
}
