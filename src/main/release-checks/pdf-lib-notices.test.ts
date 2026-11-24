import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(path, 'utf8');
it('ships the complete installed PDF writer licences and the zlib notice on both systems', () => {
  for (const [name, file, shipped] of [
    ['pdf-lib', 'LICENSE.md', 'pdf-lib-MIT.txt'],
    ['@pdf-lib/standard-fonts', 'LICENSE.md', 'standard-fonts-MIT.txt'],
    ['@pdf-lib/upng', 'LICENSE', 'upng-MIT.txt'],
    ['pako', 'LICENSE', 'pako-MIT.txt'],
    ['tslib', 'LICENSE.txt', 'tslib-0BSD.txt'],
  ]) {
    expect(read(join('LICENSES/pdf-lib', shipped))).toBe(
      read(join(dirname(require.resolve(`${name}/package.json`)), file)),
    );
  }
  const zlib = read('LICENSES/pdf-lib/pako-Zlib.txt');
  expect(zlib).toContain('Copyright (C) 1995-2013 Jean-loup Gailly and Mark Adler');
  expect(zlib).toContain('This notice may not be removed or altered from any source distribution.');
  expect(read('electron-builder.yml')).toMatch(/from: LICENSES\s+to: licenses/);
});
