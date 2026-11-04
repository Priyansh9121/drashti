import { formatBytes } from './format';
import { nfc } from './nfc';
import { cutText } from './text';

/*
 * Files between Drashti and its phones and tablets (Session 54, D3 and D4), still over the local network as
 * paired today:
 *
 * - A playlist shared with phones (a folder playlist too): Remote devices list it under "Shared from Drashti",
 *   each file to view and play on the device itself, read-only. Never on a Stage or Announcements device.
 * - "Add from this Phone…": a picture, video, sound, PDF, PowerPoint or Keynote file sent whole (never shrunk), in
 *   pieces, picking up again after a dropped connection, into a folder of Drashti's media folder by names Drashti
 *   makes; checked by what it is, then imported as a dropped file is, into the playlist "Added from Phones" and
 *   Media, marked with the device's name. It never goes live by itself. Off until someone turns the switch on.
 * - Since Session 55: Add photos puts pictures at the end of the playlist open in Pro Mode (Part 8); and while Drashti is
 *   in Simple Mode, every file, however it is sent, goes to the end of Simple Mode's one playlist (question 5, the
 *   owner's decisions of 3 and 4 Nov 2026), in Media (or the library, a deck) as ever.
 */

/** The playlist a phone's files go into, made when the first one comes (" (2)" when another has the name). */
export const ADDED_FROM_PHONES = 'Added from Phones';

/** The largest file a phone may add (2 GB, the drop folder's limit). */
export const UPLOAD_MAX_BYTES = 2 * 1024 ** 3;

/** Free space Drashti keeps on its disk whatever a phone sends, as backups and imports do (2 GB). */
export const UPLOAD_RESERVE_BYTES = 2 * 1024 ** 3;

/** The most a phone sends in one piece; it starts smaller, and sends more at a time on a fast Wi-Fi. */
export const UPLOAD_PIECE_MAX = 8 * 1024 * 1024;
export const UPLOAD_PIECE_FIRST = 1024 * 1024;
export const UPLOAD_PIECE_MIN = 256 * 1024;

/** While the stream is on air or recording, files from phones come at most this fast, so the stream keeps its Wi-Fi. */
export const UPLOAD_ON_AIR_BYTES_PER_SECOND = 2 * 1024 * 1024;

/** An upload's id: Drashti's own (a UUID), never anything the phone made. */
export const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** How a file from a phone stands, as the phone hears it. */
export type UploadState = 'receiving' | 'checking' | 'importing' | 'added' | 'failed' | 'cancelled';

export interface UploadStatus {
  id: string;
  /** The name the phone gave it (only ever shown, never a file's name on the computer). */
  name: string;
  size: number;
  /** Bytes Drashti has: the phone carries on from here. */
  received: number;
  state: UploadState;
  /** Why it failed or what became of it, in words; null while it is coming. */
  message: string | null;
  /** On air or recording: coming more slowly until the stream ends. */
  slowed: boolean;
}

/** What Drashti says to the phones about adding files: whether it takes them now, and how large. */
export interface AddFilesView {
  on: boolean;
  maxBytes: number;
  /**
   * Add photos (Session 55, Part 8, J): the name of the playlist open in Pro Mode's window, where a phone's pictures go,
   * or null with none open (or in Simple Mode): they go to "Added from Phones" then. Left out by an older Drashti.
   */
  openPlaylist?: string | null;
  /**
   * Question 5 (the owner's decisions of 3 and 4 Nov 2026): the name of Simple Mode's one playlist while Drashti is in
   * Simple Mode, where a phone's files go, however they are sent; null in Pro Mode. Left out by an older Drashti.
   */
  simplePlaylist?: string | null;
}

/** What the worker taking the pieces is told by the main process (the switch, the limits, on air). */
export interface UploadPolicy {
  on: boolean;
  maxBytes: number;
  reserveBytes: number;
  /** On air or recording: pieces are taken at UPLOAD_ON_AIR_BYTES_PER_SECOND at most. */
  slowed: boolean;
  /** The playlist open in Pro Mode's window, for the phone's words (Session 55, Part 8: Add photos); null for none. */
  openPlaylist?: string | null;
  /** Simple Mode's one playlist while Drashti is in Simple Mode, for the phone's words (question 5); null in Pro Mode. */
  simplePlaylist?: string | null;
}

/** Add photos (Session 55, Part 8): what a phone asks for its pictures, the playlist open on Drashti. */
export const INTO_OPEN = 'open';

/** A file that has all arrived and is what it should be: the main process imports it. */
export interface ArrivedFile {
  id: string;
  deviceId: string;
  /** The name the phone gave it. */
  name: string;
  /** Where it is: `<id>.<ext>` in the uploads folder of Drashti's media folder. */
  file: string;
  ext: string;
  kind: FileKind;
  /** Add photos (Session 55, Part 8): a picture for the playlist open on Drashti; left out, Added from Phones. */
  into?: typeof INTO_OPEN;
}

/** What a file is, read from its bytes. */
export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'powerpoint' | 'keynote';

/** What came of an import of a file from a phone. */
export type ArrivedOutcome = { ok: true; message: string } | { ok: false; message: string };

/** A playlist shared with phones, as a Remote lists it under "Shared from Drashti". */
export interface SharedPlaylist {
  id: string;
  name: string;
  itemCount: number;
  /** Made from a folder (a smart playlist, a Dropbox folder's): its headers are the folder's own folders. */
  fromFolder: boolean;
}

/** The phone's file picker: every kind Drashti takes from a phone, by type and by name. */
export const ADD_ACCEPT = [
  'image/*',
  'video/*',
  'audio/*',
  // Named too, so a phone hands over an iPhone's photo or video as it is rather than a copy made "compatible".
  'image/heic',
  'image/heif',
  'video/quicktime',
  'video/mp4',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.apple.keynote',
  '.pdf',
  '.pptx',
  '.key',
  '.heic',
].join(',');

const GiB = 1024 ** 3;

/** "2 GB" for a whole number of gigabytes; otherwise as formatBytes says it. */
export const sizeWords = (n: number): string => (n % GiB === 0 ? `${String(n / GiB)} GB` : formatBytes(n));

/** Words the phone and the operator both read. */
export const ADD_FILES_WORDS = {
  off: 'Drashti does not take files from phones now: on Drashti’s computer, turn on “Phones and tablets may add files” in Phones and tablets.',
  notTaken:
    'Drashti takes pictures, videos, sounds, PDF, PowerPoint and Keynote files, and this is none of them: each file is checked by what is inside it, not by its name.',
  gone: 'Drashti no longer has this file (it waited too long, or Drashti started again): add it again.',
  oldPowerPoint:
    'Drashti takes a PowerPoint file from a phone as .pptx, not the older .ppt: save it as a PowerPoint Presentation (.pptx), then add it again.',
} as const;

/**
 * Where a phone's files go, as the phone says it before they are sent (the words above its two buttons): `files` for
 * Add from this Phone…, `photos` for Add photos. In Simple Mode every file goes to the end of Simple Mode's playlist
 * (question 5); in Pro Mode, Add photos goes to the playlist open there, and the rest into Added from Phones.
 */
export function addFilesWords(view: Pick<AddFilesView, 'maxBytes' | 'openPlaylist' | 'simplePlaylist'>): {
  files: string;
  photos: string;
} {
  const simple = view.simplePlaylist ?? null;
  const open = view.openPlaylist ?? null;
  const size = sizeWords(view.maxBytes);
  if (simple !== null)
    return {
      files: `A picture, video, sound, PDF, PowerPoint or Keynote file, up to ${size}, goes whole to the end of Simple Mode’s playlist “${simple}”. It never goes on the screens by itself.`,
      photos: `Add photos puts pictures at the end of Simple Mode’s playlist, “${simple}”. They never go on the screens by themselves.`,
    };
  return {
    files: `A picture, video, sound, PDF, PowerPoint or Keynote file, up to ${size}, goes whole into Drashti’s playlist “${ADDED_FROM_PHONES}”. It never goes on the screens by itself.`,
    photos:
      open === null
        ? `No playlist is open on Drashti: Add photos puts pictures into “${ADDED_FROM_PHONES}”.`
        : `Add photos puts pictures at the end of the playlist open on Drashti, “${open}”. They never go on the screens by themselves.`,
  };
}

export const tooLargeWords = (maxBytes: number): string =>
  `This file is larger than ${sizeWords(maxBytes)}: Drashti takes files up to ${sizeWords(maxBytes)} from a phone.`;

export const noRoomWords = (reserveBytes: number): string =>
  `There is not enough free space on Drashti’s computer for this file: Drashti keeps ${sizeWords(reserveBytes)} free on its disk for the show.`;

/**
 * The name the phone gave a file, as Drashti shows it: one line, in one form (NFC), with no control characters or
 * folder separators, at most 120 characters. Only ever shown: the file on the computer has a name Drashti made.
 */
export function shownFileName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = nfc(raw)
    // Control characters, the marks that turn text around (a name that reads as another), and the separators of
    // folders on any system. The joiners Gujarati and Hindi words need stay.
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069\\/]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  // Dots in front would read as a hidden file's name, or as the way out of a folder.
  const shown = cutText(cleaned.replace(/^[.\s]+/u, ''), 120);
  return shown === '' ? fallback : shown;
}

/** A shown name without its extension, for a presentation made from a deck ("Placeholder deck.pptx" → "Placeholder deck"). */
export function nameWithoutExtension(name: string): string {
  return name.replace(/^(.+)\.[A-Za-z0-9]{1,5}$/u, '$1');
}
