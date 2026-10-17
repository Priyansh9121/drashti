import { describe, expect, it } from 'vitest';
import { libraryProblem } from './library-problem';

/* The words for a library that will not open (Sessions 31–36, AI-3): what it means and what to do, never its code. */

const coded = (code: string) => Object.assign(new Error(`${code}: placeholder system text`), { code });

describe('a library that will not open', () => {
  it('says what it means and what to do, never the code or the system’s text', () => {
    for (const code of [
      'SQLITE_CORRUPT',
      'SQLITE_NOTADB',
      'SQLITE_FULL',
      'SQLITE_BUSY',
      'SQLITE_CANTOPEN',
      'EACCES',
      'EWHATEVER',
    ]) {
      const words = libraryProblem(coded(code));
      expect(words).not.toContain(code);
      expect(words).not.toContain('placeholder system text');
      expect(words).toMatch(/^[A-Z].*[:.] .*\.$|^[A-Z][^:]*: .*\.$/u);
    }
    expect(libraryProblem(coded('SQLITE_CORRUPT'))).toContain('put back the last backup');
    expect(libraryProblem(coded('SQLITE_FULL'))).toContain('free some space');
    expect(libraryProblem('not an error')).toContain('Start Drashti again');
  });

  it('a library from a newer Drashti says to install that version again, without its schema numbers', () => {
    const words = libraryProblem(
      new Error('This database was written by a newer Drashti (schema 99; this version knows 42).'),
    );
    expect(words).toContain('newer version of Drashti');
    expect(words).not.toMatch(/schema|99|42/u);
  });
});
