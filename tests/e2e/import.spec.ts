import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ELDHistogram } from 'node:perf_hooks';
import type { OutputGlobals, PageGlobals } from './helpers';
import { launchApp } from './helpers';

/*
 * Imports run in a separate worker process, so the show never waits for
 * them (PLAN.md 4.4). This test imports a few hundred generated lyrics files
 * while slides keep changing, and checks every change still reaches a painted
 * frame on the output within a frame. All text is generated placeholder text.
 */

const SONGS = 400;

/** Verses per song: each adds a group of three slides, so the import has real work to do. */
const VERSES = 16;

function song(i: number): string {
  const lines = [`[Chorus]`, `નમૂનાની ટેક ${i}`, `Namūnānī ṭek ${i}`, ''];
  for (let v = 1; v <= VERSES; v++) {
    lines.push(`[Verse ${v}]`);
    for (let s = 1; s <= 3; s++) {
      lines.push(
        `Placeholder song ${i}, verse ${v}, slide ${s}, line one`,
        `Placeholder line two for slide ${s}`,
        '',
      );
    }
    lines.push('[Chorus]', '');
  }
  return lines.join('\n');
}

async function outputPage(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find((w) => w.url().includes('output.html'));
  if (existing) return existing;
  return app.waitForEvent('window', { predicate: (w) => w.url().includes('output.html') });
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? Infinity;
};

test('a big import runs in the background: slides keep reaching the output within a frame', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-lyrics-'));
  for (let i = 1; i <= SONGS; i++) {
    writeFileSync(join(dir, `Placeholder Song ${String(i).padStart(3, '0')}.txt`), song(i));
  }

  const { app } = await launchApp();
  const win = await app.firstWindow();
  await expect(win.getByTestId('presentation-list').getByRole('button')).toHaveCount(2);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const created = await d.screens.createGroup('Main Hall');
    if (!created.ok) throw new Error(created.message);
    const assigned = await d.screens.assignDisplay(
      created.snapshot.groups[0]?.id ?? '',
      created.snapshot.displays[0]?.id ?? -1,
      { coverOperator: true },
    );
    if (!assigned.ok) throw new Error(assigned.message);
  });
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');

  /** Main-process health since the last call: event-loop stalls, slowest IPC handlers, longest GC pause. */
  const mainHealth = () =>
    app.evaluate(() => {
      const d = (
        globalThis as unknown as {
          drashtiDiagnostics: {
            loopDelay: ELDHistogram;
            handlerTimes: Map<string, number>;
            gc: { max: number };
          };
        }
      ).drashtiDiagnostics;
      const slowest = [...d.handlerTimes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([channel, ms]) => `${channel} ${Math.round(ms)}`);
      const out = {
        p99: Math.round(d.loopDelay.percentile(99) / 1e6),
        max: Math.round(d.loopDelay.max / 1e6),
        slowest,
        gc: Math.round(d.gc.max),
      };
      d.loopDelay.reset();
      d.handlerTimes.clear();
      d.gc.max = 0;
      return out;
    });
  await mainHealth();

  // Change slides every 40 ms: first with nothing else going on, then all through the import.
  const running = win.evaluate(async (folder) => {
    const d = (globalThis as PageGlobals).drashti;
    const id = (await d.library.listPresentations()).find((p) => p.name === 'Language test slides')?.id ?? '';
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const samples: { rev: number; sentAt: number; during: boolean }[] = [];
    let slide = 0;
    const change = async (during: boolean) => {
      slide = (slide + 1) % 3;
      const sentAt = Date.now();
      const r = await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: slide });
      if (r.ok && r.changed) samples.push({ rev: r.rev, sentAt, during });
    };
    for (let i = 0; i < 25; i++) {
      await change(false);
      await sleep(40);
    }
    const phases = new Set<string>();
    let progressEvents = 0;
    let changedEvents = 0;
    const offProgress = d.library.onImportProgress((p) => {
      progressEvents++;
      phases.add(p.phase);
    });
    const offChanged = d.library.onChanged(() => {
      changedEvents++;
    });
    const state = { finished: false };
    const startedAt = Date.now();
    const imported = d.library.importPaths([folder]).then((result) => {
      state.finished = true;
      return result;
    });
    while (!state.finished) {
      await change(true);
      await sleep(40);
    }
    const result = await imported;
    const importMs = Date.now() - startedAt;
    await sleep(1200); // let the last library refresh arrive
    offProgress();
    offChanged();
    return { samples, result, importMs, progressEvents, changedEvents, phases: [...phases] };
  }, dir);

  // Meanwhile: the import runs in its own process, not in the main process that drives the show.
  const state = { settled: false };
  void running.finally(() => {
    state.settled = true;
  });
  let sawWorker = false;
  while (!sawWorker && !state.settled) {
    sawWorker = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().some((m) => m.type === 'Utility' && m.name === 'Drashti import'),
    );
    if (!sawWorker) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const run = await running;
  const mainLoop = await mainHealth();
  expect(sawWorker, 'the import worker appears as its own utility process').toBe(true);
  // ...and exits when the run is over.
  await expect
    .poll(() =>
      app.evaluate(({ app: electronApp }) =>
        electronApp.getAppMetrics().some((m) => m.type === 'Utility' && m.name === 'Drashti import'),
      ),
    )
    .toBe(false);

  expect(run.result.ok, JSON.stringify(run.result)).toBe(true);
  if (!run.result.ok) return;
  const totals = run.result.run.totals;
  expect(totals).toMatchObject({
    files: SONGS,
    imported: SONGS,
    failed: 0,
    presentations: SONGS,
    groups: SONGS * (VERSES + 1),
    slides: SONGS * (VERSES * 3 + 1),
    arrangements: SONGS,
  });
  expect(run.phases).toEqual(expect.arrayContaining(['queued', 'scanning', 'importing', 'finished']));
  expect(run.changedEvents).toBeGreaterThan(0);

  // Pair each slide change with the first frame the output painted at or after its revision.
  const paints = await output.evaluate(() => (globalThis as OutputGlobals).drashtiPaintLog ?? []);
  const latency = (s: { rev: number; sentAt: number }) =>
    (paints.find((p) => p.rev >= s.rev)?.paintedAt ?? Infinity) - s.sentAt;
  const before = run.samples.filter((s) => !s.during).map(latency);
  const during = run.samples.filter((s) => s.during).map(latency);
  const line = (label: string, v: number[]) =>
    `${label}: n=${v.length} median ${percentile(v, 0.5)} ms, p90 ${percentile(v, 0.9)} ms, worst ${Math.max(...v)} ms`;
  const summary = `import of ${SONGS} files took ${run.importMs} ms (${JSON.stringify(run.result.timings)}); ${line('idle', before)}; ${line('importing', during)}; main event loop delay p99 ${mainLoop.p99} ms, max ${mainLoop.max} ms; slowest handlers (ms) ${mainLoop.slowest.join(', ')}; longest GC ${mainLoop.gc} ms`;
  console.log(summary);
  test.info().annotations.push({ type: 'slide change to painted frame', description: summary });

  // The import overlapped plenty of slide changes, and they kept reaching the screen within a
  // frame (60 Hz: 16.7 ms). A rare scheduling hiccup is tolerated; a stall is not.
  expect(during.length).toBeGreaterThanOrEqual(10);
  expect(percentile(during, 0.5)).toBeLessThanOrEqual(17);
  expect(percentile(during, 0.9)).toBeLessThanOrEqual(34);
  expect(Math.max(...during)).toBeLessThan(250);

  // The operator's library shows everything, and the report was kept.
  await expect(win.getByTestId('presentation-list').getByRole('button')).toHaveCount(SONGS + 2);
  const runId = run.result.run.id;
  const stored = await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const report = await d.library.getImportReport(id);
    const runs = await d.library.listImportRuns();
    return {
      items: report?.items.length,
      outcomes: [...new Set(report?.items.map((i) => i.outcome))],
      runs: runs.length,
    };
  }, runId);
  expect(stored).toEqual({ items: SONGS, outcomes: ['imported'], runs: 1 });

  // An imported presentation plays like any other.
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Song 007/ })
    .click();
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Song 007',
  );
  await win.getByTestId('slide-thumb').nth(0).click();
  await expect(output.locator('[data-run][data-lang="gu"]')).toHaveText('નમૂનાની ટેક 7');
  await expect(output.locator('[data-run][data-lang="translit"]')).toHaveText('Namūnānī ṭek 7');

  // Importing the same folder again changes nothing.
  const again = await win.evaluate(
    (folder) => (globalThis as PageGlobals).drashti.library.importPaths([folder]),
    dir,
  );
  expect(again.ok, JSON.stringify(again)).toBe(true);
  expect(again.ok && again.run.totals).toMatchObject({ skipped: SONGS, imported: 0 });

  // A changed file waits for a choice; replacing keeps the presentation and updates its slides.
  const changedFile = join(dir, 'Placeholder Song 001.txt');
  writeFileSync(changedFile, '[Verse 1]\nPlaceholder song 1, rewritten\n');
  const asked = await win.evaluate(
    (file) => (globalThis as PageGlobals).drashti.library.importPaths([file]),
    changedFile,
  );
  expect(asked.ok, JSON.stringify(asked)).toBe(true);
  expect(asked.ok && asked.run.totals).toMatchObject({ conflicts: 1 });
  const replaced = await win.evaluate(
    (file) =>
      (globalThis as PageGlobals).drashti.library.importPaths([file], { decisions: { [file]: 'replace' } }),
    changedFile,
  );
  expect(replaced.ok, JSON.stringify(replaced)).toBe(true);
  expect(replaced.ok && replaced.run.totals).toMatchObject({ replaced: 1, presentations: 1, slides: 1 });
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Song 001/ })
    .click();
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Song 001',
  );
  await expect(win.getByTestId('slide-thumb')).toHaveCount(1);

  await app.close();
});
