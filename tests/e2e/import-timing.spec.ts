import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDeckMedia } from '../../src/main/import/testing/make-deck';
import {
  placeholderDeck,
  placeholderJpegs,
  placeholderPdf,
} from '../../src/main/import/testing/timing-placeholders';
import { STEPS_LINE } from '../../src/main/import/step-times';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  slideEditorWindow,
} from './helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * Where a deck's or a PDF's import spends its time, step by step (Session 56): placeholder decks of 6, 30 and 60
 * slides (a third with animations, src/main/import/testing/timing-placeholders.ts) and placeholder PDFs of 10 and
 * 100 pages, each imported into a Drashti of its own, then Edit slides opened on it (where the words and shapes for
 * editing are read). Each import's steps come from Drashti's own log line ("Import steps: …", main/import/
 * step-times.ts), with the import's time as the operator waits for it, and Edit slides' until the first slide's
 * words can be edited; each row is printed and attached, and the table at the end.
 *
 * Only when asked, so it never slows the suite:
 *   DRASHTI_IMPORT_TIMING=1 node_modules/.bin/playwright test tests/e2e/import-timing.spec.ts
 * or a manual CI run (the CI workflow, os windows or macos) naming tests/e2e/import-timing.spec.ts in its specs.
 * PowerPoint is the tests' stand-in, its movie as big as PowerPoint's own (1080 lines), unless
 * DRASHTI_IMPORT_TIMING_REAL=1: this Mac's own PowerPoint (DRASHTI_IMPORT_TIMING_APP=keynote: Keynote), which opens on
 * the screen for a moment, so only with the owner told first; then only the decks are imported.
 */

const asked =
  process.env['DRASHTI_IMPORT_TIMING'] === '1' ||
  (process.env['SPECS'] ?? '').includes('import-timing.spec.ts');
test.skip(!asked, 'Only when asked: DRASHTI_IMPORT_TIMING=1, or named in a manual CI run');
const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');
const real = process.env['DRASHTI_IMPORT_TIMING_REAL'] === '1';
const realApp = process.env['DRASHTI_IMPORT_TIMING_APP'] === 'keynote' ? 'keynote' : 'powerpoint';

/** Whether an app of this name is running for this user (a Mac). */
const running = (name: string) =>
  spawnSync('pgrep', ['-x', '-U', String(process.getuid?.() ?? 0), name]).status === 0;

// This computer's own apps only when neither is open: the check never works beside anyone's documents.
test.beforeAll(() => {
  if (real && (running('Microsoft PowerPoint') || running('Keynote')))
    throw new Error(
      'Quit PowerPoint and Keynote first: the timing check never works beside anyone’s documents.',
    );
});

interface Placeholder {
  name: string;
  kind: 'deck' | 'pdf';
  count: number;
}
const PLACEHOLDERS: Placeholder[] = [
  { name: 'Placeholder deck 6', kind: 'deck', count: 6 },
  { name: 'Placeholder deck 30', kind: 'deck', count: 30 },
  { name: 'Placeholder deck 60', kind: 'deck', count: 60 },
  { name: 'Placeholder PDF 10', kind: 'pdf', count: 10 },
  { name: 'Placeholder PDF 100', kind: 'pdf', count: 100 },
];

interface Row {
  name: string;
  how: string;
  slides: number;
  /** The import as the operator waits for it, from asking to the report. */
  importMs: number;
  steps: Record<string, number>;
  /** The file's own time in the import (the log line's). */
  totalMs: number;
  /** Edit slides, from asking to the first slide's own words being there to edit. */
  editMs: number;
}
const rows: Row[] = [];

/** Each placeholder, made once in a folder of the run's own. */
const made = (() => {
  let dir: string | null = null;
  return (p: Placeholder): string => {
    dir ??= mkdtempSync(join(tmpdir(), 'drashti-e2e-timing-'));
    const file = join(dir, `${p.name}.${p.kind === 'deck' ? 'pptx' : 'pdf'}`);
    if (existsSync(file)) return file;
    if (p.kind === 'deck')
      writeFileSync(file, placeholderDeck(p.count, makeDeckMedia(ffmpeg ?? '', join(dir, 'media'))));
    else writeFileSync(file, placeholderPdf(p.count, placeholderJpegs(ffmpeg ?? '', join(dir, 'pictures'))));
    return file;
  };
})();

interface StepsEntry {
  name: string;
  how: string;
  slides: number;
  steps: Record<string, number>;
  totalMs: number;
}

/** The file's line among Drashti's log's "Import steps". */
function stepsOf(userData: string, fileName: string): StepsEntry {
  const entry = readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8')
    .split('\n')
    .filter((l) => l.includes(STEPS_LINE))
    .map((l) => JSON.parse(l.slice(l.indexOf(STEPS_LINE) + STEPS_LINE.length)) as StepsEntry)
    .find((e) => e.name === fileName);
  if (!entry) throw new Error(`No "${STEPS_LINE}" line for ${fileName} in Drashti's log`);
  return entry;
}

const seconds = (ms: number | undefined) => (ms === undefined ? '' : (ms / 1000).toFixed(1));
const STEP_COLUMNS = [
  'original',
  'read',
  'app',
  'timed-copy',
  'app-pdf',
  'movie',
  'app-close',
  'find-steps',
  'cut',
  'deck',
  'pictures',
  'write',
];

/** The rows as a table in seconds: a step's column only where any row took time in it. */
function table(all: readonly Row[]): string {
  const columns = STEP_COLUMNS.filter((c) => all.some((r) => r.steps[c] !== undefined));
  const head = ['placeholder', 'how', 'slides', ...columns, 'file total', 'import (waited)', 'Edit slides'];
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...all.map(
      (r) =>
        `| ${[
          r.name,
          r.how,
          String(r.slides),
          ...columns.map((c) => seconds(r.steps[c])),
          seconds(r.totalMs),
          seconds(r.importMs),
          seconds(r.editMs),
        ].join(' | ')} |`,
    ),
  ];
  return lines.join('\n');
}

test.afterAll(() => {
  if (rows.length === 0) return;
  const how = real
    ? `this computer's own ${realApp === 'keynote' ? 'Keynote' : 'PowerPoint'}`
    : 'the stand-in';
  console.log(`Import timing on ${process.platform} with ${how} (seconds):\n${table(rows)}`);
});

for (const p of PLACEHOLDERS.filter((x) => !real || x.kind === 'deck')) {
  test(`timing: ${p.name}`, async () => {
    test.setTimeout(40 * 60_000);
    const file = made(p);
    const fileName = file.split(/[\\/]/u).pop() ?? '';
    const env: Record<string, string> = real
      ? { DRASHTI_TEST_DECK_APPS: realApp }
      : {
          DRASHTI_TEST_DECK_BAKER: '1',
          DRASHTI_TEST_DECK_CONVERTER: '1',
          DRASHTI_TEST_DECK_BAKER_LINES: '1080',
        };
    const { app, userData } = await launchApp(env);
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const from = Date.now();
      const [id = ''] = await importAndGetIds(win, [file]);
      const importMs = Date.now() - from;
      expect(id, `${p.name} came in`).not.toBe('');
      const steps = stepsOf(userData, fileName);
      // Edit slides on it: the words and shapes for editing are read as it opens.
      await openLibrary(win);
      await win
        .getByTestId('presentation-list')
        .getByTestId('presentation-row')
        .filter({ hasText: p.name })
        .click();
      const editFrom = Date.now();
      await win.getByTestId('edit-slides').click();
      const { editor } = await slideEditorWindow(app);
      await expect(
        editor
          .getByTestId('editor-slide')
          .locator('[data-element]')
          .filter({ hasText: '1. Velora tamsin orvel' }),
      ).toBeVisible({ timeout: 10 * 60_000 });
      const editMs = Date.now() - editFrom;
      const row: Row = { ...steps, name: p.name, importMs, editMs };
      rows.push(row);
      console.log(`Import timing: ${JSON.stringify(row)}`);
      await test.info().attach('import-timing', {
        body: Buffer.from(JSON.stringify(row, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await app.close();
    }
  });
}
