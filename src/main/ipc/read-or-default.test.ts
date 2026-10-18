import { describe, expect, it } from 'vitest';
import { readOrDefault } from './read-or-default';

/*
 * A read a window waits on before it shows anything (Session 38): always answered, the default when it
 * throws, and why said once (again only after it was read in between).
 */

describe('readOrDefault', () => {
  it('answers what it reads, and the default with why, once, while the read keeps failing', () => {
    let stored: boolean | Error = false;
    const said: string[] = [];
    const keysOn = readOrDefault(
      () => {
        if (stored instanceof Error) throw stored;
        return stored;
      },
      true,
      (error) => said.push(String(error)),
    );
    expect(keysOn()).toBe(false);
    stored = new Error('a refused read of the library');
    expect(keysOn()).toBe(true);
    expect(keysOn()).toBe(true);
    expect(said).toEqual(['Error: a refused read of the library']);
    // Read again: as stored. A failure after that is said again.
    stored = false;
    expect(keysOn()).toBe(false);
    stored = new Error('refused again');
    expect(keysOn()).toBe(true);
    expect(said).toEqual(['Error: a refused read of the library', 'Error: refused again']);
  });
});
