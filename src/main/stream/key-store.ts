import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

/*
 * Stream keys, kept with the system's secure storage (Electron safeStorage:
 * the macOS keychain, Windows DPAPI). Only the encrypted key is written, to
 * a file of its own in Drashti's data folder: never the library (so never a
 * backup), never the log or diagnostics. When secure storage is not
 * available, a key is not kept at all: never as plain text.
 *
 * A key is read back only in the main process, only to go live, and is
 * never sent to a window.
 */

/** The part of Electron's safeStorage used here (a stand-in in unit tests). */
export interface SecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only: 'basic_text' means there is no keyring, and keys would be readable. */
  getSelectedStorageBackend?(): string;
}

export type KeyResult = { ok: true } | { ok: false; message: string };

const fileSchema = z.object({ version: z.literal(1), keys: z.record(z.string(), z.string()) });

export const NO_SECURE_STORAGE =
  'This computer’s secure storage for passwords is not available, so Drashti will not save a stream key (it would have to be kept as plain text) and cannot go live from here. Go live from a computer where it works, or get the system’s keychain working and paste the key again.';

export class StreamKeyStore {
  constructor(
    private readonly file: string,
    private readonly storage: SecureStorage,
    /** Tests only: behave as if secure storage were missing. */
    private readonly forceUnavailable = false,
  ) {}

  /** Whether keys can be kept here, and why not. */
  status(): { available: boolean; message: string | null } {
    if (this.forceUnavailable) return { available: false, message: NO_SECURE_STORAGE };
    let available: boolean;
    try {
      available =
        this.storage.isEncryptionAvailable() && this.storage.getSelectedStorageBackend?.() !== 'basic_text';
    } catch {
      available = false;
    }
    return available ? { available, message: null } : { available, message: NO_SECURE_STORAGE };
  }

  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      return parsed.success ? parsed.data.keys : {};
    } catch {
      return {};
    }
  }

  private write(keys: Record<string, string>): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, keys }), { mode: 0o600 });
    renameSync(tmp, this.file);
    try {
      chmodSync(this.file, 0o600);
    } catch {
      // Windows keeps its own permissions.
    }
  }

  has(profileId: string): boolean {
    return profileId in this.read();
  }

  /** Keep a profile's key, encrypted; refused (and nothing kept) without secure storage. */
  set(profileId: string, key: string): KeyResult {
    const status = this.status();
    if (!status.available) return { ok: false, message: status.message ?? NO_SECURE_STORAGE };
    let encrypted: Buffer;
    try {
      encrypted = this.storage.encryptString(key);
    } catch {
      return { ok: false, message: NO_SECURE_STORAGE };
    }
    this.write({ ...this.read(), [profileId]: encrypted.toString('base64') });
    return { ok: true };
  }

  /** A profile's key, for going live (main process only); null when there is none or it cannot be read. */
  get(profileId: string): string | null {
    if (!this.status().available) return null;
    const stored = this.read()[profileId];
    if (stored === undefined) return null;
    try {
      return this.storage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return null;
    }
  }

  remove(profileId: string): void {
    const keys = this.read();
    if (!(profileId in keys)) return;
    const { [profileId]: _gone, ...rest } = keys;
    this.write(rest);
  }
}
