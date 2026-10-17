import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileProblem } from './plain-errors';

/*
 * Errors that say what to do next (Session 25, AI-3/DES-8): a message an operator or a phone can
 * see says what happened and what to do, in words, never a raw error or its code ("ENOSPC"), and
 * never "Something went wrong" alone. The raw error goes to the log only. Comments and log lines are
 * not messages; the source is scanned for the patterns that put an error into one.
 *
 * Widened in Sessions 31–36 (AI-3) to catch what slipped past: an error's own text in a template that runs
 * over several lines, "something went wrong" in any case, a system's own status words in a message, zod's
 * own words (the first issue's message) outside the one helper that keeps a schema's words and gives
 * Drashti's for the rest (shared/plain-parse.ts), and a message of one sentence that says only what failed.
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
  { why: '"something went wrong", which says nothing', pattern: /['"`][^'"`]*\bsomething went wrong/iu },
  { why: 'a "(s)" plural', pattern: /['"`][^'"`]*\w\(s\)[^'"`]*['"`]/u },
  {
    why: 'a system’s own status words in a message',
    pattern: /(message|detail|text|problem|notice)\s*[:=(]\s*`[^`]*\$\{[^}]*\.(status|stderr|stdout)\b/u,
  },
  { why: 'zod’s own words in a message (use shared/plain-parse.ts)', pattern: /\.issues\[\d+\]/u },
];

/** The one place a zod issue's message is read: it is a schema's own words there, or Drashti's. */
const PLAIN_PARSE = join('shared', 'plain-parse.ts');

/** Where a status number is the news, each named, with why: the status rule passes them. */
const STATUS_SHOWN: Record<string, string> = {
  [join('renderer', 'src', 'events', 'EventsOutDialog.tsx')]:
    'the HTTP answer of a receiver the admin set up, by its number, which they look up (401: the secret)',
};

/** Whether a rule passes this file: zod's words in the helper, a status where it is the news. */
const passes = (why: string, path: string) =>
  (why.startsWith('zod') && path === PLAIN_PARSE) || (why.startsWith('a system') && path in STATUS_SHOWN);

/**
 * Templates that carry an error's own text and are never shown: each named, with why. Everything else
 * that puts `error.message` in a template is a message, unless it is a log line.
 */
const NOT_SHOWN: Record<string, string> = {
  [join('renderer', 'src', 'program', 'capture.ts')]: 'the stream page’s notes for the log ([program] lines)',
  [join('shared', 'render-errors.ts')]: 'a render error’s report, for the log',
};

/** A log call that the template is part of: on its line or the two before (`log?.(` and `warn(` too). */
const LOG_NEAR = /\b(log|warn)(\.(warn|info|error|debug))?\??\.?\(|\.log\(|console\./u;

/** Templates holding an error's own text (`${error.message}`, `${(err as Error).message}`), over any lines. */
function errorTextTemplates(path: string, text: string): string[] {
  if (NOT_SHOWN[relative(src, path)]) return [];
  const found: string[] = [];
  for (const m of text.matchAll(/`(?:[^`\\]|\\.)*`/gsu)) {
    if (!/\$\{[^}]*\b(error|err)\b[^}]*\.message/su.test(m[0])) continue;
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const lines = text.slice(0, m.index).split('\n');
    const near = lines.slice(-3);
    if (near.some((l) => LOG_NEAR.test(l)) || /^\s*(\/\/|\*)/u.test(text.slice(lineStart, m.index))) continue;
    found.push(`${relative(src, path)}:${String(lines.length)} an error’s own text in a message`);
  }
  return found;
}

/** A line with each `${…}` (however nested, templates in it too) as "…", so a template reads as its words. */
function withoutInterpolations(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (line.startsWith('${', i)) {
      let depth = 1;
      i += 2;
      for (; i < line.length && depth > 0; i++) {
        if (line[i] === '{') depth++;
        else if (line[i] === '}') depth--;
      }
      i--;
      out += '…';
    } else out += line.charAt(i);
  }
  return out;
}

/** Where a message's words are given: a key that holds them, and a quoted string on the same line. */
const MESSAGE_WORDS =
  /\b(message|error|notice|problem|reason|detail|warning)\s*[:=]\s*(['"`])((?:(?!\2).)*)\2/gu;
/** Words saying something of Drashti's own failed. */
const FAILED =
  /\b(could not|took too long|stopped unexpectedly|too big|too large|went wrong|failed|will not)\b/iu;

/**
 * A message of one sentence that says only what failed ("The PDF could not be read."): it should say what
 * to do too, after a colon or in a sentence of its own.
 */
function onlyWhatFailed(line: string): boolean {
  return [...withoutInterpolations(line).matchAll(MESSAGE_WORDS)].some((m) => {
    const words = (m[3] ?? '').trim();
    if (!FAILED.test(words)) return false;
    const inner = words.endsWith('.') ? words.slice(0, -1) : words;
    return !/[.:;!?]\s/u.test(inner);
  });
}

describe('messages people see', () => {
  it('never carry a raw error, an error code, "something went wrong", a system’s status, zod’s words or "(s)"', () => {
    const found = files(src).flatMap((path) =>
      codeLines(readFileSync(path, 'utf8')).flatMap(({ line, n }) =>
        RULES.filter((r) => r.pattern.test(line) && !passes(r.why, relative(src, path))).map(
          (r) => `${relative(src, path)}:${String(n)} ${r.why}`,
        ),
      ),
    );
    expect(found).toEqual([]);
  });

  it('never carry an error’s own text, even in a template over several lines', () => {
    expect(files(src).flatMap((path) => errorTextTemplates(path, readFileSync(path, 'utf8')))).toEqual([]);
  });

  it('say what to do when something failed, not only what failed', () => {
    const found = files(src).flatMap((path) =>
      codeLines(readFileSync(path, 'utf8'))
        .filter(({ line }) => onlyWhatFailed(line))
        .map(({ n }) => `${relative(src, path)}:${String(n)} says only what failed`),
    );
    expect(found).toEqual([]);
  });

  it('the rules catch what they are for', () => {
    expect(onlyWhatFailed("      return { ok: false, message: 'The PDF could not be read.' };")).toBe(true);
    expect(
      onlyWhatFailed(
        "      return { ok: false, message: 'The PDF could not be read: save it again and import that.' };",
      ),
    ).toBe(false);
    expect(onlyWhatFailed("      return { ok: false, message: 'Cancelled.' };")).toBe(false);
    expect(
      errorTextTemplates(
        join(src, 'main', 'example.ts'),
        'box(\n  `${before}${error instanceof Error ? error.message : String(error)}`,\n);',
      ),
    ).toHaveLength(1);
    expect(
      errorTextTemplates(
        join(src, 'main', 'example.ts'),
        'log.warn(\n  `Not saved: ${(error as Error).message}`,\n);',
      ),
    ).toEqual([]);
    const rule = (why: string) => RULES.find((r) => r.why.startsWith(why))?.pattern;
    expect(
      rule('"something')?.test(
        "message: 'The library was not restored: something went wrong (see the log).'",
      ),
    ).toBe(true);
    expect(rule('a system')?.test('message: `No valid signature (Windows says: ${theirs.status}).`')).toBe(
      true,
    );
    expect(
      rule('zod')?.test("message: parsed.error.issues[0]?.message ?? 'Those markers cannot be kept.',"),
    ).toBe(true);
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
    // What to do depends on what Drashti was doing: reading what it was given, writing where the
    // person chose, or writing in its own folder (where choosing another drive is no way out).
    for (const use of ['read', 'write', 'own'] as const)
      for (const code of ['ENOSPC', 'EACCES', 'ENOENT', 'EROFS', 'EBUSY', 'EIO']) {
        const words = fileProblem(coded(code), use);
        expect(words).not.toContain(code);
        expect(words).toMatch(/^[A-Z].*\.$/u);
      }
    expect(fileProblem(coded('EACCES'), 'read')).toContain('copy it to the Desktop');
    expect(fileProblem(coded('ENOSPC'), 'own')).not.toContain('another drive');
    expect(fileProblem(coded('EROFS'), 'own')).not.toContain('another drive');
    expect(fileProblem(coded('ENOSPC'), 'read')).toContain('Try again');
    expect(fileProblem(new Error('placeholder'))).toContain('Try again');
    expect(fileProblem('not an error')).toContain('Try again');
  });
});
