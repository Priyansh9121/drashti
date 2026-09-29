import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEYMAP } from '../shared/keymap';

describe("the volunteers' key card (docs/parallel-run.md)", () => {
  it('lists every key in the keymap, so it never drifts from it', () => {
    const guide = readFileSync(join(__dirname, '..', '..', 'docs', 'parallel-run.md'), 'utf8');
    const card = guide.slice(guide.indexOf('## Keys at a glance'));
    const names: Record<string, string> = {
      ArrowRight: '→',
      ArrowLeft: '←',
      ArrowUp: '↑',
      ArrowDown: '↓',
      PageDown: 'Page Down',
      PageUp: 'Page Up',
    };
    const written = (key: string) =>
      key
        .split('+')
        .map((part) => (part === 'Mod' ? 'Cmd' : (names[part] ?? part)))
        .join('+');
    const missing = KEYMAP.flatMap((b) => b.keys)
      .map(written)
      .filter((k) => !card.includes(`**${k}**`));
    expect(missing).toEqual([]);
  });
});
