import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Searching what Drashti wrote for a secret (Sessions 9 and 31, SEC-8): its data folder (the library and its
 * write-ahead log, its logs and settings, Chromium's profile), the Diagnostics it saved and a backup, as bytes,
 * in UTF-8 and UTF-16. A failure names the secret and the file, never the secret itself: a test's output and
 * its trace are kept on CI, and the repository is public.
 */

export interface Secret {
  /** What it is, for a failure's message ("the device token"). */
  label: string;
  value: string;
  /** All digits (a code, a PIN): found only where no digit stands beside it, so a longer number is no match. */
  digits?: boolean;
}

/** Every file under these folders that can be read now (after Drashti has quit, all of them can). */
export function filesUnder(...roots: string[]): string[] {
  return roots.flatMap((root) =>
    (readdirSync(root, { recursive: true }) as string[])
      .map((f) => join(root, f))
      .filter((f) => {
        try {
          return statSync(f).isFile();
        } catch {
          // A link that points nowhere (Chromium's Singleton links while it runs).
          return false;
        }
      }),
  );
}

/** Where each secret was found: "<label> in <file>", for each file holding it. */
export function findSecrets(files: readonly string[], secrets: readonly Secret[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(file);
    } catch {
      // Held by a program that is still running (a search before Drashti quit): its own check comes after.
      continue;
    }
    const latin = secrets.some((s) => s.digits) ? bytes.toString('latin1') : '';
    const wide = secrets.some((s) => s.digits) ? bytes.toString('utf16le') : '';
    for (const s of secrets) {
      const hit = s.digits
        ? new RegExp(`(?<![0-9])${s.value}(?![0-9])`, 'u').test(latin) ||
          new RegExp(`(?<![0-9])${s.value}(?![0-9])`, 'u').test(wide)
        : bytes.includes(Buffer.from(s.value)) || bytes.includes(Buffer.from(s.value, 'utf16le'));
      if (hit) found.push(`${s.label} in ${file}`);
    }
  }
  return found;
}
