import type { DiagnosticsWho } from '../log-who';
import { identitySchema, type ErrorIdentity } from './protocol';

/**
 * The ids of a diagnostics file's who lines (log-who.ts's DiagnosticsWho), whole: never the computer's or a Main's
 * name, nor the period's words.
 */
export type AutomaticDiagnosticsWho = Pick<DiagnosticsWho, 'computerId' | 'installId' | 'grantId' | 'role' | 'made'>;
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
