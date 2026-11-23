import { spawn as spawnChild, type ChildProcess } from 'node:child_process';
import { constants, setPriority } from 'node:os';
import { pcmFrame, type IndicFiles, type IndicLanguage } from './indic-protocol';

export interface IndicPipe {
  decode(samples: Int16Array): Promise<unknown>;
  close(): void;
  exited?: Promise<void>;
}
export interface IndicPipeOptions {
  program: string;
  files: IndicFiles;
  language: IndicLanguage;
  threads?: number;
  signal?: AbortSignal;
  spawn?: (program: string, args: string[]) => ChildProcess;
  priority?: (child: ChildProcess) => void;
  failed?: () => void;
  onExit?: () => void;
}

/** A private, single-flight child. Never logs stdout/stderr, words or model-supplied errors. */
export function openIndicPipe(o: IndicPipeOptions): Promise<IndicPipe> {
  return new Promise((resolve, reject) => {
    let ended = false,
      ready = false;
    let pending: { resolve(value: unknown): void; reject(error: Error): void } | null = null;
    let buffered = Buffer.alloc(0);
    let child: ChildProcess | null = null;
    let requestTimer: NodeJS.Timeout | null = null;
    let markExited: (() => void) | null = null;
    let exitMarked = false;
    const exited = new Promise<void>((done) => {
      markExited = () => {
        if (exitMarked) return;
        exitMarked = true;
        done();
        o.onExit?.();
      };
    });
    const failed = (reason: string): void => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      if (requestTimer) clearTimeout(requestTimer);
      requestTimer = null;
      o.signal?.removeEventListener('abort', onAbort);
      pending?.reject(new Error(reason));
      pending = null;
      if (child) child.kill();
      else markExited?.();
      if (!ready) reject(new Error(reason));
      o.failed?.();
    };
    const onAbort = (): void => {
      failed('closed');
    };
    const timer = setTimeout(() => {
      failed('recogniser readiness');
    }, 90_000);
    if (o.signal?.aborted) {
      failed('closed');
      return;
    }
    o.signal?.addEventListener('abort', onAbort, { once: true });
    const args = [
      '--lang',
      o.language,
      o.files.model,
      o.files.tokens,
      '--frontend',
      o.files.frontend,
      '--threads',
      String(o.threads ?? 1),
      '--pcm-serve',
      '--admit',
    ];
    try {
      const run =
        o.spawn ??
        ((program: string, args: string[]) =>
          process.platform === 'darwin'
            ? spawnChild('/usr/sbin/taskpolicy', ['-b', program, ...args], {
                stdio: ['pipe', 'pipe', 'ignore'],
                windowsHide: true,
              })
            : spawnChild(program, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }));
      child = run(o.program, args);
      child.once('error', () => {
        if (child?.pid === undefined) markExited?.();
        failed('recogniser start');
      });
      child.once('exit', () => {
        markExited?.();
        failed('recogniser exit');
      });
      if (!child.stdout || !child.stdin) {
        failed('recogniser pipes');
        return;
      }
      const priority =
        o.priority ??
        ((p: ChildProcess) => {
          if (p.pid === undefined) throw new Error('priority');
          setPriority(p.pid, constants.priority.PRIORITY_BELOW_NORMAL);
        });
      // On the Mac taskpolicy applies background priority at launch, before ORT loads the model.
      if (o.priority || process.platform !== 'darwin') priority(child);
      child.stdout.on('error', () => {
        failed('recogniser pipe');
      });
      child.stdin.on('error', () => {
        failed('recogniser pipe');
      });
      child.stdout.on('data', (data: Buffer) => {
        if (ended) return;
        if (buffered.length + data.length > 65_536) {
          failed('recogniser protocol bounds');
          return;
        }
        buffered = Buffer.concat([buffered, data]);
        const at = buffered.indexOf(10);
        if (at < 0) return;
        // One readiness or reply frame only. A second frame is unsolicited and fails closed.
        if (at !== buffered.length - 1) {
          failed('recogniser protocol');
          return;
        }
        let value: unknown;
        try {
          value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffered.subarray(0, at)));
        } catch {
          failed('recogniser protocol');
          return;
        }
        buffered = Buffer.alloc(0);
        if (!ready) {
          if (
            typeof value !== 'object' ||
            value === null ||
            !('ready' in value) ||
            value.ready !== true ||
            Object.keys(value).length !== 1
          ) {
            failed('recogniser protocol');
            return;
          }
          clearTimeout(timer);
          ready = true;
          resolve({
            decode(samples) {
              if (ended) throw new Error('closed');
              if (pending) throw new Error('busy');
              const frame = pcmFrame(samples);
              return new Promise((resolve, reject) => {
                pending = { resolve, reject };
                requestTimer = setTimeout(() => {
                  failed('recogniser lag');
                }, 8_000);
                child?.stdin?.write(frame);
              });
            },
            close: onAbort,
            exited,
          });
          return;
        }
        if (requestTimer) clearTimeout(requestTimer);
        requestTimer = null;
        const request = pending;
        pending = null;
        if (!request) {
          failed('recogniser protocol');
          return;
        }
        request.resolve(value);
      });
      child.stdin.write(Buffer.from('GO01'));
    } catch {
      failed('recogniser priority or start');
    }
  });
}
