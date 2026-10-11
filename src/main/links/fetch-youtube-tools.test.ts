import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DENO_BUILDS,
  DENO_VERSION,
  restoreFrameworkLinks,
  sha256Of,
  verifyFile,
  YT_DLP_BUILDS,
  YT_DLP_VERSION,
} from '../../../scripts/fetch-youtube-tools.mjs';

/*
 * yt-dlp and Deno, pinned and checked (Session 25c, scripts/fetch-youtube-tools.mjs): each download is
 * the one its publisher listed, a file that differs from its pin is refused, and the downloads and
 * programs on this computer (CI fetches them before the unit tests) still match their pins.
 */

const app = join(__dirname, '..', '..', '..');
const SHA256 = /^[0-9a-f]{64}$/u;
let temp: string | null = null;
const tempDir = () => (temp = mkdtempSync(join(tmpdir(), 'drashti-tools-test-')));
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = null;
});

describe('the pins', () => {
  it('name each publisher’s own release, with a SHA-256', () => {
    expect(Object.keys(YT_DLP_BUILDS).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64']);
    expect(Object.keys(DENO_BUILDS).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64']);
    for (const b of Object.values(YT_DLP_BUILDS)) {
      expect(b.url.startsWith(`https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/`)).toBe(
        true,
      );
      expect(b.sha256).toMatch(SHA256);
    }
    for (const b of Object.values(DENO_BUILDS)) {
      expect(b.url.startsWith(`https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/`)).toBe(
        true,
      );
      expect(b.sha256).toMatch(SHA256);
      expect(b.binarySha256).toMatch(SHA256);
    }
  });

  it('refuse a file that differs from its pinned checksum', () => {
    const file = join(tempDir(), 'placeholder.zip');
    writeFileSync(file, 'placeholder bytes, not a real download');
    const pinned = sha256Of(file);
    expect(() => {
      verifyFile(file, pinned, 'A placeholder');
    }).not.toThrow();
    writeFileSync(file, 'placeholder bytes, not a real download!');
    expect(() => {
      verifyFile(file, pinned, 'A placeholder');
    }).toThrow(/A placeholder failed its check: sha256 [0-9a-f]{64}, expected [0-9a-f]{64}/u);
  });

  it('still match the downloads and programs on this computer', () => {
    let checked = 0;
    const cache = join(homedir(), '.cache', 'drashti');
    const pins: [string, string, string][] = [];
    for (const [target, b] of Object.entries(YT_DLP_BUILDS))
      pins.push([
        join(cache, `yt-dlp-${YT_DLP_VERSION}`, b.url.split('/').pop() ?? ''),
        b.sha256,
        `yt-dlp for ${target}`,
      ]);
    for (const [target, b] of Object.entries(DENO_BUILDS)) {
      pins.push([
        join(cache, `deno-${DENO_VERSION}`, b.url.split('/').pop() ?? ''),
        b.sha256,
        `Deno for ${target}`,
      ]);
      pins.push([join(app, 'vendor', 'deno', target, b.exe), b.binarySha256, `Deno's program for ${target}`]);
    }
    for (const [file, sha256, what] of pins)
      if (existsSync(file)) {
        verifyFile(file, sha256, what);
        checked++;
      }
    // What was put in vendor/ says which download it came from: the pinned one.
    for (const [tool, builds] of [
      ['yt-dlp', YT_DLP_BUILDS],
      ['deno', DENO_BUILDS],
    ] as const)
      for (const [target, b] of Object.entries(builds)) {
        const stamp = join(app, 'vendor', tool, target, 'SOURCE.txt');
        if (!existsSync(stamp)) continue;
        expect(readFileSync(stamp, 'utf8'), `${tool} for ${target}`).toContain(b.sha256);
        checked++;
      }
    console.log(`${String(checked)} pinned file(s) on this computer checked`);
  });
});

describe.skipIf(process.platform === 'win32')('the Mac yt-dlp’s framework links', () => {
  /** The layout the Mac zip unpacks to: every link a full copy. */
  function zipLayout(): string {
    const internal = join(tempDir(), '_internal');
    const fw = join(internal, 'Python.framework');
    for (const dir of [
      join(fw, 'Resources'),
      join(fw, 'Versions', '3.14', 'Resources'),
      join(fw, 'Versions', 'Current', 'Resources'),
    ]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'Info.plist'), 'placeholder plist');
    }
    for (const file of [
      join(internal, 'Python'),
      join(fw, 'Python'),
      join(fw, 'Versions', '3.14', 'Python'),
      join(fw, 'Versions', 'Current', 'Python'),
    ])
      writeFileSync(file, 'placeholder library');
    return internal;
  }

  it('are put back where each copy is the same as what it stands for', () => {
    const internal = zipLayout();
    expect(restoreFrameworkLinks(internal)).toBe(true);
    const fw = join(internal, 'Python.framework');
    expect(readlinkSync(join(fw, 'Versions', 'Current'))).toBe('3.14');
    expect(readlinkSync(join(fw, 'Python'))).toBe('Versions/Current/Python');
    expect(readlinkSync(join(fw, 'Resources'))).toBe('Versions/Current/Resources');
    expect(readlinkSync(join(internal, 'Python'))).toBe('Python.framework/Versions/3.14/Python');
    expect(readFileSync(join(internal, 'Python'), 'utf8')).toBe('placeholder library');
    expect(readFileSync(join(fw, 'Resources', 'Info.plist'), 'utf8')).toBe('placeholder plist');
    // A second time changes nothing.
    expect(restoreFrameworkLinks(internal)).toBe(false);
  });

  it('are not touched when a copy differs', () => {
    const internal = zipLayout();
    writeFileSync(join(internal, 'Python'), 'something else');
    expect(() => restoreFrameworkLinks(internal)).toThrow(/is not a copy of/u);
    const fw = join(internal, 'Python.framework');
    expect(lstatSync(join(fw, 'Versions', 'Current')).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(fw, 'Python')).isSymbolicLink()).toBe(false);
  });
});
