import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

/*
 * Tests only (x58): a child process as a busy computer hands it over, its exit told before anything it wrote has been
 * read. Node keeps no order between a child's 'exit' and the last of its output (its 'close' comes once both are
 * done): what takes a child's words at its 'exit' has only those read so far, and on a busy computer none at all
 * (the unit suite under load on this Mac: a 2.4 s clip read as no length, 20 Nov).
 */

/**
 * `child`, its stdout's and stderr's words (and their ends) held back until every listener has heard it exit, then
 * handed over in their order, as they came.
 */
export function wordsAfterExit(child: ChildProcess): ChildProcess {
  let released = false;
  const held: (() => void)[] = [];
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    const emit = stream.emit.bind(stream);
    stream.emit = ((event: string | symbol, ...args: unknown[]) => {
      if (!released && (event === 'data' || event === 'end' || event === 'close')) {
        held.push(() => emit(event, ...args));
        return true;
      }
      return emit(event, ...args);
    }) as Readable['emit'];
  }
  child.once('exit', () => {
    setImmediate(() => {
      for (const words of held.splice(0)) words();
      released = true;
    });
  });
  return child;
}
