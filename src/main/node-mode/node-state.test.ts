import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
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

describe('a node’s last picture (Session 52)', () => {
  const snapshot = (version: number) => ({
    kind: 'snapshot',
    version,
    rev: 4,
    sentAt: 1,
    state: { ...initialEngineState(), version },
  });

  it('reads the one alpha.11 kept (engine 12) as it is, as this engine’s', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-node-state-'));
    writeFileSync(join(dir, 'node-show.json'), JSON.stringify({ offsetMs: 7, snapshot: snapshot(12) }));
    const shown = new NodeStore(dir).readShow();
    expect(shown?.offsetMs).toBe(7);
    expect(shown?.snapshot).toMatchObject({ rev: 4, version: ENGINE_STATE_VERSION });
    expect(shown?.snapshot.state.version).toBe(ENGINE_STATE_VERSION);
  });

  it('reads the one alpha.12 kept (engine 13) as it is, as this engine’s (Session 54)', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-node-state-'));
    writeFileSync(join(dir, 'node-show.json'), JSON.stringify({ offsetMs: 7, snapshot: snapshot(13) }));
    const shown = new NodeStore(dir).readShow();
    expect(shown?.offsetMs).toBe(7);
    expect(shown?.snapshot).toMatchObject({ rev: 4, version: ENGINE_STATE_VERSION });
    expect(shown?.snapshot.state.version).toBe(ENGINE_STATE_VERSION);
  });

  it('reads its own, and leaves out any other version’s', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-node-state-'));
    const store = new NodeStore(dir);
    writeFileSync(store.showFile, JSON.stringify({ offsetMs: 0, snapshot: snapshot(ENGINE_STATE_VERSION) }));
    expect(store.readShow()?.snapshot.rev).toBe(4);
    writeFileSync(store.showFile, JSON.stringify({ offsetMs: 0, snapshot: snapshot(11) }));
    expect(store.readShow()).toBeNull();
  });
});
