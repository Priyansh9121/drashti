import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadIdentity, makeNewIdentity, type MainIdentity } from './identity';

/*
 * Main's identity for its nodes (Session 23, TST-2): every paired node pins
 * this certificate, so a file that cannot be read must never be replaced by a
 * new identity without anyone knowing: the nodes would stop following.
 */

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const linkDir = () => join(dir, 'node-link');
const file = () => join(linkDir(), 'identity.json');
const at = new Date(2026, 9, 10, 5, 36);

function load(lines: string[] = []) {
  return loadIdentity(dir, 'Placeholder Mac', {
    log: (line) => lines.push(line),
    now: at,
    retryMs: 10,
  });
}

function identity(): MainIdentity {
  const r = load();
  if (!r.ok) throw new Error(r.problem);
  return r.identity;
}

describe('Main’s node identity', () => {
  it('is made the first time (no file yet), and read back the same after', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-identity-'));
    const first = identity();
    expect(identity()).toEqual(first);
  });

  it('a damaged file is set aside, never replaced; Main holds and says so, even after a restart', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-identity-'));
    identity();
    const text = readFileSync(file(), 'utf8');
    const damaged = text.slice(0, text.length / 2);
    writeFileSync(file(), damaged);
    const lines: string[] = [];
    const r = load(lines);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.problem).toContain('could not be read, so no node can follow it');
    expect(r.ok ? '' : r.problem).toContain('identity.unreadable-2026-10-10 05-36.json');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('node-link/identity.json could not be read');
    // Kept as it was, beside where it was.
    expect(readFileSync(join(linkDir(), 'identity.unreadable-2026-10-10 05-36.json'), 'utf8')).toBe(damaged);
    // Started again: still held, with no new identity made in its place.
    expect(load().ok).toBe(false);
    expect(readdirSync(linkDir())).not.toContain('identity.json');
  });

  it('a folder where the file should be is set aside, and no identity is made', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-identity-'));
    mkdirSync(file(), { recursive: true });
    const r = load();
    expect(r.ok).toBe(false);
    expect(readdirSync(linkDir())).toContain('identity.unreadable-2026-10-10 05-36.json');
    expect(readdirSync(linkDir())).not.toContain('identity.json');
  });

  it('only an admin’s new identity ends the hold', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-identity-'));
    const old = identity();
    writeFileSync(file(), '{}');
    expect(load().ok).toBe(false);
    const made = makeNewIdentity(dir, 'Placeholder Mac', at);
    expect(made.id).not.toBe(old.id);
    expect(identity()).toEqual(made);
  });
});
