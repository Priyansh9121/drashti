import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

/*
 * Tests only (a22-exitreaders, after x58's words-after-exit.ts): a stand-in for a child process, nothing started,
 * that ends as a busy computer may hand a real one over: its exit is told first, and what it wrote last comes a
 * moment after; its 'close' once that has ended, as Node tells it. What takes a child's words at its 'exit' has none
 * of those last words.
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
   * `heldOpen`: its output never ends (a program it left running still holds it), so no 'close' comes.
   */
  end(code: number | null, words?: { stdout?: string; stderr?: string }, heldOpen?: boolean): void;
}

export function exitFirstChild(): ExitFirstChild {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  // What it is given is taken at once.
  const stdin = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  let ended = false;
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
  });
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
    child.emit('exit', code, signal);
    // Its last words, after every listener has heard it exit.
    setImmediate(() => {
      if (words.stdout) stdout.write(words.stdout);
      if (words.stderr) stderr.write(words.stderr);
      if (heldOpen) return;
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
    });
  }
  return child;
}
