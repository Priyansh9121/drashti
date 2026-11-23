import { describe, expect, it } from 'vitest';
import { automaticIdentity } from './identity';
const who = {
  computer: 'Private computer placeholder@example.com',
  computerId: 'c'.repeat(64),
  installId: '7K3P-Q2XM-4H9A',
  grantId: 'a'.repeat(32),
  role: { mode: 'simple' as const, owner: false },
  made: 'simple' as const,
  period: 'Today, 2026-11-23',
};
const system = { version: '1.0.0-alpha.22', platform: 'win32', arch: 'x64', release: '10.0.26100' };
const counts = { minutes: 1, shows: 2, streams: 3, recordings: 4, imports: 5 };
describe('a21-log30 diagnostics identity adapter', () => {
  it('reports the mode that made the error even when its access grant permits Pro', () => {
    const identity = automaticIdentity(
      { ...who, role: { mode: 'pro', owner: true }, made: 'simple' },
      system,
      counts,
    );
    expect(identity?.mode).toBe('simple');
  });

  it('uses its posted install/grant/role/system fields and never copies the computer name or arbitrary lines', () => {
    expect(automaticIdentity(who, system, counts)).toEqual({
      computerId: who.computerId,
      accessEntryId: who.grantId,
      diagnosticsInstallId: who.installId,
      version: system.version,
      platform: system.platform,
      arch: system.arch,
      osRelease: system.release,
      role: 'main',
      mode: 'simple',
      counts,
    });
    expect(JSON.stringify(automaticIdentity(who, system, counts))).not.toContain('Private');
    expect(JSON.stringify(automaticIdentity(who, system, counts))).not.toContain('@');
  });
  it('requires a let-in computer and uses no free-form fallback', () => {
    expect(automaticIdentity({ ...who, role: null }, system, counts)).toBe(null);
    expect(automaticIdentity({ ...who, grantId: null }, system, counts)).toBe(null);
    expect(automaticIdentity(who, { ...system, release: 'private content' }, counts)).toBe(null);
  });
});
