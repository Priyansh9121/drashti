import { readZipEntries } from '../zip';
import { copyZipReplacing } from './zip-copy';

/*
 * A deck sent from a phone (Session 54, C review: D4's "may add files"): a .pptx may name files outside it
 * (TargetMode="External": a linked video, sound or picture), and PowerPoint draws or plays what it names, from
 * anywhere on this computer. Its copy for PowerPoint and Drashti has every such link made a dead end, so nothing
 * of this computer's own comes in through it; links a person clicks (hyperlinks) stay as they are.
 */

/** What a dead link names: no file anywhere. */
export const NO_FILE = 'no file';

/** A relationships part with every link to a file outside the deck made a dead end, and how many there were. */
export function deadLinks(rels: string): { xml: string; count: number } {
  let count = 0;
  const xml = rels.replace(/<Relationship\b[^>]*>/gu, (tag) => {
    if (!/\bTargetMode\s*=\s*(["'])External\1/u.test(tag)) return tag;
    if (/\bType\s*=\s*(["'])[^"']*\/hyperlink\1/u.test(tag)) return tag;
    count++;
    return tag.replace(/\bTarget\s*=\s*(["'])[^"']*\1/u, `Target="${NO_FILE}"`);
  });
  return { xml, count };
}

/** Copy a .pptx with every link to a file outside it made a dead end; returns how many links there were. */
export async function withoutOutsideLinks(deck: string, copy: string): Promise<number> {
  const parts = await readZipEntries(deck, (name) => name.endsWith('.rels'));
  const replace = new Map<string, Buffer>();
  let count = 0;
  for (const [name, bytes] of parts) {
    const dead = deadLinks(bytes.toString('utf8'));
    if (dead.count === 0) continue;
    count += dead.count;
    replace.set(name, Buffer.from(dead.xml, 'utf8'));
  }
  await copyZipReplacing(deck, copy, replace);
  return count;
}
