import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isOldRolesFile, removeOldRoles } from './old-roles';

/*
 * Roles and PINs are gone (Session 54, E5). What an alpha.12 data folder kept of them is removed at the first
 * start and never read: the files' names are said, never what they held (placeholder hashes here).
 */

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A placeholder in the form roles.json kept a PIN's hash in: made-up bytes, never a real PIN's hash. */
const placeholderHash = (word: string) => ({
  kdf: 'scrypt',
  N: 32768,
  r: 8,
  p: 1,
  salt: Buffer.from(`placeholder salt ${word}`).toString('base64'),
  hash: Buffer.from(`placeholder hash ${word} for a test`).toString('base64'),
});

/** An alpha.12 data folder with roles on, as Drashti left it: the PINs' file beside the files that stay. */
function alpha12Folder(): string {
  dir = mkdtempSync(join(tmpdir(), 'drashti-old-roles-'));
  writeFileSync(
    join(dir, 'roles.json'),
    JSON.stringify({
      version: 1,
      admin: placeholderHash('a'),
      operator: placeholderHash('b'),
      wrong: 2,
      waitUntil: null,
    }),
  );
  // What stays: Main or Node, the library, the settings of the show.
  writeFileSync(join(dir, 'drashti-role.json'), '{"role":"main"}');
  writeFileSync(join(dir, 'drashti.sqlite'), 'placeholder library');
  writeFileSync(join(dir, 'live-state.json'), '{}');
  return dir;
}

const said: string[] = [];
const log = (level: 'info' | 'warn', message: string) => said.push(`${level}: ${message}`);

describe('roles.json and what went with it, removed at the start (Session 54, E5)', () => {
  it('removes the PINs’ file of an alpha.12 data folder, and nothing else, and says so without what it held', () => {
    alpha12Folder();
    said.length = 0;
    expect(removeOldRoles(dir, log)).toEqual(['roles.json']);
    expect(readdirSync(dir).sort()).toEqual(['drashti-role.json', 'drashti.sqlite', 'live-state.json']);
    expect(readFileSync(join(dir, 'drashti-role.json'), 'utf8')).toBe('{"role":"main"}');
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^info: .*roles\.json/u);
    for (const kept of [placeholderHash('a'), placeholderHash('b')])
      for (const part of [kept.salt, kept.hash]) expect(said.join('\n')).not.toContain(part);
    // The next start finds nothing to remove, and says nothing.
    expect(removeOldRoles(dir, log)).toEqual([]);
    expect(said).toHaveLength(1);
  });

  it('removes roles held locked too: the hold, the copies set aside with their date, and a write cut short', () => {
    alpha12Folder();
    writeFileSync(join(dir, 'roles.json'), '{ not json');
    writeFileSync(join(dir, 'roles-held.json'), '{"reason":"placeholder","copy":null}');
    writeFileSync(join(dir, 'roles.unreadable-2026-10-10 05-36.json'), '{ not json');
    writeFileSync(join(dir, 'roles.unreadable-2026-10-10 05-36 2.json'), '{ not json');
    writeFileSync(join(dir, 'roles.json.writing'), '{"version":1');
    // Another state file's copy set aside: not roles', so it stays, as Main or Node's drashti-role.json does.
    writeFileSync(join(dir, 'identity.unreadable-2026-10-10 05-36.json'), '{}');
    expect(removeOldRoles(dir, log).sort()).toEqual([
      'roles-held.json',
      'roles.json',
      'roles.json.writing',
      'roles.unreadable-2026-10-10 05-36 2.json',
      'roles.unreadable-2026-10-10 05-36.json',
    ]);
    expect(readdirSync(dir).sort()).toEqual([
      'drashti-role.json',
      'drashti.sqlite',
      'identity.unreadable-2026-10-10 05-36.json',
      'live-state.json',
    ]);
  });

  it('removes a folder left in roles.json’s place, as an unreadable one could be', () => {
    alpha12Folder();
    rmSync(join(dir, 'roles.json'));
    mkdirSync(join(dir, 'roles.json'));
    writeFileSync(join(dir, 'roles.json', 'placeholder'), 'x');
    expect(removeOldRoles(dir, log)).toEqual(['roles.json']);
    expect(existsSync(join(dir, 'roles.json'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'never stops the start: one that cannot be removed now is said, never read, and removed at the next start',
    () => {
      alpha12Folder();
      said.length = 0;
      // Nothing in the folder can be removed (as when another program holds it for a moment).
      chmodSync(dir, 0o555);
      try {
        expect(removeOldRoles(dir, log)).toEqual([]);
      } finally {
        chmodSync(dir, 0o755);
      }
      expect(said).toHaveLength(1);
      expect(said[0]).toMatch(/^warn: .*roles\.json could not be removed/u);
      expect(removeOldRoles(dir, log)).toEqual(['roles.json']);
      expect(existsSync(join(dir, 'roles.json'))).toBe(false);
    },
  );

  it('never stops the start: no data folder yet is nothing to remove', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-old-roles-'));
    said.length = 0;
    expect(removeOldRoles(join(dir, 'not made yet'), log)).toEqual([]);
    expect(said).toEqual([]);
  });

  it('knows roles’ files by their names alone', () => {
    for (const name of [
      'roles.json',
      'roles-held.json',
      'roles.json.writing',
      'roles.unreadable-2026-10-10 05-36.json',
      'roles.unreadable-2026-10-10 05-36 3.json',
    ])
      expect(isOldRolesFile(name), name).toBe(true);
    for (const name of [
      'drashti-role.json',
      'node.json',
      'role.json',
      'roles.json.bak',
      'my roles.json',
      'roles.unreadable.txt',
      'identity.unreadable-2026-10-10 05-36.json',
    ])
      expect(isOldRolesFile(name), name).toBe(false);
  });
});
