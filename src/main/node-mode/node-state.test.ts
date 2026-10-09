import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeStore } from './node-state';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const at = new Date(2026, 9, 10, 5, 36);

describe('a node’s pairing file (Session 23)', () => {
  it('none: unpaired, nothing said', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-node-state-'));
    expect(new NodeStore(dir).load({ log: () => undefined, now: at, retryMs: 5 })).toEqual({
      paired: null,
      note: null,
    });
  });

  it('one that cannot be read is kept aside (pairing again never writes over it), and the note says so', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-node-state-'));
    writeFileSync(join(dir, 'node.json'), '{"main": {"id": "cut sh');
    const lines: string[] = [];
    const r = new NodeStore(dir).load({ log: (l) => lines.push(l), now: at, retryMs: 5 });
    expect(r.paired).toBeNull();
    expect(r.note).toContain('pairing with Main could not be read, so it starts unpaired');
    expect(lines[0]).toContain('node.json could not be read');
    expect(readdirSync(dir)).toEqual(['node.unreadable-2026-10-10 05-36.json']);
    expect(readFileSync(join(dir, 'node.unreadable-2026-10-10 05-36.json'), 'utf8')).toBe(
      '{"main": {"id": "cut sh',
    );
  });
});
