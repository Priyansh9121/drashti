import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('keymap', () => {
  // Only the keymap names a key (its header): a key hint drawn with Cmd, Option, Shift or Control written out by hand
  // drifts from it (a25 item 25: the component gallery's "⌘⇧S" after keyplat's Apple order made it ⇧⌘S).
  it('is the only place a window’s key hints come from: no <Kbd> writes a modifier sign by hand', () => {
    const root = join(__dirname, '..', 'renderer', 'src');
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.tsx') ? [join(dir, d.name)] : [],
      );
    const byHand = files(root).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/<Kbd\b[^>]*>[^<{]*[⌘⌥⇧⌃][^<]*<\/Kbd>/gu)].map(
        (m) => `${file.slice(root.length + 1)}: ${m[0]}`,
      ),
    );
    expect(byHand).toEqual([]);
  });
});
