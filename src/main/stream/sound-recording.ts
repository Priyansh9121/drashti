import { access, appendFile, open, writeFile, type FileHandle } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileStamp } from '../../shared/format';
import { SPEECH_RATE, type Heard } from '../../shared/speech';
import { RECORD_PART_BYTES, type StreamStatus } from '../../shared/stream';
import { recordingWarning } from './recording-drive';

const BYTES_PER_SECOND = SPEECH_RATE * 2;
const HEADER_BYTES = 44;
const MAX_QUEUED_BYTES = 4 * BYTES_PER_SECOND;
const INPUT_WAIT_MS = 10_000;
const CHECK_EVERY_MS = 3_000;
const SYNC_EVERY_MS = 9_000;
/** The longest caption phrase (12 s), plus the hub's allowed recognition delay (10 s). */
const CAPTION_WINDOW_MS = 25_000;
const WRITE_FAILED = 'Sound recording stopped because the audio file could not be written.';
const DRAFT_FAILED = 'The caption draft could not be saved. Sound recording continues.';

type RecordingStatus = StreamStatus['recording'];

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
  lastAudioAt: number;
  lastSyncAt: number;
  timer: NodeJS.Timeout | null;
  message: string | null;
  fat: boolean | null;
  draftFailed: boolean;
  driveWarning: string | null;
}

interface Options {
  now(): number;
  freeBytes(folder: string): Promise<number | null>;
  onFat(folder: string): Promise<boolean | null>;
  keepFree: number;
  partBytes?: number;
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
      lastSyncAt: now,
      timer: null,
      message: null,
      fat: null,
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
    this.queue(session, () => this.checkDisk(session, true));
    // Filesystem discovery can take several seconds on Windows. Do not hold up PCM writes for it.
    void this.options.onFat(folder).then(
      (fat) => {
        if (this.session !== session || session.finishing || !fat) return;
        session.fat = fat;
        this.warnAboutDrive(session);
      },
      () => undefined,
    );
    session.timer = setInterval(() => {
      const time = this.options.now();
      if (time - session.lastAudioAt > INPUT_WAIT_MS) {
        void this.stop('Sound recording stopped because the chosen sound input stopped sending audio.');
        return;
      }
      this.queue(session, () => this.checkDisk(session, false));
    }, CHECK_EVERY_MS);
    session.timer.unref();
    this.options.changed();
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
    session.lastAudioAt = this.options.now();
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
        this.status = {
          ...this.status,
          warning: [session.driveWarning, DRAFT_FAILED].filter(Boolean).join(' '),
        };
        this.options.notice(DRAFT_FAILED);
        this.options.changed();
      }
    });
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
      fat: session.fat,
      freeBytes: this.status.freeBytes,
      bytesPerHour: BYTES_PER_SECOND * 3600,
      keepFree: this.options.keepFree,
    });
    if (!warning || session.driveWarning === warning) return;
    session.driveWarning = warning;
    this.status = {
      ...this.status,
      warning: session.draftFailed ? `${warning} ${DRAFT_FAILED}` : warning,
    };
    this.options.notice(warning);
    this.options.changed();
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
    await writeAt(part.file, bytes, HEADER_BYTES + part.bytes);
    part.bytes += bytes.length;
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
