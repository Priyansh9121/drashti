import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from './database';
import { SearchIndex } from './search';
import { fillLibrary } from './testing/big-library';

/*
 * Search runs in the main process as the operator types, so every query
 * must stay well inside a frame or two: under 15 ms at 5,000 presentations
 * (about 70,000 lines of text), answer message included.
 */

const BUDGET_MS = 15;
const COUNT = 5000;
let dir: string;
let db: Db;
let buildMs = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-big-search-'));
  db = openDatabase(join(dir, 'drashti.sqlite'));
  fillLibrary(db, COUNT);
  const start = performance.now();
  new SearchIndex(db).rebuild();
  buildMs = performance.now() - start;
}, 180_000);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe(`search at ${COUNT} presentations`, () => {
  it(`answers as the operator types in under ${BUDGET_MS} ms`, () => {
    const index = new SearchIndex(db);
    // What typing "namuna pankti 12" sends, one keystroke at a time, and a few other kinds of query.
    const typed = 'namuna pankti 12';
    const queries = [
      ...Array.from({ length: typed.length }, (_, i) => typed.slice(0, i + 1)),
      'placeholder',
      'placeholder kirtan 01234',
      'line 4999',
      'no such words',
    ];
    const times: number[] = [];
    for (const q of queries) {
      const start = performance.now();
      const result = index.search(q);
      serialize(result);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? Infinity;
    const worst = times.at(-1) ?? Infinity;
    console.log(
      `search at ${COUNT}: median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms; index built in ${buildMs.toFixed(0)} ms`,
    );
    expect(median).toBeLessThan(BUDGET_MS);
    // A stall on a busy machine can hit one query; most must stay fast.
    expect(times.filter((t) => t >= BUDGET_MS).length).toBeLessThanOrEqual(2);
  });

  it('finds the right presentation among thousands', () => {
    const index = new SearchIndex(db);
    const hit = index.search('pankti 1234.1.2').hits[0];
    expect(hit?.name).toBe('Placeholder Talk 01234');
    // Its first line with every word (each word is the start of one: "1" also starts "1234").
    expect(hit?.match.kind).toBe('text');
    expect(hit?.match.kind === 'text' && hit.match.line).toMatch(/^Namūnā pankti 1234\./);
    expect(index.search('placeholder').more).toBe(true);
  });
});
