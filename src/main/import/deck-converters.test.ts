import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ConvertLimits, CONVERT_LIMITS, convertToPdf, findConverters } from './deck-converters';
import { readPptx } from './pictures';
import { makeTestPptx, type TestPptxSlide } from './testing/make-pptx';
import { makeZip } from './testing/zip-writer';

/*
 * Keynote and PowerPoint saving placeholder decks as PDF, for real (Session
 * 16). It runs only where they are installed, and only when asked, because
 * it starts and quits them:
 *
 *   DRASHTI_TEST_CONVERTERS=1 pnpm test src/main/import/deck-converters.test.ts
 *
 * Quit Keynote and PowerPoint first (the test refuses to start while either
 * is open, so it never touches anyone's documents). The first run asks
 * whether the terminal may control each app: choose Allow. Never on CI (its
 * machines have neither app).
 *
 * Not here, by hand: choosing Don't Allow at that question (macOS asks only
 * once; see docs/setup-day.md), and PowerPoint on Windows.
 */

const wanted =
  process.env['DRASHTI_TEST_CONVERTERS'] === '1' && process.platform === 'darwin' && !process.env['CI'];
const has = wanted ? await findConverters() : { keynote: false, powerpoint: false };

const SLIDES: TestPptxSlide[] = [
  { color: '1E3A8A', text: 'Placeholder slide one', notes: 'Placeholder note for slide one' },
  { color: '7F1D1D', text: 'Placeholder slide two fades in', animated: true },
  {
    color: '14532D',
    text: 'Placeholder slide three is hidden',
    hidden: true,
    notes: 'Placeholder hidden note',
  },
  { color: '581C87', text: 'Placeholder slide four', notes: 'Placeholder note for slide four' },
];

/** Each step the converter takes, in the test's output. */
const log = (line: string) => {
  console.log(line);
};

/** Short limits, so a stuck app fails the case in about a minute. */
const QUICK: ConvertLimits = { ...CONVERT_LIMITS, startMs: 60_000, silentMs: 15_000 };

const osa = (lines: string[], args: string[] = []) =>
  execFileSync('osascript', [...lines.flatMap((l) => ['-e', l]), ...args], {
    encoding: 'utf8',
    timeout: 120_000,
  }).trim();

const pidsOf = (name: string) => {
  try {
    return execFileSync('pgrep', ['-x', name], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map(Number);
  } catch {
    return [];
  }
};
const running = (name: string) => pidsOf(name).length > 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(test: () => boolean, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (test()) return true;
  return test();
}

/** Start an app hidden, never reopening the documents of its last session, and wait until it answers. */
async function startHidden(id: string): Promise<void> {
  execFileSync('open', ['-g', '-j', '-b', id, '--args', '-ApplePersistenceIgnoreState', 'YES']);
  const ok = await until(() => {
    try {
      osa([`with timeout of 5 seconds`, `tell application id "${id}" to get version`, 'end timeout']);
      return true;
    } catch {
      return false;
    }
  }, 60_000);
  if (!ok) throw new Error(`${id} did not start`);
}

/** The PDF's pages, as width/height. */
async function pageShapes(pdf: string): Promise<number[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdf)) });
  const doc = await task.promise;
  const shapes: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = (await doc.getPage(i)).view;
    shapes.push(Math.round(((x1 - x0) / (y1 - y0)) * 100) / 100);
  }
  await task.destroy();
  return shapes;
}

describe.skipIf(!wanted || !(has.keynote || has.powerpoint))('Keynote and PowerPoint, for real', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-converters-'));
  const work = () => mkdtempSync(join(dir, 'work-'));
  const pptx16 = join(dir, 'Placeholder deck.pptx');
  const pptx43 = join(dir, 'Placeholder 4x3.pptx');
  const key = join(dir, 'Placeholder deck.key');

  beforeAll(async () => {
    if (running('Keynote') || running('Microsoft PowerPoint'))
      throw new Error('Quit Keynote and PowerPoint first: this test starts and quits them.');
    writeFileSync(pptx16, makeTestPptx(SLIDES, '16:9'));
    writeFileSync(pptx43, makeTestPptx(SLIDES, '4:3'));
    if (has.keynote) {
      // A Keynote file, made by Keynote from the 4:3 deck (its fade becomes a build).
      await startHidden('com.apple.iWork.Keynote');
      // Opened as a double-click opens it: Keynote's sandbox may not read a file AppleScript names.
      execFileSync('open', ['-g', '-j', '-b', 'com.apple.iWork.Keynote', pptx43]);
      osa(
        [
          'on run argv',
          'tell application id "com.apple.iWork.Keynote"',
          'repeat 300 times',
          'if (count of documents) > 0 then exit repeat',
          'delay 0.1',
          'end repeat',
          'set d to document 1',
          'save d in (POSIX file (item 2 of argv))',
          'close d saving no',
          'quit',
          'end tell',
          'end run',
        ],
        [pptx43, key],
      );
      await until(() => !running('Keynote'), 15_000);
    }
  }, 240_000);

  /** Every case starts with both apps closed: any copy running now is one this test started. */
  async function closeBoth() {
    for (const app of ['Keynote', 'Microsoft PowerPoint'])
      if (running(app)) {
        execFileSync('pkill', ['-x', app]);
        if (!(await until(() => !running(app), 10_000))) execFileSync('pkill', ['-9', '-x', app]);
      }
  }
  beforeEach(closeBoth, 30_000);
  afterAll(closeBoth, 30_000);

  it.skipIf(!has.powerpoint)(
    'PowerPoint saves a .pptx as PDF, its hidden slide left out, and quits',
    async () => {
      const t = performance.now();
      const r = await convertToPdf('powerpoint', pptx16, work(), { limits: QUICK, log, slideCount: 4 });
      console.log(`PowerPoint, Drashti starting it: ${((performance.now() - t) / 1000).toFixed(1)} s`);
      expect(r.ok ? '' : r.message).toBe('');
      if (!r.ok) return;
      expect(await pageShapes(r.pdf)).toEqual([1.78, 1.78, 1.78]);
      expect(await until(() => !running('Microsoft PowerPoint'), 10_000)).toBe(true);
    },
    180_000,
  );

  it.skipIf(!has.keynote)(
    'Keynote saves a .key as PDF and tells its builds, hidden slide and notes',
    async () => {
      const t = performance.now();
      const r = await convertToPdf('keynote', key, work(), { limits: QUICK, log });
      console.log(`Keynote, Drashti starting it: ${((performance.now() - t) / 1000).toFixed(1)} s`);
      expect(r.ok ? '' : r.message).toBe('');
      if (!r.ok) return;
      expect(await pageShapes(r.pdf)).toEqual([1.33, 1.33, 1.33]);
      expect(r.shownOnly).toBe(false);
      expect(r.slides?.map((s) => [s.hidden, s.animated, s.notes])).toEqual([
        [false, false, 'Placeholder note for slide one'],
        [false, true, ''],
        [true, false, 'Placeholder hidden note'],
        [false, false, 'Placeholder note for slide four'],
      ]);
      expect(await until(() => !running('Keynote'), 10_000)).toBe(true);
    },
    180_000,
  );

  // The operator's own document stands in as a placeholder file of the test's, opened and changed
  // without saving: a new untitled document would be autosaved into iCloud Drive.
  it.skipIf(!has.keynote)(
    'Keynote already open with an unsaved change is left as it was',
    async () => {
      const operators = join(dir, 'Placeholder operator deck.key');
      copyFileSync(key, operators);
      await startHidden('com.apple.iWork.Keynote');
      execFileSync('open', ['-g', '-j', '-b', 'com.apple.iWork.Keynote', operators]);
      expect(
        await until(
          () => osa(['tell application id "com.apple.iWork.Keynote" to count documents']) === '1',
          30_000,
        ),
      ).toBe(true);
      osa([
        'tell application id "com.apple.iWork.Keynote"',
        'set presenter notes of slide 1 of document 1 to "Placeholder unsaved words"',
        'end tell',
      ]);
      const state = () =>
        osa([
          'tell application id "com.apple.iWork.Keynote"',
          'return ((count of documents) as text) & " " & (name of document 1) & " " & (presenter notes of slide 1 of document 1)',
          'end tell',
        ]);
      const was = state();
      expect(was).toBe('1 Placeholder operator deck.key Placeholder unsaved words');
      const r = await convertToPdf('keynote', key, work(), { limits: QUICK, log });
      expect(r.ok ? '' : r.message).toBe('');
      expect(running('Keynote')).toBe(true);
      expect(state()).toBe(was);
    },
    180_000,
  );

  it.skipIf(!has.powerpoint)(
    'PowerPoint already open with an unsaved change is left as it was',
    async () => {
      const operators = join(dir, 'Placeholder operator deck.pptx');
      copyFileSync(pptx16, operators);
      await startHidden('com.microsoft.Powerpoint');
      execFileSync('open', ['-g', '-j', '-b', 'com.microsoft.Powerpoint', operators]);
      const ppt = (line: string) => osa([`tell application id "com.microsoft.Powerpoint" to ${line}`]);
      expect(await until(() => ppt('count presentations') === '1', 30_000)).toBe(true);
      ppt(
        'set content of text range of text frame of shape 1 of slide 1 of presentation 1 to "Placeholder unsaved words"',
      );
      const state = () =>
        `${ppt('count presentations')} ${ppt('name of presentation 1')} ${ppt('content of text range of text frame of shape 1 of slide 1 of presentation 1')}`;
      const was = state();
      expect(was).toBe('1 Placeholder operator deck.pptx Placeholder unsaved words');
      const r = await convertToPdf('powerpoint', pptx43, work(), { limits: QUICK, log, slideCount: 4 });
      expect(r.ok ? '' : r.message).toBe('');
      if (r.ok) expect(await pageShapes(r.pdf)).toEqual([1.33, 1.33, 1.33]);
      expect(running('Microsoft PowerPoint')).toBe(true);
      expect(state()).toBe(was);
    },
    180_000,
  );

  it.skipIf(!has.keynote)(
    'Keynote slow to start is waited for',
    async () => {
      // Hold Keynote still for 20 s as soon as it starts, as a slow first start would (under the
      // 45 s Drashti waits for an app that has stopped answering).
      const r = convertToPdf('keynote', key, work(), { limits: { ...QUICK, silentMs: 45_000 }, log });
      expect(await until(() => running('Keynote'), 30_000)).toBe(true);
      const [pid] = pidsOf('Keynote');
      process.kill(pid ?? 0, 'SIGSTOP');
      log('test: Keynote held still');
      try {
        await sleep(20_000);
      } finally {
        process.kill(pid ?? 0, 'SIGCONT');
        log('test: Keynote let go');
      }
      const done = await r;
      expect(done.ok ? '' : done.message).toBe('');
      expect(await until(() => !running('Keynote'), 10_000)).toBe(true);
    },
    180_000,
  );

  it.skipIf(!has.keynote)(
    'a damaged Keynote file ends in under a minute, and the Keynote Drashti started is stopped',
    async () => {
      // A Keynote zip whose document is noise: Keynote asks about it in a window nobody sees.
      const damaged = join(dir, 'Placeholder damaged.key');
      writeFileSync(damaged, makeZip([{ name: 'Index/Document.iwa', data: Buffer.alloc(2000, 7) }]));
      const t = performance.now();
      const r = await convertToPdf('keynote', damaged, work(), { limits: QUICK, log });
      const seconds = (performance.now() - t) / 1000;
      console.log(`damaged .key: ${seconds.toFixed(1)} s: ${r.ok ? 'ok?' : r.message}`);
      expect(r.ok).toBe(false);
      expect(seconds).toBeLessThan(60);
      expect(await until(() => !running('Keynote'), 10_000)).toBe(true);
    },
    180_000,
  );

  it.skipIf(!has.keynote)(
    'Keynote coming to the front with a message ends it at once, and the Keynote Drashti started is closed',
    async () => {
      // As Keynote did with its "is damaged" message while the operator worked in Drashti: here the
      // test brings it to the front 5 s in.
      const damaged = join(dir, 'Placeholder damaged 2.key');
      writeFileSync(damaged, makeZip([{ name: 'Index/Document.iwa', data: Buffer.alloc(2000, 9) }]));
      const t = performance.now();
      const r = convertToPdf('keynote', damaged, work(), { limits: QUICK, log });
      await sleep(5000);
      execFileSync('open', ['-b', 'com.apple.iWork.Keynote']);
      const done = await r;
      const seconds = (performance.now() - t) / 1000;
      expect(done.ok ? '' : done.message).toContain(
        'Keynote could not open the file and showed a message about it',
      );
      expect(seconds).toBeLessThan(10);
      expect(await until(() => !running('Keynote'), 10_000)).toBe(true);
    },
    180_000,
  );

  it.skipIf(!has.keynote)(
    'cancelling stops the work and the Keynote Drashti started',
    async () => {
      const stop = new AbortController();
      const r = convertToPdf('keynote', key, work(), { limits: QUICK, log, signal: stop.signal });
      await until(() => running('Keynote'), 30_000);
      await sleep(1500);
      const t = performance.now();
      stop.abort();
      const done = await r;
      expect(done).toMatchObject({ ok: false, cancelled: true });
      expect(await until(() => !running('Keynote'), 15_000)).toBe(true);
      console.log(`cancel to Keynote gone: ${((performance.now() - t) / 1000).toFixed(1)} s`);
    },
    180_000,
  );

  it.skipIf(!has.keynote)(
    'a .pptx through Keynote (no PowerPoint) keeps the file’s own slides readable',
    async () => {
      const r = await convertToPdf('keynote', pptx16, work(), { limits: QUICK, log });
      expect(r.ok ? '' : r.message).toBe('');
      if (r.ok) expect(await pageShapes(r.pdf)).toEqual([1.78, 1.78, 1.78]);
      expect((await readPptx(pptx16)).filter((s) => s.animated)).toHaveLength(1);
    },
    180_000,
  );
});
