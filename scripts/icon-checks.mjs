// What an installed Drashti shows for an icon (Session 19): Drashti's own, made by scripts/make-icons.mjs,
// never Electron's. scripts/check-installers.mjs runs these on every installer the Release workflow makes;
// src/main/windows/app-icon.test.ts gives them Electron's own icon, which they must refuse.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { carriedPictures, icoEntries, programIcons } from './icon-files.mjs';

const electronDist = (appDir) => join(appDir, 'node_modules', 'electron', 'dist');

/** Drashti's icons in the repository at `appDir`, and Electron's own where this computer has them. */
export function iconFiles(appDir) {
  return {
    icns: readFileSync(join(appDir, 'build', 'icon.icns')),
    ico: readFileSync(join(appDir, 'build', 'icon.ico')),
    electronIcns: join(electronDist(appDir), 'Electron.app', 'Contents', 'Resources', 'electron.icns'),
    electronExe: join(electronDist(appDir), 'electron.exe'),
  };
}

/** A Mac app shows Drashti's icon: Info.plist names an .icns that is build/icon.icns, not Electron's. */
export function macAppIcon(app, icons) {
  const plist = join(app, 'Contents', 'Info.plist');
  const read = spawnSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist], {
    encoding: 'utf8',
  });
  const named = read.status === 0 ? read.stdout.trim() : '';
  const file = join(app, 'Contents', 'Resources', named.endsWith('.icns') ? named : `${named}.icns`);
  const icon = named && existsSync(file) ? readFileSync(file) : null;
  if (!icon) return { ok: false, why: `its icon is missing (Info.plist names "${named}")` };
  if (existsSync(icons.electronIcns) && icon.equals(readFileSync(icons.electronIcns)))
    return { ok: false, why: `it still carries Electron's icon (${named})` };
  if (!icon.equals(icons.icns)) return { ok: false, why: `its icon (${named}) is not build/icon.icns` };
  return { ok: true, why: `shows Drashti's icon (${named}: build/icon.icns)` };
}

/** A Windows program carries Drashti's icon: every picture of build/icon.ico, and none of Electron's. */
export function windowsProgramIcon(program, what, icons) {
  if (!existsSync(program)) return { ok: false, why: `${what} is missing` };
  const pictures = programIcons(program);
  const electrons = existsSync(icons.electronExe) ? programIcons(icons.electronExe) : [];
  if (electrons.some((p) => pictures.some((q) => q.equals(p))))
    return { ok: false, why: `${what} still carries Electron's icon` };
  const ours = carriedPictures(icons.ico, pictures);
  const all = icoEntries(icons.ico).length;
  if (ours !== all)
    return {
      ok: false,
      why: `${what} carries ${String(ours)} of build/icon.ico's ${String(all)} pictures (${String(pictures.length)} icons in all)`,
    };
  return { ok: true, why: `${what} carries Drashti's icon (all ${String(all)} pictures of build/icon.ico)` };
}
