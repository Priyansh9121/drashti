import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Authenticode, SignatureReader } from './installer';
import { samePublisher, windowsInstaller, windowsSignatures } from './installer';

/* Windows: a signed Drashti installs only an update signed by the same publisher (made-up names only). */

const PUBLISHER =
  'CN=Placeholder Mandir Software, O=Placeholder Mandir Software, L=Sydney, S=New South Wales, C=AU';
const RENEWED = 'CN=Placeholder Mandir Software, O=Placeholder Mandir Software, C=AU, SERIALNUMBER=123';
const SOMEONE_ELSE = 'CN=Placeholder Other Publisher, O=Placeholder Other Publisher, C=AU';

function reader(files: Record<string, Authenticode>): SignatureReader {
  const of = (file: string) => files[file] ?? { valid: false, subject: null };
  return { read: (file) => Promise.resolve(of(file)), readSync: of };
}

function installer(own: Authenticode | null, update: Authenticode) {
  const ran: string[] = [];
  const files: Record<string, Authenticode> = { 'C:\\update.exe': update };
  if (own) files['C:\\Drashti.exe'] = own;
  const i = windowsInstaller({
    self: own ? 'C:\\Drashti.exe' : null,
    signatures: reader(files),
    run: (file) => ran.push(file),
  });
  return { i, ran };
}

const signed = (subject: string): Authenticode => ({ valid: true, subject });

describe('the Windows installer and signatures (Session 14)', () => {
  it('a signed Drashti installs an update from the same publisher, a renewed certificate too', async () => {
    for (const subject of [PUBLISHER, RENEWED]) {
      const { i, ran } = installer(signed(PUBLISHER), signed(subject));
      expect(await i.prepare('C:\\update.exe', '1.0.1')).toEqual({ ok: true });
      expect(i.atQuit('C:\\update.exe')).toEqual({ ok: true });
      expect(ran).toEqual(['C:\\update.exe']);
    }
  });

  it('refuses one signed by someone else, saying so, and never runs it', async () => {
    const { i, ran } = installer(signed(PUBLISHER), signed(SOMEONE_ELSE));
    const prepared = await i.prepare('C:\\update.exe', '1.0.1');
    expect(prepared.ok).toBe(false);
    expect(!prepared.ok && prepared.message).toContain(
      'signed by someone else (Placeholder Other Publisher)',
    );
    expect(i.atQuit('C:\\update.exe').ok).toBe(false);
    expect(ran).toEqual([]);
  });

  it('refuses one with no signature, or one Windows does not find valid', async () => {
    for (const update of [
      { valid: false, subject: null },
      { valid: false, subject: PUBLISHER },
    ]) {
      const { i, ran } = installer(signed(PUBLISHER), update);
      const prepared = await i.prepare('C:\\update.exe', '1.0.1');
      expect(!prepared.ok && prepared.message).toContain('no valid signature');
      expect(i.atQuit('C:\\update.exe').ok).toBe(false);
      expect(ran).toEqual([]);
    }
  });

  it('checks again just before it runs: a file changed after the say-so is refused', async () => {
    const files: Record<string, Authenticode> = {
      'C:\\Drashti.exe': signed(PUBLISHER),
      'C:\\update.exe': signed(PUBLISHER),
    };
    const ran: string[] = [];
    const i = windowsInstaller({
      self: 'C:\\Drashti.exe',
      signatures: reader(files),
      run: (f) => ran.push(f),
    });
    expect(await i.prepare('C:\\update.exe', '1.0.1')).toEqual({ ok: true });
    files['C:\\update.exe'] = signed(SOMEONE_ELSE);
    expect(i.atQuit('C:\\update.exe').ok).toBe(false);
    expect(ran).toEqual([]);
  });

  it('an unsigned Drashti (or one not packaged) stays as it was: it installs the checked file', async () => {
    for (const own of [null, { valid: false, subject: null }]) {
      const { i, ran } = installer(own, { valid: false, subject: null });
      expect(await i.prepare('C:\\update.exe', '1.0.1')).toEqual({ ok: true });
      expect(i.atQuit('C:\\update.exe')).toEqual({ ok: true });
      expect(ran).toEqual(['C:\\update.exe']);
    }
  });

  it('compares the name and organisation, quoted or not, never an empty name', () => {
    expect(
      samePublisher(
        'CN="Placeholder, Software", O="Placeholder, Software"',
        'O="Placeholder, Software", CN="Placeholder, Software", C=AU',
      ),
    ).toBe(true);
    expect(samePublisher('CN=Placeholder Software, O=One', 'CN=Placeholder Software, O=Two')).toBe(false);
    expect(samePublisher('CN=Placeholder Software', 'CN=Placeholder Software')).toBe(true);
    expect(samePublisher('O=Placeholder', 'O=Placeholder')).toBe(false);
  });
});

describe.runIf(process.platform === 'win32')("Windows' own signature check", () => {
  it('finds no signature on a file just written, and a valid one on a file Windows came with', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'drashti-sig-')), 'Placeholder unsigned.exe');
    writeFileSync(file, 'MZ placeholder');
    expect(await windowsSignatures.read(file)).toEqual({ valid: false, subject: null });
    const shell = join(
      process.env['SystemRoot'] ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const os = windowsSignatures.readSync(shell);
    expect(os.valid).toBe(true);
    expect(os.subject).toContain('O=Microsoft Corporation');
  }, 90_000);
});
