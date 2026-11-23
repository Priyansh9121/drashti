import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTALL_ID_FILE, installId, whoLines, type DiagnosticsWho } from './log-who';

/*
 * Who wrote a diagnostics file (alpha.21, logs for 100+ installs (b), the owner's "Yes, that plan"): its computer, its
 * access-list entry and role, this install's id, where it was made and its log's period; never a Gmail address or a
 * private value. Placeholder names and made-up ids only.
 */

const ID = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/u;

describe('this install’s id', () => {
  it('is made once and kept in the data folder: the same every time after', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-install-'));
    const first = installId(dir);
    expect(first.id).toMatch(ID);
    expect(first.kept).toBe(true);
    expect(installId(dir)).toEqual(first);
    expect(JSON.parse(readFileSync(join(dir, INSTALL_ID_FILE), 'utf8'))).toMatchObject({ id: first.id });
    // Another data folder, another install.
    expect(installId(mkdtempSync(join(tmpdir(), 'drashti-install-'))).id).not.toBe(first.id);
  });

  it('a damaged file is replaced by a new id, kept from then on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-install-'));
    writeFileSync(join(dir, INSTALL_ID_FILE), '{"id":"not an id"');
    const made = installId(dir);
    expect(made.id).toMatch(ID);
    expect(installId(dir).id).toBe(made.id);
  });

  it('one that cannot be kept is still given, saying so', () => {
    // A file where the data folder should be: nothing can be kept in it, on any system.
    const dir = join(mkdtempSync(join(tmpdir(), 'drashti-install-')), 'not-a-folder');
    writeFileSync(dir, 'placeholder');
    const made = installId(dir);
    expect(made.id).toMatch(ID);
    expect(made.kept).toBe(false);
  });
});

describe('who and what in a diagnostics file', () => {
  const now = new Date(2026, 10, 23, 10, 5);
  const main: DiagnosticsWho = {
    computer: 'Placeholder Hall Mac',
    computerId: 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
    installId: '7K3P-Q2XM-4H9A',
    grantId: '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    role: { mode: 'pro', owner: false },
    made: 'pro',
    period: 'Today, 2026-11-23',
  };

  it('names the computer, its ids by their start, the access-list entry and role, where made, the time zone and the period', () => {
    const lines = whoLines(main, now);
    expect(lines.map((l) => l.slice(0, l.indexOf(':')))).toEqual([
      'Computer',
      'Computer id',
      'Install id',
      'Access-list entry',
      'Role',
      'Made in',
      'Time zone',
      'Log',
    ]);
    expect(lines).toContain('Computer: Placeholder Hall Mac');
    expect(lines).toContain('Computer id: c0ffee00c0ff… (the Computers tab’s Computer id column starts so)');
    expect(lines).toContain('Install id: 7K3P-Q2XM-4H9A');
    expect(lines).toContain(
      'Access-list entry: grant 0a1b2c3d… (the Computers tab’s Grant column starts so)',
    );
    expect(lines).toContain('Role: Pro');
    expect(lines).toContain('Made in: Pro Mode');
    expect(lines.find((l) => l.startsWith('Time zone: '))).toMatch(/UTC[+-]\d{2}:\d{2}\)?$/u);
    expect(lines).toContain('Log: Today, 2026-11-23');
    // Never the whole of an id.
    expect(lines.join('\n')).not.toContain(main.grantId);
    expect(lines.join('\n')).not.toContain(main.computerId);
  });

  it('says Simple Mode and the owner, not let in, and a node with the Main it follows', () => {
    expect(whoLines({ ...main, role: { mode: 'simple', owner: true }, made: 'simple' }, now)).toEqual(
      expect.arrayContaining(['Role: Simple, the owner', 'Made in: Simple Mode']),
    );
    expect(whoLines({ ...main, grantId: null, role: null }, now)).toEqual(
      expect.arrayContaining(['Access-list entry: none: not let in', 'Role: not let in']),
    );
    const node = whoLines(
      { ...main, computerId: null, grantId: null, role: null, made: 'node', main: 'Placeholder Main' },
      now,
    );
    expect(node).toEqual(
      expect.arrayContaining([
        'Computer id: none',
        'Access-list entry: none: a node, following Main “Placeholder Main”',
        'Role: a node (it has no entry of its own: Main is let in)',
        'Made in: the node',
      ]),
    );
  });
});
