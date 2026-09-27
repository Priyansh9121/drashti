/** Minimal logger for the main process. Later phases will add a log file. */
type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (detail === undefined) out(line);
  else out(line, detail);
}

export const log = {
  info: (message: string, detail?: unknown) => {
    write('info', message, detail);
  },
  warn: (message: string, detail?: unknown) => {
    write('warn', message, detail);
  },
  error: (message: string, detail?: unknown) => {
    write('error', message, detail);
  },
};
