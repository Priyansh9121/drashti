import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { benchCommand, benchFiles } from '../../../scripts/captions-bench.mjs';

/*
 * CAP-CI-1 (c) (the owner, 24 Nov 2026: "Yes, all three"): one new input on the Performance workflow, `captions`,
 * runs the captions bench on Windows' two cores, alone or alongside the Performance check. Empty, the workflow is
 * the ordinary run it was: every new step waits for the input, and the check's own conditions read as before. The
 * bench is never part of the unit suite.
 */

const APP = join(__dirname, '..', '..', '..');
const workflow = readFileSync(join(APP, '.github', 'workflows', 'performance.yml'), 'utf8');

/** The workflow's steps, each as its text (from its "- " line to the next). */
function steps(): string[] {
  const at = workflow.indexOf('    steps:\n');
  return workflow
    .substring(at)
    .split(/\n(?= {6}- )/u)
    .filter((s) => s.startsWith('      - '));
}

describe('the Performance workflow’s captions input', () => {
  it('is one text input, empty unless asked', () => {
    expect(workflow).toMatch(
      /\n {6}captions:\n {8}description: "[^"\n]*Windows only[^"\n]*"\n {8}type: string\n {8}default: ''\n/u,
    );
  });

  it('runs Windows only when given (two cores by processor mask)', () => {
    expect(workflow).toContain(
      "os: ${{ fromJSON(inputs.captions != '' && '[\"windows-latest\"]' || inputs.os == 'windows' && '[\"windows-latest\"]' || inputs.os == 'macos' && '[\"macos-latest\"]' || '[\"macos-latest\",\"windows-latest\"]') }}",
    );
  });

  it('adds only steps that wait for it, so an ordinary run is unchanged', () => {
    const mine = steps().filter((s) =>
      /caption models|captions bench|captions-bench|fetch-whisper|fetch-indic/iu.test(s),
    );
    expect(mine.length).toBeGreaterThanOrEqual(7);
    for (const s of mine)
      expect(s).toMatch(
        /\n {8}if: (always\(\) && )?(inputs\.captions != ''|startsWith\(inputs\.captions, 'al(one|ongside)'\))\n/u,
      );
  });

  it('skips the Performance check only for alone, and puts it on two cores beside the bench alongside', () => {
    const check = steps().find((s) => s.includes('name: Performance self-test (headless)')) ?? '';
    expect(check).toContain("if: inputs.video_cases_packaged == '' && !startsWith(inputs.captions, 'alone')");
    expect(check).toContain(
      "DRASHTI_PERF_HANDICAP: ${{ (inputs.handicap || startsWith(inputs.captions, 'alongside')) && '1' || '0' }}",
    );
    expect(check).toContain('run: pnpm test:perf');
    const names = steps().map((s) => /name: ([^\n]+)/u.exec(s)?.[1] ?? '');
    const start = names.indexOf('Captions bench, alongside (started; two cores)');
    const stop = names.indexOf('Captions bench, alongside (stopped; its table)');
    const perf = names.indexOf('Performance self-test (headless)');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(perf);
    expect(stop).toBeGreaterThan(perf);
  });

  it('caches the models by their pins and keeps the tables (numbers only) as an artifact', () => {
    expect(workflow).toContain(
      "key: caption-models-${{ hashFiles('scripts/fetch-caption-models.mjs', 'src/main/speech/models.ts') }}",
    );
    expect(workflow).toContain('name: captions-bench-${{ runner.os }}');
  });

  it('runs the bench on its own config, never in the unit suite', () => {
    const [, args] = benchCommand();
    expect(args.slice(-3)).toEqual(['run', '-c', 'vitest.captions-bench.config.mjs']);
    expect(existsSync(join(APP, 'vitest.captions-bench.config.mjs'))).toBe(true);
    expect(readFileSync(join(APP, 'vitest.captions-bench.config.mjs'), 'utf8')).toContain(
      "include: ['src/main/speech/captions-bench.run.ts']",
    );
    // The unit suite takes *.test.ts files only.
    expect('captions-bench.run.ts').not.toMatch(/\.test\.tsx?$/u);
    expect(readFileSync(join(APP, 'vitest.config.ts'), 'utf8')).toContain(
      "include: ['src/**/*.test.{ts,tsx}']",
    );
    expect(benchFiles('/x')).toEqual({
      stop: join('/x', 'stop'),
      exit: join('/x', 'exit-code'),
      log: join('/x', 'bench.log'),
      table: join('/x', 'compare.md'),
    });
  });
});
