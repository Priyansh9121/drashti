import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readState, readStateTwice, setAside } from './state-file';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const parseRole = (raw: unknown) => {
  const r = raw as { role?: unknown } | null;
  return r?.role === 'main' || r?.role === 'node' ? r.role : null;
};

describe('state files: missing is not unreadable (Session 23)', () => {
  it('tells missing, unreadable, invalid and ok apart', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-state-'));
    const file = join(dir, 'drashti-role.json');
    expect(readState(file, parseRole)).toEqual({ status: 'missing' });
    writeFileSync(file, '{"role":"no');
    expect(readState(file, parseRole).status).toBe('invalid');
    writeFileSync(file, '{"role":"neither"}');
    expect(readState(file, parseRole).status).toBe('invalid');
    writeFileSync(file, '{"role":"node"}');
    expect(readState(file, parseRole)).toEqual({ status: 'ok', value: 'node' });
    rmSync(file);
    mkdirSync(file);
    expect(readState(file, parseRole).status).toBe('unreadable');
  });

  it('reads once more after a wait, and answers the second try', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-state-'));
    const file = join(dir, 'drashti-role.json');
    writeFileSync(file, 'garbage');
    const started = Date.now();
    expect(readStateTwice(file, parseRole, 50).status).toBe('invalid');
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it('sets a bad file (or a folder) aside with the date, never over one set aside before', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-state-'));
    const file = join(dir, 'identity.json');
    const at = new Date(2026, 9, 10, 5, 36);
    writeFileSync(file, 'first');
    expect(setAside(file, at)).toBe(join(dir, 'identity.unreadable-2026-10-10 05-36.json'));
    writeFileSync(file, 'second');
    expect(setAside(file, at)).toBe(join(dir, 'identity.unreadable-2026-10-10 05-36 2.json'));
    mkdirSync(file);
    expect(setAside(file, at)).toBe(join(dir, 'identity.unreadable-2026-10-10 05-36 3.json'));
    expect(readdirSync(dir).sort()).toEqual([
      'identity.unreadable-2026-10-10 05-36 2.json',
      'identity.unreadable-2026-10-10 05-36 3.json',
      'identity.unreadable-2026-10-10 05-36.json',
    ]);
    expect(readFileSync(join(dir, 'identity.unreadable-2026-10-10 05-36.json'), 'utf8')).toBe('first');
    expect(setAside(join(dir, 'nothing.json'), at)).toBeNull();
  });
});
