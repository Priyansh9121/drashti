import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Db } from '../db/database';
import { LATEST_VERSION, openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import { NodeRepo } from '../db/nodes';
import { applyPendingRestore, backupLibrary, LIBRARY_FILE, requestRestore } from './backup';
import { keepAccessAfterRestore } from './restore-access';

/*
 * A restore keeps who may connect (Sessions 31–36, SEC-6): the phones paired today, the poster link and the
 * nodes' tokens are copied from the library kept aside before the swap. A phone or a node removed since the
 * backup stays refused, and nobody pairs again. A node's row is never deleted: its screens go with it.
 * Made-up token hashes and placeholder names only.
 */

const hash = (c: string) => c.repeat(64);

function phone(db: Db, id: string, token: string, poster = false): void {
  db.prepare('INSERT INTO network_devices (id, name, kind, token_hash, poster) VALUES (?, ?, ?, ?, ?)').run(
    id,
    `Placeholder ${id}`,
    poster ? 'announcements' : 'remote',
    hash(token),
    poster ? 1 : 0,
  );
}

function node(db: Db, id: string, token: string): void {
  db.prepare(
    "INSERT INTO nodes (id, name, token_hash, paired_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
  ).run(id, `Placeholder ${id}`, hash(token));
}

function screenOn(db: Db, nodeId: string): void {
  db.prepare("INSERT OR IGNORE INTO screen_groups (id, name) VALUES ('group', 'Placeholder group')").run();
  db.prepare(
    "INSERT INTO screens (id, group_id, node_id, name) VALUES (?, 'group', ?, 'Placeholder screen')",
  ).run(`screen-${nodeId}`, nodeId);
}

const tokens = (rows: { id: string; tokenHash: string }[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r.tokenHash[0]]));

/** A backup with phones A and B and nodes X and Y (a screen on Y); then B and Y removed, C, the poster and Z paired. */
async function restoredOverToday() {
  const before = mkdtempSync(join(tmpdir(), 'drashti-access-backup-'));
  const atBackup = openDatabase(join(before, LIBRARY_FILE));
  phone(atBackup, 'phone-a', 'a');
  phone(atBackup, 'phone-b', 'b');
  node(atBackup, 'node-x', '1');
  node(atBackup, 'node-y', '2');
  screenOn(atBackup, 'node-y');
  const saved = await backupLibrary(atBackup, mkdtempSync(join(tmpdir(), 'drashti-access-backups-')), {
    mediaDir: null,
    app: '1.0.0',
    schema: LATEST_VERSION,
    now: new Date(),
  });
  atBackup.close();

  const dir = mkdtempSync(join(tmpdir(), 'drashti-access-today-'));
  const today = openDatabase(join(dir, LIBRARY_FILE));
  phone(today, 'phone-a', 'a');
  phone(today, 'phone-c', 'c');
  phone(today, 'poster', 'p', true);
  node(today, 'node-x', '1');
  node(today, 'node-z', '3');
  today.close();

  requestRestore(dir, saved.folder);
  const outcome = applyPendingRestore(dir, {
    schema: LATEST_VERSION,
    app: '1.0.0',
    now: new Date(2026, 9, 17, 9),
  });
  if (!outcome.restored) throw new Error('not restored');
  return { dir, kept: join(dir, 'Backups', outcome.keptIn, LIBRARY_FILE) };
}

describe('a restore keeps who may connect (SEC-6)', () => {
  it("keeps today's phones, poster link and nodes; a phone or node removed since the backup stays refused", async () => {
    const { dir, kept } = await restoredOverToday();
    const db = openDatabase(join(dir, LIBRARY_FILE));
    // As restored, the backup's phones and nodes are back: B and Y among them, removed since.
    expect(tokens(new DeviceRepo(db).list())).toEqual({ 'phone-a': 'a', 'phone-b': 'b' });
    expect(tokens(new NodeRepo(db).list())).toEqual({ 'node-x': '1', 'node-y': '2' });
    expect(keepAccessAfterRestore(db, kept)).toEqual({ ok: true, phones: 3, nodes: 2, refused: 2 });
    // Phone B, removed after the backup, is not back; C and the poster, paired since, need no pairing again.
    expect(tokens(new DeviceRepo(db).list())).toEqual({ 'phone-a': 'a', 'phone-c': 'c', poster: 'p' });
    // Node Y, removed since, cannot connect; Z, paired since, can; X keeps its token.
    expect(tokens(new NodeRepo(db).list())).toEqual({ 'node-x': '1', 'node-z': '3' });
    // Y's row is kept, without a token, and its screen with it.
    expect(db.prepare("SELECT token_hash FROM nodes WHERE id = 'node-y'").get()).toEqual({
      token_hash: null,
    });
    expect(db.prepare("SELECT count(*) AS n FROM screens WHERE node_id = 'node-y'").get()).toEqual({ n: 1 });
    db.close();
  });

  it('refuses every phone and node when the library from before cannot be read, and says so', async () => {
    const { dir } = await restoredOverToday();
    const db = openDatabase(join(dir, LIBRARY_FILE));
    // The backup's two phones and two nodes.
    expect(keepAccessAfterRestore(db, join(dir, 'Backups', 'not there', LIBRARY_FILE))).toEqual({
      ok: false,
      refused: 4,
    });
    expect(new DeviceRepo(db).list()).toEqual([]);
    expect(new NodeRepo(db).list()).toEqual([]);
    // The rows stay, their screens with them.
    expect(db.prepare('SELECT count(*) AS n FROM nodes').get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT count(*) AS n FROM screens WHERE node_id = 'node-y'").get()).toEqual({ n: 1 });
    db.close();
  });
});
