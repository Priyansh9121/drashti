import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asClause, issueWords, parsePlain } from './plain-parse';

/* Drashti's words for what zod finds (Sessions 31–36, AI-3): a schema's own, else Drashti's, never zod's. */

const schema = z
  .object({
    name: z.string().trim().min(1, 'Give it a name.').max(5),
    n: z.number(),
    tags: z.array(z.string()).min(1),
  })
  .refine((v) => v.n > 0, { message: 'The number must be above 0.' });

describe('parsePlain', () => {
  it('keeps a schema’s own words, and gives the words asked for instead of zod’s', () => {
    const otherwise = 'Those settings cannot be kept: check them, then save again.';
    expect(parsePlain(schema, { name: '', n: 1, tags: ['a'] }, otherwise)).toMatchObject({
      success: false,
      message: 'Give it a name.',
    });
    expect(parsePlain(schema, { name: 'ok', n: -1, tags: ['a'] }, otherwise)).toMatchObject({
      message: 'The number must be above 0.',
    });
    expect(parsePlain(schema, { name: 'far too long', n: 1, tags: ['a'] }, otherwise)).toMatchObject({
      message: otherwise,
      path: ['name'],
    });
    expect(parsePlain(schema, { name: 'ok', n: 'x', tags: ['a'] }, otherwise)).toMatchObject({
      message: otherwise,
    });
    expect(parsePlain(schema, { name: 'ok', n: 2, tags: ['a'] }, otherwise)).toEqual({
      success: true,
      data: { name: 'ok', n: 2, tags: ['a'] },
    });
  });

  it('says a file’s problem from its kind and limits, never zod’s text', () => {
    const said = (input: unknown) => parsePlain(schema, input, issueWords);
    expect(said({ name: 'ok', tags: ['a'] })).toMatchObject({ message: 'It is missing.', path: ['n'] });
    expect(said({ name: 'ok', n: 'x', tags: ['a'] })).toMatchObject({ message: 'It should be a number.' });
    expect(said({ name: 'toolong', n: 1, tags: ['a'] })).toMatchObject({
      message: 'It should be at most 5 letters.',
    });
    expect(said({ name: 'ok', n: 1, tags: [] })).toMatchObject({ message: 'It has nothing in it.' });
    for (const input of [{ n: 1 }, { name: 1, n: 1, tags: 'x' }, null])
      expect((said(input) as { message: string }).message).not.toMatch(
        /expected|received|Invalid|Too (big|small)/u,
      );
  });

  it('turns a sentence into a clause after a colon', () => {
    expect(asClause('Write dates as YYYY-MM-DD.')).toBe('write dates as YYYY-MM-DD');
    expect(asClause('YYYY-MM-DD only.')).toBe('YYYY-MM-DD only');
  });
});
