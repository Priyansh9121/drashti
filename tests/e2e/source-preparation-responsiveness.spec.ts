/* Generated source pages only. Main must stay responsive while real source objects are prepared. */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EditSlidesResult } from '../../src/shared/slide-edit';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

const PROBE = '__drashtiGeneratedSourcePreparationHeartbeat';
const PREP = '__drashtiGeneratedSourcePreparationPromise';
const MAIN_BUDGET_MS = 250;
const BASELINE_BUDGET_MS = 100;
const SAMPLE_COUNT = 6;
interface Beat {
  last: number;
  worst: number;
  ticks: number;
  timer?: ReturnType<typeof setInterval>;
}
type MainGlobals = typeof globalThis & { [PROBE]?: Beat };
interface PageProbe {
  pending: boolean;
  promise: Promise<EditSlidesResult>;
}
type ProbeGlobals = PageGlobals & { [PREP]?: PageProbe };

/** A compact generated PDF with distinct ordinary paint operations, not a preexisting real document. */
function complexPdf(): Buffer {
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const pages: number[] = [];
  for (let page = 0; page < 6; page++) {
    // 96 supported separate rectangle paints. The native page extractor must do
    // real source separation; one original full-page bitmap is not an answer.
    const commands: string[] = [];
    for (let i = 0; i < 96; i++) {
      const x = 60 + (i % 12) * 105;
      const y = 60 + Math.floor(i / 12) * 135;
      const color = i % 2 === 0 ? '0.15 0.35 0.55' : '0.55 0.25 0.35';
      commands.push(`${color} rg`, `${String(x)} ${String(y)} 85 100 re f`);
    }
    commands.push(
      '0 0 0 rg',
      'BT',
      '/F1 30 Tf',
      '60 1350 Td',
      `(Placeholder generated pressure page ${String(page + 1)}) Tj`,
      'ET',
    );
    const content = commands.join('\n');
    bodies.push(
      `<< /Length ${String(Buffer.byteLength(content, 'ascii'))} >>\nstream\n${content}\nendstream`,
    );
    const streamId = bodies.length;
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1440 1440] /Contents ${String(streamId)} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    pages.push(bodies.length);
  }
  bodies[1] = `<< /Type /Pages /Kids [${pages.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, body] of bodies.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${String(bodies.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${String(bodies.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

async function measured<T>(promise: Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const started = performance.now();
  const value = await promise;
  return { value, elapsedMs: performance.now() - started };
}

async function startBeat(app: ElectronApplication) {
  await app.evaluate(() => {
    const globals = globalThis as MainGlobals;
    const state: Beat = { last: performance.now(), worst: 0, ticks: 0 };
    state.timer = setInterval(() => {
      const now = performance.now();
      state.worst = Math.max(state.worst, now - state.last);
      state.last = now;
      state.ticks++;
    }, 10);
    globals.__drashtiGeneratedSourcePreparationHeartbeat = state;
  });
}
const pending = (win: Page) =>
  win.evaluate(
    () => (globalThis as ProbeGlobals).__drashtiGeneratedSourcePreparationPromise?.pending === true,
  );

test('preparing a complex generated source leaves Main responsive to live commands and its own heartbeat', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' });
  const root = mkdtempSync(join(tmpdir(), 'drashti-preparation-response-'));
  let prepStarted = false;
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const file = join(root, 'Placeholder generated preparation pressure.pdf');
    writeFileSync(file, complexPdf());
    const [sourceId = ''] = await importAndGetIds(win, [file]);
    expect(sourceId, 'the existing generated PDF import is a setup precondition').not.toBe('');
    const liveId = await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.library.newFromWords(
        'Placeholder live response',
        'Placeholder live one\n\nPlaceholder live two',
      );
      if (!made.ok) throw new Error(made.message);
      const shown = await d.engine.dispatch({ type: 'goLive', presentationId: made.id, slideIndex: 0 });
      if (!shown.ok) throw new Error('The generated live command fixture could not go live.');
      return made.id;
    });

    // Reject a saturated baseline as an environment failure, never a pass/skip.
    await startBeat(app);
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const sample = await measured(app.evaluate(() => performance.now()));
      expect(
        sample.elapsedMs,
        'idle Main must meet the baseline response budget before the fixture starts',
      ).toBeLessThanOrEqual(BASELINE_BUDGET_MS);
    }
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as MainGlobals).__drashtiGeneratedSourcePreparationHeartbeat?.ticks ?? 0,
        ),
      )
      .toBeGreaterThanOrEqual(10);
    await app.evaluate(() => {
      const probe = (globalThis as MainGlobals).__drashtiGeneratedSourcePreparationHeartbeat;
      if (!probe) throw new Error('The test Main heartbeat was not installed.');
      probe.worst = 0;
      probe.ticks = 0;
      probe.last = performance.now();
    });

    // Return immediately: do not serialize the test behind source preparation.
    await win.evaluate((id) => {
      const globals = globalThis as ProbeGlobals;
      const state = { pending: true, promise: globals.drashti.library.slidesForEdit(id) };
      globals.__drashtiGeneratedSourcePreparationPromise = state;
      void state.promise.then(
        () => {
          state.pending = false;
        },
        () => {
          state.pending = false;
        },
      );
    }, sourceId);
    prepStarted = true;
    const samples: { pingMs: number; commandMs: number }[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      if (!(await pending(win))) break;
      const back = i % 2 !== 0;
      // Start both probes while preparation is pending. Keep the measured slow
      // result instead of aborting early: a valid completed extraction must be
      // proved before calling this a responsiveness RED.
      const [ping, dispatched] = await Promise.all([
        measured(app.evaluate(() => performance.now())),
        measured(
          win.evaluate(
            (back: boolean) =>
              (globalThis as PageGlobals).drashti.engine.dispatch({ type: back ? 'back' : 'next' }),
            back,
          ),
        ),
      ]);
      samples.push({ pingMs: ping.elapsedMs, commandMs: dispatched.elapsedMs });
      expect(dispatched.value.ok).toBe(true);
      const live = await win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live,
      );
      expect(live.presentationId).toBe(liveId);
      expect(live.slideIndex).toBe(i % 2 === 0 ? 1 : 0);
    }
    const prepared = await win.evaluate(async () => {
      const probe = (globalThis as ProbeGlobals).__drashtiGeneratedSourcePreparationPromise;
      if (!probe) throw new Error('The preparation call was not installed.');
      return await probe.promise;
    });
    expect(prepared.ok, 'the generated supported PDF must actually finish preparation').toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);
    const pages = prepared.doc.groups.flatMap((group) => group.slides);
    expect(pages).toHaveLength(6);
    expect(
      pages.every((page) =>
        page.elements.some(
          (element) =>
            element.kind === 'text' && element.text.includes('Placeholder generated pressure page'),
        ),
      ),
    ).toBe(true);
    const ticksBefore = await app.evaluate(
      () => (globalThis as MainGlobals).__drashtiGeneratedSourcePreparationHeartbeat?.ticks ?? 0,
    );
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as MainGlobals).__drashtiGeneratedSourcePreparationHeartbeat?.ticks ?? 0,
        ),
      )
      .toBeGreaterThan(ticksBefore);
    const beat = await app.evaluate(() => {
      const probe = (globalThis as MainGlobals).__drashtiGeneratedSourcePreparationHeartbeat;
      return probe ? { worst: probe.worst, ticks: probe.ticks } : null;
    });
    expect(beat?.ticks ?? 0).toBeGreaterThan(0);
    await test.info().attach('generated-source-preparation-response', {
      body: JSON.stringify({
        baselineBudgetMs: BASELINE_BUDGET_MS,
        activeBudgetMs: MAIN_BUDGET_MS,
        samples,
        heartbeat: beat,
      }),
      contentType: 'application/json',
    });
    // Validate the supported real extraction above before assessing scheduling.
    // An old Main-thread implementation should fail here on a measured stall,
    // never on an absent worker export or an invented source/API.
    expect(
      samples.length,
      'at least one measured probe must start during actual preparation',
    ).toBeGreaterThan(0);
    for (const [index, sample] of samples.entries()) {
      expect(sample.pingMs, `source preparation Main ping ${String(index + 1)}`).toBeLessThanOrEqual(
        MAIN_BUDGET_MS,
      );
      expect(
        sample.commandMs,
        `live Next/Back response ${String(index + 1)} during source preparation`,
      ).toBeLessThanOrEqual(MAIN_BUDGET_MS);
    }
    expect(
      beat?.worst ?? Infinity,
      'Main event-loop heartbeat stays live while source objects are prepared',
    ).toBeLessThanOrEqual(MAIN_BUDGET_MS);
    expect(
      samples.length,
      'fixture must overlap real preparation with at least three live-command probes',
    ).toBeGreaterThanOrEqual(3);
  } finally {
    // Let this test's own pending read finish, then remove its temporary timer.
    // No kill, external process, application source change or output window.
    if (prepStarted)
      for (const page of app.windows())
        if (!page.isClosed() && page.url().includes('index.html'))
          await page
            .evaluate(async () => {
              const globals = globalThis as ProbeGlobals;
              await globals.__drashtiGeneratedSourcePreparationPromise?.promise.catch(() => undefined);
              delete globals.__drashtiGeneratedSourcePreparationPromise;
            })
            .catch(() => undefined);
    await app
      .evaluate(() => {
        const globals = globalThis as MainGlobals;
        const probe = globals.__drashtiGeneratedSourcePreparationHeartbeat;
        if (probe?.timer) clearInterval(probe.timer);
        delete globals.__drashtiGeneratedSourcePreparationHeartbeat;
      })
      .catch(() => undefined);
    try {
      await app.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
