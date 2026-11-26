import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FEATURE_PARTS,
  indexChapter,
  MANUAL_PRINT_REFUSED,
  MANUAL_PRINT_WAITS,
  manualPrintWaits,
  type ManualPrinted,
  MANUAL_CHAPTER_IDS,
  MANUAL_CHAPTERS,
  manualPictureName,
  manualStart,
  savedWhere,
  searchManual,
} from '../shared/manual';
import { emptyLayers, type MessageItem } from '../shared/engine/state';
import { type Block, imagesOf, inlineText, parseMarkdown, passagesOf } from '../shared/markdown';
import { PANEL_HELP, type PanelHelp } from '../shared/panel-help';
import { GuideFiles, guidesDir } from './guides';
import { escapeHtml, manualHtml, pdfFooter, printRequestAllowed } from './manual-print';
import { MANUAL_PDF_NAME, ManualPrinter, manualPage, readManual } from './manual-service';
import { fileProblem } from './plain-errors';

/*
 * The Drashti Manual (x37, Session 60; the owner's "A, new Manual", 19 Nov 2026), as shipped: a chapter for each part
 * of the window, each feature told the same way (what it is, when you would use it, how in short numbered steps, with
 * a picture), found by search, named by each panel's "?", and printed whole, each chapter from a new page, from a
 * page that loads nothing but the pictures it shows. Read from the real files in docs/manual/, never a fixture.
 */

const app = process.cwd();
const docs = join(app, 'docs');
const chapterText = (file: string) => readFileSync(join(docs, 'manual', file), 'utf8');
const blocksOf = (file: string) => parseMarkdown(chapterText(file));

/** A chapter's features: each level-2 heading's words, and the blocks under it up to the next. */
function features(blocks: readonly Block[]): { name: string; blocks: Block[] }[] {
  const out: { name: string; blocks: Block[] }[] = [];
  for (const b of blocks) {
    if (b.kind === 'heading' && b.level === 2) out.push({ name: inlineText(b.children), blocks: [] });
    else out.at(-1)?.blocks.push(b);
  }
  return out;
}

/** The words a paragraph starts with in bold ("What it is."), or null. */
const leadOf = (b: Block): string | null =>
  b.kind === 'paragraph' && b.children[0]?.kind === 'strong' ? inlineText(b.children[0].children) : null;

/** The pictures the picture run makes (tests/e2e/screenshots.spec.ts names each one it takes). */
const madeByThePictureRun = (() => {
  const spec = readFileSync(join(app, 'tests', 'e2e', 'screenshots.spec.ts'), 'utf8');
  return new Set([...spec.matchAll(/'([a-z0-9-]{1,80})'/gu)].map((m) => `${m[1] ?? ''}.png`));
})();

describe('the Drashti Manual’s chapters', () => {
  it('has every chapter, in its order, each file titled as its chapter, and no other file', () => {
    expect(MANUAL_CHAPTERS.map((c) => c.id)).toEqual([...MANUAL_CHAPTER_IDS]);
    for (const c of MANUAL_CHAPTERS) {
      const first = blocksOf(c.file)[0];
      expect(first?.kind === 'heading' && first.level === 1, `${c.file} starts with its title`).toBe(true);
      expect(first?.kind === 'heading' ? inlineText(first.children) : '').toBe(c.title);
      // One title each: a chapter is one level-1 heading, then its features.
      expect(blocksOf(c.file).filter((b) => b.kind === 'heading' && b.level === 1)).toHaveLength(1);
    }
    expect(readdirSync(join(docs, 'manual')).sort()).toEqual(MANUAL_CHAPTERS.map((c) => c.file).sort());
    // Simple Mode opens at its own chapter; Pro Mode at the start.
    expect(manualStart('simple')).toBe('simple');
    expect(manualStart('pro')).toBe('start');
  });

  it('covers the parts of the window the owner listed, each in a chapter of its own', () => {
    const titles = MANUAL_CHAPTERS.map((c) => c.title);
    for (const part of [
      'Library',
      'Playlists and wallpapers',
      'LIVE, Back and Next',
      'Audio and the levels',
      'Stage screen',
      'Tools',
      'Screens and screen geometry',
      'Stream',
      'Phones and network',
      'Settings and appearance',
      'Simple Mode',
      'Keys',
    ])
      expect(titles).toContain(part);
    const all = MANUAL_CHAPTERS.map((c) => chapterText(c.file)).join('\n');
    // The tools' own sections (More tools until alpha.22), and what alpha.20 brought.
    for (const words of [
      'Lower Thirds',
      'Show a Window…',
      'Add a Video Input…',
      'Picture in Picture…',
      'QR code…',
      'MIDI Controller',
      'OSC',
      'Adjust the picture…',
      'One wide picture…',
      'Send the stream’s picture',
      'Export kirtan bundle…',
      'From a Link…',
      'CC',
      'YouTube',
    ])
      expect(all, words).toContain(words);
  });

  it('tells every feature the same way: what it is, when you would use it, how in short numbered steps, and a picture', () => {
    for (const c of MANUAL_CHAPTERS) {
      const list = features(blocksOf(c.file));
      expect(list.length, `${c.file} has features`).toBeGreaterThanOrEqual(2);
      for (const f of list) {
        const where = `${c.file} › ${f.name}`;
        const leads = f.blocks.map(leadOf).filter((l): l is string => l !== null);
        expect(
          leads.filter((l) => (FEATURE_PARTS as readonly string[]).includes(l)),
          `${where}: its three parts, in order`,
        ).toEqual([...FEATURE_PARTS]);
        const how = f.blocks.findIndex((b) => leadOf(b) === 'How:');
        const steps = f.blocks[how + 1];
        expect(steps?.kind === 'list' && steps.ordered, `${where}: How: then numbered steps`).toBe(true);
        if (steps?.kind !== 'list') continue;
        expect(steps.items.length, `${where}: its steps`).toBeGreaterThanOrEqual(1);
        for (const item of steps.items) {
          const words = item.blocks
            .flatMap((b) => (b.kind === 'paragraph' ? [inlineText(b.children)] : []))
            .join(' ')
            .split(/\s+/u)
            .filter((w) => w !== '');
          // Short steps, for volunteers.
          expect(words.length, `${where}: a step of ${String(words.length)} words`).toBeLessThanOrEqual(45);
        }
        expect(imagesOf(f.blocks).length, `${where}: its picture`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('shows only pictures the guides’ folder has or the picture run makes, each named as the manual writes them', () => {
    const shipped = new Set(readdirSync(join(docs, 'screenshots')));
    const missing: string[] = [];
    for (const c of MANUAL_CHAPTERS)
      for (const src of imagesOf(blocksOf(c.file))) {
        const name = manualPictureName(src);
        expect(name, `${c.file}: ${src} is written ../screenshots/<name>.png`).not.toBeNull();
        if (name && !shipped.has(name) && !madeByThePictureRun.has(name)) missing.push(`${c.file}: ${name}`);
      }
    expect(missing).toEqual([]);
  });

  it('never names More tools, which went in alpha.22: each tool has its own section under LIVE', () => {
    const named: string[] = [];
    const files = [
      ...MANUAL_CHAPTERS.map((c) => join('manual', c.file)),
      'operator-guide.md',
      'presenter-guide.md',
      'admin-guide.md',
      'setup-day.md',
      'parallel-run.md',
      'windows-checks.md',
      'api.md',
    ];
    for (const file of files)
      readFileSync(join(docs, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/more tools/iu.test(line)) named.push(`${file}:${String(i + 1)}`);
        });
    expect(named).toEqual([]);
  });

  it('never names the old presentation program, as Drashti’s own screens never do', () => {
    for (const c of MANUAL_CHAPTERS) {
      const named = chapterText(c.file)
        .split('\n')
        .flatMap((line, i) => (/propresenter/iu.test(line) ? [`${c.file}:${String(i + 1)}`] : []));
      expect(named).toEqual([]);
    }
  });

  it('opens at each panel’s chapter from its “?”, at the feature it names', () => {
    for (const [id, help] of Object.entries(PANEL_HELP as Record<string, PanelHelp>)) {
      const chapter = MANUAL_CHAPTERS.find((c) => c.id === help.chapter);
      expect(chapter, `${id}’s chapter`).toBeDefined();
      if (!chapter) continue;
      const named = features(blocksOf(chapter.file)).filter((f) => f.name === help.feature);
      expect(named.length, `${id}: “${help.feature}” in ${chapter.file}, once`).toBe(1);
    }
  });

  it('finds Black-out under LIVE, Back and Next, a feature by its name, and nothing for words no chapter has', () => {
    const indexed = MANUAL_CHAPTERS.map((c) => indexChapter(c.id, passagesOf(blocksOf(c.file))));
    const found = searchManual(indexed, 'black');
    expect(found.some((s) => s.chapter === 'live' && s.hits.some((p) => p.text.includes('Black-out')))).toBe(
      true,
    );
    const named = searchManual(indexed, 'picture in picture');
    expect(named.some((s) => s.chapter === 'tools' && s.hits.some((p) => p.heading))).toBe(true);
    expect(searchManual(indexed, 'zzzqqq')).toEqual([]);
    expect(searchManual(indexed, '   ')).toEqual([]);
  });

  it('says where a PDF went by its name and its folder’s, on the Mac and on Windows', () => {
    expect(savedWhere('/Users/placeholder/Documents/Drashti Manual.pdf')).toBe(
      'Drashti Manual.pdf, in Documents',
    );
    expect(savedWhere('C:\\Users\\placeholder\\Desktop\\Drashti Manual.pdf')).toBe(
      'Drashti Manual.pdf, in Desktop',
    );
    expect(savedWhere('Drashti Manual.pdf')).toBe('Drashti Manual.pdf');
  });
});

describe('the manual beside the app', () => {
  const files = new GuideFiles(guidesDir({ packaged: false, resourcesPath: '/nowhere', appPath: app }));

  it('reads every chapter, with its pictures’ sizes, and serves the pictures it shows from the guides’ folder', () => {
    const read = readManual(files);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.chapters.map((c) => c.id)).toEqual([...MANUAL_CHAPTER_IDS]);
    const first = imagesOf(parseMarkdown(read.chapters[0]?.text ?? ''))
      .map(manualPictureName)
      .find((n) => n !== null && files.picture(n) !== null);
    expect(first).toBeDefined();
    expect(read.sizes[first ?? '']?.[0]).toBeGreaterThan(0);
    expect(files.picture(first ?? '')).toBe(join(docs, 'screenshots', first ?? ''));
    // Anything that is not a picture's name is refused.
    expect(files.picture('../manual/start.md')).toBeNull();
  });

  it('says what to do when a chapter is missing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'drashti-manual-test-'));
    try {
      const read = readManual(new GuideFiles(empty));
      expect(read).toEqual({
        ok: false,
        message: 'The manual is missing from Drashti’s folder: install Drashti again.',
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('the manual on paper', () => {
  it('is one page: a cover listing the chapters, then each chapter from a new page, every word escaped', () => {
    const html = manualHtml({
      chapters: [
        { title: 'One', blocks: parseMarkdown('# One\n\nPlaceholder <b>words</b> & more.\n') },
        {
          title: 'Two',
          blocks: parseMarkdown('# Two\n\n1. A step\n2. Another\n\n![A picture](../screenshots/a.png)\n'),
        },
      ],
      version: '1.0.0-alpha.20',
      picture: (src) => (src === '../screenshots/a.png' ? 'file:///placeholder/a.png' : null),
    });
    expect(html.match(/<section class="chapter">/gu)).toHaveLength(2);
    expect(html.match(/<h1>/gu)).toHaveLength(2);
    expect(html).toContain('Placeholder &lt;b&gt;words&lt;/b&gt; &amp; more.');
    expect(html).not.toContain('<b>');
    expect(html).toContain('<ol><li><p>A step</p></li><li><p>Another</p></li></ol>');
    expect(html).toContain('<img src="file:///placeholder/a.png" alt="A picture">');
    expect(html).toContain('.chapter { break-before: page; }');
    // It runs nothing, and loads nothing but its pictures.
    expect(html).not.toMatch(/<script/iu);
    expect(html).toContain("default-src 'none'; img-src file:");
    expect(html).toContain('<title>Drashti Manual</title>');
    expect(escapeHtml('"\'<>&')).toBe('&quot;&#39;&lt;&gt;&amp;');
  });

  it('prints the whole manual: every chapter, its pictures from beside the app', () => {
    const files = new GuideFiles(guidesDir({ packaged: false, resourcesPath: '/nowhere', appPath: app }));
    const page = manualPage(files, '1.0.0-alpha.20');
    expect(page).not.toBeNull();
    expect(page?.html.match(/<section class="chapter">/gu)).toHaveLength(MANUAL_CHAPTERS.length);
    for (const c of MANUAL_CHAPTERS) expect(page?.html).toContain(`<h1>${escapeHtml(c.title)}</h1>`);
    expect(page?.pictures.length).toBeGreaterThan(0);
    for (const file of page?.pictures ?? []) expect(file.startsWith(join(docs, 'screenshots'))).toBe(true);
  });

  it('lets its page load only its own file and the pictures named: nothing from the internet, no other file', () => {
    const folder = mkdtempSync(join(tmpdir(), 'drashti-manual-test-'));
    try {
      const page = join(folder, 'manual.html');
      const picture = join(folder, 'a.png');
      const other = join(folder, 'other.png');
      for (const f of [page, picture, other]) writeFileSync(f, 'x');
      // Real paths (the temporary folder may be a link elsewhere, as on a Mac).
      const allowed = new Set([page, picture].map((f) => realpathSync(f)));
      expect(printRequestAllowed(pathToFileURL(page).href, allowed)).toBe(true);
      expect(printRequestAllowed(pathToFileURL(picture).href, allowed)).toBe(true);
      expect(printRequestAllowed(pathToFileURL(other).href, allowed)).toBe(false);
      expect(printRequestAllowed(`${pathToFileURL(picture).href}?x=1`, allowed)).toBe(false);
      expect(printRequestAllowed('https://example.com/a.png', allowed)).toBe(false);
      expect(printRequestAllowed('data:image/png;base64,AAAA', allowed)).toBe(false);
      expect(printRequestAllowed('not a url', allowed)).toBe(false);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

/** What a refusal says (empty for anything else). */
const messageOf = (r: ManualPrinted): string => (!r.ok && !r.cancelled ? r.message : '');

describe('Print… and Save as PDF…', () => {
  const files = new GuideFiles(guidesDir({ packaged: false, resourcesPath: '/nowhere', appPath: app }));
  const base = {
    files,
    version: () => '1.0.0-alpha.20',
    tempDir: () => tmpdir(),
    suggestedFolder: () => join('/placeholder', 'Documents'),
    live: () => false,
  };

  it('waits while anything is up, on air or recording, as the work that waits for an idle show does (the lead’s call, 20 Nov)', () => {
    const off = { live: { state: 'off' }, recording: { state: 'off' } } as const;
    const up = { ...emptyLayers(), messages: [{} as MessageItem] };
    expect(manualPrintWaits(emptyLayers(), off as never)).toBe(false);
    expect(manualPrintWaits(up, off as never)).toBe(true);
    for (const state of ['starting', 'live', 'reconnecting', 'ending'] as const)
      expect(manualPrintWaits(emptyLayers(), { ...off, live: { state } } as never), state).toBe(true);
    expect(manualPrintWaits(emptyLayers(), { ...off, recording: { state: 'recording' } } as never)).toBe(
      true,
    );
    // Not known yet: the safe side.
    expect(manualPrintWaits(null, off as never)).toBe(true);
    expect(MANUAL_PRINT_WAITS).toBe('Print or save the manual when nothing is up, on air or recording.');
  });

  it('prints nothing while the show is live: refused in words, nothing asked and nothing made', async () => {
    let asked = 0;
    let printed = 0;
    const printer = new ManualPrinter({
      ...base,
      live: () => true,
      askWhere: () => {
        asked++;
        return Promise.resolve('/placeholder/a.pdf');
      },
      print: () => {
        printed++;
        return Promise.resolve({ ok: true, pdf: Buffer.from('%PDF-') });
      },
      write: () => undefined,
    });
    expect(messageOf(await printer.pdf())).toBe(MANUAL_PRINT_REFUSED);
    expect(messageOf(await printer.print())).toBe(MANUAL_PRINT_REFUSED);
    expect([asked, printed]).toEqual([0, 0]);
    expect(MANUAL_PRINT_REFUSED).toBe(
      'Print or save the manual when nothing is up, on air or recording: clear what is up, and end the stream and the recording first.',
    );
  });

  it('saves the PDF where the person chose, suggesting “Drashti Manual.pdf” in Documents', async () => {
    const asked: string[] = [];
    const written: { file: string; size: number }[] = [];
    const printer = new ManualPrinter({
      ...base,
      askWhere: (suggested) => {
        asked.push(suggested);
        return Promise.resolve('/placeholder/Desktop/Placeholder.pdf');
      },
      print: (p) => {
        expect(p.kind).toBe('pdf');
        expect(p.html).toContain('<title>Drashti Manual</title>');
        // Its own window title and footer (the printer is shared with a playlist's running order since alpha.22).
        expect([p.title, p.footer]).toEqual(['Drashti Manual', 'Drashti Manual']);
        return Promise.resolve({ ok: true, pdf: Buffer.from('%PDF-placeholder') });
      },
      write: (file, data) => written.push({ file, size: data.length }),
    });
    expect(await printer.pdf()).toEqual({ ok: true, file: '/placeholder/Desktop/Placeholder.pdf' });
    expect(asked).toEqual([join('/placeholder', 'Documents', MANUAL_PDF_NAME)]);
    expect(written).toEqual([{ file: '/placeholder/Desktop/Placeholder.pdf', size: 16 }]);
  });

  it('makes nothing when the person cancels the save dialog or the print dialog', async () => {
    let printed = 0;
    const printer = new ManualPrinter({
      ...base,
      askWhere: () => Promise.resolve(null),
      print: () => {
        printed++;
        return Promise.resolve({ ok: false, cancelled: true, why: 'cancelled' });
      },
    });
    expect(await printer.pdf()).toEqual({ ok: false, cancelled: true });
    expect(printed).toBe(0);
    expect(await printer.print()).toEqual({ ok: false, cancelled: true });
    expect(printed).toBe(1);
  });

  it('says what to do when printing fails, and prints one at a time', async () => {
    let finish: (() => void) | null = null;
    const printer = new ManualPrinter({
      ...base,
      askWhere: () => Promise.resolve('/placeholder/a.pdf'),
      print: (p) =>
        p.kind === 'print'
          ? new Promise((resolve) => {
              finish = () => {
                resolve({ ok: false, cancelled: false, why: 'placeholder printer problem' });
              };
            })
          : Promise.reject(new Error('placeholder')),
      write: () => undefined,
    });
    const first = printer.print();
    const second = await printer.pdf();
    expect(second).toMatchObject({ ok: false, cancelled: false });
    expect(messageOf(second)).toContain('wait until that is done');
    (finish as (() => void) | null)?.();
    const done = await first;
    expect(messageOf(done)).toBe(
      'The manual was not printed: check the printer is on and chosen, then press Print… again.',
    );
    const failed = await printer.pdf();
    expect(messageOf(failed)).toBe('The manual was not made into a PDF: press Save as PDF… again.');
  });

  it('names its own page in the PDF’s footer, escaped, with the page number Chromium fills in', () => {
    expect(pdfFooter('Drashti Manual')).toContain(
      'Drashti Manual · page <span class="pageNumber"></span> of <span class="totalPages"></span>',
    );
    expect(pdfFooter('<b>Placeholder</b> & co')).toContain('&lt;b&gt;Placeholder&lt;/b&gt; &amp; co · page');
  });

  it('says what to do when the PDF cannot be written there', async () => {
    const printer = new ManualPrinter({
      ...base,
      askWhere: () => Promise.resolve('/placeholder/a.pdf'),
      print: () => Promise.resolve({ ok: true, pdf: Buffer.from('%PDF-') }),
      write: () => {
        throw Object.assign(new Error('placeholder'), { code: 'EACCES' });
      },
    });
    const result = await printer.pdf();
    // In words, saying what to do there (plain-errors.ts), never the system's code.
    expect(messageOf(result)).toBe(fileProblem(Object.assign(new Error('x'), { code: 'EACCES' }), 'write'));
    expect(messageOf(result)).not.toContain('EACCES');
  });
});

it('the Wallpapers manual begins with What it is before its operator steps and advice', () => {
  const feature = features(blocksOf('playlists.md')).find((f) => f.name === 'Wallpapers');
  expect(feature).toBeDefined();
  const first = feature?.blocks[0];
  if (!first) throw new Error('The Wallpapers introduction is missing.');
  expect(leadOf(first)).toBe('What it is.');
  expect(chapterText('playlists.md')).not.toContain('Warning text wraps with its full words in a tooltip.');
});
