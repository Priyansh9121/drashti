import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readDeckAnimations, writeDeckAnimations } from './deck-setting';

/*
 * Decks With Their Animations on This Computer (Session 54, C review): on by default on a Mac, off on Windows until
 * the mandir PC has passed its try-list (assister/session-54-deck-trial.md), kept for this computer (a library
 * restored elsewhere does not bring it), anyone's to change in File.
 */

const dir = mkdtempSync(join(tmpdir(), 'drashti-deck-setting-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('decks with their animations on this computer', () => {
  it('is on on a Mac and off on Windows until it is changed, and kept as changed', () => {
    const fresh = mkdtempSync(join(dir, 'fresh-'));
    expect(readDeckAnimations(fresh, 'darwin')).toBe(true);
    expect(readDeckAnimations(fresh, 'win32')).toBe(false);
    writeDeckAnimations(fresh, true);
    expect(readDeckAnimations(fresh, 'win32')).toBe(true);
    writeDeckAnimations(fresh, false);
    expect(readDeckAnimations(fresh, 'darwin')).toBe(false);
  });

  it('reads a damaged file as the system’s own default', () => {
    const damaged = mkdtempSync(join(dir, 'damaged-'));
    writeFileSync(join(damaged, 'deck-animations.json'), 'not json');
    expect(readDeckAnimations(damaged, 'darwin')).toBe(true);
    expect(readDeckAnimations(damaged, 'win32')).toBe(false);
  });
});
