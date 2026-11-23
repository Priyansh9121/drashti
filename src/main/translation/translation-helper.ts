import { spawn as spawnChild } from 'node:child_process';
import { constants, setPriority } from 'node:os';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import type { Route } from './indictrans-text';

/*
 * drashti-translate, the offline translation helper (alpha.22, a22-mt; tools/translate/drashti-translate.cc): one
 * program per computer, CTranslate2 4.9.1 (MIT) with SentencePiece (Apache-2.0), built from their pinned sources by
 * scripts/fetch-translate.mjs. It reads one JSON object a line on stdin and answers one a line on stdout; it opens
 * no port and reads only the model folder it is given. It runs below the show: a Mac's background QoS (taskpolicy
 * -b) and below-normal priority, as the captions engine does. One request at a time; every line is bounded and
 * every reply checked before it is used. Text never goes on its command line.
 */

export const HELPER_PROTOCOL = 1;
/** The longest line either side may send (a reply holds at most 256 tokens). */
export const MAX_LINE = 256 * 1024;

export interface HelperChild {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pid?: number | undefined;
  kill(): boolean;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

export interface TranslationHelperOptions {
  program: string;
  log: { info(line: string): void; warn(line: string): void };
  spawn?: (program: string) => HelperChild;
  lowerPriority?: (pid: number) => void;
  /** How long the helper may take to say hello, load a model, and translate one sentence. */
  helloMs?: number;
  loadMs?: number;
  translateMs?: number;
}

export class HelperError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const helloSchema = z.object({
  hello: z.literal('drashti-translate'),
  protocol: z.number(),
  ctranslate2: z.string().max(32),
  sentencepiece: z.string().max(32),
});
const replySchema = z.union([
  z.object({
    id: z.number().int(),
    ok: z.literal(true),
    tokens: z.array(z.string().max(1024)).max(300).optional(),
    route: z.string().max(32).optional(),
    loadMs: z.number().optional(),
    sourceTokens: z.number().optional(),
    ms: z.number().optional(),
  }),
  z.object({ id: z.number().int().nullable(), ok: z.literal(false), error: z.string().max(64) }),
]);
type Reply = z.infer<typeof replySchema>;

const defaultSpawn = (program: string): HelperChild => {
  const options = { stdio: 'pipe', windowsHide: true, shell: false } as const;
  // Keep the model's compute below the show, including while it loads.
  return process.platform === 'darwin'
    ? spawnChild('/usr/sbin/taskpolicy', ['-b', program], options)
    : spawnChild(program, [], options);
};
const defaultLowerPriority = (pid: number): void => {
  setPriority(pid, constants.priority.PRIORITY_BELOW_NORMAL);
};

interface Pending {
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** One running helper. Any fault (exit, a bad or oversized line, a reply too late) ends it: start a fresh one. */
export class TranslationHelper {
  private child: HelperChild | null = null;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private hello: ((ok: boolean) => void) | null = null;
  private ended: string | null = null;

  constructor(private readonly o: TranslationHelperOptions) {}

  get running(): boolean {
    return this.child !== null && this.ended === null;
  }

  /** Start the program and wait for its hello. */
  async start(): Promise<void> {
    if (this.child) throw new HelperError('started', 'The translation engine is already running.');
    const child = (this.o.spawn ?? defaultSpawn)(this.o.program);
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.read(chunk);
    });
    // stderr is drained, never logged: it could echo words.
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => {
      this.end('The translation engine stopped taking requests.');
    });
    child.once('error', () => {
      this.end('The translation engine could not start.');
    });
    child.once('exit', (code) => {
      this.end(`The translation engine stopped (exit ${String(code)}).`);
    });
    try {
      if (child.pid !== undefined) (this.o.lowerPriority ?? defaultLowerPriority)(child.pid);
    } catch {
      this.o.log.warn('Translation: the engine could not be put below the show’s priority.');
    }
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, this.o.helloMs ?? 10_000);
      this.hello = (good) => {
        clearTimeout(timer);
        resolve(good);
      };
    });
    this.hello = null;
    if (!ok) {
      this.end('The translation engine did not answer as Drashti’s own.');
      throw new HelperError(
        'no-hello',
        'The translation engine did not start. Reinstall Drashti to restore it.',
      );
    }
    this.o.log.info(`Translation: the engine started (pid ${String(child.pid)}).`);
  }

  async load(route: Route, modelFolder: string, sentencePiece: string, threads: number): Promise<void> {
    await this.ask(
      { op: 'load', route, model: modelFolder, spm: sentencePiece, threads },
      this.o.loadMs ?? 60_000,
    );
  }

  /** Let one model go (only one is kept loaded at a time). */
  async unload(route: Route): Promise<void> {
    await this.ask({ op: 'unload', route }, this.o.loadMs ?? 60_000);
  }

  /** The model's output tokens for one prepared sentence. */
  async translate(route: Route, src: string, tgt: string, text: string, beam: number): Promise<string[]> {
    const reply = await this.ask(
      { op: 'translate', route, src, tgt, text, beam },
      this.o.translateMs ?? 30_000,
    );
    if (!reply.ok || !reply.tokens)
      throw new HelperError('bad-reply', 'The translation engine answered wrongly.');
    return reply.tokens;
  }

  /** Stop the sentence in flight (greedy decoding stops at its next word; a careful one only by stop()). */
  cancel(): void {
    this.write({ id: this.nextId++, op: 'cancel' });
  }

  /** End the helper now; anything waiting is refused. */
  stop(): void {
    this.end('The translation engine was stopped.');
  }

  private write(request: Record<string, unknown>): boolean {
    if (!this.child || this.ended !== null) return false;
    const line = JSON.stringify(request);
    if (line.length > MAX_LINE) return false;
    this.child.stdin.write(`${line}\n`);
    return true;
  }

  private ask(request: Record<string, unknown>, timeoutMs: number): Promise<Reply> {
    if (!this.child || this.ended !== null)
      return Promise.reject(
        new HelperError('not-running', this.ended ?? 'The translation engine is not running.'),
      );
    const id = this.nextId++;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.end('The translation engine took too long and was stopped.');
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.write({ id, ...request })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new HelperError('too-large', 'The words are too long for the translation engine.'));
      }
    }).then((reply) => {
      if (!reply.ok) throw new HelperError(reply.error, messageFor(reply.error));
      return reply;
    });
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const at = this.buffer.indexOf('\n');
      if (at < 0) break;
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      this.line(line);
      if (this.ended !== null) return;
    }
    if (this.buffer.length > MAX_LINE)
      this.end('The translation engine sent too much at once and was stopped.');
  }

  private line(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.end('The translation engine sent something that was not an answer and was stopped.');
      return;
    }
    if (this.hello) {
      const hello = helloSchema.safeParse(value);
      this.hello(hello.success && hello.data.protocol === HELPER_PROTOCOL);
      return;
    }
    const reply = replySchema.safeParse(value);
    if (!reply.success) {
      this.end('The translation engine sent something that was not an answer and was stopped.');
      return;
    }
    if (reply.data.id === null) {
      this.end('The translation engine could not read a request and was stopped.');
      return;
    }
    const waiting = this.pending.get(reply.data.id);
    if (!waiting) return; // a cancel's acknowledgement
    this.pending.delete(reply.data.id);
    clearTimeout(waiting.timer);
    waiting.resolve(reply.data);
  }

  private end(why: string): void {
    if (this.ended !== null) return;
    this.ended = why;
    this.hello?.(false);
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new HelperError('ended', why));
    }
    this.pending.clear();
    const child = this.child;
    if (child) {
      try {
        child.stdin.end();
      } catch {
        // already closed
      }
      child.kill();
    }
  }
}

function messageFor(code: string): string {
  switch (code) {
    case 'too-long':
      return 'This text is too long for one translation. Split it into shorter lines.';
    case 'cancelled':
      return 'Stopped.';
    case 'model-unreadable':
    case 'tokenizer-unreadable':
      return 'The translation model could not be read. Import the model pack again.';
    default:
      return 'The translation engine could not translate these words.';
  }
}
