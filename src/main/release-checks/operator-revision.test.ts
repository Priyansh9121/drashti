import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('operator render hooks never subscribe to the wire revision ahead of the published scene', () => {
  // Commands need the current wire revision, but operator pictures must advance with their published state.
  // A wire-revision hook wakes React on Go cleanup even when engine-store holds that scene publication.
  const offenders: string[] = [];
  for (const directory of ['operator', 'practice', 'screens']) {
    const root = fileURLToPath(new URL(`../../renderer/src/${directory}/`, import.meta.url));
    for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx?$/.test(entry) || entry.includes('.test.')) continue;
      const source = readFileSync(`${root}/${entry}`, 'utf8');
      if (/useEngine\(\s*\(?(\w+)\)?\s*=>\s*\1\.rev\s*\)/.test(source)) {
        offenders.push(`${directory}/${entry}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
