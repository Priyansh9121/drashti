import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PdfCopyReceipt } from './pdf-copy-file';
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
  async keep(path: string, expected: PdfCopyReceipt): Promise<string> {
    const canonical = await realpath(path);
    const identity = await lstat(canonical, { bigint: true });
    if (!identity.isFile() || identity.isSymbolicLink() || identity.size > 64n * 1024n * 1024n)
      throw new Error('The generated PDF changed.');
    const hash = digest(await readFile(canonical));
    if (
      !same(expected.identity, identity) ||
      hash !== expected.hash ||
      !same(identity, await lstat(canonical, { bigint: true }))
    )
      throw new Error('The generated PDF changed.');
    const id = randomUUID();
    this.copies.set(id, {
      path: canonical,
      hidden: join(dirname(canonical), `.drashti-pdf-undo-${id}.tmp`),
      identity,
      hash,
      visible: true,
    });
    while (this.copies.size > 200) {
      const oldest = this.copies.entries().next().value;
      if (!oldest) break;
      await this.discard(oldest[1]);
      this.copies.delete(oldest[0]);
    }
    return id;
  }
  private async discard(copy: Copy): Promise<void> {
    if (!copy.visible && (await this.matches(copy, copy.hidden))) {
      try {
        await unlink(copy.hidden);
      } catch {
        /* Leave the owned Undo file when its folder is unavailable. */
      }
    }
  }
  async stop(): Promise<void> {
    for (const copy of this.copies.values()) await this.discard(copy);
    this.copies.clear();
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
  async show(id: string, visible: boolean, current: () => boolean = () => true): Promise<boolean> {
    const copy = this.copies.get(id);
    if (!copy || copy.visible === visible || this.busy || !current()) return false;
    this.busy = true;
    try {
      if (visible) {
        if (!(await this.matches(copy, copy.hidden)) || !current()) return false;
        // link is exclusive: a file placed at the output name is never overwritten by Redo.
        await link(copy.hidden, copy.path);
        copy.visible = true;
        try {
          await unlink(copy.hidden);
        } catch {
          /* The restored output is already committed. */
        }
        return true;
      }
      if (!(await this.matches(copy, copy.path)) || !current()) return false;
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
