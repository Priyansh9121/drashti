import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { knownRole, readRole, writeRole } from './role';

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
