import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PicturesResult } from '../../shared/pictures';
import type { SabhaFlowSnapshot } from '../../shared/sabha-flow';
import type { FlowText, FlowTextPage } from '../../shared/sabha-flow-text';
import { SabhaFlowStore } from './sabha-flow-store';

/*
 * Sabha flow (alpha.23): Main's store. The PDF is Drashti's own copy in the data folder, remembered across restarts,
 * replaced or removed; one current flow; Now kept with it and reset when another PDF is chosen. The pictures window
 * is a stand-in here (it hands back pages and their text layer as the real one does; tested in pdf-pictures.test.ts
 * and, the reading itself, in sabha-flow-reader.test.ts).
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

const t = (s: string, x: number, y: number): FlowText => ({ s, x, y, w: s.length * 5, h: 10 });

/** A small placeholder table's text layer: No. | Program | Duration, rows 1 to `rows`. */
function tablePage(rows: number, word = 'Item'): FlowTextPage {
  const texts = [
    t('Placeholder order', 40, 60),
    t('No.', 40, 100),
    t('Program', 90, 100),
    t('Duration', 260, 100),
  ];
  for (let r = 1; r <= rows; r++)
    texts.push(
      t(String(r), 40, 100 + 20 * r),
      t(`${word} ${String(r)}`, 90, 100 + 20 * r),
      t('5 min', 260, 100 + 20 * r),
    );
  return { width: 595, height: 842, texts, rules: [] };
}

function setup(options: { pages?: FlowTextPage[]; fail?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'drashti-sabha-flow-'));
  const dir = join(root, 'data', 'sabha-flow');
  const changes: SabhaFlowSnapshot[] = [];
  const log: string[] = [];
  const drawn: string[] = [];
  let ids = 0;
  let pages = options.pages ?? [tablePage(3)];
  let fail = options.fail;
  const make = () =>
    new SabhaFlowStore({
      dir,
      draw: async (pdf, outDir): Promise<PicturesResult> => {
        drawn.push(pdf);
        await Promise.resolve();
        if (fail) return { ok: false, message: fail };
        mkdirSync(outDir, { recursive: true });
        return {
          ok: true,
          width: 1414,
          height: 2000,
          pages: pages.map((flowPage, index) => {
            const file = join(outDir, `page-${String(index + 1).padStart(4, '0')}.png`);
            writeFileSync(file, PNG);
            return { index, file, notes: '', flowPage };
          }),
          total: pages.length,
          failed: [],
        };
      },
      changed: (snapshot) => changes.push(snapshot),
      log: (m) => log.push(m),
      newId: () => `flow-${String(++ids).padStart(4, '0')}`,
    });
  const pdf = (name: string, bytes: string | Buffer = '%PDF-1.7 placeholder') => {
    const file = join(root, name);
    writeFileSync(file, bytes);
    return file;
  };
  return {
    root,
    dir,
    changes,
    log,
    drawn,
    make,
    pdf,
    setPages: (next: FlowTextPage[]) => {
      pages = next;
    },
    setFail: (message: string | undefined) => {
      fail = message;
    },
  };
}

describe('Sabha flow store: choosing a PDF', () => {
  it('keeps its own copy in the data folder, draws and reads it, and makes it the current flow with no Now', async () => {
    const s = setup();
    const store = s.make();
    await store.load();
    expect(store.snapshot()).toEqual({ flow: null, state: null });
    const chosen = await store.choose(s.pdf('Placeholder order.pdf'));
    const flow = {
      id: 'flow-0001',
      fileName: 'Placeholder order.pdf',
      pageCount: 1,
      drawnPages: 1,
      status: 'read',
      lang: 'en',
      title: 'Placeholder order',
      headers: ['No.', 'Program', 'Duration'],
      items: [
        { no: '1', cells: ['Item 1', '5 min'] },
        { no: '2', cells: ['Item 2', '5 min'] },
        { no: '3', cells: ['Item 3', '5 min'] },
      ],
    };
    expect(chosen).toEqual({ ok: true, flow });
    expect(store.snapshot()).toEqual({ flow, state: { flowId: 'flow-0001', now: null } });
    expect(s.changes).toEqual([{ flow, state: { flowId: 'flow-0001', now: null } }]);
    // Drawn from Drashti's own copy, which is the operator's file byte for byte.
    const copy = join(s.dir, 'flow-0001', 'source.pdf');
    expect(s.drawn).toEqual([copy]);
    expect(readFileSync(copy, 'utf8')).toBe('%PDF-1.7 placeholder');
    // The log names no file and no words.
    expect(s.log.join('\n')).not.toMatch(/Placeholder|Item/u);
  });

  it('refuses what is not a PDF, is too big, or is not there, and keeps the current flow', async () => {
    const s = setup();
    const store = s.make();
    await store.load();
    await store.choose(s.pdf('First.pdf'));
    const before = store.snapshot();
    expect(await store.choose(s.pdf('Notes.pdf', 'plain words, not a PDF'))).toEqual({
      ok: false,
      message: 'That file is not a PDF: choose the running order saved as a PDF.',
    });
    expect(await store.choose(join(s.root, 'Gone.pdf'))).toEqual({
      ok: false,
      message: 'The PDF could not be read: it may have been moved or deleted. Choose it again.',
    });
    expect(
      await store.choose(
        s.pdf('Huge.pdf', Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(51 * 1024 * 1024)])),
      ),
    ).toEqual({
      ok: false,
      message: 'That PDF is too big for a Sabha flow (over 50 MB): save it again with smaller pictures.',
    });
    expect(await store.choose(42)).toEqual({
      ok: false,
      message: 'That file is not a PDF: choose the running order saved as a PDF.',
    });
    expect(store.snapshot()).toEqual(before);
    expect(s.changes).toHaveLength(1);
  });

  it('says why when its pages could not be drawn, keeping nothing of it and the current flow as it was', async () => {
    const s = setup();
    const store = s.make();
    await store.load();
    await store.choose(s.pdf('First.pdf'));
    s.setFail('The PDF is protected with a password: save a copy without one and import that.');
    expect(await store.choose(s.pdf('Locked.pdf'))).toEqual({
      ok: false,
      message: 'The PDF is protected with a password: save a copy without one and import that.',
    });
    expect(store.snapshot().flow?.id).toBe('flow-0001');
    expect(readdirSync(s.dir).sort()).toEqual(['current.json', 'flow-0001']);
  });

  it('keeps a PDF it cannot read the words of as the current flow, its pages to be shown', async () => {
    const s = setup({ pages: [{ width: 595, height: 842, texts: [], rules: [] }] });
    const store = s.make();
    await store.load();
    const chosen = await store.choose(s.pdf('Scan.pdf'));
    expect(chosen).toMatchObject({
      ok: true,
      flow: { status: 'no-text', items: [], headers: [], pageCount: 1 },
    });
    expect(await store.page('flow-0001', 0)).toEqual(new Uint8Array(PNG));
  });
});

describe('Sabha flow store: Now, Replace, Remove and restarts', () => {
  it('marks Now by an index into the items, or clears it; refuses a flow that is no longer current, or no such item', async () => {
    const s = setup();
    const store = s.make();
    await store.load();
    await store.choose(s.pdf('First.pdf'));
    expect(await store.setNow('flow-0001', 1)).toEqual({ ok: true, state: { flowId: 'flow-0001', now: 1 } });
    expect(s.changes.at(-1)?.state).toEqual({ flowId: 'flow-0001', now: 1 });
    for (const now of [3, -1, 1.5, '1', undefined])
      expect(await store.setNow('flow-0001', now)).toEqual({
        ok: false,
        message: 'There is no such item in the Sabha flow.',
      });
    expect(await store.setNow('flow-0009', 0)).toEqual({
      ok: false,
      message: 'The Sabha flow has been replaced since: Now was not moved.',
    });
    expect(await store.setNow(7, 0)).toEqual({
      ok: false,
      message: 'The Sabha flow has been replaced since: Now was not moved.',
    });
    expect(store.snapshot().state).toEqual({ flowId: 'flow-0001', now: 1 });
    expect(await store.setNow('flow-0001', null)).toEqual({
      ok: true,
      state: { flowId: 'flow-0001', now: null },
    });
  });

  it('remembers the flow and Now across a restart', async () => {
    const s = setup();
    const first = s.make();
    await first.load();
    await first.choose(s.pdf('First.pdf'));
    await first.setNow('flow-0001', 2);
    const again = s.make();
    await again.load();
    expect(again.snapshot()).toEqual(first.snapshot());
    expect(again.snapshot().state).toEqual({ flowId: 'flow-0001', now: 2 });
    expect(await again.page('flow-0001', 0)).toEqual(new Uint8Array(PNG));
  });

  it('Replace: another PDF is a new flow (a new id), Now back to none, the old copy and pages gone', async () => {
    const s = setup();
    const store = s.make();
    await store.load();
    await store.choose(s.pdf('First.pdf'));
    await store.setNow('flow-0001', 2);
    s.setPages([tablePage(4, 'Other')]);
    const chosen = await store.choose(s.pdf('Second.pdf'));
    expect(chosen).toMatchObject({ ok: true, flow: { id: 'flow-0002', fileName: 'Second.pdf' } });
    expect(store.snapshot().state).toEqual({ flowId: 'flow-0002', now: null });
    expect(store.snapshot().flow?.items).toHaveLength(4);
    expect(readdirSync(s.dir).sort()).toEqual(['current.json', 'flow-0002']);
    expect(await store.page('flow-0001', 0)).toBeNull();
    // Now for the old flow is refused (a phone or a window that had not seen the change yet).
    expect(await store.setNow('flow-0001', 0)).toMatchObject({ ok: false });
  });

  it('Remove: no flow, nothing kept, and none after a restart', async () => {
    const s = setup();
    const store = s.make();
    await store.load();
    await store.choose(s.pdf('First.pdf'));
    expect(await store.remove()).toBeNull();
    expect(store.snapshot()).toEqual({ flow: null, state: null });
    expect(s.changes.at(-1)).toEqual({ flow: null, state: null });
    expect(existsSync(s.dir) ? readdirSync(s.dir) : []).toEqual([]);
    const again = s.make();
    await again.load();
    expect(again.snapshot()).toEqual({ flow: null, state: null });
  });

  it('starts with no flow from a damaged or missing record, and clears what a stopped choice left', async () => {
    const s = setup();
    const store = s.make();
    await store.load();
    await store.choose(s.pdf('First.pdf'));
    mkdirSync(join(s.dir, 'flow-left-behind'));
    writeFileSync(join(s.dir, 'current.json'), '{"version":1,"flow":');
    const again = s.make();
    await again.load();
    expect(again.snapshot()).toEqual({ flow: null, state: null });
    expect(readdirSync(s.dir)).toEqual([]);
  });
});

describe('Sabha flow store: its pages', () => {
  it('gives a page of the current flow as its PNG, and nothing for another flow or no such page', async () => {
    const s = setup({ pages: [tablePage(2), tablePage(2)] });
    const store = s.make();
    await store.load();
    await store.choose(s.pdf('Two pages.pdf'));
    expect(store.snapshot().flow).toMatchObject({ pageCount: 2, drawnPages: 2 });
    expect(await store.page('flow-0001', 1)).toEqual(new Uint8Array(PNG));
    expect(store.pageFile('flow-0001', 1)).toBe(join(s.dir, 'flow-0001', 'page-0002.png'));
    for (const [id, page] of [
      ['flow-0001', 2],
      ['flow-0001', -1],
      ['flow-0001', 0.5],
      ['flow-0001', '0'],
      ['flow-0002', 0],
      ['../flow-0001', 0],
      [undefined, 0],
    ] as const) {
      expect(await store.page(id, page)).toBeNull();
      expect(store.pageFile(id, page)).toBeNull();
    }
  });
});
