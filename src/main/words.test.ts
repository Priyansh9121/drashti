import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * One name for each show action (Session 25): "Black-out", with its hyphen, in every window, on the
 * phones, in the menus and in the guides. "black out" as a verb ("does not black out the stream")
 * is fine; the name of the action, with a capital, is the hyphenated one.
 */

const app = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'screenshots' || name === 'examples' ? [] : files(path);
    return /\.(tsx?|html|md)$/u.test(name) ? [path] : [];
  });
}

describe('the show actions’ names', () => {
  it('say "Black-out", never "Black out", in the app, the phones’ pages and the guides', () => {
    const found = [...files(join(app, 'src')), ...files(join(app, 'docs')), join(app, 'README.md')]
      .filter((path) => !path.endsWith('words.test.ts'))
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .flatMap((line, i) =>
            line.includes('Black out') ? [`${relative(app, path)}:${String(i + 1)}`] : [],
          ),
      );
    expect(found).toEqual([]);
  });
});
