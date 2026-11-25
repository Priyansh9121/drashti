import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  CHAT_HISTORY_MAX,
  CHAT_LINES_MAX,
  CHAT_NAME_MAX,
  CHAT_OPERATOR_ID,
  CHAT_OPERATOR_NAME,
  CHAT_PEOPLE_MAX,
  CHAT_TEXT_MAX,
  type ChatMessage,
  type ChatPerson,
  type ChatState,
  chatDay,
} from '../../shared/chat';

/*
 * The chat's day on the Drashti computer (alpha.23, QA23-CHAT-1, shared/chat.ts): the messages, the people's names
 * and the chat-only phones (paired for the day: their tokens' hashes only), in memory and in one small file in the
 * data folder, never in the library (so never in a backup, nor in the library a Report a Problem sends). It is
 * written a moment after a change, whole or not at all (written beside, then moved into place). A file from an
 * earlier day, or one that cannot be read, is emptied, never kept aside: it holds people's words. Nothing of a
 * message or a name ever goes into a log line: only what happened, with an error's code.
 */

export interface ChatDevice {
  id: string;
  /** "Chat 1", "Chat 2"…: the device's name, never the person's. */
  name: string;
  tokenHash: string;
  pairedAt: string;
}

export interface ChatStoreDeps {
  /** The chat's file, in the data folder. */
  file: string;
  now(): number;
  /** Tests: the time zone the day is read in (else this computer's). */
  timeZone?: string;
  /** When to write what changed (a moment later, once for several changes). Left out: 500 ms later. */
  later?(run: () => void): void;
  log(level: 'info' | 'warn', message: string): void;
}

/** A busy chat is written at most this often. */
const WRITE_AFTER_MS = 2000;

const personSchema = z
  .object({ id: z.string().min(1).max(128), name: z.string().min(1).max(CHAT_NAME_MAX) })
  .strict();
const messageSchema = z
  .object({
    id: z.string().min(1).max(128),
    at: z.string().min(1).max(40),
    from: personSchema,
    text: z
      .string()
      .min(1)
      .refine((t) => t.length <= CHAT_TEXT_MAX && t.split('\n').length <= CHAT_LINES_MAX),
  })
  .strict();
const deviceSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(60),
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/u),
    pairedAt: z.string().min(1).max(40),
  })
  .strict();
const fileSchema = z
  .object({
    version: z.literal(1),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    messages: z.array(messageSchema).max(CHAT_HISTORY_MAX),
    people: z.array(personSchema).max(CHAT_PEOPLE_MAX),
    devices: z.array(deviceSchema).max(CHAT_PEOPLE_MAX),
  })
  .strict();

type ChatFile = z.infer<typeof fileSchema>;

const OPERATOR: ChatPerson = { id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME };

const codeOf = (error: unknown): string => (error as NodeJS.ErrnoException | null)?.code ?? 'no code';

export class ChatStore {
  private data: ChatFile;
  private writeWaiting = false;
  /** Writes under way off Main's thread, one after another; which is the newest; and Drashti quitting. */
  private writing: Promise<void> = Promise.resolve();
  private generation = 0;
  private closed = false;

  constructor(private readonly deps: ChatStoreDeps) {
    this.data = this.empty();
  }

  private today(): string {
    return chatDay(this.deps.now(), this.deps.timeZone);
  }

  private empty(): ChatFile {
    return { version: 1, day: this.today(), messages: [], people: [], devices: [] };
  }

  /** At the start: today's chat as kept, or an empty one (an earlier day's, or a damaged file, emptied). */
  load(): void {
    let text: string;
    try {
      text = readFileSync(this.deps.file, 'utf8');
    } catch (error) {
      if (codeOf(error) !== 'ENOENT')
        this.deps.log('warn', `Chat: the day's chat could not be read (${codeOf(error)}); it starts empty`);
      this.data = this.empty();
      return;
    }
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      // Never JSON.parse's own message: it quotes the file.
    }
    const parsed = fileSchema.safeParse(raw);
    this.data = this.empty();
    if (!parsed.success) {
      this.deps.log('warn', 'Chat: the day’s chat file was not in Drashti’s form; it was emptied');
      this.remove();
      return;
    }
    if (parsed.data.day !== this.data.day) {
      this.remove();
      return;
    }
    this.data = parsed.data;
  }

  /** A new day began since the chat was last read: it is emptied (people and phones too). True when it was. */
  newDay(): boolean {
    const today = this.today();
    if (this.data.day === today) return false;
    this.data = { version: 1, day: today, messages: [], people: [], devices: [] };
    this.changed();
    return true;
  }

  state(): ChatState {
    return {
      day: this.data.day,
      messages: this.data.messages.map((m) => ({ ...m, from: { ...m.from } })),
      people: [OPERATOR, ...this.data.people].map((p) => ({ ...p })),
    };
  }

  /** A message as Drashti takes it (its words already checked and cleaned): the oldest go past CHAT_HISTORY_MAX. */
  add(from: ChatPerson, text: string): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      at: new Date(this.deps.now()).toISOString(),
      from: { id: from.id, name: from.name },
      text,
    };
    this.data.messages.push(message);
    if (this.data.messages.length > CHAT_HISTORY_MAX)
      this.data.messages.splice(0, this.data.messages.length - CHAT_HISTORY_MAX);
    this.changed();
    return { ...message, from: { ...message.from } };
  }

  /** A person's name given or changed (already checked): a new one goes last, a changed one stays in its place. */
  setName(id: string, name: string): void {
    const known = this.data.people.find((p) => p.id === id);
    if (known) known.name = name;
    else this.data.people.push({ id, name });
    this.changed();
  }

  person(id: string): ChatPerson | null {
    if (id === CHAT_OPERATOR_ID) return { ...OPERATOR };
    const p = this.data.people.find((q) => q.id === id);
    return p ? { ...p } : null;
  }

  /** People with a name today (the operator not counted). */
  peopleCount(): number {
    return this.data.people.length;
  }

  /** A person out of the people (their messages stay as sent). */
  forget(id: string): boolean {
    const before = this.data.people.length;
    this.data.people = this.data.people.filter((p) => p.id !== id);
    if (this.data.people.length === before) return false;
    this.changed();
    return true;
  }

  clearMessages(): void {
    this.data.messages = [];
    this.changed();
  }

  /** A chat-only phone paired for today, by its token's hash: "Chat n", the lowest n free. */
  addDevice(tokenHash: string): ChatDevice {
    const names = new Set(this.data.devices.map((d) => d.name));
    let n = 1;
    while (names.has(`Chat ${String(n)}`)) n++;
    const device: ChatDevice = {
      id: randomUUID(),
      name: `Chat ${String(n)}`,
      tokenHash,
      pairedAt: new Date(this.deps.now()).toISOString(),
    };
    this.data.devices.push(device);
    this.changed();
    return { ...device };
  }

  device(id: string): ChatDevice | null {
    const d = this.data.devices.find((e) => e.id === id);
    return d ? { ...d } : null;
  }

  devices(): ChatDevice[] {
    return this.data.devices.map((d) => ({ ...d }));
  }

  removeDevice(id: string): boolean {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((d) => d.id !== id);
    if (this.data.devices.length === before) return false;
    this.changed();
    return true;
  }

  /** Write what waits now, on Main's thread (Drashti quitting): no write under way after it lands over it. */
  flush(): void {
    this.writeWaiting = false;
    this.closed = true;
    this.generation++;
    this.writeNow();
  }

  /** The writes under way, done (tests; a write that failed has said so in the log). */
  settled(): Promise<void> {
    return this.writing;
  }

  private changed(): void {
    if (this.writeWaiting || this.closed) return;
    this.writeWaiting = true;
    const run = () => {
      if (!this.writeWaiting) return;
      this.writeWaiting = false;
      this.writeLater();
    };
    if (this.deps.later) this.deps.later(run);
    else setTimeout(run, WRITE_AFTER_MS).unref();
  }

  /**
   * The chat as it is now, written off Main's thread (review S1: a Windows PC's antivirus can hold a write): one write
   * at a time, each after the one before, and one a newer write follows is never written at all.
   */
  private writeLater(): void {
    const generation = ++this.generation;
    const text = JSON.stringify(this.data);
    this.writing = this.writing.then(() => this.write(text, generation));
  }

  private async write(text: string, generation: number): Promise<void> {
    const stale = () => this.closed || generation !== this.generation;
    if (stale()) return;
    const file = this.deps.file;
    const temp = `${file}.writing`;
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(temp, text, { mode: 0o600 });
      if (stale()) {
        await rm(temp, { force: true });
        return;
      }
      await rename(temp, file);
    } catch (error) {
      this.deps.log('warn', `Chat: the day's chat could not be kept on disk (${codeOf(error)})`);
      try {
        await rm(temp, { force: true });
      } catch {
        // Nothing more to do.
      }
    }
  }

  private writeNow(): void {
    const file = this.deps.file;
    // Its own name: a write under way off the thread has its own.
    const temp = `${file}.quitting`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(temp, file);
    } catch (error) {
      this.deps.log('warn', `Chat: the day's chat could not be kept on disk (${codeOf(error)})`);
      try {
        rmSync(temp, { force: true });
      } catch {
        // Nothing more to do.
      }
    }
  }

  private remove(): void {
    try {
      rmSync(this.deps.file, { force: true });
      rmSync(`${this.deps.file}.writing`, { force: true });
      rmSync(`${this.deps.file}.quitting`, { force: true });
    } catch (error) {
      this.deps.log('warn', `Chat: an earlier chat could not be emptied (${codeOf(error)})`);
    }
  }
}
