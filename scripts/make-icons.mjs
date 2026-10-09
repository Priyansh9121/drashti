#!/usr/bin/env node
// Drashti's icon, every file of it made from one source (Session 19): build/icon.svg, drawn on Apple's
// 1024-pixel grid with its tile (the rounded square, id="tile") at 100..924.
//
//   node scripts/make-icons.mjs        (pnpm icons; on a Mac, which has Apple's iconutil for the .icns)
//
//   build/icon.icns   the Mac app, its .dmg and the zip the updates install: 16 to 512 px at 1x and 2x
//   build/icon.ico    Windows: the app and its windows, the installer, the Start menu, the uninstaller:
//                     16, 20, 24, 32, 40, 48, 64, 128 and 256 px, the tile filling more of each picture
//   src/renderer/src/web/icons/
//     apple-touch-icon.png  180 px, square and opaque: an iPhone or iPad rounds the corners itself
//     icon-192.png          for a phone's home screen (Android)
//     favicon-32.png        the browser tab
//   build/icons.json  the source's SHA-256, so the unit test can tell the files were made from it
//
// The pictures are drawn by Electron's Chromium in a hidden window (scripts/make-icons-render.mjs).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { icnsEntries, ICNS_TYPES, icoEntries, pngSize, writeIco } from './icon-files.mjs';

const SOURCE = resolve('build', 'icon.svg');
const WEB = resolve('src', 'renderer', 'src', 'web', 'icons');
const MAC_SIZES = [16, 32, 64, 128, 256, 512, 1024];
const WINDOWS_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
/** How much of a Windows icon the tile fills (a Mac's leaves Apple's margin round it). */
const WINDOWS_FILL = 0.94;

const svg = readFileSync(SOURCE, 'utf8');
const tile = /<rect\b[^>]*\bid="tile"[^>]*>/u.exec(svg)?.[0];
const number = (name) => Number(new RegExp(`\\b${name}="([\\d.]+)"`, 'u').exec(tile ?? '')?.[1] ?? NaN);
const [x, y, width, height] = ['x', 'y', 'width', 'height'].map(number);
if (!tile || ![x, y, width, height].every(Number.isFinite) || width !== height)
  throw new Error(
    'build/icon.svg needs its square tile as <rect id="tile" x=".." y=".." width=".." height="..">',
  );

const viewBox = (source, left, top, side) =>
  source.replace(
    /\bviewBox="[^"]*"/u,
    `viewBox="${String(left)} ${String(top)} ${String(side)} ${String(side)}"`,
  );
const side = Math.round(width / WINDOWS_FILL);
const views = {
  mac: svg,
  windows: viewBox(svg, x + width / 2 - side / 2, y + height / 2 - side / 2, side),
  // Square and edge to edge: iOS masks it to its own rounded shape.
  touch: viewBox(svg.replace(tile, tile.replace(/\brx="[^"]*"/u, 'rx="0"')), x, y, width),
};

const pictures = [
  ...MAC_SIZES.map((size) => ({ name: `mac-${String(size)}`, svg: views.mac, size })),
  ...[...WINDOWS_SIZES, 192].map((size) => ({ name: `windows-${String(size)}`, svg: views.windows, size })),
  { name: 'touch-180', svg: views.touch, size: 180 },
];
const work = mkdtempSync(join(tmpdir(), 'drashti-icons-'));
try {
  writeFileSync(join(work, 'job.json'), JSON.stringify({ out: work, pictures }));
  const env = { ...process.env };
  delete env['ELECTRON_RUN_AS_NODE'];
  const electron = createRequire(import.meta.url)('electron');
  const drawn = spawnSync(electron, [resolve('scripts', 'make-icons-render.mjs'), join(work, 'job.json')], {
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (drawn.status !== 0)
    throw new Error(`Electron could not draw the icon:\n${drawn.stdout}${drawn.stderr}`);
  const png = (name) => readFileSync(join(work, `${name}.png`));

  // The Mac's .icns, by Apple's own tool.
  const iconset = join(work, 'icon.iconset');
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    copyFileSync(
      join(work, `mac-${String(size)}.png`),
      join(iconset, `icon_${String(size)}x${String(size)}.png`),
    );
    copyFileSync(
      join(work, `mac-${String(size * 2)}.png`),
      join(iconset, `icon_${String(size)}x${String(size)}@2x.png`),
    );
  }
  if (process.platform === 'darwin') {
    const made = spawnSync('iconutil', ['-c', 'icns', iconset, '-o', resolve('build', 'icon.icns')], {
      encoding: 'utf8',
    });
    if (made.status !== 0) throw new Error(`iconutil could not make the .icns: ${made.stderr}`);
  } else console.log('build/icon.icns kept as it is: only a Mac has iconutil to make it.');

  // Windows' .ico.
  const ico = writeIco(
    WINDOWS_SIZES.map((size) =>
      size === 256
        ? { size, png: png('windows-256') }
        : { size, rgba: readFileSync(join(work, `windows-${String(size)}.rgba`)) },
    ),
  );
  writeFileSync(resolve('build', 'icon.ico'), ico);

  // The pages for phones and browsers.
  mkdirSync(WEB, { recursive: true });
  writeFileSync(join(WEB, 'apple-touch-icon.png'), png('touch-180'));
  writeFileSync(join(WEB, 'icon-192.png'), png('windows-192'));
  writeFileSync(join(WEB, 'favicon-32.png'), png('windows-32'));

  writeFileSync(
    resolve('build', 'icons.json'),
    `${JSON.stringify(
      {
        source: 'build/icon.svg',
        sha256: createHash('sha256').update(readFileSync(SOURCE)).digest('hex'),
        madeBy: 'scripts/make-icons.mjs',
      },
      null,
      2,
    )}\n`,
  );

  // What was made, read back.
  const icns = icnsEntries(readFileSync(resolve('build', 'icon.icns')))
    .filter((e) => e.type in ICNS_TYPES)
    .map((e) => `${e.type} ${String(e.size)}`);
  console.log(`build/icon.icns: ${icns.join(', ')}`);
  console.log(
    `build/icon.ico: ${icoEntries(ico)
      .map((e) => `${String(e.width)}${e.png ? ' (PNG)' : ''}`)
      .join(', ')}`,
  );
  for (const name of ['apple-touch-icon.png', 'icon-192.png', 'favicon-32.png'])
    console.log(
      `src/renderer/src/web/icons/${name}: ${String(pngSize(readFileSync(join(WEB, name)))?.width)} px`,
    );
} finally {
  rmSync(work, { recursive: true, force: true });
}
