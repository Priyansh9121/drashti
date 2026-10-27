import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { MEDIA_LINK_MS } from '../../shared/device-pictures';
import { contentTypeOf, parseRange } from '../media/media-protocol';
import type { PreviewSource } from './previews';
import { type Rendition, RenditionMaker } from './renditions';

/*
 * Full quality for phones and tablets (Session 54, D1), served by the network worker: a picture or a video's
 * frame at the width a device asks for (renditions.ts), and a picture's or video's own file in pieces as it is
 * played (HTTP Range); a sound's too, while a playlist shared with phones has it (D3). Files are sent from the
 * disk as they are read, never held whole in memory. A <video> or an <audio> cannot send a device's token, so a
 * device asks for a link to the file first: its address with a ticket signed for that device and that file
 * alone, for MEDIA_LINK_MS, with a key made at each start (no link outlives the run), and refused at once when
 * the device is removed. Only the original takes a link; everything else needs the token, as before.
 */

/** A file for a device: where it is, its type, and what names this version of it (its size and time if not given). */
export interface SentFile {
  path: string;
  type: string;
  tag?: string;
}

/**
 * Send a file, or the piece of it a Range header asks for (206), from the disk as it is read. A range past its
 * end is a 416; several ranges at once are answered with the whole file, as HTTP allows. False, with nothing
 * sent, when the file is not there.
 */
export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: SentFile,
  headers: Record<string, string>,
): Promise<boolean> {
  const s = await stat(file.path).catch(() => null);
  if (!s?.isFile()) return false;
  const size = s.size;
  // The same version answers If-None-Match without being sent again: a device asks each time (no-cache), cheaply.
  const tag = `"${file.tag ?? `${size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}`}"`;
  const base: Record<string, string> = {
    ...headers,
    'Content-Type': file.type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-cache',
    ETag: tag,
  };
  if (req.headers['if-none-match'] === tag && req.headers.range === undefined) {
    res.writeHead(304, base);
    res.end();
    return true;
  }
  const asked = typeof req.headers.range === 'string' ? req.headers.range : null;
  // A Range for an older version of the file (If-Range) is answered with the whole of the new one.
  const ifRange = req.headers['if-range'];
  const range = ifRange === undefined || ifRange === tag ? parseRange(asked, size) : null;
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...base, 'Content-Range': `bytes */${String(size)}`, 'Content-Length': '0' });
    res.end();
    return true;
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const length = Math.max(0, end - start + 1);
  res.writeHead(range ? 206 : 200, {
    ...base,
    'Content-Length': String(length),
    ...(range ? { 'Content-Range': `bytes ${String(start)}-${String(end)}/${String(size)}` } : {}),
  });
  if (req.method === 'HEAD' || length === 0) {
    res.end();
    return true;
  }
  const stream = createReadStream(file.path, { start, end, highWaterMark: 256 * 1024 });
  stream.on('error', () => res.destroy());
  // A device that goes away (a video closed, a seek) stops the reading at once.
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
}

// ---- links for a <video> -------------------------------------------------------------------------

/** Signed links to a media file's original, for one device and one file each. */
export class MediaLinks {
  constructor(
    private readonly key: Buffer = randomBytes(32),
    private readonly now: () => number = () => Date.now(),
    private readonly lasts = MEDIA_LINK_MS,
  ) {}

  private sign(deviceId: string, mediaId: string, until: number): string {
    return createHmac('sha256', this.key)
      .update(`drashti-media-link\n${deviceId}\n${mediaId}\n${String(until)}`, 'utf8')
      .digest('base64url');
  }

  /** A ticket for this device to fetch this file's original, and when it stops working. */
  make(deviceId: string, mediaId: string): { ticket: string; until: number } {
    const until = this.now() + this.lasts;
    return { ticket: `${deviceId}.${until.toString(36)}.${this.sign(deviceId, mediaId, until)}`, until };
  }

  /** The device a ticket was made for, when it is for this file and still works; null otherwise. */
  check(ticket: string, mediaId: string): string | null {
    const parts = ticket.split('.');
    if (parts.length !== 3) return null;
    const [deviceId = '', at = '', signature = ''] = parts;
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(deviceId) || !/^[0-9a-z]{1,12}$/u.test(at)) return null;
    const until = parseInt(at, 36);
    if (!Number.isSafeInteger(until) || until < this.now()) return null;
    const expected = Buffer.from(this.sign(deviceId, mediaId, until));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected) ? deviceId : null;
  }
}

// ---- what the server asks of it ------------------------------------------------------------------

/** How long a media item's file is remembered for its many pieces (a video asks again and again as it plays). */
const SOURCE_MS = 30_000;

/** The pictures a device draws, and the originals it plays, as the network server serves them. */
export class MediaServing {
  private readonly renditions: RenditionMaker;
  readonly links: MediaLinks;
  private readonly sources = new Map<string, { source: PreviewSource; at: number }>();
  private readonly sound: (mediaId: string) => Promise<string | null>;

  constructor(
    previewDir: string,
    ffmpeg: string | null,
    private readonly lookup: (mediaId: string) => Promise<PreviewSource | null>,
    options: {
      renditions?: RenditionMaker;
      links?: MediaLinks;
      /** A sound's file while a playlist shared with phones has it (D3); left out, no sound is ever sent. */
      sound?: (mediaId: string) => Promise<string | null>;
    } = {},
  ) {
    // Kept beside the small previews, in a folder of their own.
    this.renditions = options.renditions ?? new RenditionMaker(join(previewDir, 'sized'), ffmpeg);
    this.links = options.links ?? new MediaLinks();
    this.sound = options.sound ?? (() => Promise.resolve(null));
  }

  /** A media item's file and kind, asked of the main process at most every SOURCE_MS while it is fetched. */
  async source(mediaId: string): Promise<PreviewSource | null> {
    const now = Date.now();
    const known = this.sources.get(mediaId);
    if (known && now - known.at < SOURCE_MS) return known.source;
    const source = await this.lookup(mediaId);
    if (this.sources.size > 200) this.sources.clear();
    if (source) this.sources.set(mediaId, { source, at: now });
    else this.sources.delete(mediaId);
    return source;
  }

  /** The picture at the step for `width` device pixels (a whole number; anything else is the smallest). */
  async picture(mediaId: string, width: unknown): Promise<Rendition | 'none' | null> {
    const source = await this.source(mediaId);
    if (!source) return 'none';
    const asked = typeof width === 'string' && /^\d{1,5}$/u.test(width) ? Number(width) : 0;
    return this.renditions.get(mediaId, source, asked);
  }

  /**
   * A picture's or video's own file, or a sound's while a playlist shared with phones has it (D3), with its type;
   * null when there is none. Whether a sound is shared is asked each time, never kept: Stop Sharing ends it at once.
   */
  async original(mediaId: string): Promise<SentFile | null> {
    const path = (await this.source(mediaId))?.path ?? (await this.sound(mediaId));
    return path ? { path, type: contentTypeOf(path) } : null;
  }
}
