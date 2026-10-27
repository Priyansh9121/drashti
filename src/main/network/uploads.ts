import { randomUUID } from 'node:crypto';
import { statfsSync } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  ADD_FILES_WORDS,
  type AddFilesView,
  type ArrivedFile,
  type ArrivedOutcome,
  noRoomWords,
  shownFileName,
  tooLargeWords,
  UPLOAD_ID_PATTERN,
  UPLOAD_ON_AIR_BYTES_PER_SECOND,
  UPLOAD_PIECE_FIRST,
  UPLOAD_PIECE_MAX,
  type UploadPolicy,
  type UploadState,
  type UploadStatus,
} from '../../shared/phone-files';
import { whatFileIs } from '../import/file-kind';
import { realPlaceAsync } from '../media/contained';
import { RateGate } from '../rate-gate';

/*
 * Files a phone adds (Session 54, D4), as the network worker takes them, so the main process, which carries the
 * show, never handles their bytes:
 *
 * - The phone says the file's name and size; Drashti makes the file's name on the computer (<a new id>.part, in
 *   the uploads folder inside its media folder) and never uses the phone's. The id is Drashti's own, and a piece
 *   names an upload only by an id this worker gave.
 * - Then pieces, each one where the last left off: a piece cut short (the Wi-Fi dropped) writes nothing, and the
 *   phone asks how much is here and carries on from there. One piece at a time; a newer one for the same place
 *   takes over from one still arriving.
 * - Each file up to the size limit, and only while Drashti keeps 2 GB free on the disk with the file and the
 *   import's copy of it in place: refused in words before a byte is sent, and stopped if the disk fills meanwhile.
 * - Once all of it is here, it is checked by what is inside it (import/file-kind.ts), named <id>.<ext> by what it
 *   is, and handed to the main process, which imports it and says what came of it.
 * - Cancel, the switch turned off, the phone's pairing removed, or no piece for half an hour: what was coming is
 *   removed. While the stream is on air or recording, pieces are taken at a limited rate.
 */

export interface UploadsDeps {
  /** The uploads folder: inside the media folder (where it really is, too). */
  dir: string;
  mediaDir: string;
  /** Free bytes on the disk holding `dir` (tests pass their own). */
  freeBytes?: (dir: string) => number;
  /** A file has all arrived and is what it should be: the main process imports it. */
  arrived(file: ArrivedFile): void;
  log(level: 'info' | 'warn', message: string): void;
  now?: () => number;
  /** Waiting before an answer while the stream is on air (tests pass their own). */
  wait?: (ms: number) => Promise<void>;
}

export interface UploadDevice {
  id: string;
  name: string;
}

/** A piece's bytes as they arrive, and how many the phone said it sends. */
export interface PieceBody {
  length: number;
  stream: Readable;
}

export interface UploadAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** Uploads coming at once: from one phone, and in all. */
const PER_DEVICE = 3;
const IN_ALL = 8;
/** A file no piece has come for in this long is let go. */
const IDLE_MS = 30 * 60 * 1000;
/** What came of one is kept this long for its phone to read. */
const KEPT_MS = 60 * 60 * 1000;
const SWEEP_MS = 60 * 1000;
const PART = '.part';

interface Upload {
  id: string;
  deviceId: string;
  name: string;
  size: number;
  received: number;
  state: UploadState;
  message: string | null;
  /** The file being written (<id>.part), then the whole one (<id>.<ext>). */
  file: string;
  /** When a piece last came, or it changed state. */
  at: number;
  /** The piece arriving now: a newer one for the same place, Cancel or the switch let it go. */
  piece: { gone: boolean; stop: () => void } | null;
}

const answer = (status: number, body: Record<string, unknown>): UploadAnswer => ({ status, body });
const refuse = (status: number, message: string, extra: Record<string, unknown> = {}): UploadAnswer =>
  answer(status, { ok: false, message, ...extra });

const freeOnDisk = (dir: string): number => {
  const s = statfsSync(dir);
  return s.bavail * s.bsize;
};

/** A piece's bytes, all of them, or null when it was cut short, let go, or is longer than it said. */
function readPiece(body: PieceBody, piece: NonNullable<Upload['piece']>): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (result: Buffer | null) => {
      if (done) return;
      done = true;
      body.stream.off('data', onData);
      body.stream.off('end', onEnd);
      body.stream.off('error', onFail);
      body.stream.off('close', onClose);
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > body.length || piece.gone) {
        finish(null);
        body.stream.destroy();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      finish(size === body.length && !piece.gone ? Buffer.concat(chunks, size) : null);
    };
    const onFail = () => {
      finish(null);
    };
    // Closed before its end: the connection dropped.
    const onClose = () => {
      finish(null);
    };
    piece.stop = () => {
      finish(null);
    };
    body.stream.on('data', onData);
    body.stream.on('end', onEnd);
    body.stream.on('error', onFail);
    body.stream.on('close', onClose);
  });
}

export class Uploads {
  private readonly table = new Map<string, Upload>();
  private policy: UploadPolicy = { on: false, maxBytes: 0, reserveBytes: 0, slowed: false };
  /** The folder is where it should be (inside the media folder, really): checked at start. */
  private ready = false;
  private starting: Promise<void> = Promise.resolve();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private readonly gate = new RateGate(UPLOAD_ON_AIR_BYTES_PER_SECOND);
  private readonly now: () => number;
  private readonly free: (dir: string) => number;
  private readonly wait: (ms: number) => Promise<void>;

  constructor(private readonly deps: UploadsDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.free = deps.freeBytes ?? freeOnDisk;
    this.wait =
      deps.wait ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }));
  }

  /**
   * The folder made, and what an earlier worker left half-sent removed (a whole file the main process may still
   * be importing is its to remove). Taken only when it is really inside the media folder. A file a phone starts
   * meanwhile waits for this.
   */
  start(): Promise<void> {
    this.ready = false;
    this.sweeper ??= setInterval(() => {
      this.sweep();
    }, SWEEP_MS);
    this.sweeper.unref();
    this.starting = (async () => {
      try {
        await mkdir(this.deps.dir, { recursive: true });
        const place = await realPlaceAsync(this.deps.mediaDir, this.deps.dir);
        if (!place?.inside) {
          this.deps.log(
            'warn',
            'Files from phones: the uploads folder is not inside the media folder; none are taken',
          );
          return;
        }
        for (const name of await readdir(this.deps.dir))
          if (name.endsWith(PART)) await rm(join(this.deps.dir, name), { force: true });
        this.ready = true;
      } catch (error) {
        this.deps.log(
          'warn',
          `Files from phones: the uploads folder could not be made ready (${(error as Error).name})`,
        );
      }
    })();
    return this.starting;
  }

  /** At the end: what was coming is let go and its part removed. */
  async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const up of this.table.values()) if (up.state === 'receiving') await this.end(up, 'cancelled', null);
    this.ready = false;
  }

  /** The switch, the limits and whether the stream is on air; turned off, what was coming stops. */
  setPolicy(policy: UploadPolicy): void {
    const wasOn = this.policy.on;
    this.policy = { ...policy };
    if (wasOn && !policy.on)
      for (const up of this.table.values())
        if (up.state === 'receiving') void this.end(up, 'failed', ADD_FILES_WORDS.off);
  }

  /** The paired devices now: a removed one's uploads are let go. */
  keepDevices(ids: ReadonlySet<string>): void {
    for (const up of this.table.values())
      if (up.state === 'receiving' && !ids.has(up.deviceId)) void this.end(up, 'cancelled', null);
  }

  private statusOf(up: Upload): UploadStatus {
    return {
      id: up.id,
      name: up.name,
      size: up.size,
      received: up.received,
      state: up.state,
      message: up.message,
      slowed: this.policy.slowed && up.state === 'receiving',
    };
  }

  private mine(device: UploadDevice, id: string): Upload | null {
    if (!UPLOAD_ID_PATTERN.test(id)) return null;
    const up = this.table.get(id);
    return up?.deviceId === device.id ? up : null;
  }

  /** Bytes still to come for every file coming now, but `except`. */
  private stillToCome(except: Upload | null = null): number {
    let sum = 0;
    for (const up of this.table.values())
      if (up !== except && up.state === 'receiving') sum += up.size - up.received;
    return sum;
  }

  /**
   * Room on the disk for the `bytes` still to come of a file, and the import's copy of all `size` of it, with
   * every other file coming now, leaving the 2 GB the show keeps.
   */
  private room(bytes: number, size: number, except: Upload | null): boolean {
    try {
      return this.free(this.deps.dir) - this.stillToCome(except) - bytes - size >= this.policy.reserveBytes;
    } catch {
      return false;
    }
  }

  /** Whether phones may add files now, and how large, as the phone's page reads it (once the folder is ready). */
  async adding(): Promise<AddFilesView> {
    await this.starting;
    return { on: this.policy.on && this.ready, maxBytes: this.policy.maxBytes };
  }

  /** This phone's files, newest first. */
  list(device: UploadDevice): UploadStatus[] {
    return [...this.table.values()]
      .filter((up) => up.deviceId === device.id)
      .reverse()
      .map((up) => this.statusOf(up));
  }

  /** A new file from a phone: its name (shown only) and size. */
  async begin(device: UploadDevice, given: Record<string, unknown>): Promise<UploadAnswer> {
    await this.starting;
    if (!this.ready) return refuse(503, 'Drashti cannot take files from phones now.');
    if (!this.policy.on) return refuse(403, ADD_FILES_WORDS.off);
    const size = given['size'];
    if (
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      typeof given['name'] !== 'string'
    )
      return refuse(400, 'Say the file’s name and how large it is.');
    if (size > this.policy.maxBytes) return refuse(413, tooLargeWords(this.policy.maxBytes));
    const coming = [...this.table.values()].filter((up) => up.state === 'receiving');
    if (coming.filter((up) => up.deviceId === device.id).length >= PER_DEVICE)
      return refuse(429, 'Three files are coming from this phone already: add more once one has arrived.');
    if (coming.length >= IN_ALL)
      return refuse(429, 'Drashti is taking several files now: try again in a moment.');
    if (!this.room(size, size, null)) return refuse(507, noRoomWords(this.policy.reserveBytes));
    const id = randomUUID();
    const up: Upload = {
      id,
      deviceId: device.id,
      name: shownFileName(given['name'], `File from ${device.name}`),
      size,
      received: 0,
      state: 'receiving',
      message: null,
      file: join(this.deps.dir, `${id}${PART}`),
      at: this.now(),
      piece: null,
    };
    try {
      // Made here, new: never a file (or a link) that was there before.
      await writeFile(up.file, '', { flag: 'wx' });
    } catch (error) {
      this.deps.log('warn', `Files from phones: could not start a file (${(error as Error).name})`);
      return refuse(500, 'Drashti could not make room for this file: try again.');
    }
    this.table.set(id, up);
    this.deps.log('info', `Files from phones: “${device.name}” is sending a file of ${String(size)} bytes`);
    return answer(201, {
      ok: true,
      upload: this.statusOf(up),
      pieces: { first: UPLOAD_PIECE_FIRST, max: UPLOAD_PIECE_MAX },
    });
  }

  status(device: UploadDevice, id: string): UploadAnswer {
    const up = this.mine(device, id);
    return up ? answer(200, { ok: true, upload: this.statusOf(up) }) : refuse(404, ADD_FILES_WORDS.gone);
  }

  /** A piece of a file, at `offset` (as a query says it). */
  async piece(
    device: UploadDevice,
    id: string,
    offset: string | undefined,
    body: PieceBody,
  ): Promise<UploadAnswer> {
    const up = this.mine(device, id);
    const drop = (result: UploadAnswer) => {
      body.stream.resume();
      return result;
    };
    if (!up) return drop(refuse(404, ADD_FILES_WORDS.gone));
    if (!this.policy.on) return drop(refuse(403, ADD_FILES_WORDS.off, { upload: this.statusOf(up) }));
    if (up.state !== 'receiving')
      return drop(refuse(409, up.message ?? 'All of this file has arrived.', { upload: this.statusOf(up) }));
    const at = offset !== undefined && /^\d{1,15}$/u.test(offset) ? Number(offset) : -1;
    if (at !== up.received)
      return drop(refuse(409, 'Carry on from where Drashti has it.', { upload: this.statusOf(up) }));
    if (!Number.isSafeInteger(body.length) || body.length < 1 || body.length > UPLOAD_PIECE_MAX)
      return drop(refuse(413, 'That piece is too large.', { upload: this.statusOf(up) }));
    if (at + body.length > up.size)
      return drop(refuse(413, 'That is more than the file’s size.', { upload: this.statusOf(up) }));
    // A newer piece for the same place takes over from one still arriving (its connection may be gone).
    if (up.piece) {
      up.piece.gone = true;
      up.piece.stop();
    }
    const piece: NonNullable<Upload['piece']> = { gone: false, stop: () => undefined };
    up.piece = piece;
    const bytes = await readPiece(body, piece);
    if (up.piece === piece) up.piece = null;
    if (!bytes || piece.gone) {
      if (piece.gone || !this.receiving(up))
        return refuse(409, up.message ?? 'This piece was let go.', { upload: this.statusOf(up) });
      return refuse(400, 'The piece was cut short: carry on from where Drashti has it.', {
        upload: this.statusOf(up),
      });
    }
    // Something else may have changed meanwhile: the switch, Cancel, or the same piece written by another request.
    if (!this.receiving(up) || up.received !== at)
      return refuse(409, up.message ?? 'Carry on from where Drashti has it.', { upload: this.statusOf(up) });
    if (!this.room(up.size - up.received, up.size, up)) {
      await this.end(up, 'failed', noRoomWords(this.policy.reserveBytes));
      return refuse(507, noRoomWords(this.policy.reserveBytes), { upload: this.statusOf(up) });
    }
    if (!(await this.write(up, bytes, at))) {
      await this.end(up, 'failed', 'Drashti could not keep this file: add it again.');
      return refuse(500, 'Drashti could not keep this file: add it again.', { upload: this.statusOf(up) });
    }
    up.received += bytes.length;
    up.at = this.now();
    if (up.received === up.size) await this.arrived(up);
    // On air or recording: the stream keeps its Wi-Fi.
    if (this.policy.slowed) await this.wait(this.gate.take(bytes.length));
    return answer(200, { ok: true, upload: this.statusOf(up) });
  }

  /** Write a piece where it goes, into the file made for it (still a plain file, never a link put there). */
  private async write(up: Upload, bytes: Buffer, at: number): Promise<boolean> {
    try {
      const info = await lstat(up.file);
      if (!info.isFile()) return false;
      const fh = await open(up.file, 'r+');
      try {
        await fh.write(bytes, 0, bytes.length, at);
      } finally {
        await fh.close();
      }
      return true;
    } catch (error) {
      this.deps.log('warn', `Files from phones: a piece could not be written (${(error as Error).name})`);
      return false;
    }
  }

  /** Still coming (read afresh: a piece's wait may have seen it cancelled). */
  private receiving(up: Upload): boolean {
    return up.state === 'receiving';
  }

  /** All of it is here: what is it? Named by what it is and handed on, or refused and removed. */
  private async arrived(up: Upload): Promise<void> {
    up.state = 'checking';
    const what = await whatFileIs(up.file);
    // Cancelled or turned off while it was checked.
    if (!this.checking(up)) return;
    if (!what) {
      this.deps.log(
        'info',
        'Files from phones: a file was not taken (it is none of the kinds Drashti takes)',
      );
      await this.end(up, 'failed', ADD_FILES_WORDS.notTaken);
      return;
    }
    const whole = join(this.deps.dir, `${up.id}.${what.ext}`);
    try {
      await rename(up.file, whole);
    } catch (error) {
      this.deps.log('warn', `Files from phones: a file could not be named (${(error as Error).name})`);
      await this.end(up, 'failed', 'Drashti could not keep this file: add it again.');
      return;
    }
    up.file = whole;
    up.state = 'importing';
    up.at = this.now();
    this.deps.arrived({
      id: up.id,
      deviceId: up.deviceId,
      name: up.name,
      file: whole,
      ext: what.ext,
      kind: what.kind,
    });
  }

  private checking(up: Upload): boolean {
    return up.state === 'checking';
  }

  /** What the phone reads while its file waits to be imported (a deck, while the stream is on air). */
  note(id: string, message: string): void {
    const up = this.table.get(id);
    if (up?.state === 'importing') up.message = message;
  }

  /** What the main process made of a file it was handed. */
  outcome(id: string, outcome: ArrivedOutcome): void {
    const up = this.table.get(id);
    if (up?.state !== 'importing') return;
    up.state = outcome.ok ? 'added' : 'failed';
    up.message = outcome.message;
    up.at = this.now();
  }

  /** Cancel: what has come is removed. One being imported already is the main process's. */
  async cancel(device: UploadDevice, id: string): Promise<UploadAnswer> {
    const up = this.mine(device, id);
    if (!up) return refuse(404, ADD_FILES_WORDS.gone);
    if (up.state === 'receiving' || up.state === 'checking') await this.end(up, 'cancelled', 'Cancelled.');
    if (up.state === 'importing')
      return refuse(409, 'It is being added to Drashti already.', { upload: this.statusOf(up) });
    return answer(200, { ok: true, upload: this.statusOf(up) });
  }

  /** Let go of files no piece has come for in half an hour, and forget what became of old ones. */
  sweep(): void {
    const now = this.now();
    for (const up of [...this.table.values()]) {
      if (up.state === 'receiving' && now - up.at > IDLE_MS)
        void this.end(up, 'failed', ADD_FILES_WORDS.gone);
      else if (
        (up.state === 'added' || up.state === 'failed' || up.state === 'cancelled') &&
        now - up.at > KEPT_MS
      )
        this.table.delete(up.id);
    }
  }

  /** It ends here: its piece let go, and what came of it removed. */
  private async end(up: Upload, state: 'failed' | 'cancelled', message: string | null): Promise<void> {
    up.state = state;
    up.message = message ?? (state === 'cancelled' ? 'Cancelled.' : null);
    up.at = this.now();
    if (up.piece) {
      up.piece.gone = true;
      up.piece.stop();
      up.piece = null;
    }
    await rm(up.file, { force: true }).catch(() => undefined);
  }
}
