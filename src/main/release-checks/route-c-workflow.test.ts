import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPTION_MODELS } from '../../../scripts/fetch-caption-models.mjs';

/*
 * Caption AI's real recogniser on CI (alpha.23, cap-realc): alpha.22's two caption packs (354 MB, from their own
 * prerelease page) are fetched and caption-ai-real.spec.ts run ONLY in a run asked by hand (workflow_dispatch: a
 * quick check naming it, or a hand-sent full run), never on a push to main or phase1, so the release gate never
 * downloads them (the release lead's decision A, 24 Nov 2026). The fetch has its own ten minutes and runs in bash on
 * both systems (its cache folder starts with "~"); in a full run every such step comes after the installers are
 * uploaded, so a fetch or a slow phrase never hides them; the cache is keyed by the packs' pinned SHA-256s and saved
 * only from main or phase1.
 */

const APP = join(__dirname, '..', '..', '..');
const ci = readFileSync(join(APP, '.github', 'workflows', 'ci.yml'), 'utf8');
const release = readFileSync(join(APP, '.github', 'workflows', 'release.yml'), 'utf8');

/** One job of ci.yml: from its key to the next job's. */
function job(key: string): string {
  const start = ci.indexOf(`\n  ${key}:\n`);
  if (start < 0) throw new Error(`no job ${key} in ci.yml`);
  const next = ci.slice(start + 1).search(/\n {2}[\w-]+:\n/u);
  return next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next);
}

/**
 * A job's steps, each as its text (from its "- " line to the next), without comment lines: a comment above a step
 * belongs to the next one, never to the step it follows.
 */
const steps = (text: string): string[] =>
  text
    .split(/\n(?= {6}- )/u)
    .filter((s) => s.startsWith('      - '))
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !/^\s*#/u.test(line))
        .join('\n'),
    );

/** A step that touches the real packs: fetches them, caches them, or runs the spec that imports them. */
const packs = (step: string): boolean =>
  /fetch-caption-models\.mjs|drashti-caption-models|caption-ai-real\.spec\.ts/u.test(step);

/** A step's condition as one line (a folded `>-` one joined). */
const ifOf = (step: string): string =>
  (/\n {8}if: (>-\n(?: {10}.*\n?)+|.*)/u.exec(step)?.[1] ?? '')
    .replace(/^>-\n/u, '')
    .replace(/\s*\n\s*/gu, ' ')
    .trim();
const nameOf = (step: string): string => /^ {6}- name: (.*)$/mu.exec(step)?.[1] ?? '';

describe('caption AI’s real recogniser on CI', () => {
  const app = steps(job('app'));
  const real = app.filter(packs);

  it('fetches the packs and runs the real spec only in a run asked by hand, never on a push (the gate)', () => {
    expect(real.length).toBeGreaterThanOrEqual(4);
    for (const step of real)
      expect(ifOf(step), nameOf(step)).toMatch(/^github\.event_name == 'workflow_dispatch' && /u);
  });

  it('nowhere else: no other job and no release run touches the packs', () => {
    for (const key of ['secrets', 'checks', 'app-parts', 'app-black'])
      expect(steps(job(key)).filter(packs).map(nameOf), key).toEqual([]);
    expect(packs(release)).toBe(false);
  });

  it('the fetch has its own ten minutes and runs in bash on both systems', () => {
    const fetches = real.filter((s) => s.includes('node scripts/fetch-caption-models.mjs --cache '));
    expect(fetches.length).toBeGreaterThanOrEqual(1);
    for (const step of fetches) {
      expect(step, nameOf(step)).toContain('\n        timeout-minutes: 10\n');
      expect(step, nameOf(step)).toContain('\n        shell: bash\n');
    }
  });

  it('in a full run, every such step comes after the installers are uploaded', () => {
    const upload = app.findIndex((s) => nameOf(s) === 'Upload installers');
    expect(upload).toBeGreaterThan(0);
    for (const step of real.filter((s) => ifOf(s).includes("env.QUICK != 'true'")))
      expect(app.indexOf(step), nameOf(step)).toBeGreaterThan(upload);
  });

  it('caches them by their pinned SHA-256s, saved only from main or phase1 when not already cached', () => {
    const keys = real.filter((s) =>
      s.includes('--sha256 pack-gu-indicconformer-int8 pack-hi-indicconformer-int8'),
    );
    expect(keys.length).toBeGreaterThanOrEqual(1);
    for (const id of ['pack-gu-indicconformer-int8', 'pack-hi-indicconformer-int8'])
      expect(CAPTION_MODELS[id]?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    const saves = real.filter((s) => s.includes('uses: actions/cache/save@'));
    expect(saves.length).toBeGreaterThanOrEqual(1);
    for (const step of saves) {
      const when = ifOf(step);
      expect(when).toContain("cache-hit != 'true'");
      expect(when).toContain("github.ref == 'refs/heads/main' || github.ref == 'refs/heads/phase1'");
    }
    expect(real.filter((s) => s.includes('uses: actions/cache@')).map(nameOf)).toEqual([]);
  });
});
