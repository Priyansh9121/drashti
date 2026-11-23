import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { publishExclusive, type PdfCopyReceipt } from './pdf-copy-file';
import type { BigIntStats } from 'node:fs';
interface Copy {
  path: string;
  hidden: string;
  identity: BigIntStats;
  hash: string;
  visible: boolean;
  /** On a volume without hard links (PdfCopyReceipt.copied): a renamed file gets a new number there. */
  copied: boolean;
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** The same file: on a volume without hard links its number is not compared (it changes with its name there). */
const same = (a: BigIntStats, b: BigIntStats, numbered = true) =>
  a.isFile() &&
  !a.isSymbolicLink() &&
  a.dev === b.dev &&
  (!numbered || a.ino === b.ino) &&
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
      copied: expected.copied === true,
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
        same(copy.identity, await lstat(path, { bigint: true }), !copy.copied) &&
        digest(await readFile(path)) === copy.hash &&
        same(copy.identity, await lstat(path, { bigint: true }), !copy.copied)
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
        // Exclusive (a link, or a copy where the volume has none): a file placed at the output name is never
        // overwritten by Redo. A copy is a new file: its bytes are checked and it is the one Undo takes away next.
        if (await publishExclusive(copy.hidden, copy.path)) {
          const before = copy.identity;
          copy.identity = await lstat(copy.path, { bigint: true });
          copy.copied = true;
          if (!(await this.matches(copy, copy.path))) {
            copy.identity = before;
            return false;
          }
        }
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
          await publishExclusive(copy.hidden, copy.path);
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
