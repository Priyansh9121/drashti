import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readInfo } from '../../convert/read-info';
import { CONVERT_LIMITS, findConverters, withMacSession } from '../deck-converters';
import { readPptxDeck } from '../pictures';
import { makeDeckMedia, makeTestDeck, TRIAL_SLIDES } from '../testing/make-deck';
import { ffmpegHere } from '../../testing/ffmpeg-here';
import { bakeDeck } from './bake';
import { bakedPresentation } from './deck-import';

/*
 * A deck made into its steps by PowerPoint and Keynote, for real (Session 54, C2): C1's placeholder trial deck,
 * made here, given to this Mac's PowerPoint (its timed copy, its movie) and Keynote (its own movie at its rule),
 * then cut, every step it can see checked against its plan. It runs only where they are installed, and only when
 * asked, because it starts and quits them:
 *
 *   DRASHTI_TEST_CONVERTERS=1 node scripts/vitest-electron.mjs run src/main/import/deck/bake-apps.test.ts
 *
 * Quit Keynote and PowerPoint first (it refuses to start while either is open, so it never touches anyone's
 * documents). Never on CI (its machines have neither app).
 */

const wanted =
  process.env['DRASHTI_TEST_CONVERTERS'] === '1' && process.platform === 'darwin' && !process.env['CI'];
const has = wanted ? await findConverters() : { keynote: false, powerpoint: false };
const ffmpeg = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, 'ffmpeg');

const running = (name: string) => {
  try {
    return execFileSync('pgrep', ['-x', name], { encoding: 'utf8' }).trim() !== '';
  } catch {
    return false;
  }
};

/**
 * Keynote's own documents folders, iCloud Drive's and this Mac's: where macOS keeps a document Keynote saved by itself
 * once it was changed. Never one of Drashti's copies (Session 54, C review: Keynote's copy of a deck, its movies taken
 * out, was kept there, in iCloud).
 */
const KEYNOTE_DOCUMENTS = [
  join(homedir(), 'Library', 'Mobile Documents', 'com~apple~Keynote', 'Documents'),
  join(homedir(), 'Library', 'Containers', 'com.apple.iWork.Keynote', 'Data', 'Documents'),
];
const drashtiCopies = () =>
  KEYNOTE_DOCUMENTS.flatMap((folder) => {
    try {
      return readdirSync(folder)
        .filter((f) => f.includes('(Drashti copy'))
        .map((f) => join(folder, f));
    } catch {
      return [];
    }
  });

const IDS = { powerpoint: 'com.microsoft.Powerpoint', keynote: 'com.apple.iWork.Keynote' } as const;
type App = keyof typeof IDS;

/** Lines of AppleScript to the app, with argv; what it returned. */
function tell(app: App, lines: string[], args: string[] = []): string {
  return execFileSync(
    'osascript',
    [
      ...['on run argv', `tell application id "${IDS[app]}"`, ...lines, 'end tell', 'end run'].flatMap(
        (l) => ['-e', l],
      ),
      ...args,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  ).trim();
}

/**
 * The operator's work in progress (Session 54, C review): in PowerPoint, a new presentation with a placeholder title,
 * never saved; in Keynote, the placeholder deck `from` opened as a double-click opens it (starting Keynote), saved
 * into the test's own folder (macOS would otherwise keep it in iCloud Drive by itself once changed), then a slide
 * added. Its name.
 */
function placeholder(app: App, from: string, dir: string): string {
  if (app === 'powerpoint')
    return tell(app, [
      'set p to make new presentation',
      'set s to make new slide at end of p with properties {layout:slide layout title only}',
      'set content of text range of text frame of shape 1 of s to "Placeholder work in progress"',
      'return name of p',
    ]);
  const file = join(dir, 'Placeholder work.pptx');
  copyFileSync(from, file);
  execFileSync('open', ['-g', '-j', '-b', IDS[app], file, '--args', '-ApplePersistenceIgnoreState', 'YES']);
  return tell(
    app,
    [
      'repeat 600 times',
      'if (count of documents) > 0 then exit repeat',
      'delay 0.1',
      'end repeat',
      'set d to document 1',
      'save d in (POSIX file (item 1 of argv))',
      'tell d to make new slide',
      'return name of d',
    ],
    [join(dir, 'Placeholder work.key')],
  );
}

/** The placeholder as the app has it (open, saved or not, where), and how many documents are open. */
function placeholderState(app: App, name: string): string {
  return app === 'powerpoint'
    ? tell(
        app,
        [
          'set found to "gone"',
          'repeat with i from 1 to (count of presentations)',
          'set p to presentation i',
          'if (name of p) is (item 1 of argv) then',
          'set pth to ""',
          'try',
          'set pth to path of p',
          'end try',
          'set found to "open, saved " & ((saved of p) as text) & ", path “" & pth & "”"',
          'end if',
          'end repeat',
          'return found & ", " & ((count of presentations) as text) & " open"',
        ],
        [name],
      )
    : tell(
        app,
        [
          'set found to "gone"',
          'repeat with i from 1 to (count of documents)',
          'set d to document i',
          'if (name of d) is (item 1 of argv) then',
          'set f to file of d',
          'set pth to "none"',
          'if f is not missing value then set pth to POSIX path of f',
          'set found to "open, " & ((count of slides of d) as text) & " slides, file " & pth',
          'end if',
          'end repeat',
          'return found & ", " & ((count of documents) as text) & " open"',
        ],
        [name],
      );
}

/** Start the app as the operator would have it open (hidden here), and wait for it to answer. */
async function startApp(app: App): Promise<void> {
  execFileSync('open', ['-g', '-j', '-b', IDS[app], '--args', '-ApplePersistenceIgnoreState', 'YES']);
  for (let i = 0; i < 240; i++) {
    try {
      tell(app, ['return version']);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${app} did not start`);
}

/** Close everything open in the app unsaved, and quit it, as the test found it (not running). */
async function closeAndQuit(app: App, process: string): Promise<void> {
  const docs = app === 'powerpoint' ? 'presentations' : 'documents';
  const one = app === 'powerpoint' ? 'presentation' : 'document';
  try {
    tell(app, [
      `repeat with i from (count of ${docs}) to 1 by -1`,
      `close ${one} i saving no`,
      'end repeat',
      'quit saving no',
    ]);
  } catch {
    // Quitting answers late at times: it is waited for below.
  }
  for (let i = 0; i < 80 && running(process); i++) await new Promise((r) => setTimeout(r, 250));
}

describe.skipIf(!wanted || !ffmpegHere(ffmpeg) || !(has.keynote || has.powerpoint))(
  'a deck made into its steps by this Mac’s PowerPoint and Keynote, for real',
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-bake-'));
    const deck = join(dir, 'Placeholder trial.pptx');
    const log = (line: string) => {
      console.log(line);
      // Kept with the movies, where DRASHTI_KEEP_BAKE names a folder.
      const to = process.env['DRASHTI_KEEP_BAKE'];
      if (to) appendFileSync(join(to, 'log.txt'), `${line}\n`);
    };

    /** Drashti's copies kept in Keynote's documents before (none, as a rule): none is ever added. */
    let copiesBefore: string[] = [];
    const newCopies = () => drashtiCopies().filter((f) => !copiesBefore.includes(f));
    beforeAll(() => {
      copiesBefore = drashtiCopies();
      if (running('Keynote') || running('Microsoft PowerPoint'))
        throw new Error('Quit Keynote and PowerPoint first: this test starts and quits them.');
      writeFileSync(deck, makeTestDeck(TRIAL_SLIDES, makeDeckMedia(ffmpeg, join(dir, 'made'))));
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    /** Its movie kept for a look, where DRASHTI_KEEP_BAKE names a folder. */
    const keep = (work: string, name: string) => {
      const to = process.env['DRASHTI_KEEP_BAKE'];
      if (!to) return;
      for (const file of ['movie.mov', 'movie.m4v'])
        if (existsSync(join(work, file))) copyFileSync(join(work, file), join(to, `${name}-${file}`));
    };

    it.skipIf(!has.powerpoint)(
      'PowerPoint: its timed copy’s movie, cut with every step it can see within 0.2 s, then quit',
      async () => {
        const work = mkdtempSync(join(dir, 'powerpoint-'));
        const result = await bakeDeck(
          'powerpoint',
          { source: 'pptx', input: deck, read: await readPptxDeck(deck), work },
          { ffmpeg, log },
        );
        keep(work, 'powerpoint');
        if (!result.ok) log(`PowerPoint: ${JSON.stringify(result.why)}`);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { baked } = result;
        log(
          `PowerPoint: ${String(baked.bakeMs)} ms; movie ${String(baked.movie.width)}x${String(baked.movie.height)} at ${String(baked.movie.fps)} fps, ${String(baked.movie.durationMs)} ms; offsets ${JSON.stringify(baked.cuts.offsets)}; lost ${JSON.stringify(baked.cuts.lostSlides)}`,
        );
        expect(baked.movie.height).toBe(1080);
        expect(baked.files.map((f) => f.length)).toEqual([5, 3, 2, 1, 2]);
        const measured = baked.cuts.offsets.filter((o) => o.offsetMs !== null);
        expect(measured.length).toBeGreaterThanOrEqual(5);
        for (const o of measured) expect(Math.abs(o.offsetMs ?? 0)).toBeLessThanOrEqual(200);
        // The spin's slide holds one turn after each step.
        expect(baked.files[2]?.map((f) => f.hold?.ms)).toEqual([2000, 2000]);
        for (const f of baked.files.flat()) {
          expect(existsSync(f.clip)).toBe(true);
          expect(existsSync(f.last)).toBe(true);
          const info = await readInfo(ffmpeg, f.clip);
          expect(info.audio).toBeNull();
          expect(info.video?.height).toBe(1080);
        }
        // The pictures too, should the movie not do.
        expect(result.pdf && existsSync(result.pdf)).toBe(true);
        // Its videos and sounds as real media, from the deck.
        const parsed = await bakedPresentation('Placeholder trial.pptx', deck, baked, work, ffmpeg, dir);
        expect(parsed.groups[0]?.slides.map((s) => s.deck?.media.length)).toEqual([0, 0, 0, 1, 2]);
        expect(parsed.groups[0]?.slides[3]?.deck?.media[0]?.clip).toEqual({ startMs: 1000, endMs: 4000 });
        // Drashti started it: it is quit.
        expect(running('Microsoft PowerPoint')).toBe(false);
      },
      900_000,
    );

    it.skipIf(!has.powerpoint)(
      'PowerPoint: an old .ppt saved as a .pptx first, then made into its steps',
      async () => {
        // An old .ppt, saved by PowerPoint itself from the trial deck (through Drashti's own way with it).
        const ppt = join(dir, 'Placeholder trial.ppt');
        const made = await withMacSession('powerpoint', deck, dir, CONVERT_LIMITS, { log }, async (s) => {
          const opened = await s.open(deck);
          if (!opened.ok) return opened.failed;
          const inApp = join(dirname(opened.document.copy), 'old.ppt');
          const r = await s.tell(
            [
              'save presentation (item 1 of argv) in (POSIX file (item 2 of argv)) as save as presentation',
              'return ""',
            ],
            [opened.document.doc, inApp],
            120,
          );
          for (let i = 0; i < 40 && !existsSync(inApp); i++) await new Promise((w) => setTimeout(w, 250));
          if (r.code === 0 && existsSync(inApp)) copyFileSync(inApp, ppt);
          return { ok: true as const };
        });
        expect(made.ok).toBe(true);
        expect(existsSync(ppt)).toBe(true);
        const work = mkdtempSync(join(dir, 'powerpoint-ppt-'));
        const result = await bakeDeck(
          'powerpoint',
          { source: 'ppt', input: ppt, read: null, work },
          { ffmpeg, log },
        );
        if (!result.ok) log(`PowerPoint (.ppt): ${JSON.stringify(result.why)}`);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        log(
          `PowerPoint (.ppt): ${String(result.baked.bakeMs)} ms; offsets ${JSON.stringify(result.baked.cuts.offsets)}`,
        );
        // A .ppt cannot hold an MP4 started on a click (PowerPoint 97–2003 had no such thing): that click is gone.
        expect(result.baked.files.map((f) => f.length).slice(0, 4)).toEqual([5, 3, 2, 1]);
        for (const o of result.baked.cuts.offsets.filter((x) => x.offsetMs !== null))
          expect(Math.abs(o.offsetMs ?? 0)).toBeLessThanOrEqual(200);
        expect(running('Microsoft PowerPoint')).toBe(false);
      },
      900_000,
    );

    it.skipIf(!has.keynote)(
      'Keynote: its own movie at its rule, its movies and sounds out first, cut with every step it can see within 0.2 s',
      async () => {
        const work = mkdtempSync(join(dir, 'keynote-'));
        const result = await bakeDeck(
          'keynote',
          { source: 'pptx', input: deck, read: null, work },
          { ffmpeg, log },
        );
        keep(work, 'keynote');
        if (!result.ok) log(`Keynote: ${JSON.stringify(result.why)}`);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { baked } = result;
        log(
          `Keynote: ${String(baked.bakeMs)} ms; movie ${String(baked.movie.width)}x${String(baked.movie.height)}, ${String(baked.movie.durationMs)} ms; offsets ${JSON.stringify(baked.cuts.offsets)}; media ${JSON.stringify(baked.keynoteMedia)}`,
        );
        expect(baked.movie.height).toBe(1080);
        expect(baked.plan.slides).toHaveLength(5);
        const measured = baked.cuts.offsets.filter((o) => o.offsetMs !== null);
        for (const o of measured) expect(Math.abs(o.offsetMs ?? 0)).toBeLessThanOrEqual(200);
        // Keynote says each movie's volume and loop (its PowerPoint copy leaves the loop out).
        expect(baked.keynoteMedia.filter((m) => m.kind === 'video').map((m) => [m.slide, m.loop])).toEqual([
          [4, true],
          [5, false],
        ]);
        expect(running('Keynote')).toBe(false);
        expect(newCopies()).toEqual([]);
      },
      900_000,
    );

    it.skipIf(!has.keynote)(
      'Keynote: a Keynote file of its own, its steps from its own PowerPoint copy, its videos and sound out of that copy',
      async () => {
        // A Keynote file, made by Keynote from the trial deck (as the PDF test makes one).
        const key = join(dir, 'Placeholder trial.key');
        // Without Keynote's last windows (as Drashti starts it): with them, it may not open the file at all.
        execFileSync('open', [
          '-g',
          '-j',
          '-b',
          'com.apple.iWork.Keynote',
          deck,
          '--args',
          '-ApplePersistenceIgnoreState',
          'YES',
        ]);
        execFileSync(
          'osascript',
          [
            ...[
              'on run argv',
              'tell application id "com.apple.iWork.Keynote"',
              'repeat 300 times',
              'if (count of documents) > 0 then exit repeat',
              'delay 0.1',
              'end repeat',
              'set d to document 1',
              'save d in (POSIX file (item 1 of argv))',
              'close d saving no',
              'quit',
              'end tell',
              'end run',
            ].flatMap((l) => ['-e', l]),
            key,
          ],
          { timeout: 120_000 },
        );
        for (let i = 0; i < 60 && running('Keynote'); i++) await new Promise((r) => setTimeout(r, 250));
        const work = mkdtempSync(join(dir, 'keynote-key-'));
        const result = await bakeDeck(
          'keynote',
          { source: 'key', input: key, read: null, work },
          { ffmpeg, log },
        );
        keep(work, 'keynote-key');
        if (!result.ok) log(`Keynote (.key): ${JSON.stringify(result.why)}`);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { baked } = result;
        log(
          `Keynote (.key): ${String(baked.bakeMs)} ms; movie ${String(baked.movie.durationMs)} ms; offsets ${JSON.stringify(baked.cuts.offsets)}`,
        );
        expect(baked.plan.slides).toHaveLength(5);
        for (const o of baked.cuts.offsets.filter((x) => x.offsetMs !== null))
          expect(Math.abs(o.offsetMs ?? 0)).toBeLessThanOrEqual(200);
        const parsed = await bakedPresentation('Placeholder trial.key', key, baked, work, ffmpeg, dir);
        // Its videos and sound, from Keynote's own copy, with Keynote's loop and volume.
        expect(parsed.groups[0]?.slides.map((s) => s.deck?.media.map((m) => m.kind))).toEqual([
          [],
          [],
          [],
          ['video'],
          expect.arrayContaining(['video', 'audio']),
        ]);
        expect(parsed.groups[0]?.slides[3]?.deck?.media[0]).toMatchObject({ loop: true, volume: 0.8 });
        expect(running('Keynote')).toBe(false);
        expect(newCopies()).toEqual([]);
      },
      900_000,
    );

    // ---- the operator's own work in the app (Session 54, C review) ----------------------------------------------

    it.skipIf(!has.powerpoint)(
      'PowerPoint already open on an unsaved placeholder presentation: the deck is made in it, and it is left open, the placeholder open and unsaved',
      async () => {
        expect(running('Microsoft PowerPoint')).toBe(false);
        await startApp('powerpoint');
        const name = placeholder('powerpoint', deck, dir);
        try {
          expect(placeholderState('powerpoint', name)).toBe('open, saved false, path “”, 1 open');
          const work = mkdtempSync(join(dir, 'powerpoint-open-'));
          const result = await bakeDeck(
            'powerpoint',
            { source: 'pptx', input: deck, read: await readPptxDeck(deck), work },
            { ffmpeg, log },
          );
          if (!result.ok) log(`PowerPoint (already open): ${JSON.stringify(result.why)}`);
          expect(result.ok).toBe(true);
          expect(running('Microsoft PowerPoint')).toBe(true);
          // Drashti's copy closed; the placeholder as it was.
          expect(placeholderState('powerpoint', name)).toBe('open, saved false, path “”, 1 open');
        } finally {
          await closeAndQuit('powerpoint', 'Microsoft PowerPoint');
        }
        expect(running('Microsoft PowerPoint')).toBe(false);
      },
      900_000,
    );

    it.skipIf(!has.keynote)(
      'Keynote already open on an unsaved placeholder document: the deck is made in it, and it is left open, the placeholder open and unsaved',
      async () => {
        expect(running('Keynote')).toBe(false);
        // Keynote started with it, as by a double-click.
        const name = placeholder('keynote', deck, dir);
        // The trial deck's 6 slides and the one added.
        const state = /^open, 7 slides, file \/.*\/Placeholder work\.key\/?, 1 open$/u;
        try {
          expect(placeholderState('keynote', name)).toMatch(state);
          const work = mkdtempSync(join(dir, 'keynote-open-'));
          const result = await bakeDeck(
            'keynote',
            { source: 'pptx', input: deck, read: null, work },
            { ffmpeg, log },
          );
          if (!result.ok) log(`Keynote (already open): ${JSON.stringify(result.why)}`);
          expect(result.ok).toBe(true);
          expect(running('Keynote')).toBe(true);
          // Its work as it was, where it was saved: never saved anywhere else.
          expect(placeholderState('keynote', name)).toMatch(state);
          expect(newCopies()).toEqual([]);
        } finally {
          await closeAndQuit('keynote', 'Keynote');
        }
        expect(running('Keynote')).toBe(false);
      },
      900_000,
    );

    it.skipIf(!has.powerpoint)(
      'PowerPoint Drashti started, with a placeholder presentation opened in it while the movie is made: left open, the placeholder open and unsaved',
      async () => {
        expect(running('Microsoft PowerPoint')).toBe(false);
        const lines: string[] = [];
        let name = '';
        const meanwhile: { opened?: Promise<void> } = {};
        const work = mkdtempSync(join(dir, 'powerpoint-meanwhile-'));
        try {
          const result = await bakeDeck(
            'powerpoint',
            { source: 'pptx', input: deck, read: await readPptxDeck(deck), work },
            {
              ffmpeg,
              log: (line) => {
                lines.push(line);
                log(line);
              },
              // As the movie is being made, the operator opens PowerPoint from the Dock and starts something.
              progress: (what) => {
                if (what === 'PowerPoint is making the movie' && !meanwhile.opened)
                  meanwhile.opened = Promise.resolve().then(() => {
                    name = placeholder('powerpoint', deck, dir);
                  });
              },
            },
          );
          await meanwhile.opened;
          if (!result.ok) log(`PowerPoint (opened meanwhile): ${JSON.stringify(result.why)}`);
          expect(name).not.toBe('');
          expect(running('Microsoft PowerPoint')).toBe(true);
          expect(placeholderState('powerpoint', name)).toBe('open, saved false, path “”, 1 open');
          // Seen while it answered, or as it was to be quit: either way never quit.
          expect(
            lines.some((l) =>
              /something else is open in it|the operator opened something in it meanwhile/u.test(l),
            ),
          ).toBe(true);
        } finally {
          await closeAndQuit('powerpoint', 'Microsoft PowerPoint');
        }
        expect(running('Microsoft PowerPoint')).toBe(false);
      },
      900_000,
    );
  },
);
