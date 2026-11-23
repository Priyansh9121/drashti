/*
 * Red stub (alpha.21, logs for 100+ installs (a)): the log of every show command, operator request and notice.
 */

export interface CommandLogDeps {
  write(line: string): void;
  now(): number;
  setTimer(ms: number, run: () => void): () => void;
}

export function requestLogged(channel: string): boolean {
  return channel === '';
}

export function blankQuoted(text: string): string {
  return text === '' ? text : '';
}

export class CommandLog {
  constructor(private readonly d: CommandLogDeps) {}

  show(command: { type: string } & Record<string, unknown>, result: unknown): void {
    void command;
    void result;
    void this.d;
  }

  request(channel: string, outcome: string, error?: unknown): void {
    void channel;
    void outcome;
    void error;
  }

  notice(text: string): void {
    void text;
  }
}
