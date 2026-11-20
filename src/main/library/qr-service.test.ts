import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QR_DOWNLOAD_PIXELS, QR_SLIDE_PIXELS } from '../../shared/qr-picture';
import type { QrJob } from './qr-maker';
import { makeQr } from './qr-maker';
import { readPng, writePng } from './qr-raster';
import { readQr } from './qr-read';
import { QR_PICK_MAX_BYTES, qrLogoPath, QrService } from './qr-service';
import { placeholderLogoPng } from './testing/qr-logo';

/*
 * The QR code… window's logo and Download… (Q60-28, the owner's words of 20 Nov 2026: "we also want to use a download
 * QR code option here. the QR code generated should consist of akshar deri logo, no text just logo, which can be used
 * as well."; his "Yes, A": the logo chosen as a picture, remembered). The system's dialogs are stand-ins here; the
 * pictures are made and read back as the QR worker makes them. A generated placeholder logo only, never the mandir's.
 */

const LINK = 'https://example.org/placeholder-sabha';
const folders: string[] = [];

afterEach(() => {
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});

function setup(answers: { picture?: string | null; save?: string | null } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'drashti-qr-service-'));
  folders.push(base);
  const mediaDir = join(base, 'Media');
  const downloads = join(base, 'Downloads');
  mkdirSync(mediaDir);
  mkdirSync(downloads);
  const stored = new Map<string, unknown>();
  const settings = {
    get: (name: string) => stored.get(name),
    set: (name: string, value: unknown) => {
      stored.set(name, JSON.parse(JSON.stringify(value)) as unknown);
    },
  };
  const asked = { pictures: 0, offered: [] as string[], jobs: [] as QrJob[] };
  const t = {
    base,
    mediaDir,
    downloads,
    settings,
    asked,
    answers: { picture: answers.picture ?? null, save: answers.save ?? null },
    service: null as unknown as QrService,
  };
  const make = (stored2 = settings) =>
    new QrService({
      settings: stored2,
      mediaDir,
      make: (job) => {
        asked.jobs.push(job);
        return Promise.resolve(makeQr(job, readQr));
      },
      pickPicture: () => {
        asked.pictures += 1;
        return Promise.resolve(t.answers.picture);
      },
      pickSave: (defaultPath) => {
        asked.offered.push(defaultPath);
        return Promise.resolve(t.answers.save);
      },
      downloads: () => downloads,
    });
  t.service = make();
  return { ...t, again: () => make() };
}

/** Everything under a folder, as paths inside it. */
const filesIn = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
    .sort();

describe('the QR code… window’s logo and Download… (Q60-28)', () => {
  it('Choose a Picture…: the system’s open dialog; a PNG or JPEG comes back as it is, anything else is turned down with why, and Cancel gives nothing', async () => {
    const t = setup();
    expect(await t.service.pickLogo()).toEqual({ ok: false, cancelled: true });
    const png = join(t.base, 'Placeholder logo.png');
    writeFileSync(png, placeholderLogoPng());
    t.answers.picture = png;
    const picked = await t.service.pickLogo();
    expect(picked).toEqual({
      ok: true,
      name: 'Placeholder logo.png',
      bytes: new Uint8Array(placeholderLogoPng()),
    });
    const jpeg = join(t.base, 'Placeholder photo.jpg');
    writeFileSync(jpeg, Buffer.from([255, 216, 255, 224, 0, 16]));
    t.answers.picture = jpeg;
    expect((await t.service.pickLogo()).ok).toBe(true);
    const notes = join(t.base, 'Placeholder notes.png');
    writeFileSync(notes, 'placeholder words, not a picture');
    t.answers.picture = notes;
    expect(await t.service.pickLogo()).toEqual({
      ok: false,
      message: '“Placeholder notes.png” is not a PNG or JPEG picture: choose another.',
    });
    const big = join(t.base, 'Placeholder big.png');
    writeFileSync(big, Buffer.alloc(QR_PICK_MAX_BYTES + 1));
    t.answers.picture = big;
    expect(await t.service.pickLogo()).toEqual({
      ok: false,
      message: '“Placeholder big.png” is too large for a logo: choose a picture under 20 MB.',
    });
    expect(t.asked.pictures).toBe(5);
    // Nothing kept by choosing alone.
    expect(filesIn(t.mediaDir)).toEqual([]);
  });

  it('the window’s copy is kept in the media folder’s qr/ by its sha256 and remembered, the logo on; another replaces it; a restart has it', async () => {
    const t = setup();
    const before = await t.service.choices();
    expect(before).toEqual({ logo: null, useLogo: false, wordsUnder: true });
    const first = placeholderLogoPng(64, 64);
    const kept = await t.service.keepLogo('Placeholder logo.png', first);
    if (!kept.ok) throw new Error(kept.message);
    expect(kept.choices.useLogo).toBe(true);
    expect(kept.choices.logo?.name).toBe('Placeholder logo.png');
    expect(kept.choices.logo?.dataUrl).toBe(`data:image/png;base64,${Buffer.from(first).toString('base64')}`);
    expect(filesIn(t.mediaDir)).toHaveLength(1);
    expect(filesIn(t.mediaDir)[0]).toMatch(/^qr[\\/][0-9a-f]{64}\.png$/u);
    // Another picture: kept in its place, the first copy gone.
    const second = placeholderLogoPng(96, 48);
    const again = await t.service.keepLogo('Placeholder wide logo.png', second);
    expect(again.ok).toBe(true);
    expect(filesIn(t.mediaDir)).toHaveLength(1);
    // After a restart (a new service on the same library's settings and media folder).
    const restarted = await t.again().choices();
    expect(restarted.logo?.name).toBe('Placeholder wide logo.png');
    expect(restarted.useLogo).toBe(true);
    // Its copy gone from the folder (a backup restored without it): no logo, and Logo in the middle off.
    rmSync(join(t.mediaDir, 'qr'), { recursive: true });
    expect(await t.service.choices()).toEqual({ logo: null, useLogo: false, wordsUnder: true });
  });

  it('keeps only a PNG of at most 1024 pixels a side, turning anything else down with why and keeping nothing', async () => {
    const t = setup();
    const wide = writePng({ width: 1025, height: 4, channels: 3, data: new Uint8Array(1025 * 4 * 3) });
    for (const [name, png] of [
      ['Placeholder.png', new Uint8Array([1, 2, 3])],
      ['Placeholder.png', wide],
      ['', placeholderLogoPng(16, 16)],
      [42, placeholderLogoPng(16, 16)],
      ['Placeholder.png', 'not bytes'],
    ] as const) {
      expect(await t.service.keepLogo(name, png)).toEqual({
        ok: false,
        message: 'That picture could not be kept: choose it again.',
      });
    }
    expect(filesIn(t.mediaDir)).toEqual([]);
    expect((await t.service.choices()).logo).toBeNull();
  });

  it('Logo in the middle and the words under the code are remembered; the logo is never on without one kept', async () => {
    const t = setup();
    const on = await t.service.setChoices({ useLogo: true, wordsUnder: false });
    expect(on).toEqual({ ok: true, choices: { logo: null, useLogo: false, wordsUnder: false } });
    await t.service.keepLogo('Placeholder logo.png', placeholderLogoPng(32, 32));
    const off = await t.service.setChoices({ useLogo: false });
    if (!off.ok) throw new Error(off.message);
    expect(off.choices.useLogo).toBe(false);
    expect(off.choices.wordsUnder).toBe(false);
    expect((await t.again().choices()).useLogo).toBe(false);
    // Nonsense changes nothing.
    expect((await t.service.setChoices('on')).ok).toBe(true);
    expect((await t.service.choices()).wordsUnder).toBe(false);
  });

  it('Download… asks where (Downloads first, then the folder used last) and saves the PNG and the SVG there under the name chosen, read back; Cancel saves nothing anywhere', async () => {
    const t = setup();
    const chosen = join(t.base, 'Chosen');
    mkdirSync(chosen);
    // Cancelled: nothing anywhere.
    expect(await t.service.download(LINK, { logo: false })).toEqual({ ok: false, cancelled: true });
    expect(t.asked.offered).toEqual([join(t.downloads, 'QR code.png')]);
    expect(t.asked.jobs).toEqual([]);
    t.answers.save = join(chosen, 'Placeholder code.png');
    await t.service.keepLogo('Placeholder logo.png', placeholderLogoPng());
    const saved = await t.service.download(LINK, { logo: true });
    expect(saved).toEqual({
      ok: true,
      files: [join(chosen, 'Placeholder code.png'), join(chosen, 'Placeholder code.svg')],
    });
    expect(t.asked.jobs.map((j) => [j.about, j.svg, j.logo !== null])).toEqual([
      [QR_DOWNLOAD_PIXELS, true, true],
    ]);
    const img = readPng(readFileSync(join(chosen, 'Placeholder code.png')));
    expect(img ? readQr(img) : null).toBe(LINK);
    expect(readFileSync(join(chosen, 'Placeholder code.svg'), 'utf8')).toContain('<image ');
    expect(filesIn(t.downloads)).toEqual([]);
    // The folder used last is offered next.
    t.answers.save = null;
    await t.service.download(LINK, { logo: false });
    expect(t.asked.offered.at(-1)).toBe(join(chosen, 'QR code.png'));
    // Words: none, or too many, are turned down before anything is asked.
    expect(await t.service.download('   ', { logo: false })).toEqual({
      ok: false,
      message: 'Paste a link or type the words first.',
    });
    expect((await t.service.download('x'.repeat(301), { logo: false })).ok).toBe(false);
    expect(t.asked.offered).toHaveLength(3);
  });

  it('Download… never writes over a file the save dialog did not ask about: a new name whose partner is there already is turned down with why, saving nothing; a name agreed to be replaced takes its partner with it', async () => {
    const t = setup();
    const chosen = join(t.base, 'Chosen');
    mkdirSync(chosen);
    writeFileSync(join(chosen, 'Placeholder code.svg'), 'someone else’s picture');
    t.answers.save = join(chosen, 'Placeholder code.png');
    expect(await t.service.download(LINK, { logo: false })).toEqual({
      ok: false,
      message:
        '“Placeholder code.svg” is already in that folder: choose another name, or move that file first.',
    });
    expect(readFileSync(join(chosen, 'Placeholder code.svg'), 'utf8')).toBe('someone else’s picture');
    expect(existsSync(join(chosen, 'Placeholder code.png'))).toBe(false);
    expect(t.asked.jobs).toEqual([]);
    // The PNG there too: the save dialog asked about it (the one chosen), so both are written over.
    writeFileSync(join(chosen, 'Placeholder code.png'), 'an earlier code');
    const saved = await t.service.download(LINK, { logo: false });
    expect(saved.ok).toBe(true);
    expect(readFileSync(join(chosen, 'Placeholder code.svg'), 'utf8').startsWith('<svg')).toBe(true);
    // A name typed with .svg: that one is the one chosen, the PNG beside it.
    t.answers.save = join(chosen, 'Another.svg');
    expect(await t.service.download(LINK, { logo: false })).toEqual({
      ok: true,
      files: [join(chosen, 'Another.png'), join(chosen, 'Another.svg')],
    });
  });

  it('the slide’s picture (about 1080 pixels) and Download… use the logo only when asked, say so when its copy is gone, and give nothing that is not read back', async () => {
    const t = setup({ save: null });
    const plain = await t.service.slidePicture(LINK, false);
    expect(plain.ok).toBe(true);
    expect(t.asked.jobs.at(-1)).toMatchObject({ about: QR_SLIDE_PIXELS, svg: false, logo: null });
    // Asked for the logo with none kept: said, nothing made.
    const none = await t.service.slidePicture(LINK, true);
    expect(none).toEqual({
      ok: false,
      message: 'The logo’s picture is not there now: choose it again with Choose a Picture….',
    });
    expect(await t.service.download(LINK, { logo: true })).toEqual(none);
    await t.service.keepLogo('Placeholder logo.png', placeholderLogoPng());
    const withLogo = await t.service.slidePicture(LINK, true);
    expect(withLogo.ok).toBe(true);
    expect(t.asked.jobs.at(-1)?.logo).not.toBeNull();
    // A code the reader cannot read: nothing saved, the reason said.
    const unread = new QrService({
      settings: t.settings,
      mediaDir: t.mediaDir,
      make: (job) => Promise.resolve(makeQr(job, () => null)),
      pickPicture: () => Promise.resolve(null),
      pickSave: () => Promise.resolve(join(t.base, 'Never.png')),
      downloads: () => t.downloads,
    });
    const refused = await unread.download(LINK, { logo: true });
    expect(refused.ok).toBe(false);
    if (!refused.ok && 'message' in refused) expect(refused.message).toContain('could not be read back');
    expect(existsSync(join(t.base, 'Never.png'))).toBe(false);
    expect(existsSync(join(t.base, 'Never.svg'))).toBe(false);
    expect(qrLogoPath('a'.repeat(64))).toBe(join('qr', `${'a'.repeat(64)}.png`));
  });
});
