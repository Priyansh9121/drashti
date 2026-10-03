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
