import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PicturesResult } from '../../shared/pictures';
import type { SabhaFlowSnapshot } from '../../shared/sabha-flow';
import type { FlowReading } from '../../shared/sabha-flow-reader';
import { SabhaFlowStore } from './sabha-flow-store';

/*
 * Sabha flow (alpha.23): Main's store. The PDF is Drashti's own copy in the data folder, remembered across restarts,
 * replaced or removed; one current flow; Now kept with it and reset when another PDF is chosen. The pictures window
 * is a stand-in here (it hands back pages and their text layer as the real one does; tested in pdf-pictures.test.ts
 * and, the reading itself, in sabha-flow-reader.test.ts).
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

/** What the pictures window's reader made of a small placeholder table: No. | Program | Duration, rows 1 to `rows`. */
function tableReading(rows: number, word = 'Item') {
  return {
    status: 'read' as const,
    lang: 'en' as const,
    title: 'Placeholder order',
    headers: ['No.', 'Program', 'Duration'],
    items: Array.from({ length: rows }, (_, k) => ({
      no: String(k + 1),
      cells: [`${word} ${String(k + 1)}`, '5 min'],
    })),
  };
}

interface Drawing {
  pages: number;
  /** The window's reading as it hands it over (undefined: none came). */
  reading?: unknown;
}

function setup(options: { drawing?: Drawing; fail?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'drashti-sabha-flow-'));
  const dir = join(root, 'data', 'sabha-flow');
  const changes: SabhaFlowSnapshot[] = [];
  const log: string[] = [];
  const drawn: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  let ids = 0;
  let drawing: Drawing = options.drawing ?? { pages: 1, reading: tableReading(3) };
  let fail = options.fail;
  /** While set, each drawing waits for its own release (or its stop). */
  let holding = false;
  const held: (() => void)[] = [];
  /** The next record written waits inside its writing until let go. */
  let holdWrite = false;
  let writeHeld: (() => void) | null = null;
  const make = () =>
    new SabhaFlowStore({
      dir,
      draw: async (pdf, outDir, signal): Promise<PicturesResult> => {
        drawn.push(pdf);
        signals.push(signal);
        const mine = drawing;
        if (holding)
          await new Promise<void>((resolve) => {
            held.push(resolve);
            signal?.addEventListener('abort', () => {
              resolve();
            });
          });
        else await Promise.resolve();
        if (signal?.aborted) return { ok: false, message: 'Cancelled.' };
        if (fail) return { ok: false, message: fail };
        mkdirSync(outDir, { recursive: true });
        return {
          ok: true,
          width: 1414,
          height: 2000,
          pages: Array.from({ length: mine.pages }, (_, index) => {
            const file = join(outDir, `page-${String(index + 1).padStart(4, '0')}.png`);
            writeFileSync(file, PNG);
            return { index, file, notes: '' };
          }),
          total: mine.pages,
          failed: [],
          ...(mine.reading !== undefined ? { flowReading: mine.reading as FlowReading } : {}),
        };
      },
      changed: (snapshot) => changes.push(snapshot),
      log: (m) => log.push(m),
      newId: () => `flow-${String(++ids).padStart(4, '0')}`,
      whileWriting: async () => {
        if (!holdWrite) return;
        holdWrite = false;
        await new Promise<void>((resolve) => {
          writeHeld = resolve;
        });
      },
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
    signals,
    make,
    pdf,
    setDrawing: (next: Drawing) => {
      drawing = next;
    },
    setFail: (message: string | undefined) => {
      fail = message;
    },
    hold: (on: boolean) => {
      holding = on;
    },
    /** Let every drawing still waiting go on. */
    releaseAll: () => {
      for (let go = held.shift(); go; go = held.shift()) go();
    },
    holdNextWrite: () => {
      holdWrite = true;
    },
    /** Whether a record's writing is waiting now. */
    writeWaiting: () => writeHeld !== null,
    letWriteGo: () => {
      const go = writeHeld;
      writeHeld = null;
      go?.();
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
    const s = setup({
      drawing: { pages: 1, reading: { status: 'no-text', lang: 'mixed', headers: [], items: [] } },
    });
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
    s.setDrawing({ pages: 1, reading: tableReading(4, 'Other') });
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
    const s = setup({ drawing: { pages: 2, reading: tableReading(2) } });
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

describe('Sabha flow store: Main never reads a PDF’s words (review M1)', () => {
  it('takes the reading the pictures window made, as it is', async () => {
    const reading = {
      status: 'read',
      lang: 'gu',
      subtitle: 'નમૂનો',
      headers: [],
      items: [{ no: '૧', cells: ['નમૂનો'] }],
      total: 'કુલ ૫',
    };
    const s = setup({ drawing: { pages: 1, reading } });
    const store = s.make();
    await store.load();
    expect(await store.choose(s.pdf('First.pdf'))).toEqual({
      ok: true,
      flow: { id: 'flow-0001', fileName: 'First.pdf', pageCount: 1, drawnPages: 1, ...reading },
    });
  });

  it('a drawing with no reading, or one that does not pass the check, is unreadable: its pages are shown', async () => {
    const s = setup({ drawing: { pages: 1 } });
    const store = s.make();
    await store.load();
    const unreadable = { status: 'unreadable', lang: 'mixed', headers: [], items: [] };
    expect(await store.choose(s.pdf('First.pdf'))).toMatchObject({ ok: true, flow: unreadable });
    s.setDrawing({ pages: 1, reading: { status: 'read', lang: 'en', headers: 'No.', items: [] } });
    expect(await store.choose(s.pdf('Second.pdf'))).toMatchObject({ ok: true, flow: unreadable });
    expect(await store.page('flow-0002', 0)).toEqual(new Uint8Array(PNG));
  });

  it("Main's own code never reaches the reader (it runs in the pictures window)", () => {
    const IMPORT =
      /^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/gmu;
    const seen = new Set<string>();
    const todo = [join(__dirname, '..', 'index.ts')];
    for (let file = todo.pop(); file !== undefined; file = todo.pop()) {
      if (seen.has(file)) continue;
      seen.add(file);
      for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
        const spec = m[1] ?? m[2];
        if (!spec) continue;
        const base = resolve(dirname(file), spec);
        const next = [base, `${base}.ts`, join(base, 'index.ts')].find(
          (f) => f.endsWith('.ts') && existsSync(f) && statSync(f).isFile(),
        );
        if (next) todo.push(next);
      }
    }
    expect(seen.size).toBeGreaterThan(100);
    expect([...seen].filter((f) => f.includes('sabha-flow-reader'))).toEqual([]);
  });
});

/** Let what is waiting on the disk and the timers go on, `n` turns. */
const turns = async (n: number) => {
  for (let k = 0; k < n; k++) await new Promise((r) => setImmediate(r));
};

/** Wait until the store has asked for its `n`th drawing (its copy is made over a few turns of the disk first). */
async function drawingAsked(s: { drawn: string[] }, n: number): Promise<void> {
  for (let k = 0; k < 500 && s.drawn.length < n; k++) await turns(1);
  expect(s.drawn).toHaveLength(n);
}

describe('Sabha flow store: what happens at once (review S6, S7)', () => {
  it('Now marked while the new PDF’s record is being written: the new flow is current, on disk and after a restart', async () => {
    const s = setup();
    const store = s.make();
    await store.load();
    await store.choose(s.pdf('First.pdf'));
    s.setDrawing({ pages: 1, reading: tableReading(4, 'Other') });
    s.holdNextWrite();
    const chosen = store.choose(s.pdf('Second.pdf'));
    for (let k = 0; k < 200 && !s.writeWaiting(); k++) await turns(1);
    expect(s.writeWaiting()).toBe(true);
    // Next ▸ on the old flow, its record half written.
    const now = store.setNow('flow-0001', 2);
    await turns(5);
    s.letWriteGo();
    await Promise.all([chosen, now]);
    expect(store.snapshot()).toEqual({
      flow: expect.objectContaining({ id: 'flow-0002' }) as unknown,
      state: { flowId: 'flow-0002', now: null },
    });
    const again = s.make();
    await again.load();
    expect(again.snapshot()).toEqual(store.snapshot());
    expect(readdirSync(s.dir).sort()).toEqual(['current.json', 'flow-0002']);
  });

  it('Now marked at any moment of a choice: the new flow is current, on disk and after a restart', async () => {
    for (let at = 0; at <= 12; at++) {
      const s = setup();
      const store = s.make();
      await store.load();
      await store.choose(s.pdf('First.pdf'));
      s.setDrawing({ pages: 1, reading: tableReading(4, 'Other') });
      const chosen = store.choose(s.pdf('Second.pdf'));
      await turns(at);
      const now = store.setNow('flow-0001', 2);
      await Promise.all([chosen, now]);
      expect(store.snapshot().flow?.id, `Now ${String(at)} turns in`).toBe('flow-0002');
      const again = s.make();
      await again.load();
      expect(again.snapshot(), `after a restart, Now ${String(at)} turns in`).toEqual(store.snapshot());
    }
  });

  it('Remove while a new PDF is being read or kept: no flow, nothing kept, none after a restart, whenever it comes', async () => {
    for (let at = 0; at <= 12; at++) {
      const s = setup();
      const store = s.make();
      await store.load();
      await store.choose(s.pdf('First.pdf'));
      const chosen = store.choose(s.pdf('Second.pdf'));
      await turns(at);
      await Promise.all([chosen, store.remove()]);
      expect(store.snapshot(), `Remove ${String(at)} turns in`).toEqual({ flow: null, state: null });
      expect(readdirSync(s.dir), `Remove ${String(at)} turns in`).toEqual([]);
      const again = s.make();
      await again.load();
      expect(again.snapshot()).toEqual({ flow: null, state: null });
    }
  });

  it('Remove stops a drawing under way (S7), and another PDF chosen stops the one before', async () => {
    const s = setup();
    const store = s.make();
    await store.load();
    s.hold(true);
    const first = store.choose(s.pdf('First.pdf'));
    await drawingAsked(s, 1);
    expect(s.signals[0]?.aborted).toBe(false);
    await store.remove();
    expect(s.signals[0]?.aborted).toBe(true);
    expect(await first).toMatchObject({ ok: false });
    const second = store.choose(s.pdf('Second.pdf'));
    await drawingAsked(s, 2);
    s.setDrawing({ pages: 1, reading: tableReading(4, 'Other') });
    const third = store.choose(s.pdf('Third.pdf'));
    // The second stops as soon as the third is chosen, before the third's own drawing is asked for.
    expect(s.signals[1]?.aborted).toBe(true);
    await drawingAsked(s, 3);
    s.releaseAll();
    expect(await second).toMatchObject({ ok: false });
    expect(await third).toMatchObject({ ok: true, flow: { fileName: 'Third.pdf' } });
    expect(store.snapshot().flow?.fileName).toBe('Third.pdf');
    expect(readdirSync(s.dir).sort()).toEqual(['current.json', store.snapshot().flow?.id]);
  });
});
