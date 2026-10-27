import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  ACCESS_COLUMNS,
  computerLine,
  computersOf,
  formatDay,
  formatMinutes,
  formatSeen,
  statusDetail,
  statusTone,
  statusWord,
  type AccessColumn,
  type AccessSort,
} from '../../../shared/access-list';
import { gmailKey, type AccessPerson } from '../../../shared/access-protocol';
import { Badge } from '../ui/Badge';
import { cx } from '../ui/cx';
import { ArrowDown, ArrowUp, ArrowUpDown } from '../ui/icons';
import { layoutRows, scrollToShow, visibleRows } from '../ui/virtual';

/*
 * The Access List's table (Session 54, E4): every Gmail shown, one row each, like a spreadsheet: its header and
 * its Gmail column stay put as it scrolls either way. Only the rows in view (and a margin) exist, so 200 Gmails or
 * 2,000 scroll as quickly as 20; each row is as tall as its computers need, one line each.
 *
 * Keyboard: the header is one Tab stop (← and → between its columns, Enter or Space sorts by one, again the other
 * way), and the rows are one more (↑ and ↓, Page Up and Page Down, Home and End choose a row; the bar under the
 * table has the chosen Gmail's edits, next in the Tab order). A row is chosen by a click anywhere on it too.
 */

const WIDTHS: Record<AccessColumn, number> = {
  gmail: 270,
  status: 200,
  requested: 116,
  approved: 116,
  revoked: 116,
  computers: 290,
  lastSeen: 150,
  minutes: 104,
  shows: 80,
  streams: 88,
  recordings: 104,
  imports: 84,
  note: 280,
};
const TABLE_WIDTH = Object.values(WIDTHS).reduce((a, b) => a + b, 0);

/** Each line of a row, and its padding above and below. */
const LINE = 21;
const PAD = 16;
/** The header row's height (the rows start under it, and scroll in under it). */
const HEADER = 38;
/** Rows drawn above and below what is in view. */
const MARGIN = 600;

/** A row's height: two lines (the Gmail and its name; a status and its line), or one for each computer. */
export const rowHeight = (p: AccessPerson): number => PAD + LINE * Math.max(2, p.computers.length);

const cell = 'border-b border-line px-3 py-2 align-top';

/** One line of a cell: cut off with "…" when it does not fit, whole on hover. */
function Line({
  text,
  tone = 'fg',
  className,
}: {
  text: string;
  tone?: 'fg' | 'muted' | 'faint';
  className?: string;
}) {
  return (
    <span
      title={text === '' ? undefined : text}
      className={cx(
        'block min-w-0 truncate leading-[21px]',
        tone === 'muted' ? 'text-xs text-muted' : tone === 'faint' ? 'text-xs text-faint' : 'text-fg',
        className,
      )}
    >
      {text}
    </span>
  );
}

const Row = memo(function Row({
  p,
  index,
  chosen,
  tabbable,
  now,
  onChoose,
  onKeys,
}: {
  p: AccessPerson;
  index: number;
  chosen: boolean;
  tabbable: boolean;
  now: number;
  onChoose: (gmail: string) => void;
  onKeys: (e: KeyboardEvent<HTMLButtonElement>, index: number) => void;
}) {
  const computers = computersOf(p);
  const numbers = 'text-right tabular-nums';
  return (
    <tr
      aria-rowindex={index + 2}
      style={{ height: rowHeight(p) }}
      className={cx('group cursor-default', chosen ? 'bg-panel-3' : 'hover:bg-panel-2')}
      data-testid="access-row"
      data-gmail={p.gmail}
      data-status={p.status}
      onClick={() => {
        onChoose(p.gmail);
      }}
    >
      <th
        scope="row"
        className={cx(
          cell,
          'sticky left-0 z-[1] border-l-2 text-left font-normal',
          chosen ? 'border-l-second/70 bg-panel-3' : 'border-l-transparent bg-panel group-hover:bg-panel-2',
        )}
      >
        <button
          type="button"
          tabIndex={tabbable ? 0 : -1}
          aria-current={chosen ? 'true' : undefined}
          data-row-button={gmailKey(p.gmail)}
          className="block w-full min-w-0 rounded-sm text-left"
          onKeyDown={(e) => {
            onKeys(e, index);
          }}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Line text={p.gmail} className="font-medium" />
            {p.owner && <Badge tone="info">Owner</Badge>}
          </span>
          <Line text={p.name} tone="muted" />
        </button>
      </th>
      <td className={cell}>
        <span className="flex h-[21px] items-center">
          <Badge tone={statusTone(p.status)}>{statusWord(p.status)}</Badge>
        </span>
        <Line text={statusDetail(p)} tone="muted" />
      </td>
      <td className={cell}>
        <Line text={formatDay(p.requestedAt)} />
      </td>
      <td className={cell}>
        <Line text={formatDay(p.approvedAt)} />
      </td>
      <td className={cell}>
        <Line text={formatDay(p.revokedAt)} />
      </td>
      <td className={cell}>
        {computers.length === 0 ? (
          <Line text="None yet" tone="faint" />
        ) : (
          computers.map((c, i) => (
            <Line
              key={`${String(i)}:${c.name}`}
              text={c.ended ? `${computerLine(c)} (ended)` : computerLine(c)}
              tone={c.ended ? 'faint' : 'fg'}
            />
          ))
        )}
      </td>
      <td className={cell}>
        <Line text={formatSeen(p.lastSeen, now)} />
      </td>
      <td className={cx(cell, numbers)}>
        <Line text={formatMinutes(p.minutes)} />
      </td>
      <td className={cx(cell, numbers)}>
        <Line text={p.shows.toLocaleString('en')} />
      </td>
      <td className={cx(cell, numbers)}>
        <Line text={p.streams.toLocaleString('en')} />
      </td>
      <td className={cx(cell, numbers)}>
        <Line text={p.recordings.toLocaleString('en')} />
      </td>
      <td className={cx(cell, numbers)}>
        <Line text={p.imports.toLocaleString('en')} />
      </td>
      <td className={cell}>
        <Line text={p.note} tone="muted" />
      </td>
    </tr>
  );
});

export function AccessTable({
  people,
  sort,
  onSort,
  chosen,
  onChoose,
  reveal,
  now,
}: {
  /** The rows shown, in their order. */
  people: readonly AccessPerson[];
  sort: AccessSort;
  onSort: (column: AccessColumn) => void;
  /** The chosen Gmail's key, or null. */
  chosen: string | null;
  /** A row chosen (by a click, or the keys: then it is brought into view). */
  onChoose: (gmail: string, reveal: boolean) => void;
  /** Bring the chosen row into view whenever this changes. */
  reveal: number;
  now: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const heights = useMemo(() => people.map(rowHeight), [people]);
  const layout = useMemo(() => layoutRows(heights), [heights]);
  const { start, end } = visibleRows(layout, Math.max(0, view.top), view.height, MARGIN);
  const chosenIndex = chosen === null ? -1 : people.findIndex((p) => gmailKey(p.gmail) === chosen);
  // The rows' Tab stop: the chosen row while it is drawn, otherwise the first row in view.
  const firstInView = visibleRows(layout, Math.max(0, view.top), Math.max(1, view.height - HEADER), 0).start;
  const tabbable = chosenIndex >= start && chosenIndex < end ? chosenIndex : firstInView;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setView({ top: el.scrollTop, height: el.clientHeight });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  // The chosen row brought into view when asked (chosen by the keys, sorted, edited), below the header. Read
  // after this drawing's own layout is kept (effects run in order), never the drawing before's.
  const latest = useRef({ layout, heights, chosenIndex });
  useEffect(() => {
    latest.current = { layout, heights, chosenIndex };
  });
  useEffect(() => {
    const el = box.current;
    const { layout: at, heights: sizes, chosenIndex: index } = latest.current;
    if (!el || index < 0) return;
    // Scrolled, the rows in view are drawn again as it says (onScroll).
    const to = scrollToShow(at, sizes, index, el.scrollTop, el.clientHeight - HEADER);
    if (to !== null) el.scrollTop = to;
  }, [reveal]);

  // A row chosen by the keys takes the keyboard once it is drawn.
  const focusWanted = useRef<string | null>(null);
  useEffect(() => {
    const key = focusWanted.current;
    if (key === null) return;
    const button = box.current?.querySelector<HTMLElement>(`[data-row-button="${CSS.escape(key)}"]`);
    if (!button) return;
    focusWanted.current = null;
    button.focus();
  });

  const onKeys = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const page = 10;
    const last = people.length - 1;
    const next =
      e.key === 'ArrowDown'
        ? index + 1
        : e.key === 'ArrowUp'
          ? index - 1
          : e.key === 'PageDown'
            ? index + page
            : e.key === 'PageUp'
              ? index - page
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? last
                  : null;
    if (next === null) return;
    e.preventDefault();
    const p = people[Math.max(0, Math.min(last, next))];
    if (!p) return;
    focusWanted.current = gmailKey(p.gmail);
    onChoose(p.gmail, true);
  };

  // The rows' handlers, the same from one drawing to the next, so a row is drawn again only when it changes.
  const handlers = useRef({ onKeys, onChoose });
  useEffect(() => {
    handlers.current = { onKeys, onChoose };
  });
  const rowKeys = useCallback((e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    handlers.current.onKeys(e, index);
  }, []);
  const rowChoose = useCallback((gmail: string) => {
    handlers.current.onChoose(gmail, false);
  }, []);

  const onHeaderKeys = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = ACCESS_COLUMNS.length;
    const to =
      e.key === 'ArrowRight'
        ? (i + 1) % n
        : e.key === 'ArrowLeft'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    box.current?.querySelectorAll<HTMLElement>('[data-column]')[to]?.focus();
  };

  const top = layout.offsets[start] ?? 0;
  const bottom = layout.total - (layout.offsets[end] ?? layout.total);
  const sortedIndex = ACCESS_COLUMNS.findIndex((c) => c.id === sort.column);
  return (
    <div
      ref={box}
      className="min-h-0 flex-1 overflow-auto bg-panel"
      data-testid="access-table"
      data-count={people.length}
      onScroll={(e) => {
        setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
      }}
    >
      <table
        className="border-separate border-spacing-0 text-sm"
        style={{ width: TABLE_WIDTH, tableLayout: 'fixed' }}
        aria-label="Gmails on the access list"
        aria-rowcount={people.length + 1}
      >
        <colgroup>
          {ACCESS_COLUMNS.map((c) => (
            <col key={c.id} style={{ width: WIDTHS[c.id] }} />
          ))}
        </colgroup>
        <thead>
          <tr aria-rowindex={1}>
            {ACCESS_COLUMNS.map((c, i) => {
              const sorted = sort.column === c.id;
              const Arrow = sorted ? (sort.descending ? ArrowDown : ArrowUp) : ArrowUpDown;
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={sorted ? (sort.descending ? 'descending' : 'ascending') : undefined}
                  style={{ height: HEADER }}
                  className={cx(
                    'sticky top-0 border-b border-line-strong bg-panel-2 px-1.5 text-left text-xs font-medium text-muted',
                    i === 0 ? 'left-0 z-[3]' : 'z-[2]',
                  )}
                >
                  <button
                    type="button"
                    tabIndex={i === Math.max(0, sortedIndex) ? 0 : -1}
                    data-column={c.id}
                    className={cx(
                      'inline-flex h-7 w-full min-w-0 items-center gap-1 rounded-md px-1.5 hover:bg-panel-3 hover:text-fg',
                      sorted && 'text-fg',
                      c.numeric && 'flex-row-reverse',
                    )}
                    onClick={() => {
                      onSort(c.id);
                    }}
                    onKeyDown={(e) => {
                      onHeaderKeys(e, i);
                    }}
                  >
                    <span className="truncate">{c.label}</span>
                    <Arrow size={12} aria-hidden="true" className={cx('shrink-0', !sorted && 'text-faint')} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {top > 0 && (
            <tr aria-hidden="true">
              <td colSpan={ACCESS_COLUMNS.length} style={{ height: top, padding: 0, border: 0 }} />
            </tr>
          )}
          {people.slice(start, end).map((p, k) => {
            const index = start + k;
            return (
              <Row
                key={gmailKey(p.gmail)}
                p={p}
                index={index}
                chosen={index === chosenIndex}
                tabbable={index === tabbable}
                now={now}
                onChoose={rowChoose}
                onKeys={rowKeys}
              />
            );
          })}
          {bottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={ACCESS_COLUMNS.length} style={{ height: bottom, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
