import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

/*
 * Tests only (a22-exitreaders, after x58's words-after-exit.ts): a stand-in for a child process, nothing started,
 * that ends as a busy computer may hand a real one over: its exit is told first, and what it wrote last comes a
 * moment after; its 'close' once that has ended, as Node tells it. What takes a child's words at its 'exit' has none
 * of those last words. As Node does at a child's exit, its input is let go (destroyed) just before the exit is told.
 */

export interface ExitFirstChild extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly pid: undefined;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  /** Stopped: it exits a moment later, saying nothing more. */
  kill(signal?: NodeJS.Signals): boolean;
  /**
   * It ends with `code`: its exit told at once, then its last `words`, then the end of its output and its 'close'.
   * `heldOpen`: its output does not end (a program it left running still holds it), so no 'close' comes until
   * `letGo()`.
   */
  end(code: number | null, words?: { stdout?: string; stderr?: string }, heldOpen?: boolean): void;
  /** What held its output open has gone: its output ends, and its 'close' comes. */
  letGo(): void;
  /** It never started (no such program): 'error', then 'close', and no 'exit', as Node tells it. */
  failToStart(): void;
}

export interface ExitFirstChildOptions {
  /** Each piece it is given on its input, as it takes it. */
  taken?: (chunk: Buffer) => void;
}

export function exitFirstChild(o: ExitFirstChildOptions = {}): ExitFirstChild {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  // What it is given is taken a moment later, as a pipe hands it on.
  const stdin = new Writable({
    write(chunk: Buffer, _encoding, done) {
      o.taken?.(chunk);
      setImmediate(done);
    },
  });
  let ended = false;
  let held: (() => void) | null = null;
  const child = Object.assign(events, {
    stdin,
    stdout,
    stderr,
    pid: undefined,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill(signal: NodeJS.Signals = 'SIGTERM') {
      setImmediate(() => {
        finish(null, {}, false, signal);
      });
      return true;
    },
    end(code: number | null, words: { stdout?: string; stderr?: string } = {}, heldOpen = false) {
      finish(code, words, heldOpen, null);
    },
    letGo() {
      const go = held;
      held = null;
      go?.();
    },
    failToStart() {
      if (ended) return;
      ended = true;
      process.nextTick(() => {
        stdin.destroy();
        child.emit('error', Object.assign(new Error('spawn placeholder-program ENOENT'), { code: 'ENOENT' }));
        closeOutput(-2, null);
      });
    },
  });
  function closeOutput(code: number | null, signal: NodeJS.Signals | null): void {
    let open = 2;
    for (const stream of [stdout, stderr]) {
      stream.once('close', () => {
        open -= 1;
        if (open === 0) child.emit('close', code, signal);
      });
      // What nobody reads is let go, as Node does once a child has exited.
      if (stream.listenerCount('data') === 0) stream.resume();
      stream.end();
    }
  }
  function finish(
    code: number | null,
    words: { stdout?: string; stderr?: string },
    heldOpen: boolean,
    signal: NodeJS.Signals | null,
  ): void {
    if (ended) return;
    ended = true;
    child.exitCode = code;
    child.signalCode = signal;
    stdin.destroy();
    child.emit('exit', code, signal);
    // Its last words, after every listener has heard it exit.
    setImmediate(() => {
      if (words.stdout) stdout.write(words.stdout);
      if (words.stderr) stderr.write(words.stderr);
      const close = () => {
        closeOutput(code, signal);
      };
      if (heldOpen) held = close;
      else close();
    });
  }
  return child;
}
