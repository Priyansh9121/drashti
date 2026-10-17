import type { z } from 'zod';

/*
 * Reading what a window, a phone or a file gives (Sessions 31–36, AI-3), in Drashti's words: a schema's
 * own message where it has one, written for people ("Choose the days of the week, or one date."), else
 * the words given here. zod's own text ("Too big: expected string to have <=80 characters") is a
 * developer's and is never shown: messages.test.ts keeps every other file from reading an issue's message.
 */

export type PlainParse<T> =
  { success: true; data: T } | { success: false; message: string; path: readonly PropertyKey[] };

/** A problem as zod hands it to the words for it (before it has a message). */
export type RawIssue = z.core.$ZodRawIssue;

/**
 * Parse `input`, giving `otherwise` for every problem the schema has no words of its own for: one sentence
 * for all of them, or words made from the problem (as a file's are, by `issueWords`).
 */
export function parsePlain<S extends z.ZodType>(
  schema: S,
  input: unknown,
  otherwise: string | ((issue: RawIssue) => string),
): PlainParse<z.output<S>> {
  const words = typeof otherwise === 'string' ? () => otherwise : otherwise;
  const parsed = schema.safeParse(input, { error: (issue) => words(issue) });
  if (parsed.success) return { success: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    success: false,
    message: issue?.message ?? (typeof otherwise === 'string' ? otherwise : 'It does not read.'),
    path: issue?.path ?? [],
  };
}

const KIND_NAMES: Readonly<Record<string, string>> = {
  string: 'words in quotes',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  array: 'a list in [ ]',
  object: 'a group of names and values in { }',
};

const unit = (origin: unknown, n: number) => {
  const many = n === 1 ? '' : 's';
  if (origin === 'string') return `${String(n)} letter${many}`;
  if (origin === 'array' || origin === 'set') return `${String(n)} item${many}`;
  return String(n);
};

/**
 * What is wrong with one value of a file, in a sentence from what zod found (its kind and limits, never
 * its text): "It is missing.", "It should be a number.", "It should be at most 80 letters."
 */
export function issueWords(issue: RawIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined
        ? 'It is missing.'
        : `It should be ${KIND_NAMES[String(issue.expected)] ?? String(issue.expected)}.`;
    case 'too_small': {
      const least = Number(issue.minimum);
      if (issue.origin === 'string' && least <= 1) return 'It is empty.';
      if ((issue.origin === 'array' || issue.origin === 'set') && least <= 1) return 'It has nothing in it.';
      return `It should be at least ${unit(issue.origin, least)}.`;
    }
    case 'too_big':
      return `It should be at most ${unit(issue.origin, Number(issue.maximum))}.`;
    case 'invalid_format':
      return 'It is not written the way the format asks.';
    case 'invalid_value':
      return 'It is not one of the values the format allows.';
    case 'unrecognized_keys':
      return 'It holds a name the format does not know.';
    default:
      return 'It does not read.';
  }
}

/** A sentence as a clause after a colon: its first letter small (unless it starts a capital word), no stop. */
export function asClause(sentence: string): string {
  const s = sentence.trim().replace(/\.$/u, '');
  return /^[A-Z][a-z]/u.test(s) ? `${s.charAt(0).toLowerCase()}${s.slice(1)}` : s;
}
