import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { knownRole, readRole, startingRole, writeRole } from './role';

/* Main or Node (Session 13): what Drashti starts as without asking. */

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('the role', () => {
  it('asks on the very first start, is Main where a library is, and keeps what was chosen', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-role-'));
    expect(knownRole(dir, undefined)).toBeNull();
    writeFileSync(join(dir, 'drashti.sqlite'), 'a library');
    expect(knownRole(dir, undefined)).toBe('main');
    writeRole(dir, 'node');
    expect(readRole(dir)).toBe('node');
    expect(knownRole(dir, undefined)).toBe('node');
    // The environment says it for this start (tests, a second copy on one computer).
    expect(knownRole(dir, 'main')).toBe('main');
    expect(knownRole(dir, 'something else')).toBe('node');
    writeFileSync(join(dir, 'drashti-role.json'), '{"role": "neither"}');
    expect(readRole(dir)).toBeNull();
  });
});

describe('a role file that cannot be read (Session 23)', () => {
  const at = new Date(2026, 9, 10, 5, 36);
  const start = (lines: string[] = []) =>
    startingRole(dir, undefined, { log: (l) => lines.push(l), now: at, retryMs: 5 });

  it('on a computer with no library: a node, with no question, the file kept aside, and a note', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-role-'));
    writeFileSync(join(dir, 'drashti-role.json'), '{"role": "no');
    const lines: string[] = [];
    const r = start(lines);
    expect(r.role).toBe('node');
    expect(r.note).toContain('could not be read, so Drashti started as a node');
    expect(lines[0]).toContain('drashti-role.json could not be read');
    expect(readFileSync(join(dir, 'drashti-role.unreadable-2026-10-10 05-36.json'), 'utf8')).toBe(
      '{"role": "no',
    );
  });

  it('on a computer with a library: Main; a folder in its place is kept aside too', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-role-'));
    writeFileSync(join(dir, 'drashti.sqlite'), 'a library');
    mkdirSync(join(dir, 'drashti-role.json'));
    const r = start();
    expect(r.role).toBe('main');
    expect(r.note).toContain('started as Main, because it last ran as Main');
    expect(readdirSync(dir)).toContain('drashti-role.unreadable-2026-10-10 05-36.json');
  });

  it('on a computer that was Main and then a node (it keeps its library): the role that ran last', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-role-'));
    writeFileSync(join(dir, 'drashti.sqlite'), 'a library');
    utimesSync(join(dir, 'drashti.sqlite'), new Date(2026, 9, 1), new Date(2026, 9, 1));
    writeFileSync(join(dir, 'node.json'), '{}');
    writeFileSync(join(dir, 'drashti-role.json'), 'garbage');
    const r = start();
    expect(r.role).toBe('node');
    expect(r.note).toContain('started as a node, because it last ran as a node');
  });

  it('a missing file is still a first start (asked), and the environment still wins', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-role-'));
    expect(start()).toEqual({ role: null, note: null });
    writeFileSync(join(dir, 'drashti-role.json'), 'garbage');
    expect(startingRole(dir, 'main', { log: () => undefined })).toEqual({ role: 'main', note: null });
  });
});
