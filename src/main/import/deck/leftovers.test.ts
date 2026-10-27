import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { clearDeckLeftovers } from './leftovers';

/*
 * What a deck's import left behind when Drashti stopped in the middle (Session 54, C review): the copies in
 * PowerPoint's own folder (Office's Drashti/convert-*) and the import's work folders (drashti-pictures-*), cleared
 * at the next start; nothing else of those folders.
 */

const dir = mkdtempSync(join(tmpdir(), 'drashti-deck-leftovers-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('a deck’s leftovers', () => {
  it('are cleared at the start, and nothing else', async () => {
    const office = join(dir, 'Office Drashti');
    const temp = join(dir, 'Temp');
    for (const d of [
      join(office, 'convert-AbC123'),
      join(office, 'Placeholder kept'),
      join(temp, 'drashti-pictures-XyZ789', 'bake-1'),
      join(temp, 'drashti-bundle-Kept'),
    ])
      mkdirSync(d, { recursive: true });
    writeFileSync(join(office, 'convert-AbC123', 'Placeholder (Drashti copy 1234).pptx'), 'placeholder');
    writeFileSync(join(temp, 'drashti-pictures-XyZ789', 'bake-1', 'movie.mov'), 'placeholder');
    expect(await clearDeckLeftovers({ office, temp })).toBe(2);
    expect(existsSync(join(office, 'convert-AbC123'))).toBe(false);
    expect(existsSync(join(temp, 'drashti-pictures-XyZ789'))).toBe(false);
    expect(existsSync(join(office, 'Placeholder kept'))).toBe(true);
    expect(existsSync(join(temp, 'drashti-bundle-Kept'))).toBe(true);
    // Folders that are not there are no trouble.
    expect(await clearDeckLeftovers({ office: join(dir, 'none'), temp: join(dir, 'none either') })).toBe(0);
  });
});
