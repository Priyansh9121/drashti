import { access, appendFile, open, writeFile, type FileHandle } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileStamp } from '../../shared/format';
import { SPEECH_RATE, type Heard } from '../../shared/speech';
import { RECORD_PART_BYTES, type StreamStatus } from '../../shared/stream';
import { recordingWarning } from './recording-drive';
import { QUIET_DBFS } from './worker/sound-meter';

const BYTES_PER_SECOND = SPEECH_RATE * 2;
const HEADER_BYTES = 44;
const MAX_QUEUED_BYTES = 4 * BYTES_PER_SECOND;
/** A second of sound whose mean square (16-bit samples) is below this is quiet: -50 dBFS, as the stream's No sound. */
const QUIET_MEAN_SQUARE = 10 ** (QUIET_DBFS / 10) * 32_768 ** 2;
/*
 * The sound input's wait (Session 58, X2: the alpha.16 review's L1). With nothing from the sound input (unplugged, a
 * USB interface connecting again, the stream's page stopped), the operator is told after 5 s, and the recording stops
 * after 30 s: time to plug it back in, and an input that comes back within it goes on in the same file. The time the
 * input is held back, not silent (the macOS microphone question still open, the stream's page still opening), never
 * counts. The words say these times as written here.
 */
const INPUT_WARN_MS = 5_000;
const INPUT_WAIT_MS = 30_000;
const INPUT_WARNING =
  'Nothing has come from the sound input for 5 seconds. Check the input and its cable: Drashti stops the sound recording after 30 seconds without it.';
const INPUT_BACK = 'Sound is coming from the sound input again: the sound recording goes on.';
const INPUT_STOPPED =
  'Sound recording stopped: nothing came from the sound input for 30 seconds. Check the input and its cable, then record again.';
/** The sound input's wait is looked at every second, the disk every third. */
const TICK_MS = 1_000;
const DISK_EVERY_TICKS = 3;
const SYNC_EVERY_MS = 9_000;
/**
 * How long a quit waits for the WAV to be finished (Session 58, X2: L3): a disk that does not answer by then (a
 * network share gone away, a USB stick that hangs) never holds Drashti's quit.
 */
export const QUIT_FINISH_MS = 5_000;
/** The longest caption phrase (12 s), plus the hub's allowed recognition delay (10 s). */
const CAPTION_WINDOW_MS = 25_000;
const WRITE_FAILED = 'Sound recording stopped because the audio file could not be written.';
const DRAFT_FAILED = 'The caption draft could not be saved. Sound recording continues.';

type RecordingStatus = StreamStatus['recording'];
/** How a quit's wait for the WAV ended: finished, or left behind after QUIT_FINISH_MS. */
export type SoundQuit = 'finished' | 'late';

interface Part {
  file: FileHandle;
  path: string;
  bytes: number;
  hasDraft: boolean;
}

interface CaptureSpan {
  part: Part;
  startAt: number;
  endAt: number;
  fromMs: number;
  toMs: number;
}

interface Session {
  folder: string;
  stem: string;
  number: number;
  startedAt: number;
  part: Part | null;
  spans: CaptureSpan[];
  writes: Promise<void>;
  finishing: Promise<void> | null;
  queuedBytes: number;
  /** When the sound input last sent anything, and when it was last heard above -50 dBFS (the time it is held back never counts). */
  lastAudioAt: number;
  lastSoundAt: number;
  /** The second of sound being measured: its sum of squares and samples counted. */
  squares: number;
  counted: number;
  ticks: number;
  lastSyncAt: number;
  timer: NodeJS.Timeout | null;
  message: string | null;
  /** The operator was told nothing has come from the sound input (taken back when it comes). */
  inputWarned: boolean;
  draftFailed: boolean;
  driveWarning: string | null;
}

interface Options {
  now(): number;
  freeBytes(folder: string): Promise<number | null>;
  keepFree: number;
  partBytes?: number;
  /** The sound input is held back, not silent: the system's microphone question is open, or the stream's page is still opening. */
  waiting?(): boolean;
  /** Every second while it records (the stream service judges No sound then). */
  tick?(): void;
  stopping?(): void;
  changed(): void;
  notice(text: string): void;
}

function wavHeader(bytes: number): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SPEECH_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  return header;
}

async function writeAt(file: FileHandle, buffer: Buffer, position: number): Promise<void> {
  for (let offset = 0; offset < buffer.length;) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, position + offset);
    if (!bytesWritten) throw new Error('The write made no progress');
    offset += bytesWritten;
  }
}

const draftPath = (path: string) => path.replace(/\.wav$/u, '.draft.vtt');

function cueTime(ms: number): string {
  const total = Math.round(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${two(Math.floor(total / 3_600_000))}:${two(Math.floor(total / 60_000) % 60)}:` +
    `${two(Math.floor(total / 1_000) % 60)}.${String(total % 1000).padStart(3, '0')}`
  );
}

function audioTime(spans: readonly CaptureSpan[], at: number): { part: Part; ms: number } | null {
  const span = spans.find((s) => at >= s.startAt && at <= s.endAt + 2);
  if (!span) return null;
  const fraction = span.endAt > span.startAt ? (at - span.startAt) / (span.endAt - span.startAt) : 0;
  return { part: span.part, ms: span.fromMs + Math.min(1, fraction) * (span.toMs - span.fromMs) };
}

/** One local recording of the raw sound tap. File work is asynchronous and queued with a bound. */
export class SoundRecording {
  private session: Session | null = null;
  /** A quit's wait for the WAV (QUIT_FINISH_MS at most), and whether it is over. */
  private quitWait: { done: Promise<SoundQuit>; over: boolean } | null = null;
  private status: RecordingStatus = {
    kind: 'sound',
    state: 'off',
    since: null,
    file: null,
    folder: null,
    bytes: 0,
    freeBytes: null,
    secondsLeft: null,
    message: null,
    warning: null,
  };

  constructor(private readonly options: Options) {}

  inUse(): boolean {
    return this.session !== null;
  }

  view(folder: string | null): RecordingStatus {
    return { ...this.status, folder };
  }

  start(folder: string): void {
    if (this.session) return;
    const now = this.options.now();
    const session: Session = {
      folder,
      stem: `Drashti sound ${fileStamp(new Date(now))}`,
      number: 1,
      startedAt: now,
      part: null,
      spans: [],
      writes: Promise.resolve(),
      finishing: null,
      queuedBytes: 0,
      lastAudioAt: now,
      lastSoundAt: now,
      squares: 0,
      counted: 0,
      ticks: 0,
      lastSyncAt: now,
      timer: null,
      message: null,
      inputWarned: false,
      draftFailed: false,
      driveWarning: null,
    };
    this.session = session;
    this.status = {
      ...this.status,
      state: 'starting',
      since: null,
      file: null,
      bytes: 0,
      freeBytes: null,
      secondsLeft: null,
      message: null,
      warning: null,
    };
    // No FAT32 look (Session 58, X2: L2): a WAV part of 3.5 GB holds about 32 hours, so a FAT32 drive's 4 GB limit
    // never matters to it. The room left on the disk is told (checkDisk).
    this.queue(session, () => this.checkDisk(session, true));
    session.timer = setInterval(() => {
      this.everySecond(session);
    }, TICK_MS);
    session.timer.unref();
    this.options.changed();
  }

  /** Each second: the sound input's wait, the disk every third second, and No sound's judging (`tick`). */
  private everySecond(session: Session): void {
    const nothingFor = this.nothingFor(session, this.options.now());
    if (nothingFor >= INPUT_WAIT_MS) {
      void this.stop(INPUT_STOPPED);
      return;
    }
    if (nothingFor >= INPUT_WARN_MS && !session.inputWarned) {
      session.inputWarned = true;
      this.showWarning(session);
      this.options.notice(INPUT_WARNING);
    }
    session.ticks++;
    if (session.ticks % DISK_EVERY_TICKS === 0) this.queue(session, () => this.checkDisk(session, false));
    this.options.tick?.();
  }

  /** The time the sound input is held back (not silent) never counts: its clocks start again when it ends. */
  private holdBack(session: Session, now: number): void {
    if (!this.options.waiting?.()) return;
    session.lastAudioAt = now;
    session.lastSoundAt = now;
  }

  /** How long nothing at all has come from the sound input: ms. */
  private nothingFor(session: Session, now: number): number {
    this.holdBack(session, now);
    return now - session.lastAudioAt;
  }

  /**
   * How long this recording has heard nothing above -50 dBFS (a second at a time, as the stream's No sound does),
   * the time nothing came at all included: No sound's quiet for Record sound. 0 while it is not recording.
   */
  quietMs(): number {
    const session = this.session;
    if (!session || session.finishing) return 0;
    const now = this.options.now();
    this.holdBack(session, now);
    return now - session.lastSoundAt;
  }

  stop(message?: string): Promise<void> | null {
    const session = this.session;
    if (!session) return null;
    session.message ??= message ?? null;
    if (session.finishing) return session.finishing;
    if (session.timer) clearInterval(session.timer);
    session.finishing = session.writes
      .then(async () => {
        if (session.part) await this.closePart(session.part);
      })
      .catch(() => {
        session.message ??= WRITE_FAILED;
      })
      .then(() => {
        this.session = null;
        this.status = {
          ...this.status,
          state: 'off',
          secondsLeft: null,
          warning: null,
          message: session.message,
        };
        if (session.message) this.options.notice(session.message);
        this.options.changed();
      });
    this.options.stopping?.();
    return session.finishing;
  }

  /**
   * Drashti is quitting (Session 58, X2: the alpha.16 review's L3): the WAV is finished (its header written, synced and
   * closed), and the quit waits for that QUIT_FINISH_MS at most. A disk that has not answered by then is left behind,
   * 'late': the file plays up to the last whole second its header says (it is rewritten after every second of sound),
   * and what had not reached the disk is lost. Null when nothing is recording, and once the wait is over, so the
   * quit's next before-quit is never held again.
   */
  quitting(limitMs = QUIT_FINISH_MS): Promise<SoundQuit> | null {
    if (this.quitWait) return this.quitWait.over ? null : this.quitWait.done;
    const finishing = this.stop();
    if (!finishing) return null;
    const wait: { done: Promise<SoundQuit>; over: boolean } = {
      over: false,
      done: new Promise<SoundQuit>((resolve) => {
        const timer = setTimeout(() => {
          resolve('late');
        }, limitMs);
        timer.unref();
        void finishing.then(() => {
          clearTimeout(timer);
          resolve('finished');
        });
      }).then((how) => {
        wait.over = true;
        return how;
      }),
    };
    this.quitWait = wait;
    return wait.done;
  }

  chunk(samples: Int16Array, endAt: number, startAt: number): void {
    const session = this.session;
    if (!session || session.finishing || endAt < session.startedAt) return;
    const offset = Math.max(0, Math.ceil(((session.startedAt - startAt) * SPEECH_RATE) / 1000));
    if (offset >= samples.length) return;
    const audio = samples.subarray(offset);
    if (session.queuedBytes + audio.byteLength > MAX_QUEUED_BYTES) {
      void this.stop('Sound recording stopped because the disk could not keep up.');
      return;
    }
    const now = this.options.now();
    session.lastAudioAt = now;
    this.hear(session, audio, now);
    if (session.inputWarned) {
      session.inputWarned = false;
      this.showWarning(session);
      this.options.notice(INPUT_BACK);
    }
    session.queuedBytes += audio.byteLength;
    this.queue(
      session,
      () => this.saveAudio(session, audio, endAt, startAt + (offset * 1000) / SPEECH_RATE),
      () => {
        session.queuedBytes -= audio.byteLength;
      },
    );
  }

  caption(phrase: Heard): void {
    const session = this.session;
    if (
      !session ||
      session.finishing ||
      session.draftFailed ||
      !phrase.final ||
      phrase.endAt < session.startedAt
    )
      return;
    this.queue(session, async () => {
      if (session.draftFailed) return;
      try {
        await this.saveCaption(session, phrase);
      } catch {
        session.draftFailed = true;
        this.showWarning(session);
        this.options.notice(DRAFT_FAILED);
      }
    });
  }

  /** The sound's level, a second at a time (as ./worker/sound-meter.ts): a second above -50 dBFS ends as sound heard. */
  private hear(session: Session, audio: Int16Array, now: number): void {
    for (const v of audio) {
      session.squares += v * v;
      session.counted++;
      if (session.counted < SPEECH_RATE) continue;
      if (session.squares / session.counted >= QUIET_MEAN_SQUARE) session.lastSoundAt = now;
      session.squares = 0;
      session.counted = 0;
    }
  }

  /** The recording's warning: the sound input's wait, then the drive, then a caption draft that failed. */
  private showWarning(session: Session): void {
    const said = [
      session.inputWarned ? INPUT_WARNING : null,
      session.driveWarning,
      session.draftFailed ? DRAFT_FAILED : null,
    ].filter(Boolean);
    this.status = { ...this.status, warning: said.length > 0 ? said.join(' ') : null };
    this.options.changed();
  }

  private queue(session: Session, work: () => Promise<void>, done?: () => void): void {
    session.writes = session.writes
      .then(async () => {
        if (!session.message) await work();
      })
      .catch(() => {
        void this.stop(WRITE_FAILED);
      })
      .finally(done);
  }

  private async checkDisk(session: Session, first: boolean): Promise<void> {
    const free = await this.options.freeBytes(session.folder);
    if (free !== null && free <= this.options.keepFree) {
      const gb = (free / 1024 ** 3).toFixed(1);
      void this.stop(
        `Sound recording stopped: only ${gb} GB is free on that disk, and Drashti keeps 2 GB free.`,
      );
      return;
    }
    this.status = {
      ...this.status,
      freeBytes: free,
      bytes: session.part?.bytes ?? 0,
      secondsLeft: free === null ? null : (free - this.options.keepFree) / BYTES_PER_SECOND,
    };
    if (first) this.warnAboutDrive(session);
    const now = this.options.now();
    if (session.part && now - session.lastSyncAt >= SYNC_EVERY_MS) {
      await writeAt(session.part.file, wavHeader(session.part.bytes), 0);
      await session.part.file.datasync();
      session.lastSyncAt = now;
    }
    this.options.changed();
  }

  private warnAboutDrive(session: Session): void {
    const warning = recordingWarning({
      // FAT32 never matters to a WAV part (32 hours): only the room left is told.
      fat: null,
      freeBytes: this.status.freeBytes,
      bytesPerHour: BYTES_PER_SECOND * 3600,
      keepFree: this.options.keepFree,
    });
    if (!warning || session.driveWarning === warning) return;
    session.driveWarning = warning;
    this.showWarning(session);
    this.options.notice(warning);
  }

  private async nextPart(session: Session): Promise<Part> {
    // The first file gets the date and time. Repeated takes and later parts never overwrite either file.
    const { folder, stem } = session;
    for (let tries = 0; tries < 1000; tries++, session.number++) {
      const name = session.number === 1 ? stem : `${stem} (${String(session.number)})`;
      const path = join(folder, `${name}.wav`);
      const existingDraft = await access(draftPath(path)).then(
        () => true,
        () => false,
      );
      if (existingDraft) continue;
      let file: FileHandle;
      try {
        file = await open(path, 'wx');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
      try {
        await writeAt(file, wavHeader(0), 0);
      } catch (error) {
        await file.close();
        throw error;
      }
      return { file, path, bytes: 0, hasDraft: false };
    }
    throw new Error('No unused recording name');
  }

  private async closePart(part: Part): Promise<void> {
    try {
      await writeAt(part.file, wavHeader(part.bytes), 0);
      await part.file.datasync();
    } finally {
      await part.file.close();
    }
  }

  private async saveAudio(
    session: Session,
    samples: Int16Array,
    endAt: number,
    startAt: number,
  ): Promise<void> {
    let part = session.part;
    const cap = this.options.partBytes ?? RECORD_PART_BYTES;
    const newPart = part === null || part.bytes + samples.byteLength + HEADER_BYTES > cap;
    if (part && newPart) {
      session.part = null;
      await this.closePart(part);
      session.number++;
      part = null;
    }
    part ??= await this.nextPart(session);
    session.part = part;
    const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    const fromMs = (part.bytes / BYTES_PER_SECOND) * 1000;
    const before = part.bytes;
    await writeAt(part.file, bytes, HEADER_BYTES + part.bytes);
    part.bytes += bytes.length;
    // Its header says how long it is after every second of sound (Session 58, X2: L3), not only every 9 s: a crash,
    // or a quit that could not wait for the disk, leaves at most the last second outside it for players that trust it.
    if (Math.floor(part.bytes / BYTES_PER_SECOND) > Math.floor(before / BYTES_PER_SECOND))
      await writeAt(part.file, wavHeader(part.bytes), 0);
    session.spans.push({ part, startAt, endAt, fromMs, toMs: (part.bytes / BYTES_PER_SECOND) * 1000 });
    const oldest = endAt - CAPTION_WINDOW_MS;
    while ((session.spans[0]?.endAt ?? endAt) < oldest) session.spans.shift();
    if (newPart) {
      this.status = {
        ...this.status,
        state: 'recording',
        since: this.status.since ?? startAt,
        file: basename(part.path),
        bytes: part.bytes,
      };
      this.options.changed();
    }
  }

  private async saveCaption(session: Session, phrase: Heard): Promise<void> {
    const cues = new Map<Part, { fromMs: number; toMs: number; words: string[] }>();
    for (const word of phrase.words) {
      const start = audioTime(session.spans, word.startAt);
      const end = audioTime(session.spans, word.endAt);
      if (!start || end?.part !== start.part) continue;
      const cue = cues.get(start.part) ?? { fromMs: start.ms, toMs: end.ms, words: [] };
      cue.toMs = Math.max(cue.toMs, end.ms);
      cue.words.push(word.text);
      cues.set(start.part, cue);
    }
    for (const [part, cue] of cues) {
      const text = cue.words.length === phrase.words.length ? phrase.text : cue.words.join(' ');
      const escaped = text
        .replace(/\s+/gu, ' ')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      const row = `${cueTime(cue.fromMs)} --> ${cueTime(Math.max(cue.fromMs + 1, cue.toMs))}\n${escaped}\n\n`;
      if (part.hasDraft) await appendFile(draftPath(part.path), row, 'utf8');
      else {
        await writeFile(draftPath(part.path), `WEBVTT\n\nNOTE Draft from Live captions\n\n${row}`, {
          encoding: 'utf8',
          flag: 'wx',
        });
        part.hasDraft = true;
      }
    }
  }
}
