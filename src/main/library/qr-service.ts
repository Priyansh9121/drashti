import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { nfc } from '../../shared/nfc';
import type {
  QrChoices,
  QrChoicesChange,
  QrChoicesResult,
  QrDownloadResult,
  QrPicked,
} from '../../shared/qr-picture';
import { QR_DOWNLOAD_PIXELS, QR_SLIDE_PIXELS, QR_TEXT_MAX, qrWords } from '../../shared/qr-picture';
import { cutText } from '../../shared/text';
import { fileProblem } from '../plain-errors';
import type { QrJob, QrMade } from './qr-maker';
import { pngHeader, QR_LOGO_MAX_SIDE } from './qr-raster';

/*
 * The QR code… window's logo and Download… (Q60-28, the owner's words of 20 Nov 2026: "we also want to use a download
 * QR code option here. the QR code generated should consist of akshar deri logo, no text just logo, which can be used
 * as well.", and his "Yes, A" to choosing the logo as a picture).
 *
 * - Logo in the middle: Choose a Picture… is the system's open dialog (a PNG or JPEG); the window draws the picture
 *   at most 1024 pixels a side and gives back that copy as a PNG, which Drashti keeps in its media folder's qr/ under
 *   its sha256 (so the picture's own file, the private opening pack's or the setup kit's, can go) and remembers, with
 *   Logo in the middle on. The real logo reaches a mandir's computer only that way: nothing is ever fetched.
 * - Download… is the system's save dialog, offering Downloads (or the folder used last): the PNG (about 2048 pixels)
 *   and the SVG go there under the name chosen, only the code and the logo, each read back first by the QR worker.
 *   A file of that name already there is written over only when the save dialog asked about it (the one chosen, and
 *   its partner with it); otherwise nothing is saved and the window says why. Nothing is ever saved anywhere else.
 * - The QR-code slide's picture (about 1080 pixels) comes from the same worker, with the logo when asked.
 * Nothing here touches the show: the pictures are made in the QR worker, off Main's thread.
 */

/** What Drashti remembers. */
interface QrSetting {
  logo: { sha256: string; name: string } | null;
  useLogo: boolean;
  wordsUnder: boolean;
  /** The folder Download… saved in last. */
  folder: string | null;
}

const SETTING = 'qrCode';
const SHA256 = /^[0-9a-f]{64}$/u;
/** The largest picture Choose a Picture… reads (a logo is far smaller). */
export const QR_PICK_MAX_BYTES = 20 * 1024 * 1024;
/** The largest logo copy Drashti keeps (a PNG at most 1024 pixels a side). */
const QR_COPY_MAX_BYTES = 8 * 1024 * 1024;
/** The name Download… offers. */
export const QR_DOWNLOAD_NAME = 'QR code';

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];
const JPEG_MAGIC = [255, 216, 255];
const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  magic.every((b, i) => bytes[i] === b);

export interface QrServiceDeps {
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  mediaDir: string;
  /** A code's pictures, made off Main's thread (the QR worker, qr-worker-run.ts). */
  make(job: QrJob): Promise<QrMade>;
  /** The system's open dialog for a picture: the file chosen, or null. */
  pickPicture(): Promise<string | null>;
  /** The system's save dialog, offering `defaultPath`: the file chosen, or null. */
  pickSave(defaultPath: string): Promise<string | null>;
  /** Where Download… offers to save the first time: Downloads (a test's own folder in tests). */
  downloads(): string;
}

/** The kept logo's copy, in the media folder. */
export const qrLogoPath = (sha256: string): string => join('qr', `${sha256}.png`);

/** Write a file whole, by a temporary file renamed into place, so a half-written one never takes its name. */
async function writeWhole(file: string, bytes: Uint8Array | string): Promise<void> {
  const part = `${file}.${randomUUID()}.part`;
  try {
    await writeFile(part, bytes);
    await rename(part, file);
  } catch (error) {
    await rm(part, { force: true }).catch(() => undefined);
    throw error;
  }
}

const exists = async (file: string): Promise<boolean> => (await stat(file).catch(() => null)) !== null;

function readSetting(value: unknown): QrSetting {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const logo =
    typeof v['logo'] === 'object' && v['logo'] !== null ? (v['logo'] as Record<string, unknown>) : null;
  const kept =
    logo &&
    typeof logo['sha256'] === 'string' &&
    SHA256.test(logo['sha256']) &&
    typeof logo['name'] === 'string'
      ? { sha256: logo['sha256'], name: logo['name'] }
      : null;
  return {
    logo: kept,
    useLogo: kept !== null && v['useLogo'] === true,
    wordsUnder: v['wordsUnder'] !== false,
    folder: typeof v['folder'] === 'string' && isAbsolute(v['folder']) ? v['folder'] : null,
  };
}

/** Why words cannot be a code: none, or too many. */
function wordsProblem(words: string): string {
  return words.trim() === ''
    ? 'Paste a link or type the words first.'
    : `That is too long for a code a phone can read across the hall: ${String(QR_TEXT_MAX)} letters at most.`;
}

export class QrService {
  constructor(private readonly deps: QrServiceDeps) {}

  private setting(): QrSetting {
    return readSetting(this.deps.settings.get(SETTING));
  }

  private save(setting: QrSetting): void {
    this.deps.settings.set(SETTING, setting);
  }

  /** The kept logo's copy, or null when none is kept or its file is gone. */
  private async logoBytes(setting = this.setting()): Promise<Uint8Array | null> {
    if (!setting.logo) return null;
    return readFile(join(this.deps.mediaDir, qrLogoPath(setting.logo.sha256))).catch(() => null);
  }

  /** The window's choices, with the kept logo's picture. */
  async choices(): Promise<QrChoices> {
    const setting = this.setting();
    const bytes = await this.logoBytes(setting);
    const logo =
      setting.logo && bytes
        ? {
            name: setting.logo.name,
            dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
          }
        : null;
    return { logo, useLogo: logo !== null && setting.useLogo, wordsUnder: setting.wordsUnder };
  }

  /** Choose a Picture…: the system's open dialog, then the picture's own bytes for the window to draw its copy. */
  async pickLogo(): Promise<QrPicked> {
    const file = await this.deps.pickPicture();
    if (file === null) return { ok: false, cancelled: true };
    const name = basename(file);
    try {
      const size = (await stat(file)).size;
      if (size > QR_PICK_MAX_BYTES)
        return { ok: false, message: `“${name}” is too large for a logo: choose a picture under 20 MB.` };
      const bytes = new Uint8Array(await readFile(file));
      if (!startsWith(bytes, PNG_MAGIC) && !startsWith(bytes, JPEG_MAGIC))
        return { ok: false, message: `“${name}” is not a PNG or JPEG picture: choose another.` };
      return { ok: true, name, bytes };
    } catch (error) {
      return { ok: false, message: `“${name}” could not be read. ${fileProblem(error, 'read')}` };
    }
  }

  /** The window's copy of the chosen picture (a PNG at most 1024 pixels a side), kept and remembered, the logo on. */
  async keepLogo(name: unknown, png: unknown): Promise<QrChoicesResult> {
    if (
      typeof name !== 'string' ||
      name.trim() === '' ||
      !(png instanceof Uint8Array) ||
      png.length > QR_COPY_MAX_BYTES
    )
      return { ok: false, message: 'That picture could not be kept: choose it again.' };
    const header = pngHeader(png);
    if (!header || header.width > QR_LOGO_MAX_SIDE || header.height > QR_LOGO_MAX_SIDE)
      return { ok: false, message: 'That picture could not be kept: choose it again.' };
    const sha256 = createHash('sha256').update(png).digest('hex');
    const before = this.setting();
    try {
      await mkdir(join(this.deps.mediaDir, 'qr'), { recursive: true });
      await writeWhole(join(this.deps.mediaDir, qrLogoPath(sha256)), png);
    } catch (error) {
      return { ok: false, message: `Could not keep the logo’s picture. ${fileProblem(error, 'own')}` };
    }
    this.save({ ...before, logo: { sha256, name: cutText(nfc(name.trim()), 120, '…') }, useLogo: true });
    // The copy it replaces goes (none there is no harm).
    if (before.logo && before.logo.sha256 !== sha256)
      await rm(join(this.deps.mediaDir, qrLogoPath(before.logo.sha256)), { force: true }).catch(
        () => undefined,
      );
    return { ok: true, choices: await this.choices() };
  }

  /** Logo in the middle on or off (on only with a logo kept), and the words under the code: remembered. */
  async setChoices(change: unknown): Promise<QrChoicesResult> {
    const c = typeof change === 'object' && change !== null ? (change as QrChoicesChange) : {};
    const setting = this.setting();
    this.save({
      ...setting,
      useLogo: typeof c.useLogo === 'boolean' ? c.useLogo && setting.logo !== null : setting.useLogo,
      wordsUnder: typeof c.wordsUnder === 'boolean' ? c.wordsUnder : setting.wordsUnder,
    });
    return { ok: true, choices: await this.choices() };
  }

  /** The kept logo for a code that asks for it, or why it cannot have it. */
  private async logoFor(asked: boolean): Promise<{ logo: Uint8Array | null } | { message: string }> {
    if (!asked) return { logo: null };
    const logo = await this.logoBytes();
    return logo
      ? { logo }
      : { message: 'The logo’s picture is not there now: choose it again with Choose a Picture….' };
  }

  /**
   * Download…: the system's save dialog, then the code (with the logo when asked) as a PNG of about 2048 pixels and
   * an SVG, under the name chosen, each read back first.
   */
  async download(text: unknown, options: unknown): Promise<QrDownloadResult> {
    const typed = typeof text === 'string' ? nfc(text) : '';
    const words = qrWords(typed);
    if (words === null) return { ok: false, message: wordsProblem(typed) };
    const o = typeof options === 'object' && options !== null ? (options as { logo?: unknown }) : {};
    const logo = await this.logoFor(o.logo === true);
    if ('message' in logo) return { ok: false, message: logo.message };
    const setting = this.setting();
    const chosen = await this.deps.pickSave(
      join(setting.folder ?? this.deps.downloads(), `${QR_DOWNLOAD_NAME}.png`),
    );
    if (chosen === null) return { ok: false, cancelled: true };
    // The PNG and the SVG: the one chosen keeps its name, its partner beside it.
    const base = chosen.replace(/\.(?:png|svg)$/iu, '');
    const png = /\.png$/iu.test(chosen) ? chosen : `${base}.png`;
    const svg = /\.svg$/iu.test(chosen) ? chosen : `${base}.svg`;
    // The save dialog asked about the one chosen if it was there; its partner is written over only with it.
    const agreed = await exists(chosen);
    for (const file of [png, svg])
      if (file !== chosen && !agreed && (await exists(file)))
        return {
          ok: false,
          message: `“${basename(file)}” is already in that folder: choose another name, or move that file first.`,
        };
    const made = await this.deps.make({ words, logo: logo.logo, about: QR_DOWNLOAD_PIXELS, svg: true });
    if (!made.ok) return made;
    try {
      await writeWhole(png, made.png);
      await writeWhole(svg, made.svg ?? '');
    } catch (error) {
      return { ok: false, message: `Could not save the QR code. ${fileProblem(error, 'write')}` };
    }
    this.save({ ...this.setting(), folder: dirname(png) });
    return { ok: true, files: [png, svg] };
  }

  /** The QR-code slide's picture (about 1080 pixels), with the logo when asked, read back first. */
  async slidePicture(words: string, withLogo: boolean): Promise<QrMade> {
    const logo = await this.logoFor(withLogo);
    if ('message' in logo) return { ok: false, message: logo.message };
    return this.deps.make({ words, logo: logo.logo, about: QR_SLIDE_PIXELS, svg: false });
  }
}
