import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pngSize } from '../../../scripts/icon-files.mjs';

/*
 * The Mac disk image's window (Session 50, section 11). Drashti has no paid Apple Developer ID, so a new Mac
 * stops it the first time it is opened (Gatekeeper); the only real fix is paid, so no signing is added and
 * the free way is made plain instead. The window the .dmg opens shows a picture of the two steps: drag
 * Drashti to Applications, along the picture's arrow, then the first time, System Settings › Privacy &
 * Security › Open Anyway. It is drawn in build/background.svg at the window's size in points, and
 * scripts/make-dmg-background.mjs makes build/background.png and build/background@2x.png from it; electron-
 * builder joins the two for a Retina screen and gives the window the picture's size.
 */

const app = join(__dirname, '..', '..', '..');
const read = (...path: string[]) => readFileSync(join(app, ...path));

/** How far under an icon's centre Finder draws its name: half the icon, a gap, 12 pt text. */
const NAME_BELOW = 20;
/** What a Finder window's title bar can take from the bottom of the picture, in points. */
const TITLE_BAR = 28;

/** electron-builder.yml without its comments and empty lines, each line after a newline. */
function builderYml(): string {
  const lines = read('electron-builder.yml')
    .toString()
    .split('\n')
    .filter((line) => !/^\s*#/u.test(line) && line.trim() !== '')
    .map((line) => line.replace(/\s+#.*$/u, ''));
  return `\n${lines.join('\n')}\n`;
}

/** The lines under `key:` at `indent` spaces, each after a newline ('' when there is no such key). */
function under(text: string, key: string, indent: number): string {
  const lines = new RegExp(
    `\\n {${String(indent)}}${key}:\\n((?: {${String(indent + 2)},}\\S.*\\n)*)`,
    'u',
  ).exec(text)?.[1];
  return lines === undefined ? '' : `\n${lines}`;
}

/** The value of `key:` at `indent` spaces. */
function value(text: string, key: string, indent: number): string | undefined {
  return new RegExp(`\\n {${String(indent)}}${key}: (.+)\\n`, 'u').exec(text)?.[1]?.trim();
}

/** The dmg block's picture, window, icon size and contents, as electron-builder reads them. */
function dmgSettings() {
  const dmg = under(builderYml(), 'dmg', 0);
  const window = under(dmg, 'window', 2);
  // Each `- ` item of contents, its keys then all at 6 spaces.
  const contents = under(dmg, 'contents', 2)
    .split(/\n {4}- /u)
    .slice(1)
    .map((item) => `\n      ${item.endsWith('\n') ? item : `${item}\n`}`)
    .map((item) => ({
      x: Number(value(item, 'x', 6)),
      y: Number(value(item, 'y', 6)),
      // electron-builder takes an item with no type as a file: the app.
      type: value(item, 'type', 6) ?? 'file',
      path: value(item, 'path', 6),
    }));
  return {
    background: value(dmg, 'background', 2),
    window: { width: Number(value(window, 'width', 4)), height: Number(value(window, 'height', 4)) },
    // electron-builder's own when none is given.
    iconSize: Number(value(dmg, 'iconSize', 2) ?? 80),
    contents,
  };
}

const svgText = () => read('build', 'background.svg').toString();

/** The first element with this id in the picture's source ('' when there is none). */
const element = (svg: string, id: string) =>
  new RegExp(`<\\w+\\b[^>]*\\bid="${id}"[^>]*>`, 'u').exec(svg)?.[0] ?? '';
/** A number attribute of an element. */
const attribute = (tag: string, name: string) =>
  Number(new RegExp(`\\s${name}="(-?[\\d.]+)"`, 'u').exec(tag)?.[1] ?? Number.NaN);

/** A PNG's tEXt chunks: keyword to text. */
function pngTexts(bytes: Buffer): Map<string, string> {
  const texts = new Map<string, string>();
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString('latin1', at + 4, at + 8) === 'tEXt') {
      const data = bytes.subarray(at + 8, at + 8 + length);
      const end = data.indexOf(0);
      texts.set(data.toString('latin1', 0, end), data.toString('latin1', end + 1));
    }
    at += 12 + length;
  }
  return texts;
}

describe('the Mac disk image’s window (section 11)', () => {
  it('shows build/background.png at the window’s size, with a Retina picture exactly twice it', () => {
    const { background, window } = dmgSettings();
    expect(background).toBe('build/background.png');
    expect(window.width).toBeGreaterThan(0);
    expect(window.height).toBeGreaterThan(0);
    // The source is drawn at the window's size in points, and each picture is made at its scale.
    const svg = svgText();
    const root = /<svg\b[^>]*>/u.exec(svg)?.[0] ?? '';
    expect({ width: attribute(root, 'width'), height: attribute(root, 'height') }).toEqual(window);
    expect(root).toContain(`viewBox="0 0 ${String(window.width)} ${String(window.height)}"`);
    expect(pngSize(read('build', 'background.png'))).toEqual(window);
    expect(pngSize(read('build', 'background@2x.png'))).toEqual({
      width: window.width * 2,
      height: window.height * 2,
    });
  });

  it('was made from the current build/background.svg, and is small enough to commit', () => {
    const sha256 = createHash('sha256').update(read('build', 'background.svg')).digest('hex');
    for (const name of ['background.png', 'background@2x.png']) {
      const png = read('build', name);
      // After a change to the source, run `node scripts/make-dmg-background.mjs` and commit what it makes.
      expect(pngTexts(png).get('Source'), name).toBe(`build/background.svg ${sha256}`);
      expect(png.length, name).toBeLessThan(200 * 1024);
    }
  });

  it('puts the app at the arrow’s start and the Applications link at its end, each in its place', () => {
    const { window, iconSize, contents } = dmgSettings();
    expect(contents.map((item) => item.type)).toEqual(['file', 'link']);
    const [drashti, applications] = contents;
    expect(applications?.path).toBe('/Applications');
    for (const item of contents) {
      // Finder centres each icon on its x and y (points from the window's top left), its name below.
      expect(item.x - iconSize / 2).toBeGreaterThanOrEqual(0);
      expect(item.x + iconSize / 2).toBeLessThanOrEqual(window.width);
      expect(item.y - iconSize / 2).toBeGreaterThanOrEqual(0);
      expect(item.y + iconSize / 2 + NAME_BELOW).toBeLessThanOrEqual(window.height - TITLE_BAR);
    }
    const svg = svgText();
    // The arrow: a line from just right of the app to just left of the Applications link, level with both.
    const arrow = /^M([\d.]+) ([\d.]+)H([\d.]+)$/u.exec(
      /\bd="([^"]+)"/u.exec(element(svg, 'arrow'))?.[1] ?? '',
    );
    expect(arrow, 'build/background.svg has <path id="arrow" d="Mx yHx2">').not.toBeNull();
    const [from, level, to] = (arrow ?? []).slice(1).map(Number);
    expect(level).toBe(drashti?.y);
    expect(level).toBe(applications?.y);
    expect(from).toBeGreaterThan((drashti?.x ?? 0) + iconSize / 2);
    expect(to).toBeLessThan((applications?.x ?? 0) - iconSize / 2);
    // Each icon and its name sit in the middle of the place the picture draws for it.
    for (const [id, item] of [
      ['app-place', drashti],
      ['applications-place', applications],
    ] as const) {
      const place = element(svg, id);
      const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((name) => attribute(place, name));
      expect(place, `build/background.svg has <rect id="${id}">`).not.toBe('');
      expect((x ?? 0) + (width ?? 0) / 2).toBe(item?.x);
      expect(item?.y ?? 0).toBeGreaterThanOrEqual((y ?? 0) + iconSize / 2);
      expect((item?.y ?? 0) + iconSize / 2 + NAME_BELOW).toBeLessThanOrEqual((y ?? 0) + (height ?? 0));
      expect((y ?? 0) + (height ?? 0)).toBeLessThanOrEqual(window.height - TITLE_BAR);
    }
  });

  it('says the two steps in plain words, clear of the bottom, with Drashti’s logo and no one else’s', () => {
    const svg = svgText();
    const { window } = dmgSettings();
    const words = [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/gu)];
    const said = words.map((m) => m[2] ?? '').join(' | ');
    expect(said).toContain('Drag Drashti to Applications');
    expect(said).toContain('The first time you open it');
    expect(said).toContain('System Settings');
    expect(said).toContain('Privacy &amp; Security');
    expect(said).toContain('Open Anyway');
    // Above what a title bar can take, with room for the letters' tails.
    for (const [, attributes = ''] of words)
      expect(attribute(attributes, 'y')).toBeLessThanOrEqual(window.height - TITLE_BAR - 6);
    // Drashti's own mark: the icon's flame, its core and the lamp (build/icon.svg).
    const iconPaths = [
      ...read('build', 'icon.svg')
        .toString()
        .matchAll(/<path\s+d="([^"]+)"/gu),
    ];
    expect(iconPaths).toHaveLength(3);
    for (const [, d] of iconPaths) expect(svg).toContain(`d="${d ?? ''}"`);
    // Everything drawn here: no picture, font or page of anyone else's, Apple's logo least of all
    // (U+F8FF, Apple's logo as a letter in Apple's fonts).
    expect(svg).not.toMatch(/<image\b|<use\b|<foreignObject\b|@import|@font-face/u);
    expect(svg).not.toMatch(/href="(?!#)|url\((?!#)/u);
    expect(svg).not.toContain('\uf8ff');
    expect(svg).not.toMatch(/propresenter/iu);
  });

  it('turns on no signing and no notarisation: the free way, never a paid Developer ID', () => {
    // Each key that would sign with a certificate, notarise, or sign the disk image (electron-builder's
    // schema), with the one value that leaves it off. Ad hoc signing by scripts/package-release.mjs, free and
    // what lets Open Anyway work, is given on its command line, never here.
    const off: Record<string, RegExp> = {
      identity: /^null$/u,
      notarize: /^false$/u,
      sign: /^false$/u,
      forceCodeSigning: /^false$/u,
    };
    const never = [
      'cscLink',
      'cscKeyPassword',
      'cscInstallerLink',
      'cscInstallerKeyPassword',
      'provisioningProfile',
      'signtoolOptions',
      'certificateFile',
      'additionalCertificateFile',
      'certificatePassword',
      'certificateSha1',
      'certificateSubjectName',
      'azureSignOptions',
      'afterSign',
    ];
    const found = builderYml()
      .split('\n')
      .map((line) => /^\s*(?:-\s+)?([A-Za-z]+):\s*(.*)$/u.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .filter(([, key = '', said = '']) => {
        const leftOff = off[key];
        return never.includes(key) || (leftOff !== undefined && !leftOff.test(said));
      })
      .map((m) => m[0].trim());
    expect(found).toEqual([]);
  });
});
