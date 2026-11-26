import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { KEYMAP, keyText } from '../shared/keymap';
import { type Block, type Inline, inlineText, parseMarkdown } from '../shared/markdown';
import { KEY_WINDOWS, type KeyWindow, keysOn, WINDOW_KEYS } from '../shared/window-keys';
import { ownWindowKey } from './access/access-list-window';

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), app: { isPackaged: false } }));

/*
 * The manual's Keys chapter names every key of every Drashti window as each computer writes it (alpha.24, the owner's
 * "in drashti manual, log all shortcuts for all apps, if its mac intel, the relevant shortcuts, if its mac silicon, the
 * relevant shortcuts, if its windows, relevant shortcuts"): a `###` section for each window (KEY_WINDOWS), its keys in
 * a table with a column for Windows, a Mac with Apple silicon and a Mac with Intel, or in one column when every
 * computer writes them the same. Read from the real docs/manual/keys.md with Drashti's own Markdown reader, and
 * checked both ways against KEYMAP (the operator window's show keys) and WINDOW_KEYS (every other window's), written by
 * `keyText`, so the manual can never drift from the keys: a key added, changed or taken away fails here until the
 * manual says it.
 */

const keysMd = readFileSync(join(__dirname, '..', '..', 'docs', 'manual', 'keys.md'), 'utf8');

const PLATFORMS = ['win32', 'darwin'] as const;
type Platform = (typeof PLATFORMS)[number];
const THREE = ['What it does', 'Windows', 'Mac with Apple silicon', 'Mac with Intel'];
const ONE = ['What it does', 'Every computer'];

/** A row of a key table: what it does, and the keys each computer's column names. */
interface KeyRow {
  section: string;
  what: string;
  line: number;
  same: boolean;
  /** The keys in Windows' column, and in each Mac's (Apple silicon, Intel). */
  win: readonly string[];
  silicon: readonly string[];
  intel: readonly string[];
  cells: readonly string[];
}

/**
 * The keys a cell names: each bold span's words, a range "**F1** to **F3**" or "**⌥1** to **⌥8**" taken as every key
 * between (the same words before a number that counts up).
 */
function keysIn(cell: readonly Inline[]): string[] {
  const out: string[] = [];
  cell.forEach((n, i) => {
    if (n.kind !== 'strong') return;
    const words = inlineText(n.children);
    const prev = cell[i - 2];
    const between = cell[i - 1];
    const from = prev?.kind === 'strong' ? /^(.*?)(\d+)$/u.exec(inlineText(prev.children)) : null;
    const to = /^(.*?)(\d+)$/u.exec(words);
    if (between?.kind === 'text' && between.text === ' to ' && from && to && from[1] === to[1]) {
      for (let k = Number(from[2]) + 1; k < Number(to[2]); k++) out.push(`${to[1] ?? ''}${String(k)}`);
    }
    out.push(words);
  });
  return out;
}

/** Every key table under a `###` heading of the chapter, row by row; and the headings, in order. */
function keyTables(blocks: readonly Block[]): { sections: string[]; rows: KeyRow[]; odd: string[] } {
  const sections: string[] = [];
  const rows: KeyRow[] = [];
  const odd: string[] = [];
  let section: string | null = null;
  for (const b of blocks) {
    if (b.kind === 'heading') {
      section = b.level === 3 ? inlineText(b.children) : null;
      if (section !== null) sections.push(section);
      continue;
    }
    if (b.kind !== 'table' || section === null) continue;
    const head = b.head.map(inlineText);
    const same = head.join('|') === ONE.join('|');
    if (!same && head.join('|') !== THREE.join('|')) {
      odd.push(`${section}: a table headed ${head.join(' | ')}`);
      continue;
    }
    for (const r of b.rows) {
      const [what, a = [], c = [], d = []] = r.cells;
      rows.push({
        section,
        what: inlineText(what ?? []),
        line: r.line,
        same,
        win: keysIn(a),
        silicon: keysIn(same ? a : c),
        intel: keysIn(same ? a : d),
        cells: r.cells.map(inlineText),
      });
    }
  }
  return { sections, rows, odd };
}

const { sections, rows, odd } = keyTables(parseMarkdown(keysMd));
const OPERATOR: KeyWindow = 'The operator window, in Pro Mode and Simple Mode';

/** A row's keys in a computer's column(s): Windows', or both Macs' (which name the same keys). */
const columnOf = (row: KeyRow, platform: Platform): readonly string[][] =>
  platform === 'win32' ? [[...row.win]] : [[...row.silicon], [...row.intel]];

/** Whether a row names every one of these keys, as this computer writes them, in its column(s). */
const names = (row: KeyRow, keys: readonly string[], platform: Platform) =>
  columnOf(row, platform).every((col) => keys.every((k) => col.includes(keyText(k, platform))));

/** One column for every computer only when each computer writes each key the same. */
const sameEverywhere = (byPlatform: Record<Platform, readonly string[]>) =>
  byPlatform.win32.length === byPlatform.darwin.length &&
  byPlatform.win32.every((k, i) => keyText(k, 'win32') === keyText(byPlatform.darwin[i] ?? '', 'darwin'));

describe('the manual’s Keys chapter: every window’s keys, on Windows and on a Mac with Apple silicon or Intel', () => {
  it('has a section for each window, in order, and only key tables of its two kinds', () => {
    expect(sections).toEqual([...KEY_WINDOWS]);
    expect(odd).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('names every key of the operator window’s keymap, as each computer writes it', () => {
    const operator = rows.filter((r) => r.section === OPERATOR);
    const missing = KEYMAP.filter(
      (b) =>
        !operator.some(
          (r) =>
            PLATFORMS.every((p) => names(r, b.keys, p)) &&
            (!r.same || sameEverywhere({ win32: b.keys, darwin: b.keys })),
        ),
    ).map(
      (b) => `${b.action}: ${PLATFORMS.map((p) => b.keys.map((k) => keyText(k, p)).join(' ')).join(' / ')}`,
    );
    expect(missing).toEqual([]);
  });

  it('names every other window’s keys in its own section, in the words of WINDOW_KEYS, as each computer writes them', () => {
    const wrong = WINDOW_KEYS.flatMap((e) => {
      const row = rows.find((r) => r.section === e.window && r.what === e.what);
      if (!row) return [`${e.window} › ${e.what}: no row`];
      const on = { win32: keysOn(e, 'win32'), darwin: keysOn(e, 'darwin') };
      if (row.same && !sameEverywhere(on))
        return [`${e.window} › ${e.what}: one column, but the computers differ`];
      return PLATFORMS.flatMap((p) => {
        if (on[p].length === 0)
          return row.cells.slice(p === 'win32' ? 1 : 2, p === 'win32' ? 2 : 4).every((c) => c === 'No key')
            ? []
            : [`${e.window} › ${e.what}: ${p} has no key, and its column should say No key`];
        return names(row, on[p], p)
          ? []
          : [`${e.window} › ${e.what}: ${p} should name ${on[p].map((k) => keyText(k, p)).join(' ')}`];
      });
    });
    expect(wrong).toEqual([]);
  });

  it('names no key that is not the window’s: every key in a table is one of its keys, on that computer', () => {
    const allowed = (section: string, platform: Platform) =>
      new Set(
        [
          ...(section === OPERATOR ? KEYMAP.flatMap((b) => b.keys) : []),
          ...WINDOW_KEYS.filter((e) => e.window === section).flatMap((e) => keysOn(e, platform)),
        ].map((k) => keyText(k, platform)),
      );
    const stray = rows.flatMap((r) =>
      PLATFORMS.flatMap((p) =>
        columnOf(r, p)
          .flat()
          .filter((k) => !allowed(r.section, p).has(k))
          .map((k) => `${r.section}, line ${String(r.line)}: ${k} (${p})`),
      ),
    );
    expect([...new Set(stray)]).toEqual([]);
  });

  it('gives both Macs the same keys, and says on every F-key how a Mac keyboard and a Touch Bar press it', () => {
    const differ = rows
      .filter((r) => !r.same && r.silicon.join(' ') !== r.intel.join(' '))
      .map((r) => `${r.section} › ${r.what}`);
    expect(differ).toEqual([]);
    const fKey = /^⇧?F\d{1,2}$/u;
    const unsaid = rows
      .filter((r) => !r.same && r.silicon.some((k) => fKey.test(k)))
      .filter(
        (r) => !(r.cells[2] ?? '').includes('(fn)') || !(r.cells[3] ?? '').includes('(fn or Touch Bar)'),
      )
      .map((r) => `${r.section} › ${r.what}`);
    expect(unsaid).toEqual([]);
    // Nor in one column for every computer: a Mac's F-keys need their words.
    expect(rows.filter((r) => r.same && r.win.some((k) => fKey.test(k))).map((r) => r.what)).toEqual([]);
    // How: the Mac's setting, the Touch Bar's Function Keys list, and Windows' Fn Lock.
    for (const words of [
      'Use F1, F2, etc. keys as standard function keys',
      'Function Keys',
      'Touch Bar',
      'Apple silicon',
      'Intel',
      'Fn Lock',
    ])
      expect(keysMd, words).toContain(words);
  });

  it('lists the Access List’s and the studio’s keys as their windows act on them (ownWindowKey)', () => {
    const input = (binding: string, platform: Platform) => {
      const parts = binding.split('+');
      const key = (parts.pop() ?? '').toLowerCase();
      const mod = parts.includes('Mod');
      return {
        type: 'keyDown' as const,
        key,
        meta: platform === 'darwin' && mod,
        control: parts.includes('Ctrl') || (platform === 'win32' && mod),
        alt: parts.includes('Alt'),
        shift: parts.includes('Shift'),
      };
    };
    const own = (what: string) =>
      WINDOW_KEYS.find((e) => e.window === 'The Access List and the Lower Thirds studio' && e.what === what);
    const typing = own('Undo or redo the typing');
    const close = own('Close the window');
    expect(typing).toBeDefined();
    expect(close).toBeDefined();
    for (const p of PLATFORMS) {
      for (const k of keysOn(typing ?? { window: OPERATOR, what: '', keys: [] }, p))
        expect(['undo', 'redo'], `${k} on ${p}`).toContain(ownWindowKey(input(k, p), p));
      // A Mac's ⌘W is the window's own; Windows' Ctrl+W is Window › Close, the menu's.
      for (const k of keysOn(close ?? { window: OPERATOR, what: '', keys: [] }, p))
        expect(ownWindowKey(input(k, p), p), `${k} on ${p}`).toBe(p === 'darwin' ? 'close' : null);
    }
  });
});
