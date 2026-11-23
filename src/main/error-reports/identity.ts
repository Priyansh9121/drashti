import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { identitySchema, type ErrorIdentity } from './protocol';

/** Structural subset of a21-log30's DiagnosticsWho (deea5ad0). Names/period/Main names are deliberately absent. */
export interface AutomaticDiagnosticsWho {
  computerId: string | null;
  installId: string | null;
  grantId: string | null;
  role: { mode: 'pro' | 'simple'; owner: boolean } | null;
  made: 'pro' | 'simple' | 'node';
}
/** The alpha.21 id is read only; this feature never makes or replaces the other worker's file. */
export function diagnosticInstallId(dir: string): string | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, 'install-id.json'), 'utf8'));
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'id' in raw &&
      typeof raw.id === 'string' &&
      /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/u.test(raw.id)
    )
      return raw.id;
  } catch {
    /* Before alpha.21 / an unreadable id: the access computer and grant still identify this machine. */
  }
  return null;
}
export function automaticIdentity(
  who: AutomaticDiagnosticsWho,
  system: { version: string; platform: string; arch: string; release: string },
  counts: ErrorIdentity['counts'],
): ErrorIdentity | null {
  if (!who.role || !who.computerId || !who.grantId) return null;
  const parsed = identitySchema.safeParse({
    computerId: who.computerId,
    accessEntryId: who.grantId,
    diagnosticsInstallId: who.installId,
    mode: who.made === 'node' ? who.role.mode : who.made,
    version: system.version,
    platform: system.platform,
    arch: system.arch,
    osRelease: system.release,
    role: who.made === 'node' ? 'node' : 'main',
    counts,
  });
  return parsed.success ? parsed.data : null;
}
