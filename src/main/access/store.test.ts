import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACCESS_FILE, AccessStore, grantOf, storedAccess } from './store';

/*
 * This computer's way in, kept in Drashti's data folder (Session 54, E1, store.ts): whole or not at all,
 * this computer's user's only, never the keychain. The grant and secret here are made up.
 */

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-access-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ID = 'c'.repeat(64);
const kept = () =>
  storedAccess({
    grant: { gmail: 'placeholder.user@example.com', grantId: 'a'.repeat(32), secret: 'b'.repeat(64) },
    computerId: ID,
    owner: false,
    since: 1_000,
  });

describe('the way in kept', () => {
  it('is written whole into access.json, readable by this computer’s user only, and read back', () => {
    const store = new AccessStore(dir);
    expect(store.read(0)).toEqual({ status: 'missing' });
    store.save(kept());
    expect(readdirSync(dir)).toEqual([ACCESS_FILE]);
    if (process.platform !== 'win32') expect(statSync(join(dir, ACCESS_FILE)).mode & 0o777).toBe(0o600);
    const again = new AccessStore(dir).read(0);
    expect(again).toEqual({ status: 'ok', value: kept() });
    expect(again.status === 'ok' && grantOf(again.value)).toEqual({
      gmail: 'placeholder.user@example.com',
      grantId: 'a'.repeat(32),
      secret: 'b'.repeat(64),
    });
  });

  it('says so when it is there but cut short or not what Drashti writes, and never writes what it refuses', () => {
    writeFileSync(join(dir, ACCESS_FILE), '{"v":1,');
    expect(new AccessStore(dir).read(0)).toMatchObject({ status: 'invalid' });
    writeFileSync(join(dir, ACCESS_FILE), JSON.stringify({ ...kept(), secret: 'short' }));
    expect(new AccessStore(dir).read(0)).toMatchObject({ status: 'invalid' });
    expect(() => {
      new AccessStore(dir).save({ ...kept(), grantId: 'not hex' });
    }).toThrow();
  });

  it('knows whether it was made on this computer (a copied data folder’s was not)', () => {
    const store = new AccessStore(dir);
    store.save(kept());
    expect(new AccessStore(dir).madeHere(ID)).toBe(true);
    expect(new AccessStore(dir).madeHere('d'.repeat(64))).toBe(false);
    store.clear();
    expect(existsSync(join(dir, ACCESS_FILE))).toBe(false);
    expect(new AccessStore(dir).madeHere(ID)).toBe(false);
  });

  it('gives an `at` that always rises, even when this computer’s clock goes back, across starts', () => {
    const store = new AccessStore(dir);
    store.save(kept());
    expect(store.nextAt(5_000)).toBe(5_000);
    expect(store.nextAt(4_000)).toBe(5_001);
    expect(new AccessStore(dir).nextAt(4_500)).toBe(5_002);
    expect(new AccessStore(dir).nextAt(9_000)).toBe(9_000);
  });

  it('adds to the totals, never below zero, and keeps them', () => {
    const store = new AccessStore(dir);
    store.save(kept());
    store.add({ minutes: 3, shows: 1 });
    expect(store.add({ shows: 2, imports: -5, streams: 1.7 })).toEqual({
      minutes: 3,
      shows: 3,
      streams: 1,
      recordings: 0,
      imports: 0,
    });
    const again = new AccessStore(dir).read(0);
    expect(again.status === 'ok' && again.value.activity.shows).toBe(3);
  });

  it('keeps the last answer and the time run without one since, for a start with no internet (28 Oct 2026)', () => {
    const store = new AccessStore(dir);
    store.save(kept());
    const answer = { status: 'in' as const, owner: false, heardAt: 5_000, serverTime: 6_000, endsAt: null };
    store.heard(answer);
    store.offline(90_000);
    // Never less than kept before (a check that answers in between puts it back to none).
    store.offline(30_000);
    let again = new AccessStore(dir).read(0);
    expect(again.status === 'ok' && again.value).toMatchObject({ answer, offlineMs: 90_000 });
    store.heard({ ...answer, status: 'revoked', heardAt: 7_000 });
    again = new AccessStore(dir).read(0);
    expect(again.status === 'ok' && again.value).toMatchObject({
      answer: { status: 'revoked' },
      offlineMs: 0,
    });
    // One kept before it knew of either still reads.
    const old = new AccessStore(dir);
    old.save(kept());
    expect(new AccessStore(dir).read(0)).toEqual({ status: 'ok', value: kept() });
  });
});
