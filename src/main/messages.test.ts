import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileProblem } from './plain-errors';

/*
 * Errors that say what to do next (Session 25, AI-3/DES-8): a message an operator or a phone can
 * see says what happened and what to do, in words, never a raw error or its code ("ENOSPC"), and
 * never "Something went wrong" alone. The raw error goes to the log only. Comments and log lines are
 * not messages; the source is scanned for the patterns that put an error into one.
 */

const src = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });
}

/** A log call on one line. */
const LOG = /\blog(\.(warn|info|error|debug))?\(|\.log\(/u;
/** A log call whose words follow on the next lines: it ends open, or is its level argument alone. */
const LOG_OPENS =
  /(\blog(\.(warn|info|error|debug))?|\.log)\($|^\s*(outcome === 'done' \? )?'(info|warn|error)',?\s*$/u;

/** Lines that are code, not comments or log lines (a log call's text may start on the line after it). */
const codeLines = (text: string) => {
  const lines = text.split('\n');
  return lines
    .map((line, i) => ({
      line: line.replace(/String\(\w+\)/gu, ''),
      n: i + 1,
      before: lines.slice(Math.max(0, i - 2), i),
    }))
    .filter(
      ({ line, before }) =>
        !/^\s*(\/\/|\*|\/\*)/u.test(line) &&
        !LOG.test(line) &&
        !before.some((b) => LOG_OPENS.test(b.trimEnd())),
    );
};

const RULES: { why: string; pattern: RegExp }[] = [
  {
    why: 'a raw error in a message',
    pattern: /(message|detail|text|problem)\s*[:=(]\s*`[^`]*\$\{[^}]*(error|err)\b[^}]*\.message/u,
  },
  { why: 'an error code in a message', pattern: /(notice|message)\s*[:(]\s*`[^`]*\$\{\s*errorCode\(/u },
  { why: '"Something went wrong" with no way on', pattern: /['"`]Something went wrong/u },
  { why: 'a "(s)" plural', pattern: /['"`][^'"`]*\w\(s\)[^'"`]*['"`]/u },
];

describe('messages people see', () => {
  it('never carry a raw error, an error code, "Something went wrong" or "(s)"', () => {
    const found = files(src).flatMap((path) =>
      codeLines(readFileSync(path, 'utf8')).flatMap(({ line, n }) =>
        RULES.filter((r) => r.pattern.test(line)).map((r) => `${relative(src, path)}:${String(n)} ${r.why}`),
      ),
    );
    expect(found).toEqual([]);
  });

  it('say what a file problem means and what to do, never its code', () => {
    const coded = (code: string) => Object.assign(new Error(`${code}: placeholder system text`), { code });
    for (const code of ['ENOSPC', 'EACCES', 'EPERM', 'ENOENT', 'EROFS', 'EBUSY', 'EIO', 'EWHATEVER']) {
      const words = fileProblem(coded(code));
      expect(words).not.toContain(code);
      expect(words).not.toContain('placeholder system text');
      expect(words).toMatch(/^[A-Z].*\.$/u);
    }
    expect(fileProblem(coded('ENOSPC'))).toContain('free some space');
    expect(fileProblem(new Error('placeholder'))).toContain('Try again');
    expect(fileProblem('not an error')).toContain('Try again');
  });
});
