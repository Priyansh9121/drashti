import { describe, expect, it } from 'vitest';
import { compareVersions, manifestUrl, updateManifestSchema } from './updates';

describe('versions', () => {
  it('compare as semantic versions, a pre-release before its release', () => {
    const sorted = [
      '1.0.0',
      '1.0.0-alpha.10',
      '0.9.9',
      '1.0.0-alpha.2',
      '1.0.0-beta',
      '1.0.1',
      '1.0.0-alpha',
    ];
    expect([...sorted].sort(compareVersions)).toEqual([
      '0.9.9',
      '1.0.0-alpha',
      '1.0.0-alpha.2',
      '1.0.0-alpha.10',
      '1.0.0-beta',
      '1.0.0',
      '1.0.1',
    ]);
    expect(compareVersions('1.0.0-alpha.0', '1.0.0-alpha.0')).toBe(0);
  });

  it('find the newest release, or one version, on GitHub Releases', () => {
    expect(manifestUrl('https://github.com/o/r/releases', null)).toBe(
      'https://github.com/o/r/releases/latest/download/drashti-update.json',
    );
    expect(manifestUrl('https://github.com/o/r/releases', '1.0.1')).toBe(
      'https://github.com/o/r/releases/download/v1.0.1/drashti-update.json',
    );
  });

  it('read only manifests whose files are on https (or this computer, for tests)', () => {
    const file = {
      platform: 'win32',
      arch: 'x64',
      kind: 'nsis',
      name: 'Drashti-1.0.1-setup-x64.exe',
      url: 'https://github.com/o/r/releases/download/v1.0.1/Drashti-1.0.1-setup-x64.exe',
      size: 1000,
      sha512: `${'A'.repeat(86)}==`,
    };
    const m = { app: 'drashti', version: '1.0.1', releasedAt: '', notes: '', source: '', files: [file] };
    expect(updateManifestSchema.safeParse(m).success).toBe(true);
    expect(
      updateManifestSchema.safeParse({ ...m, files: [{ ...file, url: 'http://example.com/x.exe' }] }).success,
    ).toBe(false);
    expect(
      updateManifestSchema.safeParse({ ...m, files: [{ ...file, url: 'http://127.0.0.1:8080/x.exe' }] })
        .success,
    ).toBe(true);
    expect(updateManifestSchema.safeParse({ ...m, version: 'one' }).success).toBe(false);
  });
});
