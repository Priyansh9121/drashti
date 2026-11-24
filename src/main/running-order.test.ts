import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { ManualPrinted } from '../shared/manual';
import type { PlaylistItemInfo } from '../shared/playlists';
import { GuideFiles, guidesDir } from './guides';
import { ManualPrinter } from './manual-service';
import type { PrintPage } from './manual-print';
import {
  RUNNING_ORDER_PRINT_REFUSED,
  RunningOrderPrinter,
  runningOrderHtml,
  runningOrderLines,
} from './running-order';

/*
 * A playlist's running order (alpha.22, from PLAN §7's "Print": seen, not added; the owner's "Yes, build them"):
 * copied as plain lines for the sabha team's group chat, and printed or saved as a PDF as the manual is (from a hidden
 * window, one page at a time across both, never while the show is live). Placeholder names only.
 */

/** A placeholder picture's row. */
const PICTURE: PlaylistItemInfo = {
  id: 'm3',
  kind: 'media',
  label: 'Placeholder picture',
  mediaId: 'md3',
  media: 'image',
  missing: false,
  unplayable: null,
  timers: [],
};

/** A placeholder playlist's rows, one of each kind, in its order. */
const ITEMS: PlaylistItemInfo[] = [
  { id: 'h1', kind: 'header', label: 'Placeholder Dhun', color: null },
  {
    id: 'p1',
    kind: 'presentation',
    label: 'Placeholder kirtan',
    presentationId: 'pr1',
    presentationName: 'Placeholder kirtan',
    order: { mode: 'presentation' },
    arrangementName: null,
    timers: [],
    slideCount: 4,
  },
  {
    id: 'm1',
    kind: 'media',
    label: 'Placeholder video',
    mediaId: 'md1',
    media: 'video',
    missing: false,
    unplayable: null,
    timers: [],
    durationMs: 190_000,
    playingMs: 185_000,
  },
  { id: 's1', kind: 'placeholder', label: 'Placeholder slot', hint: null, category: 'Kirtan' },
  {
    id: 'm2',
    kind: 'media',
    label: 'Placeholder sound',
    mediaId: 'md2',
    media: 'audio',
    missing: false,
    unplayable: null,
    timers: [],
    durationMs: null,
    playingMs: null,
  },
  { id: 'h2', kind: 'header', label: 'Placeholder Pravachan', color: '#ff0000' },
  PICTURE,
  { id: 'b1', kind: 'shastra', label: 'Placeholder passage 1.1', passageId: 'x', missing: false, timers: [] },
  { id: 'i1', kind: 'input', label: 'Input 1', name: 'Input 1', missing: false, timers: [] },
  { id: 's2', kind: 'placeholder', label: 'Placeholder lost file', hint: 'lost.pptx', category: null },
];

describe('Copy running order', () => {
  it('is plain lines: the name, headers as section lines, every other row numbered with its length, then the total', () => {
    expect(runningOrderLines({ name: 'Placeholder sabha', items: ITEMS }).split('\n')).toEqual([
      'Placeholder sabha',
      '— Placeholder Dhun —',
      '1. Placeholder kirtan',
      '2. Placeholder video, 3:05',
      '3. Slot to fill: Placeholder slot (Kirtan)',
      '4. Placeholder sound, length not known yet',
      '— Placeholder Pravachan —',
      '5. Placeholder picture',
      '6. Placeholder passage 1.1',
      '7. Input 1',
      '8. Not found at import: Placeholder lost file',
      'Videos and sounds in all: 3:05 (1 length not known yet)',
    ]);
  });

  it('numbers from 1 with no header, says a playlist is empty, and leaves the total out when nothing has a length', () => {
    expect(runningOrderLines({ name: 'Placeholder list', items: [PICTURE, PICTURE] })).toBe(
      'Placeholder list\n1. Placeholder picture\n2. Placeholder picture',
    );
    expect(runningOrderLines({ name: 'Placeholder list', items: [] })).toBe(
      'Placeholder list\nThis playlist is empty.',
    );
  });

  it('keeps each row on one line and says a Books slot as Books', () => {
    const lines = runningOrderLines({
      name: 'Placeholder\nsabha',
      items: [
        { id: 'h', kind: 'header', label: 'Placeholder\r\n  Dhun', color: null },
        { id: 's', kind: 'placeholder', label: 'Placeholder reading', hint: null, category: 'Shastra' },
      ],
    });
    expect(lines.split('\n')).toEqual([
      'Placeholder sabha',
      '— Placeholder Dhun —',
      '1. Slot to fill: Placeholder reading (Books)',
    ]);
  });
});

describe('the running order on paper', () => {
  const page = runningOrderHtml({
    name: 'Ravi Sabha <test>',
    printed: 'Placeholder day, 1 January 2030',
    items: ITEMS,
  });

  it('is one A4 page of the playlist: its name and the date, headers as section titles, numbered rows with what each is and its length, and the total', () => {
    expect(page).toContain('<title>Ravi Sabha &lt;test&gt; running order</title>');
    expect(page).toContain('<h1>Ravi Sabha &lt;test&gt;</h1>');
    expect(page).toContain('Running order · Placeholder day, 1 January 2030');
    expect(page).toContain('<h2>Placeholder Dhun</h2>');
    expect(page).toContain('<h2>Placeholder Pravachan</h2>');
    const rows = [...page.matchAll(/<tr>(.*?)<\/tr>/gu)].map((m) =>
      [...(m[1] ?? '').matchAll(/<td[^>]*>(.*?)<\/td>/gu)].map((c) => c[1]),
    );
    expect(rows).toEqual([
      ['1', 'Placeholder kirtan', 'Presentation', '4 slides'],
      ['2', 'Placeholder video', 'Video', '3:05'],
      ['3', 'Placeholder slot (Kirtan)', 'Slot to fill', ''],
      ['4', 'Placeholder sound', 'Sound', 'not known yet'],
      ['5', 'Placeholder picture', 'Picture', ''],
      ['6', 'Placeholder passage 1.1', 'Passage from a book', ''],
      ['7', 'Input 1', 'Video input', ''],
      ['8', 'Placeholder lost file', 'Not found at import', ''],
    ]);
    // Rows 1-4 under the first header, 5-8 under the second.
    expect(page.indexOf('<h2>Placeholder Dhun</h2>')).toBeLessThan(page.indexOf('<td>1</td>'));
    expect(page.indexOf('<td>4</td>')).toBeLessThan(page.indexOf('<h2>Placeholder Pravachan</h2>'));
    expect(page.indexOf('<h2>Placeholder Pravachan</h2>')).toBeLessThan(page.indexOf('<td>5</td>'));
    expect(page).toContain('Videos and sounds in all: 3:05 (1 length not known yet)');
  });

  it('holds no script and loads nothing: every word escaped, in a page that allows only its own style', () => {
    const hostile = runningOrderHtml({
      name: '<script>alert(1)</script>',
      printed: '<img src=x onerror=alert(1)>',
      items: [
        { id: 'h', kind: 'header', label: '"Placeholder" & <b>header</b>', color: null },
        { ...PICTURE, label: "<img src='file:///etc/passwd'>" },
      ],
    });
    expect(hostile).not.toMatch(/<script|<img|<b>/u);
    expect(hostile).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(hostile).toContain('<h2>&quot;Placeholder&quot; &amp; &lt;b&gt;header&lt;/b&gt;</h2>');
    expect(hostile).toContain('&lt;img src=&#39;file:///etc/passwd&#39;&gt;');
    expect(hostile).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
  });

  it('says an empty playlist is empty', () => {
    expect(runningOrderHtml({ name: 'Placeholder', printed: 'today', items: [] })).toContain(
      '<p>This playlist is empty.</p>',
    );
  });
});

describe('Print running order… and Save running order as PDF…', () => {
  const messageOf = (r: ManualPrinted) => (r.ok || r.cancelled ? null : r.message);
  const source = { name: 'Placeholder sabha: 1/2', items: ITEMS };
  const base = {
    source: (id: string) => (id === 'pl1' ? source : null),
    printed: () => 'Placeholder day',
    tempDir: () => tmpdir(),
    suggestedFolder: () => join('/placeholder', 'Documents'),
    live: () => false,
  };

  it('prints nothing while the show is live: refused in the manual’s words for a running order, nothing asked and nothing made', async () => {
    let asked = 0;
    let printed = 0;
    const printer = new RunningOrderPrinter({
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
    expect(messageOf(await printer.pdf('pl1'))).toBe(RUNNING_ORDER_PRINT_REFUSED);
    expect(messageOf(await printer.print('pl1'))).toBe(RUNNING_ORDER_PRINT_REFUSED);
    expect([asked, printed]).toEqual([0, 0]);
    expect(RUNNING_ORDER_PRINT_REFUSED).toBe(
      'Print or save the running order when nothing is up, on air or recording: clear what is up, and end the stream and the recording first.',
    );
  });

  it('saves the PDF where the person chose, suggesting “<name> running order.pdf” in Documents, from the page with its own title and footer', async () => {
    const asked: string[] = [];
    const pages: PrintPage[] = [];
    const written: { file: string; size: number }[] = [];
    const printer = new RunningOrderPrinter({
      ...base,
      askWhere: (suggested) => {
        asked.push(suggested);
        return Promise.resolve('/placeholder/Desktop/Placeholder.pdf');
      },
      print: (p) => {
        pages.push(p);
        return Promise.resolve({ ok: true, pdf: Buffer.from('%PDF-placeholder') });
      },
      write: (file, data) => written.push({ file, size: data.length }),
    });
    expect(await printer.pdf('pl1')).toEqual({ ok: true, file: '/placeholder/Desktop/Placeholder.pdf' });
    expect(asked).toEqual([join('/placeholder', 'Documents', 'Placeholder sabha_ 1_2 running order.pdf')]);
    expect(written).toEqual([{ file: '/placeholder/Desktop/Placeholder.pdf', size: 16 }]);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      kind: 'pdf',
      pictures: [],
      title: 'Placeholder sabha: 1/2 running order',
      footer: 'Placeholder sabha: 1/2 · running order',
    });
    expect(pages[0]?.html).toContain('<h2>Placeholder Dhun</h2>');
    expect(pages[0]?.html).toContain('Running order · Placeholder day');
  });

  it('prints through the system’s dialog, and makes nothing when the person cancels either dialog', async () => {
    let printed = 0;
    const printer = new RunningOrderPrinter({
      ...base,
      askWhere: () => Promise.resolve(null),
      print: (p) => {
        printed++;
        return Promise.resolve(
          p.kind === 'print' && printed === 1
            ? { ok: true, pdf: null }
            : { ok: false, cancelled: true, why: 'cancelled' },
        );
      },
    });
    expect(await printer.print('pl1')).toEqual({ ok: true, file: null });
    expect(await printer.pdf('pl1')).toEqual({ ok: false, cancelled: true });
    expect(printed).toBe(1);
    expect(await printer.print('pl1')).toEqual({ ok: false, cancelled: true });
  });

  it('says so when the playlist is gone, when printing fails, and when the PDF cannot be written', async () => {
    const failing = new RunningOrderPrinter({
      ...base,
      askWhere: () => Promise.resolve('/placeholder/a.pdf'),
      print: (p) =>
        p.kind === 'print'
          ? Promise.resolve({ ok: false, cancelled: false, why: 'placeholder printer problem' })
          : Promise.reject(new Error('placeholder')),
      write: () => undefined,
    });
    expect(messageOf(await failing.print('gone'))).toBe('That playlist no longer exists.');
    expect(messageOf(await failing.print('pl1'))).toBe(
      'The running order was not printed: check the printer is on and chosen, then choose Print running order… again.',
    );
    expect(messageOf(await failing.pdf('pl1'))).toBe(
      'The running order was not made into a PDF: choose Save running order as PDF… again.',
    );
    const unwritable = new RunningOrderPrinter({
      ...base,
      askWhere: () => Promise.resolve('/placeholder/a.pdf'),
      print: () => Promise.resolve({ ok: true, pdf: Buffer.from('%PDF-') }),
      write: () => {
        throw Object.assign(new Error('placeholder'), { code: 'EACCES' });
      },
    });
    expect(messageOf(await unwritable.pdf('pl1'))).not.toContain('EACCES');
  });

  it('prints one page at a time across the manual and every running order: the second is refused in words, naming the first', async () => {
    let finish: (() => void) | null = null;
    const waiting = () =>
      new Promise<{ ok: true; pdf: null }>((resolve) => {
        finish = () => {
          resolve({ ok: true, pdf: null });
        };
      });
    const files = new GuideFiles(
      guidesDir({ packaged: false, resourcesPath: '/nowhere', appPath: process.cwd() }),
    );
    const manual = new ManualPrinter({
      files,
      version: () => '1.0.0-alpha.22',
      tempDir: () => tmpdir(),
      suggestedFolder: () => '/placeholder',
      live: () => false,
      askWhere: () => Promise.resolve('/placeholder/m.pdf'),
      print: waiting,
      write: () => undefined,
    });
    const order = new RunningOrderPrinter({
      ...base,
      askWhere: () => Promise.resolve('/placeholder/r.pdf'),
      print: waiting,
      write: () => undefined,
    });
    const first = manual.print();
    expect(messageOf(await order.print('pl1'))).toBe(
      'The manual is being printed already: wait until that is done, then try again.',
    );
    expect(messageOf(await order.pdf('pl1'))).toContain('The manual is being printed already');
    (finish as (() => void) | null)?.();
    expect(await first).toEqual({ ok: true, file: null });
    // Free again: a running order now, and the manual waits for it.
    const second = order.print('pl1');
    expect(messageOf(await manual.pdf())).toBe(
      'A running order is being printed already: wait until that is done, then try again.',
    );
    expect(messageOf(await order.print('pl1'))).toBe(
      'A running order is being printed already: wait until that is done, then try again.',
    );
    (finish as (() => void) | null)?.();
    expect(await second).toEqual({ ok: true, file: null });
    // And free once more, for the manual.
    const third = manual.print();
    (finish as (() => void) | null)?.();
    expect(await third).toEqual({ ok: true, file: null });
  });
});
