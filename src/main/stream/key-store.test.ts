import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SecureStorage } from './key-store';
import { NO_SECURE_STORAGE, StreamKeyStore } from './key-store';

/* A made-up key: never a real one. */
const KEY = 'test-made-up-key-0000-aaaa';

/** A stand-in for safeStorage: reversible, and never the plain text on disk. */
const fakeStorage = (available = true, backend?: string): SecureStorage => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from([...Buffer.from(s, 'utf8')].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString('utf8'),
  ...(backend ? { getSelectedStorageBackend: () => backend } : {}),
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-keys-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('stream keys', () => {
  it('are kept encrypted, read back in the main process only, and removed', () => {
    const file = join(dir, 'stream-keys.json');
    const store = new StreamKeyStore(file, fakeStorage());
    expect(store.status()).toEqual({ available: true, message: null });
    expect(store.set('p1', KEY)).toEqual({ ok: true });
    expect(store.has('p1')).toBe(true);
    expect(readFileSync(file, 'utf8')).not.toContain(KEY);
    expect(store.get('p1')).toBe(KEY);
    store.remove('p1');
    expect(store.has('p1')).toBe(false);
    expect(store.get('p1')).toBeNull();
  });

  it('are never kept without secure storage, and say why', () => {
    for (const store of [
      new StreamKeyStore(join(dir, 'a.json'), fakeStorage(false)),
      // Linux without a keyring: safeStorage would only obscure the key.
      new StreamKeyStore(join(dir, 'b.json'), fakeStorage(true, 'basic_text')),
      // Tests: as if it were missing.
      new StreamKeyStore(join(dir, 'c.json'), fakeStorage(), true),
    ]) {
      expect(store.status()).toEqual({ available: false, message: NO_SECURE_STORAGE });
      expect(store.set('p1', KEY)).toEqual({ ok: false, message: NO_SECURE_STORAGE });
      expect(store.has('p1')).toBe(false);
    }
  });

  it('read a damaged file as no keys', () => {
    const file = join(dir, 'stream-keys.json');
    const store = new StreamKeyStore(file, fakeStorage());
    store.set('p1', KEY);
    rmSync(file);
    expect(store.get('p1')).toBeNull();
  });
});

// Q58-37 (the owner, 14 Nov 2026: opening Stream asked for the laptop's password, twice): asking the system's secure
// storage whether it works opens the Mac's keychain, which asks for the computer's password. What a window is told
// never asks it; saving a key and going live still do.
describe('what a window is told of secure storage (Q58-37)', () => {
  const counted = (available = true) => {
    const storage = fakeStorage(available);
    const asked = { count: 0 };
    const count =
      <T extends unknown[], R>(fn: (...a: T) => R) =>
      (...a: T): R => {
        asked.count++;
        return fn(...a);
      };
    return {
      asked,
      storage: {
        isEncryptionAvailable: count(storage.isEncryptionAvailable),
        encryptString: count(storage.encryptString),
        decryptString: count(storage.decryptString),
      } satisfies SecureStorage,
    };
  };

  it('never asks the storage: a key is offered until saving one has said otherwise', () => {
    const { asked, storage } = counted();
    const store = new StreamKeyStore(join(dir, 'k.json'), storage);
    expect(store.known()).toEqual({ available: true, message: null });
    expect(asked.count).toBe(0);
    expect(store.set('p', KEY)).toEqual({ ok: true });
    expect(asked.count).toBeGreaterThan(0);
    // A key saved is known from its file alone.
    const before = asked.count;
    expect(store.has('p')).toBe(true);
    expect(store.known()).toEqual({ available: true, message: null });
    expect(asked.count).toBe(before);
  });

  it('a storage that cannot keep keys is said once saving one was refused, as the refusal says', () => {
    const { asked, storage } = counted(false);
    const store = new StreamKeyStore(join(dir, 'k.json'), storage);
    expect(store.known()).toEqual({ available: true, message: null });
    expect(asked.count).toBe(0);
    expect(store.set('p', KEY)).toEqual({ ok: false, message: NO_SECURE_STORAGE });
    expect(store.known()).toEqual({ available: false, message: NO_SECURE_STORAGE });
  });

  it('the tests’ switch for no secure storage is said at once, as before', () => {
    const { asked, storage } = counted();
    expect(new StreamKeyStore(join(dir, 'k.json'), storage, true).known()).toEqual({
      available: false,
      message: NO_SECURE_STORAGE,
    });
    expect(asked.count).toBe(0);
  });
});
