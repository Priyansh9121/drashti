import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  carriedPictures,
  ICNS_TYPES,
  icnsEntries,
  icoEntries,
  pngPixels,
  pngSize,
  programIcons,
  writeIco,
} from '../../../scripts/icon-files.mjs';
import { iconFiles, macAppIcon, windowsProgramIcon } from '../../../scripts/icon-checks.mjs';
import { windowIconPath } from './app-icon';

/*
 * Drashti's own icon (Session 19), every file made from build/icon.svg by scripts/make-icons.mjs: the Mac's
 * .icns with every size a Mac shows, Windows' .ico from 16 to 256 px, and the icons of the pages a phone
 * opens. electron-builder.yml puts them on the app, the disk image, the installer and the uninstaller, and
 * on Windows each window names the .ico itself. Before Session 19 the app carried Electron's icon.
 */

const app = join(__dirname, '..', '..', '..');
const file = (...path: string[]) => readFileSync(join(app, ...path));
const WEB_ICONS = ['src', 'renderer', 'src', 'web', 'icons'];

/** One top-level part of electron-builder.yml (`mac:`, `win:`...), up to the next, each line after a newline. */
function builderPart(name: string): string {
  const yml = file('electron-builder.yml').toString();
  return `\n${new RegExp(`^${name}:\\n((?:[ #].*\\n|\\n)*)`, 'mu').exec(yml)?.[1] ?? ''}`;
}

describe("Drashti's icon", () => {
  it('was made from the current build/icon.svg', () => {
    const made = JSON.parse(file('build', 'icons.json').toString()) as { source: string; sha256: string };
    expect(made.source).toBe('build/icon.svg');
    // After a change to the source, run `pnpm icons` and commit what it makes.
    expect(createHash('sha256').update(file('build', 'icon.svg')).digest('hex')).toBe(made.sha256);
  });

  it('has every size a Mac shows: 16, 32, 128, 256 and 512 px, each also for a Retina screen', () => {
    const entries = icnsEntries(file('build', 'icon.icns'));
    const sizes = Object.fromEntries(
      entries.filter((e) => e.type in ICNS_TYPES).map((e) => [e.type, e.size]),
    );
    expect(sizes).toEqual(ICNS_TYPES);
    expect(Object.values(ICNS_TYPES).sort((a, b) => a - b)).toEqual([
      16, 32, 32, 64, 128, 256, 256, 512, 512, 1024,
    ]);
  });

  it('has every size Windows shows, from 16 to 256 px, in full colour', () => {
    const entries = icoEntries(file('build', 'icon.ico'));
    expect(entries.map((e) => e.width)).toEqual([16, 20, 24, 32, 40, 48, 64, 128, 256]);
    for (const e of entries) {
      expect(e.height).toBe(e.width);
      expect(e.bits).toBe(32);
      // Bitmaps up to 128 px (every part of Windows reads them), a PNG at 256 px.
      expect(e.png).toBe(e.width === 256);
    }
    expect(pngSize(entries[entries.length - 1]?.data ?? Buffer.alloc(0))).toEqual({
      width: 256,
      height: 256,
    });
  });

  it("has the phone pages' icons: a square one for an iPhone or iPad's Home Screen, and the browser's", () => {
    const touch = pngPixels(file(...WEB_ICONS, 'apple-touch-icon.png'));
    expect([touch.width, touch.height]).toEqual([180, 180]);
    // Opaque to the corners: iOS rounds them itself, and fills see-through ones with black.
    for (const [x, y] of [
      [0, 0],
      [179, 0],
      [0, 179],
      [179, 179],
    ] as const)
      expect(touch.rgba[(y * 180 + x) * 4 + 3]).toBe(255);
    expect(pngSize(file(...WEB_ICONS, 'icon-192.png'))).toEqual({ width: 192, height: 192 });
    expect(pngSize(file(...WEB_ICONS, 'favicon-32.png'))).toEqual({ width: 32, height: 32 });
  });

  it('is linked from every page a phone or browser opens', () => {
    for (const page of ['pair', 'remote', 'stage-display', 'announce']) {
      const html = file('src', 'renderer', `${page}.html`).toString();
      expect(html).toContain('<link rel="apple-touch-icon" href="./src/web/icons/apple-touch-icon.png" />');
      expect(html).toContain('sizes="32x32" href="./src/web/icons/favicon-32.png"');
      expect(html).toContain('sizes="192x192" href="./src/web/icons/icon-192.png"');
    }
  });

  it('is set for the Mac app and its disk image, and the Windows app, installer and uninstaller', () => {
    expect(builderPart('mac')).toContain('\n  icon: build/icon.icns\n');
    expect(builderPart('dmg')).toContain('\n  icon: build/icon.icns\n');
    expect(builderPart('win')).toContain('\n  icon: build/icon.ico\n');
    expect(builderPart('nsis')).toContain('\n  installerIcon: build/icon.ico\n');
    expect(builderPart('nsis')).toContain('\n  uninstallerIcon: build/icon.ico\n');
    // The copy the windows name on Windows, beside the app's resources.
    expect(builderPart('win')).toContain('    - from: build/icon.ico\n      to: icon.ico\n');
  });

  it("names the .ico for a window on Windows, where the taskbar shows each window's icon", () => {
    const place = { resourcesPath: join('C:', 'Drashti', 'resources'), appPath: join('C:', 'repo') };
    expect(windowIconPath({ ...place, platform: 'win32', packaged: true })).toBe(
      join('C:', 'Drashti', 'resources', 'icon.ico'),
    );
    expect(windowIconPath({ ...place, platform: 'win32', packaged: false })).toBe(
      join('C:', 'repo', 'build', 'icon.ico'),
    );
    // A Mac shows the app's own icon for every window.
    expect(windowIconPath({ ...place, platform: 'darwin', packaged: true })).toBeUndefined();
  });

  it("is not Electron's", () => {
    const electronIcns = join(
      app,
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'Resources',
    );
    if (existsSync(electronIcns))
      expect(file('build', 'icon.icns').equals(readFileSync(join(electronIcns, 'electron.icns')))).toBe(
        false,
      );
    const electronExe = join(app, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (existsSync(electronExe)) {
      const pictures = programIcons(electronExe);
      // The reader finds Electron's own icon in its program, and none of its pictures is Drashti's.
      expect(pictures.length).toBeGreaterThan(0);
      expect(carriedPictures(file('build', 'icon.ico'), pictures)).toBe(0);
    }
  });

  it.runIf(process.platform === 'darwin')(
    "makes the installer check refuse a Mac app that still carries Electron's icon",
    () => {
      const icons = iconFiles(app);
      const dir = mkdtempSync(join(tmpdir(), 'drashti-icon-check-'));
      try {
        // A bundle as electron-builder leaves it: Info.plist names the icon in Contents/Resources.
        const bundle = (iconName: string, from: string) => {
          const at = join(dir, `${iconName}.app`);
          mkdirSync(join(at, 'Contents', 'Resources'), { recursive: true });
          writeFileSync(
            join(at, 'Contents', 'Info.plist'),
            `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIconFile</key><string>${iconName}</string></dict></plist>\n`,
          );
          copyFileSync(from, join(at, 'Contents', 'Resources', iconName));
          return at;
        };
        expect(macAppIcon(bundle('electron.icns', icons.electronIcns), icons)).toEqual({
          ok: false,
          why: "it still carries Electron's icon (electron.icns)",
        });
        expect(macAppIcon(bundle('icon.icns', join(app, 'build', 'icon.icns')), icons).ok).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    "makes the installer check refuse a Windows program that still carries Electron's icon",
    () => {
      const icons = iconFiles(app);
      expect(windowsProgramIcon(icons.electronExe, 'Drashti.exe', icons)).toEqual({
        ok: false,
        why: "Drashti.exe still carries Electron's icon",
      });
    },
  );

  it('writes an .ico that reads back: bitmaps bottom up with their mask, and a PNG as it is', () => {
    // 2 x 2: red, see-through / green, blue (top row first).
    const rgba = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255]);
    const png = file(...WEB_ICONS, 'favicon-32.png');
    const [small, large] = icoEntries(
      writeIco([
        { size: 2, rgba },
        { size: 256, png },
      ]),
    );
    expect([small?.width, small?.bits, small?.png, large?.width, large?.png]).toEqual([
      2,
      32,
      false,
      256,
      true,
    ]);
    expect(large?.data.equals(png)).toBe(true);
    const bitmap = small?.data ?? Buffer.alloc(0);
    expect(bitmap.readInt32LE(8)).toBe(4); // twice the height: the picture and its mask
    // The bottom row first, each pixel blue, green, red, alpha.
    expect([...bitmap.subarray(40, 56)]).toEqual([
      0, 255, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0,
    ]);
    // The mask marks the see-through pixel (top row, second): bit 6 of the top row's mask (stored last).
    expect([...bitmap.subarray(56, 64)]).toEqual([0, 0, 0, 0, 0x40, 0, 0, 0]);
  });
});
