import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPDATE_BASE } from '../../shared/updates';

/*
 * The release's installers under names that never change (build/downloads.json, Session 18), so that
 * GitHub's releases/latest/download/<name> always gives the newest: one for each computer Drashti runs
 * on, and the files the update installs, each renamed from what electron-builder makes, in the
 * repository Drashti's update check reads, and linked from the README and the guides.
 */

interface Download {
  name: string;
  platform: string;
  arch: string;
  kind: string;
  built: string;
  for: string;
}

const app = join(__dirname, '..', '..', '..');
const read = (...path: string[]) => readFileSync(join(app, ...path), 'utf8');
const { repo, files } = JSON.parse(read('build', 'downloads.json')) as { repo: string; files: Download[] };
const link = (name: string) => `https://github.com/${repo}/releases/latest/download/${name}`;

describe('the downloads', () => {
  it('are one installer for each computer and the files the update installs, under names with no version', () => {
    expect(files.map((f) => `${f.platform} ${f.arch} ${f.kind}`).sort()).toEqual([
      'darwin arm64 dmg',
      'darwin arm64 zip',
      'darwin x64 dmg',
      'darwin x64 zip',
      'win32 x64 nsis',
    ]);
    for (const f of files) {
      expect(f.name).toMatch(/^Drashti-[a-z-]+\.(dmg|zip|exe)$/u);
      expect(f.built).toContain('{version}');
    }
    expect(new Set(files.map((f) => f.name)).size).toBe(files.length);
  });

  it('are renamed from what electron-builder makes', () => {
    // The Windows installer's name is set in electron-builder.yml; the Mac files' are its own (no arch for Intel).
    expect(read('electron-builder.yml')).toContain(
      'artifactName: ${productName}-${version}-setup-${arch}.${ext}',
    );
    const built = Object.fromEntries(files.map((f) => [`${f.platform} ${f.arch} ${f.kind}`, f.built]));
    expect(built).toEqual({
      'darwin arm64 dmg': 'Drashti-{version}-arm64.dmg',
      'darwin x64 dmg': 'Drashti-{version}.dmg',
      'darwin arm64 zip': 'Drashti-{version}-arm64-mac.zip',
      'darwin x64 zip': 'Drashti-{version}-mac.zip',
      'win32 x64 nsis': 'Drashti-{version}-setup-x64.exe',
    });
  });

  it('come from the repository Drashti looks for updates in', () => {
    expect(UPDATE_BASE).toBe(`https://github.com/${repo}/releases`);
  });

  it('are linked, each installer, from the README, the volunteers’ guide and the admin guide', () => {
    for (const doc of [['README.md'], ['docs', 'parallel-run.md'], ['docs', 'admin-guide.md']]) {
      const text = read(...doc);
      for (const f of files.filter((x) => x.kind !== 'zip'))
        expect(text, `${doc.join('/')} links ${f.name}`).toContain(link(f.name));
    }
  });
});
