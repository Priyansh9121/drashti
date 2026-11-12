import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { deckOnWindows } from '../deck-converters';
import type * as DeckConverters from '../deck-converters';
import { makeTestPptx } from '../testing/make-pptx';
import { runDeck } from './deck-flow';
import type * as Bake from './bake';

const legacy = vi.hoisted(() => ({ movieStartsBeforePictures: false }));
vi.mock('./bake', async (original) => {
  const actual = await original<typeof Bake>();
  return {
    ...actual,
    bakeDeck: (baker, request, options) => {
      const ready = options.pdfReady;
      if (!legacy.movieStartsBeforePictures || !ready) return actual.bakeDeck(baker, request, options);
      return actual.bakeDeck(baker, request, {
        ...options,
        pdfReady: (pdf, deck) => {
          void ready(pdf, deck);
        },
      });
    },
  } satisfies typeof actual;
});

vi.mock('../deck-converters', async (original) => ({
  ...(await original<typeof DeckConverters>()),
  deckOnWindows: vi.fn<typeof deckOnWindows>(),
}));
vi.mock('./timed-copy', () => ({ writeTimedCopy: () => Promise.resolve() }));

it.each([
  {
    name: 'previous Windows scheduling',
    baseline: true,
    expected: { firstPicturesMs: 640, movieStartMs: 40, movieDoneMs: 540 },
  },
  {
    name: 'Windows pictures visible before the movie',
    baseline: false,
    expected: { firstPicturesMs: 140, movieStartMs: 140, movieDoneMs: 640 },
  },
])('$name', async ({ name, baseline, expected }) => {
  legacy.movieStartsBeforePictures = baseline;
  const work = await mkdtemp(join(tmpdir(), 'drashti-windows-preview-'));
  const file = join(work, 'Placeholder deck.ppt');
  let wakeDrawing: () => void = () => undefined;
  const drawing = new Promise<void>((resolve) => {
    wakeDrawing = resolve;
  });
  let finishDrawing: () => void = () => undefined;
  const raster = new Promise<void>((resolve) => {
    finishDrawing = resolve;
  });
  let running: ReturnType<typeof runDeck> | undefined;
  try {
    await writeFile(
      file,
      makeTestPptx([
        { text: 'Placeholder moving', color: '204060', animated: true },
        { text: 'Placeholder still', color: '204060' },
      ]),
    );
    let elapsed = 0;
    let firstPicturesMs = -1;
    let firstPicturesWallMs = -1;
    let movieStartMs = -1;
    let movieDoneMs = -1;
    vi.mocked(deckOnWindows).mockImplementation(async (job) => {
      if (job.pptx) await copyFile(file, job.pptx);
      if (job.pdf) {
        await writeFile(job.pdf, '%PDF-1.4 Placeholder Windows export');
        elapsed += 40;
      }
      if (job.movie) {
        movieStartMs = elapsed;
        elapsed += 500;
        movieDoneMs = elapsed;
        return { ok: false, reason: 'placeholder movie unavailable', message: 'Use the saved pictures.' };
      }
      return { ok: true };
    });
    const from = performance.now();
    const early = vi.fn<NonNullable<Parameters<typeof runDeck>[1]['early']>>(() => {
      firstPicturesMs = elapsed;
      firstPicturesWallMs = Math.round(performance.now() - from);
      return Promise.resolve();
    });
    running = runDeck(
      {
        source: 'ppt',
        file,
        fileName: 'Placeholder deck',
        sourcePath: file,
        read: null,
        work,
        bakers: ['powerpoint'],
      },
      {
        ffmpeg: '',
        platform: 'win32',
        freeBytes: () => 1024 ** 4,
        onAir: () => Promise.resolve(false),
        drawPdf: async () => {
          wakeDrawing();
          await raster;
          elapsed += 100;
          return {
            ok: true,
            width: 960,
            height: 540,
            total: 2,
            failed: [],
            pages: [0, 1].map((index) => ({
              index,
              file: join(work, `Placeholder-${String(index)}.png`),
              notes: '',
            })),
          };
        },
        early,
      },
    );
    await Promise.race([drawing, running]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    finishDrawing();
    expect((await running).kind).toBe('pictures');
    const previews = early.mock.calls[0]?.[0].groups.flatMap((group) => group.slides);
    expect(previews?.map((slide) => [slide.elements[0]?.kind, slide.deck?.preparing === true])).toEqual([
      ['image', true],
      ['image', false],
    ]);
    process.stdout.write(
      `Windows PowerPoint preview unit clock (ms) ${JSON.stringify({ platform: process.platform, name, firstPicturesMs, movieStartMs, movieDoneMs, firstPicturesWallMs })}\n`,
    );
    expect({ firstPicturesMs, movieStartMs, movieDoneMs }).toEqual(expected);
  } finally {
    finishDrawing();
    await running;
    await rm(work, { force: true, recursive: true });
  }
});
